/* Turns a generator's ShaderCode into a complete GLSL ES 3.00 fragment shader.
 * Material Maker builds a Vulkan compute shader from the same pieces (engine/nodes/buffer_compute.tres); this is the
 * WebGL2 equivalent: one fragment per texel, uv = pixel centre / size. */
import { registry } from "../registry";
import { ShaderCode, type ShaderUniform } from "../shader-code";
import { removeConstantDeclarations } from "../util";
import { fixGlsl } from "./glsl-fix";

export interface BuiltShader {
  source: string;
  uniforms: ShaderUniform[];
  /** what the user's code amounts to, without the common header (for the code viewer) */
  body: string;
}

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** rgba output of a ShaderCode, through the port type's 2D preview when it is not plain colour (render_output_to_texture) */
export function withPreview(src: ShaderCode, previewSize = 64): ShaderCode {
  const sc = Object.assign(new ShaderCode(), src);
  sc.outputValues = { ...src.outputValues };
  if (sc.outputType === "f" || sc.outputType === "rgb" || sc.outputType === "rgba") {
    if (!sc.outputValues.rgba) sc.outputValues.rgba = `vec4(vec3(${sc.outputValues.f ?? "0.0"}), 1.0)`;
    return sc;
  }
  const t = registry.ioTypes[sc.outputType];
  if (!t?.preview) return sc;
  let p = t.preview;
  p = p.replaceAll("uniform", "const");
  p = p.replaceAll("const sampler2D", "uniform sampler2D");
  p = p.replaceAll("preview_size", previewSize.toFixed(1)).replaceAll("(256)", "(256.0)");
  p = p.replaceAll("$(code)", sc.code);
  p = p.replaceAll("$(value)", sc.outputValues[sc.outputType]);
  sc.defs += p;
  sc.code = "";
  sc.outputValues = { rgba: "preview_2d(uv)" };
  sc.outputType = "rgba";
  return sc;
}

export function buildFragmentShader(sc: ShaderCode, output = sc.outputValues.rgba ?? "vec4(0.0)"): BuiltShader {
  const all = sc.defs + sc.code + output;
  const globals = sc.getGlobalsString(all);
  const used = globals + all;
  const uniforms = sc.uniforms.filter((u) => used.includes(u.name));
  let body = "";
  body += "const float seed_variation = 0.0;\n";
  body += globals + "\n";
  body += sc.defs + "\n";
  body += "out vec4 mm_frag;\n";
  body += "void main() {\n";
  body += "\tfloat _seed_variation_ = seed_variation;\n";
  body += "\tvec4 _controlled_variation_ = vec4(0.0);\n";
  body += "\tvec2 uv = gl_FragCoord.xy / mm_size;\n";
  body += sc.code + "\n";
  body += `\tmm_frag = ${output};\n`;
  body += "}\n";
  body = removeConstantDeclarations(body);
  let source = HEADER;
  source += "uniform float elapsed_time;\nuniform vec2 mm_size;\n";
  for (const u of uniforms) source += u.declaration();
  source += "const float PI = 3.14159265359;\nconst float TAU = 6.28318530718;\n";
  source += registry.shaderFunctions + "\n";
  source += body;
  return { source: fixGlsl(source), uniforms, body };
}
