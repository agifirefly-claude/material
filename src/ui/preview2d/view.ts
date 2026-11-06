/* The 2D preview's view (port of panels/preview_2d): the node output is evaluated directly at the view's uv, so
 * zooming out shows what lies outside the unit square (Extend), its repetition (Repeat) or nothing (Clamp), with
 * an optional low-resolution post process and a checkerboard under transparency. */
import { GenContext } from "../../engine/context";
import type { Gen } from "../../engine/gen/base";
import { ShaderCode } from "../../engine/shader-code";
import { withPreview } from "../../engine/render/shader-source";

export const VIEW_MODES = ["Extend", "Repeat", "Clamp"] as const;
/** 0: none, otherwise "Lowres NxN" */
export const POSTPROCESS = [0, 32, 64, 128, 256, 512] as const;
export const GUIDES = ["None", "Corners", "Lines", "Grid"] as const;
export const CHECKER_SIZES = [64, 32, 16] as const;
export const CHECKER_BRIGHTNESS = [
  [1.0, 0.8],
  [0.4, 0.6],
  [0.2, 0.0],
] as const;

export interface View {
  center: { x: number; y: number };
  scale: number;
  mode: number;
  filter: number;
  checkerSize: number;
  checkerBrightness: number;
}
export const defaultView = (): View => ({ center: { x: 0.5, y: 0.5 }, scale: 1.2, mode: 2, filter: 0, checkerSize: 1, checkerBrightness: 1 });

type Hooked = ShaderCode & { mmMainUv?: string; mmOutputWrap?: string };

/** the ShaderCode of a node output as seen through a view. The view is in uniforms, so moving it does not recompile. */
export function viewShaderCode(g: Gen, output: number, view: View, size: number, background = [0.11, 0.115, 0.13]): ShaderCode {
  const src = withPreview(g.getShaderCode("uv", output, new GenContext()), size);
  const sc = Object.assign(new ShaderCode(), src) as Hooked;
  sc.uniforms = [...src.uniforms];
  sc.addUniform("mm_view", "vec4", [view.center.x, view.center.y, view.scale, view.mode]);
  const [b1, b2] = CHECKER_BRIGHTNESS[view.checkerBrightness] ?? CHECKER_BRIGHTNESS[1];
  sc.addUniform("mm_view2", "vec4", [POSTPROCESS[view.filter] ?? 0, CHECKER_SIZES[view.checkerSize] ?? 32, b1, b2]);
  sc.addUniform("mm_view_bg", "vec3", background);
  sc.defs += `
vec2 mm_view_uv(vec2 screen) {
  vec2 v = mm_view.xy + (screen - 0.5) * mm_view.z;
  if (int(mm_view.w) == 1) v = fract(v);
  if (mm_view2.x > 0.0) v = (floor(v * mm_view2.x) + vec2(0.5)) / mm_view2.x;
  return v;
}
vec4 mm_view_compose(vec4 c, vec2 screen) {
  vec2 v = mm_view.xy + (screen - 0.5) * mm_view.z;
  if (int(mm_view.w) == 2 && (v.x < 0.0 || v.x > 1.0 || v.y < 0.0 || v.y > 1.0)) return vec4(mm_view_bg, 1.0);
  if (int(mm_view.w) == 1) v = fract(v);
  float k = mod(floor(v.x * mm_view2.y) + floor(v.y * mm_view2.y), 2.0);
  vec3 bg = vec3(mix(mm_view2.z, mm_view2.w, k));
  return vec4(mix(bg, c.rgb, clamp(c.a, 0.0, 1.0)), 1.0);
}
`;
  // gl_FragCoord row 0 is the top of the canvas once presented
  sc.mmMainUv = "mm_view_uv(gl_FragCoord.xy / mm_size)";
  sc.mmOutputWrap = "mm_view_compose($out, gl_FragCoord.xy / mm_size)";
  return sc;
}

/** the plain image of a node output (for exports): rgba through the port type's preview */
export function imageShaderCode(g: Gen, output: number, size: number): ShaderCode {
  return withPreview(g.getShaderCode("uv", output, new GenContext()), size);
}

type P = { x: number; y: number };
/** value_to_pos: values centred on 0, as the gizmos use them, to canvas pixels */
export function valueToPos(v: P, view: View, size: number): P {
  return { x: (v.x - view.center.x + 0.5) * (size / view.scale) + 0.5 * size, y: (v.y - view.center.y + 0.5) * (size / view.scale) + 0.5 * size };
}
/** pos_to_value */
export function posToValue(p: P, view: View, size: number): P {
  return { x: ((p.x - 0.5 * size) * view.scale) / size + view.center.x - 0.5, y: ((p.y - 0.5 * size) * view.scale) / size + view.center.y - 0.5 };
}
/** uv (0..1) to canvas pixels, for the polygon/lattice/splines/pixels overlays */
export const uvToPos = (u: P, view: View, size: number) => valueToPos({ x: u.x - 0.5, y: u.y - 0.5 }, view, size);
export const posToUv = (p: P, view: View, size: number): P => {
  const v = posToValue(p, view, size);
  return { x: v.x + 0.5, y: v.y + 0.5 };
};
