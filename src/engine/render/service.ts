/* RenderService: the asynchronous renderer the editor uses.
 *
 * Where the browser can (WebGL2 on an OffscreenCanvas in a worker), shaders run in a worker: the page only builds
 * them and decides what is out of date (Recorder), so a heavy node or a big export never freezes the page. Where it
 * cannot, and for renders that read textures only the page has (baked mesh maps, paint layers), the page's own
 * Renderer draws, as before. The synchronous Renderer stays the API of the tests and the command line tool. */
import type { ShaderCode } from "../shader-code";
import type { Gen } from "../gen/base";
import { Recorder, RecorderLink, MainOnlyError } from "./recorder";
import type { Renderer } from "./renderer";
import { ShaderError, type Target } from "./types";
import type { BatchStats, Failure, FromWorker, Lane, Op, ToWorker } from "./protocol";

export interface PreviewJob {
  key: string;
  sc: ShaderCode;
  size: number;
  /** false: the shader's rgba output as it is, without its port type's preview */
  preview?: boolean;
  ctx: CanvasRenderingContext2D;
  checker?: boolean;
  /** draw even when the render did not change (the canvas is new) */
  force?: boolean;
}

export interface PreviewResult {
  changed: boolean;
  drawn: boolean;
  error: ShaderError | null;
  usesTime: boolean;
}

export interface RenderJob {
  sc: ShaderCode;
  size: number;
  preview?: boolean;
}

export interface RenderOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export class RenderFailure extends Error {
  constructor(
    public kind: Failure,
    message: string,
  ) {
    super(message);
  }
}

type Pending = { started: number; resolve: (m: Extract<FromWorker, { type: "done" }>) => void; reject: (e: RenderFailure) => void; onProgress?: (f: number) => void };

/** how long the GPU may take for one group of tiles before the render is given up */
const BUDGET = { fg: 8000, bg: 20000 };

export class RenderService {
  mode: "worker" | "main" = "main";
  /** how long the GPU may take for one group of tiles, by lane, before a render is given up (ms) */
  budget = { ...BUDGET };
  /** what the worker reported about itself */
  info = "";
  /** the last batch's figures (for the performance page and tests) */
  lastStats: BatchStats | null = null;
  /** the figures of the last batches, newest last */
  statsLog: BatchStats[] = [];
  /** told when the worker's WebGL context is lost and when renders work again */
  onLost: (() => void) | null = null;
  onRestored: (() => void) | null = null;
  /** a picture finished loading: renders that read it are out of date */
  onAsyncUpdate: (() => void) | null = null;
  private worker: Worker | null = null;
  private link = new RecorderLink();
  /** the previews' recorders: node thumbnails in the "fg" lane; the big views (2D, 3D) in the "bg" lane, so the
   *  thumbnails get the GPU between the tiles of a 1024² view. Each lane runs its batches in order, which is what a
   *  recorder's idea of the worker's targets relies on, so each lane has its own. */
  private recs: Record<Lane, Recorder> = { fg: new Recorder(this.link), bg: new Recorder(this.link) };
  private get rec(): Recorder {
    return this.recs.fg;
  }
  private pending = new Map<number, Pending>();
  private nextBatch = 1;
  private onMain = new Set<string>();
  private lost = false;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private _time = 0;

  constructor(public main: Renderer) {
    this.link.onLoaded = () => this.onAsyncUpdate?.();
  }

  /** programs and shaders run so far, in the worker and on the page (the status bar) */
  get stats() {
    const m = this.main.stats;
    return { programs: m.programs + this.link.sent.size, renders: m.renders + this.link.draws };
  }

  /** renders have been waiting a while: the GPU is busy. Every WebGL context of the browser, the worker's and the
   *  page's, goes through one GPU process, so continuous page drawing (the turning 3D model) slows renders down a
   *  lot on a slow GPU; views that redraw continuously draw fewer frames meanwhile. */
  get congested(): boolean {
    const now = performance.now();
    for (const p of this.pending.values()) if (now - p.started > 250) return true;
    return false;
  }

  get time(): number {
    return this._time;
  }
  set time(t: number) {
    this._time = t;
    this.recs.fg.time = this.recs.bg.time = t;
    this.main.time = t;
  }

