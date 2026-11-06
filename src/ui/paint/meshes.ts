/* three.js geometry <-> the paint engine's meshes, and model files (OBJ, glTF, GLB). */
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeMesh, type PaintMesh } from "../../engine/paint/mesh";

/** one non indexed geometry with position, normal and uv from a model file */
export async function loadModelGeometry(name: string, data: ArrayBuffer | Uint8Array): Promise<THREE.BufferGeometry> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let root: THREE.Object3D;
  if (/\.obj$/i.test(name)) root = new OBJLoader().parse(new TextDecoder().decode(bytes));
  else if (/\.fbx$/i.test(name)) root = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "");
  else {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    root = (await new GLTFLoader().parseAsync(/\.gltf$/i.test(name) ? new TextDecoder().decode(bytes) : buf, "")).scene;
  }
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
  return mergeGeometries(geos)!;
}

/** centres and scales a geometry to fit the views */
export function normalizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  geo.translate(-c.x, -c.y, -c.z);
  geo.scale(2.6 / size, 2.6 / size, 2.6 / size);
  return geo;
}

const cache = new WeakMap<THREE.BufferGeometry, PaintMesh>();
/** the paint engine's mesh of a geometry (UV v flipped: v = 0 is the top of a texture in Material Maker) */
export function geometryToPaintMesh(geo: THREE.BufferGeometry, name = "mesh"): PaintMesh {
  const hit = cache.get(geo);
  if (hit) return hit;
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array as Float32Array;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nrm = g.attributes.normal.array as Float32Array;
  const uvSrc = g.attributes.uv?.array as Float32Array | undefined;
  const uv = new Float32Array((pos.length / 3) * 2);
  if (uvSrc) for (let i = 0; i < uv.length; i += 2) {
    uv[i] = uvSrc[i];
    uv[i + 1] = 1 - uvSrc[i + 1];
  }
  const m = makeMesh(name, Float32Array.from(pos), Float32Array.from(nrm), uv);
  cache.set(geo, m);
  return m;
}

/** the geometry of a paint mesh, for three.js */
export function paintMeshToGeometry(m: PaintMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  const uv = new Float32Array(m.uvs.length);
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = m.uvs[i];
    uv[i + 1] = 1 - m.uvs[i + 1];
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("uv1", new THREE.BufferAttribute(uv, 2));
  return g;
}

export const BUILTIN_MESHES: Record<string, () => THREE.BufferGeometry> = {
  sphere: () => new THREE.SphereGeometry(1, 96, 48),
  cube: () => new THREE.BoxGeometry(1.5, 1.5, 1.5, 8, 8, 8),
  cylinder: () => new THREE.CylinderGeometry(0.8, 0.8, 1.8, 96, 8),
  torus: () => new THREE.TorusGeometry(0.8, 0.35, 48, 96),
  knot: () => new THREE.TorusKnotGeometry(0.65, 0.22, 256, 32),
  plane: () => new THREE.PlaneGeometry(2.2, 2.2, 32, 32),
};
