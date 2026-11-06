/* TAA renders (port of windows/export_taa) and frames of any width and height, in a RenderSession: in the render
 * worker where the browser can. No UI here, so the render worker tests load it. */
import type { Gen } from "../../engine/gen/base";
import { ShaderCode, type TextureRef } from "../../engine/shader-code";
import type { Target } from "../../engine/render/types";
import type { RenderSession } from "../../engine/render/session";
import { imageShaderCode } from "./view";
import { encodeExr } from "./exr";

/** a shader (imageShaderCode) at a time, drawn into a session's target of any width and height */
export async function sessionFrame(ss: RenderSession, sc: ShaderCode, t: Target, time: number): Promise<ImageData> {
  const w = t.size,
    h = t.height ?? t.size;
  ss.time = time;
  ss.renderInto(sc, t);
  const i = ss.read(t, false);
  const px = (await ss.flush())[i] as Uint8ClampedArray<ArrayBuffer> | null;
  return new ImageData(px ?? new Uint8ClampedArray(w * h * 4), w, h);
}

/* ---------- TAA: jittered renders accumulated, averaged and optionally denoised ---------- */
const DIVIDE = `
vec4 mm_average(vec2 uv) { return texture(mm_acc, uv) / mm_taa.x; }
vec4 mm_denoise_1(vec2 uv, vec2 duv, int radius) {
  vec4 color = vec4(0.0);
  float weight = 0.0;
  for (int y = -radius; y < radius + 1; y++) {
    for (int x = -radius; x < radius + 1; x++) {
      color += mm_average(uv + vec2(ivec2(x, y)) * duv);
      weight += 1.0;
    }
  }
  return color / weight;
}
// smartDeNoise, Copyright (c) 2018-2019 Michele Morrone, BSD 2-Clause license (as in Material Maker)
vec4 mm_denoise_2(vec2 uv, vec2 size, float sigma, float kSigma, float threshold) {
  float INV_SQRT_OF_2PI = 0.39894228040143267793994605993439;
  float INV_PI = 0.31830988618379067153776752674503;
  float radius = round(kSigma * sigma);
  float radQ = radius * radius;
  float invSigmaQx2 = 0.5 / (sigma * sigma);
  float invSigmaQx2PI = INV_PI * invSigmaQx2;
  float invThresholdSqx2 = 0.5 / (threshold * threshold);
  float invThresholdSqrt2PI = INV_SQRT_OF_2PI / threshold;
  vec4 centrPx = mm_average(uv);
  float zBuff = 0.0;
  vec4 aBuff = vec4(0.0);
  for (float dx = -radius; dx <= radius; dx++) {
    float pt = sqrt(radQ - dx * dx);
    for (float dy = -pt; dy <= pt; dy++) {
      vec2 d = vec2(dx, dy);
      float blurFactor = exp(-dot(d, d) * invSigmaQx2) * invSigmaQx2PI;
      vec4 walkPx = mm_average(uv + d / size);
      vec4 dC = walkPx - centrPx;
      float deltaFactor = exp(-dot(dC, dC) * invThresholdSqx2) * invThresholdSqrt2PI * blurFactor;
      zBuff += deltaFactor;
      aBuff += deltaFactor * walkPx;
    }
  }
  return aBuff / zBuff;
}
vec4 mm_divide(vec2 uv) {
  vec4 c;
  int mode = int(mm_taa.z);
  if (mode == 1) c = mm_denoise_1(uv, 1.0 / mm_size, int(mm_taa.w));
  else if (mode == 2) c = mm_denoise_2(uv, mm_size, mm_taa2.x, mm_taa2.y, mm_taa2.z);
  else c = mm_average(uv);
  return vec4(pow(max(c.rgb, vec3(0.0)), vec3(mm_taa.y)), c.a);
}
`;

export interface TaaSettings {
  gamma: number;
  denoise: 0 | 1 | 2;
  radius: number;
  sigma: number;
  kSigma: number;
  threshold: number;
}

/** jittered renders summed into `acc`, averaged (and denoised) into `avg`. The targets live in a RenderSession: in the
 *  render worker where the browser can, so thousands of samples never hold up the page. */
export class TaaRender {
  acc: Target;
  avg: Target;
  iteration = 0;
  private accumulate: ShaderCode & { mmMainUv?: string };
  private ref: TextureRef;
  constructor(
    readonly session: RenderSession,
    g: Gen,
    output: number,
    public width: number,
    public height = width,
    /** the jitter's random numbers (tests give a seeded one) */
    private random: () => number = Math.random,
  ) {
    // like Material Maker's TAA window, any width and height: uv still covers 0..1 on both axes
    this.acc = session.createTarget(width, height, true);
    this.avg = session.createTarget(width, height, true);
    const src = imageShaderCode(g, output, Math.max(width, height));
    this.accumulate = Object.assign(new ShaderCode(), src);
    this.accumulate.uniforms = [...src.uniforms];
    this.accumulate.addUniform("mm_jitter", "vec2", [0, 0]);
    this.accumulate.mmMainUv = "(gl_FragCoord.xy + mm_jitter) / mm_size";
    this.ref = session.ref(this.acc, "taa-acc");
  }
  /** one more jittered sample (recorded: it runs at the session's next flush) */
  step(time = performance.now() / 1000): void {
    this.iteration++;
    const u = this.accumulate.uniforms.find((x) => x.name === "mm_jitter")!;
    u.value = [this.random() - 0.5, this.random() - 0.5];
    this.session.time = time;
    // the first sample replaces what the target held, the others add to it
    this.session.renderInto(this.accumulate, this.acc, this.iteration > 1);
  }
  /** the average so far, into `avg` */
  resolve(s: TaaSettings): Target {
    const sc = new ShaderCode();
    sc.addUniform("mm_acc", "sampler2D", this.ref);
    sc.addUniform("mm_taa", "vec4", [Math.max(1, this.iteration), 1 / Math.max(0.01, s.gamma), s.denoise, s.radius]);
    sc.addUniform("mm_taa2", "vec4", [s.sigma, s.kSigma, s.threshold, 0]);
    sc.defs = DIVIDE;
    sc.outputType = "rgba";
    sc.outputValues = { rgba: "mm_divide(uv)" };
    this.session.renderInto(sc, this.avg);
    return this.avg;
  }
  /** draws the average into a canvas */
  async show(s: TaaSettings, ctx: CanvasRenderingContext2D): Promise<void> {
    this.session.present(this.resolve(s), ctx, false);
    await this.session.flush();
  }
  /** the average's pixels: floats (EXR) or bytes (PNG) */
  async pixels(s: TaaSettings, floats: boolean): Promise<Float32Array | Uint8ClampedArray> {
    const i = this.session.read(this.resolve(s), floats);
    const px = (await this.session.flush())[i];
    return px ?? new (floats ? Float32Array : Uint8ClampedArray)(this.width * this.height * 4);
  }
  async png(s: TaaSettings): Promise<Blob> {
    const px = (await this.pixels(s, false)) as Uint8ClampedArray<ArrayBuffer>;
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    c.getContext("2d")!.putImageData(new ImageData(px, this.width, this.height), 0, 0);
    return new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  }
  async exr(s: TaaSettings): Promise<Blob> {
    return new Blob([encodeExr((await this.pixels(s, true)) as Float32Array, this.width, this.height) as BlobPart], { type: "image/x-exr" });
  }
  dispose(): void {
    this.session.dispose();
  }
}
