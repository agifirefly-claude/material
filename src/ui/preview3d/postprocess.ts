/* The 3D preview's post processing (material_maker/panels/preview_3d/post_process_menu.gd, which sets Godot's
 * Environment and CameraAttributes): tone mapping with Godot's white point / AgX contrast, exposure, glow,
 * brightness/contrast/saturation adjustments and depth of field with separate far and near blur. */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { PostProcess } from "./settings";

const TONEMAP_INDEX: Record<PostProcess["tonemap"], number> = { linear: 0, reinhard: 1, filmic: 2, aces: 3, agx: 4 };
export const TONEMAP_LABELS: Record<PostProcess["tonemap"], string> = { linear: "Linear", reinhard: "Reinhard", filmic: "Filmic", aces: "ACES", agx: "AgX" };

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Godot 4's tone mappers (servers/rendering/renderer_rd/shaders/effects/tonemap.glsl), on linear colour */
const TonemapShader = {
  uniforms: { tDiffuse: { value: null }, mode: { value: 3 }, exposure: { value: 1 }, white: { value: 1 }, agxWhite: { value: 16.29 }, agxContrast: { value: 1.25 } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform int mode; uniform float exposure, white, agxWhite, agxContrast; varying vec2 vUv;
vec3 reinhard(vec3 c, float w) { return c * (1.0 + c / (w * w)) / (1.0 + c); }
vec3 filmicCurve(vec3 x) { const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30; return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F; }
vec3 filmic(vec3 c, float w) { const float bias = 2.0; return filmicCurve(c * bias) / filmicCurve(vec3(w * bias)); }
vec3 acesCurve(vec3 x) { const float A = 0.0245786, B = 0.000090537, C = 0.983729, D = 0.432951, E = 0.238081; return (x * (x + A) - B) / (x * (C * x + D) + E); }
vec3 aces(vec3 c, float w) {
  const float bias = 1.8;
  const mat3 rgb_to_rrt = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 odt_to_rgb = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 t = odt_to_rgb * acesCurve(rgb_to_rrt * (c * bias));
  return t / acesCurve(vec3(w * bias));
}
// AgX with Godot's white point (the top of the log2 range) and contrast (the slope of the sigmoid)
vec3 agx(vec3 c, float w, float contrast) {
  const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float minEv = -12.47393;
  float maxEv = log2(max(w, 1.0001));
  c = inset * max(c, vec3(1e-10));
  c = clamp((log2(c) - minEv) / (maxEv - minEv), 0.0, 1.0);
  vec3 x = (c - 0.6060606) * contrast * 2.4;
  vec3 s = 0.5 + 0.5 * x / sqrt(1.0 + x * x);
  c = outset * s;
  return pow(max(c, vec3(0.0)), vec3(2.2));
}
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  vec3 c = t.rgb * exposure;
  if (mode == 1) c = reinhard(c, white);
  else if (mode == 2) c = filmic(c, white);
  else if (mode == 3) c = aces(c, white);
  else if (mode == 4) c = agx(c, agxWhite, agxContrast);
  gl_FragColor = vec4(c, t.a);
}`,
};

/** Godot's adjustment: brightness, then contrast around grey, then saturation, on the tone mapped colour */
const AdjustShader = {
  uniforms: { tDiffuse: { value: null }, brightness: { value: 1 }, contrast: { value: 1 }, saturation: { value: 1 } },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float brightness; uniform float contrast; uniform float saturation; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 col = c.rgb * brightness;
  col = mix(vec3(0.5), col, contrast);
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  gl_FragColor = vec4(col, c.a);
}`,
};

/** Depth of field like Godot's camera attributes: things beyond far distance (ramping over the far transition)
 *  and before near distance (ramping over the near transition) are blurred, up to the blur amount */
const DofShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null as THREE.Texture | null },
    near: { value: 0.05 },
    far: { value: 100 },
    aspect: { value: 1 },
    farOn: { value: true },
    nearOn: { value: false },
    farDist: { value: 10 },
    farTrans: { value: 5 },
    nearDist: { value: 2 },
    nearTrans: { value: 1 },
    amount: { value: 0.1 },
  },
  vertexShader: VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float near, far, aspect, farDist, farTrans, nearDist, nearTrans, amount; uniform bool farOn, nearOn; varying vec2 vUv;
float dist(vec2 uv) { float d = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * near * far / (far + near - d * (far - near)); }
float coc(vec2 uv) {
  float z = dist(uv);
  float c = 0.0;
  if (farOn) c = max(c, smoothstep(farDist, farDist + farTrans, z));
  if (nearOn) c = max(c, 1.0 - smoothstep(nearDist - nearTrans, nearDist, z));
  return c;
}
void main() {
  float c = coc(vUv);
  vec4 sum = texture2D(tDiffuse, vUv);
  float wsum = 1.0;
  float r = c * amount * 0.1;
  if (r > 0.0005) {
    // a golden angle disk; sharp samples weigh less so focused things do not bleed into blurred ones
    for (int i = 1; i < 48; i++) {
      float fi = float(i);
      float a = fi * 2.39996323;
      vec2 o = vec2(cos(a), sin(a)) * sqrt(fi / 48.0) * r * vec2(1.0 / aspect, 1.0);
      float w = min(1.0, coc(vUv + o) + 0.25);
      sum += texture2D(tDiffuse, vUv + o) * w;
      wsum += w;
    }
  }
  gl_FragColor = sum / wsum;
}`,
};

class DofPass extends ShaderPass {
  private cam: THREE.PerspectiveCamera;
  constructor(camera: THREE.PerspectiveCamera) {
    super(DofShader);
    this.cam = camera;
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.near.value = this.cam.near;
    this.uniforms.far.value = this.cam.far;
    this.uniforms.aspect.value = this.cam.aspect;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

export class PostProcessor {
  composer: EffectComposer;
  private render: RenderPass;
  private bloom: UnrealBloomPass;
  private dof: DofPass;
  private tonemap: ShaderPass;
  private output: OutputPass;
  private adjust: ShaderPass;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
    this.composer = new EffectComposer(renderer, target);
    // the second buffer needs a depth texture of its own
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(1, 1);
    this.render = new RenderPass(scene, camera);
    this.dof = new DofPass(camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.4, 0.9);
    this.tonemap = new ShaderPass(TonemapShader);
    this.output = new OutputPass();
    this.adjust = new ShaderPass(AdjustShader);
    for (const p of [this.render, this.dof, this.bloom, this.tonemap, this.output, this.adjust]) this.composer.addPass(p);
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  configure(p: PostProcess) {
    // tone mapping is our own pass (Godot's operators), three's stays off
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    const u = this.tonemap.uniforms;
    u.mode.value = TONEMAP_INDEX[p.tonemap] ?? 3;
    u.exposure.value = p.exposure;
    u.white.value = p.tonemapWhite;
    u.agxWhite.value = p.agxWhite;
    u.agxContrast.value = p.agxContrast;
    this.bloom.enabled = p.glow;
    this.bloom.strength = p.glowIntensity * p.glowStrength;
    this.bloom.threshold = p.glowThreshold;
    this.dof.enabled = p.dof && (p.dofFar || p.dofNear);
    const d = this.dof.uniforms;
    d.farOn.value = p.dofFar;
    d.nearOn.value = p.dofNear;
    d.farDist.value = p.dofFarDistance;
    d.farTrans.value = p.dofFarTransition;
    d.nearDist.value = p.dofNearDistance;
    d.nearTrans.value = p.dofNearTransition;
    d.amount.value = p.dofAmount;
    this.adjust.enabled = p.adjust;
    this.adjust.uniforms.brightness.value = p.brightness;
    this.adjust.uniforms.contrast.value = p.contrast;
    this.adjust.uniforms.saturation.value = p.saturation;
  }

  draw(): void {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
