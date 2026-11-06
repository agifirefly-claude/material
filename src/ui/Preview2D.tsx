/* The 2D preview panel (port of panels/preview_2d): the selected (or locked) node output evaluated through a view
 * that pans and zooms, with Extend/Repeat/Clamp modes, a low resolution filter, guides, transparency checkers,
 * the parameter handles of the node and its export menu. */
import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "./store";
import { GenMaterial } from "../engine/gen/misc";
import type { Gen } from "../engine/gen/base";
import { portLabel } from "./NodeView";
import { CHECKER_BRIGHTNESS, CHECKER_SIZES, GUIDES, POSTPROCESS, VIEW_MODES, defaultView, viewShaderCode, type View } from "./preview2d/view";
import { Gizmos } from "./preview2d/Gizmos";
import { canvasBlob, canvasOf, exportImage, IMAGE_TYPES, interpretFileName, serviceImage, type ImageType } from "./preview2d/exports";
import { openExportDialog } from "./preview2d/Dialogs";
import { references } from "./Reference";
import { t } from "./i18n";

interface Settings {
  view: View;
  guides: number;
  gridSize: number;
  guideColor: string;
  controls: boolean;
  exportName: string;
  exportType: ImageType;
  exportSize: number;
}
const KEY = "material-pro:preview2d";
function loadSettings(): Settings {
  const d: Settings = { view: defaultView(), guides: 0, gridSize: 8, guideColor: "#808080", controls: true, exportName: "$node", exportType: "png", exportSize: 1024 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...d, ...s, view: { ...d.view, ...(s.view ?? {}) } };
  } catch {
    return d;
  }
}

const outputsOf = (g: Gen) => (g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs());

