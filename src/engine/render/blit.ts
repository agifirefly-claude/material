/* Copying textures: into targets (pictures loaded into the renderer) and onto 2D canvases (what the UI shows) */
import { linkProgram } from "./programs";
import type { Target } from "./types";

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

export class Blitter {
  private program: WebGLProgram;
  constructor(
    private gl: WebGL2RenderingContext,
    private vao: WebGLVertexArrayObject,
    private canvas: HTMLCanvasElement | OffscreenCanvas,
  ) {
    this.program = linkProgram(gl, BLIT);
  }

  private run(w: number, h: number, checker: boolean, flip: boolean) {
    const gl = this.gl;
    gl.uniform1i(gl.getUniformLocation(this.program, "t"), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, "s"), w, h);
    gl.uniform1i(gl.getUniformLocation(this.program, "mode"), checker ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "flip"), flip ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** copies a texture into a target as it is: image row 0 stays uv.y = 0 */
  blit(src: WebGLTexture, dst: Target, size: number) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, size, size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    this.run(size, size, false, false);
    if (dst.mipmap) {
      gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
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
    gl.useProgram(this.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    this.run(w, h, checker, true);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.canvas as CanvasImageSource, 0, this.canvas.height - h, w, h, 0, 0, w, h);
  }
}
