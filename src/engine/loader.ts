/* Port of MMLoader.create_gen (addons/material_maker/engine/loader.gd): builds generators from file data. */
import { registry } from "./registry";
import { factory, Gen, type Dict } from "./gen/base";
import { GenShader } from "./gen/shader";
import { GenComment, GenGraph, GenIOs, GenPassthrough, GenPortal, GenRemote, GenReroute, GenSwitch } from "./gen/graph";
import { GenBuffer, GenImage, GenIterateBuffer, GenText } from "./gen/texture";
import { GenAutoExport, GenDebug, GenExport, GenMaterial, GenMeshMap, GenWebcam } from "./gen/misc";

type Ctor = new () => Gen;
const TYPES: Record<string, Ctor> = {
  material_export: GenMaterial,
  autoexport: GenAutoExport,
  buffer: GenBuffer,
  image: GenImage,
  text: GenText,
  iterate_buffer: GenIterateBuffer,
  meshmap: GenMeshMap,
  ios: GenIOs,
  switch: GenSwitch,
  export: GenExport,
  comment: GenComment,
  webcam: GenWebcam,
  debug: GenDebug,
  reroute: GenReroute,
  portal: GenPortal,
};

function fixData(data: Dict): Dict {
  if (data.nodes && data.connections && data.label === "HBAO") {
    data = { ...data, type: "hbao" };
    delete data.nodes;
    delete data.connections;
  } else if (data.shader_model?.name === "Levels") {
    data = { ...data, type: "height_blend_levels" };
    delete data.shader_model;
  }
  return data;
}

export function createGen(data: Dict, fix = true): Gen | null {
  if (fix) data = fixData(data);
  const guess: [string, Ctor][] = [
    ["shader_model/preview_shader", GenMaterial],
    ["connections", GenGraph],
    ["nodes", GenGraph],
    ["shader_model", GenShader],
    ["model_data", GenShader],
    ["widgets", GenRemote],
  ];
  let g: Gen | null = null;
  for (const [path, ctor] of guess) {
    let d: Dict | undefined = data;
    for (const k of path.split("/")) d = d && typeof d === "object" && k in d ? d[k] : undefined;
    if (d !== undefined) {
      g = new ctor();
      break;
    }
  }
  if (!g && data.type) {
    if (TYPES[data.type]) g = new TYPES[data.type]();
    else if (registry.nodes[data.type]) {
      g = createGen(registry.nodes[data.type], false);
      if (g) g.model = data.type;
    } else if (["brush", "sdf", "comment_line"].includes(data.type)) g = new GenPassthrough(data.type);
    if (g) g.name = data.type;
  }
  if (!g) {
    console.warn("Loader: data not supported", data.type ?? data);
    return null;
  }
  g.deserialize(data);
  return g;
}
factory.createGen = createGen;

/** a new node of a library type (or a built-in type such as "buffer"), with the library item's saved parameters */
export function createNode(type: string, extra: Dict = {}): Gen | null {
  return createGen({ type, ...extra });
}

/** a project (a .ptex file's data) as a graph */
export function loadProject(data: Dict): GenGraph {
  const g = createGen(data);
  if (!(g instanceof GenGraph)) throw new Error("Not a Material Maker project");
  return g;
}

export function newProject(materialType = "material"): GenGraph {
  return loadProject({
    name: "",
    type: "graph",
    nodes: [{ name: "Material", type: materialType, node_position: { x: 0, y: 0 }, parameters: {} }],
    connections: [],
  });
}
