// UI regression suite: drives the editor in headless Chromium through clicks, drags and keys.
// Usage: node tests/ui/run.mjs [filter...]
//   filters match test or spec file names; UI_PORT picks the dev server port (5380); UI_STOP=1 stops at the first failure.
import { createRequire } from "node:module";
import { createServer } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const port = +(process.env.UI_PORT ?? 5380);
const base = `http://127.0.0.1:${port}`;
const outDir = path.join(here, "output");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const filters = process.argv.slice(2);
const specs = fs
  .readdirSync(path.join(here, "specs"))
  .filter((f) => f.endsWith(".mjs"))
  .sort();
const tests = [];
for (const f of specs) {
  const mod = await import(path.join(here, "specs", f));
  for (const t of mod.tests) tests.push({ ...t, file: f });
}
const selected = tests.filter((t) => !filters.length || filters.some((f) => t.name.includes(f) || t.file.includes(f)));

const server = await createServer({ root: path.resolve(here, "../.."), server: { port, host: "127.0.0.1", strictPort: true }, logLevel: "error" });
await server.listen();
// a project-local Playwright may lack its own browser build: then the machine's Chromium (UI_CHROMIUM) is used
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.UI_CHROMIUM ?? "/opt/pw-browsers/chromium" }));
const started = Date.now();
let passed = 0;
const failures = [];
const workers = Math.max(1, +(process.env.UI_WORKERS ?? 2));
// the longest tests start first, so the workers finish together
const queue = [...selected].sort((a, b) => (b.timeout ?? 0) - (a.timeout ?? 0));
let stop = false;

async function runOne(t) {
  const t0 = Date.now();
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
  // every test starts from an empty browser profile, unless it reloads on purpose (sessionStorage marks that)
  await context.addInitScript(() => {
    if (sessionStorage.getItem("ui-test-keep")) return;
    localStorage.clear();
    // software WebGL: the 3D preview at 15 fps (the FPS limit preference) leaves the CPU to the rest
    localStorage.setItem("material-pro:prefs", JSON.stringify({ fpsLimit: 15 }));
  });
  // ?example=blank opens a project with only the material node, as File > New material makes (fixtures/blank.json)
  await context.route("**/data/examples/blank.json", (r) => r.fulfill({ path: path.join(here, "fixtures", "blank.json"), contentType: "application/json" }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? (t.promptAnswer ?? d.defaultValue()) : undefined).catch(() => {}));
  let error = null;
  let timer;
  try {
    const limit = t.timeout ?? 90_000;
    await Promise.race([t.run({ page, context, base }), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`timed out after ${limit / 1000} s`)), limit)))]);
    if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - t0;
  if (error) {
    failures.push({ t, error });
    const shot = path.join(outDir, t.name.replace(/[^\w]+/g, "_") + ".png");
    await page.screenshot({ path: shot }).catch(() => {});
    const lines = String(error.message ?? error)
      .split("\n")
      .map((l) => l.replace(/\x1b\[\d+m/g, ""))
      .filter((l) => (l.trim() && !/^\s*-/.test(l)) || /waiting for (locator|get)/.test(l))
      .slice(0, 5);
    console.log(`  ✗ ${t.name}  (${ms} ms)\n      ${lines.join("\n      ")}\n      screenshot: ${path.relative(process.cwd(), shot)}`);
    if (process.env.UI_STOP) stop = true;
  } else {
    passed++;
    console.log(`  ✓ ${t.name}  (${ms} ms)`);
  }
  await context.close();
}

await Promise.all(
  Array.from({ length: Math.min(workers, queue.length) }, async () => {
    while (queue.length && !stop) await runOne(queue.shift());
  }),
);
await browser.close();
await server.close();
console.log(`\nui: ${passed} passed, ${failures.length} failed, ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failures.length ? 1 : 0);
