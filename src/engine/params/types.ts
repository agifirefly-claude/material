/* Parameter value types, ported from addons/material_maker/types/*.gd.
 * Each knows how to (de)serialize itself the way Material Maker files store it and which uniforms and GLSL it needs. */
import { ShaderUniform } from "../shader-code";

export type Color = { r: number; g: number; b: number; a: number };
export const isColor = (v: unknown): v is Color =>
  !!v && typeof v === "object" && "r" in v && "g" in v && "b" in v && "a" in v && !("type" in v && (v as { type: string }).type !== "Color");
export const color = (r: number, g: number, b: number, a = 1): Color => ({ r, g, b, a });
const colorArray = (cs: Color[]) => cs.flatMap((c) => [c.r, c.g, c.b, c.a]);

/* ---------- gradient ---------- */
export enum Interpolation {
  CONSTANT = 0,
  LINEAR = 1,
  SMOOTHSTEP = 2,
  CUBIC = 3,
}
export class Gradient {
  points: { v: number; c: Color }[] = [
    { v: 0, c: color(0, 0, 0, 1) },
    { v: 1, c: color(1, 1, 1, 1) },
  ];
  interpolation: Interpolation = Interpolation.LINEAR;

  clone(): Gradient {
    const g = new Gradient();
    g.points = this.points.map((p) => ({ v: p.v, c: { ...p.c } }));
    g.interpolation = this.interpolation;
    return g;
  }
  sort(): void {
    this.points.sort((a, b) => a.v - b.v);
    for (let i = 0; i < this.points.length - 1; i++) if (this.points[i].v + 0.0000005 >= this.points[i + 1].v) this.points[i + 1].v = this.points[i].v + 0.000001;
  }
  getColor(x: number): Color {
    this.sort();
    const ps = this.points;
    if (!ps.length) return color(0, 0, 0, 1);
    if (x < ps[0].v) return ps[0].c;
    const s = ps.length - 1;
    if (x > ps[s].v) return ps[s].c;
    for (let i = 0; i < s; i++) {
      if (x < ps[i + 1].v) {
        const t = (x - ps[i].v) / (ps[i + 1].v - ps[i].v);
        const f = this.interpolation === Interpolation.CONSTANT ? 0 : this.interpolation === Interpolation.SMOOTHSTEP ? 0.5 - 0.5 * Math.cos(Math.PI * t) : t;
        const a = ps[i].c,
          b = ps[i + 1].c;
        return color(a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f, a.a + (b.a - a.a) * f);
      }
    }
    return ps[s].c;
  }
  getParameters(name: string): ShaderUniform[] {
    this.sort();
    return [
      new ShaderUniform(`p_${name}_pos`, "float", this.points.map((p) => p.v), this.points.length),
      new ShaderUniform(`p_${name}_col`, "vec4", colorArray(this.points.map((p) => p.c)), this.points.length),
    ];
  }
  getShader(name: string): string {
    this.sort();
    const pv = (i: number) => `p_${name}_pos[${i}]`;
    const pc = (i: number) => `p_${name}_col[${i}]`;
    const n = this.points.length;
    let sh = `vec4 ${name}_gradient_fct(float x) {\n`;
    if (n === 0) return sh + "  return vec4(0.0, 0.0, 0.0, 1.0);\n}\n";
    const s = n - 1;
    switch (this.interpolation) {
      case Interpolation.CONSTANT:
        if (n === 1) {
          sh += `  return ${pc(0)};\n`;
          break;
        }
        sh += `  if (x < ${pv(1)}) {\n    return ${pc(0)};\n`;
        for (let i = 1; i < s; i++) sh += `  } else if (x < ${pv(i + 1)}) {\n    return ${pc(i)};\n`;
        sh += `  }\n  return ${pc(s)};\n`;
        break;
      case Interpolation.LINEAR:
      case Interpolation.SMOOTHSTEP: {
        sh += `  if (x < ${pv(0)}) {\n    return ${pc(0)};\n`;
        const fn = this.interpolation === Interpolation.LINEAR ? "(" : "0.5-0.5*cos(3.14159265359*";
        for (let i = 0; i < s; i++) sh += `  } else if (x < ${pv(i + 1)}) {\n    return mix(${pc(i)}, ${pc(i + 1)}, ${fn}(x-${pv(i)})/(${pv(i + 1)}-${pv(i)})));\n`;
        sh += `  }\n  return ${pc(s)};\n`;
        break;
      }
      case Interpolation.CUBIC: {
        sh += `  if (x < ${pv(0)}) {\n    return ${pc(0)};\n`;
        for (let i = 0; i < s; i++) {
          sh += `  } else if (x < ${pv(i + 1)}) {\n`;
          const dx = `(x-${pv(i)})/(${pv(i + 1)}-${pv(i)})`;
          const b = `mix(${pc(i)}, ${pc(i + 1)}, ${dx})`;
          if (i > 0) {
            const a = `mix(${pc(i - 1)}, ${pc(i)}, (x-${pv(i - 1)})/(${pv(i)}-${pv(i - 1)}))`;
            if (i < s - 1) {
              const c = `mix(${pc(i + 1)}, ${pc(i + 2)}, (x-${pv(i + 1)})/(${pv(i + 2)}-${pv(i + 1)}))`;
              sh += `    return 0.5*(${b} + mix(${a}, ${c}, 0.5-0.5*cos(3.14159265359*${dx})));\n`;
            } else sh += `    return mix(${a}, ${b}, 0.5+0.5*${dx});\n`;
          } else if (i < s - 1) {
            const c = `mix(${pc(i + 1)}, ${pc(i + 2)}, (x-${pv(i + 1)})/(${pv(i + 2)}-${pv(i + 1)}))`;
            sh += `    return mix(${c}, ${b}, 1.0-0.5*${dx});\n`;
          } else sh += `    return ${b};\n`;
        }
        sh += `  }\n  return ${pc(s)};\n`;
        break;
      }
    }
    return sh + "}\n";
  }
  serialize(): unknown {
    this.sort();
    let pts: { pos: number; r: number; g: number; b: number; a: number }[] = [];
    if (this.interpolation === Interpolation.CONSTANT && this.points.length) {
      let p = this.points[0];
      pts.push({ pos: 0, ...p.c });
      for (let i = 1; i < this.points.length; i++) {
        const np = this.points[i];
        pts.push({ pos: np.v - 0.00001, ...p.c });
        p = np;
        pts.push({ pos: np.v + 0.00001, ...p.c });
      }
    } else pts = this.points.map((p) => ({ pos: p.v, ...p.c }));
    return { type: "Gradient", points: pts, interpolation: this.interpolation };
  }
  static deserialize(v: unknown): Gradient {
    const g = new Gradient();
    g.points = [];
    if (Array.isArray(v)) {
      for (const i of v) g.points.push({ v: i.pos, c: color(i.r, i.g, i.b, i.a ?? 1) });
      g.interpolation = Interpolation.LINEAR;
    } else if (v && typeof v === "object" && (v as { type?: string }).type === "Gradient") {
      const d = v as { points: { pos: number; r: number; g: number; b: number; a?: number }[]; interpolation?: number };
      for (const i of d.points) g.points.push({ v: i.pos, c: color(i.r, i.g, i.b, i.a ?? 1) });
      g.interpolation = d.interpolation !== undefined ? Math.round(d.interpolation) : Interpolation.LINEAR;
      if (g.interpolation === Interpolation.CONSTANT && g.points.length) {
        for (let i = g.points.length - 1; i > 0; i--) {
          const a = g.points[i - 1].c,
            b = g.points[i].c;
          if (a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a) g.points.splice(i, 1);
          else g.points[i].v = 0.5 * (g.points[i - 1].v + g.points[i].v);
        }
        g.points[0].v = 0;
      }
    }
    return g;
  }
}

