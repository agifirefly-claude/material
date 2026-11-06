/* The graph canvas: React Flow showing the open graph, with selection, links, drops, menus and keys */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, useReactFlow, applyNodeChanges, type Node, type Edge, type NodeChange, type Connection as RFConnection, type EdgeChange, type FinalConnectionState, BackgroundVariant } from "@xyflow/react";
import { editor, useEditor } from "../store";
import { MMNode, portColor, type NodeData } from "../NodeView";
import { GenComment, GenGraph, type Connection } from "../../engine/gen/graph";
import type { Dict, Gen } from "../../engine/gen/base";
import { GenMaterial } from "../../engine/gen/misc";
import { registry, type LibraryItem } from "../../engine/registry";
import { CommentLineNode, CommentNode, viewType } from "./CommentViews";
import { AddNodePopup } from "./AddNodePopup";
import { NodeSearch } from "./NodeSearch";
import { createConnected, createFromLibrary, type QuickConnect } from "./create";
import * as act from "./actions";
import { openDialog } from "../dialogs/bus";
import { t, useLang } from "../i18n";
import { dropFiles, hasFiles } from "../fileDrop";
import { LIB_MIME, copySelection, pasteData, groupSelection } from "./clipboard";
import { NodeMenu, EdgeMenu } from "./Menus";

