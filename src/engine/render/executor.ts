/* Runs the operations the page sends (protocol.ts) on a WebGL2 context: the render worker's side of the renderer.
 *
 * It knows nothing of generators, only programs, targets and draws, so it loads nothing else of the engine.
 * Big targets are drawn in tiles; after a few tiles the executor waits for the GPU (a fence) without blocking,
 * so cancelling works mid-render, progress can be reported and a render the GPU does not finish in time is stopped
 * instead of hanging. Two lanes run side by side: previews ("fg") get the GPU between the tiles of an export ("bg"). */
import { ProgramCache } from "./programs";
import * as targets from "./targets";
import { Blitter } from "./blit";
import { upload } from "./sources";
import { prepareShader, drawTile, finishShader, tilesOf, type DrawContext } from "./draw";
import type { BuiltShader } from "./shader-source";
import type { ShaderUniform } from "../shader-code";
import { ShaderError, type Target } from "./types";
import type { BatchStats, DrawError, Failure, Op, UniformDef } from "./protocol";

/** tile size and the area above which a target is drawn in tiles */
export const WORKER_TILE = 512;
const WORKER_TILE_ABOVE = 1024 * 1024;

export class BatchFailure extends Error {
  constructor(
    public kind: Failure,
    message: string,
  ) {
    super(message);
  }
}

export interface BatchControl {
  cancelled(): boolean;
  progress(done: number, total: number): void;
  /** the longest the GPU may take to finish one group of tiles */
  budgetMs: number;
}

export interface BatchResult {
  outputs: (ImageBitmap | Float32Array | Uint8ClampedArray | null)[];
  errors: DrawError[];
  stats: BatchStats;
}

/** gives other tasks (messages, the other lane) a turn; MessageChannel is not throttled like setTimeout */
const channel = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
const waiting: (() => void)[] = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();
function yieldTask(): Promise<void> {
  return new Promise((res) => {
    if (!channel) return setTimeout(res, 0);
    waiting.push(res);
    channel.port2.postMessage(0);
  });
}

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

export class Executor {
  readonly gl: WebGL2RenderingContext;
  private programs!: ProgramCache;
  private vao!: WebGLVertexArrayObject;
  private blitter!: Blitter;
  private floatLinear = false;
  private timer: TimerExt | null = null;
  private targets = new Map<number, Target>();
  private defs = new Map<string, { source: string; uniforms: UniformDef[] }>();
  private blankTarget: Target | null = null;
  /** tiles drawn between two waits for the GPU: grows while the GPU keeps up, shrinks when it does not */
  private group = 1;

  constructor(readonly canvas: OffscreenCanvas | HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.init();
  }

  /** (re)creates everything the context holds: at the start and when a lost context comes back */
  init(): void {
    const gl = this.gl;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is not available");
    this.floatLinear = !!gl.getExtension("OES_texture_float_linear");
    this.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
    this.vao = targets.fullScreenTriangle(gl);
    this.programs = new ProgramCache(gl);
    this.blitter = new Blitter(gl, this.vao, this.canvas);
    this.targets.clear();
    this.background.clear();
    this.blankTarget = null;
  }

  get hasTimer(): boolean {
    return !!this.timer;
  }

  /** targets of the exports' lane: they free their own, and a reset of the previews' must not touch them */
  private background = new Set<number>();

  /** forgets the targets of the previews' lane; programs stay */
  reset(): void {
    for (const [id, t] of this.targets) {
      if (this.background.has(id)) continue;
      targets.deleteTarget(this.gl, t);
      this.targets.delete(id);
    }
  }

  /** after a context loss: what the context held is gone, the program sources stay */
  lost(): void {
    this.targets.clear();
    this.background.clear();
    this.blankTarget = null;
  }

  private drawContext(time: number): DrawContext {
    return {
      gl: this.gl,
      programs: this.programs,
      vao: this.vao,
      time,
      blank: () => (this.blankTarget ??= targets.createTarget(this.gl, this.floatLinear, 4)),
    };
  }

