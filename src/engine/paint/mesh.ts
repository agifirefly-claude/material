/* Meshes for mesh maps and painting: flat triangle arrays (what Material Maker's map generator reads from a Godot
 * surface), with the BVH used for ray cast maps and ports of MMCurvatureGenerator and MMAdjacencyGenerator
 * (addons/material_maker/map_generator). UVs use Material Maker's convention: v = 0 is the top row of a texture. */

export interface PaintMesh {
  /** unique per mesh, names cached maps */
  id: string;
  name: string;
  /** 3 floats per vertex, 3 vertices per triangle (not indexed) */
  positions: Float32Array;
  normals: Float32Array;
  /** 2 floats per vertex, v = 0 at the top of the texture */
  uvs: Float32Array;
  /** 4 floats per vertex */
  tangents: Float32Array;
  aabb: { position: [number, number, number]; size: [number, number, number] };
}

let meshCounter = 0;

export function makeMesh(name: string, positions: Float32Array, normals: Float32Array, uvs: Float32Array): PaintMesh {
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  if (!positions.length) min = max = [0, 0, 0];
  const size = max.map((m, k) => Math.max(m - min[k], 1e-6)) as [number, number, number];
  let tangents: Float32Array | null = null;
  const m = { id: "mesh" + ++meshCounter, name, positions, normals, uvs, aabb: { position: min as [number, number, number], size } } as PaintMesh;
  // computed when first needed (baking, painting): meshes are also made just to be the current mesh
  Object.defineProperty(m, "tangents", { get: () => (tangents ??= computeTangents(positions, normals, uvs)), enumerable: true });
  return m;
}

/** per vertex tangents (xyz + handedness), averaged over vertices sharing position, normal and uv */
function computeTangents(p: Float32Array, n: Float32Array, uv: Float32Array): Float32Array {
  const count = p.length / 3;
  const t = new Float32Array(count * 4);
  const acc = new Map<string, number[]>();
  const keys: string[] = [];
  for (let tri = 0; tri < count; tri += 3) {
    const i0 = tri,
      i1 = tri + 1,
      i2 = tri + 2;
    const e1 = [p[i1 * 3] - p[i0 * 3], p[i1 * 3 + 1] - p[i0 * 3 + 1], p[i1 * 3 + 2] - p[i0 * 3 + 2]];
    const e2 = [p[i2 * 3] - p[i0 * 3], p[i2 * 3 + 1] - p[i0 * 3 + 1], p[i2 * 3 + 2] - p[i0 * 3 + 2]];
    // the texture's v runs downwards here: flip it back for the usual tangent formula
    const du1 = uv[i1 * 2] - uv[i0 * 2],
      dv1 = -(uv[i1 * 2 + 1] - uv[i0 * 2 + 1]);
    const du2 = uv[i2 * 2] - uv[i0 * 2],
      dv2 = -(uv[i2 * 2 + 1] - uv[i0 * 2 + 1]);
    const d = du1 * dv2 - du2 * dv1;
    const r = Math.abs(d) < 1e-12 ? 0 : 1 / d;
    const tx = (e1[0] * dv2 - e2[0] * dv1) * r,
      ty = (e1[1] * dv2 - e2[1] * dv1) * r,
      tz = (e1[2] * dv2 - e2[2] * dv1) * r;
    for (const i of [i0, i1, i2]) {
      const key = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2], n[i * 3], n[i * 3 + 1], n[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]].map((x) => x.toFixed(5)).join(",");
      keys[i] = key;
      const a = acc.get(key) ?? [0, 0, 0];
      a[0] += tx;
      a[1] += ty;
      a[2] += tz;
      acc.set(key, a);
    }
  }
  for (let i = 0; i < count; i++) {
    const a = acc.get(keys[i])!;
    const nx = n[i * 3],
      ny = n[i * 3 + 1],
      nz = n[i * 3 + 2];
    // Gram-Schmidt against the normal
    const dot = a[0] * nx + a[1] * ny + a[2] * nz;
    let x = a[0] - nx * dot,
      y = a[1] - ny * dot,
      z = a[2] - nz * dot;
    let l = Math.hypot(x, y, z);
    if (l < 1e-9) {
      // any vector orthogonal to the normal
      [x, y, z] = Math.abs(nx) < 0.9 ? [0, -nz, ny] : [nz, 0, -nx];
      l = Math.hypot(x, y, z) || 1;
    }
    t[i * 4] = x / l;
    t[i * 4 + 1] = y / l;
    t[i * 4 + 2] = z / l;
    t[i * 4 + 3] = 1;
  }
  return t;
}

