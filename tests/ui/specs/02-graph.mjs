// Graph editing: links, deletion, clipboard, duplication, subgraphs, undo and redo.
import { addFromLibrary, assert, connect, ed, eq, fit, idle, node, open, select, until } from "../helpers.mjs";

const links = (page) => ed(page, (e) => e.graph.connections.map((c) => `${c.from}:${c.from_port}>${c.to}:${c.to_port}`).sort());
const names = (page) => ed(page, (e) => e.graph.children.map((c) => c.name).sort());
const undo = (page) => page.keyboard.press("Control+z");
const redo = (page) => page.keyboard.press("Control+Shift+z");
/** the editor records an undo step once changes pause for 350 ms; a person's next action comes later than that */
const pause = (page) => page.waitForTimeout(450);
/** clicks a point of a link that is not covered by a node */
async function clickEdge(page, id, button = "left") {
  const p = await page.evaluate((id) => {
    const edge = document.querySelector(`.react-flow__edge[data-id="${id}"]`);
    const path = edge?.querySelector(".react-flow__edge-path");
    if (!path) return null;
    const m = path.getScreenCTM();
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const q = path.getPointAtLength(path.getTotalLength() * f);
      const x = m.a * q.x + m.c * q.y + m.e,
        y = m.b * q.x + m.d * q.y + m.f;
      if (edge.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  }, id);
  assert(p, `the link ${id} is drawn and can be clicked`);
  await page.mouse.click(p.x, p.y, { button });
}

/** a new project with nodes from the library laid out in a row */
async function setup(page, base, queries) {
  await open(page, base, { example: "blank" });
  const out = [];
  for (const q of queries) out.push(await addFromLibrary(page, q));
  await ed(
    page,
    (e, ns) => {
      ns.forEach((n, i) => (e.graph.getNode(n).position = { x: -900 + i * 300, y: 0 }));
      e.graph.getNode("Material").position = { x: 0, y: 0 };
      e.graph.notifyChanged();
    },
    out,
  );
  await fit(page);
  await idle(page);
  return out;
}

export const tests = [
  {
    name: "links: drag to connect, incompatible types refused, delete a link, undo and redo",
    async run({ page, base }) {
      const [perlin, colorize, circle] = await setup(page, base, ["perlin", "colorize", "sdcircle"]);
      await connect(page, perlin, 0, colorize, 0);
      await until(async () => (await links(page)).includes(`${perlin}:0>${colorize}:0`), "perlin → colorize");
      await connect(page, colorize, 0, "Material", 0);
      await until(async () => (await links(page)).length === 2, "colorize → material albedo");
      // an SDF output into a colour input is refused
      await connect(page, circle, 0, colorize, 0);
      await page.waitForTimeout(300);
      eq(await links(page), [`${colorize}:0>Material:0`, `${perlin}:0>${colorize}:0`].sort(), "the SDF link is refused");
      // select a link and delete it
      await pause(page);
      await clickEdge(page, `${perlin}:0>${colorize}:0`);
      await page.keyboard.press("Delete");
      await until(async () => !(await links(page)).includes(`${perlin}:0>${colorize}:0`), "link deleted");
      await undo(page);
      await until(async () => (await links(page)).includes(`${perlin}:0>${colorize}:0`), "undo brings the link back");
      await redo(page);
      await until(async () => !(await links(page)).includes(`${perlin}:0>${colorize}:0`), "redo deletes it again");
      // the link's context menu disconnects too
      await undo(page);
      await until(async () => (await links(page)).length === 2, "link back");
      await clickEdge(page, `${colorize}:0>Material:0`, "right");
      await page.locator(".menu-list button", { hasText: "Disconnect" }).click();
      await until(async () => (await links(page)).length === 1, "disconnected from the menu");
    },
  },
  {
    name: "nodes: delete, copy and paste, duplicate, each undone and redone",
    async run({ page, base }) {
      const [perlin] = await setup(page, base, ["perlin", "colorize"]);
      const start = await names(page);
      await select(page, perlin);
      await page.keyboard.press("Delete");
      await until(async () => !(await names(page)).includes(perlin), "perlin deleted");
      await pause(page);
      await undo(page);
      await until(async () => (await names(page)).includes(perlin), "undo restores perlin");
      await redo(page);
      await until(async () => !(await names(page)).includes(perlin), "redo deletes it");
      await undo(page);
      await until(async () => JSON.stringify(await names(page)) === JSON.stringify(start), "back to the start");
      // the material node cannot be deleted
      await select(page, "Material");
      await page.keyboard.press("Delete");
      await page.waitForTimeout(300);
      assert((await names(page)).includes("Material"), "the material node stays");
      // copy and paste
      await select(page, perlin);
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      await until(async () => (await names(page)).length === start.length + 1, "pasted");
      await pause(page);
      const pasted = (await names(page)).find((n) => !start.includes(n));
      eq(await ed(page, (e, n) => e.graph.getNode(n).getTypeName(), pasted), "Value Noise", "the paste is a Value Noise");
      eq(await ed(page, (e) => e.selection), [pasted], "the paste is selected");
      // duplicate
      await page.keyboard.press("Control+d");
      await until(async () => (await names(page)).length === start.length + 2, "duplicated");
      await pause(page);
      await undo(page);
      await until(async () => (await names(page)).length === start.length + 1, "undo the duplicate");
      await undo(page);
      await until(async () => (await names(page)).length === start.length, "undo the paste");
      await redo(page);
      await until(async () => (await names(page)).length === start.length + 1, "redo the paste");
    },
  },
  {
    name: "subgraphs: group, enter by double click, leave by breadcrumb, hierarchy, undo",
    async run({ page, base }) {
      const [perlin, colorize] = await setup(page, base, ["perlin", "colorize"]);
      await connect(page, perlin, 0, colorize, 0);
      await connect(page, colorize, 0, "Material", 0);
      await until(async () => (await links(page)).length === 2, "two links");
      await pause(page);
      await select(page, perlin);
      await node(page, colorize).locator(".head").first().click({ modifiers: ["Shift"] });
      await until(() => ed(page, (e) => e.selection.length === 2), "two selected");
      await pause(page);
      await page.keyboard.press("Control+g");
      const graph = await until(() => ed(page, (e) => e.graph.children.find((c) => c.getType() === "graph")?.name), "a subgraph");
      eq(await ed(page, (e) => e.graph.children.length), 2, "material and the subgraph");
      // the material still gets its albedo, through the subgraph
      eq(await links(page), [`${graph}:0>Material:0`], "the subgraph feeds the material");
      // enter by double click
      await node(page, graph).locator(".head").first().dblclick();
      await until(() => ed(page, (e, g) => e.path.join("/") === g, graph), "inside the subgraph");
      eq((await names(page)).filter((n) => !n.startsWith("gen_")).sort(), [colorize, perlin].sort(), "the grouped nodes are inside");
      await until(async () => (await page.locator(".crumbs > span > button").count()) === 2, "two breadcrumbs");
      // leave by the breadcrumb
      await page.locator(".crumbs > span > button").first().click();
      await until(() => ed(page, (e) => e.path.length === 0), "back at the top");
      // enter by the hierarchy
      await page.locator(".tree-row", { hasText: graph }).first().click();
      await until(() => ed(page, (e) => e.path.length === 1), "entered from the hierarchy");
      await page.keyboard.press("Escape");
      await until(() => ed(page, (e) => e.path.length === 0), "Esc goes up");
      await pause(page);
      // undo the grouping
      await undo(page);
      await until(async () => (await names(page)).includes(perlin) && (await names(page)).includes(colorize), "grouping undone");
      eq((await links(page)).length, 2, "the links are back");
    },
  },
];
