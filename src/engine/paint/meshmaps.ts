/* Connects Mesh Map nodes (GenMeshMap) to the maps baked from the current mesh. */
import { meshMapHooks } from "../gen/misc";
import type { Renderer } from "../render/renderer";
import { mapGeneratorFor, type MapName } from "./mapgen";
import { currentMesh } from "./mesh";

/** the size Mesh Map nodes bake at (Material Maker uses 2048; smaller keeps the browser responsive) */
import { BAKE_SETTINGS } from "./mapgen";
export const MESH_MAP_SIZE = { value: 2048 };

export function installMeshMaps(): void {
  meshMapHooks.aabb = () => currentMesh()?.aabb ?? null;
  meshMapHooks.texture = (renderer, map) => {
    const m = currentMesh();
    if (!m) return null;
    const target = mapGeneratorFor(renderer as Renderer).get(m, map as MapName, MESH_MAP_SIZE.value);
    return { target, sig: `${m.id}:${map}:${MESH_MAP_SIZE.value}:${JSON.stringify(BAKE_SETTINGS)}` };
  };
}
