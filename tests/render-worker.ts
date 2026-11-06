/* Browser checks of rendering in a worker (tests/render-worker.mjs): the worker draws what the page's Renderer draws,
 * a heavy shader does not freeze the page, a lost context comes back, a hung render is stopped. */
import { loadRegistry } from "../src/engine/registry";
import { createGen, loadProject } from "../src/engine/loader";
import { GenContext } from "../src/engine/context";
import { Renderer } from "../src/engine/render/renderer";
import { RenderService, RenderFailure } from "../src/engine/render/service";
import { GenGraph } from "../src/engine/gen/graph";
import { GenMaterial } from "../src/engine/gen/misc";
import type { Gen } from "../src/engine/gen/base";
import { ShaderCode } from "../src/engine/shader-code";

declare global {
  interface Window {
    ready: Promise<string>;
    compare: (names: string[], size: number) => Promise<Record<string, { jobs: number; worst: number; worstAt: string }>>;
    comparePreviews: (name: string, size: number) => Promise<{ jobs: number; worst: number }>;
    heavy: (mode: "worker" | "main", size: number, loops: number) => Promise<{ ms: number; maxGap: number; longTasks: number; longest: number; frames: number }>;
    contextLoss: () => Promise<{ before: number; lost: boolean; restored: boolean; worst: number; after: number }>;
    timeout: () => Promise<{ kind: string; message: string; afterwards: string }>;
    cancel: () => Promise<{ kind: string; ms: number; afterwards: string }>;
  }
}

const main = (async () => {
  await loadRegistry("/public/data/");
  return new Renderer();
})();
let svc: RenderService;
window.ready = (async () => {
  svc = await new RenderService(await main).start();
  return svc.mode + " " + svc.info;
})();

function allNodes(g: GenGraph, out: Gen[] = []): Gen[] {
  for (const c of g.children) {
    out.push(c);
    if (c instanceof GenGraph) allNodes(c, out);
  }
  return out;
}

async function exampleJobs(name: string) {
  const data = await fetch(`/public/data/examples/${name}.json`).then((x) => x.json());
  const graph = loadProject(data);
  const jobs: { sc: ShaderCode; label: string }[] = [];
  for (const g of allNodes(graph)) {
    const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
    for (let i = 0; i < outs.length; i++) {
      try {
        const sc = g.getShaderCode("uv", i, new GenContext());
        if (sc.outputType) jobs.push({ sc, label: `${g.getHierName()}:${i}` });
      } catch {
        /* the harness reports these */
      }
    }
  }
  return jobs;
}

const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  let w = 0;
  for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i] - b[i]));
  return w;
};

/** every output of every node of the examples, by the page's Renderer and by the worker */
window.compare = async (names, size) => {
  await window.ready;
  const r = await main;
  const out: Record<string, { jobs: number; worst: number; worstAt: string }> = {};
  for (const name of names) {
    const jobs = await exampleJobs(name);
    r.time = svc.time = 0;
    const ok: typeof jobs = [];
    const ref: Uint8ClampedArray[] = [];
    for (const j of jobs) {
      try {
        const t = r.render(j.sc, size);
        ref.push(r.toImageData(t).data);
        r.deleteTarget(t);
        ok.push(j);
      } catch {
        /* does not compile: not this test's business */
      }
    }
    const got = await svc.images(ok.map((j) => ({ sc: j.sc, size })));
    let worst = 0,
      worstAt = "";
    got.forEach((g, i) => {
      const d = diff(g.data, ref[i]);
      if (d > worst) [worst, worstAt] = [d, ok[i].label];
    });
    out[name] = { jobs: ok.length, worst, worstAt };
  }
  return out;
};