  /** starts the worker; stays on the page's renderer when the browser cannot render in a worker */
  async start(opts: { worker?: boolean } = {}): Promise<this> {
    if (opts.worker === false || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return this;
    let w: Worker;
    try {
      w = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return this;
    }
    const first = await new Promise<FromWorker | null>((res) => {
      const t = setTimeout(() => res(null), 10000);
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        clearTimeout(t);
        res(e.data);
      };
      w.onerror = () => {
        clearTimeout(t);
        res(null);
      };
    });
    if (!first || first.type !== "ready") {
      w.terminate();
      this.info = first?.type === "unsupported" ? first.reason : "the render worker did not start";
      return this;
    }
    this.info = first.renderer;
    this.worker = w;
    this.mode = "worker";
    w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    w.onerror = (e) => console.error("render worker", e.message);
    return this;
  }

  private send(m: ToWorker, transfer: Transferable[] = []) {
    this.worker!.postMessage(m, transfer);
  }

  private receive(m: FromWorker) {
    switch (m.type) {
      case "progress":
        this.pending.get(m.id)?.onProgress?.(m.total ? m.done / m.total : 1);
        break;
      case "done": {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        this.lastStats = m.stats;
        this.statsLog.push(m.stats);
        if (this.statsLog.length > 100) this.statsLog.shift();
        p?.resolve(m);
        break;
      }
      case "failed": {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        p?.reject(new RenderFailure(m.kind, m.message));
        break;
      }
      case "lost":
        this.lost = true;
        this.forgetAll();
        this.onLost?.();
        // a context that does not come back: render on the page from now on
        this.fallbackTimer = setTimeout(() => {
          if (!this.lost) return;
          this.worker?.terminate();
          this.worker = null;
          this.mode = "main";
          this.lost = false;
          this.onRestored?.();
        }, 5000);
        break;
      case "restored":
        this.lost = false;
        if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
        this.forgetAll();
        this.onRestored?.();
        break;
      case "ready":
      case "unsupported":
        break;
    }
  }

  /** the worker's targets are gone or unknown: forget what the page thought they held */
  private forgetAll() {
    this.recs.fg.reset();
    this.recs.bg.reset();
    this.link.reset();
  }

  private batch(ops: Op[], transfer: Transferable[], lane: Lane, onProgress?: (f: number) => void, signal?: AbortSignal) {
    const id = this.nextBatch++;
    return new Promise<Extract<FromWorker, { type: "done" }>>((resolve, reject) => {
      if (!this.worker || this.lost) {
        for (const t of transfer) (t as ImageBitmap).close?.();
        return reject(new RenderFailure("lost", "the WebGL context was lost"));
      }
      this.pending.set(id, { started: performance.now(), resolve, reject, onProgress });
      if (signal) {
        if (signal.aborted) this.send({ type: "cancel", id });
        else signal.addEventListener("abort", () => this.send({ type: "cancel", id }), { once: true });
      }
      this.send({ type: "batch", id, ops, lane, budgetMs: this.budget[lane] }, transfer);
    });
  }

  /* ---------- previews ---------- */

