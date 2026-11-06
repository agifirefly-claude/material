/* RenderSession: renders whose targets the caller keeps between calls — TAA's accumulation, frames that are not
 * square, a material's own buffers read for an engine export. In the render worker where the browser can (its own
 * Recorder, in the exports' lane, so node previews still get the GPU between its batches), else on the page's
 * Renderer. Operations are recorded (or, on the page, run) as they are called; `flush` sends them and returns what
 * was read. Get one from RenderService.session() or RenderService.withSession(). */
import type { ShaderCode, TextureRef } from "../shader-code";
import type { Recorder } from "./recorder";
import { buildFragmentShader, type BuiltShader } from "./shader-source";
import { RenderFailure } from "./service";
import type { Renderer } from "./renderer";
import { ShaderError, type Target } from "./types";
import type { DrawError, FromWorker } from "./protocol";

type Outputs = Extract<FromWorker, { type: "done" }>["outputs"];

/** what a session in the worker needs of the RenderService */
export interface SessionLink {
  rec: Recorder;
  /** sends what the recorder holds (in the exports' lane) */
  run(rec: Recorder, opts: { signal?: AbortSignal; onProgress?: (f: number) => void }): Promise<{ outputs: Outputs; errors: DrawError[] }>;
  /** frees targets in the worker */
  release(ids: number[]): void;
  /** drops a recording that will not be sent */
  discard(rec: Recorder): void;
}

export type SessionPixels = Float32Array | Uint8ClampedArray;

export class RenderSession {
  /** the time the next draws render at */
  time = 0;
  readonly onWorker: boolean;
  /** set when the worker lost the session's targets (a lost context): every flush fails from then on */
  broken = false;
  /** called once disposed (the service forgets it) */
  onDispose: (() => void) | null = null;
  private slots = 0;
  private shows: { out: number; ctx: CanvasRenderingContext2D }[] = [];
  private mainOut: (SessionPixels | null)[] = [];
  private mainTargets = new Set<Target>();
  private disposed = false;
  private builtShaders = new WeakMap<ShaderCode, BuiltShader>();

  constructor(
    private main: Renderer,
    private link: SessionLink | null,
  ) {
    this.onWorker = !!link;
  }

  createTarget(width: number, height = width, f32 = false): Target {
    if (this.link) return this.link.rec.createTarget(width, f32, false, height);
    const t = this.main.createTarget(width, f32, false, height);
    this.mainTargets.add(t);
    return t;
  }
  deleteTarget(t: Target): void {
    if (this.link) this.link.rec.deleteTarget(t);
    else {
      this.main.deleteTarget(t);
      this.mainTargets.delete(t);
    }
  }

  /** a sampler that reads one of the session's targets */
  ref(t: Target, key: string): TextureRef {
    return { kind: "texture", key, target: t } as unknown as TextureRef;
  }

  /** draws a shader into a target; `add` sums onto what is there. With `keep`, the shader is built once and reused
   *  for later draws of the same ShaderCode (only its uniforms' values may change meanwhile: TAA's jitter) */
  renderInto(sc: ShaderCode, t: Target, add = false, opts: { keep?: boolean } = {}): void {
    let built = opts.keep ? this.builtShaders.get(sc) : undefined;
    if (!built) {
      built = buildFragmentShader(sc);
      if (opts.keep) this.builtShaders.set(sc, built);
    }
    if (this.link) {
      this.link.rec.time = this.time;
      this.link.rec.renderInto(sc, t, add, built);
      return;
    }
    const saved = this.main.time;
    this.main.time = this.time;
    try {
      // what Renderer.renderInto does, with the shader already built
      this.main.draw(built, this.main.resolveUniforms(built.uniforms, new Set()).values, t, add);
    } finally {
      this.main.time = saved;
    }
  }

  /** the texture a sampler uniform refers to (a material's buffer...), rendered if needed. It belongs to the session's
   *  cache (or, on the page, to the Renderer's): read it, do not delete it */
  textureFor(ref: TextureRef): Target | null {
    if (this.link) {
      this.link.rec.time = this.time;
      return this.link.rec.textureFor(ref);
    }
    const saved = this.main.time;
    this.main.time = this.time;
    try {
      return this.main.textureFor(ref);
    } finally {
      this.main.time = saved;
    }
  }

  /** asks for a target's pixels (row 0 first): floats, or bytes as an image file stores them. Returns its index in
   *  what `flush` returns */
  read(t: Target, floats: boolean): number {
    const out = this.slots++;
    if (this.link) this.link.rec.read(t, floats, out);
    else this.mainOut[out] = floats ? this.main.readPixels(t) : this.main.toImageData(t).data;
    return out;
  }

  /** draws a target into a canvas (at the canvas's size), when the flush is done */
  present(t: Target, ctx: CanvasRenderingContext2D, checker = false): void {
    if (!this.link) return this.main.present(t, ctx, checker);
    const out = this.slots++;
    this.link.rec.present(t, ctx.canvas.width, ctx.canvas.height, checker, out);
    this.shows.push({ out, ctx });
  }

  /** runs what was asked for; resolves with the pixels read, by the indices `read` returned */
  async flush(opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {}): Promise<(SessionPixels | null)[]> {
    const slots = this.slots;
    this.slots = 0;
    if (!this.link) {
      const out = this.mainOut;
      this.mainOut = [];
      out.length = slots;
      return out;
    }
    const shows = this.shows;
    this.shows = [];
    if (this.broken || this.disposed) {
      this.link.discard(this.link.rec);
      throw new RenderFailure("lost", "the WebGL context was lost");
    }
    let res: { outputs: Outputs; errors: DrawError[] };
    try {
      res = await this.link.run(this.link.rec, opts);
    } catch (e) {
      // what the worker holds for this session is unknown now: free it and start again from nothing
      this.free();
      throw e;
    }
    if (res.errors.length) {
      this.link.rec.applyErrors(res.errors);
      for (const o of res.outputs) if (o instanceof ImageBitmap) o.close();
      const e = res.errors[0];
      throw new ShaderError(e.message, e.source ?? "", e.log);
    }
    for (const s of shows) {
      const bmp = res.outputs[s.out] as ImageBitmap | null;
      if (!bmp) continue;
      s.ctx.clearRect(0, 0, s.ctx.canvas.width, s.ctx.canvas.height);
      s.ctx.drawImage(bmp, 0, 0);
      bmp.close();
    }
    const out: (SessionPixels | null)[] = [];
    for (let i = 0; i < slots; i++) {
      const o = res.outputs[i];
      out.push(o && !(o instanceof ImageBitmap) ? o : null);
    }
    return out;
  }

  /** the worker lost its targets */
  lost(): void {
    this.broken = true;
    this.link?.rec.reset();
  }

  private free(): void {
    if (!this.link) return;
    const ids = [...this.link.rec.owned];
    this.link.discard(this.link.rec);
    this.link.release(ids);
  }

  /** frees the session's targets */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.link) {
      if (!this.broken) this.free();
    } else for (const t of this.mainTargets) this.main.deleteTarget(t);
    this.mainTargets.clear();
    this.mainOut = [];
    this.onDispose?.();
  }
}
