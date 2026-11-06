// Converts the vendored Material Maker data (third_party/material-maker) into JSON the app loads.
import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const mm = path.join(root, "third_party/material-maker");
const out = path.join(root, "public/data");
fs.mkdirSync(out, { recursive: true });

const PROCESS = ["code", "custom", "global", "instance", "preview_shader", "template"];
const WALK = ["shader_model", "nodes", "template", "files"];
const WALK_CHILDREN = ["exports"];
// Same as MMLoader.replace_arrays_with_multiline_strings
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
const read = (p) => JSON5.parse(fs.readFileSync(p, "utf8"));

// nodes
const nodes = {};
const nodeDir = path.join(mm, "nodes");
for (const f of fs.readdirSync(nodeDir).sort()) {
  if (!f.endsWith(".mmg")) continue;
  nodes[f.slice(0, -4)] = joinLines(read(path.join(nodeDir, f)));
}
fs.writeFileSync(path.join(out, "nodes.json"), JSON.stringify(nodes));

// io types with their 2D preview functions
const ioTypes = read(path.join(nodeDir, "io_types.mmt"));
for (const t of ioTypes) {
  const p = path.join(nodeDir, `preview_${t.name}.gdshader`);
  if (fs.existsSync(p)) t.preview = fs.readFileSync(p, "utf8");
}
fs.writeFileSync(path.join(out, "io_types.json"), JSON.stringify(ioTypes));

// export templates (get_template_text reads them from the nodes directory)
const templates = {};
for (const f of fs.readdirSync(nodeDir)) if (f.endsWith(".tmpl")) templates[f] = fs.readFileSync(path.join(nodeDir, f), "utf8");
fs.writeFileSync(path.join(out, "templates.json"), JSON.stringify(templates));

// 3D preview environments (environment_manager.gd reads them from this file)
fs.writeFileSync(path.join(out, "environments.json"), JSON.stringify(read(path.join(mm, "environments/environments.json"))));

// shared shader functions
fs.writeFileSync(path.join(out, "shader_functions.glsl"), fs.readFileSync(path.join(mm, "shader_functions.glsl"), "utf8"));

// library (node menu) and search aliases
const lib = read(path.join(mm, "library/base.json"));
const aliases = read(path.join(mm, "library/aliases.json"));
fs.writeFileSync(path.join(out, "library.json"), JSON.stringify({ items: lib.lib, aliases }));

// examples
const exDir = path.join(mm, "examples");
const exOut = path.join(out, "examples");
fs.mkdirSync(exOut, { recursive: true });
const index = [];
for (const f of fs.readdirSync(exDir).sort()) {
  if (!f.endsWith(".ptex")) continue;
  const data = joinLines(read(path.join(exDir, f)));
  fs.writeFileSync(path.join(exOut, f.replace(/\.ptex$/, ".json")), JSON.stringify(data));
  index.push(f.replace(/\.ptex$/, ""));
}
fs.writeFileSync(path.join(exOut, "index.json"), JSON.stringify(index));
console.log(`nodes: ${Object.keys(nodes).length}, io types: ${ioTypes.length}, library items: ${lib.lib.length}, examples: ${index.length}`);
