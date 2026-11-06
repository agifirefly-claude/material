import type React from "react";
import { useMemo, useState } from "react";
import { registry, type LibraryItem } from "../engine/registry";
import { LIB_MIME } from "./GraphView";
import { editor, useEditor } from "./store";
import { GenGraph } from "../engine/gen/graph";
import { GenMaterial } from "../engine/gen/misc";

type Folder = { name: string; path: string; item?: LibraryItem; children: Folder[] };

function buildTree(items: LibraryItem[]): Folder {
  const root: Folder = { name: "", path: "", children: [] };
  for (const it of items) {
    if (it.skip_in_menu) continue;
    const parts = it.tree_item.split("/");
    let f = root;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let c = f.children.find((x) => x.name === parts[i]);
      if (!c) {
        c = { name: parts[i], path, children: [] };
        f.children.push(c);
      }
      if (i === parts.length - 1) c.item = it;
      f = c;
    }
  }
  return root;
}

function addNode(item: LibraryItem) {
  window.dispatchEvent(new CustomEvent("mm-add-node", { detail: item }));
}

function Item({ f, depth, open, toggle }: { f: Folder; depth: number; open: Set<string>; toggle: (p: string) => void }) {
  const isOpen = open.has(f.path);
  const hasChildren = f.children.length > 0;
  return (
    <div className={hasChildren ? "tree-folder" : ""}>
      <div
        className="tree-row"
        draggable={!!f.item}
        onDragStart={(e) => {
          if (!f.item) return;
          e.dataTransfer.setData(LIB_MIME, JSON.stringify(f.item));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => (hasChildren ? toggle(f.path) : f.item && addNode(f.item))}
        onDoubleClick={() => f.item && hasChildren && addNode(f.item)}
        title={f.item ? `${f.item.tree_item}\nClick or drag to add${hasChildren ? " (double click)" : ""}` : f.path}
      >
        <span className="caret">{hasChildren ? (isOpen ? "▾" : "▸") : ""}</span>
        {f.item?.icon_data && <img src={"data:image/png;base64," + f.item.icon_data} alt="" />}
        <span>{f.name}</span>
      </div>
      {hasChildren && isOpen && (
        <div className="tree-children">
          {f.children.map((c) => (
            <Item key={c.path} f={c} depth={depth + 1} open={open} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Library() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(registry.library), []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return registry.library.filter((it) => {
      const hay = (it.tree_item + " " + (it.display_name ?? "") + " " + (registry.aliases[it.tree_item] ?? "")).toLowerCase();
      return s.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [q]);
  const toggle = (p: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  return (
    <>
      <h3>
        Library <span className="grow" /> <span style={{ textTransform: "none" }}>{registry.library.length}</span>
      </h3>
      <div className="lib-search">
        <input type="search" placeholder="Search nodes (e.g. noise, blur, brick)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll tree" style={{ flex: 1 }}>
        {results
          ? results.map((it) => (
              <div
                key={it.tree_item}
                className="tree-row"
                draggable
                onDragStart={(e) => e.dataTransfer.setData(LIB_MIME, JSON.stringify(it))}
                onClick={() => addNode(it)}
                title={it.tree_item}
              >
                {it.icon_data && <img src={"data:image/png;base64," + it.icon_data} alt="" />}
                <span>{it.tree_item.split("/").slice(-2).join(" / ")}</span>
              </div>
            ))
          : tree.children.map((c) => <Item key={c.path} f={c} depth={0} open={open} toggle={toggle} />)}
        {results && !results.length && <div className="empty">No node matches</div>}
      </div>
      <Hierarchy />
    </>
  );
}

function Hierarchy() {
  useEditor();
  const walk = (g: GenGraph, path: string[], depth: number): React.ReactElement[] => {
    const rows: React.ReactElement[] = [];
    for (const c of g.children) {
      if (!(c instanceof GenGraph) || c instanceof GenMaterial) continue;
      const p = [...path, c.name];
      const current = p.join("/") === editor.path.join("/");
      rows.push(
        <div key={p.join("/")} className="tree-row" style={{ paddingLeft: 8 + depth * 12, color: current ? "#fff" : undefined, background: current ? "var(--bg4)" : undefined }} onClick={() => ((editor.path = p), (editor.selection = []), editor.emit())}>
          ▸ {c.getTypeName()} <span style={{ color: "var(--text3)" }}>{c.name}</span>
        </div>,
      );
      rows.push(...walk(c, p, depth + 1));
    }
    return rows;
  };
  const rows = walk(editor.root, [], 1);
  return (
    <div className="hier scroll">
      <h3>Hierarchy</h3>
      <div className="tree-row" style={{ color: editor.path.length ? undefined : "#fff" }} onClick={() => editor.goTo(0)}>
        ◆ {editor.title}
      </div>
      {rows}
      {!rows.length && <div style={{ color: "var(--text3)", padding: "2px 12px 8px" }}>No subgraphs</div>}
    </div>
  );
}
