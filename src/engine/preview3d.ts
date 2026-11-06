/* A 3D preview for the material types that are evaluated in 3D space (Material Maker previews them with Godot
 * spatial shaders): 3D texture materials on an analytic sphere or cube, raymarched SDF materials and sky materials.
 * The shader is built the way Material Maker builds its preview shaders: the material's inputs are substituted into a
 * template with replace_variables, so inline input code lands where the template uses it. */
import { GenContext } from "./context";
import { ShaderCode } from "./shader-code";
import type { GenMaterial } from "./gen/misc";

export type RayShape = "sphere" | "cube";

const COMMON = `
vec3 mm_ro; vec3 mm_rd;
void mm_camera(vec2 uv) {
  float yaw = mm_cam.x, pitch = mm_cam.y, dist = mm_cam.z;
  mat3 ry = mat3(cos(yaw), 0.0, -sin(yaw), 0.0, 1.0, 0.0, sin(yaw), 0.0, cos(yaw));
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(pitch), sin(pitch), 0.0, -sin(pitch), cos(pitch));
  mat3 r = ry * rx;
  mm_ro = r * vec3(0.0, 0.0, dist);
  mm_rd = r * normalize(vec3((uv.x - 0.5) * 0.8, (0.5 - uv.y) * 0.8, -1.0));
}
vec3 mm_background(vec3 rd) {
  return mix(vec3(0.09, 0.095, 0.11), vec3(0.2, 0.21, 0.24), rd.y * 0.5 + 0.5);
}
vec3 mm_shade(vec3 albedo, float metallic, float roughness, vec3 emission, float ao, vec3 n, vec3 v) {
  vec3 l = normalize(vec3(0.6, 0.8, 0.5));
  vec3 h = normalize(l + v);
  float ndl = max(dot(n, l), 0.0), ndh = max(dot(n, h), 0.0), ndv = max(dot(n, v), 1e-3);
  float rough = clamp(roughness, 0.04, 1.0);
  float a2 = pow(rough, 4.0);
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * d * d);
  vec3 F0 = mix(vec3(0.04), albedo, clamp(metallic, 0.0, 1.0));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = ndl / (ndl * (1.0 - k) + k) * ndv / (ndv * (1.0 - k) + k);
  vec3 spec = D * F * G / max(4.0 * ndl * ndv, 1e-3);
  vec3 kd = (1.0 - F) * (1.0 - clamp(metallic, 0.0, 1.0));
  vec3 sky = mix(vec3(0.3, 0.3, 0.33), vec3(0.85, 0.9, 1.0), n.y * 0.5 + 0.5);
  vec3 refl = mix(vec3(0.25), vec3(0.9, 0.95, 1.0), reflect(-v, n).y * 0.5 + 0.5);
  vec3 col = (kd * albedo / 3.14159265 + spec) * ndl * 2.6 + ao * (kd * albedo * sky * 0.35 + F * refl * (1.0 - 0.8 * rough) * 0.6);
  return col + emission;
}
vec4 mm_tonemap(vec3 c) { c = c / (1.0 + c); return vec4(pow(c, vec3(1.0 / 2.2)), 1.0); }
`;

/** substitutes the material's inputs and parameters into GLSL, collecting what they need into `rv` */
function substitute(m: GenMaterial, rv: ShaderCode, ctx: GenContext, variables: ReturnType<GenMaterial["getCommonReplaceVariables"]>, text: string) {
  return m.replaceVariables(text, variables, rv, ctx);
}

export function raymarchPreviewSupported(m: GenMaterial): boolean {
  const names = new Set(m.getInputDefs().map((d) => d.name));
  return names.has("distance") || names.has("sky_tex") || (names.has("albedo_tex") && m.getInputDefs()[0]?.type === "tex3d");
}

