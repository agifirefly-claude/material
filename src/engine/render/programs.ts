/* Compiling generated shaders, with Material Maker's GLSL 4.50 code made to fit GLSL ES 3.00 (glsl-fix.ts) */
import { fixFromErrors } from "./glsl-fix";
import { ShaderError } from "./types";

export const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

export type Program = { program: WebGLProgram; locations: Map<string, WebGLUniformLocation | null> };

/** links a full-screen triangle program from a fragment shader, or throws a ShaderError */
export function linkProgram(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
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

/** programs by fragment source; failures are remembered too, so a broken shader is not compiled again and again */
export class ProgramCache {
  private programs = new Map<string, Program | ShaderError>();
  /** programs compiled so far */
  compiled = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    private max = 400,
  ) {}

  get(source: string): Program {
    let p = this.programs.get(source);
    if (!p) {
      let src = source;
      for (let attempt = 0; ; attempt++) {
        try {
          p = { program: linkProgram(this.gl, src), locations: new Map() };
          this.compiled++;
          break;
        } catch (e) {
          p = e instanceof ShaderError ? e : new ShaderError(String(e), src, String(e));
          // GLSL 4.50 code: retry with the int -> float conversions the errors point at
          const fixed = attempt < 16 && p instanceof ShaderError ? fixFromErrors(src, p.log) : null;
          if (!fixed) break;
          src = fixed;
        }
      }
      if (this.programs.size > this.max) this.programs.delete(this.programs.keys().next().value!);
      this.programs.set(source, p);
    }
    if (p instanceof ShaderError) throw p;
    return p;
  }
}
