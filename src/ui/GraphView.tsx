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
  type FinalConnectionState,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph/editor.css";
import { editor, useEditor } from "./store";
import { MMNode, portColor, portLabel, type NodeData } from "./NodeView";
import { GenComment, GenCommentLine, GenGraph, type Connection } from "../engine/gen/graph";
import type { Dict, Gen } from "../engine/gen/base";
import { GenMaterial } from "../engine/gen/misc";
import { GenShader } from "../engine/gen/shader";
import { registry, type LibraryItem } from "../engine/registry";
import { CommentLineNode, CommentNode, viewType } from "./graph/CommentViews";
import { AddNodePopup } from "./graph/AddNodePopup";
import { NodeSearch } from "./graph/NodeSearch";
import { createConnected, createFromLibrary, type QuickConnect } from "./graph/create";
import * as act from "./graph/actions";
import { openDialog } from "./dialogs/bus";
import { t, tDesc, useLang } from "./i18n";
import { dropFiles, hasFiles } from "./fileDrop";

const nodeTypes = { mm: MMNode, comment: CommentNode, commentLine: CommentLineNode };
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

/** vertical position of a port inside a node, for straightening links */
const portY = (_g: Gen, port: number) => 26 + 4 + port * 18 + 9;

type Adder = { x: number; y: number; at: { x: number; y: number }; qc: QuickConnect | null };

function GraphInner() {
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

export function groupSelection() {
  const g = editor.graph;
  const gens = editor.selection.map((n) => g.getNode(n)).filter((x): x is Gen => !!x);
  const sub = g.createSubgraph(gens);
  if (sub) editor.select([sub.name]);
}

function NodeMenu({ x, y, gen, onClose }: { x: number; y: number; gen: Gen; onClose: () => void }) {
  const g = editor.graph;
  const outs = gen.getOutputDefs();
  const ins = gen.getInputDefs();
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  const isSub = gen instanceof GenGraph && !(gen instanceof GenMaterial);
  return (
    <div className="menu-list" style={{ position: "fixed", left: x, top: Math.min(y, window.innerHeight - 520), maxHeight: "80vh" }} onMouseLeave={onClose}>
      {isSub && <button onClick={run(() => editor.enter(gen.name))}>{t("Open subgraph")}</button>}
      {(gen instanceof GenShader || isSub) && <button onClick={run(() => openDialog("edit-node", gen))}>{gen instanceof GenMaterial ? t("Edit material…") : isSub ? t("Edit graph…") : t("Edit node…")} (Ctrl+E)</button>}
      {(gen instanceof GenShader || isSub) && gen.isTemplate() && <button onClick={run(() => (gen.toggleEditable(), gen.changed()))}>{t("Make editable (detach from the library)")}</button>}
      {outs.length > 1 &&
        outs.map((o, i) => (
          <button key={i} onClick={run(() => ((gen.preview = i), editor.emit()))}>
            {t("Preview output {0}", i)}
            {o.shortdesc ? ` — ${tDesc(o.shortdesc)}` : ""}
          </button>
        ))}
      {outs.length > 0 && (
        <button
          onClick={run(() => {
            if (editor.allPreviews) gen.extra.hidePreview = !gen.extra.hidePreview;
            else gen.preview = gen.preview >= 0 ? -1 : 0;
            editor.emit();
          })}
        >
          {(editor.allPreviews ? !gen.extra.hidePreview : gen.preview >= 0) ? t("Hide preview") : t("Show preview")}
        </button>
      )}
      <button onClick={run(() => ((gen.minimized = !gen.minimized), editor.emit()))}>{gen.minimized ? t("Show parameters") : t("Hide parameters")}</button>
      {gen.hasRandomness() && <button onClick={run(() => gen.setSeed(Math.random()))}>{t("New random seed")}</button>}
      {gen.hasRandomness() && <button onClick={run(() => ((gen.seedLocked = !gen.seedLocked), gen.changed()))}>{gen.seedLocked ? t("Unlock seed") : t("Lock seed")}</button>}
      <button
        onClick={run(() => {
          const n = prompt(t("Node name"), gen.name);
          if (n && !g.renameGenerator(gen, n)) editor.setStatus(t("That name is taken or not valid"));
        })}
      >
        {t("Rename…")}
      </button>
      {ins.length > 1 && <button onClick={run(() => (editor.select([gen.name]), act.swapInputs()))}>{t("Swap inputs")} (Alt+S)</button>}
      {ins.map((p, i) => (
        <button key={"r" + i} onClick={run(() => act.toggleRerouteOnInput(gen, i))}>
          {t("Reroute input")} “{portLabel(p, i, false)}”
        </button>
      ))}
      <hr />
      <button
        onClick={run(() => {
          editor.select([gen.name]);
          const d = copySelection();
          if (d) pasteData(d);
        })}
      >
        {t("Duplicate")}
      </button>
      <button onClick={run(() => act.duplicateWithInputs())}>{t("Duplicate with inputs")} (Ctrl+Shift+D)</button>
      <button onClick={run(() => groupSelection())}>{t("Group selection into subgraph")}</button>
      {isSub && <button onClick={run(() => (editor.select([gen.name]), act.expandSelectedSubgraph()))}>{t("Expand subgraph into this graph")}</button>}
      {!(gen instanceof GenComment || gen instanceof GenCommentLine) && <button onClick={run(() => openDialog("add-to-library", gen))}>{t("Add to a library…")}</button>}
      {gen.canBeDeleted() && <button onClick={run(() => g.removeGenerator(gen))}>{t("Delete")}</button>}
    </div>
  );
}

function EdgeMenu({ x, y, c, at, onClose }: { x: number; y: number; c: Connection; at: { x: number; y: number }; onClose: () => void }) {
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <div className="menu-list" style={{ position: "fixed", left: x, top: y }} onMouseLeave={onClose}>
      <div className="label">
        {c.from}.{c.from_port} → {c.to}.{c.to_port}
      </div>
      <button onClick={run(() => act.insertRerouteOnLink(c, at))}>{t("Insert a reroute node")}</button>
      <button onClick={run(() => act.linkToPortals(c))}>{t("Replace by portals")}</button>
      <button onClick={run(() => editor.graph.disconnectChildren(c.from, c.from_port, c.to, c.to_port))}>{t("Disconnect")}</button>
    </div>
  );
}

