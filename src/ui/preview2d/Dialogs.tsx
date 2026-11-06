/* Export animation and TAA render windows (ports of windows/export_animation and windows/export_taa). They open from
 * the File menu (for the selected node) or the 2D preview's export menu (for the node it shows). */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Gen } from "../../engine/gen/base";
import { editor } from "../store";
import { downloadBlob } from "../exporting";
import { rootOf } from "../../engine/render/maps";
import { exportAnimation, TaaRender, type AnimationSettings, type TaaSettings } from "./exports";
import { imageShaderCode } from "./view";
import { MainOnlyError } from "../../engine/render/recorder";
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

let thumbKeys = 0;
/** draws one output at a time into a canvas, through the render service's previews (in the worker where it can) */
function drawThumb(key: string, gen: Gen, output: number, size: number, time: number, ctx: CanvasRenderingContext2D): Promise<void> {
  const r = editor.renders;
  if (!r) return Promise.resolve();
  const saved = r.time;
  r.time = time;
  // the previews are recorded at once: the time can go back right away
  const job = r.previews([{ key, sc: imageShaderCode(gen, output, size), size, preview: false, ctx, checker: false, force: true }]);
  r.time = saved;
  return job.then(([res]) => {
    if (res.error) throw res.error;
  });
}

function Thumb({ gen, output, time, size = 128 }: { gen: Gen; output: number; time: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = useMemo(() => "anim-thumb:" + thumbKeys++, []);
  useEffect(() => () => editor.renders?.forget(key), [key]);
  useEffect(() => {
    if (!ref.current) return;
    drawThumb(key, gen, output, size, time, ref.current.getContext("2d")!).catch((e) => console.warn(e));
  }, [gen, output, time, size, key]);
  return <canvas ref={ref} width={size} height={size} className="dlg-thumb" />;
}

function AnimatedThumb({ gen, output, begin, end, size = 128 }: { gen: Gen; output: number; begin: number; end: number; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = useMemo(() => "anim-thumb:" + thumbKeys++, []);
  useEffect(() => () => editor.renders?.forget(key), [key]);
  useEffect(() => {
    let raf = 0,
      last = 0,
      busy = false,
      stopped = false;
    const start = performance.now();
    const loop = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      // one frame at a time: the next waits for the one being rendered
      if (busy || now - last < 66 || !ref.current) return;
      last = now;
      const span = Math.abs(end - begin);
      const t = span === 0 ? begin : begin + Math.sign(end - begin) * (((now - start) / 1000) % span);
      busy = true;
      drawThumb(key, gen, output, size, t, ref.current.getContext("2d")!)
        .then(() => (busy = false))
        .catch(() => {
          stopped = true;
          cancelAnimationFrame(raf);
        });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [gen, output, begin, end, size, key]);
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
    const svc = editor.renders!;
    let stopped = false;
    let t: TaaRender | null = null;
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    const run = async (onPage: boolean) => {
      t = new TaaRender(svc.session({ onPage }), gen, output, width, height);
      taa.current = t;
      // samples start once the pictures are there, or the first ones would be black where they go (#758)
      await svc.imagesLoaded(rootOf(gen));
      // in the worker: a batch of samples at a time, sized to take a few tens of milliseconds
      let n = 1;
      while (!stopped) {
        await frame();
        if (stopped || t.iteration >= 4096 || pausedRef.current) continue;
        const start = performance.now();
        const before = t.iteration;
        if (t.session.onWorker) for (let i = 0; i < n && t.iteration < 4096; i++) t.step();
        // on the page: as many samples as fit in a few milliseconds, so the page stays responsive
        else
          do {
            t.step();
            t.session.sync();
          }
          while (performance.now() - start < 8 && t.iteration < 4096);
        const show = Math.floor(t.iteration / 16) !== Math.floor(before / 16) || t.iteration <= 4 || t.iteration >= 4096;
        if (show) await t.show(settings.current, canvas.current!.getContext("2d")!);
        else await t.session.flush();
        if (stopped) break;
        if (show) setIteration(t.iteration);
        const ms = performance.now() - start;
        if (ms < 30) n = Math.min(64, n * 2);
        else if (ms > 60) n = Math.max(1, n >> 1);
      }
    };
    run(false)
      .catch((e) => {
        // a node only the page can render (a mesh map...): start again there
        if (!(e instanceof MainOnlyError) || stopped) throw e;
        t?.dispose();
        return run(true);
      })
      .catch((e) => console.warn("TAA", e));
    return () => {
      stopped = true;
      t?.dispose();
      taa.current = null;
    };
  }, [gen, output, width, height]);
  useEffect(() => {
    const t = taa.current;
    if (t && canvas.current) t.show(s, canvas.current.getContext("2d")!).catch((e) => console.warn("TAA", e));
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
              if (!t) return;
              downloadBlob(await t.png(s), `${editor.title}_${gen.name}_taa.png`);
            }}
          >
            {t("Export PNG…")}
          </button>
          <button
            onClick={async () => {
              const tr = taa.current;
              if (!tr) return;
              downloadBlob(await tr.exr(s), `${editor.title}_${gen.name}_taa.exr`);
            }}
          >
            {t("Export EXR…")}
          </button>
        </div>
      </div>
    </div>
  );
}
