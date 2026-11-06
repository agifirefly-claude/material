/* The graph clipboard, in Material Maker's format ({ nodes, connections }), and grouping into a subgraph */
import { editor } from "../store";
import { type Connection } from "../../engine/gen/graph";
import type { Dict, Gen } from "../../engine/gen/base";
import { GenMaterial } from "../../engine/gen/misc";

export const LIB_MIME = "application/x-material-pro-node";

/* ---------- clipboard: Material Maker's format, { nodes, connections } ---------- */
export function copySelection(cut = false): Dict | null {
  const g = editor.graph;
  const names = new Set(editor.selection);
  const gens = g.children.filter((c) => names.has(c.name) && !(c instanceof GenMaterial) && c.name !== "gen_inputs" && c.name !== "gen_outputs");
  if (!gens.length) return null;
  const data = { nodes: gens.map((c) => c.serialize()), connections: g.connections.filter((c) => names.has(c.from) && names.has(c.to)) };
  const text = JSON.stringify(data);
  localStorage.setItem("material-pro:clipboard", text);
  navigator.clipboard?.writeText(text).catch(() => {});
  if (cut) for (const c of gens) g.removeGenerator(c);
  return data;
}
export function pasteData(data: Dict, at?: { x: number; y: number }): void {
  const g = editor.graph;
  if (!Array.isArray(data.nodes)) return;
  let minX = Infinity,
    minY = Infinity;
  for (const n of data.nodes) {
    minX = Math.min(minX, n.node_position?.x ?? 0);
    minY = Math.min(minY, n.node_position?.y ?? 0);
  }
  const offset = at ? { x: at.x - minX, y: at.y - minY } : { x: 40, y: 40 };
  const nodes = structuredClone(data.nodes).filter((n: Dict) => n.type !== "material" && n.name !== "Material");
  const r = g.addToGraph(nodes, structuredClone(data.connections ?? []) as Connection[], offset);
  editor.select(r.generators.map((x) => x.name));
}
export function groupSelection() {
  const g = editor.graph;
  const gens = editor.selection.map((n) => g.getNode(n)).filter((x): x is Gen => !!x);
  const sub = g.createSubgraph(gens);
  if (sub) editor.select([sub.name]);
}
