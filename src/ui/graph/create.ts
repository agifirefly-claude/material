/* Creating nodes from library items (graph_edit.create_nodes) and checking which items can connect to a port
 * (add_node_popup.check_quick_connect). */
import { editor } from "../store";
import { createGen } from "../../engine/loader";
import { registry, type LibraryItem } from "../../engine/registry";
import type { Dict, Gen } from "../../engine/gen/base";
import { GenGraph, type Connection } from "../../engine/gen/graph";
import { libraries } from "../library/manager";
import { getPrefs } from "../prefs";
import { t } from "../i18n";

const DISPLAY_KEYS = ["display_name", "icon", "icon_data", "tree_item", "skip_in_menu", "library", "idx"];

/** the node data of a library item, without what only the library uses */
export function itemData(item: LibraryItem | Dict): Dict {
  const data = structuredClone(item) as Dict;
  for (const k of DISPLAY_KEYS) delete data[k];
  return data;
}

/** adds a library item at a position; an item may be one node or several (a saved selection) */
export function createFromLibrary(item: LibraryItem | Dict, at: { x: number; y: number }): Gen[] {
  const g = editor.graph;
  const data = itemData(item);
  let created: Gen[] = [];
  if (!data.type && Array.isArray(data.nodes)) {
    let minX = Infinity,
      minY = Infinity;
    for (const n of data.nodes) {
      minX = Math.min(minX, n.node_position?.x ?? 0);
      minY = Math.min(minY, n.node_position?.y ?? 0);
    }
    created = g.addToGraph(
      data.nodes.filter((n: Dict) => n.name !== "Material"),
      (data.connections ?? []) as Connection[],
      { x: at.x - (Number.isFinite(minX) ? minX : 0), y: at.y - (Number.isFinite(minY) ? minY : 0) },
    ).generators;
  } else {
    if (data.type && !data.name) data.name = data.type;
    data.node_position = at;
    const gen = createGen(data);
    if (!gen) return [];
    gen.position = at;
    if (registry.nodes[data.type]?.type === "material_export" && gen.parameters.size === undefined) gen.parameters.size = getPrefs().defaultMaterialSize;
    if (!g.addGenerator(gen)) {
      editor.setStatus(t("This graph already has a material node"));
      return [];
    }
    created = [gen];
  }
  if ((item as LibraryItem).tree_item) libraries.itemCreated((item as LibraryItem).tree_item);
  editor.select(created.map((x) => x.name));
  return created;
}

/* ---------- quick connect ---------- */
const portCache = new Map<string, { ins: number[]; outs: number[] } | null>();
const slot = (type: string) => registry.ioTypes[type]?.slot_type ?? -1;

function ports(item: LibraryItem): { ins: number[]; outs: number[] } | null {
  const key = item.tree_item + "|" + item.type;
  if (portCache.has(key)) return portCache.get(key)!;
  let r: { ins: number[]; outs: number[] } | null = null;
  try {
    if (item.type && !["comment", "comment_line", "remote"].includes(String(item.type))) {
      const gen = createGen(itemData(item));
      if (gen) {
        const tmp = new GenGraph();
        tmp.addGenerator(gen);
        r = { ins: gen.getInputDefs().map((d) => slot(d.type)), outs: gen.getOutputDefs().map((d) => slot(d.type)) };
      }
    }
  } catch {
    r = null;
  }
  portCache.set(key, r);
  return r;
}

export interface QuickConnect {
  node: string;
  port: number;
  /** the dragged port is an output: the new node connects to it with an input */
  fromOutput: boolean;
  slotType: number;
}

/** the index of the new node's port to connect, or -1 */
export function quickConnectPort(item: LibraryItem, qc: QuickConnect): number {
  const p = ports(item);
  if (!p) return -1;
  const list = qc.fromOutput ? p.ins : p.outs;
  return list.findIndex((s) => s === qc.slotType || s === 42 || qc.slotType === 42);
}

/** creates the item and connects it to the dragged port */
export function createConnected(item: LibraryItem, at: { x: number; y: number }, qc: QuickConnect | null): Gen[] {
  const created = createFromLibrary(item, at);
  if (!qc || created.length !== 1) return created;
  const gen = created[0];
  const g = editor.graph;
  const other = g.getNode(qc.node);
  if (!other) return created;
  const ports = qc.fromOutput ? gen.getInputDefs() : gen.getOutputDefs();
  const i = ports.findIndex((d) => {
    const s = slot(d.type);
    return s === qc.slotType || s === 42 || qc.slotType === 42;
  });
  if (i < 0) return created;
  if (qc.fromOutput) {
    g.connectChildren(other, qc.port, gen, i);
    gen.position = { x: at.x, y: at.y - 30 - i * 18 };
  } else {
    g.connectChildren(gen, i, other, qc.port);
    gen.position = { x: at.x - 160, y: at.y - 30 - i * 18 };
  }
  g.notifyChanged(gen);
  return created;
}