  /** renders previews (node thumbnails, the 2D and 3D views) and draws the ones that changed into their canvases */
  async previews(jobs: PreviewJob[], opts: { lane?: Lane } = {}): Promise<PreviewResult[]> {
    const lane = opts.lane ?? "fg";
    const results: PreviewResult[] = jobs.map(() => ({ changed: false, drawn: false, error: null, usesTime: false }));
    const onPage: number[] = [];
    const shown: { job: number; out: number }[] = [];
    // pictures that loaded meanwhile go to the worker in the "fg" lane first: a "bg" batch may run before the next
    // "fg" one, and must find them there
    if (lane === "bg" && this.link.pending.length && this.mode === "worker" && !this.lost) await this.batch(...this.flushPending(), "fg").catch(() => this.link.reset());
    const rec = this.recs[lane];
    if (this.mode === "worker" && !this.lost) {
      jobs.forEach((j, i) => {
        try {
          const r = rec.renderKeyed(j.key, j.sc, j.size, j.preview !== false);
          if (this.onMain.delete(j.key)) this.main.forget(j.key);
          results[i] = { changed: r.changed, drawn: false, error: r.error, usesTime: r.usesTime };
          if (r.target && (r.changed || j.force)) {
            rec.present(r.target, j.ctx.canvas.width, j.ctx.canvas.height, j.checker !== false, shown.length);
            shown.push({ job: i, out: shown.length });
          }
        } catch (e) {
          if (e instanceof MainOnlyError) onPage.push(i);
          else throw e;
        }
      });
      const { ops, transfer } = rec.take();
      if (ops.length) {
        try {
          const res = await this.batch(ops, transfer, lane);
          rec.applyErrors(res.errors);
          for (const s of shown) {
            const bmp = res.outputs[s.out] as ImageBitmap | null;
            const j = jobs[s.job];
            if (bmp) {
              j.ctx.clearRect(0, 0, j.ctx.canvas.width, j.ctx.canvas.height);
              j.ctx.drawImage(bmp, 0, 0);
              bmp.close();
              results[s.job].drawn = true;
            }
          }
          jobs.forEach((j, i) => {
            if (!onPage.includes(i)) results[i].error = rec.errors.get(j.key) ?? null;
          });
        } catch (e) {
          if (!(e instanceof RenderFailure)) throw e;
          // the worker's targets no longer match what the page thinks: start again from nothing
          if (e.kind === "lost") this.forgetAll();
          else if (lane === "fg") {
            this.send({ type: "reset" });
            this.recs.fg.reset();
            this.link.reset();
          } else {
            // a reset leaves the "bg" lane's targets alone: free this recorder's own
            this.send({ type: "batch", id: this.nextBatch++, ops: [...rec.owned].map((id) => ({ op: "delete", id })), lane: "bg", budgetMs: this.budget.bg });
            rec.reset();
          }
          const err = new ShaderError(e.kind === "timeout" ? e.message : "Render failed: " + e.message, "", "");
          for (const s of shown) results[s.job].error = err;
        }
      }
    } else jobs.forEach((_, i) => onPage.push(i));
    for (const i of onPage) {
      const j = jobs[i];
      const r = this.main.renderKeyed(j.key, j.sc, j.size, j.preview !== false);
      this.onMain.add(j.key);
      results[i] = { changed: r.changed, drawn: false, error: r.error, usesTime: r.usesTime };
      if (r.target && (r.changed || j.force)) {
        this.main.present(r.target, j.ctx, j.checker !== false);
        results[i].drawn = true;
      }
    }
    return results;
  }

  forget(key: string): void {
    if (this.onMain.delete(key)) this.main.forget(key);
    this.recs.fg.forget(key);
    this.recs.bg.forget(key);
  }

  clearCache(): void {
    this.recs.fg.clearCache();
    this.recs.bg.clearCache();
    this.main.clearCache();
    this.onMain.clear();
  }

  /** resolves when the pictures of every Image node under `root` have loaded: exports wait for it first, or the
   *  maps would be rendered with black where the pictures go (Material Maker #758, #729) */
  async imagesLoaded(root?: Gen): Promise<void> {
    await Promise.all([this.mode === "worker" ? this.rec.imagesLoaded(root) : null, this.main.imagesLoaded(root)]);
  }

  /** frees the renders of nodes no longer in any of `roots` (Material Maker #1539) */
  prune(roots: Gen[]): number {
    return this.recs.fg.prune(roots) + this.recs.bg.prune(roots) + this.main.prune(roots);
  }

  /** renders kept, in the worker's mirror and on the page (tests) */
  get cacheSize(): number {
    return this.recs.fg.cacheSize + this.recs.bg.cacheSize + this.main.cacheSize;
  }

  /* ---------- exports ---------- */

  /** renders pictures at their full size (exports): 8 bit pixels, as image files store them */
  async images(jobs: RenderJob[], opts: RenderOptions = {}): Promise<ImageData[]> {
    const px = await this.pixels(jobs, false, opts);
    return px.map((p, i) => new ImageData(p as Uint8ClampedArray<ArrayBuffer>, jobs[i].size, jobs[i].size));
  }
  async image(sc: ShaderCode, size: number, opts: RenderOptions & { preview?: boolean } = {}): Promise<ImageData> {
    return (await this.images([{ sc, size, preview: opts.preview }], opts))[0];
  }
  /** float pixels (EXR, 16 bit PNG) */
  async floats(sc: ShaderCode, size: number, opts: RenderOptions & { preview?: boolean; f32?: boolean } = {}): Promise<Float32Array> {
    return (await this.pixels([{ sc, size, preview: opts.preview }], true, opts))[0] as Float32Array;
  }

