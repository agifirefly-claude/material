import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "./store";
import { GraphView, ProjectTabs, groupSelection } from "./GraphView";
import { Hierarchy, Library } from "./Library";
import { Dock, PANEL_TITLES } from "./dock/Dock";
import { ALL_PANELS, dockOf, showPanel, visiblePanels } from "./dock/model";
import { Inspector } from "./Inspector";
import { Preview2D } from "./Preview2D";
import { ReferencePanel } from "./Reference";
import { ExportDialogsHost, openExportDialog } from "./preview2d/Dialogs";
import { Preview3D } from "./Preview3D";
import { exportForEngine, exportMaterialMaps, openExample, openProjectFile, parseProject, projectText, saveProject } from "./exporting";
import { exportProfiles } from "../engine/export";
import { findMaterial, previewMaps } from "../engine/materialMaps";
import { ExportDialog } from "./ExportDialog";
import { raymarchPreviewSupported } from "../engine/preview3d";
import { PreviewRay } from "./PreviewRay";
import { newProject } from "../engine/loader";
import { registry } from "../engine/registry";
import { t, useLang } from "./i18n";
import { DialogHost } from "./dialogs/AppDialogs";
import { openDialog } from "./dialogs/bus";
import { getPrefs, setPrefs, usePrefs } from "./prefs";
import * as graphActions from "./graph/actions";

/** asks before replacing a project with changes (confirm_close_project) */
function confirmDiscard(): boolean {
  return !getPrefs().confirmCloseProject || !editor.canUndo || confirm(t("Discard the changes to the current project?"));
}

/** a new project whose material has the preferred size */
function newMaterial(type?: string) {
  const g = newProject(type);
  const m = g.children[0];
  if (m && m.getParameterDef("size")) m.parameters.size = getPrefs().defaultMaterialSize;
  editor.openProject(g, "untitled");
}
import { paint, usePaint } from "./paint/paintStore";
import { useHostIntegration } from "./hostIntegration";

