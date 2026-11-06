/* The 3D paint view (paint.tscn's View and paint.gd's stroke handling): the painted model with the composited maps,
 * the camera (right drag to turn, middle drag to pan, wheel to zoom) and the brush (left drag to paint). */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { paint, usePaint } from "./paintStore";
import { paintMeshToGeometry } from "./meshes";
import type { PaintProject } from "../../engine/paint/project";
import { isColor } from "../../engine/params/types";

const MAPS = ["albedo", "orm", "emission", "normal_gl", "depth"] as const;

/** stroke state (paint.gd's last_motion_*, stroke_*, previous_position...) */
export class StrokeState {
  previous: [number, number] | null = null;
  lastPainted: [number, number] = [-1e9, -1e9];
  lastMotion: [number, number] = [0, 0];
  lastVector: [number, number] = [0, 0];
  length = 0;
  angle = 0;
  seed = Math.random();
  stampCenter: [number, number] = [0, 0];
  painting = false;
  reset() {
    this.length = 0;
    this.previous = null;
  }
}

/** pointer pressure: a pen's, 1 for a mouse */
export const pressureOf = (e: PointerEvent | React.PointerEvent) => (e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 1);

/** paints one point of a stroke with the brush settings (paint / do_paint) */
export type PaintMode = { textureSpace: boolean; rect: [number, number]; center?: [number, number]; scale?: number };
export function paintAt(p: PaintProject, s: StrokeState, pos: [number, number], pressure: number, mode: PaintMode, end = false) {
  const sel = p.selected;
  if (!sel || sel.type === 1) return;
  if (paint.tool === 0 || paint.tool === 1) {
    if (!end && Math.hypot(pos[0] - s.lastPainted[0], pos[1] - s.lastPainted[1]) < paint.spacing) return;
    if (paint.tool === 0) s.previous = null;
  }
  if (s.previous === null) s.previous = pos;
  const prm = p.painter.params;
  p.paint(
    {
      texture_space: mode.textureSpace,
      brush_pos: pos,
      brush_ppos: s.previous,
      brush_size: paint.pressure.size ? prm.brush_size * pressure : prm.brush_size,
      brush_opacity: paint.pressure.opacity ? prm.brush_opacity * pressure : prm.brush_opacity,
      erase: paint.eraser,
      pressure,
      rect_size: mode.rect,
      texture_center: mode.center,
      texture_scale: mode.scale,
    },
    end,
  );
  s.previous = pos;
  s.lastPainted = pos;
  if (end) prm.stroke_seed = Math.random();
}

/** the brush parameters that follow the stroke (painter_update_brush_params on motion) */
export function strokeMotion(p: PaintProject, s: StrokeState, pos: [number, number], pressure: number) {
  const d: [number, number] = [pos[0] - s.lastMotion[0], pos[1] - s.lastMotion[1]];
  s.length += Math.hypot(d[0], d[1]);
  const v: [number, number] = [d[0] * 0.75 + s.lastVector[0] * 0.75, d[1] * 0.75 + s.lastVector[1] * 0.75];
  s.angle = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  s.lastMotion = pos;
  s.lastVector = v;
  const prm = p.painter.params;
  prm.pressure = pressure;
  prm.stroke_length = s.length;
  prm.stroke_angle = s.angle;
  if (paint.pressure.hardness) prm.brush_hardness = Math.min(1, prm.brush_hardness);
}

/** sets the brush's parameters that are named like the picked values (pick_color) */
export function applyPickedColors(p: PaintProject, colors: Record<string, unknown>) {
  const remote = p.brushRemote;
  if (!remote) return;
  for (const d of remote.getParameterDefs()) {
    const v = colors[d.label ?? ""];
    if (v === undefined) continue;
    remote.setParameter(d.name, isColor(v) ? { ...v, a: 1 } : (v as number));
  }
}

