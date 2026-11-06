/* The 3D preview's post processing (material_maker/panels/preview_3d/post_process_menu.gd, which sets Godot's
 * Environment): tone mapping and exposure, glow, brightness/contrast/saturation adjustments and depth of field. */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import type { PostProcess } from "./settings";

const TONEMAPS: Record<PostProcess["tonemap"], THREE.ToneMapping> = {
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  filmic: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
};
export const TONEMAP_LABELS: Record<PostProcess["tonemap"], string> = { linear: "Linear", reinhard: "Reinhard", filmic: "Filmic", aces: "ACES", agx: "AgX" };

/** Godot's adjustment: brightness, then contrast around grey, then saturation, on the tone mapped colour */
const AdjustShader = {
  uniforms: { tDiffuse: { value: null }, brightness: { value: 1 }, contrast: { value: 1 }, saturation: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float brightness; uniform float contrast; uniform float saturation; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 col = c.rgb * brightness;
  col = mix(vec3(0.5), col, contrast);
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation);
  gl_FragColor = vec4(col, c.a);
}`,
};

export class PostProcessor {
  composer: EffectComposer;
  private render: RenderPass;
  private bloom: UnrealBloomPass;
  private bokeh: BokehPass;
  private output: OutputPass;
  private adjust: ShaderPass;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.render = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.4, 0.9);
    this.bokeh = new BokehPass(scene, camera, { focus: 3, aperture: 0.002, maxblur: 0.01 });
    this.output = new OutputPass();
    this.adjust = new ShaderPass(AdjustShader);
    for (const p of [this.render, this.bloom, this.bokeh, this.output, this.adjust]) this.composer.addPass(p);
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  configure(p: PostProcess) {
    this.renderer.toneMapping = TONEMAPS[p.tonemap] ?? THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = p.exposure;
    this.bloom.enabled = p.glow;
    this.bloom.strength = p.glowIntensity * p.glowStrength;
    this.bloom.threshold = p.glowThreshold;
    this.bokeh.enabled = p.dof;
    (this.bokeh.uniforms as Record<string, THREE.IUniform>).aperture.value = p.dofAperture;
    (this.bokeh.uniforms as Record<string, THREE.IUniform>).maxblur.value = p.dofMaxBlur;
    this.adjust.enabled = p.adjust;
    this.adjust.uniforms.brightness.value = p.brightness;
    this.adjust.uniforms.contrast.value = p.contrast;
    this.adjust.uniforms.saturation.value = p.saturation;
  }

  draw(focus: number) {
    (this.bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = focus;
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
