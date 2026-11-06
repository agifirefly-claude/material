/* The paint mode's panels: tools and brush settings (paint.tscn's Tools and OptionsPanel), the brush's own parameters
 * (its graph's remote), the brush library (panels/brushes), the layers (panels/layers with layer_config_popup) and the
 * project settings (paint_project_settings). */
import { useEffect, useState } from "react";
import { paint, pickFiles, decodeImage, usePaint, TOOL_LABELS } from "./paintStore";
import { ParamControl, paramLabel } from "../widgets/ParamControl";
import { FloatEdit } from "../widgets/FloatEdit";
import { CHANNELS, LAYER_MASK, LAYER_PAINT, LAYER_PROC, findParentArray, type Layer, type MapChannel } from "../../engine/paint/layers";
import { editor } from "../store";
import { t } from "../i18n";
import { brushThumbnail } from "./brushPreview";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function ToolsPanel() {
  usePaint();
  const p = paint.project!;
  const prm = p.painter.params;
  const set = (k: keyof typeof prm, v: number | string) => {
    (prm as unknown as Record<string, number>)[k] = Number(v);
    paint.emit();
  };
  return (
    <div className="insp">
      <div className="paint-tools">
        {TOOL_LABELS.map((l, i) => (
          <button key={l} className={paint.tool === i ? "primary" : ""} onClick={() => ((paint.tool = i), paint.emit())} title={t(l)}>
            {t(l)}
          </button>
        ))}
      </div>
      <div className="paint-tools">
        <button className={paint.eraser ? "primary" : ""} onClick={() => ((paint.eraser = !paint.eraser), paint.emit())} title={t("Erase instead of painting")}>
          {t("Eraser")}
        </button>
        <button disabled={!p.selected || p.selected.type === LAYER_PROC} onClick={() => p.fill(paint.eraser)} title={t("Fill the whole layer with the brush")}>
          {t("Fill")}
        </button>
        <button className={paint.textureEngine ? "primary" : ""} onClick={() => ((paint.textureEngine = !paint.textureEngine), paint.emit())} title={t("Paint engine: in view space, or in texture space through the view")}>
          {paint.textureEngine ? t("Texture space") : t("View space")}
        </button>
        <button disabled={!p.canUndo()} onClick={() => p.undo()} title={t("Undo the last stroke on this layer (Ctrl+Z)")}>
          {t("Undo")}
        </button>
        <button disabled={!p.canRedo()} onClick={() => p.redo()} title={t("Redo (Ctrl+Shift+Z)")}>
          {t("Redo")}
        </button>
      </div>
      {paint.tool === 5 && (
        <div className="paint-tools">
          <button
            onClick={async () => {
              const [f] = await pickFiles("image/png,image/*");
              if (!f) return;
              const img = await decodeImage(f.data);
              p.setIdMap(p.textureFromPixels(img.width, img.height, img.data), f);
              paint.emit();
            }}
          >
            {p.idMap ? t("Replace ID map…") : t("Load ID map…")}
          </button>
          {p.painter.idMask && (
            <button onClick={() => ((p.painter.idMask = null), paint.emit())}>
              {t("Clear ID mask")}{" "}<span className="dot" style={{ background: `rgb(${p.painter.idMask.slice(0, 3).map((x) => x * 255).join(",")})` }} />
            </button>
          )}
        </div>
      )}
      <div className="sect">{t("Brush")}</div>
      <Row label={t("Size")}>
        <FloatEdit value={prm.brush_size} min={0} max={250} step={1} allowExpr={false} onChange={(v) => set("brush_size", v)} />
      </Row>
      <Row label={t("Hardness")}>
        <FloatEdit value={prm.brush_hardness} min={0} max={1} step={0.01} allowExpr={false} onChange={(v) => set("brush_hardness", v)} />
      </Row>
      <Row label={t("Opacity")}>
        <FloatEdit value={prm.brush_opacity} min={0} max={1} step={0.01} allowExpr={false} onChange={(v) => set("brush_opacity", v)} />
      </Row>
      <Row label={t("Spacing")}>
        <FloatEdit value={paint.spacing} min={1} max={250} step={1} allowExpr={false} onChange={(v) => ((paint.spacing = Number(v)), paint.emit())} />
      </Row>
      <Row label={t("Angle")}>
        <FloatEdit value={(prm.pattern_angle * 180) / Math.PI} min={-180} max={180} step={1} allowExpr={false} onChange={(v) => set("pattern_angle", (Number(v) * Math.PI) / 180)} />
      </Row>
      <Row label={t("Pattern scale")}>
        <FloatEdit value={prm.pattern_scale} min={0.1} max={25} step={0.1} allowExpr={false} onChange={(v) => set("pattern_scale", v)} />
      </Row>
      <Row label={t("Pen pressure")}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["size", "opacity", "hardness"] as const).map((k) => (
            <label key={k} style={{ display: "flex", gap: 3 }}>
              <input type="checkbox" checked={paint.pressure[k]} onChange={(e) => ((paint.pressure[k] = e.target.checked), paint.emit())} /> {t(k)}
            </label>
          ))}
        </div>
      </Row>
      <details>
        <summary>{t("Jitter")}</summary>
        {(["jitter_position", "jitter_size", "jitter_angle", "jitter_opacity"] as const).map((k) => (
          <Row key={k} label={k.slice(7)}>
            <FloatEdit value={prm[k]} min={0} max={k === "jitter_position" ? 250 : 1} step={k === "jitter_position" ? 1 : 0.01} allowExpr={false} onChange={(v) => set(k, v)} />
          </Row>
        ))}
      </details>
      <BrushParams />
    </div>
  );
}

