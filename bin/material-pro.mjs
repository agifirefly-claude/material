#!/usr/bin/env node
// Material Pro on the command line: exports materials and renders node outputs without the editor, the way Material
// Maker's command line export works (material_maker/parse_args.gd). The engine runs in headless Chromium: this
// script serves the built app (dist/, or the sources through Vite when there is no build) and drives cli.html.
//
//   material-pro export <files…> [--target T] [--size N] [--out DIR] [--output-file TEMPLATE] [--name NAME] [--glb-shape S] [--zip]
//   material-pro list-targets <file>
//   material-pro render <file> --node PATH [--output I] [--size N] --out FILE.png
//   material-pro --export <files…> [-t T] [-o DIR] [--output-file TEMPLATE] [--size N]   (Material Maker's form)
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../scripts/playwright.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXIT = { ok: 0, failed: 1, usage: 2, environment: 3 };

const HELP = `Material Pro command line

Usage
  material-pro export <files.ptex…> [options]     export materials
  material-pro list-targets <file.ptex>           list the export targets of a project's material
  material-pro render <file.ptex> --node PATH --out FILE [options]
                                                  render one output of one node to an image
  material-pro help | --version

Export options
  -t, --target T        an export profile of the material (e.g. "Godot/Godot 4 Standard", "Unity/URP",
                        "Unreal/Unreal Engine 5", "Blender") or one of: cocos, glb, m3e, maps.
                        A name that is not exact picks the most similar target, as Material Maker does.
                        Default: "Godot/Godot 4 Standard"
  -s, --size N          texture size in pixels (default: the material's own size)
  -o, --out DIR         output directory (default: the current directory); --output-dir works too
  --output-file T       file name prefix template: %f file name without extension, %N material name,
                        %n material name in lower case with underscores (default: %f)
  --name NAME           material name for %N / %n and the m3e material (default: the file name)
  --glb-shape S         plane, sphere or cube for the glb target (default: plane)
  --zip                 write one zip per project instead of loose files
  --no-export-nodes     do not write the project's Export nodes
  --m3e-tile PX         m3e: size of one tile at 100% (default 160)
  --m3e-resolution PX   m3e: picture size (default min(size, 512))
  --m3e-light AZ,EL     m3e: light azimuth and elevation in degrees (default 315,45)
  --m3e-format F        m3e: webp or png (default webp)
  --m3e-no-raw          m3e: leave the PBR maps out
  --m3e-project         m3e: embed the project so the material can be edited again

Render options
  --node PATH           the node, by name or by path through subgraphs (e.g. graph_2/blend_1)
  --output I            output index (default 0)
  -s, --size N          image size (default 1024)
  -o, --out FILE        .png, .jpg or .webp

Files may contain * (e.g. "materials/*.ptex"). Exit codes: 0 done, 1 an export failed, 2 bad usage,
3 no usable browser or WebGL2.`;

class UsageError extends Error {}

/* ---------- arguments ---------- */
function parseArgs(argv) {
  const args = [...argv];
  let command = args[0];
  if (command === "--export" || command === "--export-material") {
    command = "export";
    args.shift();
  } else if (["export", "list-targets", "targets", "render", "help", "--help", "-h", "--version", "-v"].includes(command)) args.shift();
  else if (!command) command = "help";
  else command = "export"; // bare files: Material Maker's form without --export
  const o = { command, files: [], flags: {} };
  const takes = new Set(["-t", "--target", "-s", "--size", "-o", "--out", "--output-dir", "--output-file", "--name", "--glb-shape", "--node", "--output", "--m3e-tile", "--m3e-resolution", "--m3e-light", "--m3e-format"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-") && a !== "-") {
      const [k, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
      if (takes.has(k)) {
        const v = inline ?? args[++i];
        if (v === undefined) throw new UsageError(`${k} needs a value`);
        o.flags[k] = v;
      } else if (["--zip", "--no-export-nodes", "--m3e-no-raw", "--m3e-project", "--quiet", "-q"].includes(k)) o.flags[k] = true;
      else throw new UsageError(`unknown option ${a}`);
    } else o.files.push(a);
  }
  const f = o.flags;
  const pick = (...ks) => ks.map((k) => f[k]).find((v) => v !== undefined);
  const num = (v, name, lo, hi) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new UsageError(`${name} must be a whole number from ${lo} to ${hi}`);
    return n;
  };
  return {
    command: o.command,
    files: o.files,
    target: pick("-t", "--target") ?? "Godot/Godot 4 Standard",
    size: num(pick("-s", "--size"), "--size", 16, 8192),
    out: pick("-o", "--out", "--output-dir"),
    outputFile: f["--output-file"] ?? "%f",
    name: f["--name"],
    glbShape: f["--glb-shape"] ?? "plane",
    zip: !!f["--zip"],
    exportNodes: !f["--no-export-nodes"],
    node: f["--node"],
    output: num(f["--output"], "--output", 0, 64) ?? 0,
    quiet: !!(f["--quiet"] || f["-q"]),
    m3e: {
      tile: num(f["--m3e-tile"], "--m3e-tile", 8, 2048),
      resolution: num(f["--m3e-resolution"], "--m3e-resolution", 8, 4096),
      light: f["--m3e-light"],
      format: f["--m3e-format"],
      raw: !f["--m3e-no-raw"],
      project: !!f["--m3e-project"],
    },
  };
}

