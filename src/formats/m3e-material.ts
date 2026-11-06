/* The m3e material format (docs/m3e-material.md): materials made in Material Pro, carried to m3e-canvas-pro.
 *
 * This file is the reference implementation of the format and has no dependencies, so m3e-canvas-pro can copy it
 * as lib/material.ts. It holds:
 *  - the types of a material file, of a material kept in a document (Doc.materials) and of the paint layer
 *    that draws one (PaintLayer type "material"),
 *  - openMaterialFile / cleanMaterial / cleanMaterialLayer: the one way in, which keeps only what the format
 *    allows (images are base64 data URLs of png, webp or jpeg; numbers are clamped; anything else is dropped),
 *  - materialLayerCss: the CSS background layers a material layer paints.
 *
 * In the spirit of m3e-canvas-pro's lib/look.ts: a file can never put its own CSS into a page. */

export const MATERIAL_FORMAT = "m3e-material";
export const MATERIAL_VERSION = 1;

/* ---------- a material ---------- */

/** an image: a base64 data URL of a png, webp or jpeg picture */
export type MaterialImage = string;

/** the pictures a material comes with; one tile each, all the same size, seamless */
export type MaterialMaps = {
  /** the finished surface, lit and coloured: what to tile when the material is used as it is */
  surface: MaterialImage;
  /** the surface's detail without its colour: grey, mid grey (128) at the surface's average lightness, lighter and
   *  darker where `surface` is (relief, occlusion and pattern). Laid over a colour with the overlay blend mode, it
   *  gives that colour the material's look: how "tint" layers recolour a material to the theme */
  shading: MaterialImage;
  /** base colour (sRGB) with opacity in alpha, unlit */
  albedo?: MaterialImage;
  /** tangent space normal map, OpenGL convention (green up) */
  normal?: MaterialImage;
  /** height, white is high */
  height?: MaterialImage;
  /** occlusion (red), roughness (green), metallic (blue) */
  orm?: MaterialImage;
  /** emitted light (sRGB), black where there is none */
  emission?: MaterialImage;
};

/** the light the surface and shading pictures were made with */
export type MaterialLight = {
  /** degrees, clockwise from the top of the screen: 315 is a light from the top left */
  azimuth: number;
  /** degrees above the surface, 1 to 90 */
  elevation: number;
};

/** colours that stand for the material where a picture cannot be used (a strict style, a prompt, a thumbnail) */
export type MaterialSwatch = {
  /** the average colour */
  average: string;
  /** up to 6 dominant colours, most common first */
  palette: string[];
  /** 0 (dark) to 100 (light): the average lightness, so text over the material can pick a colour */
  lightness: number;
};

export type MaterialDef = {
  /** unique in the file and, once imported, in the document: lower case letters, digits and dashes */
  id: string;
  name: string;
  description?: string;
  /** px: the size one tile is drawn at, at 100% scale */
  tile: number;
  /** px: the size of the pictures */
  resolution: number;
  light: MaterialLight;
  maps: MaterialMaps;
  swatch: MaterialSwatch;
  /** an m3e-canvas-pro look (ItemLook) that approximates the material with colours only, for renderers without pictures */
  fallbackLook?: Record<string, unknown>;
  /** where it came from, so the material can be opened again in the tool that made it */
  source?: { app: string; version?: string; project?: string; projectFormat?: string };
  tags?: string[];
};

export type MaterialFile = {
  format: typeof MATERIAL_FORMAT;
  version: number;
  generator?: { name: string; version?: string; url?: string };
  materials: MaterialDef[];
};

/* ---------- a material in a look ---------- */

export type MaterialBlend = "normal" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light" | "darken" | "lighten" | "color-burn" | "color-dodge" | "luminosity";
export const MATERIAL_BLENDS: readonly MaterialBlend[] = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "color-burn", "color-dodge", "luminosity"];