/* ---------- curve ---------- */
export type CurvePoint = { x: number; y: number; ls: number; rs: number };
export class Curve {
  points: CurvePoint[] = [
    { x: 0, y: 0, ls: 0, rs: 1 },
    { x: 1, y: 1, ls: 1, rs: 0 },
  ];
  clone(): Curve {
    const c = new Curve();
    c.points = this.points.map((p) => ({ ...p }));
    return c;
  }
  getShaderParams(name: string): Record<string, number> {
    const rv: Record<string, number> = {};
    this.points.forEach((p, i) => {
      rv[`p_${name}_${i}_x`] = p.x;
      rv[`p_${name}_${i}_y`] = p.y;
      rv[`p_${name}_${i}_ls`] = p.ls;
      rv[`p_${name}_${i}_rs`] = p.rs;
    });
    return rv;
  }
  getShader(name: string): string {
    let sh = `float ${name}_curve_fct(float x) {\n`;
    const n = this.points.length;
    for (let i = 0; i < n - 1; i++) {
      if (i < n - 2) sh += `if (x <= p_${name}_${i + 1}_x) `;
      sh += "{\n";
      sh += `float dx = x - p_${name}_${i}_x;\n`;
      sh += `float d = p_${name}_${i + 1}_x - p_${name}_${i}_x;\n`;
      sh += "float t = dx/d;\nfloat omt = (1.0 - t);\nfloat omt2 = omt * omt;\nfloat omt3 = omt2 * omt;\nfloat t2 = t * t;\nfloat t3 = t2 * t;\nd /= 3.0;\n";
      sh += `float y1 = p_${name}_${i}_y;\n`;
      sh += `float yac = p_${name}_${i}_y + d*p_${name}_${i}_rs;\n`;
      sh += `float ybc = p_${name}_${i + 1}_y - d*p_${name}_${i + 1}_ls;\n`;
      sh += `float y2 = p_${name}_${i + 1}_y;\n`;
      sh += "return y1*omt3 + yac*omt2*t*3.0 + ybc*omt*t2*3.0 + y2*t3;\n}\n";
    }
    if (n < 2) sh += "return x;\n";
    return sh + "}\n";
  }
  /** value at x, for drawing the curve in the editor */
  evaluate(x: number): number {
    const ps = this.points;
    for (let i = 0; i < ps.length - 1; i++) {
      if (x <= ps[i + 1].x || i === ps.length - 2) {
        let d = ps[i + 1].x - ps[i].x;
        const t = (x - ps[i].x) / d;
        const omt = 1 - t;
        d /= 3;
        const yac = ps[i].y + d * ps[i].rs,
          ybc = ps[i + 1].y - d * ps[i + 1].ls;
        return ps[i].y * omt ** 3 + yac * omt * omt * t * 3 + ybc * omt * t * t * 3 + ps[i + 1].y * t ** 3;
      }
    }
    return x;
  }
  serialize(): unknown {
    return { type: "Curve", points: this.points.map((p) => ({ ...p })) };
  }
  static deserialize(v: unknown): Curve {
    const c = new Curve();
    c.points = [];
    const d = v as { points?: CurvePoint[] };
    for (const p of d?.points ?? []) c.points.push({ x: p.x, y: p.y, ls: p.ls ?? 0, rs: p.rs ?? 0 });
    c.points.sort((a, b) => a.x - b.x);
    return c;
  }
}