/** node thumbnails: the worker's ImageBitmaps against Renderer.present */
window.comparePreviews = async (name, size) => {
  await window.ready;
  const r = await main;
  const jobs = await exampleJobs(name);
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c.getContext("2d", { willReadFrequently: true })!;
  };
  const a = jobs.map(() => mk());
  const b = jobs.map(() => mk());
  await svc.previews(jobs.map((j, i) => ({ key: "cmp" + i, sc: j.sc, size, ctx: a[i], force: true })));
  jobs.forEach((j, i) => {
    const res = r.renderKeyed("cmp" + i, j.sc, size);
    if (res.target) r.present(res.target, b[i], true);
  });
  let worst = 0;
  for (let i = 0; i < jobs.length; i++) worst = Math.max(worst, diff(a[i].getImageData(0, 0, size, size).data, b[i].getImageData(0, 0, size, size).data));
  return { jobs: jobs.length, worst };
};

/** a shader with a long loop, as a user's Shader node could have */
function heavyShader(loops: number): ShaderCode {
  const sc = new ShaderCode();
  sc.defs = `vec4 heavy(vec2 uv) { float a = 0.0; for (int i = 0; i < ${loops}; i++) { a += sin(uv.x * float(i) * 0.37 + cos(uv.y * float(i))); } return vec4(vec3(fract(a)), 1.0); }\n`;
  sc.outputType = "rgba";
  sc.outputValues = { rgba: "heavy(uv)" };
  return sc;
}

/** renders a heavy shader as an export while measuring how often the page gets to run */
window.heavy = async (mode, size, loops) => {
  await window.ready;
  const s = mode === "worker" ? svc : new RenderService(await main);
  let longTasks = 0,
    longest = 0;
  const po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      longTasks++;
      longest = Math.max(longest, e.duration);
    }
  });
  try {
    po.observe({ type: "longtask", buffered: false });
  } catch {
    /* not supported */
  }
  let last = performance.now(),
    maxGap = 0,
    frames = 0,
    running = true;
  const tick = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  const raf = () => {
    frames++;
    if (running) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  const t0 = performance.now();
  await s.image(heavyShader(loops), size, { preview: false });
  const ms = performance.now() - t0;
  // a page blocked until now did not get to tick at all
  maxGap = Math.max(maxGap, performance.now() - last);
  running = false;
  clearInterval(tick);
  await new Promise((r) => setTimeout(r, 100));
  for (const e of po.takeRecords()) {
    longTasks++;
    longest = Math.max(longest, e.duration);
  }
  po.disconnect();
  return { ms, maxGap, longTasks, longest, frames };
};

/** WEBGL_lose_context in the worker: previews fail meanwhile and render the same once it is back */
window.contextLoss = async () => {
  await window.ready;
  const jobs = (await exampleJobs("bricks")).slice(0, 12);
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    return c.getContext("2d", { willReadFrequently: true })!;
  };
  const a = jobs.map(() => mk());
  const b = jobs.map(() => mk());
  const res0 = await svc.previews(jobs.map((j, i) => ({ key: "loss" + i, sc: j.sc, size: 64, ctx: a[i], force: true })));
  let lost = false,
    restored = false;
  const wait = (f: () => boolean) =>
    new Promise<void>((res) => {
      const t = setInterval(() => {
        if (f()) {
          clearInterval(t);
          res();
        }
      }, 10);
      setTimeout(() => (clearInterval(t), res()), 4000);
    });
  svc.onLost = () => (lost = true);
  svc.onRestored = () => (restored = true);
  svc.loseContext();
  await wait(() => lost);
  svc.restoreContext();
  await wait(() => restored);
  const res1 = await svc.previews(jobs.map((j, i) => ({ key: "loss" + i, sc: j.sc, size: 64, ctx: b[i] })));
  let worst = 0;
  for (let i = 0; i < jobs.length; i++) worst = Math.max(worst, diff(a[i].getImageData(0, 0, 64, 64).data, b[i].getImageData(0, 0, 64, 64).data));
  svc.onLost = svc.onRestored = null;
  return { before: res0.filter((r) => r.drawn).length, lost, restored, worst, after: res1.filter((r) => r.drawn).length };
};

