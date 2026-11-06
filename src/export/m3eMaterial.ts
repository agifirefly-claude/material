/* Exports the project's material as an m3e material file (src/formats/m3e-material.ts, docs/m3e-material.md). */
import type { Renderer } from "../engine/render/renderer";
import { pictureRenderer, rootOf, type PictureRenderer } from "../engine/render/maps";
import type { GenMaterial } from "../engine/gen/misc";
import { previewMaps } from "../engine/materialMaps";
import { MATERIAL_FORMAT, MATERIAL_VERSION, materialId, type MaterialDef, type MaterialFile, type MaterialLight } from "../formats/m3e-material";

export interface M3eExportOptions {
  name: string;
  /** px of the pictures */
  resolution: number;
  /** px one tile is drawn at in m3e at 100% */
  tile: number;
  light: MaterialLight;
  /** include the raw maps (albedo, normal, height, orm, emission) besides surface and shading */
  rawMaps: boolean;
  /** the material's project, so it can be opened again */
  project?: string;
  format: "webp" | "png";
}

type Px = { w: number; h: number; d: Float32Array };

const toSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

/** the light as a direction in the tangent space of a normal map (x right, y up, z out of the surface) */
export function lightVector(l: MaterialLight): [number, number, number] {
  const az = (l.azimuth * Math.PI) / 180,
    el = (l.elevation * Math.PI) / 180;
  // azimuth 0 is the top of the screen, clockwise
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}

/** Bakes the two pictures m3e uses: the lit surface and the neutral grey relief */
export function bakeSurface(albedo: Px, normal: Px | null, orm: Px | null, emission: Px | null, light: MaterialLight): { surface: Px; shading: Px } {
  const [lx, ly, lz] = lightVector(light);
  const n = albedo.w * albedo.h;
  const surface = new Float32Array(n * 4),
    shading = new Float32Array(n * 4);
  // half vector for a viewer straight above the surface
  let hx = lx,
    hy = ly,
    hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz);
  hx /= hl;
  hy /= hl;
  hz /= hl;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let nx = 0,
      ny = 0,
      nz = 1;
    if (normal) {
      // as Godot reads a normal map: x and y from the picture, z rebuilt (an unconnected normal is 0.5 grey)
      nx = normal.d[o] * 2 - 1;
      ny = normal.d[o + 1] * 2 - 1;
      nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }
    const ao = orm ? orm.d[o] : 1;
    const rough = orm ? clamp01(orm.d[o + 1]) : 1;
    const metal = orm ? clamp01(orm.d[o + 2]) : 0;
    const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
    // a simple lit surface: diffuse + ambient, a Blinn-Phong highlight whose size follows the roughness
    const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
    const shininess = 4 + Math.pow(1 - rough, 2) * 200;
    const spec = Math.pow(ndh, shininess) * Math.pow(1 - rough, 2) * ((shininess + 8) / (8 * Math.PI)) * 0.25;
    for (let c = 0; c < 3; c++) {
      const base = toLinear(clamp01(albedo.d[o + c]));
      const f0 = 0.04 * (1 - metal) + base * metal;
      const diffuse = base * (1 - metal);
      let v = diffuse * (0.3 * ao + 0.85 * ndl * ao) + f0 * (spec * ndl + 0.15 * ao);
      if (emission) v += toLinear(clamp01(emission.d[o + c]));
      surface[o + c] = toSrgb(clamp01(v * 1.25));
    }
    surface[o + 3] = clamp01(albedo.d[o + 3]);
  }
  // shading: the surface's lightness relative to its average, mid grey on average: relief and pattern, without colour
  const lum = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * toLinear(surface[o]) + 0.7152 * toLinear(surface[o + 1]) + 0.0722 * toLinear(surface[o + 2]);
    mean += lum[i] / n;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = clamp01(0.5 * Math.sqrt(lum[i] / Math.max(mean, 1e-4)));
    shading[o] = shading[o + 1] = shading[o + 2] = v;
    shading[o + 3] = 1;
  }
  return { surface: { w: albedo.w, h: albedo.h, d: surface }, shading: { w: albedo.w, h: albedo.h, d: shading } };
}

