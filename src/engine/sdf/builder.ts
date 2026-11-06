/* Port of Material Maker's Easy SDF builder (addons/material_maker/sdf_builder): the item types a scene is made of
 * (2D and 3D shapes, booleans, smooth booleans, alterations, generators, colour channels and textures) and the
 * functions that turn a scene into the pieces of a shader model (sdf_builder.gd).
 * Each item class mirrors one .gd script; subclasses mirror `extends`. Parameter definitions are in defs.ts. */
import type { Dict, ParameterDef } from "../gen/base";
import { cloneValue, deserializeValue, isColor, serializeValue, type ParamValue } from "../params/types";
import { SDF_PARAMETER_DEFS } from "./defs";

export interface SdfScene {
  type: string;
  index: number;
  name?: string;
  hidden?: boolean;
  collapsed?: boolean;
  children: SdfScene[];
  parameters: Record<string, ParamValue>;
  /** per parameter GLSL expressions, used in place of the value */
  parmexprs?: Record<string, string>;
  [k: string]: unknown;
}

/** what a colour (or texture) is being computed for */
export interface ColorCtxt {
  uv: string;
  channel?: string;
  target?: string;
  type?: string;
  glsl_type?: string;
  local_uv?: string;
  geometry?: string;
  check?: boolean;
}

const has = (d: Dict, k: string) => d[k] !== undefined;
const f9 = (v: number) => Number(v).toFixed(9);

/* ======================================================================== items ======================================================================== */

/** base.gd */
export class SdfItem {
  /** `script` is the .gd file (without extension) the item comes from, `menu` where the editor lists it */
  constructor(
    public itemType: string,
    public category: string,
    public script: string,
    public menu: string,
  ) {}
  /** the categories of the items it may contain (get_children_types, or its own category when the script has none) */
  childrenTypes(): string[] {
    return [this.category];
  }
  parameterDefs(): ParameterDef[] {
    return structuredClone(SDF_PARAMETER_DEFS[this.script] ?? []);
  }
  includes(): string[] {
    return [];
  }
  sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const data: Dict = { parameters: [], outputs: [] };
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, uv, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
    }
    return data;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  colorCode(_scene: SdfScene, _ctxt: ColorCtxt, _editor = false): Dict {
    return {};
  }
}

/** base.gd get_color_code_smooth_union */
function colorCodeSmoothUnion(scene: SdfScene, ctxt: ColorCtxt, editor: boolean): Dict {
  const i = scene.index;
  const ctxt2: ColorCtxt = { ...ctxt, target: `tmp_${i}`, check: false };
  let code = "";
  for (const s of scene.children) {
    const c = getColorCode(s, ctxt2, editor);
    if (has(c, "distance")) {
      if (has(c, "color")) code += c.color;
      else code += `\ntmp_${i} = current_color_${i};`;
      code += `\ncoef_${i} = 1.0/pow(1.0+max(${c.distance}, 0.0), 10000.0*pow(0.8-0.3*clamp($color_k, 0.0, 1.0), 10.0));`;
      code += `\nsum_${i} += tmp_${i}*coef_${i};`;
      code += `\ncoefsum_${i} += coef_${i};`;
    } else if (has(c, "color")) {
      code += c.color;
      code += `\ncurrent_color_${i} = tmp_${i};`;
    }
  }
  if (code === "") return { distance: `_n${i}` };
  let init = "";
  init += `${ctxt.glsl_type} sum_${i} = ${ctxt.glsl_type}(0.0);\n`;
  init += `${ctxt.glsl_type} tmp_${i};\n`;
  init += `${ctxt.glsl_type} current_color_${i} = ${ctxt.channel};\n`;
  init += `float coef_${i};\n`;
  init += `float coefsum_${i} = 0.0;\n`;
  code = init + code;
  code += `\n${ctxt.target} = sum_${i}/coefsum_${i};`;
  return { color: code, distance: `_n${i}` };
}

/* ---------- 2D ---------- */

