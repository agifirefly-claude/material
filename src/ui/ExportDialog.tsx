/* Export, by framework: Material Maker's engine targets (Blender, Unity, Godot, Unreal, glTF plane) and this
 * port's own (Cocos Creator, binary glTF, m3e-canvas-pro, a plain texture set). */
import { useState } from "react";
import { zipSync } from "fflate";
import { editor } from "./store";
import { t } from "./i18n";
import { findMaterial } from "../engine/materialMaps";
import { exportProfiles } from "../engine/export";
import { downloadBlob, exportForEngine, exportMaterialMaps, projectText } from "./exporting";
import { cocosFiles, glbFile, type GltfShape } from "../export/engines";
import { buildM3eMaterial } from "../export/m3eMaterial";
import type { GenMaterial } from "../engine/gen/misc";

type Group = { key: string; label: string; note: string; profiles: string[]; extra?: "cocos" | "glb" | "m3e" | "maps" };

function groups(m: GenMaterial): Group[] {
  const all = exportProfiles(m);
  const take = (re: RegExp) => all.filter((p) => re.test(p));
  const gs: Group[] = [
    { key: "blender", label: "Blender", note: t("Texture maps named for Blender (albedo, roughness, metallic, normal, displacement, SSS, emission, occlusion)"), profiles: take(/^Blender/) },
    { key: "unity", label: "Unity", note: t("Built-in render pipeline, URP and HDRP materials"), profiles: take(/^Unity/) },
    { key: "godot", label: "Godot", note: t("Godot 3 and 4 materials (.tres) and shaders"), profiles: take(/^Godot/) },
    { key: "unreal", label: "Unreal Engine", note: t("Unreal Engine 4 and 5"), profiles: take(/^Unreal/) },
    { key: "cocos", label: "Cocos Creator", note: t("Cocos Creator 3.x: a .mtl material on builtin-standard with its textures and .meta files; drop the folder into assets"), profiles: [], extra: "cocos" },
    { key: "gltf", label: "glTF", note: t("A .glb with the material, which Cocos, Blender, Godot, Unity (glTFast), Unreal, three.js and Babylon.js import"), profiles: take(/^GLTF/), extra: "glb" },
    { key: "m3e", label: "m3e-canvas-pro", note: t("An m3e material file (docs/m3e-material.md): the material for UI surfaces, as it is or recoloured to the theme"), profiles: [], extra: "m3e" },
    { key: "maps", label: t("Texture set"), note: t("Every map as PNG files, for any other tool"), profiles: [], extra: "maps" },
  ];
  const used = new Set(gs.flatMap((g) => g.profiles));
  const rest = all.filter((p) => !used.has(p));
  if (rest.length) gs.push({ key: "other", label: t("Other"), note: "", profiles: rest });
  return gs.filter((g) => g.profiles.length || g.extra);
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const m = findMaterial(editor.root);
  const [size, setSize] = useState(m ? Math.round(Math.log2(m.imageSize)) : 10);
  const [name, setName] = useState(editor.title.replace(/[^\w.-]/g, "_") || "material");
  const [shape, setShape] = useState<GltfShape>("plane");
  const [m3e, setM3e] = useState({ tile: 160, resolution: 512, azimuth: 315, elevation: 45, raw: true, format: "webp" as "webp" | "png", project: true });
  const [busy, setBusy] = useState(false);
  if (!m)
    return (
      <div className="modal-back" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>{t("Export")}</h2>
          <p>{t("This project has no material node.")}</p>
        </div>
      </div>
    );
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    editor.setStatus(t("Exporting…"));
    await new Promise((r) => setTimeout(r, 30));
    try {
      await f();
      onClose();
    } catch (e) {
      editor.setStatus(t("Export failed: {0}", String((e as Error).message ?? e)));
    } finally {
      setBusy(false);
    }
  };
  const withTitle = (f: () => Promise<void>) => async () => {
    const old = editor.title;
    editor.title = name;
    try {
      await f();
    } finally {
      editor.title = old;
    }
  };
  // renders in the render worker where the browser can: the editor stays usable while a big export renders
  const r = editor.renders!;
  const extra = (g: Group) => {
    switch (g.extra) {
      case "cocos":
        return (
          <button disabled={busy} onClick={() => run(async () => downloadBlob(new Blob([zipSync(await cocosFiles(r, m, name, 2 ** size), { level: 0 })]), `${name}_cocos.zip`))}>
            {t("Cocos Creator 3.x material")}
          </button>
        );
      case "glb":
        return (
          <span style={{ display: "inline-flex", gap: 4 }}>
            <select value={shape} onChange={(e) => setShape(e.target.value as GltfShape)}>
              <option value="plane">{t("plane")}</option>
              <option value="sphere">{t("sphere")}</option>
              <option value="cube">{t("cube")}</option>
            </select>
            <button disabled={busy} onClick={() => run(async () => downloadBlob(new Blob([(await glbFile(r, m, name, 2 ** size, shape)) as BlobPart], { type: "model/gltf-binary" }), `${name}.glb`))}>
              {t("Binary glTF (.glb)")}
            </button>
          </span>
        );
      case "maps":
        return (
          <button disabled={busy} onClick={() => run(withTitle(() => exportMaterialMaps(2 ** size)))}>
            {t("All maps (zip)")}
          </button>
        );
      case "m3e":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label>
                {t("Tile size")} <input type="number" min={8} max={2048} value={m3e.tile} style={{ width: 64 }} onChange={(e) => setM3e({ ...m3e, tile: +e.target.value })} /> px
              </label>
              <label>
                {t("Resolution")}{" "}
                <select value={m3e.resolution} onChange={(e) => setM3e({ ...m3e, resolution: +e.target.value })}>
                  {[128, 256, 512, 1024].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Light direction")} <input type="number" min={0} max={360} value={m3e.azimuth} style={{ width: 56 }} onChange={(e) => setM3e({ ...m3e, azimuth: +e.target.value })} />°
              </label>
              <label>
                {t("Light height")} <input type="number" min={1} max={90} value={m3e.elevation} style={{ width: 52 }} onChange={(e) => setM3e({ ...m3e, elevation: +e.target.value })} />°
              </label>
              <label>
                <input type="checkbox" checked={m3e.raw} onChange={(e) => setM3e({ ...m3e, raw: e.target.checked })} /> {t("Include the PBR maps")}
              </label>
              <label>
                <input type="checkbox" checked={m3e.project} onChange={(e) => setM3e({ ...m3e, project: e.target.checked })} /> {t("Include the project, to edit it again")}
              </label>
              <select value={m3e.format} onChange={(e) => setM3e({ ...m3e, format: e.target.value as "webp" | "png" })}>
                <option value="webp">WebP</option>
                <option value="png">PNG</option>
              </select>
            </div>
            <div>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const file = await buildM3eMaterial(r, m, {
                      name,
                      tile: m3e.tile,
                      resolution: m3e.resolution,
                      light: { azimuth: m3e.azimuth, elevation: m3e.elevation },
                      rawMaps: m3e.raw,
                      format: m3e.format,
                      project: m3e.project ? projectText() : undefined,
                    });
                    downloadBlob(new Blob([JSON.stringify(file)], { type: "application/json" }), `${name}.m3e-material.json`);
                  })
                }
              >
                {t("m3e material file")}
              </button>
            </div>
          </div>
        );
    }
    return null;
  };
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t("Export")}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          {t("Name")} <input type="text" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w.-]/g, "_"))} />
          {t("Size")}
          <select value={size} onChange={(e) => setSize(+e.target.value)}>
            {[8, 9, 10, 11, 12, 13].map((i) => (
              <option key={i} value={i}>
                {2 ** i}×{2 ** i}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups(m).map((g) => (
            <div key={g.key} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <div style={{ fontWeight: 600, color: "#fff" }}>{g.label}</div>
              {g.note && <div style={{ color: "var(--text3)", marginBottom: 6 }}>{g.note}</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                {g.profiles.map((p) => (
                  <button key={p} disabled={busy} onClick={() => run(withTitle(() => exportForEngine(p, 2 ** size)))}>
                    {p.split("/").pop()}
                  </button>
                ))}
                {extra(g)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
