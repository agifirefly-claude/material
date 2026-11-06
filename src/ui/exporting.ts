/* Files: saving and opening projects (.ptex, Material Maker's format), exporting images and material maps. */
import { zip } from "fflate";

/** a zip of the files, built off the main thread (fflate's workers): a big export's maps are hundreds of MB */
export function zipFiles(files: Record<string, Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((res, rej) => zip(files, { level: 0 }, (e, d) => (e ? rej(e) : res(d as Uint8Array<ArrayBuffer>))));
}
import { editor } from "./store";
import { STANDARD_MAPS, findMaterial, hasStandardMaps } from "../engine/materialMaps";
import { GenContext } from "../engine/context";
import type { Dict } from "../engine/gen/base";
import { GenGraph } from "../engine/gen/graph";
import { GenExport } from "../engine/gen/misc";
import { expressionShaderCode, planExport, processShader, processConditionals, connectionsAndParametersContext } from "../engine/export";
import type { TextureRef } from "../engine/shader-code";
import { t } from "./i18n";
import { parseProject, serializeProject } from "../engine/ptex";
import { RenderFailure } from "../engine/render/service";
import { fileName, host, projectPath, setProjectPath } from "./platform";
import type { Renderer, Target } from "../engine/render/renderer";
import { encodeExr } from "./preview2d/exr";
import { UNREAL_MM_PY, localizeUnrealScript, needsUnrealMm } from "../export/unrealMm";

export function downloadBlob(blob: Blob, name: string) {
  // the desktop app: a save dialog and a real file instead of a download
  if (host) {
    const h = host;
    blob
      .arrayBuffer()
      .then((b) => h.save(new Uint8Array(b), name))
      .then((p) => p && editor.setStatus(t("Saved {0}", p)))
      .catch((e) => editor.setStatus(t("Cannot save {0}: {1}", name, String(e))));
    return;
  }
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
export async function addExportNodeFiles(files: Record<string, Uint8Array>, project: string, signal?: AbortSignal): Promise<number> {
  const r = editor.renders!;
  let n = 0;
  for (const e of exportNodes()) {
    const src = e.getSource(0);
    if (!src) continue;
    try {
      const sc = src.generator.getShaderCode("uv", src.outputIndex, new GenContext());
      if (!sc.outputType) continue;
      const img = await r.image(sc, e.imageSize, { signal });
      const name = e.fileName(project, (x) => x in files);
      files[name] = new Uint8Array(await (await imageDataToBlob(img, e.format)).arrayBuffer());
      n++;
    } catch (err) {
      if (err instanceof RenderFailure && err.kind === "cancelled") throw err;
      console.error("export node", e.name, err);
    }
  }
  return n;
}

/* ---------- exports in the background ---------- */
let running: AbortController | null = null;

/** stops the export that is rendering, if any */
export function cancelExport(): boolean {
  if (!running) return false;
  running.abort();
  return true;
}
if (typeof window !== "undefined")
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && running) cancelExport();
  });

/** runs an export with its progress in the status bar; Esc cancels it. Renders happen in the render worker, so the
 *  editor stays usable meanwhile. The project's pictures are loaded first (Material Maker #758, #729). */