export function Preview2D() {
  useEditor();
  const [locked, setLocked] = useState<Gen | null>(null);
  const g = locked && locked.parent ? locked : editor.selected;
  const [st, setSt] = useState<Settings>(loadSettings);
  const [output, setOutput] = useState(0);
  const [menu, setMenu] = useState<"view" | "export" | null>(null);
  const [error, setError] = useState("");
  const [box, setBox] = useState(300);
  const [tick, setTick] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const busy = useRef<Promise<unknown> | null>(null);
  const view = st.view;
  const set = (p: Partial<Settings>) =>
    setSt((s) => {
      const n = { ...s, ...p };
      try {
        localStorage.setItem(KEY, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  const setView = (p: Partial<View>) => set({ view: { ...view, ...p } });

  useEffect(() => setOutput(g && g.preview >= 0 ? g.preview : 0), [g]);
  const outs = g ? outputsOf(g) : [];
  const o = Math.max(0, Math.min(output, outs.length - 1));

  useEffect(() => {
    const ro = new ResizeObserver(() => body.current && setBox(Math.max(64, Math.floor(Math.min(body.current.clientWidth, body.current.clientHeight)))));
    ro.observe(body.current!);
    return () => ro.disconnect();
  }, []);
  const res = Math.min(1024, Math.round(box * Math.min(2, window.devicePixelRatio || 1)));

  // render the view; again every frame while the image depends on the time
  // (in the render worker: the page only builds the shader; one render at a time, the newest request wins)
  useEffect(() => {
    const r = editor.renders;
    if (!r || !g || !outs.length || !canvas.current) return;
    let stale = false;
    const id = requestAnimationFrame(async () => {
      await busy.current;
      if (stale || !canvas.current) return;
      try {
        r.time = performance.now() / 1000;
        const job = r.previews([{ key: "preview2d", sc: viewShaderCode(g, o, view, res), size: res, preview: false, ctx: canvas.current.getContext("2d")!, checker: false, force: true }], { lane: "view" });
        busy.current = job.catch(() => null);
        const [out] = await job;
        setError(out.error ? out.error.message : "");
        if (out.usesTime && !stale) setTick((t) => t + 1);
      } catch (e) {
        setError(String(e));
      }
    });
    return () => {
      stale = true;
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, o, view, res, editor.contentVersion, tick]);

  /* pan and zoom (_on_gui_input) */
  const zoomAt = (clientX: number, clientY: number, newScale: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const off = { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
    newScale = Math.min(5, Math.max(0.005, newScale));
    const c = { x: view.center.x + (off.x * (view.scale - newScale)) / rect.width, y: view.center.y + (off.y * (view.scale - newScale)) / rect.height };
    setView({ scale: newScale, center: { x: Math.min(1, Math.max(0, c.x)), y: Math.min(1, Math.max(0, c.y)) } });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const pan = e.button === 1 || (e.button === 0 && e.shiftKey);
    const zoom = e.button === 0 && (e.ctrlKey || e.metaKey);
    if (!pan && !zoom) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX,
      ly = e.clientY;
    let v = view;
    const move = (ev: PointerEvent) => {
      const w = canvas.current!.getBoundingClientRect().width;
      if (pan) v = { ...v, center: { x: Math.min(1, Math.max(0, v.center.x - ((ev.clientX - lx) * v.scale) / w)), y: Math.min(1, Math.max(0, v.center.y - ((ev.clientY - ly) * v.scale) / w)) } };
      else v = { ...v, scale: Math.min(5, Math.max(0.005, v.scale * (1 + 0.01 * (ev.clientY - ly)))) };
      lx = ev.clientX;
      ly = ev.clientY;
      set({ view: v });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const exportName = g ? interpretFileName(st.exportName, g, o, st.exportSize, editor.title) : "";
  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        <button title={t("Reset the view")} onClick={() => setView({ center: { x: 0.5, y: 0.5 }, scale: 1.2 })}>
          ⟲
        </button>
        <div className="menu">
          <button onClick={() => setMenu(menu === "view" ? null : "view")}>{t("View ▾")}</button>
          {menu === "view" && (
            <div className="menu-list pv2-menu" onMouseLeave={() => setMenu(null)}>
              <div className="dlg-grid">
                <label>{t("View")}</label>
                <select value={view.mode} onChange={(e) => setView({ mode: +e.target.value })}>
                  {VIEW_MODES.map((m, i) => (
                    <option key={m} value={i}>
                      {t(m)}
                    </option>
                  ))}
                </select>
                <label>{t("Filter")}</label>
                <select value={view.filter} onChange={(e) => setView({ filter: +e.target.value })}>
                  {POSTPROCESS.map((n, i) => (
                    <option key={n} value={i}>
                      {n ? t("Lowres {0}×{1}", n, n) : t("None")}
                    </option>
                  ))}
                </select>
                <label>{t("Guides")}</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <select value={st.guides} onChange={(e) => set({ guides: +e.target.value })}>
                    {GUIDES.map((m, i) => (
                      <option key={m} value={i}>
                        {t(m)}
                      </option>
                    ))}
                  </select>
                  {st.guides === 3 && <input type="number" min={1} max={64} value={st.gridSize} onChange={(e) => set({ gridSize: Math.max(1, +e.target.value) })} style={{ width: 52 }} title={t("Grid size")} />}
                  <input type="color" value={st.guideColor} onChange={(e) => set({ guideColor: e.target.value })} title={t("Guides colour")} style={{ width: 28, padding: 0 }} />
                </div>
                <label>{t("Alpha")}</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <select value={view.checkerBrightness} onChange={(e) => setView({ checkerBrightness: +e.target.value })} title={t("Transparency checkers brightness")}>
                    {["Light", "Mid-tones", "Dark"].slice(0, CHECKER_BRIGHTNESS.length).map((m, i) => (
                      <option key={m} value={i}>
                        {t(m)}
                      </option>
                    ))}
                  </select>
                  <select value={view.checkerSize} onChange={(e) => setView({ checkerSize: +e.target.value })} title={t("Transparency checkers size")}>
                    {CHECKER_SIZES.map((n, i) => (
                      <option key={n} value={i}>
                        {t(["Small", "Medium", "Large"][i])}
                      </option>
                    ))}
                  </select>
                </div>
                <label>{t("Controls")}</label>
                <input type="checkbox" checked={st.controls} onChange={(e) => set({ controls: e.target.checked })} style={{ justifySelf: "start" }} />
              </div>
            </div>
          )}
        </div>
        <div className="menu">
          <button disabled={!g || !outs.length} onClick={() => setMenu(menu === "export" ? null : "export")}>
            {t("Export ▾")}
          </button>
          {menu === "export" && g && (
            <div className="menu-list pv2-menu" style={{ width: 290 }}>
              <div className="dlg-grid">
                <label>{t("File")}</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="text" value={st.exportName} onChange={(e) => set({ exportName: e.target.value })} title={t("$node, $output, $resolution and $project can be used")} style={{ flex: 1 }} />
                  <select value={st.exportType} onChange={(e) => set({ exportType: e.target.value as ImageType })}>
                    {Object.keys(IMAGE_TYPES).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <span />
                <span style={{ color: "var(--text3)" }}>
                  {exportName}.{st.exportType}
                </span>
                <label>{t("Resolution")}</label>
                <select value={st.exportSize} onChange={(e) => set({ exportSize: +e.target.value })}>
                  {[256, 512, 1024, 2048, 4096].map((s) => (
                    <option key={s} value={s}>
                      {s}×{s}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
                <button onClick={() => (setMenu(null), exportImage(editor.renders!, g, o, st.exportSize, st.exportType, exportName))}>{t("Image")}</button>
                <button
                  onClick={async () => {
                    setMenu(null);
                    const blob = await canvasBlob(canvasOf(await serviceImage(editor.renders!, g, o, st.exportSize)));
                    references.add(URL.createObjectURL(blob), exportName);
                    editor.setStatus(t("Exported to Reference"));
                  }}
                >
                  {t("To Reference")}
                </button>
                <button
                  title={t("Copy the image at the chosen resolution, to paste it in another application")}
                  onClick={async () => {
                    setMenu(null);
                    try {
                      const blob = await canvasBlob(canvasOf(await serviceImage(editor.renders!, g, o, st.exportSize)));
                      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
                      editor.setStatus(t("Image copied"));
                    } catch (err) {
                      editor.setStatus(t("Could not copy the image: {0}", err instanceof Error ? err.message : String(err)));
                    }
                  }}
                >
                  {t("Copy")}
                </button>
                <button onClick={() => (setMenu(null), openExportDialog({ kind: "animation", gen: g, output: o }))}>{t("Animation…")}</button>
                <button onClick={() => (setMenu(null), openExportDialog({ kind: "taa", gen: g, output: o }))}>{t("TAA Render…")}</button>
              </div>
            </div>
          )}
        </div>
        {outs.length > 1 && (
          <select value={o} onChange={(e) => setOutput(+e.target.value)}>
            {outs.map((p, i) => (
              <option key={i} value={i}>
                {i}: {portLabel(p, i, true) || p.type}
              </option>
            ))}
          </select>
        )}
        <span className="grow" />
        <button className={locked ? "primary" : ""} disabled={!g} title={locked ? t("Unlock: show the selected node") : t("Lock this preview on this node")} onClick={() => setLocked(locked ? null : (g ?? null))}>
          {locked ? "🔒" : "🔓"}
        </button>
      </div>
      <div
        className="body"
        ref={body}
        onWheel={(e) => g && zoomAt(e.clientX, e.clientY, view.scale * (e.deltaY > 0 ? 1.05 : 0.95))}
        onPointerDown={onPointerDown}
        onAuxClick={(e) => e.preventDefault()}
        title={t("Middle button or shift+drag: pan · wheel or ctrl+drag: zoom")}
      >
        {g && outs.length > 0 ? (
          <div className="pv2-stage" style={{ width: box, height: box }}>
            <canvas ref={canvas} width={res} height={res} style={{ width: box, height: box }} />
            {st.controls && <Gizmos gen={g} view={view} size={box} guides={st.guides} gridSize={st.gridSize} guideColor={st.guideColor} />}
            {!st.controls && st.guides > 0 && <Gizmos gen={{ getParameterDefs: () => [] } as unknown as Gen} view={view} size={box} guides={st.guides} gridSize={st.gridSize} guideColor={st.guideColor} />}
          </div>
        ) : (
          <div className="empty">{g ? t("This node has no output to preview") : t("Select a node to preview it")}</div>
        )}
        {error && <div className="empty" style={{ position: "absolute", inset: "auto 0 0 0", background: "#000a", color: "var(--danger)" }}>{error}</div>}
      </div>
    </div>
  );
}
