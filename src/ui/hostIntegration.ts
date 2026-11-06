/* The desktop app (electron/): the native menu's commands, files opened from Finder, the open dialog or Open Recent,
 * and the window's document (title bar file and unsaved-changes dot). Does nothing in a browser. */
import { useEffect, useRef } from "react";
import { editor } from "./store";
import { markSaved, parseProject, projectText, savedVersionOf } from "./exporting";
import { paint } from "./paint/paintStore";
import { editCommand, host, projectPath, setProjectPath, type HostFile } from "./platform";
import { t } from "./i18n";

const PROJECT = /\.(ptex|json|mmg)$/i;
const PAINT = /\.(mmpp|zip)$/i;

/** opens files given by the host: material projects in tabs, a paint project with the files beside it */
export async function openHostFiles(files: HostFile[]) {
  const main = files.find((f) => PROJECT.test(f.name) || PAINT.test(f.name));
  if (!main) return;
  try {
    if (PAINT.test(main.name)) {
      await paint.load(files.map((f) => ({ name: f.name, data: f.data })));
      return;
    }
    for (const f of files.filter((x) => PROJECT.test(x.name))) {
      const data = parseProject(new TextDecoder().decode(f.data));
      if (!data.nodes) {
        editor.setStatus(t("{0} is not a Material Maker project", f.name));
        continue;
      }
      editor.open(data, f.name.replace(PROJECT, ""));
      setProjectPath(editor.root, f.path);
      markSaved(editor.root, projectText());
    }
  } catch (e) {
    editor.setStatus(t("Cannot open: {0}", e));
  }
}

export interface HostHandlers {
  [action: string]: (() => void) | undefined;
}

/** listens to the host while the app is mounted; `handlers` maps menu actions to what the page does */
export function useHostIntegration(handlers: HostHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!host) return;
    const offMenu = host.onMenu((action) => {
      const h = ref.current[action];
      if (h) h();
      else editCommand(action);
    });
    const offFiles = host.onOpenFiles((files) => void openHostFiles(files));
    const onPicked = (e: Event) => void openHostFiles((e as CustomEvent<HostFile[]>).detail);
    window.addEventListener("mp-open-files", onPicked);
    // the title bar follows the current project and whether it changed since it was opened or saved
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      timer = null;
      const p = paint.project;
      if (p) return host!.setDocument(null, !!p.needSave);
      const saved = savedVersionOf(editor.root);
      host!.setDocument(projectPath(editor.root), saved === undefined ? editor.canUndo : saved !== projectText());
    };
    const unsub = editor.subscribe(() => {
      if (!timer) timer = setTimeout(update, 400);
    });
    update();
    return () => {
      offMenu();
      offFiles();
      window.removeEventListener("mp-open-files", onPicked);
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