  private target(id: number): Target {
    const t = this.targets.get(id);
    if (!t) throw new BatchFailure("error", "unknown target " + id);
    return t;
  }

  async run(ops: Op[], ctl: BatchControl, lane: "fg" | "bg" = "fg"): Promise<BatchResult> {
    const gl = this.gl;
    const start = performance.now();
    const outputs: BatchResult["outputs"] = [];
    const errors: DrawError[] = [];
    const stats: BatchStats = { ms: 0, draws: 0, tiles: 0, queuedMs: 0, lane, gpuMs: this.timer ? 0 : null };
    let total = 0;
    for (const o of ops) if (o.op === "draw") total += tilesOf(this.targets.get(o.id) ?? sizeOf(ops, o.id), WORKER_TILE, WORKER_TILE_ABOVE).length;
    let done = 0;
    let lastProgress = 0;
    let sinceWait = 0;
    let query: WebGLQuery | null = null;
    const queries: WebGLQuery[] = [];
    const endQuery = () => {
      if (query) {
        gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
        queries.push(query);
        query = null;
      }
    };
    const wait = async () => {
      endQuery();
      const waited = await this.settle(ctl);
      // keep each group of tiles around 10 ms of GPU work
      if (waited < 4) this.group = Math.min(64, this.group * 2);
      else if (waited > 16) this.group = Math.max(1, this.group >> 1);
      sinceWait = 0;
      const now = performance.now();
      if (now - lastProgress > 100) {
        lastProgress = now;
        ctl.progress(done, total);
      }
    };
    for (const o of ops) {
      if (ctl.cancelled()) throw new BatchFailure("cancelled", "cancelled");
      if (gl.isContextLost()) throw new BatchFailure("lost", "the WebGL context was lost");
      switch (o.op) {
        case "create":
          targets.deleteTarget(gl, this.targets.get(o.id));
          this.targets.set(o.id, targets.createTarget(gl, this.floatLinear, o.size, o.f32, o.mipmap, o.height));
          if (lane === "bg") this.background.add(o.id);
          break;
        case "delete":
          targets.deleteTarget(gl, this.targets.get(o.id));
          this.targets.delete(o.id);
          this.background.delete(o.id);
          break;
        case "program":
          this.defs.set(o.hash, { source: o.source, uniforms: o.uniforms });
          break;
        case "upload":
          upload(gl, this.blitter, o.bitmap, this.target(o.id), o.size);
          o.bitmap.close();
          break;
        case "draw": {
          const def = this.defs.get(o.program);
          const target = this.target(o.id);
          if (!def) throw new BatchFailure("error", "unknown program " + o.program);
          try {
            this.programs.get(def.source);
          } catch (e) {
            if (!(e instanceof ShaderError)) throw e;
            errors.push({ target: o.id, program: o.program, message: e.message, log: e.log, source: e.source });
            continue;
          }
          const built = { source: def.source, uniforms: def.uniforms as unknown as ShaderUniform[], body: "" } as BuiltShader;
          const values = new Map<string, unknown>();
          def.uniforms.forEach((u, i) => values.set(u.name, u.type === "sampler2D" ? (this.targets.get(o.values[i] as number) ?? null) : o.values[i]));
          const c = this.drawContext(o.time);
          let prepared = false;
          for (const tile of tilesOf(target, WORKER_TILE, WORKER_TILE_ABOVE)) {
            if (!prepared) {
              prepareShader(c, built, values, target, o.blend);
              prepared = true;
              if (this.timer && !query) {
                query = gl.createQuery();
                gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query!);
              }
            }
            drawTile(gl, tile.w === target.size && tile.h === (target.height ?? target.size) ? null : tile);
            stats.tiles++;
            done++;
            if (++sinceWait >= this.group) {
              gl.flush();
              await wait();
              // the other lane may have drawn meanwhile: bind everything again
              prepared = false;
            }
          }
          finishShader(gl, target, o.blend);
          stats.draws++;
          break;
        }
        case "present": {
          endQuery();
          this.blitter.toCanvas(this.target(o.id), o.w, o.h, o.checker);
          outputs[o.out] = await createImageBitmap(this.canvas, 0, this.canvas.height - o.h, o.w, o.h);
          break;
        }
        case "read":
          if (sinceWait) await wait();
          outputs[o.out] = await this.read(this.target(o.id), o.f32, ctl);
          break;
      }
    }
    if (sinceWait || query) await wait();
    for (const q of queries) {
      if (this.timer && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(this.timer.GPU_DISJOINT_EXT)) stats.gpuMs! += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
    }
    ctl.progress(total, total);
    stats.ms = performance.now() - start;
    return { outputs, errors, stats };
  }

  /** waits, without blocking, until the GPU has done what was sent; returns how long that took */
  private async settle(ctl: BatchControl): Promise<number> {
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const t0 = performance.now();
    let polls = 0;
    try {
      for (;;) {
        if (!sync) break;
        const s = gl.clientWaitSync(sync, 0, 0);
        if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED || s === gl.WAIT_FAILED) break;
        if (gl.isContextLost()) throw new BatchFailure("lost", "the WebGL context was lost");
        if (performance.now() - t0 > ctl.budgetMs)
          throw new BatchFailure("timeout", `the GPU did not finish a part of this render in ${ctl.budgetMs < 2000 ? ctl.budgetMs + " ms" : Math.round(ctl.budgetMs / 1000) + " s"}: a node's shader is probably too heavy for this size`);
        // polling without pause would take a CPU core from the GPU driver (software ones run on the CPU): back off
        if (++polls < 4) await yieldTask();
        else await new Promise((r) => setTimeout(r, Math.min(16, polls - 3)));
      }
    } finally {
      if (sync) gl.deleteSync(sync);
    }
    // a turn for the other lane and for messages (cancel) even when the GPU was quick
    await yieldTask();
    if (ctl.cancelled()) throw new BatchFailure("cancelled", "cancelled");
    if (gl.isContextLost()) throw new BatchFailure("lost", "the WebGL context was lost");
    return performance.now() - t0;
  }

  /** reads a target in bands of rows, so a big export never needs all of it as floats at once */
  private async read(t: Target, f32: boolean, ctl: BatchControl): Promise<Float32Array | Uint8ClampedArray> {
    const gl = this.gl;
    const w = t.size,
      h = t.height ?? t.size;
    const band = Math.max(1, Math.floor((1 << 22) / (w * 4)));
    const out = f32 ? new Float32Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
    const tmp = f32 ? null : new Float32Array(w * Math.min(band, h) * 4);
    for (let y = 0; y < h; y += band) {
      const rows = Math.min(band, h - y);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      if (f32) gl.readPixels(0, y, w, rows, gl.RGBA, gl.FLOAT, (out as Float32Array).subarray(y * w * 4, (y + rows) * w * 4));
      else {
        const part = tmp!.subarray(0, w * rows * 4);
        gl.readPixels(0, y, w, rows, gl.RGBA, gl.FLOAT, part);
        targets.toBytes(part, out as Uint8ClampedArray<ArrayBuffer>, y * w * 4);
      }
      if (h > band) {
        await yieldTask();
        if (ctl.cancelled()) throw new BatchFailure("cancelled", "cancelled");
      }
    }
    return out;
  }
}

/** the size of a target a batch creates before drawing into it (for counting tiles up front) */
function sizeOf(ops: Op[], id: number): Target {
  const c = ops.find((o) => o.op === "create" && o.id === id) as Extract<Op, { op: "create" }> | undefined;
  return { size: c?.size ?? 1, height: c?.height ?? c?.size ?? 1 } as Target;
}
