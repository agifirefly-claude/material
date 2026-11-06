// Compares the node library (library/) with a Material Maker checkout, for a human to review.
// Material Maker is only a reference: this script never writes anything. See docs/节点库维护.md.
//
//   node scripts/compare-reference.mjs <path to a material-maker checkout> [--detail <node>] [--json]
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith("--"));
const detail = args.includes("--detail") ? args[args.indexOf("--detail") + 1] : null;
const asJson = args.includes("--json");
if (!ref || !fs.existsSync(path.join(ref, "addons/material_maker/nodes"))) {
  console.error("usage: node scripts/compare-reference.mjs <material-maker checkout> [--detail <node>] [--json]");
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const lib = path.join(root, "library");
const read = (p) => JSON5.parse(fs.readFileSync(p, "utf8"));
const lines = (v) => (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : JSON.stringify(v));

function list(dir, ext) {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => f.slice(0, -ext.length))
        .sort()
    : [];
}

/** what differs between two node definitions, field by field */
function nodeDiff(a, b) {
  const out = [];
  const sa = a.shader_model ?? {},
    sb = b.shader_model ?? {};
  if ((a.type ?? "shader") !== (b.type ?? "shader")) out.push(`type ${a.type} → ${b.type}`);
  for (const k of ["code", "global", "instance", "preview_shader"]) if (lines(sa[k] ?? "") !== lines(sb[k] ?? "")) out.push(k);
  const names = (arr, key = "name") => (arr ?? []).map((x) => x[key] ?? x.type);
  for (const k of ["parameters", "inputs"]) {
    const na = names(sa[k]),
      nb = names(sb[k]);
    const added = nb.filter((n) => !na.includes(n)),
      removed = na.filter((n) => !nb.includes(n));
    if (added.length) out.push(`${k} +${added.join(",")}`);
    if (removed.length) out.push(`${k} -${removed.join(",")}`);
    if (!added.length && !removed.length && JSON.stringify(sa[k] ?? []) !== JSON.stringify(sb[k] ?? [])) out.push(`${k} changed`);
  }
  if (JSON.stringify(sa.outputs ?? []) !== JSON.stringify(sb.outputs ?? [])) out.push("outputs");
  if (JSON.stringify(sa.includes ?? []) !== JSON.stringify(sb.includes ?? [])) out.push("includes");
  if (JSON.stringify(sa.exports ?? {}) !== JSON.stringify(sb.exports ?? {})) out.push("exports");
  if (JSON.stringify(a.nodes ?? []) !== JSON.stringify(b.nodes ?? []) || JSON.stringify(a.connections ?? []) !== JSON.stringify(b.connections ?? [])) out.push("graph");
  if (JSON.stringify(a.parameters ?? {}) !== JSON.stringify(b.parameters ?? {})) out.push("saved parameter values");
  return out;
}

/** things in the reference this port's engine may not know: node types, parameter types, port types, $keywords */
const KNOWN_PARAM = new Set(["float", "size", "enum", "boolean", "color", "gradient", "curve", "polygon", "polyline", "splines", "pixels", "lattice", "string", "file", "image_path"]);
const KNOWN_GEN = new Set(["material_export", "autoexport", "buffer", "image", "text", "iterate_buffer", "meshmap", "ios", "switch", "export", "comment", "comment_line", "webcam", "debug", "reroute", "portal", "remote", "graph", "shader", "sdf", "brush", "custom"]);
function unknowns(node, ioTypes) {
  const out = [];
  const walk = (n) => {
    const sm = n.shader_model ?? {};
    for (const p of sm.parameters ?? []) if (!KNOWN_PARAM.has(p.type)) out.push(`parameter type ${p.type}`);
    for (const port of [...(sm.inputs ?? []), ...(sm.outputs ?? [])]) if (port.type && !ioTypes.has(port.type)) out.push(`port type ${port.type}`);
    for (const c of n.nodes ?? []) {
      if (c.type && !KNOWN_GEN.has(c.type) && !fs.existsSync(path.join(lib, "nodes", c.type + ".json")) && !fs.existsSync(path.join(ref, "addons/material_maker/nodes", c.type + ".mmg"))) out.push(`node type ${c.type}`);
      walk(c);
    }
  };
  walk(node);
  return [...new Set(out)];
}

const report = { reference: ref, nodes: { added: [], removed: [], changed: [] }, examples: { added: [], removed: [], changed: [] }, menu: { added: [], removed: [] }, unknown: [] };

// nodes
const refNodes = path.join(ref, "addons/material_maker/nodes");
const ours = list(path.join(lib, "nodes"), ".json");
const theirs = list(refNodes, ".mmg");
const ioTypes = new Set([...read(path.join(lib, "io-types.json")).map((t) => t.name), ...read(path.join(refNodes, "io_types.mmt")).map((t) => t.name)]);
for (const n of theirs) {
  const b = read(path.join(refNodes, n + ".mmg"));
  if (!ours.includes(n)) report.nodes.added.push(n);
  else {
    const d = nodeDiff(read(path.join(lib, "nodes", n + ".json")), b);
    if (d.length) report.nodes.changed.push({ node: n, what: d });
  }
  for (const u of unknowns(b, ioTypes)) report.unknown.push(`${n}: ${u}`);
}
for (const n of ours) if (!theirs.includes(n)) report.nodes.removed.push(n);

// examples
const refEx = path.join(ref, "material_maker/examples");
const ourEx = list(path.join(lib, "examples"), ".ptex"),
  theirEx = list(refEx, ".ptex");
for (const e of theirEx) {
  if (!ourEx.includes(e)) report.examples.added.push(e);
  else if (JSON.stringify(read(path.join(lib, "examples", e + ".ptex"))) !== JSON.stringify(read(path.join(refEx, e + ".ptex")))) report.examples.changed.push(e);
}
for (const e of ourEx) if (!theirEx.includes(e)) report.examples.removed.push(e);

// node menu
const refMenu = path.join(ref, "material_maker/library/base.json");
if (fs.existsSync(refMenu)) {
  const a = new Set(read(path.join(lib, "menu.json")).items.map((i) => i.tree_item));
  const b = new Set(read(refMenu).lib.map((i) => i.tree_item));
  report.menu.added = [...b].filter((x) => !a.has(x));
  report.menu.removed = [...a].filter((x) => !b.has(x));
}

if (detail) {
  const a = read(path.join(lib, "nodes", detail + ".json"));
  const b = read(path.join(refNodes, detail + ".mmg"));
  for (const k of ["code", "global", "instance"]) {
    const x = lines(a.shader_model?.[k] ?? ""),
      y = lines(b.shader_model?.[k] ?? "");
    if (x === y) continue;
    console.log(`--- ${k} (library)\n${x}\n+++ ${k} (reference)\n${y}\n`);
  }
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  const sec = (title, arr) => console.log(`${title} (${arr.length})${arr.length ? "\n  " + arr.join("\n  ") : ""}`);
  console.log(`Reference: ${ref}\nThis only lists differences; nothing is written. Decide case by case what to adopt into library/.\n`);
  sec("Nodes only in the reference", report.nodes.added);
  sec("Nodes only in the library", report.nodes.removed);
  sec(
    "Nodes that differ",
    report.nodes.changed.map((c) => `${c.node}: ${c.what.join("; ")}`),
  );
  sec("Examples only in the reference", report.examples.added);
  sec("Examples that differ", report.examples.changed);
  sec("Menu items only in the reference", report.menu.added);
  sec("Menu items only in the library", report.menu.removed);
  sec("Features the engine may not know", report.unknown);
}