/** files, with * expanded the way Material Maker's command line does (in the file name part) */
function expandFiles(list) {
  const out = [];
  for (const f of list) {
    if (!f.includes("*")) {
      out.push(f);
      continue;
    }
    const dir = path.dirname(f);
    const re = new RegExp("^" + path.basename(f).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*") + "$");
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir).sort()) if (re.test(n)) out.push(path.join(dir, n));
  }
  return out;
}

const lowerName = (s) => s.trim().toLowerCase().replaceAll(" ", "_").replace(/[()/"]/g, "");
const fileNameOf = (template, file, name) => template.replaceAll("%f", path.basename(file).replace(/\.[^.]+$/, "")).replaceAll("%N", name).replaceAll("%n", lowerName(name));

/* ---------- serving the app ---------- */
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".glsl": "text/plain", ".hdr": "application/octet-stream", ".png": "image/png", ".wasm": "application/wasm", ".obj": "text/plain" };

async function serve() {
  const dist = path.join(ROOT, "dist");
  if (fs.existsSync(path.join(dist, "cli.html"))) {
    const server = http.createServer((req, res) => {
      const p = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      const file = path.join(dist, p);
      if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${server.address().port}/cli.html`, close: () => new Promise((r) => server.close(r)) };
  }
  // no build: the sources through Vite
  let vite;
  try {
    vite = await import("vite");
  } catch {
    throw Object.assign(new Error("dist/ is missing and Vite is not installed: run `npm install` and `npm run build`"), { code: EXIT.environment });
  }
  const server = await vite.createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.ts"), server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const addr = server.httpServer.address();
  return { url: `http://127.0.0.1:${addr.port}/cli.html`, close: () => server.close() };
}

async function startEngine() {
  const server = await serve();
  let browser;
  try {
    browser = await launchChromium();
  } catch (e) {
    await server.close();
    throw Object.assign(new Error(`cannot start headless Chromium (${e.message.split("\n")[0]}); run \`npx playwright install chromium\``), { code: EXIT.environment });
  }
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(server.url);
  try {
    await page.waitForFunction(() => window.materialProCli, null, { timeout: 60000 });
    await page.evaluate(() => window.materialProCli.ready());
  } catch (e) {
    await browser.close();
    await server.close();
    throw Object.assign(new Error(`the engine did not start: ${errors[0] ?? e.message.split("\n")[0]}`), { code: EXIT.environment });
  }
  return {
    page,
    close: async () => {
      await browser.close();
      await server.close();
    },
  };
}

/* ---------- commands ---------- */
const shown = (p) => {
  const r = path.relative(process.cwd(), p);
  return !r ? "." : r.startsWith("..") ? p : r;
};
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

async function zipFiles(files) {
  const { zipSync } = await import("fflate");
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(v)])), { level: 6 });
}

