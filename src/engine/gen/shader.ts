/* Port of MMGenShader (addons/material_maker/engine/nodes/gen_shader.gd): a node defined by a shader model,
 * which is what nearly every library node is. */
import { GenContext } from "../context";
import { getPredefinedGlobal, registry } from "../registry";
import { ShaderCode } from "../shader-code";
import { Curve, Gradient, Lattice, Pixels, Polygon, Splines, isColor, type ParamValue } from "../params/types";
import { f6, findMatchingParenthesis, isValidIdentifierChar, lstrip, splitParameters, WORD_LETTERS } from "../util";
import { Gen, type Dict, type ParameterDef, type PortDef } from "./base";

type ReplaceCallable = (variable: string, suffix: string, parameters: string, variables: Variables, rv: ShaderCode, context: GenContext) => string;
type VariableValue = string | { hasParameters: boolean; hasSuffix: boolean; replace: ReplaceCallable };
export type Variables = Record<string, VariableValue>;

const colorVec = (c: unknown): number[] => (isColor(c) ? [c.r, c.g, c.b, c.a] : typeof c === "number" ? [c, c, c, 1] : [0, 0, 0, 1]);

export class GenShader extends Gen {
  shaderModel: Dict = {};
  pre: Dict = {};
  modelUsesSeed = false;
  paramsUseSeed = false;
  genericSize = 1;
  editable = false;

  override toggleEditable() {
    this.editable = !this.editable;
    if (this.editable) this.model = null;
    return true;
  }
  override isEditable() {
    return this.editable;
  }
  override hasRandomness() {
    return this.modelUsesSeed || this.paramsUseSeed;
  }
  override getDescription() {
    return [this.shaderModel.shortdesc, this.shaderModel.longdesc].filter(Boolean).join("\n");
  }
  override getType() {
    return "shader";
  }
  override getTypeName() {
    return this.shaderModel.name ?? "Unnamed";
  }
  override getParameterDefs(): ParameterDef[] {
    return this.pre?.parameters ?? [];
  }
  override getInputDefs(): PortDef[] {
    return this.pre?.inputs ?? [];
  }
  override getOutputDefs(): PortDef[] {
    return this.pre?.outputs ?? [];
  }
  getPreprocessedOutputDef(i: number): Dict {
    return this.pre?.outputs?.[i] ?? {};
  }

  override setParameter(n: string, v: ParamValue): void {
    const usesRnd = (x: unknown) => typeof x === "string" && (x.includes("$rnd(") || x.includes("$rndi("));
    this.parameters[n] = v;
    this.paramsUseSeed = Object.values(this.parameters).some(usesRnd);
    this.changed();
  }

  /* ---------- shader model preprocessing ---------- */

