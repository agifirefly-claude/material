/* Material Pro desktop app: the Vite build (dist/) served from app://material-pro/, with native menus, dialogs and
 * file access through electron/preload.cjs. Security: context isolation, a sandboxed renderer, no Node in the page,
 * a strict content security policy, navigation and new windows kept to the app. */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const SCHEME = "app";
const HOST = "material-pro";
const ORIGIN = `${SCHEME}://${HOST}`;
const DIST = path.join(__dirname, "..", "dist");
const PROJECT_EXT = [".ptex", ".mmpp"];
/** files a .mmpp project may need from its folder (layer pictures, the model) */
const PAINT_SIBLINGS = /\.(png|jpe?g|webp|exr|obj|glb|gltf|fbx|bin)$/i;
const MAX_SIBLING_BYTES = 512 * 1024 * 1024;

/* Tests: MATERIAL_PRO_TEST_SAVE_DIR saves into that folder without a dialog, MATERIAL_PRO_TEST_OPEN_DIALOG answers
 * open dialogs with these paths, MATERIAL_PRO_TEST_OPEN opens these paths at launch, MATERIAL_PRO_SELFTEST runs
 * electron/selftest.cjs and quits. */
const TEST_SAVE_DIR = process.env.MATERIAL_PRO_TEST_SAVE_DIR;
const SELFTEST = process.env.MATERIAL_PRO_SELFTEST;
// a separate profile (tests): its own settings, window state, recent files and single-instance lock
if (process.env.MATERIAL_PRO_USER_DATA) app.setPath("userData", process.env.MATERIAL_PRO_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "media-src 'self' data: blob: mediastream:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/* ---------- small persisted state: window bounds, recent files ---------- */
const stateFile = (name) => path.join(app.getPath("userData"), name);
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(name), "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(name, value) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(stateFile(name), JSON.stringify(value));
  } catch {
    /* not fatal */
  }
}

let recent = [];
function addRecent(p) {
  recent = [p, ...recent.filter((x) => x !== p)].filter((x) => fs.existsSync(x)).slice(0, 12);
  writeJson("recent.json", recent);
  app.addRecentDocument(p);
  buildMenu();
}

/* ---------- files ---------- */
const KNOWN = { ptex: "Material Pro project", mmpp: "Paint project", zip: "Zip archive", png: "PNG image", jpg: "JPEG image", webp: "WebP image", exr: "OpenEXR image", glb: "Binary glTF", json: "JSON" };
function filtersFor(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return ext ? [{ name: KNOWN[ext] ?? ext.toUpperCase(), extensions: [ext] }, { name: "All files", extensions: ["*"] }] : [];
}

/** what the page receives for an opened file: its name, path and bytes, and for a paint project the files beside it */
function filePayload(p) {
  const out = [{ name: path.basename(p), path: p, data: new Uint8Array(fs.readFileSync(p)) }];
  if (/\.mmpp$/i.test(p)) {
    let total = 0;
    const dir = path.dirname(p);
    for (const f of fs.readdirSync(dir)) {
      if (!PAINT_SIBLINGS.test(f)) continue;
      const full = path.join(dir, f);
      const size = fs.statSync(full).size;
      if (total + size > MAX_SIBLING_BYTES) break;
      total += size;
      out.push({ name: f, path: full, data: new Uint8Array(fs.readFileSync(full)) });
    }
  }
  return out;
}

/** writes stay inside what the user picked: paths that came from a dialog or an opened file */
const allowedPaths = new Set();
const allow = (p) => (allowedPaths.add(path.resolve(p)), p);

let dirState = null;
const lastDir = () => (dirState && fs.existsSync(dirState) ? dirState : app.getPath("documents"));
const rememberDir = (p) => (dirState = path.dirname(p));

ipcMain.handle("mp:open", async (e, opts = {}) => {
  const owner = BrowserWindow.fromWebContents(e.sender);
  let paths = process.env.MATERIAL_PRO_TEST_OPEN_DIALOG ? process.env.MATERIAL_PRO_TEST_OPEN_DIALOG.split(path.delimiter) : null;
  if (!paths) {
    const r = await dialog.showOpenDialog(owner, {
      defaultPath: lastDir(),
      properties: opts.multiple ? ["openFile", "multiSelections"] : ["openFile"],
      filters: Array.isArray(opts.filters) ? opts.filters : undefined,
    });
    if (r.canceled) return null;
    paths = r.filePaths;
  }
  if (paths[0]) rememberDir(paths[0]);
  for (const p of paths) if (PROJECT_EXT.includes(path.extname(p).toLowerCase())) addRecent(p);
  return paths.flatMap((p) => filePayload(allow(p)));
});

