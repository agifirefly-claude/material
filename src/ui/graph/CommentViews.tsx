/* Comment frames (nodes/comment) and comment lines (nodes/comment_line): resizable, editable in place, coloured. */
import { memo, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { GenComment, GenCommentLine } from "../../engine/gen/graph";
import type { Gen } from "../../engine/gen/base";
import { editor, useEditor } from "../store";
import { t, useLang } from "../i18n";

const COLORS = ["#3a3a2a", "#2a3a2e", "#2a333f", "#3a2a3a", "#402a2a", "#2e2e2e"];
const css = (c: { r: number; g: number; b: number; a?: number } | null) => (c ? `rgba(${c.r * 255},${c.g * 255},${c.b * 255},${c.a ?? 1})` : "#3a3a2a");
const hexToColor = (h: string) => ({ type: "Color", r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1 });

function CommentInner({ data, selected }: NodeProps & { data: { gen: Gen } }) {
  useEditor();
  useLang();
  const g = data.gen as GenComment;
  const [edit, setEdit] = useState(false);
  return (
    <div className="mm-comment" style={{ width: g.size.x, height: g.size.y, background: css(g.color as never) + "cc", borderColor: selected ? "var(--accent)" : undefined }}>
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={60}
        onResizeEnd={(_, p) => {
          g.size = { x: p.width, y: p.height };
          g.position = { x: p.x, y: p.y };
          g.changed();
        }}
      />
      {edit ? (
        <div className="nodrag" style={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }} onKeyDown={(e) => e.stopPropagation()}>
          <input type="text" defaultValue={g.title} onChange={(e) => (g.title = e.target.value)} />
          <textarea defaultValue={g.text} onChange={(e) => (g.text = e.target.value)} style={{ flex: 1, fontFamily: "inherit" }} autoFocus />
          <div style={{ display: "flex", gap: 3 }}>
            {COLORS.map((c) => (
              <button key={c} style={{ background: c, width: 18, height: 18, padding: 0 }} onClick={() => ((g.color = hexToColor(c)), g.changed())} />
            ))}
            <span style={{ flex: 1 }} />
            <button onClick={() => (setEdit(false), g.changed())}>{t("OK")}</button>
          </div>
        </div>
      ) : (
        <div onDoubleClick={() => setEdit(true)} style={{ height: "100%" }} title={t("Double-click to write a comment")}>
          <div className="t">{g.title}</div>
          <pre>{g.text || t("Double-click to write a comment")}</pre>
        </div>
      )}
    </div>
  );
}

function CommentLineInner({ data, selected }: NodeProps & { data: { gen: Gen } }) {
  useEditor();
  const g = data.gen as GenCommentLine;
  const [edit, setEdit] = useState(false);
  const size = [14, 22, 34][Math.round(Number(g.parameters.label ?? 0))] ?? 14;
  return edit ? (
    <input
      className="nodrag"
      autoFocus
      defaultValue={g.text}
      style={{ fontSize: size, minWidth: 200 }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        g.text = e.target.value;
        setEdit(false);
        g.changed();
      }}
    />
  ) : (
    <div className="mm-comment-line" onDoubleClick={() => setEdit(true)} style={{ fontSize: size, outline: selected ? "1px solid var(--accent)" : undefined }}>
      {g.text}
    </div>
  );
}

export const CommentNode = memo(CommentInner);
export const CommentLineNode = memo(CommentLineInner);

/** the React Flow node type that draws a generator */
export function viewType(g: Gen): string {
  if (g instanceof GenComment) return "comment";
  if (g instanceof GenCommentLine) return "commentLine";
  return "mm";
}

