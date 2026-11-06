// Imports Material Pro's Godot exports into a real Godot 4 and checks what Godot makes of them.
//
//   node tests/engines/godot-import.mjs            (or npm run test:engines)
//
// Godot is looked for in GODOT_BIN, then on PATH (godot, godot4, Godot), then in /Applications/Godot.app. Nothing is
// downloaded: without Godot 4 the check is skipped. With it:
//   1. a temporary Godot project gets the "Godot/Godot 4 Standard" and "Godot/Godot 4 ORM" exports and a .glb of a
//      few examples, made with the command line (bin/material-pro.mjs);
//   2. Godot imports the project headlessly (--headless --import);
//   3. a GDScript (written below) loads each .tres and .glb and checks the textures (which file, their size) and the
//      parameters against what the export wrote, and prints PASS / FAIL lines, collected into a report here.
import fs from "node:fs";
import path from "node:path";
import { EXAMPLES, SKIP, exampleFile, exportWithCli, findExecutable, report, run, tempDir } from "./common.mjs";

const SIZE = 256;

/* ---------- what the export says, read on the Node side ---------- */

/** the [resource] properties of a .tres the way Godot should load them: textures, numbers, booleans, colours */
export function tresExpectations(text) {
  const files = {};
  for (const m of text.matchAll(/\[ext_resource path="([^"]+)"[^\]]*id=("?)([^\]"\s]+)\2/g)) files[m[3]] = m[1];
  const body = text.slice(text.indexOf("[resource]") + "[resource]".length);
  const props = [];
  for (const line of body.split("\n")) {
    const m = /^(\w+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, name, v] = m;
    let r;
    if ((r = /^ExtResource\(\s*"?([^")\s]+)"?\s*\)$/.exec(v))) props.push({ name, kind: "texture", file: path.basename(files[r[1]] ?? "?") });
    else if ((r = /^Color\((.*)\)$/.exec(v))) props.push({ name, kind: "color", value: r[1].split(",").map(Number) });
    else if (v === "true" || v === "false") props.push({ name, kind: "bool", value: v === "true" });
    else if (!Number.isNaN(Number(v))) props.push({ name, kind: "number", value: Number(v) });
  }
  const cls = /gd_resource type="(\w+)"/.exec(text)?.[1];
  return { class: cls, props };
}

/** which textures a .glb carries (its JSON chunk) */
export function glbExpectations(buf) {
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString());
  const m = gltf.materials?.[0] ?? {};
  const pbr = m.pbrMetallicRoughness ?? {};
  return {
    albedo: !!pbr.baseColorTexture,
    orm: !!pbr.metallicRoughnessTexture,
    normal: !!m.normalTexture,
    occlusion: !!m.occlusionTexture,
    emission: !!m.emissiveTexture,
    roughness: pbr.roughnessFactor ?? 1,
    metallic: pbr.metallicFactor ?? 1,
  };
}

/* ---------- the GDScript Godot runs ---------- */

const CHECK_GD = String.raw`extends SceneTree
# Run by tests/engines/godot-import.mjs: godot --headless --path <project> --script res://check.gd
# res://cases.json lists what to load and what to expect. Prints one PASS or FAIL line per check, then DONE.

var failures := 0

func check(ok: bool, what: String) -> void:
	if ok:
		print("PASS ", what)
	else:
		failures += 1
		print("FAIL ", what)

func has_property(o: Object, name: String) -> bool:
	for p in o.get_property_list():
		if p.name == name:
			return true
	return false

func _initialize() -> void:
	var cases = JSON.parse_string(FileAccess.get_file_as_string("res://cases.json"))
	for c in cases:
		if c.kind == "tres":
			check_tres(c)
		else:
			check_glb(c)
	print("DONE ", failures)
	quit(1 if failures > 0 else 0)

# a .tres from an export profile: its class, then every property the file sets
func check_tres(c: Dictionary) -> void:
	var label: String = c.label
	var m = load(c.path)
	check(m != null, "%s: loads" % label)
	if m == null:
		return
	check(m.get_class() == c["class"], "%s: is a %s (Godot made a %s)" % [label, c["class"], m.get_class()])
	for p in c.props:
		var what := "%s: %s" % [label, p.name]
		if not has_property(m, p.name):
			check(false, "%s: Godot 4 has no such property, the value is ignored" % what)
			continue
		var v = m.get(p.name)
		match p.kind:
			"texture":
				var ok: bool = v is Texture2D and v.resource_path.get_file() == p.file
				check(ok, "%s is %s" % [what, p.file])
				if ok:
					check(v.get_width() == int(c.size) and v.get_height() == int(c.size), "%s is %d×%d (got %d×%d)" % [what, c.size, c.size, v.get_width(), v.get_height()])
			"number":
				check(abs(float(v) - float(p.value)) < 0.001, "%s = %s (got %s)" % [what, p.value, v])
			"bool":
				check(bool(v) == bool(p.value), "%s = %s (got %s)" % [what, p.value, v])
			"color":
				var e: Array = p.value
				var ok: bool = v is Color and abs(v.r - e[0]) < 0.002 and abs(v.g - e[1]) < 0.002 and abs(v.b - e[2]) < 0.002 and abs(v.a - e[3]) < 0.002
				check(ok, "%s = Color%s (got %s)" % [what, str(e), v])

func find_mesh(n: Node) -> MeshInstance3D:
	if n is MeshInstance3D:
		return n
	for child in n.get_children():
		var m := find_mesh(child)
		if m != null:
			return m
	return null

# a .glb: Godot's glTF importer should give its mesh a material with the textures in the right slots
func check_glb(c: Dictionary) -> void:
	var label: String = c.label
	var scene = load(c.path)
	check(scene is PackedScene, "%s: imports as a scene" % label)
	if not scene is PackedScene:
		return
	var root: Node = scene.instantiate()
	var mesh := find_mesh(root)
	check(mesh != null, "%s: has a mesh" % label)
	if mesh == null:
		return
	var m = mesh.get_active_material(0)
	check(m is BaseMaterial3D, "%s: the mesh has a StandardMaterial3D" % label)
	if not m is BaseMaterial3D:
		return
	var e: Dictionary = c.expect
	if e.albedo:
		check(m.albedo_texture != null and m.albedo_texture.get_width() == int(c.size), "%s: albedo_texture, %d px" % [label, c.size])
	if e.orm:
		# glTF's metallicRoughness texture: roughness in green, metallic in blue
		check(m.roughness_texture != null and m.roughness_texture_channel == BaseMaterial3D.TEXTURE_CHANNEL_GREEN, "%s: roughness_texture, green channel" % label)
		check(m.metallic_texture != null and m.metallic_texture_channel == BaseMaterial3D.TEXTURE_CHANNEL_BLUE, "%s: metallic_texture, blue channel" % label)
		check(abs(m.roughness - float(e.roughness)) < 0.001, "%s: roughness = %s (got %s)" % [label, e.roughness, m.roughness])
		check(abs(m.metallic - float(e.metallic)) < 0.001, "%s: metallic = %s (got %s)" % [label, e.metallic, m.metallic])
	if e.normal:
		check(m.normal_enabled and m.normal_texture != null, "%s: normal map on" % label)
	if e.occlusion:
		check(m.ao_enabled and m.ao_texture != null, "%s: ambient occlusion on" % label)
	if e.emission:
		check(m.emission_enabled and m.emission_texture != null, "%s: emission on" % label)
	root.free()
`;

