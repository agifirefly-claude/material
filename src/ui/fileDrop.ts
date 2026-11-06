/* Files dropped on the graph (main_window.gd on_files_dropped): a project opens, an image becomes an Image node,
 * or replaces the image of the Image node it is dropped on. */
import { editor } from "./store";
import { parseProject } from "./exporting";
import { createGen } from "../engine/loader";
import { GenImage } from "../engine/gen/texture";
import { t } from "./i18n";

const IMAGE = /\.(bmp|jpe?g|png|svg|webp|gif|avif)$/i;
const PROJECT = /\.(ptex|json)$/i;

export const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

const readDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

/** handles the files of a drop; `at` is the drop point in graph coordinates */
export async function dropFiles(e: React.DragEvent, at: { x: number; y: number }): Promise<void> {
  const files = [...e.dataTransfer.files];
  // the node under the cursor, if any
  const nodeEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".react-flow__node") as HTMLElement | null;
  const target = nodeEl ? editor.graph.getNode(nodeEl.dataset.id ?? "") : undefined;
  let offset = 0;
  for (const f of files) {
    try {
      if (PROJECT.test(f.name)) {
        const data = parseProject(await f.text());
        if (data.nodes) editor.open(data, f.name.replace(PROJECT, ""));
        else editor.setStatus(t("{0} is not a Material Maker project", f.name));
      } else if (IMAGE.test(f.name) || f.type.startsWith("image/")) {
        const url = await readDataUrl(f);
        if (target instanceof GenImage) target.setParameter("image", url);
        else {
          const g = createGen({ type: "image", image: url, filter: true });
          if (!g) continue;
          g.position = { x: at.x + offset, y: at.y + offset };
          offset += 30;
          editor.graph.addGenerator(g);
          editor.select([g.name]);
        }
      } else editor.setStatus(t("Cannot open {0} here", f.name));
    } catch (err) {
      editor.setStatus(t("Cannot open {0}: {1}", f.name, err));
    }
  }
}
