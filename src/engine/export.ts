/* Port of Material Maker's material export (gen_material.gd: export_material, process_shader and the template
 * functions). An export profile is a list of files: rendered textures, and text files made from templates with
 * $if/$else/$fi, $(...) substitutions, $begin_generate ... $end_generate shader generation, $definitions,
 * $begin_buffers ... $end_buffers and $uid(n). The result here is a map of file names to contents. */
import { GenContext } from "./context";
import { evaluateExpression } from "./expression";
import { registry } from "./registry";
import { ShaderCode } from "./shader-code";
import { isColor } from "./params/types";
import { GenMaterial } from "./gen/misc";
import type { Dict } from "./gen/base";
import { splitGlsl } from "./util";

export type ExportFile = { name: string; kind: "texture"; output: number | null; expression?: { type: string; code: string } } | { name: string; kind: "text"; text: string } | { name: string; kind: "buffer"; uniform: string };

/** subst_string: replaces context keys until nothing changes, then evaluates $(expr:...) */
export function substString(s: string, ctx: Record<string, string>): string {
  for (let modified = true; modified; ) {
    modified = false;
    for (const [k, v] of Object.entries(ctx)) {
      const n = s.replaceAll(k, v);
      if (n !== s) {
        s = n;
        modified = true;
      }
    }
  }
  let from = 0;
  for (;;) {
    const search = "$(expr:";
    const pos = s.indexOf(search, from);
    if (pos === -1) break;
    from = pos + 1;
    let level = 0;
    const begin = pos + search.length;
    for (let i = begin; i < s.length; i++) {
      if (s[i] === "(") level++;
      else if (s[i] === ")") {
        if (level === 0) {
          const v = evaluateExpression(s.slice(begin, i));
          if (v !== undefined) s = s.slice(0, pos) + String(Number.isInteger(v) ? v : v) + s.slice(i + 1);
          break;
        }
        level--;
      }
    }
  }
  return s;
}

export function getTemplateText(template: string): string {
  return registry.templates[template] ?? template;
}

export function connectionsAndParametersContext(m: GenMaterial): Record<string, string> {
  const ctx: Record<string, string> = {};
  (m.shaderModel.inputs ?? []).forEach((input: Dict, i: number) => (ctx[`$(connected:${input.name})`] = m.getSource(i) ? "true" : "false"));
  for (const p of m.shaderModel.parameters ?? []) {
    const value = p.name in m.parameters ? m.parameters[p.name] : p.default;
    switch (p.type) {
      case "float":
      case "size":
        ctx[`$(param:${p.name})`] = String(value);
        break;
      case "boolean":
        ctx[`$(param:${p.name})`] = String(!!value);
        break;
      case "color":
        if (isColor(value)) for (const c of ["r", "g", "b", "a"] as const) ctx[`$(param:${p.name}.${c})`] = String(value[c]);
        break;
    }
  }
  return ctx;
}

function condition(expr: string, ctx: Record<string, string>): boolean {
  const v = evaluateExpression(substString(expr, ctx));
  return !!v;
}

export function processConditionals(template: string, ctx: Record<string, string>): string {
  let out = "";
  const skip: boolean[] = [false];
  for (const l of template.split("\n")) {
    if (l === "") continue;
    if (l.startsWith("$if ")) skip.push(!condition(l.slice(4), ctx));
    else if (l.startsWith("$fi")) skip.pop();
    else if (l.startsWith("$else")) skip.push(!skip.pop());
    else if (!skip[skip.length - 1] && !skip.includes(true)) out += l + "\n";
  }
  return out;
}

export function processTemplate(template: string, ctx: Record<string, string>): string {
  return template
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => substString(l, ctx) + "\n")
    .join("");
}

function processBuffers(template: string, bufferCount: number): string {
  let out = "",
    gen = "",
    generating = false;
  for (const l of template.split("\n")) {
    if (generating) {
      if (l === "$end_buffers") {
        for (let i = 1; i <= bufferCount; i++) out += substString(gen, { "$(buffer_index)": String(i) });
        generating = false;
      } else gen += l + "\n";
    } else if (l === "$begin_buffers") {
      generating = true;
      gen = "";
    } else out += l + "\n";
  }
  return out;
}

function processUids(template: string, uids: Map<number, string>): string {
  return template.replace(/\$uid\((\w+)\)/g, (_m, n: string) => {
    const i = parseInt(n);
    if (!uids.has(i)) {
      const r = crypto.getRandomValues(new Uint8Array(16));
      r[6] = (r[6] & 0x0f) | 0x40;
      r[8] = (r[8] & 0x3f) | 0x80;
      uids.set(i, [...r].map((b) => b.toString(16).padStart(2, "0")).join(""));
    }
    return uids.get(i)!;
  });
}

