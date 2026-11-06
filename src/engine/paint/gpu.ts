/* WebGL2 helpers for the mesh map generator and the painter, on the renderer's own context so that their textures
 * can be read by generated shaders (Mesh Map nodes, brushes) and the other way round. */
import type { Renderer, Target } from "../render/renderer";
import { ShaderError } from "../render/renderer";
import { fixFromErrors, fixGlsl } from "../render/glsl-fix";
import type { ShaderUniform, TextureRef } from "../shader-code";
import type { PaintMesh } from "./mesh";

export const GLSL_HEADER = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n";

/** a render target of any size (the renderer's are square) */
export interface RT {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  depth?: WebGLRenderbuffer;
}

export type UniformInput = number | boolean | number[] | Target | RT | TextureRef | null | { type: "mat4"; value: number[] } | { type: "int"; value: number | number[] } | { type: "ivec2"; value: number[] };

interface Prog {
  program: WebGLProgram;
  loc: (n: string) => WebGLUniformLocation | null;
  types: Map<string, { type: number; size: number }>;
}

export class Gpu {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<string, Prog | ShaderError>();
  private quad: WebGLVertexArrayObject;
  private meshes = new Map<string, { vao: WebGLVertexArrayObject; count: number; buffers: WebGLBuffer[]; extra?: WebGLBuffer }>();
  private dummy: WebGLTexture;

  constructor(public renderer: Renderer) {
    const gl = (this.gl = renderer.gl);
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.dummy = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
  }

