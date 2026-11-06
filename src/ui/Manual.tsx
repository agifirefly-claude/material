/* Help › User manual: shows docs/用户手册.md (copied to public/docs/manual.md by npm run data) in a window, with
 * a small Markdown renderer of its own: headings, paragraphs, lists, tables, code, bold and links. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { t } from "./i18n";

const REPO_DOCS = "https://github.com/agifirefly-wu/material-pro/blob/main/docs/";

type Block =
  | { kind: "h"; level: number; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; children: Block[] }[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string };

export const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** Markdown text → blocks (the subset the manual uses) */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let i = 0;
  const isList = (l: string) => /^\s*([-*]|\d+\.)\s+/.test(l);
  const indent = (l: string) => l.length - l.trimStart().length;
  const list = (base: number): Block => {
    const ordered = /^\s*\d+\./.test(lines[i]);
    const sameKind = (l: string) => /^\s*\d+\./.test(l) === ordered;
    const items: { text: string; children: Block[] }[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // a blank line ends the list unless an item of it follows
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && isList(lines[j]) && indent(lines[j]) >= base && (indent(lines[j]) > base || sameKind(lines[j]))) {
          i = j;
          continue;
        }
        if (j < lines.length && indent(lines[j]) > base && items.length) {
          i = j;
          continue;
        }
        break;
      }
      const ind = indent(l);
      if (ind < base) break;
      if (isList(l) && ind === base && !sameKind(l)) break;
      if (isList(l) && ind === base) {
        items.push({ text: l.trim().replace(/^([-*]|\d+\.)\s+/, ""), children: [] });
        i++;
      } else if (isList(l) && ind > base && items.length) {
        items[items.length - 1].children.push(list(ind));
      } else if (l.trim().startsWith("```") && items.length) {
        items[items.length - 1].children.push(code());
      } else if (items.length) {
        // continuation of the item, or an indented paragraph inside it
        const last = items[items.length - 1];
        if (lines[i - 1]?.trim()) last.text += " " + l.trim();
        else last.children.push({ kind: "p", text: l.trim() });
        i++;
      } else break;
    }
    return { kind: "list", ordered, items };
  };
  const code = (): Block => {
    const ind = indent(lines[i]);
    i++;
    const body: string[] = [];
    while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++].slice(ind));
    i++;
    return { kind: "code", text: body.join("\n") };
  };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      out.push({ kind: "h", level: h[1].length, text: h[2].trim(), id: slug(h[2]) });
      i++;
    } else if (l.trim().startsWith("```")) out.push(code());
    else if (isList(l)) out.push(list(indent(l)));
    else if (l.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      out.push({ kind: "table", head, rows });
    } else if (l.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ kind: "quote", text: body.join(" ") });
    } else {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s|\|)/.test(lines[i])) body.push(lines[i++].trim());
      out.push({ kind: "p", text: body.join(" ") });
    }
  }
  return out;
}

/** inline Markdown: `code`, **bold**, [text](link) */
export function inline(s: string, onLink?: (href: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let k = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k++}>{inline(m[2], onLink)}</strong>);
    else {
      const href = m[4];
      const external = /^https?:/.test(href);
      const url = external ? href : href.startsWith("#") ? href : REPO_DOCS + href;
      out.push(
        <a
          key={k++}
          href={url}
          target={href.startsWith("#") ? undefined : "_blank"}
          rel="noreferrer"
          onClick={(e) => {
            if (href.startsWith("#") && onLink) {
              e.preventDefault();
              onLink(href.slice(1));
            }
          }}
        >
          {inline(m[3], onLink)}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function Blocks({ blocks, onLink }: { blocks: Block[]; onLink: (id: string) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const H = `h${Math.min(6, b.level)}` as "h2";
            return (
              <H key={i} id={"manual-" + b.id}>
                {inline(b.text, onLink)}
              </H>
            );
          }
          case "p":
            return <p key={i}>{inline(b.text, onLink)}</p>;
          case "quote":
            return <blockquote key={i}>{inline(b.text, onLink)}</blockquote>;
          case "code":
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={i} className="manual-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>{inline(c, onLink)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, n) => (
                          <td key={n}>{inline(c, onLink)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "list": {
            const L = b.ordered ? "ol" : "ul";
            return (
              <L key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    {inline(it.text, onLink)}
                    {it.children.length > 0 && <Blocks blocks={it.children} onLink={onLink} />}
                  </li>
                ))}
              </L>
            );
          }
        }
      })}
    </>
  );
}

