/* Browser checks of paint mode off the page's thread (tests/paint-worker.mjs): mesh maps baked in the paint worker
 * (or on the page in steps) match the synchronous bake, painting with them gives the same layers, the asynchronous
 * composite and save give the same maps and files, and the page keeps running meanwhile. */
import { unzipSync } from "fflate";
import { loadRegistry } from "../src/engine/registry";
import { Renderer } from "../src/engine/render/renderer";
import { BAKE_SETTINGS, mapGeneratorFor, type MapName } from "../src/engine/paint/mapgen";
import { makeMesh, sphereMesh, setCurrentMesh, type PaintMesh } from "../src/engine/paint/mesh";
import { bakeLog, bakeMap, encodePngAsync, paintWorker, paintWorkerOptions } from "../src/engine/paint/paint-client";
import { installMeshMaps } from "../src/engine/paint/meshmaps";
import { PaintProject, encodePng } from "../src/engine/paint/project";
import { gpuFor } from "../src/engine/paint/gpu";
import { PAINTER_MAPS } from "../src/engine/paint/painter";
import type { Target } from "../src/engine/render/renderer";

type Blocking = { ms: number; maxGap: number; longTasks: number; longest: number; longTotal: number; frames: number };
declare global {
  interface Window {
    paintReady: Promise<boolean>;
    bakeCompare: (size: number, rays: number) => Promise<Record<string, { worker: number; page: number; where: string }>>;
    bakeBlocking: (mode: "sync" | "worker" | "page", size: number, rays: number) => Promise<Blocking & { where: string }>;
    compositeBlocking: (mode: "sync" | "async", size: number, layers: number, rounds: number) => Promise<Blocking>;
    saveBlocking: (mode: "sync" | "async", size: number) => Promise<Blocking & { bytes: number }>;
    paintCompare: (size: number) => Promise<{ maps: Record<string, number>; pngs: number; pngsDiffer: string[]; ready: boolean }>;
  }
}

window.paintReady = loadRegistry("/public/data/").then(() => {
  installMeshMaps();
  return true;
});

/** a mesh with concave parts (two overlapping spheres, side by side in UV space), so rays hit something */
function twoSpheres(): PaintMesh {
  const a = sphereMesh(1, 48, 24),
    b = sphereMesh(0.6, 32, 16);
  const n = a.positions.length + b.positions.length;
  const pos = new Float32Array(n),
    nrm = new Float32Array(n),
    uv = new Float32Array((n / 3) * 2);
  pos.set(a.positions);
  nrm.set(a.normals);
  for (let i = 0; i < b.positions.length; i += 3) pos.set([b.positions[i] + 1.1, b.positions[i + 1] + 0.3, b.positions[i + 2]], a.positions.length + i);
  nrm.set(b.normals, a.normals.length);
  for (let i = 0; i < a.uvs.length; i += 2) uv.set([a.uvs[i] * 0.6, a.uvs[i + 1]], i);
  for (let i = 0; i < b.uvs.length; i += 2) uv.set([0.62 + b.uvs[i] * 0.38, b.uvs[i + 1] * 0.38], a.uvs.length + i);
  return makeMesh("two spheres", pos, nrm, uv);
}

const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let w = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > w || Number.isNaN(d)) w = Number.isNaN(d) ? Infinity : d;
  }
  return w;
};

