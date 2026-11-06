/* Port of the painter (material_maker/tools/painter/painter.gd and its shaders).
 * - view to texture (v2t): the mesh drawn from the camera, each pixel holding the UV it shows
 * - texture to view (t2v): the mesh drawn in UV space, each texel holding where it is in the view and whether it is
 *   visible there
 * - the paint pass (paint_shader_template.tres): for every texel of a layer channel, where the brush stroke covers
 *   it, the brush and pattern functions generated from the brush graph's "Brush" node, accumulated into a stroke
 *   texture and applied to the layer.
 * Material Maker writes all channels in one compute dispatch; here each channel is a fragment pass writing the
 * stroke and the layer through two render targets, `discard` standing for the compute shader's early returns. */
import { GenContext } from "../context";
import type { Gen } from "../gen/base";
import { registry } from "../registry";
import { ShaderCode, ShaderUniform } from "../shader-code";
import type { Renderer, Target } from "../render/renderer";
import { GLSL_HEADER, Gpu, gpuFor, type RT, type UniformInput } from "./gpu";
import { removeConstantDeclarations } from "../util";
import { mapGeneratorFor } from "./mapgen";
import type { PaintMesh } from "./mesh";

export interface PaintChannelDef {
  name: string;
  type: "rgba" | "ggaa" | "111a";
  conditions: string[];
  output: number;
}
export const PAINT_CHANNELS: PaintChannelDef[] = [
  { name: "albedo", type: "rgba", conditions: ["has_albedo"], output: 1 },
  { name: "mr", type: "ggaa", conditions: ["has_metallic", "has_roughness"], output: 2 },
  { name: "emission", type: "rgba", conditions: ["has_emission"], output: 3 },
  { name: "normal", type: "rgba", conditions: ["has_normal"], output: 4 },
  { name: "do", type: "ggaa", conditions: ["has_depth", "has_ao"], output: 5 },
];
export const PAINT_CHANNELS_MASK: PaintChannelDef[] = [{ name: "mask", type: "111a", conditions: ["has_albedo"], output: 6 }];

export interface BrushParams {
  brush_size: number;
  brush_hardness: number;
  brush_opacity: number;
  pattern_scale: number;
  pattern_angle: number;
  jitter: boolean;
  jitter_position: number;
  jitter_size: number;
  jitter_angle: number;
  jitter_opacity: number;
  stroke_seed: number;
  stroke_length: number;
  stroke_angle: number;
  pressure: number;
  tilt: [number, number];
}

export interface PaintOptions {
  texture_space?: boolean;
  /** brush position and previous position, in pixels of the paint view */
  brush_pos: [number, number];
  brush_ppos: [number, number];
  /** size of the paint view (or of the 2D texture view) */
  rect_size?: [number, number];
  texture_center?: [number, number];
  texture_scale?: number;
  erase?: boolean;
  fill?: boolean;
  reset?: boolean;
  brush_size?: number;
  brush_opacity?: number;
  pressure?: number;
  tilt?: [number, number];
}

/** the textures of one channel of the layer being painted (PaintChannel) */
export interface ChannelTextures {
  /** the layer as it was when the stroke started */
  start: Target;
  /** what the stroke has laid down so far */
  stroke: Target;
  /** the layer itself, painted into */
  live: Target;
}