async function exportCommand(o, log) {
  const files = expandFiles(o.files);
  if (!files.length) throw new UsageError(o.files.length ? `no file matches ${o.files.join(" ")}` : "export needs at least one .ptex file");
  for (const f of files) if (!fs.existsSync(f)) throw new UsageError(`${f}: no such file`);
  const outDir = path.resolve(o.out ?? ".");
  const engine = await startEngine();
  let failed = 0;
  try {
    for (const f of files) {
      const name = o.name ?? path.basename(f).replace(/\.[^.]+$/, "");
      const prefix = fileNameOf(o.outputFile, f, name);
      const [az, el] = (o.m3e.light ?? "315,45").split(",").map(Number);
      try {
        const res = await engine.page.evaluate(
          ([text, opts]) => window.materialProCli.export(text, opts),
          [
            fs.readFileSync(f, "utf8"),
            {
              target: o.target,
              size: o.size,
              prefix,
              name,
              glbShape: o.glbShape,
              exportNodes: o.exportNodes,
              m3e: { tile: o.m3e.tile, resolution: o.m3e.resolution, azimuth: az, elevation: el, raw: o.m3e.raw, format: o.m3e.format, project: o.m3e.project ? fs.readFileSync(f, "utf8") : undefined },
            },
          ],
        );
        if (!res.exact) log(`${f}: using target “${res.target}” (closest to “${o.target}”)`);
        const out = Object.fromEntries(Object.entries(res.files).map(([k, v]) => [k, Buffer.from(v, "base64")]));
        if (o.zip) {
          const zipName = path.join(outDir, `${prefix}_${res.target.replace(/[/ ]/g, "_")}.zip`);
          write(zipName, await zipFiles(out));
          log(`${f} → ${shown(zipName)} (${Object.keys(out).length} files)`);
        } else {
          for (const [k, v] of Object.entries(out)) write(path.join(outDir, k), v);
          log(`${f} → ${res.target}: ${Object.keys(out).length} files in ${shown(outDir)}`);
          for (const k of Object.keys(out)) log(`  ${k}`);
        }
      } catch (e) {
        failed++;
        console.error(`${f}: ${String(e.message ?? e).replace(/^page\.evaluate: (Error: )?/, "").split("\n")[0]}`);
      }
    }
  } finally {
    await engine.close();
  }
  return failed ? EXIT.failed : EXIT.ok;
}

async function listTargetsCommand(o, log) {
  if (o.files.length !== 1) throw new UsageError("list-targets takes one .ptex file");
  const f = o.files[0];
  if (!fs.existsSync(f)) throw new UsageError(`${f}: no such file`);
  const engine = await startEngine();
  try {
    const info = await engine.page.evaluate((text) => window.materialProCli.info(text), fs.readFileSync(f, "utf8"));
    if (!info.material) {
      console.error(`${f}: this project has no material node`);
      return EXIT.failed;
    }
    log(`${f}: ${info.material}, ${info.size}×${info.size}`);
    for (const t of info.targets) console.log(t);
    return EXIT.ok;
  } finally {
    await engine.close();
  }
}

async function renderCommand(o, log) {
  if (o.files.length !== 1) throw new UsageError("render takes one .ptex file");
  if (!o.node) throw new UsageError("render needs --node");
  if (!o.out) throw new UsageError("render needs --out FILE");
  const f = o.files[0];
  if (!fs.existsSync(f)) throw new UsageError(`${f}: no such file`);
  const ext = path.extname(o.out).toLowerCase();
  const format = ext === ".jpg" || ext === ".jpeg" ? "jpg" : ext === ".webp" ? "webp" : ext === ".png" ? "png" : null;
  if (!format) throw new UsageError("--out must end in .png, .jpg or .webp");
  const engine = await startEngine();
  try {
    const data = await engine.page.evaluate(([text, node, output, size, fmt]) => window.materialProCli.render(text, node, output, size, fmt), [fs.readFileSync(f, "utf8"), o.node, o.output, o.size ?? 1024, format]);
    write(path.resolve(o.out), Buffer.from(data, "base64"));
    log(`${o.node} output ${o.output} → ${o.out}`);
    return EXIT.ok;
  } catch (e) {
    console.error(String(e.message ?? e).replace(/^page\.evaluate: (Error: )?/, "").split("\n")[0]);
    return EXIT.failed;
  } finally {
    await engine.close();
  }
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`material-pro: ${e.message}\n(material-pro help for usage)`);
    return EXIT.usage;
  }
  const log = o.quiet ? () => {} : (s) => console.log(s);
  if (["help", "--help", "-h"].includes(o.command)) {
    console.log(HELP);
    return EXIT.ok;
  }
  if (["--version", "-v"].includes(o.command)) {
    console.log(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
    return EXIT.ok;
  }
  try {
    if (o.command === "export") return await exportCommand(o, log);
    if (o.command === "list-targets" || o.command === "targets") return await listTargetsCommand(o, log);
    if (o.command === "render") return await renderCommand(o, log);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`material-pro: ${e.message}\n(material-pro help for usage)`);
      return EXIT.usage;
    }
    console.error(`material-pro: ${e.message}`);
    return e.code ?? EXIT.failed;
  }
  return EXIT.usage;
}

process.exit(await main());
