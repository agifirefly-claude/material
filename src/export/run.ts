/* Exports that run without the editor: a project graph, a renderer and a target in, file names and bytes out.
 * Used by the command line (src/cli/entry.ts); the same steps as the editor's File → Export. */
import { UNREAL_MM_PY, localizeUnrealScript, needsUnrealMm } from "./unrealMm";
import type { Renderer, Target } from "../engine/render/renderer";
import { encodeExr } from "./exr";
import type { GenGraph } from "../engine/gen/graph";
import { GenGraph as Graph } from "../engine/gen/graph";
import { GenExport, GenMaterial } from "../engine/gen/misc";
import { GenContext } from "../engine/context";
import { STANDARD_MAPS, findMaterial } from "../engine/materialMaps";
import { connectionsAndParametersContext, expressionShaderCode, exportProfiles, planExport, processConditionals, processShader } from "../engine/export";
import type { TextureRef } from "../engine/shader-code";
import type { Gen } from "../engine/gen/base";
import { cocosFiles, glbFile, type GltfShape } from "./engines";
import { buildM3eMaterial } from "./m3eMaterial";

export type Files = Record<string, Uint8Array>;

/** targets this port adds to the material's own export profiles */
export const EXTRA_TARGETS = ["cocos", "glb", "m3e", "maps"] as const;

/** an image as file bytes */
export function encodeImage(img: ImageData, format: "png" | "jpg" | "webp" = "png"): Promise<Uint8Array> {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext("2d")!.putImageData(img, 0, 0);
  const type = format === "jpg" ? "image/jpeg" : "image/" + format;
  return c.convertToBlob({ type, quality: 0.92 }).then(async (b) => new Uint8Array(await b.arrayBuffer()));
}

/** a rendered target as the file `name` asks for: OpenEXR for .exr (Material Maker's Image.save_exr, which the
 * Blender profile uses for its float maps), JPEG / WebP for those extensions, PNG otherwise */
export function encodeTarget(r: Renderer, t: Target, name: string): Promise<Uint8Array> {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "exr") return Promise.resolve(encodeExr(r.readPixels(t), t.size, t.height ?? t.size));
  return encodeImage(r.toImageData(t), ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "webp" ? "webp" : "png");
}

/** Godot's String.similarity (Sørensen–Dice on bigrams), which Material Maker's command line uses to pick a target */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const pa = pairs(a),
    pb = pairs(b);
  const rest = [...pb];
  let inter = 0;
  for (const p of pa) {
    const i = rest.indexOf(p);
    if (i >= 0) {
      inter++;
      rest.splice(i, 1);
    }
  }
  return (2 * inter) / (pa.length + pb.length);
}

/** every target a project's material can be exported to */
export function targetsOf(root: GenGraph): string[] {
  const m = findMaterial(root);
  return [...(m ? exportProfiles(m) : []), ...EXTRA_TARGETS];
}

/** the target asked for, or the closest of the material's profiles (case is ignored), as Material Maker does */
export function resolveTarget(root: GenGraph, wanted: string): { target: string; exact: boolean } | null {
  const all = targetsOf(root);
  const exact = all.find((t) => t === wanted) ?? all.find((t) => t.toLowerCase() === wanted.toLowerCase());
  if (exact) return { target: exact, exact: true };
  let best = "",
    score = 0;
  for (const t of all) {
    const s = similarity(t.toLowerCase(), wanted.toLowerCase());
    if (s > score) {
      score = s;
      best = t;
    }
  }
  return best ? { target: best, exact: false } : null;
}

function exportNodes(g: GenGraph, out: GenExport[] = []): GenExport[] {
  for (const c of g.children) {
    if (c instanceof GenExport) out.push(c);
    else if (c instanceof Graph) exportNodes(c, out);
  }
  return out;
}

/** the files of the project's Export nodes (gen_export.gd), added to `files` */
export async function exportNodeFiles(r: Renderer, root: GenGraph, project: string, files: Files): Promise<void> {
  for (const e of exportNodes(root)) {
    const src = e.getSource(0);
    if (!src) continue;
    const sc = src.generator.getShaderCode("uv", src.outputIndex, new GenContext());
    if (!sc.outputType) continue;
    const t = r.render(sc, e.imageSize);
    const name = e.fileName(project, (x) => x in files);
    files[name] = await encodeTarget(r, t, name);
    r.deleteTarget(t);
  }
}

