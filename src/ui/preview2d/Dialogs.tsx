/* Export animation and TAA render windows (ports of windows/export_animation and windows/export_taa). They open from
 * the File menu (for the selected node) or the 2D preview's export menu (for the node it shows). */
import { useEffect, useRef, useState } from "react";
import type { Gen } from "../../engine/gen/base";
import { editor } from "../store";
import { downloadBlob } from "../exporting";
import { rootOf } from "../../engine/render/maps";
import { canvasBlob, canvasOf, exportAnimation, renderImage, targetExr, TaaRender, type AnimationSettings, type TaaSettings } from "./exports";
import { t } from "../i18n";
import { getPrefs } from "../prefs";

export type DialogRequest = { kind: "animation" | "taa"; gen?: Gen; output?: number };

/** opens an export window; without a node, the selected one */
export function openExportDialog(req: DialogRequest) {
  window.dispatchEvent(new CustomEvent("mm-export-dialog", { detail: req }));
}

const SIZES = [6, 7, 8, 9, 10, 11, 12];
const LAYOUTS: [number, string][] = [
  [0, "Image sequence (zip)"],
  [1, "Spritesheet, 1 row"],
  [2, "Spritesheet, 2 rows"],
  [4, "Spritesheet, 4 rows"],
  [8, "Spritesheet, 8 rows"],
  [-2, "Spritesheet, 2 columns"],
  [-4, "Spritesheet, 4 columns"],
  [-8, "Spritesheet, 8 columns"],
];
const loadSettings = <T,>(k: string, d: T): T => {
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(k) ?? "{}") };
  } catch {
    return d;
  }
};

export function ExportDialogsHost() {
  const [req, setReq] = useState<Required<DialogRequest> | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as DialogRequest;
      const gen = d.gen ?? editor.selected;
      if (!gen || !gen.getOutputDefs().length) {
        editor.setStatus(t("Select a node with an output first"));
        return;
      }
      setReq({ kind: d.kind, gen, output: d.output ?? Math.max(0, gen.preview) });
    };
    window.addEventListener("mm-export-dialog", h);
    return () => window.removeEventListener("mm-export-dialog", h);
  }, []);
  if (!req) return null;
  const close = () => setReq(null);
  return req.kind === "animation" ? <AnimationDialog gen={req.gen} output={req.output} onClose={close} /> : <TaaDialog gen={req.gen} output={req.output} onClose={close} />;
}

function Thumb({ gen, output, time, size = 128 }: { gen: Gen; output: number; time: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const r = editor.renderer;
    if (!r || !ref.current) return;
    try {
      ref.current.getContext("2d")!.putImageData(renderImage(r, gen, output, size, time), 0, 0);
    } catch (e) {
      console.warn(e);
    }
  }, [gen, output, time, size]);
  return <canvas ref={ref} width={size} height={size} className="dlg-thumb" />;
}

function AnimatedThumb({ gen, output, begin, end, size = 128 }: { gen: Gen; output: number; begin: number; end: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0,
      last = 0;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 66 || !ref.current || !editor.renderer) return;
      last = now;
      const span = Math.abs(end - begin);
      const t = span === 0 ? begin : begin + Math.sign(end - begin) * (((now - start) / 1000) % span);
      try {
        ref.current.getContext("2d")!.putImageData(renderImage(editor.renderer, gen, output, size, t), 0, 0);
      } catch {
        cancelAnimationFrame(raf);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gen, output, begin, end, size]);
  return <canvas ref={ref} width={size} height={size} className="dlg-thumb" />;
}

