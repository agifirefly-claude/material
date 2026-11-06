// Shared steps for the UI suite. Steps wait on state (window.mmEditor, the DOM, the renderer), not on time.
import crypto from "node:crypto";
import fs from "node:fs";

export class AssertionError extends Error {}
export function assert(cond, message) {
  if (!cond) throw new AssertionError(message);
}
export function eq(actual, expected, message) {
  const a = JSON.stringify(actual),
    e = JSON.stringify(expected);
  if (a !== e) throw new AssertionError(`${message}: expected ${e}, got ${a}`);
}

/** polls fn (in node) until it returns a truthy value */
export async function until(fn, message = "condition", timeout = 15_000, every = 100) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() - t0 > timeout) throw new AssertionError(`timed out waiting for ${message}${last instanceof Error ? ": " + last.message : ""}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/** evaluates fn(editor, arg) in the page */
export const ed = (page, fn, arg) => page.evaluate(([src, a]) => new Function("ed", "arg", `return (${src})(ed, arg)`)(window.mmEditor, a), [fn.toString(), arg ?? null]);

/** opens the app (an example, or the default) and waits until the graph is drawn */
export async function open(page, base, { example = "bricks", lang = "en" } = {}) {
  const q = new URLSearchParams({ lang });
  if (example) q.set("example", example);
  await page.goto(`${base}/?${q}`);
  await page.waitForFunction(() => window.mmEditor?.renderer && document.querySelector(".react-flow__node"), null, { timeout: 30_000 });
  await idle(page);
}

/** File / Edit / View / Help menu item */
export async function menu(page, label, item) {
  await page.locator(".topbar .menu > button", { hasText: label }).first().click();
  await page.locator(".topbar .menu-list button", { hasText: item }).first().click();
}

/** a new material project through the File menu */
export async function newMaterial(page, lang = "en") {
  await menu(page, lang === "zh" ? "文件" : "File", lang === "zh" ? "新建材质" : "New material");
  await until(() => ed(page, (e) => e.graph.children.length === 1 && e.title === "untitled"), "a new project");
  await fit(page);
}

/** waits until no render happened for `quiet` ms */
export async function idle(page, quiet = 400, timeout = 20_000) {
  const t0 = Date.now();
  let last = -1,
    since = Date.now();
  for (;;) {
    const n = await page.evaluate(() => window.mmEditor?.renderer?.stats.renders ?? 0);
    if (n !== last) {
      last = n;
      since = Date.now();
    } else if (Date.now() - since >= quiet) return;
    if (Date.now() - t0 > timeout) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export const node = (page, name) => page.locator(`.react-flow__node[data-id="${name}"]`);
export const handle = (page, name, id) => node(page, name).locator(`.react-flow__handle[data-handleid="${id}"]`);

export async function fit(page) {
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(300); // fitView animates
}

/** drags from a locator's centre to another locator's centre (or a point), with intermediate moves */
export async function drag(page, from, to, { button = "left" } = {}) {
  const a = await from.boundingBox();
  assert(a, "drag source is visible");
  const p0 = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  let p1 = to;
  if (to && typeof to.boundingBox === "function") {
    const b = await to.boundingBox();
    assert(b, "drag target is visible");
    p1 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down({ button });
  await page.mouse.move(p0.x + (p1.x - p0.x) * 0.3, p0.y + (p1.y - p0.y) * 0.3, { steps: 5 });
  await page.mouse.move(p1.x, p1.y, { steps: 10 });
  await page.mouse.up({ button });
}

/** moves a node by its header */
export async function moveNode(page, name, dx, dy) {
  const head = node(page, name).locator(".head").first();
  const b = await head.boundingBox();
  await drag(page, head, { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy });
}

export const connect = (page, from, fromPort, to, toPort) => drag(page, handle(page, from, "o" + fromPort), handle(page, to, "i" + toPort));

/** adds a library node by searching the library panel and clicking the first result; returns its name */
export async function addFromLibrary(page, query) {
  const before = await ed(page, (e) => e.graph.children.map((c) => c.name));
  const search = page.locator(".lib-search input");
  await search.fill(query);
  await page.locator(".tree .tree-row").first().click();
  await search.fill("");
  return until(() => ed(page, (e, b) => e.graph.children.map((c) => c.name).find((n) => !b.includes(n)), before), `a node for "${query}"`);
}

/** fits the graph in view when a node is outside the graph area (new nodes can land off screen) */
export async function inView(page, name) {
  const head = node(page, name).locator(".head").first();
  await head.waitFor();
  const [b, p] = [await head.boundingBox(), await page.locator(".react-flow__pane").boundingBox()];
  if (!b || b.x < p.x || b.y < p.y || b.x + b.width > p.x + p.width || b.y + b.height > p.y + p.height) await fit(page);
}

/** selects a node by clicking its header */
export async function select(page, name) {
  await inView(page, name);
  await node(page, name).locator(".head").first().click();
  await until(() => ed(page, (e, n) => e.selection.includes(n), name), `${name} selected`);
}

/** a point of the graph area, as fractions of its size */
export async function panePoint(page, fx = 0.05, fy = 0.9) {
  const b = await page.locator(".react-flow__pane").boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

/** sha1 of an element's screenshot: changes when what it shows changes */
export async function pixels(locator) {
  return crypto.createHash("sha1").update(await locator.screenshot()).digest("hex");
}

/** the hash of what an element shows once two screenshots 250 ms apart agree */
export async function stablePixels(locator, timeout = 15_000) {
  const t0 = Date.now();
  let last = await pixels(locator);
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const now = await pixels(locator);
    if (now === last || Date.now() - t0 > timeout) return now;
    last = now;
  }
}

/** a weighted sum of a 2D canvas' pixels */
export const canvasSum = (locator) =>
  locator.evaluate((c) => {
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] * 3 + d[i + 2] * 7;
    return s;
  });

/** the download a click triggers: { name, bytes } */
export async function download(page, click) {
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 45_000 }), click()]);
  return { name: d.suggestedFilename(), bytes: fs.readFileSync(await d.path()) };
}

/** the file names in a zip */
export function zipNames(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert(eocd >= 0, "a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const n = buf.readUInt16LE(p + 28),
      x = buf.readUInt16LE(p + 30),
      c = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + n).toString("utf8"));
    p += 46 + n + x + c;
  }
  return names;
}

export const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
