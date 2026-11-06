import { memo, useCallback, useEffect, useState } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import type { Gen, PortDef } from "../engine/gen/base";
import { GenComment, GenGraph, GenIOs, GenPortal, GenRemote, GenReroute } from "../engine/gen/graph";
import { usePrefs } from "./prefs";
import { GenAutoExport, GenMaterial } from "../engine/gen/misc";
import { GenBuffer, GenIterateBuffer } from "../engine/gen/texture";
import { registry } from "../engine/registry";
import type { ShaderError } from "../engine/render/renderer";
import { ParamControl, paramLabel } from "./widgets/ParamControl";
import { PreviewCanvas } from "./PreviewCanvas";
import { editor, useEditor } from "./store";
import { t, tDesc, useLang } from "./i18n";
import { TonesEditor, isTones } from "./Tones";
import { AutoExportControls } from "./autoExport";

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
  const prefs = usePrefs();
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
  if (g instanceof GenPortal) {
    // Material Maker's aperture: a dot with its link name beside it, or above it (aperture_label_position)
    const type = g.io === 0 ? g.getInputDefs()[0]?.type : g.getOutputDefs()[0]?.type;
    const c = g.color;
    return (
      <div className={"mm-portal" + (prefs.portalLabelSide ? " side" : " top") + (g.io === 0 ? " in" : " out") + (selected ? " selected" : "")} title={t(g.getTypeName())}>
        <span className="mm-portal-label">{String(g.parameters.link ?? "")}</span>
        <span className="mm-portal-dot" style={{ background: `rgb(${c.r * 255},${c.g * 255},${c.b * 255})` }}>
          {g.io === 0 ? (
            <Handle type="target" id="i0" position={Position.Left} className={slotClass(type)} style={{ background: portColor(type), left: -6 }} />
          ) : (
            <Handle type="source" id="o0" position={Position.Right} className={slotClass(type)} style={{ background: portColor(type), right: -6 }} />
          )}
        </span>
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
        {g.hasRandomness() && <span className="badge" title={t("Uses a random seed")}>{t("rnd")}</span>}
        {g instanceof GenGraph && !isMaterial && (
          <span className="badge" title={t("Double click to open")}>
            {t("graph")}
          </span>
        )}
        {prefs.nodeMinimizeButton && (
          <button className="node-btn nodrag" title={g.minimized ? t("Show parameters") : t("Hide parameters")} onClick={() => ((g.minimized = !g.minimized), editor.emit())}>
            {g.minimized ? "▢" : "–"}
          </button>
        )}
        {prefs.nodeCloseButton && g.canBeDeleted() && (
          <button className="node-btn nodrag" title={t("Delete")} onClick={() => g.parent && (g.parent as unknown as GenGraph).removeGenerator(g)}>
            ×
          </button>
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
      {!g.minimized && isTones(g) && <TonesEditor gen={g} />}
      {g instanceof GenAutoExport && <AutoExportControls gen={g} />}
      {!g.minimized && params.length > 0 && !isTones(g) && (
        <div className="params">
          {params.map((p) => (
            <ParamRow key={p.name} g={g} name={p.name} />
          ))}
        </div>
      )}
      {showPreview && <PreviewCanvas gen={g} output={previewOutput} size={prefs.nodePreviewSize} display={110} className="preview" onError={onError} />}
      {error && <div className="err">{error}</div>}
      {isMaterial && <div className="err" style={{ color: "var(--text3)" }}>{t("Material output — see the 3D view")}</div>}
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