/* ---------- polygon / polyline ---------- */
export class Polygon {
  points: { x: number; y: number }[] = [
    { x: 0.2, y: 0.2 },
    { x: 0.7, y: 0.4 },
    { x: 0.4, y: 0.7 },
  ];
  clone(): Polygon {
    const p = new Polygon();
    p.points = this.points.map((q) => ({ ...q }));
    return p;
  }
  getParameters(name: string): ShaderUniform[] {
    return [new ShaderUniform(`p_${name}_pos`, "vec2", this.points.flatMap((p) => [p.x, p.y]), this.points.length)];
  }
  getShader(name: string): string {
    return `p_${name}_pos`;
  }
  serialize(): unknown {
    return { type: "Polygon", points: this.points.map((p) => ({ ...p })) };
  }
  static deserialize(v: unknown): Polygon {
    const p = new Polygon();
    p.points = ((v as { points?: { x: number; y: number }[] })?.points ?? []).map((q) => ({ x: q.x, y: q.y }));
    return p;
  }
}

/* ---------- lattice ---------- */
export class Lattice {
  size = { x: 1, y: 1 };
  points: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  clone(): Lattice {
    const l = new Lattice();
    l.size = { ...this.size };
    l.points = this.points.map((p) => ({ ...p }));
    return l;
  }
  getParameters(name: string): ShaderUniform[] {
    return [new ShaderUniform(`p_${name}_pos`, "vec2", this.points.flatMap((p) => [p.x, p.y]), this.points.length)];
  }
  getShader(name: string): string {
    return `p_${name}_pos`;
  }
  serialize(): unknown {
    return { type: "Lattice", size: { ...this.size }, points: this.points.map((p) => ({ ...p })) };
  }
  static deserialize(v: unknown): Lattice {
    const l = new Lattice();
    const d = v as { size: { x: number; y: number }; points: { x: number; y: number }[] };
    l.size = { x: Math.round(d.size.x), y: Math.round(d.size.y) };
    l.points = d.points.map((p) => ({ x: p.x, y: p.y }));
    return l;
  }
}

