/* A smoke test of the packaged app, run by main.cjs when MATERIAL_PRO_SELFTEST names a result file
 * (npm run electron:smoke). It checks the bridge, WebGL2 with float render targets, opens an example, looks at the
 * rendered window, saves through the File menu (MATERIAL_PRO_TEST_SAVE_DIR answers the dialog) and opens the saved
 * file again the way Finder would. The result is written as JSON and the app quits. */
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

exports.run = async function run(win, out) {
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
    const c = r.checks;
    r.ok = !!(c.bridge && c["nodeIntegration off"] && c.webgl2 && c["editor ready"] && c["example nodes"] > 0 && c["distinct colours"] > 50 && c.saved && c.reopened && c["saved in place"]);
  } catch (e) {
    r.error = String(e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(out, JSON.stringify(r, null, 2));
  console.log("selftest", JSON.stringify(r));
  app.exit(r.ok ? 0 : 1);
};
