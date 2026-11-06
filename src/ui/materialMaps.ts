/* The texture maps of the project's material node, rendered for the 3D preview and for export. */
import { GenContext } from "../engine/context";
import { GenMaterial } from "../engine/gen/misc";
import type { Renderer, Target } from "../engine/render/renderer";
import type { GenGraph } from "../engine/gen/graph";

export function findMaterial(root: GenGraph): GenMaterial | undefined {
  return root.children.find((c) => c instanceof GenMaterial) as GenMaterial | undefined;
}

/** The maps of Material Maker's standard material (material.mmg outputs) */
export const STANDARD_MAPS = [
  { key: "albedo", output: 0, label: "Albedo (RGB) + opacity (A)", srgb: true },
  { key: "orm", output: 1, label: "ORM: occlusion, roughness, metallic", srgb: false },
  { key: "emission", output: 2, label: "Emission", srgb: true },
  { key: "normal", output: 3, label: "Normal (OpenGL)", srgb: false },
  { key: "depth", output: 4, label: "Depth", srgb: false },
  { key: "sss", output: 5, label: "Subsurface scattering", srgb: false },
  { key: "normal_dx", output: 7, label: "Normal (DirectX)", srgb: false },
  { key: "height", output: 8, label: "Height", srgb: false },
  { key: "ao", output: 9, label: "Ambient occlusion", srgb: false },
  { key: "metallic", output: 12, label: "Metallic", srgb: false },
  { key: "roughness", output: 13, label: "Roughness", srgb: false },
] as const;

export function hasStandardMaps(m: GenMaterial): boolean {
  return m.getOutputDefs(true).length >= 6;
}

/** renders one material output; `key` lets unchanged maps be reused */
export function renderMap(r: Renderer, m: GenMaterial, output: number, size: number, key?: string): Target | null {
  const sc = m.getShaderCode("uv", output, new GenContext());
  if (!sc.outputType) return null;
  if (key) return r.renderKeyed(key, sc, size).target;
  return r.render(sc, size);
}