ipcMain.handle("mp:save", async (e, { data, name, path: given }) => {
  const owner = BrowserWindow.fromWebContents(e.sender);
  const base = path.basename(String(name || "untitled"));
  let target = given && allowedPaths.has(path.resolve(given)) ? given : null;
  if (!target) {
    if (TEST_SAVE_DIR) target = path.join(TEST_SAVE_DIR, base);
    else {
      const r = await dialog.showSaveDialog(owner, { defaultPath: path.join(lastDir(), base), filters: filtersFor(base) });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(data));
  allow(target);
  rememberDir(target);
  if (PROJECT_EXT.includes(path.extname(target).toLowerCase())) addRecent(target);
  return target;
});

/** a file chosen once and written again later (Auto Export) */
ipcMain.handle("mp:pickSave", async (e, { name }) => {
  const owner = BrowserWindow.fromWebContents(e.sender);
  const base = path.basename(String(name || "export.png"));
  if (TEST_SAVE_DIR) return allow(path.join(TEST_SAVE_DIR, base));
  const r = await dialog.showSaveDialog(owner, { defaultPath: path.join(lastDir(), base), filters: filtersFor(base) });
  if (r.canceled || !r.filePath) return null;
  rememberDir(r.filePath);
  return allow(r.filePath);
});

ipcMain.handle("mp:write", async (_e, { path: p, data }) => {
  if (!allowedPaths.has(path.resolve(p))) throw new Error("Not a file the user chose");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(data));
  return true;
});

ipcMain.handle("mp:recent", () => recent);
ipcMain.on("mp:document", (e, { path: p, edited }) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (process.platform === "darwin") {
    w.setDocumentEdited(!!edited);
    w.setRepresentedFilename(p && allowedPaths.has(path.resolve(p)) ? p : "");
  }
});

/* ---------- the window ---------- */
let win = null;
const pendingOpen = [];
function sendOpen(paths) {
  const ok = paths.filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  for (const p of ok) if (PROJECT_EXT.includes(path.extname(p).toLowerCase())) addRecent(p);
  if (!win || win.webContents.isLoading()) {
    pendingOpen.push(...ok);
    return;
  }
  for (const p of ok) win.webContents.send("mp:open-files", filePayload(allow(p)));
}
const fileArgs = (argv) => argv.slice(1).filter((a) => !a.startsWith("-") && PROJECT_EXT.includes(path.extname(a).toLowerCase()));

