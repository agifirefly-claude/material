/* The Easy SDF scene editor (Material Maker's material_maker/windows/sdf_builder), shown in the inspector:
 * the scene as a tree of items, an add menu filtered by what the selected item may contain, and the selected
 * item's parameters. Every edit rebuilds the node's shader through GenSDF.setSdfScene. */
import { useState } from "react";
import type { Gen } from "../engine/gen/base";
import type { GenSDF } from "../engine/gen/sdf";
import { deserializeValue, type ParamValue } from "../engine/params/types";
import { SDF_ITEM_TYPES, deserializeScene, newSceneItem, sdfItemType, serializeScene, validChildrenTypes, type SdfScene } from "../engine/sdf/builder";
import { ParamControl, paramLabel } from "./widgets/ParamControl";
import { useEditor } from "./store";

type Loc = { list: SdfScene[]; i: number; item: SdfScene; parent: SdfScene | null; grandList: SdfScene[] | null };

function find(scene: SdfScene[], index: number, parent: SdfScene | null = null, grandList: SdfScene[] | null = null): Loc | null {
  for (let i = 0; i < scene.length; i++) {
    const item = scene[i];
    if (item.index === index) return { list: scene, i, item, parent, grandList };
    const r = find(item.children, index, item, scene);
    if (r) return r;
  }
  return null;
}
function maxIndex(scene: SdfScene[]): number {
  return scene.reduce((m, s) => Math.max(m, s.index, maxIndex(s.children)), 0);
}
const categoryOf = (s: SdfScene) => sdfItemType(s.type)?.category ?? "";

export function SdfEditor({ gen }: { gen: GenSDF }) {
  useEditor();
  const [sel, setSel] = useState<number | null>(gen.scene[0]?.index ?? null);
  const [addType, setAddType] = useState("");
  const scene = gen.scene;
  const selected = sel !== null ? find(scene, sel) : null;

  /** edits a copy of the scene and gives it to the node */
  const edit = (f: (s: SdfScene[]) => void) => {
    const copy = deserializeScene(serializeScene(gen.scene));
    f(copy);
    gen.setSdfScene(copy);
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

  const row = (s: SdfScene, depth: number): React.ReactNode => {
    const t = sdfItemType(s.type);
    return (
      <div key={s.index}>
        <div
          className={"sdf-row" + (s.index === sel ? " sel" : "") + (s.hidden ? " hidden" : "")}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => setSel(s.index)}
          onDoubleClick={() => {
            const n = prompt("Item name", s.name ?? s.type);
            if (n !== null) edit((sc) => void (find(sc, s.index)!.item.name = n || undefined));
          }}
          title={`${t?.menu ?? "?"}/${s.type} · n${s.index}`}
        >
          <span className="sdf-name">{s.name ?? s.type}</span>
          {s.name && <span className="sdf-type">{s.type}</span>}
          <span className="grow" />
          <button title={s.hidden ? "Show" : "Hide"} onClick={(e) => (e.stopPropagation(), move(s.index, "hide"))}>
            {s.hidden ? "◌" : "●"}
          </button>
          <button title="Move up" onClick={(e) => (e.stopPropagation(), move(s.index, "up"))}>
            ↑
          </button>
          <button title="Move down" onClick={(e) => (e.stopPropagation(), move(s.index, "down"))}>
            ↓
          </button>
          <button title="Out of its parent" onClick={(e) => (e.stopPropagation(), move(s.index, "out"))}>
            ⇤
          </button>
          <button title="Into the item above" onClick={(e) => (e.stopPropagation(), move(s.index, "in"))}>
            ⇥
          </button>
          <button
            title="Delete"
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
        <span style={{ flex: 1 }}>Easy SDF scene {gen.getSceneType() ? `(${gen.getSceneType() === "SDF3D" ? "3D" : "2D"})` : ""}</span>
      </div>
      <div className="sdf-tree">
        <div className={"sdf-row" + (sel === null ? " sel" : "")} onClick={() => setSel(null)} title="Select to add items at the top level">
          <span className="sdf-type">Scene</span>
        </div>
        {scene.map((s) => row(s, 1))}
        {!scene.length && <div style={{ color: "var(--text3)", padding: "4px 8px" }}>Empty: add a 2D or 3D shape to start.</div>}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <select value={addType} onChange={(e) => setAddType(e.target.value)} style={{ flex: 1 }} disabled={!addable.length}>
          <option value="">{addable.length ? `Add to ${target ? target.name ?? target.type : "the scene"}…` : "Nothing can be added here"}</option>
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
          Add
        </button>
      </div>
      {selected && <ItemParams gen={gen} item={selected.item} edit={edit} />}
    </div>
  );
}

/** the selected item's parameters, through ParamControl (which edits a node's parameters: this adapter stands in for one) */
function ItemParams({ gen, item, edit }: { gen: GenSDF; item: SdfScene; edit: (f: (s: SdfScene[]) => void) => void }) {
  const t = sdfItemType(item.type);
  if (!t) return <div className="err">Unknown item type {item.type}</div>;
  const defs = t.parameterDefs();
  const adapter = {
    getParameter: (n: string): ParamValue => (item.parameters[n] !== undefined ? item.parameters[n] : deserializeValue(defs.find((d) => d.name === n)?.default)),
    setParameter: (n: string, v: ParamValue) => edit((s) => void (find(s, item.index)!.item.parameters[n] = v)),
    acceptFloatExpressions: () => false,
  } as unknown as Gen;
  return (
    <>
      <div className="sect">
        {item.name ?? item.type} <span style={{ textTransform: "none" }}>({t.menu})</span>
      </div>
      {!defs.length && <div style={{ color: "var(--text3)" }}>No parameters.</div>}
      {defs.map((d) => (
        <div key={d.name} className="row" style={d.type === "polygon" ? { gridTemplateColumns: "1fr" } : undefined}>
          <label title={d.name}>{paramLabel(d)}</label>
          <ParamControl gen={adapter} def={d} />
        </div>
      ))}
      <div style={{ color: "var(--text3)" }}>
        Contains: {t.childrenTypes().join(", ")} · node <code>{gen.name}</code>
      </div>
    </>
  );
}