function AnimationDialog({ gen, output, onClose }: { gen: Gen; output: number; onClose: () => void }) {
  const [s, setS] = useState<AnimationSettings & { sizeExp: number; heightExp: number }>(() => {
    const d = { size: 256, sizeExp: 8, heightExp: 8, begin: 0, end: 1, images: 16, spritesheet: 4 };
    // Material Maker's remember_anim_export
    return getPrefs().rememberAnimExport ? loadSettings("material-pro:export-animation", d) : d;
  });
  const [progress, setProgress] = useState<number | null>(null);
  const set = (p: Partial<typeof s>) => setS((x) => ({ ...x, ...p }));
  const run = async () => {
    if (getPrefs().rememberAnimExport) localStorage.setItem("material-pro:export-animation", JSON.stringify(s));
    setProgress(0);
    const name = `${editor.title}_${gen.name}`;
    const blob = await exportAnimation(editor.renders!, gen, output, { ...s, size: 2 ** s.sizeExp, height: 2 ** (s.heightExp ?? s.sizeExp) }, name, setProgress);
    downloadBlob(blob, s.spritesheet === 0 ? `${name}_frames.zip` : `${name}_spritesheet.png`);
    setProgress(null);
    editor.setStatus(t("Exported {0} frames", s.images));
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <h2>{t("Export animation —")}{" "}{gen.getTypeName()}</h2>
        <div className="dlg-grid">
          <label>{t("Width")}</label>
          <select value={s.sizeExp} onChange={(e) => set({ sizeExp: +e.target.value })}>
            {SIZES.map((i) => (
              <option key={i} value={i}>
                {2 ** i}
              </option>
            ))}
          </select>
          <label>{t("Height")}</label>
          <select value={s.heightExp ?? s.sizeExp} onChange={(e) => set({ heightExp: +e.target.value })}>
            {SIZES.map((i) => (
              <option key={i} value={i}>
                {2 ** i}
              </option>
            ))}
          </select>
          <label>{t("Begin (s)")}</label>
          <input type="number" step={0.05} value={s.begin} onChange={(e) => set({ begin: +e.target.value })} />
          <label>{t("End (s)")}</label>
          <input type="number" step={0.05} value={s.end} onChange={(e) => set({ end: +e.target.value })} />
          <label>{t("Images")}</label>
          <input type="number" min={1} max={256} value={s.images} onChange={(e) => set({ images: Math.max(1, Math.round(+e.target.value)) })} />
          <label>{t("Layout")}</label>
          <select value={s.spritesheet} onChange={(e) => set({ spritesheet: +e.target.value })}>
            {LAYOUTS.map(([v, l]) => (
              <option key={v} value={v}>
                {t(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="dlg-thumbs">
          <figure>
            <Thumb gen={gen} output={output} time={s.begin} />
            <figcaption>{t("Begin")}</figcaption>
          </figure>
          <figure>
            <AnimatedThumb gen={gen} output={output} begin={s.begin} end={s.end} />
            <figcaption>{t("Animated")}</figcaption>
          </figure>
          <figure>
            <Thumb gen={gen} output={output} time={s.end} />
            <figcaption>{t("End")}</figcaption>
          </figure>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {progress !== null && <span>{Math.round(progress * 100)}%</span>}
          <button onClick={onClose}>{t("Close")}</button>
          <button className="primary" disabled={progress !== null} onClick={run}>
            {t("Export…")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaaDialog({ gen, output, onClose }: { gen: Gen; output: number; onClose: () => void }) {
  const [dims, setDims] = useState<[number, number]>([512, 512]);
  const [s, setS] = useState<TaaSettings>({ gamma: 1, denoise: 0, radius: 1, sigma: 1, kSigma: 1, threshold: 0.1 });
  const [iteration, setIteration] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const taa = useRef<TaaRender | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const settings = useRef(s);
  settings.current = s;
  const [width, height] = dims;
  useEffect(() => {
    const r = editor.renderer!;
    const t = new TaaRender(r, gen, output, width, height);
    taa.current = t;
    let raf = 0;
    // samples start once the pictures are there, or the first ones would be black where they go (#758)
    let ready = false;
    void r.imagesLoaded(rootOf(gen)).then(() => (ready = true));
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!ready || t.iteration >= 4096 || pausedRef.current) return;
      try {
        // as many samples as fit in a few milliseconds, so the page stays responsive
        const start = performance.now();
        const before = t.iteration;
        do t.step();
        while (performance.now() - start < 8 && t.iteration < 4096);
        if (Math.floor(t.iteration / 16) !== Math.floor(before / 16) || t.iteration <= 4) {
          r.present(t.resolve(settings.current), canvas.current!.getContext("2d")!, false);
          setIteration(t.iteration);
        }
      } catch (e) {
        console.warn("TAA", e);
        cancelAnimationFrame(raf);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      t.dispose();
      taa.current = null;
    };
  }, [gen, output, width, height]);
  useEffect(() => {
    const t = taa.current;
    if (t && editor.renderer && canvas.current) editor.renderer.present(t.resolve(s), canvas.current.getContext("2d")!, false);
  }, [s]);
  const set = (p: Partial<TaaSettings>) => setS((x) => ({ ...x, ...p }));
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 620 }}>
        <h2>{t("TAA render —")}{" "}{gen.getTypeName()}</h2>
        <p style={{ color: "var(--text2)", marginTop: 0 }}>{t("Accumulates renders with sub-pixel jitter (and the time moving), then averages them: anti-aliasing for shapes and noise.")}</p>
        <div style={{ display: "flex", gap: 12 }}>
          <canvas ref={canvas} width={width} height={height} style={{ width: width >= height ? 320 : (320 * width) / height, height: height >= width ? 320 : (320 * height) / width, background: "#000" }} />
          <div className="dlg-grid" style={{ alignContent: "start" }}>
            <label>{t("Width")}</label>
            <input type="number" min={16} max={8192} step={16} defaultValue={width} onBlur={(e) => setDims([Math.min(8192, Math.max(16, Math.round(+e.target.value))), height])} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
            <label>{t("Height")}</label>
            <input type="number" min={16} max={8192} step={16} defaultValue={height} onBlur={(e) => setDims([width, Math.min(8192, Math.max(16, Math.round(+e.target.value)))])} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
            <label>{t("Gamma")}</label>
            <input type="number" step={0.1} min={0.1} value={s.gamma} onChange={(e) => set({ gamma: +e.target.value })} />
            <label>{t("Denoise")}</label>
            <select value={s.denoise} onChange={(e) => set({ denoise: +e.target.value as 0 | 1 | 2 })}>
              <option value={0}>{t("None")}</option>
              <option value={1}>{t("Box")}</option>
              <option value={2}>{t("Smart")}</option>
            </select>
            {s.denoise === 1 && (
              <>
                <label>{t("Radius")}</label>
                <input type="number" min={1} max={8} value={s.radius} onChange={(e) => set({ radius: Math.round(+e.target.value) })} />
              </>
            )}
            {s.denoise === 2 && (
              <>
                <label>{t("Sigma")}</label>
                <input type="number" step={0.1} min={0.1} value={s.sigma} onChange={(e) => set({ sigma: +e.target.value })} />
                <label>{t("kSigma")}</label>
                <input type="number" step={0.1} min={0} value={s.kSigma} onChange={(e) => set({ kSigma: +e.target.value })} />
                <label>{t("Threshold")}</label>
                <input type="number" step={0.01} min={0.01} value={s.threshold} onChange={(e) => set({ threshold: +e.target.value })} />
              </>
            )}
            <label>{t("Iterations")}</label>
            <span className="taa-iter">{iteration}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
          <button onClick={() => setPaused(!paused)}>{paused ? t("Resume") : t("Pause")}</button>
          <button onClick={onClose}>{t("Close")}</button>
          <button
            className="primary"
            onClick={async () => {
              const t = taa.current;
              const r = editor.renderer!;
              if (!t) return;
              downloadBlob(await canvasBlob(canvasOf(r.toImageData(t.resolve(s)))), `${editor.title}_${gen.name}_taa.png`);
            }}
          >
            {t("Export PNG…")}
          </button>
          <button
            onClick={() => {
              const tr = taa.current;
              if (!tr) return;
              downloadBlob(targetExr(editor.renderer!, tr.resolve(s)), `${editor.title}_${gen.name}_taa.exr`);
            }}
          >
            {t("Export EXR…")}
          </button>
        </div>
      </div>
    </div>
  );
}
