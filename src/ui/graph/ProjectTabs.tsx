/* The open projects, as Material Maker's project tabs: material projects and paint projects */
import { editor, useEditor } from "../store";
import { t } from "../i18n";
import { newProject } from "../../engine/loader";

/** the open projects, as Material Maker's project tabs: material projects and paint projects */
export function ProjectTabs() {
  useEditor();
  const tabs = editor.projects;
  // the app's grid has a row for the tabs: keep it, empty, with a single project
  if (tabs.length < 2) return <div />;
  return (
    <div className="project-tabs">
      {tabs.map((p, i) => (
        <div key={i} className={"project-tab" + (p.current ? " on" : "")} onClick={() => editor.switchProject(i)} onAuxClick={(e) => e.button === 1 && closeTab(i)} title={p.title}>
          <span>
            {p.data ? "🖌 " : ""}
            {p.title}
          </span>
          <button
            title={t("Close")}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(i);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
function closeTab(i: number) {
  if (!editor.confirmClose(i, t("Discard the changes to the current project?"))) return;
  editor.closeProject(i, () => newProject());
}
