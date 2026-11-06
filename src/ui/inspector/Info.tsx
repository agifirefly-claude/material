/* The info tab: what a node is, and what it reads */
import type React from "react";
import { editor } from "../store";
import type { Gen } from "../../engine/gen/base";
import { GenGraph } from "../../engine/gen/graph";
import { GenMaterial } from "../../engine/gen/misc";
import { portColor, portLabel } from "../NodeView";
import { t, tDesc } from "../i18n";
import { Header, PortTable } from "./Params";

export function Info({ g }: { g: Gen }) {
  const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
  return (
    <div className="insp">
      <Header g={g} />
      {g.getDescription() && <div className="desc">{tDesc(g.getDescription())}</div>}
      <div className="sect">{t("Inputs")}</div>
      <PortTable ports={g.getInputDefs()} output={false} g={g} />
      <div className="sect">{g instanceof GenMaterial ? t("Texture maps") : t("Outputs")}</div>
      <PortTable ports={outs} output g={g} />
      <div className="sect">{t("Upstream (what this node is computed from)")}</div>
      <Upstream g={g} />
    </div>
  );
}
/** the tree of nodes feeding a node, across subgraph boundaries */
function Upstream({ g }: { g: Gen }) {
  const seen = new Set<Gen>();
  const walk = (n: Gen, depth: number): React.ReactNode[] => {
    if (depth > 12) return [];
    const rows: React.ReactNode[] = [];
    n.getInputDefs().forEach((p, i) => {
      const s = n.getSource(i);
      if (!s) return;
      const repeat = seen.has(s.generator);
      seen.add(s.generator);
      rows.push(
        <div key={`${n.id}-${i}-${depth}`} style={{ paddingLeft: depth * 12, whiteSpace: "nowrap" }}>
          <span className="dot" style={{ background: portColor(p.type) }} />
          <span style={{ color: "var(--text3)" }}>{portLabel(p, i, false)} ←</span>{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              selectAnywhere(s.generator);
            }}
          >
            {t(s.generator.getTypeName())}
          </a>{" "}
          <span style={{ color: "var(--text3)" }}>
            {s.generator.getHierName() || s.generator.name}
            {repeat ? t(" (see above)") : ""}
          </span>
        </div>,
      );
      if (!repeat) rows.push(...walk(s.generator, depth + 1));
    });
    return rows;
  };
  const rows = walk(g, 0);
  return rows.length ? <div>{rows}</div> : <div style={{ color: "var(--text3)" }}>{t("Nothing is connected to this node's inputs.")}</div>;
}
/** opens the graph a node is in and selects it */
export function selectAnywhere(g: Gen) {
  const path: string[] = [];
  let p = g.parent as unknown as GenGraph | null;
  while (p && p.parent) {
    path.unshift(p.name);
    p = p.parent as unknown as GenGraph;
  }
  editor.path = path;
  editor.selection = [g.name];
  editor.emit();
}
