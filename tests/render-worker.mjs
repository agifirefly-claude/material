// Rendering in a worker (tests/render-worker.ts in headless Chromium): same pixels as the page's renderer, the page
// stays responsive during a heavy export, a lost context recovers, hung renders time out, exports can be cancelled.
import { createServer } from "vite";
import os from "node:os";
import path from "node:path";
import { launchChromium } from "../scripts/playwright.mjs";

// its own dependency cache: a Vite server optimizing into a shared one reloads the pages of the others
const server = await createServer({ server: { port: +(process.env.WORKER_TEST_PORT ?? 5197), host: "127.0.0.1" }, logLevel: "error", cacheDir: process.env.VITE_CACHE_DIR || path.join(os.tmpdir(), "material-pro-vite-render-worker") });
await server.listen();
// the port Vite really took (it moves on when the asked one is busy)
const port = server.httpServer.address().port;
const browser = await launchChromium();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console", m.text()));
await page.goto(`http://127.0.0.1:${port}/tests/render-worker.html`);
await page.waitForFunction(() => typeof window.compare === "function");
let failed = false;
const check = (ok, msg) => {
  console.log((ok ? "ok   " : "FAIL ") + msg);
  if (!ok) failed = true;
};
const only = process.argv[2];
const want = (k) => !only || only === k;

const mode = await page.evaluate(() => window.ready);
console.log("renderer:", mode);
check(mode.startsWith("worker"), "renders in a worker");

if (want("compare")) {
  const names = process.env.COMPARE ? process.env.COMPARE.split(",") : ["bricks", "marble", "rusted_metal", "wood", "mosaic", "skulls", "tiles", "lava", "paper", "rock"];
  const r = await page.evaluate((n) => window.compare(n, 128), names);
  for (const [k, v] of Object.entries(r)) check(v.worst <= 1, `${k}: ${v.jobs} outputs, worker vs page differ by at most ${v.worst}/255${v.worst ? " (" + v.worstAt + ")" : ""}`);
  const p = await page.evaluate(() => window.comparePreviews("bricks", 64));
  check(p.worst <= 1, `bricks previews: ${p.jobs} ImageBitmaps, differ by at most ${p.worst}/255`);
}
if (want("heavy")) {
  const w = await page.evaluate(() => window.heavy("worker", 2048, 300));
  const m = await page.evaluate(() => window.heavy("main", 2048, 300));
  console.log(`  heavy 2048² export, worker: ${w.ms.toFixed(0)} ms, longest timer gap ${w.maxGap.toFixed(0)} ms, ${w.longTasks} long tasks (longest ${w.longest.toFixed(0)} ms), ${w.frames} frames`);
  console.log(`  heavy 2048² export, page:   ${m.ms.toFixed(0)} ms, longest timer gap ${m.maxGap.toFixed(0)} ms, ${m.longTasks} long tasks (longest ${m.longest.toFixed(0)} ms), ${m.frames} frames`);
  check(w.maxGap < 200, `the page keeps running during a heavy export in the worker (longest gap ${w.maxGap.toFixed(0)} ms)`);
}
if (want("loss")) {
  const r = await page.evaluate(() => window.contextLoss());
  check(r.lost && r.restored, `context lost (${r.lost}) and restored (${r.restored})`);
  check(r.after === r.before && r.worst <= 1, `previews render again after the loss: ${r.after}/${r.before}, differ by ${r.worst}/255`);
}
if (want("timeout")) {
  const r = await page.evaluate(() => window.timeout());
  check(r.kind === "timeout", `a render over budget is stopped: ${r.kind} (${r.message})`);
  check(r.afterwards === "renders", `the worker renders afterwards: ${r.afterwards}`);
}
if (want("cancel")) {
  const r = await page.evaluate(() => window.cancel());
  check(r.kind === "cancelled", `an export can be cancelled: ${r.kind} after ${r.ms.toFixed(0)} ms`);
  check(r.afterwards === "renders", `the worker renders afterwards: ${r.afterwards}`);
}
if (want("images")) {
  const r = await page.evaluate(() => window.imageExport());
  const orange = (p) => p[0] > 250 && Math.abs(p[1] - 128) < 3 && p[2] < 3;
  check(orange(r.worker) && orange(r.page), `an export waits for its pictures: ${r.worker.join(",")} (worker), ${r.page.join(",")} (page)`);
}
if (want("prune")) {
  const r = await page.evaluate(() => window.prune());
  const flat = (a) => a.every((x) => x === a[0]);
  check(flat(r.sizes) && flat(r.mainSizes), `renders of deleted Buffer nodes are freed: kept ${r.sizes.join(",")} (worker), ${r.mainSizes.join(",")} (page)`);
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
