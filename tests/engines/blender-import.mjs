// Loads Material Pro's Blender exports into a real Blender and checks what Blender makes of them.
//
//   node tests/engines/blender-import.mjs          (or npm run test:engines)
//
// Blender is looked for in BLENDER_BIN, then on PATH (blender), then in /Applications/Blender.app. Nothing is
// downloaded: without Blender the check is skipped. With it:
//   1. the "Blender" export profile and a .glb of a few examples are made with the command line;
//   2. Blender runs in the background (-b) with a Python script (written below) that
//      - loads the profile's maps the way Material Maker's Blender maps are meant to be used (albedo and emission as
//        colour, roughness / metal / displace / occlusion EXR and the normal map as non-colour data), wires them
//        into a Principled BSDF and checks every image loaded, has the right size and is linked where it should be;
//      - imports the .glb with Blender's glTF importer and checks the textures reach Base Color, Metallic,
//        Roughness, Normal (through a Normal Map node) and Emission;
//   3. the PASS / FAIL lines it prints become the report here.
import fs from "node:fs";
import path from "node:path";
import { EXAMPLES, SKIP, exampleFile, exportWithCli, findExecutable, report, run, tempDir } from "./common.mjs";
import { glbExpectations } from "./godot-import.mjs";

const SIZE = 256;

const CHECK_PY = String.raw`# Run by tests/engines/blender-import.mjs:
#   blender -b --factory-startup --python-exit-code 1 --python check.py -- cases.json
# Prints one PASS or FAIL line per check, then DONE.
import bpy, json, os, sys

cases = json.load(open(sys.argv[sys.argv.index("--") + 1]))
failures = 0

def check(ok, what):
    global failures
    print(("PASS " if ok else "FAIL ") + what, flush=True)
    if not ok:
        failures += 1

def bsdf_input(bsdf, *names):
    # inputs were renamed over Blender versions ("Emission" became "Emission Color" in 4.0)
    for n in names:
        if n in bsdf.inputs:
            return bsdf.inputs[n]
    return None

def upstream(socket, seen=None):
    # every node that feeds a socket, following links back through the tree
    seen = set() if seen is None else seen
    for link in socket.links:
        n = link.from_node
        if n.name in seen:
            continue
        seen.add(n.name)
        yield n
        for s in n.inputs:
            yield from upstream(s, seen)

def images_into(socket):
    return [n.image for n in upstream(socket) if n.type == "TEX_IMAGE" and n.image]

def check_image(img, label, size, float_data):
    w, h = img.size
    # reading pixels makes Blender decode the file: an empty list means it could not
    check(w > 0 and h > 0 and len(img.pixels[:4]) == 4, label + ": decodes")
    check((w, h) == (size, size), "%s: %d×%d (got %d×%d)" % (label, size, size, w, h))
    if float_data is not None:
        check(img.is_float == float_data, "%s: %s" % (label, "float (EXR)" if float_data else "8 bit"))

# ---- the Blender profile: its maps wired into a material by hand ----
# map suffix: (BSDF input names, colour space, float file, how it is connected)
MAPS = {
    "albedo": (("Base Color",), "sRGB", False, "direct"),
    "rough": (("Roughness",), "Non-Color", True, "direct"),
    "metal": (("Metallic",), "Non-Color", True, "direct"),
    "normal": (("Normal",), "Non-Color", False, "normal_map"),
    "emission": (("Emission Color", "Emission"), "sRGB", False, "direct"),
    "displace": ((), "Non-Color", True, "displacement"),
    "occlusion": ((), "Non-Color", True, None),
    "sss": ((), "Non-Color", True, None),
}

def check_profile(c):
    mat = bpy.data.materials.new(c["label"])
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    out = nt.nodes["Material Output"]
    for key, f in c["files"].items():
        if key not in MAPS:
            check(False, "%s: unexpected file %s" % (c["label"], os.path.basename(f)))
            continue
        inputs, space, is_float, how = MAPS[key]
        label = "%s: %s" % (c["label"], os.path.basename(f))
        try:
            img = bpy.data.images.load(f, check_existing=False)
        except RuntimeError as e:
            check(False, "%s: Blender cannot read it (%s)" % (label, e))
            continue
        img.colorspace_settings.name = space
        check_image(img, label, c["size"], is_float)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        if how == "direct":
            sock = bsdf_input(bsdf, *inputs)
            check(sock is not None, "%s: the Principled BSDF has %s" % (label, " / ".join(inputs)))
            if sock is not None:
                nt.links.new(tex.outputs["Color"], sock)
                check(img in images_into(sock), "%s: linked to %s" % (label, sock.name))
        elif how == "normal_map":
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
            check(img in images_into(bsdf.inputs["Normal"]), label + ": linked to Normal through a Normal Map")
        elif how == "displacement":
            d = nt.nodes.new("ShaderNodeDisplacement")
            nt.links.new(tex.outputs["Color"], d.inputs["Height"])
            nt.links.new(d.outputs["Displacement"], out.inputs["Displacement"])
            check(img in images_into(out.inputs["Displacement"]), label + ": linked to the output's Displacement")

# ---- the .glb: Blender's own glTF importer ----
def check_glb(c):
    label = c["label"]
    before = set(bpy.data.materials)
    try:
        bpy.ops.import_scene.gltf(filepath=c["path"])
    except Exception as e:
        check(False, "%s: imports (%s)" % (label, e))
        return
    mats = [m for m in bpy.data.materials if m not in before]
    check(len(mats) == 1, "%s: imports one material (got %d)" % (label, len(mats)))
    if not mats:
        return
    nt = mats[0].node_tree
    bsdfs = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"]
    check(len(bsdfs) == 1, label + ": has a Principled BSDF")
    if not bsdfs:
        return
    bsdf = bsdfs[0]
    e = c["expect"]
    def into(names, what):
        sock = bsdf_input(bsdf, *names)
        imgs = images_into(sock) if sock is not None else []
        check(len(imgs) > 0, "%s: a texture reaches %s" % (label, what))
        for img in imgs:
            check(tuple(img.size) == (c["size"], c["size"]), "%s: the %s texture is %d px (got %d×%d)" % (label, what, c["size"], img.size[0], img.size[1]))
    if e["albedo"]:
        into(("Base Color",), "Base Color")
    if e["orm"]:
        into(("Metallic",), "Metallic")
        into(("Roughness",), "Roughness")
    if e["normal"]:
        into(("Normal",), "Normal")
        check(any(n.type == "NORMAL_MAP" for n in upstream(bsdf.inputs["Normal"])), label + ": through a Normal Map node")
    if e["emission"]:
        into(("Emission Color", "Emission"), "Emission")

for c in cases:
    if c["kind"] == "profile":
        check_profile(c)
    else:
        check_glb(c)
print("DONE", failures, flush=True)
sys.exit(1 if failures else 0)
`;

