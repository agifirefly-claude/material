/* Headless checks run by tests/run-harness.mjs: compiles every library node and renders every example. */
import { loadRegistry, registry } from "../src/engine/registry";
import { createGen, loadProject } from "../src/engine/loader";
import { GenContext } from "../src/engine/context";
import { Renderer, ShaderError } from "../src/engine/render/renderer";
import { GenGraph } from "../src/engine/gen/graph";
import { GenMaterial } from "../src/engine/gen/misc";
import type { Gen } from "../src/engine/gen/base";
import { GenSDF } from "../src/engine/gen/sdf";
import { SDF_ITEM_TYPES, newSceneItem, type SdfScene } from "../src/engine/sdf/builder";

declare global {
  interface Window {
    runNodes: () => Promise<unknown>;
    runExamples: (names?: string[]) => Promise<unknown>;
    renderExample: (name: string, output: number, size: number) => Promise<string>;
    runSdf: () => Promise<{ ok: number; failures: Record<string, string> }>;
    renderSdf: (output: number, size: number) => Promise<string>;
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

/* ---------- Easy SDF ---------- */
let sdfIndex = 0;
function item(type: string, children: SdfScene[] = [], params: Record<string, unknown> = {}): SdfScene {
  const s = newSceneItem(type, ++sdfIndex);
  s.children = children;
  Object.assign(s.parameters, params);
  return s;
}
const red = { r: 1, g: 0.1, b: 0.1, a: 1 };
const blue = { r: 0.1, g: 0.3, b: 1, a: 1 };

/** hand made scenes covering booleans, smooth booleans, alterations, generators and colour channels */
function sdfScenes(): Record<string, SdfScene[]> {
  return {
    "2d": [
      item("Union", [
        item("SmoothUnion", [item("Circle", [], { position_x: -0.2, radius: 0.25 }), item("Box", [item("Albedo2D", [item("Uniform", [], { color: red })])], { position_x: 0.2, size_x: 0.2, size_y: 0.3 })], { k: 0.5 }),
        item("Difference", [item("Polygon", [], { position_y: 0.3 }), item("Star", [], { radius: 0.2, position_y: 0.3 })]),
        item("Albedo2D", [item("Blend", [item("Uniform", [], { color: blue }), item("FBM"), item("Step", [item("Pattern")])])]),
        item("Roughness2D", [item("GreyscaleUniform", [], { value: 0.3 })]),
      ]),
    ],
    "3d": [
      item("Union3D", [
        item("Sphere", [item("Albedo3D", [item("Uniform", [], { color: red })])], { position_x: 0.3, radius: 0.3 }),
        item("Difference3D", [item("Box3D", [], { angle_y: 30 }), item("Cylinder", [], { axis: 1 })], { position_x: -0.3 }),
        item("SmoothUnion3D", [item("Torus"), item("Sphere", [], { radius: 0.2 })], { position_y: 0.4 }),
        item("Extrusion", [item("Circle", [], { radius: 0.2 })], { position_z: 0.2 }),
        item("Revolution", [item("Box", [], { size_x: 0.1 })]),
        item("Twist", [item("Box3D")], { angle: 90 }),
        item("Distort3D", [item("Sphere"), item("FBM")]),
        item("Albedo3D", [item("SimpleGradient", [item("Pattern")])]),
        item("Metallic3D", [item("Deform", [item("FBM"), item("Pattern")])]),
      ]),
    ],
  };
}

/** every item type in a minimal scene that is valid for it */
function itemScenes(): Record<string, SdfScene[]> {
  const out: Record<string, SdfScene[]> = {};
  for (const t of SDF_ITEM_TYPES) {
    const name = "item:" + t.itemType;
    switch (t.category) {
      case "SDF2D":
        out[name] = [item(t.itemType, [item("Circle", [], { radius: 0.2 }), item("Box", [], { size_x: 0.2 })])];
        break;
      case "SDF3D":
        out[name] = [item(t.itemType, t.childrenTypes().includes("SDF2D") ? [item("Circle", [], { radius: 0.2 })] : [item("Sphere", [], { radius: 0.3 }), item("Box3D", [], { size_x: 0.2 })])];
        break;
      case "SDF2D_COLOR":
        out[name] = [item("Union", [item("Circle"), item(t.itemType, [item("FBM")])])];
        break;
      case "SDF3D_COLOR":
        out[name] = [item("Union3D", [item("Sphere"), item(t.itemType, [item("FBM")])])];
        break;
      case "TEX":
        out[name + " (2D)"] = [item("Union", [item("Circle"), item("Albedo2D", [item(t.itemType, [item("FBM"), item("Uniform"), item("Pattern")])])])];
        out[name + " (3D)"] = [item("Union3D", [item("Sphere"), item("Albedo3D", [item(t.itemType, [item("FBM"), item("Uniform"), item("Pattern")])])])];
        break;
    }
  }
  return out;
}

function checkGen(r: Renderer, g: Gen): string | null {
  const outs = g.getOutputDefs();
  if (!outs.length) return "no outputs";
  for (let i = 0; i < outs.length; i++) {
    const sc = g.getShaderCode("uv", i, new GenContext());
    const e = r.check(sc);
    if (e) return `out ${i}: ${firstError(e)}`;
  }
  return null;
}

window.runSdf = async () => {
  const r = await rp;
  const failures: Record<string, string> = {};
  let ok = 0;
  const run = (name: string, f: () => Gen, reload = true) => {
    try {
      const root = new GenGraph();
      const g = f();
      root.addGenerator(g);
      const e = checkGen(r, g);
      if (e) failures[name] = e;
      else ok++;
      // round trip through the file format (the editor mode is not saved, as in Material Maker)
      if (!reload) return;
      const g2 = createGen(JSON.parse(JSON.stringify(g.serialize())));
      if (!(g2 instanceof GenSDF)) failures[name + " (reload)"] = "reloaded as " + g2?.getType();
      else if (JSON.stringify(g2.shaderModel) !== JSON.stringify((g as GenSDF).shaderModel)) failures[name + " (reload)"] = "shader model differs after reload";
    } catch (e) {
      failures[name] = String((e as Error).stack ?? e);
    }
  };
  run("library item", () => createGen({ type: "sdf", name: "sdf_3", parameters: {}, sdf_scene: [], seed: 0, seed_locked: false })!);
  const scenes = { ...sdfScenes(), ...itemScenes() };
  for (const [name, scene] of Object.entries(scenes)) {
    for (const editorMode of [false, true]) {
      run(name + (editorMode ? " [editor]" : ""), () => {
        const g = new GenSDF();
        g.editor = editorMode;
        g.setSdfScene(structuredClone(scene));
        return g;
      }, !editorMode);
    }
  }
  return { ok, failures };
};

window.renderSdf = async (output: number, size: number) => {
  const r = await rp;
  const g = new GenSDF();
  new GenGraph().addGenerator(g);
  g.setSdfScene(sdfScenes()["2d"]);
  const t = r.render(g.getShaderCode("uv", output, new GenContext()), size);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.putImageData(r.toImageData(t), 0, 0);
  return c.toDataURL("image/png");
};
