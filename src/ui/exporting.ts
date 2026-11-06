/* Files: saving and opening projects (.ptex, Material Maker's format), exporting images and material maps. */
import JSON5 from "json5";
import { zipSync } from "fflate";
import { editor } from "./store";
import { STANDARD_MAPS, findMaterial, hasStandardMaps, renderMap } from "./materialMaps";
import { GenContext } from "../engine/context";
import type { Dict } from "../engine/gen/base";
import { expressionShaderCode, planExport, processShader, processConditionals, connectionsAndParametersContext } from "../engine/export";
import type { TextureRef } from "../engine/shader-code";

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
      if (data.nodes) editor.load(data, f.name.replace(/\.(ptex|json|mmg)$/, ""));
      else editor.setStatus("This file is not a Material Maker project");
    } catch (e) {
      editor.setStatus("Cannot open: " + e);
    }
  };
  input.click();
}

export async function openExample(name: string) {
  const data = await fetch(`data/examples/${name}.json`).then((r) => r.json());
  editor.load(data, name);
}

/** every texture map of the material, in one zip */
export async function exportMaterialMaps(size?: number) {
  const r = editor.renderer!;
  const m = findMaterial(editor.root);
  if (!m) return editor.setStatus("No material node to export");
  if (!hasStandardMaps(m)) return editor.setStatus(`“${m.getTypeName()}” has no texture maps to export`);
  const s = size ?? m.imageSize;
  editor.setStatus(`Exporting ${STANDARD_MAPS.length} maps at ${s}×${s}…`);
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
  downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `${editor.title}_maps.zip`);
  editor.setStatus(`Exported ${Object.keys(files).length - 1} maps`);
}

/** runs one of the material's export profiles (Godot, Unity, Unreal, Blender, glTF…) and downloads the files as a zip */
export async function exportForEngine(profile: string, size?: number) {
  const r = editor.renderer!;
  const m = findMaterial(editor.root);
  if (!m) return editor.setStatus("No material node to export");
  const s = size ?? m.imageSize;
  const prefix = editor.title || "material";
  const plan = planExport(m, profile, prefix);
  editor.setStatus(`Exporting ${plan.length} files for ${profile}…`);
  await new Promise((res) => setTimeout(res, 30));
  const files: Record<string, Uint8Array> = {};
  let buffersCode: ReturnType<typeof processShader> | null = null;
  for (const f of plan) {
    try {
      if (f.kind === "text") files[f.name] = new TextEncoder().encode(f.text);
      else if (f.kind === "texture") {
        const sc = f.output !== null ? m.getShaderCode("uv", f.output, new GenContext()) : expressionShaderCode(m, f.expression!);
        const t = r.render(sc, s);
        files[f.name] = new Uint8Array(await (await imageDataToPng(r.toImageData(t))).arrayBuffer());
        r.deleteTarget(t);
      } else if (f.kind === "buffer") {
        buffersCode ??= processShader(m, processConditionals(String(m.shaderModel.preview_shader ?? ""), connectionsAndParametersContext(m)));
        const u = buffersCode.shaderCode.uniforms.find((x) => x.name === f.uniform);
        const t = u && r.textureFor(u.value as TextureRef);
        if (t) files[f.name] = new Uint8Array(await (await imageDataToPng(r.toImageData(t))).arrayBuffer());
      }
    } catch (e) {
      console.error("export", f.name, e);
    }
  }
  downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: "application/zip" }), `${prefix}_${profile.replaceAll("/", "_").replaceAll(" ", "_")}.zip`);
  editor.setStatus(`Exported ${Object.keys(files).length} files for ${profile}`);
}
