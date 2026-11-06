/* The messages between the page and the render worker.
 *
 * The page decides what to draw (Recorder: the same caching and signatures as Renderer) and sends it as a list of
 * operations on targets it names by number. The worker owns the WebGL context, the compiled programs and the
 * textures, runs the operations in order and sends back what was asked for: pictures for previews (ImageBitmap)
 * and pixels for exports, both transferred rather than copied. */

export interface UniformDef {
  name: string;
  type: string;
  size: number;
}

export type Op =
  | { op: "create"; id: number; size: number; height: number; f32: boolean; mipmap: boolean }
  | { op: "delete"; id: number }
  /** a program, sent once: later draws name it by its hash */
  | { op: "program"; hash: string; source: string; uniforms: UniformDef[] }
  /** values in the order of the program's uniforms; a sampler's value is a target id, or -1 for nothing */
  | { op: "draw"; id: number; program: string; values: unknown[]; blend: boolean; time: number }
  /** a picture (row 0 at the top) copied into a target */
  | { op: "upload"; id: number; bitmap: ImageBitmap; size: number }
  /** a target drawn upright into a w×h picture, with a checkerboard under transparency when `checker` */
  | { op: "present"; id: number; w: number; h: number; checker: boolean; out: number }
  /** the pixels of a target, row 0 first: floats, or bytes as an image file stores them */
  | { op: "read"; id: number; f32: boolean; out: number };

/** node thumbnails, the big 2D and 3D views, exports: each lane runs its batches in order, the lanes side by side
 *  (hazards.ts orders them where they touch the same targets) */
export type Lane = "fg" | "view" | "bg";

export type ToWorker =
  | { type: "batch"; id: number; ops: Op[]; lane: Lane; budgetMs: number }
  | { type: "cancel"; id: number }
  /** for tests: lose the context (WEBGL_lose_context), and get it back */
  | { type: "lose" }
  | { type: "restore" };

export interface DrawError {
  target: number;
  program: string;
  message: string;
  log: string;
}

export interface BatchStats {
  ms: number;
  draws: number;
  tiles: number;
  /** how long the batch waited in the worker for the batches before it in its lane */
  queuedMs: number;
  lane: Lane;
  /** GPU time, when the browser can measure it (EXT_disjoint_timer_query_webgl2) */
  gpuMs: number | null;
}

export type Failure = "cancelled" | "timeout" | "lost" | "error";

export type FromWorker =
  | { type: "ready"; renderer: string; timerQuery: boolean }
  | { type: "unsupported"; reason: string }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "done"; id: number; outputs: (ImageBitmap | Float32Array | Uint8ClampedArray | null)[]; errors: DrawError[]; stats: BatchStats }
  | { type: "failed"; id: number; kind: Failure; message: string }
  | { type: "lost" }
  | { type: "restored" };
