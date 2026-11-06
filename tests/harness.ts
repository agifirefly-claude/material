/* Headless checks run by tests/run-harness.mjs: compiles every library node and renders every example. */
import { loadRegistry, registry } from "../src/engine/registry";
import { createGen, loadProject } from "../src/engine/loader";
import { GenContext } from "../src/engine/context";
import { Renderer, ShaderError } from "../src/engine/render/renderer";
import { GenGraph } from "../src/engine/gen/graph";
import { GenMaterial } from "../src/engine/gen/misc";
import type { Gen } from "../src/engine/gen/base";
import { GenSDF } from "../src/engine/gen/sdf";
import { sdfPreview2D, sdfPreview3D } from "../src/engine/sdf/preview";
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
      if (editorMode) {
        // the builder window's own preview of the scene
        try {
          const g = new GenSDF();
          g.editor = true;
          new GenGraph().addGenerator(g);
          g.setSdfScene(structuredClone(scene));
          const sc = g.getSceneType() === "SDF3D" ? sdfPreview3D(g, { yaw: 0.5, pitch: -0.3, dist: 3, target: [0, 0, 0] }, scene[0].index) : sdfPreview2D(g, { center: { x: 0.5, y: 0.5 }, scale: 1.2, style: 0 }, scene[0].index);
          const e = r.check(sc, false);
          if (e) failures[name + " [builder preview]"] = firstError(e);
          else ok++;
        } catch (e) {
          failures[name + " [builder preview]"] = String((e as Error).stack ?? e);
        }
      }
    }
  }
  return { ok, failures };
};

window.renderSdf = async (output: number, size: number) => {
  const r = await rp;
  const g = new GenSDF();
  new GenGraph().addGenerator(g);
  g.setSdfScene(sdfScenes()["2d"]);
  return renderToUrl(r, g.getShaderCode("uv", output, new GenContext()), size);
};

function renderToUrl(r: Renderer, sc: import("../src/engine/shader-code").ShaderCode, size: number, preview = true): string {
  const t = r.render(sc, size, { preview });
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.putImageData(r.toImageData(t), 0, 0);
  return c.toDataURL("image/png");
}

declare global {
  interface Window {
    renderSdfBuilder: (which: string, size: number) => Promise<string>;
  }
}
/** the builder window's preview of one of the test scenes, as a PNG */
window.renderSdfBuilder = async (which: string, size: number) => {
  const r = await rp;
  const g = new GenSDF();
  g.editor = true;
  new GenGraph().addGenerator(g);
  const scene = sdfScenes()[which];
  g.setSdfScene(scene);
  const sel = scene[0].children[0].index;
  const sc = which === "3d" ? sdfPreview3D(g, { yaw: 0.5, pitch: -0.3, dist: 3, target: [0, 0, 0] }, sel) : sdfPreview2D(g, { center: { x: 0.5, y: 0.5 }, scale: 1.2, style: 0 }, sel);
  return renderToUrl(r, sc, size, false);
};