const DO_PAINT = `
void do_paint_rgba(vec4 paint_value, float brush_value, vec4 old_stroke_value, vec4 old_layer_value, out vec4 new_stroke_value, out vec4 new_layer_value) {
  paint_value = clamp(paint_value, vec4(0.0), vec4(1.0));
  brush_value = clamp(brush_value, 0.0, 1.0);
  old_stroke_value = clamp(old_stroke_value, vec4(0.0), vec4(1.0));
  old_layer_value = clamp(old_layer_value, vec4(0.0), vec4(1.0));
  float stroke_alpha = paint_value.a*brush_value;
  float new_alpha = min(1.0, max(stroke_alpha, old_stroke_value.a));
  new_stroke_value = vec4(mix(paint_value.rgb, old_stroke_value.rgb, new_alpha-stroke_alpha), new_alpha);
  float layer_apply_alpha = new_alpha*brush_opacity;
  if (erase) {
    new_layer_value = vec4(old_layer_value.rgb, max(0.0, old_layer_value.a-layer_apply_alpha));
  } else {
    float layer_alpha_sum = min(1.0, layer_apply_alpha + old_layer_value.a);
    new_layer_value = vec4(mix(new_stroke_value.rgb, old_layer_value.rgb, layer_alpha_sum-layer_apply_alpha), layer_alpha_sum);
  }
}
void do_paint_ggaa(vec4 paint_value, float brush_value, vec4 old_stroke_value, vec4 old_layer_value, out vec4 new_stroke_value, out vec4 new_layer_value) {
  paint_value = clamp(paint_value, vec4(0.0), vec4(1.0));
  brush_value = clamp(brush_value, 0.0, 1.0);
  old_stroke_value = clamp(old_stroke_value, vec4(0.0), vec4(1.0));
  old_layer_value = clamp(old_layer_value, vec4(0.0), vec4(1.0));
  vec2 stroke_alpha = paint_value.ba*brush_value;
  vec2 new_alpha = min(vec2(1.0), stroke_alpha + old_stroke_value.ba);
  new_stroke_value = vec4(mix(paint_value.rg, old_stroke_value.rg, new_alpha-stroke_alpha), new_alpha);
  vec2 layer_apply_alpha = new_alpha*brush_opacity;
  if (erase) {
    new_layer_value = vec4(old_layer_value.rg, max(vec2(0.0), old_layer_value.ba-layer_apply_alpha));
  } else {
    vec2 layer_alpha_sum = min(vec2(1.0), layer_apply_alpha + old_layer_value.ba);
    new_layer_value = vec4(mix(new_stroke_value.rg, old_layer_value.rg, layer_alpha_sum-layer_apply_alpha), layer_alpha_sum);
  }
}
void do_paint_111a(vec4 paint_value, float brush_value, vec4 old_stroke_value, vec4 old_layer_value, out vec4 new_stroke_value, out vec4 new_layer_value) {
  paint_value = clamp(paint_value, vec4(0.0), vec4(1.0));
  brush_value = clamp(brush_value, 0.0, 1.0);
  old_stroke_value = clamp(old_stroke_value, vec4(0.0), vec4(1.0));
  old_layer_value = clamp(old_layer_value, vec4(0.0), vec4(1.0));
  float stroke_alpha = paint_value.a*brush_value;
  float new_alpha = min(1.0, max(stroke_alpha, old_stroke_value.a));
  new_stroke_value = vec4(0.0, 0.0, 0.0, new_alpha);
  float layer_apply_alpha = new_alpha*brush_opacity;
  float layer_alpha_sum = min(1.0, layer_apply_alpha + old_layer_value.a);
  new_layer_value = vec4(mix(vec3(erase ? 0.0 : 1.0), old_layer_value.rgb, layer_alpha_sum-layer_apply_alpha), layer_alpha_sum);
}
`;

const PAINT_UNIFORMS = `
uniform bool texture_space;
uniform vec2 viewport_size;
uniform vec2 texture_center;
uniform float texture_scale;
uniform sampler2D tex2view_tex;
uniform sampler2D seams;
uniform vec3 view_back;
uniform vec3 view_right;
uniform vec3 view_up;
uniform sampler2D id_map_tex;
uniform bool use_id_mask;
uniform vec4 id_mask_color;
uniform bool fill;
uniform bool erase;
uniform bool reset;
uniform vec2 brush_position;
uniform vec2 brush_previous_position;
uniform float brush_size;
uniform float brush_opacity;
uniform float brush_hardness;
uniform float pressure;
uniform vec2 tilt;
uniform float pattern_angle;
uniform float pattern_scale;
uniform bool jitter;
uniform float jitter_position;
uniform float jitter_size;
uniform float jitter_angle;
uniform float jitter_opacity;
uniform float stroke_seed;
uniform float stroke_length;
uniform float stroke_angle;
uniform sampler2D mesh_inv_uv_tex;
uniform sampler2D mesh_normal_tex;
uniform sampler2D mesh_tangent_tex;
uniform float elapsed_time;
uniform sampler2D layer_albedo_tex;
uniform sampler2D layer_mr_tex;
uniform sampler2D layer_emission_tex;
uniform sampler2D layer_normal_tex;
uniform sampler2D layer_do_tex;
uniform sampler2D layer_depth_tex;
`;

