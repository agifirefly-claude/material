/* The Tones node's own UI (port of nodes/tones and widgets/histogram): the histogram of its input, with handles for
 * the input min/mid/max levels on top and the output min/max below, per channel or for all three colour channels. */
import { useEffect, useRef, useState } from "react";
import type { Gen } from "../engine/gen/base";
import { GenContext } from "../engine/context";
import { isColor, type Color } from "../engine/params/types";
import { withPreview } from "../engine/render/shader-source";
import { editor, useEditor } from "./store";
import { t } from "./i18n";

const MODES = ["Luminance", "Red", "Green", "Blue", "Alpha"] as const;
const CURSORS = [
  { p: "in_min", top: true, color: "#000", d: 0 },
  { p: "in_mid", top: true, color: "#808080", d: 0.5 },
  { p: "in_max", top: true, color: "#fff", d: 1 },
  { p: "out_min", top: false, color: "#000", d: 0 },
  { p: "out_max", top: false, color: "#fff", d: 1 },
] as const;
const W = 256,
  H = 80;

/** 256 bins per channel (r, g, b, a) of the image the generator produces, normalised to its tallest bin. Rendered by
 *  the render service: in the worker where the browser can. */
export async function histogram(g: Gen, output: number, size = 128): Promise<Float32Array[] | null> {
  const r = editor.renders;
  if (!r) return null;
  const sc = g.getShaderCode("uv", output, new GenContext());
  if (!sc.outputType) return null;
  return binsOf(await r.floats(withPreview(sc, size), size, { preview: false }));
}

/** 256 bins per channel of float pixels, normalised to the tallest bin */
export function binsOf(px: Float32Array): Float32Array[] {
  const bins = [0, 1, 2, 3].map(() => new Float32Array(256));
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 4; c++) bins[c][Math.max(0, Math.min(255, Math.round(px[i + c] * 255)))]++;
  for (const b of bins) {
    let m = 0;
    for (let i = 0; i < 256; i++) m = Math.max(m, b[i]);
    m ||= 1;
    for (let i = 0; i < 256; i++) b[i] /= m;
  }
  return bins;
}

export function isTones(g: Gen): boolean {
  return g.model === "tones";
}

export function TonesEditor({ gen }: { gen: Gen }) {
  useEditor();
  const [mode, setMode] = useState(0);
  const [bins, setBins] = useState<Float32Array[] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const src = gen.getSource(0);

  // the histogram follows the input
  useEffect(() => {
    if (!src) return setBins(null);
    let stale = false;
    const t = setTimeout(() => {
      histogram(src.generator, src.outputIndex).then(
        (b) => !stale && setBins(b),
        () => !stale && setBins(null),
      );
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [src?.generator, src?.outputIndex, editor.contentVersion]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#151619";
    ctx.fillRect(0, 0, W, H);
    if (!bins) return;
    const channels: [number, string][] = mode === 0 ? [[0, "#ff4040aa"], [1, "#40ff40aa"], [2, "#4080ffaa"]] : [[mode - 1, ["#ff4040", "#40ff40", "#4080ff", "#dddddd"][mode - 1]]];
    ctx.globalCompositeOperation = "lighter";
    for (const [ch, col] of channels) {
      ctx.fillStyle = col;
      for (let i = 0; i < 256; i++) {
        const h = bins[ch][i] * (H - 4);
        ctx.fillRect((i / 256) * W, H - h, W / 256 + 0.5, h);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }, [bins, mode]);

  const valueOf = (p: string): number => {
    const v = gen.getParameter(p);
    if (!isColor(v)) return 0;
    return mode === 0 ? (v.r + v.g + v.b) / 3 : [v.r, v.g, v.b, v.a][mode - 1];
  };
  const setValue = (p: string, x: number, d: number) => {
    const v = gen.getParameter(p);
    const c: Color = isColor(v) ? { ...v } : { r: d, g: d, b: d, a: d };
    x = Math.min(1, Math.max(0, x));
    if (mode === 0) {
      c.r = c.g = c.b = x;
      c.a = d;
    } else c[(["r", "g", "b", "a"] as const)[mode - 1]] = x;
    gen.setParameter(p, c);
  };
  const auto = () => {
    if (!bins) return;
    let min = -1,
      max = -1,
      mid = -1,
      midv = 0;
    for (let i = 0; i < 256; i++) {
      const v = mode === 0 ? (bins[0][i] + bins[1][i] + bins[2][i]) / 3 : bins[mode - 1][i];
      if (v > 0) {
        if (min === -1) min = i;
        max = i;
        if (midv < v) {
          mid = i;
          midv = v;
        }
      }
    }
    if (min < 0) return;
    setValue("in_min", min / 255, 0);
    setValue("in_mid", mid / 255, 0.5);
    setValue("in_max", max / 255, 1);
    editor.snapshot();
  };
  const reset = () => {
    for (const c of CURSORS) setValue(c.p, c.d, c.d);
    editor.snapshot();
  };

  return (
    <div className="tones nodrag nowheel">
      <div className="tones-bar">
        <select value={mode} onChange={(e) => setMode(+e.target.value)}>
          {MODES.map((m, i) => (
            <option key={m} value={i}>
              {t(m)}
            </option>
          ))}
        </select>
        <button onClick={auto} disabled={!bins} title={t("Fit the input levels to the histogram")}>
          {t("Auto")}
        </button>
        <button onClick={reset}>{t("Reset")}</button>
      </div>
      <div className="tones-hist" style={{ width: W, height: H + 24 }}>
        <canvas ref={canvas} width={W} height={H} style={{ top: 12 }} />
        {!src && <div className="tones-empty">{t("Connect an input to see its histogram")}</div>}
        {CURSORS.map((c) => (
          <svg
            key={c.p}
            className="tones-cursor"
            width={12}
            height={12}
            style={{ left: valueOf(c.p) * W - 6, top: c.top ? 0 : H + 12 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const el = e.currentTarget as SVGSVGElement;
              el.setPointerCapture(e.pointerId);
              const rect = el.parentElement!.getBoundingClientRect();
              const move = (ev: PointerEvent) => setValue(c.p, (ev.clientX - rect.left) / rect.width, c.d);
              const up = () => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
                editor.snapshot();
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
            }}
          >
            <title>{c.p.replace("_", " ")}</title>
            <polygon points={c.top ? "0,0 6,12 12,0" : "0,12 6,0 12,12"} fill={c.color} stroke={valueOf(c.p) > 0.5 ? "#000" : "#fff"} />
          </svg>
        ))}
      </div>
    </div>
  );
}
