import { useMemo, useState } from "react";
import type React from "react";
import { editor, useEditor } from "./store";
import type { Gen, PortDef } from "../engine/gen/base";
import { GenShader } from "../engine/gen/shader";
import { GenGraph, GenIOs, GenRemote } from "../engine/gen/graph";
import { GenMaterial } from "../engine/gen/misc";
import { GenContext } from "../engine/context";
import { registry } from "../engine/registry";
import { buildFragmentShader, withPreview } from "../engine/render/shader-source";
import { ParamControl, paramLabel } from "./widgets/ParamControl";
import { portColor, portLabel } from "./NodeView";
import { GenSDF } from "../engine/gen/sdf";
import { SdfEditor } from "./SdfEditor";
import { openDialog } from "./dialogs/bus";
import { t, tDesc, useLang } from "./i18n";

const KW = /\b(if|else|for|while|return|const|uniform|in|out|inout|break|continue|true|false|discard)\b/;
const TY = /\b(void|float|int|bool|[iub]?vec[234]|mat[234]|sampler2D)\b/;
/** a light GLSL highlighter, enough to read generated code */
export function Code({ text, max }: { text: string; max?: number }) {
  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(\$\(?[\w?]+\)?)|(\b\d+\.?\d*(?:e[+-]?\d+)?\b)|(\b\w+\b)/g;
    let last = 0;
    let k = 0;
    for (const m of text.matchAll(re)) {
      if (m.index! > last) out.push(text.slice(last, m.index));
      const [s] = m;
      const cls = m[1] ? "com" : m[2] ? "var" : m[3] ? "num" : KW.test(s) ? "kw" : TY.test(s) ? "ty" : null;
      out.push(cls ? (
        <span key={k++} className={cls}>
          {s}
        </span>
      ) : s);
      last = m.index! + s.length;
    }
    out.push(text.slice(last));
    return out;
  }, [text]);
  return (
    <pre className="code" style={max ? { maxHeight: max } : undefined}>
      {parts}
    </pre>
  );
}

function copy(text: string) {
  navigator.clipboard?.writeText(text);
  editor.setStatus(t("Copied to the clipboard"));
}

export function Inspector() {
  useEditor();
  useLang();
  const g = editor.selected;
  const [tab, setTab] = useState<"params" | "info" | "code">("params");
  if (!g)
    return (
      <div className="scroll" style={{ flex: 1 }}>
        <GraphParameters graph={editor.graph} />
        <GraphInfo graph={editor.graph} />
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="tabs">
        {(
          [
            ["params", "Parameters"],
            ["info", "Ports & info"],
            ["code", "Code analysis"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {t(l)}
          </button>
        ))}
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {tab === "params" && <Params g={g} />}
        {tab === "info" && <Info g={g} />}
        {tab === "code" && <CodeTab g={g} />}
      </div>
    </div>
  );
}

function Header({ g }: { g: Gen }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{t(g.getTypeName())}</div>
      <div style={{ color: "var(--text3)" }}>
        {g.name} · {g.model ? t("library node “{0}”", g.model) : g.getType()}
        {g.getHierName() && g.getHierName() !== g.name ? ` · ${g.getHierName()}` : ""}
      </div>
    </div>
  );
}