/* ---------- process_shader and its options ---------- */
function hlslBase(s: string, isDeclaration: boolean): string {
  const reps: [string, string][] = [
    ["ivec2(", "toint2("],
    ["ivec3(", "toint3("],
    ["ivec4(", "toint4("],
    ["vec2(", "tofloat2("],
    ["vec3(", "tofloat3("],
    ["vec4(", "tofloat4("],
    ["ivec2", "int2"],
    ["ivec3", "int3"],
    ["ivec4", "int4"],
    ["vec2", "float2"],
    ["vec3", "float3"],
    ["vec4", "float4"],
    ["mat2(", "tofloat2x2("],
    ["mat2", "float2x2"],
    ["mix", "lerp"],
    ["fract", "frac"],
    ["atan", "hlsl_atan"],
  ];
  for (const [a, b] of reps) s = s.replaceAll(a, b);
  for (;;) {
    const m = /(\w+)\s*\*=\s*tofloat2x2([^;]+);/.exec(s);
    if (!m) break;
    s = s.replace(m[0], `${m[1]} = mul(${m[1]}, tofloat2x2${m[2]});`);
  }
  for (;;) {
    const m = /(?:int|float)[234]?\[\d*\]\((.*)\);/.exec(s);
    if (!m) break;
    s = s.replace(m[0], `{ ${m[1]} };`);
  }
  if (isDeclaration) s = getTemplateText("hlsl_defs.tmpl") + "\n\n// EngineSpecificDefinitions\n\n\n" + s;
  return s;
}
function unreal5Decls(s: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const re = /(?:uniform|const)\s+([\w_]+)\s+([\w_]+)((?:\[\d+\])?)\s*=\s*([^;]+);/g;
  for (let d of splitGlsl(s)) {
    d = hlslBase(d, false);
    for (const m of d.matchAll(re)) out.push(m as unknown as RegExpExecArray);
  }
  return out.sort((a, b) => b[2].length - a[2].length);
}
const OPTIONS: Record<string, (s: string, isDecl: boolean, defs: string, bufferNames: string[]) => string> = {
  hlsl_base: (s, d) => hlslBase(s, d),
  hlsl: (s, d) => hlslBase(s, d).replaceAll("uniform float", "static const float").replaceAll("uniform vec4", "static const vec4").replaceAll("uniform int", "static const int"),
  float_uniform_to_const: (s) => s.replaceAll("uniform float", "const float").replaceAll("uniform vec4", "const vec4").replaceAll("uniform int", "const int"),
  rename_buffers: (s, _d, _defs, buffers) => {
    buffers.forEach((t, i) => (s = s.replaceAll(t, `texture_${i + 1}`)));
    return s;
  },
  unity: (s) => s.replaceAll("elapsed_time", "_Time.y"),
  unreal: (s, d) => {
    s = s.replaceAll("elapsed_time", "Time").replaceAll("uniform sampler2D", "// uniform sampler2D ");
    if (d) s = s.replace("// EngineSpecificDefinitions", "#define textureLod(t, uv, lod) t.SampleLevel(t##Sampler, uv, lod)");
    return s;
  },
  unreal5: (s, d, defs) => {
    s = s.replaceAll("elapsed_time", "Time").replaceAll("uniform sampler2D", "// uniform sampler2D ");
    if (d) {
      s = s.replace("// EngineSpecificDefinitions", "#define textureLod(t, uv, lod) t.SampleLevel(t##Sampler, uv, lod)");
      for (const m of unreal5Decls(s)) s = s.replace(m[0], `${m[1]} ${m[2]}${m[3]};`);
    } else {
      let init = "";
      for (const m of unreal5Decls(defs)) {
        if (m[3] === "") init += `${m[2]} = ${m[4]};\n`;
        else {
          const n = parseInt(m[3].slice(1, -1));
          const values = m[4].replace(/[{}]/g, "").trim().split(",");
          for (let i = 0; i < n; i++) {
            let v = "";
            while (values.length) {
              if (v !== "") v += ",";
              v += values.shift();
              if ((v.match(/\(/g) ?? []).length === (v.match(/\)/g) ?? []).length) break;
            }
            init += `${m[2]}[${i}] = ${v.trim()};\n`;
          }
        }
      }
      s = init + s;
    }
    return s.replaceAll("sampler2D", "sampler");
  },
};
function applyOptions(s: string, options: string[], defs: string, isDecl: boolean, buffers: string[]): string {
  for (const o of options) {
    const f = OPTIONS[o];
    if (f) s = f(s, isDecl, defs, buffers);
    else console.warn(`No implementation of export option '${o}'`);
  }
  return s;
}