export async function runExport<T>(label: string, work: (signal: AbortSignal, progress: (f: number) => void) => Promise<T>): Promise<T | undefined> {
  cancelExport();
  const ac = new AbortController();
  running = ac;
  const progress = (f: number) => editor.setStatus(t("{0} {1}% (Esc to cancel)", label, Math.round(f * 100)));
  progress(0);
  try {
    await editor.renders?.imagesLoaded(editor.root);
    return await work(ac.signal, progress);
  } catch (e) {
    if (e instanceof RenderFailure && e.kind === "cancelled") editor.setStatus(t("Export cancelled"));
    else editor.setStatus(t("Export failed: {0}", e instanceof Error ? e.message : String(e)));
    return undefined;
  } finally {
    if (running === ac) running = null;
  }
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

export function projectText(): string {
  return serializeProject(editor.root, editor.title);
}

export function saveProject(saveAs = false) {
  editor.snapshot();
  if (host) {
    // the desktop app saves in place once the project has a file, and asks where the first time (or for Save As)
    const root = editor.root;
    const text = projectText();
    host
      .save(new TextEncoder().encode(text), `${editor.title || "material"}.ptex`, saveAs ? null : projectPath(root))
      .then((p) => {
        if (!p) return;
        setProjectPath(root, p);
        if (editor.root === root) editor.setTabTitle(editor.currentIndex, fileName(p).replace(/\.ptex$/i, ""));
        markSaved(root, text);
        editor.setStatus(t("Saved {0}", p));
      })
      .catch((e) => editor.setStatus(t("Cannot save {0}: {1}", editor.title, String(e))));
  } else downloadBlob(new Blob([projectText()], { type: "application/json" }), `${editor.title || "material"}.ptex`);
  try {
    localStorage.setItem("material-pro:autosave", JSON.stringify({ title: editor.title, text: projectText() }));
  } catch {
    /* storage full or blocked */
  }
}

export { parseProject };

/** in the desktop app, what a project looked like when it was opened or saved, to tell whether it has changed */
const savedText = new WeakMap<object, string>();
export function markSaved(root: object, text: string) {
  savedText.set(root, text);
}
export const savedVersionOf = (root: object) => savedText.get(root);

export function openProjectFile() {
  if (host) {
    // the files are opened by the host integration (src/ui/hostIntegration.ts), like files opened from Finder
    host
      .open({ multiple: true, filters: [{ name: t("Projects"), extensions: ["ptex", "json", "mmg", "mmpp", "zip"] }] })
      .then((files) => files && window.dispatchEvent(new CustomEvent("mp-open-files", { detail: files })));
    return;
  }
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
  const r = editor.renders!;
  const m = findMaterial(editor.root);
  if (!m) return editor.setStatus(t("No material node to export"));
  if (!hasStandardMaps(m)) return editor.setStatus(t("“{0}” has no texture maps to export", m.getTypeName()));
  const s = size ?? m.imageSize;
  await runExport(t("Exporting {0} maps at {1}×{2}…", STANDARD_MAPS.length, s, s), async (signal, progress) => {
    const files: Record<string, Uint8Array> = {};
    // one batch: the maps share the buffers they read
    const maps = STANDARD_MAPS.filter((map) => map.output < m.getOutputDefs(true).length)
      .map((map) => ({ map, sc: m.getShaderCode("uv", map.output, new GenContext()) }))
      .filter((x) => x.sc.outputType);
    const images = await r.images(
      maps.map((x) => ({ sc: x.sc, size: s })),
      { signal, onProgress: (f) => progress(f * 0.9) },
    );
    for (let i = 0; i < maps.length; i++) files[`${editor.title}_${maps[i].map.key}.png`] = new Uint8Array(await (await imageDataToPng(images[i])).arrayBuffer());
    files[`${editor.title}.ptex`] = new TextEncoder().encode(projectText());
    await addExportNodeFiles(files, editor.title, signal);
    downloadBlob(new Blob([await zipFiles(files)], { type: "application/zip" }), `${editor.title}_maps.zip`);
    editor.setStatus(t("Exported {0} maps", Object.keys(files).length - 1));
  });
}

/** runs one of the material's export profiles (Godot, Unity, Unreal, Blender, glTF…) and downloads the files as a zip */
export async function exportForEngine(profile: string, size?: number) {
  const r = editor.renderer!;
  const m = findMaterial(editor.root);
  if (!m) return editor.setStatus(t("No material node to export"));
  const s = size ?? m.imageSize;
  const prefix = editor.title || "material";
  const plan = planExport(m, profile, prefix);
  await runExport(t("Exporting {0} files for {1}…", plan.length, profile), async (signal, progress) => {
  const files: Record<string, Uint8Array> = {};
  let buffersCode: ReturnType<typeof processShader> | null = null;
  let done = 0;
  for (const f of plan) {
    progress(done++ / plan.length);
    try {
      // a profile's "clipboard" file is text to paste in the engine (gen_material.gd export_material), not a file
      if (f.kind === "text" && f.name === "clipboard") navigator.clipboard?.writeText(f.text.split("\n").filter(Boolean).join("\n")).catch(() => {});
      else if (f.kind === "text") files[f.name] = new TextEncoder().encode(localizeUnrealScript(f.text));
      else if (f.kind === "texture") {
        const sc = f.output !== null ? m.getShaderCode("uv", f.output, new GenContext()) : expressionShaderCode(m, f.expression!);
        if (imageFormatOf(f.name) === "exr") files[f.name] = encodeExr(await editor.renders!.floats(sc, s, { signal }), s, s);
        else files[f.name] = new Uint8Array(await (await imageDataToBlob(await editor.renders!.image(sc, s, { signal }), imageFormatOf(f.name) as "png")).arrayBuffer());
      } else if (f.kind === "buffer") {
        // the material's own buffers are read from the page's renderer, which holds them
        await r.imagesLoaded(editor.root);
        buffersCode ??= processShader(m, processConditionals(String(m.shaderModel.preview_shader ?? ""), connectionsAndParametersContext(m)));
        const u = buffersCode.shaderCode.uniforms.find((x) => x.name === f.uniform);
        const t = u && r.textureFor(u.value as TextureRef);
        if (t) files[f.name] = await encodeTarget(r, t, f.name);
      }
    } catch (e) {
      if (e instanceof RenderFailure && e.kind === "cancelled") throw e;
      console.error("export", f.name, e);
    }
  }
  // the Unreal 5 script imports the helper module mm.py from its own folder
  if (needsUnrealMm(plan) && !("mm.py" in files)) files["mm.py"] = new TextEncoder().encode(UNREAL_MM_PY);
  await addExportNodeFiles(files, prefix, signal);
  downloadBlob(new Blob([await zipFiles(files)], { type: "application/zip" }), `${prefix}_${profile.replaceAll("/", "_").replaceAll(" ", "_")}.zip`);
  editor.setStatus(t("Exported {0} files for {1}", Object.keys(files).length, profile));
  });
}