const MANUAL_CSS = `
.manual-back{position:fixed;inset:0;background:#0008;z-index:1000;display:flex;align-items:center;justify-content:center}
.manual{background:var(--bg2,#23262b);color:var(--text,#ddd);width:min(1100px,94vw);height:88vh;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px #0009}
.manual-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--line,#3a3f47)}
.manual-head h1{font-size:15px;margin:0;flex:1}
.manual-head input{width:200px}
.manual-body{flex:1;display:flex;min-height:0}
.manual-toc{width:220px;overflow:auto;padding:10px;border-right:1px solid var(--line,#3a3f47);font-size:13px}
.manual-toc button{display:block;width:100%;text-align:left;background:none;border:none;color:inherit;padding:3px 6px;cursor:pointer;border-radius:4px}
.manual-toc button:hover{background:#ffffff14}
.manual-toc .sub{padding-left:18px;color:var(--text2,#aaa)}
.manual-text{flex:1;overflow:auto;padding:4px 28px 40px;line-height:1.65;font-size:14px}
.manual-text h2{font-size:20px;margin:20px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line,#3a3f47)}
.manual-text h3{font-size:16px;margin:18px 0 6px}
.manual-text h4{font-size:14px;margin:14px 0 4px}
.manual-text code{background:#ffffff14;padding:1px 4px;border-radius:3px;font-size:12.5px}
.manual-text pre{background:#0004;padding:8px 12px;border-radius:6px;overflow:auto}
.manual-text pre code{background:none;padding:0}
.manual-text a{color:var(--accent,#6aa9ff)}
.manual-table{overflow:auto}
.manual-text table{border-collapse:collapse;margin:8px 0}
.manual-text th,.manual-text td{border:1px solid var(--line,#3a3f47);padding:4px 8px;vertical-align:top;text-align:left}
.manual-text th{background:#ffffff0d}
.manual-text mark{background:#e6c05a55;color:inherit}
@media (max-width:700px){.manual-toc{display:none}.manual-text{padding:4px 14px 30px}}
`;

export function Manual({ onClose, url = "docs/manual.md" }: { onClose: () => void; url?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then(setText, (e) => setError(String(e.message ?? e)));
  }, [url]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const blocks = useMemo(() => (text ? parseMarkdown(text) : []), [text]);
  // the title is the first heading; the contents are the second and third levels
  const title = blocks.find((b) => b.kind === "h" && b.level === 1) as Extract<Block, { kind: "h" }> | undefined;
  const toc = blocks.filter((b): b is Extract<Block, { kind: "h" }> => b.kind === "h" && (b.level === 2 || b.level === 3));
  // the search keeps the sections (from one heading to the next) that contain the text
  const shown = useMemo(() => {
    const rest = blocks.filter((b) => b !== title);
    const q = query.trim().toLowerCase();
    if (!q) return rest;
    const out: Block[] = [];
    let section: Block[] = [];
    const flush = () => {
      if (JSON.stringify(section).toLowerCase().includes(q)) out.push(...section);
      section = [];
    };
    for (const b of rest) {
      if (b.kind === "h" && b.level <= 3) flush();
      section.push(b);
    }
    flush();
    return out;
  }, [blocks, title, query]);
  const go = (id: string) => {
    setQuery("");
    setTimeout(() => body.current?.querySelector("#manual-" + CSS.escape(id))?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  return (
    <div className="manual-back" onClick={onClose}>
      <style>{MANUAL_CSS}</style>
      <div className="manual" role="dialog" aria-label={t("User manual")} onClick={(e) => e.stopPropagation()}>
        <div className="manual-head">
          <h1>{title ? title.text : t("User manual")}</h1>
          <input placeholder={t("Search the manual")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={onClose}>{t("Close")}</button>
        </div>
        <div className="manual-body">
          <nav className="manual-toc">
            {toc.map((h, i) => (
              <button key={i} className={h.level === 3 ? "sub" : ""} onClick={() => go(h.id)}>
                {h.text.replace(/`/g, "")}
              </button>
            ))}
          </nav>
          <div className="manual-text" ref={body}>
            {error ? <p>{t("Cannot load the manual: {0}", error)}</p> : text === null ? <p>…</p> : shown.length ? <Blocks blocks={shown} onLink={go} /> : <p>{t("Nothing found")}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}


let root: Root | null = null;
let host: HTMLDivElement | null = null;
/** opens the manual over the app (Help › User manual) */
export function openManual(): void {
  if (!host) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root!.render(<Manual onClose={() => root!.render(null)} />);
}