/* ---------- the current mesh (MMGenGraph.current_mesh): what Mesh Map nodes and brushes use ---------- */
type Listener = (m: PaintMesh | null) => void;
const listeners = new Set<Listener>();
let current: PaintMesh | null = null;
export function currentMesh(): PaintMesh | null {
  return current;
}
export function setCurrentMesh(m: PaintMesh | null): void {
  if (m === current) return;
  current = m;
  for (const l of listeners) l(m);
}
export function onCurrentMesh(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/* ---------- welding ---------- */
const FLT_EPSILON = 1.192092896e-7;

/** for every vertex, the index of the first vertex at the same position (the duplicate search of MMCurvatureGenerator) */
export function weldVertices(p: Float32Array): Int32Array {
  const count = p.length / 3;
  const sorted = Array.from({ length: count }, (_, i) => i);
  const sum = (i: number) => p[i * 3] + p[i * 3 + 1] + p[i * 3 + 2];
  sorted.sort((a, b) => sum(a) - sum(b) || b - a);
  const orig = new Int32Array(count);
  for (let si = 0; si < count; si++) {
    const vi = sorted[si];
    const s = sum(vi);
    let found = false;
    for (let oi = si + 1; oi < count; oi++) {
      const ov = sorted[oi];
      if (sum(ov) - s > 3 * FLT_EPSILON * Math.max(1, Math.abs(s))) break;
      const dx = p[ov * 3] - p[vi * 3],
        dy = p[ov * 3 + 1] - p[vi * 3 + 1],
        dz = p[ov * 3 + 2] - p[vi * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < FLT_EPSILON) {
        found = true;
        orig[vi] = ov;
        break;
      }
    }
    if (!found) orig[vi] = vi;
  }
  for (let i = 0; i < count; i++) {
    let o = orig[i];
    while (o !== orig[o]) o = orig[o];
    orig[i] = o;
  }
  return orig;
}

/* ---------- curvature (MMCurvatureGenerator, after Blender's cycles mesh code) ---------- */

/** per vertex (maximum, minimum) principal curvature, written as the vertex "colour" the curvature map rasterizes */
export function curvatureColors(m: PaintMesh): Float32Array {
  const p = m.positions;
  const count = p.length / 3;
  const orig = weldVertices(p);
  const v = (i: number) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a: number[]) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const faces = count / 3;
  const faceNormal: number[][] = [];
  for (let f = 0; f < faces; f++) faceNormal.push(norm(cross(sub(v(orig[f * 3 + 1]), v(orig[f * 3])), sub(v(orig[f * 3 + 2]), v(orig[f * 3])))));
  // edges between welded vertices, with the face that has them in this order (slot 0) and the reverse (slot 1)
  const edges = new Map<string, { v1: number; v2: number; f: [number, number] }>();
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const a = orig[f * 3 + k],
        b = orig[f * 3 + ((k + 1) % 3)];
      if (a === b) continue;
      const fwd = edges.get(a + "," + b);
      const rev = edges.get(b + "," + a);
      if (fwd) {
        if (fwd.f[0] === -1) fwd.f[0] = f;
      } else if (rev) {
        if (rev.f[1] === -1) rev.f[1] = f;
      } else edges.set(a + "," + b, { v1: a, v2: b, f: [f, -1] });
    }
  }
  const mean = new Float64Array(count);
  for (const e of edges.values()) {
    if (e.f[0] === -1 || e.f[1] === -1) continue;
    const ev = sub(v(e.v2), v(e.v1));
    const x = 0.5 * len(ev);
    const n0 = faceNormal[e.f[0]],
      n1 = faceNormal[e.f[1]];
    const cosT = dot(n0, n1);
    const sinT = dot(cross(n0, n1), norm(ev));
    // Godot winds front faces clockwise, these meshes counter clockwise: the two faces of an edge are swapped,
    // and so is the sign of Material Maker's "mean_curvature_data -= x*atan2(...)"
    const a = x * Math.atan2(sinT, cosT);
    mean[e.v1] += a;
    mean[e.v2] += a;
  }
  const gauss = new Float64Array(count);
  const area = new Float64Array(count);
  const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / ((len(a) * len(b)) || 1))));
  for (let f = 0; f < faces; f++) {
    const a = orig[f * 3],
      b = orig[f * 3 + 1],
      c = orig[f * 3 + 2];
    const va = v(a),
      vb = v(b),
      vc = v(c);
    const ts3 = len(cross(sub(vb, va), sub(vc, va))) / 6;
    gauss[a] += angle(sub(vb, va), sub(vc, va));
    gauss[b] += angle(sub(vc, vb), sub(va, vb));
    gauss[c] += angle(sub(va, vc), sub(vb, vc));
    area[a] += ts3;
    area[b] += ts3;
    area[c] += ts3;
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const o = orig[i];
    const ar = area[o] || 1e-12;
    const H = mean[o] / ar;
    const K = (2 * Math.PI - gauss[o]) / ar;
    const d = Math.sqrt(Math.max(0, H * H - K));
    out[i * 3] = H + d;
    out[i * 3 + 1] = H - d;
  }
  return out;
}

