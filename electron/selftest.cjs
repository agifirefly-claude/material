/* A smoke test of the packaged app, run by main.cjs when MATERIAL_PRO_SELFTEST names a result file
 * (npm run electron:smoke). It checks the bridge, WebGL2 with float render targets, opens an example, looks at the
 * rendered window, saves through the File menu (MATERIAL_PRO_TEST_SAVE_DIR answers the dialog) and opens the saved
 * file again the way Finder would; then the same for a paint project, which must save back to the zip it was opened from. The result is written as JSON and the app quits. */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(win, expr, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await win.webContents.executeJavaScript(expr).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}

/** `hooks.open(paths)` opens files through the main process, as Finder does */
exports.run = async function run(win, out, hooks = {}) {
  const r = { ok: false, checks: {} };
  const check = (name, v) => (r.checks[name] = v);
  try {
    const js = (s) => win.webContents.executeJavaScript(s);
    check("bridge", await js("typeof window.materialPro === 'object' && typeof window.materialPro.save === 'function'"));
    check("nodeIntegration off", await js("typeof require === 'undefined' && typeof process === 'undefined'"));
    check(
      "webgl2",
      await js(`(() => { const gl = document.createElement('canvas').getContext('webgl2');
        return !!gl && !!gl.getExtension('EXT_color_buffer_float') && gl.getParameter(gl.VERSION); })()`),
    );
    check("editor ready", await waitFor(win, "!!(globalThis.mmEditor && globalThis.mmEditor.renderer)"));
    const example = await js(`fetch('data/examples/index.json').then((r) => r.json()).then((l) => {
        const n = (Array.isArray(l) ? l : Object.keys(l)).map((x) => (typeof x === 'string' ? x : x.name))[0];
        return fetch('data/examples/' + n + '.json').then((r) => r.json()).then((d) => (globalThis.mmEditor.open(d, n), n));
      })`);
    check("example", example);
    check("example nodes", await js("globalThis.mmEditor.root.children.length"));
    await sleep(4000);
    // the previews drew something: many distinct colours in the window
    const img = await win.webContents.capturePage();
    const bmp = img.toBitmap();
    const colours = new Set();
    for (let i = 0; i < bmp.length; i += 4 * 7) colours.add((bmp[i] << 16) | (bmp[i + 1] << 8) | bmp[i + 2]);
    check("distinct colours", colours.size);
    fs.writeFileSync(out.replace(/\.json$/, "") + ".png", img.toPNG());
    // File > Save goes through the page and the preload to the main process
    const dir = process.env.MATERIAL_PRO_TEST_SAVE_DIR;
    const saved = dir && path.join(dir, `${example}.ptex`);
    if (saved && fs.existsSync(saved)) fs.unlinkSync(saved);
    win.webContents.send("mp:menu", { action: "save" });
    const end = Date.now() + 10000;
    while (saved && !fs.existsSync(saved) && Date.now() < end) await sleep(100);
    const text = saved && fs.existsSync(saved) ? fs.readFileSync(saved, "utf8") : "";
    check("saved", !!text && Array.isArray(JSON.parse(text).nodes) && saved);
    check("status", await js("globalThis.mmEditor.status"));
    // opening it again, as from Finder, makes a new tab
    const tabs = await js("globalThis.mmEditor.projects.length");
    if (text) {
      win.webContents.send("mp:open-files", [{ name: path.basename(saved), path: saved, data: new Uint8Array(fs.readFileSync(saved)) }]);
      check("reopened", await waitFor(win, `globalThis.mmEditor.projects.length > ${tabs}`, 5000));
    }
    // a second save writes in place, without a dialog
    if (text) {
      fs.unlinkSync(saved);
      win.webContents.send("mp:menu", { action: "save" });
      const end2 = Date.now() + 10000;
      while (!fs.existsSync(saved) && Date.now() < end2) await sleep(100);
      check("saved in place", fs.existsSync(saved));
    }
    // a paint project: File > Save writes a zip; opened again from another folder, Save writes back to that file
    if (dir) {
      win.webContents.send("mp:menu", { action: "newPaint" });
      await waitFor(win, "!!document.querySelector('.modal button.primary')", 10000);
      await js(`(() => { const d = document.querySelector('.modal'); const s = d.querySelectorAll('select');
        if (s[1]) { s[1].value = '8'; s[1].dispatchEvent(new Event('change', { bubbles: true })); }
        d.querySelector('button.primary').click(); })()`);
      check("paint project", await waitFor(win, "!!document.querySelector('.paint-view')", 60000));
      const zips = () => fs.readdirSync(dir).filter((f) => f.endsWith(".zip"));
      for (const f of zips()) fs.unlinkSync(path.join(dir, f));
      win.webContents.send("mp:menu", { action: "save" });
      const end3 = Date.now() + 20000;
      while (!zips().length && Date.now() < end3) await sleep(200);
      const zip = zips()[0];
      check("paint saved", zip ?? false);
      if (zip) {
        const sub = path.join(dir, "reopened");
        fs.mkdirSync(sub, { recursive: true });
        const moved = path.join(sub, zip);
        fs.renameSync(path.join(dir, zip), moved);
        const tabs2 = await js("globalThis.mmEditor.projects.length");
        // through the main process, as from Finder: only files the user chose can be written in place
        hooks.open([moved]);
        check("paint reopened", await waitFor(win, `globalThis.mmEditor.projects.length > ${tabs2}`, 30000));
        const before = fs.statSync(moved).mtimeMs;
        await sleep(50);
        win.webContents.send("mp:menu", { action: "save" });
        const end4 = Date.now() + 20000;
        while (fs.statSync(moved).mtimeMs === before && Date.now() < end4) await sleep(200);
        // written back to the file it was opened from, not into the default save folder
        check("paint saved in place", fs.statSync(moved).mtimeMs !== before && !zips().length);
      }
    }
    const c = r.checks;
    r.ok = !!(c.bridge && c["nodeIntegration off"] && c.webgl2 && c["editor ready"] && c["example nodes"] > 0 && c["distinct colours"] > 50 && c.saved && c.reopened && c["saved in place"] && c["paint project"] && c["paint saved"] && c["paint reopened"] && c["paint saved in place"]);
  } catch (e) {
    r.error = String(e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(out, JSON.stringify(r, null, 2));
  console.log("selftest", JSON.stringify(r));
  app.exit(r.ok ? 0 : 1);
};
