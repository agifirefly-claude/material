// The 2D preview (gizmos, image export) and the 3D preview (object, environment, material).
import { addFromLibrary, assert, connect, download, ed, fit, idle, isPng, open, select, stablePixels, until } from "../helpers.mjs";

const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);

export const tests = [
  {
    name: "2D preview: dragging a gizmo changes the parameter; Export ▾ Image downloads a PNG",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const circle = await addFromLibrary(page, "sdcircle");
      eq2(await ed(page, (e, n) => e.graph.getNode(n).getTypeName(), circle), "sdCircle");
      await select(page, circle);
      await page.locator(".dock-tabbar button", { hasText: "2D node output" }).click();
      const h = page.locator('.pv2-handle[data-control="P1"]');
      await h.waitFor();
      const cx0 = await ed(page, (e, n) => e.graph.getNode(n).getParameter("cx"), circle);
      const b = await h.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 10, { steps: 8 });
      await page.mouse.up();
      await until(async () => (await ed(page, (e, n) => e.graph.getNode(n).getParameter("cx"), circle)) > cx0 + 0.02, "dragging P1 right raises cx");
      await idle(page);
      // export the image
      await page.locator(".menu > button", { hasText: "Export ▾" }).click();
      await page.locator(".pv2-menu select").nth(1).selectOption("256");
      const d = await download(page, () => page.locator(".pv2-menu button", { hasText: /^Image$/ }).click());
      assert(d.name.endsWith(".png"), "a .png file: " + d.name);
      assert(isPng(d.bytes) && d.bytes.length > 200, "PNG data");
    },
  },
  {
    name: "3D preview: object and environment change the picture, and so does a material change",
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      await page.locator(".dock-tabbar button", { hasText: "3D material" }).click();
      const canvas = page.locator(".preview-pane .body canvas").first();
      await canvas.waitFor();
      await idle(page);
      const p0 = await stablePixels(canvas);
      // the object
      const tools = page.locator(".preview-pane .tools").first();
      await tools.locator(".menu > button").nth(0).click();
      await page.locator(".p3d-panel select").first().selectOption("cube");
      await until(async () => (await stored(page, "material-pro:preview3d"))?.object === "cube", "cube chosen");
      await page.mouse.click(5, 300);
      const p1 = await until(async () => {
        const p = await stablePixels(canvas);
        return p !== p0 && p;
      }, "the cube is drawn");
      // the environment
      await tools.locator(".menu > button").nth(1).click();
      await page.locator(".p3d-panel .env-cell").nth(1).click();
      await until(async () => (await stored(page, "material-pro:preview3d"))?.environment === 1, "the second environment");
      await page.mouse.click(5, 300);
      const p2 = await until(async () => {
        const p = await stablePixels(canvas);
        return p !== p1 && p;
      }, "the environment changes the picture");
      // a material change: a uniform colour into the albedo
      const uniform = await addFromLibrary(page, "uniform");
      await ed(page, (e, n) => {
        const c = e.graph.getNode(n);
        c.setParameter("color", { r: 1, g: 0, b: 0, a: 1 });
      }, uniform);
      await fit(page);
      await connect(page, uniform, 0, "Material", 0);
      await until(() => ed(page, (e) => e.graph.connections.length === 1), "uniform → albedo");
      await idle(page);
      await until(async () => (await stablePixels(canvas)) !== p2, "the material change shows in 3D");
    },
  },
  {
    name: "3D preview: draws nothing while nothing changes, and draws when the camera moves or the model turns",
    async run({ page, base }) {
      await open(page, base, { example: "bricks" });
      // no FPS limit: the view must idle by itself
      await page.evaluate(() => import("/src/ui/prefs.ts").then((m) => m.setPrefs({ fpsLimit: 0 })));
      await page.locator(".dock-tabbar button", { hasText: "3D material" }).click();
      const canvas = page.locator(".preview-pane .body canvas").first();
      await canvas.waitFor();
      await idle(page);
      const frames = () => canvas.evaluate((c) => +(c.dataset.frames ?? 0));
      await until(async () => (await frames()) > 0, "the first frame");
      await page.waitForTimeout(1000);
      const f0 = await frames();
      await page.waitForTimeout(2000);
      const idleFrames = (await frames()) - f0;
      assert(idleFrames <= 1, `frames drawn in 2 s while nothing changes: ${idleFrames}`);
      // a drag turns the camera
      const box = await canvas.boundingBox();
      const f1 = await frames();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await until(async () => (await frames()) > f1 + 2, "frames while the camera moves");
      // the camera settles (damping), then the view idles again
      await page.waitForTimeout(2500);
      const f2 = await frames();
      await page.waitForTimeout(1000);
      assert((await frames()) - f2 <= 1, "idle again after the drag");
      // rotation on: frames keep coming
      await page.evaluate(() => import("/src/ui/preview3d/settings.ts").then((m) => m.updateSettings({ rotationSpeed: 2 })));
      const f3 = await frames();
      await page.waitForTimeout(2000);
      const turning = (await frames()) - f3;
      // software WebGL on a busy machine draws a few frames a second
      assert(turning >= 4, `frames in 2 s while the model turns: ${turning}`);
      await page.evaluate(() => import("/src/ui/preview3d/settings.ts").then((m) => m.updateSettings({ rotationSpeed: 0 })));
    },
  },
];

function eq2(a, b) {
  assert(a === b, `expected ${b}, got ${a}`);
}
