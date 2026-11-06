/* Port of the environment manager (material_maker/tools/environment_manager/environment_manager.gd): the read-only
 * environments that ship with Material Maker, the user's own (kept in the browser, their uploaded HDR images in
 * IndexedDB), and how one lights the 3D preview: the HDR sky (background and reflections), a background colour,
 * an ambient light, and a sun. */
import { useSyncExternalStore } from "react";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

type C = { type?: "Color"; r: number; g: number; b: number; a: number };
export interface Environment {
  name: string;
  hdri_url: string;
  show_color: boolean;
  color: C;
  sky_energy: number;
  ambient_light_color: C;
  ambient_light_energy: number;
  ambient_light_sky_contribution: number;
  sun_color: C;
  sun_energy: number;
  /** degrees around the vertical axis */
  sun_direction: number;
  /** degrees above the horizon */
  sun_angle: number;
  /** base64 PNG */
  thumbnail?: string;
}

/** environment_manager.gd DEFAULT_ENVIRONMENT, on a bundled HDR image */
export const DEFAULT_ENVIRONMENT: Environment = {
  name: "New environment",
  hdri_url: "hdri/photo_studio_01_1k.hdr",
  show_color: false,
  color: { type: "Color", r: 0, g: 0, b: 0, a: 1 },
  sky_energy: 1.1,
  ambient_light_color: { type: "Color", r: 0, g: 0, b: 0, a: 1 },
  ambient_light_energy: 1,
  ambient_light_sky_contribution: 1,
  sun_color: { type: "Color", r: 1, g: 1, b: 1, a: 1 },
  sun_energy: 0,
  sun_direction: 0,
  sun_angle: 90,
};

/** the HDR images the app serves */
export const BUNDLED_HDRIS = ["photo_studio_01_1k.hdr", "epping_forest_01_1k.hdr", "moonless_golf_1k.hdr"];

const USER_KEY = "material-pro:environments";
let builtins: Environment[] = [];
let user: Environment[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "[]");
  } catch {
    return [];
  }
})();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const save = () => {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage full: thumbnails are the large part */
  }
};

let loading: Promise<void> | null = null;
export function loadEnvironments(): Promise<void> {
  loading ??= fetch("data/environments.json")
    .then((r) => r.json())
    .then((list: Environment[]) => {
      builtins = list;
      emit();
    })
    .catch(() => {
      builtins = [{ ...DEFAULT_ENVIRONMENT, name: "Studio" }];
      emit();
    });
  return loading;
}

export function environments(): Environment[] {
  return [...builtins, ...user];
}
export const isReadOnly = (i: number) => i < builtins.length;
export function useEnvironments(): Environment[] {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return environments();
}

/** environment_manager.gd new_environment: a copy of an environment (or the default one) the user can edit */
export function newEnvironment(from: number): number {
  const base = from >= 0 ? environments()[from] : DEFAULT_ENVIRONMENT;
  user.push({ ...structuredClone(base), name: base === DEFAULT_ENVIRONMENT ? base.name : base.name + " copy" });
  save();
  emit();
  return environments().length - 1;
}
export function deleteEnvironment(i: number): void {
  if (isReadOnly(i)) return;
  user.splice(i - builtins.length, 1);
  save();
  emit();
}
export function setEnvironmentValue<K extends keyof Environment>(i: number, key: K, value: Environment[K]): void {
  if (isReadOnly(i) || i >= environments().length) return;
  user[i - builtins.length] = { ...user[i - builtins.length], [key]: value };
  if (key !== "thumbnail" && key !== "name") delete user[i - builtins.length].thumbnail;
  save();
  emit();
}

/* ---------- HDR images ---------- */
const DB = "material-pro-hdri";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("hdri");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
/** keeps an uploaded HDR image and returns the hdri_url that refers to it */
export async function storeHdr(file: File): Promise<string> {
  const id = `${Date.now().toString(36)}-${file.name}`;
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const t = db.transaction("hdri", "readwrite");
    t.objectStore("hdri").put(file, id);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return "idb:" + id;
}
async function readHdr(id: string): Promise<Blob | null> {
  const db = await idb();
  return new Promise((res) => {
    const r = db.transaction("hdri").objectStore("hdri").get(id);
    r.onsuccess = () => res((r.result as Blob) ?? null);
    r.onerror = () => res(null);
  });
}
/** where an hdri_url can be read from: Material Maker's own URLs point to images the app serves */
export async function hdrUrl(url: string): Promise<string> {
  if (url.startsWith("idb:")) {
    const b = await readHdr(url.slice(4));
    if (!b) throw new Error("The uploaded HDR image is not in this browser any more");
    return URL.createObjectURL(b);
  }
  const file = url.split("/").pop() ?? "";
  if (BUNDLED_HDRIS.includes(file)) return "hdri/" + file;
  return url;
}
export const hdrLabel = (url: string) => (url.startsWith("idb:") ? url.slice(4).replace(/^[^-]*-/, "") + " (uploaded)" : url.split("/").pop() ?? url);

