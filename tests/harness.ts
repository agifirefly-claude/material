/* Headless checks run by tests/run-harness.mjs: compiles every library node and renders every example. */
import { loadRegistry, registry } from "../src/engine/registry";
import { createGen, loadProject } from "../src/engine/loader";
import { GenContext } from "../src/engine/context";
import { Renderer, ShaderError } from "../src/engine/render/renderer";
import { GenGraph } from "../src/engine/gen/graph";
import { GenMaterial } from "../src/engine/gen/misc";
import type { Gen } from "../src/engine/gen/base";

declare global {
  interface Window {
    runNodes: () => Promise<unknown>;
    runExamples: (names?: string[]) => Promise<unknown>;
    renderExample: (name: string, output: number, size: number) => Promise<string>;
  }
}

const firstError = (e: ShaderError) => {
  const m = /ERROR: 0:(\d+): (.*)/.exec(e.log);
  if (!m) return e.log.slice(0, 300);
  const line = e.source.split("\n")[parseInt(m[1]) - 1] ?? "";
  return `${m[2]} @ ${line.trim().slice(0, 160)}`;
};

async function init() {
  await loadRegistry("/public/data/");
  return new Renderer();
}
const rp = init();

window.runNodes = async () => {
  const r = await rp;
  const failures: Record<string, string> = {};
  let ok = 0;
  for (const name of Object.keys(registry.nodes)) {
    let g: Gen | null = null;
    try {
      const root = new GenGraph();
      g = createGen({ type: name });
      if (!g) throw new Error("not created");
      root.addGenerator(g);
      const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
      for (let i = 0; i < outs.length; i++) {
        const sc = g.getShaderCode("uv", i, new GenContext());
        const e = r.check(sc);
        if (e) throw new Error(`out ${i}: ${firstError(e)}`);
      }
      ok++;
    } catch (e) {
      failures[name] = String((e as Error).message ?? e);
    }
  }
  return { ok, failures };
};

function allNodes(g: GenGraph, out: Gen[] = []): Gen[] {
  for (const c of g.children) {
    out.push(c);
    if (c instanceof GenGraph) allNodes(c, out);
  }
  return out;
}

window.runExamples = async (names?: string[]) => {
  const r = await rp;
  const index: string[] = names ?? (await fetch("/public/data/examples/index.json").then((x) => x.json()));
  const result: Record<string, unknown> = {};
  for (const name of index) {
    const data = await fetch(`/public/data/examples/${name}.json`).then((x) => x.json());
    const failures: string[] = [];
    let rendered = 0;
    try {
      const graph = loadProject(data);
      for (const g of allNodes(graph)) {
        const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
        for (let i = 0; i < outs.length; i++) {
          try {
            const sc = g.getShaderCode("uv", i, new GenContext());
            if (!sc.outputType) continue;
            r.render(sc, 64);
            rendered++;
          } catch (e) {
            failures.push(`${g.getHierName()} (${g.model ?? g.getType()}) out ${i}: ${e instanceof ShaderError ? firstError(e) : String(e)}`);
          }
        }
      }
      for (const [k, e] of r.errors) failures.push(`buffer ${k}: ${firstError(e)}`);
      r.errors.clear();
    } catch (e) {
      failures.push("load: " + String(e) + (e as Error).stack);
    }
    result[name] = { rendered, failures: failures.slice(0, 20), failureCount: failures.length };
  }
  return result;
};

window.renderExample = async (name: string, output: number, size: number) => {
  const r = await rp;
  const data = await fetch(`/public/data/examples/${name}.json`).then((x) => x.json());
  const graph = loadProject(data);
  const m = graph.children.find((c) => c instanceof GenMaterial) as GenMaterial;
  const t = r.render(m.getShaderCode("uv", output, new GenContext()), size);
  const img = r.toImageData(t);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
};

import { exportProfiles, planExport } from "../src/engine/export";
import { newProject } from "../src/engine/loader";
declare global {
  interface Window {
    runExports: () => Promise<unknown>;
  }
}
/** every export profile of every material type, on an example graph (static) or a new project wired to noise (dynamic) */
window.runExports = async () => {
  await rp;
  const out: Record<string, unknown> = {};
  const data = await fetch(`/public/data/examples/bricks.json`).then((x) => x.json());
  const projects: [string, GenGraph][] = [["bricks (material)", loadProject(data)]];
  for (const t of ["material_dynamic", "material_unlit", "material_3d", "material_raymarching", "material_tesselated"]) {
    const p = newProject(t);
    const m = p.children[0];
    const noise = createGen({ type: "perlin" })!;
    p.addGenerator(noise);
    // connect the first compatible input
    const i = m.getInputDefs().findIndex((d) => ["f", "rgb", "rgba"].includes(d.type));
    if (i >= 0) p.connectChildren(noise, 0, m, i);
    projects.push([t, p]);
  }
  for (const [label, g] of projects) {
    const m = g.children.find((c) => c instanceof GenMaterial) as GenMaterial;
    for (const prof of exportProfiles(m)) {
      try {
        const files = planExport(m, prof, "test");
        const leftovers = files.flatMap((f) => (f.kind === "text" ? [...f.text.matchAll(/\$(if|fi|else|begin_generate|end_generate|definitions|begin_buffers|uid\(|\(\w+:)[^\n]{0,40}/g)].map((x) => f.name + ": " + x[0]) : []));
        out[`${label} / ${prof}`] = { files: files.map((f) => `${f.kind}:${f.name}`), leftovers };
      } catch (e) {
        out[`${label} / ${prof}`] = { error: String(e) };
      }
    }
  }
  return out;
};
declare global {
  interface Window {
    exportText: (type: string, profile: string, file: number) => Promise<string>;
  }
}
window.exportText = async (type, profile, file) => {
  await rp;
  const p = newProject(type);
  const m = p.children[0] as GenMaterial;
  const noise = createGen({ type: "perlin" })!;
  p.addGenerator(noise);
  p.connectChildren(noise, 0, m, m.getInputDefs().findIndex((d) => ["f", "rgb", "rgba"].includes(d.type)));
  const f = planExport(m, profile, "test")[file];
  return f.kind === "text" ? f.name + "\n" + f.text : f.name;
};
import { raymarchPreview } from "../src/engine/preview3d";
declare global {
  interface Window {
    rayShot: (type: string, input: string, node: string) => Promise<string>;
  }
}
/** the 3D preview of a material evaluated in 3D space, with one library node connected */
window.rayShot = async (type, input, node) => {
  const r = await rp;
  const p = newProject(type);
  const m = p.children[0] as GenMaterial;
  const n = createGen({ type: node })!;
  p.addGenerator(n);
  p.connectChildren(n, 0, m, m.getInputDefs().findIndex((d) => d.name === input));
  const res = r.renderKeyed("ray", raymarchPreview(m, { yaw: 0.6, pitch: -0.35, dist: 2.2 }, "sphere"), 256, false);
  if (res.error) throw new Error(res.error.log);
  const img = r.toImageData(res.target!);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
};
