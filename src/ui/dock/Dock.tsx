/* The docked panels around the graph: drag a tab onto a group to join it, onto a group's or the graph's edge to dock
 * beside it; drag the gaps between panels to resize them; × closes a panel (View > Panels shows it again). */
import { useRef, useState, type ReactNode } from "react";
import type { DockLayout, DockNode, DockPanel } from "../prefs";
import { dockPanel, closePanel, setActive, setSizes, type Side } from "./model";
import { t } from "../i18n";

export const PANEL_TITLES: Record<DockPanel, string> = {
  library: "Library",
  hierarchy: "Hierarchy",
  preview3d: "3D material",
  preview2d: "2D node output",
  reference: "Reference",
  inspector: "Inspector",
};
const MIME = "application/x-material-pro-panel";
let dragging: DockPanel | null = null;

export interface DockProps {
  layout: DockLayout;
  onChange: (l: DockLayout) => void;
  /** a panel's content; `shown` is false for a panel in a tab that is not the active one */
  panel: (p: DockPanel, shown: boolean) => ReactNode;
  center: ReactNode;
}

export function Dock(props: DockProps) {
  return (
    <div className="dock-root">
      <DockView node={props.layout.root} path={[]} {...props} />
    </div>
  );
}

function DockView(props: DockProps & { node: DockNode; path: number[] }) {
  const { node, path } = props;
  if (node.type === "center")
    return (
      <DropZone {...props} path={path} isCenter>
        {props.center}
      </DropZone>
    );
  if (node.type === "tabs") return <TabGroup {...props} node={node} path={path} />;
  return <Split {...props} node={node} path={path} />;
}

function Split(props: DockProps & { node: Extract<DockNode, { type: "split" }>; path: number[] }) {
  const { node, path } = props;
  const ref = useRef<HTMLDivElement>(null);
  const total = node.sizes.reduce((a, b) => a + b, 0) || 1;
  const row = node.dir === "row";
  const startResize = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current!;
    const extent = row ? el.clientWidth : el.clientHeight;
    const start = row ? e.clientX : e.clientY;
    const sizes0 = node.sizes.slice();
    const pair = sizes0[i] + sizes0[i + 1];
    const move = (ev: PointerEvent) => {
      const d = (((row ? ev.clientX : ev.clientY) - start) / extent) * total;
      const a = Math.min(pair - total * 0.05, Math.max(total * 0.05, sizes0[i] + d));
      const sizes = sizes0.slice();
      sizes[i] = a;
      sizes[i + 1] = pair - a;
      props.onChange(setSizes(props.layout, path, sizes));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={ref} className={"dock-split " + node.dir}>
      {node.children.map((c, i) => (
        <div key={i} style={{ display: "contents" }}>
          {i > 0 && <div className={"dock-gutter " + node.dir} onPointerDown={(e) => startResize(i - 1, e)} />}
          <div className="dock-cell" style={{ flex: `${node.sizes[i] / total} 1 0` }}>
            <DockView {...props} node={c} path={[...path, i]} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TabGroup(props: DockProps & { node: Extract<DockNode, { type: "tabs" }>; path: number[] }) {
  const { node, path } = props;
  const active = Math.min(node.active, node.panels.length - 1);
  return (
    <DropZone {...props} path={path}>
      <div className="dock-tabs panel">
        <div className="tabs dock-tabbar">
          {node.panels.map((p, i) => (
            <button
              key={p}
              className={i === active ? "on" : ""}
              draggable
              onDragStart={(e) => {
                dragging = p;
                e.dataTransfer.setData(MIME, p);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => (dragging = null)}
              onClick={() => props.onChange(setActive(props.layout, path, i))}
              title={t("Drag to dock this panel elsewhere")}
            >
              {t(PANEL_TITLES[p])}
              <span
                className="dock-close"
                title={t("Close")}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onChange(closePanel(props.layout, p));
                }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        {node.panels.map((p, i) => (
          <div key={p} className="dock-content" style={{ display: i === active ? "flex" : "none" }}>
            {props.panel(p, i === active)}
          </div>
        ))}
      </div>
    </DropZone>
  );
}

/** where a dragged tab would land: one of the five zones of the element under the pointer */
function DropZone(props: DockProps & { path: number[]; isCenter?: boolean; children: ReactNode }) {
  const [side, setSide] = useState<Side | null>(null);
  const zone = (e: React.DragEvent): Side => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width,
      y = (e.clientY - r.top) / r.height;
    const edge = Math.min(x, 1 - x, y, 1 - y);
    // the graph only takes panels beside it; a group takes them into its tabs in its middle
    if (edge > (props.isCenter ? 0.18 : 0.25)) return props.isCenter ? (x < 0.5 ? "left" : "right") : "center";
    return edge === x ? "left" : edge === 1 - x ? "right" : edge === y ? "top" : "bottom";
  };
  return (
    <div
      className="dock-drop"
      onDragOver={(e) => {
        if (!dragging || !e.dataTransfer.types.includes(MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        setSide(zone(e));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setSide(null);
      }}
      onDrop={(e) => {
        const p = e.dataTransfer.getData(MIME) as DockPanel;
        setSide(null);
        if (!p) return;
        e.preventDefault();
        e.stopPropagation();
        props.onChange(dockPanel(props.layout, p, props.path, zone(e)));
        dragging = null;
      }}
    >
      {props.children}
      {side && <div className={"dock-hint " + side} />}
    </div>
  );
}
