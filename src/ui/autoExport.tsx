/* Auto Export nodes (gen_autoexport.gd): the input is written to its file whenever it changes, a quarter of a second
 * after the last change. A browser page cannot write files by name, so the file is chosen once per node with the
 * File System Access API (showSaveFilePicker) and written again in place; where that API is missing, the node offers
 * a download of the current image instead. */
import { useState } from "react";
import { editor, useEditor } from "./store";
import { GenAutoExport } from "../engine/gen/misc";
import { GenGraph } from "../engine/gen/graph";
import { GenContext } from "../engine/context";
import { downloadBlob, imageDataToBlob } from "./exporting";
import { t } from "./i18n";
import { hostSavePicker } from "./platform";

type Handle = { name: string; createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> };
type SavePicker = (o: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<Handle>;
// in the desktop app the host writes the file (src/ui/platform.ts)
const picker = (): SavePicker | undefined => (hostSavePicker() as SavePicker | undefined) ?? (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
export const canWriteFiles = () => typeof window !== "undefined" && !!picker();

const handles = new Map<number, Handle>();
const written = new Map<number, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function autoExports(g: GenGraph = editor.root, out: GenAutoExport[] = []): GenAutoExport[] {
  for (const c of g.children) {
    if (c instanceof GenAutoExport) out.push(c);
    else if (c instanceof GenGraph) autoExports(c, out);
  }
  return out;
}

function formatOf(name: string): "png" | "jpg" | "webp" {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "webp" ? "webp" : "png";
}

/** the node's input as an image file, or null when nothing is connected */
async function render(g: GenAutoExport): Promise<Blob | null> {
  const src = g.getSource(0);
  if (!src || !editor.renderer) return null;
  const sc = src.generator.getShaderCode("uv", src.outputIndex, new GenContext());
  if (!sc.outputType) return null;
  const r = editor.renderer;
  // keyed: unchanged inputs are not re-rendered, and `changed` says whether the file is out of date
  const res = r.renderKeyed("autoexport:" + g.id, sc, g.imageSize);
  if (!res.target || (!res.changed && written.has(g.id))) return null;
  return imageDataToBlob(r.toImageData(res.target), formatOf(String(g.getParameter("filename"))));
}

let writing: Promise<void> | null = null;
let again = false;
/** writes the files that are out of date; calls made while it runs are folded into one more run */
function writeAll(): Promise<void> {
  if (writing) {
    again = true;
    return writing;
  }
  writing = (async () => {
    do {
      again = false;
      await writeOnce();
    } while (again);
    writing = null;
  })();
  return writing;
}

async function writeOnce() {
  for (const g of autoExports()) {
    const h = handles.get(g.id);
    if (!h) continue;
    try {
      const blob = await render(g);
      if (!blob) continue;
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      written.set(g.id, Date.now());
      editor.setStatus(t("Auto export: wrote {0}", h.name));
    } catch (e) {
      console.warn("auto export", e);
    }
  }
}

/** after each change, the files of the auto exports whose input changed are written again */
editor.subscribe(() => {
  if (!handles.size) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(writeAll, 250);
});

export function AutoExportControls({ gen }: { gen: GenAutoExport }) {
  useEditor();
  const [, redraw] = useState(0);
  const h = handles.get(gen.id);
  const name = String(gen.getParameter("filename") ?? "export.png");
  return (
    <div className="autoexport nodrag">
      {canWriteFiles() ? (
        <button
          title={t("Choose the file this node keeps up to date")}
          onClick={async () => {
            try {
              const f = formatOf(name);
              const handle = await picker()!({ suggestedName: name, types: [{ description: t("Image"), accept: { [f === "jpg" ? "image/jpeg" : "image/" + f]: ["." + f] } }] });
              handles.set(gen.id, handle);
              written.delete(gen.id);
              redraw((x) => x + 1);
              writeAll();
            } catch {
              /* cancelled */
            }
          }}
        >
          {h ? t("Writing to {0}", h.name) : t("Choose file…")}
        </button>
      ) : (
        <button
          title={t("This browser cannot keep a file up to date: download the current image")}
          onClick={async () => {
            written.delete(gen.id);
            const blob = await render(gen);
            if (blob) downloadBlob(blob, name.split("/").pop() || "export.png");
          }}
        >
          {t("Download")}
        </button>
      )}
      {h && written.has(gen.id) && <span style={{ color: "var(--text3)" }}>{new Date(written.get(gen.id)!).toLocaleTimeString()}</span>}
    </div>
  );
}