/** a render the GPU does not finish within the budget is stopped, and the worker keeps working */
window.timeout = async () => {
  await window.ready;
  const old = svc.budget.bg;
  svc.budget.bg = 30;
  let kind = "none",
    message = "";
  try {
    await svc.image(heavyShader(3000), 1024, { preview: false });
  } catch (e) {
    kind = e instanceof RenderFailure ? e.kind : "other";
    message = String((e as Error).message);
  }
  svc.budget.bg = old;
  const ok = await svc.image((await exampleJobs("bricks"))[0].sc, 64).then(
    () => "renders",
    (e) => "fails: " + e,
  );
  return { kind, message, afterwards: ok };
};

/** an export can be cancelled while it renders */
window.cancel = async () => {
  await window.ready;
  const ac = new AbortController();
  const t0 = performance.now();
  setTimeout(() => ac.abort(), 200);
  let kind = "none";
  try {
    await svc.image(heavyShader(400), 4096, { preview: false, signal: ac.signal });
  } catch (e) {
    kind = e instanceof RenderFailure ? e.kind : "other: " + e;
  }
  const ms = performance.now() - t0;
  const ok = await svc.image((await exampleJobs("bricks"))[0].sc, 64).then(
    () => "renders",
    (e) => "fails: " + e,
  );
  return { kind, ms, afterwards: ok };
};

declare global {
  interface Window {
    imageExport: () => Promise<{ worker: number[]; page: number[] }>;
  }
}
/** an export right after a project opens has its pictures, not black (Material Maker #758, #729) */
window.imageExport = async () => {
  await window.ready;
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const x = c.getContext("2d")!;
  x.fillStyle = "#ff8000";
  x.fillRect(0, 0, 8, 8);
  const url = c.toDataURL("image/png");
  const pixel = async (renderer: { image(sc: ShaderCode, size: number): Promise<ImageData>; imagesLoaded(root?: Gen): Promise<void> }) => {
    const root = new GenGraph();
    // a new URL each time, so nothing is loaded yet
    const g = createGen({ type: "image", parameters: { image: url + "#" + Math.random() } })!;
    root.addGenerator(g);
    await renderer.imagesLoaded(root);
    const img = await renderer.image(g.getShaderCode("uv", 0, new GenContext()), 16);
    return [...img.data.slice(0, 4)];
  };
  const { pictureRenderer } = await import("../src/engine/render/maps");
  return { worker: await pixel(svc), page: await pixel(pictureRenderer(await main)) };
};

declare global {
  interface Window {
    prune:() => Promise<{ sizes: number[]; mainSizes: number[] }>;
  }
}
/** adding and deleting a Buffer node again and again does not keep its textures (Material Maker #1539) */
window.prune = async () => {
  await window.ready;
  const r = await main;
  const root = new GenGraph();
  const sizes: number[] = [];
  const mainSizes: number[] = [];
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  for (let i = 0; i < 8; i++) {
    const b = createGen({ type: "buffer" })!;
    root.addGenerator(b);
    const sc = b.getShaderCode("uv", 0, new GenContext());
    await svc.previews([{ key: "prune:preview", sc, size: 32, ctx: c.getContext("2d")!, force: true }]);
    r.renderKeyed("prune:preview", sc, 32);
    root.removeGenerator(b);
    svc.prune([root]);
    sizes.push(svc.cacheSize);
    mainSizes.push(r.cacheSize);
  }
  return { sizes, mainSizes };
};

/* ---------- renders that used to run on the page only: each by the worker and by the page's fallback ---------- */
import { findMaterial } from "../src/engine/materialMaps";
import { raymarchPreview } from "../src/engine/preview3d";
import { GenSDF } from "../src/engine/gen/sdf";
import { sdfPreview2D, sdfPreview3D } from "../src/engine/sdf/preview";
import { newSceneItem, type SdfScene } from "../src/engine/sdf/builder";
import { processShader, processConditionals, connectionsAndParametersContext } from "../src/engine/export";
import { withPreview } from "../src/engine/render/shader-source";
import { ShaderError } from "../src/engine/render/types";
import { TaaRender, sessionFrame } from "../src/ui/preview2d/taa";
import { imageShaderCode } from "../src/ui/preview2d/view";
import type { TextureRef } from "../src/engine/shader-code";
import { newProject } from "../src/engine/loader";

