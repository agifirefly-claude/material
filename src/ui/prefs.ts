/* Preferences (Material Maker's windows/preferences), kept in the browser. */
import { useSyncExternalStore } from "react";
import { BAKE_SETTINGS } from "../engine/paint/mapgen";
import { MESH_MAP_SIZE } from "../engine/paint/meshmaps";

export interface Prefs {
  /** UI scale in percent; 0 follows the browser */
  uiScale: number;
  /** exponent of the size new material nodes get */
  defaultMaterialSize: number;
  /** resolution of the node thumbnails */
  nodePreviewSize: number;
  confirmCloseProject: boolean;
  dimBackground: boolean;
  /** Material Maker's auto_size_comment: a new comment frames the selection */
  autoSizeComment: boolean;
  /** Material Maker's node_minimize_button / node_close_button */
  nodeMinimizeButton: boolean;
  nodeCloseButton: boolean;
  /** Material Maker's aperture_label_position */
  portalLabelSide: boolean;
  autosave: boolean;
  /** resolution of the 3D preview's maps */
  preview3dResolution: number;
  /** Material Maker's ui_3d_preview_tesselation_detail: subdivisions of tessellated preview objects */
  tessellationDetail: number;
  /** Material Maker's confirm_quit: ask before leaving the page with unsaved changes */
  confirmQuit: boolean;
  /** Material Maker's fps_limit: frames per second of the 3D preview (0: the display's rate) */
  fpsLimit: number;
  /** Material Maker's remember_anim_export */
  rememberAnimExport: boolean;
  /** Material Maker's custom theme: base colour, accent colour and contrast ("" keeps the default theme) */
  themeBase: string;
  themeAccent: string;
  themeContrast: number;
  /** Material Maker's bake_ray_count, bake_ao_ray_dist, bake_ao_ray_bias, bake_denoise_radius, and the mesh map size */
  bakeRayCount: number;
  bakeAoRayDist: number;
  bakeAoRayBias: number;
  bakeDenoiseRadius: number;
  /** exponent: Mesh Map nodes bake at 2^n */
  meshMapSize: number;
  /** panel layout */
  layout: Layout;
  /** saved panel layouts (panels_presets_dialog) */
  layoutPresets: Record<string, Layout>;
}

export interface Layout {
  left: number;
  right: number;
  showLibrary: boolean;
  showRight: boolean;
  previewHeight: number;
  /** the docked panels' arrangement (flexible_layout), made from the fields above when missing */
  dock?: DockLayout;
}

/** A dock tree: splits of tab groups, with the graph (the centre) somewhere in it */
export type DockPanel = "library" | "hierarchy" | "preview3d" | "preview2d" | "reference" | "inspector";
export type DockNode = { type: "split"; dir: "row" | "column"; children: DockNode[]; sizes: number[] } | { type: "tabs"; panels: DockPanel[]; active: number } | { type: "center" };
export interface DockLayout {
  root: DockNode;
  /** panels closed from their tab */
  hidden: DockPanel[];
  /** the legacy fields it was made from, so changing them in the layout dialog rebuilds it */
  from: string;
}

export const DEFAULT_LAYOUT: Layout = { left: 250, right: 380, showLibrary: true, showRight: true, previewHeight: 42 };

export const DEFAULT_PREFS: Prefs = {
  uiScale: 0,
  defaultMaterialSize: 10,
  nodePreviewSize: 128,
  confirmCloseProject: true,
  dimBackground: true,
  autoSizeComment: true,
  nodeMinimizeButton: true,
  nodeCloseButton: false,
  portalLabelSide: false,
  autosave: true,
  preview3dResolution: 512,
  tessellationDetail: 4,
  confirmQuit: true,
  fpsLimit: 0,
  rememberAnimExport: true,
  bakeRayCount: 64,
  bakeAoRayDist: 128,
  bakeAoRayBias: 0.005,
  bakeDenoiseRadius: 3,
  meshMapSize: 11,
  themeBase: "",
  themeAccent: "",
  themeContrast: 1,
  layout: DEFAULT_LAYOUT,
  layoutPresets: {},
};

const KEY = "material-pro:prefs";
let prefs: Prefs = load();
const listeners = new Set<() => void>();

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULT_PREFS, ...v, layout: { ...DEFAULT_LAYOUT, ...(v.layout ?? {}) } };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked */
  }
  applyPrefs();
  for (const l of listeners) l();
}

export function applyPrefs(): void {
  BAKE_SETTINGS.ray_count = prefs.bakeRayCount;
  BAKE_SETTINGS.ao_ray_dist = prefs.bakeAoRayDist;
  BAKE_SETTINGS.ao_ray_bias = prefs.bakeAoRayBias;
  BAKE_SETTINGS.denoise_radius = prefs.bakeDenoiseRadius;
  MESH_MAP_SIZE.value = 2 ** prefs.meshMapSize;
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.zoom = prefs.uiScale ? String(prefs.uiScale / 100) : "";
  // the custom theme (Material Maker's enhanced theme system): panels shaded from the base colour, contrast between them
  const vars = ["--bg", "--bg2", "--bg3", "--bg4", "--line", "--node", "--node-head", "--accent", "--accent2"];
  for (const v of vars) root.style.removeProperty(v);
  if (/^#[0-9a-f]{6}$/i.test(prefs.themeBase)) {
    const k = prefs.themeContrast;
    const shades: [string, number][] = [
      ["--bg", 0],
      ["--bg2", 0.035],
      ["--bg3", 0.07],
      ["--bg4", 0.11],
      ["--line", 0.12],
      ["--node", 0.05],
      ["--node-head", 0.1],
    ];
    for (const [v, d] of shades) root.style.setProperty(v, shade(prefs.themeBase, d * k));
  }
  if (/^#[0-9a-f]{6}$/i.test(prefs.themeAccent)) {
    root.style.setProperty("--accent", prefs.themeAccent);
    root.style.setProperty("--accent2", shade(prefs.themeAccent, -0.18));
  }
}

/** a colour lightened (d > 0) or darkened (d < 0) */
function shade(hex: string, d: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = c.map((x) => Math.round(Math.min(255, Math.max(0, d >= 0 ? x + (255 - x) * d : x * (1 + d)))));
  return "#" + out.map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
