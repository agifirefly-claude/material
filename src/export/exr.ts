/* A minimal OpenEXR writer: one part, scanlines, no compression, RGBA as half floats (what Material Maker writes
 * with Image.save_exr for its float textures). Rows are given top first, as the renderer reads them. */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
/** float to IEEE 754 half, rounding to nearest */
export function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // inf / nan
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // too large: inf
  if (e <= 0) {
    if (e < -10) return sign; // too small: zero
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >> shift;
    if ((mant >> (shift - 1)) & 1) h++;
    return sign | h;
  }
  let h = sign | (e << 10) | (mant >> 13);
  if (mant & 0x1000) h++; // round (may carry into the exponent, which is right)
  return h & 0xffff;
}

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 0xff);
  }
  i32(v: number) {
    for (let i = 0; i < 4; i++) this.u8(v >>> (8 * i));
  }
  f32(v: number) {
    f32[0] = v;
    this.i32(u32[0]);
  }
  str(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
    this.u8(0);
  }
  attr(name: string, type: string, write: (w: Writer) => void) {
    const w = new Writer();
    write(w);
    this.str(name);
    this.str(type);
    this.i32(w.bytes.length);
    this.bytes.push(...w.bytes);
  }
}

/** an EXR file of RGBA float pixels (row 0 at the top) */
export function encodeExr(pixels: Float32Array, width: number, height: number): Uint8Array {
  const h = new Writer();
  h.i32(20000630);
  h.i32(2);
  const channels = ["A", "B", "G", "R"];
  h.attr("channels", "chlist", (w) => {
    for (const c of channels) {
      w.str(c);
      w.i32(1); // HALF
      w.u8(0);
      w.u8(0);
      w.u8(0);
      w.u8(0);
      w.i32(1);
      w.i32(1);
    }
    w.u8(0);
  });
  h.attr("compression", "compression", (w) => w.u8(0));
  const box = (w: Writer) => {
    w.i32(0);
    w.i32(0);
    w.i32(width - 1);
    w.i32(height - 1);
  };
  h.attr("dataWindow", "box2i", box);
  h.attr("displayWindow", "box2i", box);
  h.attr("lineOrder", "lineOrder", (w) => w.u8(0));
  h.attr("pixelAspectRatio", "float", (w) => w.f32(1));
  h.attr("screenWindowCenter", "v2f", (w) => {
    w.f32(0);
    w.f32(0);
  });
  h.attr("screenWindowWidth", "float", (w) => w.f32(1));
  h.u8(0);
  const header = new Uint8Array(h.bytes);
  const lineData = width * channels.length * 2;
  const lineSize = 8 + lineData;
  const tableSize = height * 8;
  const out = new Uint8Array(header.length + tableSize + height * lineSize);
  const view = new DataView(out.buffer);
  out.set(header, 0);
  const first = header.length + tableSize;
  for (let y = 0; y < height; y++) {
    // offsets are 64 bit; files this size fit in the low word
    view.setUint32(header.length + y * 8, first + y * lineSize, true);
    view.setUint32(header.length + y * 8 + 4, 0, true);
    let o = first + y * lineSize;
    view.setInt32(o, y, true);
    view.setInt32(o + 4, lineData, true);
    o += 8;
    // channels in alphabetical order: A, B, G, R (component 3, 2, 1, 0)
    for (const comp of [3, 2, 1, 0]) {
      for (let x = 0; x < width; x++) {
        view.setUint16(o, toHalf(pixels[(y * width + x) * 4 + comp]), true);
        o += 2;
      }
    }
  }
  return out;
}
