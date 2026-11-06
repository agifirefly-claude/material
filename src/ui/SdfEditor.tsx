/* The Easy SDF scene editor (Material Maker's material_maker/windows/sdf_builder), shown in the inspector:
 * the scene as a tree of items, an add menu filtered by what the selected item may contain, and the selected
 * item's parameters (with per parameter expressions). Every edit rebuilds the node's shader through GenSDF.setSdfScene,
 * or, in the SDF builder window, changes the window's working copy of the scene. */
import { useEffect, useRef, useState } from "react";
import type { Gen } from "../engine/gen/base";
import type { GenSDF } from "../engine/gen/sdf";
import { deserializeValue, type ParamValue } from "../engine/params/types";
import { SDF_ITEM_TYPES, deserializeScene, newSceneItem, sdfItemType, serializeScene, validChildrenTypes, type SdfScene } from "../engine/sdf/builder";
import { ParamControl, paramLabel } from "./widgets/ParamControl";
import { editor, useEditor } from "./store";
import { SdfBuilder } from "./sdf/SdfBuilder";
import { t as tr } from "./i18n";

type Loc = { list: SdfScene[]; i: number; item: SdfScene; parent: SdfScene | null; grandList: SdfScene[] | null };

export function find(scene: SdfScene[], index: number, parent: SdfScene | null = null, grandList: SdfScene[] | null = null): Loc | null {
  for (let i = 0; i < scene.length; i++) {
    const item = scene[i];
    if (item.index === index) return { list: scene, i, item, parent, grandList };
    const r = find(item.children, index, item, scene);
    if (r) return r;
  }
  return null;
}
export function maxIndex(scene: SdfScene[]): number {
  return scene.reduce((m, s) => Math.max(m, s.index, maxIndex(s.children)), 0);
}
const categoryOf = (s: SdfScene) => sdfItemType(s.type)?.category ?? "";

/* ---------- the Easy SDF clipboard (sdf_builder.gd copy_item / paste_item: one item as JSON, flagged is_easysdf) ---------- */
const CLIP_KEY = "material-pro:sdf-clipboard";
function copyItem(item: SdfScene) {
  const text = JSON.stringify({ ...serializeScene([item])[0], is_easysdf: true });
  try {
    localStorage.setItem(CLIP_KEY, text);
  } catch {
    /* storage blocked */
  }
  navigator.clipboard?.writeText(text).catch(() => {});
}
function readClipboard(): SdfScene | null {
  try {
    const d = JSON.parse(localStorage.getItem(CLIP_KEY) ?? "null");
    if (d && d.is_easysdf) {
      delete d.is_easysdf;
      return deserializeScene([d])[0];
    }
  } catch {
    /* not ours */
  }
  return null;
}
/** gives a pasted item and its children new indexes (add_sdf_item does this as it rebuilds the tree) */
function reindex(item: SdfScene, next: () => number) {
  item.index = next();
  for (const c of item.children) reindex(c, next);
}

/** where the scene lives: the node itself, or the SDF builder's working copy */
export interface SdfSource {
  scene: SdfScene[];
  setScene: (s: SdfScene[]) => void;
}

