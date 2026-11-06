/* Node editor model round trip, user libraries, subgraph expansion and translations. */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initRegistry, registry } from "../../src/engine/registry";
import { createGen, loadProject } from "../../src/engine/loader";
import { GenContext } from "../../src/engine/context";
import { GenGraph } from "../../src/engine/gen/graph";
import { GenShader } from "../../src/engine/gen/shader";
import { GenMaterial } from "../../src/engine/gen/misc";
import { draftFromModel, modelFromDraft } from "../../src/ui/nodeEditor/model";
import { LibraryManager, type KeyValueStore } from "../../src/ui/library/manager";
import { setCatalog, t, tPath } from "../../src/ui/i18n";

const data = path.resolve(__dirname, "../../public/data");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(data, f), "utf8"));

beforeAll(() => {
  initRegistry({ nodes: read("nodes.json"), ioTypes: read("io_types.json"), shaderFunctions: fs.readFileSync(path.join(data, "shader_functions.glsl"), "utf8"), templates: read("templates.json"), library: read("library.json") });
});

/** every output's code, with the generator's instance id factored out */
function codes(g: GenShader): string[] {
  const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
  return outs.map((_, i) => {
    const sc = g.getShaderCode("uv", i, new GenContext());
    return (sc.globals.map((x) => x.code).join("") + sc.defs + sc.code + JSON.stringify(sc.outputValues)).replaceAll(g.genName, "oX");
  });
}

describe("node editor model", () => {
  it("writes back every library node so that it generates the same code", () => {
    const failures: string[] = [];
    let n = 0;
    for (const name of Object.keys(registry.nodes)) {
      const a = createGen({ type: name });
      if (!(a instanceof GenShader)) continue;
      new GenGraph().addGenerator(a);
      const model = modelFromDraft(draftFromModel(a.shaderModel), a instanceof GenMaterial);
      const b = createGen({ type: name })!;
      new GenGraph().addGenerator(b);
      (b as GenShader).setShaderModel(JSON.parse(JSON.stringify(model)));
      n++;
      if (JSON.stringify(codes(a)) !== JSON.stringify(codes(b as GenShader))) failures.push(name);
    }
    expect(n).toBeGreaterThan(300);
    expect(failures).toEqual([]);
  });
});

function memory(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("libraries", () => {
  it("keeps user libraries, aliases, usage and the quick bar across reloads", () => {
    const store = memory();
    const a = new LibraryManager(store);
    a.load();
    expect(a.libraries.map((l) => l.id)).toEqual(["base", "user"]);
    const id = a.createLibrary("Mine");
    a.addItem(id, "Stuff/Noise", { type: "perlin", parameters: { scale_x: 9 } }, "aWNvbg==");
    a.addItem("user", "Mine/Pair", { nodes: [{ name: "a", type: "perlin" }], connections: [] });
    expect(a.renameItem(id, "Stuff/Noise", "Stuff/My noise")).toBe(true);
    a.setAliases("Stuff/My noise", "cloud, fog");
    a.itemCreated("Stuff/My noise");
    a.toggleSection("Pattern");
    a.setQuick(0, "Stuff/My noise");
    const b = new LibraryManager(store);
    b.load();
    expect(b.library(id)?.items.map((i) => [i.tree_item, i.display_name, i.icon_data])).toEqual([["Stuff/My noise", "My noise", "aWNvbg=="]]);
    expect(b.library("user")?.items.length).toBe(1);
    expect(b.search("fog")[0].tree_item).toBe("Stuff/My noise");
    expect(b.usage["Stuff/My noise"]).toBe(1);
    expect(b.items().some((i) => i.tree_item.startsWith("Pattern/"))).toBe(false);
    expect(b.quick[0]).toBe("Stuff/My noise");
  });

  it("exports and imports Material Maker library files", () => {
    const a = new LibraryManager(memory());
    a.load();
    const text = a.exportLibrary("base");
    const parsed = JSON.parse(text);
    expect(parsed.lib.length).toBe(registry.library.length);
    const id = a.importLibrary(text, "copy");
    expect(a.library(id)?.items.length).toBe(registry.library.length);
    expect(() => a.importLibrary('{"lib": [{"nope": 1}]}')).toThrow();
  });
});

describe("subgraphs", () => {
  it("expanding a group gives back the same material", () => {
    const g = loadProject(read("examples/bricks.json"));
    const m = g.children.find((c) => c instanceof GenMaterial) as GenMaterial;
    const norm = () => codes(m).join("").replace(/\/\/[^\n]*/g, "").replace(/o\d+/g, "o");
    const before = norm();
    const picked = g.children.filter((c) => ["colorize", "colorize_2", "blend_0", "adjust_hsv_0"].includes(c.name));
    expect(picked.length).toBeGreaterThan(1);
    const sub = g.createSubgraph(picked)!;
    expect(norm()).toBe(before);
    g.expandSubgraph(sub);
    expect(g.children.includes(sub)).toBe(false);
    expect(norm()).toBe(before);
  });
});

describe("translations", () => {
  it("translates through the catalog, with arguments and paths", () => {
    setCatalog("zh", { File: "文件", Filter: "过滤器", Blur: "模糊" });
    expect(t("File")).toBe("文件");
    expect(t("Unknown")).toBe("Unknown");
    expect(t("{0} nodes · {1} links", 3, 4)).toBe("3 个节点 · 4 条连线");
    expect(tPath("Filter/Blur")).toBe("过滤器/模糊");
    setCatalog("en", {});
    expect(t("{0} nodes · {1} links", 3, 4)).toBe("3 nodes · 4 links");
  });
});
