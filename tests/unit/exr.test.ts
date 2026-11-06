/* The EXR writer, read back with three.js's EXR loader */
import { describe, expect, it } from "vitest";
import { encodeExr, toHalf } from "../../src/export/exr";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";
import { DataUtils, FloatType } from "three";

describe("EXR", () => {
  it("converts floats to halves", () => {
    for (const v of [0, 1, -2, 0.5, 0.333, 1000, 1e-5]) expect(DataUtils.fromHalfFloat(toHalf(v))).toBeCloseTo(v, v > 100 ? 0 : 3);
  });
  it("writes a file three.js reads back, non square, row 0 at the top", () => {
    const w = 5,
      h = 3;
    const px = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        px[i] = x / w;
        px[i + 1] = y / h;
        px[i + 2] = 2.5;
        px[i + 3] = 1;
      }
    const bytes = encodeExr(px, w, h);
    expect([...bytes.slice(0, 4)]).toEqual([0x76, 0x2f, 0x31, 0x01]);
    const loader = new EXRLoader();
    loader.setDataType(FloatType);
    const r = loader.parse(bytes.buffer as ArrayBuffer) as unknown as { width: number; height: number; data: Float32Array };
    expect(r.width).toBe(w);
    expect(r.height).toBe(h);
    // three flips rows (bottom first): its last row is our row 0
    const at = (x: number, y: number, c: number) => r.data[((h - 1 - y) * w + x) * 4 + c];
    expect(at(3, 0, 0)).toBeCloseTo(0.6, 2);
    expect(at(3, 2, 1)).toBeCloseTo(2 / 3, 2);
    expect(at(1, 1, 2)).toBeCloseTo(2.5, 2);
    expect(at(4, 2, 3)).toBeCloseTo(1, 3);
  });
});
