/* The graph view: breadcrumbs, toolbar and the canvas (src/ui/graph/*) */
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph/editor.css";
import { editor, useEditor } from "./store";
import { t, useLang } from "./i18n";
import { GraphInner } from "./graph/GraphCanvas";
import { Toolbar } from "./graph/Toolbar";
import { GraphBackground } from "./graph/GraphBackground";

export function GraphView() {
  useEditor();
  useLang();
  const crumbs = ["Material", ...editor.path];
  return (
    <div className={"graph-wrap" + (editor.background !== "none" ? " with-bg" : "")}>
      <GraphBackground />
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span className="sep">›</span>}
            <button disabled={i === crumbs.length - 1} onClick={() => editor.goTo(i)}>
              {i === 0 ? editor.title : c}
            </button>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <Toolbar />
        <label title={t("Show a preview on every node")}>
          <input type="checkbox" checked={editor.allPreviews} onChange={(e) => ((editor.allPreviews = e.target.checked), editor.emit())} /> {t("all previews")}
        </label>
        <span style={{ color: "var(--text3)" }}>{t("{0} nodes · {1} links", editor.graph.children.length, editor.graph.connections.length)}</span>
      </div>
      <ReactFlowProvider>
        <GraphInner />
      </ReactFlowProvider>
    </div>
  );
}

// what other modules import from here
export { LIB_MIME, copySelection, pasteData, groupSelection } from "./graph/clipboard";
export { ProjectTabs } from "./graph/ProjectTabs";
