/* Paint mode: the current paint project, the tools, and the link between the brush graph and the node editor.
 * As in Material Maker's paint panel, the brush is a node graph: while painting, the node editor shows it. */
import { useSyncExternalStore } from "react";
import { editor } from "../store";
import { PaintProject, findFile, unpackFiles, type Float32ArrayImage, type ModelFile } from "../../engine/paint/project";
import { installMeshMaps, meshMapBaked } from "../../engine/paint/meshmaps";
import { bakeMap, encodePngAsync } from "../../engine/paint/paint-client";
import { PAINTER_MAPS } from "../../engine/paint/painter";
import type { PaintMesh } from "../../engine/paint/mesh";
import type { Dict } from "../../engine/gen/base";
import type { LibraryItem } from "../../engine/registry";
import { downloadBlob } from "../exporting";
import { fileName, host, projectPath, setProjectPath } from "../platform";
import { newProject } from "../../engine/loader";
import { setCurrentMesh } from "../../engine/paint/mesh";
import { BUILTIN_MESHES, geometryToPaintMesh, loadModelGeometry, normalizeGeometry } from "./meshes";
import { t } from "../i18n";
import { brushThumbnail } from "./brushPreview";

export const TOOLS = ["FreeDots", "FreeLine", "Line", "Stamp", "ColorPicker", "MaskSelector"] as const;
export const TOOL_LABELS = ["Free dots", "Free line", "Line", "Stamp", "Colour picker", "ID mask"];

class PaintState {
  /** the paint project of the current tab: paint projects are project tabs, next to material projects */
  get project(): PaintProject | null {
    return editor.data instanceof PaintProject ? editor.data : null;
  }
  /** the project whose brush the node editor shows and watches */
  private shown: PaintProject | null = null;
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
  /** the 3D preview environment lighting the paint view, and whether its sky is shown */
  environment = Number(localStorage.getItem("material-pro:paint-env") ?? 0) || 0;
  showSky = localStorage.getItem("material-pro:paint-sky") === "1";
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

  /** the mesh maps painting needs are being baked (in the paint worker) */
  baking = false;

  constructor() {
    // Mesh Map nodes baked in the background: draw what used them again
    meshMapBaked.add(() => {
      this.project?.brushChanged();
      editor.emit();
    });
    // switching tabs switches the paint workspace on or off and the brush graph shown
    editor.subscribe(() => this.sync());
    editor.addTabHooks({
      canClose: (d) => (d instanceof PaintProject ? !d.needSave || confirm(t("The paint project has unsaved changes. Close it anyway?")) : undefined),
      closed: (d) => {
        if (d instanceof PaintProject) d.dispose();
      },
    });
  }
  private sync() {
    const p = this.project;
    if (p === this.shown) return;
    this.unwatchBrush?.();
    this.unwatchBrush = null;
    this.shown = p;
    if (p) {
      // Mesh Map nodes in brushes bake from the painted model
      setCurrentMesh(p.mesh);
      this.watchBrush(p);
    }
    this.emit();
  }

  /** opens a paint project in a new tab (create_paint_project / do_load_painting) */
  private async open(project: PaintProject) {
    installMeshMaps({ background: true });
    // the editor composites asynchronously and bakes mesh maps in the paint worker: the page keeps running
    project.deferComposite = true;
    project.painter.backgroundMaps = true;
    project.painter.onMapsReady = () => {
      this.baking = false;
      // a procedural layer is filled once the maps are there
      project.brushChanged();
      project.update();
      this.setStatus("");
      this.emit();
    };
    if (!project.painter.ready()) {
      // the maps painting reads are baked (in the paint worker) before the tab opens; the page keeps running
      this.baking = true;
      this.setStatus(t("Baking mesh maps…"));
      try {
        await Promise.all(PAINTER_MAPS.map((n) => bakeMap(project.renderer, project.mesh, n, project.size)));
      } catch (e) {
        console.error("mesh map bake", e);
      }
      this.baking = false;
      this.setStatus("");
    }
    await this.loadBrushes();
    if (!project.brushGraph) project.setBrush(this.brushes.find((b) => b.tree_item === "Simple/Uniform") ?? this.brushes[0], false);
    project.onChange(() => {
      // a new brush graph (another brush picked): the node editor shows it
      if (this.project === project && project.brushGraph && project.brushGraph !== editor.root) this.showBrush();
      if (this.project === project) this.emit();
    });
    editor.openProject(project.brushGraph!, project.title, project);
  }

