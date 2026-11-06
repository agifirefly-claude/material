/* Exports of the 2D preview (port of panels/preview_2d/export_menu.gd, windows/export_animation and windows/export_taa). */
import { zipSync } from "fflate";
import type { Gen } from "../../engine/gen/base";
import type { Renderer, Target } from "../../engine/render/renderer";
import type { RenderService } from "../../engine/render/service";
import { sessionFrame } from "./taa";
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
  let frames: ImageData[] = [];
  await svc.imagesLoaded(rootOf(g));
  const saved = svc.time;
  const timeOf = (i: number) => s.begin + ((s.end - s.begin) * i) / s.images;
  const fh = s.height ?? s.size;
  if (fh === s.size) {
    try {
      for (let i = 0; i < s.images; i++) {
        svc.time = timeOf(i);
        frames.push(await svc.image(imageShaderCode(g, output, s.size), s.size, { preview: false }));
        progress?.((i + 1) / s.images);
      }
    } finally {
      svc.time = saved;
    }
  } else {
    // frames that are not square: a target of their own, in a session (in the worker where the browser can)
    await svc.withSession(async (ss) => {
      frames = [];
      const t = ss.createTarget(s.size, fh);
      const sc = imageShaderCode(g, output, Math.max(s.size, fh));
      for (let i = 0; i < s.images; i++) {
        frames.push(await sessionFrame(ss, sc, t, timeOf(i)));
        progress?.((i + 1) / s.images);
      }
    });
  }
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
  sheet.width = s.size * cols;
  sheet.height = fh * rows;
  const ctx = sheet.getContext("2d")!;
  frames.forEach((f, i) => ctx.putImageData(f, s.size * (i % cols), fh * Math.floor(i / cols)));
  return canvasBlob(sheet);
}

export { TaaRender, sessionFrame, type TaaSettings } from "./taa";
