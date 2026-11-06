/* Material Maker's project file format (.ptex): JSON where shader code is written as arrays of lines
 * (MMLoader.replace_multiline_strings_with_arrays / replace_arrays_with_multiline_strings). */
import JSON5 from "json5";
import type { Dict } from "./gen/base";
import type { GenGraph } from "./gen/graph";

const PROCESS = ["code", "custom", "global", "instance", "preview_shader", "template"];
const WALK = ["shader_model", "nodes", "template", "files"];

/** code strings as arrays of lines, as Material Maker writes them */
export function splitLines(data: unknown, walkChildren = false): unknown {
  if (Array.isArray(data)) return data.map((d) => splitLines(d));
  if (data && typeof data === "object") {
    const out: Dict = {};
    for (const [k, v] of Object.entries(data as Dict)) {
      if (PROCESS.includes(k) && typeof v === "string") out[k] = v.includes("\n") ? v.replaceAll("    ", "\t").split("\n") : v;
      else if (walkChildren || WALK.includes(k)) out[k] = splitLines(v);
      else if (k === "exports") out[k] = splitLines(v, true);
      else out[k] = v;
    }
    return out;
  }
  return data;
}

/** arrays of lines back to code strings */
export function joinLines(data: unknown, walkChildren = false): unknown {
  if (Array.isArray(data)) return data.map((d) => joinLines(d));
  if (data && typeof data === "object") {
    const out: Dict = {};
    for (const [k, v] of Object.entries(data as Dict)) {
      if (PROCESS.includes(k) && Array.isArray(v)) out[k] = v.join("\n");
      else if (walkChildren || WALK.includes(k)) out[k] = joinLines(v);
      else if (k === "exports") out[k] = joinLines(v, true);
      else out[k] = v;
    }
    return out;
  }
  return data;
}

/** a project graph as .ptex text */
export function serializeProject(root: GenGraph, title: string): string {
  const data = root.serialize();
  data.name = title;
  data.node_position = { x: 0, y: 0 };
  return JSON.stringify(splitLines(data), null, "\t");
}

/** .ptex text (or any lenient JSON of it) as project data */
export function parseProject(text: string): Dict {
  return joinLines(JSON5.parse(text)) as Dict;
}
