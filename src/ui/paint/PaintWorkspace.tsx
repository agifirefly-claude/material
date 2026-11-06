/* Paint mode's layout (paint.tscn): the 3D paint view and the 2D texture view over the brush graph, with the
 * library on the left and the brushes, tools, layers and settings on the right. Also the new project dialog
 * (windows/new_painter) and the exports (panels/paint/export.gd). */
import { useEffect, useState } from "react";
import * as THREE from "three";
import { zipSync } from "fflate";
import { paint, pickFiles, usePaint } from "./paintStore";
import { PaintView } from "./PaintView";
import { Paint2D } from "./Paint2D";
import { BrushesPanel, LayersPanel, SettingsPanel, ToolsPanel } from "./PaintPanels";
import { Library } from "../Library";
import { GraphView } from "../GraphView";
import { Inspector } from "../Inspector";
import { BUILTIN_MESHES, geometryToPaintMesh, loadModelGeometry, normalizeGeometry } from "./meshes";
import { downloadBlob } from "../exporting";
import { encodePng } from "../../engine/paint/project";
import { exportProfiles, planExport, expressionShaderCode } from "../../engine/export";
import { GenContext } from "../../engine/context";
import { editor } from "../store";

export function PaintWorkspace() {
  usePaint();
  const [right, setRight] = useState<"tools" | "layers" | "settings" | "node">("layers");
  const [show2d, setShow2d] = useState(false);
  // paint shortcuts: undo and redo of strokes when the paint views have the focus
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const p = paint.project;
      if (!p || paint.focus !== "paint") return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) p.redo();
        else p.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        e.stopImmediatePropagation();
        p.redo();
      }
    };
    window.addEventListener("keydown", key, true);
    const focusGraph = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".paint-view, .paint-2d")) paint.focus = "graph";
    };
    window.addEventListener("pointerdown", focusGraph, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", focusGraph, true);
    };
  }, []);
  if (!paint.project) return null;
  return (
    <div className="main">
      <div className="panel left">
        <BrushesPanel />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderTop: "1px solid var(--line)" }}>
          <Library />
        </div>
      </div>
      <div className="paint-center">
        <div className="paint-views">
          <PaintView />
          {show2d && <Paint2D />}
          <button className="paint-2d-toggle" onClick={() => setShow2d(!show2d)}>
            {show2d ? "Hide 2D view" : "2D texture view"}
          </button>
        </div>
        <div className="paint-graph">
          <GraphView />
        </div>
      </div>
      <div className="panel right">
        <div className="tabs">
          {(
            [
              ["layers", "Layers"],
              ["tools", "Tools & brush"],
              ["settings", "Settings"],
              ["node", "Brush node"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={right === k ? "on" : ""} onClick={() => setRight(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="scroll" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {right === "layers" && <LayersPanel />}
          {right === "tools" && <ToolsPanel />}
          {right === "settings" && <SettingsPanel />}
          {right === "node" && <Inspector />}
        </div>
      </div>
    </div>
  );
}

/** windows/new_painter: a model (built in or from a file) and a texture size */
export function NewPaintDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState("sphere");
  const [file, setFile] = useState<{ name: string; data: Uint8Array } | null>(null);
  const [size, setSize] = useState(10);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const create = async () => {
    setBusy("Preparing the model…");
    try {
      let geo: THREE.BufferGeometry;
      let name = kind;
      if (kind === "file" && file) {
        geo = normalizeGeometry(await loadModelGeometry(file.name, file.data));
        name = file.name;
        const uv = geo.attributes.uv?.array as Float32Array | undefined;
        if (!uv || uv.every((x) => x === 0)) throw new Error("This model has no UVs: painting needs a UV layout");
      } else geo = BUILTIN_MESHES[kind]();
      const mesh = geometryToPaintMesh(geo, name);
      await new Promise((r) => setTimeout(r, 20));
      await paint.newProject(mesh, kind === "file" && file ? file : null, size, name.replace(/\.\w+$/, ""));
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy("");
    }
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 92vw)" }}>
        <h2>New paint project</h2>
        <p style={{ color: "var(--text2)", marginTop: 0 }}>Paint materials on a model with layers and brushes. The model needs a UV layout; its mesh maps are baked for the brushes.</p>
        <div className="insp" style={{ padding: 0 }}>
          <div className="row">
            <label>Model</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.keys(BUILTIN_MESHES).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              <option value="file">from a file…</option>
            </select>
          </div>
          {kind === "file" && (
            <div className="row">
              <label>File</label>
              <button
                onClick={async () => {
                  const [f] = await pickFiles(".obj,.glb,.gltf");
                  if (f) setFile(f);
                }}
              >
                {file ? file.name : "Choose .obj / .glb / .gltf…"}
              </button>
            </div>
          )}
          <div className="row">
            <label>Texture size</label>
            <select value={size} onChange={(e) => setSize(+e.target.value)}>
              {[8, 9, 10, 11, 12].map((i) => (
                <option key={i} value={i}>
                  {2 ** i}×{2 ** i}
                </option>
              ))}
            </select>
          </div>
          {error && <div className="err">{error}</div>}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <span style={{ color: "var(--text3)", flex: 1 }}>{busy}</span>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!!busy || (kind === "file" && !file)} onClick={create}>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function openPaintProject() {
  const files = await pickFiles(".zip,.mmpp,.png,.obj,.glb,.gltf", true);
  if (!files.length) return;
  try {
    editor.setStatus("Opening the paint project…");
    await paint.load(files);
    editor.setStatus("");
  } catch (e) {
    editor.setStatus("Cannot open: " + (e as Error).message);
  }
}

const MAP_FILES = ["albedo", "metallic", "roughness", "emission", "normal_map", "depth", "occlusion"] as const;

/** the composited maps as PNGs in a zip */
export function exportPaintMaps() {
  const p = paint.project;
  if (!p) return;
  const files: Record<string, Uint8Array> = {};
  for (const m of MAP_FILES) {
    const t = p.compositor.maps[m];
    if (t) files[`${p.title}_${m === "normal_map" ? "normal" : m}.png`] = encodePng(p.gpu, t);
  }
  downloadBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), `${p.title}_maps.zip`);
}

/** export_material: the maps through a material node and one of its export targets */
export async function exportPaintForEngine(profile: string) {
  const p = paint.project;
  if (!p) return;
  const r = p.renderer;
  const { material } = p.exportGraph();
  const plan = planExport(material, profile, p.title);
  const files: Record<string, Uint8Array> = {};
  for (const f of plan) {
    if (f.kind === "text") files[f.name] = new TextEncoder().encode(f.text);
    else if (f.kind === "texture") {
      const sc = f.output !== null ? material.getShaderCode("uv", f.output, new GenContext()) : expressionShaderCode(material, f.expression!);
      const t = r.render(sc, p.size);
      files[f.name] = encodePng(p.gpu, t);
      r.deleteTarget(t);
    }
  }
  downloadBlob(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), `${p.title}_${profile.replaceAll("/", "_").replaceAll(" ", "_")}.zip`);
}

export function paintExportProfiles(): string[] {
  const p = paint.project;
  return p ? exportProfiles(p.exportGraph().material) : [];
}

/** the paint entries of the File menu (main_window.gd: new_paint_project, load, save, export) */
export function PaintMenuItems({ close, onNew }: { close: () => void; onNew: () => void }) {
  usePaint();
  const p = paint.project;
  return (
    <>
      <hr />
      <div className="label">Painting</div>
      <button onClick={() => (close(), onNew())}>New paint project…</button>
      <button onClick={() => (close(), openPaintProject())}>Open paint project… (.mmpp.zip, or .mmpp with its files)</button>
      {p && (
        <>
          <button onClick={() => (close(), paint.save())}>Save paint project</button>
          <button onClick={() => (close(), exportPaintMaps())}>Export painted maps (zip)</button>
          <div className="label">Export the painted material for</div>
          {paintExportProfiles().map((prof) => (
            <button key={prof} onClick={() => (close(), exportPaintForEngine(prof))}>
              {prof}
            </button>
          ))}
          <button onClick={() => (close(), paint.close())}>Close paint project</button>
        </>
      )}
    </>
  );
}
