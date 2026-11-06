/* The layers of the code: the engine, the exporters and the file formats work without the editor UI
 * (in Node for these tests, in a command line tool), so none of them may import from src/ui. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(__dirname, "../../src");
const LOWER = ["engine", "export", "formats"];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** the modules a file imports (static and dynamic), relative to src */
function imports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith(".")) out.push(path.relative(src, path.resolve(path.dirname(file), spec)));
  }
  return out;
}

describe("layers", () => {
  for (const layer of LOWER) {
    it(`src/${layer} does not import the UI`, () => {
      const bad = files(path.join(src, layer)).flatMap((f) =>
        imports(f)
          .filter((i) => i === "ui" || i.startsWith("ui" + path.sep))
          .map((i) => `${path.relative(src, f)} → ${i}`),
      );
      expect(bad).toEqual([]);
    });
  }
  it("src/formats depends on nothing else in src", () => {
    const bad = files(path.join(src, "formats")).flatMap((f) =>
      imports(f)
        .filter((i) => !i.startsWith("formats"))
        .map((i) => `${path.relative(src, f)} → ${i}`),
    );
    expect(bad).toEqual([]);
  });
});
