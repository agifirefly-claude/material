// Performance of the editor in headless Chromium (numbers in docs/性能.md):
//   - time to the first full preview: from navigation until every node preview of a large example is drawn
//   - the page's long tasks (PerformanceObserver "longtask") and longest pause while a 2048² maps export renders
//   - JS heap after the previews and after the export
//   - whether the editor stays interactive while a 4096² maps export renders (frames, timer pauses, input latency)
//   - "All maps (zip)" at 256²
// Usage: node tests/perf.mjs [worker|main|both] [--example stylized_wall] [--root <checkout>] [--size 2048] [--big 4096]
//   (--big 0 leaves the big export out)
//   --root runs against another checkout (for the numbers before a change); "main" renders on the page (?render=main)
import { createServer } from "vite";
import path from "node:path";
import os from "node:os";
import { launchChromium } from "../scripts/playwright.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const which = args[0] && !args[0].startsWith("--") ? args[0] : "both";
const example = opt("--example", "stylized_wall");
const root = path.resolve(opt("--root", "."));
const size = +opt("--size", 2048);
const big = +opt("--big", 4096);
const assert = args.includes("--assert");

// its own dependency cache: a Vite server optimizing into a shared one reloads the pages of the others
const server = await createServer({ root, server: { port: +(process.env.PERF_PORT ?? 5196), host: "127.0.0.1" }, logLevel: "error", cacheDir: path.join(os.tmpdir(), "material-pro-vite-perf-" + path.basename(root)) });
await server.listen();
// the port Vite really took (it moves on when the asked one is busy)
const port = server.httpServer.address().port;
const browser = await launchChromium();
let failed = false;