/** sdf2d/boolean/union.gd: also the base of every 2D shape and alteration */
export class Union2D extends SdfItem {
  override childrenTypes() {
    return ["SDF2D", "SDF2D_COLOR"];
  }
  override includes() {
    return ["rotate"];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shapeCodePre(_scene: SdfScene, _uv = "$uv"): string {
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shapeCode(_scene: SdfScene, _uv = "$uv"): string {
    return "";
  }
  shapeAndChildrenCode(scene: SdfScene, data: Dict, uv = "$uv", editor = false): void {
    const out = `$(name_uv)_n${scene.index}`;
    let assigned = false;
    data.code += `float ${out};\n`;
    const init = this.shapeCode(scene, uv);
    if (init !== "") {
      data.code += this.shapeCodePre(scene, uv);
      data.code += `${out} = ${init};\n`;
      assigned = true;
      if (editor) data.code += `if (index == -${scene.index}) return ${out}*$scale;\n`;
    }
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, uv, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "outputs")) {
        if (has(d2, "code")) data.code += d2.code;
        if (assigned) data.code += `${out} = min(${out}, ${d2.outputs[0].sdf2d});\n`;
        else {
          data.code += `${out} = ${d2.outputs[0].sdf2d};\n`;
          assigned = true;
        }
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modUvCode(_scene: SdfScene, _out: string): string {
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modCode(_scene: SdfScene, _out: string, _editor: boolean): string {
    return "";
  }
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const out = `$(name_uv)_n${scene.index}`;
    const data: Dict = { parameters: [], outputs: [{ sdf2d: out, type: "sdf2d" }] };
    data.code = `vec2 ${out}_p = ${uv} - vec2($position_x, $position_y);\n`;
    data.code += `${out}_p = rotate(${out}_p, radians($angle))/$scale;\n`;
    data.code += this.modUvCode(scene, out);
    this.shapeAndChildrenCode(scene, data, `${out}_p`, editor);
    data.code += this.modCode(scene, out, editor);
    data.code += `${out} *= $scale;\n`;
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
    return data;
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    let code = "";
    const ctxt2: ColorCtxt = { ...ctxt, local_uv: `$(name_uv)_n${scene.index}_p` };
    let elseColor = "";
    let first = true;
    for (let i = 0; i < scene.children.length; i++) {
      const s = scene.children[scene.children.length - i - 1];
      if (itemOf(s).category === "TEX") continue;
      const c = getColorCode(s, ctxt2, editor);
      if (!has(c, "color")) continue;
      if (!has(c, "distance")) {
        if (elseColor === "") elseColor = c.color;
        continue;
      }
      if (first) first = false;
      else code += " else ";
      code += `if (${c.distance} < 0.0) {\n${c.color}\n}\n`;
    }
    if (elseColor !== "") {
      if (first) code += `${elseColor}\n`;
      else code += ` else {\n${elseColor}\n}`;
    } else if (first) return { distance: `_n${scene.index}` };
    return { color: code, distance: `_n${scene.index}` };
  }
}

/** a 2D shape: shape_code is a format string where %s is the uv */
class Shape2D extends Union2D {
  constructor(
    itemType: string,
    script: string,
    menu: string,
    private readonly fmt: string,
    private readonly incs: string[],
  ) {
    super(itemType, "SDF2D", script, menu);
  }
  override includes() {
    return this.incs;
  }
  override shapeCode(_scene: SdfScene, uv = "$uv") {
    return this.fmt.replaceAll("%s", uv);
  }
}

/** sdf2d/shapes/box.gd: Box, Rhombus, IsocelesTriangle, Tunnel, Ellipse */
class Box2D extends Union2D {
  static INCLUDES = [
    ["rotate", "sdbox"],
    ["rotate", "sdrhombus"],
    ["rotate", "sdisoscelestriangle"],
    ["rotate", "sdtunnel"],
    ["rotate", "sdellipse"],
    ["rotate", "sdstairs"],
  ];
  static FUNCTIONS = ["sd_box", "sdRhombus", "sd_isosceles_triangle", "sdTunnel", "sd_ellipse", "sdStairs"];
  constructor(
    itemType: string,
    menu: string,
    private readonly shape: number,
  ) {
    super(itemType, "SDF2D", "sdf2d/shapes/box", menu);
  }
  override includes() {
    return Box2D.INCLUDES[this.shape];
  }
  override shapeCode(_scene: SdfScene, uv = "$uv") {
    return `${Box2D.FUNCTIONS[this.shape]}(${uv}, vec2($size_x, $size_y))`;
  }
}

/** sdf2d/shapes/polygon.gd */
class Polygon2D extends Union2D {
  override shapeCodePre(scene: SdfScene, uv = "$uv") {
    let code = "";
    code += `vec2 <prefix>uv = ${uv}+vec2(0.5);`;
    code += "vec2 <prefix>v[] = $polygon;";
    code += "int <prefix>l = <prefix>v.length();";
    code += "float <prefix>d = dot(<prefix>uv-<prefix>v[0], <prefix>uv-<prefix>v[0]);";
    code += "float <prefix>s = 1.0;";
    code += "int <prefix>j = <prefix>l-1;";
    code += "for (int <prefix>i=0; <prefix>i<<prefix>l; <prefix>i++) {";
    code += "    vec2 <prefix>e = <prefix>v[<prefix>j] - <prefix>v[<prefix>i];";
    code += "    vec2 <prefix>w = <prefix>uv - <prefix>v[<prefix>i];";
    code += "    vec2 <prefix>b = <prefix>w - <prefix>e*clamp(dot(<prefix>w,<prefix>e)/dot(<prefix>e,<prefix>e), 0.0, 1.0 );";
    code += "    <prefix>d = min(<prefix>d, dot(<prefix>b, <prefix>b));";
    code += "    bvec3 <prefix>c = bvec3(<prefix>uv.y>=<prefix>v[<prefix>i].y,<prefix>uv.y<<prefix>v[<prefix>j].y,<prefix>e.x*<prefix>w.y><prefix>e.y*<prefix>w.x);";
    code += "    if (all(<prefix>c) || all(not(<prefix>c))) <prefix>s*=-1.0;";
    code += "    <prefix>j = <prefix>i;";
    code += "}";
    return code.replaceAll("<prefix>", `$(name_uv)_n${scene.index}_`);
  }
  override shapeCode(scene: SdfScene) {
    return "<prefix>s*sqrt(<prefix>d)".replaceAll("<prefix>", `$(name_uv)_n${scene.index}_`);
  }
}

/** sdf2d/boolean/intersection.gd */
class Intersection2D extends Union2D {
  override shapeAndChildrenCode(scene: SdfScene, data: Dict, _uv = "$uv", editor = false) {
    const out = `$(name_uv)_n${scene.index}`;
    data.code += `float ${out} = 42.0;`;
    let first = true;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (Object.keys(d2).length) {
        data.parameters.push(...(d2.parameters ?? []));
        data.code += d2.code ?? "";
        if (!d2.outputs?.length) continue;
        if (first) {
          data.code += `${out} = ${d2.outputs[0].sdf2d};\n`;
          first = false;
        } else data.code += `${out} = max(${out}, ${d2.outputs[0].sdf2d});\n`;
      }
    }
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
  }
}

/** sdf2d/boolean/difference.gd */
class Difference2D extends Union2D {
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const out = `$(name_uv)_n${scene.index}`;
    const data: Dict = { parameters: [], outputs: [{ sdf2d: out, type: "sdf2d" }] };
    data.code = `vec2 ${out}_p = ${uv} - vec2($position_x, $position_y);\n`;
    data.code += `${out}_p = rotate(${out}_p, radians($angle))/$scale;\n`;
    data.code += `float ${out} = 0.0;`;
    let first = true;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "code")) {
        data.code += d2.code;
        if (first) {
          data.code += `${out} = ${d2.outputs[0].sdf2d};\n`;
          first = false;
        } else data.code += `${out} = max(${out}, -(${d2.outputs[0].sdf2d}));\n`;
      }
    }
    data.code += `${out} *= $scale;\n`;
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
    return data;
  }
}

/** sdf2d/smooth/smooth_union.gd: SmoothUnion (op_sign "-") and SmoothIntersection (op_sign "") */
class Smooth2D extends Union2D {
  constructor(
    itemType: string,
    menu: string,
    private readonly opSign: string,
  ) {
    super(itemType, "SDF2D", "sdf2d/smooth/smooth_union", menu);
  }
  override shapeAndChildrenCode(scene: SdfScene, data: Dict, _uv = "$uv", editor = false) {
    const out = `$(name_uv)_n${scene.index}`;
    data.code += `float ${out} = 0.0;`;
    data.code += `float $(name_uv)_n${scene.index}_kk = 10.0/$k;`;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "code")) {
        data.code += d2.code;
        data.code += `${out} += exp2(${this.opSign}$(name_uv)_n${scene.index}_kk*${d2.outputs[0].sdf2d});\n`;
      }
    }
    data.code += `${out} = ${this.opSign}log2(${out})/$(name_uv)_n${scene.index}_kk;\n`;
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false) {
    return colorCodeSmoothUnion(scene, ctxt, editor);
  }
}

/** sdf2d/alter/*.gd */
class Alter2D extends Union2D {
  constructor(
    itemType: string,
    script: string,
    menu: string,
    private readonly uvMod: ((scene: SdfScene, out: string) => string) | null,
    private readonly distMod: ((scene: SdfScene, out: string) => string) | null,
    private readonly incs: string[] = ["rotate"],
  ) {
    super(itemType, "SDF2D", script, menu);
  }
  override includes() {
    return this.incs;
  }
  override modUvCode(scene: SdfScene, out: string) {
    return this.uvMod ? this.uvMod(scene, out) : "";
  }
  override modCode(scene: SdfScene, out: string) {
    return this.distMod ? this.distMod(scene, out) : "";
  }
}