  /* ---------- programs ---------- */
  /** compiles (with the GLSL 4.50 compatibility fixes) and links; vertex attributes: 0 p/a_pos, 1 a_nrm, 2 a_tan, 3 a_uv, 4 a_col */
  program(vs: string, fs: string): Prog {
    const key = vs + "\u0000" + fs;
    const cached = this.programs.get(key);
    if (cached instanceof ShaderError) throw cached;
    if (cached) return cached;
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader | ShaderError => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? "";
        gl.deleteShader(s);
        return new ShaderError("Shader compilation failed: " + log.split("\n")[0], src, log);
      }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    if (v instanceof ShaderError) {
      this.programs.set(key, v);
      throw v;
    }
    let src = fixGlsl(fs);
    let f: WebGLShader | ShaderError = compile(gl.FRAGMENT_SHADER, src);
    for (let i = 0; i < 16 && f instanceof ShaderError; i++) {
      const fixed = fixFromErrors(src, f.log);
      if (!fixed) break;
      src = fixed;
      f = compile(gl.FRAGMENT_SHADER, src);
    }
    if (f instanceof ShaderError) {
      gl.deleteShader(v);
      this.programs.set(key, f);
      throw f;
    }
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    ["a_pos", "a_nrm", "a_tan", "a_uv", "a_col"].forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.bindAttribLocation(p, 0, "p");
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const e = new ShaderError("Shader link failed: " + gl.getProgramInfoLog(p), src, gl.getProgramInfoLog(p) ?? "");
      this.programs.set(key, e);
      throw e;
    }
    const locs = new Map<string, WebGLUniformLocation | null>();
    const types = new Map<string, { type: number; size: number }>();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      types.set(info.name.replace(/\[0\]$/, ""), { type: info.type, size: info.size });
    }
    const prog: Prog = {
      program: p,
      types,
      loc: (name) => {
        if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name) ?? gl.getUniformLocation(p, name + "[0]"));
        return locs.get(name)!;
      },
    };
    if (this.programs.size > 200) this.programs.delete(this.programs.keys().next().value!);
    this.programs.set(key, prog);
    return prog;
  }

  static readonly FULLSCREEN_VS = GLSL_HEADER + "in vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }\n";

  /* ---------- targets ---------- */
  target(w: number, h: number, opts: { f32?: boolean; nearest?: boolean; depth?: boolean; clamp?: boolean } = {}): RT {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, opts.f32 ? gl.RGBA32F : gl.RGBA16F, w, h);
    const filter = opts.nearest || opts.f32 ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    const wrap = opts.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let depth: WebGLRenderbuffer | undefined;
    if (opts.depth) {
      depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    return { tex, fbo, w, h, depth };
  }
  /** a square target in the renderer's format, usable wherever a Target is */
  squareTarget(size: number): Target {
    return this.renderer.createTarget(size);
  }
  deleteRT(t: RT | null | undefined) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
    if (t.depth) this.gl.deleteRenderbuffer(t.depth);
  }
  static asRT(t: Target): RT {
    return { tex: t.tex, fbo: t.fbo, w: t.size, h: t.size };
  }

  private mrtCache = new Map<string, WebGLFramebuffer>();
  private texIds = new WeakMap<WebGLTexture, number>();
  private nextTexId = 1;
  /** a framebuffer writing to several textures at once (they must have the same size) */
  mrt(textures: WebGLTexture[]): WebGLFramebuffer {
    const id = textures.map((t) => {
      let i = this.texIds.get(t);
      if (!i) this.texIds.set(t, (i = this.nextTexId++));
      return i;
    });
    const key = id.join(",");
    let fbo = this.mrtCache.get(key);
    if (!fbo) {
      const gl = this.gl;
      fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
      gl.drawBuffers(textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
      this.mrtCache.set(key, fbo);
    }
    return fbo;
  }
  forgetMrt() {
    for (const f of this.mrtCache.values()) this.gl.deleteFramebuffer(f);
    this.mrtCache.clear();
  }

  clear(t: RT | Target, color: [number, number, number, number] = [0, 0, 0, 0]) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clearColor(...color);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | ("depth" in t && t.depth ? gl.DEPTH_BUFFER_BIT : 0));
  }

  /* ---------- uniforms ---------- */
  setUniforms(p: Prog, values: Record<string, UniformInput>, shaderUniforms: ShaderUniform[] = []): void {
    const gl = this.gl;
    let unit = 0;
    const all: [string, UniformInput, string?][] = Object.entries(values).map(([k, v]) => [k, v]);
    for (const u of shaderUniforms) if (!(u.name in values)) all.push([u.name, (typeof u.value === "function" ? (u.value as () => number)() : u.value) as UniformInput, u.type]);
    for (const [name, raw, declared] of all) {
      const info = p.types.get(name);
      if (!info) continue;
      const l = p.loc(name);
      if (l === null) continue;
      const v = raw as unknown;
      if (info.type === gl.SAMPLER_2D) {
        let tex: WebGLTexture | null = null;
        if (v && typeof v === "object" && "tex" in (v as object)) tex = (v as RT).tex;
        else if (v && typeof v === "object" && "kind" in (v as object)) tex = this.renderer.textureFor(v as TextureRef)?.tex ?? null;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex ?? this.dummy);
        gl.uniform1i(l, unit++);
        continue;
      }
      const arr: number[] =
        v && typeof v === "object" && "value" in (v as object)
          ? ([] as number[]).concat((v as { value: number | number[] }).value)
          : Array.isArray(v)
            ? (v as number[])
            : [typeof v === "boolean" ? (v ? 1 : 0) : Number(v ?? 0)];
      void declared;
      switch (info.type) {
        case gl.FLOAT:
          gl.uniform1fv(l, arr);
          break;
        case gl.FLOAT_VEC2:
          gl.uniform2fv(l, arr);
          break;
        case gl.FLOAT_VEC3:
          gl.uniform3fv(l, arr);
          break;
        case gl.FLOAT_VEC4:
          gl.uniform4fv(l, arr);
          break;
        case gl.FLOAT_MAT4:
          gl.uniformMatrix4fv(l, false, arr);
          break;
        case gl.INT:
        case gl.BOOL:
          gl.uniform1iv(l, arr.map((x) => Math.trunc(x) | 0));
          break;
        case gl.INT_VEC2:
          gl.uniform2iv(l, arr.map((x) => Math.trunc(x) | 0));
          break;
      }
    }
  }

  /* ---------- drawing ---------- */
  /** a full screen pass into `fbo` (w×h) */
  pass(p: Prog, fbo: WebGLFramebuffer | null, w: number, h: number, values: Record<string, UniformInput>, shaderUniforms: ShaderUniform[] = [], blend = false): void {
    const gl = this.gl;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    this.setUniforms(p, { mm_size: [w, h], ...values }, shaderUniforms);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    if (blend) gl.disable(gl.BLEND);
  }

  /** the mesh's vertex arrays, with an optional extra per vertex vec3 (a_col) */
  private meshVao(m: PaintMesh, extraKey?: string, extra?: Float32Array) {
    const key = m.id + (extraKey ?? "");
    let e = this.meshes.get(key);
    if (!e) {
      const gl = this.gl;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buffers: WebGLBuffer[] = [];
      const attr = (i: number, data: Float32Array, n: number) => {
        const b = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, n, gl.FLOAT, false, 0, 0);
        buffers.push(b);
      };
      attr(0, m.positions, 3);
      attr(1, m.normals, 3);
      attr(2, m.tangents, 4);
      attr(3, m.uvs, 2);
      if (extra) attr(4, extra, 3);
      gl.bindVertexArray(null);
      e = { vao, count: m.positions.length / 3, buffers };
      this.meshes.set(key, e);
    }
    return e;
  }

  /** draws the mesh's triangles into `fbo` */
  drawMesh(p: Prog, m: PaintMesh, fbo: WebGLFramebuffer, w: number, h: number, values: Record<string, UniformInput>, opts: { depth?: boolean; extraKey?: string; extra?: Float32Array; shaderUniforms?: ShaderUniform[] } = {}) {
    const gl = this.gl;
    const { vao, count } = this.meshVao(m, opts.extraKey, opts.extra);
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    if (opts.depth) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
    } else gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.setUniforms(p, { mm_size: [w, h], ...values }, opts.shaderUniforms);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }

  forgetMesh(m: PaintMesh) {
    for (const [k, e] of this.meshes) {
      if (k.startsWith(m.id)) {
        this.gl.deleteVertexArray(e.vao);
        for (const b of e.buffers) this.gl.deleteBuffer(b);
        this.meshes.delete(k);
      }
    }
  }

  private copyProg?: Prog;
  /** copies a texture into a target (same size), optionally multiplied by a colour */
  copy(src: WebGLTexture | null, dst: RT | Target, modulate: [number, number, number, number] = [1, 1, 1, 1]) {
    this.copyProg ??= this.program(
      Gpu.FULLSCREEN_VS,
      GLSL_HEADER + "uniform sampler2D src; uniform bool use_src; uniform vec4 modulate; out vec4 o;\nvoid main() { o = modulate * (use_src ? texelFetch(src, ivec2(gl_FragCoord.xy), 0) : vec4(1.0)); }\n",
    );
    const r = "size" in dst ? Gpu.asRT(dst) : dst;
    this.pass(this.copyProg, r.fbo, r.w, r.h, { src: src ? ({ tex: src } as RT) : null, use_src: !!src, modulate });
  }

  private presentProg?: Prog;
  /** draws a texture into a 2D canvas, row 0 at the top (straight alpha) */
  present(t: RT | Target, ctx: CanvasRenderingContext2D, opts: { opaque?: boolean; channel?: number } = {}) {
    const r = "size" in t ? Gpu.asRT(t) : t;
    const canvas = this.renderer.canvas;
    const w = ctx.canvas.width,
      h = ctx.canvas.height;
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    this.presentProg ??= this.program(
      Gpu.FULLSCREEN_VS,
      GLSL_HEADER +
        `uniform sampler2D src; uniform vec2 view; uniform bool opaque; uniform int channel; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / view; uv.y = 1.0 - uv.y;
  vec4 c = texture(src, uv);
  if (channel >= 0) c = vec4(vec3(c[channel]), 1.0);
  c = clamp(c, 0.0, 1.0);
  o = opaque ? vec4(c.rgb, 1.0) : c;
}`,
    );
    this.pass(this.presentProg, null, w, h, { src: r, view: [w, h], opaque: !!opts.opaque, channel: { type: "int", value: opts.channel ?? -1 } });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas as CanvasImageSource, 0, canvas.height - h, w, h, 0, 0, w, h);
  }

  /** reads RGBA floats (row 0 first) */
  read(t: RT | Target, x = 0, y = 0, w?: number, h?: number): Float32Array {
    const r = "size" in t ? Gpu.asRT(t) : t;
    const gl = this.gl;
    w ??= r.w;
    h ??= r.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    const out = new Float32Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  /** reads RGBA floats (row 0 first) without stalling the thread: into a pixel buffer, then copied out once a fence
   *  says the GPU is done, in bands with the event loop running in between */
  async readAsync(t: RT | Target): Promise<Float32Array> {
    const r = "size" in t ? Gpu.asRT(t) : t;
    const gl = this.gl;
    const bytes = r.w * r.h * 16;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.readPixels(0, 0, r.w, r.h, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    await gpuPause(gl)();
    const out = new Float32Array(r.w * r.h * 4);
    const band = 1 << 20; // floats per copy (4 MB)
    for (let o = 0; o < out.length; o += band) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, o * 4, out, o, Math.min(band, out.length - o));
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (o + band < out.length) await nextTask();
    }
    gl.deleteBuffer(buf);
    return out;
  }

  /** a texture from float data (row 0 first) */
  upload(w: number, h: number, data: Float32Array, f32 = true): RT {
    const t = this.target(w, h, { f32, nearest: true, clamp: true });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    return t;
  }
}

/** waits until the GPU has done what was sent so far without blocking the thread (fence polling), so a long bake
 *  leaves room for the page's frames and for other contexts */
export function gpuPause(gl: WebGL2RenderingContext): () => Promise<void> {
  return async () => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (!sync) return;
    await waitSync(gl, sync);
    gl.deleteSync(sync);
  };
}

/** polls a fence until the GPU has passed it, giving the thread back in between */
export async function waitSync(gl: WebGL2RenderingContext, sync: WebGLSync): Promise<void> {
  let wait = 0;
  for (;;) {
    const r = gl.clientWaitSync(sync, 0, 0);
    if (r === gl.ALREADY_SIGNALED || r === gl.CONDITION_SATISFIED || r === gl.WAIT_FAILED) return;
    await new Promise((res) => setTimeout(res, wait));
    wait = Math.min(16, wait + 2);
  }
}

/** yields to the event loop (between bands of a long copy) */
export const nextTask = () => new Promise<void>((res) => setTimeout(res, 0));

const gpus = new WeakMap<Renderer, Gpu>();
export function gpuFor(r: Renderer): Gpu {
  let g = gpus.get(r);
  if (!g) gpus.set(r, (g = new Gpu(r)));
  return g;
}