/* ---------- mesh maps and painting (src/engine/paint) ---------- */
import { sphereMesh, setCurrentMesh } from "../src/engine/paint/mesh";
import { BAKE_SETTINGS, mapGeneratorFor, type MapName } from "../src/engine/paint/mapgen";
import { installMeshMaps } from "../src/engine/paint/meshmaps";
import { PaintProject, findFile, unpackFiles } from "../src/engine/paint/project";
import { gpuFor } from "../src/engine/paint/gpu";
import type { Target } from "../src/engine/render/renderer";
declare global {
  interface Window {
    bakeMaps: (size: number, rays: number) => Promise<Record<string, string>>;
    paintTest: (size: number) => Promise<Record<string, unknown>>;
  }
}
function targetUrl(r: Renderer, t: Target, scale = 1, offset = 0): string {
  const px = gpuFor(r).read(t);
  const d = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i++) d[i] = Math.round(Math.min(1, Math.max(0, i % 4 === 3 ? px[i] : px[i] * scale + offset)) * 255);
  const c = document.createElement("canvas");
  c.width = c.height = t.size;
  c.getContext("2d")!.putImageData(new ImageData(d, t.size, t.size), 0, 0);
  return c.toDataURL("image/png");
}
/** bakes every map of a sphere, and renders a Mesh Map node through the node path */
window.bakeMaps = async (size, rays) => {
  const r = await rp;
  installMeshMaps();
  BAKE_SETTINGS.ray_count = rays;
  const m = sphereMesh(1, 48, 24);
  const mg = mapGeneratorFor(r);
  const out: Record<string, string> = {};
  for (const map of ["seams", "position", "normal", "tangent", "curvature", "ambient_occlusion", "bent_normals", "thickness", "adjacency"] as MapName[]) {
    const t = mg.get(m, map, size);
    out[map] = targetUrl(r, t, map === "curvature" ? 0.25 : 1, map === "curvature" ? 0.5 : 0);
  }
  setCurrentMesh(m);
  const g = new GenGraph();
  const mm = createGen({ type: "meshmap", parameters: { map: 1 } })!;
  g.addGenerator(mm);
  const res = r.render(mm.getShaderCode("uv", 0, new GenContext()), size);
  out.meshmap_node_normal = targetUrl(r, res);
  // curvature sign on a convex mesh
  const px = gpuFor(r).read(mg.get(m, "curvature", size));
  let pos = 0,
    neg = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) px[i] > 0 ? pos++ : px[i] < 0 ? neg++ : 0;
  out.curvature_sign = `${pos} positive, ${neg} negative`;
  return out;
};
/** a paint project on a sphere: strokes with library brushes, undo, a mask layer, save and load */
window.paintTest = async (size) => {
  const r = await rp;
  installMeshMaps();
  const brushes = await fetch("/public/data/brushes.json").then((x) => x.json());
  const byName = (n: string) => brushes.find((b: { tree_item: string }) => b.tree_item === n);
  const m = sphereMesh(1, 48, 24);
  const p = new PaintProject(r, m, null);
  p.setSettings({ texture_size: Math.log2(size) });
  p.initProject();
  const f = 1 / Math.tan((35 * Math.PI) / 360),
    near = 0.1,
    far = 10;
  const proj = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4, 1];
  const mul = (a: number[], b: number[]) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) o[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
    return o;
  };
  p.painter.setView(mul(proj, view), [256, 256]);
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const b of brushes) {
    p.setBrush(b);
    const e = p.painter.checkBrush();
    if (e) errors[b.tree_item] = e;
  }
  out.brushes = brushes.length;
  out.brushErrors = errors;
  p.setBrush(byName("Simple/Uniform"));
  p.brushRemote!.setParameter("param1", { r: 1, g: 0, b: 0, a: 1 });
  p.brushChanged();
  p.painter.params.brush_size = 60;
  for (let i = 0; i <= 10; i++) p.paint({ brush_pos: [60 + i * 14, 128], brush_ppos: [60 + Math.max(0, i - 1) * 14, 128], rect_size: [256, 256] }, i === 10);
  out.uv_at_center = p.painter.viewToTexture(128, 128);
  out.after_stroke = targetUrl(r, p.compositor.maps.albedo!);
  p.setBrush(byName("Material/Wood"));
  p.painter.params.brush_size = 80;
  for (let i = 0; i <= 6; i++) p.paint({ brush_pos: [128, 40 + i * 30], brush_ppos: [128, 40 + Math.max(0, i - 1) * 30], rect_size: [256, 256] }, i === 6);
  out.after_second = targetUrl(r, p.compositor.maps.albedo!);
  out.second_roughness = targetUrl(r, p.compositor.maps.roughness!);
  p.undo();
  out.after_undo = targetUrl(r, p.compositor.maps.albedo!);
  p.selectLayer(p.layers[0]);
  p.addLayer(2);
  p.setBrush(byName("Simple/Uniform"));
  p.painter.params.brush_size = 100;
  p.paint({ brush_pos: [128, 128], brush_ppos: [128, 128], rect_size: [256, 256] }, true);
  out.with_mask = targetUrl(r, p.compositor.maps.albedo!);
  out.brush_preview_ok = !!p.painter.brushPreview([128, 128], [128, 128]);
  // a procedural layer filled by a brush
  p.addLayer(1);
  p.setBrush(byName("Material/Marble"));
  p.brushChanged();
  out.with_procedural = targetUrl(r, p.compositor.maps.albedo!);
  const zip = p.save("test");
  const files = unpackFiles([{ name: "test.zip", data: zip }]);
  out.files = [...files.keys()];
  const data = JSON.parse(new TextDecoder().decode(findFile(files, "test.mmpp")!));
  out.layers = data.layers.map((l: { name: string; type: number; layers?: unknown[] }) => [l.name, l.type, l.layers?.length ?? 0]);
  const q = new PaintProject(r, m, null);
  await q.loadLayers(data, async (name) => {
    const bytes = findFile(files, name);
    if (!bytes) return null;
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    return { width: c.width, height: c.height, data: Float32Array.from(id.data, (v) => v / 255) };
  });
  out.reloaded = targetUrl(r, q.compositor.maps.albedo!);
  // the export graph (export.gd): the maps through the material node
  const { material } = p.exportGraph();
  out.export_albedo = targetUrl(r, r.render(material.getShaderCode("uv", 0, new GenContext()), size));
  return out;
};

