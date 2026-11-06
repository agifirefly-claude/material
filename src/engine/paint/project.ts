/* A paint project (material_maker/panels/paint/paint.gd without its UI): a mesh, a stack of layers painted with
 * brushes, the composited material maps, stroke history, and the .mmpp file format. */
import { unzipSync, zipSync, zlibSync } from "fflate";
import type { Dict, Gen } from "../gen/base";
import { GenGraph } from "../gen/graph";
import { GenMaterial } from "../gen/misc";
import { GenTexture } from "../gen/texture";
import { loadProject } from "../loader";
import type { Renderer, Target } from "../render/renderer";
import { GLSL_HEADER, Gpu, gpuFor } from "./gpu";
import { CHANNELS, Compositor, LAYER_MASK, LAYER_PAINT, LAYER_PROC, Layer, allLayers, findParentArray, layerData, unusedLayerIndex, type MapChannel } from "./layers";
import { mapGeneratorFor } from "./mapgen";
import { setCurrentMesh, type PaintMesh } from "./mesh";
import { Painter, type PaintOptions } from "./painter";

export interface PaintSettings {
  /** exponent: the texture size is 2^texture_size */
  texture_size: number;
  paint_emission: boolean;
  paint_normal: boolean;
  paint_depth: boolean;
  paint_depth_as_bump: boolean;
  bump_strength: number;
}

export interface ModelFile {
  name: string;
  data: Uint8Array;
}

type Snapshot = Record<string, Target>;

const RESAMPLE_FS = "uniform sampler2D src; out vec4 o;\nvoid main() { o = texture(src, gl_FragCoord.xy / mm_size); }\n";

/** a texture from the painted maps, for exporting through a material node (export.gd builds the same graph) */
export class GenPaintMap extends GenTexture {
  target: Target | null = null;
  override getType() {
    return "paint_map";
  }
  externalTarget() {
    return this.target ? { target: this.target, sig: "paint:" + this.name + ":" + Math.random() } : null;
  }
}

export class PaintProject {
  readonly gpu: Gpu;
  readonly painter: Painter;
  readonly compositor: Compositor;
  layers: Layer[] = [];
  selected: Layer | null = null;
  settings: PaintSettings = { texture_size: 10, paint_emission: true, paint_normal: true, paint_depth: true, paint_depth_as_bump: true, bump_strength: 0.5 };
  brushGraph: GenGraph | null = null;
  /** the brush the user had before selecting a procedural layer */
  private savedBrush: Dict | null = null;
  idMap: Target | null = null;
  idMapFile: { name: string; data: Uint8Array } | null = null;
  title = "untitled";
  needSave = false;
  /** stroke history per layer (initialize_layer_history, _on_Painter_end_of_stroke) */
  private history = new Map<Layer, { states: Snapshot[]; current: number }>();
  private listeners = new Set<() => void>();
  version = 0;

  constructor(
    public renderer: Renderer,
    public mesh: PaintMesh,
    public model: ModelFile | null,
  ) {
    this.gpu = gpuFor(renderer);
    this.painter = new Painter(renderer);
    this.compositor = new Compositor(renderer);
    this.painter.textureSize = this.size;
    this.painter.setMesh(mesh);
    setCurrentMesh(mesh);
  }

  get size() {
    return 1 << this.settings.texture_size;
  }