function Params({ g }: { g: Gen }) {
  const defs = g.getParameterDefs();
  return (
    <div className="insp">
      <Header g={g} />
      {g.getDescription() && <div className="desc">{tDesc(g.getDescription())}</div>}
      {(g instanceof GenShader || (g instanceof GenGraph && !(g instanceof GenMaterial))) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button onClick={() => openDialog("edit-node", g)}>{g instanceof GenMaterial ? t("Edit material…") : g instanceof GenGraph ? t("Edit graph…") : t("Edit node…")}</button>
          {g.isTemplate() && <button onClick={() => (g.toggleEditable(), g.changed())} title={t("Make editable (detach from the library)")}>{t("Make editable")}</button>}
          <button onClick={() => openDialog("add-to-library", g)}>{t("Add to a library…")}</button>
        </div>
      )}
      {defs.length === 0 && <div style={{ color: "var(--text3)" }}>{t("This node has no parameters.")}</div>}
      {defs.map((d) => (
        <div key={d.name} className="row" style={["curve", "polygon", "polyline", "lattice", "splines", "pixels", "gradient"].includes(d.type) ? { gridTemplateColumns: "1fr" } : undefined}>
          <label title={[d.name, tDesc(d.shortdesc), tDesc(d.longdesc)].filter(Boolean).join("\n")}>{paramLabel(d)}</label>
          <ParamControl gen={g} def={d} />
        </div>
      ))}
      {g.hasRandomness() && (
        <div className="row">
          <label>{t("Seed")}</label>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <code>{g.seedValue.toFixed(5)}</code>
            <button onClick={() => g.setSeed(Math.random())}>{t("Randomize")}</button>
            <label style={{ display: "flex", gap: 4 }}>
              <input type="checkbox" checked={g.seedLocked} onChange={(e) => ((g.seedLocked = e.target.checked), g.changed())} /> {t("locked")}
            </label>
          </div>
        </div>
      )}
      {g instanceof GenShader && g.isGeneric() && (
        <div className="row">
          <label>{t("Generic inputs")}</label>
          <input type="number" min={1} max={16} value={g.genericSize} onChange={(e) => g.setGenericSize(Math.max(1, +e.target.value))} />
        </div>
      )}
      {g instanceof GenSDF && <SdfEditor gen={g} />}
      {g instanceof GenRemote && <RemoteEditor r={g} />}
      {g instanceof GenIOs && <IOsEditor ios={g} />}
      {g instanceof GenGraph && !(g instanceof GenMaterial) && (
        <button onClick={() => editor.enter(g.name)} className="primary">
          {t("Open this subgraph ({0} nodes)", g.children.length)}
        </button>
      )}
    </div>
  );
}

