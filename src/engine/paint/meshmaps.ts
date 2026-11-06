/* Connects Mesh Map nodes (GenMeshMap) to the maps baked from the current mesh. */
import { meshMapHooks } from "../gen/misc";
import type { Renderer } from "../render/renderer";
import { mapGeneratorFor, type MapName } from "./mapgen";
import { currentMesh } from "./mesh";
import { BAKE_SETTINGS } from "./mapgen";
import { bakeMap } from "./paint-client";

/** the size Mesh Map nodes bake at (Material Maker uses 2048; smaller keeps the browser responsive) */
export const MESH_MAP_SIZE = { value: 2048 };

/** called when a map baked in the background is ready (renders that used a blank map can be drawn again) */
export const meshMapBaked = new Set<() => void>();

/** `background`: a map that is not baked yet is baked without blocking the page (paint-client.ts) and renders read a
 *  blank map until then; otherwise (tests, the command line) it is baked on the spot */
export function installMeshMaps(opts: { background?: boolean } = {}): void {
  meshMapHooks.aabb = () => currentMesh()?.aabb ?? null;
  meshMapHooks.texture = (renderer, map) => {
    const m = currentMesh();
    if (!m) return null;
    const r = renderer as Renderer;
    const size = MESH_MAP_SIZE.value;
    const name = map as MapName;
    if (opts.background && !mapGeneratorFor(r).has(m, name, size)) {
      bakeMap(r, m, name, size).then(
        () => meshMapBaked.forEach((l) => l()),
        (e) => console.error("mesh map bake", e),
      );
      return { target: null, sig: `baking:${m.id}:${map}:${size}` };
    }
    const target = mapGeneratorFor(r).get(m, name, size);
    return { target, sig: `${m.id}:${map}:${size}:${JSON.stringify(BAKE_SETTINGS)}` };
  };
}