/** One layer of paint that draws a material, alongside m3e-canvas-pro's solid and gradient layers (PaintLayer). */
export type MaterialLayer = {
  type: "material";
  /** a MaterialDef id of the document */
  material: string;
  /** "surface": the material as it is. "tint": the colour `tint` with the material's relief laid over it */
  mode?: "surface" | "tint";
  /** with mode "tint": a colour reference as m3e-canvas-pro writes them (a role such as "primary", "primary/40", or a hex) */
  tint?: string;
  /** percent of the tile size, 5 to 400 */
  scale?: number;
  /** percent of a tile, -100 to 100 */
  x?: number;
  y?: number;
  /** percent, 0 to 100 */
  opacity?: number;
  /** how the layer mixes with the layers under it */
  blend?: MaterialBlend;
  hidden?: boolean;
};

/* ---------- reading ---------- */

const MAX_IMAGE = 12_000_000; // characters of a data URL, about 9 MB of picture
const IMAGE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const text = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);
export const isMaterialImage = (v: unknown): v is MaterialImage => typeof v === "string" && v.length <= MAX_IMAGE && IMAGE.test(v);
/** an id made from any name: what an importer gives a material whose id is taken or missing */
export const materialId = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "material";

/** a material as it may be kept, or nothing when it misses what the format requires */
export function cleanMaterial(v: unknown): MaterialDef | undefined {
  if (!isRecord(v) || !isRecord(v.maps) || !isRecord(v.swatch)) return undefined;
  const maps: Partial<MaterialMaps> = {};
  for (const k of ["surface", "shading", "albedo", "normal", "height", "orm", "emission"] as const) if (isMaterialImage(v.maps[k])) maps[k] = v.maps[k];
  if (!maps.surface || !maps.shading) return undefined;
  const id = typeof v.id === "string" && ID.test(v.id) && v.id.length <= 64 ? v.id : materialId(String(v.name ?? ""));
  const palette = Array.isArray(v.swatch.palette) ? v.swatch.palette.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, 6) : [];
  const average = typeof v.swatch.average === "string" && HEX.test(v.swatch.average) ? v.swatch.average : (palette[0] ?? "#808080");
  const light = isRecord(v.light) ? v.light : {};
  const out: MaterialDef = {
    id,
    name: text(v.name, 80)?.trim() || id,
    tile: num(v.tile, 8, 2048) ?? 256,
    resolution: Math.round(num(v.resolution, 8, 8192) ?? 512),
    light: { azimuth: num(light.azimuth, 0, 360) ?? 315, elevation: num(light.elevation, 1, 90) ?? 45 },
    maps: maps as MaterialMaps,
    swatch: { average, palette: palette.length ? palette : [average], lightness: num(v.swatch.lightness, 0, 100) ?? 50 },
  };
  const description = text(v.description, 500);
  if (description) out.description = description;
  // the fallback look is passed on as it is: the importer runs it through its own cleanLook
  if (isRecord(v.fallbackLook)) out.fallbackLook = v.fallbackLook;
  if (isRecord(v.source) && typeof v.source.app === "string") {
    out.source = { app: v.source.app.slice(0, 80) };
    if (typeof v.source.version === "string") out.source.version = v.source.version.slice(0, 40);
    if (typeof v.source.project === "string" && v.source.project.length <= 4_000_000) out.source.project = v.source.project;
    if (typeof v.source.projectFormat === "string") out.source.projectFormat = v.source.projectFormat.slice(0, 40);
  }
  if (Array.isArray(v.tags)) {
    const tags = v.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 20);
    if (tags.length) out.tags = tags;
  }
  return out;
}

/** The one way in for a material file: unwraps it, refuses other formats and newer versions, and keeps the
 *  materials that are whole. Ids are made unique within the file. Returns null when nothing usable is left. */
