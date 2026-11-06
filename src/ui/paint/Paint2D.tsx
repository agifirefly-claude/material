/* The 2D paint view (paint.tscn's Painter2D): a composited map in texture space, painted directly
 * (PAINTING_MODE_TEXTURE). Wheel zooms, middle drag pans. */
import { useEffect, useRef, useState } from "react";
import { paint, usePaint } from "./paintStore";
import { StrokeState, paintAt, pressureOf, strokeMotion } from "./PaintView";
import { GLSL_HEADER, Gpu } from "../../engine/paint/gpu";
import { t } from "../i18n";

const CHANNELS = [
  ["albedo", "Albedo"],
  ["metallic", "Metallic"],
  ["roughness", "Roughness"],
  ["emission", "Emission"],
  ["normal_map", "Normal map"],
  ["depth", "Depth"],
  ["occlusion", "Occlusion"],
] as const;

// preview_2d of the paint view: the texture region around a centre at a scale
const VIEW_FS = `uniform sampler2D src; uniform vec2 view; uniform vec2 center; uniform float scale; out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x, view.y - gl_FragCoord.y);
  vec2 uv = center + (px - 0.5*view) * scale / min(view.x, view.y);
  vec4 c = texture(src, uv);
  vec2 cb = floor(px / 8.0);
  float k = mod(cb.x + cb.y, 2.0) == 0.0 ? 0.3 : 0.4;
  vec3 col = mix(vec3(k), clamp(c.rgb, 0.0, 1.0), clamp(c.a, 0.0, 1.0));
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) col *= 0.35;
  o = vec4(col, 1.0);
}`;

export function Paint2D() {
  usePaint();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number][0]>("albedo");
  const view = useRef({ center: [0.5, 0.5] as [number, number], scale: 1, drag: false });
  const stroke = useRef(new StrokeState());
  const [, setTick] = useState(0);
  const p = paint.project!;

  const draw = () => {
    const c = canvas.current;
    if (!c || !paint.project) return;
    const t = paint.project.compositor.maps[channel];
    if (!t) return;
    const gpu = paint.project.gpu;
    const prog = gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + VIEW_FS);
    const r = paint.project.renderer;
    if (r.canvas.width < c.width || r.canvas.height < c.height) {
      r.canvas.width = Math.max(r.canvas.width, c.width);
      r.canvas.height = Math.max(r.canvas.height, c.height);
    }
    gpu.pass(prog, null, c.width, c.height, { src: t, view: [c.width, c.height], center: view.current.center, scale: view.current.scale });
    const ctx = c.getContext("2d")!;
    ctx.drawImage(r.canvas as CanvasImageSource, 0, r.canvas.height - c.height, c.width, c.height, 0, 0, c.width, c.height);
  };

  useEffect(() => {
    const c = canvas.current!;
    const ro = new ResizeObserver(() => {
      c.width = Math.max(1, c.clientWidth);
      c.height = Math.max(1, c.clientHeight);
      void (paint.project?.compositeAsync() ?? Promise.resolve()).then(draw);
    });
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let raf = 0;
    // the maps are composited without waiting for the GPU, then drawn
    let alive = true;
    const redraw = () => p.compositeAsync().then(() => alive && draw());
    const off = p.onChange(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(redraw);
    });
    redraw();
    return () => {
      alive = false;
      off();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, channel]);

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const mode = () => {
    const c = canvas.current!;
    return { textureSpace: true, rect: [c.width, c.height] as [number, number], center: view.current.center, scale: view.current.scale };
  };
  return (
    <div className="paint-2d">
      <div className="tools">
        <select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
          {CHANNELS.map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            view.current.center = [0.5, 0.5];
            view.current.scale = 1;
            draw();
            setTick((x) => x + 1);
          }}
        >
          {t("Fit")}
        </button>
        <span style={{ color: "var(--text3)" }}>{t("paint in texture space · wheel zoom · middle drag pan")}</span>
      </div>
      <canvas
        ref={canvas}
        className="paint-2d-canvas"
        onContextMenu={(e) => e.preventDefault()}
        onWheel={(e) => {
          const c = canvas.current!;
          const v = view.current;
          const pos = local(e);
          const m = Math.min(c.width, c.height);
          const ns = Math.min(5, Math.max(0.005, v.scale * (e.deltaY > 0 ? 1.05 : 0.95)));
          const off = [pos[0] - c.width / 2, pos[1] - c.height / 2];
          v.center = [v.center[0] + (off[0] * (v.scale - ns)) / m, v.center[1] + (off[1] * (v.scale - ns)) / m];
          v.scale = ns;
          draw();
        }}
        onPointerDown={(e) => {
          paint.focus = "paint";
          e.currentTarget.setPointerCapture(e.pointerId);
          if (e.button === 1) {
            view.current.drag = true;
            return;
          }
          if (e.button !== 0 || paint.tool >= 2) return;
          const s = stroke.current;
          s.length = 0;
          s.lastPainted = [-1e9, -1e9];
          s.previous = local(e);
          s.painting = true;
          paintAt(p, s, local(e), pressureOf(e), mode());
        }}
        onPointerMove={(e) => {
          const v = view.current;
          if (v.drag) {
            const c = canvas.current!;
            const m = Math.min(c.width, c.height);
            v.center = [Math.min(1, Math.max(0, v.center[0] - (e.movementX * v.scale) / m)), Math.min(1, Math.max(0, v.center[1] - (e.movementY * v.scale) / m))];
            draw();
            return;
          }
          const s = stroke.current;
          if (!s.painting || !(e.buttons & 1)) return;
          strokeMotion(p, s, local(e), pressureOf(e));
          paintAt(p, s, local(e), pressureOf(e), mode());
        }}
        onPointerUp={(e) => {
          view.current.drag = false;
          const s = stroke.current;
          if (!s.painting) return;
          s.painting = false;
          paintAt(p, s, local(e), pressureOf(e), mode(), true);
          s.reset();
          paint.emit();
        }}
      />
    </div>
  );
}
