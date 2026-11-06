// Paint mode off the page's thread (tests/paint-worker.ts in headless Chromium): mesh maps baked in the paint worker
// match the synchronous bake, painting with them gives the same layers and files, and the page keeps running during a
// bake, a large composite and a save. `node tests/paint-worker.mjs [compare|paint|bake|composite|save] [--before]`;
// --before also measures the old synchronous paths.
import { createServer } from "vite";
import os from "node:os";
import path from "node:path";
import { launchChromium } from "../scripts/playwright.mjs";

const server = await createServer({ server: { port: +(process.env.PAINT_WORKER_TEST_PORT ?? 5196), host: "127.0.0.1" }, logLevel: "error", cacheDir: process.env.VITE_CACHE_DIR || path.join(os.tmpdir(), "material-pro-vite-paint-worker") });
await server.listen();
const port = server.httpServer.address().port;
const browser = await launchChromium();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console", m.text()));
await page.goto(`http://127.0.0.1:${port}/tests/paint-worker.html`);
await page.waitForFunction(() => typeof window.paintCompare === "function");
await page.evaluate(() => window.paintReady);
let failed = false;
const check = (ok, msg) => {
  console.log((ok ? "ok   " : "FAIL ") + msg);
  if (!ok) failed = true;
};
const args = process.argv.slice(2);
const before = args.includes("--before");
const only = args.find((a) => !a.startsWith("--"));
const want = (k) => !only || only === k;
const fmt = (r) => `${r.ms.toFixed(0)} ms, longest timer gap ${r.maxGap.toFixed(0)} ms, ${r.longTasks} long tasks (total ${r.longTotal.toFixed(0)} ms, longest ${r.longest.toFixed(0)} ms), ${r.frames} frames`;

if (want("compare")) {
  const r = await page.evaluate(() => window.bakeCompare(256, 8));
  for (const [k, v] of Object.entries(r)) check(v.worker === 0 && v.page === 0 && v.where === "worker", `${k}: baked in the ${v.where}, differs from the synchronous bake by ${v.worker} (worker), ${v.page} (page, in steps)`);
}
if (want("paint")) {
  const r = await page.evaluate(() => window.paintCompare(256));
  check(r.ready, "the painter waits for its maps from the worker");
  for (const [k, v] of Object.entries(r.maps)) check(v === 0, `${k} after strokes: worker-baked maps and the asynchronous composite differ from the page path by ${v}`);
  check(r.pngs > 0 && r.pngsDiffer.length === 0, `saveAsync writes the same ${r.pngs} layer PNGs as save${r.pngsDiffer.length ? ": " + r.pngsDiffer.join(", ") : ""}`);
}
if (want("bake")) {
  const [size, rays] = [2048, 16];
  if (before) console.log(`  bake AO ${size}² ${rays} rays, before (synchronous): ${fmt(await page.evaluate(([s, n]) => window.bakeBlocking("sync", s, n), [size, rays]))}`);
  const w = await page.evaluate(([s, n]) => window.bakeBlocking("worker", s, n), [size, rays]);
  console.log(`  bake AO ${size}² ${rays} rays, ${w.where}: ${fmt(w)}`);
  const p = await page.evaluate(([s, n]) => window.bakeBlocking("page", s, n), [size, rays]);
  console.log(`  bake AO ${size}² ${rays} rays, page in steps: ${fmt(p)}`);
  check(w.where === "worker" && w.maxGap < 300, `the page keeps running during a bake in the worker (longest gap ${w.maxGap.toFixed(0)} ms)`);
  check(p.maxGap < 1000, `the page keeps running during a bake on the page in steps (longest gap ${p.maxGap.toFixed(0)} ms)`);
}
if (want("composite")) {
  const [size, layers, rounds] = [2048, 4, 4];
  if (before) console.log(`  composite ${size}² ×${layers} layers + 3D view maps, ${rounds} rounds, before (synchronous): ${fmt(await page.evaluate(([s, l, n]) => window.compositeBlocking("sync", s, l, n), [size, layers, rounds]))}`);
  const a = await page.evaluate(([s, l, n]) => window.compositeBlocking("async", s, l, n), [size, layers, rounds]);
  console.log(`  composite ${size}² ×${layers} layers + 3D view maps, ${rounds} rounds, asynchronous: ${fmt(a)}`);
}
if (want("save")) {
  const size = 2048;
  if (before) console.log(`  save ${size}² project, before (synchronous): ${fmt(await page.evaluate((s) => window.saveBlocking("sync", s), size))}`);
  const a = await page.evaluate((s) => window.saveBlocking("async", s), size);
  console.log(`  save ${size}² project, asynchronous: ${fmt(a)}`);
  check(a.maxGap < 500, `the page keeps running while a project is saved (longest gap ${a.maxGap.toFixed(0)} ms)`);
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
