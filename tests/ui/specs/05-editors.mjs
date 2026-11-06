// The node editor (Ctrl+E), the Easy SDF scene editor, and paint mode.
import { addFromLibrary, assert, eq, ed, idle, menu, node, open, select, stablePixels, until } from "../helpers.mjs";

export const tests = [
  {
    name: "node editor: Ctrl+E opens it, a change is applied to the node, undo reverts it",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const perlin = await addFromLibrary(page, "perlin");
      await select(page, perlin);
      await page.waitForTimeout(450);
      await page.keyboard.press("Control+e");
      const dlg = page.locator(".modal.ne");
      await dlg.waitFor();
      // general tab: the name
      const name = dlg.locator(".ne-body input[type=text]").first();
      eq(await name.inputValue(), "Value Noise", "the node's name in the editor");
      await name.fill("Wobbly Noise");
      // the main code tab shows the code
      await dlg.locator(".tabs button", { hasText: "Main Code" }).click();
      await dlg.locator("textarea.code-edit-input").waitFor();
      await dlg.locator(".ne-buttons button.primary").click();
      await until(async () => (await dlg.count()) === 0, "the editor closes");
      await until(() => ed(page, (e, n) => e.graph.getNode(n).getTypeName() === "Wobbly Noise", perlin), "the new name is applied");
      await until(async () => (await node(page, perlin).locator(".head").innerText()).includes("Wobbly Noise"), "the node shows the new name");
      eq(await ed(page, (e, n) => e.graph.getNode(n).isTemplate(), perlin), false, "the node is its own now");
      await page.waitForTimeout(450);
      await page.keyboard.press("Control+z");
      await until(() => ed(page, (e, n) => e.graph.getNode(n)?.getTypeName() === "Value Noise", perlin), "undo reverts the edit");
    },
  },
  {
    name: "Easy SDF: items are added to the scene from the inspector and the preview changes",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const sdf = await addFromLibrary(page, "easy sdf");
      eq(await ed(page, (e, n) => e.graph.getNode(n).getType(), sdf), "sdf", "an Easy SDF node");
      await select(page, sdf);
      await page.getByLabel("all previews").check();
      await idle(page);
      const preview = node(page, sdf).locator(".preview");
      const before = await stablePixels(preview);
      const editor = page.locator(".sdf-editor");
      const add = async () => {
        await editor.locator(".sdf-row").first().click(); // the scene: add at the top level
        const pick = editor.locator("select").first();
        const value = await pick.evaluate((s) => [...s.options].find((o) => o.value && /circle|sphere|box/i.test(o.value))?.value ?? [...s.options].find((o) => o.value)?.value);
        assert(value, "an item type to add");
        await pick.selectOption(value);
        await editor.locator("button.primary", { hasText: "Add" }).click();
      };
      await add();
      await until(() => ed(page, (e, n) => e.graph.getNode(n).scene.length === 1, sdf), "one item");
      await add();
      await until(() => ed(page, (e, n) => e.graph.getNode(n).scene.length === 2, sdf), "two items");
      eq(await editor.locator(".sdf-row").count(), 3, "the scene and its two items are listed");
      await idle(page);
      await until(async () => (await stablePixels(preview)) !== before, "the node preview shows the shapes");
    },
  },
  {
    name: "paint: a new paint project, a stroke, a new layer, and back to the material tab",
    async run({ page, base }) {
      await open(page, base);
      await menu(page, "File", "New paint project…");
      const dlg = page.locator(".modal", { hasText: "New paint project" });
      await dlg.waitFor();
      await dlg.locator("select").nth(1).selectOption("8");
      await dlg.locator("button.primary", { hasText: "Create" }).click();
      const view = page.locator(".paint-view");
      await view.waitFor({ timeout: 45_000 });
      await until(async () => (await page.locator(".project-tab").count()) === 2, "a paint tab");
      assert((await page.locator(".project-tab.on span").innerText()).includes("🖌"), "the paint tab is current");
      const canvas = view.locator("canvas:not(.paint-overlay)").first();
      await page.waitForTimeout(500);
      await page.mouse.move(5, 300);
      const before = await stablePixels(canvas);
      // a stroke across the middle of the model
      const b = await view.boundingBox();
      const cx = b.x + b.width / 2,
        cy = b.y + b.height / 2;
      await page.mouse.move(cx - 60, cy - 20);
      await page.mouse.down();
      await page.mouse.move(cx + 60, cy + 20, { steps: 20 });
      await page.mouse.up();
      await page.mouse.move(5, 300);
      await until(async () => (await stablePixels(canvas)) !== before, "the stroke shows on the model");
      // a new layer
      await page.locator(".panel.right .tabs button", { hasText: "Layers" }).click();
      const layers = page.locator(".layer-row");
      const n = await layers.count();
      await page.locator(".panel.right button", { hasText: "+ Paint" }).click();
      await until(async () => (await layers.count()) === n + 1, "a new paint layer");
      // back to the material
      await page.locator(".project-tab", { hasText: "bricks" }).click();
      await until(async () => (await view.count()) === 0, "the paint view is gone");
      await until(() => ed(page, (e) => e.title === "bricks" && e.graph.children.length === 17), "the bricks graph is back");
      await page.locator(".dock-main .react-flow__node").first().waitFor();
    },
  },
];
