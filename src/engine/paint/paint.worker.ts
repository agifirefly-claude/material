/* The paint worker: bakes mesh maps on its own WebGL2 context (an OffscreenCanvas) with the same MeshMapGenerator
 * the page uses, so the BVH build, the ray cast passes and the postprocess passes run off the page's thread; and
 * encodes the PNGs of saved and exported paint projects. The page side is paint-client.ts. */
import { Renderer } from "../render/renderer";
import { BAKE_SETTINGS, MeshMapGenerator, type MapName } from "./mapgen";
import type { PaintMesh } from "./mesh";
import { encodePixels } from "./png";

export type ToPaintWorker =
  | { type: "mesh"; mesh: PaintMesh }
  | { type: "forget"; meshId: string }
  | { type: "bake"; id: number; meshId: string; map: MapName; size: number; settings: typeof BAKE_SETTINGS }
  | { type: "png"; id: number; width: number; height: number; data: Float32Array };
export type FromPaintWorker =
  | { type: "baked"; id: number; data: Float32Array; ms: number }
  | { type: "png"; id: number; bytes: Uint8Array }
  | { type: "error"; id: number; message: string; nogl?: boolean };

const post = (m: FromPaintWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let gen: MeshMapGenerator | null = null;
let glError: string | null = null;
function generator(): MeshMapGenerator | null {
  if (gen || glError) return gen;
  try {
    gen = new MeshMapGenerator(new Renderer(new OffscreenCanvas(16, 16)));
  } catch (e) {
    glError = String(e);
  }
  return gen;
}

const meshes = new Map<string, PaintMesh>();
// one bake at a time: they share the context, and the page waits for them in order anyway
let queue: Promise<void> = Promise.resolve();

self.onmessage = (ev: MessageEvent<ToPaintWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case "mesh":
      meshes.set(m.mesh.id, m.mesh);
      break;
    case "forget": {
      const mesh = meshes.get(m.meshId);
      if (mesh && gen) gen.forget(mesh);
      meshes.delete(m.meshId);
      break;
    }
    case "png":
      try {
        const bytes = encodePixels(m.width, m.height, m.data);
        post({ type: "png", id: m.id, bytes }, [bytes.buffer]);
      } catch (e) {
        post({ type: "error", id: m.id, message: String(e) });
      }
      break;
    case "bake":
      queue = queue.then(async () => {
        const g = generator();
        const mesh = meshes.get(m.meshId);
        if (!g) return post({ type: "error", id: m.id, message: glError ?? "no WebGL2", nogl: true });
        if (!mesh) return post({ type: "error", id: m.id, message: "unknown mesh " + m.meshId });
        try {
          const t0 = performance.now();
          Object.assign(BAKE_SETTINGS, m.settings);
          const rt = await g.bake(mesh, m.map, m.size);
          const data = g.gpu.read(rt);
          post({ type: "baked", id: m.id, data, ms: performance.now() - t0 }, [data.buffer]);
        } catch (e) {
          post({ type: "error", id: m.id, message: (e as Error).message ?? String(e) });
        }
      });
      break;
  }
};