/** sdf2d/alter/morph.gd */
class Morph2D extends Union2D {
  override shapeAndChildrenCode(scene: SdfScene, data: Dict, _uv = "$uv", editor = false) {
    const out = `$(name_uv)_n${scene.index}`;
    data.code += `float ${out} = 42.0;`;
    let count = 0;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "code")) {
        data.code += d2.code;
        if (count === 0) data.code += `${out} = ${d2.outputs[0].sdf2d};\n`;
        else if (count === 1) {
          data.code += `${out} *= $k;\n`;
          data.code += `${out} += ${d2.outputs[0].sdf2d}*(1.0-$k);\n`;
        }
        count++;
      }
    }
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
  }
}

/* ---------- 3D ---------- */

/** sdf3d/boolean/union.gd: also the base of every 3D shape, alteration and of the colour items */
export class Union3D extends SdfItem {
  override childrenTypes() {
    return ["SDF3D", "SDF3D_COLOR"];
  }
  override includes() {
    return ["rotate"];
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shapeCode(_scene: SdfScene, _uv = "$uv"): string {
    return "";
  }
  shapeAndChildrenCode(scene: SdfScene, data: Dict, uv = "$uv", editor = false): void {
    const out = `$(name_uv)_n${scene.index}`;
    let assigned = false;
    data.code += `float ${out};\n`;
    const init = this.shapeCode(scene, uv);
    if (init !== "") {
      data.code += `${out} = ${init};\n`;
      assigned = true;
    }
    if (editor) data.code += `if (index == -${scene.index}) return ${out}*$scale;\n`;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "outputs")) {
        if (has(d2, "code")) data.code += d2.code;
        if (assigned) data.code += `${out} = min(${out}, ${d2.outputs[0].sdf3d});\n`;
        else {
          data.code += `${out} = ${d2.outputs[0].sdf3d};\n`;
          assigned = true;
        }
      }
    }
    if (!assigned) data.code += `${out} = 1000000.0;\n`;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modUvCode(_scene: SdfScene, _out: string): string {
    return "";
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modCode(_scene: SdfScene, _out: string, _editor: boolean): string {
    return "";
  }
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const out = `$(name_uv)_n${scene.index}`;
    const data: Dict = { parameters: [], outputs: [{ sdf3d: out, type: "sdf3d" }] };
    data.code = `vec3 ${out}_p = ${uv};\n`;
    data.code += transform3d(scene, out, editor);
    data.code += this.modUvCode(scene, out);
    this.shapeAndChildrenCode(scene, data, `${out}_p`, editor);
    data.code += this.modCode(scene, out, editor);
    if (editor || checkNonZeroParam(scene, "scale", 1.0)) data.code += `${out} *= $scale;\n`;
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
    return data;
  }
  coloringTolerance(): string {
    return "0.001";
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    let code = "";
    const ctxt2: ColorCtxt = { ...ctxt, local_uv: `$(name_uv)_n${scene.index}_p` };
    const colored: Dict[] = [];
    let colorCount = 0,
      distanceCount = 0;
    for (const s of scene.children) {
      if (itemOf(s).category === "TEX") continue;
      const c = getColorCode(s, ctxt2, editor);
      colored.push(c);
      if (has(c, "color")) {
        colorCount++;
        if (has(c, "distance")) distanceCount++;
      }
    }
    const n = scene.index;
    if (colorCount === 0) return { distance: `_n${n}` };
    if (distanceCount === 0) {
      for (const c of colored) if (has(c, "color")) return { color: c.color, distance: `_n${n}` };
    }
    let first = true;
    for (let i = 0; i < colored.length; i++) {
      if (!has(colored[i], "distance")) continue;
      if (first) {
        first = false;
        code += `int $(name_uv)_n${n}_id = ${i};\nfloat $(name_uv)_n${n}_best_d = ${colored[i].distance};\n`;
      } else code += `if ($(name_uv)_n${n}_best_d > ${colored[i].distance}) { $(name_uv)_n${n}_best_d = ${colored[i].distance}; $(name_uv)_n${n}_id = ${i}; }\n`;
    }
    first = true;
    let elseColor = "";
    for (let i = 0; i < colored.length; i++) {
      if (!has(colored[i], "color")) continue;
      if (!has(colored[i], "distance")) {
        if (elseColor === "") elseColor = colored[i].color;
        continue;
      }
      if (first) first = false;
      else code += " else ";
      code += `if ($(name_uv)_n${n}_id == ${i}) {\n${colored[i].color}\n}\n`;
    }
    if (elseColor !== "") code += ` else {\n${elseColor}\n}`;
    return { color: code, distance: `_n${n}` };
  }
}

/** the position / rotation / scale prologue every 3D item shares */
function transform3d(scene: SdfScene, out: string, editor: boolean): string {
  let code = "";
  if (editor || checkNonZeroParam(scene, "position_x") || checkNonZeroParam(scene, "position_y") || checkNonZeroParam(scene, "position_z")) code += `${out}_p -= vec3($position_x, $position_y, $position_z);\n`;
  code += generateRotate3d(`${out}_p`, scene, editor);
  if (editor || checkNonZeroParam(scene, "scale", 1.0)) code += `${out}_p /= $scale;\n`;
  return code;
}

/** a 3D shape: one of a script's FUNCTIONS (format strings, %s is the uv) with its INCLUDES */
class Shape3D extends Union3D {
  constructor(
    itemType: string,
    script: string,
    menu: string,
    private readonly fmt: string,
    private readonly incs: string[],
    private readonly axis = false,
  ) {
    super(itemType, "SDF3D", script, menu);
  }
  override includes() {
    return this.incs;
  }
  override shapeCode(_scene: SdfScene, uv = "$uv") {
    return this.fmt.replaceAll("%s", this.axis ? uv + ".$axis" : uv);
  }
}

/** sdf3d/boolean/intersection.gd */
class Intersection3D extends Union3D {
  override shapeAndChildrenCode(scene: SdfScene, data: Dict, _uv = "$uv", editor = false) {
    const out = `$(name_uv)_n${scene.index}`;
    data.code += `float ${out} = 42.0;`;
    let first = true;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "code")) {
        data.parameters.push(...(d2.parameters ?? []));
        data.code += d2.code;
        if (!d2.outputs?.length) continue;
        if (first) {
          data.code += `${out} = ${d2.outputs[0].sdf3d};\n`;
          first = false;
        } else data.code += `${out} = max(${out}, ${d2.outputs[0].sdf3d});\n`;
      }
    }
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
  }
}

