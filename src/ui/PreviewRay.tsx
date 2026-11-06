import { useEffect, useRef, useState } from "react";
import { editor, useEditor } from "./store";
import type { GenMaterial } from "../engine/gen/misc";
import { raymarchPreview, type RayShape } from "../engine/preview3d";
import { t } from "./i18n";

/** the 3D preview of materials evaluated in 3D space, rendered by the material renderer itself */
export function PreviewRay({ m }: { m: GenMaterial }) {
  useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState({ yaw: 0.6, pitch: -0.35, dist: 2.2 });
  const [shape, setShape] = useState<RayShape>("sphere");
  const [size, setSize] = useState(384);
  const [error, setError] = useState("");
  const isRaymarch = m.getInputDefs().some((d) => d.name === "distance");
  // in the render worker where the browser can: the page only builds the shader; one render at a time, the newest
  // request wins
  const busy = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => () => editor.renders?.forget("3d-ray"), []);
  useEffect(() => {
    const r = editor.renders;
    if (!r || !canvas.current) return;
    let stale = false;
    const id = requestAnimationFrame(async () => {
      await busy.current;
      if (stale || !canvas.current) return;
      try {
        r.time = performance.now() / 1000;
        const sc = raymarchPreview(m, { ...cam, dist: isRaymarch ? cam.dist * 1.4 : cam.dist }, shape);
        const job = r.previews([{ key: "3d-ray", sc, size, preview: false, ctx: canvas.current.getContext("2d")!, checker: false, force: true }], { lane: "view" });
        busy.current = job.catch(() => null);
        const [res] = await job;
        if (!stale) setError(res.error ? res.error.message : "");
      } catch (e) {
        setError(String(e));
      }
    });
    return () => {
      stale = true;
      cancelAnimationFrame(id);
    };
  }, [m, cam, shape, size, editor.contentVersion, isRaymarch]);
  return (
    <div className="preview-pane" style={{ flex: 1 }}>
      <div className="tools">
        {!isRaymarch && m.getInputDefs().some((d) => d.name === "albedo_tex") && (
          <select value={shape} onChange={(e) => setShape(e.target.value as RayShape)}>
            <option value="sphere">{t("sphere")}</option>
            <option value="cube">{t("cube")}</option>
          </select>
        )}
        <select value={size} onChange={(e) => setSize(+e.target.value)}>
          {[256, 384, 512, 768].map((s) => (
            <option key={s} value={s}>
              {s}{t("px")}
            </option>
          ))}
        </select>
        <span style={{ color: "var(--text3)" }}>{t("drag to turn · wheel to zoom")}</span>
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
