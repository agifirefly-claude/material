/* Port of the paint layers (material_maker/panels/paint/paint_layers.gd and layer_types/*.gd):
 * paint layers (albedo, mr = metallic/roughness, emission, normal, do = depth/occlusion), procedural layers (a paint
 * layer filled by a brush graph kept with it) and mask layers (multiplying the layers they belong to), composited
 * from the bottom up into the seven material maps, and the normal map made from the normal and depth maps. */
import type { Dict } from "../gen/base";
import type { Renderer, Target } from "../render/renderer";
import { GLSL_HEADER, Gpu, gpuFor } from "./gpu";

export const LAYER_PAINT = 0,
  LAYER_PROC = 1,
  LAYER_MASK = 2;

/** what the composited maps are, in Material Maker's order */
export const CHANNELS = ["albedo", "metallic", "roughness", "emission", "normal", "depth", "occlusion"] as const;
export type MapChannel = (typeof CHANNELS)[number];

let layerSerial = 0;

export class Layer {
  /** unique in the session, for React keys and history */
  readonly uid = ++layerSerial;
  name = "New layer";
  index = 0;
  hidden = false;
  layers: Layer[] = [];
  textures: Record<string, Target> = {};
  alpha: Record<MapChannel, number> = { albedo: 1, metallic: 1, roughness: 1, emission: 1, normal: 1, depth: 1, occlusion: 1 };
  /** the brush graph of a procedural layer (serialized) */
  material: Dict = {};
  constructor(public type: number) {}
  get channels(): string[] {
    return this.type === LAYER_MASK ? ["mask"] : ["albedo", "mr", "emission", "normal", "do"];
  }
}

const BLEND_FS = `uniform sampler2D dst; uniform sampler2D input_tex; uniform float modulate; uniform int mode; uniform int mask_count;
uniform sampler2D mask0; uniform sampler2D mask1; uniform sampler2D mask2; uniform sampler2D mask3;
uniform sampler2D mask4; uniform sampler2D mask5; uniform sampler2D mask6; uniform sampler2D mask7;
out vec4 o;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 tex = texelFetch(input_tex, px, 0);
  float m = modulate;
  if (mask_count > 0) m *= texelFetch(mask0, px, 0).r;
  if (mask_count > 1) m *= texelFetch(mask1, px, 0).r;
  if (mask_count > 2) m *= texelFetch(mask2, px, 0).r;
  if (mask_count > 3) m *= texelFetch(mask3, px, 0).r;
  if (mask_count > 4) m *= texelFetch(mask4, px, 0).r;
  if (mask_count > 5) m *= texelFetch(mask5, px, 0).r;
  if (mask_count > 6) m *= texelFetch(mask6, px, 0).r;
  if (mask_count > 7) m *= texelFetch(mask7, px, 0).r;
  vec4 c;
  if (mode == 0) c = vec4(tex.rgb, tex.a*m);
  else if (mode == 1) c = vec4(tex.rrr, tex.b*m);
  else if (mode == 2) c = vec4(tex.ggg, tex.a*m);
  else c = vec4(0.0, 0.0, 0.0, tex.a*m);
  c = clamp(c, 0.0, 1.0);
  vec4 d = texelFetch(dst, px, 0);
  // Godot's canvas blend_mix
  o = vec4(c.rgb*c.a + d.rgb*(1.0-c.a), c.a + d.a*(1.0-c.a));
}`;

