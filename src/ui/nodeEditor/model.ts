/* The shader model as material_maker/windows/node_editor edits it: get_model_data of the window and of each
 * parameter, input and output row, so what the editor writes is what Material Maker writes. */
import type { Dict } from "../../engine/gen/base";

export const PARAMETER_TYPES = ["float", "size", "enum", "boolean", "color", "gradient", "curve", "polygon", "polyline", "splines", "pixels", "lattice"] as const;
/** parameter_float.gd CONTROLS: the 2D preview gizmo a float drives */
export const FLOAT_CONTROLS = ["None", "P1.x", "P1.y", "P1.a", "P1.r", "P2.x", "P2.y", "P2.a", "P2.r", "P3.x", "P3.y", "Rect1.x", "Rect1.y", "Radius1.r", "Radius1.a", "Radius11.r", "Radius11.a", "Scale1.x", "Scale1.y", "Angle1.a", "Angle2.a"];

const TYPE_FIELDS: Record<string, string[]> = {
  float: ["min", "max", "step", "default", "control"],
  size: ["first", "last", "default"],
  enum: ["values", "default"],
  boolean: ["default"],
  color: ["default"],
  gradient: ["default"],
  curve: ["default"],
  polygon: ["default"],
  polyline: ["default"],
  splines: ["default"],
  pixels: ["default"],
  lattice: ["default"],
};

/** defaults for a parameter that just changed type */
export function defaultsFor(type: string): Dict {
  switch (type) {
    case "float":
      return { min: 0, max: 1, step: 0.01, default: 0.5, control: "None" };
    case "size":
      return { first: 4, last: 12, default: 10 };
    case "enum":
      return { values: [{ name: "Foo", value: "foo" }], default: 0 };
    case "boolean":
      return { default: false };
    case "color":
      return { default: { r: 1, g: 1, b: 1, a: 1 } };
    case "gradient":
      return { default: { type: "Gradient", interpolation: 1, points: [{ pos: 0, r: 0, g: 0, b: 0, a: 1 }, { pos: 1, r: 1, g: 1, b: 1, a: 1 }] } };
    case "curve":
      return { default: { type: "Curve", points: [{ x: 0, y: 0, ls: 0, rs: 1 }, { x: 1, y: 1, ls: 1, rs: 0 }] } };
    case "polygon":
    case "polyline":
      return { default: { type: "Polygon", points: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.4 }, { x: 0.4, y: 0.7 }] } };
    case "splines":
      return { default: { type: "Splines", values: [], point_groups: [] } };
    case "pixels":
      return { default: { type: "Pixels", w: 8, h: 8, bpp: 1, pl: [{ r: 0, g: 0, b: 0, a: 1 }, { r: 1, g: 1, b: 1, a: 1 }], px: [0, 0] } };
    case "lattice":
      return { default: { type: "Lattice", size: { x: 1, y: 1 }, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] } };
  }
  return {};
}

/** the output row's type is the io type key it carries (output.gd) */
export function outputType(o: Dict): string {
  return o.type && o.type in o ? o.type : (["rgba", "rgb", "f", "sdf2d", "sdf3d", "sdf3dc", "tex3d", "tex3d_gs", "v4v4", "fill"].find((k) => k in o) ?? "rgba");
}

/** node_editor.get_model_data */
export function modelFromDraft(d: Dict, material = false): Dict {
  const data: Dict = { name: d.name ?? "", global: d.global ?? "", instance: d.instance ?? "" };
  // Material Maker always writes code; a model without any keeps none, since an empty one changes how outputs are numbered
  if (d.code !== undefined) data.code = d.code;
  if (d.shortdesc) data.shortdesc = d.shortdesc;
  if (d.longdesc) data.longdesc = d.longdesc;
  const includes = (Array.isArray(d.includes) ? d.includes.join(",") : String(d.includes ?? "")).replaceAll(" ", "");
  if (includes) data.includes = includes.split(",").filter(Boolean);
  data.parameters = (d.parameters ?? []).map((p: Dict) => {
    const r: Dict = {};
    for (const k of TYPE_FIELDS[p.type] ?? []) if (p[k] !== undefined) r[k] = structuredClone(p[k]);
    r.name = p.name ?? "";
    r.label = p.label ?? "";
    r.type = p.type;
    if (p.shortdesc) r.shortdesc = p.shortdesc;
    if (p.longdesc) r.longdesc = p.longdesc;
    return r;
  });
  data.inputs = (d.inputs ?? []).map((i: Dict) => {
    const r: Dict = { name: i.name ?? "", label: i.label ?? "", default: String(i.default ?? "") };
    r.type = i.type;
    if (i.shortdesc) r.shortdesc = i.shortdesc;
    if (i.longdesc) r.longdesc = i.longdesc;
    if (i.function) r.function = true;
    if (i.group_size > 0) r.group_size = i.group_size;
    return r;
  });
  data.outputs = (d.outputs ?? []).map((o: Dict) => {
    const t = outputType(o);
    const r: Dict = { type: t, [t]: String(o[t] ?? "") };
    if (o.shortdesc) r.shortdesc = o.shortdesc;
    if (o.longdesc) r.longdesc = o.longdesc;
    if (o.group_size > 0) r.group_size = o.group_size;
    return r;
  });
  if (material) {
    data.preview_shader = d.preview_shader ?? "";
    data.exports = structuredClone(d.exports ?? {});
  }
  return data;
}

/** what the editor starts from */
export function draftFromModel(sm: Dict): Dict {
  const d = structuredClone(sm ?? {});
  d.parameters ??= [];
  d.inputs ??= [];
  d.outputs = (d.outputs ?? []).map((o: Dict) => ({ ...o, type: outputType(o) }));
  d.includes = Array.isArray(d.includes) ? d.includes.join(",") : (d.includes ?? "");
  return d;
}
