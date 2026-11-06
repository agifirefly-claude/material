/* Paint mode: the current paint project, the tools, and the link between the brush graph and the node editor.
 * As in Material Maker's paint panel, the brush is a node graph: while painting, the node editor shows it. */
import { useSyncExternalStore } from "react";
import { editor } from "../store";
import { PaintProject, findFile, unpackFiles, type Float32ArrayImage, type ModelFile } from "../../engine/paint/project";
import { installMeshMaps } from "../../engine/paint/meshmaps";
import type { PaintMesh } from "../../engine/paint/mesh";
import type { Dict } from "../../engine/gen/base";
import type { LibraryItem } from "../../engine/registry";
import { projectText, parseProject, downloadBlob } from "../exporting";
import { geometryToPaintMesh, loadModelGeometry, normalizeGeometry } from "./meshes";
import { t } from "../i18n";

export const TOOLS = ["FreeDots", "FreeLine", "Line", "Stamp", "ColorPicker", "MaskSelector"] as const;
export const TOOL_LABELS = ["Free dots", "Free line", "Line", "Stamp", "Colour picker", "ID mask"];

class PaintState {
  project: PaintProject | null = null;
  /** the material project, kept while painting */
  private savedMaterial: { title: string; text: string } | null = null;
  tool = 0;
  eraser = false;
  /** paint in texture space through the view (the "Engine" toggle) */
  textureEngine = false;
  spacing = 1;
  pressure = { size: false, opacity: false, hardness: false };
  brushes: LibraryItem[] = [];
  /** where keyboard shortcuts go: the paint views or the node editor */
  focus: "paint" | "graph" = "paint";
  status = "";
  version = 0;
  private listeners = new Set<() => void>();
  private unwatchBrush: (() => void) | null = null;
  private brushTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  emit = () => {
    this.version++;
    for (const l of this.listeners) l();
  };

  async loadBrushes() {
    if (this.brushes.length) return;
    this.brushes = await fetch("data/brushes.json").then((r) => r.json());
    try {
      const user = JSON.parse(localStorage.getItem("material-pro:brushes") ?? "[]");
      this.brushes.push(...user);
    } catch {
      /* none */
    }
    this.emit();
  }

  /** opens a paint project (create_paint_project / do_load_painting) */
  private async open(project: PaintProject) {
    installMeshMaps();
    await this.loadBrushes();
    if (!this.project) this.savedMaterial = { title: editor.title, text: projectText() };
    else this.project.dispose();
    this.project = project;
    if (!project.brushGraph) project.setBrush(this.brushes.find((b) => b.tree_item === "Simple/Uniform") ?? this.brushes[0], false);
    project.onChange(() => {
      if (project.brushGraph && project.brushGraph !== editor.root) this.showBrush();
      this.emit();
    });
    this.showBrush();
    this.emit();
  }

  /** the node editor shows the brush graph; its changes update the brush */
  private showBrush() {
    const p = this.project!;
    this.unwatchBrush?.();
    editor.setRoot(p.brushGraph!, "Brush");
    this.unwatchBrush = p.brushGraph!.onChange(() => {
      if (this.brushTimer) clearTimeout(this.brushTimer);
      this.brushTimer = setTimeout(() => {
        p.brushChanged();
        this.emit();
      }, 60);
    });
  }

  async newProject(mesh: PaintMesh, model: ModelFile | null, sizeExp: number, title: string) {
    const p = new PaintProject(editor.renderer!, mesh, model);
    p.title = title;
    p.setSettings({ texture_size: sizeExp });
    p.initProject();
    await this.open(p);
  }

  setBrush(data: Dict) {
    this.project?.setBrush(data);
    this.emit();
  }

  /** back to editing materials */
  close() {
    if (!this.project) return;
    if (this.project.needSave && !confirm(t("The paint project has unsaved changes. Close it anyway?"))) return;
    this.unwatchBrush?.();
    this.project.dispose();
    this.project = null;
    const s = this.savedMaterial;
    this.savedMaterial = null;
    if (s) editor.load(parseProject(s.text), s.title);
    this.emit();
  }

  save() {
    const p = this.project;
    if (!p) return;
    const zip = p.save(p.title);
    downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${p.title}.mmpp.zip`);
    this.emit();
  }

  /** a saved project: a zip, or a .mmpp with its layer PNGs and model picked together */
  async load(files: { name: string; data: Uint8Array }[]) {
    const all = unpackFiles(files);
    const mmppName = [...all.keys()].find((k) => k.endsWith(".mmpp"));
    if (!mmppName) throw new Error("No .mmpp file");
    const data = JSON.parse(new TextDecoder().decode(all.get(mmppName)!));
    const modelBytes = data.model ? findFile(all, data.model) : null;
    if (!modelBytes) throw new Error(`The model ${data.model || ""} is not among the files`);
    const modelName = String(data.model).split(/[\\/]/).pop()!;
    const geo = normalizeGeometry(await loadModelGeometry(modelName, modelBytes));
    const mesh = geometryToPaintMesh(geo, modelName);
    const p = new PaintProject(editor.renderer!, mesh, { name: modelName, data: modelBytes });
    p.title = mmppName.split("/").pop()!.replace(/\.mmpp$/, "");
    const dir = mmppName.replace(/\.mmpp$/, "");
    await p.loadLayers(data, async (name) => {
      const bytes = all.get(`${dir}/${name}`) ?? findFile(all, name);
      return bytes ? decodeImage(bytes) : null;
    });
    if (data.idmap) {
      const bytes = findFile(all, data.idmap);
      if (bytes) {
        const img = await decodeImage(bytes);
        p.setIdMap(p.textureFromPixels(img.width, img.height, img.data), { name: String(data.idmap).split(/[\\/]/).pop()!, data: bytes });
      }
    }
    await this.open(p);
  }

  /** the current brush, as a user brush in the brush list (Tools > Add current brush to library) */
  addBrushToLibrary(name: string) {
    const g = this.project?.brushGraph;
    if (!g) return;
    const item = { ...g.serialize(), tree_item: "User/" + name, display_name: name } as LibraryItem;
    this.brushes.push(item);
    try {
      const user = JSON.parse(localStorage.getItem("material-pro:brushes") ?? "[]");
      user.push(item);
      localStorage.setItem("material-pro:brushes", JSON.stringify(user));
    } catch {
      /* storage blocked */
    }
    this.emit();
  }

  setStatus(s: string) {
    editor.setStatus(s);
  }
}

export const paint = new PaintState();

export function usePaint(): number {
  return useSyncExternalStore(paint.subscribe, paint.getVersion);
}

/** an image file as float RGBA, row 0 at the top */
export async function decodeImage(bytes: Uint8Array): Promise<Float32ArrayImage> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: Float32Array.from(id.data, (v) => v / 255) };
}

/** picks files with the browser's file dialog */
export function pickFiles(accept: string, multiple = false): Promise<{ name: string; data: Uint8Array }[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = async () => resolve(await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    input.click();
  });
}
