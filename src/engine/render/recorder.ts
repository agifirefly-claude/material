/* The page's side of the render worker: decides what to draw exactly as Renderer does (it runs the same HostBase
 * code: same cache, same signatures), but instead of drawing it writes down operations for the worker (protocol.ts).
 * Its targets are numbers that name the worker's textures. Pictures are decoded on the page, where the DOM is
 * (createImageBitmap decodes off the main thread), and sent to the worker as ImageBitmaps.
 *
 * One Recorder records for every lane (thumbnails, big views, exports), so they share the renders of Buffer nodes:
 * a Buffer one lane drew is not drawn again for another. The worker keeps the lanes in order where they touch the
 * same targets (hazards.ts). A cached render that a batch still in flight uses is not drawn over: it is drawn into a
 * new target, and the old one deleted once nothing uses it, so a long export never holds a thumbnail up. */
import { HostBase } from "./base";
import { buildFragmentShader, type BuiltShader } from "./shader-source";
import type { ShaderCode, TextureRef } from "../shader-code";
import type { GenImage } from "../gen/texture";
import { pow2, type PictureSource } from "./sources";
import { fnv, ShaderError, type Resolved, type Target } from "./types";
import type { DrawError, Op } from "./protocol";
import { accessesOf } from "./hazards";
import type { CacheEntry } from "./host";

/** a target of the worker, known by its id */
export interface RemoteTarget extends Target {
  id: number;
}

/** what was asked for needs a texture only the page's own renderer has (mesh maps, paint layers...) */
export class MainOnlyError extends Error {}

/** what recorders share: target ids, programs the worker already has, pictures */
export class RecorderLink {
  private nextId = 1;
  /** programs the worker knows, by hash */
  sent = new Set<string>();
  /** which uniforms of each program sent are samplers */
  samplers = new Map<string, boolean[]>();
  /** targets the batches in flight use, with how many of them do */
  busy = new Map<number, number>();
  /** programs that did not compile there, by hash: drawing them fails at once, as it does in Renderer */
  failed = new Map<string, ShaderError>();
  /** operations to send before the next batch (pictures that finished loading) */
  pending: Op[] = [];
  pendingTransfer: Transferable[] = [];
  pictures: PictureStore;
  /** draws recorded so far */
  draws = 0;
  /** called when a picture finished loading */
  onLoaded: (() => void) | null = null;

  constructor() {
    this.pictures = new PictureStore(this);
  }
  newId(): number {
    return this.nextId++;
  }
  use(ids: Iterable<number>, by: number): void {
    for (const id of ids) {
      const n = (this.busy.get(id) ?? 0) + by;
      if (n > 0) this.busy.set(id, n);
      else this.busy.delete(id);
    }
  }
  /** the worker forgot every target */
  reset(): void {
    this.pending = [];
    for (const t of this.pendingTransfer) (t as ImageBitmap).close?.();
    this.pendingTransfer = [];
    this.busy.clear();
    this.pictures.reset();
  }
}

/** what a recording sends, with the targets it uses (to know which are busy, and what to forget if it fails) */
export interface Recording {
  ops: Op[];
  transfer: Transferable[];
  /** every target it reads or writes */
  touched: Set<number>;
  /** the targets it creates or draws into */
  written: Set<number>;
  /** the targets it deletes */
  deleted: number[];
  /** the key each target was drawn for (to file the worker's compile errors) */
  drawKeys: Map<number, string>;
}

/** the state of a Recorder's cache, to go back to when a recording is not sent */
export interface RecorderSnapshot {
  cache: Map<string, CacheEntry>;
  loopTextures: Map<string, Target>;
  errors: Map<string, ShaderError>;
  sent: Set<string>;
  programsSent: Set<string>;
  owned: Set<number>;
}