  /** the node editor shows the brush graph; its changes update the brush */
  private showBrush() {
    const p = this.project!;
    editor.setRoot(p.brushGraph!, p.title);
    this.unwatchBrush?.();
    this.watchBrush(p);
  }
  private watchBrush(p: PaintProject) {
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

  /** closes the paint project's tab */
  close() {
    if (!this.project) return;
    const i = editor.currentIndex;
    if (!editor.confirmClose(i, "")) return;
    editor.closeProject(i, () => newProject());
  }

  /** saves the paint project as one zip without stalling the page (layers read asynchronously, PNGs encoded in the
   * paint worker). The desktop app writes it back to its file once it has one (opened from a zip, or saved before)
   * and asks where the first time or for Save As; a browser downloads it. */
  async save(saveAs = false) {
    const p = this.project;
    if (!p) return;
    this.setStatus(t("Saving {0}…", p.title));
    try {
      const zip = await p.saveAsync(p.title, (tex) => encodePngAsync(p.renderer, tex));
      if (!host) {
        downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${p.title}.mmpp.zip`);
        this.setStatus("");
      } else {
        const path = await host.save(zip, `${p.title}.mmpp.zip`, saveAs ? null : projectPath(p));
        if (!path) {
          p.needSave = true; // cancelled: nothing was written
          this.setStatus("");
        } else {
          setProjectPath(p, path);
          p.title = fileName(path).replace(/(\.mmpp)?\.zip$/i, "");
          if (this.project === p) editor.setTabTitle(editor.currentIndex, p.title);
          this.setStatus(t("Saved {0}", path));
        }
      }
    } catch (e) {
      p.needSave = true;
      this.setStatus(t("Cannot save {0}: {1}", p.title, (e as Error).message ?? String(e)));
    }
    this.emit();
  }

  /** a saved project: a zip, or a .mmpp with its layer PNGs and model picked together */
  async load(files: { name: string; data: Uint8Array }[]): Promise<PaintProject> {
    const all = unpackFiles(files);
    const mmppName = [...all.keys()].find((k) => k.endsWith(".mmpp"));
    if (!mmppName) throw new Error("No .mmpp file");
    const data = JSON.parse(new TextDecoder().decode(all.get(mmppName)!));
    const modelBytes = data.model ? findFile(all, data.model) : null;
    const builtin = typeof data.builtin_mesh === "string" && !modelBytes ? BUILTIN_MESHES[data.builtin_mesh] : undefined;
    let mesh: PaintMesh;
    let model: ModelFile | null = null;
    if (builtin) mesh = geometryToPaintMesh(builtin(), data.builtin_mesh);
    else {
      if (!modelBytes) throw new Error(`The model ${data.model || ""} is not among the files`);
      const modelName = String(data.model).split(/[\\/]/).pop()!;
      mesh = geometryToPaintMesh(normalizeGeometry(await loadModelGeometry(modelName, modelBytes)), modelName);
      model = { name: modelName, data: modelBytes };
    }
    const p = new PaintProject(editor.renderer!, mesh, model);
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
    return p;
  }

  /** the current brush, as a user brush in the brush list (Tools > Add current brush to library) */
  async addBrushToLibrary(name: string) {
    const g = this.project?.brushGraph;
    if (!g) return;
    const item = { ...g.serialize(), tree_item: "User/" + name, display_name: name } as LibraryItem;
    // its icon is a dab of it, rendered (main_window.gd add_brush_to_library: get_brush_preview)
    try {
      item.icon_data = await brushThumbnail(editor.renderer!, item);
    } catch (e) {
      console.warn("brush preview", e);
    }
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

  setEnvironment(i: number, sky = this.showSky) {
    this.environment = i;
    this.showSky = sky;
    try {
      localStorage.setItem("material-pro:paint-env", String(i));
      localStorage.setItem("material-pro:paint-sky", sky ? "1" : "0");
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
