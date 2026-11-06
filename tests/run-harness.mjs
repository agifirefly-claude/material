// Runs tests/harness.ts in headless Chromium against a Vite dev server: node compile check and example renders.
import { launchChromium } from "../scripts/playwright.mjs";
import { createServer } from "vite";
import fs from "node:fs";

const mode = process.argv[2] ?? "all";
const server = await createServer({ server: { port: +(process.env.HARNESS_PORT ?? 5199), host: "127.0.0.1" }, logLevel: "error", cacheDir: process.env.VITE_CACHE_DIR || undefined });
await server.listen();
// the port Vite really took: when the asked one is busy (another checkout's harness) it moves to the next one
const port = server.httpServer.address().port;
const browser = await launchChromium();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(`http://127.0.0.1:${port}/tests/harness.html`);
await page.waitForFunction(() => typeof window.runNodes === "function");
let failed = false;
if (mode === "all" || mode === "nodes") {
  const r = await page.evaluate(() => window.runNodes());
  const f = Object.entries(r.failures);
  console.log(`nodes: ${r.ok} ok, ${f.length} failing`);
  for (const [k, v] of f) console.log(`  ${k}: ${v}`);
  if (f.length) failed = true;
}
if (mode === "all" || mode === "examples") {
  const names = process.argv.slice(3);
  const r = await page.evaluate((n) => window.runExamples(n.length ? n : undefined), names);
  let bad = 0;
  for (const [k, v] of Object.entries(r)) {
    if (v.failureCount) {
      bad++;
      console.log(`${k}: ${v.rendered} rendered, ${v.failureCount} failures`);
      for (const x of v.failures) console.log("   " + x);
    }
  }
  console.log(`examples: ${Object.keys(r).length - bad} clean, ${bad} with failures`);
  if (bad) failed = true;
}
if (mode === "all" || mode === "exports") {
  const r = await page.evaluate(() => window.runExports());
  let bad = 0;
  for (const [k, v] of Object.entries(r)) {
    const problem = v.error || v.leftovers.length;
    if (problem) bad++;
    console.log(`${problem ? "FAIL" : "ok  "} ${k}: ${v.error ?? v.files.length + " files"}${v.leftovers?.length ? "\n     " + v.leftovers.slice(0, 5).join("\n     ") : ""}`);
  }
  if (bad) failed = true;
}
if (mode === "tiling") {
  // node tests/run-harness.mjs tiling [type...]: whether nodes tile (by default every generator and brick node);
  // prints, per output, the share of pixels (%) that change one tile over
  const types = process.argv.slice(3);
  // Checked: the render at uv equals the render one tile over (uv + (1,0), uv + (0,1)). Not checked:
  const EXEMPT = {
    // not meant to tile
    bricks_nontileable: "by design",
    box: "a shape", sphere: "a shape", circular_gradient: "a gradient", spiral_gradient: "a gradient",
    sine_wave: "a wave line across the tile", mesh_curvature: "baked from a mesh",
    // tile, but are only defined on one tile, which this check goes beyond
    bricks_uneven: "subdivides the unit square, so no brick crosses the edge",
    // each grid cell has its own random value and the cells line up with the tile edge, so the edge is one more
    // cell boundary; the infinite plane is not periodic because the hash takes absolute cell numbers
    color_noise: "independent cells", noise_color: "independent cells", noise_white: "independent cells",
    truchet: "independent cells", iching: "independent cells", runes: "independent cells", diagonal_weave: "independent cells",
    noise_anisotropic: "rows are independent; wraps horizontally",
  };
  const list = types.length ? types : [...new Set([...(await page.evaluate(() => window.generatorTypes())), ...(await page.evaluate(() => window.brickTypes()))])].sort().filter((t) => !(t in EXEMPT));
  for (const t of list) {
    const outs = await page.evaluate((t) => window.outputCount(t), t);
    const per = [];
    for (let o = 0; o < outs; o++) {
      let worst = 0;
      for (const seed of [0, 1, 2]) {
        const r = await page.evaluate(([t, o, s]) => window.tileSeam(t, o, 256, s), [t, o, seed]);
        worst = Math.max(worst, r.x, r.y);
        if (process.env.TILING_PNG) fs.writeFileSync(`${process.env.TILING_PNG}/${t}_${o}_${seed}.png`, Buffer.from(r.png.split(",")[1], "base64"));
      }
      per.push(worst);
    }
    // under 1%: pixels exactly on a cell boundary can round to either cell, inside the tile as much as at its edge
    const bad = per.some((w) => w > 1);
    if (bad) failed = true;
    console.log(`${bad ? "SEAM" : "ok  "} ${t}: ${per.map((w) => w.toFixed(2)).join(" ")}`);
  }
}
if (mode === "export-text") {
  const [type, profile, file = "0"] = process.argv.slice(3);
  console.log(await page.evaluate(([t, p, f]) => window.exportText(t, p, +f), [type, profile, file]));
}
if (mode === "ray") {
  const [type, input, node, file] = process.argv.slice(3);
  const url = await page.evaluate(([t, i, n]) => window.rayShot(t, i, n), [type, input, node]);
  fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", file);
}
if (mode === "all" || mode === "sdf") {
  const r = await page.evaluate(() => window.runSdf());
  const f = Object.entries(r.failures);
  console.log(`sdf: ${r.ok} scenes compile, ${f.length} failing`);
  for (const [k, v] of f) console.log(`  ${k}: ${v}`);
  if (f.length) failed = true;
}
if (mode === "sdfbuilder") {
  const [which = "2d", size = "256", file = "sdfbuilder.png"] = process.argv.slice(3);
  const url = await page.evaluate(([w, s]) => window.renderSdfBuilder(w, +s), [which, size]);
  fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", file);
}
if (mode === "sdfshot") {
  const [out = "0", size = "256", file = "sdf.png"] = process.argv.slice(3);
  const url = await page.evaluate(([o, s]) => window.renderSdf(+o, +s), [out, size]);
  fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", file);
}
if (mode === "shot") {
  const [name, out = "0", size = "512", file = `${name}.png`] = process.argv.slice(3);
  const url = await page.evaluate(([n, o, s]) => window.renderExample(n, +o, +s), [name, out, size]);
  fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  console.log("wrote", file);
}
/* ---------- mesh maps and painting ---------- */
if (mode === "bake" || mode === "paint") {
  const dir = process.argv[3] ?? ".";
  fs.mkdirSync(dir, { recursive: true });
  const r = mode === "bake" ? await page.evaluate(() => window.bakeMaps(256, 16)) : await page.evaluate(() => window.paintTest(256));
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "string" && v.startsWith("data:image/png")) {
      fs.writeFileSync(`${dir}/${mode}_${k}.png`, Buffer.from(v.split(",")[1], "base64"));
      console.log("wrote", `${dir}/${mode}_${k}.png`);
    } else console.log(k, JSON.stringify(v).slice(0, 2000));
  }
}
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
