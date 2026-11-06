import { useRef, useState } from "react";
import { Gradient, Interpolation } from "../../engine/params/types";
import { ColorPopover, css } from "./ColorEdit";
import { gradientDrop } from "./dnd";

/** The gradient as CSS, sampled so every interpolation mode looks right */
export function gradientCss(g: Gradient): string {
  const stops: string[] = [];
  for (let i = 0; i <= 32; i++) stops.push(`${css(g.getColor(i / 32))} ${(i / 32) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(",")})`;
}

export function GradientEdit({ value, onChange, compact }: { value: Gradient; onChange: (g: Gradient) => void; compact?: boolean }) {
  const [sel, setSel] = useState(0);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const update = (f: (g: Gradient) => void) => {
    const g = value.clone();
    f(g);
    onChange(g);
  };
  const posOf = (e: { clientX: number }) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  if (compact) return <div className="grad-bar" style={{ background: gradientCss(value), cursor: "default" }} title="Gradient (edit in the inspector)" {...gradientDrop(onChange)} />;
  const sorted = value.points;
  return (
    <div className="nodrag" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ position: "relative", paddingBottom: 14 }}>
        <div
          ref={bar}
          className="grad-bar"
          {...gradientDrop(onChange)}
          style={{ background: gradientCss(value) }}
          title="Double click to add a point"
          onDoubleClick={(e) => {
            const x = posOf(e);
            update((g) => {
              g.points.push({ v: x, c: { ...value.getColor(x) } });
            });
          }}
        />
        {sorted.map((p, i) => (
          <div
            key={i}
            className={"grad-stop" + (i === sel ? " sel" : "")}
            style={{ left: `${p.v * 100}%`, background: css({ ...p.c, a: 1 }) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSel(i);
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => {
                const x = posOf(ev);
                const g = value.clone();
                g.points[i].v = x;
                onChange(g);
              };
              const up = () => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
            }}
            onDoubleClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <select value={value.interpolation} onChange={(e) => update((g) => (g.interpolation = +e.target.value as Interpolation))}>
          <option value={0}>Constant</option>
          <option value={1}>Linear</option>
          <option value={2}>Smooth</option>
          <option value={3}>Cubic</option>
        </select>
        <button onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())} disabled={!sorted[sel]}>
          Color…
        </button>
        <button disabled={sorted.length <= 1 || !sorted[sel]} onClick={() => {
            update((g) => void g.points.splice(sel, 1));
            setSel(0);
          }}>
          Remove
        </button>
        <button onClick={() => update((g) => g.points.forEach((p) => void (p.v = 1 - p.v)))}>Reverse</button>
        <button onClick={() => update((g) => g.points.sort((a, b) => a.v - b.v).forEach((p, i, a) => (p.v = a.length > 1 ? i / (a.length - 1) : 0)))}>Even</button>
      </div>
      {picker && sorted[sel] && (
        <ColorPopover
          rect={picker}
          value={sorted[sel].c}
          onChange={(c) =>
            update((g) => {
              g.points[sel].c = c;
            })
          }
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