type Moved = { n: number; worst: number; note?: string };
declare global {
  interface Window {
    moved: () => Promise<Record<string, Moved>>;
  }
}

/** a seeded random generator (mulberry32), so both TAA runs jitter alike */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** the largest difference of two float pictures, in 1/255 (clamped as a file would store them) */
const fdiff = (a: Float32Array, b: Float32Array) => {
  let w = 0;
  for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(Math.min(1, Math.max(0, a[i])) - Math.min(1, Math.max(0, b[i]))) * 255);
  return w;
};
const ctx2d = (w: number, h = w) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d", { willReadFrequently: true })!;
};
const pixelsOf = (c: CanvasRenderingContext2D) => c.getImageData(0, 0, c.canvas.width, c.canvas.height).data;

/** each render moved to the worker against the same render on the page (the fallback: a RenderService without a
 *  worker, which draws with the page's Renderer) */
window.moved = async () => {
  await window.ready;
  const r = await main;
  const page = new RenderService(r);
  const out: Record<string, Moved> = {};
  /** for each session: whether it ran where it was asked to (the worker, or the page) */
  let where: boolean[] = [];
  const graphOf = async (name: string) => loadProject(await fetch(`/public/data/examples/${name}.json`).then((x) => x.json()));
  r.time = svc.time = page.time = 0;

  // keyed previews (the raymarching 3D preview, the SDF builder): RenderService.previews in both
  const previewPair = async (key: string, sc: ShaderCode, size: number) => {
    const a = ctx2d(size),
      b = ctx2d(size);
    const [ra] = await svc.previews([{ key, sc, size, preview: false, ctx: a, checker: false, force: true }]);
    const [rb] = await page.previews([{ key, sc, size, preview: false, ctx: b, checker: false, force: true }]);
    svc.forget(key);
    page.forget(key);
    if (ra.error || rb.error) throw new Error(String(ra.error?.log || rb.error?.log));
    if (!ra.drawn || !rb.drawn) throw new Error("not drawn");
    return diff(pixelsOf(a), pixelsOf(b));
  };
  {
    let worst = 0,
      n = 0;
    for (const name of ["raymarching", "marble", "3d_shapes"]) {
      const m = findMaterial(await graphOf(name));
      if (!m) continue;
      for (const shape of ["sphere", "cube"] as const) {
        try {
          worst = Math.max(worst, await previewPair("3d-ray", raymarchPreview(m, { yaw: 0.6, pitch: -0.35, dist: 2.2 }, shape), 96));
          n++;
        } catch (e) {
          // a material this preview cannot compile is not this test's business
          console.log("skipped", name, shape, String(e).slice(0, 80));
        }
      }
    }
    out["raymarching 3D preview"] = { n, worst };
  }
  {
    let idx = 0;
    const item = (type: string, children: SdfScene[] = [], params: Record<string, unknown> = {}): SdfScene => {
      const s = newSceneItem(type, ++idx);
      s.children = children;
      Object.assign(s.parameters, params);
      return s;
    };
    const g = new GenSDF();
    g.editor = true;
    new GenGraph().addGenerator(g);
    let worst = 0;
    g.setSdfScene([item("Union", [item("Circle", [], { radius: 0.25 }), item("Box", [], { position_x: 0.2, size_x: 0.2 })])]);
    worst = Math.max(worst, await previewPair("sdf-builder", sdfPreview2D(g, { center: { x: 0.5, y: 0.5 }, scale: 1.2, style: 0 }, 0), 96));
    g.setSdfScene([item("Union3D", [item("Sphere", [], { radius: 0.3 }), item("Box3D", [], { position_x: 0.3 })])]);
    worst = Math.max(worst, await previewPair("sdf-builder", sdfPreview3D(g, { yaw: 0.5, pitch: -0.3, dist: 3, target: [0, 0, 0] }, 0), 96));
    out["SDF builder preview"] = { n: 2, worst };
  }

  // library icons and the tone histogram: images and floats of the render service
  {
    const jobs = (await exampleJobs("bricks")).slice(0, 16);
    let worst = 0,
      hist = 0;
    for (const j of jobs) {
      const a = await svc.image(j.sc, 64),
        b = await page.image(j.sc, 64);
      worst = Math.max(worst, diff(a.data, b.data));
      const fa = await svc.floats(withPreview(j.sc, 128), 128, { preview: false }),
        fb = await page.floats(withPreview(j.sc, 128), 128, { preview: false });
      hist = Math.max(hist, fdiff(fa, fb));
    }
    out["library icons"] = { n: jobs.length, worst };
    out["tone histogram"] = { n: jobs.length, worst: hist };
  }

  // frames that are not square, in sessions
  {
    const graph = await graphOf("marble");
    const gens = allNodes(graph)
      .filter((g) => g.getOutputDefs().length)
      .slice(0, 12);
    let worst = 0,
      n = 0;
    for (const g of gens) {
      const frame = (onPage: boolean) => svc.withSession((s) => (where.push(s.onWorker !== onPage), sessionFrame(s, imageShaderCode(g, 0, 96), s.createTarget(96, 48), 0.25)), { onPage });
      try {
        const a = await frame(false),
          b = await frame(true);
        worst = Math.max(worst, diff(a.data, b.data));
        n++;
      } catch (e) {
        if (!(e instanceof ShaderError)) throw e;
      }
    }
    out["non-square animation frames"] = { n, worst: where.every(Boolean) ? worst : 255, note: where.every(Boolean) ? "" : "not worker against page" };
  }

  // TAA: the same seeded jitter, accumulated in the worker and on the page
  {
    const m = findMaterial(await graphOf("marble"))!;
    const settings = [
      { gamma: 1, denoise: 0 as const, radius: 1, sigma: 1, kSigma: 1, threshold: 0.1 },
      { gamma: 2.2, denoise: 1 as const, radius: 2, sigma: 1, kSigma: 1, threshold: 0.1 },
      { gamma: 1, denoise: 2 as const, radius: 1, sigma: 1.5, kSigma: 2, threshold: 0.1 },
    ];
    const run = async (onPage: boolean) => {
      const t = new TaaRender(svc.session({ onPage }), m, 0, 80, 56, seeded(7));
      for (let i = 0; i < 24; i++) t.step(0.5);
      const res: Float32Array[] = [];
      for (const st of settings) res.push((await t.pixels(st, true)) as Float32Array);
      const c = ctx2d(80, 56);
      await t.show(settings[0], c);
      const bytes = (await t.pixels(settings[0], false)) as Uint8ClampedArray;
      const onWorker = t.session.onWorker;
      t.dispose();
      return { res, shown: pixelsOf(c), bytes, onWorker };
    };
    const a = await run(false),
      b = await run(true);
    let worst = 0;
    a.res.forEach((x, i) => (worst = Math.max(worst, fdiff(x, b.res[i]))));
    out["TAA render (floats, 3 denoise modes)"] = { n: settings.length, worst: a.onWorker && !b.onWorker ? worst : 255, note: a.onWorker && !b.onWorker ? "" : "not worker against page" };
    out["TAA render (shown, PNG)"] = { n: 2, worst: Math.max(diff(a.shown, b.shown), diff(a.bytes, b.bytes)) };
  }

  // a material's own buffers, as the engine exports read them
  where = [];
  {
    let worst = 0,
      n = 0;
    // a dynamic material whose albedo is a Buffer of a noise: its export writes that buffer as a file
    const dynamic = () => {
      const p = newProject("material_dynamic");
      const m = p.children[0] as GenMaterial;
      const noise = createGen({ type: "fbm2" })!;
      const buf = createGen({ type: "buffer" })!;
      p.addGenerator(noise);
      p.addGenerator(buf);
      p.connectChildren(noise, 0, buf, 0);
      p.connectChildren(buf, 0, m, m.getInputDefs().findIndex((d) => d.name === "albedo_tex"));
      return p;
    };
    for (const name of ["dynamic", "raymarching", "planet"]) {
      const m = findMaterial(name === "dynamic" ? dynamic() : await graphOf(name));
      if (!m) continue;
      const code = processShader(m, processConditionals(String(m.shaderModel.preview_shader ?? ""), connectionsAndParametersContext(m)));
      for (const u of code.shaderCode.uniforms) {
        if (u.type !== "sampler2D" || !u.value) continue;
        const read = (onPage: boolean, floats: boolean) =>
          svc.withSession(
            async (s) => {
              where.push(s.onWorker !== onPage);
              const t = s.textureFor(u.value as TextureRef);
              if (!t) return null;
              const i = s.read(t, floats);
              return (await s.flush())[i];
            },
            { onPage },
          );
        const a = await read(false, false),
          b = await read(true, false);
        if (!a || !b) continue;
        const fa = await read(false, true),
          fb = await read(true, true);
        worst = Math.max(worst, diff(a as Uint8ClampedArray, b as Uint8ClampedArray), fdiff(fa as Float32Array, fb as Float32Array));
        n++;
      }
    }
    out["engine export buffers"] = { n, worst: n && where.every(Boolean) ? worst : 255, note: !n ? "no buffers found" : where.every(Boolean) ? "" : "not worker against page" };
  }

  // a shader that does not compile: the worker's error carries the source, as the page's does
  {
    const bad = new ShaderCode();
    bad.defs = "vec4 broken(vec2 uv) { return vec4(nope); }\n";
    bad.outputType = "rgba";
    bad.outputValues = { rgba: "broken(uv)" };
    const [ra] = await svc.previews([{ key: "bad", sc: bad, size: 16, preview: false, ctx: ctx2d(16), force: true }]);
    const [rb] = await page.previews([{ key: "bad", sc: bad, size: 16, preview: false, ctx: ctx2d(16), force: true }]);
    const ok = !!ra.error && !!rb.error && ra.error.source.length > 0 && ra.error.source === rb.error.source;
    out["compile errors carry the source"] = { n: 1, worst: ok ? 0 : 255, note: `worker ${ra.error?.source.length ?? "none"} chars, page ${rb.error?.source.length ?? "none"} chars` };
    svc.forget("bad");
    page.forget("bad");
  }
  return out;
};

