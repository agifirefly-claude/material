/* The only bridge between the page and the system: dialogs, writing the files the user chose, files opened from
 * Finder and the native menu. The page sees it as window.materialPro (src/ui/platform.ts). */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("materialPro", {
  platform: process.platform,
  /** files picked in an open dialog: [{ name, path, data }] (a paint project brings the files beside it), or null */
  open: (opts) => ipcRenderer.invoke("mp:open", opts ?? {}),
  /** saves bytes to `path` when it is a file the user chose before, otherwise where the save dialog says; the path, or null */
  save: (data, name, path) => ipcRenderer.invoke("mp:save", { data, name, path }),
  /** asks once for a file to write to later (Auto Export); its path, or null */
  pickSave: (name) => ipcRenderer.invoke("mp:pickSave", { name }),
  /** writes a file chosen with pickSave, save or open */
  write: (path, data) => ipcRenderer.invoke("mp:write", { path, data }),
  recent: () => ipcRenderer.invoke("mp:recent"),
  /** the path of a file dropped on the page */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  /** the open document and whether it has unsaved changes (shown in the macOS title bar) */
  setDocument: (path, edited) => ipcRenderer.send("mp:document", { path, edited }),
  onMenu: (cb) => {
    const h = (_e, m) => cb(m.action, m.arg);
    ipcRenderer.on("mp:menu", h);
    return () => ipcRenderer.removeListener("mp:menu", h);
  },
  onOpenFiles: (cb) => {
    openListeners.add(cb);
    // files opened at launch can arrive before the page listens
    for (const files of queued.splice(0)) cb(files);
    return () => openListeners.delete(cb);
  },
});

const openListeners = new Set();
const queued = [];
ipcRenderer.on("mp:open-files", (_e, files) => {
  if (openListeners.size) for (const cb of openListeners) cb(files);
  else queued.push(files);
});
