/* Types shared by the renderer's modules. */

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  size: number;
  /** when not square: the height (size is then the width) */
  height?: number;
  f32: boolean;
  mipmap: boolean;
}

export class ShaderError extends Error {
  constructor(
    message: string,
    public source: string,
    public log: string,
  ) {
    super(message);
  }
}

/** a texture a sampler reads, and a signature that changes when its content does */
export interface Resolved {
  target: Target | null;
  sig: string;
}

export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}
