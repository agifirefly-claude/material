/* The SDF builder window (material_maker/windows/sdf_builder/sdf_builder.gd): edits a working copy of an Easy SDF
 * node's scene and node parameters, with its own preview, a 2D view with the item's controls or a raymarched 3D view
 * with a move/rotate gizmo, drawn from an editor mode GenSDF whose item parameters are uniforms (so dragging redraws
 * without recompiling). Apply or OK gives the result to the node. */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import type { Dict } from "../../engine/gen/base";
import { GenGraph } from "../../engine/gen/graph";
import { GenSDF } from "../../engine/gen/sdf";
import { deserializeScene, sdfItemType, serializeScene, type SdfScene } from "../../engine/sdf/builder";
import { SDF_VIEW_STYLES, parentTransform2D, sdfPreview2D, sdfPreview3D, type Sdf2DView, type Sdf3DCamera } from "../../engine/sdf/preview";
import { editor } from "../store";
import { FloatEdit } from "../widgets/FloatEdit";
import { SdfEditor, find } from "../SdfEditor";
import { View2D, controlPositions, controlShape, dragControl, itemControls, CONTROLS } from "./gizmos2d";
import { arrowDrag, arrowEnds, gizmoFor, positionParams, ringDirection, ringPoints, rotationParams } from "./gizmos3d";

const SIZE = 512;
const AXIS_COLORS = ["#ff5555", "#55dd55", "#5599ff"];
const clone = (s: SdfScene[]) => deserializeScene(serializeScene(s));

