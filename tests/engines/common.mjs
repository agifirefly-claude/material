// Shared by the engine import checks (tests/engines/*.mjs). They use engines that are already installed and never
// download anything: without the engine a check says so and is skipped.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin/material-pro.mjs");

/** the examples the checks export: bricks (no emission) and lava (emission) */
export const EXAMPLES = ["bricks", "lava"];

/**
 * the engine's executable: the environment variable, then PATH, then the usual application folders.
 * Returns null when there is none (or the variable names a file that does not exist).
 */
export function findExecutable({ env, names, apps }) {
  const fromEnv = process.env[env];
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : (console.error(`${env}=${fromEnv}: no such file`), null);
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const n of names) for (const d of dirs) for (const e of exts) if (isFile(path.join(d, n + e))) return path.join(d, n + e);
  for (const a of apps) if (isFile(a)) return a;
  return null;
}
const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};

/** a project file of an example (the generated data first, the vendored sources otherwise) copied to `dir` */
export function exampleFile(name, dir) {
  const src = [path.join(ROOT, "public/data/examples", `${name}.json`), path.join(ROOT, "third_party/material-maker/examples", `${name}.ptex`)].find((f) => fs.existsSync(f));
  if (!src) throw new Error(`example ${name} not found (run npm run data)`);
  const file = path.join(dir, `${name}.ptex`);
  fs.copyFileSync(src, file);
  return file;
}

/** runs the command line export; throws with its output when it fails */
export function exportWithCli(file, target, outDir, size, extra = []) {
  const r = spawnSync(process.execPath, [CLI, "export", file, "-t", target, "-s", String(size), "-o", outDir, "-q", ...extra], { encoding: "utf8", timeout: 300000 });
  if (r.status !== 0) throw new Error(`material-pro export ${path.basename(file)} -t "${target}" failed (exit ${r.status}):\n${r.stderr}${r.stdout}`);
}

export const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** runs the engine and returns its exit code and output */
export function run(exe, args, options = {}) {
  const r = spawnSync(exe, args, { encoding: "utf8", timeout: 600000, maxBuffer: 64 << 20, ...options });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), error: r.error };
}

/**
 * collects the "PASS …" / "FAIL …" lines the engine scripts print, prints a report and returns how many failed
 * (a script that printed no "DONE" line counts as one failure: it did not get to the end).
 */
export function report(title, output) {
  const lines = output.split(/\r?\n/);
  const pass = lines.filter((l) => l.startsWith("PASS "));
  const fail = lines.filter((l) => l.startsWith("FAIL "));
  const done = lines.some((l) => l.startsWith("DONE"));
  console.log(`\n${title}`);
  for (const l of [...pass, ...fail]) console.log(`  ${l.startsWith("PASS") ? "✓" : "✗"} ${l.slice(5)}`);
  if (!done) {
    console.log("  ✗ the check did not run to the end; the engine's output:");
    console.log(lines.slice(-40).map((l) => "    " + l).join("\n"));
  }
  const failed = fail.length + (done ? 0 : 1);
  console.log(`  ${pass.length} passed, ${failed} failed`);
  return failed;
}

/** exit codes: 0 every check passed, 1 something failed, and SKIP when the engine is not installed */
export const SKIP = 0;
