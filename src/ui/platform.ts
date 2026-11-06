/* The desktop app's bridge (electron/preload.cjs), when the page runs inside it. In a browser `host` is undefined and
 * every caller keeps its browser behaviour (downloads, file inputs, the File System Access API). */

export interface HostFile {
  name: string;
  path: string;
  data: Uint8Array;
}

export interface MaterialProHost {
  platform: string;
  open(opts?: { multiple?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<HostFile[] | null>;
  save(data: Uint8Array, name: string, path?: string | null): Promise<string | null>;
  pickSave(name: string): Promise<string | null>;
  write(path: string, data: Uint8Array): Promise<boolean>;
  recent(): Promise<string[]>;
  pathForFile(file: File): string | null;
  setDocument(path: string | null, edited: boolean): void;
  onMenu(cb: (action: string, arg?: unknown) => void): () => void;
  onOpenFiles(cb: (files: HostFile[]) => void): () => void;
}

export const host: MaterialProHost | undefined = typeof window !== "undefined" ? (window as unknown as { materialPro?: MaterialProHost }).materialPro : undefined;

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** where each open project is saved, so Save writes it in place (keyed by the project's root graph) */
const projectPaths = new WeakMap<object, string>();
export const projectPath = (root: object) => projectPaths.get(root) ?? null;
export function setProjectPath(root: object, path: string | null) {
  if (path) projectPaths.set(root, path);
  else projectPaths.delete(root);
}

/** A save picker that writes through the host, shaped like the File System Access API's showSaveFilePicker
 *  (what Auto Export uses in browsers). */
export function hostSavePicker() {
  if (!host) return undefined;
  const h = host;
  return async (opts: { suggestedName?: string }) => {
    const path = await h.pickSave(opts.suggestedName ?? "export.png");
    if (!path) throw new DOMException("The user aborted a request.", "AbortError");
    return {
      name: fileName(path),
      async createWritable() {
        const parts: Blob[] = [];
        return {
          async write(d: Blob) {
            parts.push(d);
          },
          async close() {
            await h.write(path, new Uint8Array(await new Blob(parts).arrayBuffer()));
          },
        };
      },
    };
  };
}

/** carries out an Edit menu command: in a text field the field's own, elsewhere the editor's keyboard shortcut */
export function editCommand(action: string): void {
  const el = document.activeElement as HTMLElement | null;
  const editable = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const native: Record<string, string> = { undo: "undo", redo: "redo", cut: "cut", copy: "copy", paste: "paste", selectAll: "selectAll" };
  if (editable) {
    if (native[action]) document.execCommand(native[action]);
    return;
  }
  const keys: Record<string, [string, boolean]> = { undo: ["z", false], redo: ["z", true], cut: ["x", false], copy: ["c", false], paste: ["v", false], duplicate: ["d", false], selectAll: ["a", false], group: ["g", false], find: ["f", false] };
  const k = keys[action];
  if (!k) return;
  const mac = host?.platform === "darwin";
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k[0], code: "Key" + k[0].toUpperCase(), shiftKey: k[1], ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
}
