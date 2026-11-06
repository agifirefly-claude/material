/* The handles drawn over the 2D preview (port of panels/preview_2d control_point.gd, lines.gd, axes.gd and the
 * polygon/lattice/splines/pixels editors). A parameter whose definition has `control: "P1.x"` (or .y, .r, .a) is
 * moved by the handle of that name; a parameter set to an expression has no handle. */
import { useRef, useState } from "react";
import type { Gen, ParameterDef } from "../../engine/gen/base";
import { Lattice, Pixels, Polygon, Splines } from "../../engine/params/types";
import { editor } from "../store";
import { posToUv, posToValue, uvToPos, valueToPos, type View } from "./view";

type P = { x: number; y: number };
type Kind = 0 | 1 | 2 | 3 | 4; // simple, rect, radius, scale, rotate-scale

/** the handles of preview_2d_panel.tscn, in its order: name, colour, parent, kind */
const CONTROLS: { name: string; color: string; parent?: string; kind: Kind }[] = [
  { name: "P1", color: "#ff7700", kind: 0 },
  { name: "P2", color: "#0081ff", kind: 0 },
  { name: "P11", color: "#0081ff", parent: "P1", kind: 0 },
  { name: "RadiusP11", color: "#ffa100", parent: "P11", kind: 2 },
  { name: "P12", color: "#0081ff", parent: "P1", kind: 0 },
  { name: "P3", color: "#00ff61", kind: 0 },
  { name: "Rect1", color: "#ffa100", parent: "P1", kind: 1 },
  { name: "Radius1", color: "#ffa100", parent: "P1", kind: 2 },
  { name: "Radius2", color: "#0081ff", parent: "P2", kind: 2 },
  { name: "Radius11", color: "#ffa100", parent: "Radius1", kind: 2 },
  { name: "Scale1", color: "#ffa100", parent: "P1", kind: 3 },
  { name: "RotateScale1", color: "#ffa100", parent: "P1", kind: 4 },
  { name: "Angle1", color: "#ffa100", parent: "P1", kind: 2 },
  { name: "Angle2", color: "#ffa100", parent: "P1", kind: 2 },
];

interface Bound {
  def: (typeof CONTROLS)[number];
  x?: string;
  y?: string;
  r?: string;
  a?: string;
}

const COMPLEX = ["polygon", "polyline", "splines", "pixels", "lattice"];
const num = (g: Gen, n: string | undefined) => (n ? g.getParameter(n) : undefined);

/** which handles a node uses, by its parameter definitions (setup_control) */
export function boundControls(g: Gen, defs: ParameterDef[]): Bound[] {
  const out: Bound[] = [];
  for (const def of CONTROLS) {
    const b: Bound = { def };
    for (const p of defs) {
      if (typeof p.control !== "string") continue;
      for (const k of ["x", "y", "r", "a"] as const) if (p.control === `${def.name}.${k}`) b[k] = p.name;
    }
    if (!(b.x || b.y || b.r || b.a)) continue;
    // a parameter that is an expression cannot be moved by a handle
    if ([b.x, b.y, b.r, b.a].some((n) => n && typeof g.getParameter(n) !== "number")) continue;
    out.push(b);
  }
  return out;
}