/** sdf3d/boolean/difference.gd */
class Difference3D extends Union3D {
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const out = `$(name_uv)_n${scene.index}`;
    const data: Dict = { parameters: [], outputs: [{ sdf3d: out, type: "sdf3d" }] };
    data.code = `vec3 ${out}_p = ${uv};\n`;
    data.code += transform3d(scene, out, editor);
    data.code += `float ${out} = 0.0;`;
    let first = true;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (Object.keys(d2).length) {
        data.parameters.push(...(d2.parameters ?? []));
        if (has(d2, "code")) data.code += d2.code;
        if (has(d2, "outputs") && d2.outputs.length) {
          if (first) {
            data.code += `${out} = ${d2.outputs[0].sdf3d};\n`;
            first = false;
          } else data.code += `${out} = max(${out}, -(${d2.outputs[0].sdf3d}));\n`;
        }
      }
    }
    if (editor || checkNonZeroParam(scene, "scale", 1.0)) data.code += `${out} *= $scale;\n`;
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
    return data;
  }
}

/** sdf3d/smooth/smooth_union.gd */
class Smooth3D extends Union3D {
  constructor(
    itemType: string,
    menu: string,
    private readonly opSign: string,
  ) {
    super(itemType, "SDF3D", "sdf3d/smooth/smooth_union", menu);
  }
  override shapeAndChildrenCode(scene: SdfScene, data: Dict, _uv = "$uv", editor = false) {
    const out = `$(name_uv)_n${scene.index}`;
    data.code += `float ${out} = 0.0;`;
    data.code += `float $(name_uv)_n${scene.index}_kk = 10.0/$k;`;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "code")) {
        data.code += d2.code;
        data.code += `${out} += exp2(${this.opSign}$(name_uv)_n${scene.index}_kk*${d2.outputs[0].sdf3d});\n`;
      }
    }
    data.code += `${out} = ${this.opSign}log2(${out})/$(name_uv)_n${scene.index}_kk;\n`;
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false) {
    return colorCodeSmoothUnion(scene, ctxt, editor);
  }
}

/** sdf3d/alter/*.gd */
class Alter3D extends Union3D {
  constructor(
    itemType: string,
    script: string,
    menu: string,
    private readonly uvMod: ((scene: SdfScene, out: string) => string) | null,
    private readonly distMod: ((scene: SdfScene, out: string, editor: boolean) => string) | null,
    private readonly incs: string[] = ["rotate"],
  ) {
    super(itemType, "SDF3D", script, menu);
  }
  override includes() {
    return this.incs;
  }
  override modUvCode(scene: SdfScene, out: string) {
    return this.uvMod ? this.uvMod(scene, out) : "";
  }
  override modCode(scene: SdfScene, out: string, editor: boolean) {
    return this.distMod ? this.distMod(scene, out, editor) : "";
  }
}

/** sdf3d/alter/morph.gd */
class Morph3D extends Union3D {
  override shapeAndChildrenCode(scene: SdfScene, data: Dict, _uv = "$uv", editor = false) {
    const out = `$(name_uv)_n${scene.index}`;
    data.code += `float ${out} = 42.0;`;
    let count = 0;
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, `${out}_p`, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
      if (has(d2, "code")) {
        data.code += d2.code;
        if (count === 0) data.code += `${out} = ${d2.outputs[0].sdf3d};\n`;
        else if (count === 1) {
          data.code += `${out} *= $k;\n`;
          data.code += `${out} += ${d2.outputs[0].sdf3d}*(1.0-$k);\n`;
        }
        count++;
      }
    }
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
  }
}

/** sdf3d/alter/distort.gd */
class Distort3D extends Union3D {
  override childrenTypes() {
    return ["SDF3D", "SDF3D_COLOR", "TEX"];
  }
  override modCode(scene: SdfScene, out: string, editor: boolean) {
    for (const s of scene.children) {
      if (itemOf(s).category !== "TEX") continue;
      const ctxt: ColorCtxt = { uv: out + "_p", geometry: "sdf3d", type: "float", glsl_type: "float" };
      const m = getColorCode(s, ctxt, editor);
      if (has(m, "color")) return `${out} += $amount*(${m.color}-0.5);\n`;
    }
    return "";
  }
  override coloringTolerance() {
    return "0.001+$amount";
  }
}

/** sdf3d/generate/extrusion.gd and revolution.gd: 3D items made from 2D children (they extend the 2D union) */
class Generate3D extends Union2D {
  constructor(
    itemType: string,
    script: string,
    menu: string,
    private readonly revolution: boolean,
  ) {
    super(itemType, "SDF3D", script, menu);
  }
  override childrenTypes() {
    return ["SDF2D", "SDF3D_COLOR"];
  }
  override includes() {
    return ["sdf3d_rotate"];
  }
  override shapeCode() {
    return "1000000.0";
  }
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const out = `$(name_uv)_n${scene.index}`;
    const data: Dict = { parameters: [], outputs: [{ sdf3d: out, type: "sdf3d" }] };
    data.code = `vec3 ${out}_p = ${uv};\n`;
    data.code += transform3d(scene, out, editor);
    if (this.revolution) {
      data.code += `vec2 ${out}_q = vec2(length(${out}_p.xz)-$offset, ${out}_p.y);\n`;
      this.shapeAndChildrenCode(scene, data, `${out}_q`, editor);
    } else {
      this.shapeAndChildrenCode(scene, data, `${out}_p.xy`, editor);
      data.code += `vec2 ${out}_w = vec2(${out}, abs(${out}_p.z) - $length);\n`;
      data.code += `${out} = min(max(${out}_w.x, ${out}_w.y),0.0) + length(max(${out}_w,0.0));\n`;
    }
    if (editor || checkNonZeroParam(scene, "scale", 1.0)) data.code += `${out} *= $scale;\n`;
    if (editor) data.code += `if (index == ${scene.index}) return ${out};\n`;
    return data;
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    const uv = this.revolution ? `$(name_uv)_n${scene.index}_q` : `$(name_uv)_n${scene.index}_p.xy`;
    const ctxt2: ColorCtxt = { ...ctxt, local_uv: uv, uv, check: false };
    const c = super.colorCode(scene, ctxt2, editor);
    return has(c, "color") ? { color: c.color, distance: `_n${scene.index}` } : { distance: `_n${scene.index}` };
  }
}

/** sdf3d/color.gd: a colour channel (albedo, metallic, roughness, emission) set by a texture.
 * Material Maker's sdf_builder.tscn uses this script for the 2D colour items too, which makes textures in 2D scenes
 * call the 3D noise functions with a 2D position (a shader error). The 2D items here use the geometry of
 * sdf2d/alter/color.gd, the script written for them, so their textures are 2D. */
