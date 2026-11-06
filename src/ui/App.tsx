import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "./store";
import { GraphView, groupSelection } from "./GraphView";
import { Library } from "./Library";
import { Inspector } from "./Inspector";
import { Preview2D } from "./Preview2D";
import { Preview3D } from "./Preview3D";
import { exportMaterialMaps, openExample, openProjectFile, parseProject, projectText, saveProject } from "./exporting";
import { newProject } from "../engine/loader";
import { registry } from "../engine/registry";

function Menu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className="menu-list">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Examples({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    fetch("data/examples/index.json")
      .then((r) => r.json())
      .then(setList);
  }, []);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Examples from Material Maker</h2>
        <p style={{ color: "var(--text2)", marginTop: 0 }}>Each opens as a full node graph you can inspect: select nodes to see their parameters and generated code, double click subgraphs to open them.</p>
        <div className="examples">
          {list.map((n) => (
            <button
              key={n}
              onClick={() => {
                openExample(n);
                onClose();
              }}
            >
              {n.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function App() {
  useEditor();
  const [examples, setExamples] = useState(false);
  const [view, setView] = useState<"2d" | "3d">("3d");
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!editor.status) return;
    setToast(editor.status);
    editor.status = "";
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [editor.version]);

  // autosave
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem("material-pro:autosave", JSON.stringify({ title: editor.title, text: projectText() }));
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [editor.version]);

  const r = editor.renderer;
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((x) => x + 1), 2000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">Material Pro</span>
        <Menu label="File">
          {(close) => (
            <>
              <button onClick={() => (close(), editor.setRoot(newProject(), "untitled"))}>New material</button>
              <div className="label">New with another material type</div>
              {Object.entries(registry.nodes)
                .filter(([, v]) => v.type === "material_export")
                .map(([k, v]) => (
                  <button key={k} onClick={() => (close(), editor.setRoot(newProject(k), "untitled"))}>
                    {v.shader_model?.name ?? k}
                  </button>
                ))}
              <hr />
              <button onClick={() => (close(), openProjectFile())}>Open… (.ptex)</button>
              <button onClick={() => (close(), setExamples(true))}>Examples…</button>
              <button onClick={() => (close(), saveProject())}>Save (.ptex)</button>
              <hr />
              <button onClick={() => (close(), exportMaterialMaps())}>Export material maps (zip)</button>
              {[512, 1024, 2048, 4096].map((s) => (
                <button key={s} onClick={() => (close(), exportMaterialMaps(s))}>
                  Export maps at {s}×{s}
                </button>
              ))}
            </>
          )}
        </Menu>
        <Menu label="Edit">
          {(close) => (
            <>
              <button disabled={!editor.canUndo} onClick={() => (close(), editor.undo())}>
                Undo (Ctrl+Z)
              </button>
              <button disabled={!editor.canRedo} onClick={() => (close(), editor.redo())}>
                Redo (Ctrl+Shift+Z)
              </button>
              <hr />
              <button disabled={editor.selection.length === 0} onClick={() => (close(), groupSelection())}>
                Group into subgraph (Ctrl+G)
              </button>
              <div className="label">Copy Ctrl+C · Paste Ctrl+V · Duplicate Ctrl+D · Delete Del · Up a level Esc</div>
            </>
          )}
        </Menu>
        <button onClick={() => setExamples(true)}>Examples</button>
        <span className="title">{editor.title}</span>
        <span className="spacer" />
        <button disabled={!editor.canUndo} onClick={() => editor.undo()} title="Undo">
          ↶
        </button>
        <button disabled={!editor.canRedo} onClick={() => editor.redo()} title="Redo">
          ↷
        </button>
      </div>
      <div className="main">
        <div className="panel left">
          <Library />
        </div>
        <GraphView />
        <div className="panel right">
          <div className="tabs">
            <button className={view === "3d" ? "on" : ""} onClick={() => setView("3d")}>
              3D material
            </button>
            <button className={view === "2d" ? "on" : ""} onClick={() => setView("2d")}>
              2D node output
            </button>
          </div>
          <div style={{ height: "42%", display: "flex", minHeight: 200 }}>
            <div style={{ display: view === "3d" ? "flex" : "none", flex: 1, minWidth: 0 }}>
              <Preview3D active={view === "3d"} />
            </div>
            {view === "2d" && <Preview2D />}
          </div>
          <Inspector />
        </div>
      </div>
      <div className="statusbar">
        <span>
          {registry.library.length} library nodes · {Object.keys(registry.nodes).length} node definitions
        </span>
        <span>{r ? `${r.stats.programs} shaders compiled · ${r.stats.renders} renders` : "renderer not ready"}</span>
        <span style={{ flex: 1 }} />
        <span>Based on Material Maker (MIT) by Rodolphe Suescun and contributors</span>
      </div>
      {examples && <Examples onClose={() => setExamples(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export function restoreAutosave(): boolean {
  try {
    const s = localStorage.getItem("material-pro:autosave");
    if (!s) return false;
    const { title, text } = JSON.parse(s);
    editor.load(parseProject(text), title);
    return true;
  } catch {
    return false;
  }
}
