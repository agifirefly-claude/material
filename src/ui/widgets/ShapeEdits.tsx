/* Canvas editors for the parameter types that are shapes: curves, polygons, lattices, splines and pixel art. */
import { useEffect, useRef, useState } from "react";
import { Curve, Lattice, Pixels, Polygon, Splines, type Color } from "../../engine/params/types";
import { ColorEdit, css } from "./ColorEdit";

const SIZE = 200;
type Pt = { x: number; y: number };

function useCanvas(draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
function grid(ctx: CanvasRenderingContext2D, n = 4) {
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  for (let i = 1; i < n; i++) {
    const p = (i / n) * SIZE + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }
}
const local = (e: { clientX: number; clientY: number }, c: HTMLCanvasElement): Pt => {
  const r = c.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
};
function handle(ctx: CanvasRenderingContext2D, p: Pt, sel = false, color = "#4f9cf0") {
  ctx.fillStyle = sel ? "#fff" : color;
  ctx.fillRect(p.x * SIZE - 4, p.y * SIZE - 4, 8, 8);
}
function nearest(points: Pt[], p: Pt, maxDist = 0.05): number {
  let best = -1,
    bd = maxDist;
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** drag points; double click adds (or removes, on a point) */
function usePointDrag(c: () => HTMLCanvasElement | null, points: () => Pt[], move: (i: number, p: Pt) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = c()!;
      const p = local(e, canvas);
      const i = nearest(points(), p);
      if (i < 0) return;
      canvas.setPointerCapture(e.pointerId);
      const mv = (ev: PointerEvent) => move(i, local(ev, canvas));
      const up = () => {
        canvas.removeEventListener("pointermove", mv);
        canvas.removeEventListener("pointerup", up);
      };
      canvas.addEventListener("pointermove", mv);
      canvas.addEventListener("pointerup", up);
      e.stopPropagation();
    },
  };
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function CurveEdit({ value, onChange }: { value: Curve; onChange: (c: Curve) => void }) {
  const ref = useCanvas(
    (ctx) => {
      grid(ctx);
      ctx.strokeStyle = "#e7c46a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= SIZE; i++) {
        const x = i / SIZE;
        const y = value.evaluate(x);
        if (i === 0) ctx.moveTo(i, (1 - y) * SIZE);
        else ctx.lineTo(i, (1 - y) * SIZE);
      }
      ctx.stroke();
      value.points.forEach((p) => handle(ctx, { x: p.x, y: 1 - p.y }));
    },
    [value],
  );
  const pts = () => value.points.map((p) => ({ x: p.x, y: 1 - p.y }));
  const drag = usePointDrag(
    () => ref.current,
    pts,
    (i, p) => {
      const c = value.clone();
      const last = c.points.length - 1;
      const x = i === 0 ? 0 : i === last ? 1 : Math.min(Math.max(clamp01(p.x), c.points[i - 1].x + 0.001), c.points[i + 1].x - 0.001);
      c.points[i] = { ...c.points[i], x, y: 1 - clamp01(p.y) };
      onChange(c);
    },
  );
  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      className="curve-canvas nodrag"
      title="Drag points; double click to add or remove a point"
      {...drag}
      onDoubleClick={(e) => {
        const p = local(e, ref.current!);
        const c = value.clone();
        const i = nearest(pts(), p);
        if (i > 0 && i < c.points.length - 1) c.points.splice(i, 1);
        else if (i < 0) {
          c.points.push({ x: clamp01(p.x), y: 1 - clamp01(p.y), ls: 0, rs: 0 });
          c.points.sort((a, b) => a.x - b.x);
        }
        onChange(c);
      }}
    />
  );
}

export function PolygonEdit({ value, closed, onChange }: { value: Polygon; closed: boolean; onChange: (p: Polygon) => void }) {
  const ref = useCanvas(
    (ctx) => {
      grid(ctx);
      ctx.strokeStyle = "#e7c46a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      value.points.forEach((p, i) => (i ? ctx.lineTo(p.x * SIZE, p.y * SIZE) : ctx.moveTo(p.x * SIZE, p.y * SIZE)));
      if (closed) ctx.closePath();
      ctx.stroke();
      value.points.forEach((p) => handle(ctx, p));
    },
    [value, closed],
  );
  const drag = usePointDrag(
    () => ref.current,
    () => value.points,
    (i, p) => {
      const c = value.clone();
      c.points[i] = { x: clamp01(p.x), y: clamp01(p.y) };
      onChange(c);
    },
  );
  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      className="poly-canvas nodrag"
      title="Drag points; double click to add a point on the nearest edge or remove one"
      {...drag}
      onDoubleClick={(e) => {
        const p = local(e, ref.current!);
        const c = value.clone();
        const i = nearest(c.points, p);
        if (i >= 0) {
          if (c.points.length > 3) c.points.splice(i, 1);
        } else {
          // insert on the closest segment, as MMPolygon.add_point does
          let best = 0,
            bd = Infinity;
          const n = c.points.length;
          for (let k = 0; k < (closed ? n : n - 1); k++) {
            const a = c.points[k],
              b = c.points[(k + 1) % n];
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
            const d = Math.hypot(a.x + t * (b.x - a.x) - p.x, a.y + t * (b.y - a.y) - p.y);
            if (d < bd) {
              bd = d;
              best = k + 1;
            }
          }
          c.points.splice(best, 0, { x: p.x, y: p.y });
        }
        onChange(c);
      }}
    />
  );
}