  /** adds the variation parameters to the functions an instance section defines */
  static findInstanceFunctions(code: string): { code: string; functions: string[] } {
    const functions: string[] = [];
    const re = /(\w+)\s+(\w*\$(?:\(name\)\w*|name))\s*\((.*)\)\s*{/g;
    for (const m of [...code.matchAll(re)]) {
      if (m[1] === "return") continue;
      functions.push(m[2]);
      code = code.replace(m[0], `${m[1]} ${m[2]}(${m[3]}, float _seed_variation_, vec4 _controlled_variation_) {`);
    }
    return { code, functions };
  }

  static fixInstanceFunctions(code: string, functions: string[]): string {
    const variation = ", _seed_variation_, _controlled_variation_";
    for (const f of functions) {
      let location = 0;
      const lowerF = f.toLowerCase();
      for (;;) {
        location = code.toLowerCase().indexOf(lowerF, location);
        if (location === -1) break;
        if (location > 0 && isValidIdentifierChar(code[location - 1])) {
          location += f.length;
          continue;
        }
        let p = location + f.length;
        for (;;) {
          const c = code[p];
          if (c === "(") {
            p = findMatchingParenthesis(code, p);
            if (p === -1) {
              p = code.length;
              break;
            }
            let replace = true;
            let p2 = p;
            while (p2 < code.length - 1) {
              p2++;
              const c2 = code[p2];
              if (c2 === " " || c2 === "\t" || c2 === "\n" || c2 === "\r") continue;
              if (c2 === "{") replace = false;
              break;
            }
            if (replace) code = code.slice(0, p) + variation + code.slice(p);
            break;
          } else if (c === " " || c === "\t" || c === "\r" || c === "\n") p++;
          else break;
        }
        location = p;
      }
    }
    return code;
  }

  static preprocessShaderModel(data: Dict): Dict {
    const pre: Dict = {};
    if (data.instance) {
      const inst = GenShader.findInstanceFunctions(data.instance);
      const fix = (s: string) => GenShader.fixInstanceFunctions(s, inst.functions);
      pre.instance = fix(inst.code);
      if (data.code !== undefined) pre.code = fix(data.code);
      if (data.parameters) {
        pre.parameters = data.parameters.map((p: Dict) => {
          if (p.type !== "enum") return p;
          let changed = false;
          const values = p.values.map((v: Dict) => {
            const nv = fix(v.value);
            if (nv !== v.value) changed = true;
            return { name: v.name, value: nv };
          });
          return changed ? { ...structuredClone(p), values } : p;
        });
      }
      if (data.outputs) {
        pre.outputs = data.outputs.map((o: Dict) => {
          o = structuredClone(o);
          if (o.type && o.type in o) o[o.type] = fix(o[o.type]);
          else
            for (const f of Object.keys(registry.ioTypes)) {
              if (f in o) {
                o[f] = fix(o[f]);
                o.type = f;
              }
            }
          return o;
        });
      }
    } else {
      if (data.parameters) pre.parameters = data.parameters;
      if (data.code !== undefined) pre.code = data.code;
      if (data.outputs) pre.outputs = data.outputs;
    }
    if (data.inputs) pre.inputs = data.inputs;
    if (data.includes) pre.includes = data.includes;
    if (data.global !== undefined) pre.global = data.global;
    return pre;
  }

  /* ---------- generic ports (#) ---------- */
  isGeneric(): boolean {
    return (this.shaderModel.parameters ?? []).some((p: Dict) => p.name.includes("#")) || (this.shaderModel.inputs ?? []).some((i: Dict) => i.name.includes("#"));
  }
  setGenericSize(size: number): void {
    if (this.genericSize === size || !this.isGeneric()) return;
    this.genericSize = size;
    this.setShaderModel(this.shaderModel);
  }
  expandGenericCode(code: string, first = 1): string {
    let rv = "";
    code = code.replaceAll("#count", String(this.genericSize));
    while (code !== "") {
      const fp = code.indexOf("#for");
      if (fp === -1) {
        rv += code;
        break;
      }
      rv += code.slice(0, fp);
      code = code.slice(fp + 4);
      const ep = code.indexOf("#end");
      let gcode: string;
      if (ep === -1) {
        gcode = code;
        code = "";
      } else {
        gcode = code.slice(0, ep);
        code = code.slice(ep + 4);
      }
      for (let gi = 0; gi < this.genericSize; gi++) rv += gcode.replaceAll("#", String(gi + first));
    }
    return rv;
  }
  static getGenericRange(array: Dict[], field: string, indirect = false): { first: number; last: number } {
    const rv = { first: -1, last: -1 };
    for (let i = 0; i < array.length; i++) {
      const p = array[i];
      const s: string = (indirect ? p[p[field]] : p[field]) ?? "";
      if (s.includes("#")) {
        if (rv.first === -1) rv.first = i;
        else if (rv.last !== -1) return { first: -1, last: -1 };
      } else if (rv.first !== -1 && rv.last === -1) rv.last = i;
    }
    if (rv.first !== -1 && rv.last === -1) rv.last = array.length;
    return rv;
  }
  expandGeneric(): void {
    const sm = this.shaderModel;
    const inputs: Dict[] = sm.inputs ?? [];
    const params: Dict[] = sm.parameters ?? [];
    const gi = GenShader.getGenericRange(inputs, "name");
    const gp = GenShader.getGenericRange(params, "name");
    const go = GenShader.getGenericRange(this.pre.outputs ?? [], "type", true);
    const n = this.genericSize;
    const rep = (s: string | undefined, v: number) => (s === undefined ? s : s.replaceAll("#", String(v)));
    if (gi.first !== -1) {
      const out: Dict[] = inputs.slice(0, gi.first);
      for (let g = 0; g < n; g++) {
        for (let i = gi.first; i < gi.last; i++) {
          const input = { ...inputs[i] };
          input.name = rep(input.name, g + 1);
          for (const k of ["label", "shortdesc", "longdesc"]) if (input[k] !== undefined) input[k] = rep(input[k], g + 1);
          out.push(input);
        }
      }
      out.push(...inputs.slice(gi.last));
      this.pre.inputs = out;
    }
    const ranges: { begin: number; end: number; generic: boolean }[] = [];
    if (gp.first !== -1) {
      if (gp.first > 0) ranges.push({ begin: 0, end: gp.first, generic: false });
      ranges.push({ begin: gp.first, end: gp.last, generic: true });
      if (gp.last < params.length) ranges.push({ begin: gp.last, end: params.length, generic: false });
    } else ranges.push({ begin: 0, end: params.length, generic: false });
    const outParams: Dict[] = [];
    const labelPos = (label: string | undefined) => {
      if (!label) return null;
      const c = label.indexOf(":");
      if (c === -1) return null;
      const num = label.slice(0, c);
      return /^-?\d+$/.test(num) ? { pos: parseInt(num), rest: label.slice(c) } : null;
    };
    for (const r of ranges) {
      if (r.generic) {
        for (let g = 0; g < n; g++) {
          for (let i = r.begin; i < r.end; i++) {
            const p = { ...params[i] };
            p.name = rep(p.name, g + 1);
            for (const k of ["shortdesc", "longdesc"]) if (p[k] !== undefined) p[k] = rep(p[k], g + 1);
            const lp = labelPos(p.label);
            if (lp && lp.pos > gi.first && lp.pos <= gi.last) p.label = String(lp.pos + g * (gi.last - gi.first)) + lp.rest;
            outParams.push(p);
          }
        }
      } else {
        for (let i = r.begin; i < r.end; i++) {
          let p = params[i];
          const lp = labelPos(p.label);
          if (lp && gi.first !== -1 && lp.pos >= gi.last) {
            p = { ...p, label: String(lp.pos + (n - 1) * (gi.last - gi.first)) + lp.rest };
          }
          outParams.push(p);
        }
      }
    }
    this.pre.parameters = outParams;
    if (go.first !== -1) {
      const outs: Dict[] = this.pre.outputs.slice(0, go.first);
      for (let g = 0; g < n; g++) {
        for (let i = go.first; i < go.last; i++) {
          const o = { ...this.pre.outputs[i] };
          o[o.type] = rep(o[o.type], g + 1);
          for (const k of ["shortdesc", "longdesc"]) if (o[k] !== undefined) o[k] = rep(o[k], g + 1);
          outs.push(o);
        }
      }
      outs.push(...this.pre.outputs.slice(go.last));
      this.pre.outputs = outs;
    }
    for (const f of ["code", "instance"]) if (this.pre[f] !== undefined) this.pre[f] = this.expandGenericCode(this.pre[f], 1);
  }

  setShaderModel(data: Dict): void {
    this.shaderModel = data;
    this.pre = GenShader.preprocessShaderModel(data);
    if (this.isGeneric()) this.expandGeneric();
    this.initParameters();
    this.modelUsesSeed = false;
    for (const output of data.outputs ?? []) {
      let code = "";
      for (const f of Object.keys(registry.ioTypes)) {
        if (f in output) {
          output.type = f;
          code = output[f];
          break;
        }
      }
      if (code.includes("$seed") || code.includes("$(seed)")) this.modelUsesSeed = true;
    }
    for (const f of ["code", "instance"]) if (typeof data[f] === "string" && (data[f].includes("$seed") || data[f].includes("$(seed)"))) this.modelUsesSeed = true;
    (this.parent as unknown as { checkInputConnects?: (g: Gen) => void })?.checkInputConnects?.(this);
    this.changed();
  }

  /* ---------- shader generation ---------- */
  static findKeywordCall(s: string, keyword: string): string {
    const search = `$${keyword}(`;
    const pos = s.indexOf(search);
    if (pos === -1) return "";
    const begin = pos + search.length;
    const end = findMatchingParenthesis(s, begin - 1);
    if (end > 0) return s.slice(begin, end);
    return "#error";
  }

  static replaceRnd(s: string, offset = 0): string {
    for (;;) {
      const params = GenShader.findKeywordCall(s, "rnd");
      if (params === "" || params === "#error") break;
      const replace = `$rnd(${params})`;
      for (;;) {
        const position = s.indexOf(replace);
        if (position === -1) break;
        s = s.replaceAll(replace, `param_rnd(${params}, $seed+${f6(Math.sin(position + offset) * 0.5 + 0.5)})`);
      }
    }
    return s;
  }
  static replaceRndi(s: string, offset = 0): string {
    for (;;) {
      const params = GenShader.findKeywordCall(s, "rndi");
      if (params === "" || params === "#error") break;
      const replace = `$rndi(${params})`;
      for (;;) {
        const position = s.indexOf(replace);
        if (position === -1) break;
        s = s.replaceAll(replace, `param_rndi(${params}, $seed+${f6(Math.sin(position) + offset)})`);
      }
    }
    return s;
  }

  generateInputFunction(index: number, input: Dict, rv: ShaderCode, context: GenContext): void {
    const source = this.getSource(index);
    if (!source) return;
    const t = registry.ioTypes[input.type];
    const local = new GenContext(context);
    const src = source.generator.getShaderCode(t.params, source.outputIndex, local);
    rv.addUniforms(src.uniforms);
    rv.defs += src.defs;
    rv.addGlobals(src.globals);
    rv.defs += `${t.type} ${this.genName}_input_${input.name}(${t.paramdefs}, float _seed_variation_, vec4 _controlled_variation_) {\n`;
    rv.defs += `${src.code}\n`;
    rv.defs += `return ${src.outputValues[input.type] ?? defaultValueFor(input.type)};\n}\n`;
  }

  processParameters(rv: ShaderCode, variables: Variables, declare: boolean): void {
    const g = this.genName;
    let rndOffset = 0;
    if (this.hasRandomness()) {
      if (declare) rv.addUniform(`seed_${g}`, "float", this.getSeed());
      variables.seed = `(seed_${g}+fract(_seed_variation_))`;
    }
    for (const p of this.pre.parameters ?? []) {
      const value = this.parameters[p.name];
      switch (p.type) {
        case "float":
          if (typeof value === "number") {
            if (declare) rv.addUniform(`p_${g}_${p.name}`, "float", value);
            variables[p.name] = `p_${g}_${p.name}`;
          } else {
            let s = String(value ?? 0);
            s = GenShader.replaceRnd(s, rndOffset);
            s = GenShader.replaceRndi(s, rndOffset);
            variables[p.name] = `(${s})`;
          }
          rndOffset += 17;
          break;
        case "color":
          if (declare) rv.addUniform(`p_${g}_${p.name}`, "vec4", colorVec(value));
          variables[p.name] = `p_${g}_${p.name}`;
          break;
        case "enum": {
          variables[p.name] = "";
          if (p.values?.length) {
            let v = value;
            if (typeof v !== "number" || v < 0 || v >= p.values.length) v = 0;
            variables[p.name] = p.values[Math.floor(v)].value;
          }
          break;
        }
        case "boolean":
          variables[p.name] = value ? "true" : "false";
          break;
        case "size":
          variables[p.name] = Math.pow(2, Number(value)).toFixed(1);
          break;
        case "gradient": {
          const gr = value instanceof Gradient ? value : Gradient.deserialize(value);
          if (declare) {
            rv.addUniforms(gr.getParameters(`${g}_${p.name}`));
            rv.defs += gr.getShader(`${g}_${p.name}`);
          }
          variables[p.name] = `${g}_${p.name}_gradient_fct`;
          break;
        }
        case "curve": {
          const c = value instanceof Curve ? value : Curve.deserialize(value);
          if (declare) {
            for (const [k, v] of Object.entries(c.getShaderParams(`${g}_${p.name}`))) rv.addUniform(k, "float", v);
            rv.defs += c.getShader(`${g}_${p.name}`);
          }
          variables[p.name] = `${g}_${p.name}_curve_fct`;
          break;
        }
        case "polygon":
        case "polyline": {
          const v = value instanceof Polygon ? value : Polygon.deserialize(value);
          if (declare) rv.addUniforms(v.getParameters(`${g}_${p.name}`));
          variables[p.name] = v.getShader(`${g}_${p.name}`);
          break;
        }
        case "splines": {
          const v = value instanceof Splines ? value : Splines.deserialize(value);
          if (declare) rv.addUniforms(v.getParameters(`${g}_${p.name}`));
          variables[p.name] = v.getShader(`${g}_${p.name}`);
          break;
        }
        case "pixels": {
          const v = value instanceof Pixels ? value : Pixels.deserialize(value);
          if (declare) {
            rv.addUniforms(v.getParameters(`${g}_${p.name}`));
            rv.defs += v.getShader(`${g}_${p.name}`);
          }
          variables[p.name] = `${g}_${p.name}_pixels_fct`;
          variables[p.name + "_size"] = `${g}_${p.name}_size`;
          break;
        }
        case "lattice": {
          const v = value instanceof Lattice ? value : Lattice.deserialize(value);
          if (declare) rv.addUniforms(v.getParameters(`${g}_${p.name}`));
          variables[p.name] = v.getShader(`${g}_${p.name}`);
          variables[p.name + "_size"] = `ivec2(${v.size.x}, ${v.size.y})`;
          break;
        }
        case "string":
        case "file":
        case "image_path":
          variables[p.name] = String(value ?? "");
          break;
        default:
          console.warn(`Unsupported parameter ${p.name} of type ${p.type}`);
      }
    }
  }

  replaceInput(index: number): ReplaceCallable {
    return (inputName, suffix, parameters, variables, rv, context) => {
      const inputDef = this.pre.inputs[index];
      const source = this.getSource(index);
      if (!source) {
        const oldUv = variables.uv;
        variables.uv = parameters;
        let def = String(inputDef.default ?? defaultValueFor(inputDef.type));
        // a bare number for a vector input (Material Maker files have some) is that number in every component
        const vt = registry.ioTypes[inputDef.type]?.type;
        if (/^\s*-?\d+(\.\d*)?\s*$/.test(def) && vt && vt !== "float") def = `${vt}(${def.includes(".") ? def.trim() : def.trim() + ".0"})`;
        const replaced = this.replaceVariables(def, variables, rv, context);
        variables.uv = oldUv;
        return replaced;
      }
      if (suffix) {
        const attributes = source.generator.getOutputAttributes(source.outputIndex);
        const attributeName = suffix === "size" ? "texture_size" : suffix;
        if (attributes && attributeName in attributes) return attributes[attributeName];
        if (suffix === "texture" || suffix === "size") return `(error: Cannot find attribute ${suffix} for input ${inputName})`;
      }
      if (inputDef.function) {
        const fn = `${this.genName}_input_${inputDef.name}`;
        if (suffix === "variation") {
          const list = splitParameters(parameters);
          let tail = ")";
          if (list.length === 1) tail = ", _seed_variation_, _controlled_variation_)";
          else if (list.length === 2) tail = ", _controlled_variation_)";
          return fn + "(" + list.join(", ") + tail;
        }
        return `${fn}(${parameters}, _seed_variation_, _controlled_variation_)`;
      }
      const src = source.generator.getShaderCode(parameters, source.outputIndex, context);
      rv.addUniforms(src.uniforms);
      rv.defs += src.defs;
      rv.addGlobals(src.globals);
      rv.code += src.code;
      rv.alias = src;
      return src.outputValues[inputDef.type] ?? defaultValueFor(inputDef.type);
    };
  }

  processInputs(rv: ShaderCode, variables: Variables, context: GenContext, declare: boolean): void {
    const inputs: Dict[] = this.pre.inputs ?? [];
    inputs.forEach((input, i) => {
      if (declare && input.function) this.generateInputFunction(i, input, rv, context);
      variables[input.name] = { hasParameters: true, hasSuffix: true, replace: this.replaceInput(i) };
    });
  }

  /** Port of replace_variables: substitutes $name, $(name), $input(uv), $input.suffix(...) from the end of the string. */
  replaceVariables(s: string, variables: Variables, rv: ShaderCode, context: GenContext): string {
    let end = "";
    for (;;) {
      const dollar = s.lastIndexOf("$");
      if (dollar === -1) break;
      let variableEnd: number;
      let variable: string;
      if (s[dollar + 1] === "(") {
        const close = findMatchingParenthesis(s, dollar + 1);
        variableEnd = (close === -1 ? s.length - 1 : close) + 1;
        variable = s.substring(dollar + 2, variableEnd - 1);
      } else {
        const rest = s.slice(dollar + 1);
        variableEnd = s.length - lstrip(rest, WORD_LETTERS).length;
        variable = s.substring(dollar + 1, variableEnd);
      }
      end = s.slice(variableEnd) + end;
      s = s.slice(0, dollar);
      const replaceWith = variables[variable];
      if (replaceWith === undefined) s += `(error: ${variable} not found)`;
      else if (typeof replaceWith === "string") s += replaceWith;
      else {
        let replaceAll = dollar === 0;
        end = end.trim();
        let params = "";
        let suffix = "";
        if (replaceWith.hasSuffix && end[0] === ".") {
          end = end.slice(1).trim();
          const suffixEnd = end.length - lstrip(end, WORD_LETTERS).length;
          suffix = end.slice(0, suffixEnd);
          end = end.slice(suffixEnd).trim();
        }
        if (replaceWith.hasParameters && end[0] === "(") {
          const pe = findMatchingParenthesis(end, 0);
          if (pe < end.length - 1) replaceAll = false;
          params = end.slice(0, pe + 1);
          if (params[1] === "(" && findMatchingParenthesis(params, 1) === params.length - 2) params = params.slice(1, -1);
          end = end.slice(pe + 1);
        } else replaceAll = false;
        s += replaceWith.replace(variable, suffix, params, variables, rv, context);
        if (!replaceAll) rv.alias = null;
      }
    }
    return s + end;
  }

  getCommonReplaceVariables(uv: string, rv: ShaderCode): Variables {
    const g = this.genName;
    const variables: Variables = {};
    variables.uv = uv;
    variables.time = "elapsed_time";
    for (const [gp, v] of Object.entries(registry.globalParameters)) {
      variables[gp] = "mm_global_" + gp;
      rv.addUniform("mm_global_" + gp, "float", v);
    }
    for (const [np, v] of Object.entries(this.parent?.getNamedParameters() ?? {})) {
      variables[np] = v.id;
      rv.addUniform(v.id, "float", v.value);
    }
    variables.name = g;
    variables.seed = this.seedLocked ? `seed_${g}` : `(seed_${g}+fract(_seed_variation_))`;
    variables["?1"] = "_controlled_variation_.x";
    variables["?2"] = "_controlled_variation_.y";
    variables["?3"] = "_controlled_variation_.z";
    variables["?4"] = "_controlled_variation_.w";
    variables.node_id = String(this.id);
    return variables;
  }

  override _getShaderCode(uv: string, outputIndex: number, context: GenContext): ShaderCode {
    const g = this.genName;
    const rv = new ShaderCode();
    const declare = !context.hasVariant(this);
    const output = this.getPreprocessedOutputDef(outputIndex);
    if (!output || !output.type) return rv;
    const variables = this.getCommonReplaceVariables(uv, rv);
    this.processParameters(rv, variables, declare);
    this.processInputs(rv, variables, context, declare);
    if (declare) {
      for (const inc of this.pre.includes ?? []) {
        const gl = getPredefinedGlobal(inc);
        if (gl !== "") rv.addGlobal(gl, inc);
      }
      if (this.pre.global) rv.addGlobal(this.pre.global, `${this.getHierName()} (${g})`);
      if (this.pre.instance) {
        const inst = this.replaceVariables(this.pre.instance, variables, rv, context).trim();
        if (inst !== "") {
          rv.defs += `\n// #instance: ${this.getHierName()} (${g})\n`;
          rv.defs += this.replaceVariables(this.pre.instance, variables, rv, context);
          rv.defs += "\n\n";
        }
      }
    }
    if (this.pre.code !== undefined && !String(output[output.type]).includes("@NOCODE")) {
      const variantIndex = context.getVariant(this, uv);
      variables.name_uv = `${g}_${context.getVariant(this, uv)}`;
      if (variantIndex === -1) {
        const code = this.replaceVariables(this.pre.code, variables, rv, context);
        if (code !== "") {
          rv.code += `\n// #code: ${this.getHierName()} (${g})\n`;
          rv.code += code;
        }
      }
    }
    const variantString = uv + "," + outputIndex;
    let variantIndex = context.getVariant(this, variantString);
    let assign = false;
    if (variantIndex === -1) {
      variantIndex = context.getVariant(this, variantString);
      assign = true;
    }
    let useAlias = false;
    for (const f of Object.keys(registry.ioTypes)) {
      if (!(f in output)) continue;
      const outputString = String(output[f]).replace("@NOCODE", "").replace("@KEEPTYPE", "").trim();
      const expression = this.replaceVariables(outputString, variables, rv, context);
      if (rv.alias && String(output[f]).includes("@KEEPTYPE")) useAlias = true;
      if (!useAlias) {
        const name = `${g}_${outputIndex}_${variantIndex}_${f}`;
        if (assign) {
          rv.code += `\n// #output${outputIndex}: ${this.getHierName()} (${g})\n`;
          rv.code += `${registry.ioTypes[f].type} ${name} = ${expression};\n`;
        }
        rv.outputValues[f] = name;
      }
    }
    if (useAlias && rv.alias) {
      rv.outputValues = rv.alias.outputValues;
      rv.outputType = rv.alias.outputType;
    } else rv.outputType = output.type;
    return rv;
  }

  override _serialize(data: Dict): Dict {
    data.shader_model = this.shaderModel;
    return data;
  }
  override _serializeData(data: Dict): Dict {
    if (this.isGeneric()) data.generic_size = this.genericSize;
    return data;
  }
  override _deserialize(data: Dict): void {
    if (data.shader_model) this.setShaderModel(structuredClone(data.shader_model));
    else if (data.model_data) this.setShaderModel(structuredClone(data.model_data));
    if (data.generic_size !== undefined) this.setGenericSize(data.generic_size);
  }
}

export function defaultValueFor(type: string): string {
  switch (registry.ioTypes[type]?.type) {
    case "float":
      return "0.0";
    case "vec2":
      return "vec2(0.0)";
    case "vec3":
      return "vec3(0.0)";
    case "vec4":
      return "vec4(0.0)";
  }
  return "0.0";
}
