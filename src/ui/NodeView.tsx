import { memo, useCallback, useEffect, useState } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import type { Gen, PortDef } from "../engine/gen/base";
import { GenComment, GenGraph, GenIOs, GenRemote, GenReroute } from "../engine/gen/graph";
import { GenMaterial } from "../engine/gen/misc";
import { GenBuffer, GenIterateBuffer } from "../engine/gen/texture";
import { registry } from "../engine/registry";
import type { ShaderError } from "../engine/render/renderer";
import { ParamControl, paramLabel } from "./widgets/ParamControl";
import { PreviewCanvas } from "./PreviewCanvas";
import { editor, useEditor } from "./store";
import { t, tDesc, useLang } from "./i18n";

export type NodeData = { gen: Gen };

export const portColor = (type: string | undefined) => registry.ioTypes[type ?? ""]?.color ?? "#dedede";
const slotClass = (type: string | undefined) => "slot" + (registry.ioTypes[type ?? ""]?.slot_type ?? 0);

export function nodeClass(g: Gen): string {
  if (g instanceof GenMaterial) return "material";
  if (g instanceof GenGraph) return "graph";
  if (g instanceof GenBuffer || g instanceof GenIterateBuffer) return "buffer";
  if (g instanceof GenRemote) return "remote";
  if (g instanceof GenIOs) return "ios";
  return "shader";
}

/** Material Maker draws a bracket along ports of a group (group_size on the first port) */
function groupClass(ports: PortDef[], i: number): string {
  for (let s = i; s >= 0; s--) {
    const n = ports[s].group_size ?? 0;
    if (n > 1 && i < s + n) return " pg" + (i === s ? " pg-first" : "") + (i === s + n - 1 ? " pg-last" : "");
  }
  return "";
}

export function portLabel(p: PortDef, i: number, output: boolean): string {
  if (output) return t(p.shortdesc ?? p.name ?? "");
  return t((p.label || p.shortdesc || p.name || `in ${i}`).replace(/^\d+:/, ""));
}

function MMNodeInner({ id, data, selected }: NodeProps & { data: NodeData }) {
  useEditor();
  useLang();
  const g = data.gen;
  const update = useUpdateNodeInternals();
  const [error, setError] = useState<string | null>(null);
  const inputs = g.getInputDefs();
  const outputs = g instanceof GenMaterial ? [] : g.getOutputDefs();
  const sig = inputs.map((p) => p.type).join() + "|" + outputs.map((p) => p.type).join() + "|" + g.minimized;
  useEffect(() => update(id), [id, sig, update]);
  const onError = useCallback((e: ShaderError | null) => setError(e ? e.message : null), []);

  if (g instanceof GenComment) {
    return (
      <div className="mm-comment" style={{ width: g.size.x, height: g.size.y }}>
        <div className="t">{g.title}</div>
        <pre>{g.text}</pre>
      </div>
    );
  }
  if (g instanceof GenReroute) {
    const t = g.getOutputDefs()[0].type;
    return (
      <div className="mm-reroute">
        <Handle type="target" id="i0" position={Position.Left} style={{ background: portColor(t), left: -2 }} />
        <Handle type="source" id="o0" position={Position.Right} style={{ background: portColor(t), right: -2 }} />
      </div>
    );
  }
  const params = g.getParameterDefs().filter((p) => !(g instanceof GenMaterial && p.name === "size" && false));
  const rows = Math.max(inputs.length, outputs.length);
  const previewOutput = g.preview >= 0 ? g.preview : 0;
  const showPreview = outputs.length > 0 && !g.minimized && (editor.allPreviews ? g.extra.hidePreview !== true : g.preview >= 0);
  const isMaterial = g instanceof GenMaterial;
  return (
    <div className={`mm-node ${nodeClass(g)}${selected ? " selected" : ""}${error ? " error" : ""}`} title={tDesc(g.getDescription())}>
      <div className="head">
        <span>{t(g.getTypeName())}</span>
        <span className="name">{g.name}</span>
        <span className="grow" />
        {g.hasRandomness() && <span className="badge" title="Uses a random seed">rnd</span>}
        {g instanceof GenGraph && !isMaterial && (
          <span className="badge" title="Double click to open">
            graph
          </span>
        )}
      </div>
      <div className="ports">
        <div>
          {inputs.map((p, i) => (
            <div className={"port in" + groupClass(inputs, i)} key={"i" + i} title={tDesc(p.longdesc ?? p.shortdesc ?? "")}>
              <Handle type="target" id={"i" + i} position={Position.Left} className={slotClass(p.type)} style={{ background: portColor(p.type), left: -6 }} />
              {portLabel(p, i, false)}
            </div>
          ))}
        </div>
        <div>
          {outputs.map((p, i) => (
            <div className={"port out" + groupClass(outputs, i)} key={"o" + i} onDoubleClick={() => ((g.preview = g.preview === i ? -1 : i), editor.emit())}
              title={(p.longdesc ?? p.shortdesc ?? "") + "\nDouble click to preview this output"}>
              {portLabel(p, i, true)}
              {i === previewOutput && outputs.length > 1 && " ●"}
              <Handle type="source" id={"o" + i} position={Position.Right} className={slotClass(p.type)} style={{ background: portColor(p.type), right: -6 }} />
            </div>
          ))}
        </div>
      </div>
      {rows === 0 && <div style={{ height: 4 }} />}
      {!g.minimized && params.length > 0 && (
        <div className="params">
          {params.map((p) => (
            <ParamRow key={p.name} g={g} name={p.name} />
          ))}
        </div>
      )}
      {showPreview && <PreviewCanvas gen={g} output={previewOutput} size={128} display={110} className="preview" onError={onError} />}
      {error && <div className="err">{error}</div>}
      {isMaterial && <div className="err" style={{ color: "var(--text3)" }}>Material output — see the 3D view</div>}
    </div>
  );
}

function ParamRow({ g, name }: { g: Gen; name: string }) {
  const def = g.getParameterDef(name)!;
  if (!def) return null;
  return (
    <>
      <span className="pl" title={def.shortdesc ?? def.longdesc ?? def.name}>
        {paramLabel(def)}
      </span>
      <ParamControl gen={g} def={def} compact />
    </>
  );
}

export const MMNode = memo(MMNodeInner);
