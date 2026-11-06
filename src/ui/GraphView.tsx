import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type Connection as RFConnection,
  type EdgeChange,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { editor, useEditor } from "./store";
import { MMNode, portColor, type NodeData } from "./NodeView";
import { GenComment, GenGraph, type Connection } from "../engine/gen/graph";
import type { Dict, Gen } from "../engine/gen/base";
import { GenMaterial } from "../engine/gen/misc";
import { createGen } from "../engine/loader";
import { searchLibrary } from "./Library";
import type { LibraryItem } from "../engine/registry";

const nodeTypes = { mm: MMNode };
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

function GraphInner() {
  useEditor();
  const graph = editor.graph;
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; gen: Gen } | null>(null);
  const [adder, setAdder] = useState<{ x: number; y: number; at: { x: number; y: number } } | null>(null);
  const openAdder = (e: { clientX: number; clientY: number }) => setAdder({ x: e.clientX, y: e.clientY, at: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) });

  const derived = useMemo<Node<NodeData>[]>(
    () =>
      graph.children.map((g) => ({
        id: g.name,
        type: "mm",
        position: { x: g.position.x, y: g.position.y },
        data: { gen: g },
        selected: editor.selection.includes(g.name),
        zIndex: g instanceof GenComment ? -1 : 0,
        dragHandle: g instanceof GenComment ? undefined : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, editor.version],
  );
  const [nodes, setNodes] = useState(derived);
  useEffect(() => setNodes(derived), [derived]);

  const edges = useMemo<Edge[]>(
    () =>
      graph.connections.map((c) => {
        const from = graph.getNode(c.from);
        const t = from?.getOutputDefs()[c.from_port]?.type;
        return {
          id: `${c.from}:${c.from_port}>${c.to}:${c.to_port}`,
          source: c.from,
          sourceHandle: "o" + c.from_port,
          target: c.to,
          targetHandle: "i" + c.to_port,
          style: { stroke: portColor(t) },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, editor.version],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const ch of changes) {
      if (ch.type === "position" && ch.position && !ch.dragging) {
        const g = editor.graph.getNode(ch.id);
        if (g) {
          g.position = { x: ch.position.x, y: ch.position.y };
          editor.graph.notifyChanged();
        }
      }
      if (ch.type === "remove") {
        const g = editor.graph.getNode(ch.id);
        if (g) editor.graph.removeGenerator(g);
      }
    }
  }, []);

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node[] }) => editor.select(nodes.map((n) => n.id)), []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const ch of changes) {
      if (ch.type === "remove") {
        const m = /^(.*):(\d+)>(.*):(\d+)$/.exec(ch.id);
        if (m) editor.graph.disconnectChildren(m[1], +m[2], m[3], +m[4]);
      }
    }
  }, []);

  const isValidConnection = useCallback((c: RFConnection | Edge) => {
    const g = editor.graph;
    const from = g.getNode(c.source),
      to = g.getNode(c.target);
    if (!from || !to || !c.sourceHandle || !c.targetHandle) return false;
    const ot = from.getOutputDefs()[+c.sourceHandle.slice(1)]?.type;
    const it = to.getInputDefs()[+c.targetHandle.slice(1)]?.type;
    return GenGraph.compatible(ot, it);
  }, []);

  const onConnect = useCallback((c: RFConnection) => {
    const g = editor.graph;
    const from = g.getNode(c.source),
      to = g.getNode(c.target);
    if (from && to && c.sourceHandle && c.targetHandle) {
      if (!g.connectChildren(from, +c.sourceHandle.slice(1), to, +c.targetHandle.slice(1))) editor.setStatus("That connection would create a loop");
    }
  }, []);

  const addFromLibrary = useCallback((item: Dict, at: { x: number; y: number }) => {
    const data = structuredClone(item);
    for (const k of ["display_name", "icon", "icon_data", "tree_item", "skip_in_menu"]) delete data[k];
    if (data.type && !data.name) data.name = data.type;
    data.node_position = at;
    const g = createGen(data);
    if (!g) return;
    g.position = at;
    if (!editor.graph.addGenerator(g)) {
      editor.setStatus("This graph already has a material node");
      return;
    }
    editor.select([g.name]);
  }, []);

  useEffect(() => {
    const h = (e: Event) => {
      const item = (e as CustomEvent).detail as Dict;
      const r = wrap.current!.getBoundingClientRect();
      addFromLibrary(item, rf.screenToFlowPosition({ x: r.left + r.width / 2 - 60, y: r.top + r.height / 2 - 40 }));
    };
    window.addEventListener("mm-add-node", h);
    return () => window.removeEventListener("mm-add-node", h);
  }, [rf, addFromLibrary]);

  useEffect(() => {
    // fit the view when a different graph is shown
    const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 0 }), 30);
    return () => clearTimeout(t);
  }, [graph, rf]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        editor.redo();
      } else if (mod && e.key.toLowerCase() === "c") copySelection();
      else if (mod && e.key.toLowerCase() === "x") copySelection(true);
      else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const d = copySelection();
        if (d) pasteData(d);
      } else if (mod && e.key.toLowerCase() === "v") {
        const fromLocal = localStorage.getItem("material-pro:clipboard");
        const paste = (text: string | null) => {
          if (!text) return;
          try {
            pasteData(JSON.parse(text));
          } catch {
            /* not ours */
          }
        };
        if (navigator.clipboard?.readText) navigator.clipboard.readText().then(paste, () => paste(fromLocal));
        else paste(fromLocal);
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        groupSelection();
      } else if (e.key === "Escape" && editor.path.length) {
        editor.goTo(editor.path.length - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <div
      ref={wrap}
      style={{ flex: 1, minHeight: 0 }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(LIB_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const d = e.dataTransfer.getData(LIB_MIME);
        if (!d) return;
        e.preventDefault();
        addFromLibrary(JSON.parse(d), rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDoubleClick={(_, n) => {
          const g = editor.graph.getNode(n.id);
          if (g instanceof GenGraph) editor.enter(n.id);
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          const g = editor.graph.getNode(n.id);
          if (g) setMenu({ x: e.clientX, y: e.clientY, gen: g });
        }}
        onPaneClick={(e) => {
          setMenu(null);
          if (e.detail === 2) openAdder(e);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          openAdder(e);
        }}
        zoomOnDoubleClick={false}
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        minZoom={0.1}
        maxZoom={2.5}
        colorMode="dark"
        onBeforeDelete={async ({ nodes, edges }) => ({ nodes: nodes.filter((n) => editor.graph.getNode(n.id)?.canBeDeleted() !== false), edges })}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#3a3f47" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="#444" maskColor="#0008" />
      </ReactFlow>
      {menu && <NodeMenu {...menu} onClose={() => setMenu(null)} />}
      {adder && (
        <AddNodePopup
          x={adder.x}
          y={adder.y}
          onPick={(item) => {
            addFromLibrary(item, adder.at);
            setAdder(null);
          }}
          onClose={() => setAdder(null)}
        />
      )}
    </div>
  );
}

/** the quick add box: type to search the library, Enter adds the first match */
function AddNodePopup({ x, y, onPick, onClose }: { x: number; y: number; onPick: (i: LibraryItem) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const results = useMemo(() => searchLibrary(q).slice(0, 30), [q]);
  return (
    <div className="menu-list" style={{ position: "fixed", left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 380), width: 290 }}>
      <input
        autoFocus
        type="search"
        placeholder="Add a node…"
        value={q}
        style={{ width: "100%", marginBottom: 4 }}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onBlur={() => setTimeout(onClose, 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowDown") setSel((s) => Math.min(results.length - 1, s + 1));
          if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
          if (e.key === "Enter" && results[sel]) onPick(results[sel]);
        }}
      />
      {results.map((it, i) => (
        <button key={it.tree_item} onMouseDown={() => onPick(it)} style={{ background: i === sel ? "var(--bg4)" : undefined, display: "flex", gap: 6, alignItems: "center" }}>
          {it.icon_data && <img src={"data:image/png;base64," + it.icon_data} alt="" style={{ width: 28, height: 14, objectFit: "cover" }} />}
          {it.tree_item}
        </button>
      ))}
      {q && !results.length && <div className="label">No node matches</div>}
    </div>
  );
}

export function groupSelection() {
  const g = editor.graph;
  const gens = editor.selection.map((n) => g.getNode(n)).filter((x): x is Gen => !!x);
  const sub = g.createSubgraph(gens);
  if (sub) editor.select([sub.name]);
}

function NodeMenu({ x, y, gen, onClose }: { x: number; y: number; gen: Gen; onClose: () => void }) {
  const g = editor.graph;
  const outs = gen.getOutputDefs();
  const act = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <div className="menu-list" style={{ position: "fixed", left: x, top: y }} onMouseLeave={onClose}>
      {gen instanceof GenGraph && <button onClick={act(() => editor.enter(gen.name))}>Open subgraph</button>}
      {outs.length > 1 &&
        outs.map((o, i) => (
          <button key={i} onClick={act(() => ((gen.preview = i), editor.emit()))}>
            Preview output {i}
            {o.shortdesc ? ` — ${o.shortdesc}` : ""}
          </button>
        ))}
      {outs.length > 0 && (
        <button
          onClick={act(() => {
            if (editor.allPreviews) gen.extra.hidePreview = !gen.extra.hidePreview;
            else gen.preview = gen.preview >= 0 ? -1 : 0;
            editor.emit();
          })}
        >
          {(editor.allPreviews ? !gen.extra.hidePreview : gen.preview >= 0) ? "Hide preview" : "Show preview"}
        </button>
      )}
      <button onClick={act(() => ((gen.minimized = !gen.minimized), editor.emit()))}>{gen.minimized ? "Show parameters" : "Hide parameters"}</button>
      {gen.hasRandomness() && <button onClick={act(() => gen.setSeed(Math.random()))}>New random seed</button>}
      {gen.hasRandomness() && <button onClick={act(() => ((gen.seedLocked = !gen.seedLocked), gen.changed()))}>{gen.seedLocked ? "Unlock seed" : "Lock seed"}</button>}
      <button
        onClick={act(() => {
          const n = prompt("Node name", gen.name);
          if (n && !g.renameGenerator(gen, n)) editor.setStatus("That name is taken or not valid");
        })}
      >
        Rename…
      </button>
      <hr />
      <button
        onClick={act(() => {
          editor.select([gen.name]);
          const d = copySelection();
          if (d) pasteData(d);
        })}
      >
        Duplicate
      </button>
      <button onClick={act(() => groupSelection())}>Group selection into subgraph</button>
      {gen.canBeDeleted() && <button onClick={act(() => g.removeGenerator(gen))}>Delete</button>}
    </div>
  );
}

export function GraphView() {
  useEditor();
  const crumbs = ["Material", ...editor.path];
  return (
    <div className="graph-wrap">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span className="sep">›</span>}
            <button disabled={i === crumbs.length - 1} onClick={() => editor.goTo(i)}>
              {i === 0 ? editor.title : c}
            </button>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <label title="Show a preview on every node">
          <input type="checkbox" checked={editor.allPreviews} onChange={(e) => ((editor.allPreviews = e.target.checked), editor.emit())} /> all previews
        </label>
        <span style={{ color: "var(--text3)" }}>
          {editor.graph.children.length} nodes · {editor.graph.connections.length} links
        </span>
      </div>
      <ReactFlowProvider>
        <GraphInner />
      </ReactFlowProvider>
    </div>
  );
}
