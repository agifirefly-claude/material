/* What a shader node is made of (its model), shown and edited */
import { useState } from "react";
import type { PortDef } from "../../engine/gen/base";
import { GenShader } from "../../engine/gen/shader";
import { openDialog } from "../dialogs/bus";
import { t } from "../i18n";
import { Code } from "./Code";
import { fmtValue } from "./CodeTab";

export function ShaderModel({ g }: { g: GenShader }) {
  const sm = g.shaderModel;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <>
      <div className="sect" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1 }}>{t("Shader model")} {g.model ? t("(from the library: {0})", g.model) : t("(custom)")}</span>
        {!edit ? (
          <>
            <button onClick={() => openDialog("edit-node", g)}>{t("Edit…")}</button>
            <button
              title={t("Edit the model as JSON")}
              onClick={() => {
                setDraft(JSON.stringify(sm, null, 2));
                setEdit(true);
              }}
            >
              {t("JSON")}
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              onClick={() => {
                try {
                  const d = JSON.parse(draft);
                  g.model = null;
                  g.setShaderModel(d);
                  setEdit(false);
                } catch (e) {
                  alert(t("Not valid JSON: {0}", e));
                }
              }}
            >
              {t("Apply")}
            </button>
            <button onClick={() => setEdit(false)}>{t("Cancel")}</button>
          </>
        )}
      </div>
      {edit ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} spellCheck={false} onKeyDown={(e) => e.stopPropagation()} />
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{t("Parameter")}</th>
                <th>{t("Type")}</th>
                <th>{t("Value used in code")}</th>
              </tr>
            </thead>
            <tbody>
              {g.getParameterDefs().map((p) => (
                <tr key={p.name}>
                  <td>
                    <code>${p.name}</code>
                  </td>
                  <td>{p.type}</td>
                  <td style={{ wordBreak: "break-all" }}>{p.type === "enum" ? (p.values?.[Number(g.parameters[p.name] ?? 0)]?.value ?? "") : fmtValue(g.parameters[p.name] as unknown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(sm.inputs ?? []).length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t("Input")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Default when unconnected")}</th>
                </tr>
              </thead>
              <tbody>
                {(sm.inputs ?? []).map((p: PortDef) => (
                  <tr key={p.name}>
                    <td>
                      <code>${p.name}(uv)</code>
                      {p.function ? " ƒ" : ""}
                    </td>
                    <td>{p.type}</td>
                    <td>
                      <code>{String(p.default ?? "")}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(sm.outputs ?? []).map((o: Record<string, string>, i: number) => (
            <div key={i}>
              <div style={{ color: "var(--text3)" }}>
                {t("Output")}{" "}{i} ({o.type}){o.shortdesc ? ` — ${o.shortdesc}` : ""}
              </div>
              <Code text={o[o.type] ?? ""} />
            </div>
          ))}
          {sm.code && (
            <>
              <div style={{ color: "var(--text3)" }}>{t("Code (run per pixel before the outputs)")}</div>
              <Code text={sm.code} max={260} />
            </>
          )}
          {sm.instance && (
            <>
              <div style={{ color: "var(--text3)" }}>{t("Instance (functions specific to this node)")}</div>
              <Code text={sm.instance} max={260} />
            </>
          )}
          {sm.global && (
            <>
              <div style={{ color: "var(--text3)" }}>{t("Global (shared functions)")}</div>
              <Code text={sm.global} max={260} />
            </>
          )}
          {(sm.includes ?? []).length > 0 && <div style={{ color: "var(--text3)" }}>{t("Includes the globals of:")}{" "}{sm.includes.join(", ")}</div>}
        </>
      )}
    </>
  );
}