const hdrCache = new Map<string, Promise<THREE.DataTexture>>();
export function loadHdr(url: string): Promise<THREE.DataTexture> {
  let p = hdrCache.get(url);
  if (!p) {
    p = hdrUrl(url).then((u) => new HDRLoader().loadAsync(u) as Promise<THREE.DataTexture>);
    p.catch(() => hdrCache.delete(url));
    hdrCache.set(url, p);
  }
  return p;
}

/* ---------- lighting the preview (apply_environment) ---------- */
export interface Stage {
  scene: THREE.Scene;
  pmrem: THREE.PMREMGenerator;
  sun: THREE.DirectionalLight;
  ambient: THREE.AmbientLight;
  /** environment maps already made, by hdri_url */
  envMaps: Map<string, THREE.Texture>;
}
const color = (c: C) => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);

/** the sun's direction: Godot turns the light by sun_direction around Y and -sun_angle around X, and it shines along -Z */
export function sunDirection(env: Environment): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(THREE.MathUtils.degToRad(-env.sun_angle), THREE.MathUtils.degToRad(env.sun_direction), 0, "YXZ"));
}

export async function applyEnvironment(stage: Stage, env: Environment, clearBackground: boolean, panelColor = "#202226"): Promise<void> {
  const { scene } = stage;
  let envMap = stage.envMaps.get(env.hdri_url);
  let sky: THREE.DataTexture | null = null;
  try {
    sky = await loadHdr(env.hdri_url);
    sky.mapping = THREE.EquirectangularReflectionMapping;
    if (!envMap) {
      envMap = stage.pmrem.fromEquirectangular(sky).texture;
      stage.envMaps.set(env.hdri_url, envMap);
    }
  } catch (e) {
    console.warn("environment HDR", env.hdri_url, e);
  }
  scene.environment = envMap ?? null;
  // Godot's background energy scales the sky's light as well as its look
  scene.environmentIntensity = env.sky_energy;
  if (clearBackground) scene.background = new THREE.Color(panelColor);
  else if (env.show_color) scene.background = color(env.color);
  else {
    scene.background = sky;
    scene.backgroundIntensity = env.sky_energy;
  }
  // the part of the ambient light that does not come from the sky
  stage.ambient.color = color(env.ambient_light_color);
  stage.ambient.intensity = env.ambient_light_energy * (1 - env.ambient_light_sky_contribution) * Math.PI;
  stage.sun.color = color(env.sun_color);
  stage.sun.intensity = env.sun_energy * Math.PI;
  stage.sun.position.copy(sunDirection(env).multiplyScalar(-6));
}

/* ---------- thumbnails (environment_manager.gd create_preview: a sphere lit by the environment) ---------- */
let thumbs: { renderer: THREE.WebGLRenderer; stage: Stage; camera: THREE.PerspectiveCamera } | null = null;
let thumbQueue: Promise<unknown> = Promise.resolve();
/** renders one at a time: the renderer is shared */
export function renderThumbnail(env: Environment, size = 64): Promise<string> {
  const p = thumbQueue.then(() => doRenderThumbnail(env, size));
  thumbQueue = p.catch(() => {});
  return p;
}
async function doRenderThumbnail(env: Environment, size: number): Promise<string> {
  if (!thumbs) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight();
    const ambient = new THREE.AmbientLight();
    scene.add(sun, ambient);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.2 });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 48, 24), mat));
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0, 2.6);
    thumbs = { renderer, stage: { scene, pmrem: new THREE.PMREMGenerator(renderer), sun, ambient, envMaps: new Map() }, camera };
  }
  thumbs.renderer.setSize(size, size);
  await applyEnvironment(thumbs.stage, env, false);
  thumbs.renderer.render(thumbs.stage.scene, thumbs.camera);
  return thumbs.renderer.domElement.toDataURL("image/png").split(",")[1];
}

/** a user environment's thumbnail, made when it is missing (update_thumbnail) */
export async function ensureThumbnail(i: number): Promise<void> {
  const env = environments()[i];
  if (!env || env.thumbnail || isReadOnly(i)) return;
  try {
    setEnvironmentValue(i, "thumbnail", await renderThumbnail(env));
  } catch (e) {
    console.warn("thumbnail", e);
  }
}