  onChange(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  changed(save = true) {
    this.version++;
    if (save) this.needSave = true;
    for (const l of this.listeners) l();
  }

  /* ---------- textures ---------- */
  newTexture(color: [number, number, number, number] = [0, 0, 0, 0]): Target {
    const t = this.renderer.createTarget(this.size);
    this.gpu.clear(t, color);
    return t;
  }
  copyTexture(t: Target): Target {
    const c = this.renderer.createTarget(t.size);
    this.gpu.copy(t.tex, c);
    return c;
  }
  /** a texture of this project's size from an image of any size */
  textureFromPixels(w: number, h: number, data: Float32Array): Target {
    const rt = this.gpu.upload(w, h, data, false);
    const gl = this.gpu.gl;
    gl.bindTexture(gl.TEXTURE_2D, rt.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const t = this.renderer.createTarget(this.size);
    this.gpu.pass(this.gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + "uniform vec2 mm_size;\n" + RESAMPLE_FS), t.fbo, t.size, t.size, { src: rt });
    this.gpu.deleteRT(rt);
    return t;
  }

  /* ---------- layers ---------- */
  /** the first layer of a new project, initialised like a default StandardMaterial3D (init_textures) */
  initProject() {
    const l = this.addLayer(LAYER_PAINT);
    if (!l) return;
    this.gpu.clear(l.textures.albedo, [1, 1, 1, 1]);
    this.gpu.clear(l.textures.emission, [0, 0, 0, 1]);
    this.gpu.clear(l.textures.normal, [0.5, 0.5, 0, 1]);
    this.gpu.clear(l.textures.do, [0, 1, 0, 0]);
    this.selectLayer(l, true);
    this.history.delete(l);
    this.initHistory(l);
    this.needSave = false;
    this.update();
  }

  addLayer(type = LAYER_PAINT): Layer | null {
    let array = this.layers;
    if (type === LAYER_MASK) {
      if (!this.selected) return null;
      array = this.selected.type === LAYER_MASK ? findParentArray(this.selected, this.layers)! : this.selected.layers;
    }
    const l = new Layer(type);
    l.name = "New layer";
    l.index = unusedLayerIndex(this.layers);
    for (const c of l.channels) l.textures[c] = this.newTexture();
    array.unshift(l);
    this.initHistory(l);
    this.selectLayer(l);
    this.changed();
    return l;
  }

  duplicateLayer(src: Layer) {
    const array = findParentArray(src, this.layers)!;
    const l = new Layer(src.type);
    l.name = src.name + " (copy)";
    l.index = unusedLayerIndex(this.layers);
    l.alpha = { ...src.alpha };
    l.material = structuredClone(src.material);
    for (const c of src.channels) if (src.textures[c]) l.textures[c] = this.copyTexture(src.textures[c]);
    array.unshift(l);
    this.initHistory(l);
    this.selectLayer(l);
    this.changed();
  }

  removeLayer(l: Layer) {
    const array = findParentArray(l, this.layers);
    if (!array) return;
    array.splice(array.indexOf(l), 1);
    const reselect = l === this.selected || (this.selected && !allLayers(this.layers).includes(this.selected));
    for (const x of allLayers([l])) {
      for (const t of Object.values(x.textures)) this.renderer.deleteTarget(t);
      this.dropHistory(x);
    }
    if (reselect) {
      this.selected = null;
      if (this.layers.length) this.selectLayer(this.layers[0], true);
    }
    this.changed();
    this.update();
  }

  moveLayerUp(l: Layer) {
    const a = findParentArray(l, this.layers)!;
    const i = a.indexOf(l);
    if (i > 0) {
      a.splice(i, 1);
      a.splice(i - 1, 0, l);
      this.changed();
      this.update();
    }
  }
  moveLayerDown(l: Layer) {
    const a = findParentArray(l, this.layers)!;
    const i = a.indexOf(l);
    if (i < a.length - 1) {
      a.splice(i, 1);
      a.splice(i + 1, 0, l);
      this.changed();
      this.update();
    }
  }
  /** moves a layer into another (null: the top level), at an index (move_layer_into) */
  moveLayerInto(l: Layer, target: Layer | null, index = -1) {
    if (l.type === LAYER_MASK && (target === null || target.type === LAYER_MASK)) return;
    if (target && allLayers([l]).includes(target)) return;
    const a = findParentArray(l, this.layers)!;
    const orig = a.indexOf(l);
    a.splice(orig, 1);
    const t = target ? target.layers : this.layers;
    if (index === -1) index = t.length;
    else if (a === t && index > orig) index--;
    t.splice(index, 0, l);
    this.changed();
    this.update();
  }

  setLayerHidden(l: Layer, hidden: boolean) {
    l.hidden = hidden;
    this.changed();
    this.update();
  }
  setLayerAlpha(l: Layer, channel: MapChannel, v: number) {
    l.alpha[channel] = v;
    this.changed();
    this.update();
  }

  /** makes a layer the one painted (select_layer) */
  selectLayer(l: Layer | null, force = false) {
    if (l === this.selected && !force) return;
    for (const c of Object.values(this.painter.channels)) {
      this.renderer.deleteTarget(c.start);
      this.renderer.deleteTarget(c.stroke);
    }
    this.painter.channels = {};
    this.selected = l;
    if (l) {
      for (const c of l.channels) {
        l.textures[c] ??= this.newTexture();
        this.painter.channels[c] = { live: l.textures[c], start: this.copyTexture(l.textures[c]), stroke: this.newTexture() };
      }
      // a procedural layer brings its brush; leaving it gives the user's brush back
      if (l.type === LAYER_PROC) {
        if (!this.savedBrush && this.brushGraph) this.savedBrush = this.brushGraph.serialize();
        if (Object.keys(l.material).length) this.setBrush(l.material, false);
      } else if (this.savedBrush) {
        const b = this.savedBrush;
        this.savedBrush = null;
        this.setBrush(b, false);
      }
    }
    this.updateBrushNode();
    this.changed(false);
  }

  /* ---------- brush ---------- */
  /** the brush graph, from a library brush or a saved one (set_brush) */
  setBrush(data: Dict, refill = true) {
    const g = loadProject(structuredClone(data));
    this.brushGraph = g;
    this.updateBrushNode();
    if (refill) this.brushChanged();
    this.changed(false);
  }
  get brushNode(): Gen | null {
    return this.brushGraph?.getNode("Brush") ?? null;
  }
  /** the remote of the brush graph, whose controls are the brush's parameters */
  get brushRemote(): Gen | null {
    return this.brushGraph?.children.find((c) => c.getType() === "remote") ?? null;
  }
  private updateBrushNode() {
    this.painter.setBrushNode(this.brushNode, this.selected?.type === LAYER_MASK);
  }
  /** after any change of the brush graph (do_on_brush_changed / update_procedural_layer) */
  brushChanged() {
    this.painter.brushChanged();
    this.updateBrushNode();
    if (this.selected?.type === LAYER_PROC && this.brushGraph) {
      this.painter.fill(false, true);
      this.selected.material = this.brushGraph.serialize();
      this.update();
      this.changed();
    }
  }

  /* ---------- painting ---------- */
  /** a dab or a segment of the current stroke; at the end of a stroke it goes in the history */
  paint(o: PaintOptions, endOfStroke = false) {
    if (!this.selected || this.selected.type === LAYER_PROC) return;
    const painted = this.painter.paint(o, endOfStroke);
    if (endOfStroke) this.pushHistory(this.selected, painted);
    this.update();
    this.needSave = true;
  }
  fill(erase: boolean) {
    if (!this.selected || this.selected.type === LAYER_PROC) return;
    const painted = this.painter.fill(erase);
    this.pushHistory(this.selected, painted);
    this.update();
    this.changed();
  }

  /** recomposites the maps */
  update() {
    this.compositor.composite(this.layers, this.size, this.settings);
    this.version++;
    for (const l of this.listeners) l();
  }

  setSettings(s: Partial<PaintSettings>) {
    const sizeChanged = s.texture_size !== undefined && s.texture_size !== this.settings.texture_size;
    this.settings = { ...this.settings, ...s };
    if (sizeChanged) this.resize();
    this.update();
    this.changed();
  }
  private resize() {
    const size = this.size;
    for (const l of allLayers(this.layers))
      for (const c of Object.keys(l.textures)) {
        const old = l.textures[c];
        const t = this.renderer.createTarget(size);
        this.gpu.pass(this.gpu.program(Gpu.FULLSCREEN_VS, GLSL_HEADER + "uniform vec2 mm_size;\n" + RESAMPLE_FS), t.fbo, size, size, { src: old });
        l.textures[c] = t;
        this.renderer.deleteTarget(old);
      }
    for (const l of this.history.keys()) this.dropHistory(l);
    for (const l of allLayers(this.layers)) this.initHistory(l);
    this.painter.setTextureSize(size);
    this.selectLayer(this.selected, true);
  }

  /** the colour of the composited maps under a point of the view, for the colour picker (pick_color) */
  pickColors(uv: [number, number]): Record<string, number | { r: number; g: number; b: number; a: number }> {
    const size = this.size;
    const px = Math.min(size - 1, Math.max(0, Math.floor(uv[0] * size))),
      py = Math.min(size - 1, Math.max(0, Math.floor(uv[1] * size)));
    const at = (t: Target) => this.gpu.read(t, px, py, 1, 1);
    const m = this.compositor.maps;
    const c = (t: Target) => {
      const v = at(t);
      return { r: v[0], g: v[1], b: v[2], a: v[3] };
    };
    return { Albedo: c(m.albedo!), Metallic: at(m.metallic!)[0], Roughness: at(m.roughness!)[0], Emission: c(m.emission!), Depth: at(m.depth!)[0], Occlusion: at(m.occlusion!)[0] };
  }

  /* ---------- ID map ---------- */
  setIdMap(t: Target | null, file: { name: string; data: Uint8Array } | null) {
    this.renderer.deleteTarget(this.idMap);
    this.idMap = t;
    this.idMapFile = file;
    this.painter.idMap = t;
    this.painter.idMask = null;
  }
  /** the ID colour under a UV, which then limits painting to that part */
  selectId(uv: [number, number]) {
    if (!this.idMap) return;
    const s = this.idMap.size;
    const v = this.gpu.read(this.idMap, Math.min(s - 1, Math.floor(uv[0] * s)), Math.min(s - 1, Math.floor(uv[1] * s)), 1, 1);
    this.painter.idMask = [v[0], v[1], v[2], v[3]];
    this.changed(false);
  }

  /* ---------- history ---------- */
  private initHistory(l: Layer) {
    if (this.history.has(l)) return;
    const s: Snapshot = {};
    for (const c of l.channels) if (l.textures[c]) s[c] = this.copyTexture(l.textures[c]);
    this.history.set(l, { states: [s], current: 0 });
  }
  private dropHistory(l: Layer) {
    const h = this.history.get(l);
    if (!h) return;
    const seen = new Set<Target>();
    for (const s of h.states) for (const t of Object.values(s)) if (!seen.has(t)) (seen.add(t), this.renderer.deleteTarget(t));
    this.history.delete(l);
  }
  private pushHistory(l: Layer, channels: string[]) {
    const h = this.history.get(l);
    if (!h) return this.initHistory(l);
    const states = h.states;
    // drop redo states, keeping textures still used by earlier states
    const kept = new Set(states.slice(0, h.current + 1).flatMap((s) => Object.values(s)));
    for (const s of states.slice(h.current + 1)) for (const t of Object.values(s)) if (!kept.has(t)) this.renderer.deleteTarget(t);
    states.length = h.current + 1;
    const next: Snapshot = { ...states[h.current] };
    for (const c of channels) if (l.textures[c]) next[c] = this.copyTexture(l.textures[c]);
    states.push(next);
    h.current++;
    // keep the history bounded (each state shares unchanged channels with the previous one)
    while (states.length > 24) {
      const first = states.shift()!;
      const still = new Set(states.flatMap((s) => Object.values(s)));
      for (const t of Object.values(first)) if (!still.has(t)) this.renderer.deleteTarget(t);
      h.current--;
    }
    this.lastStrokeLayer = l;
  }
  private lastStrokeLayer: Layer | null = null;
  private restore(l: Layer, index: number) {
    const h = this.history.get(l)!;
    h.current = index;
    for (const [c, t] of Object.entries(h.states[index])) this.gpu.copy(t.tex, l.textures[c]);
    if (l === this.selected) for (const [c, ch] of Object.entries(this.painter.channels)) this.gpu.copy(ch.live.tex, ch.start);
    this.update();
    this.changed();
  }
  canUndo() {
    const l = this.selected ?? this.lastStrokeLayer;
    const h = l && this.history.get(l);
    return !!h && h.current > 0;
  }
  canRedo() {
    const l = this.selected ?? this.lastStrokeLayer;
    const h = l && this.history.get(l);
    return !!h && h.current < h.states.length - 1;
  }
  undo() {
    const l = this.selected;
    const h = l && this.history.get(l);
    if (l && h && h.current > 0) this.restore(l, h.current - 1);
  }
  redo() {
    const l = this.selected;
    const h = l && this.history.get(l);
    if (l && h && h.current < h.states.length - 1) this.restore(l, h.current + 1);
  }

  /* ---------- files ---------- */
  /** the project as Material Maker writes it (do_save_project), with its PNGs and model, as a zip */
  save(name = this.title): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    const dir = name;
    const data: Dict = {
      layers: this.layers.map((l) =>
        layerData(l, (c, layer) => {
          const file = `${c}_${layer.index}.png`;
          files[`${dir}/${file}`] = encodePng(this.gpu, layer.textures[c]);
          return file;
        }),
      ),
      model: this.model?.name ?? "",
      settings: { ...this.settings },
    };
    // a built-in mesh has no model file: its name is enough to make it again
    if (!this.model) data.builtin_mesh = this.mesh.name;
    if (this.idMapFile) {
      data.idmap = this.idMapFile.name;
      files[this.idMapFile.name] = this.idMapFile.data;
    }
    if (this.model) files[this.model.name] = this.model.data;
    if (this.brushGraph) data.brush = this.brushGraph.serialize();
    files[`${name}.mmpp`] = new TextEncoder().encode(JSON.stringify(data));
    this.needSave = false;
    return zipSync(files, { level: 0 });
  }

