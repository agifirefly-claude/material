/* The Easy SDF builder's own previews (material_maker/windows/sdf_builder/preview_2d.gdshader and preview_3d.gdshader):
 * an editor mode GenSDF, whose item parameters are uniforms and whose distance function takes an item index, drawn
 * either as a 2D view (the scene's isolines, the selected item outlined, the colour channels) or raymarched in 3D.
 * Also the transforms the builder's gizmos are placed with (sdf_builder.gd get_item_transform_2d/3d). */
import * as THREE from "three";
import { GenContext } from "../context";
import type { ShaderCode } from "../shader-code";
import type { GenSDF } from "../gen/sdf";
import type { SdfScene } from "./builder";

/** what the 2D view shows (the builder's View menu) */
export const SDF_VIEW_STYLES = ["SDF and color", "SDF", "Albedo", "Metallic", "Roughness", "Emission"] as const;

export interface Sdf2DView {
  /** centre of the view, in scene coordinates offset by 0.5 as in Material Maker (0.5, 0.5 is the origin) */
  center: { x: number; y: number };
  /** how much of the scene the view spans */
  scale: number;
  style: number;
}
export interface Sdf3DCamera {
  yaw: number;
  pitch: number;
  dist: number;
  /** the point the camera turns around */
  target: [number, number, number];
}

const fns = (g: GenSDF) => ({ d: `${g.genName}_d`, c: `${g.genName}_c` });

/** the 2D view as a ShaderCode whose rgba output is the image (preview_2d.gdshader) */
export function sdfPreview2D(g: GenSDF, view: Sdf2DView, selected: number): ShaderCode {
  const sc = g.getShaderCode("mm_uv", 0, new GenContext());
  const { d, c } = fns(g);
  sc.addUniform("mm_view", "vec4", [view.center.x, view.center.y, view.scale, view.style]);
  sc.addUniform("mm_sel", "int", selected);
  sc.defs += `
float mm_sstep(float v1, float v2) {
  float edgewidth = 0.002*mm_view.z;
  return smoothstep(v1-edgewidth, v1+edgewidth, v2);
}
`;
  sc.code =
    `vec2 mm_uv = mm_view.xy-vec2(0.5)+(uv-0.5)*mm_view.z;
float mm_d = -${d}(mm_uv, 0, _seed_variation_, _controlled_variation_);
float mm_d2 = -${d}(mm_uv, mm_sel, _seed_variation_, _controlled_variation_);
float mm_d3 = -${d}(mm_uv, -mm_sel, _seed_variation_, _controlled_variation_);
float mm_c = 0.5*mm_sstep(0.0, mm_d);
mm_c += mm_sstep(abs(mm_d2), 0.002*mm_view.z);
mm_c += mm_sstep(abs(mm_d3), 0.003*mm_view.z);
mm_c += 0.05*sin(mm_d*251.327412287);
vec4 mm_albedo; float mm_metallic; float mm_roughness; vec3 mm_emission;
${c}(mm_uv, mm_albedo, mm_metallic, mm_roughness, mm_emission, _seed_variation_, _controlled_variation_);
int mm_style = int(mm_view.w);
vec4 mm_image;
if (mm_style == 0) mm_image = clamp(mm_albedo+vec4(vec3(clamp(mm_c, 0.0, 1.0)), 1.0), vec4(0.0), vec4(1.0));
else if (mm_style == 1) mm_image = vec4(vec3(clamp(mm_c, 0.0, 1.0)), 1.0);
else if (mm_style == 2) mm_image = clamp(mm_albedo, vec4(0.0), vec4(1.0));
else if (mm_style == 3) mm_image = vec4(vec3(clamp(mm_metallic, 0.0, 1.0)), 1.0);
else if (mm_style == 4) mm_image = vec4(vec3(clamp(mm_roughness, 0.0, 1.0)), 1.0);
else mm_image = vec4(clamp(mm_emission, 0.0, 1.0), 1.0);
float mm_checker = mod(floor(mm_uv.x*32.0)+floor(mm_uv.y*32.0), 2.0);
vec4 mm_out = vec4(mix(mix(vec3(0.16), vec3(0.2), mm_checker), mm_image.rgb, mm_image.a), 1.0);
`;
  sc.outputType = "rgba";
  sc.outputValues = { rgba: "mm_out" };
  return sc;
}

/** the camera of the 3D view, shared by the shader and the gizmos so they line up */
export function cameraBasis(cam: Sdf3DCamera): { ro: THREE.Vector3; r: THREE.Matrix3 } {
  const { yaw, pitch, dist } = cam;
  const ry = new THREE.Matrix3().set(Math.cos(yaw), 0, Math.sin(yaw), 0, 1, 0, -Math.sin(yaw), 0, Math.cos(yaw));
  const rx = new THREE.Matrix3().set(1, 0, 0, 0, Math.cos(pitch), -Math.sin(pitch), 0, Math.sin(pitch), Math.cos(pitch));
  const r = ry.multiply(rx);
  const ro = new THREE.Vector3(0, 0, dist).applyMatrix3(r).add(new THREE.Vector3(...cam.target));
  return { ro, r };
}
/** half the height of the view at distance 1 */
export const FOV_HALF = 0.4;

/** where a scene point appears in the 3D view, 0..1 (y down), or null behind the camera */
export function project(cam: Sdf3DCamera, p: THREE.Vector3): { x: number; y: number } | null {
  const { ro, r } = cameraBasis(cam);
  const d = p.clone().sub(ro).applyMatrix3(r.clone().transpose());
  if (d.z > -1e-4) return null;
  return { x: 0.5 + d.x / -d.z / (2 * FOV_HALF), y: 0.5 - d.y / -d.z / (2 * FOV_HALF) };
}

