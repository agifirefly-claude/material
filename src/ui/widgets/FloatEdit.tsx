import { useRef, useState } from "react";
import { t } from "../i18n";

/** Material Maker's float field: drag sideways to change, double click to type a number or an expression. */
export function FloatEdit({ value, min = 0, max = 1, step = 0.01, onChange, onCommit, allowExpr = true, title }: {
  value: number | string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number | string) => void;
  onCommit?: () => void;
  allowExpr?: boolean;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const isNum = typeof value === "number";
  const v = isNum ? value : NaN;
  const frac = isNum && max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
  const shown = isNum ? v.toFixed(decimals) : String(value);
  const snap = (x: number) => {
    const s = step > 0 ? Math.round(x / step) * step : x;
    return parseFloat(s.toFixed(6));
  };
  if (editing) {
    return (
      <div className="float-edit nodrag" title={title}>
        <input
          autoFocus
          defaultValue={isNum ? String(v) : String(value)}
          onBlur={(e) => {
            setEditing(false);
            commitText(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
        />
      </div>
    );
  }
  function commitText(t: string) {
    const n = Number(t);
    if (t.trim() !== "" && Number.isFinite(n)) onChange(n);
    else if (allowExpr && t.trim() !== "") onChange(t.trim());
    onCommit?.();
  }
  return (
    <div
      className={"float-edit nodrag" + (isNum ? "" : " expr")}
      title={title ?? (isNum ? `${min} … ${max}` : t("expression"))}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: isNum ? v : min, moved: false };
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 2) d.moved = true;
        if (!d.moved) return;
        const w = e.currentTarget.clientWidth || 100;
        const range = max - min || 1;
        const k = e.shiftKey ? 0.1 : 1;
        onChange(snap(d.v + (dx / w) * range * k));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) setEditing(true);
        else onCommit?.();
      }}
      onWheel={(e) => {
        if (!isNum || !e.altKey) return;
        onChange(snap(v + (e.deltaY < 0 ? step : -step)));
      }}
    >
      <div className="bar" style={{ width: `${frac * 100}%` }} />
      <div className="val">{shown}</div>
    </div>
  );
}
