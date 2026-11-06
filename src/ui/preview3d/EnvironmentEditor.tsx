/* Port of the environment editor window (material_maker/windows/environment_editor): the list of environments with
 * their thumbnails, "New..." to copy the selected one, and the selected one's settings (Material Maker's own
 * environments are read only). */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BUNDLED_HDRIS, deleteEnvironment, ensureThumbnail, hdrLabel, isReadOnly, newEnvironment, renderThumbnail, setEnvironmentValue, storeHdr, useEnvironments, type Environment } from "./environments";
import { getSettings, updateSettings } from "./settings";
import { ColorEdit } from "../widgets/ColorEdit";
import { FloatEdit } from "../widgets/FloatEdit";
import { t } from "../i18n";

type FloatKey = "sky_energy" | "ambient_light_energy" | "ambient_light_sky_contribution" | "sun_energy" | "sun_direction" | "sun_angle";
const FLOATS: [FloatKey, string, number, number, number][] = [
  ["sky_energy", "Sky energy", 0, 4, 0.01],
  ["ambient_light_energy", "Ambient light energy", 0, 4, 0.01],
  ["ambient_light_sky_contribution", "Ambient sky contribution", 0, 1, 0.01],
  ["sun_energy", "Sun energy", 0, 8, 0.01],
  ["sun_direction", "Sun direction", 0, 360, 1],
  ["sun_angle", "Sun angle", 0, 90, 1],
];

export function EnvironmentEditor({ onClose }: { onClose: () => void }) {
  const list = useEnvironments();
  const [sel, setSel] = useState(Math.min(getSettings().environment, list.length - 1));
  const env: Environment | undefined = list[sel];
  const ro = isReadOnly(sel);
  const [preview, setPreview] = useState("");
  const select = (i: number) => {
    setSel(i);
    updateSettings({ environment: i });
  };
  // a bigger preview of the selected environment, and thumbnails for the user's environments
  useEffect(() => {
    if (!env) return;
    let live = true;
    const t = setTimeout(() => {
      renderThumbnail(env, 192)
        .then((b) => live && setPreview(b))
        .catch(() => {});
      if (!ro && !env.thumbnail) ensureThumbnail(sel);
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [env, sel, ro]);
  const set = <K extends keyof Environment>(k: K, v: Environment[K]) => setEnvironmentValue(sel, k, v);

  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal env-editor" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h2 style={{ margin: 0, flex: 1 }}>{t("Environments")}</h2>
          <button onClick={onClose}>{t("Close")}</button>
        </div>
        <div className="env-editor-body">
          <div className="env-list">
            {list.map((e, i) => (
              <div key={i} className={"env-item" + (i === sel ? " sel" : "")} onClick={() => select(i)} title={isReadOnly(i) ? t("Material Maker environment (read only)") : t("Your environment")}>
                {e.thumbnail ? <img src={"data:image/png;base64," + e.thumbnail} alt="" /> : <div className="env-thumb-empty" />}
                <span>{e.name}</span>
              </div>
            ))}
            <div className="env-item" onClick={() => select(newEnvironment(sel))} title={t("Copy the selected environment into a new one you can edit")}>
              <div className="env-thumb-empty">+</div>
              <span>{t("New…")}</span>
            </div>
          </div>
          {env && (
            <div className="env-fields insp">
              {preview && <img className="env-preview" src={"data:image/png;base64," + preview} alt="" />}
              {ro && <div style={{ color: "var(--text3)" }}>{t("Material Maker's environments cannot be changed: use New… to make an editable copy.")}</div>}
              <div className="row">
                <label>{t("Name")}</label>
                <input type="text" value={env.name} disabled={ro} onChange={(e) => set("name", e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              </div>
              <div className="row">
                <label>{t("HDR image")}</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <select
                    disabled={ro}
                    value={BUNDLED_HDRIS.includes(env.hdri_url.split("/").pop() ?? "") ? "hdri/" + env.hdri_url.split("/").pop() : env.hdri_url}
                    onChange={(e) => set("hdri_url", e.target.value)}
                    style={{ flex: 1 }}
                  >
                    {BUNDLED_HDRIS.map((h) => (
                      <option key={h} value={"hdri/" + h}>
                        {h}
                      </option>
                    ))}
                    {!BUNDLED_HDRIS.includes(env.hdri_url.split("/").pop() ?? "") && <option value={env.hdri_url}>{hdrLabel(env.hdri_url)}</option>}
                  </select>
                  <button
                    disabled={ro}
                    title={t("Use an .hdr image of your own (kept in this browser)")}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".hdr";
                      input.onchange = async () => {
                        const f = input.files?.[0];
                        if (f) set("hdri_url", await storeHdr(f));
                      };
                      input.click();
                    }}
                  >
                    {t("Upload…")}
                  </button>
                </div>
              </div>
              <div className="row">
                <label>{t("Show color")}</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" disabled={ro} checked={env.show_color} onChange={(e) => set("show_color", e.target.checked)} />
                  <ColorEdit value={env.color} onChange={(c) => !ro && set("color", { type: "Color", ...c })} />
                </div>
              </div>
              <div className="row">
                <label>{t("Ambient light color")}</label>
                <ColorEdit value={env.ambient_light_color} onChange={(c) => !ro && set("ambient_light_color", { type: "Color", ...c })} />
              </div>
              <div className="row">
                <label>{t("Sun color")}</label>
                <ColorEdit value={env.sun_color} onChange={(c) => !ro && set("sun_color", { type: "Color", ...c })} />
              </div>
              {FLOATS.map(([k, label, min, max, step]) => (
                <div className="row" key={k}>
                  <label>{label}</label>
                  <FloatEdit value={env[k]} min={min} max={max} step={step} allowExpr={false} onChange={(v) => !ro && set(k, Number(v))} />
                </div>
              ))}
              {!ro && (
                <button
                  onClick={() => {
                    deleteEnvironment(sel);
                    select(Math.max(0, sel - 1));
                  }}
                >
                  {t("Delete this environment")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
