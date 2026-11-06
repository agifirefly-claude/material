/* GLSL shown with simple highlighting, with a copy button */
import { useMemo } from "react";
import type React from "react";
import { editor } from "../store";
import { t } from "../i18n";

const KW = /\b(if|else|for|while|return|const|uniform|in|out|inout|break|continue|true|false|discard)\b/;
const TY = /\b(void|float|int|bool|[iub]?vec[234]|mat[234]|sampler2D)\b/;
/** a light GLSL highlighter, enough to read generated code */
export function Code({ text, max }: { text: string; max?: number }) {
  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\$\(?[\w?]+\)?)|(\b\d+\.?\d*(?:e[+-]?\d+)?\b)|(\b\w+\b)/g;
    let last = 0;
    let k = 0;
    for (const m of text.matchAll(re)) {
      if (m.index! > last) out.push(text.slice(last, m.index));
      const [s] = m;
      const cls = m[1] ? "com" : m[2] ? "var" : m[3] ? "num" : KW.test(s) ? "kw" : TY.test(s) ? "ty" : null;
      out.push(cls ? (
        <span key={k++} className={cls}>
          {s}
        </span>
      ) : s);
      last = m.index! + s.length;
    }
    out.push(text.slice(last));
    return out;
  }, [text]);
  return (
    <pre className="code" style={max ? { maxHeight: max } : undefined}>
      {parts}
    </pre>
  );
}
export function copy(text: string) {
  navigator.clipboard?.writeText(text);
  editor.setStatus(t("Copied to the clipboard"));
}
