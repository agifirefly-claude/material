/* What every renderer shares, whether it draws itself (Renderer, on the page's WebGL context) or writes down what to
 * draw for a worker (Recorder): the cache of renders by key, resolving what each sampler reads (rendering the buffers
 * it reads first) and the signatures that say when something must be drawn again. Both run this same code, so a
 * render in the worker is redone exactly when the same render on the page would be. */
import { ShaderCode, type ShaderUniform, type TextureRef } from "../shader-code";
import { withPreview, type BuiltShader } from "./shader-source";
import { GenBuffer, GenImage, GenIterateBuffer, GenText, GenTextureRef, GenTexture } from "../gen/texture";
import { GenMeshMap, GenWebcam, meshMapHooks } from "../gen/misc";
import { renderBuffer, renderCached, renderIterateBuffer } from "./buffers";
import { ImageSource, TextSource, WebcamSource, type PictureSource } from "./sources";
import type { CacheEntry, RenderHost } from "./host";
import type { Resolved, ShaderError, Target } from "./types";
import type { Gen } from "../gen/base";

/** a generator and everything inside it (subgraphs) */
function* walk(g: Gen): Generator<Gen> {
  yield g;
  const children = (g as unknown as { children?: Gen[] }).children;
  if (Array.isArray(children)) for (const c of children) yield* walk(c);
}

export interface KeyedResult {
  target: Target | null;
  changed: boolean;
  error: ShaderError | null;
  usesTime: boolean;
}

export abstract class HostBase implements RenderHost {
  protected cache = new Map<string, CacheEntry>();
  private pictures: PictureSource | null = null;
  protected get images(): PictureSource {
    return (this.pictures ??= this.pictureSource());
  }
  protected texts: TextSource;
  protected webcam: WebcamSource;
  /** @internal the current texture of each iterate buffer's loop */
  loopTextures = new Map<string, Target>();
  /** called when something loaded asynchronously (an image) and renders should be redone */
  onAsyncUpdate: (() => void) | null = null;
  time = 0;
  /** set when a render (or one of the buffers it read) depends on the time */
  usedTime = false;
  /** errors met while rendering buffers, by buffer key */
  errors = new Map<string, ShaderError>();

  constructor() {
    this.texts = new TextSource(this);
    this.webcam = new WebcamSource(this);
  }

  protected pictureSource(): PictureSource {
    return new ImageSource(this);
  }

  abstract createTarget(size: number, f32?: boolean, mipmap?: boolean, height?: number): Target;
  abstract deleteTarget(t: Target | null | undefined): void;
  abstract upload(source: TexImageSource, size: number, into?: Target): Target;
  abstract draw(built: BuiltShader, values: Map<string, unknown>, target: Target, blend?: boolean): void;
  /** textures only the page's renderer has (baked mesh maps, painted layers, targets the caller holds) */
  protected abstract mainOnly<T>(what: string, get: () => T): T;

  /** @internal */
  reuse(key: string, size: number, f32: boolean, mipmap: boolean): Target {
    const old = this.cache.get(key)?.target;
    if (old && old.size === size && old.f32 === f32 && old.mipmap === mipmap) return old;
    this.deleteTarget(old);
    return this.createTarget(size, f32, mipmap);
  }
  /** @internal */
  cached(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }
  /** @internal */
  setCached(key: string, entry: CacheEntry | null): void {
    if (entry) this.cache.set(key, entry);
    else this.cache.delete(key);
  }
  /** @internal */
  asyncUpdate(): void {
    this.onAsyncUpdate?.();
  }

