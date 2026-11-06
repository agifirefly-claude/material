/* The data the engine runs on: the node library, the port types and the shared shader functions.
 * Loaded once (from public/data in the browser, from disk in tests) before any graph is built. */

export interface IoType {
  name: string;
  label?: string;
  type: string;
  paramdefs: string;
  params: string;
  slot_type: number;
  convert?: { type: string; expr: string }[];
  color: string;
  preview?: string;
}

export interface LibraryItem {
  name: string;
  display_name?: string;
  tree_item: string;
  type: string;
  icon?: string;
  icon_data?: string;
  parameters?: Record<string, unknown>;
  [k: string]: unknown;
}

export const registry = {
  nodes: {} as Record<string, NodeData>,
  ioTypes: {} as Record<string, IoType>,
  shaderFunctions: "",
  library: [] as LibraryItem[],
  aliases: {} as Record<string, string>,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NodeData = Record<string, any>;

export function initRegistry(d: { nodes: Record<string, NodeData>; ioTypes: IoType[]; shaderFunctions: string; library?: { items: LibraryItem[]; aliases: Record<string, string> } }) {
  registry.nodes = d.nodes;
  registry.ioTypes = {};
  for (const t of d.ioTypes) registry.ioTypes[t.name] = t;
  registry.shaderFunctions = d.shaderFunctions;
  if (d.library) {
    registry.library = d.library.items;
    registry.aliases = d.library.aliases;
  }
}

export async function loadRegistry(base = "data/"): Promise<void> {
  const [nodes, ioTypes, shaderFunctions, library] = await Promise.all([
    fetch(base + "nodes.json").then((r) => r.json()),
    fetch(base + "io_types.json").then((r) => r.json()),
    fetch(base + "shader_functions.glsl").then((r) => r.text()),
    fetch(base + "library.json").then((r) => r.json()),
  ]);
  initRegistry({ nodes, ioTypes, shaderFunctions, library });
}

/** MMLoader.get_predefined_global */
export function getPredefinedGlobal(name: string): string {
  return registry.nodes[name]?.shader_model?.global ?? "";
}
