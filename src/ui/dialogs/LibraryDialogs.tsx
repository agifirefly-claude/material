/* Adding nodes to user libraries (main_window.add_selection_to_library) and managing libraries
 * (panels/library: create, load, unload, enable; files in Material Maker's library format). */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Dict, Gen } from "../../engine/gen/base";
import { GenContext } from "../../engine/context";
import { GenMaterial } from "../../engine/gen/misc";
import { editor } from "../store";
import { libraries, USER_LIBRARY } from "../library/manager";
import { downloadBlob } from "../exporting";
import { t, tPath, useLang } from "../i18n";

/** a 64×64 PNG of a node's first output, as Material Maker's library icons are */
export function nodeIcon(gen: Gen): string | undefined {
  const r = editor.renderer;
  if (!r) return undefined;
  const outs = gen instanceof GenMaterial ? gen.getOutputDefs(true) : gen.getOutputDefs();
  if (!outs.length) return undefined;
  try {
    // output 0 through its preview, at 64×64, like main_window.add_selection_to_library (generator.render(self, 0, 64, true))
    const target = r.render(gen.getShaderCode("uv", 0, new GenContext()), 64);
    const img = r.toImageData(target);
    r.deleteTarget(target);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    c.getContext("2d")!.putImageData(img, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  } catch {
    return undefined;
  }
}

/** what a library item made from the selection holds: one node, or several with their links */
export function selectionData(gens: Gen[]): Dict {
  if (gens.length === 1) {
    const d = gens[0].serialize();
    delete d.node_position;
    return d;
  }
  const names = new Set(gens.map((g) => g.name));
  return { nodes: gens.map((g) => g.serialize()), connections: editor.graph.connections.filter((c) => names.has(c.from) && names.has(c.to)) };
}

export function AddToLibraryDialog({ payload, onClose }: { payload: Gen | { gen: Gen; library?: string; name?: string; iconOnly?: boolean }; onClose: () => void }) {
  useLang();
  const p: { gen: Gen; library?: string; name?: string; iconOnly?: boolean } = typeof (payload as Gen).serialize === "function" ? { gen: payload as Gen } : (payload as { gen: Gen });
  const sel = editor.selection.map((n) => editor.graph.getNode(n)).filter((x): x is Gen => !!x);
  const gens = sel.includes(p.gen) ? sel : [p.gen];
  const writable = libraries.libraries.filter((l) => !l.builtin);
  const [lib, setLib] = useState(p.library ?? USER_LIBRARY);
  const [name, setName] = useState(p.name ?? `${t("My nodes")}/${p.gen.getTypeName()}`);
  const [icon, setIcon] = useState<string | undefined>();
  useEffect(() => setIcon(nodeIcon(p.gen)), [p.gen]);
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
      <h2>{p.iconOnly ? t("Update the library icon") : t("New library element")}</h2>
      <div style={{ display: "flex", gap: 12 }}>
        {icon ? <img src={"data:image/png;base64," + icon} width={64} height={64} alt="" style={{ borderRadius: 4 }} /> : <div style={{ width: 64, height: 64, background: "var(--bg)" }} />}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {!p.iconOnly && (
            <>
              <label className="ne-field wide">
                <span>{t("Library")}</span>
                <select value={lib} onChange={(e) => setLib(e.target.value)}>
                  {writable.map((l) => (
                    <option key={l.id} value={l.id}>
                      {t(l.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ne-field wide">
                <span>{t("Name (a path such as Folder/Name)")}</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
              </label>
              <div style={{ color: "var(--text3)" }}>{gens.length > 1 ? t("{0} nodes and the links between them", gens.length) : t("One node, with its parameters")}</div>
            </>
          )}
        </div>
      </div>
      <div className="ne-buttons">
        <button onClick={onClose}>{t("Cancel")}</button>
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => {
            if (p.iconOnly) {
              if (icon) libraries.updateIcon(lib, name, icon);
            } else {
              libraries.addItem(lib, name.trim().replace(/^\/+|\/+$/g, ""), selectionData(gens), icon);
              editor.setStatus(t("Added “{0}” to {1}", name, t(libraries.library(lib)?.name ?? "")));
            }
            onClose();
          }}
        >
          {t("OK")}
        </button>
      </div>
    </div>
  );
}

export function LibrariesDialog({ onClose }: { onClose: () => void }) {
  useLang();
  useSyncExternalStore(libraries.subscribe, libraries.getVersion);
  const importFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        libraries.importLibrary(await f.text(), f.name.replace(/\.json$/, ""));
      } catch (e) {
        alert(t("Cannot load this library: {0}", String(e)));
      }
    };
    input.click();
  };
  return (
    <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
      <h2>{t("Libraries")}</h2>
      <table className="lib-table">
        <thead>
          <tr>
            <th>{t("Shown")}</th>
            <th>{t("Name")}</th>
            <th>{t("Items")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {libraries.libraries.map((l) => (
            <tr key={l.id}>
              <td>
                <input type="checkbox" checked={libraries.isEnabled(l.id)} onChange={() => libraries.toggleLibrary(l.id)} />
              </td>
              <td>
                {l.builtin ? (
                  t(l.name)
                ) : (
                  <input type="text" value={l.name} onChange={(e) => libraries.renameLibrary(l.id, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                )}
              </td>
              <td>{l.items.length}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button onClick={() => downloadBlob(new Blob([libraries.exportLibrary(l.id)], { type: "application/json" }), `${l.name.replace(/\W+/g, "_")}.json`)}>{t("Export")}</button>{" "}
                {!l.builtin && l.id !== USER_LIBRARY && (
                  <button onClick={() => confirm(t("Remove the library “{0}”?", l.name)) && libraries.removeLibrary(l.id)}>{t("Remove")}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ne-buttons" style={{ justifyContent: "flex-start" }}>
        <button
          onClick={() => {
            const n = prompt(t("Name of the new library"), t("My library"));
            if (n) libraries.createLibrary(n);
          }}
        >
          + {t("Create a library")}
        </button>
        <button onClick={importFile}>{t("Load a library file…")}</button>
        <span style={{ flex: 1 }} />
        <button className="primary" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <div className="sect" style={{ marginTop: 10 }}>
        {t("Quick bar of the add node popup")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {libraries.quick.map((q, i) => (
          <span key={i} className="lib-badge" style={{ fontSize: 11 }}>
            {i + 1}. {tPath(q)}
          </span>
        ))}
      </div>
    </div>
  );
}