async function measure(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    window.__long = [];
    try {
      new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => ({ start: e.startTime, ms: e.duration })))).observe({ type: "longtask", buffered: true });
    } catch {
      /* not supported */
    }
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const heap = async () => {
    const m = await cdp.send("Performance.getMetrics");
    return Math.round(m.metrics.find((x) => x.name === "JSHeapUsedSize").value / 1048576);
  };
  await page.goto(`http://127.0.0.1:${port}/?lang=en&example=${example}${mode === "main" ? "&render=main" : ""}`);
  await page.waitForSelector(".react-flow__node", { timeout: 120000 });
  const loadMs = await page.evaluate(() => performance.now());
  // "all previews" on: from the click until every node preview is drawn, and nothing more for a while
  const first = await page.evaluate(
    () =>
      new Promise((res) => {
        const box = [...document.querySelectorAll("label")].find((l) => /all previews/.test(l.textContent))?.querySelector("input");
        const t0 = performance.now();
        box?.click();
        let lastCount = -1,
          lastChange = performance.now();
        const t = setInterval(() => {
          const all = [...document.querySelectorAll("canvas[data-drawn]")];
          const drawn = all.filter((c) => c.dataset.drawn === "1").length;
          if (drawn !== lastCount) {
            lastCount = drawn;
            lastChange = performance.now();
          }
          if ((all.length && drawn === all.length && performance.now() - lastChange > 1500) || performance.now() - t0 > 180000) {
            clearInterval(t);
            const long = window.__long.filter((e) => e.start >= t0);
            res({ ms: lastChange - t0, previews: all.length, drawn, longTasks: long.length, longest: long.reduce((a, e) => Math.max(a, e.ms), 0) });
          }
        }, 50);
      }),
  );
  const heapPreviews = await heap();

  // "All maps (zip)" at 256²: small pictures, so what it takes is everything but the drawing of the maps
  const smallMs = await page.evaluate(async () => {
    const t0 = performance.now();
    const m = await import("/src/ui/exporting.ts");
    await m.exportMaterialMaps(256);
    return performance.now() - t0;
  });

  // a 2048² maps export: long tasks and the longest pause of the page meanwhile
  const exp = await page.evaluate(async (s) => {
    const from = window.__long.length;
    let last = performance.now(),
      maxGap = 0;
    const tick = setInterval(() => {
      const n = performance.now();
      maxGap = Math.max(maxGap, n - last);
      last = n;
    }, 10);
    const { editor } = await import("/src/ui/store.ts");
    const svc = editor.renders;
    // how long the maps take to render (RenderService.images), the rest is encoding and the zip
    const images = svc.images;
    let renderMs = 0;
    svc.images = async (...a) => {
      const t = performance.now();
      const r = await images.apply(svc, a);
      renderMs += performance.now() - t;
      return r;
    };
    const draws = svc.stats?.renders ?? 0;
    const t0 = performance.now();
    const m = await import("/src/ui/exporting.ts");
    await m.exportMaterialMaps(s);
    const ms = performance.now() - t0;
    svc.images = images;
    maxGap = Math.max(maxGap, performance.now() - last);
    clearInterval(tick);
    await new Promise((r) => setTimeout(r, 200));
    const long = window.__long.slice(from);
    return { ms, renderMs, draws: (svc.stats?.renders ?? 0) - draws, maxGap, longTasks: long.length, longMs: long.reduce((a, e) => a + e.ms, 0), longest: long.reduce((a, e) => Math.max(a, e.ms), 0) };
  }, size);
  const heapExport = await heap();

  // a 4096² export while the user works: frames drawn, timer pauses, and how long a click takes to be handled
  await page.evaluate((b) => {
    window.__ui = { frames: 0, maxGap: 0, running: true, done: false };
    // --big 0: no big export
    if (!b) return Object.assign(window.__ui, { done: true, ms: 0, running: false });
    let last = performance.now();
    const raf = () => {
      const n = performance.now();
      window.__ui.maxGap = Math.max(window.__ui.maxGap, n - last);
      last = n;
      window.__ui.frames++;
      if (window.__ui.running) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    window.__ui.t0 = performance.now();
    import("/src/ui/exporting.ts").then((m) => m.exportMaterialMaps(b)).then(() => {
      window.__ui.done = true;
      window.__ui.ms = performance.now() - window.__ui.t0;
    });
  }, big);
  const clicks = [];
  const box = { x: 400, y: 300, width: 600, height: 300 };
  for (let i = 0; i < 40; i++) {
    const done = await page.evaluate(() => window.__ui.done);
    if (done) break;
    const t = Date.now();
    await page.mouse.click(box.x + box.width / 2 + i, box.y + box.height / 2);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    clicks.push(Date.now() - t);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => window.__ui.done, null, { timeout: 600000 });
  const ui = await page.evaluate(() => ((window.__ui.running = false), window.__ui));
  const out = {
    mode,
    renderer: await page.evaluate(() => import("/src/ui/store.ts").then((m) => m.editor.renders?.mode ?? "page (before the worker)")).catch(() => "page (before the worker)"),
    loadMs: Math.round(loadMs),
    allPreviewsMs: Math.round(first.ms),
    previews: first.previews,
    previewsDrawn: first.drawn,
    previewLongTasks: first.longTasks,
    previewLongestTaskMs: Math.round(first.longest),
    heapAfterPreviewsMB: heapPreviews,
    smallExportMs: Math.round(smallMs),
    exportMs: Math.round(exp.ms),
    exportRenderMs: Math.round(exp.renderMs),
    exportDraws: exp.draws,
    exportLongTasks: exp.longTasks,
    exportLongTaskMs: Math.round(exp.longMs),
    exportLongestTaskMs: Math.round(exp.longest),
    exportLongestPauseMs: Math.round(exp.maxGap),
    heapAfterExportMB: heapExport,
    bigExportMs: Math.round(ui.ms),
    bigExportFrames: ui.frames,
    bigExportLongestFrameMs: Math.round(ui.maxGap),
    clicks: clicks.length,
    clickWorstMs: Math.max(0, ...clicks),
    clickMedianMs: clicks.length ? clicks.sort((a, b) => a - b)[clicks.length >> 1] : 0,
  };
  await ctx.close();
  return out;
}

const modes = which === "both" ? ["main", "worker"] : [which];
const results = [];
for (const m of modes) {
  const r = await measure(m);
  results.push(r);
  console.log(JSON.stringify(r));
}
if (assert) {
  const w = results.find((r) => r.mode === "worker");
  if (w) {
    // the end of an export (eleven 4096² pictures put into canvases for PNG) still takes the page about a second
    const ok = w.renderer === "worker" && w.bigExportLongestFrameMs < 2500 && w.clickWorstMs < 1000;
    console.log((ok ? "ok   " : "FAIL ") + `the editor stays interactive during a ${big}² export: longest frame ${w.bigExportLongestFrameMs} ms, slowest click ${w.clickWorstMs} ms`);
    if (!ok) failed = true;
  }
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
