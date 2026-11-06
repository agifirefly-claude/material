import { useEffect, useState } from "react";
import { editor, useEditor } from "./store";
import { PreviewCanvas } from "./PreviewCanvas";
import { GenMaterial } from "../engine/gen/misc";
import { portLabel } from "./NodeView";
import { GenContext } from "../engine/context";
import { downloadBlob, imageDataToPng } from "./exporting";

/** the selected node's output, large */
export function Preview2D() {
  useEditor();
  const g = editor.selected;
  const [size, setSize] = useState(512);
  const [output, setOutput] = useState(0);
  const [tile, setTile] = useState(false);
  useEffect(() => setOutput(g?.preview && g.preview >= 0 ? g.preview : 0), [g]);
  const outs = g ? (g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs()) : [];
  const o = Math.min(output, outs.length - 1);
  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        {outs.length > 1 && (
          <select value={o} onChange={(e) => setOutput(+e.target.value)}>
            {outs.map((p, i) => (
              <option key={i} value={i}>
                {i}: {portLabel(p, i, true) || p.type}
              </option>
            ))}
          </select>
        )}
        <select value={size} onChange={(e) => setSize(+e.target.value)}>
          {[256, 512, 1024, 2048].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} /> tile 2×2
        </label>
        <span className="grow" />
        <button
          disabled={!g || !outs.length}
          onClick={async () => {
            const r = editor.renderer!;
            const t = r.render(g!.getShaderCode("uv", o, new GenContext()), size);
            downloadBlob(await imageDataToPng(r.toImageData(t)), `${g!.name}_${o}.png`);
            r.deleteTarget(t);
          }}
        >
          Save PNG
        </button>
      </div>
      <div className="body">
        {g && outs.length > 0 ? (
          tile ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: "min(100%, 100cqh)", aspectRatio: "1" }}>
              {[0, 1, 2, 3].map((i) => (
                <PreviewCanvas key={i + ":" + size} gen={g} output={o} size={size / 2} className="p2d" />
              ))}
            </div>
          ) : (
            <PreviewCanvas key={size} gen={g} output={o} size={size} className="p2d" />
          )
        ) : (
          <div className="empty">{g ? "This node has no output to preview" : "Select a node to preview it"}</div>
        )}
      </div>
    </div>
  );
}
