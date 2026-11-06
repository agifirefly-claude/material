/* Regression tests for problems found while reviewing Material Maker's open issues (docs/MaterialMaker问题审查.md). */
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initRegistry } from "../../src/engine/registry";
import { createGen, loadProject } from "../../src/engine/loader";
import { GenContext } from "../../src/engine/context";
import { GenGraph } from "../../src/engine/gen/graph";
import { GenShader } from "../../src/engine/gen/shader";
import { GenMaterial } from "../../src/engine/gen/misc";
import { planExport } from "../../src/engine/export";
import { UNREAL_MM_PY, localizeUnrealScript, needsUnrealMm } from "../../src/export/unrealMm";
import { imageFormatOf } from "../../src/ui/exporting";
import { parseFloatInput } from "../../src/ui/widgets/floatInput";

const data = path.resolve(__dirname, "../../public/data");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(data, f), "utf8"));

beforeAll(() => {
  initRegistry({ nodes: read("nodes.json"), ioTypes: read("io_types.json"), shaderFunctions: fs.readFileSync(path.join(data, "shader_functions.glsl"), "utf8"), templates: read("templates.json"), library: read("library.json") });
});

/** a custom shader node with float parameters a and b, whose output is a + b */
function twoParams(a: number | string, b: number | string): GenShader {
  const g = createGen({
    type: "shader",
    parameters: { a, b },
    shader_model: {
      name: "Test",
      parameters: [
        { name: "a", type: "float", default: 0, min: 0, max: 1, step: 0.01 },
        { name: "b", type: "float", default: 0, min: 0, max: 1, step: 0.01 },
      ],
      inputs: [],
      outputs: [{ type: "f", f: "$a + $b" }],
      code: "",
      global: "",
      instance: "",
    },
  }) as GenShader;
  new GenGraph().addGenerator(g);
  return g;
}

describe("MM #562: parameter expressions that refer to themselves", () => {
  it("does not loop forever when a parameter uses its own value", () => {
    const sc = twoParams("$a * 2.0", 0.5).getShaderCode("uv", 0, new GenContext());
    expect(sc.code).toContain("(error: a refers to itself)");
  });
  it("does not loop forever when two parameters use each other", () => {
    const sc = twoParams("$b", "$a").getShaderCode("uv", 0, new GenContext());
    expect(sc.code).toContain("refers to itself");
  });
  it("still lets a parameter use another one, several times", () => {
    const g = twoParams("$b + $b", 0.25);
    const f = g.getShaderCode("uv", 0, new GenContext()).code;
    expect(f).not.toContain("error");
    expect(f.split(`p_${g.genName}_b`).length - 1).toBe(3);
  });
});

describe("MM #840: export profiles that write .exr maps", () => {
  it("picks the encoder from the file name", () => {
    expect(imageFormatOf("bricks_rough.exr")).toBe("exr");
    expect(imageFormatOf("bricks_albedo.png")).toBe("png");
    expect(imageFormatOf("a.b/c.JPG")).toBe("jpg");
    expect(imageFormatOf("x.webp")).toBe("webp");
  });
  it("the Blender profile asks for .exr files", () => {
    const m = loadProject(read("examples/bricks.json")).children.find((c) => c instanceof GenMaterial) as GenMaterial;
    const exr = planExport(m, "Blender", "bricks").filter((f) => f.kind !== "text" && imageFormatOf(f.name) === "exr");
    expect(exr.length).toBeGreaterThan(0);
  });
});

describe("MM #615: the Unreal 5 script needs mm.py", () => {
  const script = () => {
    const m = loadProject(read("examples/bricks.json")).children.find((c) => c instanceof GenMaterial) as GenMaterial;
    const plan = planExport(m, "Unreal/Unreal Engine 5", "bricks");
    return { plan, py: plan.find((f) => f.kind === "text" && f.name.endsWith(".py")) as { text: string } };
  };
  it("ships mm.py and finds it next to the script", () => {
    const { plan, py } = script();
    expect(needsUnrealMm(plan)).toBe(true);
    const fixed = localizeUnrealScript(py.text);
    expect(fixed).not.toContain("sys.path.append('/export')");
    expect(fixed).toContain("sys.path.append(os.path.dirname(os.path.abspath(__file__)))");
    for (const fn of ["class Material", "def custom_input", "def custom_output", "def import_texture", "def read_text_file"]) expect(UNREAL_MM_PY).toContain(fn);
    // every mm.<name> the script uses is defined in mm.py
    for (const [, name] of fixed.matchAll(/\bmm\.(\w+)\(/g)) expect(UNREAL_MM_PY).toMatch(new RegExp(`^(def|class) ${name}\\b`, "m"));
  });
  it("leaves other scripts alone", () => {
    expect(localizeUnrealScript("sys.path.append('/export')\n")).toBe("sys.path.append('/export')\n");
    expect(needsUnrealMm([{ name: "a.tres", kind: "text", text: "[gd_resource]" }])).toBe(false);
  });
});

describe("MM #204: decimal comma in number fields", () => {
  it("reads 0,5 as 0.5 and leaves expressions alone", () => {
    expect(parseFloatInput("0,5")).toBe("0.5");
    expect(parseFloatInput("-12,25")).toBe("-12.25");
    expect(parseFloatInput(" 3 ")).toBe("3");
    expect(parseFloatInput("min(1,2)")).toBe("min(1,2)");
    expect(parseFloatInput("$a*2")).toBe("$a*2");
  });
});