function valueOf(g: Gen, b: Bound): P {
  if (b.x || b.y) return { x: Number(num(g, b.x) ?? 0), y: Number(num(g, b.y) ?? 0) };
  const r = b.r ? Number(num(g, b.r)) : 0.25;
  const a = b.a ? Number(num(g, b.a)) * 0.01745329251 : 0;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

export function Gizmos({ gen, view, size, guides, gridSize, guideColor }: { gen: Gen; view: View; size: number; guides: number; gridSize: number; guideColor: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [axes, setAxes] = useState<P | null>(null);
  const [complexIndex, setComplexIndex] = useState(0);
  const defs = gen.getParameterDefs();
  const bound = boundControls(gen, defs);
  const byName = new Map(bound.map((b) => [b.def.name, b]));
  const vp = (v: P) => valueToPos(v, view, size);

  // positions, parents first (update_position)
  const pos = new Map<string, P>();
  const positionOf = (b: Bound): P => {
    if (pos.has(b.def.name)) return pos.get(b.def.name)!;
    let v = valueOf(gen, b);
    if (b.def.kind === 3 || b.def.kind === 4) v = { x: v.x * 0.25, y: v.y * 0.25 };
    let p = vp(v);
    const parent = b.def.parent ? byName.get(b.def.parent) : undefined;
    if (parent) {
      const o = vp({ x: 0, y: 0 });
      const pp = positionOf(parent);
      p = { x: p.x - o.x + pp.x, y: p.y - o.y + pp.y };
    }
    pos.set(b.def.name, p);
    return p;
  };
  for (const b of bound) positionOf(b);

  const local = (e: { clientX: number; clientY: number }): P => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const drag = (b: Bound) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const el = e.currentTarget as SVGElement;
    el.setPointerCapture(e.pointerId);
    const initPos = positionOf(b);
    const parent = b.def.parent ? byName.get(b.def.parent) : undefined;
    const parentPos = parent ? positionOf(parent) : null;
    const move = (ev: PointerEvent) => {
      let value = posToValue(local(ev), view, size);
      let init = posToValue(initPos, view, size);
      if (parentPos) {
        const pv = posToValue(parentPos, view, size);
        value = { x: value.x - pv.x, y: value.y - pv.y };
        init = { x: init.x - pv.x, y: init.y - pv.y };
      }
      const isXy = !!(b.x || b.y);
      if (ev.shiftKey && !(b.def.kind > 0 && b.def.kind <= 4) && !b.a) {
        if (Math.abs(value.x - init.x) > Math.abs(value.y - init.y)) value.y = init.y;
        else value.x = init.x;
        setAxes(initPos);
      }
      if (ev.ctrlKey || ev.metaKey) {
        if (isXy && guides === 3 && gridSize > 0) {
          value.x = Math.round((value.x - 0.5) * gridSize) / gridSize + 0.5;
          value.y = Math.round((value.y - 0.5) * gridSize) / gridSize + 0.5;
        } else if (b.a) {
          const l = Math.hypot(value.x, value.y);
          const a = Math.round(Math.atan2(value.y, value.x) / (Math.PI / 12)) * (Math.PI / 12);
          value = { x: l * Math.cos(a), y: l * Math.sin(a) };
        }
      }
      if (ev.shiftKey && b.def.kind === 3) value.y = value.x = Math.max(value.x, value.y);
      if (isXy) {
        if (!b.x) value.x = 0;
        if (!b.y) value.y = 0;
      } else {
        const l = Math.hypot(value.x, value.y) || 1;
        if (!b.r) {
          value = { x: value.x / l, y: value.y / l };
          if (b.def.kind === 2) value = { x: value.x * 0.25, y: value.y * 0.25 };
        }
        if (!b.a) value = { x: Math.hypot(value.x, value.y), y: 0 };
      }
      if (b.def.kind === 3 || b.def.kind === 4) value = { x: value.x * 4, y: value.y * 4 };
      if (b.def.kind === 1) value = { x: Math.abs(value.x), y: Math.abs(value.y) };
      const set = (n: string | undefined, v: number) => n && gen.setParameterSilently(n, parseFloat(v.toFixed(5)));
      set(b.x, value.x);
      set(b.y, value.y);
      set(b.r, Math.hypot(value.x, value.y));
      set(b.a, (Math.atan2(value.y, value.x) * 180) / Math.PI);
      gen.changed();
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setAxes(null);
      editor.snapshot();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  // guides (lines.gd)
  const guideLines: [P, P][] = [];
  const grid = (n: number) => {
    for (let i = 0; i <= n; i++) {
      const x = i / n - 0.5;
      const p = vp({ x, y: x });
      guideLines.push([{ x: p.x, y: 0 }, { x: p.x, y: size }], [{ x: 0, y: p.y }, { x: size, y: p.y }]);
    }
  };
  if (guides === 1) {
    const c = (a: P, toEdge: P) => guideLines.push([vp(a), toEdge]);
    const p = (v: P) => vp(v);
    c({ x: -0.5, y: -0.52 }, { x: p({ x: -0.5, y: 0 }).x, y: 0 });
    c({ x: 0.5, y: -0.52 }, { x: p({ x: 0.5, y: 0 }).x, y: 0 });
    c({ x: -0.52, y: -0.5 }, { x: 0, y: p({ x: 0, y: -0.5 }).y });
    c({ x: -0.52, y: 0.5 }, { x: 0, y: p({ x: 0, y: 0.5 }).y });
    c({ x: -0.5, y: 0.52 }, { x: p({ x: -0.5, y: 0 }).x, y: size });
    c({ x: 0.5, y: 0.52 }, { x: p({ x: 0.5, y: 0 }).x, y: size });
    c({ x: 0.52, y: -0.5 }, { x: size, y: p({ x: 0, y: -0.5 }).y });
    c({ x: 0.52, y: 0.5 }, { x: size, y: p({ x: 0, y: 0.5 }).y });
  } else if (guides === 2) grid(1);
  else if (guides === 3 && gridSize > 0) grid(Math.round(gridSize));

  // the complex parameter being edited, when the node has some
  const complex = defs.filter((d) => COMPLEX.includes(d.type));
  const cdef = complex[Math.min(complexIndex, complex.length - 1)];

  return (
    <>
      {complex.length > 1 && (
        <select className="pv2-complex" value={Math.min(complexIndex, complex.length - 1)} onChange={(e) => setComplexIndex(+e.target.value)}>
          {complex.map((d, i) => (
            <option key={d.name} value={i}>
              {d.label || d.name}
            </option>
          ))}
        </select>
      )}
      <svg ref={svg} className="pv2-overlay" width={size} height={size}>
        {guideLines.map(([a, b], i) => (
          <line key={"g" + i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={guideColor} strokeWidth={1} />
        ))}
        {cdef && <ComplexEditor gen={gen} def={cdef} view={view} size={size} local={local} />}
        {bound.map((b) => {
          const p = pos.get(b.def.name)!;
          const parent = b.def.parent ? pos.get(b.def.parent) : undefined;
          const origin = vp({ x: 0, y: 0 });
          const pp = parent ?? origin;
          const k = b.def.kind;
          let deco: React.ReactNode = null;
          if (k === 1 && parent) {
            const v = valueOf(gen, b);
            const o = vp({ x: 0, y: 0 });
            const q = vp({ x: -v.x, y: v.y });
            const p1 = { x: parent.x + q.x - o.x, y: parent.y + q.y - o.y };
            const p2 = { x: 2 * parent.x - p.x, y: 2 * parent.y - p.y };
            const p3 = { x: 2 * parent.x - p1.x, y: 2 * parent.y - p1.y };
            deco = <polygon points={[p, p1, p2, p3].map((c) => `${c.x},${c.y}`).join(" ")} fill="none" stroke={b.def.color} />;
          } else if (k === 2 || k === 4) deco = <line x1={p.x} y1={p.y} x2={pp.x} y2={pp.y} stroke={b.def.color} />;
          else if (k === 3) deco = <rect x={Math.min(p.x, pp.x)} y={Math.min(p.y, pp.y)} width={Math.abs(pp.x - p.x)} height={Math.abs(pp.y - p.y)} fill="none" stroke={b.def.color} />;
          const title = [b.x, b.y, b.r, b.a].filter(Boolean).join(", ");
          return (
            <g key={b.def.name}>
              {deco}
              {k === 0 ? (
                <circle className="pv2-handle" data-control={b.def.name} cx={p.x} cy={p.y} r={6} fill={b.def.color} stroke="#000" strokeWidth={1.5} onPointerDown={drag(b)}>
                  <title>{`${b.def.name}: ${title}`}</title>
                </circle>
              ) : (
                <rect className="pv2-handle" data-control={b.def.name} x={p.x - 5} y={p.y - 5} width={10} height={10} fill={b.def.color} stroke="#000" strokeWidth={1.5} onPointerDown={drag(b)}>
                  <title>{`${b.def.name}: ${title}`}</title>
                </rect>
              )}
            </g>
          );
        })}
        {axes && (
          <g pointerEvents="none">
            <line x1={axes.x} y1={0} x2={axes.x} y2={size} stroke="#ff0b06" strokeWidth={2} />
            <line x1={0} y1={axes.y} x2={size} y2={axes.y} stroke="#07c905" strokeWidth={2} />
          </g>
        )}
      </svg>
    </>
  );
}

/** polygon, polyline, lattice, splines and pixels edited on the image itself */
function ComplexEditor({ gen, def, view, size, local }: { gen: Gen; def: ParameterDef; view: View; size: number; local: (e: { clientX: number; clientY: number }) => P }) {
  const value = gen.getParameter(def.name);
  const toPos = (u: P) => uvToPos(u, view, size);
  const set = (v: Polygon | Lattice | Splines | Pixels) => gen.setParameter(def.name, v);
  const dragPoint = (onMove: (u: P) => void) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as SVGElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onMove(posToUv(local(ev), view, size));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      editor.snapshot();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  if (def.type === "polygon" || def.type === "polyline") {
    const poly = value instanceof Polygon ? value : Polygon.deserialize(value ?? def.default);
    const pts = poly.points.map(toPos);
    const closed = def.type === "polygon";
    return (
      <g>
        {closed ? <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#e7c46a" strokeWidth={1.5} /> : <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#e7c46a" strokeWidth={1.5} />}
        {pts.map((p, i) => (
          <circle
            key={i}
            className="pv2-handle"
            cx={p.x}
            cy={p.y}
            r={5}
            fill="#e7c46a"
            stroke="#000"
            onPointerDown={dragPoint((u) => {
              const c = poly.clone();
              c.points[i] = u;
              set(c);
            })}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (poly.points.length <= (closed ? 3 : 2)) return;
              const c = poly.clone();
              c.points.splice(i, 1);
              set(c);
            }}
          />
        ))}
        {pts.map((p, i) => {
          if (!closed && i === pts.length - 1) return null;
          const q = pts[(i + 1) % pts.length];
          return (
            <circle
              key={"m" + i}
              className="pv2-handle"
              cx={(p.x + q.x) / 2}
              cy={(p.y + q.y) / 2}
              r={3.5}
              fill="#555"
              stroke="#e7c46a"
              onPointerDown={(e) => {
                // a click on an edge's middle inserts a point there
                const c = poly.clone();
                c.points.splice(i + 1, 0, posToUv({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, view, size));
                set(c);
                e.stopPropagation();
              }}
            >
              <title>Click to add a point</title>
            </circle>
          );
        })}
      </g>
    );
  }
  if (def.type === "lattice") {
    const lat = value instanceof Lattice ? value : Lattice.deserialize(value ?? def.default);
    const w = lat.size.x + 1;
    const pts = lat.points.map(toPos);
    const lines: React.ReactNode[] = [];
    for (let y = 0; y <= lat.size.y; y++)
      for (let x = 0; x <= lat.size.x; x++) {
        const p = pts[x + w * y];
        if (x < lat.size.x) lines.push(<line key={`h${x},${y}`} x1={p.x} y1={p.y} x2={pts[x + 1 + w * y].x} y2={pts[x + 1 + w * y].y} stroke="#e7c46a" />);
        if (y < lat.size.y) lines.push(<line key={`v${x},${y}`} x1={p.x} y1={p.y} x2={pts[x + w * (y + 1)].x} y2={pts[x + w * (y + 1)].y} stroke="#e7c46a" />);
      }
    return (
      <g>
        {lines}
        {pts.map((p, i) => (
          <circle
            key={i}
            className="pv2-handle"
            cx={p.x}
            cy={p.y}
            r={5}
            fill="#e7c46a"
            stroke="#000"
            onPointerDown={dragPoint((u) => {
              const c = lat.clone();
              c.points[i] = u;
              set(c);
            })}
          />
        ))}
      </g>
    );
  }
  if (def.type === "splines") {
    const sp = value instanceof Splines ? value : Splines.deserialize(value ?? def.default);
    const pts: P[] = [];
    for (let i = 0; i < sp.values.length; i += 4) pts.push(toPos({ x: sp.values[i], y: sp.values[i + 1] }));
    const curves: React.ReactNode[] = [];
    for (let s = 0; s + 3 < pts.length; s += 4) {
      const [a, b, c, d] = pts.slice(s, s + 4);
      curves.push(<path key={"c" + s} d={`M${a.x},${a.y} C${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`} fill="none" stroke="#e7c46a" strokeWidth={1.5} />);
      curves.push(<path key={"t" + s} d={`M${a.x},${a.y} L${b.x},${b.y} M${d.x},${d.y} L${c.x},${c.y}`} stroke="#777" />);
    }
    return (
      <g>
        {curves}
        {pts.map((p, i) => (
          <circle
            key={i}
            className="pv2-handle"
            cx={p.x}
            cy={p.y}
            r={i % 4 === 0 || i % 4 === 3 ? 5 : 4}
            fill={i % 4 === 0 || i % 4 === 3 ? "#4f9cf0" : "#999"}
            stroke="#000"
            onPointerDown={dragPoint((u) => {
              const c = sp.clone();
              const dx = u.x - c.values[i * 4],
                dy = u.y - c.values[i * 4 + 1];
              const mv = (k: number) => {
                c.values[k * 4] += dx;
                c.values[k * 4 + 1] += dy;
              };
              mv(i);
              if (i % 4 === 0) mv(i + 1);
              if (i % 4 === 3) mv(i - 1);
              for (const g of c.pointGroups) if (g.includes(i)) for (const j of g) if (j !== i) mv(j);
              set(c);
            })}
          />
        ))}
      </g>
    );
  }
  if (def.type === "pixels") {
    const px = value instanceof Pixels ? value : Pixels.deserialize(value ?? def.default);
    const o = toPos({ x: 0, y: 0 }),
      e = toPos({ x: 1, y: 1 });
    const paint = (ev: { clientX: number; clientY: number; buttons: number; shiftKey: boolean }) => {
      const u = posToUv(local(ev), view, size);
      const x = Math.floor(u.x * px.size.x),
        y = Math.floor(u.y * px.size.y);
      // left: last palette colour, right or shift: first
      const c = ev.buttons & 2 || ev.shiftKey ? 0 : px.palette.length - 1;
      if (px.getColorIndex(x, y) === c || x < 0 || y < 0 || x >= px.size.x || y >= px.size.y) return;
      const n = px.clone();
      n.setColorIndex(x, y, c);
      set(n);
    };
    return (
      <rect
        x={o.x}
        y={o.y}
        width={e.x - o.x}
        height={e.y - o.y}
        fill="transparent"
        stroke="#e7c46a"
        style={{ cursor: "crosshair" }}
        onContextMenu={(ev) => ev.preventDefault()}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          (ev.currentTarget as SVGElement).setPointerCapture(ev.pointerId);
          paint(ev);
        }}
        onPointerMove={(ev) => ev.buttons && paint(ev)}
        onPointerUp={() => editor.snapshot()}
      >
        <title>Paint pixels: left button with the last palette colour, right button or shift with the first</title>
      </rect>
    );
  }
  return null;
}
