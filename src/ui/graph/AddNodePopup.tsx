/* The add-node popup (material_maker/windows/add_node_popup): search the libraries, most used first, a bar of quick
 * buttons, and, when opened by dropping a link on empty space, only the nodes that can take that link. */
import { useMemo, useState, useSyncExternalStore } from "react";
import type { LibraryItem } from "../../engine/registry";
import { libraries } from "../library/manager";
import { quickConnectPort, type QuickConnect } from "./create";
import { t, tPath, useLang } from "../i18n";

export function AddNodePopup({ x, y, qc, onPick, onClose }: { x: number; y: number; qc: QuickConnect | null; onPick: (i: LibraryItem) => void; onClose: () => void }) {
  useLang();
  useSyncExternalStore(libraries.subscribe, libraries.getVersion);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = useMemo(() => {
    let r = libraries.search(q, true, t);
    if (qc) r = r.filter((it) => quickConnectPort(it, qc) >= 0);
    return r.slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, qc, libraries.version]);
  const quick = libraries.quick.map((ti) => libraries.items().find((i) => i.tree_item === ti));
  return (
    <div className="menu-list add-popup" style={{ position: "fixed", left: Math.min(x, window.innerWidth - 320), top: Math.min(y, window.innerHeight - 420), width: 310 }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="quick-bar">
        {quick.map((it, i) => {
          const ok = !!it && (!qc || quickConnectPort(it, qc) >= 0);
          return (
            <button key={i} disabled={!ok} title={it ? tPath(it.tree_item) : t("Empty quick button")} onMouseDown={() => ok && it && onPick(it)}>
              {it?.icon_data ? <img src={"data:image/png;base64," + it.icon_data} alt="" /> : <span>{it ? t(it.display_name ?? "") : "·"}</span>}
            </button>
          );
        })}
      </div>
      <input
        autoFocus
        type="search"
        placeholder={qc ? t("Add a node that connects here…") : t("Add a node…")}
        value={q}
        style={{ width: "100%", marginBottom: 4 }}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onBlur={() => setTimeout(onClose, 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") setSel((s) => Math.min(results.length - 1, s + 1));
          if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
          if (e.key === "Enter" && results[sel]) onPick(results[sel]);
        }}
      />
      <div style={{ maxHeight: 320, overflow: "auto" }}>
        {results.map((it, i) => (
          <div key={it.library + it.tree_item} className="add-row" style={{ background: i === sel ? "var(--bg4)" : undefined }}>
            <button onMouseDown={() => onPick(it)} style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }} title={it.tree_item}>
              {it.icon_data && <img src={"data:image/png;base64," + it.icon_data} alt="" style={{ width: 28, height: 14, objectFit: "cover" }} />}
              {tPath(it.tree_item)}
            </button>
            <button
              className="pin"
              title={t("Put in the quick bar")}
              onMouseDown={(e) => {
                e.preventDefault();
                const free = libraries.quick.findIndex((x) => !libraries.items().some((i2) => i2.tree_item === x));
                libraries.setQuick(free >= 0 ? free : Math.min(libraries.quick.length, 7), it.tree_item);
              }}
            >
              ☆
            </button>
          </div>
        ))}
      </div>
      {!results.length && <div className="label">{t("No node matches")}</div>}
    </div>
  );
}