export function LatticeEdit({ value, onChange }: { value: Lattice; onChange: (l: Lattice) => void }) {
  const ref = useCanvas(
    (ctx) => {
      const w = value.size.x + 1;
      ctx.strokeStyle = "#e7c46a";
      ctx.lineWidth = 1.5;
      for (let y = 0; y <= value.size.y; y++)
        for (let x = 0; x <= value.size.x; x++) {
          const p = value.points[x + w * y];
          if (x < value.size.x) {
            const q = value.points[x + 1 + w * y];
            ctx.beginPath();
            ctx.moveTo(p.x * SIZE, p.y * SIZE);
            ctx.lineTo(q.x * SIZE, q.y * SIZE);
            ctx.stroke();
          }
          if (y < value.size.y) {
            const q = value.points[x + w * (y + 1)];
            ctx.beginPath();
            ctx.moveTo(p.x * SIZE, p.y * SIZE);
            ctx.lineTo(q.x * SIZE, q.y * SIZE);
            ctx.stroke();
          }
        }
      value.points.forEach((p) => handle(ctx, p));
    },
    [value],
  );
  const drag = usePointDrag(
    () => ref.current,
    () => value.points,
    (i, p) => {
      const c = value.clone();
      c.points[i] = { x: p.x, y: p.y };
      onChange(c);
    },
  );
  const resize = (sx: number, sy: number) => {
    const l = new Lattice();
    l.size = { x: sx, y: sy };
    l.points = [];
    for (let y = 0; y <= sy; y++) for (let x = 0; x <= sx; x++) l.points.push({ x: x / sx, y: y / sy });
    onChange(l);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <canvas ref={ref} width={SIZE} height={SIZE} className="poly-canvas nodrag" {...drag} />
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        Size
        <input type="number" min={1} max={8} value={value.size.x} onChange={(e) => resize(Math.max(1, +e.target.value), value.size.y)} style={{ width: 48 }} />×
        <input type="number" min={1} max={8} value={value.size.y} onChange={(e) => resize(value.size.x, Math.max(1, +e.target.value))} style={{ width: 48 }} />
        <button onClick={() => resize(value.size.x, value.size.y)}>Reset</button>
      </div>
    </div>
  );
}

