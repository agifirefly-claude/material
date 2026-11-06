/* WebGL2 renderer: runs generated shaders into float textures, rendering the buffers they sample first.
 * Plays the part of Material Maker's mm_renderer, its compute pipeline (engine/pipeline) and mm_deps.
 *
 * It is made of parts, each in its own module:
 *   programs.ts  compiling shaders (with the GLSL 4.50 to ES 3.00 fixes)
 *   targets.ts   float render targets
 *   draw.ts      running a shader with its uniforms
 *   blit.ts      copying pictures in and drawing targets onto 2D canvases
 *   buffers.ts   Buffer and Iterate Buffer passes, and the cache they share with previews
 *   sources.ts   pictures, text and the camera
 * This class holds their state, resolves what each sampler reads and is the API the rest of the code uses. */
import type { ShaderCode, TextureRef } from "../shader-code";
import { buildFragmentShader, withPreview, type BuiltShader } from "./shader-source";
import { ProgramCache } from "./programs";
import * as targets from "./targets";
import { drawShader } from "./draw";
import { Blitter } from "./blit";
import { renderCached } from "./buffers";
import { upload } from "./sources";
import { HostBase } from "./base";
import { ShaderError, type Target } from "./types";

export { ShaderError, type Target } from "./types";

export class Renderer extends HostBase {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private programs: ProgramCache;
  private vao: WebGLVertexArrayObject;
  private floatLinear: boolean;
  private blitter: Blitter;
  private blankTarget: Target | null = null;
  private renders = 0;
  /** programs compiled and shaders run so far */
  get stats() {
    return { programs: this.programs.compiled, renders: this.renders };
  }

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    super();
    this.canvas = canvas ?? (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : document.createElement("canvas"));
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is not available");
    this.floatLinear = !!gl.getExtension("OES_texture_float_linear");
    this.vao = targets.fullScreenTriangle(gl);
    this.programs = new ProgramCache(gl);
    this.blitter = new Blitter(gl, this.vao, this.canvas);
  }

  protected mainOnly<T>(_what: string, get: () => T): T {
    return get();
  }

  /* ---------- programs ---------- */
  program(source: string) {
    return this.programs.get(source);
  }

  /** compiles without rendering; returns the error, if any */
  check(sc: ShaderCode, preview = true): ShaderError | null {
    try {
      this.program(buildFragmentShader(preview ? withPreview(sc) : sc).source);
      return null;
    } catch (e) {
      return e as ShaderError;
    }
  }

  /* ---------- targets ---------- */
  createTarget(size: number, f32 = false, mipmap = false, height = size): Target {
    return targets.createTarget(this.gl, this.floatLinear, size, f32, mipmap, height);
  }
  deleteTarget(t: Target | null | undefined): void {
    targets.deleteTarget(this.gl, t);
  }
  /** @internal */
  upload(source: TexImageSource, size: number, into?: Target): Target {
    return upload(this.gl, this.blitter, source, into ?? this.createTarget(size, false, true), size);
  }
  /** @internal */
  blit(src: WebGLTexture, dst: Target, size: number): void {
    this.blitter.blit(src, dst, size);
  }

  /* ---------- drawing ---------- */
  /** @internal */
  draw(built: BuiltShader, values: Map<string, unknown>, target: Target, blend = false): void {
    const self = this;
    drawShader(
      {
        gl: this.gl,
        programs: this.programs,
        vao: this.vao,
        time: this.time,
        blank() {
          return (self.blankTarget ??= self.createTarget(4));
        },
      },
      built,
      values,
      target,
      blend,
    );
    this.renders++;
  }

  /** renders a ShaderCode's rgba output (through its port type preview) into a target, rendering what it samples first */
  render(sc: ShaderCode, size: number, opts: { key?: string; preview?: boolean; f32?: boolean } = {}): Target {
    const src = opts.preview === false ? sc : withPreview(sc, size);
    const key = opts.key ?? "render:" + Math.random();
    const r = renderCached(this, key, src, size, !!opts.f32, false, new Set());
    const err = this.errors.get(key);
    if (err) throw err;
    if (!opts.key) this.cache.delete(key);
    return r.target!;
  }

  /** renders into a target the caller owns, without caching; `add` sums onto what is there (accumulation) */
  renderInto(sc: ShaderCode, target: Target, add = false): void {
    const built = buildFragmentShader(sc);
    const deps = this.resolveUniforms(built.uniforms, new Set());
    this.draw(built, deps.values, target, add);
  }
  clearTarget(t: Target): void {
    targets.clearTarget(this.gl, t);
  }

  /** the texture a sampler uniform refers to (a buffer, an image...), rendered if needed */
  textureFor(ref: TextureRef): Target | null {
    return this.resolve(ref, new Set()).target;
  }

  /** pixels of a target, row 0 first (row 0 is uv.y = 0, the top of the image) */
  readPixels(t: Target): Float32Array {
    return targets.readTarget(this.gl, t);
  }

  toImageData(t: Target): ImageData {
    return new ImageData(targets.toBytes(this.readPixels(t)), t.size, t.height ?? t.size);
  }

  /** draws a target into a 2D canvas (with a checkerboard under transparency) */
  present(t: Target, ctx: CanvasRenderingContext2D, checker = true): void {
    this.blitter.present(t, ctx, checker);
  }
}
