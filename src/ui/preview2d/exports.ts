/* Exports of the 2D preview (port of panels/preview_2d/export_menu.gd, windows/export_animation and windows/export_taa). */
import { zipSync } from "fflate";
import type { Gen } from "../../engine/gen/base";
import { ShaderCode, type TextureRef } from "../../engine/shader-code";
import type { Renderer, Target } from "../../engine/render/renderer";
import type { RenderService } from "../../engine/render/service";
import { rootOf } from "../../engine/render/maps";
import { downloadBlob } from "../exporting";
import { imageShaderCode } from "./view";
import { encodeExr } from "./exr";

export const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", exr: "image/x-exr" } as const;
export type ImageType = keyof typeof IMAGE_TYPES;

/** a float target as an OpenEXR file (half floats, what Material Maker writes for .exr) */
export function targetExr(r: Renderer, t: Target): Blob {
  return new Blob([encodeExr(r.readPixels(t), t.size, t.height ?? t.size) as BlobPart], { type: IMAGE_TYPES.exr });
}

export function canvasOf(img: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}
export const canvasBlob = (c: HTMLCanvasElement, type: ImageType = "png") => new Promise<Blob>((res) => c.toBlob((b) => res(b!), IMAGE_TYPES[type], 0.92));

/** one output of a node as an image of a given size */
export function renderImage(r: Renderer, g: Gen, output: number, size: number, time?: number, height = size): ImageData {
  if (time !== undefined) r.time = time;
  let t: Target;
  if (height === size) t = r.render(imageShaderCode(g, output, size), size, { preview: false });
  else {
    t = r.createTarget(size, false, false, height);
    r.renderInto(imageShaderCode(g, output, Math.max(size, height)), t);
  }
  const img = r.toImageData(t);
  r.deleteTarget(t);
  return img;
}

/** $node, $output, $resolution and $idx in export file names (interpret_file_name) */
export function interpretFileName(pattern: string, g: Gen, output: number, size: number, project: string): string {
  return pattern.replaceAll("$project", project).replaceAll("$node", g.name).replaceAll("$output", String(output)).replaceAll("$resolution", String(size)).replaceAll("$idx", "01");
}

/** one output of a node as an image (in the render worker where the browser can), once its pictures have loaded */
export async function serviceImage(s: RenderService, g: Gen, output: number, size: number): Promise<ImageData> {
  await s.imagesLoaded(rootOf(g));
  return s.image(imageShaderCode(g, output, size), size, { preview: false });
}

export async function exportImage(s: RenderService, g: Gen, output: number, size: number, type: ImageType, name: string) {
  await s.imagesLoaded(rootOf(g));
  if (type === "exr") {
    const px = await s.floats(imageShaderCode(g, output, size), size, { preview: false, f32: true });
    downloadBlob(new Blob([encodeExr(px, size, size) as BlobPart], { type: IMAGE_TYPES.exr }), `${name}.exr`);
    return;
  }
  const c = canvasOf(await serviceImage(s, g, output, size));
  downloadBlob(await canvasBlob(c, type), `${name}.${type}`);
}

/* ---------- animation ---------- */
export interface AnimationSettings {
  size: number;
  /** frame height, when not square */
  height?: number;
  begin: number;
  end: number;
  images: number;
  /** 0: image sequence; > 0: that many rows; < 0: that many columns */
  spritesheet: number;
}

/** renders the frames at times begin + (end-begin)*i/images and writes a spritesheet PNG or a zip of PNGs */
export async function exportAnimation(svc: RenderService, g: Gen, output: number, s: AnimationSettings, name: string, progress?: (f: number) => void): Promise<Blob> {
  const frames: ImageData[] = [];
  const r = svc.main;
  await svc.imagesLoaded(rootOf(g));
  const saved = svc.time;
  for (let i = 0; i < s.images; i++) {
    const time = s.begin + ((s.end - s.begin) * i) / s.images;
    // square frames render in the worker; others (rare) on the page
    if ((s.height ?? s.size) === s.size) {
      svc.time = time;
      frames.push(await svc.image(imageShaderCode(g, output, s.size), s.size, { preview: false }));
    } else frames.push(renderImage(r, g, output, s.size, time, s.height ?? s.size));
    progress?.((i + 1) / s.images);
    await new Promise((res) => setTimeout(res, 0));
  }
  svc.time = saved;
  if (s.spritesheet === 0) {
    const files: Record<string, Uint8Array> = {};
    const digits = String(s.images).length;
    for (let i = 0; i < frames.length; i++) files[`${name}_${String(i + 1).padStart(digits, "0")}.png`] = new Uint8Array(await (await canvasBlob(canvasOf(frames[i]))).arrayBuffer());
    return new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
  }
  let rows: number, cols: number;
  if (s.spritesheet > 0) {
    rows = s.spritesheet;
    cols = Math.floor((s.images - 1) / rows) + 1;
  } else {
    cols = -s.spritesheet;
    rows = Math.floor((s.images - 1) / cols) + 1;
  }
  const sheet = document.createElement("canvas");
  const fh = s.height ?? s.size;
  sheet.width = s.size * cols;
  sheet.height = fh * rows;
  const ctx = sheet.getContext("2d")!;
  frames.forEach((f, i) => ctx.putImageData(f, s.size * (i % cols), fh * Math.floor(i / cols)));
  return canvasBlob(sheet);
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

export class TaaRender {
  acc: Target;
  avg: Target;
  iteration = 0;
  private accumulate: ShaderCode & { mmMainUv?: string };
  private ref: TextureRef & { target: Target };
  constructor(
    private r: Renderer,
    g: Gen,
    output: number,
    public width: number,
    public height = width,
  ) {
    // like Material Maker's TAA window, any width and height: uv still covers 0..1 on both axes
    this.acc = r.createTarget(width, true, false, height);
    this.avg = r.createTarget(width, true, false, height);
    const src = imageShaderCode(g, output, Math.max(width, height));
    this.accumulate = Object.assign(new ShaderCode(), src);
    this.accumulate.uniforms = [...src.uniforms];
    this.accumulate.addUniform("mm_jitter", "vec2", [0, 0]);
    this.accumulate.mmMainUv = "(gl_FragCoord.xy + mm_jitter) / mm_size";
    this.ref = { kind: "texture", key: "taa-acc", target: this.acc };
  }
  /** one more jittered sample */
  step(): void {
    if (this.iteration === 0) this.r.clearTarget(this.acc);
    this.iteration++;
    const u = this.accumulate.uniforms.find((x) => x.name === "mm_jitter")!;
    u.value = [Math.random() - 0.5, Math.random() - 0.5];
    this.r.time = performance.now() / 1000;
    this.r.renderInto(this.accumulate, this.acc, true);
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
    this.r.renderInto(sc, this.avg);
    return this.avg;
  }
  dispose(): void {
    this.r.deleteTarget(this.acc);
    this.r.deleteTarget(this.avg);
  }
}
