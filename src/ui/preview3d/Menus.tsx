/* The 3D preview's menus (material_maker/panels/preview_3d: model_menu.gd, mesh_config_popup.gd, environment_menu.gd,
 * post_process_menu.gd): which object, its UV scale, tessellation and shape parameters, how fast it turns; which
 * environment and whether the background shows; tone mapping, glow, adjustments and depth of field; the camera. */
import { useEffect, useRef, useState } from "react";
import { PREVIEW_OBJECTS, objectByKey } from "./objects";
import { DEFAULT_POST, objectSettings, updateObject, updatePost, updateSettings, usePreview3DSettings, type PostProcess } from "./settings";
import { ensureThumbnail, isReadOnly, useEnvironments } from "./environments";
import { EnvironmentEditor } from "./EnvironmentEditor";
import { TONEMAP_LABELS } from "./postprocess";
import { FloatEdit } from "../widgets/FloatEdit";
import { t } from "../i18n";

function Panel({ label, title, children }: { label: string; title?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".popover, .modal-back") && setOpen(false);
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button onClick={() => setOpen(!open)} title={title} className={open ? "on" : ""}>
        {label} ▾
      </button>
      {open && <div className="menu-list p3d-panel">{children(() => setOpen(false))}</div>}
    </div>
  );
}

const SPEEDS = ["Pause", "Slow", "Medium", "Fast"];

