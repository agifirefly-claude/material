/* Files: saving and opening projects (.ptex, Material Maker's format), exporting images and material maps. */
import JSON5 from "json5";
import { zipSync } from "fflate";
import { editor } from "./store";
import { STANDARD_MAPS, findMaterial, hasStandardMaps, renderMap } from "./materialMaps";
import { GenContext } from "../engine/context";
import type { Dict } from "../engine/gen/base";
import { GenGraph } from "../engine/gen/graph";
import { GenExport } from "../engine/gen/misc";
import { expressionShaderCode, planExport, processShader, processConditionals, connectionsAndParametersContext } from "../engine/export";
import type { TextureRef } from "../engine/shader-code";
import { t } from "./i18n";
import type { Renderer, Target } from "../engine/render/renderer";
import { encodeExr } from "./preview2d/exr";
import { UNREAL_MM_PY, localizeUnrealScript, needsUnrealMm } from "../export/unrealMm";

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** an image as png, jpg or webp */
export function imageDataToBlob(img: ImageData, format: "png" | "jpg" | "webp" = "png"): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  const type = format === "jpg" ? "image/jpeg" : "image/" + format;
  return new Promise((res) => c.toBlob((b) => res(b!), type, 0.92));
}

/** every Export node of a project, subgraphs included */
export function exportNodes(g: GenGraph = editor.root, out: GenExport[] = []): GenExport[] {
  for (const c of g.children) {
    if (c instanceof GenExport) out.push(c);
    else if (c instanceof GenGraph) exportNodes(c, out);
  }
  return out;
}

/** the files of the project's Export nodes, written with the material (gen_export.gd export_material) */
export async function addExportNodeFiles(files: Record<string, Uint8Array>, project: string): Promise<number> {
  const r = editor.renderer!;
  let n = 0;
  for (const e of exportNodes()) {
    const src = e.getSource(0);
    if (!src) continue;
    try {
      const sc = src.generator.getShaderCode("uv", src.outputIndex, new GenContext());
      if (!sc.outputType) continue;
      const tgt = r.render(sc, e.imageSize);
      const name = e.fileName(project, (x) => x in files);
      files[name] = new Uint8Array(await (await imageDataToBlob(r.toImageData(tgt), e.format)).arrayBuffer());
      r.deleteTarget(tgt);
      n++;
    } catch (err) {
      console.error("export node", e.name, err);
    }
  }
  return n;
}

/** the image format a file name asks for (export profiles write .png and .exr maps) */
export function imageFormatOf(name: string): "png" | "jpg" | "webp" | "exr" {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return ext === "exr" ? "exr" : ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "webp" ? "webp" : "png";
}

/** a render target encoded in the format its file name asks for: float pixels for .exr, 8 bits otherwise */
export async function encodeTarget(r: Renderer, tgt: Target, name: string): Promise<Uint8Array> {
  const f = imageFormatOf(name);
  if (f === "exr") return encodeExr(r.readPixels(tgt), tgt.size, tgt.height ?? tgt.size);
  return new Uint8Array(await (await imageDataToBlob(r.toImageData(tgt), f)).arrayBuffer());
}

export function imageDataToPng(img: ImageData): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

const PROCESS = ["code", "custom", "global", "instance", "preview_shader", "template"];
const WALK = ["shader_model", "nodes", "template", "files"];
/** MMLoader.replace_multiline_strings_with_arrays: how Material Maker writes code in its files */
function splitLines(data: unknown, walkChildren = false): unknown {
  if (Array.isArray(data)) return data.map((d) => splitLines(d));
  if (data && typeof data === "object") {
    const out: Dict = {};
    for (const [k, v] of Object.entries(data as Dict)) {
      if (PROCESS.includes(k) && typeof v === "string") out[k] = v.includes("\n") ? v.replaceAll("    ", "\t").split("\n") : v;
      else if (walkChildren || WALK.includes(k)) out[k] = splitLines(v);
      else if (k === "exports") out[k] = splitLines(v, true);
      else out[k] = v;
    }
    return out;
  }
  return data;
}
const PROCESS_JOIN = (data: unknown, walkChildren = false): unknown => {
  if (Array.isArray(data)) return data.map((d) => PROCESS_JOIN(d));
  if (data && typeof data === "object") {
    const out: Dict = {};
    for (const [k, v] of Object.entries(data as Dict)) {
      if (PROCESS.includes(k) && Array.isArray(v)) out[k] = v.join("\n");
      else if (walkChildren || WALK.includes(k)) out[k] = PROCESS_JOIN(v);
      else if (k === "exports") out[k] = PROCESS_JOIN(v, true);
      else out[k] = v;
    }
    return out;
  }
  return data;
};

