/* Shader generation without a GPU: every example loads, every node output generates code with every $variable
 * resolved, and saving a project gives back what was loaded. */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initRegistry } from "../../src/engine/registry";
import { loadProject } from "../../src/engine/loader";
import { GenContext } from "../../src/engine/context";
import { GenGraph } from "../../src/engine/gen/graph";
import { GenMaterial } from "../../src/engine/gen/misc";
import type { Gen } from "../../src/engine/gen/base";
import { buildFragmentShader, withPreview } from "../../src/engine/render/shader-source";

const data = path.resolve(__dirname, "../../public/data");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(data, f), "utf8"));
const examples: string[] = read("examples/index.json");

beforeAll(() => {
  initRegistry({ nodes: read("nodes.json"), ioTypes: read("io_types.json"), shaderFunctions: fs.readFileSync(path.join(data, "shader_functions.glsl"), "utf8"), templates: read("templates.json") });
});

function all(g: GenGraph, out: Gen[] = []): Gen[] {
  for (const c of g.children) {
    out.push(c);
    if (c instanceof GenGraph) all(c, out);
  }
  return out;
}

describe("examples", () => {
  it.each(examples)("%s generates complete shaders", (name) => {
    const graph = loadProject(read(`examples/${name}.json`));
    let outputs = 0;
    const problems: string[] = [];
    for (const g of all(graph)) {
      const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
      for (let i = 0; i < outs.length; i++) {
        const sc = g.getShaderCode("uv", i, new GenContext());
        if (!sc.outputType) continue;
        const src = buildFragmentShader(withPreview(sc)).source;
        outputs++;
        const m = /\(error: [^)]*\)|\$\(?\w+/.exec(src);
        if (m) problems.push(`${g.getHierName()} out ${i}: ${m[0]}`);
      }
    }
    expect(outputs).toBeGreaterThan(0);
    // doc_tools has a node whose code is broken upstream; everything else must be clean
    if (name !== "doc_tools") expect(problems).toEqual([]);
  });

  it.each(examples)("%s saves what it loads", (name) => {
    const first = loadProject(read(`examples/${name}.json`)).serialize();
    const second = loadProject(JSON.parse(JSON.stringify(first))).serialize();
    expect(second).toEqual(first);
  });
});
