/* The inspector: the selected node's parameters, info and code (src/ui/inspector/*) */
import { useState } from "react";
import { editor, useEditor } from "./store";
import { t, useLang } from "./i18n";
import { Code } from "./inspector/Code";
import { Params } from "./inspector/Params";
import { Info } from "./inspector/Info";
import { CodeTab } from "./inspector/CodeTab";
import { GraphInfo, GraphParameters } from "./inspector/GraphInfo";

export function Inspector() {
  useEditor();
  useLang();
  const g = editor.selected;
  const [tab, setTab] = useState<"params" | "info" | "code">("params");
  if (!g)
    return (
      <div className="scroll" style={{ flex: 1 }}>
        <GraphParameters graph={editor.graph} />
        <GraphInfo graph={editor.graph} />
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="tabs">
        {(
          [
            ["params", "Parameters"],
            ["info", "Ports & info"],
            ["code", "Code analysis"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {t(l)}
          </button>
        ))}
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {tab === "params" && <Params g={g} />}
        {tab === "info" && <Info g={g} />}
        {tab === "code" && <CodeTab g={g} />}
      </div>
    </div>
  );
}

// what other modules import from here
export { Code } from "./inspector/Code";
export { selectAnywhere } from "./inspector/Info";
