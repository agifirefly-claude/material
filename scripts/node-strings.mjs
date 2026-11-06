// The strings of the node library that the UI translates, collected the way the UI looks them up:
// node names (t), descriptions (tDesc: the whole text or each line), parameter labels and tooltips, enum values,
// port labels and tooltips, the controls of graph nodes (Remote widgets, subgraph ports), menu paths (tPath, each
// part) and brushes. Used by scripts/check-i18n.mjs.
import fs from "node:fs";
import path from "node:path";

/** each string with where it was found */
export function nodeStrings(root) {
  const lib = path.join(root, "library");
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  const text = (v) => (Array.isArray(v) ? v.join("\n") : typeof v === "string" ? v : "");
  const out = new Map();
  const add = (s, where, kind = "text") => {
    if (typeof s !== "string") return;
    s = s.trim();
    // only what is words: not numbers, symbols or code
    if (!/[A-Za-z]{2}/.test(s) || /[$(){};=]/.test(s)) return;
    if (!out.has(s)) out.set(s, { where, kind });
  };
  const desc = (s, where) => {
    const t = text(s);
    if (!t) return;
    for (const l of t.split("\n")) add(l, where, "desc");
  };
  const label = (s) => (typeof s === "string" ? s.replace(/^\d+:/, "") : s);

  function node(n, where) {
    const sm = n.shader_model ?? {};
    add(sm.name, where, "name");
    add(n.label, where, "name");
    desc(sm.shortdesc, where);
    desc(sm.longdesc, where);
    desc(n.shortdesc, where);
    desc(n.longdesc, where);
    for (const p of sm.parameters ?? []) {
      add(label(p.label) || p.name, where, "parameter");
      desc(p.shortdesc, where);
      desc(p.longdesc, where);
      for (const v of p.values ?? []) add(v.name, where, "value");
    }
    for (const p of sm.inputs ?? []) {
      add(label(p.label) || p.shortdesc || p.name, where, "port");
      desc(p.shortdesc, where);
      desc(p.longdesc, where);
    }
    for (const p of sm.outputs ?? []) {
      if (p.shortdesc) add(p.shortdesc, where, "port");
      desc(p.longdesc, where);
    }
    // a graph: its parameters come from its Remote widgets, its ports from gen_inputs / gen_outputs
    for (const c of n.nodes ?? []) {
      if (c.type === "remote" || c.widgets) {
        for (const w of c.widgets ?? []) {
          add(w.label, where, "parameter");
          desc(w.shortdesc, where);
          desc(w.longdesc, where);
          for (const k of Object.keys(w.configurations ?? {})) add(k, where, "value");
        }
      }
      if (c.type === "ios") for (const p of c.ports ?? []) {
        add(p.name, where, "port");
        desc(p.shortdesc, where);
        desc(p.longdesc, where);
      }
      // nodes inside a graph show their own strings when the graph is opened
      if (c.shader_model) node(c, where);
    }
  }

  for (const f of fs.readdirSync(path.join(lib, "nodes")).sort()) node(read(path.join(lib, "nodes", f)), "nodes/" + f);
  for (const it of read(path.join(lib, "menu.json")).items) {
    for (const part of it.tree_item.split("/")) add(part, "menu.json", "menu");
    add(it.display_name, "menu.json", "menu");
  }
  for (const b of read(path.join(lib, "brushes.json")).items) {
    for (const part of (b.tree_item ?? "").split("/")) add(part, "brushes.json", "menu");
    add(b.label, "brushes.json", "name");
    node(b, "brushes.json");
  }
  return out;
}