export function PaintView() {
  usePaint();
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const project = paint.project!;
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    canvases: Record<string, HTMLCanvasElement>;
    textures: Record<string, THREE.CanvasTexture>;
    dirtyMaps: boolean;
    stroke: StrokeState;
  } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.insertBefore(renderer.domElement, el.firstChild);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#202226");
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    camera.position.set(0, 0, 4.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons = { LEFT: null as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.enableDamping = false;
    const canvases: Record<string, HTMLCanvasElement> = {};
    const textures: Record<string, THREE.CanvasTexture> = {};
    for (const k of MAPS) {
      const c = document.createElement("canvas");
      c.width = c.height = 4;
      canvases[k] = c;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = k === "albedo" || k === "emission" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      textures[k] = t;
    }
    const material = new THREE.MeshStandardMaterial({ map: textures.albedo, aoMap: textures.orm, roughnessMap: textures.orm, metalnessMap: textures.orm, emissiveMap: textures.emission, emissive: new THREE.Color(1, 1, 1), normalMap: textures.normal_gl, metalness: 1, roughness: 1 });
    const mesh = new THREE.Mesh(paintMeshToGeometry(project.mesh), material);
    scene.add(mesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    new HDRLoader().load("hdri/photo_studio_01_1k.hdr", (tex) => {
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
    });
    const st = { renderer, scene, camera, controls, mesh, material, canvases, textures, dirtyMaps: true, stroke: new StrokeState() };
    state.current = st;
    const updateView = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      camera.updateMatrixWorld();
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const e = camera.matrixWorld.elements;
      paint.project?.painter.setView(m.toArray(), [w, h], { back: [e[8], e[9], e[10]], right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]] });
    };
    controls.addEventListener("change", updateView);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      overlay.current!.width = w;
      overlay.current!.height = h;
      updateView();
    });
    ro.observe(el);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = paint.project;
      if (p && st.dirtyMaps) {
        st.dirtyMaps = false;
        const gpu = p.gpu;
        for (const k of MAPS) {
          const t = p.compositor.maps[k];
          if (!t) continue;
          const c = canvases[k];
          if (c.width !== t.size) {
            c.width = c.height = t.size;
            textures[k].dispose();
            const nt = new THREE.CanvasTexture(c);
            nt.colorSpace = textures[k].colorSpace;
            nt.anisotropy = 8;
            textures[k] = nt;
          }
          gpu.present(t, c.getContext("2d")!, { opaque: true });
          textures[k].needsUpdate = true;
        }
        const s = p.settings;
        material.map = textures.albedo;
        material.aoMap = material.roughnessMap = material.metalnessMap = textures.orm;
        material.emissiveMap = s.paint_emission ? textures.emission : null;
        material.emissive.setRGB(s.paint_emission ? 1 : 0, s.paint_emission ? 1 : 0, s.paint_emission ? 1 : 0);
        material.normalMap = s.paint_normal || s.paint_depth_as_bump ? textures.normal_gl : null;
        material.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      state.current = null;
    };
  }, [project]);

  // maps changed: redraw them in the next frame
  useEffect(() => {
    const p = paint.project;
    if (!p) return;
    const off = p.onChange(() => {
      if (state.current) state.current.dirtyMaps = true;
    });
    return () => void off();
  }, [project]);

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = host.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  /** what the brush works with in this view: the view itself, or the texture through the view */
  const toPaintSpace = (pos: [number, number]): { pos: [number, number] | null; mode: PaintMode } => {
    const p = paint.project!;
    const [w, h] = p.painter.viewportSize;
    if (!paint.textureEngine) return { pos, mode: { textureSpace: false, rect: [w, h] } };
    const uv = p.painter.viewToTexture(pos[0], pos[1]);
    const m = Math.min(w, h);
    return { pos: uv ? [uv[0] * m, uv[1] * m] : null, mode: { textureSpace: true, rect: [m, m], center: [0.5, 0.5], scale: 1 } };
  };
  const showBrush = (pos: [number, number] | null, ppos?: [number, number]) => {
    const ctx = overlay.current?.getContext("2d");
    const p = paint.project;
    if (!ctx || !p) return;
    if (!pos || paint.tool >= 4) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    try {
      const rt = p.painter.brushPreview(pos, ppos ?? pos);
      if (rt) p.gpu.present(rt, ctx);
    } catch (err) {
      paint.status = (err as Error).message;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    paint.focus = "paint";
    if (e.button !== 0 || !paint.project) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = state.current!.stroke;
    const pos = local(e);
    const p = paint.project;
    s.length = 0;
    s.lastMotion = pos;
    if (paint.tool === 4 || paint.tool === 5) return;
    const { pos: pp } = toPaintSpace(pos);
    s.previous = pp;
    s.painting = true;
    if (paint.tool === 3) {
      s.stampCenter = pos;
      s.previous = null;
      (s as unknown as { stampSize: number }).stampSize = p.painter.params.brush_size;
    } else if (paint.tool === 0 || paint.tool === 1) {
      s.lastPainted = [-1e9, -1e9];
      if (pp) paintAt(p, s, pp, pressureOf(e), toPaintSpace(pos).mode);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = paint.project;
    if (!p) return;
    const s = state.current!.stroke;
    const pos = local(e);
    const pressure = pressureOf(e);
    const dragging = (e.buttons & 1) !== 0 && s.painting;
    if (dragging && e.shiftKey) {
      // shift drag: size and hardness
      const prm = p.painter.params;
      prm.brush_size = Math.min(250, Math.max(0, prm.brush_size + e.movementX * 0.1 * 10));
      prm.brush_hardness = Math.min(1, Math.max(0, prm.brush_hardness + e.movementY * 0.01));
      s.reset();
      showBrush(pos);
      paint.emit();
      return;
    }
    if (dragging && (e.ctrlKey || e.metaKey)) {
      // control drag: pattern scale and angle
      const prm = p.painter.params;
      prm.pattern_scale = Math.min(25, Math.max(0.1, prm.pattern_scale + e.movementX * 0.1));
      let a = 0.5 + (prm.pattern_angle + e.movementY * 0.01) / (2 * Math.PI);
      a = 2 * Math.PI * (a - Math.floor(a) - 0.5);
      prm.pattern_angle = a;
      s.reset();
      showBrush(pos);
      paint.emit();
      return;
    }
    strokeMotion(p, s, pos, pressure);
    const { pos: pp, mode } = toPaintSpace(pos);
    if (paint.tool === 2) {
      if (s.previous && pp && dragging) p.painter.params.pattern_angle = -Math.atan2(pp[1] - s.previous[1], pp[0] - s.previous[0]);
      showBrush(paint.textureEngine ? null : pos, dragging && s.previous && !paint.textureEngine ? s.previous : pos);
    } else if (paint.tool === 3 && dragging) {
      const off = [pos[0] - s.stampCenter[0], pos[1] - s.stampCenter[1]];
      p.painter.params.brush_size = Math.hypot(off[0], off[1]);
      p.painter.params.pattern_angle = -Math.atan2(off[1], off[0]);
      showBrush(s.stampCenter, s.stampCenter);
    } else showBrush(paint.textureEngine ? null : pos);
    if (dragging && (paint.tool === 0 || paint.tool === 1) && pp) paintAt(p, s, pp, pressure, mode);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = paint.project;
    const s = state.current?.stroke;
    if (!p || !s || e.button !== 0) return;
    const pos = local(e);
    const { pos: pp, mode } = toPaintSpace(pos);
    if (paint.tool === 4 || paint.tool === 5) {
      const uv = p.painter.viewToTexture(pos[0], pos[1]);
      if (uv) {
        if (paint.tool === 5) {
          if (!p.idMap) paint.setStatus("Load an ID map first (in the tool options)");
          else p.selectId(uv);
        } else applyPickedColors(p, p.pickColors(uv));
      }
      paint.emit();
      return;
    }
    if (!s.painting) return;
    s.painting = false;
    if (paint.tool === 3) {
      const center = toPaintSpace(s.stampCenter);
      if (center.pos) {
        s.previous = center.pos;
        paintAt(p, s, center.pos, pressureOf(e), center.mode, true);
      }
      p.painter.params.brush_size = (s as unknown as { stampSize: number }).stampSize;
    } else if (pp) {
      if (paint.tool === 2 && s.previous) p.painter.params.pattern_angle = -Math.atan2(pp[1] - s.previous[1], pp[0] - s.previous[0]);
      else s.lastPainted = [pp[0] + paint.spacing, pp[1] + paint.spacing];
      paintAt(p, s, pp, pressureOf(e), mode, true);
    } else p.painter.endStroke();
    s.reset();
    paint.emit();
  };

  return (
    <div
      ref={host}
      className="paint-view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => showBrush(null)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: paint.eraser ? "crosshair" : "default" }}
    >
      <canvas ref={overlay} className="paint-overlay" />
      <div className="paint-hint">Left drag: paint · Right drag: turn · Middle drag: pan · Wheel: zoom · Shift+drag: size/hardness · Ctrl+drag: pattern</div>
    </div>
  );
}