export class Recorder extends HostBase {
  ops: Op[] = [];
  transfer: Transferable[] = [];
  /** the key each draw rendered for (to file errors the worker reports under it) */
  private drawKeys = new Map<number, string>();
  private lastKey = "";
  /** the worker targets it created and has not deleted (a RenderSession frees them all at the end) */
  readonly owned = new Set<number>();
  /** programs this recorder has put in its operations */
  private programsSent = new Set<string>();

  constructor(readonly link: RecorderLink) {
    super();
  }

  protected pictureSource(): PictureSource {
    return this.link.pictures;
  }

  protected mainOnly<T>(what: string, get?: () => T): T {
    // a texture the caller holds is fine when it is one of the worker's (a RenderSession's target)
    if (what === "texture" && get) {
      const r = get() as unknown as Resolved;
      if (r.target && typeof (r.target as RemoteTarget).id === "number") return r as unknown as T;
    }
    throw new MainOnlyError(what);
  }

  /** draws a shader into a target the caller owns, without caching; `add` sums onto what is there (Renderer.renderInto) */
  renderInto(sc: ShaderCode, target: Target, add = false, built: BuiltShader = buildFragmentShader(sc)): void {
    const deps = this.resolveUniforms(built.uniforms, new Set());
    this.lastKey = "";
    this.draw(built, deps.values, target, add);
  }

  /** the texture a sampler uniform refers to (a buffer, an image...), recorded if needed (Renderer.textureFor) */
  textureFor(ref: TextureRef): Target | null {
    return this.resolve(ref, new Set()).target;
  }

  createTarget(size: number, f32 = false, mipmap = false, height = size): Target {
    const id = this.link.newId();
    this.owned.add(id);
    this.ops.push({ op: "create", id, size, height, f32, mipmap });
    const t = { id, tex: null, fbo: null, size, f32, mipmap } as unknown as RemoteTarget;
    if (height !== size) t.height = height;
    return t;
  }
  /** a cached target a batch in flight still uses is not drawn over: a new one takes its place */
  reuse(key: string, size: number, f32: boolean, mipmap: boolean): Target {
    const old = this.cache.get(key)?.target as RemoteTarget | undefined;
    if (old && this.link.busy.has(old.id)) {
      this.deleteTarget(old);
      return this.createTarget(size, f32, mipmap);
    }
    return super.reuse(key, size, f32, mipmap);
  }
  deleteTarget(t: Target | null | undefined): void {
    if (!t) return;
    this.owned.delete((t as RemoteTarget).id);
    this.ops.push({ op: "delete", id: (t as RemoteTarget).id });
  }
  cached(key: string) {
    this.lastKey = key;
    return super.cached(key);
  }
  upload(source: TexImageSource, size: number, into?: Target): Target {
    const t = into ?? this.createTarget(size, false, true);
    const bitmap = toBitmap(source);
    this.ops.push({ op: "upload", id: (t as RemoteTarget).id, bitmap, size });
    this.transfer.push(bitmap);
    return t;
  }
  draw(built: BuiltShader, values: Map<string, unknown>, target: Target, blend = false): void {
    const hash = fnv(built.source);
    const failed = this.link.failed.get(hash);
    if (failed) throw failed;
    // each recorder sends a program the first time it draws it, even when another recorder has: the other one's batch
    // may run in the other lane, after this one (an export drawing what a preview batch still queued defines)
    if (!this.programsSent.has(hash)) {
      this.programsSent.add(hash);
      this.link.sent.add(hash);
      this.link.samplers.set(hash, built.uniforms.map((u) => u.type === "sampler2D"));
      this.ops.push({ op: "program", hash, source: built.source, uniforms: built.uniforms.map((u) => ({ name: u.name, type: u.type, size: u.size })) });
    }
    const vals = built.uniforms.map((u) => {
      let v = values.get(u.name);
      if (u.type === "sampler2D") return v ? (v as RemoteTarget).id : -1;
      if (typeof v === "function") v = (v as () => unknown)();
      return Array.isArray(v) ? [...v] : v;
    });
    const id = (target as RemoteTarget).id;
    this.drawKeys.set(id, this.lastKey);
    this.link.draws++;
    this.ops.push({ op: "draw", id, program: hash, values: vals, blend, time: this.time });
  }

