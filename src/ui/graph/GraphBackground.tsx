/* The 2D or 3D preview drawn behind the graph */
import { editor, useEditor } from "../store";
import { Preview3D } from "../Preview3D";
import { PreviewCanvas } from "../PreviewCanvas";

/** the 2D or 3D preview drawn behind the graph */
export function GraphBackground() {
  useEditor();
  const g = editor.selected;
  if (editor.background === "none") return null;
  const outs = g ? g.getOutputDefs() : [];
  return (
    <div className="graph-bg">
      {editor.background === "3d" ? (
        <Preview3D active />
      ) : g && outs.length ? (
        <PreviewCanvas gen={g} output={g.preview >= 0 ? Math.min(g.preview, outs.length - 1) : 0} size={1024} className="graph-bg-2d" />
      ) : null}
    </div>
  );
}