const MANUAL_URL = "https://rodzill4.github.io/material-maker/doc/";
import { NewPaintDialog, PaintMenuItems, PaintWorkspace } from "./paint/PaintWorkspace";

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
        <h2>{t("Examples from Material Maker")}</h2>
        <p style={{ color: "var(--text2)", marginTop: 0 }}>{t("Each opens as a full node graph you can inspect: select nodes to see their parameters and generated code, double click subgraphs to open them.")}</p>
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
  useLang();
  const prefs = usePrefs();
  const layout = prefs.layout;
  const dock = dockOf(layout);
  const [examples, setExamples] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newPaint, setNewPaint] = useState(false);
  usePaint();
  // the desktop app's menu (electron/main.cjs); the Edit commands it does not name go to editCommand
  useHostIntegration({
    new: () => newMaterial(),
    newPaint: () => setNewPaint(true),
    open: openProjectFile,
    examples: () => setExamples(true),
    save: () => (paint.project ? paint.save() : saveProject()),
    saveAs: () => (paint.project ? paint.save() : saveProject(true)),
    export: () => setExporting(true),
    exportMaps: () => void exportMaterialMaps(),
    preferences: () => openDialog("preferences"),
    about: () => openDialog("about"),
    libraries: () => openDialog("libraries"),
    layouts: () => openDialog("layouts"),
    manual: () => window.open(MANUAL_URL, "_blank"),
  });
  const [toast, setToast] = useState("");
  // Material Maker's confirm_quit: the browser asks before leaving with changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (getPrefs().confirmQuit && editor.canUndo) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  // Ctrl+S (⌘S) saves the project, as the File menu does, instead of the browser saving the page
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (!editor.status) return;
    setToast(editor.status);
    editor.status = "";
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [editor.version]);

  // autosave
  useEffect(() => {
    // paint tabs hold the brush graph: the autosave keeps the last material project
    if (!prefs.autosave || editor.data) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem("material-pro:autosave", JSON.stringify({ title: editor.title, text: projectText() }));
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [editor.version, prefs.autosave]);

  const r = editor.renderer;
  const material = findMaterial(editor.root);
  const rayMaterial = material && !previewMaps(material) && raymarchPreviewSupported(material) ? material : null;
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((x) => x + 1), 2000);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">{t("Material Pro")}</span>
        <Menu label={t("File")}>
          {(close) => (
            <>
              <button onClick={() => (close(), newMaterial())}>{t("New material")}</button>
              <div className="label">{t("New with another material type")}</div>
              {Object.entries(registry.nodes)
                .filter(([, v]) => v.type === "material_export")
                .map(([k, v]) => (
                  <button key={k} onClick={() => (close(), newMaterial(k))}>
                    {t(v.shader_model?.name ?? k)}
                  </button>
                ))}
              <hr />
              <button onClick={() => (close(), openProjectFile())}>{t("Open…")}{" "}{t("(.ptex)")}</button>
              <button onClick={() => (close(), setExamples(true))}>{t("Examples…")}</button>
              <button onClick={() => (close(), saveProject())}>{t("Save")}{" "}{t("(.ptex)")}{" "}{t("(Ctrl+S)")}</button>
              <hr />
              <button onClick={() => (close(), setExporting(true))}>{t("Export…")}</button>
              <button onClick={() => (close(), exportMaterialMaps())}>{t("Export material maps (zip)")}</button>
              <button onClick={() => (close(), openExportDialog({ kind: "animation" }))}>{t("Export animation of the selected node…")}</button>
              <button onClick={() => (close(), openExportDialog({ kind: "taa" }))}>{t("TAA render of the selected node…")}</button>
              {[512, 1024, 2048, 4096].map((s) => (
                <button key={s} onClick={() => (close(), exportMaterialMaps(s))}>
                  {t("Export maps at {0}×{0}", s)}
                </button>
              ))}
              <PaintMenuItems close={close} onNew={() => setNewPaint(true)} />
            </>
          )}
        </Menu>
        <Menu label={t("Edit")}>
          {(close) => (
            <>
              <button disabled={!editor.canUndo} onClick={() => (close(), editor.undo())}>
                {t("Undo")}{" "}{t("(Ctrl+Z)")}
              </button>
              <button disabled={!editor.canRedo} onClick={() => (close(), editor.redo())}>
                {t("Redo")}{" "}{t("(Ctrl+Shift+Z)")}
              </button>
              <hr />
              <button disabled={editor.selection.length === 0} onClick={() => (close(), groupSelection())}>
                {t("Group into subgraph")}{" "}{t("(Ctrl+G)")}
              </button>
              <button onClick={() => (close(), graphActions.selectAll())}>{t("Select all")}{" "}{t("(Ctrl+A)")}</button>
              <button onClick={() => (close(), graphActions.selectInvert())}>{t("Invert selection")}{" "}{t("(Ctrl+I)")}</button>
              <button onClick={() => (close(), window.dispatchEvent(new Event("mm-find-node")))}>{t("Find a node…")}{" "}{t("(Ctrl+F)")}</button>
              <button disabled={!editor.selected} onClick={() => (close(), openDialog("edit-node", editor.selected))}>
                {t("Edit node…")}{" "}{t("(Ctrl+E)")}
              </button>
              <button disabled={!editor.selected} onClick={() => (close(), openDialog("add-to-library", editor.selected))}>
                {t("Add selection to a library…")}
              </button>
              <hr />
              <button onClick={() => (close(), openDialog("preferences"))}>{t("Preferences…")}</button>
              <div className="label">{t("Copy Ctrl+C · Paste Ctrl+V · Duplicate Ctrl+D · Delete Del · Up a level Esc")}</div>
            </>
          )}
        </Menu>
        <Menu label={t("View")}>
          {(close) => (
            <>
              <button onClick={() => (close(), (editor.background = editor.background === "2d" ? "none" : "2d"), editor.emit())}>
                {editor.background === "2d" ? "✓ " : ""}
                {t("Show 2D preview behind the graph")}
              </button>
              <button onClick={() => (close(), (editor.background = editor.background === "3d" ? "none" : "3d"), editor.emit())}>
                {editor.background === "3d" ? "✓ " : ""}
                {t("Show 3D preview behind the graph")}
              </button>
              <hr />
              <div className="label">{t("Panels")}</div>
              {ALL_PANELS.map((p) => {
                const shown = !dock.hidden.includes(p);
                return (
                  <button key={p} onClick={() => (close(), setPrefs({ layout: { ...layout, dock: shown ? (visiblePanels(dock.root).has(p) ? dock : showPanel(dock, p)) : showPanel(dock, p) } }))}>
                    {shown ? "✓ " : ""}
                    {t(PANEL_TITLES[p])}
                  </button>
                );
              })}
              <button onClick={() => (close(), setPrefs({ layout: { ...layout, dock: undefined } }))}>{t("Reset panel layout")}</button>
              <hr />
              <button onClick={() => (close(), openDialog("libraries"))}>{t("Libraries…")}</button>
              <button onClick={() => (close(), openDialog("layouts"))}>{t("Panel layout…")}</button>
              {Object.keys(prefs.layoutPresets).map((k) => (
                <button key={k} onClick={() => (close(), setPrefs({ layout: { ...prefs.layoutPresets[k] } }))}>
                  {t("Layout")}: {k}
                </button>
              ))}
            </>
          )}
        </Menu>
        <Menu label={t("Help")}>
          {(close) => (
            <>
              <button onClick={() => (close(), window.open(MANUAL_URL, "_blank"))}>{t("User manual")}</button>
              <button onClick={() => (close(), openDialog("about"))}>{t("About…")}</button>
            </>
          )}
        </Menu>
        <button onClick={() => setExamples(true)}>{t("Examples")}</button>
        <span className="title">{editor.title}</span>
        <span className="spacer" />
        <button onClick={() => openDialog("preferences")} title={t("Preferences")}>
          ⚙
        </button>
        <button disabled={!editor.canUndo} onClick={() => editor.undo()} title={t("Undo")}>
          ↶
        </button>
        <button disabled={!editor.canRedo} onClick={() => editor.redo()} title={t("Redo")}>
          ↷
        </button>
      </div>
      <ProjectTabs />
      {paint.project ? (
        <PaintWorkspace />
      ) : (
      <div className="main dock-main">
        <Dock
          layout={dock}
          onChange={(d) => setPrefs({ layout: { ...prefs.layout, dock: d } })}
          center={<GraphView />}
          panel={(p, shown) => {
            switch (p) {
              case "library":
                return <Library hierarchy={false} />;
              case "hierarchy":
                return <Hierarchy docked />;
              case "preview3d":
                return rayMaterial ? shown && <PreviewRay m={rayMaterial} /> : <Preview3D active={shown} />;
              case "preview2d":
                return shown && <Preview2D />;
              case "reference":
                return <ReferencePanel />;
              case "inspector":
                return <Inspector />;
            }
          }}
        />
      </div>
      )}
      <div className="statusbar">
        <span>
          {t("{0} library nodes · {1} node definitions", registry.library.length, Object.keys(registry.nodes).length)}
        </span>
        <span>{r ? t("{0} shaders compiled · {1} renders", r.stats.programs, r.stats.renders) : t("renderer not ready")}</span>
        <span style={{ flex: 1 }} />
        <span>{t("Based on Material Maker (MIT) by Rodolphe Suescun and contributors")}</span>
      </div>
      {examples && <Examples onClose={() => setExamples(false)} />}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {newPaint && <NewPaintDialog onClose={() => setNewPaint(false)} />}
      <ExportDialogsHost />
      {toast && <div className="toast">{toast}</div>}
      <DialogHost />
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