const VIEW_VS = `in vec3 a_pos; in vec3 a_nrm; in vec4 a_tan; in vec2 a_uv;
uniform mat4 transform;
out vec3 model_vert; out vec2 uv;
void main() {
  model_vert = a_pos; uv = a_uv;
  gl_Position = transform*vec4(a_pos, 1.0);
  gl_Position.y = -gl_Position.y;
}`;
const V2T_FS = `in vec3 model_vert; in vec2 uv; out vec4 outColor;
void main() { outColor = vec4(uv, 0.0, 1.0); }`;
const T2V_VS = `in vec3 a_pos; in vec3 a_nrm; in vec4 a_tan; in vec2 a_uv;
out vec3 model_vert; out vec2 uv;
void main() { model_vert = a_pos; uv = a_uv; gl_Position = vec4(2.0*a_uv-vec2(1.0), 0.0, 1.0); }`;
const T2V_FS = `in vec3 model_vert; in vec2 uv; out vec4 outColor;
uniform mat4 transform; uniform vec2 viewport_size; uniform sampler2D v2t;
void main() {
  float box = 2.0;
  vec2 epsilon = vec2(1.0)/viewport_size;
  float v = 1.0;
  vec4 pos = transform*vec4(model_vert, 1.0);
  pos /= pos.w;
  pos.y = -pos.y;
  vec3 mv = pos.xyz*0.5+vec3(0.5);
  if (mv.x > 0.0 && mv.x < 1.0 && mv.y > 0.0 && mv.y < 1.0) {
    for (float dx = -box; dx <= box; dx += 1.0) for (float dy = -box; dy <= box; dy += 1.0)
      v = min(v, length(texture(v2t, mv.xy+epsilon*vec2(dx, dy)).xy-uv));
  }
  v = clamp(1.0-20.0*v, 0.0, 1.0);
  outColor = vec4(mv.xy, v, 1.0);
}`;

