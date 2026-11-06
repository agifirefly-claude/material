/* The dock tree (Material Maker's addons/flexible_layout): panels in tab groups, tab groups in row or column splits,
 * the graph editor as the fixed centre. Pure functions over the tree; the tree is kept in the preferences. */
import type { DockLayout, DockNode, DockPanel, Layout } from "../prefs";

export const ALL_PANELS: DockPanel[] = ["library", "hierarchy", "preview3d", "preview2d", "reference", "inspector"];
export type Side = "left" | "right" | "top" | "bottom" | "center";

const legacyKey = (l: Layout) => [l.left, l.right, l.showLibrary, l.showRight, l.previewHeight].join(",");

/** the default arrangement, from the layout dialog's fields: library and hierarchy on the left, previews over the inspector on the right */
export function defaultDock(l: Layout): DockLayout {
  const w = Math.max(900, typeof window !== "undefined" ? window.innerWidth : 1600);
  const children: DockNode[] = [];
  const sizes: number[] = [];
  const hidden: DockPanel[] = [];
  if (l.showLibrary) {
    children.push({ type: "split", dir: "column", children: [{ type: "tabs", panels: ["library"], active: 0 }, { type: "tabs", panels: ["hierarchy"], active: 0 }], sizes: [72, 28] });
    sizes.push(l.left);
  } else hidden.push("library", "hierarchy");
  children.push({ type: "center" });
  sizes.push(w - (l.showLibrary ? l.left : 0) - (l.showRight ? l.right : 0));
  if (l.showRight) {
    children.push({ type: "split", dir: "column", children: [{ type: "tabs", panels: ["preview3d", "preview2d", "reference"], active: 0 }, { type: "tabs", panels: ["inspector"], active: 0 }], sizes: [l.previewHeight, 100 - l.previewHeight] });
    sizes.push(l.right);
  } else hidden.push("preview3d", "preview2d", "reference", "inspector");
  return { root: { type: "split", dir: "row", children, sizes }, hidden, from: legacyKey(l) };
}

/** the layout's dock, rebuilt when the layout dialog changed what it was made from */
export function dockOf(l: Layout): DockLayout {
  if (l.dock && l.dock.from === legacyKey(l) && valid(l.dock)) return l.dock;
  return defaultDock(l);
}

function valid(d: DockLayout): boolean {
  let centers = 0;
  const seen = new Set<string>();
  const walk = (n: DockNode): boolean => {
    if (n.type === "center") return ++centers === 1;
    if (n.type === "tabs") return n.panels.length > 0 && n.panels.every((p) => ALL_PANELS.includes(p) && !seen.has(p) && seen.add(p));
    return n.children.length > 0 && n.children.length === n.sizes.length && n.children.every(walk);
  };
  return walk(d.root) && centers === 1;
}

const clone = (d: DockLayout): DockLayout => structuredClone(d);

/** removes a panel from wherever it is; empty groups go, and splits of one child become that child */
function removePanel(n: DockNode, p: DockPanel): DockNode | null {
  if (n.type === "center") return n;
  if (n.type === "tabs") {
    const i = n.panels.indexOf(p);
    if (i < 0) return n;
    const panels = n.panels.filter((x) => x !== p);
    if (!panels.length) return null;
    return { ...n, panels, active: Math.min(n.active > i ? n.active - 1 : n.active, panels.length - 1) };
  }
  const children: DockNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c, i) => {
    const r = removePanel(c, p);
    if (r) {
      children.push(r);
      sizes.push(n.sizes[i]);
    }
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return { ...n, children, sizes };
}

/** the node at a path of child indexes */
export function nodeAt(root: DockNode, path: number[]): DockNode {
  let n = root;
  for (const i of path) if (n.type === "split") n = n.children[i];
  return n;
}

function replaceAt(root: DockNode, path: number[], f: (n: DockNode) => DockNode): DockNode {
  if (!path.length) return f(root);
  if (root.type !== "split") return root;
  const [i, ...rest] = path;
  const children = root.children.slice();
  children[i] = replaceAt(children[i], rest, f);
  return { ...root, children };
}

/** splits of the same direction nested in each other become one */
function flatten(n: DockNode): DockNode {
  if (n.type !== "split") return n;
  const children: DockNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c0, i) => {
    const c = flatten(c0);
    if (c.type === "split" && c.dir === n.dir) {
      const total = c.sizes.reduce((a, b) => a + b, 0) || 1;
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push((n.sizes[i] * c.sizes[j]) / total);
      });
    } else {
      children.push(c);
      sizes.push(n.sizes[i]);
    }
  });
  return { ...n, children, sizes };
}

