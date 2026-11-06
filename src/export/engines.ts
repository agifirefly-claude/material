/* Exports Material Maker does not have: Cocos Creator 3.x (native .mtl material with its textures and .meta files)
 * and binary glTF (.glb), which Cocos Creator, Blender, Godot, Unity (glTFast), Unreal (Interchange), three.js and
 * Babylon.js all import with the material. */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { Renderer } from "../engine/render/renderer";
import { pictureRenderer, rootOf, type PictureRenderer } from "../engine/render/maps";
import type { GenMaterial } from "../engine/gen/misc";
import { previewMaps } from "../engine/materialMaps";
import { isColor } from "../engine/params/types";

export type MapName = "albedo" | "orm" | "normal" | "emission";

/** the material's maps as 8 bit pictures, only those its inputs feed (an unconnected map is left out, as Material Maker does) */
export async function materialPictures(renderer: Renderer | PictureRenderer, m: GenMaterial, size: number): Promise<Partial<Record<MapName, ImageData>>> {
  const r = pictureRenderer(renderer);
  await r.imagesLoaded(rootOf(m));
  const spec = previewMaps(m);
  if (!spec || spec.unlit) throw new Error("Only PBR materials (Static or Dynamic PBR) can be exported this way");
  const connected = (input: string) => !m.getInputDefs().some((d) => d.name === input) || m.isConnected(input);
  const want: [MapName, boolean][] = [
    ["albedo", true],
    ["orm", connected("ao_tex") || connected("roughness_tex") || connected("metallic_tex")],
    ["normal", connected("normal_tex")],
    ["emission", connected("emission_tex")],
  ];
  const out: Partial<Record<MapName, ImageData>> = {};
  for (const [k, on] of want) {
    if (!on) continue;
    const sc = spec.maps[k]();
    if (!sc?.outputType) continue;
    out[k] = await r.image(sc, size);
  }
  return out;
}

/** the material node's scalar parameters, as the engines name them */
export function materialFactors(m: GenMaterial) {
  const p = m.parameters;
  const c = isColor(p.albedo_color) ? p.albedo_color : { r: 1, g: 1, b: 1, a: 1 };
  const n = (k: string, d: number) => (typeof p[k] === "number" ? (p[k] as number) : d);
  return { albedo: c, metallic: n("metallic", 1), roughness: n("roughness", 1), emission: n("emission_energy", 1), normal: n("normal", 1), ao: n("ao", 1) };
}

export function pngBytes(img: ImageData): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b!.arrayBuffer())), "image/png"));
}

const uuid = () => crypto.randomUUID();

/* ---------- Cocos Creator 3.x ---------- */

/** cocos-engine v3.8 editor/assets/effects/builtin-standard.effect.meta */
export const COCOS_BUILTIN_STANDARD = "c8f66d17-351a-48da-a12c-0212d28575c4";
/** the opaque technique of builtin-standard has 6 passes (forward, forward-add, shadow-caster, reflect-map, planar-shadow, deferred) */
const COCOS_PASSES = 6;

/** an image's .meta, with its texture sub asset (id 6c48a, as Creator writes it), repeating and mip mapped */
export function cocosImageMeta(id: string, displayName: string) {
  return {
    ver: "1.0.27",
    importer: "image",
    imported: true,
    uuid: id,
    files: [".json", ".png"],
    subMetas: {
      "6c48a": {
        ver: "1.0.22",
        importer: "texture",
        uuid: `${id}@6c48a`,
        imported: true,
        files: [".json"],
        subMetas: {},
        userData: { wrapModeS: "repeat", wrapModeT: "repeat", minfilter: "linear", magfilter: "linear", mipfilter: "linear", premultiplyAlpha: false, anisotropy: 8, isUuid: true, imageUuidOrDatabaseUri: id, visible: false },
        displayName,
        id: "6c48a",
        name: "texture",
      },
    },
    userData: { type: "texture", redirect: `${id}@6c48a`, hasAlpha: true, fixAlphaTransparencyArtifacts: false },
  };
}

