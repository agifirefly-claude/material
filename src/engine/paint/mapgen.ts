/* Port of MMMapGenerator (addons/material_maker/map_generator): bakes mesh maps into textures.
 * The mesh is rasterized in UV space (gl_Position = uv*2-1) by the map's vertex shader; ray cast maps
 * (ambient occlusion, bent normals, thickness) accumulate one random ray per texel and pass against a BVH;
 * then the postprocess passes run: seams (nearest covered texel, in two separable passes), dilation past the UV
 * islands, normalisation and denoising. Compute passes of the original are full screen fragment passes here. */
import type { Renderer, Target } from "../render/renderer";
import { GLSL_HEADER, Gpu, gpuFor, type RT } from "./gpu";
import { adjacencyColors, buildBvh, curvatureColors, type PaintMesh } from "./mesh";

export type MapName = "position" | "normal" | "tangent" | "ambient_occlusion" | "bent_normals" | "thickness" | "curvature" | "seams" | "adjacency";

type MapDef = { type: "simple" | "curvature" | "adjacency" | "bvh"; vertex: string; fragment: "common" | "normal" | "ao"; mode?: number; postprocess: string[]; dependencies?: MapName[] };

export const MAP_DEFINITIONS: Record<MapName, MapDef> = {
  position: { type: "simple", vertex: "position", fragment: "common", postprocess: ["dilate"], dependencies: ["seams"] },
  normal: { type: "simple", vertex: "normal", fragment: "normal", postprocess: ["dilate"], dependencies: ["seams"] },
  tangent: { type: "simple", vertex: "tangent", fragment: "normal", postprocess: ["dilate"], dependencies: ["seams"] },
  ambient_occlusion: { type: "bvh", vertex: "ao", fragment: "ao", mode: 0, postprocess: ["dilate"], dependencies: ["seams"] },
  bent_normals: { type: "bvh", vertex: "ao", fragment: "ao", mode: 1, postprocess: ["dilate"], dependencies: ["seams"] },
  thickness: { type: "bvh", vertex: "ao", fragment: "ao", mode: 2, postprocess: ["dilate"], dependencies: ["seams"] },
  curvature: { type: "curvature", vertex: "color", fragment: "common", postprocess: ["dilate"], dependencies: ["seams"] },
  seams: { type: "simple", vertex: "position", fragment: "common", postprocess: ["seams_1", "seams_2"] },
  adjacency: { type: "adjacency", vertex: "color", fragment: "common", postprocess: ["adjacency_dilate"], dependencies: ["seams"] },
};

/** the baking settings of Material Maker's preferences (globals.gd) */
/** Material Maker's bake_* preferences (globals.gd defaults); set from the preferences */
export const BAKE_SETTINGS = { ray_count: 64, ao_ray_dist: 128.0, ao_ray_bias: 0.005, denoise_radius: 3 };
/** maps baked with other settings are other maps */
const bakeKey = () => `${BAKE_SETTINGS.ray_count}/${BAKE_SETTINGS.ao_ray_dist}/${BAKE_SETTINGS.ao_ray_bias}/${BAKE_SETTINGS.denoise_radius}`;

const V_IN = "in vec3 a_pos; in vec3 a_nrm; in vec4 a_tan; in vec2 a_uv; in vec3 a_col;\n";
const VERTEX: Record<string, string> = {
  position: `uniform vec3 aabb_position; uniform vec3 aabb_size; out vec3 output_color;
void main() { output_color = (a_pos-aabb_position)/aabb_size; gl_Position = vec4(a_uv*2.0-vec2(1.0), 0.0, 1.0); }`,
  normal: `out vec3 output_color;
void main() { output_color = a_nrm; gl_Position = vec4(a_uv*2.0-vec2(1.0), 0.0, 1.0); }`,
  tangent: `out vec3 output_color;
void main() { output_color = a_tan.xyz; gl_Position = vec4(a_uv*2.0-vec2(1.0), 0.0, 1.0); }`,
  color: `out vec3 output_color;
void main() { output_color = a_col; gl_Position = vec4(a_uv*2.0-vec2(1.0), 0.0, 1.0); }`,
  ao: `out vec3 model_vert; out vec3 normal; out vec2 uv;
void main() { model_vert = a_pos; normal = a_nrm; uv = a_uv; gl_Position = vec4(uv*2.0-vec2(1.0), 0.0, 1.0); }`,
};

