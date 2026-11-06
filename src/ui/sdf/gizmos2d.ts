/* The 2D controls the SDF builder's preview shows for the selected item (material_maker/panels/preview_2d,
 * control_point.gd): points, radii, rectangles and scales, driven by the "control" field of parameter definitions
 * ("P1.x", "RotateScale1.a"...). Values are in the item's parent space; the view maps them to pixels. */
import * as THREE from "three";
import type { ParameterDef } from "../../engine/gen/base";
import type { SdfScene } from "../../engine/sdf/builder";
import type { Sdf2DView } from "../../engine/sdf/preview";

/** control_type of the preview_2d_panel.tscn controls */
export enum ControlType {
  SIMPLE = 0,
  RECT = 1,
  RADIUS = 2,
  SCALE = 3,
  ROTATE_SCALE = 4,
}
/** the controls of preview_2d_panel.tscn: their parent and whether the item's own rotation and scale apply */
export const CONTROLS: Record<string, { parent?: string; type: ControlType; local?: boolean; color: string }> = {
  P1: { type: ControlType.SIMPLE, color: "#ff7700" },
  P2: { type: ControlType.SIMPLE, color: "#0081ff" },
  P3: { type: ControlType.SIMPLE, color: "#00ff61" },
  P11: { parent: "P1", type: ControlType.SIMPLE, local: true, color: "#0081ff" },
  P12: { parent: "P1", type: ControlType.SIMPLE, local: true, color: "#0081ff" },
  RadiusP11: { parent: "P11", type: ControlType.RADIUS, color: "#ffa100" },
  Rect1: { parent: "P1", type: ControlType.RECT, local: true, color: "#ffa100" },
  Radius1: { parent: "P1", type: ControlType.RADIUS, color: "#ffa100" },
  Radius2: { parent: "P2", type: ControlType.RADIUS, color: "#0081ff" },
  Radius11: { parent: "Radius1", type: ControlType.RADIUS, color: "#ffa100" },
  Scale1: { parent: "P1", type: ControlType.SCALE, color: "#ffa100" },
  RotateScale1: { parent: "P1", type: ControlType.ROTATE_SCALE, color: "#ffa100" },
  Angle1: { parent: "P1", type: ControlType.RADIUS, color: "#ffa100" },
  Angle2: { parent: "P1", type: ControlType.RADIUS, color: "#ffa100" },
};

type V2 = { x: number; y: number };
export interface Control2D {
  name: string;
  params: { x?: string; y?: string; r?: string; a?: string };
}

/** the controls an item's parameters use */
export function itemControls(defs: ParameterDef[]): Control2D[] {
  const map = new Map<string, Control2D>();
  for (const d of defs) {
    const m = /^(\w+)\.([xyra])$/.exec(String(d.control ?? ""));
    if (!m || !CONTROLS[m[1]]) continue;
    const c = map.get(m[1]) ?? { name: m[1], params: {} };
    c.params[m[2] as "x"] = d.name;
    map.set(m[1], c);
  }
  return [...map.values()];
}

/** maps values to pixels and back for one view and one selected item (preview_2d_panel.gd value_to_pos / pos_to_value) */
export class View2D {
  constructor(
    public view: Sdf2DView,
    public size: number,
    /** the transform of the selected item's parents */
    public parent: THREE.Matrix3,
    /** the selected item's own rotation (degrees) and scale */
    public localRotate: number,
    public localScale: number,
  ) {}
  valueToPos(v: V2, applyParent = false, applyLocal = false): V2 {
    let p = new THREE.Vector2(v.x, v.y);
    if (applyParent) p = p.applyMatrix3(this.parent);
    if (applyLocal) p = p.rotateAround(new THREE.Vector2(), (this.localRotate * Math.PI) / 180).multiplyScalar(this.localScale);
    const { center, scale } = this.view;
    return { x: ((p.x - center.x + 0.5) * this.size) / scale + 0.5 * this.size, y: ((p.y - center.y + 0.5) * this.size) / scale + 0.5 * this.size };
  }
  posToValue(pos: V2, applyParent = false, applyLocal = false): V2 {
    const { center, scale } = this.view;
    let p = new THREE.Vector2(((pos.x - 0.5 * this.size) * scale) / this.size + center.x - 0.5, ((pos.y - 0.5 * this.size) * scale) / this.size + center.y - 0.5);
    if (applyLocal) p = p.divideScalar(this.localScale || 1).rotateAround(new THREE.Vector2(), (-this.localRotate * Math.PI) / 180);
    if (applyParent) p = p.applyMatrix3(this.parent.clone().invert());
    return { x: p.x, y: p.y };
  }
}

const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

