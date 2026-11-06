/* The texture maps of the project's material node, rendered for the 3D preview and for export. */
import { GenContext } from "./context";
import { GenMaterial } from "./gen/misc";
import type { Renderer, Target } from "./render/renderer";
import type { GenGraph } from "./gen/graph";
import { expressionShaderCode } from "./export";
import type { ShaderCode } from "./shader-code";

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

export type PreviewMaps = { unlit: boolean; maps: Record<"albedo" | "orm" | "emission" | "normal" | "depth", () => ShaderCode | null> };

/** How the 3D view shows a material type: the static ones by their outputs, the dynamic ones by baking their inputs
 *  with the same expressions the static material's outputs use. null: this type cannot be previewed in 3D. */
export function previewMaps(m: GenMaterial): PreviewMaps | null {
  const out = (i: number) => () => m.getShaderCode("uv", i, new GenContext());
  const expr = (type: string, code: string) => () => expressionShaderCode(m, { type, code });
  const inputs = new Set(m.getInputDefs().map((d) => d.name));
  if (hasStandardMaps(m)) return { unlit: false, maps: { albedo: out(0), orm: out(1), emission: out(2), normal: out(3), depth: out(4) } };
  if (inputs.has("albedo_tex") && inputs.has("normal_tex")) {
    const opacity = inputs.has("opacity_tex") ? "$opacity_tex($uv)" : "1.0";
    return {
      unlit: false,
      maps: {
        albedo: expr("rgba", `vec4($albedo_tex($uv), ${opacity})`),
        orm: expr("rgb", "vec3($ao_tex($uv), $roughness_tex($uv), $metallic_tex($uv))"),
        emission: expr("rgb", "$emission_tex($uv)"),
        normal: expr("rgb", "$normal_tex($uv)*vec3(-1.0, 1.0, -1.0)+vec3(1.0, 0.0, 1.0)"),
        depth: inputs.has("depth_tex") ? expr("f", "clamp($depth_tex($uv), 0.0, 1.0)") : () => null,
      },
    };
  }
  if (inputs.has("color_tex")) return { unlit: true, maps: { albedo: expr("rgba", "$color_tex($uv)"), orm: () => null, emission: () => null, normal: () => null, depth: () => null } };
  return null;
}
