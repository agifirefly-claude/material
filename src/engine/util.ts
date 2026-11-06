/* Shader text helpers, ported from MMGenBase (addons/material_maker/engine/nodes/gen_base.gd). */

/** Index of the parenthesis that closes the one at `i`, or -1. */
export function findMatchingParenthesis(s: string, i: number, op = "(", cp = ")"): number {
  let level = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === op) level++;
    else if (c === cp) {
      level--;
      if (level === 0) return i;
    }
  }
  return -1;
}

/** "(a, f(b, c), d)" -> ["a", "f(b, c)", "d"] */
export function splitParameters(s: string): string[] {
  if (s[0] !== "(" || findMatchingParenthesis(s, 0) !== s.length - 1) return [];
  s = s.substring(1, s.length - 1);
  const out: string[] = [];
  let p = "";
  for (const part of s.split(",")) {
    if (p !== "") p += ",";
    p += part;
    if (count(p, "(") === count(p, ")") && count(p, "[") === count(p, "]")) {
      out.push(p.trim());
      p = "";
    }
  }
  return out;
}

export function count(s: string, sub: string): number {
  let n = 0;
  let i = s.indexOf(sub);
  while (i !== -1) {
    n++;
    i = s.indexOf(sub, i + sub.length);
  }
  return n;
}

export function removeComments(s: string): string {
  for (;;) {
    const b = s.indexOf("/*");
    if (b === -1) break;
    const e = s.indexOf("*/", b);
    if (e === -1) break;
    s = s.slice(0, b) + s.slice(e + 2);
  }
  return s.replace(/\/\/.*/g, "");
}

/** Splits GLSL source into top level declarations. */
export function splitGlsl(s: string): string[] {
  s = removeComments(s).trim();
  const out: string[] = [];
  while (s !== "") {
    const semi = s.indexOf(";");
    const bracket = s.indexOf("{");
    if (semi !== -1 && (bracket === -1 || semi < bracket)) {
      out.push(s.slice(0, semi + 1));
      s = s.slice(semi + 1);
    } else if (bracket !== -1) {
      const close = findMatchingParenthesis(s, bracket, "{", "}");
      if (close === -1) {
        out.push(s);
        break;
      }
      let d = s.slice(0, close + 1);
      s = s.slice(close + 1).trim();
      if (s[0] === ";") {
        d += ";";
        s = s.slice(1);
      }
      out.push(d);
    } else {
      out.push(s);
      break;
    }
    s = s.trim();
  }
  return out;
}

export function getGlslDeclarationName(s: string): string {
  const words = s.split(" ").filter((w) => w !== "");
  if (words.length > 2 && (words[0] === "const" || words[0] === "uniform" || words[0] === "varying")) {
    let d = words[2];
    const b = d.indexOf("[");
    if (b >= 0) d = d.slice(0, b);
    return d;
  }
  const split = s.split(" ");
  if (split.length > 1) {
    const s2 = split[1].split("(");
    if (s2.length > 1) return s2[0];
  }
  return "";
}

export function removeConstantDeclarations(s: string): string {
  for (const c of ["PI", "TAU"]) s = s.replace(new RegExp(`const\\s+float\\s+${c}\\s*=.*?;`, "g"), "");
  return s;
}

export const WORD_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_?";
export const isWordLetter = (c: string) => c !== undefined && c !== "" && WORD_LETTERS.includes(c);

/** Godot String.lstrip(chars) */
export function lstrip(s: string, chars: string): string {
  let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}

export const isValidIdentifierChar = (c: string) => /[A-Za-z0-9_]/.test(c);

/** Godot's "%.9f" */
export const f9 = (v: number) => (Number.isFinite(v) ? v.toFixed(9) : "0.0");
/** Godot's "%f" */
export const f6 = (v: number) => (Number.isFinite(v) ? v.toFixed(6) : "0.0");
/** A number written as a GLSL float literal */
export function glslFloat(v: number): string {
  if (!Number.isFinite(v)) return "0.0";
  const s = String(v);
  return /[.e]/.test(s) ? s : s + ".0";
}