declare global {
  interface Window {
    taaLoop: (onPage: boolean, size: number, ms: number) => Promise<{ samples: number; maxGap: number; frames: number; onWorker: boolean }>;
  }
}
/** the TAA window's loop for `ms` milliseconds (as src/ui/preview2d/Dialogs.tsx runs it): samples taken, and how
 *  long the page went without running a timer */
window.taaLoop = async (onPage, size, ms) => {
  await window.ready;
  const m = findMaterial(loadProject(await fetch(`/public/data/examples/marble.json`).then((x) => x.json())))!;
  const t = new TaaRender(svc.session({ onPage }), m, 0, size, size);
  const ctx = ctx2d(size);
  const st = { gamma: 1, denoise: 0 as const, radius: 1, sigma: 1, kSigma: 1, threshold: 0.1 };
  // compile first, so both measure sampling only
  t.step();
  await t.show(st, ctx);
  let last = performance.now(),
    maxGap = 0,
    frames = 0,
    running = true;
  const tick = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  const raf = () => {
    frames++;
    if (running) requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  const first = t.iteration;
  const end = performance.now() + ms;
  let n = 1;
  while (performance.now() < end) {
    await new Promise((res) => requestAnimationFrame(res));
    const start = performance.now();
    const before = t.iteration;
    if (t.session.onWorker) for (let i = 0; i < n; i++) t.step();
    else
      do t.step();
      while (performance.now() - start < 8);
    if (Math.floor(t.iteration / 16) !== Math.floor(before / 16)) await t.show(st, ctx);
    else await t.session.flush();
    const took = performance.now() - start;
    if (took < 30) n = Math.min(64, n * 2);
    else if (took > 60) n = Math.max(1, n >> 1);
  }
  maxGap = Math.max(maxGap, performance.now() - last);
  running = false;
  clearInterval(tick);
  const onWorker = t.session.onWorker;
  t.dispose();
  return { samples: t.iteration - first, maxGap, frames, onWorker };
};