const FRAGMENT: Record<string, string> = {
  common: `in vec3 output_color; out vec4 outColor;
void main() { outColor = vec4(output_color, 1.0); }`,
  normal: `in vec3 output_color; out vec4 outColor;
void main() { outColor = vec4(vec3(0.5)+0.5*normalize(output_color), 1.0); }`,
  // ao_fragment.tres, with this port's BVH layout (see mesh.ts buildBvh)
  ao: `in vec3 model_vert; in vec3 normal; in vec2 uv; out vec4 outColor;
uniform highp sampler2D bvh_data;
uniform int tri_offset;
uniform sampler2D prev_iteration_tex;
uniform float max_dist;
uniform float bias_dist;
uniform int iteration;
uniform int mode;
const float PI = 3.1415928;
vec4 get_data(int index) {
  int w = textureSize(bvh_data, 0).x;
  return texelFetch(bvh_data, ivec2(index % w, index / w), 0);
}
float intersect_aabb(vec3 o, vec3 inv, vec3 bmin, vec3 bmax) {
  vec3 t0 = (bmin - o) * inv, t1 = (bmax - o) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float near = max(max(tn.x, tn.y), tn.z), far = min(min(tf.x, tf.y), tf.z);
  if (near > far || far < 0.0) return -1.0;
  return max(near, 0.0);
}
float intersects_triangle(vec3 ray_start, vec3 ray_dir, vec3 v0, vec3 v1, vec3 v2) {
  vec3 e1 = v1 - v0, e2 = v2 - v0;
  vec3 h = cross(ray_dir, e2);
  float a = dot(e1, h);
  if (abs(a) < 0.000001) return -1.0;
  float f = 1.0 / a;
  vec3 s = ray_start - v0;
  float u = f * dot(s, h);
  if (u < 0.0 || u > 1.0) return -1.0;
  vec3 q = cross(s, e1);
  float v = f * dot(ray_dir, q);
  if (v < 0.0 || u + v > 1.0) return -1.0;
  float t = f * dot(e2, q);
  return t > 0.0000001 ? t : -1.0;
}
float intersects_bvh(vec3 o, vec3 d) {
  vec3 inv = 1.0 / d;
  float best = 65536.0;
  int stack[64];
  int sp = 0;
  stack[sp++] = 0;
  for (int guard = 0; guard < 8192 && sp > 0; guard++) {
    int n = stack[--sp];
    vec4 n0 = get_data(2 * n), n1 = get_data(2 * n + 1);
    float t = intersect_aabb(o, inv, n0.xyz, n1.xyz);
    if (t < 0.0 || t > best) continue;
    int count = int(n1.w);
    if (count > 0) {
      int first = int(n0.w);
      for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        int base = tri_offset + 3 * (first + i);
        float tt = intersects_triangle(o, d, get_data(base).xyz, get_data(base + 1).xyz, get_data(base + 2).xyz);
        if (tt > 0.0 && tt < best) best = tt;
      }
    } else if (sp < 62) {
      stack[sp++] = int(n0.w);
      stack[sp++] = n + 1;
    }
  }
  return best;
}
vec3 random_hemi_point(vec3 rand, vec3 norm) {
  float ang1 = (rand.x * 2.0) * PI;
  float u = rand.y * 2.0 - 1.0;
  float sqrt1MinusU2 = sqrt(1.0 - u * u);
  vec3 v = vec3(sqrt1MinusU2 * cos(ang1), sqrt1MinusU2 * sin(ang1), u);
  return v * sign(dot(v, norm));
}
float rand(vec2 co) { return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 model_norm = normalize(normal) * sign(max_dist);
  vec3 true_normal = model_norm;
  vec3 ray_start = model_vert + model_norm * bias_dist;
  vec3 ray_dir;
  for (int i = 0; i < 5; i++) {
    ray_dir = random_hemi_point(vec3(rand(uv + float(iteration)), rand(-uv.yx + float(iteration)), 0.0), model_norm);
    if (dot(ray_dir, true_normal) > 0.0) break;
  }
  float hit = intersects_bvh(ray_start, ray_dir);
  if (mode == 2) {
    if (hit == 65536.0 || hit < 0.0) hit = abs(max_dist);
    hit /= abs(max_dist);
  } else {
    if (hit == 65536.0 || hit < 0.0 || hit > max_dist) hit = 1.0;
    else hit = 1.0 - clamp(dot(model_norm, ray_dir), 0.0, 1.0);
  }
  vec2 tuv = gl_FragCoord.xy / vec2(textureSize(prev_iteration_tex, 0));
  if (mode == 1) outColor = vec4(texture(prev_iteration_tex, tuv).rgb + hit * normalize(ray_dir), 1.0);
  else outColor = vec4(mix(texture(prev_iteration_tex, tuv).rgb, vec3(hit), 1.0 / float(iteration)), 1.0);
}`,
};