export class Painter {
  readonly gpu: Gpu;
  mesh: PaintMesh | null = null;
  textureSize = 1024;
  /** projection * view * model, column major */
  transform: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  viewportSize: [number, number] = [512, 512];
  viewVectors = { back: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] };
  v2t: RT | null = null;
  t2v: RT | null = null;
  private v2tPixels: Float32Array | null = null;
  brushNode: Gen | null = null;
  paintMask = false;
  params: BrushParams = {
    brush_size: 50,
    brush_hardness: 0.5,
    brush_opacity: 1,
    pattern_scale: 10,
    pattern_angle: 0,
    jitter: true,
    jitter_position: 0,
    jitter_size: 0,
    jitter_angle: 0,
    jitter_opacity: 0,
    stroke_seed: 0,
    stroke_length: 0,
    stroke_angle: 0,
    pressure: 1,
    tilt: [0, 0],
  };
  idMap: Target | null = null;
  idMask: [number, number, number, number] | null = null;
  /** the channels of the layer being painted, by name (albedo, mr, emission, normal, do, mask) */
  channels: Record<string, ChannelTextures> = {};
  private scratch: Target | null = null;
  private programs = new Map<string, { prog: ReturnType<Gpu["program"]>; uniforms: ShaderUniform[] }>();

  constructor(public renderer: Renderer) {
    this.gpu = gpuFor(renderer);
  }

  setMesh(m: PaintMesh | null) {
    this.mesh = m;
    this.updateViewTextures();
  }
  setTextureSize(s: number) {
    if (s === this.textureSize) return;
    this.textureSize = s;
    this.renderer.deleteTarget(this.scratch);
    this.scratch = null;
    this.gpu.deleteRT(this.t2v);
    this.t2v = null;
    this.updateViewTextures();
  }

  private maps() {
    const mg = mapGeneratorFor(this.renderer);
    const m = this.mesh!;
    const s = this.textureSize;
    return { seams: mg.getRT(m, "seams", s), position: mg.get(m, "position", s), normal: mg.get(m, "normal", s), tangent: mg.get(m, "tangent", s) };
  }

  /** the camera moved or the view was resized (update_view) */
  setView(transform: number[], viewport: [number, number], vectors?: { back: number[]; right: number[]; up: number[] }) {
    this.transform = transform;
    this.viewportSize = [Math.max(1, Math.round(viewport[0])), Math.max(1, Math.round(viewport[1]))];
    if (vectors) this.viewVectors = vectors;
    this.updateViewTextures();
  }

  updateViewTextures() {
    if (!this.mesh) return;
    const gpu = this.gpu;
    const [w, h] = this.viewportSize;
    if (!this.v2t || this.v2t.w !== w || this.v2t.h !== h) {
      gpu.deleteRT(this.v2t);
      this.v2t = gpu.target(w, h, { f32: true, nearest: true, depth: true, clamp: true });
    }
    gpu.clear(this.v2t);
    const v2tProg = gpu.program(GLSL_HEADER + VIEW_VS, GLSL_HEADER + V2T_FS);
    gpu.drawMesh(v2tProg, this.mesh, this.v2t.fbo, w, h, { transform: { type: "mat4", value: this.transform } }, { depth: true });
    this.v2tPixels = null;
    const s = this.textureSize;
    if (!this.t2v || this.t2v.w !== s) {
      gpu.deleteRT(this.t2v);
      this.t2v = gpu.target(s, s, { clamp: true });
    }
    gpu.clear(this.t2v);
    const t2vProg = gpu.program(GLSL_HEADER + T2V_VS, GLSL_HEADER + T2V_FS);
    gpu.drawMesh(t2vProg, this.mesh, this.t2v.fbo, s, s, { transform: { type: "mat4", value: this.transform }, viewport_size: [w, h], v2t: this.v2t });
  }

  /** the UV under a point of the view, or null off the mesh (view_to_texture) */
  viewToTexture(x: number, y: number): [number, number] | null {
    if (!this.v2t) return null;
    const [w, h] = this.viewportSize;
    const px = Math.floor(x),
      py = Math.floor(y);
    if (px < 0 || py < 0 || px >= w || py >= h) return null;
    this.v2tPixels ??= this.gpu.read(this.v2t);
    const i = (py * w + px) * 4;
    const r = this.v2tPixels[i],
      g = this.v2tPixels[i + 1],
      b = this.v2tPixels[i + 2];
    if (r === b && g === b) return null;
    return [r, g];
  }

  /* ---------- brush ---------- */
  setBrushNode(node: Gen | null, isMask: boolean) {
    this.brushNode = node;
    this.paintMask = isMask;
    this.programs.clear();
  }
  /** the brush graph changed: shaders are regenerated on the next paint */
  brushChanged() {
    this.programs.clear();
  }
  get brushMode(): string {
    const b = this.brushNode;
    if (!b) return "stamp";
    const def = b.getParameterDef("mode");
    return String(def?.values?.[Number(b.getParameter("mode") ?? 0)]?.value ?? "stamp");
  }
  activeChannels(): PaintChannelDef[] {
    const b = this.brushNode;
    if (!b) return [];
    return (this.paintMask ? PAINT_CHANNELS_MASK : PAINT_CHANNELS).filter((c) => c.conditions.some((k) => !!b.getParameter(k)));
  }

  private replacePredefs(s: string): string {
    s = removeConstantDeclarations(s);
    const a = this.mesh?.aabb ?? { position: [0, 0, 0], size: [1, 1, 1] };
    const v3 = (v: number[]) => `vec3(${v.map((x) => x.toFixed(9)).join(", ")})`;
    return s.replaceAll("mesh_aabb_position", v3(a.position)).replaceAll("mesh_aabb_size", v3(a.size));
  }

  /** the paint pass of one channel (update_brush building paint_shader_template) */
  private paintProgram(c: PaintChannelDef) {
    const key = c.name + "|" + this.brushMode;
    const cached = this.programs.get(key);
    if (cached) return cached;
    const b = this.brushNode!;
    const ctx = new GenContext();
    const brush = b.getShaderCode("brush_uv", 0, ctx);
    const pattern = b.getShaderCode("pattern_uv", c.output, ctx);
    const all = new ShaderCode();
    all.addGlobals(brush.globals);
    all.addGlobals(pattern.globals);
    all.addUniforms(brush.uniforms);
    all.addUniforms(pattern.uniforms);
    const brushCode = brush.code + `brush_value = ${brush.outputValues.f ?? "1.0"};\n`;
    const patternCode =
      pattern.code +
      `vec4 ${c.name}_value = ${pattern.outputValues.rgba ?? "vec4(1.0)"};\n` +
      `vec4 old_${c.name}_stroke_value = texelFetch(${c.name}_stroke, pixel, 0);\n` +
      `vec4 old_${c.name}_layer_value = reset ? vec4(0.0) : texelFetch(${c.name}_layer, pixel, 0);\n` +
      `vec4 new_${c.name}_stroke_value;\nvec4 new_${c.name}_layer_value;\n` +
      `do_paint_${c.type}(${c.name}_value, brush_value, old_${c.name}_stroke_value, old_${c.name}_layer_value, new_${c.name}_stroke_value, new_${c.name}_layer_value);\n` +
      `out_stroke = new_${c.name}_stroke_value;\nout_layer = new_${c.name}_layer_value;\n`;
    const definitions = brush.defs + pattern.defs;
    const used = definitions + brushCode + patternCode;
    const globals = all.getGlobalsString(used);
    const uniforms = all.uniforms.filter((u) => (globals + used).includes(u.name));
    const mode = this.brushMode;
    const stampRotate = mode === "stamp" || c.type === "111a";
    const patternUv =
      mode === "stamp"
        ? "vec2 pattern_uv = 0.5*texture_rotation*(p-b-bv)+vec2(0.5);"
        : mode === "pattern"
          ? "vec2 pattern_uv = pattern_scale*texture_rotation*(vec2(bs.y/bs.x, 1.0)*(view_uv - vec2(0.5, 0.5)));"
          : "vec2 pattern_uv = uv;";
    const fs =
      GLSL_HEADER +
      PAINT_UNIFORMS +
      `uniform sampler2D ${c.name}_layer;\nuniform sampler2D ${c.name}_stroke;\n` +
      uniforms.map((u) => u.declaration()).join("") +
      "const float PI = 3.14159265359;\nconst float TAU = 6.28318530718;\n" +
      registry.shaderFunctions +
      "\nvec2 seams_uv(vec2 uv) { return texture(seams, uv).xy; }\n" +
      this.replacePredefs(globals + definitions) +
      DO_PAINT +
      `layout(location = 0) out vec4 out_stroke;\nlayout(location = 1) out vec4 out_layer;\n` +
      `void main() {
  float _seed_variation_ = 0.0;
  vec4 _controlled_variation_ = vec4(0.0);
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec2 image_size = vec2(textureSize(${c.name}_layer, 0));
  vec2 UV = vec2(pixel)/image_size;
  if (use_id_mask && length(texture(id_map_tex, UV)-id_mask_color) > 0.001) discard;
  vec2 uv; vec2 view_uv; vec2 b; vec2 bv; vec2 bs; vec4 tex2view;
  vec2 jitter_offset = vec2(0.0);
  float jitter_scale = 1.0;
  float jitter_rotation = 0.0;
  float jitter_alpha_scale = 1.0;
  if (jitter) {
    vec3 r = rand3(vec2(stroke_seed, fract(stroke_length*456.34)));
    r.y *= 6.28318530718;
    jitter_offset = jitter_position*r.x*vec2(cos(r.y), sin(r.y));
    jitter_scale = (2.0*fract(r.z)-1.0)*jitter_size+1.0;
    r = rand3(r.xz);
    jitter_rotation = 6.28318530718*(r.x-0.5)*jitter_angle;
    jitter_alpha_scale = (2.0*fract(r.y)-1.0)*jitter_opacity+1.0;
  }
  if (texture_space) {
    uv = UV;
    tex2view = vec4(1.0);
    view_uv = uv;
    float min_size = min(viewport_size.x, viewport_size.y);
    bs = jitter_scale*vec2(brush_size)/min_size;
    b = ((brush_position+jitter_offset-0.5*viewport_size)*texture_scale/min_size+texture_center)/bs;
    bv = ((brush_previous_position-brush_position)*texture_scale/min_size)/bs;
  } else {
    uv = seams_uv(UV);
    tex2view = texture(tex2view_tex, uv);
    if (!fill && tex2view.z < 0.001) discard;
    view_uv = tex2view.xy;
    bs = jitter_scale*vec2(brush_size)/viewport_size;
    b = (brush_position+jitter_offset)/viewport_size/bs;
    bv = (brush_previous_position-brush_position)/viewport_size/bs;
  }
  vec2 p = view_uv/bs;
  float x = clamp(dot(p-b, bv)/dot(bv, bv), 0.0, 1.0);
  vec2 local_uv = p-(b+x*bv);
  float pattern_angle_cos = cos(pattern_angle+jitter_rotation);
  float pattern_angle_sin = sin(pattern_angle+jitter_rotation);
  mat2 texture_rotation = mat2(vec2(pattern_angle_cos, pattern_angle_sin), vec2(-pattern_angle_sin, pattern_angle_cos));
  ${stampRotate ? "local_uv = texture_rotation*local_uv;" : ""}
  if (!fill && (abs(local_uv.x) > 1.0 || abs(local_uv.y) > 1.0)) discard;
  vec2 brush_uv = 0.5*local_uv+vec2(0.5);
  float brush_value;
  if (fill) {
    brush_value = 1.0;
  } else {
${this.replacePredefs(brushCode)}
    brush_value *= jitter_alpha_scale;
    brush_value /= max(0.0001, 1.0-brush_hardness);
    if (brush_value <= 0.0001) discard;
    brush_value = min(brush_value, 1.0);
  }
  ${patternUv}
${this.replacePredefs(patternCode)}
}
`;
    const prog = this.gpu.program(Gpu.FULLSCREEN_VS, fs);
    const entry = { prog, uniforms };
    this.programs.set(key, entry);
    return entry;
  }

  /** the brush's own code check, without painting (for errors in the UI) */
  checkBrush(): string | null {
    try {
      for (const c of this.activeChannels()) this.paintProgram(c);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /* ---------- painting ---------- */
  /** paints one dab (or segment from the previous position) of the stroke into the active channels (in_thread_paint) */
  paint(o: PaintOptions, endOfStroke = false): string[] {
    if (!this.mesh || !this.brushNode) return [];
    const gpu = this.gpu;
    const maps = this.maps();
    const p = this.params;
    const painted: string[] = [];
    const rect = o.rect_size ?? this.viewportSize;
    for (const c of this.activeChannels()) {
      const ch = this.channels[c.name];
      if (!ch) continue;
      const { prog, uniforms } = this.paintProgram(c);
      // the pass reads the stroke so far from a copy and writes the new stroke and layer in place
      this.scratch ??= this.renderer.createTarget(this.textureSize);
      gpu.copy(ch.stroke.tex, this.scratch);
      const values: Record<string, UniformInput> = {
        texture_space: !!o.texture_space,
        viewport_size: rect,
        texture_center: o.texture_center ?? [0.5, 0.5],
        texture_scale: o.texture_scale ?? 1,
        tex2view_tex: this.t2v,
        seams: maps.seams,
        view_back: this.viewVectors.back,
        view_right: this.viewVectors.right,
        view_up: this.viewVectors.up,
        id_map_tex: this.idMap,
        use_id_mask: !!this.idMask && !!this.idMap,
        id_mask_color: this.idMask ?? [0, 0, 0, 0],
        fill: !!o.fill,
        erase: !!o.erase,
        reset: !!o.reset,
        brush_position: o.brush_pos,
        brush_previous_position: o.brush_ppos,
        brush_size: o.brush_size ?? p.brush_size,
        brush_opacity: o.brush_opacity ?? p.brush_opacity,
        brush_hardness: p.brush_hardness,
        pressure: o.pressure ?? p.pressure,
        tilt: o.tilt ?? p.tilt,
        pattern_angle: p.pattern_angle,
        pattern_scale: p.pattern_scale,
        jitter: p.jitter,
        jitter_position: p.jitter_position,
        jitter_size: p.jitter_size,
        jitter_angle: p.jitter_angle,
        jitter_opacity: p.jitter_opacity,
        stroke_seed: p.stroke_seed,
        stroke_length: p.stroke_length,
        stroke_angle: p.stroke_angle,
        mesh_inv_uv_tex: maps.position,
        mesh_normal_tex: maps.normal,
        mesh_tangent_tex: maps.tangent,
        elapsed_time: this.renderer.time,
        ...this.layerTextures(),
        [c.name + "_layer"]: ch.start,
        [c.name + "_stroke"]: this.scratch,
      };
      const fbo = gpu.mrt([ch.stroke.tex, ch.live.tex]);
      gpu.pass(prog, fbo, this.textureSize, this.textureSize, values, uniforms);
      painted.push(c.name);
    }
    if (endOfStroke) this.endStroke();
    return painted;
  }

  /** the stroke is applied: the layer as painted becomes the start of the next stroke, and the stroke is cleared */
  endStroke() {
    for (const c of Object.values(this.channels)) {
      this.gpu.copy(c.live.tex, c.start);
      this.gpu.clear(c.stroke);
    }
  }

  /** the layer being painted, as brushes read it (the "Effect" brushes): as it was when the stroke started */
  private layerTextures(): Record<string, UniformInput> {
    const t = (n: string) => this.channels[n]?.start ?? null;
    return { layer_albedo_tex: t("albedo"), layer_mr_tex: t("mr"), layer_emission_tex: t("emission"), layer_normal_tex: t("normal"), layer_do_tex: t("do"), layer_depth_tex: t("do") };
  }

  /** paints the whole layer (fill) */
  fill(erase: boolean, reset = false): string[] {
    return this.paint({ brush_pos: [0, 0], brush_ppos: [0, 0], erase, fill: true, reset, pressure: 1 }, true);
  }

  /* ---------- the brush outline on the view (brush.gdshader) ---------- */
  private previewProgram() {
    const key = "preview|" + this.brushMode;
    const cached = this.programs.get(key);
    if (cached) return cached;
    const b = this.brushNode!;
    const ctx = new GenContext();
    const mask = b.getShaderCode("uv", 0, ctx);
    const source = b.getShaderCode("uv", 1, new GenContext(ctx));
    const all = new ShaderCode();
    all.addGlobals(source.globals);
    all.addGlobals(mask.globals);
    all.addUniforms(source.uniforms);
    all.addUniforms(mask.uniforms);
    let gen = mask.defs + "\nfloat brush_function(vec2 uv) {\nfloat _seed_variation_ = 0.0;\nvec4 _controlled_variation_ = vec4(0.0);\n" + mask.code + "\nvec2 mm_brush_box = abs(uv-vec2(0.5));\n";
    gen += `return (max(mm_brush_box.x, mm_brush_box.y) < 0.5) ? ${mask.outputValues.f ?? "1.0"} : 0.0;\n}\n`;
    gen += source.defs + "\nvec4 pattern_function(vec2 uv) {\nfloat _seed_variation_ = 0.0;\nvec4 _controlled_variation_ = vec4(0.0);\n" + source.code + `\nreturn ${source.outputValues.rgba ?? "vec4(1.0)"};\n}\n`;
    const globals = all.getGlobalsString(gen);
    const uniforms = all.uniforms.filter((u) => (globals + gen).includes(u.name));
    const mode = this.brushMode;
    const fs =
      GLSL_HEADER +
      `uniform bool texture_space; uniform vec2 rect_size; uniform vec2 brush_pos; uniform vec2 brush_ppos; uniform float brush_size; uniform float brush_hardness;
const float brush_opacity = 1.0;
uniform float jitter_position; uniform float jitter_size; uniform float jitter_angle; uniform float jitter_opacity;
uniform float stroke_length; uniform float stroke_seed; uniform float pattern_scale; uniform float pattern_angle; uniform float pattern_alpha;
uniform sampler2D view2tex_tex; uniform sampler2D mesh_inv_uv_tex; uniform sampler2D mesh_normal_tex; uniform sampler2D mesh_tangent_tex; uniform float elapsed_time;
uniform sampler2D layer_albedo_tex; uniform sampler2D layer_mr_tex; uniform sampler2D layer_emission_tex; uniform sampler2D layer_normal_tex; uniform sampler2D layer_do_tex; uniform sampler2D layer_depth_tex;
` +
      uniforms.map((u) => u.declaration()).join("") +
      "const float PI = 3.14159265359;\nconst float TAU = 6.28318530718;\n" +
      registry.shaderFunctions +
      this.replacePredefs(globals + gen) +
      `
float brush(vec2 uv, float jo) { return clamp(brush_opacity*jo*brush_function(uv)/(1.0-brush_hardness), 0.0, 1.0); }
out vec4 COLOR;
void main() {
  vec2 UV = gl_FragCoord.xy / rect_size;
  vec2 bs; vec2 bp; vec2 bpp; vec2 p;
  vec2 jp = vec2(0.0); float js = 1.0; float ja = 0.0; float jo = 1.0;
  vec3 r = rand3(vec2(stroke_seed, fract(stroke_length*456.34)));
  r.y *= 6.28318530718;
  jp = jitter_position*r.x*vec2(cos(r.y), sin(r.y));
  js = (2.0*fract(r.z)-1.0)*jitter_size+1.0;
  r = rand3(r.xz);
  ja = 6.28318530718*(r.x-0.5)*jitter_angle;
  jo = (2.0*fract(r.y)-1.0)*jitter_opacity+1.0;
  if (texture_space) {
    float min_size = min(rect_size.x, rect_size.y);
    bs = vec2(brush_size*js)/min_size; bp = (brush_pos+jp)/min_size; bpp = (brush_ppos+jp)/min_size;
    p = texture(view2tex_tex, UV).xy/bs;
  } else {
    bs = vec2(brush_size*js)/rect_size; bp = (brush_pos+jp)/rect_size; bpp = (brush_ppos+jp)/rect_size;
    p = UV/bs;
  }
  vec2 b = bp/bs;
  vec2 bv = (bpp-bp)/bs;
  float x = clamp(dot(p-b, bv)/dot(bv, bv), 0.0, 1.0);
  vec2 local_uv = p-(b+x*bv);
${
  mode === "stamp"
    ? `  vec2 local_uv2 = p-b-bv;
  mat2 texture_rotation = mat2(vec2(cos(pattern_angle+ja), sin(pattern_angle+ja)), vec2(-sin(pattern_angle+ja), cos(pattern_angle+ja)));
  local_uv = texture_rotation*local_uv;
  vec2 stamp_limit = step(abs(local_uv), vec2(1.0));
  float a = stamp_limit.x*stamp_limit.y;
  COLOR = vec4(1.0, 1.0, 1.0, a)*pattern_function(0.5*texture_rotation*local_uv2+vec2(0.5)) * vec4(vec3(1.0), brush(0.5*local_uv+vec2(0.5), jo));`
    : mode === "pattern"
      ? `  float a = max(brush(0.5*local_uv+vec2(0.5), jo), pattern_alpha);
  mat2 texture_rotation = mat2(vec2(cos(pattern_angle), sin(pattern_angle)), vec2(-sin(pattern_angle), cos(pattern_angle)));
  vec2 pattern_uv = pattern_scale*texture_rotation*(vec2(bs.y/bs.x, 1.0)*(UV - vec2(0.5, 0.5)));
  COLOR = pattern_function(fract(pattern_uv)) * vec4(vec3(1.0), a);`
      : `  float a = max(brush(0.5*local_uv+vec2(0.5), jo), pattern_alpha);
  vec4 tuv = texture(view2tex_tex, UV);
  COLOR = pattern_function(fract(tuv.xy)) * vec4(vec3(1.0), a*(0.5+0.5*tuv.a));`
}
}
`;
    const prog = this.gpu.program(Gpu.FULLSCREEN_VS, fs);
    const entry = { prog, uniforms };
    this.programs.set(key, entry);
    return entry;
  }

  private previewRT: RT | null = null;
  /** the brush footprint over the view at a position, as an image the size of the view (row 0 at the top) */
  brushPreview(pos: [number, number], ppos: [number, number], patternShown = false, textureSpace = false): RT | null {
    if (!this.brushNode || !this.mesh) return null;
    const [w, h] = this.viewportSize;
    if (!this.previewRT || this.previewRT.w !== w || this.previewRT.h !== h) {
      this.gpu.deleteRT(this.previewRT);
      this.previewRT = this.gpu.target(w, h, { clamp: true });
    }
    const { prog, uniforms } = this.previewProgram();
    const p = this.params;
    const maps = this.maps();
    this.gpu.pass(
      prog,
      this.previewRT.fbo,
      w,
      h,
      {
        // in texture space the positions are texture coordinates times min(w, h), read through view2tex
        texture_space: textureSpace,
        rect_size: [w, h],
        brush_pos: pos,
        brush_ppos: ppos,
        brush_size: p.brush_size,
        brush_hardness: p.brush_hardness,
        jitter_position: p.jitter_position,
        jitter_size: p.jitter_size,
        jitter_angle: p.jitter_angle,
        jitter_opacity: p.jitter_opacity,
        stroke_length: p.stroke_length,
        stroke_seed: p.stroke_seed,
        pattern_scale: p.pattern_scale,
        pattern_angle: p.pattern_angle,
        pattern_alpha: patternShown ? 0.5 : 0,
        view2tex_tex: this.v2t,
        mesh_inv_uv_tex: maps.position,
        mesh_normal_tex: maps.normal,
        mesh_tangent_tex: maps.tangent,
        elapsed_time: this.renderer.time,
        ...this.layerTextures(),
      },
      uniforms,
    );
    return this.previewRT;
  }

  dispose() {
    this.gpu.deleteRT(this.v2t);
    this.gpu.deleteRT(this.t2v);
    this.gpu.deleteRT(this.previewRT);
    this.renderer.deleteTarget(this.scratch);
  }
}