export function SdfBuilder({ gen, initialSel, onClose }: { gen: GenSDF; initialSel: number | null; onClose: () => void }) {
  const [scene, setScene] = useState<SdfScene[]>(() => clone(gen.scene));
  const [nodeParams, setNodeParams] = useState<Dict[]>(() => structuredClone(gen.nodeParameters));
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(gen.nodeParameters.map((p) => [p.name, Number(gen.parameters[p.name] ?? p.default)])));
  const [sel, setSel] = useState<number | null>(initialSel ?? gen.scene[0]?.index ?? null);
  const [view, setView] = useState<Sdf2DView>({ center: { x: 0.5, y: 0.5 }, scale: 1.2, style: 0 });
  const [cam, setCam] = useState<Sdf3DCamera>({ yaw: 0.5, pitch: -0.35, dist: 3, target: [0, 0, 0] });
  const [gizmos, setGizmos] = useState(true);
  const [localAxes, setLocalAxes] = useState(false);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const dirty = useRef(false);

  // the window's own GenSDF, in editor mode (MM's $GenSDF child of the window)
  const preview = useMemo(() => {
    const g = new GenSDF();
    g.editor = true;
    g.expressions = true;
    new GenGraph().addGenerator(g);
    return g;
  }, []);

  const sceneType = scene.length ? sdfItemType(scene[0].type)?.category ?? "" : "";
  const is3d = sceneType === "SDF3D";
  const selected = sel !== null ? find(scene, sel)?.item ?? null : null;

  const changeScene = (s: SdfScene[]) => {
    dirty.current = true;
    setScene(s);
  };
  /** sets parameters of the selected item (gizmo drags), keeping the rest of the scene */
  const setItemParams = (index: number, params: Record<string, number>) => {
    const s = clone(scene);
    const it = find(s, index)?.item;
    if (!it) return;
    for (const [k, v] of Object.entries(params)) if (it.parmexprs?.[k] === undefined) it.parameters[k] = +v.toFixed(4);
    changeScene(s);
  };

  // draw the preview whenever something changes
  useEffect(() => {
    const r = editor.renderer;
    const c = canvas.current;
    if (!r || !c) return;
    const id = requestAnimationFrame(() => {
      try {
        preview.nodeParameters = structuredClone(nodeParams);
        preview.parameters = {};
        for (const p of nodeParams) preview.parameters[p.name] = values[p.name] ?? Number(p.default);
        preview.setSdfScene(clone(scene));
        if (!scene.length) {
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setError("");
          return;
        }
        const sc = is3d ? sdfPreview3D(preview, cam, sel ?? 0) : sdfPreview2D(preview, view, sel ?? 0);
        const res = r.renderKeyed("sdf-builder", sc, SIZE, false);
        setError(res.error ? res.error.message : "");
        if (res.target) r.present(res.target, c.getContext("2d")!, false);
      } catch (e) {
        setError(String(e));
      }
    });
    return () => cancelAnimationFrame(id);
  }, [scene, nodeParams, values, view, cam, sel, is3d, preview]);
  useEffect(() => () => editor.renderer?.forget("sdf-builder"), []);

  const apply = () => {
    gen.nodeParameters = structuredClone(nodeParams);
    for (const p of nodeParams) gen.parameters[p.name] = values[p.name] ?? Number(p.default);
    gen.setSdfScene(clone(scene));
    dirty.current = false;
  };
  const close = () => {
    if (dirty.current && !confirm("Close the SDF builder without applying the changes?")) return;
    onClose();
  };

  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal sdf-builder" onKeyDown={(e) => e.key === "Escape" && close()}>
        <div className="sdf-builder-head">
          <h2>SDF builder — {gen.name}</h2>
          <span className="grow" />
          <button onClick={apply}>Apply</button>
          <button
            className="primary"
            onClick={() => {
              apply();
              onClose();
            }}
          >
            OK
          </button>
          <button onClick={() => (dirty.current = false, onClose())}>Cancel</button>
        </div>
        <div className="sdf-builder-body">
          <div className="sdf-builder-side insp">
            <SdfEditor gen={gen} source={{ scene, setScene: changeScene }} sel={sel} setSel={setSel} />
            <NodeParameters params={nodeParams} values={values} onChange={(p, v) => (dirty.current = true, setNodeParams(p), setValues(v))} />
          </div>
          <div className="sdf-builder-view">
            <div className="tools">
              {!is3d && (
                <select value={view.style} onChange={(e) => setView({ ...view, style: +e.target.value })} title="View">
                  {SDF_VIEW_STYLES.map((s, i) => (
                    <option key={s} value={i}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <label>
                <input type="checkbox" checked={gizmos} onChange={(e) => setGizmos(e.target.checked)} /> gizmo
              </label>
              {is3d && (
                <label title="Align the gizmo with the item rather than the scene">
                  <input type="checkbox" checked={localAxes} onChange={(e) => setLocalAxes(e.target.checked)} /> local
                </label>
              )}
              <button onClick={() => (is3d ? setCam({ yaw: 0.5, pitch: -0.35, dist: 3, target: [0, 0, 0] }) : setView({ ...view, center: { x: 0.5, y: 0.5 }, scale: 1.2 }))}>Reset view</button>
              <span style={{ color: "var(--text3)" }}>{is3d ? "drag: turn · shift+drag: pan · wheel: zoom" : "drag: pan · wheel: zoom"}</span>
            </div>
            <div className="sdf-builder-canvas" style={{ width: SIZE, height: SIZE }}>
              <canvas ref={canvas} width={SIZE} height={SIZE} />
              {is3d ? (
                <Overlay3D scene={scene} item={selected} cam={cam} setCam={setCam} show={gizmos} localAxes={localAxes} onParams={setItemParams} />
              ) : (
                <Overlay2D scene={scene} item={selected} view={view} setView={setView} show={gizmos} onParams={setItemParams} />
              )}
              {error && <div className="sdf-builder-error">{error}</div>}
              {!scene.length && <div className="empty" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>Add a 2D or 3D shape to the scene</div>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- 2D view: pan and zoom, and the controls of the selected item ---------- */
function Overlay2D({ scene, item, view, setView, show, onParams }: { scene: SdfScene[]; item: SdfScene | null; view: Sdf2DView; setView: (v: Sdf2DView) => void; show: boolean; onParams: (index: number, p: Record<string, number>) => void }) {
  const t = item ? sdfItemType(item.type) : null;
  const controls = t && item && show ? itemControls(t.parameterDefs()).filter((c) => Object.values(c.params).every((p) => item.parmexprs?.[p] === undefined)) : [];
  const v2 = item ? new View2D(view, SIZE, parentTransform2D(scene, item.index), Number(item.parameters.angle ?? 0), Number(item.parameters.scale ?? 1)) : null;
  const positions = item && v2 ? controlPositions(controls, item, v2) : new Map();
  const pan = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, c: { ...view.center } };
    const move = (ev: PointerEvent) => setView({ ...view, center: { x: start.c.x - ((ev.clientX - start.x) * view.scale) / SIZE, y: start.c.y - ((ev.clientY - start.y) * view.scale) / SIZE } });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const drag = (name: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!item || !v2) return;
    const el = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    const c = controls.find((x) => x.name === name)!;
    const move = (ev: PointerEvent) => onParams(item.index, dragControl(c, { x: ((ev.clientX - rect.left) * SIZE) / rect.width, y: ((ev.clientY - rect.top) * SIZE) / rect.height }, positions, v2));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  return (
    <svg
      className="sdf-overlay"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      onPointerDown={pan}
      onWheel={(e) => setView({ ...view, scale: Math.min(20, Math.max(0.05, view.scale * (e.deltaY > 0 ? 1.1 : 1 / 1.1))) })}
    >
      {item &&
        v2 &&
        controls.map((c) => {
          const s = controlShape(c, positions, v2, item);
          const col = CONTROLS[c.name].color;
          return s.lines.map(([a, b], i) => <line key={c.name + i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={1.2} strokeDasharray="4 3" />);
        })}
      {item &&
        controls.map((c) => {
          const p = positions.get(c.name)!;
          return <circle key={c.name} data-control={c.name} cx={p.x} cy={p.y} r={6} fill={CONTROLS[c.name].color} stroke="#000" strokeWidth={1.5} style={{ cursor: "move" }} onPointerDown={drag(c.name)}>
            <title>{c.name}: {Object.values(c.params).join(", ")}</title>
          </circle>;
        })}
    </svg>
  );
}

/* ---------- 3D view: orbit, and the move / rotate gizmo of the selected item ---------- */
function Overlay3D({ scene, item, cam, setCam, show, localAxes, onParams }: { scene: SdfScene[]; item: SdfScene | null; cam: Sdf3DCamera; setCam: (c: Sdf3DCamera) => void; show: boolean; localAxes: boolean; onParams: (index: number, p: Record<string, number>) => void }) {
  const t = item ? sdfItemType(item.type) : null;
  const g = item && t && show ? gizmoFor(scene, item, t.category, cam, localAxes) : null;
  const orbit = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = { x: e.clientX, y: e.clientY };
    let c = cam;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last.x,
        dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      if (ev.shiftKey) {
        // pan in the view plane
        const k = (0.0025 * c.dist * SIZE) / 512;
        const yaw = c.yaw,
          pitch = c.pitch;
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const up = new THREE.Vector3(Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch));
        const tg = new THREE.Vector3(...c.target).addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        c = { ...c, target: [tg.x, tg.y, tg.z] };
      } else c = { ...c, yaw: c.yaw - dx * 0.01, pitch: Math.max(-1.55, Math.min(1.55, c.pitch - dy * 0.01)) };
      setCam(c);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const startDrag = (e: React.PointerEvent, onMove: (d: { x: number; y: number }) => void) => {
    e.stopPropagation();
    const el = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = el.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const move = (ev: PointerEvent) => onMove({ x: ((ev.clientX - start.x) * SIZE) / rect.width, y: ((ev.clientY - start.y) * SIZE) / rect.height });
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const dragArrow = (i: number) => (e: React.PointerEvent) => {
    if (!g || !item) return;
    const origin = g.origin.clone();
    startDrag(e, (d) => {
      const m = arrowDrag(g, cam, SIZE, i, d);
      if (m) onParams(item.index, positionParams(g, origin.clone().add(m), item));
    });
  };
  const dragRing = (i: number, grab: THREE.Vector3) => (e: React.PointerEvent) => {
    if (!g || !item) return;
    const dir = ringDirection(g, cam, SIZE, i, grab);
    if (!dir) return;
    const l2 = dir.x * dir.x + dir.y * dir.y || 1;
    startDrag(e, (d) => onParams(item.index, rotationParams(g, i, -(d.x * dir.x + d.y * dir.y) / l2, item)));
  };
  return (
    <svg className="sdf-overlay" viewBox={`0 0 ${SIZE} ${SIZE}`} onPointerDown={orbit} onWheel={(e) => setCam({ ...cam, dist: Math.min(150, Math.max(0.5, cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1))) })}>
      {g &&
        [0, 1, 2].map((i) => {
          if (!g.rings[i]) return null;
          const pts = ringPoints(g, cam, SIZE, i);
          return (
            <g key={"r" + i}>
              <polyline points={pts.map((p) => `${p.px.x},${p.px.y}`).join(" ")} fill="none" stroke={AXIS_COLORS[i]} strokeWidth={2} opacity={0.8} />
              {pts.map((p, k) =>
                k % 3 === 0 ? <circle key={k} data-ring={i} cx={p.px.x} cy={p.px.y} r={5} fill="transparent" style={{ cursor: "grab" }} onPointerDown={dragRing(i, p.world)} /> : null,
              )}
            </g>
          );
        })}
      {g &&
        [0, 1, 2].map((i) => {
          if (!g.arrows[i]) return null;
          const e = arrowEnds(g, cam, SIZE, i);
          if (!e) return null;
          return (
            <g key={"a" + i} style={{ cursor: "move" }} onPointerDown={dragArrow(i)} data-arrow={i}>
              <line x1={e[0].x} y1={e[0].y} x2={e[1].x} y2={e[1].y} stroke={AXIS_COLORS[i]} strokeWidth={3} />
              <line x1={e[0].x} y1={e[0].y} x2={e[1].x} y2={e[1].y} stroke="transparent" strokeWidth={12} />
              <circle cx={e[1].x} cy={e[1].y} r={6} fill={AXIS_COLORS[i]} stroke="#000" />
            </g>
          );
        })}
    </svg>
  );
}

/* ---------- node parameters (sdf_builder.gd update_node_parameters_grid) ---------- */
function NodeParameters({ params, values, onChange }: { params: Dict[]; values: Record<string, number>; onChange: (p: Dict[], v: Record<string, number>) => void }) {
  const set = (i: number, patch: Dict) => {
    const p = structuredClone(params);
    Object.assign(p[i], patch);
    onChange(p, values);
  };
  const exists = (name: string, i: number) => params.some((p, j) => j !== i && p.name === name);
  return (
    <>
      <div className="sect" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Node parameters</span>
        <button
          onClick={() => {
            let i = 1;
            while (exists("param" + i, -1)) i++;
            onChange([...params, { name: "param" + i, type: "float", min: 0, max: 1, step: 0.01, default: 0.5 }], { ...values, ["param" + i]: 0.5 });
          }}
        >
          + Parameter
        </button>
      </div>
      {!params.length && <div style={{ color: "var(--text3)" }}>None. Node parameters show on the node and can drive item parameters through expressions ($name).</div>}
      {params.map((p, i) => (
        <div key={i} className="sdf-nodeparam">
          <input
            type="text"
            defaultValue={p.name}
            title="Name, used as $name in expressions"
            onBlur={(e) => {
              const n = e.currentTarget.value.trim();
              if (/^[A-Za-z_]\w*$/.test(n) && !exists(n, i)) {
                const v = { ...values, [n]: values[p.name] };
                delete v[p.name];
                const np = structuredClone(params);
                np[i].name = n;
                onChange(np, v);
              } else e.currentTarget.value = p.name;
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <input type="text" defaultValue={p.shortdesc ?? ""} placeholder="label" onBlur={(e) => set(i, e.currentTarget.value ? { shortdesc: e.currentTarget.value, label: e.currentTarget.value } : { shortdesc: undefined, label: undefined })} onKeyDown={(e) => e.stopPropagation()} />
          <FloatEdit value={values[p.name] ?? Number(p.default)} min={p.min} max={p.max} step={p.step} allowExpr={false} onChange={(v) => onChange(params.map((q, j) => (j === i ? { ...q, default: v } : q)), { ...values, [p.name]: Number(v) })} />
          <button title="Move up" disabled={i === 0} onClick={() => onChange(params.map((_, j) => params[j === i ? i - 1 : j === i - 1 ? i : j]), values)}>
            ↑
          </button>
          <button title="Move down" disabled={i === params.length - 1} onClick={() => onChange(params.map((_, j) => params[j === i ? i + 1 : j === i + 1 ? i : j]), values)}>
            ↓
          </button>
          <button title="Remove" onClick={() => onChange(params.filter((_, j) => j !== i), values)}>
            ✕
          </button>
          <div className="sdf-nodeparam-range">
            min <input type="number" step="any" value={p.min} onChange={(e) => set(i, { min: +e.target.value })} />
            max <input type="number" step="any" value={p.max} onChange={(e) => set(i, { max: +e.target.value })} />
            step <input type="number" step="any" value={p.step} onChange={(e) => set(i, { step: +e.target.value })} />
          </div>
        </div>
      ))}
    </>
  );
}
