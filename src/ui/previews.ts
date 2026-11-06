/* Schedules the many small renders the editor shows (node thumbnails, the 2D preview) so the UI stays responsive:
 * after each change the visible previews are refreshed a few per frame, and only the ones whose shader changed draw. */
import type { Gen } from "../engine/gen/base";
import { GenContext } from "../engine/context";
import { GenMaterial } from "../engine/gen/misc";
import { editor } from "./store";
import type { ShaderError } from "../engine/render/renderer";

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

class Previews {
  private requests = new Map<HTMLCanvasElement, PreviewRequest>();
  private dirty = new Set<HTMLCanvasElement>();
  private scheduled = false;
  private lastVersion = -1;

  constructor() {
    editor.subscribe(() => this.invalidateAll());
  }

  set(req: PreviewRequest) {
    this.requests.set(req.canvas, req);
    this.dirty.add(req.canvas);
    this.schedule();
  }
  remove(canvas: HTMLCanvasElement) {
    const r = this.requests.get(canvas);
    if (r) editor.renderer?.forget(r.key);
    this.requests.delete(canvas);
    this.dirty.delete(canvas);
  }
  invalidateAll() {
    if (editor.version === this.lastVersion) return;
    this.lastVersion = editor.version;
    for (const c of this.requests.keys()) this.dirty.add(c);
    this.schedule();
  }
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => this.run());
  }
  private run() {
    this.scheduled = false;
    const r = editor.renderer;
    if (!r) return;
    const start = performance.now();
    r.time = start / 1000;
    for (const canvas of [...this.dirty]) {
      if (performance.now() - start > 14) break;
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
        const res = r.renderKeyed(req.key, sc, req.size);
        req.onError?.(res.error);
        if (res.target && (res.changed || canvas.dataset.drawn !== "1")) {
          r.present(res.target, canvas.getContext("2d")!, req.checker !== false);
          canvas.dataset.drawn = "1";
        }
      } catch (e) {
        console.warn("preview failed", req.gen.name, e);
      }
    }
    if (this.dirty.size) this.schedule();
  }
}

export const previews = new Previews();