/* ---------- adjacency (MMAdjacencyGenerator) ---------- */

/** On the mesh split at its UV seams, each vertex of a border edge gets the UV of the vertex on the other side of the
 *  seam (z = 0), or its own UV with z = 1 on a border with no other side; other vertices get 0. */
export function adjacencyColors(m: PaintMesh): Float32Array {
  const p = m.positions,
    uv = m.uvs;
  const count = p.length / 3;
  // index vertices by position + uv, as a Godot surface is
  const index = new Int32Array(count);
  const ids = new Map<string, number>();
  const posKey = (i: number) => `${p[i * 3].toFixed(6)},${p[i * 3 + 1].toFixed(6)},${p[i * 3 + 2].toFixed(6)}`;
  for (let i = 0; i < count; i++) {
    const k = posKey(i) + `|${uv[i * 2].toFixed(6)},${uv[i * 2 + 1].toFixed(6)}`;
    let id = ids.get(k);
    if (id === undefined) ids.set(k, (id = i));
    index[i] = id;
  }
  // border edges: edges used by one face
  const use = new Map<string, number>();
  const ek = (a: number, b: number) => (a < b ? a + "," + b : b + "," + a);
  for (let f = 0; f < count / 3; f++) for (let k = 0; k < 3; k++) {
    const key = ek(index[f * 3 + k], index[f * 3 + ((k + 1) % 3)]);
    use.set(key, (use.get(key) ?? 0) + 1);
  }
  const border: [number, number][] = [];
  for (const [k, n] of use) if (n === 1) border.push(k.split(",").map(Number) as [number, number]);
  // match border edges by position
  const byPos = new Map<string, [number, number][]>();
  const pk = (a: number, b: number) => {
    const ka = posKey(a),
      kb = posKey(b);
    return ka < kb ? ka + "|" + kb : kb + "|" + ka;
  };
  for (const e of border) {
    const key = pk(e[0], e[1]);
    const l = byPos.get(key) ?? [];
    l.push(e);
    byPos.set(key, l);
  }
  const color = new Map<number, [number, number, number]>();
  const done = new Set<[number, number]>();
  for (const e of border) {
    if (done.has(e)) continue;
    const other = byPos.get(pk(e[0], e[1]))!.find((x) => x !== e && !done.has(x));
    const [i0, i1] = e;
    if (!other) {
      color.set(i0, [uv[i0 * 2], uv[i0 * 2 + 1], 1]);
      color.set(i1, [uv[i1 * 2], uv[i1 * 2 + 1], 1]);
      continue;
    }
    let [j0, j1] = other;
    if (posKey(i0) !== posKey(j0)) [j0, j1] = [j1, j0];
    color.set(i0, [uv[j0 * 2], uv[j0 * 2 + 1], 0]);
    color.set(i1, [uv[j1 * 2], uv[j1 * 2 + 1], 0]);
    color.set(j0, [uv[i0 * 2], uv[i0 * 2 + 1], 0]);
    color.set(j1, [uv[i1 * 2], uv[i1 * 2 + 1], 0]);
    done.add(other);
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const c = color.get(index[i]);
    if (c) out.set(c, i * 3);
  }
  return out;
}

