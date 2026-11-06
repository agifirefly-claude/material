/* The code tab: the generated shader of a node and its uniforms */
import { useMemo, useState } from "react";
import { editor } from "../store";
import type { Gen } from "../../engine/gen/base";
import { GenShader } from "../../engine/gen/shader";
import { GenGraph } from "../../engine/gen/graph";
import { GenMaterial } from "../../engine/gen/misc";
import { GenContext } from "../../engine/context";
import { registry } from "../../engine/registry";
import { buildFragmentShader, withPreview } from "../../engine/render/shader-source";
import { portLabel } from "../NodeView";
import { t } from "../i18n";
import { Code, copy } from "./Code";
import { Header } from "./Params";
import { ShaderModel } from "./ShaderModel";
import { GraphInfo } from "./GraphInfo";

export function CodeTab({ g }: { g: Gen }) {
  const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
  const [out, setOut] = useState(0);
  const [full, setFull] = useState(false);
  const o = Math.min(out, Math.max(0, outs.length - 1));
  const generated = useMemo(() => {
    if (!outs.length) return null;
    try {
      const sc = g.getShaderCode("uv", o, new GenContext());
      const built = buildFragmentShader(withPreview(sc, 256));
      return { sc, built };
    } catch (e) {
      return { error: String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, o, editor.version]);
  return (
    <div className="insp">
      <Header g={g} />
      {g instanceof GenShader && <ShaderModel g={g} />}
      {g instanceof GenGraph && !(g instanceof GenMaterial) && <GraphInfo graph={g} embedded />}
      {outs.length > 0 && (
        <>
          <div className="sect">{t("Generated GLSL")}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select value={o} onChange={(e) => setOut(+e.target.value)}>
              {outs.map((p, i) => (
                <option key={i} value={i}>
                  {t("Output")}{" "}{i}: {portLabel(p, i, true) || p.type}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 4 }}>
              <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />{" "}{t("whole shader")}
            </label>
            {generated && "built" in generated && generated.built && <button onClick={() => copy(full ? generated.built.source : generated.built.body)}>{t("Copy")}</button>}
          </div>
          {generated && "error" in generated && <div className="err">{generated.error}</div>}
          {generated && "built" in generated && generated.built && (
            <>
              <div style={{ color: "var(--text3)" }}>
                {generated.sc!.uniforms.length}{" "}{t("uniforms ·")}{" "}{generated.sc!.globals.length}{" "}{t("global blocks · output type")}{" "}{registry.ioTypes[generated.sc!.outputType]?.label ?? generated.sc!.outputType}
              </div>
              <Code text={full ? generated.built.source : generated.built.body} max={520} />
              {generated.sc!.uniforms.length > 0 && (
                <>
                  <div className="sect">{t("Uniforms (live values)")}</div>
                  <table>
                    <tbody>
                      {generated.built.uniforms.map((u) => (
                        <tr key={u.name}>
                          <td>
                            <code>{u.name}</code>
                          </td>
                          <td>{u.type + (u.size ? `[${u.size}]` : "")}</td>
                          <td style={{ wordBreak: "break-all" }}>{fmtValue(u.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
export function fmtValue(v: unknown): string {
  if (typeof v === "number") return +v.toFixed(5) + "";
  if (Array.isArray(v)) return v.length > 12 ? `[${v.slice(0, 12).map((x) => +(+x).toFixed(3)).join(", ")}, …]` : `[${v.map((x) => +(+x).toFixed(3)).join(", ")}]`;
  if (typeof v === "function") return "(set while rendering)";
  if (v && typeof v === "object" && "key" in v) return "texture " + (v as { key: string }).key;
  if (v && typeof v === "object") {
    // gradients, curves, colours...: their saved form, shortened
    const o = v as { serialize?: () => unknown };
    const s = JSON.stringify(typeof o.serialize === "function" ? o.serialize() : v);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  }
  return String(v);
}
