/* WebGL2 renderer: runs generated shaders into float textures, rendering the buffers they sample first.
 * Plays the part of Material Maker's mm_renderer, its compute pipeline (engine/pipeline) and mm_deps. */
import { ShaderCode, type ShaderUniform, type TextureRef } from "../shader-code";
import { buildFragmentShader, withPreview, type BuiltShader } from "./shader-source";
import { fixFromErrors } from "./glsl-fix";
import { GenBuffer, GenImage, GenIterateBuffer, GenText, GenTextureRef, GenTexture } from "../gen/texture";
import { GenMeshMap, GenWebcam } from "../gen/misc";
import { isColor } from "../params/types";

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  size: number;
  /** when not square: the height (size is then the width) */
  height?: number;
  f32: boolean;
  mipmap: boolean;
}

export class ShaderError extends Error {
  constructor(
    message: string,
    public source: string,
    public log: string,
  ) {
    super(message);
  }
}

interface Resolved {
  target: Target | null;
  sig: string;
}

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const BLIT = `#version 300 es
precision highp float;
uniform sampler2D t;
uniform vec2 s;
uniform int mode;
uniform bool flip;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / s;
  if (flip) uv.y = 1.0 - uv.y;
  vec4 c = texture(t, uv);
  if (mode == 1) {
    vec2 cb = floor(gl_FragCoord.xy / 8.0);
    float k = mod(cb.x + cb.y, 2.0) == 0.0 ? 0.35 : 0.5;
    c = vec4(mix(vec3(k), c.rgb, clamp(c.a, 0.0, 1.0)), 1.0);
  }
  o = vec4(clamp(c.rgb, 0.0, 1.0), clamp(c.a, 0.0, 1.0));
}`;

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private programs = new Map<string, { program: WebGLProgram; locations: Map<string, WebGLUniformLocation | null> } | ShaderError>();
  private cache = new Map<string, { sig: string; target: Target }>();
  private images = new Map<string, { tex: Target | null; w: number; h: number; loading: boolean; error?: string }>();
  private vao: WebGLVertexArrayObject;
  private floatLinear: boolean;
  private loopTextures = new Map<string, Target>();
  private blitProgram: WebGLProgram;
  /** called when something loaded asynchronously (an image) and renders should be redone */
  onAsyncUpdate: (() => void) | null = null;
  time = 0;
  /** set when a render (or one of the buffers it read) depends on the time */
  usedTime = false;
  /** errors met while rendering buffers, by buffer key */
  errors = new Map<string, ShaderError>();
  stats = { programs: 0, renders: 0 };

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
    this.blitProgram = this.link(BLIT);
  }

  /* ---------- programs ---------- */
  private link(fragment: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? "";
        gl.deleteShader(s);
        throw new ShaderError("Shader compilation failed: " + log.split("\n")[0], src, log);
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p) ?? "";
      throw new ShaderError("Shader link failed: " + log, fragment, log);
    }
    return p;
  }

  program(source: string) {
    let p = this.programs.get(source);
    if (!p) {
      let src = source;
      for (let attempt = 0; ; attempt++) {
        try {
          p = { program: this.link(src), locations: new Map() };
          this.stats.programs++;
          break;
        } catch (e) {
          p = e instanceof ShaderError ? e : new ShaderError(String(e), src, String(e));
          // GLSL 4.50 code: retry with the int -> float conversions the errors point at
          const fixed = attempt < 16 && p instanceof ShaderError ? fixFromErrors(src, p.log) : null;
          if (!fixed) break;
          src = fixed;
        }
      }
      if (this.programs.size > 400) this.programs.delete(this.programs.keys().next().value!);
      this.programs.set(source, p);
    }
    if (p instanceof ShaderError) throw p;
    return p;
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
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, mipmap ? Math.floor(Math.log2(Math.max(size, height))) + 1 : 1, f32 ? gl.RGBA32F : gl.RGBA16F, size, height);
    const linear = !f32 || this.floatLinear;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? (mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR) : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return height === size ? { tex, fbo, size, f32, mipmap } : { tex, fbo, size, f32, mipmap, height };
  }
  deleteTarget(t: Target | null | undefined): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }
  private reuse(key: string, size: number, f32: boolean, mipmap: boolean): Target {
    const old = this.cache.get(key)?.target;
    if (old && old.size === size && old.f32 === f32 && old.mipmap === mipmap) return old;
    this.deleteTarget(old);
    return this.createTarget(size, f32, mipmap);
  }

  /* ---------- resolving samplers ---------- */
  private resolve(ref: TextureRef, stack: Set<string>): Resolved {
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
      if (g instanceof GenBuffer) return this.renderBuffer(g, stack);
      if (g instanceof GenIterateBuffer) return this.renderIterateBuffer(g, stack);
      if (g instanceof GenImage) return this.imageTexture(g);
      if (g instanceof GenText) return this.textTexture(g);
      if (g instanceof GenWebcam) return this.webcamTexture();
      if (g instanceof GenMeshMap || g instanceof GenTexture) return { target: null, sig: "empty" };
      return { target: null, sig: "none" };
    } finally {
      stack.delete(ref.key);
    }
  }

  private renderBuffer(g: GenBuffer, stack: Set<string>): Resolved {
    const key = g.genName + "_tex";
    let job;
    try {
      job = g.job();
    } catch (e) {
      console.error(e);
      return { target: null, sig: "error" };
    }
    return this.renderCached(key, job.source, job.size, job.f32, job.mipmap, stack);
  }

  private renderCached(key: string, sc: ShaderCode, size: number, f32: boolean, mipmap: boolean, stack: Set<string>): Resolved {
    const built = buildFragmentShader(sc);
    const deps = this.resolveUniforms(built.uniforms, stack);
    // a shader that reads the time is a new render at every new time
    const timeSig = built.body.includes("elapsed_time") ? "t" + this.time : "";
    if (timeSig) this.usedTime = true;
    const sig = fnv(built.source + "|" + deps.sig + "|" + size + f32 + mipmap + timeSig);
    const cached = this.cache.get(key);
    if (cached && cached.sig === sig) return { target: cached.target, sig };
    const target = this.reuse(key, size, f32, mipmap);
    try {
      this.draw(built, deps.values, target);
      this.errors.delete(key);
    } catch (e) {
      if (e instanceof ShaderError) this.errors.set(key, e);
      else throw e;
    }
    this.cache.set(key, { sig, target });
    return { target, sig };
  }

  private renderIterateBuffer(g: GenIterateBuffer, stack: Set<string>): Resolved {
    const key = g.genName + "_it_tex";
    const { init, loop } = g.jobs();
    const builtInit = buildFragmentShader(init);
    const builtLoop = buildFragmentShader(loop);
    const iterations = g.iterations;
    const size = g.size;
    const f32 = !!g.getParameter("f32");
    const mipmap = !!g.getParameter("mipmap");
    const shrink = !!g.getParameter("shrink");
    const initDeps = this.resolveUniforms(builtInit.uniforms, stack);
    // the loop reads its own previous result: resolve the rest of its samplers now, the loop texture each iteration
    const loopDepsSig = this.resolveUniforms(builtLoop.uniforms, stack).sig;
    const timeSig = (builtInit.body + builtLoop.body).includes("elapsed_time") ? "t" + this.time : "";
    if (timeSig) this.usedTime = true;
    const sig = fnv(builtInit.source + builtLoop.source + initDeps.sig + loopDepsSig + [iterations, size, f32, mipmap, shrink].join(",") + timeSig);
    const cached = this.cache.get(key);
    if (cached && cached.sig === sig) return { target: cached.target, sig };
    let current: Target | null = null;
    try {
      g.currentIteration = 0;
      current = this.createTarget(size, f32, mipmap);
      this.draw(builtInit, initDeps.values, current);
      for (let it = 1; it <= iterations; it++) {
        g.currentIteration = it;
        this.loopTextures.set(g.genName, current);
        const s = shrink ? Math.max(4, size >> it) : size;
        const next = this.createTarget(s, f32, mipmap);
        const deps = this.resolveUniforms(builtLoop.uniforms, stack);
        this.draw(builtLoop, deps.values, next);
        this.deleteTarget(current);
        current = next;
      }
      this.loopTextures.set(g.genName, current);
      this.errors.delete(key);
    } catch (e) {
      if (e instanceof ShaderError) this.errors.set(key, e);
      else throw e;
    }
    g.currentIteration = iterations + 1;
    if (cached) this.deleteTarget(cached.target);
    if (current) this.cache.set(key, { sig, target: current });
    else this.cache.delete(key);
    return { target: current, sig };
  }

  /* ---------- webcam (gen_webcam.gd): the browser's camera, asked for the first time a webcam node is rendered ---------- */
  private webcam: { video: HTMLVideoElement | null; target: Target | null; state: "asking" | "on" | "denied" } | null = null;
  private webcamTexture(): Resolved {
    if (!this.webcam) {
      this.webcam = { video: null, target: null, state: "asking" };
      const cam = this.webcam;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) cam.state = "denied";
      else
        navigator.mediaDevices
          .getUserMedia({ video: true })
          .then((stream) => {
            const v = document.createElement("video");
            v.muted = true;
            v.playsInline = true;
            v.srcObject = stream;
            return v.play().then(() => {
              cam.video = v;
              cam.state = "on";
              this.onAsyncUpdate?.();
            });
          })
          .catch(() => (cam.state = "denied"));
    }
    const cam = this.webcam;
    if (cam.state !== "on" || !cam.video || !cam.video.videoWidth) return { target: null, sig: "webcam:" + cam.state };
    const gl = this.gl;
    const size = 1 << Math.ceil(Math.log2(Math.max(cam.video.videoWidth, cam.video.videoHeight, 1)));
    if (!cam.target || cam.target.size !== Math.min(size, 1024)) {
      this.deleteTarget(cam.target);
      cam.target = this.createTarget(Math.min(size, 1024), false, true);
    }
    const tmp = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tmp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cam.video);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.blit(tmp, cam.target, cam.target.size);
    gl.deleteTexture(tmp);
    // a live picture: renders that read it refresh like time based ones
    this.usedTime = true;
    return { target: cam.target, sig: "webcam:" + this.time };
  }

  private imageTexture(g: GenImage): Resolved {
    const url = String(g.getParameter("image") ?? "");
    if (!url) return { target: null, sig: "noimage" };
    let entry = this.images.get(url);
    if (!entry) {
      entry = { tex: null, w: 0, h: 0, loading: true };
      this.images.set(url, entry);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const gl = this.gl;
        const size = 1 << Math.ceil(Math.log2(Math.max(img.width, img.height, 1)));
        const t = this.createTarget(size, false, true);
        const tmp = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tmp);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        this.blit(tmp, t, size);
        gl.deleteTexture(tmp);
        entry!.tex = t;
        entry!.w = img.width;
        entry!.h = img.height;
        entry!.loading = false;
        this.onAsyncUpdate?.();
      };
      img.onerror = () => {
        entry!.loading = false;
        entry!.error = "Cannot load " + url;
      };
      img.src = url;
    }
    if (entry.tex) {
      g.imageSize = { w: entry.w, h: entry.h };
      return { target: entry.tex, sig: "img:" + url };
    }
    return { target: null, sig: "loading:" + url };
  }

  private textTexture(g: GenText): Resolved {
    const p = g.parameters;
    const fg = isColor(p.fg) ? p.fg : { r: 1, g: 1, b: 1, a: 1 };
    const bg = isColor(p.bg) ? p.bg : { r: 0, g: 0, b: 0, a: 1 };
    const num = (k: string, d: number) => g.calculateFloatParameter(k) ?? d;
    const desc = JSON.stringify([p.text, p.font, fg, bg, num("font_size", 32), num("line_spacing", 0), p.alignment, p.center, num("x", 0.1), num("y", 0.1)]);
    const key = g.genName + "_tex";
    const sig = fnv("text" + desc);
    const cached = this.cache.get(key);
    if (cached && cached.sig === sig) return { target: cached.target, sig };
    const size = 512;
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    const css = (k: typeof fg) => `rgba(${k.r * 255},${k.g * 255},${k.b * 255},${k.a})`;
    ctx.fillStyle = css(bg);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = css(fg);
    const fontSize = num("font_size", 32);
    ctx.font = `${fontSize}px ${String(p.font || "sans-serif")}`;
    const lines = String(p.text ?? "").split("\n");
    const lineHeight = fontSize * 1.2 + num("line_spacing", 0);
    const align = Math.round(Number(p.alignment ?? 0));
    ctx.textAlign = align === 1 ? "center" : align === 2 ? "right" : "left";
    ctx.textBaseline = "top";
    let x = (num("x", 0.1) + (p.center ? 0.5 : 0)) * size;
    let y = (num("y", 0.1) + (p.center ? 0.5 : 0)) * size;
    if (p.center) y -= (lines.length * lineHeight) / 2;
    if (p.center && align === 0) ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    x = y = 0;
    const gl = this.gl;
    const t = this.reuse(key, size, false, true);
    const tmp = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tmp);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c as unknown as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.blit(tmp, t, size);
    gl.deleteTexture(tmp);
    this.cache.set(key, { sig, target: t });
    return { target: t, sig };
  }

  /** copies a texture into a target, flipping it so image row 0 is uv.y = 0 */
  private blit(src: WebGLTexture, dst: Target, size: number) {
    const gl = this.gl;
    gl.useProgram(this.blitProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, size, size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, "t"), 0);
    gl.uniform2f(gl.getUniformLocation(this.blitProgram, "s"), size, size);
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, "mode"), 0);
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, "flip"), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (dst.mipmap) {
      gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }

  private resolveUniforms(uniforms: ShaderUniform[], stack: Set<string>): { sig: string; values: Map<string, unknown> } {
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
  private dummy: Target | null = null;
  private draw(built: BuiltShader, values: Map<string, unknown>, target: Target, blend = false): void {
    const gl = this.gl;
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    const { program, locations } = this.program(built.source);
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.size, target.height ?? target.size);
    const loc = (n: string) => {
      if (!locations.has(n)) locations.set(n, gl.getUniformLocation(program, n));
      return locations.get(n)!;
    };
    gl.uniform2f(loc("mm_size"), target.size, target.height ?? target.size);
    gl.uniform1f(loc("elapsed_time"), this.time);
    let unit = 0;
    for (const u of built.uniforms) {
      let v = values.get(u.name);
      if (typeof v === "function") v = (v as () => number)();
      const l = loc(u.size > 0 ? u.name + "[0]" : u.name) ?? loc(u.name);
      if (u.type === "sampler2D") {
        let t = v as Target | null;
        if (!t || t === target) {
          if (!this.dummy) this.dummy = this.createTarget(4);
          t = this.dummy;
        }
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform1i(l, unit);
        unit++;
        continue;
      }
      if (l === null) continue;
      const arr = Array.isArray(v) ? (v as number[]) : [Number(v ?? 0)];
      switch (u.type) {
        case "float":
          gl.uniform1fv(l, arr);
          break;
        case "int":
        case "bool":
          gl.uniform1iv(l, arr.map((x) => Math.trunc(Number(x)) | 0));
          break;
        case "vec2":
          gl.uniform2fv(l, pad(arr, 2));
          break;
        case "vec3":
          gl.uniform3fv(l, pad(arr, 3));
          break;
        case "vec4":
          gl.uniform4fv(l, pad(arr, 4));
          break;
      }
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.renders++;
    if (blend) gl.disable(gl.BLEND);
    if (target.mipmap) {
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }

  /** renders a ShaderCode's rgba output (through its port type preview) into a target, rendering what it samples first */
  render(sc: ShaderCode, size: number, opts: { key?: string; preview?: boolean; f32?: boolean } = {}): Target {
    const src = opts.preview === false ? sc : withPreview(sc, size);
    const key = opts.key ?? "render:" + Math.random();
    const r = this.renderCached(key, src, size, !!opts.f32, false, new Set());
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
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.size, t.height ?? t.size);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** the texture a sampler uniform refers to (a buffer, an image...), rendered if needed */
  textureFor(ref: TextureRef): Target | null {
    return this.resolve(ref, new Set()).target;
  }

  /** pixels of a target, row 0 first (row 0 is uv.y = 0, the top of the image) */
  readPixels(t: Target): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    const h = t.height ?? t.size;
    const out = new Float32Array(t.size * h * 4);
    gl.readPixels(0, 0, t.size, h, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  toImageData(t: Target): ImageData {
    const px = this.readPixels(t);
    const data = new Uint8ClampedArray(px.length);
    for (let i = 0; i < px.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, px[i])) * 255);
    return new ImageData(data, t.size, t.height ?? t.size);
  }

  /** draws a target into a 2D canvas (with a checkerboard under transparency) */
  present(t: Target, ctx: CanvasRenderingContext2D, checker = true): void {
    const gl = this.gl;
    const w = ctx.canvas.width,
      h = ctx.canvas.height;
    // the GL canvas only grows: resizing it on every call would be slow
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    gl.useProgram(this.blitProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, "t"), 0);
    gl.uniform2f(gl.getUniformLocation(this.blitProgram, "s"), w, h);
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, "mode"), checker ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.blitProgram, "flip"), 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.canvas as CanvasImageSource, 0, this.canvas.height - h, w, h, 0, 0, w, h);
  }

  /** renders and keeps the result under `key`, re-rendering only when the shader or what it reads changed */
  renderKeyed(key: string, sc: ShaderCode, size: number, preview = true): { target: Target | null; changed: boolean; error: ShaderError | null; usesTime: boolean } {
    const before = this.cache.get(key)?.sig;
    this.usedTime = false;
    const r = this.renderCached(key, preview ? withPreview(sc, size) : sc, size, false, false, new Set());
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

function pad(a: number[], n: number): number[] {
  if (a.length % n === 0 && a.length) return a;
  const out = [...a];
  while (out.length % n || !out.length) out.push(out.length % 4 === 3 ? 1 : 0);
  return out;
}