  /** layers from a .mmpp file's data, with its images by file name (load_layers) */
  async loadLayers(data: Dict, images: (name: string) => Promise<Float32ArrayImage | null>) {
    const load = async (list: Dict[], array: Layer[], firstIndex: number): Promise<number> => {
      for (const d of list) {
        const l = new Layer(d.type ?? 0);
        l.name = d.name;
        l.index = d.index ?? firstIndex++;
        l.hidden = !!d.hidden;
        for (const c of l.channels) {
          if (!d[c]) continue;
          const img = await images(d[c]);
          if (img) l.textures[c] = this.textureFromPixels(img.width, img.height, img.data);
        }
        for (const c of l.channels) l.textures[c] ??= this.newTexture();
        for (const c of CHANNELS) if (d[c + "_alpha"] !== undefined) l.alpha[c] = d[c + "_alpha"];
        if (l.type === LAYER_PROC) l.material = d.material ?? {};
        if (d.layers) firstIndex = await load(d.layers, l.layers, firstIndex);
        array.push(l);
        this.initHistory(l);
      }
      return firstIndex;
    };
    // the size first: layer images are resampled to it
    if (data.settings) this.settings = { ...this.settings, ...data.settings };
    else if (data.texture_size) this.settings.texture_size = Math.round(Math.log2(data.texture_size));
    this.painter.setTextureSize(this.size);
    this.layers = [];
    await load(data.layers ?? [], this.layers, 0);
    if (data.brush) this.setBrush(data.brush, false);
    if (this.layers.length) this.selectLayer(this.layers[0], true);
    this.update();
    this.needSave = false;
  }