const nodeTypes = { mm: MMNode, comment: CommentNode, commentLine: CommentLineNode };
/** vertical position of a port inside a node, for straightening links */
export const portY = (_g: Gen, port: number) => 26 + 4 + port * 18 + 9;
type Adder = { x: number; y: number; at: { x: number; y: number }; qc: QuickConnect | null };
export function GraphInner() {
  useEditor();
  useLang();
  const graph = editor.graph;
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; gen: Gen } | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; c: Connection } | null>(null);
  const [adder, setAdder] = useState<Adder | null>(null);
  const [search, setSearch] = useState(false);
  const connecting = useRef<QuickConnect | null>(null);
  const openAdder = (e: { clientX: number; clientY: number }, qc: QuickConnect | null = null) =>
    setAdder({ x: e.clientX, y: e.clientY, at: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }), qc });

  const derived = useMemo<Node<NodeData>[]>(
    () =>
      graph.children.map((g) => ({
        id: g.name,
        type: viewType(g),
        position: { x: g.position.x, y: g.position.y },
        data: { gen: g },
        selected: editor.selection.includes(g.name),
        zIndex: g instanceof GenComment ? -1 : 0,
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
        const type = from?.getOutputDefs()[c.from_port]?.type;
        return {
          id: `${c.from}:${c.from_port}>${c.to}:${c.to_port}`,
          source: c.from,
          sourceHandle: "o" + c.from_port,
          target: c.to,
          targetHandle: "i" + c.to_port,
          style: { stroke: portColor(type) },
          data: { c },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, editor.version],
  );

  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    for (const ch of changes) {
      if (ch.type === "dimensions" && ch.dimensions) act.nodeSizes.set(ch.id, ch.dimensions);
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
    connecting.current = null;
    const g = editor.graph;
    const from = g.getNode(c.source),
      to = g.getNode(c.target);
    if (from && to && c.sourceHandle && c.targetHandle) {
      if (!g.connectChildren(from, +c.sourceHandle.slice(1), to, +c.targetHandle.slice(1))) editor.setStatus(t("That connection would create a loop"));
    }
  }, []);

  /* a link dropped on empty space opens the add popup for nodes that can take it (graph_edit.request_popup) */
  const onConnectEnd = useCallback(
    (e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || state.toHandle || !state.fromNode || !state.fromHandle?.id) return;
      const target = (e as MouseEvent).target as Element | null;
      if (target?.closest?.(".react-flow__node")) return;
      const gen = editor.graph.getNode(state.fromNode.id);
      if (!gen) return;
      const fromOutput = state.fromHandle.type === "source";
      const port = +state.fromHandle.id.slice(1);
      const def = (fromOutput ? gen.getOutputDefs() : gen.getInputDefs())[port];
      const qc: QuickConnect = { node: gen.name, port, fromOutput, slotType: registry.ioTypes[def?.type]?.slot_type ?? 42 };
      const p = "changedTouches" in e ? e.changedTouches[0] : (e as MouseEvent);
      openAdder(p, qc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf],
  );

  const placeFree = useCallback(
    (at: { x: number; y: number }) => {
      const taken = (p: { x: number; y: number }) =>
        rf.getNodes().some((n) => {
          const w = n.measured?.width ?? 180,
            h = n.measured?.height ?? 120;
          return p.x < n.position.x + w + 20 && p.x + 180 > n.position.x - 20 && p.y < n.position.y + h + 20 && p.y + 120 > n.position.y - 20;
        });
      for (let i = 0; i < 12 && taken(at); i++) at.x -= 120;
      return at;
    },
    [rf],
  );

  useEffect(() => {
    const h = (e: Event) => {
      const item = (e as CustomEvent).detail as Dict;
      const r = wrap.current!.getBoundingClientRect();
      createFromLibrary(item, placeFree(rf.screenToFlowPosition({ x: r.left + r.width / 2 - 60, y: r.top + r.height / 2 - 40 })));
    };
    window.addEventListener("mm-add-node", h);
    return () => window.removeEventListener("mm-add-node", h);
  }, [rf, placeFree]);

  useEffect(() => {
    // fit the view when a different graph is shown
    const tm = setTimeout(() => rf.fitView({ padding: 0.15, duration: 0 }), 30);
    return () => clearTimeout(tm);
  }, [graph, rf]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        editor.redo();
      } else if (mod && k === "c") copySelection();
      else if (mod && k === "x") copySelection(true);
      else if (mod && k === "d") {
        e.preventDefault();
        if (e.shiftKey) act.duplicateWithInputs();
        else {
          const d = copySelection();
          if (d) pasteData(d);
        }
      } else if (mod && k === "v") {
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
      } else if (mod && k === "g") {
        e.preventDefault();
        groupSelection();
      } else if (mod && k === "a") {
        e.preventDefault();
        if (e.shiftKey) act.selectNone();
        else act.selectAll();
      } else if (mod && k === "i") {
        e.preventDefault();
        act.selectInvert();
      } else if (mod && k === "f") {
        e.preventDefault();
        setSearch(true);
      } else if (mod && k === "m") {
        e.preventDefault();
        act.minimizeSelection();
      } else if (mod && k === "e") {
        e.preventDefault();
        const g = editor.selected;
        if (g) openDialog("edit-node", g);
      } else if (e.altKey && k === "s") {
        e.preventDefault();
        act.swapInputs();
      } else if (e.key === "Escape" && editor.path.length) {
        editor.goTo(editor.path.length - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    const h = () => setSearch(true);
    window.addEventListener("mm-find-node", h);
    return () => window.removeEventListener("mm-find-node", h);
  }, []);

  return (
    <div
      ref={wrap}
      style={{ flex: 1, minHeight: 0, position: "relative" }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(LIB_MIME) || hasFiles(e)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          dropFiles(e, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          return;
        }
        const d = e.dataTransfer.getData(LIB_MIME);
        if (!d) return;
        e.preventDefault();
        createFromLibrary(JSON.parse(d), rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
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
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDoubleClick={(_, n) => {
          const g = editor.graph.getNode(n.id);
          if (g instanceof GenGraph && !(g instanceof GenMaterial)) editor.enter(n.id);
        }}
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          const g = editor.graph.getNode(n.id);
          if (g) setMenu({ x: e.clientX, y: e.clientY, gen: g });
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          setEdgeMenu({ x: e.clientX, y: e.clientY, c: (edge.data as { c: Connection }).c });
        }}
        onEdgeDoubleClick={(e, edge) => act.insertRerouteOnLink((edge.data as { c: Connection }).c, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
        onPaneClick={(e) => {
          setMenu(null);
          setEdgeMenu(null);
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
      {edgeMenu && <EdgeMenu {...edgeMenu} at={rf.screenToFlowPosition({ x: edgeMenu.x, y: edgeMenu.y })} onClose={() => setEdgeMenu(null)} />}
      {adder && (
        <AddNodePopup
          x={adder.x}
          y={adder.y}
          qc={adder.qc}
          onPick={(item: LibraryItem) => {
            createConnected(item, adder.at, adder.qc);
            setAdder(null);
          }}
          onClose={() => setAdder(null)}
        />
      )}
      {search && <NodeSearch onClose={() => setSearch(false)} onGo={(n) => setTimeout(() => rf.fitView({ nodes: [{ id: n.name }], padding: 0.6, duration: 300 }), 80)} />}
    </div>
  );
}