/* ---------- splines ---------- */
export class Splines {
  /** 16 floats per bezier: 4 points of (x, y, width, offset) */
  values: number[] = [];
  pointGroups: number[][] = [];
  clone(): Splines {
    const s = new Splines();
    s.values = [...this.values];
    s.pointGroups = this.pointGroups.map((g) => [...g]);
    return s;
  }
  packed(): number[] {
    return this.values.length ? this.values : [0, 0, 0, 0];
  }
  getParameters(name: string): ShaderUniform[] {
    const v = this.packed();
    return [new ShaderUniform(`p_${name}_points`, "vec4", v, Math.max(1, v.length / 4))];
  }
  getShader(name: string): string {
    return `p_${name}_points`;
  }
  serialize(): unknown {
    return { type: "Splines", values: [...this.values], point_groups: this.pointGroups.map((g) => [...g]) };
  }
  static deserialize(v: unknown): Splines {
    const s = new Splines();
    const d = v as { values?: number[]; point_groups?: number[][] };
    const n = 16 * Math.floor((d.values?.length ?? 0) / 16);
    s.values = (d.values ?? []).slice(0, n);
    s.pointGroups = (d.point_groups ?? []).map((g) => g.map((x) => Math.round(x)));
    return s;
  }
}

/* ---------- pixels ---------- */
export class Pixels {
  size = { x: 8, y: 8 };
  bpp = 1;
  palette: Color[] = [];
  pixels: number[] = [];
  constructor() {
    const colors = 1 << this.bpp;
    for (let c = 0; c < colors; c++) {
      const v = 1 - (colors - c - 1) / (colors - 1);
      this.palette.push(color(v, v, v, 1));
    }
    this.updateData();
  }
  updateData(): void {
    while (this.palette.length < 1 << this.bpp) this.palette.push(color(0, 0, 0, 1));
    this.palette = this.palette.slice(0, 1 << this.bpp);
    const ppw = Math.floor(32 / this.bpp);
    const words = 1 + Math.floor((this.size.x * this.size.y - 1) / ppw);
    this.pixels = new Array(words).fill(0);
  }
  clone(): Pixels {
    const p = new Pixels();
    p.size = { ...this.size };
    p.bpp = this.bpp;
    p.palette = this.palette.map((c) => ({ ...c }));
    p.pixels = [...this.pixels];
    return p;
  }
  getColorIndex(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.size.x || y >= this.size.y) return 0;
    const ppw = Math.floor(32 / this.bpp);
    const index = x + this.size.x * y;
    return ((1 << this.bpp) - 1) & (this.pixels[Math.floor(index / ppw)] >>> (this.bpp * (index % ppw)));
  }
  setColorIndex(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.size.x || y >= this.size.y) return;
    const ppw = Math.floor(32 / this.bpp);
    const mask = (1 << this.bpp) - 1;
    const index = x + this.size.x * y;
    const w = Math.floor(index / ppw);
    const shift = this.bpp * (index % ppw);
    this.pixels[w] = ((this.pixels[w] & ~(mask << shift)) | ((c & mask) << shift)) | 0;
  }
  getParameters(name: string): ShaderUniform[] {
    return [
      new ShaderUniform(`p_${name}_palette`, "vec4", colorArray(this.palette), this.palette.length),
      new ShaderUniform(`p_${name}_pixels`, "int", this.pixels.map((p) => p | 0), this.pixels.length),
    ];
  }
  getShader(name: string): string {
    const ppw = Math.floor(32 / this.bpp);
    let sh = `const ivec2 ${name}_size = ivec2(${this.size.x}, ${this.size.y});\n`;
    sh += `vec4 ${name}_pixels_fct(ivec2 v) {\n`;
    sh += `\tif (v.x < 0 || v.x >= ${this.size.x} || v.y < 0 || v.y >= ${this.size.y}) {\n`;
    sh += `\t\treturn p_${name}_palette[0];\n\t} else {\n`;
    sh += `\t\tint i = v.x+${this.size.x}*v.y;\n`;
    sh += `\t\tint c = ${(1 << this.bpp) - 1} & (p_${name}_pixels[i/${ppw}] >> (${this.bpp}*(i%${ppw})));\n`;
    sh += `\t\treturn p_${name}_palette[c];\n\t}\n}\n`;
    return sh;
  }
  serialize(): unknown {
    return { type: "Pixels", w: this.size.x, h: this.size.y, bpp: this.bpp, pl: this.palette.map((c) => ({ ...c })), px: [...this.pixels] };
  }
  static deserialize(v: unknown): Pixels {
    const p = new Pixels();
    const d = v as { w: number; h: number; bpp: number; pl: Color[]; px: number[] };
    p.size = { x: Math.round(d.w), y: Math.round(d.h) };
    p.bpp = Math.round(d.bpp);
    p.palette = d.pl.map((c) => color(c.r, c.g, c.b, c.a));
    p.pixels = d.px.map((x) => Math.round(x) | 0);
    return p;
  }
}