/** process_shader: expands $begin_generate blocks and $definitions in a template with the material's generated code */
export function processShader(m: GenMaterial, text: string, forceUniformsInit = false): { code: string; buffers: string[]; shaderCode: ShaderCode } {
  const rv = new ShaderCode();
  const context = new GenContext();
  const variables = m.getCommonReplaceVariables("UV", rv);
  m.processParameters(rv, variables, true);
  m.processInputs(rv, variables, context, true);
  let code = "";
  let generating = false,
    buf = "",
    options: string[] = [];
  const pending: { at: number; gen: string; options: string[] }[] = [];
  for (const l of text.split("\n")) {
    if (generating) {
      if (l === "$end_generate") {
        const subst = m.replaceVariables(buf, variables, rv, context);
        // as in Material Maker, rv.code keeps growing: a block repeats the code of the blocks before it
        pending.push({ at: code.length, gen: rv.code + "\n" + subst + "\n", options });
        generating = false;
      } else buf += l + "\n";
    } else if (l.includes("$begin_generate")) {
      generating = true;
      buf = "";
      options = l.replaceAll(" ", "").replace("$begin_generate", "").split(",").filter(Boolean);
    } else code += l + "\n";
  }
  const buffers = rv.uniforms.filter((u) => u.type === "sampler2D").map((u) => u.name);
  const definitionsOf = () => {
    let d = rv.uniformsAsStrings("uniform", forceUniformsInit);
    for (const g of rv.globals) d += `// #globals: ${g.source}\n${g.code}\n`;
    return d + rv.defs + "\n";
  };
  // generated blocks see the definitions of everything generated so far, as in Material Maker
  let offset = 0;
  for (const p of pending) {
    const g = applyOptions(p.gen, p.options, definitionsOf(), false, buffers);
    code = code.slice(0, p.at + offset) + g + code.slice(p.at + offset);
    offset += g.length;
  }
  const definitions = getTemplateText("glsl_defs.tmpl") + "\n" + definitionsOf();
  let out = "";
  for (const l of code.split("\n")) {
    if (l.includes("$definitions")) {
      const opts = l.replaceAll(" ", "").replace("$definitions", "").split(",").filter(Boolean);
      for (const dl of applyOptions(definitions, opts, definitions, true, buffers).split("\n")) if (dl.replaceAll(" ", "") !== "") out += dl + "\n";
    } else out += l + "\n";
  }
  return { code: out, buffers, shaderCode: rv };
}

export function exportProfiles(m: GenMaterial): string[] {
  return Object.keys(m.shaderModel.exports ?? {}).sort();
}

/** The files an export profile writes, for a prefix such as "bricks" (export_material) */
export function planExport(m: GenMaterial, profile: string, prefix: string): ExportFile[] {
  const exp = m.shaderModel.exports?.[profile];
  if (!exp) throw new Error(`No export profile ${profile}`);
  const ctx: Record<string, string> = {
    ...connectionsAndParametersContext(m),
    "$(path_prefix)": prefix,
    "$(file_prefix)": prefix.split("/").pop()!,
    "$(dir_prefix)": prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "",
    "$(material_maker_path)": "",
    "$(path_separator)": "/",
  };
  const uids = new Map<number, string>();
  // the buffers the material's generated code samples (preview_texture_dependencies)
  const previewShader = processConditionals(String(m.shaderModel.preview_shader ?? ""), connectionsAndParametersContext(m));
  const buffers = previewShader.includes("$begin_generate") ? processShader(m, previewShader).buffers : [];
  const files: ExportFile[] = [];
  const makeText = (template: string, fileCtx: Record<string, string>) => {
    let t = processUids(processBuffers(processConditionals(processTemplate(getTemplateText(template), fileCtx), fileCtx), buffers.length), uids);
    t = processShader(m, t, true).code;
    return t;
  };
  for (const f of exp.files ?? []) {
    if (f.conditions && !condition(f.conditions, ctx)) continue;
    const fileName = substString(f.file_name, ctx);
    switch (f.type) {
      case "texture": {
        if (typeof f.output === "number") files.push({ name: fileName, kind: "texture", output: f.output });
        else if (f.expression) {
          let type = "rgba";
          let code: string = f.expression;
          const eq = code.indexOf("=");
          if (eq !== -1 && ["f", "rgb", "rgba"].includes(code.slice(0, eq).trim())) {
            type = code.slice(0, eq).trim();
            code = code.slice(eq + 1);
          }
          files.push({ name: fileName, kind: "texture", output: null, expression: { type, code } });
        }
        break;
      }
      case "template": {
        const fctx = { ...ctx };
        for (const [k, v] of Object.entries(f.file_params ?? {})) fctx[`$(file_param:${k})`] = String(v);
        files.push({ name: fileName, kind: "text", text: makeText(f.template, fctx) });
        break;
      }
      case "buffers":
        buffers.forEach((b, i) => files.push({ name: fileName.replaceAll("$(buffer_index)", String(i + 1)), kind: "buffer", uniform: b }));
        break;
      case "buffer_templates":
        buffers.forEach((_b, i) => {
          const fctx: Record<string, string> = { ...ctx, "$(buffer_index)": String(i + 1) };
          for (const [k, v] of Object.entries(f.file_params ?? {})) fctx[`$(file_param:${k})`] = String(v);
          files.push({ name: fileName.replaceAll("$(buffer_index)", String(i + 1)), kind: "text", text: makeText(f.template, fctx) });
        });
        break;
    }
  }
  return files;
}

/** the ShaderCode of an export expression texture (export_output_def) */
export function expressionShaderCode(m: GenMaterial, e: { type: string; code: string }): ShaderCode {
  const saved = m.pre.outputs;
  const index = (saved?.length ?? 0) + 1000;
  try {
    m.pre.outputs = [...(saved ?? [])];
    m.pre.outputs[index] = { [e.type]: e.code, type: e.type };
    return m.getShaderCode("uv", index, new GenContext());
  } finally {
    m.pre.outputs = saved;
  }
}
