// Opening examples, project tabs, and adding nodes from the library and the add-node popup.
import { addFromLibrary, assert, drag, ed, eq, fit, handle, idle, menu, newMaterial, node, open, panePoint, until } from "../helpers.mjs";

const count = (page) => ed(page, (e) => e.graph.children.length);

export const tests = [
  {
    name: "examples open from the dialog into tabs, which switch and close",
    async run({ page, base }) {
      await open(page, base, { example: "bricks" });
      eq(await count(page), 17, "bricks has 17 nodes");
      await page.locator(".react-flow__node").first().waitFor();
      eq(await page.locator(".react-flow__node").count(), 17, "17 nodes drawn");
      // the toolbar button opens the dialog; an example opens in a new tab
      await page.locator(".topbar > button", { hasText: "Examples" }).click();
      await page.locator(".modal .examples button", { hasText: "marble" }).click();
      await until(() => ed(page, (e) => e.title === "marble"), "marble open");
      await until(async () => (await page.locator(".project-tab").count()) === 2, "two tabs");
      eq(await page.locator(".project-tab.on span").first().innerText(), "marble", "marble is the current tab");
      // through the File menu too
      await menu(page, "File", "Examples…");
      await page.locator(".modal .examples button", { hasText: "wood" }).first().click();
      await until(async () => (await page.locator(".project-tab").count()) === 3, "three tabs");
      // switch back to bricks: its graph comes back
      await page.locator(".project-tab", { hasText: "bricks" }).click();
      await until(() => ed(page, (e) => e.title === "bricks"), "bricks current");
      eq(await count(page), 17, "bricks graph restored");
      // close the wood tab with its ×
      await page.locator(".project-tab", { hasText: "wood" }).locator("button").click();
      await until(async () => (await page.locator(".project-tab").count()) === 2, "wood closed");
      eq(await ed(page, (e) => e.projects.map((p) => p.title)), ["bricks", "marble"], "remaining tabs");
    },
  },
  {
    name: "library: search and click adds a node; dragging a result adds it where it is dropped",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const name = await addFromLibrary(page, "perlin");
      eq(await ed(page, (e, n) => e.graph.getNode(n).getTypeName(), name), "Value Noise", "the perlin node is a Value Noise");
      await node(page, name).waitFor();
      // drag a search result onto the graph
      await page.locator(".lib-search input").fill("voronoi");
      await page.locator(".tree .tree-row").first().dragTo(page.locator(".react-flow__pane"), { targetPosition: { x: 200, y: 160 } });
      await until(async () => (await count(page)) === 3, "the dropped node");
      const dropped = await ed(page, (e) => e.graph.children[2]);
      assert(dropped !== null, "dropped node exists");
      // the folder tree works too: open a folder and click an item
      await page.locator(".lib-search input").fill("");
      await page.locator(".tree > div > .tree-row", { hasText: "Simple" }).first().click();
      const items = page.locator(".tree .tree-children .tree-row");
      await until(async () => (await items.count()) > 3, "Simple opens");
      await items.filter({ hasText: "Shape" }).first().click(); // a folder with an item: opens
      await items.filter({ hasText: "Square" }).first().click();
      await until(async () => (await count(page)) === 4, "a node from the tree");
    },
  },
  {
    name: "add-node popup: right click, double click, and a link dropped on empty space connects the new node",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      // right click the empty graph
      const p1 = await panePoint(page, 0.15, 0.2);
      await page.mouse.click(p1.x, p1.y, { button: "right" });
      const box = page.locator(".add-popup input[type=search]");
      await box.waitFor();
      await box.fill("bricks");
      await box.press("Enter");
      await until(async () => (await count(page)) === 2, "a node from the right click popup");
      const bricks = await ed(page, (e) => e.graph.children[1].name);
      // double click
      const p2 = await panePoint(page, 0.15, 0.8);
      await page.mouse.dblclick(p2.x, p2.y);
      await box.waitFor();
      await box.fill("uniform");
      await page.locator(".add-popup .add-row button").first().dispatchEvent("mousedown");
      await until(async () => (await count(page)) === 3, "a node from the double click popup");
      // drag a link from the bricks output to empty space: the popup lists nodes that take it, and connects the pick
      await fit(page);
      const out = handle(page, bricks, "o0");
      const b = await out.boundingBox();
      await drag(page, out, { x: b.x + 260, y: b.y + 140 });
      await box.waitFor();
      assert((await box.getAttribute("placeholder")).includes("connects"), "the popup says it connects");
      await box.fill("colorize");
      await box.press("Enter");
      await until(async () => (await count(page)) === 4, "the connected node");
      const linked = await ed(page, (e, from) => e.graph.connections.filter((c) => c.from === from).map((c) => e.graph.getNode(c.to).getTypeName()), bricks);
      assert(linked.includes("Colorize"), "bricks is connected to the new Colorize node: " + linked.join(","));
      await idle(page);
    },
  },
  {
    name: "zh: the menus and the library are in Chinese and work",
    async run({ page, base }) {
      await open(page, base, { lang: "zh" });
      await page.locator(".topbar .menu > button", { hasText: "文件" }).waitFor();
      await newMaterial(page, "zh");
      assert((await page.locator(".lib-search input").getAttribute("placeholder")).includes("搜索"), "Chinese search placeholder");
      await addFromLibrary(page, "perlin");
      eq(await count(page), 2, "a node added in the Chinese UI");
      await page.locator(".topbar > button", { hasText: "示例" }).click();
      await page.locator(".modal .examples button", { hasText: "marble" }).click();
      await until(() => ed(page, (e) => e.title === "marble"), "an example opened from the Chinese dialog");
    },
  },
];
