/* Graph editing commands, ported from material_maker/panels/graph_edit/graph_edit.gd. They act on the open graph and
 * the selection; the editor's change listener records each one for undo. */
import { editor } from "../store";
import { GenComment, GenGraph, GenPortal, GenReroute, type Connection } from "../../engine/gen/graph";
import { GenMaterial } from "../../engine/gen/misc";
import type { Gen } from "../../engine/gen/base";
import { registry } from "../../engine/registry";
import { getPrefs } from "../prefs";

export type Size = { width: number; height: number };
/** measured node sizes, kept up to date by the graph view */
export const nodeSizes = new Map<string, Size>();
const sizeOf = (g: Gen): Size => nodeSizes.get(g.name) ?? { width: 180, height: 120 };

export function selectedGens(): Gen[] {
  const g = editor.graph;
  return editor.selection.map((n) => g.getNode(n)).filter((x): x is Gen => !!x);
}

function moved() {
  editor.graph.notifyChanged();
}

/* ---------- selection ---------- */
export function selectAll() {
  editor.select(editor.graph.children.map((c) => c.name));
}
export function selectNone() {
  editor.select([]);
}
export function selectInvert() {
  const sel = new Set(editor.selection);
  editor.select(editor.graph.children.filter((c) => !sel.has(c.name)).map((c) => c.name));
}

/* ---------- alignment (align_start, align_end, align_top, straighten_connections) ---------- */
export function alignStart() {
  const nodes = selectedGens();
  const x = Math.min(...nodes.map((n) => n.position.x));
  for (const n of nodes) n.position = { ...n.position, x };
  moved();
}
export function alignCenter() {
  const nodes = selectedGens();
  if (!nodes.length) return;
  const c = nodes.reduce((a, n) => a + n.position.x + sizeOf(n).width / 2, 0) / nodes.length;
  for (const n of nodes) n.position = { ...n.position, x: c - sizeOf(n).width / 2 };
  moved();
}
export function alignEnd() {
  const nodes = selectedGens();
  const x = Math.max(...nodes.map((n) => n.position.x + sizeOf(n).width));
  for (const n of nodes) n.position = { ...n.position, x: x - sizeOf(n).width };
  moved();
}
export function alignTop() {
  const nodes = selectedGens().sort((a, b) => a.position.x - b.position.x);
  if (!nodes.length) return;
  for (const n of nodes) n.position = { ...n.position, y: nodes[0].position.y };
  moved();
}
/** lines nodes up so the links between consecutive ones are horizontal */
export function straightenConnections(portY: (g: Gen, port: number, output: boolean) => number) {
  const nodes = selectedGens().sort((a, b) => a.position.x - b.position.x);
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i],
      to = nodes[i + 1];
    const c = editor.graph.connections.find((x) => x.from === from.name && x.to === to.name);
    if (!c) continue;
    const dy = to.position.y + portY(to, c.to_port, false) - (from.position.y + portY(from, c.from_port, true));
    to.position = { ...to.position, y: to.position.y - dy };
  }
  moved();
}

/* ---------- ports ---------- */
/** swap_node_inputs: exchanges the two links into the selected node, or moves its only link to the next compatible input */
export function swapInputs() {
  const nodes = selectedGens();
  if (nodes.length !== 1) return;
  const node = nodes[0];
  const g = editor.graph;
  const inputs = node.getInputDefs();
  const links = g.connections.filter((c) => c.to === node.name);
  const slot = (p: number) => registry.ioTypes[inputs[p]?.type]?.slot_type;
  if (links.length === 2) {
    const [a, b] = links;
    if (a.from === b.from && a.from_port === b.from_port) return;
    if (inputs[a.to_port]?.type !== inputs[b.to_port]?.type) return;
    g.connections = g.connections.filter((c) => c !== a && c !== b);
    g.connections.push({ ...a, to_port: b.to_port }, { ...b, to_port: a.to_port });
    g.notifyChanged(node);
  } else if (links.length === 1) {
    const l = links[0];
    const compatible = inputs.map((_, i) => i).filter((i) => slot(i) === slot(l.to_port));
    const next = compatible[(compatible.indexOf(l.to_port) + 1) % compatible.length];
    g.connections = g.connections.filter((c) => c !== l);
    g.connections.push({ ...l, to_port: next });
    g.notifyChanged(node);
  }
}

/** add_reroute_to_input: puts a reroute node on a link, or removes the one that is there */
export function toggleRerouteOnInput(node: Gen, port: number) {
  const g = editor.graph;
  const link = g.connections.find((c) => c.to === node.name && c.to_port === port);
  const from = link && g.getNode(link.from);
  if (from instanceof GenReroute) {
    const src = g.connections.find((c) => c.to === from.name);
    const outs = g.connections.filter((c) => c.from === from.name);
    g.connections = g.connections.filter((c) => c.to !== from.name && c.from !== from.name);
    g.children = g.children.filter((c) => c !== from);
    from.parent = null;
    if (src) for (const o of outs) g.connections.push({ from: src.from, from_port: src.from_port, to: o.to, to_port: o.to_port });
    g.notifyChanged();
    return;
  }
  const r = new GenReroute();
  r.name = "reroute";
  r.position = { x: node.position.x - 74, y: node.position.y + 30 + port * 18 };
  g.addGenerator(r);
  if (link) {
    g.connections = g.connections.filter((c) => c !== link);
    g.connections.push({ from: link.from, from_port: link.from_port, to: r.name, to_port: 0 });
  }
  g.connections.push({ from: r.name, from_port: 0, to: node.name, to_port: port });
  g.notifyChanged();
}

