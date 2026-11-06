// Lists likely user-visible English strings in src/ui that do not go through t(). A helper for i18n work:
// node scripts/scan-ui-strings.mjs [dir] [--list]
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "src/ui";
const list = process.argv.includes("--list");
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(f) && !p.includes("i18n")) files.push(p);
  }
};
walk(dir);
let total = 0;
for (const f of files) {
  const hits = [];
  fs.readFileSync(f, "utf8")
    .split("\n")
    .forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      for (const m of l.matchAll(/>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
        const txt = m[1].trim();
        if (txt && /[A-Za-z]{2}/.test(txt) && !/=>|&&|\|\||\(|\)/.test(txt)) hits.push(`${i + 1}: >${txt}<`);
      }
      if (/^\s+[A-Z][A-Za-z ,.'’…?!\-:]*[a-z][A-Za-z ,.'’…?!\-:]*$/.test(l) && !/[;=,]$/.test(l.trim())) hits.push(`${i + 1}: ${l.trim()}`);
      for (const m of l.matchAll(/\b(title|placeholder|label|aria-label)=("([^"]*[A-Za-z]{2}[^"]*)")/g)) hits.push(`${i + 1}: ${m[1]}=${m[2]}`);
      for (const m of l.matchAll(/\b(setStatus|alert|confirm|prompt|setNote|setError)\(\s*(["`])([^"`]*[A-Za-z]{3})/g)) hits.push(`${i + 1}: ${m[1]}(${m[3]}`);
      for (const m of l.matchAll(/\b(title|label|placeholder|name|text):\s*"([A-Z][^"]*[a-z][^"]*)"/g)) hits.push(`${i + 1}: ${m[1]}: "${m[2]}"`);
    });
  if (hits.length) {
    total += hits.length;
    console.log(`== ${f} (${hits.length})`);
    if (list) for (const h of hits) console.log("   " + h);
  }
}
console.log("total", total);