class ColorItem extends Union3D {
  constructor(
    itemType: string,
    category: string,
    menu: string,
    public readonly channel: string,
  ) {
    super(itemType, category, "sdf3d/color", menu);
  }
  override childrenTypes() {
    return ["TEX"];
  }
  override includes() {
    return [];
  }
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const data: Dict = { parameters: [] };
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, uv, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
    }
    return data;
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    if (this.channel !== ctxt.channel) return {};
    const ctxt2: ColorCtxt = { ...ctxt, geometry: this.category === "SDF2D_COLOR" ? "sdf2d" : "sdf3d" };
    if (scene.parameters.local) ctxt2.uv = ctxt.local_uv!;
    for (const s of scene.children) {
      const c = getColorCode(s, ctxt2, editor);
      if (Object.keys(c).length) return { color: `${ctxt.target} = ${c.color};` };
    }
    return {};
  }
}

/* ---------- textures ---------- */

/** the shared part of the texture scripts: they only collect their children's parameters */
class Tex extends SdfItem {
  constructor(itemType: string, script: string, menu: string) {
    super(itemType, "TEX", script, menu);
  }
  override sceneToShaderModel(scene: SdfScene, uv = "$uv", editor = false): Dict {
    const data: Dict = { parameters: [] };
    for (const s of scene.children) {
      const d2 = sceneToShaderModel(s, uv, editor);
      if (has(d2, "parameters")) data.parameters.push(...d2.parameters);
    }
    return data;
  }
}
const asType = (tex: string, type: string | undefined) => (type === "rgba" ? `vec4(vec3(${tex}), 1.0)` : type === "color" ? `vec3(${tex})` : tex);
const fromRgba = (tex: string, type: string | undefined) => (type === "color" ? `(${tex}).xyz` : type === "float" ? `dot((${tex}).xyz, vec3(1.0))/3.0` : tex);

/** tex/uniform.gd */
class UniformTex extends Tex {
  override sceneToShaderModel(scene: SdfScene): Dict {
    const out = `$(name_uv)_n${scene.index}`;
    return { parameters: [], outputs: [{ sdf2d: out, type: "sdf2d" }], code: "" };
  }
  override colorCode(_scene: SdfScene, ctxt: ColorCtxt): Dict {
    return { color: ctxt.type === "color" ? "($color).xyz" : ctxt.type === "float" ? "dot(($color).xyz, vec3(1.0))/3.0" : "$color" };
  }
}

/** tex/fbm.gd, and through get_color_code_gs, tex/pattern.gd and tex/uniform_gs.gd */
class FbmTex extends Tex {
  override includes() {
    return ["fbm2", "tex3d_fbm"];
  }
  colorCodeGs(ctxt: ColorCtxt): string {
    if (ctxt.geometry === "sdf3d") return `fbm3d_$noise(${ctxt.uv}, vec3($scale_x, $scale_y, $scale_z), int($iterations), $persistence, 0.0)`;
    // tex/fbm.gd calls fbm_2d_$noise, which the fbm2 library node has since renamed old_fbm_2d_$noise (same signature)
    return `old_fbm_2d_$noise(${ctxt.uv}, vec2($scale_x, $scale_y), int($folds), int($iterations), $persistence, $offset, 0.0)`;
  }
  override colorCode(_scene: SdfScene, ctxt: ColorCtxt): Dict {
    return { color: asType(this.colorCodeGs(ctxt), ctxt.type) };
  }
}
class PatternTex extends FbmTex {
  override includes() {
    return ["pattern", "tex3d_pattern"];
  }
  override colorCodeGs(ctxt: ColorCtxt): string {
    if (ctxt.geometry === "sdf3d") return `mix3d_$mix(wave_$x_wave($x_scale*${ctxt.uv}.x), wave_$y_wave($y_scale*${ctxt.uv}.y), wave_$z_wave($z_scale*${ctxt.uv}.z))`;
    return `mix_$mix(wave_$x_wave($x_scale*${ctxt.uv}.x), wave_$y_wave($y_scale*${ctxt.uv}.y))`;
  }
}
class UniformGsTex extends FbmTex {
  override includes() {
    return [];
  }
  override colorCodeGs(): string {
    return "$value";
  }
}

/** tex/brightness_contrast.gd */
class BrightnessContrastTex extends Tex {
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    let child = ctxt.type === "rgba" ? "vec4(vec3(0.5), 1.0)" : ctxt.type === "color" ? "vec3(0.5)" : "0.5";
    if (scene.children.length) {
      const c = getColorCode(scene.children[0], ctxt, editor);
      if (has(c, "color")) child = c.color;
    }
    const type = ctxt.type === "rgba" ? "vec4" : ctxt.type === "color" ? "vec3" : "";
    let tex = ctxt.type === "rgba" ? `${child}*vec4(vec3($contrast), 1.0)+vec4(vec3($brightness+0.5-$contrast*0.5), 0.0)` : `${child}*$contrast+${type}($brightness+0.5-$contrast*0.5)`;
    if (scene.parameters.clamp === undefined || scene.parameters.clamp) tex = `clamp(${tex}, ${type}(0.0), ${type}(1.0))`;
    return { color: tex };
  }
}

/** tex/step.gd */
class StepTex extends Tex {
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    let child = "0.0";
    if (scene.children.length) child = getColorCode(scene.children[0], { ...ctxt, type: "float" }, editor).color;
    let tex = `clamp((${child}-$value)/max(0.0001, $width)+0.5, 0.0, 1.0)`;
    if (scene.parameters.invert) tex = `(1.0-${tex})`;
    return { color: asType(tex, ctxt.type) };
  }
}

/** tex/simple_gradient.gd */
class SimpleGradientTex extends Tex {
  override childrenTypes() {
    return ["TEX"];
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    const tex = scene.children.length ? `mix($color1, $color2, ${getColorCode(scene.children[0], { ...ctxt, type: "float" }, editor).color})` : "$color1";
    return { color: fromRgba(tex, ctxt.type) };
  }
}

/** tex/blend.gd */
class BlendTex extends Tex {
  override childrenTypes() {
    return ["TEX"];
  }
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    let tex = "vec4(1.0)";
    const ch = scene.children;
    if (ch.length) {
      tex = getColorCode(ch[0], { ...ctxt, type: "rgba" }, editor).color;
      for (let i = 1; i < ch.length; i += 2) {
        const tex2 = getColorCode(ch[i], { ...ctxt, type: "rgba" }, editor).color;
        let mask = "0.5";
        if (ch.length > i + 1) mask = getColorCode(ch[i + 1], { ...ctxt, type: "float" }, editor).color;
        tex = `mix(${tex}, ${tex2}, ${mask})`;
      }
    }
    return { color: fromRgba(tex, ctxt.type) };
  }
}

/** tex/deform.gd */
class DeformTex extends Tex {
  override colorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
    let tex = "";
    if (!scene.children.length) tex = asType("1.0", ctxt.type);
    else {
      let deform = "vec3(0.0)";
      if (scene.children.length > 1) {
        const d = getColorCode(scene.children[1], { ...ctxt, type: "color" }, editor);
        if (has(d, "color")) deform = d.color;
      }
      const ctxt2: ColorCtxt = { ...ctxt };
      if (ctxt.geometry === "sdf3d") ctxt2.uv = `(${ctxt2.uv}+$amount*(${deform}.xyz-vec3(0.5)))`;
      else ctxt2.uv = `(${ctxt2.uv}+$amount*(${deform}.xy-vec2(0.5)))`;
      const c = getColorCode(scene.children[0], ctxt2, editor);
      if (has(c, "color")) tex = c.color;
    }
    return { color: tex };
  }
}

