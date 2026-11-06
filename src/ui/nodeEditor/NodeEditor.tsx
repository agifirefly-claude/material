/* The node editor (material_maker/windows/node_editor) and material editor (windows/material_editor + export_editor):
 * a form over a shader node's model, with the JSON as an advanced view. For subgraphs, their name and descriptions. */
import { useMemo, useState } from "react";
import type { Dict, Gen } from "../../engine/gen/base";
import { GenShader } from "../../engine/gen/shader";
import { GenGraph } from "../../engine/gen/graph";
import { GenMaterial } from "../../engine/gen/misc";
import { GenContext } from "../../engine/context";
import { registry } from "../../engine/registry";
import { Curve, Gradient, Lattice, Pixels, Polygon, Splines, deserializeValue, serializeValue, type Color } from "../../engine/params/types";
import { editor } from "../store";
import { ColorEdit } from "../widgets/ColorEdit";
import { GradientEdit } from "../widgets/GradientEdit";
import { CurveEdit, LatticeEdit, PixelsEdit, PolygonEdit, SplinesEdit } from "../widgets/ShapeEdits";
import { FLOAT_CONTROLS, PARAMETER_TYPES, defaultsFor, draftFromModel, modelFromDraft, outputType } from "./model";
import { t, useLang } from "../i18n";

type Tab = "general" | "outputs" | "code" | "instance" | "global" | "preview" | "exports" | "json";

const ioTypes = () => Object.values(registry.ioTypes).filter((x) => x.label);

type T = Dict;
function Rows({ items, onChange, render, make, addLabel }: { items: T[]; onChange: (v: T[]) => void; render: (it: T, set: (v: T) => void, i: number) => React.ReactNode; make: () => T; addLabel: string }) {
  const move = (i: number, d: number) => {
    const a = [...items];
    const [x] = a.splice(i, 1);
    a.splice(i + d, 0, x);
    onChange(a);
  };
  return (
    <div className="ne-rows">
      {items.map((it, i) => (
        <div className="ne-row" key={i}>
          <div className="ne-row-tools">
            <button title={t("Delete")} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ✕
            </button>
            <button disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
          </div>
          <div className="ne-row-body">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}</div>
        </div>
      ))}
      <button onClick={() => onChange([...items, make()])}>+ {addLabel}</button>
    </div>
  );
}

const Field = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={"ne-field" + (wide ? " wide" : "")}>
    <span>{label}</span>
    {children}
  </label>
);
const Text = ({ value, onChange, mono, placeholder }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) => (
  <input type="text" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={mono ? { fontFamily: "ui-monospace, monospace" } : undefined} onKeyDown={(e) => e.stopPropagation()} />
);
const Num = ({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: number }) => (
  <input type="number" value={Number.isFinite(value) ? value : 0} step={step ?? "any"} onChange={(e) => onChange(+e.target.value)} style={{ width: 70 }} />
);
const Code = ({ value, onChange, rows = 20 }: { value: string; onChange: (v: string) => void; rows?: number }) => (
  <textarea className="ne-code" value={value ?? ""} rows={rows} spellCheck={false} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
);

/** the default value of a parameter, edited with the same widgets as the value */
function DefaultEdit({ p, set }: { p: Dict; set: (p: Dict) => void }) {
  const d = p.default;
  const setD = (v: unknown) => set({ ...p, default: v });
  switch (p.type) {
    case "float":
      return <Num value={d} onChange={setD} step={p.step} />;
    case "size":
    case "enum":
      return <Num value={d} onChange={setD} step={1} />;
    case "boolean":
      return <input type="checkbox" checked={!!d} onChange={(e) => setD(e.target.checked)} />;
    case "color":
      return <ColorEdit value={(deserializeValue(d) as Color) ?? { r: 1, g: 1, b: 1, a: 1 }} onChange={(c) => setD({ r: c.r, g: c.g, b: c.b, a: c.a })} />;
    case "gradient":
      return <GradientEdit value={Gradient.deserialize(d)} onChange={(g) => setD(serializeValue(g))} />;
    case "curve":
      return <CurveEdit value={Curve.deserialize(d)} onChange={(c) => setD(serializeValue(c))} />;
    case "polygon":
    case "polyline":
      return <PolygonEdit value={Polygon.deserialize(d)} closed={p.type === "polygon"} onChange={(c) => setD(serializeValue(c))} />;
    case "splines":
      return <SplinesEdit value={Splines.deserialize(d)} onChange={(c) => setD(serializeValue(c))} />;
    case "pixels":
      return <PixelsEdit value={Pixels.deserialize(d)} onChange={(c) => setD(serializeValue(c))} />;
    case "lattice":
      return <LatticeEdit value={Lattice.deserialize(d)} onChange={(c) => setD(serializeValue(c))} />;
  }
  return null;
}