function createWindow() {
  const saved = readJson("window.json", null);
  const area = screen.getPrimaryDisplay().workAreaSize;
  const bounds = saved?.bounds ?? { width: Math.min(1600, area.width), height: Math.min(1000, area.height) };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    title: "Material Pro",
    backgroundColor: "#1d1f23",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  if (saved?.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  const save = () => win && writeJson("window.json", { bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  win.on("resize", save);
  win.on("move", save);
  win.on("close", save);
  win.on("closed", () => (win = null));

  // stay on the app: web links open in the browser, nothing navigates the window away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN + "/")) e.preventDefault();
  });
  win.webContents.on("did-finish-load", () => {
    const paths = pendingOpen.splice(0);
    for (const p of paths) if (fs.existsSync(p)) win.webContents.send("mp:open-files", filePayload(allow(p)));
    // the self test opens files the way Finder does (sendOpen), so they count as chosen by the user
    if (SELFTEST) require("./selftest.cjs").run(win, SELFTEST, { open: sendOpen });
  });
  win.loadURL(`${ORIGIN}/index.html`);
}

/* ---------- the menu: actions are carried out by the page (src/ui/platform.ts) ---------- */
const chinese = () => app.getPreferredSystemLanguages().some((l) => l.toLowerCase().startsWith("zh"));
const L = (en, cn) => (chinese() ? cn : en);
const send = (action, arg) => () => win?.webContents.send("mp:menu", { action, arg });

function buildMenu() {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { label: L("About Material Pro", "关于 Material Pro"), click: send("about") },
              { type: "separator" },
              { label: L("Preferences…", "偏好设置…"), accelerator: "CmdOrCtrl+,", click: send("preferences") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: L("File", "文件"),
      submenu: [
        { label: L("New Material", "新建材质"), accelerator: "CmdOrCtrl+N", click: send("new") },
        { label: L("New Paint Project…", "新建绘制工程…"), accelerator: "CmdOrCtrl+Shift+N", click: send("newPaint") },
        { type: "separator" },
        { label: L("Open…", "打开…"), accelerator: "CmdOrCtrl+O", click: send("open") },
        {
          label: L("Open Recent", "最近打开"),
          submenu: recent.length
            ? [
                ...recent.map((p) => ({ label: path.basename(p), sublabel: path.dirname(p), click: () => sendOpen([p]) })),
                { type: "separator" },
                {
                  label: L("Clear Menu", "清除列表"),
                  click: () => {
                    recent = [];
                    writeJson("recent.json", recent);
                    app.clearRecentDocuments();
                    buildMenu();
                  },
                },
              ]
            : [{ label: L("No Recent Files", "没有最近打开的文件"), enabled: false }],
        },
        { label: L("Examples…", "示例…"), click: send("examples") },
        { type: "separator" },
        { label: L("Save", "保存"), accelerator: "CmdOrCtrl+S", click: send("save") },
        { label: L("Save As…", "另存为…"), accelerator: "CmdOrCtrl+Shift+S", click: send("saveAs") },
        { type: "separator" },
        { label: L("Export…", "导出…"), accelerator: "CmdOrCtrl+Shift+E", click: send("export") },
        { label: L("Export Material Maps (zip)", "导出材质贴图（zip）"), click: send("exportMaps") },
        { type: "separator" },
        mac ? { role: "close", label: L("Close Window", "关闭窗口") } : { role: "quit", label: L("Quit", "退出") },
      ],
    },
    {
      label: L("Edit", "编辑"),
      submenu: [
        { label: L("Undo", "撤销"), accelerator: "CmdOrCtrl+Z", click: send("undo") },
        { label: L("Redo", "重做"), accelerator: "Shift+CmdOrCtrl+Z", click: send("redo") },
        { type: "separator" },
        { label: L("Cut", "剪切"), accelerator: "CmdOrCtrl+X", click: send("cut") },
        { label: L("Copy", "复制"), accelerator: "CmdOrCtrl+C", click: send("copy") },
        { label: L("Paste", "粘贴"), accelerator: "CmdOrCtrl+V", click: send("paste") },
        { label: L("Duplicate", "复制节点"), accelerator: "CmdOrCtrl+D", click: send("duplicate") },
        { label: L("Select All", "全选"), accelerator: "CmdOrCtrl+A", click: send("selectAll") },
        { type: "separator" },
        { label: L("Group into Subgraph", "打组为子图"), accelerator: "CmdOrCtrl+G", click: send("group") },
        { label: L("Find Node…", "查找节点…"), accelerator: "CmdOrCtrl+F", click: send("find") },
        ...(mac ? [] : [{ type: "separator" }, { label: L("Preferences…", "偏好设置…"), accelerator: "CmdOrCtrl+,", click: send("preferences") }]),
      ],
    },
    {
      label: L("View", "视图"),
      submenu: [
        { label: L("Libraries…", "节点库…"), click: send("libraries") },
        { label: L("Panel Layout…", "面板布局…"), click: send("layouts") },
        { type: "separator" },
        { role: "resetZoom", label: L("Actual Size", "实际大小") },
        { role: "zoomIn", label: L("Zoom In", "放大") },
        { role: "zoomOut", label: L("Zoom Out", "缩小") },
        { type: "separator" },
        { role: "togglefullscreen", label: L("Toggle Full Screen", "切换全屏") },
        ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu", label: L("Window", "窗口") },
    {
      role: "help",
      label: L("Help", "帮助"),
      submenu: [{ label: L("User Manual", "用户手册"), click: send("manual") }, ...(mac ? [] : [{ label: L("About Material Pro", "关于 Material Pro"), click: send("about") }])],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- start ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    sendOpen(fileArgs(argv));
  });
  // Finder: a double click on a project, or a drop on the Dock icon (it may come before the app is ready)
  app.on("open-file", (e, p) => {
    e.preventDefault();
    if (app.isReady()) {
      if (!win) createWindow();
      sendOpen([p]);
    } else pendingOpen.push(p);
  });

  app.whenReady().then(() => {
    recent = readJson("recent.json", []).filter((p) => typeof p === "string" && fs.existsSync(p));
    protocol.handle(SCHEME, async (req) => {
      const url = new URL(req.url);
      if (url.host !== HOST) return new Response("Not found", { status: 404 });
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const file = path.normalize(path.join(DIST, rel));
      if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      if (rel.endsWith(".html")) headers.set("Content-Security-Policy", CSP);
      return new Response(res.body, { status: res.status, headers });
    });
    // the camera (Webcam node), the clipboard and full screen; nothing else
    const allowed = ["media", "clipboard-read", "clipboard-sanitized-write", "fullscreen"];
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(wc.getURL().startsWith(ORIGIN) && allowed.includes(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => !!wc && wc.getURL().startsWith(ORIGIN) && allowed.includes(permission));
    buildMenu();
    pendingOpen.push(...fileArgs(process.argv));
    if (process.env.MATERIAL_PRO_TEST_OPEN) pendingOpen.push(...process.env.MATERIAL_PRO_TEST_OPEN.split(path.delimiter));
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" || SELFTEST) app.quit();
  });
}