  /** a target drawn into a picture of w×h */
  present(t: Target, w: number, h: number, checker: boolean, out: number): void {
    this.ops.push({ op: "present", id: (t as RemoteTarget).id, w, h, checker, out });
  }
  read(t: Target, f32: boolean, out: number): void {
    this.ops.push({ op: "read", id: (t as RemoteTarget).id, f32, out });
  }

  /** what to send: pictures loaded meanwhile first */
  take(): Recording {
    const ops = [...this.link.pending, ...this.ops];
    const transfer = [...this.link.pendingTransfer, ...this.transfer];
    this.link.pending = [];
    this.link.pendingTransfer = [];
    this.ops = [];
    this.transfer = [];
    const touched = new Set<number>(),
      written = new Set<number>(),
      deleted: number[] = [];
    for (const o of ops) {
      if (o.op === "delete") deleted.push(o.id);
      const a = accessesOf(o, (p) => this.link.samplers.get(p));
      for (const id of a.reads) touched.add(id);
      for (const id of a.writes) touched.add(id), written.add(id);
    }
    const drawKeys = this.drawKeys;
    this.drawKeys = new Map();
    return { ops, transfer, touched, written, deleted, drawKeys };
  }

  /** files the worker's compile errors under the keys that rendered them, so they show as Renderer's would */
  applyErrors(errors: DrawError[], drawKeys: Map<number, string>): void {
    for (const e of errors) {
      const err = new ShaderError(e.message, e.source ?? "", e.log);
      this.link.failed.set(e.program, err);
      let key = drawKeys.get(e.target);
      for (const [k, c] of this.cache) if ((c.target as RemoteTarget).id === e.target) key = k;
      if (key) this.errors.set(key, err);
    }
  }

  /** a batch did not get to the end: forgets the renders it was to draw (they are drawn again when asked for), and
   *  sends the deletes it did not get to. Returns whether a render was forgotten. */
  failed(rec: Pick<Recording, "written" | "deleted">): boolean {
    let n = 0;
    for (const [k, c] of [...this.cache]) {
      if (!rec.written.has((c.target as RemoteTarget).id)) continue;
      this.cache.delete(k);
      this.errors.delete(k);
      n++;
    }
    for (const [k, t] of [...this.loopTextures]) if (rec.written.has((t as RemoteTarget).id)) this.loopTextures.delete(k);
    this.link.pictures.forget(rec.written);
    for (const id of new Set([...rec.written, ...rec.deleted])) {
      this.owned.delete(id);
      this.link.pending.push({ op: "delete", id });
    }
    return n > 0;
  }

  /** drops what was recorded and not taken (a RenderSession's recording that will not be sent): its programs are
   *  sent again the next time they are drawn */
  drop(): void {
    for (const o of this.ops) if (o.op === "program") this.programsSent.delete(o.hash);
    for (const t of this.transfer) (t as ImageBitmap).close?.();
    this.ops = [];
    this.transfer = [];
    this.drawKeys.clear();
  }

  /** the state to go back to if what is recorded next is not sent (nothing must be recorded and not taken yet) */
  snapshot(): RecorderSnapshot {
    return {
      cache: new Map(this.cache),
      loopTextures: new Map(this.loopTextures),
      errors: new Map(this.errors),
      sent: new Set(this.link.sent),
      programsSent: new Set(this.programsSent),
      owned: new Set(this.owned),
    };
  }
  /** forgets what was recorded since the snapshot: the worker never gets it */
  rollback(s: RecorderSnapshot): void {
    this.cache = s.cache;
    this.loopTextures = s.loopTextures;
    this.errors = s.errors;
    this.link.sent = s.sent;
    this.programsSent = s.programsSent;
    this.owned.clear();
    for (const id of s.owned) this.owned.add(id);
    for (const t of this.transfer) (t as ImageBitmap).close?.();
    this.ops = [];
    this.transfer = [];
    this.drawKeys.clear();
    this.webcam.reset();
  }