/* ======================================================================== registry ======================================================================== */

const P = (s: SdfScene, k: string) => s.parameters[k] === undefined || !!s.parameters[k];

/** every item type, in the order sdf_builder.tscn lists them (which is the editor's menu order) */
export const SDF_ITEM_TYPES: SdfItem[] = [
  // 2D shapes
  new Shape2D("Arc", "sdf2d/shapes/arc", "SDF2D/Shape", "sdArc( %s, mod($a1, 360.0)*0.01745329251, mod($a2, 360.0)*0.01745329251, $r1, $r2)", ["sdarc", "rotate"]),
  new Shape2D("Arrow", "sdf2d/shapes/arrow", "SDF2D/Shape", "sdArrow(%s,vec2($ax,$ay),vec2($bx,$by),$wt,$wh,$k/$wh*distance(vec2($ax,$ay),vec2($bx,$by)))", ["sdarrow", "rotate"]),
  new Box2D("Box", "SDF2D/Shape", 0),
  new Shape2D("Circle", "sdf2d/shapes/circle", "SDF2D/Shape", "length(%s)-$radius", ["rotate"]),
  new Shape2D("Cross", "sdf2d/shapes/cross", "SDF2D/Shape", "sdCross(%s, vec2($bx, $by) + $r, $r)", ["sdcross", "rotate"]),
  new Box2D("Ellipse", "SDF2D/Shape", 4),
  new Shape2D("Heart", "sdf2d/shapes/heart", "SDF2D/Shape", "sdHeart((%s) / ($r *1.75)) * ($r *1.75)", ["sdheart", "rotate"]),
  new Shape2D("Hexagram", "sdf2d/shapes/hexagram", "SDF2D/Shape", "sdHexagram(%s, $r)", ["sdhexagram", "rotate"]),
  new Box2D("IsoTriangle", "SDF2D/Shape", 2),
  new Shape2D("Line", "sdf2d/shapes/line", "SDF2D/Shape", "sdLine(%s, vec2($ax, $ay), vec2($bx, $by)).x-$r", ["rotate", "sdline2"]),
  new Shape2D("Moon", "sdf2d/shapes/moon", "SDF2D/Shape", "sdMoon(%s, $d, $ra, $rb)", ["sdmoon", "rotate"]),
  new Shape2D("NGon", "sdf2d/shapes/ngon", "SDF2D/Shape", "sdNgon(%s, $radius, $edgecount)", ["rotate", "sdcirclerepeat", "sdngon"]),
  new Shape2D("Pie", "sdf2d/shapes/pie", "SDF2D/Shape", "sdPie(%s, vec2(sin(radians(abs(mod(450.0 + $aa , 360.0) - 180.0))), cos(radians(abs(mod(450.0 + $aa , 360.0) - 180.0)))), $r)", ["sdpie", "rotate"]),
  new Polygon2D("Polygon", "SDF2D", "sdf2d/shapes/polygon", "SDF2D/Shape"),
  new Box2D("Rhombus", "SDF2D/Shape", 1),
  new Shape2D("Stairs", "sdf2d/shapes/stairs", "SDF2D/Shape", "sdStairs(vec2(1.0, -1.0)*%s+vec2($size_x, $size_y), 2.0*vec2($size_x, $size_y)/$steps, $steps)", ["rotate", "sdstairs"]),
  new Shape2D("Star", "sdf2d/shapes/star", "SDF2D/Shape", "sdStar(%s, $radius, int($branchcount),  2.0+($branchcount-2.0)*(1.0-$pointiness))", ["rotate", "sdstar"]),
  new Box2D("Tunnel", "SDF2D/Shape", 3),
  new Shape2D("Vesica", "sdf2d/shapes/vesica", "SDF2D/Shape", "sdVesica(%s, $r, $r - $d)", ["sdversica", "rotate"]),
  // 2D booleans
  new Union2D("Union", "SDF2D", "sdf2d/boolean/union", "SDF2D/Boolean"),
  new Intersection2D("Intersection", "SDF2D", "sdf2d/boolean/intersection", "SDF2D/Boolean"),
  new Difference2D("Difference", "SDF2D", "sdf2d/boolean/difference", "SDF2D/Boolean"),
  new Smooth2D("SmoothUnion", "SDF2D/Smooth", "-"),
  new Smooth2D("SmoothIntersection", "SDF2D/Smooth", ""),
  // 2D alterations (the "Round" node of sdf_builder.tscn has no item_type, so it is not offered)
  new Alter2D("Flip", "sdf2d/alter/flip", "SDF2D/Alter", (s, o) => (P(s, "h_flip") ? `${o}_p.x = -${o}_p.x;\n` : "") + (P(s, "v_flip") ? `${o}_p.y = -${o}_p.y;\n` : ""), null),
  new Alter2D("Mirror", "sdf2d/alter/mirror", "SDF2D/Alter", (s, o) => (P(s, "h_mirror") ? `${o}_p.x = abs(${o}_p.x);\n` : "") + (P(s, "v_mirror") ? `${o}_p.y = abs(${o}_p.y);\n` : ""), null),
  new Alter2D("Elongate", "sdf2d/alter/elongate", "SDF2D/Alter", (_s, o) => `vec2 ${o}_s = vec2($size_x, $size_y);\n${o}_p = ${o}_p - clamp(${o}_p, -${o}_s, ${o}_s);\n`, null),
  new Alter2D("Bend", "sdf2d/alter/bend", "SDF2D/Alter", (_s, o) => `${o}_p = sdBend(${o}_p, $amount);\n`, null, ["rotate", "sdbend"]),
  new Alter2D("Annular", "sdf2d/alter/annular", "SDF2D/Alter", null, (_s, o) => `${o} = abs(${o})-0.5*$width;\n`),
  new Morph2D("Morph", "SDF2D", "sdf2d/alter/morph", "SDF2D/Alter"),
  // 2D colours
  new ColorItem("Albedo2D", "SDF2D_COLOR", "SDF2D/Color", "albedo"),
  new ColorItem("Metallic2D", "SDF2D_COLOR", "SDF2D/Color", "metallic"),
  new ColorItem("Roughness2D", "SDF2D_COLOR", "SDF2D/Color", "roughness"),
  new ColorItem("Emission2D", "SDF2D_COLOR", "SDF2D/Color", "emission"),
  // 3D shapes
  new Shape3D("Sphere", "sdf3d/shapes/sphere", "SDF3D/Shape", "length(%s)-$radius", ["rotate"]),
  new Shape3D("Box3D", "sdf3d/shapes/box", "SDF3D/Shape", "box3d(%s, vec3($size_x, $size_y, $size_z))", ["rotate", "sdf3d_box"]),
  new Shape3D("Cylinder", "sdf3d/shapes/cylinder", "SDF3D/Shape", "sdCylinder(%s, $height, $radius)", ["rotate", "sdf3d_cylinder"], true),
  new Shape3D("Capsule", "sdf3d/shapes/cylinder", "SDF3D/Shape", "sdCapsule(%s, $height, $radius)", ["rotate", "sdf3d_capsule2"], true),
  new Shape3D("Cone", "sdf3d/shapes/cylinder", "SDF3D/Shape", "sdCone(vec3(0.0, $height, 0.0)-%s, vec2($radius, 2.0*$height))", ["rotate", "sdf3d_cone2"], true),
  new Shape3D("Torus", "sdf3d/shapes/torus", "SDF3D/Shape", "sdTorus(%s.$axis, vec2($R, $r))", ["rotate", "sdf3d_torus"]),
  new Shape3D("Pyramid", "sdf3d/shapes/cylinder", "SDF3D/Shape", "sdPyramid(0.5*%s/$radius, $height/$radius)*$radius*2.0", ["rotate", "sdf3d_pyramid"], true),
  new Shape3D("Ellipsoid", "sdf3d/shapes/box", "SDF3D/Shape", "sdEllipsoid(%s, vec3($size_x, $size_y, $size_z))", ["rotate", "sdf3d_ellipsoid"]),
  new Shape3D("Octahedron", "sdf3d/shapes/sphere", "SDF3D/Shape", "sdOctahedron(%s, $radius)", ["rotate", "sdf3d_octahedron"]),
  // 3D generators
  new Generate3D("Extrusion", "sdf3d/generate/extrusion", "SDF3D/Generate", false),
  new Generate3D("Revolution", "sdf3d/generate/revolution", "SDF3D/Generate", true),
  // 3D booleans
  new Union3D("Union3D", "SDF3D", "sdf3d/boolean/union", "SDF3D/Boolean"),
  new Intersection3D("Intersection3D", "SDF3D", "sdf3d/boolean/intersection", "SDF3D/Boolean"),
  new Difference3D("Difference3D", "SDF3D", "sdf3d/boolean/difference", "SDF3D/Boolean"),
  new Smooth3D("SmoothUnion3D", "SDF3D/Smooth", "-"),
  new Smooth3D("SmoothIntersection3D", "SDF3D/Smooth", ""),
  // 3D alterations
  new Alter3D("Flip3D", "sdf3d/alter/flip", "SDF3D/Alter", (s, o) => ["x", "y", "z"].map((a) => (P(s, `${a}_flip`) ? `${o}_p.${a} = -${o}_p.${a};\n` : "")).join(""), null),
  new Alter3D("Mirror3D", "sdf3d/alter/mirror", "SDF3D/Alter", (s, o) => ["x", "y", "z"].map((a) => (P(s, `${a}_mirror`) ? `${o}_p.${a} = abs(${o}_p.${a});\n` : "")).join(""), null),
  new Alter3D("Elongate3D", "sdf3d/alter/elongate", "SDF3D/Alter", (_s, o) => `vec3 ${o}_s = vec3($size_x, $size_y, $size_z);\n${o}_p = ${o}_p - clamp(${o}_p, -${o}_s, ${o}_s);\n`, null),
  new Alter3D("Round3D", "sdf3d/alter/round", "SDF3D/Alter", null, (_s, o) => `${o} -= $width;\n`),
  new Alter3D("Bend3D", "sdf3d/alter/bend", "SDF3D/Alter", (_s, o) => `${o}_p = Bend3d(${o}_p, $amount);\n`, null, ["rotate", "sdf3d_bend"]),
  new Alter3D("Annular3D", "sdf3d/alter/annular", "SDF3D/Alter", null, (_s, o) => `${o} = abs(${o})-0.5*$width;\n`),
  new Morph3D("Morph3D", "SDF3D", "sdf3d/alter/morph", "SDF3D/Alter"),
  new Alter3D(
    "Twist",
    "sdf3d/alter/twist",
    "SDF3D/Alter",
    (s, o) => {
      const axis = Math.round(Number(s.parameters?.axis ?? 0));
      if (axis === 1) return `${o}_p.zx=rotate(${o}_p.zx, ${o}_p.y*$angle*0.01745329251);\n`;
      if (axis === 2) return `${o}_p.xy=rotate(${o}_p.xy, ${o}_p.z*$angle*0.01745329251);\n`;
      return `${o}_p.yz=rotate(${o}_p.yz, ${o}_p.x*$angle*0.01745329251);\n`;
    },
    null,
  ),
  new Distort3D("Distort3D", "SDF3D", "sdf3d/alter/distort", "SDF3D/Alter"),
  // 3D colours
  new ColorItem("Albedo3D", "SDF3D_COLOR", "SDF3D/Color", "albedo"),
  new ColorItem("Metallic3D", "SDF3D_COLOR", "SDF3D/Color", "metallic"),
  new ColorItem("Roughness3D", "SDF3D_COLOR", "SDF3D/Color", "roughness"),
  new ColorItem("Emission3D", "SDF3D_COLOR", "SDF3D/Color", "emission"),
  // textures
  new UniformTex("Uniform", "tex/uniform", "Texture/Generator"),
  new UniformGsTex("GreyscaleUniform", "tex/uniform_gs", "Texture/Generator"),
  new PatternTex("Pattern", "tex/pattern", "Texture/Generator"),
  new FbmTex("FBM", "tex/fbm", "Texture/Generator"),
  new BrightnessContrastTex("BrightnessContrast", "tex/brightness_contrast", "Texture/Filter"),
  new StepTex("Step", "tex/step", "Texture/Filter"),
  new SimpleGradientTex("SimpleGradient", "tex/simple_gradient", "Texture/Filter"),
  new BlendTex("Blend", "tex/blend", "Texture/Filter"),
  new DeformTex("Deform", "tex/deform", "Texture/Filter"),
];