/** a reroute in the middle of a link */
export function insertRerouteOnLink(c: Connection, at: { x: number; y: number }) {
  const g = editor.graph;
  const r = new GenReroute();
  r.name = "reroute";
  r.position = { x: at.x - 8, y: at.y - 8 };
  g.addGenerator(r);
  g.connections = g.connections.filter((x) => !(x.from === c.from && x.from_port === c.from_port && x.to === c.to && x.to_port === c.to_port));
  g.connections.push({ from: c.from, from_port: c.from_port, to: r.name, to_port: 0 }, { from: r.name, from_port: 0, to: c.to, to_port: c.to_port });
  g.notifyChanged();
}

/** create_portals: replaces a link by a pair of portals */
export function linkToPortals(c: Connection) {
  const g = editor.graph;
  const from = g.getNode(c.from),
    to = g.getNode(c.to);
  if (!from || !to) return;
  let i = 1;
  const used = new Set(g.children.filter((x) => x instanceof GenPortal).map((x) => String(x.parameters.link)));
  while (used.has("aperture_" + i)) i++;
  const link = "aperture_" + i;
  const pin = new GenPortal();
  pin.name = "portal";
  pin.io = 0;
  pin.portType = from.getOutputDefs()[c.from_port]?.type ?? "any";
  pin.position = { x: from.position.x + sizeOf(from).width + 50, y: from.position.y };
  pin.parameters.link = link;
  g.addGenerator(pin);
  const pout = new GenPortal();
  pout.name = "portal";
  pout.io = 1;
  pout.portType = pin.portType;
  pout.position = { x: to.position.x - 120, y: to.position.y };
  pout.parameters.link = link;
  g.addGenerator(pout);
  g.connections = g.connections.filter((x) => !(x.from === c.from && x.from_port === c.from_port && x.to === c.to && x.to_port === c.to_port));
  g.connections.push({ from: c.from, from_port: c.from_port, to: pin.name, to_port: 0 }, { from: pout.name, from_port: 0, to: c.to, to_port: c.to_port });
  g.notifyChanged();
}

/* ---------- nodes ---------- */
export function minimizeSelection() {
  const nodes = selectedGens();
  const v = !nodes.every((n) => n.minimized);
  for (const n of nodes) n.minimized = v;
  editor.emit();
}

/** duplicate_selected_with_inputs: the copies keep the links coming into the selection from outside */
export function duplicateWithInputs() {
  const g = editor.graph;
  const names = new Set(editor.selection);
  const gens = selectedGens().filter((c) => !(c instanceof GenMaterial) && c.name !== "gen_inputs" && c.name !== "gen_outputs");
  if (!gens.length) return;
  const nodes = gens.map((c) => c.serialize());
  const r = g.addToGraph(nodes, g.connections.filter((c) => names.has(c.from) && names.has(c.to)), { x: 40, y: 40 });
  const map = new Map(gens.map((c, i) => [c.name, r.generators[i]?.name]));
  for (const c of g.connections.filter((x) => names.has(x.to) && !names.has(x.from))) {
    const to = map.get(c.to);
    if (to) g.connections.push({ ...c, to });
  }
  g.notifyChanged();
  editor.select(r.generators.map((x) => x.name));
}

/** a comment framing the selection (auto_size_comment), or at a position */
export function addComment(at?: { x: number; y: number }) {
  const g = editor.graph;
  const c = new GenComment();
  c.name = "comment";
  const nodes = selectedGens();
  if (nodes.length && getPrefs().autoSizeComment) {
    const x0 = Math.min(...nodes.map((n) => n.position.x)) - 20;
    const y0 = Math.min(...nodes.map((n) => n.position.y)) - 50;
    const x1 = Math.max(...nodes.map((n) => n.position.x + sizeOf(n).width)) + 20;
    const y1 = Math.max(...nodes.map((n) => n.position.y + sizeOf(n).height)) + 20;
    c.position = { x: x0, y: y0 };
    c.size = { x: x1 - x0, y: y1 - y0 };
  } else c.position = at ?? { x: 0, y: 0 };
  g.addGenerator(c);
  editor.select([c.name]);
}

/** expands the selected subgraph into the open graph */
export function expandSelectedSubgraph() {
  const nodes = selectedGens();
  const sub = nodes.find((n) => n instanceof GenGraph && !(n instanceof GenMaterial)) as GenGraph | undefined;
  if (!sub) return;
  const inner = editor.graph.expandSubgraph(sub);
  editor.select(inner.map((n) => n.name));
}

/** propagate_node_changes: copies the open subgraph to every subgraph with the same label in the project */
export function propagateChanges(): number {
  const g = editor.graph;
  if (g === editor.root) return 0;
  const targets = editor.root.propagationTargets(g);
  for (const t of targets) t.applyDiffFrom(g);
  editor.emit();
  return targets.length;
}
