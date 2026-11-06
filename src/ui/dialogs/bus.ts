/* Opening dialogs from anywhere: the host (DialogHost) listens and shows them. */
export type DialogKind = "edit-node" | "add-to-library" | "preferences" | "about" | "layouts" | "libraries";

export function openDialog(kind: DialogKind, payload?: unknown): void {
  window.dispatchEvent(new CustomEvent("mm-dialog", { detail: { kind, payload } }));
}
