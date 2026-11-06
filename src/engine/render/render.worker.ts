/* The render worker: a WebGL2 context on an OffscreenCanvas, running what the page sends (protocol.ts).
 * Batches of one lane run one after the other; the two lanes (previews, exports) run side by side. */
import { BatchFailure, Executor } from "./executor";
import type { FromWorker, Lane, ToWorker } from "./protocol";

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let ex: Executor | null = null;
let lost = false;
let loseExt: WEBGL_lose_context | null = null;
try {
  const canvas = new OffscreenCanvas(256, 256);
  ex = new Executor(canvas);
  // asked for now: after a loss, getExtension returns null
  loseExt = ex.gl.getExtension("WEBGL_lose_context");
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    ex!.lost();
    post({ type: "lost" });
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try {
      ex!.init();
      lost = false;
      post({ type: "restored" });
    } catch (e) {
      post({ type: "unsupported", reason: String(e) });
    }
  });
  const dbg = ex.gl.getExtension("WEBGL_debug_renderer_info");
  post({ type: "ready", renderer: String(ex.gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : ex.gl.RENDERER)), timerQuery: ex.hasTimer });
} catch (e) {
  post({ type: "unsupported", reason: String(e) });
}

const cancelled = new Set<number>();
const queues: Record<Lane, Promise<void>> = { fg: Promise.resolve(), bg: Promise.resolve() };

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (!ex) return;
  switch (m.type) {
    case "cancel":
      cancelled.add(m.id);
      break;
    case "reset":
      ex.reset();
      break;
    case "lose":
      loseExt?.loseContext();
      break;
    case "restore":
      loseExt?.restoreContext();
      break;
    case "batch":
      {
        const received = performance.now();
        queues[m.lane] = queues[m.lane].then(() => runBatch(m, performance.now() - received));
      }
      break;
  }
};

async function runBatch(m: Extract<ToWorker, { type: "batch" }>, queuedMs: number) {
  const e = ex!;
  if (lost) {
    for (const o of m.ops) if (o.op === "upload") o.bitmap.close();
    return post({ type: "failed", id: m.id, kind: "lost", message: "the WebGL context was lost" });
  }
  try {
    const r = await e.run(m.ops, {
      cancelled: () => cancelled.has(m.id),
      progress: (done, total) => post({ type: "progress", id: m.id, done, total }),
      budgetMs: m.budgetMs,
    }, m.lane);
    r.stats.queuedMs = queuedMs;
    const transfer: Transferable[] = [];
    for (const o of r.outputs) if (o) transfer.push(o instanceof ImageBitmap ? o : o.buffer);
    post({ type: "done", id: m.id, outputs: r.outputs, errors: r.errors, stats: r.stats }, transfer);
  } catch (err) {
    const kind = err instanceof BatchFailure ? err.kind : e.gl.isContextLost() ? "lost" : "error";
    post({ type: "failed", id: m.id, kind, message: err instanceof Error ? err.message : String(err) });
  } finally {
    cancelled.delete(m.id);
  }
}
