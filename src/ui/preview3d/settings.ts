/* The 3D preview's settings, kept in the browser like Material Maker keeps them in its config file
 * (3D_preview_model, 3D_preview_objects/<object>_uv_scale, ui_3d_preview_environment, the post process settings...). */
import { useSyncExternalStore } from "react";
import { PREVIEW_OBJECTS } from "./objects";

export interface ObjectSettings {
  uvScale: [number, number];
  tessellated: boolean;
  params: Record<string, number>;
}
export interface PostProcess {
  tonemap: "linear" | "reinhard" | "filmic" | "aces" | "agx";
  exposure: number;
  glow: boolean;
  glowIntensity: number;
  glowStrength: number;
  glowThreshold: number;
  adjust: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  /** Godot's tonemap_white (Reinhard, Filmic, ACES), tonemap_agx_white and tonemap_agx_contrast */
  tonemapWhite: number;
  agxWhite: number;
  agxContrast: number;
  dof: boolean;
  /** Godot's dof_blur_far/near_enabled, _distance, _transition and dof_blur_amount */
  dofFar: boolean;
  dofNear: boolean;
  dofFarDistance: number;
  dofFarTransition: number;
  dofNearDistance: number;
  dofNearTransition: number;
  dofAmount: number;
}
export interface Preview3DSettings {
  object: string;
  objects: Record<string, ObjectSettings>;
  /** index in the environment list */
  environment: number;
  clearBackground: boolean;
  /** 0 paused, 1 slow, 2 medium, 3 fast */
  rotationSpeed: number;
  sunShadow: boolean;
  fov: number;
  post: PostProcess;
}

const KEY = "material-pro:preview3d";
export const DEFAULT_POST: PostProcess = {
  tonemap: "aces",
  exposure: 1,
  glow: false,
  glowIntensity: 0.8,
  glowStrength: 1,
  glowThreshold: 0.9,
  adjust: false,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  tonemapWhite: 1,
  agxWhite: 16.29,
  agxContrast: 1.25,
  dof: false,
  dofFar: true,
  dofNear: false,
  dofFarDistance: 10,
  dofFarTransition: 5,
  dofNearDistance: 2,
  dofNearTransition: 1,
  dofAmount: 0.1,
};
export function defaultObjectSettings(key: string): ObjectSettings {
  const o = PREVIEW_OBJECTS.find((x) => x.key === key)!;
  return { uvScale: [...o.uvScale], tessellated: false, params: Object.fromEntries(o.params.map((p) => [p.name, p.default])) };
}
function defaults(): Preview3DSettings {
  return { object: "sphere", objects: {}, environment: 0, clearBackground: false, rotationSpeed: 0, sunShadow: false, fov: 35, post: { ...DEFAULT_POST } };
}

let current: Preview3DSettings = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (s) return { ...defaults(), ...s, post: { ...DEFAULT_POST, ...(s.post ?? {}) } };
  } catch {
    /* blocked storage */
  }
  return defaults();
})();
const listeners = new Set<() => void>();

export function getSettings(): Preview3DSettings {
  return current;
}
export function objectSettings(key: string): ObjectSettings {
  return { ...defaultObjectSettings(key), ...(current.objects[key] ?? {}) };
}
export function updateSettings(patch: Partial<Preview3DSettings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* blocked storage */
  }
  for (const l of listeners) l();
}
export function updateObject(key: string, patch: Partial<ObjectSettings>): void {
  updateSettings({ objects: { ...current.objects, [key]: { ...objectSettings(key), ...patch } } });
}
export function updatePost(patch: Partial<PostProcess>): void {
  updateSettings({ post: { ...current.post, ...patch } });
}
export function usePreview3DSettings(): Preview3DSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
