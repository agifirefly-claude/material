import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { editor, useEditor } from "./store";
import { findMaterial, previewMaps } from "./materialMaps";
import { previews } from "./previews";
import { isColor } from "../engine/params/types";
import { buildGeometry, loadModel, objectByKey } from "./preview3d/objects";
import { getSettings, objectSettings, updateSettings, usePreview3DSettings } from "./preview3d/settings";
import { applyEnvironment, loadEnvironments, useEnvironments, type Stage } from "./preview3d/environments";
import { PostProcessor } from "./preview3d/postprocess";
import { CameraMenu, EnvironmentMenu, ModelMenu, PostProcessMenu } from "./preview3d/Menus";

const MAP_KEYS = ["albedo", "orm", "emission", "normal", "depth"] as const;
/** model_menu.gd rotation speeds, in radians per second */
const ROTATION_SPEEDS = [0, 0.15, 0.6, 1.2];
const CAMERA_HOME = new THREE.Vector3(0, 0.3, 3);

export function Preview3D({ active }: { active: boolean }) {
  useEditor();
  const settings = usePreview3DSettings();
  const envs = useEnvironments();
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    pivot: THREE.Group;
    mesh: THREE.Mesh;
    material: THREE.MeshPhysicalMaterial;
    canvases: Record<string, HTMLCanvasElement>;
    textures: Record<string, THREE.CanvasTexture>;
    stage: Stage;
    post: PostProcessor;
  } | null>(null);
  const [res, setRes] = useState(512);
  const [displace, setDisplace] = useState(false);
  const [note, setNote] = useState("");
  const [animTick, setAnimTick] = useState(0);
  const [custom, setCustom] = useState<THREE.BufferGeometry | null>(null);
  const models = useRef(new Map<string, Promise<THREE.BufferGeometry>>());

  // set up three.js once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#202226");
    const camera = new THREE.PerspectiveCamera(getSettings().fov, 1, 0.05, 100);
    camera.position.copy(CAMERA_HOME);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 150;
    const canvases: Record<string, HTMLCanvasElement> = {};
    const textures: Record<string, THREE.CanvasTexture> = {};
    for (const k of MAP_KEYS) {
      const c = document.createElement("canvas");
      c.width = c.height = 4;
      canvases[k] = c;
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = k === "albedo" || k === "emission" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      textures[k] = t;
    }
    const material = new THREE.MeshPhysicalMaterial({
      map: textures.albedo,
      aoMap: textures.orm,
      roughnessMap: textures.orm,
      metalnessMap: textures.orm,
      emissiveMap: textures.emission,
      emissive: new THREE.Color(1, 1, 1),
      normalMap: textures.normal,
      roughness: 1,
      metalness: 1,
    });
    // the model turns inside a pivot, as ObjectsPivot in preview_3d.tscn
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(buildGeometry("sphere", {}, false), material);
    pivot.add(m);
    scene.add(pivot);
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
    sun.shadow.camera.right = sun.shadow.camera.top = 2;
    sun.shadow.bias = -0.0005;
    const ambient = new THREE.AmbientLight(0xffffff, 0);
    scene.add(sun, ambient);
    const stage: Stage = { scene, pmrem: new THREE.PMREMGenerator(renderer), sun, ambient, envMaps: new Map() };
    const post = new PostProcessor(renderer, scene, camera);
    post.configure(getSettings().post);
    three.current = { renderer, scene, camera, controls, pivot, mesh: m, material, canvases, textures, stage, post };
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      post.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    // Ctrl+drag turns the model instead of the camera; Ctrl+wheel changes the field of view (preview_3d.gd on_gui_input)
    let turning: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      turning = { x: e.clientX, y: e.clientY };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!turning) return;
      const dx = (e.clientX - turning.x) * 0.01,
        dy = (e.clientY - turning.y) * 0.01;
      turning = { x: e.clientX, y: e.clientY };
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      pivot.rotateOnWorldAxis(right, dy);
      pivot.rotateOnWorldAxis(up, dx);
    };
    const upH = () => {
      turning = null;
      controls.enabled = true;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      updateSettings({ fov: Math.min(90, Math.max(10, getSettings().fov + (e.deltaY > 0 ? -1 : 1))) });
    };
    renderer.domElement.addEventListener("pointerdown", down, true);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", upH);
    renderer.domElement.addEventListener("wheel", wheel, { capture: true, passive: false });

    let raf = 0;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      pivot.rotateY(ROTATION_SPEEDS[getSettings().rotationSpeed] * dt);
      controls.update();
      post.draw(camera.position.distanceTo(controls.target));
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      post.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // the object, its shape parameters and tessellation (preview_mesh.gd update_mesh)
  const os = objectSettings(settings.object);
  const shapeKey = JSON.stringify([settings.object, os.params, os.tessellated]);
  useEffect(() => {
    const t = three.current!;
    const obj = objectByKey(settings.object);
    let live = true;
    const use = (geo: THREE.BufferGeometry, owned: boolean) => {
      if (!live) return;
      const old = t.mesh.geometry;
      geo.setAttribute("uv1", geo.attributes.uv);
      t.mesh.geometry = geo;
      if (t.mesh.userData.owned) old.dispose();
      t.mesh.userData.owned = owned;
    };
    if (obj.key === "custom") {
      if (custom) use(custom, false);
    } else if (obj.url) {
      let p = models.current.get(obj.url);
      if (!p) {
        p = loadModel(obj.url);
        models.current.set(obj.url, p);
      }
      p.then((g) => use(g, false)).catch((e) => editor.setStatus("Cannot load the model: " + e));
    } else use(buildGeometry(obj.key, os.params, os.tessellated), true);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, custom]);

  // the environment (environment_menu.gd, environment_manager.gd apply_environment)
  useEffect(() => {
    loadEnvironments();
  }, []);
  const env = envs[settings.environment] ?? envs[0];
  useEffect(() => {
    const t = three.current;
    if (!t || !env) return;
    applyEnvironment(t.stage, env, settings.clearBackground);
  }, [env, settings.clearBackground]);

  // post processing, camera and shadows
  useEffect(() => {
    const t = three.current!;
    t.post.configure(settings.post);
    t.camera.fov = settings.fov;
    t.camera.updateProjectionMatrix();
    t.renderer.shadowMap.enabled = settings.sunShadow;
    t.stage.sun.castShadow = settings.sunShadow;
    t.mesh.castShadow = t.mesh.receiveShadow = settings.sunShadow;
    t.material.needsUpdate = true;
  }, [settings.post, settings.fov, settings.sunShadow]);

  const resetCamera = () => {
    const t = three.current!;
    t.camera.position.copy(CAMERA_HOME);
    t.controls.target.set(0, 0, 0);
    t.pivot.rotation.set(0, 0, 0);
    t.controls.update();
  };
  const loadCustom = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".obj,.glb,.gltf";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        setCustom(await loadModel(f));
        updateSettings({ object: "custom" });
      } catch (err) {
        editor.setStatus("Cannot load the model: " + err);
      }
    };
    input.click();
  };

  // refresh the maps after changes
  const uvScale = os.uvScale.join(",");
  useEffect(() => {
    if (!active) return;
    const t = three.current;
    const r = editor.renderer;
    if (!t || !r) return;
    const timer = setTimeout(() => {
      const m = findMaterial(editor.root);
      if (!m) return setNote("This project has no material node.");
      const spec = previewMaps(m);
      if (!spec) return setNote(`“${m.getTypeName()}” is evaluated in 3D space, which this preview does not do yet. Its exports work.`);
      setNote("");
      const size = Math.min(res, m.imageSize);
      r.time = performance.now() / 1000;
      const present = new Set<string>();
      let usesTime = false;
      for (const k of MAP_KEYS) {
        try {
          const sc = spec.maps[k]();
          if (!sc || !sc.outputType) continue;
          const res = r.renderKeyed("3d:" + k, sc, size);
          usesTime ||= res.usesTime;
          const target = res.target;
          if (!target) continue;
          present.add(k);
          const c = t.canvases[k];
          const resized = c.width !== size;
          if (resized) c.width = c.height = size;
          r.present(target, c.getContext("2d")!, false);
          if (resized) {
            t.textures[k].dispose();
            const nt = new THREE.CanvasTexture(c);
            nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
            nt.colorSpace = t.textures[k].colorSpace;
            nt.anisotropy = 8;
            t.textures[k] = nt;
          } else t.textures[k].needsUpdate = true;
        } catch (e) {
          console.warn("3D map", k, e);
        }
      }
      const p = m.parameters;
      const mat = t.material;
      mat.map = t.textures.albedo;
      mat.aoMap = mat.roughnessMap = mat.metalnessMap = present.has("orm") ? t.textures.orm : null;
      mat.emissiveMap = present.has("emission") ? t.textures.emission : null;
      mat.normalMap = present.has("normal") ? t.textures.normal : null;
      if (usesTime && previews.animate) setAnimTick((x) => x + 1);
      // the object's UV scale (uv1_scale)
      const [su, sv] = uvScale.split(",").map(Number);
      for (const tx of Object.values(t.textures)) tx.repeat.set(su, sv);
      if (spec.unlit) {
        // unlit: the colour is all there is
        mat.emissiveMap = t.textures.albedo;
        mat.emissive.setRGB(1, 1, 1);
        mat.color.setRGB(0, 0, 0);
        mat.metalness = 0;
        mat.roughness = 1;
        mat.envMapIntensity = 0;
        mat.normalMap = null;
        mat.transparent = true;
        mat.alphaMap = null;
        mat.needsUpdate = true;
        return;
      }
      mat.envMapIntensity = 1;
      const ac = isColor(p.albedo_color) ? p.albedo_color : { r: 1, g: 1, b: 1, a: 1 };
      mat.color.setRGB(ac.r, ac.g, ac.b, THREE.SRGBColorSpace);
      mat.metalness = Number(p.metallic ?? 1);
      mat.roughness = Number(p.roughness ?? 1);
      mat.emissiveIntensity = Number(p.emission_energy ?? 1);
      const ns = Number(p.normal ?? 1);
      mat.normalScale.set(ns, ns);
      mat.aoMapIntensity = Number(p.ao ?? 1);
      mat.transparent = (!!p.flags_transparent || !("flags_transparent" in p)) && m.isConnected("opacity_tex");
      mat.alphaMap = null;
      mat.sheen = 0;
      if (displace && present.has("depth") && m.isConnected("depth_tex")) {
        mat.displacementMap = t.textures.depth;
        mat.displacementScale = -0.2 * Number(p.depth_scale ?? 0.5);
        mat.displacementBias = 0.1 * Number(p.depth_scale ?? 0.5);
      } else mat.displacementMap = null;
      mat.needsUpdate = true;
    }, animTick ? 70 : 120);
    return () => clearTimeout(timer);
  }, [editor.version, active, res, displace, uvScale, animTick]);

  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        <ModelMenu onLoadModel={loadCustom} hasCustom={!!custom} />
        <EnvironmentMenu />
        <PostProcessMenu />
        <CameraMenu onReset={resetCamera} />
        <select value={res} onChange={(e) => setRes(+e.target.value)} title="Texture resolution of the preview">
          {[256, 512, 1024, 2048].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        <label title="Use the depth map as displacement (turn on the model's tessellation for detail)">
          <input type="checkbox" checked={displace} onChange={(e) => setDisplace(e.target.checked)} /> depth
        </label>
      </div>
      <div className="body" ref={host}>
        {note && <div className="empty" style={{ position: "absolute", inset: "auto 0 0 0", background: "#000a" }}>{note}</div>}
      </div>
    </div>
  );
}
