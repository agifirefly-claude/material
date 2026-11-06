/* Running a built shader into a target with its uniforms set */
import type { BuiltShader } from "./shader-source";
import type { ProgramCache } from "./programs";
import type { Target } from "./types";

export interface DrawContext {
  gl: WebGL2RenderingContext;
  programs: ProgramCache;
  vao: WebGLVertexArrayObject;
  time: number;
  /** a small blank texture for samplers with nothing to read */
  blank(): Target;
}

/** big targets are drawn in tiles of this size, each a draw of its own: one long draw can trip the GPU's watchdog
 *  (which loses the context) and keeps the GPU from everything else, the page's own drawing included */
export const TILE = 512;
export const TILE_ABOVE = 1024 * 1024;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** the tiles a target is drawn in: the whole target when it is small */
export function tilesOf(target: Target, tile = TILE, above = TILE_ABOVE): Rect[] {
  const w = target.size,
    h = target.height ?? target.size;
  if (w * h <= above) return [{ x: 0, y: 0, w, h }];
  const out: Rect[] = [];
  for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) out.push({ x, y, w: Math.min(tile, w - x), h: Math.min(tile, h - y) });
  return out;
}

export function drawShader(c: DrawContext, built: BuiltShader, values: Map<string, unknown>, target: Target, blend = false): void {
  const tiles = tilesOf(target);
  prepareShader(c, built, values, target, blend);
  if (tiles.length === 1) drawTile(c.gl, null);
  else
    for (const t of tiles) {
      drawTile(c.gl, t);
      c.gl.flush();
    }
  finishShader(c.gl, target, blend);
}

/** draws the prepared shader, into a part of the target only when `r` is given */
export function drawTile(gl: WebGL2RenderingContext, r: Rect | null): void {
  if (r) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(r.x, r.y, r.w, r.h);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (r) gl.disable(gl.SCISSOR_TEST);
}

export function finishShader(gl: WebGL2RenderingContext, target: Target, blend: boolean): void {
  if (blend) gl.disable(gl.BLEND);
  if (target.mipmap) {
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}

/** binds the program, the target and the uniforms: what drawTile then draws */
export function prepareShader(c: DrawContext, built: BuiltShader, values: Map<string, unknown>, target: Target, blend = false): void {
  const gl = c.gl;
  if (blend) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  } else gl.disable(gl.BLEND);
  const { program, locations } = c.programs.get(built.source);
  gl.useProgram(program);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, target.size, target.height ?? target.size);
  const loc = (n: string) => {
    if (!locations.has(n)) locations.set(n, gl.getUniformLocation(program, n));
    return locations.get(n)!;
  };
  gl.uniform2f(loc("mm_size"), target.size, target.height ?? target.size);
  gl.uniform1f(loc("elapsed_time"), c.time);
  let unit = 0;
  for (const u of built.uniforms) {
    let v = values.get(u.name);
    if (typeof v === "function") v = (v as () => number)();
    const l = loc(u.size > 0 ? u.name + "[0]" : u.name) ?? loc(u.name);
    if (u.type === "sampler2D") {
      let t = v as Target | null;
      // a target cannot be read while it is drawn into
      if (!t || t === target) t = c.blank();
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
  gl.bindVertexArray(c.vao);
}

function pad(a: number[], n: number): number[] {
  if (a.length % n === 0 && a.length) return a;
  const out = [...a];
  while (out.length % n || !out.length) out.push(out.length % 4 === 3 ? 1 : 0);
  return out;
}
