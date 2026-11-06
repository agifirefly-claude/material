/* Preferences (windows/preferences), About (windows/about), panel layouts (windows/panels_presets_dialog), global
 * parameters, and the host that shows every dialog opened through the bus. */
import { useEffect, useState } from "react";
import type { Gen } from "../../engine/gen/base";
import { registry } from "../../engine/registry";
import { editor } from "../store";
import { DEFAULT_LAYOUT, getPrefs, setPrefs, usePrefs, type Layout } from "../prefs";
import { LANGUAGES, setLanguage, t, useLang } from "../i18n";
import { NodeEditor } from "../nodeEditor/NodeEditor";
import { AddToLibraryDialog, LibrariesDialog } from "./LibraryDialogs";
import type { DialogKind } from "./bus";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pref-row" title={hint}>
      <span>{label}</span>
      {children}
    </div>
  );
}

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const lang = useLang();
  const p = usePrefs();
  const check = (k: keyof typeof p) => <input type="checkbox" checked={!!p[k]} onChange={(e) => setPrefs({ [k]: e.target.checked })} />;
  const [globals, setGlobals] = useState(() => Object.entries(registry.globalParameters));
  const saveGlobals = (g: [string, number][]) => {
    setGlobals(g);
    registry.globalParameters = Object.fromEntries(g.filter(([k]) => /^[A-Za-z_]\w*$/.test(k)));
    try {
      localStorage.setItem("material-pro:globals", JSON.stringify(registry.globalParameters));
    } catch {
      /* ignore */
    }
    editor.root.notifyChanged();
  };
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
      <h2>{t("Preferences")}</h2>
      <div className="sect">{t("General")}</div>
      <Row label={t("Language")}>
        <select value={lang} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("UI scale (0 = auto)")}>
        <select value={p.uiScale} onChange={(e) => setPrefs({ uiScale: +e.target.value })}>
          {[0, 75, 90, 100, 110, 125, 150, 175, 200].map((s) => (
            <option key={s} value={s}>
              {s ? s + "%" : t("auto")}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Confirm when closing a project")}>{check("confirmCloseProject")}</Row>
      <Row label={t("Dim background when showing dialogs")}>{check("dimBackground")}</Row>
      <Row label={t("Save the project in the browser as you work")}>{check("autosave")}</Row>
      <div className="sect">{t("Graph")}</div>
      <Row label={t("Auto size comment node to selection")}>{check("autoSizeComment")}</Row>
      <Row label={t("Size of new materials")}>
        <select value={p.defaultMaterialSize} onChange={(e) => setPrefs({ defaultMaterialSize: +e.target.value })}>
          {[8, 9, 10, 11, 12, 13].map((i) => (
            <option key={i} value={i}>
              {2 ** i}×{2 ** i}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Node preview resolution")}>
        <select value={p.nodePreviewSize} onChange={(e) => setPrefs({ nodePreviewSize: +e.target.value })}>
          {[64, 96, 128, 192, 256].map((i) => (
            <option key={i} value={i}>
              {i}{t("px")}
            </option>
          ))}
        </select>
      </Row>
      <div className="sect">{t("3D preview")}</div>
      <Row label={t("3D preview resolution")}>
        <select value={p.preview3dResolution} onChange={(e) => setPrefs({ preview3dResolution: +e.target.value })}>
          {[256, 512, 1024, 2048].map((i) => (
            <option key={i} value={i}>
              {i}{t("px")}
            </option>
          ))}
        </select>
      </Row>
      <div className="sect">{t("Global parameters")}</div>
      <div style={{ color: "var(--text3)", marginBottom: 4 }}>{t("Values every node can read as $name (Material Maker's global parameters).")}</div>
      {globals.map(([k, v], i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginBottom: 3 }}>
          <input type="text" value={k} onChange={(e) => saveGlobals(globals.map((g, j) => (j === i ? [e.target.value, g[1]] : g)))} onKeyDown={(e) => e.stopPropagation()} />
          <input type="number" step="any" value={v} onChange={(e) => saveGlobals(globals.map((g, j) => (j === i ? [g[0], +e.target.value] : g)))} />
          <button onClick={() => saveGlobals(globals.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button onClick={() => saveGlobals([...globals, ["global_" + (globals.length + 1), 0]])}>+ {t("Global parameter")}</button>
      <div className="ne-buttons">
        <button onClick={() => setPrefs({ ...getPrefs(), uiScale: 0 })}>{t("Reset scale")}</button>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  useLang();
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
      <h2>{t("Material Pro")}</h2>
      <p>{t("A web port of Material Maker: procedural textures and materials made with node graphs, in the browser.")}</p>
      <p style={{ color: "var(--text2)" }}>
        {t("Material Maker © 2018-present Rodolphe Suescun and contributors — MIT")}
        <br />
        <a href="https://github.com/RodZill4/material-maker" target="_blank" rel="noreferrer">
          github.com/RodZill4/material-maker
        </a>{" "}
        ·{" "}
        <a href="https://www.materialmaker.org" target="_blank" rel="noreferrer">
          materialmaker.org
        </a>
      </p>
      <p style={{ color: "var(--text3)" }}>
        {t("{0} node definitions, {1} library items.", Object.keys(registry.nodes).length, registry.library.length)} {t("HDR environments from Poly Haven (CC0).")}
      </p>
      <div className="ne-buttons">
        <button className="primary" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}

export function LayoutsDialog({ onClose }: { onClose: () => void }) {
  useLang();
  const p = usePrefs();
  const setLayout = (l: Partial<Layout>) => setPrefs({ layout: { ...p.layout, ...l } });
  const [name, setName] = useState("");
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
      <h2>{t("Panel layout")}</h2>
      <Row label={t("Library panel")}>
        <input type="checkbox" checked={p.layout.showLibrary} onChange={(e) => setLayout({ showLibrary: e.target.checked })} />
      </Row>
      <Row label={t("Preview and inspector panel")}>
        <input type="checkbox" checked={p.layout.showRight} onChange={(e) => setLayout({ showRight: e.target.checked })} />
      </Row>
      <Row label={t("Library width")}>
        <input type="range" min={160} max={480} value={p.layout.left} onChange={(e) => setLayout({ left: +e.target.value })} />
      </Row>
      <Row label={t("Right panel width")}>
        <input type="range" min={260} max={760} value={p.layout.right} onChange={(e) => setLayout({ right: +e.target.value })} />
      </Row>
      <Row label={t("Preview height")}>
        <input type="range" min={20} max={80} value={p.layout.previewHeight} onChange={(e) => setLayout({ previewHeight: +e.target.value })} />
      </Row>
      <div className="sect">{t("Presets")}</div>
      {Object.keys(p.layoutPresets).map((k) => (
        <div key={k} style={{ display: "flex", gap: 4, marginBottom: 3 }}>
          <button style={{ flex: 1, textAlign: "left" }} onClick={() => setPrefs({ layout: { ...p.layoutPresets[k] } })}>
            {k}
          </button>
          <button
            onClick={() => {
              const x = { ...p.layoutPresets };
              delete x[k];
              setPrefs({ layoutPresets: x });
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 4 }}>
        <input type="text" placeholder={t("Preset name")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button disabled={!name} onClick={() => (setPrefs({ layoutPresets: { ...p.layoutPresets, [name]: { ...p.layout } } }), setName(""))}>
          {t("Save current layout")}
        </button>
      </div>
      <div className="ne-buttons">
        <button onClick={() => setPrefs({ layout: { ...DEFAULT_LAYOUT } })}>{t("Default layout")}</button>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </div>
  );
}

/** shows the dialogs opened with openDialog() */
export function DialogHost() {
  const [d, setD] = useState<{ kind: DialogKind; payload?: unknown } | null>(null);
  const prefs = usePrefs();
  useEffect(() => {
    const h = (e: Event) => setD((e as CustomEvent).detail);
    window.addEventListener("mm-dialog", h);
    return () => window.removeEventListener("mm-dialog", h);
  }, []);
  if (!d) return null;
  const close = () => setD(null);
  let body: React.ReactNode = null;
  switch (d.kind) {
    case "edit-node":
      body = <NodeEditor gen={d.payload as Gen} onClose={close} />;
      break;
    case "add-to-library":
      body = <AddToLibraryDialog payload={d.payload as Gen} onClose={close} />;
      break;
    case "libraries":
      body = <LibrariesDialog onClose={close} />;
      break;
    case "preferences":
      body = <PreferencesDialog onClose={close} />;
      break;
    case "about":
      body = <AboutDialog onClose={close} />;
      break;
    case "layouts":
      body = <LayoutsDialog onClose={close} />;
      break;
  }
  return (
    <div className="modal-back" style={prefs.dimBackground ? undefined : { background: "transparent" }} onClick={close} onKeyDown={(e) => e.key === "Escape" && close()}>
      {body}
    </div>
  );
}
