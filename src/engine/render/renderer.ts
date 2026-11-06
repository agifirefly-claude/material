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
import { ShaderCode, type ShaderUniform, type TextureRef } from "../shader-code";
import { buildFragmentShader, withPreview, type BuiltShader } from "./shader-source";
import { GenBuffer, GenImage, GenIterateBuffer, GenText, GenTextureRef, GenTexture } from "../gen/texture";
import { GenMeshMap, GenWebcam, meshMapHooks } from "../gen/misc";
import { ProgramCache } from "./programs";
import * as targets from "./targets";
import { drawShader } from "./draw";
import { Blitter } from "./blit";
import { renderBuffer, renderCached, renderIterateBuffer } from "./buffers";
import { ImageSource, TextSource, WebcamSource } from "./sources";
import type { CacheEntry, RenderHost } from "./host";
import { ShaderError, type Resolved, type Target } from "./types";

export { ShaderError, type Target } from "./types";

export class Renderer implements RenderHost {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private programs: ProgramCache;
  private cache = new Map<string, CacheEntry>();
  private vao: WebGLVertexArrayObject;
  private floatLinear: boolean;
  private blitter: Blitter;
  private images: ImageSource;
  private texts: TextSource;
  private webcam: WebcamSource;
  private blankTarget: Target | null = null;
  /** @internal the current texture of each iterate buffer's loop */
  loopTextures = new Map<string, Target>();
  /** called when something loaded asynchronously (an image) and renders should be redone */
  onAsyncUpdate: (() => void) | null = null;
  time = 0;
  /** set when a render (or one of the buffers it read) depends on the time */
  usedTime = false;
  /** errors met while rendering buffers, by buffer key */
  errors = new Map<string, ShaderError>();
  private renders = 0;
  /** programs compiled and shaders run so far */
  get stats() {
    return { programs: this.programs.compiled, renders: this.renders };
  }

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas ?? (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : document.createElement("canvas"));
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is not available");
    this.floatLinear = !!gl.getExtension("OES_texture_float_linear");
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.programs = new ProgramCache(gl);
    this.blitter = new Blitter(gl, this.vao, this.canvas);
    this.images = new ImageSource(this);
    this.texts = new TextSource(this);
    this.webcam = new WebcamSource(this);
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
  reuse(key: string, size: number, f32: boolean, mipmap: boolean): Target {
    const old = this.cache.get(key)?.target;
    if (old && old.size === size && old.f32 === f32 && old.mipmap === mipmap) return old;
    this.deleteTarget(old);
    return this.createTarget(size, f32, mipmap);
  }
  /** @internal */
  cached(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }
  /** @internal */
  setCached(key: string, entry: CacheEntry | null): void {
    if (entry) this.cache.set(key, entry);
    else this.cache.delete(key);
  }
  /** @internal */
  blit(src: WebGLTexture, dst: Target, size: number): void {
    this.blitter.blit(src, dst, size);
  }
  /** @internal */
  asyncUpdate(): void {
    this.onAsyncUpdate?.();
  }

  /* ---------- resolving samplers ---------- */
  private resolve(ref: TextureRef, stack: Set<string>): Resolved {
    const meshMap = (ref as TextureRef & { meshMap?: string }).meshMap;
    if (meshMap) return (meshMapHooks.texture?.(this, meshMap) as Resolved | null) ?? { target: null, sig: "nomesh" };
    // a texture the caller already has (TAA accumulation, ...)
    const direct = (ref as TextureRef & { target?: Target }).target;
    if (direct) return { target: direct, sig: ref.key };
    if (!(ref instanceof GenTextureRef)) return { target: null, sig: "none" };
    const g = ref.gen;
    if (g instanceof GenIterateBuffer && ref.slot === "_loop_tex") {
      const t = this.loopTextures.get(g.genName);
      return { target: t ?? null, sig: "loop" };
    }
    if (stack.has(ref.key)) return { target: null, sig: "cycle" };
    stack.add(ref.key);
    try {
      // textures something else provides (baked mesh maps, painted layers)
      const ext = (g as unknown as { externalTarget?: (r: Renderer, slot: string) => Resolved | null }).externalTarget?.(this, ref.slot);
      if (ext) return ext;
      if (g instanceof GenBuffer) return renderBuffer(this, g, stack);
      if (g instanceof GenIterateBuffer) return renderIterateBuffer(this, g, stack);
      if (g instanceof GenImage) return this.images.resolve(g);
      if (g instanceof GenText) return this.texts.resolve(g);
      if (g instanceof GenWebcam) return this.webcam.resolve();
      if (g instanceof GenMeshMap || g instanceof GenTexture) return { target: null, sig: "empty" };
      return { target: null, sig: "none" };
    } finally {
      stack.delete(ref.key);
    }
  }

  /** @internal what each uniform of a shader is set to, samplers resolved (and rendered), with a signature of it all */
  resolveUniforms(uniforms: ShaderUniform[], stack: Set<string>): { sig: string; values: Map<string, unknown> } {
    const values = new Map<string, unknown>();
    let sig = "";
    for (const u of uniforms) {
      if (u.type === "sampler2D") {
        const r = u.value && typeof u.value === "object" && "kind" in u.value ? this.resolve(u.value as TextureRef, stack) : { target: null, sig: "none" };
        values.set(u.name, r.target);
        sig += u.name + ":" + r.sig + ";";
      } else {
        values.set(u.name, u.value);
        if (typeof u.value !== "function") sig += u.name + "=" + (Array.isArray(u.value) ? u.value.join(",") : String(u.value)) + ";";
      }
    }
    return { sig, values };
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
    const px = this.readPixels(t);
    const data = new Uint8ClampedArray(px.length);
    for (let i = 0; i < px.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, px[i])) * 255);
    return new ImageData(data, t.size, t.height ?? t.size);
  }

  /** draws a target into a 2D canvas (with a checkerboard under transparency) */
  present(t: Target, ctx: CanvasRenderingContext2D, checker = true): void {
    this.blitter.present(t, ctx, checker);
  }

  /** renders and keeps the result under `key`, re-rendering only when the shader or what it reads changed */
  renderKeyed(key: string, sc: ShaderCode, size: number, preview = true): { target: Target | null; changed: boolean; error: ShaderError | null; usesTime: boolean } {
    const before = this.cache.get(key)?.sig;
    this.usedTime = false;
    const r = renderCached(this, key, preview ? withPreview(sc, size) : sc, size, false, false, new Set());
    return { target: r.target, changed: before !== r.sig, error: this.errors.get(key) ?? null, usesTime: this.usedTime };
  }
  forget(key: string): void {
    const c = this.cache.get(key);
    if (c) this.deleteTarget(c.target);
    this.cache.delete(key);
    this.errors.delete(key);
  }

  /** forgets cached renders (they are redone on demand) */
  clearCache(): void {
    for (const c of this.cache.values()) this.deleteTarget(c.target);
    this.cache.clear();
  }
}
