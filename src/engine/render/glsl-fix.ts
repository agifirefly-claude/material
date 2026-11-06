/* Material Maker's node code targets desktop GLSL 4.50 (it runs as Vulkan compute shaders). GLSL ES 3.00 (WebGL2)
 * is stricter in two ways the node library relies on:
 *  - no initializer lists:  `const int v[] = { 1, 2 };`  ->  `const int v[] = int[](1, 2);`
 *  - no implicit int -> float conversion:  `pow(2, x)`, `f(uv, 1)` where f takes a float.
 * The first is rewritten up front. The second needs types, so it is fixed from the compiler's own errors:
 * on a line where a call has no matching overload, integer literals passed where the callee wants a float become
 * floats (for user functions from their declarations, for built-ins always), then the shader is compiled again. */
import { findMatchingParenthesis } from "../util";

/** rewrites done on every shader */
const ES_RESERVED = ["input", "output", "filter", "common", "partition", "active", "cast", "namespace", "using", "superp", "half", "fixed", "sizeof", "external", "interface", "long", "short", "double", "unsigned"];
const ES_RESERVED_RE = new RegExp(`\\b(${ES_RESERVED.join("|")})\\b`, "g");

export function fixGlsl(src: string): string {
  // words GLSL ES reserves that desktop GLSL lets node code use as names
  src = src.replace(ES_RESERVED_RE, "mm_$1");
  // array initializer lists
  src = src.replace(/(\b(?:const\s+)?(\w+)\s+(\w+)\s*\[\s*(\d*)\s*\]\s*=\s*)\{([^{}]*)\}/g, (_m, head: string, type: string, _n, size: string, body: string) => {
    return `${head}${type}[${size}](${body.trim().replace(/,\s*$/, "")})`;
  });
  return src;
}

const BUILTIN_INT_ARGS: Record<string, number[]> = {
  texelFetch: [1, 2],
  textureSize: [1],
  textureLod: [],
  bitfieldExtract: [0, 1, 2],
};
const FLOAT_TYPES = new Set(["float", "vec2", "vec3", "vec4", "mat2", "mat3", "mat4"]);

interface Signature {
  params: string[];
}

/** parameter types of the functions a shader declares, by name */
export function functionSignatures(src: string): Map<string, Signature[]> {
  const rv = new Map<string, Signature[]>();
  const re = /\b(void|float|int|bool|u?int|[iub]?vec[234]|mat[234])\s+(\w+)\s*\(([^()]*)\)\s*\{/g;
  for (const m of src.matchAll(re)) {
    const params = m[3]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p && p !== "void")
      .map((p) => p.replace(/\b(in|out|inout|const|highp|mediump|lowp)\b/g, "").trim().split(/\s+/)[0]);
    const list = rv.get(m[2]) ?? [];
    list.push({ params });
    rv.set(m[2], list);
  }
  return rv;
}

function splitArgs(s: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push({ text: s.slice(start, i), start });
      start = i + 1;
    }
  }
  out.push({ text: s.slice(start), start });
  return out;
}

const INT_LITERAL = /^\s*[-+]?\d+\s*$/;

/** turns int literals into floats in the arguments of calls to `name` on one line; returns the line unchanged when nothing applies */
function fixCallsOnLine(line: string, name: string, sigs: Map<string, Signature[]>): string {
  const re = new RegExp(`\\b${name}\\s*\\(`, "g");
  let out = line;
  const matches = [...line.matchAll(re)].reverse();
  for (const m of matches) {
    const open = m.index! + m[0].length - 1;
    const close = findMatchingParenthesis(out, open);
    if (close === -1) continue;
    const args = splitArgs(out.slice(open + 1, close));
    const decls = sigs.get(name)?.filter((s) => s.params.length === args.length);
    let argsText = out.slice(open + 1, close);
    for (let i = args.length - 1; i >= 0; i--) {
      const a = args[i];
      if (!INT_LITERAL.test(a.text)) continue;
      let wantFloat: boolean;
      if (decls && decls.length) wantFloat = decls.some((d) => FLOAT_TYPES.has(d.params[i]));
      else wantFloat = !(BUILTIN_INT_ARGS[name] ?? []).includes(i);
      if (!wantFloat) continue;
      const lit = a.text.trim();
      const startInArgs = a.start + a.text.indexOf(lit);
      argsText = argsText.slice(0, startInArgs) + lit + ".0" + argsText.slice(startInArgs + lit.length);
    }
    out = out.slice(0, open + 1) + argsText + out.slice(close);
  }
  return out;
}

/** int literals that are operands of arithmetic with something else on a line */
function fixOperandsOnLine(line: string): string {
  return line.replace(/(^|[^\w.\[])(\d+)(?![\w.\]])/g, (m, pre: string, num: string, offset: number, all: string) => {
    // leave array sizes, indices, and int(...) / ivec(...) arguments alone
    const before = all.slice(0, offset + pre.length);
    if (/\b(?:int|ivec[234]|uint|uvec[234])\s*\(\s*$/.test(before) || /\[\s*$/.test(before)) return m;
    return pre + num + ".0";
  });
}

/** One round of fixes driven by a compile log; null when nothing could be changed. */
export function fixFromErrors(src: string, log: string): string | null {
  const lines = src.split("\n");
  const sigs = functionSignatures(src);
  let changed = false;
  for (const m of log.matchAll(/ERROR: 0:(\d+): (.*)/g)) {
    const ln = parseInt(m[1]) - 1;
    const msg = m[2];
    const line = lines[ln];
    if (line === undefined) continue;
    let fixed = line;
    const call = /'(\w+)' : no matching overloaded function found/.exec(msg);
    if (call) fixed = fixCallsOnLine(line, call[1], sigs);
    else if (/wrong operand types|cannot convert|'(?:min|max|mix|clamp|step|pow|mod)'/.test(msg)) fixed = fixOperandsOnLine(line);
    if (fixed !== line) {
      lines[ln] = fixed;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : null;
}
