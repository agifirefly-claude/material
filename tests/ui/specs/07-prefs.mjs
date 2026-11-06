// Preferences (language), docking a panel by dragging its tab, and restoring the autosave after a reload.
import { addFromLibrary, assert, ed, eq, open, until } from "../helpers.mjs";

const prefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("material-pro:prefs") ?? "{}"));
/** the panels of each tab group of the dock */
function groups(dock) {
  const out = [];
  const walk = (n) => (n.type === "tabs" ? out.push(n.panels) : n.type === "split" ? n.children.forEach(walk) : null);
  if (dock) walk(dock.root);
  return out;
}

export const tests = [
  {
    name: "preferences: switching the language changes the UI and is remembered",
    async run({ page, base }) {
      await open(page, base);
      await page.locator(".topbar button[title=Preferences]").click();
      const dlg = page.locator(".modal", { has: page.locator("h2", { hasText: "Preferences" }) });
      await dlg.waitFor();
      await dlg.locator(".pref-row", { hasText: "Language" }).locator("select").selectOption("zh");
      await page.locator(".topbar .menu > button", { hasText: "文件" }).waitFor();
      await until(async () => /[\u4e00-\u9fff]/.test(await page.locator(".modal h2").first().innerText()), "the dialog title is in Chinese");
      eq(await page.evaluate(() => localStorage.getItem("material-pro:lang")), "zh", "the language is remembered");
      await page.locator(".dock-tabbar button", { hasText: "检查器" }).waitFor();
      // back to English
      await page.locator(".modal .pref-row select").first().selectOption("en");
      await page.locator(".topbar .menu > button", { hasText: "File" }).waitFor();
    },
  },
  {
    name: "dock: dragging the Inspector tab into the library group docks it there and is remembered",
    async run({ page, base }) {
      await open(page, base);
      const tab = page.locator(".dock-tabbar button", { hasText: "Inspector" });
      const lib = page.locator(".dock-drop", { has: page.locator(".dock-tabbar button", { hasText: "Library" }) }).last();
      await tab.dragTo(lib);
      await until(async () => groups((await prefs(page)).layout?.dock).some((g) => g.includes("library") && g.includes("inspector")), "the inspector joins the library's tabs");
      // the tab bar shows it next to the library
      const bar = page.locator(".dock-tabbar", { has: page.locator("button", { hasText: "Library" }) });
      await until(async () => (await bar.locator("button", { hasText: "Inspector" }).count()) === 1, "the Inspector tab is beside the Library tab");
      // the layout survives a reload
      await page.evaluate(() => sessionStorage.setItem("ui-test-keep", "1"));
      await page.reload();
      await page.waitForFunction(() => window.mmEditor?.renderer && document.querySelector(".react-flow__node"), null, { timeout: 30_000 });
      await until(async () => (await page.locator(".dock-tabbar", { has: page.locator("button", { hasText: "Library" }) }).locator("button", { hasText: "Inspector" }).count()) === 1, "still docked after a reload");
    },
  },
  {
    name: "autosave: the project comes back after a reload",
    async run({ page, base }) {
      await open(page, base);
      const added = await addFromLibrary(page, "perlin");
      await until(async () => {
        const s = await page.evaluate(() => localStorage.getItem("material-pro:autosave"));
        return s && JSON.parse(JSON.parse(s).text).nodes.some((n) => n.name === added);
      }, "the autosave has the new node", 10_000);
      await page.evaluate(() => sessionStorage.setItem("ui-test-keep", "1"));
      await page.goto(`${base}/?lang=en`);
      await page.waitForFunction(() => window.mmEditor?.renderer && document.querySelector(".react-flow__node"), null, { timeout: 30_000 });
      eq(await ed(page, (e) => e.title), "bricks", "the title is restored");
      assert(await ed(page, (e, n) => !!e.graph.getNode(n), added), "the added node is restored");
      eq(await ed(page, (e) => e.graph.children.length), 18, "17 bricks nodes and the added one");
    },
  },
];
