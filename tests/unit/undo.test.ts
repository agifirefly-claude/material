/* Undo history: deflated steps under limits, and the editor's undo and redo, within a tab and across tabs. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initRegistry } from "../../src/engine/registry";
import { GenGraph } from "../../src/engine/gen/graph";
import { UndoHistory } from "../../src/ui/undoHistory";
import { editor } from "../../src/ui/store";

const data = path.resolve(__dirname, "../../public/data");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(data, f), "utf8"));

beforeAll(() => {
  vi.useFakeTimers();
  initRegistry({ nodes: read("nodes.json"), ioTypes: read("io_types.json"), shaderFunctions: fs.readFileSync(path.join(data, "shader_functions.glsl"), "utf8"), templates: read("templates.json"), library: read("library.json") });
});
afterAll(() => vi.useRealTimers());

describe("UndoHistory", () => {
  it("goes back and forth through the states it recorded", () => {
    const h = new UndoHistory("a");
    expect(h.record("a")).toBe(false);
    h.record("b");
    h.record("c");
    expect(h.undo()).toBe("b");
    expect(h.undo()).toBe("a");
    expect(h.undo()).toBeUndefined();
    expect(h.current).toBe("a");
    expect(h.redo()).toBe("b");
    expect(h.redo()).toBe("c");
    expect(h.redo()).toBeUndefined();
    h.undo();
    h.record("d");
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe("b");
  });

  it("keeps steps deflated, under a number of steps and of bytes", () => {
    const big = (i: number) => JSON.stringify({ i, nodes: Array.from({ length: 2000 }, (_, k) => ({ name: "node_" + k, type: "uniform" })) });
    const h = new UndoHistory(big(0), { steps: 5, bytes: Infinity });
    for (let i = 1; i <= 20; i++) h.record(big(i));
    expect(h.depth.undo).toBe(5);
    expect(h.bytes).toBeLessThan(big(0).length);
    let last = "";
    while (h.canUndo) last = h.undo()!;
    expect(last).toBe(big(15));

    const one = new UndoHistory(big(0), { steps: 100, bytes: 1 }).bytes;
    expect(one).toBe(0);
    const probe = new UndoHistory(big(0));
    probe.record(big(1));
    const step = probe.bytes;
    const capped = new UndoHistory(big(0), { steps: 100, bytes: step * 3.5 });
    for (let i = 1; i <= 20; i++) capped.record(big(i));
    expect(capped.bytes).toBeLessThanOrEqual(step * 3.5);
    expect(capped.depth.undo).toBe(3);
    expect(capped.undo()).toBe(big(19));
  });
});

/* nodes are told apart by their position (adding renames them) */
const add = (id: string) => editor.root.addToGraph([{ name: id, type: "uniform", node_position: { x: 1000 + id.charCodeAt(0), y: 0 } }], []);
function addNode(id: string) {
  add(id);
  editor.snapshot();
}
const names = () =>
  editor.root.children
    .filter((c) => c.position.x > 1000)
    .map((c) => String.fromCharCode(c.position.x - 1000))
    .sort();

describe("editor undo", () => {
  it("undoes and redoes changes of a project", () => {
    editor.setRoot(new GenGraph(), "first");
    const start = names();
    addNode("a");
    addNode("b");
    expect(names()).toEqual([...start, "a", "b"].sort());
    editor.undo();
    expect(names()).toEqual([...start, "a"].sort());
    editor.undo();
    expect(names()).toEqual(start);
    expect(editor.canUndo).toBe(false);
    editor.redo();
    editor.redo();
    expect(names()).toEqual([...start, "a", "b"].sort());
    expect(editor.canRedo).toBe(false);
  });

  it("keeps each tab's history when switching tabs", () => {
    editor.setRoot(new GenGraph(), "first");
    addNode("a");
    addNode("b");
    editor.undo();
    expect(editor.canRedo).toBe(true);
    const first = editor.currentIndex;

    editor.openProject(new GenGraph(), "second");
    const second = editor.currentIndex;
    expect(second).not.toBe(first);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    addNode("x");
    expect(editor.hasChanges(second)).toBe(true);
    // a change made just before switching (not yet recorded) is kept too
    add("y");

    editor.switchProject(first);
    expect(editor.title).toBe("first");
    expect(names()).toContain("a");
    expect(names()).not.toContain("b");
    editor.redo();
    expect(names()).toContain("b");
    editor.undo();
    editor.undo();
    expect(names()).not.toContain("a");

    editor.switchProject(second);
    expect(editor.title).toBe("second");
    expect(names()).toEqual(expect.arrayContaining(["x", "y"]));
    editor.undo();
    expect(names()).toContain("x");
    expect(names()).not.toContain("y");
    editor.undo();
    expect(names()).not.toContain("x");
    expect(editor.canUndo).toBe(false);
    editor.redo();
    expect(names()).toContain("x");

    editor.closeProject(second, () => new GenGraph());
    expect(editor.title).toBe("first");
    expect(editor.canRedo).toBe(true);
  });
});