/** one of the material's own export profiles (gen_material.gd export_material) */
export async function runProfile(r: Renderer, m: GenMaterial, profile: string, prefix: string, size: number): Promise<Files> {
  const files: Files = {};
  let buffers: ReturnType<typeof processShader> | null = null;
  const plan = planExport(m, profile, prefix);
  for (const f of plan) {
    // Material Maker copies a template named "clipboard" to the clipboard rather than writing it (Unreal 5 profile)
    if (f.kind === "text" && f.name === "clipboard") continue;
    if (f.kind === "text") files[f.name] = new TextEncoder().encode(localizeUnrealScript(f.text));
    else if (f.kind === "texture") {
      const sc = f.output !== null ? m.getShaderCode("uv", f.output, new GenContext()) : expressionShaderCode(m, f.expression!);
      const t = r.render(sc, size);
      files[f.name] = await encodeTarget(r, t, f.name);
      r.deleteTarget(t);
    } else {
      buffers ??= processShader(m, processConditionals(String(m.shaderModel.preview_shader ?? ""), connectionsAndParametersContext(m)));
      const u = buffers.shaderCode.uniforms.find((x) => x.name === f.uniform);
      const t = u && r.textureFor(u.value as TextureRef);
      if (t) files[f.name] = await encodeTarget(r, t, f.name);
    }
  }
  // the Unreal 5 script imports the helper module mm.py from its own folder
  if (needsUnrealMm(plan) && !("mm.py" in files)) files["mm.py"] = new TextEncoder().encode(UNREAL_MM_PY);
  return files;
}

/** every map of the standard material as PNG files */
export async function runMaps(r: Renderer, m: GenMaterial, prefix: string, size: number): Promise<Files> {
  const files: Files = {};
  const outs = m.getOutputDefs(true).length;
  if (outs < 6) throw new Error(`“${m.getTypeName()}” has no texture maps`);
  for (const map of STANDARD_MAPS) {
    if (map.output >= outs) continue;
    const sc = m.getShaderCode("uv", map.output, new GenContext());
    if (!sc.outputType) continue;
    const t = r.render(sc, size);
    files[`${prefix}_${map.key}.png`] = await encodeImage(r.toImageData(t));
    r.deleteTarget(t);
  }
  return files;
}

export interface ExportOptions {
  target: string;
  size?: number;
  /** the file name prefix, Material Maker's output file (already expanded) */
  prefix: string;
  /** the material name for formats that keep one (m3e) */
  name?: string;
  glbShape?: GltfShape;
  /** m3e options */
  m3e?: { tile?: number; resolution?: number; azimuth?: number; elevation?: number; raw?: boolean; format?: "webp" | "png"; project?: string };
  /** also write the project's Export nodes (Material Maker's command line does) */
  exportNodes?: boolean;
}

/** a whole export: the files it writes, by path relative to the output directory */
export async function runExport(r: Renderer, root: GenGraph, o: ExportOptions): Promise<{ files: Files; target: string }> {
  const m = findMaterial(root);
  if (!m) throw new Error("This project has no material node");
  const size = o.size ?? m.imageSize;
  let files: Files;
  switch (o.target) {
    case "maps":
      files = await runMaps(r, m, o.prefix, size);
      break;
    case "cocos":
      files = await cocosFiles(r, m, o.prefix, size);
      break;
    case "glb":
      files = { [`${o.prefix}.glb`]: await glbFile(r, m, o.prefix, size, o.glbShape ?? "plane") };
      break;
    case "m3e": {
      const x = o.m3e ?? {};
      const file = await buildM3eMaterial(r, m, {
        name: o.name ?? o.prefix,
        tile: x.tile ?? 160,
        resolution: x.resolution ?? Math.min(size, 512),
        light: { azimuth: x.azimuth ?? 315, elevation: x.elevation ?? 45 },
        rawMaps: x.raw ?? true,
        format: x.format ?? "webp",
        project: x.project,
      });
      files = { [`${o.prefix}.m3e-material.json`]: new TextEncoder().encode(JSON.stringify(file)) };
      break;
    }
    default:
      files = await runProfile(r, m, o.target, o.prefix, size);
  }
  if (o.exportNodes !== false && o.target !== "glb" && o.target !== "m3e") await exportNodeFiles(r, root, o.prefix, files);
  return { files, target: o.target };
}

/** a node by its path in the graph ("graph/subgraph/node"), or by its name anywhere when the name is unique */
export function findNode(root: GenGraph, path: string): Gen | null {
  const parts = path.split("/").filter(Boolean);
  let g: Gen | undefined = root;
  for (const p of parts) g = g instanceof Graph ? g.getNode(p) : undefined;
  if (g && g !== root) return g;
  const found: Gen[] = [];
  const walk = (x: GenGraph) => {
    for (const c of x.children) {
      if (c.name === path) found.push(c);
      if (c instanceof Graph) walk(c);
    }
  };
  walk(root);
  return found.length === 1 ? found[0] : null;
}

/** one output of one node as an image */
export async function runRender(r: Renderer, root: GenGraph, node: string, output: number, size: number, format: "png" | "jpg" | "webp"): Promise<Uint8Array> {
  const g = findNode(root, node);
  if (!g) throw new Error(`No node “${node}” (use its path, e.g. graph_2/blend_1)`);
  const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
  if (output < 0 || output >= outs.length) throw new Error(`“${node}” has ${outs.length} output(s); output ${output} does not exist`);
  const sc = g.getShaderCode("uv", output, new GenContext());
  if (!sc.outputType) throw new Error(`Output ${output} of “${node}” generates nothing`);
  const t = r.render(sc, size);
  const bytes = await encodeImage(r.toImageData(t), format);
  r.deleteTarget(t);
  return bytes;
}
