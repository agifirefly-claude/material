/* Editor state: the project graph, which subgraph is open, what is selected, undo history and the shared renderer. */
import { useSyncExternalStore } from "react";
import { GenGraph } from "../engine/gen/graph";
import type { Gen } from "../engine/gen/base";
import { loadProject } from "../engine/loader";
import { Renderer } from "../engine/render/renderer";
import { UndoHistory } from "./undoHistory";

type Listener = () => void;
interface TabState {
  root: GenGraph;
  path: string[];
  selection: string[];
  title: string;
  history: UndoHistory;
  /** what else the tab holds: a paint project for paint tabs, null for material projects */
  data: unknown;
}

/** what other parts of the editor do with the tabs that hold their data (the paint mode) */
export interface TabHooks {
  /** whether the tab may close, asking the user when needed; undefined when the data is not theirs */
  canClose?(data: unknown): boolean | undefined;
  closed?(data: unknown): void;
}

class Editor {
  root: GenGraph = new GenGraph();
  /** show a preview on every node, rather than only where the file asks for one (Material Maker's behaviour) */
  allPreviews = false;
  /** a preview shown behind the graph (show_background_preview_2d / _3d) */
  background: "none" | "2d" | "3d" = "none";
  /** names of the subgraphs from the root down to the open one */
  path: string[] = [];
  selection: string[] = [];
  title = "untitled";
  renderer: Renderer | null = null;
  version = 0;
  private listeners = new Set<Listener>();
  private history = new UndoHistory();
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  status = "";

  constructor() {
    this.attach();
    this.history.current = this.serialized();
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
  }
  private serialized() {
    return JSON.stringify(this.root.serialize());
  }

  /* ----- project tabs (Material Maker's projects panel) ----- */
  private tabs: TabState[] = [];
  private current = 0;
  /** the current tab's data (a paint project in a paint tab) */
  data: unknown = null;
  private hooks: TabHooks[] = [];
  addTabHooks(h: TabHooks) {
    this.hooks.push(h);
  }
  get currentIndex() {
    return this.tabs.length ? this.current : 0;
  }
  private capture(): TabState {
    if (this.snapshotTimer) this.snapshot();
    return { root: this.root, path: this.path, selection: this.selection, title: this.title, history: this.history, data: this.data };
  }
  private apply(t: TabState) {
    this.data = t.data;
    this.root = t.root;
    this.path = t.path;
    this.selection = t.selection;
    this.title = t.title;
    this.history = t.history;
    this.renderer?.clearCache();
    this.attach();
    // a new tab's history starts from what it opened with
    this.history.current ??= this.serialized();
  }
  /** the open projects, the current one included */
  get projects(): { title: string; current: boolean; data: unknown }[] {
    if (!this.tabs.length) return [{ title: this.title, current: true, data: this.data }];
    return this.tabs.map((t, i) => ({ title: i === this.current ? this.title : t.title, current: i === this.current, data: i === this.current ? this.data : t.data }));
  }
  /** renames a tab (a paint project's title lives with its project) */
  setTabTitle(i: number, title: string) {
    if (!this.tabs.length || i === this.current) this.title = title;
    else this.tabs[i].title = title;
    this.emit();
  }
  /** a project left untouched since it was created can be replaced rather than kept */
  private get pristine() {
    return this.data === null && !this.history.canUndo && !this.snapshotTimer && this.title === "untitled" && this.root.children.length <= 1;
  }
  /** opens a project in a new tab (or in the current one, when that one is an untouched new project) */
  openProject(g: GenGraph, title = "untitled", data: unknown = null) {
    if (!this.tabs.length) this.tabs = [this.capture()];
    if (this.pristine) {
      this.data = data;
      this.setRoot(g, title);
      return;
    }
    this.tabs[this.current] = this.capture();
    this.tabs.push({ root: g, path: [], selection: [], title, history: new UndoHistory(), data });
    this.current = this.tabs.length - 1;
    this.apply(this.tabs[this.current]);
    this.emit();
  }
  switchProject(i: number) {
    if (!this.tabs.length || i === this.current || !this.tabs[i]) return;
    this.tabs[this.current] = this.capture();
    this.current = i;
    this.apply(this.tabs[i]);
    this.emit();
  }
  /** closes a tab; the last one is replaced by a new project */
  closeProject(i: number, replacement: () => GenGraph) {
    if (!this.tabs.length) this.tabs = [this.capture()];
    this.tabs[this.current] = this.capture();
    const [closed] = this.tabs.splice(i, 1);
    if (!this.tabs.length) this.tabs.push({ root: replacement(), path: [], selection: [], title: "untitled", history: new UndoHistory(), data: null });
    if (i < this.current) this.current--;
    this.current = Math.min(this.current, this.tabs.length - 1);
    this.apply(this.tabs[this.current]);
    if (closed?.data) for (const h of this.hooks) h.closed?.(closed.data);
    this.emit();
  }
  hasChanges(i: number): boolean {
    const t = i === this.current || !this.tabs.length ? this.capture() : this.tabs[i];
    return !!t && t.history.canUndo;
  }
  /** whether tab i may close: its data's owner decides, otherwise the user is asked about unsaved changes */
  confirmClose(i: number, question: string): boolean {
    const data = this.projects[i]?.data;
    if (data) {
      for (const h of this.hooks) {
        const r = h.canClose?.(data);
        if (r !== undefined) return r;
      }
      return true;
    }
    return !this.hasChanges(i) || confirm(question);
  }

  setRoot(g: GenGraph, title = "untitled") {
    this.root = g;
    this.path = [];
    this.selection = [];
    this.title = title;
    this.renderer?.clearCache();
    this.attach();
    this.history = new UndoHistory(this.serialized());
    this.emit();
  }

  load(data: Record<string, unknown>, title: string) {
    this.setRoot(loadProject(data), title);
  }
  /** opens file data in a new tab */
  open(data: Record<string, unknown>, title: string) {
    this.openProject(loadProject(data), title);
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
  /** Changes are recorded 350 ms after the last one, so a drag or a run of keystrokes is one step. A new user
   * action (a pointer press, or a key outside a text field) closes the pending step first, so two actions done
   * quickly one after the other (paste then duplicate) stay two steps. */
  private boundaryListening = false;
  private listenForActionBoundaries() {
    if (this.boundaryListening || typeof window === "undefined") return;
    this.boundaryListening = true;
    const close = (e: Event) => {
      if (!this.snapshotTimer) return;
      const el = e.target as HTMLElement | null;
      if (e.type === "keydown" && el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      clearTimeout(this.snapshotTimer);
      this.snapshot();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
  }
  private scheduleSnapshot() {
    this.listenForActionBoundaries();
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.snapshot(), 350);
  }
  snapshot() {
    this.snapshotTimer = null;
    this.history.record(this.serialized());
  }
  private restore(s: string) {
    const path = this.path;
    const sel = this.selection;
    this.root = loadProject(JSON.parse(s));
    this.attach();
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
    const s = this.history.undo();
    if (s !== undefined) this.restore(s);
  }
  redo() {
    const s = this.history.redo();
    if (s !== undefined) this.restore(s);
  }
  get canUndo() {
    return this.history.canUndo || this.snapshotTimer !== null;
  }
  get canRedo() {
    return this.history.canRedo;
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