// normal_map.gdshader
const NORMAL_MAP_FS = `uniform sampler2D normal_tex; uniform sampler2D depth_tex; uniform float bump_strength; uniform float epsilon; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy * epsilon;
  vec3 normal_from_bump = vec3(0.0);
  normal_from_bump += vec3(-1.0, -1.0, 0.0) * texture(depth_tex, uv+vec2(-epsilon, -epsilon)).rgb;
  normal_from_bump += vec3(0.0, -2.0, 0.0) * texture(depth_tex, uv+vec2(0.0, -epsilon)).rgb;
  normal_from_bump += vec3(1.0, -1.0, 0.0) * texture(depth_tex, uv+vec2(epsilon, -epsilon)).rgb;
  normal_from_bump += vec3(-2.0, 0.0, 0.0) * texture(depth_tex, uv+vec2(-epsilon, 0.0)).rgb;
  normal_from_bump += vec3(2.0, 0.0, 0.0) * texture(depth_tex, uv+vec2(epsilon, 0.0)).rgb;
  normal_from_bump += vec3(-1.0, 1.0, 0.0) * texture(depth_tex, uv+vec2(-epsilon, epsilon)).rgb;
  normal_from_bump += vec3(0.0, 2.0, 0.0) * texture(depth_tex, uv+vec2(0.0, epsilon)).rgb;
  normal_from_bump += vec3(1.0, 1.0, 0.0) * texture(depth_tex, uv+vec2(epsilon, epsilon)).rgb;
  normal_from_bump *= vec3(1.0, -1.0, 0.0);
  normal_from_bump += vec3(0.0, 0.0, -1.0);
  normal_from_bump = normalize(normal_from_bump);
  vec3 painted_normal = 2.0*texture(normal_tex, uv).rgb-vec3(1.0);
  o = vec4(0.5*normalize(mix(painted_normal, normal_from_bump, bump_strength))+vec3(0.5), 1.0);
}`;

const ORM_FS = `uniform sampler2D ao; uniform sampler2D roughness; uniform sampler2D metallic; out vec4 o;
void main() { ivec2 p = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(ao, p, 0).r, texelFetch(roughness, p, 0).r, texelFetch(metallic, p, 0).r, 1.0); }`;

// material.mmg's normal output: $normal_tex($uv)*vec3(-1.0, 1.0, -1.0)+vec3(1.0, 0.0, 1.0)
const NORMAL_GL_FS = `uniform sampler2D n; out vec4 o;
void main() { o = vec4(texelFetch(n, ivec2(gl_FragCoord.xy), 0).rgb*vec3(-1.0, 1.0, -1.0)+vec3(1.0, 0.0, 1.0), 1.0); }`;

export interface NormalOptions {
  paint_normal: boolean;
  paint_depth_as_bump: boolean;
  bump_strength: number;
}

/** The composited maps of a layer stack (the viewports of paint_layers.tscn) */
export class Compositor {
  readonly gpu: Gpu;
  /** the seven maps, the normal map (normal_map), the normal map as the static material outputs it for OpenGL
   *  (normal_gl), and occlusion/roughness/metallic packed (orm) */
  maps: Partial<Record<MapChannel | "normal_map" | "normal_gl" | "orm", Target>> = {};
  private spare: Target | null = null;
  size = 0;
  constructor(public renderer: Renderer) {
    this.gpu = gpuFor(renderer);
  }

  private ensure(size: number) {
    if (size === this.size) return;
    for (const t of Object.values(this.maps)) this.renderer.deleteTarget(t);
    this.renderer.deleteTarget(this.spare);
    this.maps = {};
    for (const c of [...CHANNELS, "normal_map", "normal_gl", "orm"] as const) this.maps[c] = this.renderer.createTarget(size);
    this.spare = this.renderer.createTarget(size);
    this.size = size;
  }