export async function main() {
  const exe = findExecutable({ env: "BLENDER_BIN", names: ["blender", "Blender"], apps: ["/Applications/Blender.app/Contents/MacOS/Blender"] });
  if (!exe) {
    console.log("Blender: SKIPPED — Blender is not installed (set BLENDER_BIN, put blender on PATH, or install /Applications/Blender.app)");
    return SKIP;
  }
  const v = run(exe, ["--version"], { timeout: 120000 });
  const version = /Blender\s+([\d.]+)/.exec(v.out)?.[1];
  if (!version) {
    console.log(`Blender: SKIPPED — ${exe} does not answer like Blender (exit ${v.code})`);
    return SKIP;
  }
  console.log(`Blender ${version}: ${exe}`);

  const dir = tempDir("material-pro-blender-");
  const cases = [];
  for (const ex of EXAMPLES) {
    const file = exampleFile(ex, dir);
    const out = path.join(dir, ex);
    exportWithCli(file, "Blender", out, SIZE, ["--no-export-nodes"]);
    const files = {};
    for (const f of fs.readdirSync(out)) {
      const key = f.slice(ex.length + 1).replace(/\.\w+$/, "");
      if (f.startsWith(ex + "_")) files[key] = path.join(out, f);
    }
    cases.push({ kind: "profile", label: `${ex} (Blender profile)`, size: SIZE, files });
    exportWithCli(file, "glb", out, SIZE);
    const glb = path.join(out, `${ex}.glb`);
    cases.push({ kind: "glb", label: `${ex}.glb`, path: glb, size: SIZE, expect: glbExpectations(fs.readFileSync(glb)) });
  }
  fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify(cases, null, 1));
  fs.writeFileSync(path.join(dir, "check.py"), CHECK_PY);

  const r = run(exe, ["-b", "--factory-startup", "--python-exit-code", "1", "--python", path.join(dir, "check.py"), "--", path.join(dir, "cases.json")]);
  const failed = report(`Blender ${version} — ${cases.length} cases`, r.out);
  if (failed) console.log(`  the exported files and check.py are kept for a look: ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
