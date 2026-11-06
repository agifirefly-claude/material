/* Textures that come from outside the shaders: pictures (gen_image.gd), text (gen_text.gd) and the camera (gen_webcam.gd) */
import type { GenImage, GenText } from "../gen/texture";
import { isColor } from "../params/types";
import type { RenderHost } from "./host";
import type { Blitter } from "./blit";
import { fnv, type Resolved, type Target } from "./types";

/** uploads a picture into a target, as it is (row 0 is the top) */
export function upload(gl: WebGL2RenderingContext, blitter: Blitter, source: TexImageSource, t: Target, size: number): Target {
  const tmp = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tmp);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  blitter.blit(tmp, t, size);
  gl.deleteTexture(tmp);
  return t;
}
export const pow2 = (w: number, h: number) => 1 << Math.ceil(Math.log2(Math.max(w, h, 1)));

/** what Image nodes read */
export interface PictureSource {
  resolve(g: GenImage): Resolved;
  /** resolves once every picture asked for so far has loaded or failed */
  idle(): Promise<void>;
  /** forgets the pictures of URLs no longer used, freeing their textures */
  prune(used: Set<string>): void;
}

type Picture = { tex: Target | null; w: number; h: number; loading: boolean; error?: string; ready: Promise<void> };

/** pictures by URL, loaded once */
export class ImageSource implements PictureSource {
  private images = new Map<string, Picture>();
  constructor(private host: RenderHost) {}

  async idle(): Promise<void> {
    for (;;) {
      const pending = [...this.images.values()].filter((e) => e.loading).map((e) => e.ready);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  prune(used: Set<string>): void {
    for (const [url, e] of this.images) {
      if (used.has(url) || e.loading) continue;
      this.host.deleteTarget(e.tex);
      this.images.delete(url);
    }
  }

  resolve(g: GenImage): Resolved {
    const url = String(g.getParameter("image") ?? "");
    if (!url) return { target: null, sig: "noimage" };
    let entry = this.images.get(url);
    if (!entry) {
      let done!: () => void;
      const e: Picture = { tex: null, w: 0, h: 0, loading: true, ready: new Promise<void>((res) => (done = res)) };
      entry = e;
      this.images.set(url, e);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        e.tex = this.host.upload(img, pow2(img.width, img.height));
        e.w = img.width;
        e.h = img.height;
        e.loading = false;
        done();
        this.host.asyncUpdate();
      };
      img.onerror = () => {
        e.loading = false;
        e.error = "Cannot load " + url;
        done();
      };
      img.src = url;
    }
    if (entry.tex) {
      g.imageSize = { w: entry.w, h: entry.h };
      return { target: entry.tex, sig: "img:" + url };
    }
    return { target: null, sig: "loading:" + url };
  }
}

/** text drawn with the browser's fonts */
export class TextSource {
  constructor(private host: RenderHost) {}

  resolve(g: GenText): Resolved {
    const p = g.parameters;
    const fg = isColor(p.fg) ? p.fg : { r: 1, g: 1, b: 1, a: 1 };
    const bg = isColor(p.bg) ? p.bg : { r: 0, g: 0, b: 0, a: 1 };
    const num = (k: string, d: number) => g.calculateFloatParameter(k) ?? d;
    const desc = JSON.stringify([p.text, p.font, fg, bg, num("font_size", 32), num("line_spacing", 0), p.alignment, p.center, num("x", 0.1), num("y", 0.1)]);
    const key = g.genName + "_tex";
    const sig = fnv("text" + desc);
    const cached = this.host.cached(key);
    if (cached && cached.sig === sig) return { target: cached.target, sig };
    const size = 512;
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(size, size) : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    const css = (k: typeof fg) => `rgba(${k.r * 255},${k.g * 255},${k.b * 255},${k.a})`;
    ctx.fillStyle = css(bg);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = css(fg);
    const fontSize = num("font_size", 32);
    ctx.font = `${fontSize}px ${String(p.font || "sans-serif")}`;
    const lines = String(p.text ?? "").split("\n");
    const lineHeight = fontSize * 1.2 + num("line_spacing", 0);
    const align = Math.round(Number(p.alignment ?? 0));
    ctx.textAlign = align === 1 ? "center" : align === 2 ? "right" : "left";
    ctx.textBaseline = "top";
    const x = (num("x", 0.1) + (p.center ? 0.5 : 0)) * size;
    let y = (num("y", 0.1) + (p.center ? 0.5 : 0)) * size;
    if (p.center) y -= (lines.length * lineHeight) / 2;
    if (p.center && align === 0) ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    const t = this.host.upload(c as unknown as TexImageSource, size, this.host.reuse(key, size, false, true));
    this.host.setCached(key, { sig, target: t });
    return { target: t, sig };
  }
}

/** the browser's camera, asked for the first time a webcam node is rendered */
export class WebcamSource {
  private cam: { video: HTMLVideoElement | null; target: Target | null; state: "asking" | "on" | "denied" } | null = null;
  constructor(private host: RenderHost) {}

  /** the host forgot its targets */
  reset(): void {
    if (this.cam) this.cam.target = null;
  }

  resolve(): Resolved {
    if (!this.cam) {
      const cam: { video: HTMLVideoElement | null; target: Target | null; state: "asking" | "on" | "denied" } = { video: null, target: null, state: "asking" };
      this.cam = cam;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) cam.state = "denied";
      else
        navigator.mediaDevices
          .getUserMedia({ video: true })
          .then((stream) => {
            const v = document.createElement("video");
            v.muted = true;
            v.playsInline = true;
            v.srcObject = stream;
            return v.play().then(() => {
              cam.video = v;
              cam.state = "on";
              this.host.asyncUpdate();
            });
          })
          .catch(() => (cam.state = "denied"));
    }
    const cam = this.cam;
    if (cam.state !== "on" || !cam.video || !cam.video.videoWidth) return { target: null, sig: "webcam:" + cam.state };
    const size = Math.min(pow2(cam.video.videoWidth, cam.video.videoHeight), 1024);
    if (!cam.target || cam.target.size !== size) {
      this.host.deleteTarget(cam.target);
      cam.target = this.host.createTarget(size, false, true);
    }
    this.host.upload(cam.video, size, cam.target);
    // a live picture: renders that read it refresh like time based ones
    this.host.usedTime = true;
    return { target: cam.target, sig: "webcam:" + this.host.time };
  }
}
