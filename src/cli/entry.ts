/* The page the command line (bin/material-pro.mjs) drives in headless Chromium: the engine and the exporters,
 * without the editor. Files go in and out as base64 strings. */
import { loadRegistry } from "../engine/registry";
import { Renderer } from "../engine/render/renderer";
import { loadProject } from "../engine/loader";
import { parseProject } from "../engine/ptex";
import { findMaterial } from "../engine/materialMaps";
import { resolveTarget, runExport, runRender, targetsOf, type ExportOptions } from "../export/run";

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

let renderer: Renderer | null = null;
const ready = (async () => {
  await loadRegistry("data/");
  renderer = new Renderer();
})();

function open(text: string) {
  const data = parseProject(text);
  if (!data || !Array.isArray((data as { nodes?: unknown }).nodes)) throw new Error("not a Material Maker / Material Pro project (.ptex)");
  return loadProject(data);
}

const api = {
  ready: () => ready.then(() => true),
  async info(text: string) {
    await ready;
    const g = open(text);
    const m = findMaterial(g);
    return { material: m ? m.getTypeName() : null, size: m?.imageSize ?? null, targets: targetsOf(g) };
  },
  async export(text: string, o: ExportOptions) {
    await ready;
    const g = open(text);
    const t = resolveTarget(g, o.target);
    if (!t) throw new Error(`no export target like “${o.target}”`);
    const { files } = await runExport(renderer!, g, { ...o, target: t.target });
    return { target: t.target, exact: t.exact, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, b64(v)])) };
  },
  async render(text: string, node: string, output: number, size: number, format: "png" | "jpg" | "webp") {
    await ready;
    return b64(await runRender(renderer!, open(text), node, output, size, format));
  },
};

(window as unknown as { materialProCli: typeof api }).materialProCli = api;
