/* Brush thumbnails (tools/painter/brush_preview.gd): one dab of the brush, half the view wide, painted on a plane
 * and rendered lit, the way Material Maker makes the icon of a brush it adds to a library. */
import * as THREE from "three";
import { PaintProject } from "../../engine/paint/project";
import { currentMesh, setCurrentMesh } from "../../engine/paint/mesh";
import { installMeshMaps } from "../../engine/paint/meshmaps";
import type { Renderer } from "../../engine/render/renderer";
import type { Dict } from "../../engine/gen/base";
import { geometryToPaintMesh } from "./meshes";

const VIEW = 256;
const MAPS = ["albedo", "orm", "emission", "normal_gl"] as const;

let gen: {
  project: PaintProject;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvases: Record<string, HTMLCanvasElement>;
  textures: Record<string, THREE.CanvasTexture>;
} | null = null;
let queue: Promise<unknown> = Promise.resolve();

function setup(r: Renderer) {
  installMeshMaps({ background: true });
  const keep = currentMesh();
  const mesh = geometryToPaintMesh(new THREE.PlaneGeometry(2, 2, 8, 8), "brush_preview_plane");
  const project = new PaintProject(r, mesh, null);
  // the preview's plane must not become the mesh Mesh Map nodes bake from
  setCurrentMesh(keep);
  project.setSettings({ texture_size: 9 });
  project.initProject();
  // a camera straight in front of the plane, the plane filling the view
  const f = 1 / Math.tan((30 * Math.PI) / 360);
  const near = 0.1,
    far = 10,
    dist = f;
  const proj = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -dist, 1];
  const m = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) m[c * 4 + rr] += proj[k * 4 + rr] * view[c * 4 + k];
  project.painter.setView(m, [VIEW, VIEW], { back: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] });
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, near, far);
  camera.position.set(0, 0, dist);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-1, 1.5, 2);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.9));
  const canvases: Record<string, HTMLCanvasElement> = {};
  const textures: Record<string, THREE.CanvasTexture> = {};
  for (const k of MAPS) {
    canvases[k] = document.createElement("canvas");
    textures[k] = new THREE.CanvasTexture(canvases[k]);
    textures[k].colorSpace = k === "albedo" || k === "emission" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  }
  const material = new THREE.MeshStandardMaterial({ map: textures.albedo, roughnessMap: textures.orm, metalnessMap: textures.orm, emissiveMap: textures.emission, emissive: new THREE.Color(1, 1, 1), normalMap: textures.normal_gl, metalness: 1, roughness: 1 });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  gen = { project, renderer, scene, camera, canvases, textures };
  return gen;
}

/** a PNG (base 64, as library icons are stored) of the brush; renders one at a time */
export function brushThumbnail(r: Renderer, brush: Dict, size = 64): Promise<string> {
  const p = queue.then(() => render(r, brush, size));
  queue = p.catch(() => {});
  return p;
}

async function render(r: Renderer, brush: Dict, size: number): Promise<string> {
  const g = gen ?? setup(r);
  const p = g.project;
  // a fresh layer, as a new project has it (init_textures)
  const l = p.layers[0];
  p.gpu.clear(l.textures.albedo, [1, 1, 1, 1]);
  p.gpu.clear(l.textures.emission, [0, 0, 0, 1]);
  p.gpu.clear(l.textures.normal, [0.5, 0.5, 0, 1]);
  p.gpu.clear(l.textures.do, [0, 1, 0, 0]);
  p.setBrush(brush);
  const prm = p.painter.params;
  const saved = { ...prm };
  Object.assign(prm, { brush_size: VIEW / 2, brush_opacity: 1, brush_hardness: 0.8, jitter_position: 0, jitter_size: 0, jitter_angle: 0, jitter_opacity: 0, pattern_angle: 0 });
  const at: [number, number] = [VIEW / 2, VIEW / 2];
  p.paint({ brush_pos: at, brush_ppos: at, rect_size: [VIEW, VIEW], pressure: 1 }, true);
  Object.assign(prm, saved);
  for (const k of MAPS) {
    const t = p.compositor.maps[k];
    if (!t) continue;
    const c = g.canvases[k];
    c.width = c.height = t.size;
    p.gpu.present(t, c.getContext("2d")!, { opaque: true });
    g.textures[k].needsUpdate = true;
  }
  g.renderer.setSize(size, size, false);
  g.renderer.render(g.scene, g.camera);
  return g.renderer.domElement.toDataURL("image/png").split(",")[1];
}
