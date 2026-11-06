/* Float render targets: a texture and the framebuffer that draws into it */
import type { Target } from "./types";

export function createTarget(gl: WebGL2RenderingContext, floatLinear: boolean, size: number, f32 = false, mipmap = false, height = size): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, mipmap ? Math.floor(Math.log2(Math.max(size, height))) + 1 : 1, f32 ? gl.RGBA32F : gl.RGBA16F, size, height);
  const linear = !f32 || floatLinear;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? (mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR) : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return height === size ? { tex, fbo, size, f32, mipmap } : { tex, fbo, size, f32, mipmap, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null | undefined): void {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

/** pixels of a target, row 0 first (row 0 is uv.y = 0, the top of the image) */
export function readTarget(gl: WebGL2RenderingContext, t: Target): Float32Array {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  const h = t.height ?? t.size;
  const out = new Float32Array(t.size * h * 4);
  gl.readPixels(0, 0, t.size, h, gl.RGBA, gl.FLOAT, out);
  return out;
}

export function clearTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, t.size, t.height ?? t.size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}
