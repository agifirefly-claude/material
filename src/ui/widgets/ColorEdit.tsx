import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Color } from "../../engine/params/types";
import { colorDrop } from "./dnd";

export const toHex = (c: Color) => "#" + [c.r, c.g, c.b].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string, a = 1): Color => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a });
export const css = (c: Color) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

/** a swatch that opens a picker with alpha and exact values */
export function ColorEdit({ value, onChange }: { value: Color; onChange: (c: Color) => void }) {
  const [open, setOpen] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={ref} className="color-swatch nodrag" title={toHex(value) + " α " + value.a.toFixed(2)} onClick={() => setOpen(ref.current!.getBoundingClientRect())} {...colorDrop(onChange)}>
        <div style={{ background: css(value) }} />
      </div>
      {open && <ColorPopover rect={open} value={value} onChange={onChange} onClose={() => setOpen(null)} />}
    </>
  );
}

export function ColorPopover({ rect, value, onChange, onClose }: { rect: DOMRect; value: Color; onChange: (c: Color) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    setTimeout(() => window.addEventListener("pointerdown", h), 0);
    return () => window.removeEventListener("pointerdown", h);
  }, [onClose]);
  const top = Math.min(rect.bottom + 4, window.innerHeight - 200);
  const left = Math.min(rect.left, window.innerWidth - 230);
  const ch = (k: keyof Color, v: number) => onChange({ ...value, [k]: v });
  return createPortal(
    <div ref={ref} className="popover nodrag nowheel" style={{ top, left, width: 220 }} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <input type="color" value={toHex(value)} onChange={(e) => onChange(fromHex(e.target.value, value.a))} style={{ width: 48, height: 28, padding: 0, border: "none", background: "none" }} />
        <input type="text" value={toHex(value)} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && onChange(fromHex(e.target.value, value.a))} style={{ width: 80 }} />
      </div>
      {(["r", "g", "b", "a"] as const).map((k) => (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "14px 1fr 46px", gap: 4, alignItems: "center" }}>
          <span>{k.toUpperCase()}</span>
          <input type="range" min={0} max={1} step={0.001} value={value[k]} onChange={(e) => ch(k, +e.target.value)} />
          <input type="number" min={0} max={1} step={0.01} value={+value[k].toFixed(3)} onChange={(e) => ch(k, +e.target.value)} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
