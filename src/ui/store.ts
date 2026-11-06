/* Editor state: the project graph, which subgraph is open, what is selected, undo history and the shared renderer. */
import { useSyncExternalStore } from "react";
import { GenGraph } from "../engine/gen/graph";
import type { Gen } from "../engine/gen/base";
import { loadProject } from "../engine/loader";
import { Renderer } from "../engine/render/renderer";

type Listener = () => void;

class Editor {
  root: GenGraph = new GenGraph();
  /** show a preview on every node, rather than only where the file asks for one (Material Maker's behaviour) */
  allPreviews = false;
  /** names of the subgraphs from the root down to the open one */
  path: string[] = [];
  selection: string[] = [];
  title = "untitled";
  renderer: Renderer | null = null;
  version = 0;
  private listeners = new Set<Listener>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot = "";
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  status = "";

  constructor() {
    this.attach();
  }

  get graph(): GenGraph {
    let g: GenGraph = this.root;
    for (const n of this.path) {
      const c = g.getNode(n);
      if (c instanceof GenGraph) g = c;
      else break;
    }
    return g;
  }

  get selected(): Gen | undefined {
    return this.selection.length ? this.graph.getNode(this.selection[this.selection.length - 1]) : undefined;
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version;
  emit = () => {
    this.version++;
    for (const l of this.listeners) l();
  };

  private attach() {
    this.unsubscribe?.();
    this.unsubscribe = this.root.onChange(() => {
      this.emit();
      this.scheduleSnapshot();
    });
    this.lastSnapshot = JSON.stringify(this.root.serialize());
  }

  setRoot(g: GenGraph, title = "untitled") {
    this.root = g;
    this.path = [];
    this.selection = [];
    this.title = title;
    this.undoStack = [];
    this.redoStack = [];
    this.renderer?.clearCache();
    this.attach();
    this.emit();
  }

  load(data: Record<string, unknown>, title: string) {
    this.setRoot(loadProject(data), title);
  }

  enter(name: string) {
    const g = this.graph.getNode(name);
    if (g instanceof GenGraph) {
      this.path = [...this.path, name];
      this.selection = [];
      this.emit();
    }
  }
  goTo(depth: number) {
    this.path = this.path.slice(0, depth);
    this.selection = [];
    this.emit();
  }
  select(names: string[]) {
    if (names.join() === this.selection.join()) return;
    this.selection = names;
    this.emit();
  }

  /* ----- undo ----- */
  private scheduleSnapshot() {
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.snapshot(), 350);
  }
  snapshot() {
    this.snapshotTimer = null;
    const s = JSON.stringify(this.root.serialize());
    if (s === this.lastSnapshot) return;
    this.undoStack.push(this.lastSnapshot);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnapshot = s;
  }
  private restore(s: string) {
    const path = this.path;
    const sel = this.selection;
    this.root = loadProject(JSON.parse(s));
    this.attach();
    this.lastSnapshot = s;
    this.path = [];
    for (const n of path) {
      if (this.graph.getNode(n) instanceof GenGraph) this.path.push(n);
      else break;
    }
    this.selection = sel.filter((n) => this.graph.getNode(n));
    this.emit();
  }
  undo() {
    if (this.snapshotTimer) this.snapshot();
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(this.lastSnapshot);
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.lastSnapshot);
    this.restore(s);
  }
  get canUndo() {
    return this.undoStack.length > 0 || this.snapshotTimer !== null;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  setStatus(s: string) {
    this.status = s;
    this.emit();
  }
}

export const editor = new Editor();
// handy from the browser console
(globalThis as unknown as { mmEditor: Editor }).mmEditor = editor;

/** re-renders the component whenever the editor changes */
export function useEditor(): number {
  return useSyncExternalStore(editor.subscribe, editor.getVersion);
}