function ParameterRow({ p, set }: { p: Dict; set: (p: Dict) => void }) {
  return (
    <>
      <div className="ne-line">
        <Field label={t("Name")}>
          <Text value={p.name} onChange={(v) => set({ ...p, name: v })} mono />
        </Field>
        <Field label={t("Label")}>
          <Text value={p.label} onChange={(v) => set({ ...p, label: v })} />
        </Field>
        <Field label={t("Type")}>
          <select value={p.type} onChange={(e) => set({ name: p.name, label: p.label, shortdesc: p.shortdesc, longdesc: p.longdesc, type: e.target.value, ...defaultsFor(e.target.value) })}>
            {PARAMETER_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        {p.type === "float" && (
          <>
            <Field label={t("Min")}>
              <Num value={p.min} onChange={(v) => set({ ...p, min: v })} />
            </Field>
            <Field label={t("Max")}>
              <Num value={p.max} onChange={(v) => set({ ...p, max: v })} />
            </Field>
            <Field label={t("Step")}>
              <Num value={p.step} onChange={(v) => set({ ...p, step: v })} />
            </Field>
            <Field label={t("Control")}>
              <select value={p.control ?? "None"} onChange={(e) => set({ ...p, control: e.target.value })}>
                {FLOAT_CONTROLS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        {p.type === "size" && (
          <>
            <Field label={t("First")}>
              <Num value={p.first} onChange={(v) => set({ ...p, first: v })} step={1} />
            </Field>
            <Field label={t("Last")}>
              <Num value={p.last} onChange={(v) => set({ ...p, last: v })} step={1} />
            </Field>
          </>
        )}
        {!["gradient", "curve", "polygon", "polyline", "splines", "pixels", "lattice"].includes(p.type) && (
          <Field label={t("Default")}>
            <DefaultEdit p={p} set={set} />
          </Field>
        )}
      </div>
      {p.type === "enum" && (
        <div className="ne-sub">
          <Rows
            items={p.values ?? []}
            onChange={(values) => set({ ...p, values })}
            make={() => ({ name: "Value", value: "value" })}
            addLabel={t("Value")}
            render={(v: Dict, sv) => (
              <div className="ne-line">
                <Field label={t("Name")}>
                  <Text value={v.name} onChange={(x) => sv({ ...v, name: x })} />
                </Field>
                <Field label={t("Value")} wide>
                  <Text value={v.value} onChange={(x) => sv({ ...v, value: x })} mono />
                </Field>
              </div>
            )}
          />
        </div>
      )}
      {["gradient", "curve", "polygon", "polyline", "splines", "pixels", "lattice"].includes(p.type) && (
        <div className="ne-sub">
          <span style={{ color: "var(--text3)" }}>{t("Default")}</span>
          <DefaultEdit p={p} set={set} />
        </div>
      )}
      <Descriptions o={p} set={set} />
    </>
  );
}

function Descriptions({ o, set }: { o: Dict; set: (o: Dict) => void }) {
  return (
    <div className="ne-line">
      <Field label={t("Short description")} wide>
        <Text value={o.shortdesc ?? ""} onChange={(v) => set({ ...o, shortdesc: v })} />
      </Field>
      <Field label={t("Long description")} wide>
        <Text value={o.longdesc ?? ""} onChange={(v) => set({ ...o, longdesc: v })} />
      </Field>
    </div>
  );
}

function InputRow({ i, set }: { i: Dict; set: (i: Dict) => void }) {
  return (
    <>
      <div className="ne-line">
        <Field label={t("Name")}>
          <Text value={i.name} onChange={(v) => set({ ...i, name: v })} mono />
        </Field>
        <Field label={t("Label")}>
          <Text value={i.label} onChange={(v) => set({ ...i, label: v })} />
        </Field>
        <Field label={t("Type")}>
          <select value={i.type} onChange={(e) => set({ ...i, type: e.target.value })}>
            {ioTypes().map((x) => (
              <option key={x.name} value={x.name}>
                {t(x.label ?? x.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Default value")} wide>
          <Text value={i.default} onChange={(v) => set({ ...i, default: v })} mono />
        </Field>
        <Field label={t("Function")}>
          <input type="checkbox" checked={!!i.function} onChange={(e) => set({ ...i, function: e.target.checked })} title={t("Generate input as function (can be used in instance functions)")} />
        </Field>
        <Field label={t("Port group")}>
          <Num value={i.group_size ?? 0} onChange={(v) => set({ ...i, group_size: v })} step={1} />
        </Field>
      </div>
      <Descriptions o={i} set={set} />
    </>
  );
}

function OutputRow({ o, set }: { o: Dict; set: (o: Dict) => void }) {
  const type = outputType(o);
  return (
    <>
      <div className="ne-line">
        <Field label={t("Type")}>
          <select
            value={type}
            onChange={(e) => {
              const n: Dict = { ...o, type: e.target.value, [e.target.value]: o[type] };
              delete n[type];
              n[e.target.value] = o[type];
              set(n);
            }}
          >
            {ioTypes().map((x) => (
              <option key={x.name} value={x.name}>
                {t(x.label ?? x.name)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Value")} wide>
          <Text value={o[type] ?? ""} onChange={(v) => set({ ...o, [type]: v })} mono />
        </Field>
        <Field label={t("Port group")}>
          <Num value={o.group_size ?? 0} onChange={(v) => set({ ...o, group_size: v })} step={1} />
        </Field>
      </div>
      <Descriptions o={o} set={set} />
    </>
  );
}

const FILE_TYPES = ["texture", "template", "buffers", "buffer_templates"];

/** export_editor: export targets of a material, each a list of files */
function ExportsEditor({ exports, set }: { exports: Dict; set: (e: Dict) => void }) {
  const names = Object.keys(exports).sort();
  const [cur, setCur] = useState(names[0] ?? "");
  const e = exports[cur];
  const setE = (v: Dict) => set({ ...exports, [cur]: v });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 10, minHeight: 300 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="ne-list">
          {names.map((n) => (
            <button key={n} className={n === cur ? "on" : ""} onClick={() => setCur(n)}>
              {n}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const n = prompt(t("Name of the export target"), "New export");
            if (n && !exports[n]) {
              set({ ...exports, [n]: { export_extension: "", files: [] } });
              setCur(n);
            }
          }}
        >
          + {t("Create")}
        </button>
        <button
          disabled={!e}
          onClick={() => {
            const n = prompt(t("Name of the copy"), cur + " copy");
            if (n && !exports[n]) {
              set({ ...exports, [n]: structuredClone(e) });
              setCur(n);
            }
          }}
        >
          {t("Duplicate")}
        </button>
        <button
          disabled={!e}
          onClick={() => {
            const n = prompt(t("New name"), cur);
            if (n && n !== cur && !exports[n]) {
              const x = { ...exports, [n]: e };
              delete x[cur];
              set(x);
              setCur(n);
            }
          }}
        >
          {t("Rename")}
        </button>
        <button
          disabled={!e}
          onClick={() => {
            const x = { ...exports };
            delete x[cur];
            set(x);
            setCur(Object.keys(x)[0] ?? "");
          }}
        >
          {t("Delete")}
        </button>
      </div>
      {e ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="ne-line">
            <Field label={t("Extension")}>
              <Text value={e.export_extension ?? ""} onChange={(v) => setE({ ...e, export_extension: v })} />
            </Field>
          </div>
          <Rows
            items={e.files ?? []}
            onChange={(files) => setE({ ...e, files })}
            make={() => ({ file_name: "$(path_prefix)_foo.png", type: "texture", output: 0 })}
            addLabel={t("File")}
            render={(f: Dict, sf) => (
              <>
                <div className="ne-line">
                  <Field label={t("Type")}>
                    <select value={f.type} onChange={(ev) => sf({ ...f, type: ev.target.value })}>
                      {FILE_TYPES.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("File name")} wide>
                    <Text value={f.file_name} onChange={(v) => sf({ ...f, file_name: v })} mono />
                  </Field>
                  <Field label={t("Conditions")} wide>
                    <Text value={f.conditions ?? ""} onChange={(v) => sf({ ...f, conditions: v || undefined })} mono placeholder="$(connected:albedo_tex)" />
                  </Field>
                  <Field label={t("Ask before overwriting")}>
                    <input type="checkbox" checked={!!f.prompt_overwrite} onChange={(ev) => sf({ ...f, prompt_overwrite: ev.target.checked })} />
                  </Field>
                </div>
                {f.type === "texture" && (
                  <div className="ne-line">
                    <Field label={t("Output")}>
                      <Num value={f.output ?? 0} onChange={(v) => sf({ ...f, output: v, expression: undefined })} step={1} />
                    </Field>
                    <Field label={t("or expression")} wide>
                      <Text value={f.expression ?? ""} onChange={(v) => sf({ ...f, expression: v || undefined, output: v ? undefined : 0 })} mono placeholder="rgb = $albedo_tex($uv)" />
                    </Field>
                  </div>
                )}
                {(f.type === "template" || f.type === "buffer_templates") && <Code value={f.template ?? ""} onChange={(v) => sf({ ...f, template: v })} rows={8} />}
              </>
            )}
          />
        </div>
      ) : (
        <div className="empty">{t("No export target")}</div>
      )}
    </div>
  );
}

function GraphEditor({ g, onClose }: { g: GenGraph; onClose: () => void }) {
  const [label, setLabel] = useState(g.label);
  const [shortdesc, setShort] = useState(g.shortdesc);
  const [longdesc, setLong] = useState(g.longdesc);
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
      <h2>{t("Edit graph")}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Field label={t("Name")} wide>
          <Text value={label} onChange={setLabel} />
        </Field>
        <Field label={t("Short description")} wide>
          <Text value={shortdesc} onChange={setShort} />
        </Field>
        <Field label={t("Long description")} wide>
          <textarea value={longdesc} rows={5} onChange={(e) => setLong(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </Field>
        <div style={{ color: "var(--text3)" }}>{t("The ports and parameters of a subgraph are its Inputs, Outputs and Parameters nodes: open the subgraph to edit them.")}</div>
        {g.isTemplate() && <div style={{ color: "var(--text3)" }}>{t("This subgraph comes from the library “{0}”: saving makes it a copy of its own.", g.model ?? "")}</div>}
      </div>
      <div className="ne-buttons">
        <button onClick={onClose}>{t("Cancel")}</button>
        <button
          className="primary"
          onClick={() => {
            g.label = label;
            g.shortdesc = shortdesc;
            g.longdesc = longdesc;
            g.model = null;
            g.editable = true;
            g.changed();
            editor.emit();
            onClose();
          }}
        >
          {t("OK")}
        </button>
      </div>
    </div>
  );
}

export function NodeEditor({ gen, onClose }: { gen: Gen; onClose: () => void }) {
  useLang();
  if (gen instanceof GenGraph && !(gen instanceof GenMaterial)) return <GraphEditor g={gen} onClose={onClose} />;
  if (!(gen instanceof GenShader)) return null;
  return <ShaderEditor gen={gen} onClose={onClose} />;
}

function ShaderEditor({ gen, onClose }: { gen: GenShader; onClose: () => void }) {
  const material = gen instanceof GenMaterial;
  const [d, setD] = useState<Dict>(() => draftFromModel(gen.shaderModel));
  const [tab, setTab] = useState<Tab>("general");
  const [json, setJson] = useState("");
  const [error, setError] = useState("");
  const set = (patch: Dict) => setD((x) => ({ ...x, ...patch }));
  const model = useMemo(() => modelFromDraft(d, material), [d, material]);
  const apply = (): boolean => {
    let m = model;
    if (tab === "json") {
      try {
        m = JSON.parse(json);
        setD(draftFromModel(m));
      } catch (e) {
        setError(t("Not valid JSON: {0}", String(e)));
        return false;
      }
    }
    gen.model = null;
    gen.editable = true;
    gen.setShaderModel(structuredClone(m));
    // check what the edited node compiles to
    const r = editor.renderer;
    setError("");
    if (r) {
      const outs = material ? gen.getOutputDefs(true) : gen.getOutputDefs();
      for (let i = 0; i < outs.length; i++) {
        const err = r.check(gen.getShaderCode("uv", i, new GenContext()));
        if (err) {
          setError(t("Output {0} does not compile: {1}", i, err.log.split("\n").find((l) => l.includes("ERROR")) ?? err.message));
          editor.emit();
          return false;
        }
      }
    }
    editor.emit();
    return true;
  };
  const tabs: [Tab, string][] = [
    ["general", t("General")],
    ["outputs", t("Outputs")],
    ["code", t("Main Code")],
    ["instance", t("Instance Functions")],
    ["global", t("Global Functions")],
    ...(material ? ([["preview", t("Preview")], ["exports", t("Export")]] as [Tab, string][]) : []),
    ["json", "JSON"],
  ];
  return (
    <div className="modal ne" onClick={(e) => e.stopPropagation()}>
      <h2>
        {material ? t("Material editor") : t("Node editor")} — {gen.getTypeName()}
      </h2>
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            className={tab === k ? "on" : ""}
            onClick={() => {
              if (k === "json") setJson(JSON.stringify(model, null, 2));
              if (tab === "json" && k !== "json") {
                try {
                  setD(draftFromModel(JSON.parse(json)));
                } catch {
                  /* keep the form */
                }
              }
              setTab(k);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="ne-body">
        {tab === "general" && (
          <>
            <div className="ne-line">
              <Field label={t("Name")}>
                <Text value={d.name ?? ""} onChange={(v) => set({ name: v })} />
              </Field>
              <Field label={t("Short description")} wide>
                <Text value={d.shortdesc ?? ""} onChange={(v) => set({ shortdesc: v })} />
              </Field>
            </div>
            <Field label={t("Long description")} wide>
              <textarea value={d.longdesc ?? ""} rows={3} onChange={(e) => set({ longdesc: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            </Field>
            <div className="sect">{t("Parameters")}</div>
            <Rows items={d.parameters} onChange={(parameters) => set({ parameters })} make={() => ({ name: "param", label: "Param", type: "float", ...defaultsFor("float") })} addLabel={t("Parameter")} render={(p: Dict, sp) => <ParameterRow p={p} set={sp} />} />
            <div className="sect">{t("Inputs")}</div>
            <Rows items={d.inputs} onChange={(inputs) => set({ inputs })} make={() => ({ name: "in", label: "", type: "rgba", default: "vec4(0.0)" })} addLabel={t("Input")} render={(i: Dict, si) => <InputRow i={i} set={si} />} />
          </>
        )}
        {tab === "outputs" && <Rows items={d.outputs} onChange={(outputs) => set({ outputs })} make={() => ({ type: "rgba", rgba: "vec4(1.0)" })} addLabel={t("Output")} render={(o: Dict, so) => <OutputRow o={o} set={so} />} />}
        {tab === "code" && <Code value={d.code ?? ""} onChange={(v) => set({ code: v })} />}
        {tab === "instance" && <Code value={d.instance ?? ""} onChange={(v) => set({ instance: v })} />}
        {tab === "global" && (
          <>
            <Field label={t("Includes")} wide>
              <Text value={d.includes ?? ""} onChange={(v) => set({ includes: v })} mono placeholder="perlin, fbm2" />
            </Field>
            <Code value={d.global ?? ""} onChange={(v) => set({ global: v })} />
          </>
        )}
        {tab === "preview" && <Code value={d.preview_shader ?? ""} onChange={(v) => set({ preview_shader: v })} rows={26} />}
        {tab === "exports" && <ExportsEditor exports={d.exports ?? {}} set={(exports) => set({ exports })} />}
        {tab === "json" && <Code value={json} onChange={setJson} rows={28} />}
      </div>
      {error && <div className="err" style={{ color: "var(--danger)", whiteSpace: "pre-wrap" }}>{error}</div>}
      <div className="ne-buttons">
        <span style={{ color: "var(--text3)", flex: 1 }}>{gen.isTemplate() ? t("This node comes from the library: applying makes it a node of its own.") : ""}</span>
        <button onClick={onClose}>{t("Cancel")}</button>
        <button onClick={() => apply()}>{t("Apply")}</button>
        <button className="primary" onClick={() => apply() && onClose()}>
          {t("OK")}
        </button>
      </div>
    </div>
  );
}
