/* What the renderer's parts (texture sources, buffer passes) need from the renderer that runs them */
import type { ShaderUniform } from "../shader-code";
import type { BuiltShader } from "./shader-source";
import type { Resolved, ShaderError, Target } from "./types";

export interface CacheEntry {
  sig: string;
  target: Target;
}

export interface RenderHost {
  time: number;
  /** renders that read something live (the time, a camera) say so, so their previews keep refreshing */
  usedTime: boolean;
  errors: Map<string, ShaderError>;
  /** the current texture of each iterate buffer's loop, by generator name */
  loopTextures: Map<string, Target>;
  createTarget(size: number, f32?: boolean, mipmap?: boolean, height?: number): Target;
  deleteTarget(t: Target | null | undefined): void;
  /** the cached target under `key` when it has this size and format, otherwise a new one */
  reuse(key: string, size: number, f32: boolean, mipmap: boolean): Target;
  cached(key: string): CacheEntry | undefined;
  setCached(key: string, entry: CacheEntry | null): void;
  /** copies a picture (row 0 at the top) into a target, a new mipmapped one of `size` when `into` is not given */
  upload(source: TexImageSource, size: number, into?: Target): Target;
  draw(built: BuiltShader, values: Map<string, unknown>, target: Target, blend?: boolean): void;
  resolveUniforms(uniforms: ShaderUniform[], stack: Set<string>): { sig: string; values: Map<string, unknown> };
  /** something loaded later (a picture, the camera): renders should be redone */
  asyncUpdate(): void;
}

export type { Resolved };
