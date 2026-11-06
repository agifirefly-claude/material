import type React from "react";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { LibraryItem } from "../engine/registry";
import { LIB_MIME } from "./GraphView";
import { editor, useEditor } from "./store";
import { GenGraph } from "../engine/gen/graph";
import { GenMaterial } from "../engine/gen/misc";
import { libraries } from "./library/manager";
import { openDialog } from "./dialogs/bus";
import { t, tPath, useLang } from "./i18n";

type Item = LibraryItem & { library: string };
type Folder = { name: string; path: string; item?: Item; children: Folder[] };

function buildTree(items: Item[]): Folder {
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

/** library items matching a query, best first (kept for callers of the first version) */
export function searchLibrary(q: string): LibraryItem[] {
  return q.trim() ? libraries.search(q, false, t) : [];
}

function addNode(item: LibraryItem) {
  window.dispatchEvent(new CustomEvent("mm-add-node", { detail: item }));
}

type ItemMenu = { x: number; y: number; item: Item };

function TreeItem({ f, open, toggle, onMenu }: { f: Folder; open: Set<string>; toggle: (p: string) => void; onMenu: (m: ItemMenu) => void }) {
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
        onContextMenu={(e) => {
          if (!f.item) return;
          e.preventDefault();
          onMenu({ x: e.clientX, y: e.clientY, item: f.item });
        }}
        title={f.item ? `${tPath(f.item.tree_item)}\n${t("Click or drag to add")}` : tPath(f.path)}
      >
        <span className="caret">{hasChildren ? (isOpen ? "▾" : "▸") : ""}</span>
        {f.item?.icon_data && <img src={"data:image/png;base64," + f.item.icon_data} alt="" />}
        <span>{t(f.name)}</span>
        {f.item && f.item.library !== "base" && <span className="lib-badge">{t(libraries.library(f.item.library)?.name ?? "")}</span>}
      </div>
      {hasChildren && isOpen && (
        <div className="tree-children">
          {f.children.map((c) => (
            <TreeItem key={c.path} f={c} open={open} toggle={toggle} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemContextMenu({ m, onClose }: { m: ItemMenu; onClose: () => void }) {
  const lib = libraries.library(m.item.library);
  const editable = lib && !lib.builtin;
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <div className="menu-list" style={{ position: "fixed", left: m.x, top: m.y }} onMouseLeave={onClose}>
      <div className="label">
        {tPath(m.item.tree_item)} · {t(lib?.name ?? "")}
      </div>
      <button onClick={run(() => addNode(m.item))}>{t("Add to the graph")}</button>
      {editable && (
        <button
          onClick={run(() => {
            const n = prompt(t("New name (a path such as Folder/Name)"), m.item.tree_item);
            if (n && !libraries.renameItem(m.item.library, m.item.tree_item, n)) editor.setStatus(t("That name is taken"));
          })}
        >
          {t("Rename…")}
        </button>
      )}
      {editable && editor.selected && <button onClick={run(() => openDialog("add-to-library", { gen: editor.selected, library: m.item.library, name: m.item.tree_item, iconOnly: true }))}>{t("Update the icon from the selected node")}</button>}
      {editable && editor.selected && <button onClick={run(() => openDialog("add-to-library", { gen: editor.selected, library: m.item.library, name: m.item.tree_item }))}>{t("Replace with the selected node")}</button>}
      <button
        onClick={run(() => {
          const a = prompt(t("Other names to find this node by, separated by commas"), libraries.userAliases[m.item.tree_item] ?? "");
          if (a !== null) libraries.setAliases(m.item.tree_item, a);
        })}
      >
        {t("Aliases…")}
      </button>
      <button onClick={run(() => libraries.setQuick(libraries.quick.length < 8 ? libraries.quick.length : 7, m.item.tree_item))}>{t("Put in the quick bar")}</button>
      {editable && <button onClick={run(() => confirm(t("Delete “{0}” from {1}?", m.item.tree_item, lib!.name)) && libraries.removeItem(m.item.library, m.item.tree_item))}>{t("Delete")}</button>}
    </div>
  );
}

/** the library panel; the hierarchy sits under it unless it is docked on its own */
export function Library({ hierarchy = true }: { hierarchy?: boolean } = {}) {
  useLang();
  useSyncExternalStore(libraries.subscribe, libraries.getVersion);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<ItemMenu | null>(null);
  const items = libraries.items();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(items), [libraries.version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const results = useMemo(() => (q.trim() ? (libraries.search(q, false, t) as Item[]) : null), [q, libraries.version]);
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
        {t("Library")} <span className="grow" /> <span style={{ textTransform: "none" }}>{items.length}</span>
        <button className="tiny" title={t("Manage libraries")} onClick={() => openDialog("libraries")}>
          ⋯
        </button>
      </h3>
      <div className="lib-sections">
        {libraries.sections().map((s) => (
          <button key={s} className={libraries.disabledSections.has(s) ? "off" : "on"} title={t("Show or hide this section")} onClick={() => libraries.toggleSection(s)}>
            {t(s)}
          </button>
        ))}
      </div>
      <div className="lib-search">
        <input type="search" placeholder={t("Search nodes (e.g. noise, blur, brick)")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="scroll tree" style={{ flex: 1 }}>
        {results
          ? results.map((it) => (
              <div
                key={it.library + it.tree_item}
                className="tree-row"
                draggable
                onDragStart={(e) => e.dataTransfer.setData(LIB_MIME, JSON.stringify(it))}
                onClick={() => addNode(it)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, item: it });
                }}
                title={tPath(it.tree_item)}
              >
                {it.icon_data && <img src={"data:image/png;base64," + it.icon_data} alt="" />}
                <span>{tPath(it.tree_item).split("/").slice(-2).join(" / ")}</span>
              </div>
            ))
          : tree.children.map((c) => <TreeItem key={c.path} f={c} open={open} toggle={toggle} onMenu={setMenu} />)}
        {results && !results.length && <div className="empty">{t("No node matches")}</div>}
      </div>
      {menu && <ItemContextMenu m={menu} onClose={() => setMenu(null)} />}
      {hierarchy && <Hierarchy />}
    </>
  );
}

export function Hierarchy({ docked = false }: { docked?: boolean } = {}) {
  useEditor();
  useLang();
  const walk = (g: GenGraph, path: string[], depth: number): React.ReactElement[] => {
    const rows: React.ReactElement[] = [];
    for (const c of g.children) {
      if (!(c instanceof GenGraph) || c instanceof GenMaterial) continue;
      const p = [...path, c.name];
      const current = p.join("/") === editor.path.join("/");
      rows.push(
        <div key={p.join("/")} className="tree-row" style={{ paddingLeft: 8 + depth * 12, color: current ? "#fff" : undefined, background: current ? "var(--bg4)" : undefined }} onClick={() => ((editor.path = p), (editor.selection = []), editor.emit())}>
          ▸ {t(c.getTypeName())} <span style={{ color: "var(--text3)" }}>{c.name}</span>
        </div>,
      );
      rows.push(...walk(c, p, depth + 1));
    }
    return rows;
  };
  const rows = walk(editor.root, [], 1);
  return (
    <div className={"hier scroll" + (docked ? " docked" : "")}>
      <h3>{t("Hierarchy")}</h3>
      <div className="tree-row" style={{ color: editor.path.length ? undefined : "#fff" }} onClick={() => editor.goTo(0)}>
        ◆ {editor.title}
      </div>
      {rows}
      {!rows.length && <div style={{ color: "var(--text3)", padding: "2px 12px 8px" }}>{t("No subgraphs")}</div>}
    </div>
  );
}