  /** the layers to draw, bottom first, with the masks that apply to each (get_visible_layers) */
  static visibleLayers(layers: Layer[], masks: Target[] = [], out: { layer: Layer; masks: Target[] }[] = []) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.hidden || l.type === LAYER_MASK) continue;
      const m = [...masks];
      for (const cl of l.layers) if (!cl.hidden && cl.type === LAYER_MASK && cl.textures.mask) m.push(cl.textures.mask);
      Compositor.visibleLayers(l.layers, m, out);
      out.push({ layer: l, masks: m });
    }
    return out;
  }

  /** composites the layers into the maps (update_layers_renderer) */
  composite(layers: Layer[], size: number, normal: NormalOptions, parentAlpha?: Map<Layer, Record<MapChannel, number>>) {
    this.ensure(size);
    const gpu = this.gpu;
    const prog = gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + BLEND_FS);
    const visible = Compositor.visibleLayers(layers);
    const alphaOf = parentAlpha ?? effectiveAlphas(layers);
    const blend = (out: MapChannel, tex: Target | undefined, mode: number, modulate: number, masks: Target[]) => {
      if (!tex) return;
      const dst = this.maps[out]!;
      const tmp = this.spare!;
      const values: Record<string, unknown> = { dst, input_tex: tex, modulate, mode: { type: "int", value: mode }, mask_count: { type: "int", value: Math.min(8, masks.length) } };
      masks.slice(0, 8).forEach((m, i) => (values["mask" + i] = m));
      gpu.pass(prog, tmp.fbo, size, size, values as Record<string, never>);
      this.maps[out] = tmp;
      this.spare = dst;
    };
    for (const c of CHANNELS) gpu.clear(this.maps[c]!, c === "normal" ? [0.5, 0.5, 0, 1] : c === "occlusion" ? [1, 1, 1, 1] : [0, 0, 0, 0]);
    for (const { layer: l, masks } of visible) {
      const a = alphaOf.get(l) ?? l.alpha;
      blend("albedo", l.textures.albedo, 0, a.albedo, masks);
      blend("metallic", l.textures.mr, 1, a.metallic, masks);
      blend("roughness", l.textures.mr, 2, a.roughness, masks);
      blend("emission", l.textures.albedo, 3, a.albedo, masks);
      blend("emission", l.textures.emission, 0, a.emission, masks);
      blend("normal", l.textures.normal, 0, a.normal, masks);
      blend("depth", l.textures.do, 1, a.depth, masks);
      blend("occlusion", l.textures.do, 2, a.occlusion, masks);
    }
    // normal map, from the painted normals and the depth as bump (set_normal_options)
    const nm = gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + NORMAL_MAP_FS);
    let bump = 0;
    if (normal.paint_normal) bump = normal.paint_depth_as_bump ? normal.bump_strength : 0;
    else if (normal.paint_depth_as_bump) bump = 1;
    gpu.pass(nm, this.maps.normal_map!.fbo, size, size, { normal_tex: this.maps.normal!, depth_tex: this.maps.depth!, bump_strength: bump, epsilon: 1 / size });
    const gl = gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + NORMAL_GL_FS);
    gpu.pass(gl, this.maps.normal_gl!.fbo, size, size, { n: this.maps.normal_map! });
    const orm = gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + ORM_FS);
    gpu.pass(orm, this.maps.orm!.fbo, size, size, { ao: this.maps.occlusion!, roughness: this.maps.roughness!, metallic: this.maps.metallic! });
  }

  dispose() {
    for (const t of Object.values(this.maps)) this.renderer.deleteTarget(t);
    this.renderer.deleteTarget(this.spare);
    this.maps = {};
    this.size = 0;
  }
}

/** a layer's alphas times those of the layers it is in (update_color_rects) */
export function effectiveAlphas(layers: Layer[], parent?: Record<MapChannel, number>, out = new Map<Layer, Record<MapChannel, number>>()) {
  for (const l of layers) {
    const a = { ...l.alpha };
    if (parent) for (const c of CHANNELS) a[c] *= parent[c];
    out.set(l, a);
    effectiveAlphas(l.layers, a, out);
  }
  return out;
}

/* ---------- the layer tree ---------- */
export function findParentArray(layer: Layer, layers: Layer[]): Layer[] | null {
  for (const l of layers) {
    if (l === layer) return layers;
    const r = findParentArray(layer, l.layers);
    if (r) return r;
  }
  return null;
}

export function allLayers(layers: Layer[], out: Layer[] = []): Layer[] {
  for (const l of layers) {
    out.push(l);
    allLayers(l.layers, out);
  }
  return out;
}

export function unusedLayerIndex(layers: Layer[]): number {
  const used = new Set(allLayers(layers).map((l) => l.index));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}

/** the JSON of a layer in a .mmpp file (MMLayer.save_layer), with its channels' file names */
export function layerData(l: Layer, fileOf: (channel: string, l: Layer) => string): Dict {
  const d: Dict = { name: l.name, type: l.type, index: l.index, hidden: l.hidden };
  for (const c of l.channels) if (l.textures[c]) d[c] = fileOf(c, l);
  if (l.type !== LAYER_MASK) for (const c of CHANNELS) d[c + "_alpha"] = l.alpha[c];
  if (l.type === LAYER_PROC) d.material = l.material;
  if (l.layers.length) d.layers = l.layers.map((x) => layerData(x, fileOf));
  return d;
}