export function SdfEditor({ gen, source, sel: selProp, setSel: setSelProp }: { gen: GenSDF; source?: SdfSource; sel?: number | null; setSel?: (n: number | null) => void }) {
  useEditor();
  const [selState, setSelState] = useState<number | null>(gen.scene[0]?.index ?? null);
  const sel = selProp !== undefined ? selProp : selState;
  const setSel = setSelProp ?? setSelState;
  const [addType, setAddType] = useState("");
  const [builder, setBuilder] = useState(false);
  const [, setClipTick] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const scene = source ? source.scene : gen.scene;
  const selected = sel !== null ? find(scene, sel) : null;

  /** edits a copy of the scene and gives it to the node (or to the builder's working copy) */
  const edit = (f: (s: SdfScene[]) => void) => {
    const copy = deserializeScene(serializeScene(scene));
    f(copy);
    if (source) source.setScene(copy);
    else gen.setSdfScene(copy);
  };

  const target = selected?.item ?? null;
  const allowed = validChildrenTypes(target, scene);
  const addable = SDF_ITEM_TYPES.filter((t) => allowed.includes(t.category));
  const groups = new Map<string, typeof addable>();
  for (const t of addable) groups.set(t.menu, [...(groups.get(t.menu) ?? []), t]);

  const add = (type: string) => {
    const n = newSceneItem(type, maxIndex(scene) + 1);
    edit((s) => {
      if (target) find(s, target.index)!.item.children.push(n);
      else s.push(n);
    });
    setSel(n.index);
  };

  const clip = readClipboard();
  const canPaste = !!clip && validChildrenTypes(target, scene).includes(categoryOf(clip));
  const paste = () => {
    const item = readClipboard();
    if (!item || !validChildrenTypes(target, scene).includes(categoryOf(item))) {
      editor.setStatus(tr("The copied SDF item cannot go here"));
      return;
    }
    let next = maxIndex(scene);
    reindex(item, () => ++next);
    edit((s) => {
      if (target) find(s, target.index)!.item.children.push(item);
      else s.push(item);
    });
    setSel(item.index);
  };

  const move = (index: number, op: "up" | "down" | "in" | "out" | "delete" | "hide") =>
    edit((s) => {
      const l = find(s, index);
      if (!l) return;
      const { list, i, item, parent, grandList } = l;
      switch (op) {
        case "up":
          if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
          break;
        case "down":
          if (i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
          break;
        case "in": {
          const prev = list[i - 1];
          if (prev && sdfItemType(prev.type)!.childrenTypes().includes(categoryOf(item))) {
            list.splice(i, 1);
            prev.children.push(item);
          }
          break;
        }
        case "out": {
          if (!parent || !grandList) break;
          const gp = grandList === s ? null : find(s, parent.index)!.parent;
          if (!validChildrenTypes(gp, s).includes(categoryOf(item))) break;
          list.splice(i, 1);
          grandList.splice(grandList.indexOf(parent) + 1, 0, item);
          break;
        }
        case "delete":
          list.splice(i, 1);
          break;
        case "hide":
          item.hidden = !item.hidden;
          break;
      }
    });

  // Ctrl+C / Ctrl+X / Ctrl+V / Delete in the tree, as in the builder window
  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const key = (e: KeyboardEvent) => {
      // typing in a field (renaming an item): the keys edit the text, not the tree
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "c" && selected) copyItem(selected.item);
      else if (mod && k === "x" && selected) {
        copyItem(selected.item);
        move(selected.item.index, "delete");
        setSel(null);
      } else if (mod && k === "v") paste();
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        move(selected.item.index, "delete");
        setSel(null);
      } else return;
      e.preventDefault();
      e.stopPropagation();
      setClipTick((x) => x + 1);
    };
    el.addEventListener("keydown", key);
    return () => el.removeEventListener("keydown", key);
  });

  const row = (s: SdfScene, depth: number): React.ReactNode => {
    const t = sdfItemType(s.type);
    return (
      <div key={s.index}>
        <div
          className={"sdf-row" + (s.index === sel ? " sel" : "") + (s.hidden ? " hidden" : "")}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => setSel(s.index)}
          onDoubleClick={() => {
            const n = prompt(tr("Item name"), s.name ?? s.type);
            if (n !== null) edit((sc) => void (find(sc, s.index)!.item.name = n && n !== s.type ? n : undefined));
          }}
          title={`${t?.menu ?? "?"}/${s.type} · n${s.index}`}
        >
          <span className="sdf-name">{s.name ?? s.type}</span>
          {s.name && <span className="sdf-type">{s.type}</span>}
          <span className="grow" />
          <button title={s.hidden ? tr("Show") : tr("Hide")} onClick={(e) => (e.stopPropagation(), move(s.index, "hide"))}>
            {s.hidden ? "◌" : "●"}
          </button>
          <button title={tr("Move up")} onClick={(e) => (e.stopPropagation(), move(s.index, "up"))}>
            ↑
          </button>
          <button title={tr("Move down")} onClick={(e) => (e.stopPropagation(), move(s.index, "down"))}>
            ↓
          </button>
          <button title={tr("Out of its parent")} onClick={(e) => (e.stopPropagation(), move(s.index, "out"))}>
            ⇤
          </button>
          <button title={tr("Into the item above")} onClick={(e) => (e.stopPropagation(), move(s.index, "in"))}>
            ⇥
          </button>
          <button
            title={tr("Delete")}
            onClick={(e) => {
              e.stopPropagation();
              move(s.index, "delete");
              if (sel === s.index) setSel(null);
            }}
          >
            ✕
          </button>
        </div>
        {s.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="sdf-editor">
      <div className="sect" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1 }}>{tr("Easy SDF scene")}{" "}{gen.getSceneType() ? `(${gen.getSceneType() === "SDF3D" ? "3D" : "2D"})` : ""}</span>
        {!source && (
          <button className="primary" onClick={() => setBuilder(true)} title={tr("The SDF builder window: previews with gizmos, node parameters and expressions")}>
            {tr("SDF builder…")}
          </button>
        )}
      </div>
      <div className="sdf-tree" ref={treeRef} tabIndex={0}>
        <div className={"sdf-row" + (sel === null ? " sel" : "")} onClick={() => setSel(null)} title={tr("Select to add items at the top level")}>
          <span className="sdf-type">{tr("Scene")}</span>
        </div>
        {scene.map((s) => row(s, 1))}
        {!scene.length && <div style={{ color: "var(--text3)", padding: "4px 8px" }}>{tr("Empty: add a 2D or 3D shape to start.")}</div>}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <select value={addType} onChange={(e) => setAddType(e.target.value)} style={{ flex: 1 }} disabled={!addable.length}>
          <option value="">{addable.length ? tr("Add to {0}…", target ? target.name ?? target.type : "the scene") : tr("Nothing can be added here")}</option>
          {[...groups.entries()].map(([g, ts]) => (
            <optgroup key={g} label={g}>
              {ts.map((t) => (
                <option key={t.itemType} value={t.itemType}>
                  {t.itemType}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          className="primary"
          disabled={!addType || !addable.some((t) => t.itemType === addType)}
          onClick={() => {
            add(addType);
            setAddType("");
          }}
        >
          {tr("Add")}
        </button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button disabled={!selected} title={tr("Copy the selected item (Ctrl+C)")} onClick={() => (copyItem(selected!.item), setClipTick((x) => x + 1))}>
          {tr("Copy")}
        </button>
        <button
          disabled={!selected}
          title={tr("Cut the selected item (Ctrl+X)")}
          onClick={() => {
            copyItem(selected!.item);
            move(selected!.item.index, "delete");
            setSel(null);
          }}
        >
          {tr("Cut")}
        </button>
        <button disabled={!canPaste} title={tr("Paste {0} into {1} (Ctrl+V)", clip ? clip.name ?? clip.type : "an item", target ? target.name ?? target.type : "the scene")} onClick={paste}>
          {tr("Paste")}
        </button>
      </div>
      {selected && <ItemParams gen={gen} item={selected.item} edit={edit} />}
      {builder && <SdfBuilder gen={gen} initialSel={sel} onClose={() => setBuilder(false)} />}
    </div>
  );
}

/** the selected item's parameters, through ParamControl (which edits a node's parameters: this adapter stands in for one).
 *  A float parameter can be replaced by an expression (ƒ), which may use the node's parameters ($param1...). */
function ItemParams({ gen, item, edit }: { gen: GenSDF; item: SdfScene; edit: (f: (s: SdfScene[]) => void) => void }) {
  const t = sdfItemType(item.type);
  const [exprOpen, setExprOpen] = useState<string | null>(null);
  if (!t) return <div className="err">{tr("Unknown item type")}{" "}{item.type}</div>;
  const defs = t.parameterDefs();
  const adapter = {
    getParameter: (n: string): ParamValue => (item.parameters[n] !== undefined ? item.parameters[n] : deserializeValue(defs.find((d) => d.name === n)?.default)),
    setParameter: (n: string, v: ParamValue) => edit((s) => void (find(s, item.index)!.item.parameters[n] = v)),
    acceptFloatExpressions: () => false,
  } as unknown as Gen;
  const setExpr = (name: string, value: string) =>
    edit((s) => {
      const it = find(s, item.index)!.item;
      const exprs = { ...(it.parmexprs ?? {}) };
      if (value.trim() === "") delete exprs[name];
      else exprs[name] = value;
      if (Object.keys(exprs).length) it.parmexprs = exprs;
      else delete it.parmexprs;
    });
  const named = gen.nodeParameters.map((p) => "$" + p.name).join(", ");
  return (
    <>
      <div className="sect">
        {item.name ?? item.type} <span style={{ textTransform: "none" }}>({t.menu})</span>
      </div>
      {!defs.length && <div style={{ color: "var(--text3)" }}>{tr("No parameters.")}</div>}
      {defs.map((d) => {
        const expr = item.parmexprs?.[d.name];
        const open = exprOpen === d.name || expr !== undefined;
        return (
          <div key={d.name}>
            <div className="row" style={d.type === "polygon" ? { gridTemplateColumns: "1fr" } : d.type === "float" ? { gridTemplateColumns: "110px 1fr auto" } : undefined}>
              <label title={d.name}>{paramLabel(d)}</label>
              {expr !== undefined ? <code className="sdf-expr-value" title={tr("Set by an expression")}>{expr}</code> : <ParamControl gen={adapter} def={d} />}
              {d.type === "float" && (
                <button className={"sdf-fx" + (expr !== undefined ? " on" : "")} title={expr !== undefined ? tr("Edit or remove the expression") : tr("Use an expression for this parameter")} onClick={() => setExprOpen(open && exprOpen === d.name ? null : d.name)}>
                  ƒ
                </button>
              )}
            </div>
            {open && exprOpen === d.name && (
              <div className="sdf-expr">
                <input
                  autoFocus
                  type="text"
                  defaultValue={expr ?? ""}
                  placeholder={named ? tr("GLSL, e.g. {0}*0.5", named.split(", ")[0]) : tr("GLSL expression")}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      setExpr(d.name, e.currentTarget.value);
                      setExprOpen(null);
                    }
                    if (e.key === "Escape") setExprOpen(null);
                  }}
                  onBlur={(e) => setExpr(d.name, e.currentTarget.value)}
                />
                <span style={{ color: "var(--text3)" }}>{named ? tr("Node parameters: {0}", named) : tr("Empty to use the value")}</span>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ color: "var(--text3)" }}>
        {tr("Contains:")}{" "}{t.childrenTypes().join(", ")}{" "}{tr("· node")}{" "}<code>{gen.name}</code>
      </div>
    </>
  );
}
