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

export function drawShader(c: DrawContext, built: BuiltShader, values: Map<string, unknown>, target: Target, blend = false): void {
  const gl = c.gl;
  if (blend) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  }
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (blend) gl.disable(gl.BLEND);
  if (target.mipmap) {
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
}

function pad(a: number[], n: number): number[] {
  if (a.length % n === 0 && a.length) return a;
  const out = [...a];
  while (out.length % n || !out.length) out.push(out.length % 4 === 3 ? 1 : 0);
  return out;
}