/** runs `work` while measuring how often the page gets to run: a 10 ms timer, frames, long tasks */
async function measure<T>(work: () => Promise<T> | T): Promise<Blocking & { result: T }> {
  let longTasks = 0,
    longest = 0,
    longTotal = 0;
  const take = (l: PerformanceEntryList) => {
    for (const e of l) {
      longTasks++;
      longTotal += e.duration;
      longest = Math.max(longest, e.duration);
    }
  };
  const po = new PerformanceObserver((l) => take(l.getEntries()));
  try {
    po.observe({ type: "longtask", buffered: false });
  } catch {
    /* not supported */
  }
  let last = performance.now(),
    maxGap = 0,
    frames = 0,
    running = true;
  const tick = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  const raf = () => {
    frames++;
    if (running) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  await new Promise((r) => setTimeout(r, 20));
  last = performance.now();
  const t0 = performance.now();
  const result = await work();
  const ms = performance.now() - t0;
  maxGap = Math.max(maxGap, performance.now() - last);
  running = false;
  clearInterval(tick);
  await new Promise((r) => setTimeout(r, 100));
  take(po.takeRecords());
  po.disconnect();
  return { ms, maxGap, longTasks, longest, longTotal, frames, result };
}

const MAPS: MapName[] = ["seams", "position", "normal", "tangent", "curvature", "ambient_occlusion", "bent_normals", "thickness", "adjacency"];

/** every map: synchronous bake on the page against the worker's and the page's stepped bake */
window.bakeCompare = async (size, rays) => {
  await window.paintReady;
  BAKE_SETTINGS.ray_count = rays;
  const m = twoSpheres();
  const sync = new Renderer(),
    viaWorker = new Renderer(),
    viaPage = new Renderer();
  const out: Record<string, { worker: number; page: number; where: string }> = {};
  for (const map of MAPS) {
    const ref = gpuFor(sync).read(mapGeneratorFor(sync).getRT(m, map, size));
    paintWorkerOptions.prefer = "worker";
    await bakeMap(viaWorker, m, map, size);
    const where = bakeLog[bakeLog.length - 1]?.where ?? "?";
    paintWorkerOptions.prefer = "page";
    await bakeMap(viaPage, m, map, size);
    paintWorkerOptions.prefer = "worker";
    const w = gpuFor(viaWorker).read(mapGeneratorFor(viaWorker).getRT(m, map, size));
    const p = gpuFor(viaPage).read(mapGeneratorFor(viaPage).getRT(m, map, size));
    out[map] = { worker: maxDiff(ref, w), page: maxDiff(ref, p), where };
  }
  paintWorker.forget(m);
  return out;
};

/** an ambient occlusion bake (and the seams map it needs), as before (synchronous), in the worker, or on the page in steps */
window.bakeBlocking = async (mode, size, rays) => {
  await window.paintReady;
  BAKE_SETTINGS.ray_count = rays;
  const r = new Renderer();
  const m = twoSpheres();
  paintWorkerOptions.prefer = mode === "page" ? "page" : "worker";
  const res = await measure(async () => {
    if (mode === "sync") {
      gpuFor(r).read(mapGeneratorFor(r).get(m, "ambient_occlusion", size), 0, 0, 1, 1);
      return "page (synchronous)";
    }
    await bakeMap(r, m, "ambient_occlusion", size);
    gpuFor(r).read(mapGeneratorFor(r).get(m, "ambient_occlusion", size), 0, 0, 1, 1);
    return bakeLog[bakeLog.length - 1].where;
  });
  paintWorkerOptions.prefer = "worker";
  paintWorker.forget(m);
  mapGeneratorFor(r).forget(m);
  return { ...res, where: res.result };
};

const MAPS_3D = ["albedo", "orm", "emission", "normal_gl", "depth"] as const;

/** a project of `size`² with layers of every channel */
function bigProject(r: Renderer, size: number, layers: number): PaintProject {
  const m = sphereMesh(1, 48, 24);
  const p = new PaintProject(r, m, null);
  p.setSettings({ texture_size: Math.log2(size) });
  p.initProject();
  for (let i = 0; i < layers; i++) {
    const l = p.addLayer(0)!;
    for (const [k, t] of Object.entries(l.textures)) p.gpu.clear(t, [((i + 1) * 0.13) % 1, k.length * 0.1, 0.5, 0.5]);
  }
  return p;
}

/** what the 3D paint view does when the maps change: composite, then draw the five maps it shows into canvases */
window.compositeBlocking = async (mode, size, layers, rounds) => {
  await window.paintReady;
  const r = new Renderer();
  const p = bigProject(r, size, layers);
  const canvases = MAPS_3D.map(() => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c.getContext("2d")!;
  });
  const present = () => MAPS_3D.forEach((k, i) => p.gpu.present(p.compositor.maps[k]!, canvases[i], { opaque: true }));
  p.deferComposite = mode === "async";
  const res = await measure(async () => {
    for (let i = 0; i < rounds; i++) {
      p.setLayerAlpha(p.layers[0], "albedo", 0.5 + i * 0.01);
      if (mode === "async") await p.compositeAsync();
      present();
      await new Promise((res) => requestAnimationFrame(() => res(null)));
    }
  });
  p.dispose();
  return res;
};

