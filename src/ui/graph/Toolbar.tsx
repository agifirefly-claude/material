/* The graph toolbar: select, align, find */
import { useState } from "react";
import { editor } from "../store";
import * as act from "./actions";
import { t } from "../i18n";
import { portY } from "./GraphCanvas";

export function Toolbar() {
  const [open, setOpen] = useState<"" | "select" | "align">("");
  const g = editor.graph;
  const sub = g !== editor.root;
  const close = (f: () => void) => () => {
    f();
    setOpen("");
  };
  return (
    <>
      <div className="menu">
        <button onClick={() => setOpen(open === "select" ? "" : "select")}>{t("Select")} ▾</button>
        {open === "select" && (
          <div className="menu-list" onMouseLeave={() => setOpen("")}>
            <button onClick={close(act.selectAll)}>{t("Select all")}{" "}{t("(Ctrl+A)")}</button>
            <button onClick={close(act.selectNone)}>{t("Select none")}{" "}{t("(Ctrl+Shift+A)")}</button>
            <button onClick={close(act.selectInvert)}>{t("Invert selection")}{" "}{t("(Ctrl+I)")}</button>
            <hr />
            <button onClick={close(act.minimizeSelection)}>{t("Minimize / restore selection")}{" "}{t("(Ctrl+M)")}</button>
            <button onClick={close(() => act.addComment())}>{t("Add a comment around the selection")}</button>
          </div>
        )}
      </div>
      <div className="menu">
        <button onClick={() => setOpen(open === "align" ? "" : "align")} disabled={editor.selection.length < 2}>
          {t("Align")} ▾
        </button>
        {open === "align" && (
          <div className="menu-list" onMouseLeave={() => setOpen("")}>
            <button onClick={close(act.alignStart)}>{t("Align start")}</button>
            <button onClick={close(act.alignCenter)}>{t("Align center")}</button>
            <button onClick={close(act.alignEnd)}>{t("Align end")}</button>
            <button onClick={close(act.alignTop)}>{t("Align top")}</button>
            <button onClick={close(() => act.straightenConnections(portY))}>{t("Straighten connections")}</button>
          </div>
        )}
      </div>
      <button onClick={() => window.dispatchEvent(new Event("mm-find-node"))} title={t("Ctrl+F")}>
        {t("Find")}
      </button>
      {sub && (
        <label title={t("The nodes of this subgraph add the graph's seed to theirs")}>
          <input type="checkbox" checked={g.transmitsSeed} onChange={(e) => ((g.transmitsSeed = e.target.checked), g.changed())} /> {t("transmit seed")}
        </label>
      )}
      {sub && (
        <button
          title={t("Copy this subgraph to every subgraph with the same name")}
          onClick={() => {
            const n = act.propagateChanges();
            editor.setStatus(t("Changes propagated to {0} subgraphs", n));
          }}
        >
          {t("Propagate")}
        </button>
      )}
    </>
  );
}
