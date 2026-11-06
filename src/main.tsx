import { createRoot } from "react-dom/client";
import "./ui/styles.css";
import { loadRegistry, registry } from "./engine/registry";
import { libraries } from "./ui/library/manager";
import { initialLanguage, setLanguage } from "./ui/i18n";
import { applyPrefs } from "./ui/prefs";
import { Renderer } from "./engine/render/renderer";
import { RenderService } from "./engine/render/service";
import { previews } from "./ui/previews";
import { t } from "./ui/i18n";
import { editor } from "./ui/store";
import { App, restoreAutosave } from "./ui/App";
import { openExample } from "./ui/exporting";

async function start() {
  const root = document.getElementById("root")!;
  root.innerHTML = '<div class="empty" style="padding:40px">Loading the node library…</div>';
  await loadRegistry("data/");
  libraries.load();
  try {
    registry.globalParameters = JSON.parse(localStorage.getItem("material-pro:globals") ?? "{}");
  } catch {
    registry.globalParameters = {};
  }
  const params0 = new URLSearchParams(location.search);
  await setLanguage(params0.get("lang") ?? initialLanguage());
  applyPrefs();
  try {
    editor.renderer = pageRenderer();
    const svc = await new RenderService(editor.renderer).start({ worker: params0.get("render") !== "main" });
    editor.renders = svc;
    svc.onAsyncUpdate = () => editor.emit();
    // free the renders of deleted nodes and closed tabs (Material Maker #1539), a moment after changes settle
    let pruneTimer: ReturnType<typeof setTimeout> | null = null;
    editor.subscribe(() => {
      if (pruneTimer) clearTimeout(pruneTimer);
      pruneTimer = setTimeout(() => editor.renders?.prune(editor.openRoots()), 1000);
    });
    svc.onLost = () => editor.setStatus(t("The GPU was reset: previews are drawn again as soon as it is back"));
    svc.onRestored = () => {
      editor.setStatus(t("The GPU is back: previews were drawn again"));
      previews.redrawAll();
      editor.emit();
    };
  } catch (e) {
    root.innerHTML = `<div class="empty" style="padding:40px">This browser cannot run the renderer: ${e}. Material Pro needs WebGL2 with float render targets.</div>`;
    return;
  }
  root.innerHTML = "";
  const params = new URLSearchParams(location.search);
  if (params.get("example")) await openExample(params.get("example")!);
  else if (!restoreAutosave()) await openExample("bricks");
  createRoot(root).render(<App />);
}
/** the page's own renderer; when its context is lost (a GPU reset), a new one takes its place */
function pageRenderer(): Renderer {
  const r = new Renderer();
  r.onAsyncUpdate = () => {
    r.clearCache();
    editor.emit();
  };
  (r.canvas as EventTarget).addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    try {
      const next = pageRenderer();
      editor.renderer = next;
      if (editor.renders) editor.renders.main = next;
      editor.setStatus(t("The GPU was reset: previews were drawn again"));
      previews.redrawAll();
      editor.emit();
    } catch (err) {
      editor.setStatus(t("The GPU was reset and WebGL2 is not available any more: {0}", err));
    }
  });
  return r;
}

start();