/** the average colour and the dominant colours (k-means on a sample) of a picture */
export function swatchOf(p: Px): { average: string; palette: string[]; lightness: number } {
  const pts: number[][] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((p.w * p.h) / 4096)));
  let ar = 0,
    ag = 0,
    ab = 0;
  for (let y = 0; y < p.h; y += step)
    for (let x = 0; x < p.w; x += step) {
      const o = (y * p.w + x) * 4;
      if (p.d[o + 3] < 0.1) continue;
      const c = [clamp01(p.d[o]), clamp01(p.d[o + 1]), clamp01(p.d[o + 2])];
      pts.push(c);
      ar += c[0];
      ag += c[1];
      ab += c[2];
    }
  if (!pts.length) return { average: "#808080", palette: ["#808080"], lightness: 50 };
  ar /= pts.length;
  ag /= pts.length;
  ab /= pts.length;
  const k = Math.min(6, pts.length);
  // spread the first centres over the lightness range, for a stable result
  const sorted = [...pts].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centres = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]]);
  let counts = new Array(k).fill(0);
  for (let it = 0; it < 10; it++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts = new Array(k).fill(0);
    for (const c of pts) {
      let best = 0,
        bd = Infinity;
      centres.forEach((m, i) => {
        const d = (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      sums[best][0] += c[0];
      sums[best][1] += c[1];
      sums[best][2] += c[2];
      counts[best]++;
    }
    centres = centres.map((m, i) => (counts[i] ? sums[i].map((s) => s / counts[i]) : m));
  }
  const order = centres.map((c, i) => ({ c, n: counts[i] })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const palette: string[] = [];
  for (const { c } of order) {
    const h = hex(c[0], c[1], c[2]);
    if (!palette.includes(h)) palette.push(h);
  }
  const lum = 0.2126 * toLinear(ar) + 0.7152 * toLinear(ag) + 0.0722 * toLinear(ab);
  const lightness = Math.round((lum <= 0.008856 ? lum * 903.3 : 116 * Math.cbrt(lum) - 16) * 10) / 10;
  return { average: hex(ar, ag, ab), palette, lightness: Math.max(0, Math.min(100, lightness)) };
}

/** An m3e-canvas-pro look made of colours only: a gradient through the material's colours, a matching edge and
 *  a soft shadow, and a grain when the material has relief. It passes m3e-canvas-pro's cleanLook unchanged. */
export function fallbackLook(swatch: { average: string; palette: string[]; lightness: number }, relief: number): Record<string, unknown> {
  const byLight = [...swatch.palette].sort((a, b) => lightOf(b) - lightOf(a));
  const top = byLight[0] ?? swatch.average,
    bottom = byLight[byLight.length - 1] ?? swatch.average;
  const look: Record<string, unknown> = {
    fills: [
      { type: "linear", angle: 160, stops: [{ color: top + "33", at: 0 }, { color: "#00000000", at: 55 }] },
      { type: "linear", angle: 180, stops: [{ color: swatch.average, at: 0 }, { color: bottom, at: 100 }] },
    ],
    stroke: { width: 1, color: bottom + "99" },
    shadows: [{ x: 0, y: 1, blur: 0, spread: 0, color: "#ffffff33", inset: true }, { x: 0, y: 3, blur: 8, spread: 0, color: "#00000040" }],
  };
  if (relief > 0.02) look.texture = { kind: "noise", color: swatch.lightness > 55 ? "#000000" : "#ffffff", opacity: Math.round(Math.min(40, 8 + relief * 200)) };
  return look;
}
const lightOf = (h: string) => parseInt(h.slice(1, 3), 16) * 0.2126 + parseInt(h.slice(3, 5), 16) * 0.7152 + parseInt(h.slice(5, 7), 16) * 0.0722;

/** a picture as a data URL */
export async function encode(p: Px, format: "webp" | "png", alpha = true): Promise<string> {
  const c = document.createElement("canvas");
  c.width = p.w;
  c.height = p.h;
  const img = new ImageData(p.w, p.h);
  for (let i = 0; i < p.d.length; i++) img.data[i] = Math.round(clamp01(alpha || i % 4 !== 3 ? p.d[i] : 1) * 255);
  c.getContext("2d")!.putImageData(img, 0, 0);
  const type = format === "webp" ? "image/webp" : "image/png";
  let url = c.toDataURL(type, format === "webp" ? 0.92 : undefined);
  // a browser that cannot write webp gives a png instead; take it as it is
  if (!url.startsWith("data:image/")) url = c.toDataURL("image/png");
  return url;
}

async function read(r: PictureRenderer, sc: ReturnType<NonNullable<ReturnType<typeof previewMaps>>["maps"]["albedo"]>, size: number): Promise<Px | null> {
  if (!sc || !sc.outputType) return null;
  return { w: size, h: size, d: await r.floats(sc, size) };
}

/** the material as an m3e material file */
export async function buildM3eMaterial(renderer: Renderer | PictureRenderer, m: GenMaterial, o: M3eExportOptions): Promise<MaterialFile> {
  const r = pictureRenderer(renderer);
  await r.imagesLoaded(rootOf(m));
  const spec = previewMaps(m);
  if (!spec) throw new Error("This material type has no texture maps to export");
  const size = o.resolution;
  const albedo = await read(r, spec.maps.albedo(), size);
  if (!albedo) throw new Error("The material has no albedo");
  const connected = (input: string) => !m.getInputDefs().some((d) => d.name === input) || m.isConnected(input);
  const normal = connected("normal_tex") ? await read(r, spec.maps.normal(), size) : null;
  const orm = await read(r, spec.maps.orm(), size);
  const emission = connected("emission_tex") ? await read(r, spec.maps.emission(), size) : null;
  const depth = connected("depth_tex") ? await read(r, spec.maps.depth(), size) : null;
  const { surface, shading } = bakeSurface(albedo, normal, orm, emission, o.light);
  const swatch = swatchOf(surface);
  // how much relief there is: the spread of the shading around mid grey
  let dev = 0;
  for (let i = 0; i < shading.d.length; i += 4) dev += Math.abs(shading.d[i] - 0.5);
  const relief = dev / (shading.d.length / 4);
  const maps: MaterialDef["maps"] = { surface: await encode(surface, o.format), shading: await encode(shading, o.format, false) };
  if (o.rawMaps) {
    maps.albedo = await encode(albedo, o.format);
    if (normal) maps.normal = await encode(normal, "png", false);
    if (depth) {
      const h = new Float32Array(depth.d.length);
      for (let i = 0; i < h.length; i += 4) h[i] = h[i + 1] = h[i + 2] = 1 - depth.d[i];
      maps.height = await encode({ w: size, h: size, d: h }, "png", false);
    }
    if (orm) maps.orm = await encode(orm, "png", false);
    if (emission) maps.emission = await encode(emission, o.format, false);
  }
  const def: MaterialDef = {
    id: materialId(o.name),
    name: o.name,
    tile: o.tile,
    resolution: size,
    light: o.light,
    maps,
    swatch,
    fallbackLook: fallbackLook(swatch, relief),
    source: { app: "Material Pro", version: "0.1.0" },
  };
  if (m.getDescription()) def.description = m.getDescription().slice(0, 500);
  if (o.project) Object.assign(def.source!, { project: o.project, projectFormat: "ptex" });
  return { format: MATERIAL_FORMAT, version: MATERIAL_VERSION, generator: { name: "Material Pro", version: "0.1.0" }, materials: [def] };
}