/** the preview as a ShaderCode whose rgba output is the shaded image */
export function raymarchPreview(m: GenMaterial, cam: { yaw: number; pitch: number; dist: number }, shape: RayShape): ShaderCode {
  const rv = new ShaderCode();
  const ctx = new GenContext();
  const variables = m.getCommonReplaceVariables("uv", rv);
  m.processParameters(rv, variables, true);
  m.processInputs(rv, variables, ctx, true);
  rv.addUniform("mm_cam", "vec3", [cam.yaw, cam.pitch, cam.dist]);
  rv.defs += COMMON;
  const names = new Set(m.getInputDefs().map((d) => d.name));
  let setup = "mm_camera(uv);\n";
  let shading: string;
  if (names.has("distance")) {
    // material_raymarching
    rv.defs += substitute(
      m,
      rv,
      ctx,
      variables,
      `
vec2 mm_dist(vec3 p) {
  float _seed_variation_ = 0.0;
  vec4 _controlled_variation_ = vec4(0.0);
  if ($flip_y) p *= vec3(1.0, -1.0, 1.0);
  return $distance(p);
}
vec3 mm_normal(vec3 p) {
  vec2 e = vec2(1e-3, 0.0);
  return normalize(mm_dist(p).x - vec3(mm_dist(p - e.xyy).x, mm_dist(p - e.yxy).x, mm_dist(p - e.yyx).x));
}
`,
    );
    setup += `
float mm_t = 0.0; vec2 mm_ds = vec2(1.0); bool mm_hit = false;
for (int i = 0; i < 160; i++) {
  mm_ds = mm_dist(mm_ro + mm_t * mm_rd);
  if (abs(mm_ds.x) < 1e-3) { mm_hit = true; break; }
  mm_t += mm_ds.x;
  if (mm_t > 40.0) break;
}
vec3 p = mm_ro + mm_t * mm_rd;
vec3 mm_n = mm_hit ? mm_normal(p) : vec3(0.0, 1.0, 0.0);
if ($flip_y) { p *= vec3(1.0, -1.0, 1.0); mm_n *= vec3(1.0, -1.0, 1.0); }
`;
    shading = `mm_hit ? mm_tonemap(mm_shade($albedo(vec4(p, mm_ds.y)), $metallic(vec4(p, mm_ds.y)), $roughness(vec4(p, mm_ds.y)), $emission(vec4(p, mm_ds.y)), 1.0, mm_n, -mm_rd)) : vec4(mm_background(mm_rd), 1.0)`;
  } else if (names.has("sky_tex")) {
    shading = "vec4(clamp($sky_tex(vec4(mm_rd * vec3(1.0, 1.0, 1.0), 0.0)), 0.0, 1.0), 1.0)";
  } else {
    // material_3d: the 3D texture on an analytic object, in object coordinates
    setup +=
      shape === "sphere"
        ? `
float mm_b = dot(mm_ro, mm_rd), mm_c = dot(mm_ro, mm_ro) - 0.25, mm_h = mm_b * mm_b - mm_c;
bool mm_hit = mm_h > 0.0 && -mm_b - sqrt(max(mm_h, 0.0)) > 0.0;
vec3 p = mm_ro + (-mm_b - sqrt(max(mm_h, 0.0))) * mm_rd;
vec3 mm_n = normalize(p);
`
        : `
vec3 mm_inv = 1.0 / mm_rd;
vec3 mm_t0 = (-0.5 - mm_ro) * mm_inv, mm_t1 = (0.5 - mm_ro) * mm_inv;
vec3 mm_tmin = min(mm_t0, mm_t1), mm_tmax = max(mm_t0, mm_t1);
float mm_near = max(max(mm_tmin.x, mm_tmin.y), mm_tmin.z), mm_far = min(min(mm_tmax.x, mm_tmax.y), mm_tmax.z);
bool mm_hit = mm_near < mm_far && mm_near > 0.0;
vec3 p = mm_ro + mm_near * mm_rd;
vec3 mm_n = -sign(mm_rd) * step(mm_tmin.yzx, mm_tmin) * step(mm_tmin.zxy, mm_tmin);
`;
    shading = `mm_hit ? mm_tonemap(mm_shade($albedo_color.rgb * $albedo_tex(vec4(p, 0.0)), $metallic * $metallic_tex(vec4(p, 0.0)), $roughness * $roughness_tex(vec4(p, 0.0)), $emission_energy * $emission_tex(vec4(p, 0.0)), mix(1.0, $ao_tex(vec4(p, 0.0)), $ao), mm_n, -mm_rd)) : vec4(mm_background(mm_rd), 1.0)`;
  }
  const setupCode = substitute(m, rv, ctx, variables, setup);
  const before = rv.code;
  rv.code = "";
  const out = substitute(m, rv, ctx, variables, shading);
  rv.code = before + setupCode + rv.code + `vec4 mm_color = ${out};\n`;
  rv.outputType = "rgba";
  rv.outputValues = { rgba: "mm_color" };
  return rv;
}
