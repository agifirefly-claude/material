import { createRoot } from "react-dom/client";
import "./ui/styles.css";
import { loadRegistry } from "./engine/registry";
import { Renderer } from "./engine/render/renderer";
import { editor } from "./ui/store";
import { App, restoreAutosave } from "./ui/App";
import { openExample } from "./ui/exporting";

async function start() {
  const root = document.getElementById("root")!;
  root.innerHTML = '<div class="empty" style="padding:40px">Loading the node library…</div>';
  await loadRegistry("data/");
  try {
    editor.renderer = new Renderer();
    editor.renderer.onAsyncUpdate = () => {
      editor.renderer!.clearCache();
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
start();
