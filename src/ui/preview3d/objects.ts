/* The objects the 3D preview shows (material_maker/panels/preview_3d/preview_objects.tscn): Material Maker's cube and
 * cylinder with a chamfer, its sphere, its plane with a curvature, its prism, the models shipped with it, and a model
 * of the user's. Each has a UV scale (uv1_scale) and may be tessellated for displacement (preview_mesh.gd). */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface ObjectParam {
  name: string;
  label: string;
  min: number;
  max: number;
  default: number;
}
export interface PreviewObject {
  key: string;
  label: string;
  /** Material Maker's default uv1_scale for it */
  uvScale: [number, number];
  canTessellate: boolean;
  params: ObjectParam[];
  /** a model file served by the app, or undefined for generated geometry */
  url?: string;
}

export const PREVIEW_OBJECTS: PreviewObject[] = [
  { key: "cube", label: "Cube", uvScale: [3, 2], canTessellate: true, params: [{ name: "chamfer", label: "Chamfer", min: 0, max: 1, default: 0.2 }] },
  { key: "cylinder", label: "Cylinder", uvScale: [3, 1], canTessellate: true, params: [{ name: "chamfer", label: "Chamfer", min: 0, max: 1, default: 0.2 }] },
  { key: "sphere", label: "Sphere", uvScale: [4, 2], canTessellate: true, params: [] },
  { key: "plane", label: "Plane", uvScale: [2, 2], canTessellate: true, params: [{ name: "curvature", label: "Curvature", min: 0, max: 5, default: 0.5 }] },
  { key: "prism", label: "Prism", uvScale: [3, 2], canTessellate: true, params: [] },
  { key: "torus", label: "Torus", uvScale: [4, 1], canTessellate: true, params: [] },
  { key: "suzanne", label: "Suzanne", uvScale: [1, 1], canTessellate: false, params: [], url: "meshes/suzanne.obj" },
  { key: "pillow", label: "Pillow", uvScale: [1, 1], canTessellate: false, params: [], url: "meshes/pillow.obj" },
  { key: "vase", label: "Vase", uvScale: [1, 1], canTessellate: false, params: [], url: "meshes/vase.obj" },
  { key: "custom", label: "Custom model", uvScale: [1, 1], canTessellate: false, params: [] },
];
export const objectByKey = (k: string) => PREVIEW_OBJECTS.find((o) => o.key === k) ?? PREVIEW_OBJECTS[2];

/** a cylinder whose rims are rounded by `chamfer` (the generated mesh of preview_objects.tscn) */
function chamferedCylinder(chamfer: number, radial: number, rows: number): THREE.BufferGeometry {
  const r = 0.55,
    h = 0.6;
  const c = Math.min(r, h) * Math.max(0.001, chamfer) * 0.5;
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h)];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= rows; i++) {
      const a = a0 + ((a1 - a0) * i) / rows;
      pts.push(new THREE.Vector2(cx + c * Math.cos(a), cy + c * Math.sin(a)));
    }
  };
  arc(r - c, -h + c, -Math.PI / 2, 0);
  arc(r - c, h - c, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, radial);
}

/** a plane bent around the horizontal axis by `curvature` */
function curvedPlane(curvature: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1.6, 1.6, segments, segments);
  if (curvature > 1e-4) {
    const p = g.attributes.position;
    const k = curvature * 0.8;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const a = y * k;
      p.setY(i, Math.sin(a) / k);
      p.setZ(i, (Math.cos(a) - 1) / k);
    }
    g.computeVertexNormals();
  }
  return g;
}

/** a triangular prism (Godot's PrismMesh: a triangle in XY extruded along Z) */
function prism(tessellated: boolean): THREE.BufferGeometry {
  const s = 0.9;
  const shape = new THREE.Shape([new THREE.Vector2(-s / 2, -s / 2), new THREE.Vector2(s / 2, -s / 2), new THREE.Vector2(0, s / 2)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: s, bevelEnabled: false, steps: tessellated ? 64 : 1 });
  g.translate(0, 0, -s / 2);
  // ExtrudeGeometry's side UVs are in shape units: bring them to 0..1
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / s + 0.5, uv.getY(i) / s + 0.5);
  return g;
}

/** generated geometry of an object (not models) */
export function buildGeometry(key: string, params: Record<string, number>, tessellated: boolean): THREE.BufferGeometry {
  const t = tessellated ? 4 : 1;
  switch (key) {
    case "cube":
      return new RoundedBoxGeometry(1, 1, 1, Math.max(2, 4 * t), Math.max(0.001, (params.chamfer ?? 0.2) * 0.25));
    case "cylinder":
      return chamferedCylinder(params.chamfer ?? 0.2, 64 * t, 8 * t);
    case "plane":
      return curvedPlane(params.curvature ?? 0.5, 32 * t * 2);
    case "prism":
      return prism(tessellated);
    case "torus":
      return new THREE.TorusGeometry(0.5, 0.22, 32 * t, 64 * t);
    case "sphere":
    default:
      return new THREE.SphereGeometry(0.75, 64 * t, 32 * t);
  }
}

/** one geometry from a model (a URL or a file), centred and scaled to the size of the other objects */
export async function loadModel(source: File | string): Promise<THREE.BufferGeometry> {
  const isFile = typeof source !== "string";
  const name = isFile ? source.name : source;
  const url = isFile ? URL.createObjectURL(source) : source;
  try {
    let root: THREE.Object3D;
    if (/\.obj$/i.test(name)) root = new OBJLoader().parse(isFile ? await source.text() : await (await fetch(url)).text());
    else root = (await new GLTFLoader().loadAsync(url)).scene;
    root.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      geos.push(g);
    });
    if (!geos.length) throw new Error("No mesh in this file");
    const geo = mergeGeometries(geos)!;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    geo.translate(-c.x, -c.y, -c.z);
    geo.scale(1.8 / size, 1.8 / size, 1.8 / size);
    return geo;
  } finally {
    if (isFile) URL.revokeObjectURL(url);
  }
}