/** the brush graph's remote, as Material Maker's Parameters panel shows it in paint mode */
function BrushParams() {
  usePaint();
  const p = paint.project!;
  const r = p.brushRemote;
  const err = p.painter.checkBrush();
  return (
    <>
      <div className="sect">{t("Brush parameters ·")}{" "}{t(p.painter.brushMode)}</div>
      {err && <div className="err">{err}</div>}
      {!r && <div style={{ color: "var(--text3)" }}>{t("This brush has no parameters panel. Edit its graph below.")}</div>}
      {r?.getParameterDefs().map((d) => (
        <div key={d.name} className="row" style={["gradient", "curve", "polygon"].includes(d.type) ? { gridTemplateColumns: "1fr" } : undefined}>
          <label title={d.longdesc ?? d.name}>{paramLabel(d)}</label>
          <ParamControl gen={r} def={d} />
        </div>
      ))}
    </>
  );
}

export function BrushesPanel() {
  usePaint();
  const [q, setQ] = useState("");
  const list = paint.brushes.filter((b) => b.tree_item.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h3>
        {t("Brushes")}{" "}<span className="grow" />
        <button
          title={t("Add the current brush to the brush library (Tools > Add current brush to library)")}
          onClick={() => {
            const n = prompt(t("Brush name"));
            if (n) paint.addBrushToLibrary(n);
          }}
        >
          {t("+ Save brush")}
        </button>
      </h3>
      <CurrentBrush />
      <div className="lib-search">
        <input type="search" placeholder={t("Search brushes")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll tree brush-grid">
        {list.map((b) => (
          <button key={b.tree_item} className="brush-item" title={b.tree_item + (b.longdesc ? "\n" + b.longdesc : "")} onClick={() => paint.setBrush(b)}>
            {b.icon_data ? <img src={"data:image/png;base64," + b.icon_data} alt="" /> : <span className="brush-noicon" />}
            <span>{t(b.tree_item.split("/").pop() ?? "")}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** the current brush, drawn live: one dab on a plane, redone when its graph changes */
function CurrentBrush() {
  usePaint();
  const p = paint.project;
  const [img, setImg] = useState("");
  const graph = p?.brushGraph;
  const version = p?.version ?? 0;
  useEffect(() => {
    if (!graph || !editor.renderer) return;
    const data = graph.serialize();
    const key = JSON.stringify(data);
    const hit = thumbCache.get(key);
    if (hit) return setImg(hit);
    const timer = setTimeout(() => {
      brushThumbnail(editor.renderer!, data, 96).then((png) => {
        thumbCache.set(key, png);
        if (thumbCache.size > 64) thumbCache.delete(thumbCache.keys().next().value!);
        setImg(png);
      }, (e) => console.warn("brush preview", e));
    }, 250);
    return () => clearTimeout(timer);
  }, [graph, version]);
  if (!p) return null;
  return (
    <div className="current-brush" title={t("The current brush")}>
      {img ? <img src={"data:image/png;base64," + img} alt="" /> : <span className="brush-noicon" />}
      <div>
        <div style={{ color: "#fff" }}>{t("Current brush")}</div>
        <div style={{ color: "var(--text3)" }}>{t(graph?.label && graph.label !== "Graph" ? graph.label : "Brush")}</div>
      </div>
    </div>
  );
}
const thumbCache = new Map<string, string>();

const TYPE_ICON = ["🖌", "⚙", "◐"];
const TYPE_NAME = ["Paint layer", "Procedural layer", "Mask"];

export function LayersPanel() {
  usePaint();
  const p = paint.project!;
  const sel = p.selected;
  const [drag, setDrag] = useState<Layer | null>(null);
  const rows: React.ReactNode[] = [];
  const walk = (layers: Layer[], depth: number) => {
    for (const l of layers) {
      rows.push(
        <div
          key={l.uid}
          className={"layer-row" + (l === sel ? " sel" : "")}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={() => setDrag(l)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (drag && drag !== l) {
              // dropping on the right half nests, on the left half places before
              const r = e.currentTarget.getBoundingClientRect();
              if (e.clientX > r.left + r.width / 2 && l.type !== LAYER_MASK) p.moveLayerInto(drag, l, 0);
              else {
                const parent = findParentArray(l, p.layers)!;
                const owner = parent === p.layers ? null : allOwners(p.layers).get(parent) ?? null;
                p.moveLayerInto(drag, owner, parent.indexOf(l));
              }
            }
            setDrag(null);
          }}
          onClick={() => p.selectLayer(l)}
          onDoubleClick={() => {
            const n = prompt(t("Layer name"), l.name);
            if (n) {
              l.name = n;
              p.changed();
            }
          }}
          title={t(TYPE_NAME[l.type])}
        >
          <button className="eye" onClick={(e) => (e.stopPropagation(), p.setLayerHidden(l, !l.hidden))} title={l.hidden ? t("Show") : t("Hide")}>
            {l.hidden ? "◌" : "●"}
          </button>
          <span>{TYPE_ICON[l.type]}</span>
          <span className="grow">{t(l.name)}</span>
        </div>,
      );
      walk(l.layers, depth + 1);
    }
  };
  walk(p.layers, 0);
  return (
    <>
      <h3>
        {t("Layers")}{" "}<span className="grow" />
        <button title={t("Add a paint layer")} onClick={() => p.addLayer(LAYER_PAINT)}>
          {t("+ Paint")}
        </button>
        <button title={t("Add a procedural layer: filled by the brush graph")} onClick={() => p.addLayer(LAYER_PROC)}>
          {t("+ Proc")}
        </button>
        <button title={t("Add a mask to the selected layer")} disabled={!sel} onClick={() => p.addLayer(LAYER_MASK)}>
          {t("+ Mask")}
        </button>
      </h3>
      <div className="layers">{rows}</div>
      {sel && (
        <div className="insp">
          <div className="paint-tools">
            <button onClick={() => p.moveLayerUp(sel)}>{t("Up")}</button>
            <button onClick={() => p.moveLayerDown(sel)}>{t("Down")}</button>
            <button onClick={() => p.duplicateLayer(sel)}>{t("Duplicate")}</button>
            <button onClick={() => p.removeLayer(sel)}>{t("Remove")}</button>
          </div>
          {sel.type !== LAYER_MASK && (
            <>
              <div className="sect">{t("Opacity of “{0}” per channel", sel.name)}</div>
              {CHANNELS.map((c: MapChannel) => (
                <Row key={c} label={c}>
                  <FloatEdit value={sel.alpha[c]} min={0} max={1} step={0.01} allowExpr={false} onChange={(v) => p.setLayerAlpha(sel, c, Number(v))} />
                </Row>
              ))}
            </>
          )}
          {sel.type === LAYER_PROC && <div style={{ color: "var(--text3)" }}>{t("A procedural layer is filled by its brush: edit the brush graph to change it.")}</div>}
        </div>
      )}
    </>
  );
}

function allOwners(layers: Layer[], out = new Map<Layer[], Layer>()) {
  for (const l of layers) {
    out.set(l.layers, l);
    allOwners(l.layers, out);
  }
  return out;
}

export function SettingsPanel() {
  usePaint();
  const p = paint.project!;
  const s = p.settings;
  return (
    <div className="insp">
      <div className="sect">{t("Project settings")}</div>
      <Row label={t("Texture size")}>
        <select value={s.texture_size} onChange={(e) => p.setSettings({ texture_size: +e.target.value })}>
          {[8, 9, 10, 11, 12].map((i) => (
            <option key={i} value={i}>
              {2 ** i}×{2 ** i}
            </option>
          ))}
        </select>
      </Row>
      {(["paint_emission", "paint_normal", "paint_depth", "paint_depth_as_bump"] as const).map((k) => (
        <Row key={k} label={k.replace("paint_", "").replaceAll("_", " ")}>
          <input type="checkbox" checked={s[k]} onChange={(e) => p.setSettings({ [k]: e.target.checked })} style={{ justifySelf: "start" }} />
        </Row>
      ))}
      <Row label={t("bump strength")}>
        <FloatEdit value={s.bump_strength} min={0} max={1} step={0.01} allowExpr={false} onChange={(v) => p.setSettings({ bump_strength: Number(v) })} />
      </Row>
      <div style={{ color: "var(--text3)" }}>
        {t("Model:")}{" "}{p.mesh.name} · {p.mesh.positions.length / 9}{" "}{t("triangles ·")}{" "}{editor.title === "Brush" ? t("the node editor shows the brush graph") : ""}
      </div>
    </div>
  );
}