export function projectText(): string {
  const data = editor.root.serialize();
  data.name = editor.title;
  data.node_position = { x: 0, y: 0 };
  return JSON.stringify(splitLines(data), null, "\t");
}

export function saveProject() {
  editor.snapshot();
  downloadBlob(new Blob([projectText()], { type: "application/json" }), `${editor.title || "material"}.ptex`);
  try {
    localStorage.setItem("material-pro:autosave", JSON.stringify({ title: editor.title, text: projectText() }));
  } catch {
    /* storage full or blocked */
  }
}

export function parseProject(text: string): Dict {
  return PROCESS_JOIN(JSON5.parse(text)) as Dict;
}

export function openProjectFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ptex,.json,.mmg";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = parseProject(await f.text());
      if (data.nodes) editor.open(data, f.name.replace(/\.(ptex|json|mmg)$/, ""));
      else editor.setStatus(t("This file is not a Material Maker project"));
    } catch (e) {
      editor.setStatus(t("Cannot open: {0}", e));
    }
  };
  input.click();
}

export async function openExample(name: string) {
  const data = await fetch(`data/examples/${name}.json`).then((r) => r.json());
  editor.open(data, name);
}

/** every texture map of the material, in one zip */
export async function exportMaterialMaps(size?: number) {
  const r = editor.renderer!;
  const m = findMaterial(editor.root);
  if (!m) return editor.setStatus(t("No material node to export"));
  if (!hasStandardMaps(m)) return editor.setStatus(t("“{0}” has no texture maps to export", m.getTypeName()));
  const s = size ?? m.imageSize;
  editor.setStatus(t("Exporting {0} maps at {1}×{2}…", STANDARD_MAPS.length, s, s));
  await new Promise((res) => setTimeout(res, 30));
  const files: Record<string, Uint8Array> = {};
  for (const map of STANDARD_MAPS) {
    if (map.output >= m.getOutputDefs(true).length) continue;
    const t = renderMap(r, m, map.output, s);
    if (!t) continue;
    const png = await imageDataToPng(r.toImageData(t));
    r.deleteTarget(t);
    files[`${editor.title}_${map.key}.png`] = new Uint8Array(await png.arrayBuffer());
  }
  files[`${editor.title}.ptex`] = new TextEncoder().encode(projectText());
  await addExportNodeFiles(files, editor.title);
  downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `${editor.title}_maps.zip`);
  editor.setStatus(t("Exported {0} maps", Object.keys(files).length - 1));
}

/** runs one of the material's export profiles (Godot, Unity, Unreal, Blender, glTF…) and downloads the files as a zip */
export async function exportForEngine(profile: string, size?: number) {
  const r = editor.renderer!;
  const m = findMaterial(editor.root);
  if (!m) return editor.setStatus(t("No material node to export"));
  const s = size ?? m.imageSize;
  const prefix = editor.title || "material";
  const plan = planExport(m, profile, prefix);
  editor.setStatus(t("Exporting {0} files for {1}…", plan.length, profile));
  await new Promise((res) => setTimeout(res, 30));
  const files: Record<string, Uint8Array> = {};
  let buffersCode: ReturnType<typeof processShader> | null = null;
  for (const f of plan) {
    try {
      // a profile's "clipboard" file is text to paste in the engine (gen_material.gd export_material), not a file
      if (f.kind === "text" && f.name === "clipboard") navigator.clipboard?.writeText(f.text.split("\n").filter(Boolean).join("\n")).catch(() => {});
      else if (f.kind === "text") files[f.name] = new TextEncoder().encode(localizeUnrealScript(f.text));
      else if (f.kind === "texture") {
        const sc = f.output !== null ? m.getShaderCode("uv", f.output, new GenContext()) : expressionShaderCode(m, f.expression!);
        const t = r.render(sc, s);
        files[f.name] = await encodeTarget(r, t, f.name);
        r.deleteTarget(t);
      } else if (f.kind === "buffer") {
        buffersCode ??= processShader(m, processConditionals(String(m.shaderModel.preview_shader ?? ""), connectionsAndParametersContext(m)));
        const u = buffersCode.shaderCode.uniforms.find((x) => x.name === f.uniform);
        const t = u && r.textureFor(u.value as TextureRef);
        if (t) files[f.name] = await encodeTarget(r, t, f.name);
      }
    } catch (e) {
      console.error("export", f.name, e);
    }
  }
  // the Unreal 5 script imports the helper module mm.py from its own folder
  if (needsUnrealMm(plan) && !("mm.py" in files)) files["mm.py"] = new TextEncoder().encode(UNREAL_MM_PY);
  await addExportNodeFiles(files, prefix);
  downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `${prefix}_${profile.replaceAll("/", "_").replaceAll(" ", "_")}.zip`);
  editor.setStatus(t("Exported {0} files for {1}", Object.keys(files).length, profile));
}
