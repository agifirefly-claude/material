/* The page side of the paint worker (paint.worker.ts): mesh maps baked off the page's thread, then uploaded into the
 * page's MeshMapGenerator in bands; PNGs encoded in the worker. Without a worker that can use WebGL2 on an
 * OffscreenCanvas, maps are baked on the page in steps (MeshMapGenerator.bake: a fence wait between draws), so the
 * page keeps running either way. The synchronous paths (MeshMapGenerator.get, encodePng) stay for tests and tools. */
import type { Renderer, Target } from "../render/renderer";
import { gpuFor, nextTask } from "./gpu";
import { BAKE_SETTINGS, bakeKey, mapGeneratorFor, type MapName } from "./mapgen";
import type { PaintMesh } from "./mesh";
import { encodePixels } from "./png";
import type { FromPaintWorker, ToPaintWorker } from "./paint.worker";

/** where maps are baked: "worker" when it works, else "page"; set `prefer` to "page" to compare */
export const paintWorkerOptions = { prefer: "worker" as "worker" | "page" };

type Pending = { resolve: (m: FromPaintWorker) => void };

class PaintWorkerClient {
  private worker: Worker | null = null;
  private failed = false;
  /** the worker cannot use WebGL2 (bakes go to the page; PNGs still go to the worker) */
  noGl = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private sent = new Set<string>();

  private get(): Worker | null {
    if (this.worker || this.failed) return this.worker;
    if (typeof Worker === "undefined") return ((this.failed = true), null);
    try {
      const w = new Worker(new URL("./paint.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<FromPaintWorker>) => {
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        p?.resolve(e.data);
      };
      w.onerror = (e) => {
        console.error("paint worker", e.message);
        this.failed = true;
        this.worker = null;
        for (const p of this.pending.values()) p.resolve({ type: "error", id: 0, message: "the paint worker stopped", nogl: true });
        this.pending.clear();
        w.terminate();
      };
      this.worker = w;
    } catch {
      this.failed = true;
    }
    return this.worker;
  }

  private call(m: ToPaintWorker & { id: number }, transfer: Transferable[] = []): Promise<FromPaintWorker> {
    const w = this.get();
    if (!w) return Promise.resolve({ type: "error", id: m.id, message: "no worker", nogl: true });
    return new Promise((resolve) => {
      this.pending.set(m.id, { resolve });
      w.postMessage(m, transfer);
    });
  }

  /** the map baked in the worker, as float RGBA rows; null when the worker cannot bake */
  async bake(m: PaintMesh, map: MapName, size: number): Promise<Float32Array | null> {
    if (this.noGl || paintWorkerOptions.prefer === "page") return null;
    const w = this.get();
    if (!w) return null;
    if (!this.sent.has(m.id)) {
      const mesh: PaintMesh = { id: m.id, name: m.name, positions: m.positions, normals: m.normals, uvs: m.uvs, tangents: m.tangents, aabb: m.aabb };
      w.postMessage({ type: "mesh", mesh } satisfies ToPaintWorker);
      this.sent.add(m.id);
    }
    const r = await this.call({ type: "bake", id: this.nextId++, meshId: m.id, map, size, settings: { ...BAKE_SETTINGS } });
    if (r.type === "baked") return r.data;
    if (r.type === "error" && r.nogl) {
      this.noGl = true;
      return null;
    }
    throw new Error(r.type === "error" ? r.message : "unexpected answer");
  }

  forget(m: PaintMesh) {
    if (this.worker && this.sent.delete(m.id)) this.worker.postMessage({ type: "forget", meshId: m.id } satisfies ToPaintWorker);
  }

  /** float RGBA rows as an 8 bit PNG, encoded in the worker (on the page without one) */
  async png(width: number, height: number, data: Float32Array): Promise<Uint8Array> {
    if (this.get()) {
      const r = await this.call({ type: "png", id: this.nextId++, width, height, data }, [data.buffer]);
      if (r.type === "png") return r.bytes;
      if (!(r.type === "error" && r.nogl)) throw new Error(r.type === "error" ? r.message : "unexpected answer");
    }
    return encodePixels(width, height, data);
  }
}

export const paintWorker = new PaintWorkerClient();

const inFlight = new Map<string, Promise<void>>();
/** stats of the last bakes, for tests: where each ran and how long it took */
export const bakeLog: { map: MapName; size: number; where: "worker" | "page"; ms: number }[] = [];

/** bakes a mesh map for the page's renderer without blocking the page; resolves once MeshMapGenerator.get has it */
export function bakeMap(renderer: Renderer, m: PaintMesh, map: MapName, size: number): Promise<void> {
  const mg = mapGeneratorFor(renderer);
  if (mg.has(m, map, size)) return Promise.resolve();
  const key = `${m.id}:${map}:${size}:${bakeKey()}`;
  let p = inFlight.get(key);
  if (p) return p;
  p = (async () => {
    const t0 = performance.now();
    const data = await paintWorker.bake(m, map, size);
    if (data) await mg.adopt(m, map, size, data, nextTask);
    else await mg.bake(m, map, size);
    bakeLog.push({ map, size, where: data ? "worker" : "page", ms: performance.now() - t0 });
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** whether a bake of any map is running */
export const baking = () => inFlight.size > 0;

/** a target as an 8 bit PNG, without stalling the page: an asynchronous read, the encoding in the worker */
export async function encodePngAsync(renderer: Renderer, t: Target): Promise<Uint8Array> {
  const px = await gpuFor(renderer).readAsync(t);
  return paintWorker.png(t.size, t.size, px);
}
