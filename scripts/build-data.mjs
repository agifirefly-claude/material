// Builds what the app loads (public/data) from the node library this project maintains (library/, see
// docs/节点库维护.md). Run with `npm run data`; `npm run build` runs it first.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const lib = path.join(root, "library");
const out = path.join(root, "public/data");
fs.mkdirSync(out, { recursive: true });

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const write = (p, data) => fs.writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data));

// Code is kept as arrays of lines in the library (readable diffs); the app wants strings.
const PROCESS = ["code", "custom", "global", "instance", "preview_shader", "template"];
const WALK = ["shader_model", "nodes", "template", "files"];
const WALK_CHILDREN = ["exports"];
function joinLines(data, walkChildren = false) {
  if (Array.isArray(data)) return data.map((d) => joinLines(d));
  if (data && typeof data === "object") {
    for (const k of Object.keys(data)) {
      if (PROCESS.includes(k)) {
        if (Array.isArray(data[k])) data[k] = data[k].join("\n");
      } else if (walkChildren || WALK.includes(k)) data[k] = joinLines(data[k]);
      else if (WALK_CHILDREN.includes(k)) data[k] = joinLines(data[k], true);
    }
  }
  return data;
}
const sortedFiles = (dir, ext) => fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort();

// nodes: library/nodes/<type>.json, the file name is the node type
const nodes = {};
for (const f of sortedFiles(path.join(lib, "nodes"), ".json")) nodes[f.slice(0, -5)] = joinLines(read(path.join(lib, "nodes", f)));
write(path.join(out, "nodes.json"), nodes);

// port types, with their 2D preview functions (library/previews/<type>.glsl)
const ioTypes = read(path.join(lib, "io-types.json"));
for (const t of ioTypes) {
  const p = path.join(lib, "previews", `${t.name}.glsl`);
  if (fs.existsSync(p)) t.preview = fs.readFileSync(p, "utf8");
}
write(path.join(out, "io_types.json"), ioTypes);

// export templates, by file name
const templates = {};
for (const f of fs.readdirSync(path.join(lib, "templates"))) templates[f] = fs.readFileSync(path.join(lib, "templates", f), "utf8");
write(path.join(out, "templates.json"), templates);

write(path.join(out, "environments.json"), read(path.join(lib, "environments.json")));
write(path.join(out, "shader_functions.glsl"), fs.readFileSync(path.join(lib, "shader-functions.glsl"), "utf8"));

// menus: icons are PNG files next to them, inlined for the app
function withIcons(items, dir) {
  return items.map((it) => {
    const o = {};
    for (const [k, v] of Object.entries(it)) {
      if (k === "icon_file") o.icon_data = fs.readFileSync(path.join(lib, dir, v)).toString("base64");
      else o[k] = v;
    }
    return o;
  });
}
const menu = read(path.join(lib, "menu.json"));
const aliases = read(path.join(lib, "aliases.json"));
write(path.join(out, "library.json"), { items: withIcons(menu.items, "menu-icons"), aliases });
const brushes = read(path.join(lib, "brushes.json"));
write(path.join(out, "brushes.json"), withIcons(brushes.items, "brush-icons").map((b) => joinLines(b)));

// examples: library/examples/*.ptex
const exOut = path.join(out, "examples");
fs.mkdirSync(exOut, { recursive: true });
const index = [];
for (const f of sortedFiles(path.join(lib, "examples"), ".ptex")) {
  write(path.join(exOut, f.replace(/\.ptex$/, ".json")), joinLines(read(path.join(lib, "examples", f))));
  index.push(f.replace(/\.ptex$/, ""));
}
write(path.join(exOut, "index.json"), index);

// translations: library/locale/<lang>.json, English text → translation; library/locale/<lang>.nodes.json holds
// the node library's own strings (names, parameters, ports, descriptions) in the same form
const locOut = path.join(out, "locale");
fs.mkdirSync(locOut, { recursive: true });
const langs = [];
const counts = [];
for (const f of sortedFiles(path.join(lib, "locale"), ".json")) {
  if (f.includes(".nodes.")) continue;
  const lang = f.slice(0, -5);
  const cat = read(path.join(lib, "locale", f));
  const extra = path.join(lib, "locale", `${lang}.nodes.json`);
  if (fs.existsSync(extra)) for (const [k, v] of Object.entries(read(extra))) if (!(k in cat)) cat[k] = v;
  write(path.join(locOut, `${lang}.json`), cat);
  langs.push(lang);
  counts.push(`${lang} ${Object.keys(cat).length}`);
}
write(path.join(locOut, "index.json"), langs);

// the user manual, shown by Help › User manual
fs.mkdirSync(path.join(root, "public/docs"), { recursive: true });
fs.copyFileSync(path.join(root, "docs/用户手册.md"), path.join(root, "public/docs/manual.md"));

console.log(`locales: ${counts.join(", ")}`);
console.log(`nodes: ${Object.keys(nodes).length}, io types: ${ioTypes.length}, library items: ${menu.items.length}, examples: ${index.length}`);
