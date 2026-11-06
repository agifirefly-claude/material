import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../src/ui/Manual";

describe("user manual markdown", () => {
  it("parses headings, lists, tables and code", () => {
    const b = parseMarkdown(["# T", "", "Some **bold** text", "on two lines.", "", "- a", "  - a1", "- b", "", "1. one", "", "   ```bash", "   npm i", "   ```", "", "2. two", "", "| x | y |", "| --- | --- |", "| 1 | 2 |", "", "```", "code", "```"].join("\n"));
    expect(b.map((x) => x.kind)).toEqual(["h", "p", "list", "list", "table", "code"]);
    expect(b[1]).toEqual({ kind: "p", text: "Some **bold** text on two lines." });
    const ul = b[2] as Extract<(typeof b)[number], { kind: "list" }>;
    expect(ul.items.map((i) => i.text)).toEqual(["a", "b"]);
    expect(ul.items[0].children[0].kind).toBe("list");
    const ol = b[3] as Extract<(typeof b)[number], { kind: "list" }>;
    expect(ol.ordered).toBe(true);
    expect(ol.items.length).toBe(2);
    expect(ol.items[0].children[0]).toEqual({ kind: "code", text: "npm i" });
    expect(b[4]).toEqual({ kind: "table", head: ["x", "y"], rows: [["1", "2"]] });
  });
  it("reads the whole manual, every table row with its columns", () => {
    const b = parseMarkdown(fs.readFileSync("docs/用户手册.md", "utf8"));
    expect(b.filter((x) => x.kind === "h" && x.level === 2).length).toBeGreaterThanOrEqual(12);
    for (const x of b) if (x.kind === "table") for (const r of x.rows) expect(r.length).toBe(x.head.length);
  });
});
