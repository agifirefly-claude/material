import { getGlslDeclarationName, splitGlsl } from "./util";

export type UniformType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "sampler2D";

/** A texture a sampler uniform reads: resolved by the renderer when a shader runs. */
export interface TextureRef {
  readonly kind: "texture";
  /** stable key, used to cache renders */
  readonly key: string;
}

/** a function is read when the shader runs (an iteration counter) */
export type UniformValue = number | boolean | number[] | TextureRef | (() => number) | null;

export class ShaderUniform {
  constructor(
    public name: string,
    public type: UniformType,
    public value: UniformValue,
    /** array size, 0 when not an array */
    public size = 0,
  ) {}

  declaration(): string {
    return `uniform ${this.type === "sampler2D" ? "highp sampler2D" : this.type} ${this.name}${this.size > 0 ? `[${this.size}]` : ""};\n`;
  }
}

export interface GlobalDefs {
  code: string;
  source: string;
}

/** Port of MMGenBase.ShaderCode: the pieces of a shader one output of a generator contributes. */
export class ShaderCode {
  globals: GlobalDefs[] = [];
  uniforms: ShaderUniform[] = [];
  defs = "";
  code = "";
  outputType = "";
  outputValues: Record<string, string> = {};
  alias: ShaderCode | null = null;

  addGlobal(code: string, source: string, index = -1): void {
    if (this.globals.some((g) => g.code === code)) return;
    if (index === -1) this.globals.push({ code, source });
    else this.globals.splice(index, 0, { code, source });
  }

  addGlobals(list: GlobalDefs[]): void {
    for (const g of list) this.addGlobal(g.code, g.source);
  }

  /** The globals, keeping only declarations something refers to (by name), in dependency friendly order. */
  getGlobalsString(code = ""): string {
    let rv = "";
    const reversed = [...this.globals].reverse();
    for (const g of reversed) {
      let added = false;
      const decls = splitGlsl(g.code).reverse();
      for (const d of decls) {
        const name = getGlslDeclarationName(d);
        if (code === "" || name === "" || code.includes(name) || rv.includes(name)) {
          rv = `\n// '${name}'\n${d}\n${rv}`;
          added = true;
        }
      }
      if (added) rv = `// #globals: ${g.source}\n${rv}`;
    }
    return rv;
  }

  addUniform(name: string, type: UniformType, value: UniformValue, size = 0): void {
    if (this.uniforms.some((u) => u.name === name)) return;
    this.uniforms.push(new ShaderUniform(name, type, value, size));
  }

  addUniforms(list: ShaderUniform[]): void {
    for (const u of list) this.addUniform(u.name, u.type, u.value, u.size);
  }
}

export function defaultGeneratedShader(): ShaderCode {
  const rv = new ShaderCode();
  rv.outputType = "rgba";
  rv.outputValues.f = "0.0";
  rv.outputValues.rgb = "vec3(0.0)";
  rv.outputValues.rgba = "vec4(0.0, 0.0, 0.0, 0.0)";
  return rv;
}