export type ParamValue = number | string | boolean | Color | Gradient | Curve | Polygon | Lattice | Splines | Pixels | null | undefined;

/** MMType.deserialize_value */
export function deserializeValue(data: unknown): ParamValue {
  if (Array.isArray(data)) return Gradient.deserialize(data);
  if (data && typeof data === "object") {
    const d = data as { type?: string; r?: number; g?: number; b?: number; a?: number };
    switch (d.type) {
      case "Color":
        return color(d.r ?? 0, d.g ?? 0, d.b ?? 0, d.a ?? 1);
      case "Gradient":
        return Gradient.deserialize(d);
      case "Curve":
        return Curve.deserialize(d);
      case "Polygon":
        return Polygon.deserialize(d);
      case "Splines":
        return Splines.deserialize(d);
      case "Pixels":
        return Pixels.deserialize(d);
      case "Lattice":
        return Lattice.deserialize(d);
    }
    if ("r" in d && "g" in d && "b" in d && "a" in d) return color(d.r!, d.g!, d.b!, d.a!);
  }
  return data as ParamValue;
}

/** MMType.serialize_value */
export function serializeValue(v: ParamValue): unknown {
  if (v instanceof Gradient || v instanceof Curve || v instanceof Polygon || v instanceof Lattice || v instanceof Splines || v instanceof Pixels) return v.serialize();
  if (isColor(v)) return { type: "Color", r: v.r, g: v.g, b: v.b, a: v.a };
  return v;
}

export function cloneValue<T extends ParamValue>(v: T): T {
  if (v instanceof Gradient || v instanceof Curve || v instanceof Polygon || v instanceof Lattice || v instanceof Splines || v instanceof Pixels) return v.clone() as T;
  if (isColor(v)) return { ...(v as Color) } as T;
  return v;
}
