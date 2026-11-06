import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { editor, useEditor } from "./store";
import { findMaterial, hasStandardMaps, renderMap } from "./materialMaps";
import { isColor } from "../engine/params/types";

const MESHES = {
  sphere: () => new THREE.SphereGeometry(1, 192, 96),
  cube: () => new THREE.BoxGeometry(1.5, 1.5, 1.5, 96, 96, 96),
  cylinder: () => new THREE.CylinderGeometry(0.8, 0.8, 1.8, 192, 64),
  plane: () => new THREE.PlaneGeometry(2.2, 2.2, 256, 256),
  torus: () => new THREE.TorusGeometry(0.8, 0.35, 96, 192),
  knot: () => new THREE.TorusKnotGeometry(0.65, 0.22, 384, 64),
};
type MeshKind = keyof typeof MESHES;
const ENVS = { studio: "hdri/photo_studio_01_1k.hdr", forest: "hdri/epping_forest_01_1k.hdr" };
const MAP_KEYS = ["albedo", "orm", "emission", "normal", "depth"] as const;

export function Preview3D({ active }: { active: boolean }) {
  useEditor();
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    material: THREE.MeshPhysicalMaterial;
    canvases: Record<string, HTMLCanvasElement>;
    textures: Record<string, THREE.CanvasTexture>;
    pmrem: THREE.PMREMGenerator;
  } | null>(null);
  const [mesh, setMesh] = useState<MeshKind>("sphere");
  const [env, setEnv] = useState<keyof typeof ENVS>("studio");
  const [res, setRes] = useState(512);
  const [displace, setDisplace] = useState(false);
  const [tiling, setTiling] = useState(1);
  const [spin, setSpin] = useState(false);
  const [note, setNote] = useState("");

  // set up three.js once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#202226");
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    camera.position.set(0, 0.4, 4.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
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
    const m = new THREE.Mesh(MESHES.sphere(), material);
    scene.add(m);
    const pmrem = new THREE.PMREMGenerator(renderer);
    three.current = { renderer, scene, camera, controls, mesh: m, material, canvases, textures, pmrem };
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  useEffect(() => {
    const t = three.current!;
    t.mesh.geometry.dispose();
    const geo = MESHES[mesh]();
    geo.setAttribute("uv1", geo.attributes.uv);
    t.mesh.geometry = geo;
  }, [mesh]);

  useEffect(() => {
    const t = three.current!;
    new HDRLoader().load(ENVS[env], (tex) => {
      const envMap = t.pmrem.fromEquirectangular(tex).texture;
      t.scene.environment = envMap;
      t.scene.background = new THREE.Color("#202226");
      tex.dispose();
    });
  }, [env]);

  useEffect(() => {
    if (three.current) three.current.controls.autoRotate = spin;
  }, [spin]);

  // refresh the maps after changes
  useEffect(() => {
    if (!active) return;
    const t = three.current;
    const r = editor.renderer;
    if (!t || !r) return;
    const timer = setTimeout(() => {
      const m = findMaterial(editor.root);
      if (!m) return setNote("This project has no material node.");
      if (!hasStandardMaps(m)) return setNote(`“${m.getTypeName()}” has no texture maps to show here; the preview shows the standard PBR material only.`);
      setNote("");
      const size = Math.min(res, m.imageSize);
      const outputs: Record<string, number> = { albedo: 0, orm: 1, emission: 2, normal: 3, depth: 4 };
      for (const k of MAP_KEYS) {
        try {
          const target = renderMap(r, m, outputs[k], size, "3d:" + k);
          if (!target) continue;
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
      mat.aoMap = mat.roughnessMap = mat.metalnessMap = t.textures.orm;
      mat.emissiveMap = t.textures.emission;
      mat.normalMap = t.textures.normal;
      for (const tx of Object.values(t.textures)) tx.repeat.set(tiling, tiling);
      const ac = isColor(p.albedo_color) ? p.albedo_color : { r: 1, g: 1, b: 1, a: 1 };
      mat.color.setRGB(ac.r, ac.g, ac.b, THREE.SRGBColorSpace);
      mat.metalness = Number(p.metallic ?? 1);
      mat.roughness = Number(p.roughness ?? 1);
      mat.emissiveIntensity = Number(p.emission_energy ?? 1);
      const ns = Number(p.normal ?? 1);
      mat.normalScale.set(ns, ns);
      mat.aoMapIntensity = Number(p.ao ?? 1);
      mat.transparent = !!p.flags_transparent && m.isConnected("opacity_tex");
      mat.alphaMap = null;
      mat.sheen = 0;
      if (displace && m.isConnected("depth_tex")) {
        mat.displacementMap = t.textures.depth;
        mat.displacementScale = -0.2 * Number(p.depth_scale ?? 0.5);
        mat.displacementBias = 0.1 * Number(p.depth_scale ?? 0.5);
      } else mat.displacementMap = null;
      mat.needsUpdate = true;
    }, 120);
    return () => clearTimeout(timer);
  }, [editor.version, active, res, displace, tiling]);

  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        <select value={mesh} onChange={(e) => setMesh(e.target.value as MeshKind)}>
          {Object.keys(MESHES).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={env} onChange={(e) => setEnv(e.target.value as keyof typeof ENVS)}>
          {Object.keys(ENVS).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={res} onChange={(e) => setRes(+e.target.value)} title="Texture resolution of the preview">
          {[256, 512, 1024, 2048].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        <select value={tiling} onChange={(e) => setTiling(+e.target.value)} title="Tiling">
          {[1, 2, 3, 4].map((s) => (
            <option key={s} value={s}>
              ×{s}
            </option>
          ))}
        </select>
        <label title="Use the depth map as displacement">
          <input type="checkbox" checked={displace} onChange={(e) => setDisplace(e.target.checked)} /> depth
        </label>
        <label>
          <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> spin
        </label>
      </div>
      <div className="body" ref={host}>
        {note && <div className="empty" style={{ position: "absolute", inset: "auto 0 0 0", background: "#000a" }}>{note}</div>}
      </div>
    </div>
  );
}