/** the 3D view raymarched (preview_3d.gdshader), the selected item tinted */
export function sdfPreview3D(g: GenSDF, cam: Sdf3DCamera, selected: number): ShaderCode {
  const sc = g.getShaderCode("mm_p", 0, new GenContext());
  const { d, c } = fns(g);
  const { ro, r } = cameraBasis(cam);
  const e = r.elements; // column major
  sc.addUniform("mm_ro", "vec3", [ro.x, ro.y, ro.z]);
  sc.addUniform("mm_rx", "vec3", [e[0], e[1], e[2]]);
  sc.addUniform("mm_ry", "vec3", [e[3], e[4], e[5]]);
  sc.addUniform("mm_rz", "vec3", [e[6], e[7], e[8]]);
  sc.addUniform("mm_sel", "int", selected);
  sc.defs += `
float mm_dist(vec3 p) { return ${d}(p, 0, 0.0, vec4(0.0)); }
vec3 mm_normal(vec3 p) {
  vec2 e = vec2(1e-3, 0.0);
  return normalize(mm_dist(p) - vec3(mm_dist(p - e.xyy), mm_dist(p - e.yxy), mm_dist(p - e.yyx)));
}
`;
  sc.code = `
vec3 mm_rd = normalize(mat3(mm_rx, mm_ry, mm_rz) * vec3((uv.x-0.5)*${(2 * FOV_HALF).toFixed(3)}, (0.5-uv.y)*${(2 * FOV_HALF).toFixed(3)}, -1.0));
float mm_t = 0.0; bool mm_hit = false;
for (int i = 0; i < 160; i++) {
  float s = mm_dist(mm_ro + mm_t*mm_rd);
  if (abs(s) < 1e-3) { mm_hit = true; break; }
  mm_t += s;
  if (mm_t > 200.0) break;
}
vec4 mm_out = vec4(mix(vec3(0.11, 0.115, 0.13), vec3(0.22, 0.23, 0.26), mm_rd.y*0.5+0.5), 1.0);
if (mm_hit) {
  vec3 p = mm_ro + mm_t*mm_rd;
  vec3 n = mm_normal(p);
  vec4 albedo; float metallic; float roughness; vec3 emission;
  ${c}(p, albedo, metallic, roughness, emission, _seed_variation_, _controlled_variation_);
  vec3 l = normalize(vec3(0.5, 0.8, 0.6));
  vec3 v = -mm_rd;
  vec3 h = normalize(l+v);
  float spec = pow(max(dot(n, h), 0.0), mix(64.0, 4.0, clamp(roughness, 0.0, 1.0)))*(1.0-0.7*roughness);
  vec3 base = albedo.rgb;
  vec3 col = base*(0.25+0.75*max(dot(n, l), 0.0))*(1.0-0.5*metallic) + mix(vec3(0.04), base, metallic)*spec*2.0 + emission;
  if (mm_sel > 0 && abs(${d}(p, mm_sel, 0.0, vec4(0.0))) < 0.01) col = mix(col, vec3(1.0, 0.55, 0.1), 0.35);
  mm_out = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0/1.6)), 1.0);
}
`;
  sc.outputType = "rgba";
  sc.outputValues = { rgba: "mm_out" };
  return sc;
}

/* ---------- item transforms (sdf_builder.gd) ---------- */
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : d);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** the path of items from the scene root to an item, both included */
export function pathTo(scene: SdfScene[], index: number): SdfScene[] | null {
  for (const s of scene) {
    if (s.index === index) return [s];
    const r = pathTo(s.children, index);
    if (r) return [s, ...r];
  }
  return null;
}

/** get_local_item_transform_2d: translate * scale * rotate */
export function localTransform2D(s: SdfScene | null): THREE.Matrix3 {
  const m = new THREE.Matrix3();
  if (!s) return m;
  const p = s.parameters;
  if ("angle" in p) m.premultiply(new THREE.Matrix3().makeRotation(rad(num(p.angle))));
  if ("scale" in p) m.premultiply(new THREE.Matrix3().makeScale(num(p.scale, 1), num(p.scale, 1)));
  if ("position_x" in p && "position_y" in p) m.premultiply(new THREE.Matrix3().makeTranslation(num(p.position_x), num(p.position_y)));
  return m;
}
/** the transform of the items above one (its parent chain), in which its own parameters are expressed */
export function parentTransform2D(scene: SdfScene[], index: number): THREE.Matrix3 {
  const path = pathTo(scene, index) ?? [];
  const m = new THREE.Matrix3();
  for (const s of path.slice(0, -1)) m.multiply(localTransform2D(s));
  return m;
}

/** get_local_item_transform_3d: translate * scale * rotation (Godot's YXZ euler) */
export function localTransform3D(s: SdfScene | null): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (!s) return m;
  const p = s.parameters;
  if ("angle_x" in p && "angle_y" in p && "angle_z" in p) m.makeRotationFromEuler(new THREE.Euler(rad(num(p.angle_x)), rad(num(p.angle_y)), rad(num(p.angle_z)), "YXZ"));
  else if ("angle" in p) m.makeRotationZ(rad(num(p.angle)));
  if ("scale" in p) m.premultiply(new THREE.Matrix4().makeScale(num(p.scale, 1), num(p.scale, 1), num(p.scale, 1)));
  if ("position_x" in p && "position_y" in p) m.premultiply(new THREE.Matrix4().makeTranslation(num(p.position_x), num(p.position_y), num(p.position_z)));
  return m;
}
export function parentTransform3D(scene: SdfScene[], index: number): THREE.Matrix4 {
  const path = pathTo(scene, index) ?? [];
  const m = new THREE.Matrix4();
  for (const s of path.slice(0, -1)) m.multiply(localTransform3D(s));
  return m;
}