function Toolbar() {
  const [open, setOpen] = useState<"" | "select" | "align">("");
  const g = editor.graph;
  const sub = g !== editor.root;
  const close = (f: () => void) => () => {
    f();
    setOpen("");
  };
  return (
    <>
      <div className="menu">
        <button onClick={() => setOpen(open === "select" ? "" : "select")}>{t("Select")} ▾</button>
        {open === "select" && (
          <div className="menu-list" onMouseLeave={() => setOpen("")}>
            <button onClick={close(act.selectAll)}>{t("Select all")} (Ctrl+A)</button>
            <button onClick={close(act.selectNone)}>{t("Select none")} (Ctrl+Shift+A)</button>
            <button onClick={close(act.selectInvert)}>{t("Invert selection")} (Ctrl+I)</button>
            <hr />
            <button onClick={close(act.minimizeSelection)}>{t("Minimize / restore selection")} (Ctrl+M)</button>
            <button onClick={close(() => act.addComment())}>{t("Add a comment around the selection")}</button>
          </div>
        )}
      </div>
      <div className="menu">
        <button onClick={() => setOpen(open === "align" ? "" : "align")} disabled={editor.selection.length < 2}>
          {t("Align")} ▾
        </button>
        {open === "align" && (
          <div className="menu-list" onMouseLeave={() => setOpen("")}>
            <button onClick={close(act.alignStart)}>{t("Align start")}</button>
            <button onClick={close(act.alignCenter)}>{t("Align center")}</button>
            <button onClick={close(act.alignEnd)}>{t("Align end")}</button>
            <button onClick={close(act.alignTop)}>{t("Align top")}</button>
            <button onClick={close(() => act.straightenConnections(portY))}>{t("Straighten connections")}</button>
          </div>
        )}
      </div>
      <button onClick={() => window.dispatchEvent(new Event("mm-find-node"))} title="Ctrl+F">
        {t("Find")}
      </button>
      {sub && (
        <label title={t("The nodes of this subgraph add the graph's seed to theirs")}>
          <input type="checkbox" checked={g.transmitsSeed} onChange={(e) => ((g.transmitsSeed = e.target.checked), g.changed())} /> {t("transmit seed")}
        </label>
      )}
      {sub && (
        <button
          title={t("Copy this subgraph to every subgraph with the same name")}
          onClick={() => {
            const n = act.propagateChanges();
            editor.setStatus(t("Changes propagated to {0} subgraphs", n));
          }}
        >
          {t("Propagate")}
        </button>
      )}
    </>
  );
}

export function GraphView() {
  useEditor();
  useLang();
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
        <Toolbar />
        <label title={t("Show a preview on every node")}>
          <input type="checkbox" checked={editor.allPreviews} onChange={(e) => ((editor.allPreviews = e.target.checked), editor.emit())} /> {t("all previews")}
        </label>
        <span style={{ color: "var(--text3)" }}>{t("{0} nodes · {1} links", editor.graph.children.length, editor.graph.connections.length)}</span>
      </div>
      <ReactFlowProvider>
        <GraphInner />
      </ReactFlowProvider>
    </div>
  );
}