  /* ---------- resolving samplers ---------- */
  protected resolve(ref: TextureRef, stack: Set<string>): Resolved {
    const meshMap = (ref as TextureRef & { meshMap?: string }).meshMap;
    if (meshMap) return this.mainOnly("mesh map", () => (meshMapHooks.texture?.(this, meshMap) as Resolved | null) ?? { target: null, sig: "nomesh" });
    // a texture the caller already has (TAA accumulation, ...)
    const direct = (ref as TextureRef & { target?: Target }).target;
    if (direct) return this.mainOnly("texture", () => ({ target: direct, sig: ref.key }));
    if (!(ref instanceof GenTextureRef)) return { target: null, sig: "none" };
    const g = ref.gen;
    if (g instanceof GenIterateBuffer && ref.slot === "_loop_tex") {
      const t = this.loopTextures.get(g.genName);
      return { target: t ?? null, sig: "loop" };
    }
    if (stack.has(ref.key)) return { target: null, sig: "cycle" };
    stack.add(ref.key);
    try {
      // textures something else provides (baked mesh maps, painted layers)
      const external = (g as unknown as { externalTarget?: (r: unknown, slot: string) => Resolved | null }).externalTarget;
      if (external) {
        const ext = this.mainOnly(g.getType(), () => external.call(g, this, ref.slot));
        if (ext) return ext;
      }
      if (g instanceof GenBuffer) return renderBuffer(this, g, stack);
      if (g instanceof GenIterateBuffer) return renderIterateBuffer(this, g, stack);
      if (g instanceof GenImage) return this.images.resolve(g);
      if (g instanceof GenText) return this.texts.resolve(g);
      if (g instanceof GenWebcam) return this.webcam.resolve();
      if (g instanceof GenMeshMap || g instanceof GenTexture) return { target: null, sig: "empty" };
      return { target: null, sig: "none" };
    } finally {
      stack.delete(ref.key);
    }
  }

  /** @internal what each uniform of a shader is set to, samplers resolved (and rendered), with a signature of it all */
  resolveUniforms(uniforms: ShaderUniform[], stack: Set<string>): { sig: string; values: Map<string, unknown> } {
    const values = new Map<string, unknown>();
    let sig = "";
    for (const u of uniforms) {
      if (u.type === "sampler2D") {
        const r = u.value && typeof u.value === "object" && "kind" in u.value ? this.resolve(u.value as TextureRef, stack) : { target: null, sig: "none" };
        values.set(u.name, r.target);
        sig += u.name + ":" + r.sig + ";";
      } else {
        values.set(u.name, u.value);
        if (typeof u.value !== "function") sig += u.name + "=" + (Array.isArray(u.value) ? u.value.join(",") : String(u.value)) + ";";
      }
    }
    return { sig, values };
  }

  /** renders and keeps the result under `key`, re-rendering only when the shader or what it reads changed */
  renderKeyed(key: string, sc: ShaderCode, size: number, preview = true, f32 = false): KeyedResult {
    const before = this.cache.get(key)?.sig;
    this.usedTime = false;
    const r = renderCached(this, key, preview ? withPreview(sc, size) : sc, size, f32, false, new Set());
    return { target: r.target, changed: before !== r.sig, error: this.errors.get(key) ?? null, usesTime: this.usedTime };
  }
  forget(key: string): void {
    const c = this.cache.get(key);
    if (c) this.deleteTarget(c.target);
    this.cache.delete(key);
    this.errors.delete(key);
  }

  /** resolves once the pictures of every Image node under `root` have loaded (or failed): exports wait for it, or
   *  an image a render asks for first would be black in the file (Material Maker #758, #729) */
  async imagesLoaded(root?: Gen): Promise<void> {
    if (root) for (const g of walk(root)) if (g instanceof GenImage) this.images.resolve(g);
    await this.images.idle();
  }

  /** frees the renders of nodes that are gone: buffers, iterate buffers, text and pictures no node of `roots` uses
   *  (Material Maker #1539: they were kept until the page closed). Returns how many targets were freed. */
  prune(roots: Gen[]): number {
    const names = new Set<string>();
    const urls = new Set<string>();
    for (const r of roots)
      for (const g of walk(r)) {
        names.add(g.genName);
        if (g instanceof GenImage) urls.add(String(g.getParameter("image") ?? ""));
      }
    let n = 0;
    for (const key of [...this.cache.keys()]) {
      const m = /^(o\d+)_(it_)?tex$/.exec(key);
      if (m && !names.has(m[1])) {
        this.forget(key);
        n++;
      }
    }
    for (const name of [...this.loopTextures.keys()]) if (!names.has(name)) this.loopTextures.delete(name);
    this.images.prune(urls);
    return n;
  }

  /** how many renders it keeps (tests) */
  get cacheSize(): number {
    return this.cache.size;
  }

  /** forgets cached renders (they are redone on demand) */
  clearCache(): void {
    for (const c of this.cache.values()) this.deleteTarget(c.target);
    this.cache.clear();
  }
}
