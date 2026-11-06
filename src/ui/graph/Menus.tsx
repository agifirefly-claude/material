/* The context menus of a node and of a link */
import { type Node } from "@xyflow/react";
import { editor } from "../store";
import { portLabel } from "../NodeView";
import { GenComment, GenCommentLine, GenGraph, type Connection } from "../../engine/gen/graph";
import type { Gen } from "../../engine/gen/base";
import { GenMaterial } from "../../engine/gen/misc";
import { GenShader } from "../../engine/gen/shader";
import * as act from "./actions";
import { openDialog } from "../dialogs/bus";
import { t, tDesc } from "../i18n";
import { copySelection, pasteData, groupSelection } from "./clipboard";

export function NodeMenu({ x, y, gen, onClose }: { x: number; y: number; gen: Gen; onClose: () => void }) {
  const g = editor.graph;
  const outs = gen.getOutputDefs();
  const ins = gen.getInputDefs();
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  const isSub = gen instanceof GenGraph && !(gen instanceof GenMaterial);
  return (
    <div className="menu-list" style={{ position: "fixed", left: x, top: Math.min(y, window.innerHeight - 520), maxHeight: "80vh" }} onMouseLeave={onClose}>
      {isSub && <button onClick={run(() => editor.enter(gen.name))}>{t("Open subgraph")}</button>}
      {(gen instanceof GenShader || isSub) && <button onClick={run(() => openDialog("edit-node", gen))}>{gen instanceof GenMaterial ? t("Edit material…") : isSub ? t("Edit graph…") : t("Edit node…")}{" "}{t("(Ctrl+E)")}</button>}
      {(gen instanceof GenShader || isSub) && gen.isTemplate() && <button onClick={run(() => (gen.toggleEditable(), gen.changed()))}>{t("Make editable (detach from the library)")}</button>}
      {outs.length > 1 &&
        outs.map((o, i) => (
          <button key={i} onClick={run(() => ((gen.preview = i), editor.emit()))}>
            {t("Preview output {0}", i)}
            {o.shortdesc ? ` — ${tDesc(o.shortdesc)}` : ""}
          </button>
        ))}
      {outs.length > 0 && (
        <button
          onClick={run(() => {
            if (editor.allPreviews) gen.extra.hidePreview = !gen.extra.hidePreview;
            else gen.preview = gen.preview >= 0 ? -1 : 0;
            editor.emit();
          })}
        >
          {(editor.allPreviews ? !gen.extra.hidePreview : gen.preview >= 0) ? t("Hide preview") : t("Show preview")}
        </button>
      )}
      <button onClick={run(() => ((gen.minimized = !gen.minimized), editor.emit()))}>{gen.minimized ? t("Show parameters") : t("Hide parameters")}</button>
      {gen.hasRandomness() && <button onClick={run(() => gen.setSeed(Math.random()))}>{t("New random seed")}</button>}
      {gen.hasRandomness() && <button onClick={run(() => ((gen.seedLocked = !gen.seedLocked), gen.changed()))}>{gen.seedLocked ? t("Unlock seed") : t("Lock seed")}</button>}
      <button
        onClick={run(() => {
          const n = prompt(t("Node name"), gen.name);
          if (n && !g.renameGenerator(gen, n)) editor.setStatus(t("That name is taken or not valid"));
        })}
      >
        {t("Rename…")}
      </button>
      {ins.length > 1 && <button onClick={run(() => (editor.select([gen.name]), act.swapInputs()))}>{t("Swap inputs")}{" "}{t("(Alt+S)")}</button>}
      {ins.map((p, i) => (
        <button key={"r" + i} onClick={run(() => act.toggleRerouteOnInput(gen, i))}>
          {t("Reroute input")} “{portLabel(p, i, false)}”
        </button>
      ))}
      <hr />
      <button
        onClick={run(() => {
          editor.select([gen.name]);
          const d = copySelection();
          if (d) pasteData(d);
        })}
      >
        {t("Duplicate")}
      </button>
      <button onClick={run(() => act.duplicateWithInputs())}>{t("Duplicate with inputs")}{" "}{t("(Ctrl+Shift+D)")}</button>
      <button onClick={run(() => groupSelection())}>{t("Group selection into subgraph")}</button>
      {isSub && <button onClick={run(() => (editor.select([gen.name]), act.expandSelectedSubgraph()))}>{t("Expand subgraph into this graph")}</button>}
      {!(gen instanceof GenComment || gen instanceof GenCommentLine) && <button onClick={run(() => openDialog("add-to-library", gen))}>{t("Add to a library…")}</button>}
      {gen.canBeDeleted() && <button onClick={run(() => g.removeGenerator(gen))}>{t("Delete")}</button>}
    </div>
  );
}
export function EdgeMenu({ x, y, c, at, onClose }: { x: number; y: number; c: Connection; at: { x: number; y: number }; onClose: () => void }) {
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <div className="menu-list" style={{ position: "fixed", left: x, top: y }} onMouseLeave={onClose}>
      <div className="label">
        {c.from}.{c.from_port} → {c.to}.{c.to_port}
      </div>
      <button onClick={run(() => act.insertRerouteOnLink(c, at))}>{t("Insert a reroute node")}</button>
      <button onClick={run(() => act.linkToPortals(c))}>{t("Replace by portals")}</button>
      <button onClick={run(() => editor.graph.disconnectChildren(c.from, c.from_port, c.to, c.to_port))}>{t("Disconnect")}</button>
    </div>
  );
}
