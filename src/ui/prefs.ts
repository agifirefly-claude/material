/* Preferences (Material Maker's windows/preferences), kept in the browser. */
import { useSyncExternalStore } from "react";

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
  if (typeof document === "undefined") return;
  document.documentElement.style.zoom = prefs.uiScale ? String(prefs.uiScale / 100) : "";
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
