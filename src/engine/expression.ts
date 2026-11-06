/* A small, safe evaluator for the numeric expressions Material Maker accepts in float fields
 * (Godot's Expression class there): numbers, + - * / % **, parentheses, and common math functions. */

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, exp: Math.exp, log: Math.log,
  pow: Math.pow, min: Math.min, max: Math.max, fract: (x) => x - Math.floor(x), sign: Math.sign,
  clamp: (x, a, b) => Math.min(Math.max(x, a), b), mix: (a, b, t) => a + (b - a) * t, lerp: (a, b, t) => a + (b - a) * t,
  float: (x) => x, int: (x) => Math.trunc(x),
};
const CONSTS: Record<string, number> = { PI: Math.PI, TAU: Math.PI * 2, E: Math.E };

export function evaluateExpression(src: string, vars: Record<string, number> = {}): number | undefined {
  let i = 0;
  const s = src;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (): never => {
    throw new Error("bad expression");
  };
  const primary = (): number => {
    ws();
    const c = s[i];
    if (c === "(") {
      i++;
      const v = expr();
      ws();
      if (s[i] !== ")") fail();
      i++;
      return v;
    }
    if (c === "-") {
      i++;
      return -power();
    }
    if (c === "+") {
      i++;
      return power();
    }
    const num = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)/i.exec(s.slice(i));
    if (num) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    const id = /^\$?[A-Za-z_]\w*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0].replace(/^\$/, "");
      ws();
      if (s[i] === "(") {
        i++;
        const args: number[] = [];
        ws();
        if (s[i] !== ")") {
          for (;;) {
            args.push(expr());
            ws();
            if (s[i] === ",") i++;
            else break;
          }
        }
        if (s[i] !== ")") fail();
        i++;
        const f = FUNCS[name];
        if (!f) fail();
        return f(...args);
      }
      if (name in vars) return vars[name];
      if (name in CONSTS) return CONSTS[name];
      return fail();
    }
    return fail();
  };
  const power = (): number => {
    const b = primary();
    ws();
    if (s.startsWith("**", i)) {
      i += 2;
      return Math.pow(b, power());
    }
    return b;
  };
  const term = (): number => {
    let v = power();
    for (;;) {
      ws();
      const c = s[i];
      if ((c === "*" && s[i + 1] !== "*") || c === "/" || c === "%") {
        i++;
        const r = power();
        v = c === "*" ? v * r : c === "/" ? v / r : v % r;
      } else return v;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      ws();
      const c = s[i];
      if (c === "+" || c === "-") {
        i++;
        const r = term();
        v = c === "+" ? v + r : v - r;
      } else return v;
    }
  };
  try {
    const v = expr();
    ws();
    if (i !== s.length) return undefined;
    return Number.isFinite(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