declare global {
  interface Window {
    tileSeam: (type: string, output: number, size: number, seed?: number) => Promise<{ x: number; y: number; png: string }>;
  }
}
/** whether a node's output repeats with period 1: the share of pixels (in %) that differ by more than 2/255
 * between the render at uv and at uv shifted by one tile in x and in y */
window.tileSeam = async (type, output, size, seed) => {
  const r = await rp;
  const g = new GenGraph();
  const n = createGen({ type })!;
  g.addGenerator(n);
  if (seed !== undefined) n.seedValue = 0.137 + 0.291 * seed;
  const at = (uv: string) => {
    const t = r.render(n.getShaderCode(uv, output, new GenContext()), size);
    const d = r.toImageData(t).data;
    r.deleteTarget(t);
    return d;
  };
  const base = at("uv");
  const diff = (o: Uint8ClampedArray) => {
    let bad = 0;
    for (let i = 0; i < base.length; i += 4) if (Math.max(Math.abs(base[i] - o[i]), Math.abs(base[i + 1] - o[i + 1]), Math.abs(base[i + 2] - o[i + 2]), Math.abs(base[i + 3] - o[i + 3])) > 2) bad++;
    return (100 * bad) / (size * size);
  };
  const x = diff(at("(uv+vec2(1.0, 0.0))"));
  const y = diff(at("(uv+vec2(0.0, 1.0))"));
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.putImageData(new ImageData(base, size, size), 0, 0);
  return { x, y, png: c.toDataURL("image/png") };
};

declare global {
  interface Window {
    brickTypes: () => Promise<string[]>;
  }
}
window.brickTypes = async () => {
  await rp;
  return Object.keys(registry.nodes).filter((n) => /brick/.test(n)).sort();
};
declare global {
  interface Window {
    outputCount: (type: string) => Promise<number>;
  }
}
window.outputCount = async (type) => {
  await rp;
  const g = new GenGraph();
  const n = createGen({ type })!;
  g.addGenerator(n);
  return n.getOutputDefs().length;
};
declare global {
  interface Window {
    generatorTypes: () => Promise<string[]>;
  }
}
/** library nodes with no inputs and an image output: the generators */
window.generatorTypes = async () => {
  await rp;
  const out: string[] = [];
  for (const t of Object.keys(registry.nodes).sort()) {
    try {
      const g = new GenGraph();
      const n = createGen({ type: t });
      if (!n) continue;
      g.addGenerator(n);
      const outs = n.getOutputDefs();
      if (n.getInputDefs().length === 0 && outs.length && outs.every((o) => ["f", "rgb", "rgba", "fill"].includes(o.type))) out.push(t);
    } catch {
      /* not a plain node */
    }
  }
  return out;
};