/** control_point.gd get_value */
export function controlValue(c: Control2D, item: SdfScene): V2 {
  const p = item.parameters;
  if (c.params.x || c.params.y) return { x: c.params.x ? num(p[c.params.x], 0) : 0, y: c.params.y ? num(p[c.params.y], 0) : 0 };
  const r = c.params.r ? num(p[c.params.r], 0.25) : 0.25;
  const a = c.params.a ? (num(p[c.params.a], 0) * Math.PI) / 180 : 0;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/** pixel positions of the item's controls (update_position) */
export function controlPositions(controls: Control2D[], item: SdfScene, view: View2D): Map<string, V2> {
  const out = new Map<string, V2>();
  const byName = new Map(controls.map((c) => [c.name, c]));
  const pos = (name: string): V2 => {
    if (out.has(name)) return out.get(name)!;
    const def = CONTROLS[name];
    const c = byName.get(name);
    let v = c ? controlValue(c, item) : { x: 0, y: 0 };
    if (def.type === ControlType.SCALE || def.type === ControlType.ROTATE_SCALE) v = { x: v.x * 0.25, y: v.y * 0.25 };
    let p = view.valueToPos(v, true, !!def.local);
    if (def.parent) {
      const o = view.valueToPos({ x: 0, y: 0 }, true, !!def.local);
      const pp = pos(def.parent);
      p = { x: p.x - o.x + pp.x, y: p.y - o.y + pp.y };
    }
    out.set(name, p);
    return p;
  };
  for (const c of controls) pos(c.name);
  return out;
}

/** the parameter values for a control dragged to a pixel position (_on_Point_gui_input + update_parameters) */
export function dragControl(c: Control2D, to: V2, positions: Map<string, V2>, view: View2D): Record<string, number> {
  const def = CONTROLS[c.name];
  let value = view.posToValue(to, true, !!def.local);
  if (def.parent) {
    const pp = positions.get(def.parent) ?? view.valueToPos({ x: 0, y: 0 }, true, !!def.local);
    const pv = view.posToValue(pp, true, !!def.local);
    value = { x: value.x - pv.x, y: value.y - pv.y };
  }
  const isXy = !!(c.params.x || c.params.y);
  if (isXy) {
    if (!c.params.x) value.x = 0;
    if (!c.params.y) value.y = 0;
  } else {
    const len = Math.hypot(value.x, value.y) || 1e-6;
    if (!c.params.r) {
      value = { x: value.x / len, y: value.y / len };
      if (def.type === ControlType.RADIUS) value = { x: value.x * 0.25, y: value.y * 0.25 };
    }
    if (!c.params.a) value = { x: Math.hypot(value.x, value.y), y: 0 };
  }
  if (def.type === ControlType.SCALE || def.type === ControlType.ROTATE_SCALE) value = { x: value.x * 4, y: value.y * 4 };
  if (def.type === ControlType.RECT) value = { x: Math.abs(value.x), y: Math.abs(value.y) };
  const out: Record<string, number> = {};
  if (c.params.x) out[c.params.x] = value.x;
  if (c.params.y) out[c.params.y] = value.y;
  if (c.params.r) out[c.params.r] = Math.hypot(value.x, value.y);
  if (c.params.a) out[c.params.a] = (Math.atan2(value.y, value.x) * 180) / Math.PI;
  return out;
}

/** what is drawn for a control: a line to its parent, or the rectangle of a Rect or Scale control */
export function controlShape(c: Control2D, positions: Map<string, V2>, view: View2D, item: SdfScene): { lines: [V2, V2][] } {
  const def = CONTROLS[c.name];
  const p0 = positions.get(c.name)!;
  const pp = def.parent ? positions.get(def.parent) ?? view.valueToPos({ x: 0, y: 0 }) : view.valueToPos({ x: 0, y: 0 });
  switch (def.type) {
    case ControlType.RECT: {
      const val = controlValue(c, item);
      const a = view.valueToPos({ x: -val.x, y: val.y }, true, true);
      const o = view.valueToPos({ x: 0, y: 0 }, true, true);
      const p1 = { x: pp.x + a.x - o.x, y: pp.y + a.y - o.y };
      const p2 = { x: 2 * pp.x - p0.x, y: 2 * pp.y - p0.y };
      const p3 = { x: 2 * pp.x - p1.x, y: 2 * pp.y - p1.y };
      return { lines: [[p0, p1], [p1, p2], [p2, p3], [p3, p0]] };
    }
    case ControlType.SCALE:
      return {
        lines: [
          [p0, { x: pp.x, y: p0.y }],
          [{ x: pp.x, y: p0.y }, pp],
          [pp, { x: p0.x, y: pp.y }],
          [{ x: p0.x, y: pp.y }, p0],
        ],
      };
    case ControlType.RADIUS:
    case ControlType.ROTATE_SCALE:
      return { lines: [[pp, p0]] };
  }
  return { lines: [] };
}