/* the postprocess compute shaders, as fragment passes: pixel and uv as Material Maker computes them */
const PP_HEAD = `uniform sampler2D tex; uniform sampler2D seams_map; uniform int pixels; uniform int radius; out vec4 outColor;
vec2 image_size() { return vec2(textureSize(tex, 0)); }
`;
const POSTPROCESS: Record<string, string> = {
  dilate: `void main() { vec2 uv = gl_FragCoord.xy / image_size(); outColor = texture(tex, texture(seams_map, uv).xy); }`,
  seams_1: `vec4 dilate_distance_h(vec2 uv, float size) {
  vec2 e = vec2(1.0/size, 0.0);
  for (int i = 0; i < pixels; ++i) {
    vec2 src_uv = uv+float(i)*e;
    if (texture(tex, src_uv).a >= 1.0) return vec4(src_uv, 1.0, 1.0);
    src_uv = uv-float(i)*e;
    if (texture(tex, src_uv).a >= 1.0) return vec4(src_uv, 1.0, 1.0);
  }
  return vec4(uv, 0.0, 1.0);
}
void main() { vec2 uv = gl_FragCoord.xy / image_size(); outColor = dilate_distance_h(uv, image_size().x); }`,
  seams_2: `vec4 dilate_distance_v(vec2 uv, float size) {
  vec2 e = vec2(0.0, 1.0/size);
  float best_length = 10.0;
  vec4 rv = vec4(uv, 0.0, 1.0);
  for (int i = 0; i < pixels; ++i) {
    vec2 src_uv = uv+float(i)*e;
    vec4 src_color = texture(tex, src_uv);
    if (src_color.b >= 1.0) { float l = length(uv-src_color.xy); if (best_length > l) { best_length = l; rv = src_color; } }
    src_uv = uv-float(i)*e;
    src_color = texture(tex, src_uv);
    if (src_color.b >= 1.0) { float l = length(uv-src_color.xy); if (best_length > l) { best_length = l; rv = src_color; } }
  }
  return rv;
}
void main() { vec2 uv = gl_FragCoord.xy / image_size(); outColor = dilate_distance_v(uv, image_size().y); }`,
  adjacency_dilate: `void main() {
  vec2 uv = gl_FragCoord.xy / image_size();
  vec2 dilated_uv = texture(seams_map, uv).xy;
  outColor = mix(texture(tex, dilated_uv), vec4(uv, 0.0, 1.0), step(length(uv-dilated_uv), 0.001));
}`,
  normalize: `void main() {
  vec4 v = texelFetch(tex, ivec2(gl_FragCoord.xy), 0);
  outColor = v.a == 0.0 ? v : vec4(normalize(v.xyz)*0.5+vec3(0.5), 1.0);
}`,
  denoise: `void main() {
  vec2 uv = floor(gl_FragCoord.xy) / image_size();
  vec4 c0 = texelFetch(tex, ivec2(gl_FragCoord.xy), 0);
  if (c0.a == 0.0) { outColor = c0; return; }
  vec3 color = vec3(0.0);
  float weight = 0.0;
  for (int y = -radius; y < radius+1; y++) for (int x = -radius; x < radius+1; x++) {
    vec4 col = texture(tex, uv + vec2(ivec2(x, y)) / image_size());
    color += col.rgb * col.a;
    weight += col.a;
  }
  outColor = vec4(color / weight, 1.0);
}`,
};

/** Bakes and caches mesh maps (MMMapGenerator.get_map) */
export class MeshMapGenerator {
  readonly gpu: Gpu;
  private maps = new Map<string, RT>();
  private targets = new Map<string, Target>();
  /** called with a progress text while baking */
  onProgress: ((text: string) => void) | null = null;

  constructor(public renderer: Renderer) {
    this.gpu = gpuFor(renderer);
  }

  has(m: PaintMesh, map: MapName, size: number) {
    return this.maps.has(`${m.id}:${map}:${size}:${bakeKey()}`);
  }

  /** the map as a renderer Target (square, linear filtering, repeat) */
  get(m: PaintMesh, map: MapName, size = 2048): Target {
    const key = `${m.id}:${map}:${size}:${bakeKey()}`;
    let t = this.targets.get(key);
    if (t) return t;
    const rt = this.getRT(m, map, size);
    t = this.renderer.createTarget(size);
    this.gpu.copy(rt.tex, t);
    this.targets.set(key, t);
    return t;
  }

