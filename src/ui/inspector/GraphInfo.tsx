/* Graph nodes: their info, remote parameters, inputs and outputs, and parameters */
import { useMemo, useState } from "react";
import { editor, useEditor } from "../store";
import { GenGraph, GenIOs, GenRemote } from "../../engine/gen/graph";
import { registry } from "../../engine/registry";
import { ParamControl, paramLabel } from "../widgets/ParamControl";
import { t } from "../i18n";

/** Statistics of a graph: which node types it uses and how they connect */
export function GraphInfo({ graph, embedded }: { graph: GenGraph; embedded?: boolean }) {
  useEditor();
  const stats = useMemo(() => {
    const types = new Map<string, number>();
    let total = 0,
      links = 0,
      subgraphs = 0;
    const walk = (g: GenGraph) => {
      links += g.connections.length;
      for (const c of g.children) {
        total++;
        const k = c.model ?? c.getType();
        types.set(k, (types.get(k) ?? 0) + 1);
        if (c instanceof GenGraph) {
          subgraphs++;
          walk(c);
        }
      }
    };
    walk(graph);
    return { types: [...types.entries()].sort((a, b) => b[1] - a[1]), total, links, subgraphs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, editor.version]);
  return (
    <div className={embedded ? "" : "insp"}>
      {!embedded && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{graph === editor.root ? editor.title : t(graph.getTypeName())}</div>
          <div style={{ color: "var(--text3)" }}>{t("Select a node to see its parameters, ports and generated code.")}</div>
        </>
      )}
      <div className="sect">{t("Graph analysis (including subgraphs)")}</div>
      <div>
        {stats.total}{" "}{t("nodes ·")}{" "}{stats.links}{" "}{t("connections ·")}{" "}{stats.subgraphs}{" "}{t("subgraphs")}
      </div>
      <table>
        <tbody>
          {stats.types.map(([k, n]) => (
            <tr key={k}>
              <td>{k}</td>
              <td style={{ textAlign: "right" }}>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function RemoteEditor({ r }: { r: GenRemote }) {
  const graph = r.parent as unknown as GenGraph;
  const [node, setNode] = useState("");
  const [param, setParam] = useState("");
  const target = graph?.getNode(node);
  return (
    <>
      <div className="sect">{t("Controls")}</div>
      {r.widgets.map((w) => (
        <div key={w.name} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <code>{w.name}</code>
          <span style={{ color: "var(--text3)" }}>{w.type}</span>
          <input type="text" value={w.label ?? ""} onChange={(e) => ((w.label = e.target.value), r.changed())} style={{ flex: 1 }} />
          <button onClick={() => r.removeParameter(w.name)}>✕</button>
          {w.linked_widgets?.length > 0 && <div style={{ color: "var(--text3)", width: "100%" }}>→ {w.linked_widgets.map((l: { node: string; widget: string }) => `${l.node}.${l.widget}`).join(", ")}</div>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button onClick={() => r.createNamedParameter("Parameter")}>{t("+ Named parameter")}</button>
        <select value={node} onChange={(e) => (setNode(e.target.value), setParam(""))}>
          <option value="">{t("Link a node's parameter…")}</option>
          {graph?.children.filter((c) => c !== r && c.getParameterDefs().length).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.getTypeName()})
            </option>
          ))}
        </select>
        {target && (
          <select value={param} onChange={(e) => setParam(e.target.value)}>
            <option value="">{t("parameter…")}</option>
            {target.getParameterDefs().map((p) => (
              <option key={p.name} value={p.name}>
                {paramLabel(p)}
              </option>
            ))}
          </select>
        )}
        <button
          disabled={!target || !param}
          onClick={() => {
            const w = r.createLinkedControl(paramLabel(target!.getParameterDef(param)!));
            r.linkParameter(w, target!, param);
            setParam("");
          }}
        >
          {t("Link")}
        </button>
      </div>
    </>
  );
}
export function IOsEditor({ ios }: { ios: GenIOs }) {
  const types = Object.values(registry.ioTypes).filter((t) => t.label);
  const changed = () => {
    ios.changed();
    (ios.parent as unknown as GenGraph)?.parent?.notifyChanged();
  };
  return (
    <>
      <div className="sect">{ios.name === "gen_inputs" ? t("Subgraph inputs") : t("Subgraph outputs")}</div>
      {ios.ports.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 4 }}>
          <input type="text" value={p.name ?? ""} onChange={(e) => ((p.name = e.target.value), changed())} style={{ flex: 1 }} />
          <select value={p.type} onChange={(e) => ((p.type = e.target.value), changed())}>
            {types.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              ios.ports.splice(i, 1);
              changed();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => (ios.ports.push({ name: "port" + ios.ports.length, type: "rgba" }), changed())}>{t("+ Port")}</button>
    </>
  );
}
/** Material Maker's parameters panel: the controls of the open graph's parameters node */
export function GraphParameters({ graph }: { graph: GenGraph }) {
  const defs = graph.getParameterDefs();
  if (!defs.length) return null;
  return (
    <div className="insp" style={{ paddingBottom: 0 }}>
      <div className="sect">{t("Parameters")}</div>
      {defs.map((d) => (
        <div key={d.name} className="row" style={["curve", "polygon", "polyline", "lattice", "splines", "pixels", "gradient"].includes(d.type) ? { gridTemplateColumns: "1fr" } : undefined}>
          <label title={[d.name, d.shortdesc, d.longdesc].filter(Boolean).join("\n")}>{t(paramLabel(d))}</label>
          <ParamControl gen={graph} def={d} />
        </div>
      ))}
    </div>
  );
}
