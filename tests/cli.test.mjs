// Tests of the command line (bin/material-pro.mjs): every kind of export target on an example, list-targets, render
// and the errors. Each command runs the real CLI in a child process (headless Chromium, dist/ or Vite).
//   node tests/cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin/material-pro.mjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "material-pro-cli-"));
const SIZE = 128;

/** an example project as a .ptex file (the generated data first, the vendored sources otherwise) */
function example(name) {
  const file = path.join(TMP, `${name}.ptex`);
  if (!fs.existsSync(file)) {
    const src = [path.join(ROOT, "public/data/examples", `${name}.json`), path.join(ROOT, "third_party/material-maker/examples", `${name}.ptex`)].find((f) => fs.existsSync(f));
    assert.ok(src, `example ${name} not found (run npm run data)`);
    fs.copyFileSync(src, file);
  }
  return file;
}

function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: TMP, encoding: "utf8", timeout: 240000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const ok = (r) => assert.equal(r.code, 0, `exit ${r.code}\n${r.out}\n${r.err}`);
const outDir = (n) => path.join(TMP, "out", n);
const read = (dir, f) => fs.readFileSync(path.join(dir, f));

function pngSize(buf) {
  assert.equal(buf.subarray(1, 4).toString(), "PNG", "not a PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
function assertPng(dir, f, size = SIZE) {
  assert.deepEqual(pngSize(read(dir, f)), [size, size], `${f} size`);
}

test("help and version", () => {
  const h = cli("help");
  ok(h);
  assert.match(h.out, /material-pro export/);
  const v = cli("--version");
  ok(v);
  assert.match(v.out.trim(), /^\d+\.\d+\.\d+/);
});

test("list-targets", () => {
  const r = cli("list-targets", example("bricks"));
  ok(r);
  const targets = r.out.trim().split("\n");
  for (const t of ["Godot/Godot 4 Standard", "Godot/Godot 4 ORM", "Blender", "Unity/3D", "Unity/URP", "Unity/HDRP", "Unreal/Unreal Engine 5", "cocos", "glb", "m3e", "maps"]) assert.ok(targets.includes(t), `missing ${t}`);
});

test("export: Godot 4 Standard (the default target)", () => {
  const d = outDir("godot");
  ok(cli("export", example("bricks"), "--size", String(SIZE), "--out", d));
  for (const m of ["albedo", "orm", "normal"]) assertPng(d, `bricks_${m}.png`);
  const tres = read(d, "bricks.tres").toString();
  assert.match(tres, /StandardMaterial3D/);
  assert.match(tres, /albedo_texture/);
  assert.match(tres, /bricks_orm\.png/);
});

test("export: Godot 4 ORM with the Material Maker style flags and --output-file", () => {
  const d = outDir("godot-orm");
  ok(cli("--export", example("bricks"), "-t", "Godot/Godot 4 ORM", "-o", d, "--size", String(SIZE), "--output-file", "%n_mat", "--name", "Red Bricks"));
  assert.ok(fs.readdirSync(d).some((f) => f.startsWith("red_bricks_mat")), fs.readdirSync(d).join(", "));
  assert.match(fs.readdirSync(d).filter((f) => f.endsWith(".tres")).map((f) => read(d, f).toString()).join(""), /ORMMaterial3D/);
});

test("export: Blender", () => {
  const d = outDir("blender");
  ok(cli("export", example("bricks"), "-t", "Blender", "-s", String(SIZE), "-o", d));
  assertPng(d, "bricks_albedo.png");
  assertPng(d, "bricks_normal.png");
  for (const m of ["rough", "metal"]) assert.equal(read(d, `bricks_${m}.exr`).readUInt32LE(0), 20000630, `${m} is not EXR`);
});

test("export: Unity 3D through a similar name", () => {
  const d = outDir("unity");
  const r = cli("export", example("bricks"), "-t", "unity3d", "-s", String(SIZE), "-o", d);
  ok(r);
  assert.match(r.out, /using target “Unity\/3D”/);
  assertPng(d, "bricks_albedo.png");
  assert.ok(fs.existsSync(path.join(d, "bricks_albedo.png.meta")));
  assert.match(read(d, "bricks.mat").toString(), /_MainTex/);
});

test("export: Unreal Engine 5", () => {
  const d = outDir("unreal");
  ok(cli("export", example("bricks"), "-t", "Unreal/Unreal Engine 5", "-s", String(SIZE), "-o", d));
  assert.ok(fs.readdirSync(d).some((f) => f.endsWith(".png")));
  assert.match(read(d, "bricks.py").toString(), /import unreal/);
  // the profile's "clipboard" template goes to the clipboard in Material Maker, not into a file
  assert.ok(!fs.existsSync(path.join(d, "clipboard")));
  // the script imports mm.py from its own folder (MM #615)
  assert.match(read(d, "mm.py").toString(), /def /);
  assert.ok(!read(d, "bricks.py").toString().includes("/export"));
});

test("export: maps", () => {
  const d = outDir("maps");
  ok(cli("export", example("bricks"), "-t", "maps", "-s", String(SIZE), "-o", d));
  for (const m of ["albedo", "orm", "normal", "normal_dx", "height", "ao", "metallic", "roughness"]) assertPng(d, `bricks_${m}.png`);
});

test("export: Cocos Creator", () => {
  const d = outDir("cocos");
  ok(cli("export", example("bricks"), "-t", "cocos", "-s", String(SIZE), "-o", d));
  const mtl = JSON.parse(read(d, "bricks/bricks.mtl").toString());
  assert.ok(mtl.__type__ === "cc.Material" || JSON.stringify(mtl).includes("cc.Material"));
  assertPng(d, "bricks/bricks_albedo.png");
  assert.ok(fs.existsSync(path.join(d, "bricks/bricks.mtl.meta")));
});

test("export: glb (sphere)", () => {
  const d = outDir("glb");
  ok(cli("export", example("bricks"), "-t", "glb", "--glb-shape", "sphere", "-s", String(SIZE), "-o", d));
  const glb = read(d, "bricks.glb");
  assert.equal(glb.subarray(0, 4).toString(), "glTF");
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
});

test("export: m3e", () => {
  const d = outDir("m3e");
  ok(cli("export", example("bricks"), "-t", "m3e", "-s", String(SIZE), "-o", d, "--name", "Bricks"));
  const m = JSON.parse(read(d, "bricks.m3e-material.json").toString());
  assert.equal(m.format, "m3e-material");
  assert.equal(m.materials[0].name, "Bricks");
  assert.ok(JSON.stringify(m).includes("data:image/"), "no embedded pictures");
});

test("export: several files with *, and --zip", () => {
  example("bricks");
  example("beehive");
  const d = outDir("zip");
  const r = cli("export", path.join(TMP, "b*.ptex"), "-t", "maps", "-s", "64", "-o", d, "--zip");
  ok(r);
  const zips = fs.readdirSync(d).filter((f) => f.endsWith(".zip"));
  assert.equal(zips.length, 2, zips.join(", "));
  for (const z of zips) assert.equal(read(d, z).readUInt32LE(0), 0x04034b50);
});

test("render one node output", () => {
  const file = path.join(TMP, "out", "render.png");
  ok(cli("render", example("bricks"), "--node", "colorize_0", "--size", "64", "--out", file));
  assert.deepEqual(pngSize(fs.readFileSync(file)), [64, 64]);
});

test("errors and exit codes", () => {
  let r = cli("export", "missing.ptex");
  assert.equal(r.code, 2);
  assert.match(r.err, /no such file/);
  r = cli("export", example("bricks"), "--bogus");
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown option/);
  r = cli("export", example("bricks"), "--size", "abc");
  assert.equal(r.code, 2);
  r = cli("render", example("bricks"), "--out", "x.png");
  assert.equal(r.code, 2);
  assert.match(r.err, /--node/);
  r = cli("render", example("bricks"), "--node", "no_such_node", "--out", path.join(TMP, "x.png"));
  assert.equal(r.code, 1);
  assert.match(r.err, /no_such_node/);
  const bad = path.join(TMP, "broken.ptex");
  fs.writeFileSync(bad, "{ this is not a project");
  r = cli("export", bad, "-o", outDir("broken"));
  assert.equal(r.code, 1);
  assert.match(r.err, /broken\.ptex/);
});

process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