const BY_TYPE = new Map(SDF_ITEM_TYPES.map((t) => [t.itemType, t]));

export function sdfItemType(type: string): SdfItem | undefined {
  return BY_TYPE.get(type);
}
function itemOf(scene: SdfScene): SdfItem {
  const t = BY_TYPE.get(scene.type);
  if (!t) throw new Error(`Unknown Easy SDF item type "${scene.type}"`);
  return t;
}

/* ======================================================================== builder ======================================================================== */

/** get_includes: the library globals a scene needs, its children's included */
export function getIncludes(scene: SdfScene): string[] {
  if (scene.hidden) return [];
  const rv: string[] = [];
  for (const i of itemOf(scene).includes()) if (!rv.includes(i)) rv.push(i);
  for (const c of scene.children ?? []) for (const i of getIncludes(c)) if (!rv.includes(i)) rv.push(i);
  return rv;
}

export function serializeScene(s: SdfScene[]): Dict[] {
  return s.map((i) => {
    const n: Dict = { ...i };
    n.children = serializeScene(i.children ?? []);
    if (i.parameters) {
      n.parameters = {};
      for (const [k, v] of Object.entries(i.parameters)) n.parameters[k] = serializeValue(v);
    }
    if (i.parmexprs) n.parmexprs = { ...i.parmexprs };
    return n;
  });
}

