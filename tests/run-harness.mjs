// Runs tests/harness.ts in headless Chromium against a Vite dev server: node compile check and example renders.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { createServer } from "vite";
import fs from "node:fs";

const mode = process.argv[2] ?? "all";
const port = +(process.env.HARNESS_PORT ?? 5199);
const server = await createServer({ server: { port, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
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
if (mode === "all" || mode === "sdf") {
  const r = await page.evaluate(() => window.runSdf());
  const f = Object.entries(r.failures);
  console.log(`sdf: ${r.ok} scenes compile, ${f.length} failing`);
  for (const [k, v] of f) console.log(`  ${k}: ${v}`);
  if (f.length) failed = true;
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
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