  /** the graph export.gd builds: the maps into a material node, to use Material Maker's export targets */
  exportGraph(): { graph: GenGraph; material: GenMaterial } {
    const graph = loadProject({ name: "", type: "graph", nodes: [{ name: "material", type: "material", node_position: { x: 0, y: 0 }, parameters: { size: this.settings.texture_size } }], connections: [] });
    const material = graph.getNode("material") as GenMaterial;
    const order: MapChannel[] = ["albedo", "metallic", "roughness", "emission", "normal", "occlusion", "depth"];
    order.forEach((c, i) => {
      const n = new GenPaintMap();
      n.name = c;
      n.target = (c === "normal" ? this.compositor.maps.normal_map : this.compositor.maps[c]) ?? null;
      graph.addGenerator(n);
      graph.connectChildren(n, 0, material, i);
    });
    return { graph, material };
  }

  dispose() {
    for (const l of allLayers(this.layers)) for (const t of Object.values(l.textures)) this.renderer.deleteTarget(t);
    for (const l of [...this.history.keys()]) this.dropHistory(l);
    for (const c of Object.values(this.painter.channels)) {
      this.renderer.deleteTarget(c.start);
      this.renderer.deleteTarget(c.stroke);
    }
    this.painter.dispose();
    this.compositor.dispose();
    this.renderer.deleteTarget(this.idMap);
    mapGeneratorFor(this.renderer).forget(this.mesh);
  }
}