  /** the worker lost its targets (a lost context): everything is drawn again on demand */
  reset(): void {
    this.cache.clear();
    this.loopTextures.clear();
    this.drawKeys.clear();
    this.owned.clear();
    this.programsSent.clear();
    this.webcam.reset();
    for (const t of this.transfer) (t as ImageBitmap).close?.();
    this.ops = [];
    this.transfer = [];
  }
}

/** a picture as an ImageBitmap, which the worker can take */
function toBitmap(source: TexImageSource): ImageBitmap {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) return source;
  if (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) return source.transferToImageBitmap();
  const s = source as HTMLImageElement & HTMLVideoElement;
  const w = s.videoWidth || s.naturalWidth || (s as unknown as { width: number }).width;
  const h = s.videoHeight || s.naturalHeight || (s as unknown as { height: number }).height;
  const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  c.getContext("2d")!.drawImage(s, 0, 0);
  return c.transferToImageBitmap();
}

type Picture = { target: RemoteTarget | null; w: number; h: number; loading: boolean; error?: string };

/** pictures of Image nodes, by URL: decoded once on the page, kept in the worker for every recorder */
export class PictureStore implements PictureSource {
  private pictures = new Map<string, Picture>();
  private loads = new Set<Promise<void>>();
  /** how many times a render read a picture that had not loaded yet */
  misses = 0;
  constructor(private link: RecorderLink) {}

  resolve(g: GenImage): Resolved {
    const url = String(g.getParameter("image") ?? "");
    if (!url) return { target: null, sig: "noimage" };
    let p = this.pictures.get(url);
    if (!p) {
      p = { target: null, w: 0, h: 0, loading: true };
      this.pictures.set(url, p);
      this.load(url, p);
    }
    if (p.target) {
      g.imageSize = { w: p.w, h: p.h };
      return { target: p.target, sig: "img:" + url };
    }
    if (p.loading) this.misses++;
    return { target: null, sig: "loading:" + url };
  }

  /** resolves when every picture asked for so far has loaded (or failed) */
  async idle(): Promise<void> {
    while (this.loads.size) await Promise.all([...this.loads]);
  }

  reset(): void {
    // the worker forgot the textures: load again when asked
    this.pictures.clear();
  }

  /** pictures whose targets a failed batch was to fill: loaded again when asked for */
  forget(ids: Set<number>): void {
    for (const [url, p] of this.pictures) if (p.target && ids.has(p.target.id)) this.pictures.delete(url);
  }

  prune(used: Set<string>): void {
    for (const [url, p] of this.pictures) {
      if (used.has(url) || p.loading) continue;
      if (p.target) this.link.pending.push({ op: "delete", id: p.target.id });
      this.pictures.delete(url);
    }
  }

  private load(url: string, p: Picture) {
    const job = (async () => {
      let bitmap: ImageBitmap;
      try {
        const blob = await (await fetch(url, { mode: "cors" })).blob();
        bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
      } catch {
        try {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = url;
          await img.decode();
          bitmap = await createImageBitmap(img, { premultiplyAlpha: "none" });
        } catch {
          p.loading = false;
          p.error = "Cannot load " + url;
          return;
        }
      }
      if (this.pictures.get(url) !== p) return bitmap.close();
      const size = pow2(bitmap.width, bitmap.height);
      const id = this.link.newId();
      this.link.pending.push({ op: "create", id, size, height: size, f32: false, mipmap: true }, { op: "upload", id, bitmap, size });
      this.link.pendingTransfer.push(bitmap);
      p.target = { id, tex: null, fbo: null, size, f32: false, mipmap: true } as unknown as RemoteTarget;
      p.w = bitmap.width;
      p.h = bitmap.height;
      p.loading = false;
      this.link.onLoaded?.();
    })();
    this.loads.add(job);
    void job.finally(() => this.loads.delete(job));
  }
}
