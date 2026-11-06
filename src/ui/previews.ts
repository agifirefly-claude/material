/* Schedules the many small renders the editor shows (node thumbnails) so the UI stays responsive: after each change
 * the visible previews are refreshed in batches, and only the ones whose shader changed draw. The shaders run in the
 * render worker (RenderService) when the browser can; the page only builds them, a few milliseconds per frame. */
import type { Gen } from "../engine/gen/base";
import { GenContext } from "../engine/context";
import { GenMaterial } from "../engine/gen/misc";
import { editor } from "./store";
import type { ShaderError } from "../engine/render/renderer";
import type { PreviewJob } from "../engine/render/service";

export interface PreviewRequest {
  canvas: HTMLCanvasElement;
  gen: Gen;
  output: number;
  size: number;
  checker?: boolean;
  onError?: (e: ShaderError | null) => void;
  /** key used for caching the render */
  key: string;
}

/** the most previews sent to the worker at once */
const BATCH = 48;

class Previews {
  private requests = new Map<HTMLCanvasElement, PreviewRequest>();
  private dirty = new Set<HTMLCanvasElement>();
  private scheduled = false;
  private running = false;
  private lastVersion = -1;
  /** previews whose shader reads the time, refreshed while `animate` is on */
  private animated = new Set<HTMLCanvasElement>();
  animate = true;
  private lastTick = 0;
  /** resolves when nothing is left to draw (tests, the performance measurements) */
  private idleWaiters: (() => void)[] = [];

  constructor() {
    editor.subscribe(() => this.invalidateAll());
  }

  set(req: PreviewRequest) {
    this.requests.set(req.canvas, req);
    this.dirty.add(req.canvas);
    this.schedule();
  }
  remove(canvas: HTMLCanvasElement) {
    this.animated.delete(canvas);
    const r = this.requests.get(canvas);
    if (r) editor.renders?.forget(r.key);
    this.requests.delete(canvas);
    this.dirty.delete(canvas);
  }
  invalidateAll() {
    if (editor.contentVersion === this.lastVersion) return;
    this.lastVersion = editor.contentVersion;
    for (const c of this.requests.keys()) this.dirty.add(c);
    this.schedule();
  }
  /** draws every preview again (after the renderer lost what it had) */
  redrawAll() {
    for (const c of this.requests.keys()) {
      delete c.dataset.drawn;
      this.dirty.add(c);
    }
    this.schedule();
  }
  /** a promise of the moment no preview waits to be drawn */
  idle(): Promise<void> {
    if (!this.dirty.size && !this.running) return Promise.resolve();
    return new Promise((res) => this.idleWaiters.push(res));
  }
  private schedule() {
    if (this.scheduled || this.running) return;
    this.scheduled = true;
    requestAnimationFrame(() => void this.run());
  }
  private async run() {
    this.scheduled = false;
    const r = editor.renders;
    if (!r) return;
    this.running = true;
    try {
      const start = performance.now();
      if (this.animate && this.animated.size && start - this.lastTick > 60) {
        this.lastTick = start;
        r.time = start / 1000;
        for (const c of this.animated) this.dirty.add(c);
      }
      // building shaders is the page's part: a few milliseconds per frame, the rest waits for the next one
      const jobs: PreviewJob[] = [];
      const reqs: PreviewRequest[] = [];
      for (const canvas of [...this.dirty]) {
        if (jobs.length >= BATCH || performance.now() - start > 10) break;
        this.dirty.delete(canvas);
        const req = this.requests.get(canvas);
        if (!req || !canvas.isConnected) continue;
        try {
          const outs = req.gen instanceof GenMaterial ? req.gen.getOutputDefs(true) : req.gen.getOutputDefs();
          if (req.output >= outs.length) {
            canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            req.onError?.(null);
            continue;
          }
          const sc = req.gen.getShaderCode("uv", req.output, new GenContext());
          if (!sc.outputType) continue;
          jobs.push({ key: req.key, sc, size: req.size, ctx: canvas.getContext("2d")!, checker: req.checker !== false, force: canvas.dataset.drawn !== "1" });
          reqs.push(req);
        } catch (e) {
          console.warn("preview failed", req.gen.name, e);
        }
      }
      if (jobs.length) {
        try {
          const res = await r.previews(jobs);
          res.forEach((x, i) => {
            const req = reqs[i];
            if (x.usesTime) this.animated.add(req.canvas);
            else this.animated.delete(req.canvas);
            req.onError?.(x.error);
            if (x.drawn) req.canvas.dataset.drawn = "1";
          });
        } catch (e) {
          console.warn("previews failed", e);
        }
      }
    } finally {
      this.running = false;
    }
    if (!this.dirty.size) for (const w of this.idleWaiters.splice(0)) w();
    if (this.dirty.size || (this.animate && this.animated.size)) this.schedule();
  }
}

export const previews = new Previews();
