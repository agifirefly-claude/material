// The export dialog: every framework button produces a download with the expected files.
import { addFromLibrary, assert, download, ed, eq, idle, menu, open, zipNames } from "../helpers.mjs";

async function openDialog(page) {
  await menu(page, "File", "Export…");
  const dlg = page.locator(".modal", { has: page.locator("h2", { hasText: /^Export$/ }) });
  await dlg.waitFor();
  await dlg.locator("input[type=text]").first().fill("uitest");
  await dlg.locator("select").first().selectOption("8"); // 256×256 keeps it quick
  return dlg;
}

/** what a download should hold, by its file name */
function check(label, d) {
  const n = d.name;
  assert(n.startsWith("uitest"), `${label}: the file is named after the project: ${n}`);
  if (n.endsWith(".zip")) {
    const files = zipNames(d.bytes);
    assert(files.length > 0, `${label}: the zip has files`);
    return files;
  }
  if (n.endsWith(".glb")) {
    eq(d.bytes.subarray(0, 4).toString("latin1"), "glTF", `${label}: a binary glTF`);
    return [];
  }
  if (n.endsWith(".json")) {
    const j = JSON.parse(d.bytes.toString("utf8"));
    assert(j && typeof j === "object", `${label}: JSON`);
    return Object.keys(j);
  }
  assert(d.bytes.length > 0, `${label}: not empty`);
  return [];
}

export const tests = [
  {
    name: "export dialog: each framework button produces a download",
    timeout: 150_000,
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      // a light material: the engine exports only write the maps that are connected
      const uniform = await addFromLibrary(page, "uniform");
      await ed(page, (e, n) => e.graph.connectChildren(e.graph.getNode(n), 0, e.graph.getNode("Material"), 0), uniform);
      await idle(page);
      let dlg = await openDialog(page);
      const buttons = await dlg.locator("button").allInnerTexts();
      assert(buttons.length >= 8, "export buttons: " + buttons.join(", "));
      const seen = {};
      for (let i = 0; i < buttons.length; i++) {
        if (i) dlg = await openDialog(page);
        const label = buttons[i];
        const t0 = Date.now();
        const d = await download(page, () => dlg.locator("button").nth(i).click());
        const files = check(label, d);
        seen[label] = { name: d.name, files };
        if (process.env.UI_VERBOSE) console.log(`      ${label} → ${d.name} (${Date.now() - t0} ms)`);
        await dlg.waitFor({ state: "detached" });
      }
      const names = Object.values(seen).map((s) => s.name);
      // the frameworks each get their own file
      for (const [re, what] of [
        [/blender/i, "Blender"],
        [/unity/i, "Unity"],
        [/godot/i, "Godot"],
        [/unreal/i, "Unreal"],
        [/_cocos\.zip$/, "Cocos"],
        [/\.glb$/, "glTF"],
        [/\.m3e-material\.json$/, "m3e"],
      ])
        assert(names.some((n) => re.test(n)) || Object.keys(seen).some((l) => re.test(l)), `a ${what} export: ${names.join(", ")}`);
      // the texture set has PNG maps
      const maps = Object.entries(seen).find(([l]) => /All maps/.test(l));
      assert(maps && maps[1].files.some((f) => f.endsWith(".png")), "the texture set has PNG files");
      const cocos = Object.values(seen).find((s) => s.name.endsWith("_cocos.zip"));
      assert(cocos.files.some((f) => f.endsWith(".mtl")) && cocos.files.some((f) => f.endsWith(".meta")), "the Cocos zip has a .mtl and .meta files: " + cocos.files.join(", "));
    },
  },
  {
    name: "export dialog: an engine export of a material with nothing connected says so, and downloads nothing",
    timeout: 60_000,
    async run({ page, base }) {
      await open(page, base, { example: "blank" });
      const dlg = await openDialog(page);
      let downloads = 0;
      page.on("download", () => downloads++);
      await dlg.locator("button", { hasText: /^Blender$/ }).first().click();
      const toast = page.locator(".toast", { hasText: /Nothing to export for Blender/ });
      await toast.waitFor({ timeout: 30_000 });
      assert(/no input of .* is connected/.test(await toast.innerText()), "the message says why");
      await page.waitForTimeout(1500);
      eq(downloads, 0, "downloads");
    },
  },
];