  getRT(m: PaintMesh, map: MapName, size = 2048): RT {
    const key = `${m.id}:${map}:${size}:${bakeKey()}`;
    let rt = this.maps.get(key);
    if (rt) return rt;
    for (const d of MAP_DEFINITIONS[map].dependencies ?? []) this.getRT(m, d, size);
    rt = this.generate(m, map, size);
    this.maps.set(key, rt);
    return rt;
  }

  forget(m: PaintMesh) {
    for (const [k, rt] of this.maps)
      if (k.startsWith(m.id + ":")) {
        this.gpu.deleteRT(rt);
        this.maps.delete(k);
      }
    for (const [k, t] of this.targets)
      if (k.startsWith(m.id + ":")) {
        this.renderer.deleteTarget(t);
        this.targets.delete(k);
      }
    this.gpu.forgetMesh(m);
  }

  private generate(m: PaintMesh, map: MapName, size: number): RT {
    const gpu = this.gpu;
    const def = MAP_DEFINITIONS[map];
    this.onProgress?.(`Generating ${map} map`);
    const pixels = Math.floor(size / 4);
    // the seams map needs exact texel values: nearest filtering, no wrapping
    const opts = { f32: false, nearest: map === "seams", clamp: true };
    let texture = gpu.target(size, size, opts);
    gpu.clear(texture);
    const prog = gpu.program(GLSL_HEADER + V_IN + VERTEX[def.vertex], GLSL_HEADER + FRAGMENT[def.fragment]);
    const aabb = { aabb_position: m.aabb.position, aabb_size: m.aabb.size };
    switch (def.type) {
      case "simple":
        gpu.drawMesh(prog, m, texture.fbo, size, size, aabb);
        break;
      case "curvature":
        gpu.drawMesh(prog, m, texture.fbo, size, size, aabb, { extraKey: ":curvature", extra: curvatureColors(m) });
        break;
      case "adjacency":
        gpu.drawMesh(prog, m, texture.fbo, size, size, aabb, { extraKey: ":adjacency", extra: adjacencyColors(m) });
        break;
      case "bvh": {
        const bvh = buildBvh(m.positions);
        const bvhTex = gpu.upload(bvh.width, bvh.height, bvh.data, true);
        const diag = Math.hypot(...m.aabb.size);
        const maxDist = map === "thickness" ? -diag : BAKE_SETTINGS.ao_ray_dist;
        let other = gpu.target(size, size, opts);
        gpu.clear(other);
        for (let i = 0; i < BAKE_SETTINGS.ray_count; i++) {
          gpu.clear(other);
          gpu.drawMesh(prog, m, other.fbo, size, size, { bvh_data: bvhTex, tri_offset: { type: "int", value: bvh.triOffset }, prev_iteration_tex: texture, max_dist: maxDist, bias_dist: BAKE_SETTINGS.ao_ray_bias, iteration: { type: "int", value: i + 1 }, mode: { type: "int", value: def.mode! } });
          [texture, other] = [other, texture];
        }
        gpu.deleteRT(other);
        gpu.deleteRT(bvhTex);
        if (map === "bent_normals") texture = this.postprocess(texture, "normalize", {}, opts);
        texture = this.postprocess(texture, "denoise", { radius: { type: "int", value: BAKE_SETTINGS.denoise_radius } }, opts);
        break;
      }
    }
    if (pixels > 0) {
      for (const p of def.postprocess) {
        const extra: Record<string, unknown> = { pixels: { type: "int", value: pixels } };
        if (p === "dilate" || p === "adjacency_dilate") extra.seams_map = this.maps.get(`${m.id}:seams:${size}`);
        texture = this.postprocess(texture, p, extra, opts);
      }
    }
    this.onProgress?.("");
    return texture;
  }

  private postprocess(src: RT, pass: string, values: Record<string, unknown>, opts: { nearest: boolean; clamp: boolean }): RT {
    const gpu = this.gpu;
    const prog = gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + PP_HEAD + POSTPROCESS[pass]);
    const dst = gpu.target(src.w, src.h, opts);
    gpu.pass(prog, dst.fbo, dst.w, dst.h, { tex: src, ...(values as Record<string, never>) });
    gpu.deleteRT(src);
    return dst;
  }
}

const generators = new WeakMap<Renderer, MeshMapGenerator>();
export function mapGeneratorFor(r: Renderer): MeshMapGenerator {
  let g = generators.get(r);
  if (!g) generators.set(r, (g = new MeshMapGenerator(r)));
  return g;
}