export function SplinesEdit({ value, onChange }: { value: Splines; onChange: (s: Splines) => void }) {
  const pts = () => {
    const out: Pt[] = [];
    for (let i = 0; i < value.values.length; i += 4) out.push({ x: value.values[i], y: value.values[i + 1] });
    return out;
  };
  const ref = useCanvas(
    (ctx) => {
      grid(ctx);
      const p = pts();
      for (let s = 0; s + 3 < p.length; s += 4) {
        ctx.strokeStyle = "#e7c46a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p[s].x * SIZE, p[s].y * SIZE);
        ctx.bezierCurveTo(p[s + 1].x * SIZE, p[s + 1].y * SIZE, p[s + 2].x * SIZE, p[s + 2].y * SIZE, p[s + 3].x * SIZE, p[s + 3].y * SIZE);
        ctx.stroke();
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p[s].x * SIZE, p[s].y * SIZE);
        ctx.lineTo(p[s + 1].x * SIZE, p[s + 1].y * SIZE);
        ctx.moveTo(p[s + 3].x * SIZE, p[s + 3].y * SIZE);
        ctx.lineTo(p[s + 2].x * SIZE, p[s + 2].y * SIZE);
        ctx.stroke();
      }
      p.forEach((q, i) => handle(ctx, q, false, i % 4 === 0 || i % 4 === 3 ? "#4f9cf0" : "#999"));
    },
    [value],
  );
  const drag = usePointDrag(
    () => ref.current,
    pts,
    (i, p) => {
      const c = value.clone();
      const move = (k: number, dx: number, dy: number) => {
        c.values[k * 4] += dx;
        c.values[k * 4 + 1] += dy;
      };
      const dx = p.x - c.values[i * 4],
        dy = p.y - c.values[i * 4 + 1];
      move(i, dx, dy);
      // end points carry their control point, and linked points move together
      if (i % 4 === 0) move(i + 1, dx, dy);
      if (i % 4 === 3) move(i - 1, dx, dy);
      for (const g of c.pointGroups) if (g.includes(i)) for (const j of g) if (j !== i) move(j, dx, dy);
      onChange(c);
    },
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <canvas ref={ref} width={SIZE} height={SIZE} className="poly-canvas nodrag" {...drag} />
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={() => {
            const c = value.clone();
            c.values.push(0.2, 0.5, 0.02, 0, 0.4, 0.3, 0.02, 0, 0.6, 0.7, 0.02, 0, 0.8, 0.5, 0.02, 0);
            onChange(c);
          }}
        >
          Add curve
        </button>
        <button
          disabled={!value.values.length}
          onClick={() => {
            const c = value.clone();
            c.values.splice(-16);
            const n = c.values.length / 4;
            c.pointGroups = c.pointGroups.map((g) => g.filter((i) => i < n)).filter((g) => g.length > 1);
            onChange(c);
          }}
        >
          Remove last
        </button>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          Width
          <input
            type="number"
            step={0.005}
            min={0}
            value={value.values[2] ?? 0.02}
            onChange={(e) => {
              const c = value.clone();
              for (let i = 2; i < c.values.length; i += 4) c.values[i] = +e.target.value;
              onChange(c);
            }}
            style={{ width: 64 }}
          />
        </label>
      </div>
    </div>
  );
}

export function PixelsEdit({ value, onChange }: { value: Pixels; onChange: (p: Pixels) => void }) {
  const [color, setColor] = useState(1);
  const cell = Math.floor(SIZE / Math.max(value.size.x, value.size.y));
  const ref = useCanvas(
    (ctx) => {
      for (let y = 0; y < value.size.y; y++)
        for (let x = 0; x < value.size.x; x++) {
          ctx.fillStyle = css(value.palette[value.getColorIndex(x, y)] ?? { r: 0, g: 0, b: 0, a: 1 });
          ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      ctx.strokeStyle = "#0004";
      for (let x = 0; x <= value.size.x; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cell + 0.5, 0);
        ctx.lineTo(x * cell + 0.5, value.size.y * cell);
        ctx.stroke();
      }
      for (let y = 0; y <= value.size.y; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cell + 0.5);
        ctx.lineTo(value.size.x * cell, y * cell + 0.5);
        ctx.stroke();
      }
    },
    [value, cell],
  );
  const paint = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * (SIZE / cell));
    const y = Math.floor(((e.clientY - r.top) / r.height) * (SIZE / cell));
    if (value.getColorIndex(x, y) === color) return;
    const p = value.clone();
    p.setColorIndex(x, y, color);
    onChange(p);
  };
  const setPalette = (i: number, c: Color) => {
    const p = value.clone();
    p.palette[i] = c;
    onChange(p);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <canvas
        ref={ref}
        width={SIZE}
        height={SIZE}
        className="poly-canvas nodrag"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          paint(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && paint(e)}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 3 }}>
        {value.palette.map((c, i) => (
          <div key={i} style={{ outline: i === color ? "2px solid #fff" : undefined, borderRadius: 3 }} onClickCapture={() => setColor(i)}>
            <ColorEdit value={c} onChange={(nc) => setPalette(i, nc)} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input type="number" min={1} max={64} value={value.size.x} style={{ width: 46 }} onChange={(e) => onChange(resizePixels(value, +e.target.value, value.size.y, value.bpp))} />×
        <input type="number" min={1} max={64} value={value.size.y} style={{ width: 46 }} onChange={(e) => onChange(resizePixels(value, value.size.x, +e.target.value, value.bpp))} />
        bpp
        <select value={value.bpp} onChange={(e) => onChange(resizePixels(value, value.size.x, value.size.y, +e.target.value))}>
          {[1, 2, 3, 4, 5].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
function resizePixels(old: Pixels, w: number, h: number, bpp: number): Pixels {
  const p = old.clone();
  p.size = { x: Math.max(1, w), y: Math.max(1, h) };
  p.bpp = bpp;
  p.updateData();
  for (let y = 0; y < p.size.y; y++) for (let x = 0; x < p.size.x; x++) p.setColorIndex(x, y, old.getColorIndex(x, y));
  return p;
}