/** The files of a Cocos Creator 3.x material: drop the folder into the project's assets. */
export async function cocosFiles(r: Renderer | PictureRenderer, m: GenMaterial, name: string, size: number): Promise<Record<string, Uint8Array>> {
  const pics = await materialPictures(r, m, size);
  const f = materialFactors(m);
  const files: Record<string, Uint8Array> = {};
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));
  const tex = (id: string) => ({ __uuid__: `${id}@6c48a`, __expectedType__: "cc.Texture2D" });
  const defines: Record<string, boolean> = {};
  const props: Record<string, unknown> = {
    albedoScale: { __type__: "cc.Vec3", x: f.albedo.r, y: f.albedo.g, z: f.albedo.b },
    roughness: pics.orm ? f.roughness : 1,
    metallic: pics.orm ? f.metallic : 0,
  };
  const names: Record<MapName, [string, string, string]> = {
    albedo: ["albedo", "mainTexture", "USE_ALBEDO_MAP"],
    orm: ["pbr", "pbrMap", "USE_PBR_MAP"],
    normal: ["normal", "normalMap", "USE_NORMAL_MAP"],
    emission: ["emissive", "emissiveMap", "USE_EMISSIVE_MAP"],
  };
  for (const k of Object.keys(names) as MapName[]) {
    const img = pics[k];
    if (!img) continue;
    const [suffix, prop, define] = names[k];
    const id = uuid();
    const file = `${name}/${name}_${suffix}.png`;
    files[file] = await pngBytes(img);
    files[file + ".meta"] = enc(cocosImageMeta(id, `${name}_${suffix}`));
    props[prop] = tex(id);
    defines[define] = true;
  }
  // the pbr map's red channel is occlusion: how much of it applies
  if (pics.orm) props.occlusion = f.ao;
  if (pics.normal) props.normalStrength = f.normal;
  if (pics.emission) props.emissiveScale = { __type__: "cc.Vec3", x: f.emission, y: f.emission, z: f.emission };
  const mtl = {
    __type__: "cc.Material",
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _native: "",
    _effectAsset: { __uuid__: COCOS_BUILTIN_STANDARD, __expectedType__: "cc.EffectAsset" },
    _techIdx: 0,
    _defines: Array.from({ length: COCOS_PASSES }, () => ({ ...defines })),
    _states: Array.from({ length: COCOS_PASSES }, () => ({ rasterizerState: {}, depthStencilState: {}, blendState: { targets: [{}] } })),
    _props: [props, ...Array.from({ length: COCOS_PASSES - 1 }, () => ({}))],
  };
  files[`${name}/${name}.mtl`] = enc(mtl);
  files[`${name}/${name}.mtl.meta`] = enc({ ver: "1.0.21", importer: "material", imported: true, uuid: uuid(), files: [".json"], subMetas: {}, userData: {} });
  return files;
}

/* ---------- glTF ---------- */

export type GltfShape = "plane" | "sphere" | "cube";

/** a .glb holding the material on a plane, sphere or cube (metallic-roughness PBR, the maps embedded) */
export async function glbFile(r: Renderer | PictureRenderer, m: GenMaterial, name: string, size: number, shape: GltfShape): Promise<Uint8Array> {
  const pics = await materialPictures(r, m, size);
  const f = materialFactors(m);
  const texture = (img: ImageData, srgb: boolean) => {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false;
    return t;
  };
  const mat = new THREE.MeshStandardMaterial({ name, color: new THREE.Color().setRGB(f.albedo.r, f.albedo.g, f.albedo.b, THREE.SRGBColorSpace) });
  if (pics.albedo) mat.map = texture(pics.albedo, true);
  if (pics.orm) {
    // glTF's metallicRoughness texture is roughness in green, metallic in blue, occlusion (its own texture) in red: Material Maker's ORM
    const t = texture(pics.orm, false);
    mat.metalnessMap = mat.roughnessMap = mat.aoMap = t;
    mat.metalness = f.metallic;
    mat.roughness = f.roughness;
    mat.aoMapIntensity = f.ao;
  } else {
    mat.metalness = 0;
    mat.roughness = 1;
  }
  if (pics.normal) {
    mat.normalMap = texture(pics.normal, false);
    mat.normalScale.set(f.normal, f.normal);
  }
  if (pics.emission) {
    mat.emissiveMap = texture(pics.emission, true);
    mat.emissive.setRGB(1, 1, 1);
    mat.emissiveIntensity = f.emission;
  }
  const geo = shape === "sphere" ? new THREE.SphereGeometry(1, 64, 32) : shape === "cube" ? new THREE.BoxGeometry(2, 2, 2) : new THREE.PlaneGeometry(2, 2);
  if (shape === "plane") geo.rotateX(-Math.PI / 2);
  // tangents in the file, so every engine reads the normal map the same way
  if (pics.normal) geo.computeTangents();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const out = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  return new Uint8Array(out);
}
