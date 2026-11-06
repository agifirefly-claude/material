/* The node header, its parameters and its ports */
import { editor } from "../store";
import type { Gen, PortDef } from "../../engine/gen/base";
import { GenShader } from "../../engine/gen/shader";
import { GenGraph, GenIOs, GenRemote } from "../../engine/gen/graph";
import { GenMaterial } from "../../engine/gen/misc";
import { registry } from "../../engine/registry";
import { ParamControl, paramLabel } from "../widgets/ParamControl";
import { portColor, portLabel } from "../NodeView";
import { GenSDF } from "../../engine/gen/sdf";
import { SdfEditor } from "../SdfEditor";
import { openDialog } from "../dialogs/bus";
import { t, tDesc } from "../i18n";
import { RemoteEditor, IOsEditor } from "./GraphInfo";

export function Header({ g }: { g: Gen }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{t(g.getTypeName())}</div>
      <div style={{ color: "var(--text3)" }}>
        {g.name} · {g.model ? t("library node “{0}”", g.model) : g.getType()}
        {g.getHierName() && g.getHierName() !== g.name ? ` · ${g.getHierName()}` : ""}
      </div>
    </div>
  );
}
export function Params({ g }: { g: Gen }) {
  const defs = g.getParameterDefs();
  return (
    <div className="insp">
      <Header g={g} />
      {g.getDescription() && <div className="desc">{tDesc(g.getDescription())}</div>}
      {(g instanceof GenShader || (g instanceof GenGraph && !(g instanceof GenMaterial))) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button onClick={() => openDialog("edit-node", g)}>{g instanceof GenMaterial ? t("Edit material…") : g instanceof GenGraph ? t("Edit graph…") : t("Edit node…")}</button>
          {g.isTemplate() && <button onClick={() => (g.toggleEditable(), g.changed())} title={t("Make editable (detach from the library)")}>{t("Make editable")}</button>}
          <button onClick={() => openDialog("add-to-library", g)}>{t("Add to a library…")}</button>
        </div>
      )}
      {defs.length === 0 && <div style={{ color: "var(--text3)" }}>{t("This node has no parameters.")}</div>}
      {defs.map((d) => (
        <div key={d.name} className="row" style={["curve", "polygon", "polyline", "lattice", "splines", "pixels", "gradient"].includes(d.type) ? { gridTemplateColumns: "1fr" } : undefined}>
          <label title={[d.name, tDesc(d.shortdesc), tDesc(d.longdesc)].filter(Boolean).join("\n")}>{paramLabel(d)}</label>
          <ParamControl gen={g} def={d} />
        </div>
      ))}
      {g.hasRandomness() && (
        <div className="row">
          <label>{t("Seed")}</label>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <code>{g.seedValue.toFixed(5)}</code>
            <button onClick={() => g.setSeed(Math.random())}>{t("Randomize")}</button>
            <label style={{ display: "flex", gap: 4 }}>
              <input type="checkbox" checked={g.seedLocked} onChange={(e) => ((g.seedLocked = e.target.checked), g.changed())} /> {t("locked")}
            </label>
          </div>
        </div>
      )}
      {g instanceof GenShader && g.isGeneric() && (
        <div className="row">
          <label>{t("Generic inputs")}</label>
          <input type="number" min={1} max={16} value={g.genericSize} onChange={(e) => g.setGenericSize(Math.max(1, +e.target.value))} />
        </div>
      )}
      {g instanceof GenSDF && <SdfEditor gen={g} />}
      {g instanceof GenRemote && <RemoteEditor r={g} />}
      {g instanceof GenIOs && <IOsEditor ios={g} />}
      {g instanceof GenGraph && !(g instanceof GenMaterial) && (
        <button onClick={() => editor.enter(g.name)} className="primary">
          {t("Open this subgraph ({0} nodes)", g.children.length)}
        </button>
      )}
    </div>
  );
}
export function PortTable({ ports, output, g }: { ports: PortDef[]; output: boolean; g: Gen }) {
  if (!ports.length) return <div style={{ color: "var(--text3)" }}>{t("None")}</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>{t("Name")}</th>
          <th>{t("Type")}</th>
          <th>{output ? t("Goes to") : t("Comes from")}</th>
        </tr>
      </thead>
      <tbody>
        {ports.map((p, i) => {
          const links = output ? g.getTargets(i).map((t) => `${t.generator.name}.${portLabel(t.generator.getInputDefs()[t.inputIndex] ?? { type: "" }, t.inputIndex, false)}`) : [];
          const src = output ? null : g.getSource(i);
          return (
            <tr key={i} title={p.longdesc ?? ""}>
              <td>{i}</td>
              <td>{portLabel(p, i, output) || "—"}</td>
              <td>
                <span className="dot" style={{ background: portColor(p.type) }} />
                {registry.ioTypes[p.type]?.label ?? p.type}
              </td>
              <td>
                {output ? links.join(", ") || "—" : src ? `${src.generator.getHierName() || src.generator.name}.out${src.outputIndex}` : <span style={{ color: "var(--text3)" }}>{t("default:")}{" "}{String(p.default ?? "—")}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
