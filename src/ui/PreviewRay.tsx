import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "./store";
import type { GenMaterial } from "../engine/gen/misc";
import { raymarchPreview, type RayShape } from "../engine/preview3d";

/** the 3D preview of materials evaluated in 3D space, rendered by the material renderer itself */
export function PreviewRay({ m }: { m: GenMaterial }) {
  useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState({ yaw: 0.6, pitch: -0.35, dist: 2.2 });
  const [shape, setShape] = useState<RayShape>("sphere");
  const [size, setSize] = useState(384);
  const [error, setError] = useState("");
  const isRaymarch = m.getInputDefs().some((d) => d.name === "distance");
  useEffect(() => {
    const r = editor.renderer;
    if (!r || !canvas.current) return;
    const id = requestAnimationFrame(() => {
      try {
        r.time = performance.now() / 1000;
        const res = r.renderKeyed("3d-ray", raymarchPreview(m, { ...cam, dist: isRaymarch ? cam.dist * 1.4 : cam.dist }, shape), size, false);
        setError(res.error ? res.error.message : "");
        if (res.target) r.present(res.target, canvas.current!.getContext("2d")!, false);
      } catch (e) {
        setError(String(e));
      }
    });
    return () => cancelAnimationFrame(id);
  }, [m, cam, shape, size, editor.version, isRaymarch]);
  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        {!isRaymarch && m.getInputDefs().some((d) => d.name === "albedo_tex") && (
          <select value={shape} onChange={(e) => setShape(e.target.value as RayShape)}>
            <option value="sphere">sphere</option>
            <option value="cube">cube</option>
          </select>
        )}
        <select value={size} onChange={(e) => setSize(+e.target.value)}>
          {[256, 384, 512, 768].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        <span style={{ color: "var(--text3)" }}>drag to turn · wheel to zoom</span>
      </div>
      <div className="body">
        <canvas
          ref={canvas}
          width={size}
          height={size}
          className="p2d"
          style={{ cursor: "grab", touchAction: "none" }}
          onPointerDown={(e) => {
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            let lx = e.clientX,
              ly = e.clientY;
            const move = (ev: PointerEvent) => {
              const dx = ev.clientX - lx,
                dy = ev.clientY - ly;
              lx = ev.clientX;
              ly = ev.clientY;
              setCam((c) => ({ ...c, yaw: c.yaw - dx * 0.01, pitch: Math.max(-1.5, Math.min(1.5, c.pitch - dy * 0.01)) }));
            };
            const up = () => {
              el.removeEventListener("pointermove", move);
              el.removeEventListener("pointerup", up);
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", up);
          }}
          onWheel={(e) => setCam((c) => ({ ...c, dist: Math.max(0.8, Math.min(8, c.dist * (e.deltaY > 0 ? 1.1 : 0.9))) }))}
        />
        {error && <div className="empty" style={{ position: "absolute", inset: "auto 0 0 0", background: "#000a", color: "var(--danger)" }}>{error}</div>}
      </div>
    </div>
  );
}