export interface Float32ArrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** a target as an 8 bit PNG */
export function encodePng(gpu: Gpu, t: Target): Uint8Array {
  const px = gpu.read(t);
  const rgba = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) rgba[i] = Math.round(Math.min(1, Math.max(0, px[i])) * 255);
  return pngEncode(t.size, t.size, rgba);
}

/* ---------- a small PNG encoder (stored deflate), so saving does not need a canvas ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array, start = 0, end = data.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function pngEncode(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 3 });
  const chunks: Uint8Array[] = [];
  const chunk = (type: string, data: Uint8Array) => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    chunks.push(c);
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  chunks.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array(0));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** the files of a saved project: a zip, or the .mmpp, its PNGs and its model picked together */
export function unpackFiles(files: { name: string; data: Uint8Array }[]): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) for (const [k, v] of Object.entries(unzipSync(f.data))) map.set(k, v);
    else map.set(f.name, f.data);
  }
  return map;
}
/** a file in an unpacked project, by path or by base name */
export function findFile(files: Map<string, Uint8Array>, name: string): Uint8Array | null {
  if (files.has(name)) return files.get(name)!;
  const base = name.split(/[\\/]/).pop()!;
  for (const [k, v] of files) if (k.split("/").pop() === base) return v;
  return null;
}