function PortTable({ ports, output, g }: { ports: PortDef[]; output: boolean; g: Gen }) {
  if (!ports.length) return <div style={{ color: "var(--text3)" }}>{t("None")}</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>{t("Name")}</th>
          <th>{t("Type")}</th>
          <th>{output ? t("Goes to") : t("Comes from")}</th>
        </tr>
      </thead>
      <tbody>
        {ports.map((p, i) => {
          const links = output ? g.getTargets(i).map((t) => `${t.generator.name}.${portLabel(t.generator.getInputDefs()[t.inputIndex] ?? { type: "" }, t.inputIndex, false)}`) : [];
          const src = output ? null : g.getSource(i);
          return (
            <tr key={i} title={p.longdesc ?? ""}>
              <td>{i}</td>
              <td>{portLabel(p, i, output) || "—"}</td>
              <td>
                <span className="dot" style={{ background: portColor(p.type) }} />
                {registry.ioTypes[p.type]?.label ?? p.type}
              </td>
              <td>
                {output ? links.join(", ") || "—" : src ? `${src.generator.getHierName() || src.generator.name}.out${src.outputIndex}` : <span style={{ color: "var(--text3)" }}>{t("default:")}{" "}{String(p.default ?? "—")}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Info({ g }: { g: Gen }) {
  const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
  return (
    <div className="insp">
      <Header g={g} />
      {g.getDescription() && <div className="desc">{tDesc(g.getDescription())}</div>}
      <div className="sect">{t("Inputs")}</div>
      <PortTable ports={g.getInputDefs()} output={false} g={g} />
      <div className="sect">{g instanceof GenMaterial ? t("Texture maps") : t("Outputs")}</div>
      <PortTable ports={outs} output g={g} />
      <div className="sect">{t("Upstream (what this node is computed from)")}</div>
      <Upstream g={g} />
    </div>
  );
}

/** the tree of nodes feeding a node, across subgraph boundaries */
function Upstream({ g }: { g: Gen }) {
  const seen = new Set<Gen>();
  const walk = (n: Gen, depth: number): React.ReactNode[] => {
    if (depth > 12) return [];
    const rows: React.ReactNode[] = [];
    n.getInputDefs().forEach((p, i) => {
      const s = n.getSource(i);
      if (!s) return;
      const repeat = seen.has(s.generator);
      seen.add(s.generator);
      rows.push(
        <div key={`${n.id}-${i}-${depth}`} style={{ paddingLeft: depth * 12, whiteSpace: "nowrap" }}>
          <span className="dot" style={{ background: portColor(p.type) }} />
          <span style={{ color: "var(--text3)" }}>{portLabel(p, i, false)} ←</span>{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              selectAnywhere(s.generator);
            }}
          >
            {t(s.generator.getTypeName())}
          </a>{" "}
          <span style={{ color: "var(--text3)" }}>
            {s.generator.getHierName() || s.generator.name}
            {repeat ? t(" (see above)") : ""}
          </span>
        </div>,
      );
      if (!repeat) rows.push(...walk(s.generator, depth + 1));
    });
    return rows;
  };
  const rows = walk(g, 0);
  return rows.length ? <div>{rows}</div> : <div style={{ color: "var(--text3)" }}>{t("Nothing is connected to this node's inputs.")}</div>;
}

/** opens the graph a node is in and selects it */
export function selectAnywhere(g: Gen) {
  const path: string[] = [];
  let p = g.parent as unknown as GenGraph | null;
  while (p && p.parent) {
    path.unshift(p.name);
    p = p.parent as unknown as GenGraph;
  }
  editor.path = path;
  editor.selection = [g.name];
  editor.emit();
}

function CodeTab({ g }: { g: Gen }) {
  const outs = g instanceof GenMaterial ? g.getOutputDefs(true) : g.getOutputDefs();
  const [out, setOut] = useState(0);
  const [full, setFull] = useState(false);
  const o = Math.min(out, Math.max(0, outs.length - 1));
  const generated = useMemo(() => {
    if (!outs.length) return null;
    try {
      const sc = g.getShaderCode("uv", o, new GenContext());
      const built = buildFragmentShader(withPreview(sc, 256));
      return { sc, built };
    } catch (e) {
      return { error: String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, o, editor.version]);
  return (
    <div className="insp">
      <Header g={g} />
      {g instanceof GenShader && <ShaderModel g={g} />}
      {g instanceof GenGraph && !(g instanceof GenMaterial) && <GraphInfo graph={g} embedded />}
      {outs.length > 0 && (
        <>
          <div className="sect">{t("Generated GLSL")}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select value={o} onChange={(e) => setOut(+e.target.value)}>
              {outs.map((p, i) => (
                <option key={i} value={i}>
                  {t("Output")}{" "}{i}: {portLabel(p, i, true) || p.type}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 4 }}>
              <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />{" "}{t("whole shader")}
            </label>
            {generated && "built" in generated && generated.built && <button onClick={() => copy(full ? generated.built.source : generated.built.body)}>{t("Copy")}</button>}
          </div>
          {generated && "error" in generated && <div className="err">{generated.error}</div>}
          {generated && "built" in generated && generated.built && (
            <>
              <div style={{ color: "var(--text3)" }}>
                {generated.sc!.uniforms.length}{" "}{t("uniforms ·")}{" "}{generated.sc!.globals.length}{" "}{t("global blocks · output type")}{" "}{registry.ioTypes[generated.sc!.outputType]?.label ?? generated.sc!.outputType}
              </div>
              <Code text={full ? generated.built.source : generated.built.body} max={520} />
              {generated.sc!.uniforms.length > 0 && (
                <>
                  <div className="sect">{t("Uniforms (live values)")}</div>
                  <table>
                    <tbody>
                      {generated.built.uniforms.map((u) => (
                        <tr key={u.name}>
                          <td>
                            <code>{u.name}</code>
                          </td>
                          <td>{u.type + (u.size ? `[${u.size}]` : "")}</td>
                          <td style={{ wordBreak: "break-all" }}>{fmtValue(u.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (typeof v === "number") return +v.toFixed(5) + "";
  if (Array.isArray(v)) return v.length > 12 ? `[${v.slice(0, 12).map((x) => +(+x).toFixed(3)).join(", ")}, …]` : `[${v.map((x) => +(+x).toFixed(3)).join(", ")}]`;
  if (typeof v === "function") return "(set while rendering)";
  if (v && typeof v === "object" && "key" in v) return "texture " + (v as { key: string }).key;
  if (v && typeof v === "object") {
    // gradients, curves, colours...: their saved form, shortened
    const o = v as { serialize?: () => unknown };
    const s = JSON.stringify(typeof o.serialize === "function" ? o.serialize() : v);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  }
  return String(v);
}

function ShaderModel({ g }: { g: GenShader }) {
  const sm = g.shaderModel;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <>
      <div className="sect" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1 }}>{t("Shader model")} {g.model ? t("(from the library: {0})", g.model) : t("(custom)")}</span>
        {!edit ? (
          <>
            <button onClick={() => openDialog("edit-node", g)}>{t("Edit…")}</button>
            <button
              title={t("Edit the model as JSON")}
              onClick={() => {
                setDraft(JSON.stringify(sm, null, 2));
                setEdit(true);
              }}
            >
              {t("JSON")}
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              onClick={() => {
                try {
                  const d = JSON.parse(draft);
                  g.model = null;
                  g.setShaderModel(d);
                  setEdit(false);
                } catch (e) {
                  alert(t("Not valid JSON: {0}", e));
                }
              }}
            >
              {t("Apply")}
            </button>
            <button onClick={() => setEdit(false)}>{t("Cancel")}</button>
          </>
        )}
      </div>
      {edit ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} spellCheck={false} onKeyDown={(e) => e.stopPropagation()} />
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{t("Parameter")}</th>
                <th>{t("Type")}</th>
                <th>{t("Value used in code")}</th>
              </tr>
            </thead>
            <tbody>
              {g.getParameterDefs().map((p) => (
                <tr key={p.name}>
                  <td>
                    <code>${p.name}</code>
                  </td>
                  <td>{p.type}</td>
                  <td style={{ wordBreak: "break-all" }}>{p.type === "enum" ? (p.values?.[Number(g.parameters[p.name] ?? 0)]?.value ?? "") : fmtValue(g.parameters[p.name] as unknown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(sm.inputs ?? []).length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t("Input")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Default when unconnected")}</th>
                </tr>
              </thead>
              <tbody>
                {(sm.inputs ?? []).map((p: PortDef) => (
                  <tr key={p.name}>
                    <td>
                      <code>${p.name}(uv)</code>
                      {p.function ? " ƒ" : ""}
                    </td>
                    <td>{p.type}</td>
                    <td>
                      <code>{String(p.default ?? "")}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(sm.outputs ?? []).map((o: Record<string, string>, i: number) => (
            <div key={i}>
              <div style={{ color: "var(--text3)" }}>
                {t("Output")}{" "}{i} ({o.type}){o.shortdesc ? ` — ${o.shortdesc}` : ""}
              </div>
              <Code text={o[o.type] ?? ""} />
            </div>
          ))}
          {sm.code && (
            <>
              <div style={{ color: "var(--text3)" }}>{t("Code (run per pixel before the outputs)")}</div>
              <Code text={sm.code} max={260} />
            </>
          )}
          {sm.instance && (
            <>
              <div style={{ color: "var(--text3)" }}>{t("Instance (functions specific to this node)")}</div>
              <Code text={sm.instance} max={260} />
            </>
          )}
          {sm.global && (
            <>
              <div style={{ color: "var(--text3)" }}>{t("Global (shared functions)")}</div>
              <Code text={sm.global} max={260} />
            </>
          )}
          {(sm.includes ?? []).length > 0 && <div style={{ color: "var(--text3)" }}>{t("Includes the globals of:")}{" "}{sm.includes.join(", ")}</div>}
        </>
      )}
    </>
  );
}

/** Statistics of a graph: which node types it uses and how they connect */
function GraphInfo({ graph, embedded }: { graph: GenGraph; embedded?: boolean }) {
  useEditor();
  const stats = useMemo(() => {
    const types = new Map<string, number>();
    let total = 0,
      links = 0,
      subgraphs = 0;
    const walk = (g: GenGraph) => {
      links += g.connections.length;
      for (const c of g.children) {
        total++;
        const k = c.model ?? c.getType();
        types.set(k, (types.get(k) ?? 0) + 1);
        if (c instanceof GenGraph) {
          subgraphs++;
          walk(c);
        }
      }
    };
    walk(graph);
    return { types: [...types.entries()].sort((a, b) => b[1] - a[1]), total, links, subgraphs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, editor.version]);
  return (
    <div className={embedded ? "" : "insp"}>
      {!embedded && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{graph === editor.root ? editor.title : t(graph.getTypeName())}</div>
          <div style={{ color: "var(--text3)" }}>{t("Select a node to see its parameters, ports and generated code.")}</div>
        </>
      )}
      <div className="sect">{t("Graph analysis (including subgraphs)")}</div>
      <div>
        {stats.total}{" "}{t("nodes ·")}{" "}{stats.links}{" "}{t("connections ·")}{" "}{stats.subgraphs}{" "}{t("subgraphs")}
      </div>
      <table>
        <tbody>
          {stats.types.map(([k, n]) => (
            <tr key={k}>
              <td>{k}</td>
              <td style={{ textAlign: "right" }}>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RemoteEditor({ r }: { r: GenRemote }) {
  const graph = r.parent as unknown as GenGraph;
  const [node, setNode] = useState("");
  const [param, setParam] = useState("");
  const target = graph?.getNode(node);
  return (
    <>
      <div className="sect">{t("Controls")}</div>
      {r.widgets.map((w) => (
        <div key={w.name} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <code>{w.name}</code>
          <span style={{ color: "var(--text3)" }}>{w.type}</span>
          <input type="text" value={w.label ?? ""} onChange={(e) => ((w.label = e.target.value), r.changed())} style={{ flex: 1 }} />
          <button onClick={() => r.removeParameter(w.name)}>✕</button>
          {w.linked_widgets?.length > 0 && <div style={{ color: "var(--text3)", width: "100%" }}>→ {w.linked_widgets.map((l: { node: string; widget: string }) => `${l.node}.${l.widget}`).join(", ")}</div>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <button onClick={() => r.createNamedParameter("Parameter")}>{t("+ Named parameter")}</button>
        <select value={node} onChange={(e) => (setNode(e.target.value), setParam(""))}>
          <option value="">{t("Link a node's parameter…")}</option>
          {graph?.children.filter((c) => c !== r && c.getParameterDefs().length).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.getTypeName()})
            </option>
          ))}
        </select>
        {target && (
          <select value={param} onChange={(e) => setParam(e.target.value)}>
            <option value="">{t("parameter…")}</option>
            {target.getParameterDefs().map((p) => (
              <option key={p.name} value={p.name}>
                {paramLabel(p)}
              </option>
            ))}
          </select>
        )}
        <button
          disabled={!target || !param}
          onClick={() => {
            const w = r.createLinkedControl(paramLabel(target!.getParameterDef(param)!));
            r.linkParameter(w, target!, param);
            setParam("");
          }}
        >
          {t("Link")}
        </button>
      </div>
    </>
  );
}

function IOsEditor({ ios }: { ios: GenIOs }) {
  const types = Object.values(registry.ioTypes).filter((t) => t.label);
  const changed = () => {
    ios.changed();
    (ios.parent as unknown as GenGraph)?.parent?.notifyChanged();
  };
  return (
    <>
      <div className="sect">{ios.name === "gen_inputs" ? t("Subgraph inputs") : t("Subgraph outputs")}</div>
      {ios.ports.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 4 }}>
          <input type="text" value={p.name ?? ""} onChange={(e) => ((p.name = e.target.value), changed())} style={{ flex: 1 }} />
          <select value={p.type} onChange={(e) => ((p.type = e.target.value), changed())}>
            {types.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              ios.ports.splice(i, 1);
              changed();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => (ios.ports.push({ name: "port" + ios.ports.length, type: "rgba" }), changed())}>{t("+ Port")}</button>
    </>
  );
}

/** Material Maker's parameters panel: the controls of the open graph's parameters node */
function GraphParameters({ graph }: { graph: GenGraph }) {
  const defs = graph.getParameterDefs();
  if (!defs.length) return null;
  return (
    <div className="insp" style={{ paddingBottom: 0 }}>
      <div className="sect">{t("Parameters")}</div>
      {defs.map((d) => (
        <div key={d.name} className="row" style={["curve", "polygon", "polyline", "lattice", "splines", "pixels", "gradient"].includes(d.type) ? { gridTemplateColumns: "1fr" } : undefined}>
          <label title={[d.name, d.shortdesc, d.longdesc].filter(Boolean).join("\n")}>{t(paramLabel(d))}</label>
          <ParamControl gen={graph} def={d} />
        </div>
      ))}
    </div>
  );
}