export function openMaterialFile(value: unknown): MaterialDef[] | null {
  if (!isRecord(value) || value.format !== MATERIAL_FORMAT) return null;
  if (typeof value.version !== "number" || value.version > MATERIAL_VERSION) return null;
  if (!Array.isArray(value.materials)) return null;
  const seen = new Set<string>();
  const out: MaterialDef[] = [];
  for (const m of value.materials.slice(0, 200)) {
    const c = cleanMaterial(m);
    if (!c) continue;
    c.id = uniqueId(c.id, seen);
    seen.add(c.id);
    out.push(c);
  }
  return out.length ? out : null;
}

/** `id`, or `id-2`, `id-3`… when it is taken: how an importer adds materials to a document that has some */
export function uniqueId(id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  for (let i = 2; ; i++) if (!taken.has(`${id}-${i}`)) return `${id}-${i}`;
}

/** a material layer as it may be kept, or nothing */
export function cleanMaterialLayer(v: unknown, isColorRef: (c: unknown) => boolean = (c) => typeof c === "string" && HEX.test(c)): MaterialLayer | undefined {
  if (!isRecord(v) || v.type !== "material" || typeof v.material !== "string" || !ID.test(v.material)) return undefined;
  const out: MaterialLayer = { type: "material", material: v.material };
  if (v.mode === "tint") {
    out.mode = "tint";
    if (isColorRef(v.tint)) out.tint = v.tint as string;
  }
  const scale = num(v.scale, 5, 400);
  if (scale !== undefined && scale !== 100) out.scale = scale;
  const x = num(v.x, -100, 100);
  const y = num(v.y, -100, 100);
  if (x) out.x = x;
  if (y) out.y = y;
  const opacity = num(v.opacity, 0, 100);
  if (opacity !== undefined && opacity !== 100) out.opacity = opacity;
  if (typeof v.blend === "string" && (MATERIAL_BLENDS as readonly string[]).includes(v.blend) && v.blend !== "normal") out.blend = v.blend as MaterialBlend;
  if (v.hidden === true) out.hidden = true;
  return out;
}

/* ---------- drawing ---------- */

/** one CSS background layer: what lib/look.ts's textureLayers gives for a texture, so they stack the same way */
export type CssLayer = { image: string; size: string; position: string; repeat: string; blend: string };

/**
 * The background layers a material layer paints, top first, or [] when it cannot be drawn (no such material).
 * `colorCss` turns a colour reference into CSS (m3e-canvas-pro's colorCss), for the tint.
 *
 * CSS background layers cannot be translucent, so a layer's opacity is returned for the caller to apply
 * (by drawing the layers on an element of their own with that opacity, under the part's content).
 */
export function materialLayerCss(layer: MaterialLayer, materials: readonly MaterialDef[], colorCss: (c: string) => string | undefined = (c) => c): { layers: CssLayer[]; opacity: number } {
  const l = cleanMaterialLayer(layer, (c) => typeof c === "string" && colorCss(c) !== undefined);
  const m = l && !l.hidden ? materials.find((d) => d.id === l.material) : undefined;
  if (!l || !m) return { layers: [], opacity: 1 };
  const tile = (m.tile * (l.scale ?? 100)) / 100;
  const size = `${round(tile)}px ${round(tile)}px`;
  const position = `${round(((l.x ?? 0) / 100) * tile)}px ${round(((l.y ?? 0) / 100) * tile)}px`;
  const url = (img: string) => `url("${img}")`;
  const blend = l.blend ?? "normal";
  const layers: CssLayer[] =
    l.mode === "tint"
      ? [
          // the relief over the tint colour
          { image: url(m.maps.shading), size, position, repeat: "repeat", blend: "overlay" },
          { image: (() => { const c = colorCss(l.tint ?? "") ?? m.swatch.average; return `linear-gradient(${c}, ${c})`; })(), size: "auto", position: "0 0", repeat: "repeat", blend },
        ]
      : [{ image: url(m.maps.surface), size, position, repeat: "repeat", blend }];
  return { layers, opacity: (l.opacity ?? 100) / 100 };
}

const round = (v: number) => Math.round(v * 100) / 100;
