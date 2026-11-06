/* PNG encoding for paint projects (saving, exporting maps): float RGBA pixels to an 8 bit PNG. Used on the page and
 * in the paint worker (paint.worker.ts), so both give the same bytes. */
import { zlibSync } from "fflate";

/** float RGBA rows (row 0 first) as an 8 bit PNG */
export function encodePixels(w: number, h: number, px: Float32Array): Uint8Array {
  const rgba = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) rgba[i] = Math.round(Math.min(1, Math.max(0, px[i])) * 255);
  return pngEncode(w, h, rgba);
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

