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
