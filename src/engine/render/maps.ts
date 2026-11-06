/* What the exporters need from a renderer: whole pictures, asynchronously. The editor gives them its RenderService
 * (renders in the worker); tests and the command line tool give them a Renderer, which this wraps. */
import type { ShaderCode } from "../shader-code";
import type { Gen } from "../gen/base";
import { Renderer } from "./renderer";

export interface PictureRenderer {
  /** 8 bit pixels of a ShaderCode's output (through its port type's preview), row 0 first */
  image(sc: ShaderCode, size: number): Promise<ImageData>;
  /** float pixels, row 0 first */
  floats(sc: ShaderCode, size: number): Promise<Float32Array>;
  /** resolves when the pictures of the Image nodes under `root` have loaded (Material Maker #758, #729) */
  imagesLoaded(root?: Gen): Promise<void>;
}

export function pictureRenderer(r: Renderer | PictureRenderer): PictureRenderer {
  if (!(r instanceof Renderer)) return r;
  return {
    async image(sc, size) {
      const t = r.render(sc, size);
      try {
        return r.toImageData(t);
      } finally {
        r.deleteTarget(t);
      }
    },
    async floats(sc, size) {
      const t = r.render(sc, size);
      try {
        return r.readPixels(t);
      } finally {
        r.deleteTarget(t);
      }
    },
    imagesLoaded: (root) => r.imagesLoaded(root),
  };
}

/** the project a generator is part of */
export function rootOf(g: Gen): Gen {
  let r = g;
  while (r.parent) r = r.parent as unknown as Gen;
  return r;
}
