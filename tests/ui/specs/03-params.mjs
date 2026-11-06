// Parameter widgets in the inspector, node previews, and the inspector's tabs.
import { addFromLibrary, assert, eq, ed, idle, node, open, pixels, select, stablePixels, until } from "../helpers.mjs";

const param = (page, n, p) => ed(page, (e, [n, p]) => JSON.parse(JSON.stringify(e.graph.getNode(n).getParameter(p))), [n, p]);
/** the inspector row of a parameter, by its label */
const row = (page, label) => page.locator(".insp .row").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });

export const tests = [
  {
    name: "parameters: float drag and typed expression, enum, bool, size; the node preview changes",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const perlin = await addFromLibrary(page, "perlin");
      eq(await ed(page, (e, n) => e.graph.getNode(n).getTypeName(), perlin), "Value Noise", "a Value Noise");
      await select(page, perlin);
      // node previews of nodes with parameters show with "all previews"
      await page.getByLabel("all previews").check();
      await idle(page);
      const preview = node(page, perlin).locator(".preview");
      const before = await stablePixels(preview);
      // drag the float sideways
      const scale = row(page, "Scale X").locator(".float-edit");
      const b = await scale.boundingBox();
      await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
      const dragged = await param(page, perlin, "scale_x");
      assert(typeof dragged === "number" && dragged > 4, `dragging right raises Scale X: ${dragged}`);
      await idle(page);
      await until(async () => (await stablePixels(preview)) !== before, "the node preview changes");
      // click without moving: type a number, then an expression
      await scale.click();
      await row(page, "Scale X").locator("input").fill("7");
      await page.keyboard.press("Enter");
      await until(async () => (await param(page, perlin, "scale_x")) === 7, "typed 7");
      await row(page, "Scale X").locator(".float-edit").click();
      await row(page, "Scale X").locator("input").fill("2*3");
      await page.keyboard.press("Enter");
      await until(async () => (await param(page, perlin, "scale_x")) === "2*3", "an expression is kept as text");
      await until(async () => (await row(page, "Scale X").locator(".float-edit.expr").count()) === 1, "the field shows an expression");
      // enum
      const blend = await addFromLibrary(page, "blend");
      eq(await ed(page, (e, n) => e.graph.getNode(n).getTypeName(), blend), "Blend", "a Blend");
      await select(page, blend);
      await page.locator(".insp .row select").first().selectOption("0"); // the blend mode, the node's first parameter
      await until(async () => (await param(page, blend, "blend_type")) === 0, "the blend mode is the first one");
      // boolean
      const circ = await addFromLibrary(page, "circular gradient");
      await select(page, circ);
      await row(page, "Mirror").locator("input[type=checkbox]").check();
      await until(async () => (await param(page, circ, "mirror")) === true, "mirror on");
      // size
      const noise = await addFromLibrary(page, "color noise");
      await select(page, noise);
      await row(page, "Grid Size").locator("select").selectOption("6");
      await until(async () => (await param(page, noise, "size")) === 6, "grid size 64");
      await idle(page);
    },
  },
  {
    name: "parameters: colour popover, gradient stops, curve points",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      // colour
      const uniform = await addFromLibrary(page, "uniform");
      await select(page, uniform);
      await page.locator(".insp .color-swatch").first().click();
      const pop = page.locator(".popover");
      await pop.waitFor();
      await pop.locator("input[type=text]").fill("#ff8000");
      await until(async () => {
        const c = await param(page, uniform, "color");
        return c.r === 1 && Math.abs(c.g - 128 / 255) < 1e-3 && c.b === 0;
      }, "the colour is #ff8000");
      await page.mouse.click(5, 300); // outside closes it
      await until(async () => (await pop.count()) === 0, "the popover closes");
      // gradient: double click adds a stop, dragging a stop moves it
      const colorize = await addFromLibrary(page, "colorize");
      await select(page, colorize);
      const bar = page.locator(".insp .grad-bar");
      const bb = await bar.boundingBox();
      await page.mouse.dblclick(bb.x + bb.width * 0.5, bb.y + bb.height / 2);
      await until(async () => (await param(page, colorize, "gradient")).points?.length === 3, "a third stop");
      const stop = page.locator(".insp .grad-stop").nth(2);
      const sb = await stop.boundingBox();
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(bb.x + bb.width * 0.25, sb.y + sb.height / 2, { steps: 6 });
      await page.mouse.up();
      await until(async () => {
        const pts = (await param(page, colorize, "gradient")).points;
        return pts.some((p) => Math.abs((p.pos ?? p.v) - 0.25) < 0.03);
      }, "the new stop moved to a quarter");
      // curve: double click away from the line adds a point
      const tonality = await addFromLibrary(page, "tonality");
      await select(page, tonality);
      const curve = page.locator(".insp .curve-canvas");
      const cb = await curve.boundingBox();
      await page.mouse.dblclick(cb.x + cb.width * 0.3, cb.y + cb.height * 0.3);
      await until(async () => (await param(page, tonality, "curve")).points?.length === 3, "a third curve point");
      await idle(page);
    },
  },
  {
    name: "inspector: parameters, ports & info with an upstream link that navigates, code analysis shows GLSL",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const perlin = await addFromLibrary(page, "perlin");
      const colorize = await addFromLibrary(page, "colorize");
      await ed(page, (e, [a, b]) => (e.graph.connectChildren(e.graph.getNode(a), 0, e.graph.getNode(b), 0), e.graph.connectChildren(e.graph.getNode(b), 0, e.graph.getNode("Material"), 0)), [perlin, colorize]);
      await idle(page);
      await select(page, colorize);
      const tabs = page.locator(".dock-content .tabs button");
      await tabs.filter({ hasText: "Ports & info" }).click();
      await page.getByText("Upstream (what this node is computed from)").waitFor();
      await page.locator(".insp a", { hasText: "Value Noise" }).click();
      await until(() => ed(page, (e, n) => e.selection.length === 1 && e.selection[0] === n, perlin), "the upstream link selects the Value Noise");
      await select(page, colorize);
      await tabs.filter({ hasText: "Code analysis" }).click();
      await until(async () => /\bvec[234]\b/.test((await page.locator(".dock-content pre.code").last().innerText()) ?? ""), "GLSL in the code tab");
      assert(!(await page.locator(".dock-content .insp").innerText()).includes("[object Object]"), "parameter values are readable");
      await tabs.filter({ hasText: "Parameters" }).click();
      await page.locator(".insp .grad-bar").waitFor();
    },
  },
  {
    name: "zh: the inspector tabs are in Chinese",
    async run({ page, base }) {
      await open(page, base, { lang: "zh" });
      const any = await ed(page, (e) => e.graph.children.find((c) => c.getType() !== "material_export" && c.getInputDefs().length)?.name);
      await select(page, any);
      const tabs = page.locator(".dock-content .tabs button");
      await tabs.filter({ hasText: "端口与信息" }).click();
      await page.locator(".insp table").first().waitFor();
      await tabs.filter({ hasText: "代码分析" }).click();
      await page.locator(".dock-content pre.code").first().waitFor();
    },
  },
];