/* ---------- running it ---------- */

function godotVersion(exe) {
  const r = run(exe, ["--version"], { timeout: 60000 });
  return r.code === 0 ? r.out.trim().split("\n").pop() : null;
}

export async function main() {
  const exe = findExecutable({ env: "GODOT_BIN", names: ["godot", "godot4", "Godot"], apps: ["/Applications/Godot.app/Contents/MacOS/Godot", "/Applications/Godot_mono.app/Contents/MacOS/Godot"] });
  if (!exe) {
    console.log("Godot: SKIPPED — Godot 4 is not installed (set GODOT_BIN, put godot on PATH, or install /Applications/Godot.app)");
    return SKIP;
  }
  const version = godotVersion(exe);
  if (!version?.startsWith("4.")) {
    console.log(`Godot: SKIPPED — ${exe} is not Godot 4 (it says ${version ?? "nothing"})`);
    return SKIP;
  }
  console.log(`Godot ${version}: ${exe}`);

  const project = tempDir("material-pro-godot-");
  fs.writeFileSync(path.join(project, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="Material Pro import check"\n');
  const cases = [];
  for (const ex of EXAMPLES) {
    const file = exampleFile(ex, project);
    for (const [dir, target] of [
      ["standard", "Godot/Godot 4 Standard"],
      ["orm", "Godot/Godot 4 ORM"],
    ]) {
      const out = path.join(project, dir);
      exportWithCli(file, target, out, SIZE, ["--no-export-nodes"]);
      const tres = `${ex}.tres`;
      cases.push({ kind: "tres", label: `${ex} (${target})`, path: `res://${dir}/${tres}`, size: SIZE, ...tresExpectations(fs.readFileSync(path.join(out, tres), "utf8")) });
    }
    const out = path.join(project, "glb");
    exportWithCli(file, "glb", out, SIZE);
    cases.push({ kind: "glb", label: `${ex}.glb`, path: `res://glb/${ex}.glb`, size: SIZE, expect: glbExpectations(fs.readFileSync(path.join(out, `${ex}.glb`))) });
    fs.rmSync(file);
  }
  fs.writeFileSync(path.join(project, "cases.json"), JSON.stringify(cases, null, 1));
  fs.writeFileSync(path.join(project, "check.gd"), CHECK_GD);

  // import every file (Godot 4.2+); older 4.x import when the editor opens the project once
  let imp = run(exe, ["--headless", "--path", project, "--import"]);
  if (imp.code !== 0 || !fs.existsSync(path.join(project, ".godot/imported"))) imp = run(exe, ["--headless", "--path", project, "--editor", "--quit"]);
  if (!fs.existsSync(path.join(project, ".godot/imported"))) {
    console.log(`Godot: the import did not run (exit ${imp.code}):\n${imp.out.slice(-3000)}`);
    return 1;
  }
  const r = run(exe, ["--headless", "--path", project, "--script", "res://check.gd"]);
  const failed = report(`Godot ${version} — ${cases.length} materials`, r.out);
  if (failed) console.log(`  the Godot project is kept for a look: ${project}`);
  else fs.rmSync(project, { recursive: true, force: true });
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
