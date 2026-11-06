// Lists the UI strings that have no translation in a language (Chinese by default):
// every t("…") / tr("…") key in src, plus the keys in src/ui/i18n/dynamic.ts, looked up the way t() looks them up
// in Material Maker's catalog (public/data/locale/<lang>.json) and this port's own (src/ui/i18n/extra.ts).
// Then the same for the node library's strings (scripts/node-strings.mjs: node names, parameters, ports, descriptions,
// menu paths, and the internal names a parameter or port shows when it has no label), which live in
// library/locale/<lang>.nodes.json.
// node scripts/check-i18n.mjs [lang]      exits 1 when something is missing
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "rolldown/parseAst";
import { nodeStrings } from "./node-strings.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lang = process.argv[2] ?? "zh";

/** a string-keyed object literal inside a TS file, read with the parser (no need to run the file) */
function objectLiteral(file, exportName) {
  const src = fs.readFileSync(file, "utf8");
  const ast = parseAst(src, { lang: "ts" });
  const out = {};
  const read = (node) => {
    if (node.type === "ObjectExpression") {
      const o = {};
      for (const p of node.properties) {
        const k = p.key.type === "Identifier" ? p.key.name : p.key.value;
        o[k] = read(p.value);
      }
      return o;
    }
    if (node.type === "ArrayExpression") return node.elements.map(read);
    if (node.type === "Literal") return node.value;
    if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return read(node.expression);
    return undefined;
  };
  for (const st of ast.body) {
    const d = st.type === "ExportNamedDeclaration" ? st.declaration : st;
    if (d?.type !== "VariableDeclaration") continue;
    for (const v of d.declarations) if (v.id.name === exportName) Object.assign(out, { value: read(v.init) });
  }
  return out.value;
}

const catalogFile = path.join(root, "public/data/locale", `${lang}.json`);
const catalog = { ...(fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, "utf8")) : {}), ...(objectLiteral(path.join(root, "src/ui/i18n/extra.ts"), "EXTRA")?.[lang] ?? {}) };

/** the same lookup as t() in src/ui/i18n/index.ts */
function translated(s) {
  if (!s || catalog[s]) return true;
  const trimmed = s.replace(/[.:…\s]+$/, "");
  return !!(catalog[trimmed] ?? catalog[trimmed.charAt(0).toUpperCase() + trimmed.slice(1)]);
}

const keys = new Map();
const add = (k, where) => {
  if (!/[A-Za-z]/.test(k)) return;
  if (!keys.has(k)) keys.set(k, where);
};
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(f)) {
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(/\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) add(JSON.parse(`"${m[1]}"`), path.relative(root, p));
    }
  }
};
walk(path.join(root, "src/ui"));
for (const k of objectLiteral(path.join(root, "src/ui/i18n/dynamic.ts"), "DYNAMIC_KEYS") ?? []) add(k, "src/ui/i18n/dynamic.ts");

const missing = [...keys].filter(([k]) => !translated(k));
for (const [k, where] of missing) console.log(`${JSON.stringify(k)}  (${where})`);
console.log(`UI: ${keys.size} strings, ${missing.length} without a ${lang} translation`);

const nodes = [...nodeStrings(root)];
const nodeMissing = nodes.filter(([s]) => !translated(s));
for (const [s, { where, kind }] of nodeMissing) console.log(`${JSON.stringify(s)}  (${kind}, library/${where})`);
console.log(`node library: ${nodes.length} strings, ${nodeMissing.length} without a ${lang} translation (add them to library/locale/${lang}.nodes.json)`);
process.exit(missing.length || nodeMissing.length ? 1 : 0);