  /** the pixels of each job, row 0 first. Jobs share the buffers they read; a ShaderError fails the whole call */
  async pixels(jobs: RenderJob[], floats: boolean, opts: RenderOptions & { f32?: boolean } = {}): Promise<(Float32Array | Uint8ClampedArray)[]> {
    // the targets are half floats unless asked otherwise, as Renderer.render's are
    const f32 = !!opts.f32;
    if (opts.signal?.aborted) throw new RenderFailure("cancelled", "cancelled");
    if (this.mode === "worker" && !this.lost) {
      // pictures that loaded meanwhile go first, in the previews' lane, so a failed export cannot lose them
      if (this.link.pending.length) await this.batch(...this.flushPending(), "fg").catch(() => this.link.reset());
      for (let attempt = 0; attempt < 2; attempt++) {
        const rec = new Recorder(this.link);
        rec.time = this._time;
        const misses = this.link.pictures.misses;
        let ok = true;
        try {
          jobs.forEach((j, i) => {
            const r = rec.renderKeyed("export:" + i, j.sc, j.size, j.preview !== false, f32);
            if (r.error) throw r.error;
            if (r.target) rec.read(r.target, floats, i);
          });
        } catch (e) {
          if (!(e instanceof MainOnlyError)) {
            this.discard(rec);
            throw e;
          }
          ok = false;
        }
        if (!ok) {
          this.discard(rec);
          break;
        }
        if (this.link.pictures.misses !== misses && attempt === 0) {
          // pictures were still loading: wait for them and record again
          this.discard(rec);
          await this.link.pictures.idle();
          if (this.link.pending.length) await this.batch(...this.flushPending(), "fg").catch(() => this.link.reset());
          continue;
        }
        rec.dispose();
        const { ops, transfer } = rec.take();
        const created = ops.flatMap((o) => (o.op === "create" ? [o.id] : []));
        try {
          const res = await this.batch(ops, transfer, "bg", opts.onProgress, opts.signal);
          rec.applyErrors(res.errors);
          const err = jobs.map((_, i) => rec.errors.get("export:" + i)).find((x) => x);
          if (err) throw err;
          return jobs.map((j, i) => (res.outputs[i] as Float32Array | Uint8ClampedArray) ?? new (floats ? Float32Array : Uint8ClampedArray)(j.size * j.size * 4));
        } catch (e) {
          // free what the export created in the worker
          if (e instanceof RenderFailure && e.kind !== "lost") this.send({ type: "batch", id: this.nextBatch++, ops: created.map((id) => ({ op: "delete", id })), lane: "bg", budgetMs: this.budget.bg });
          throw e;
        }
      }
    }
    // on the page
    const out: (Float32Array | Uint8ClampedArray)[] = [];
    for (const j of jobs) {
      if (opts.signal?.aborted) throw new RenderFailure("cancelled", "cancelled");
      const t: Target = this.main.render(j.sc, j.size, { preview: j.preview !== false, f32 });
      out.push(floats ? this.main.readPixels(t) : this.main.toImageData(t).data);
      this.main.deleteTarget(t);
      opts.onProgress?.(out.length / jobs.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }

  /** a keyed render's pixels, and whether they changed since the last call (Auto Export) */
  async keyedImage(key: string, sc: ShaderCode, size: number): Promise<{ image: ImageData | null; changed: boolean }> {
    if (this.mode === "worker" && !this.lost) {
      try {
        const r = this.rec.renderKeyed(key, sc, size);
        if (this.onMain.delete(key)) this.main.forget(key);
        if (r.target) this.rec.read(r.target, false, 0);
        const { ops, transfer } = this.rec.take();
        const res = await this.batch(ops, transfer, "fg");
        this.rec.applyErrors(res.errors);
        const px = res.outputs[0] as Uint8ClampedArray<ArrayBuffer> | null;
        return { image: px && r.target ? new ImageData(px, size, size) : null, changed: r.changed };
      } catch (e) {
        if (e instanceof RenderFailure) {
          if (e.kind === "lost") this.forgetAll();
          else {
            this.send({ type: "reset" });
            this.recs.fg.reset();
            this.link.reset();
          }
          throw e;
        }
        if (!(e instanceof MainOnlyError)) throw e;
      }
    }
    const r = this.main.renderKeyed(key, sc, size);
    this.onMain.add(key);
    return { image: r.target ? this.main.toImageData(r.target) : null, changed: r.changed };
  }

  private flushPending(): [Op[], Transferable[]] {
    const ops = this.link.pending;
    const transfer = this.link.pendingTransfer;
    this.link.pending = [];
    this.link.pendingTransfer = [];
    return [ops, transfer];
  }

  /** drops a recording that will not be sent: the worker never got its programs */
  private discard(rec: Recorder) {
    for (const o of rec.ops) if (o.op === "program") this.link.sent.delete(o.hash);
    rec.reset();
  }

  /* ---------- tests ---------- */
  /** loses the worker's context (WEBGL_lose_context), as a GPU reset would */
  loseContext(): void {
    this.send({ type: "lose" });
  }
  restoreContext(): void {
    this.send({ type: "restore" });
  }
}
