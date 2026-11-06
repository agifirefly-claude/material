/* A GLSL code editor with syntax colouring (Material Maker's widgets/code_editor): a transparent textarea over a
 * highlighted copy of its text, scrolled together. Tab indents, Shift+Tab unindents, Enter keeps the indentation. */
import { useMemo, useRef } from "react";
import type React from "react";

const KEYWORDS = new Set("if else for while do return break continue discard const uniform in out inout struct switch case default true false varying".split(" "));
const TYPES = /^(void|bool|int|uint|float|[biu]?vec[234]|mat[234](x[234])?|sampler2D|sampler3D|samplerCube)$/;
const BUILTINS = new Set(
  "radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract texture textureLod texelFetch textureSize dFdx dFdy fwidth round trunc isnan isinf lessThan greaterThan equal not any all".split(" "),
);

/** GLSL (with Material Maker's $variables) as coloured spans */
export function highlightGlsl(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(\$\([\w?:]+\)|\$[\w?]+|#\w+)|(\b\d+\.?\d*(?:e[+-]?\d+)?\b|\.\d+\b)|(\b[A-Za-z_]\w*\b)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const s = m[0];
    let cls: string | null = null;
    if (m[1]) cls = "com";
    else if (m[2]) cls = "var";
    else if (m[3]) cls = "num";
    else if (KEYWORDS.has(s)) cls = "kw";
    else if (TYPES.test(s)) cls = "ty";
    else if (BUILTINS.has(s)) cls = "fn";
    out.push(
      cls ? (
        <span key={k++} className={cls}>
          {s}
        </span>
      ) : (
        s
      ),
    );
    last = m.index! + s.length;
  }
  out.push(text.slice(last));
  // a trailing newline needs something after it to be shown in the <pre>
  out.push("\n");
  return out;
}

export function CodeEdit({ value, onChange, rows = 20, className }: { value: string; onChange: (v: string) => void; rows?: number; className?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const parts = useMemo(() => highlightGlsl(value ?? ""), [value]);
  const edit = (ta: HTMLTextAreaElement, text: string, start: number, end: number) => {
    // execCommand keeps the browser's undo history; fall back to a plain value change
    ta.focus();
    if (!document.execCommand?.("insertText", false, text)) {
      const v = ta.value;
      onChange(v.slice(0, start) + text + v.slice(end));
      requestAnimationFrame(() => ta.setSelectionRange(start + text.length, start + text.length));
    }
  };
  return (
    <div className={"code-edit " + (className ?? "")} style={{ minHeight: rows * 17 }}>
      <pre ref={pre} className="code code-edit-view" aria-hidden>
        {parts}
      </pre>
      <textarea
        className="code-edit-input"
        value={value ?? ""}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (pre.current) {
            pre.current.scrollTop = e.currentTarget.scrollTop;
            pre.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          const ta = e.currentTarget;
          const { selectionStart: s, selectionEnd: en, value: v } = ta;
          if (e.key === "Tab") {
            e.preventDefault();
            const lineStart = v.lastIndexOf("\n", s - 1) + 1;
            if (s === en && !e.shiftKey) edit(ta, "\t", s, en);
            else {
              // indent or unindent every line of the selection
              const block = v.slice(lineStart, en);
              const lines = block.split("\n");
              const next = e.shiftKey ? lines.map((l) => l.replace(/^(\t| {1,4})/, "")) : lines.map((l) => "\t" + l);
              ta.setSelectionRange(lineStart, en);
              edit(ta, next.join("\n"), lineStart, en);
              ta.setSelectionRange(lineStart, lineStart + next.join("\n").length);
            }
          } else if (e.key === "Enter") {
            e.preventDefault();
            const lineStart = v.lastIndexOf("\n", s - 1) + 1;
            let indent = /^[\t ]*/.exec(v.slice(lineStart, s))![0];
            if (/\{\s*$/.test(v.slice(lineStart, s))) indent += "\t";
            edit(ta, "\n" + indent, s, en);
          }
        }}
      />
    </div>
  );
}