/** saving a project of `size`² with three layers: save() against saveAsync() */
window.saveBlocking = async (mode, size) => {
  await window.paintReady;
  const r = new Renderer();
  const p = bigProject(r, size, 2);
  const res = await measure(async () => (mode === "sync" ? p.save("t") : await p.saveAsync("t", (t) => encodePngAsync(r, t))));
  p.dispose();
  return { ...res, bytes: res.result.length };
};

/** the same strokes painted with maps baked synchronously and with maps baked in the worker, composited
 *  synchronously and asynchronously; then saved both ways */
window.paintCompare = async (size) => {
  await window.paintReady;
  const brushes = await fetch("/public/data/brushes.json").then((x) => x.json());
  const byName = (n: string) => brushes.find((b: { tree_item: string }) => b.tree_item === n);
  const m = sphereMesh(1, 48, 24);
  const make = (r: Renderer) => {
    const p = new PaintProject(r, m, null);
    p.setSettings({ texture_size: Math.log2(size) });
    p.initProject();
    const f = 1 / Math.tan((35 * Math.PI) / 360),
      near = 0.1,
      far = 10;
    const proj = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4, 1];
    const mul = (x: number[], y: number[]) => {
      const o = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) o[c * 4 + rr] += x[k * 4 + rr] * y[c * 4 + k];
      return o;
    };
    p.painter.setView(mul(proj, view), [256, 256]);
    return p;
  };
  const a = make(new Renderer());
  const rb = new Renderer();
  const b = make(rb);
  b.painter.backgroundMaps = true;
  b.deferComposite = true;
  // nothing is painted until the worker's maps are there
  const readyAtFirst = b.painter.ready();
  await Promise.all(PAINTER_MAPS.map((n) => bakeMap(rb, m, n, size)));
  const ready = b.painter.ready();
  for (const p of [a, b]) {
    setCurrentMesh(m);
    p.setBrush(byName("Material/Wood"));
    p.painter.params.brush_size = 80;
    for (let i = 0; i <= 6; i++) p.paint({ brush_pos: [128, 40 + i * 30], brush_ppos: [128, 40 + Math.max(0, i - 1) * 30], rect_size: [256, 256] }, i === 6);
    p.setBrush(byName("Simple/Uniform"));
    p.painter.params.brush_size = 50;
    for (let i = 0; i <= 8; i++) p.paint({ brush_pos: [50 + i * 18, 150], brush_ppos: [50 + Math.max(0, i - 1) * 18, 150], rect_size: [256, 256] }, i === 8);
  }
  await b.compositeAsync();
  const maps: Record<string, number> = {};
  for (const k of ["albedo", "metallic", "roughness", "normal_map", "orm", "depth"] as const) maps[k] = maxDiff(a.gpu.read(a.compositor.maps[k] as Target), b.gpu.read(b.compositor.maps[k] as Target));
  const za = unzipSync(a.save("t")),
    zb = unzipSync(await b.saveAsync("t", (t) => encodePngAsync(rb, t)));
  const pngs = Object.keys(za).filter((k) => k.endsWith(".png"));
  const pngsDiffer = pngs.filter((k) => maxDiff(za[k], zb[k] ?? new Uint8Array(0)) !== 0);
  // encodePng and encodePngAsync of the same target
  const t = a.compositor.maps.albedo!;
  if (maxDiff(encodePng(a.gpu, t), await encodePngAsync(a.renderer, t)) !== 0) pngsDiffer.push("albedo map");
  return { maps, pngs: pngs.length, pngsDiffer, ready: !readyAtFirst && ready };
};