/** Note: Material Maker serializes (rather than deserializes) the children here; values are deserialized all the way down in this port. */
export function deserializeScene(s: Dict[]): SdfScene[] {
  return (s ?? []).map((i) => {
    const n: SdfScene = { ...(i as SdfScene) };
    n.children = deserializeScene(i.children ?? []);
    n.parameters = {};
    for (const [k, v] of Object.entries((i.parameters ?? {}) as Dict)) n.parameters[k] = deserializeValue(v);
    if (i.parmexprs) n.parmexprs = { ...i.parmexprs };
    return n;
  });
}

/** in editor mode parameters become node parameters, named n<index>_<name> */
export function replaceParameters(scene: SdfScene, s: string): string {
  for (const p of itemOf(scene).parameterDefs()) s = s.replaceAll("$" + p.name, `$n${scene.index}_${p.name}`);
  return s;
}

/** outside editor mode, parameters are written into the code as constants */
export function replaceParameterValues(scene: SdfScene, s: string): string {
  for (const p of itemOf(scene).parameterDefs()) {
    const value = scene.parameters?.[p.name] !== undefined ? scene.parameters[p.name] : deserializeValue(p.default);
    switch (p.type) {
      case "boolean":
        s = s.replaceAll("$" + p.name, value ? "true" : "false");
        break;
      case "enum":
        s = s.replaceAll("$" + p.name, p.values?.[Math.round(Number(value ?? 0))]?.value ?? p.values?.[0]?.value ?? "");
        break;
      case "float":
        if (scene.parmexprs?.[p.name] !== undefined) s = s.replaceAll("$" + p.name, scene.parmexprs[p.name]);
        else s = s.replaceAll("$" + p.name, typeof value === "number" ? f9(value) : `(${String(value)})`);
        break;
      case "color": {
        const c = isColor(value) ? value : { r: 0, g: 0, b: 0, a: 1 };
        s = s.replaceAll("$" + p.name, `vec4(${f9(c.r)}, ${f9(c.g)}, ${f9(c.b)}, ${f9(c.a)})`);
        break;
      }
      case "polygon": {
        const pts = ((value as { points?: { x: number; y: number }[] } | null)?.points ?? []).map((v) => `vec2(${f9(v.x)},${f9(v.y)})`);
        s = s.replaceAll("$" + p.name, "{" + pts.join(",") + "}");
        break;
      }
      default:
        console.warn(`Unsupported parameter ${p.name} of type ${p.type}`);
    }
  }
  return s;
}

/** scene_to_shader_model: the code, outputs and (in editor mode) parameters of one item and its children */
export function sceneToShaderModel(scene: SdfScene, uv: string, editor: boolean): Dict {
  if (scene.hidden) return {};
  const t = itemOf(scene);
  const sm = t.sceneToShaderModel(scene, uv, editor);
  if (editor) {
    for (let p of t.parameterDefs()) {
      p = structuredClone(p);
      if (scene.parameters?.[p.name] !== undefined) p.default = serializeValue(scene.parameters[p.name]);
      if (scene.parmexprs?.[p.name] !== undefined) p.parmexpr = scene.parmexprs[p.name];
      p.name = `n${scene.index}_${p.name}`;
      sm.parameters.push(p);
    }
    if (has(sm, "code")) sm.code = replaceParameters(scene, sm.code);
  } else if (has(sm, "code")) sm.code = replaceParameterValues(scene, sm.code);
  if (Object.keys(sm).length) sm.includes = getIncludes(scene);
  return sm;
}

/** get_color_code: the code that sets one colour channel, and the distance that decides where it applies */
export function getColorCode(scene: SdfScene, ctxt: ColorCtxt, editor = false): Dict {
  if (scene.hidden) return {};
  const rv = itemOf(scene).colorCode(scene, ctxt, editor);
  if (has(rv, "color")) rv.color = editor ? replaceParameters(scene, rv.color) : replaceParameterValues(scene, rv.color);
  return rv;
}

export function checkNonZeroParam(scene: SdfScene, name: string, zero = 0.0): boolean {
  if (scene.parmexprs?.[name] !== undefined) return true;
  const v = scene.parameters?.[name];
  return v !== undefined && Math.abs(Number(v) - zero) > 0.0001;
}

export function generateRotate3d(variable: string, scene: SdfScene, editor = true): string {
  let rv = "";
  if (editor || checkNonZeroParam(scene, "angle_y")) rv += `${variable}.zx = rotate(${variable}.zx, radians($angle_y));\n`;
  if (editor || checkNonZeroParam(scene, "angle_x")) rv += `${variable}.yz = rotate(${variable}.yz, radians($angle_x));\n`;
  if (editor || checkNonZeroParam(scene, "angle_z")) rv += `${variable}.xy = rotate(${variable}.xy, radians($angle_z));\n`;
  return rv;
}

/* ---------- editing helpers (the editor window's add / validity rules) ---------- */

/** a new item of a type, its parameters at their defaults (_on_menu_add_shape) */
export function newSceneItem(type: string, index: number): SdfScene {
  const t = itemOf({ type } as SdfScene);
  const parameters: Record<string, ParamValue> = {};
  for (const p of t.parameterDefs()) parameters[p.name] = p.type === "float" ? Number(p.default) : cloneValue(deserializeValue(p.default));
  return { type, index, children: [], parameters };
}

/** the categories an item (or the scene root, when null) may contain (sdf_builder_tree.gd get_valid_children_types) */
export function validChildrenTypes(parent: SdfScene | null, root: SdfScene[]): string[] {
  if (!parent) return root.length ? [itemOf(root[0]).category] : ["SDF2D", "SDF3D"];
  return itemOf(parent).childrenTypes();
}

/** gives indexes to the items that have none, or share one */
export function ensureIndexes(scene: SdfScene[]): void {
  const used = new Set<number>();
  const all: SdfScene[] = [];
  const walk = (l: SdfScene[]) => {
    for (const s of l) {
      all.push(s);
      walk(s.children ?? (s.children = []));
    }
  };
  walk(scene);
  let next = Math.max(0, ...all.map((s) => (typeof s.index === "number" ? s.index : 0))) + 1;
  for (const s of all) {
    if (typeof s.index !== "number" || s.index <= 0 || used.has(s.index)) s.index = next++;
    used.add(s.index);
    if (!s.parameters) s.parameters = {};
  }
}