/** a node's path, found by identity */
export function pathOf(root: DockNode, target: DockNode, path: number[] = []): number[] | null {
  if (root === target) return path;
  if (root.type !== "split") return null;
  for (let i = 0; i < root.children.length; i++) {
    const r = pathOf(root.children[i], target, [...path, i]);
    if (r) return r;
  }
  return null;
}

/** docks a panel against the node at `path`: beside it (left/right/top/bottom) or into its tab group (center) */
export function dockPanel(d: DockLayout, panel: DockPanel, path: number[], side: Side): DockLayout {
  const out = clone(d);
  // mark the target, then take the panel out (paths change when groups disappear)
  const target = nodeAt(out.root, path);
  const marker = target as DockNode & { __target?: boolean };
  marker.__target = true;
  if (target.type === "tabs" && side === "center" && target.panels.includes(panel)) return d;
  if (target.type === "tabs" && target.panels.length === 1 && target.panels[0] === panel) return d;
  out.root = removePanel(out.root, panel) ?? { type: "center" };
  out.hidden = out.hidden.filter((p) => p !== panel);
  const find = (n: DockNode, p: number[] = []): number[] | null => {
    if ((n as { __target?: boolean }).__target) return p;
    if (n.type !== "split") return null;
    for (let i = 0; i < n.children.length; i++) {
      const r = find(n.children[i], [...p, i]);
      if (r) return r;
    }
    return null;
  };
  const at = find(out.root);
  delete marker.__target;
  if (!at) return d;
  out.root = replaceAt(out.root, at, (n) => {
    const clean = { ...n } as DockNode & { __target?: boolean };
    delete clean.__target;
    if (side === "center" && clean.type === "tabs") return { ...clean, panels: [...clean.panels, panel], active: clean.panels.length };
    const group: DockNode = { type: "tabs", panels: [panel], active: 0 };
    const dir = side === "left" || side === "right" ? "row" : "column";
    const first = side === "left" || side === "top";
    // beside the graph, a panel takes about a quarter of the room
    const own = clean.type === "center" ? 25 : 50;
    return { type: "split", dir, children: first ? [group, clean] : [clean, group], sizes: first ? [own, 100 - own] : [100 - own, own] };
  });
  out.root = flatten(out.root);
  return out;
}

export function closePanel(d: DockLayout, panel: DockPanel): DockLayout {
  const out = clone(d);
  out.root = removePanel(out.root, panel) ?? { type: "center" };
  if (!out.hidden.includes(panel)) out.hidden.push(panel);
  return out;
}

/** shows a closed panel again, in the biggest tab group (or right of the graph when there is none) */
export function showPanel(d: DockLayout, panel: DockPanel): DockLayout {
  let best: { path: number[]; n: number } | null = null;
  const walk = (n: DockNode, p: number[]) => {
    if (n.type === "tabs" && (!best || n.panels.length > best.n)) best = { path: p, n: n.panels.length };
    if (n.type === "split") n.children.forEach((c, i) => walk(c, [...p, i]));
  };
  walk(d.root, []);
  if (best) return dockPanel(d, panel, (best as { path: number[] }).path, "center");
  const centerPath = findCenter(d.root) ?? [];
  return dockPanel(d, panel, centerPath, "right");
}

export function findCenter(n: DockNode, p: number[] = []): number[] | null {
  if (n.type === "center") return p;
  if (n.type !== "split") return null;
  for (let i = 0; i < n.children.length; i++) {
    const r = findCenter(n.children[i], [...p, i]);
    if (r) return r;
  }
  return null;
}

export function setSizes(d: DockLayout, path: number[], sizes: number[]): DockLayout {
  const out = clone(d);
  out.root = replaceAt(out.root, path, (n) => (n.type === "split" ? { ...n, sizes } : n));
  return out;
}

export function setActive(d: DockLayout, path: number[], active: number): DockLayout {
  const out = clone(d);
  out.root = replaceAt(out.root, path, (n) => (n.type === "tabs" ? { ...n, active } : n));
  return out;
}

/** which panels are on screen (the active tab of each group) */
export function visiblePanels(n: DockNode, out = new Set<DockPanel>()): Set<DockPanel> {
  if (n.type === "tabs") out.add(n.panels[n.active] ?? n.panels[0]);
  else if (n.type === "split") n.children.forEach((c) => visiblePanels(c, out));
  return out;
}