/* ---------- BVH for ray cast maps ---------- */

/** A binary BVH packed into RGBA32F texels: nodes first (2 texels each), then triangles (3 texels each).
 *  Node texel 0: min.xyz, a; texel 1: max.xyz, b. b > 0: leaf with b triangles starting at triangle a;
 *  b == 0: inner node whose left child follows it and whose right child is node a. */
export interface PackedBvh {
  data: Float32Array;
  width: number;
  height: number;
  nodeCount: number;
  /** texel index where triangles start */
  triOffset: number;
}

export function buildBvh(positions: Float32Array, leafSize = 4): PackedBvh {
  const triCount = positions.length / 9;
  const order = Array.from({ length: triCount }, (_, i) => i);
  const centroid = new Float32Array(triCount * 3);
  const bmin = new Float32Array(triCount * 3),
    bmax = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++)
    for (let k = 0; k < 3; k++) {
      const a = positions[t * 9 + k],
        b = positions[t * 9 + 3 + k],
        c = positions[t * 9 + 6 + k];
      bmin[t * 3 + k] = Math.min(a, b, c);
      bmax[t * 3 + k] = Math.max(a, b, c);
      centroid[t * 3 + k] = (a + b + c) / 3;
    }
  const nodes: number[][] = [];
  const build = (start: number, end: number): number => {
    const id = nodes.length;
    const node = [Infinity, Infinity, Infinity, 0, -Infinity, -Infinity, -Infinity, 0];
    nodes.push(node);
    const cmin = [Infinity, Infinity, Infinity],
      cmax = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        node[k] = Math.min(node[k], bmin[t * 3 + k]);
        node[4 + k] = Math.max(node[4 + k], bmax[t * 3 + k]);
        cmin[k] = Math.min(cmin[k], centroid[t * 3 + k]);
        cmax[k] = Math.max(cmax[k], centroid[t * 3 + k]);
      }
    }
    const n = end - start;
    const ext = [cmax[0] - cmin[0], cmax[1] - cmin[1], cmax[2] - cmin[2]];
    const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    if (n <= leafSize || ext[axis] < 1e-9) {
      node[3] = start;
      node[7] = n;
      return id;
    }
    const part = order.slice(start, end).sort((a, b) => centroid[a * 3 + axis] - centroid[b * 3 + axis]);
    for (let i = 0; i < n; i++) order[start + i] = part[i];
    const mid = start + (n >> 1);
    build(start, mid);
    node[3] = build(mid, end);
    node[7] = 0;
    return id;
  };
  if (triCount) build(0, triCount);
  const texels = nodes.length * 2 + triCount * 3;
  const width = 2048;
  const height = Math.max(1, Math.ceil(texels / width));
  const data = new Float32Array(width * height * 4);
  nodes.forEach((nd, i) => data.set(nd, i * 8));
  const triOffset = nodes.length * 2;
  order.forEach((t, i) => {
    for (let v = 0; v < 3; v++) data.set([positions[t * 9 + v * 3], positions[t * 9 + v * 3 + 1], positions[t * 9 + v * 3 + 2], 0], (triOffset + i * 3 + v) * 4);
  });
  return { data, width, height, nodeCount: nodes.length, triOffset };
}

/* ---------- simple meshes, for new paint projects and tests ---------- */
export function sphereMesh(radius = 1, w = 64, h = 32): PaintMesh {
  const pos: number[] = [],
    nrm: number[] = [],
    uv: number[] = [];
  const vert = (i: number, j: number) => {
    const u = i / w,
      v = j / h;
    const th = u * Math.PI * 2,
      ph = v * Math.PI;
    const n = [-Math.cos(th) * Math.sin(ph), Math.cos(ph), Math.sin(th) * Math.sin(ph)];
    pos.push(n[0] * radius, n[1] * radius, n[2] * radius);
    nrm.push(...n);
    uv.push(u, v);
  };
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      // counter clockwise seen from outside
      vert(i, j);
      vert(i, j + 1);
      vert(i + 1, j + 1);
      vert(i, j);
      vert(i + 1, j + 1);
      vert(i + 1, j);
    }
  return makeMesh("sphere", new Float32Array(pos), new Float32Array(nrm), new Float32Array(uv));
}
