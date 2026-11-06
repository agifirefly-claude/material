/* Find a node anywhere in the project (Ctrl+F) and go to it, opening its subgraph. */
import { useMemo, useState } from "react";
import { editor } from "../store";
import { GenGraph } from "../../engine/gen/graph";
import type { Gen } from "../../engine/gen/base";
import { selectAnywhere } from "../Inspector";
import { t, useLang } from "../i18n";

function allNodes(g: GenGraph, out: Gen[] = []): Gen[] {
  for (const c of g.children) {
    out.push(c);
    if (c instanceof GenGraph) allNodes(c, out);
  }
  return out;
}

export function NodeSearch({ onClose, onGo }: { onClose: () => void; onGo: (g: Gen) => void }) {
  useLang();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const nodes = allNodes(editor.root);
    if (!s) return nodes.slice(0, 50);
    return nodes.filter((n) => [n.name, n.getTypeName(), t(n.getTypeName()), n.model ?? "", n.getHierName()].some((x) => x.toLowerCase().includes(s))).slice(0, 50);
  }, [q]);
  const go = (n: Gen) => {
    selectAnywhere(n);
    onGo(n);
    onClose();
  };
  return (
    <div className="menu-list" style={{ position: "absolute", top: 34, left: "50%", transform: "translateX(-50%)", width: 360, zIndex: 60 }}>
      <input
        autoFocus
        type="search"
        placeholder={t("Find a node in the project…")}
        value={q}
        style={{ width: "100%", marginBottom: 4 }}
        onChange={(e) => (setQ(e.target.value), setSel(0))}
        onBlur={() => setTimeout(onClose, 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") setSel((s) => Math.min(results.length - 1, s + 1));
          if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
          if (e.key === "Enter" && results[sel]) go(results[sel]);
        }}
      />
      <div style={{ maxHeight: 360, overflow: "auto" }}>
        {results.map((n, i) => (
          <button key={n.id} onMouseDown={() => go(n)} style={{ background: i === sel ? "var(--bg4)" : undefined }}>
            {t(n.getTypeName())} <span style={{ color: "var(--text3)" }}>{n.getHierName() || n.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