export function ModelMenu({ onLoadModel, hasCustom }: { onLoadModel: () => void; hasCustom: boolean }) {
  const s = usePreview3DSettings();
  const obj = objectByKey(s.object);
  const os = objectSettings(obj.key);
  const [linked, setLinked] = useState(os.uvScale[0] === os.uvScale[1]);
  return (
    <Panel label={t(obj.label)} title={t("Model")}>
      {() => (
        <div className="insp" style={{ padding: 4, minWidth: 260 }}>
          <div className="row">
            <label>{t("Model")}</label>
            <select
              value={obj.key}
              onChange={(e) => {
                if (e.target.value === "custom" && !hasCustom) onLoadModel();
                else updateSettings({ object: e.target.value });
              }}
            >
              {PREVIEW_OBJECTS.map((o) => (
                <option key={o.key} value={o.key}>
                  {t(o.label)}
                </option>
              ))}
            </select>
          </div>
          <button onClick={onLoadModel}>{t("Load a model… (.obj, .glb, .gltf)")}</button>
          <div className="sect">{t("Configure {0}", t(obj.label))}</div>
          <div className="row">
            <label>{t("UV scale")}</label>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <FloatEdit value={os.uvScale[0]} min={0.1} max={10} step={0.1} allowExpr={false} onChange={(v) => updateObject(obj.key, { uvScale: [Number(v), linked ? Number(v) : os.uvScale[1]] })} />
              {!linked && <FloatEdit value={os.uvScale[1]} min={0.1} max={10} step={0.1} allowExpr={false} onChange={(v) => updateObject(obj.key, { uvScale: [os.uvScale[0], Number(v)] })} />}
              <button title={t("Same scale in both directions")} className={linked ? "on" : ""} onClick={() => setLinked(!linked)}>
                🔗
              </button>
            </div>
          </div>
          {obj.canTessellate && (
            <div className="row">
              <label>{t("Tessellated")}</label>
              <input type="checkbox" checked={os.tessellated} onChange={(e) => updateObject(obj.key, { tessellated: e.target.checked })} />
            </div>
          )}
          {obj.params.map((p) => (
            <div className="row" key={p.name}>
              <label>{t(p.label)}</label>
              <FloatEdit value={os.params[p.name] ?? p.default} min={p.min} max={p.max} step={0.01} allowExpr={false} onChange={(v) => updateObject(obj.key, { params: { ...os.params, [p.name]: Number(v) } })} />
            </div>
          ))}
          <div className="sect">{t("Rotation")}</div>
          <div style={{ display: "flex", gap: 2 }}>
            {SPEEDS.map((l, i) => (
              <button key={l} className={s.rotationSpeed === i ? "on" : ""} onClick={() => updateSettings({ rotationSpeed: i })}>
                {t(l)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function EnvironmentMenu() {
  const s = usePreview3DSettings();
  const list = useEnvironments();
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    list.forEach((e, i) => !e.thumbnail && !isReadOnly(i) && ensureThumbnail(i));
  }, [list]);
  const cur = list[s.environment] ?? list[0];
  return (
    <>
      <Panel label={cur?.name ?? t("Environment")} title={t("Environment")}>
        {(close) => (
          <div style={{ padding: 4, width: 250 }}>
            <div className="env-grid">
              {list.map((e, i) => (
                <button key={i} className={"env-cell" + (i === s.environment ? " on" : "")} title={e.name} onClick={() => updateSettings({ environment: i })}>
                  {e.thumbnail ? <img src={"data:image/png;base64," + e.thumbnail} alt={e.name} /> : <span>{e.name}</span>}
                </button>
              ))}
            </div>
            <label style={{ display: "flex", gap: 6, margin: "6px 0" }}>
              <input type="checkbox" checked={s.clearBackground} onChange={(e) => updateSettings({ clearBackground: e.target.checked })} />{" "}{t("Clear background")}
            </label>
            <button
              onClick={() => {
                close();
                setEditing(true);
              }}
            >
              {t("Environment editor…")}
            </button>
          </div>
        )}
      </Panel>
      {editing && <EnvironmentEditor onClose={() => setEditing(false)} />}
    </>
  );
}

export function PostProcessMenu() {
  const s = usePreview3DSettings();
  const p = s.post;
  const f = (k: keyof PostProcess, label: string, min: number, max: number, step = 0.01) => (
    <div className="row" key={k}>
      <label>{label}</label>
      <FloatEdit value={p[k] as number} min={min} max={max} step={step} allowExpr={false} onChange={(v) => updatePost({ [k]: Number(v) })} />
    </div>
  );
  return (
    <Panel label={t("Post process")} title={t("Post processing")}>
      {() => (
        <div className="insp" style={{ padding: 4, minWidth: 260 }}>
          <div className="sect">{t("Tonemap")}</div>
          <div className="row">
            <label>{t("Mode")}</label>
            <select value={p.tonemap} onChange={(e) => updatePost({ tonemap: e.target.value as PostProcess["tonemap"] })}>
              {Object.entries(TONEMAP_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {t(l)}
                </option>
              ))}
            </select>
          </div>
          {f("exposure", "Exposure", 0, 4)}
          <div className="sect">
            <label>
              <input type="checkbox" checked={p.glow} onChange={(e) => updatePost({ glow: e.target.checked })} />{" "}{t("Glow")}
            </label>
          </div>
          {p.glow && [f("glowIntensity", "Intensity", 0, 4), f("glowStrength", "Strength", 0, 2), f("glowThreshold", "Threshold", 0, 4)]}
          <div className="sect">
            <label>
              <input type="checkbox" checked={p.adjust} onChange={(e) => updatePost({ adjust: e.target.checked })} />{" "}{t("Adjustments")}
            </label>
          </div>
          {p.adjust && [f("brightness", "Brightness", 0, 4), f("contrast", "Contrast", 0, 4), f("saturation", "Saturation", 0, 4)]}
          <div className="sect">
            <label>
              <input type="checkbox" checked={p.dof} onChange={(e) => updatePost({ dof: e.target.checked })} />{" "}{t("Depth of field")}
            </label>
          </div>
          {p.dof && [f("dofAperture", "Aperture", 0, 0.02, 0.0005), f("dofMaxBlur", "Max blur", 0, 0.05, 0.001)]}
          <button onClick={() => updatePost({ ...DEFAULT_POST })}>{t("Reset")}</button>
        </div>
      )}
    </Panel>
  );
}

export function CameraMenu({ onReset }: { onReset: () => void }) {
  const s = usePreview3DSettings();
  return (
    <Panel label={t("Camera")} title={t("Camera and light")}>
      {() => (
        <div className="insp" style={{ padding: 4, minWidth: 240 }}>
          <button onClick={onReset}>{t("Reset camera and model rotation")}</button>
          <div className="row">
            <label>{t("Field of view")}</label>
            <FloatEdit value={s.fov} min={10} max={90} step={1} allowExpr={false} onChange={(v) => updateSettings({ fov: Number(v) })} />
          </div>
          <div className="row">
            <label>{t("Sun shadow")}</label>
            <input type="checkbox" checked={s.sunShadow} onChange={(e) => updateSettings({ sunShadow: e.target.checked })} />
          </div>
          <div style={{ color: "var(--text3)" }}>{t("Drag: orbit · Ctrl+drag: turn the model · right drag: pan · wheel: zoom · Ctrl+wheel: field of view")}</div>
        </div>
      )}
    </Panel>
  );
}
