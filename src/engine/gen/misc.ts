/* Ports of gen_material.gd (the material output), gen_meshmap.gd, gen_export.gd, gen_autoexport.gd, gen_debug.gd, gen_webcam.gd */
import { GenContext } from "../context";
import { registry } from "../registry";
import { ShaderCode } from "../shader-code";
import { Gen, type Dict, type ParameterDef, type PortDef } from "./base";
import { GenShader } from "./shader";
import { GenTexture } from "./texture";

/** The material node: its outputs are the texture maps a material is made of. */
export class GenMaterial extends GenShader {
  exportPaths: Dict = {};
  override getType() {
    return "material_export";
  }
  override getTypeName() {
    return this.shaderModel.name ?? "Material";
  }
  override acceptFloatExpressions() {
    return false;
  }
  override canBeDeleted() {
    return false;
  }
  /** the material's texture outputs are not ports in the graph */
  override getOutputDefs(showHidden = false): PortDef[] {
    return showHidden ? super.getOutputDefs() : [];
  }
  get imageSize(): number {
    return Math.pow(2, Number(this.parameters.size ?? 10));
  }
  /** the texture maps the material's preview shader reads, by name: `uniform sampler2D texture_albedo ...; // $output(0)` */
  textureMaps(): { name: string; output: number }[] {
    const rv: { name: string; output: number }[] = [];
    const re = /uniform\s+sampler2D\s+([\w_]+).*output\((\d+)\)/;
    for (const l of String(this.shaderModel.preview_shader ?? "").split("\n")) {
      const m = re.exec(l);
      if (m) rv.push({ name: m[1], output: parseInt(m[2]) });
    }
    return rv;
  }
  isConnected(inputName: string): boolean {
    const i = this.getInputDefs().findIndex((d) => d.name === inputName);
    return i >= 0 && !!this.getSource(i);
  }
  override _serializeData(data: Dict): Dict {
    data = super._serializeData(data);
    data.export_paths = this.exportPaths;
    return data;
  }
  override _deserialize(data: Dict): void {
    super._deserialize(data);
    if (data.export_paths) this.exportPaths = data.export_paths;
  }
}

export const MESH_MAPS = [
  { name: "Position", output_type: "rgb", map: "position", output: "$AABB_POSITION+$AABB_SIZE*texture($TEXTURE, $UV).rgb" },
  { name: "Normal", output_type: "rgb", map: "normal", output: "2.0*texture($TEXTURE, $UV).rgb-vec3(1.0)" },
  { name: "Tangent", output_type: "rgb", map: "tangent", output: "2.0*texture($TEXTURE, $UV).rgb-vec3(1.0)" },
  { name: "Maximum Curvature", output_type: "f", map: "curvature", output: "texture($TEXTURE, $UV).r" },
  { name: "Minimum Curvature", output_type: "f", map: "curvature", output: "texture($TEXTURE, $UV).g" },
  { name: "Cavity", output_type: "f", map: "curvature", code: "vec4 $NODE_curvature = texture($TEXTURE, $UV);", output: "-step($NODE_curvature.r, 0.0)*step($NODE_curvature.g, 0.0)*dot($NODE_curvature.rg, vec2(0.5))" },
  { name: "Pointiness", output_type: "f", map: "curvature", code: "vec4 $NODE_curvature = texture($TEXTURE, $UV);", output: "step(0.0, $NODE_curvature.r)*step(0.0, $NODE_curvature.g)*dot($NODE_curvature.rg, vec2(0.5))" },
  { name: "Ambient occlusion", output_type: "f", map: "ambient_occlusion", output: "texture($TEXTURE, $UV).r" },
  { name: "Bent normals", output_type: "rgb", map: "bent_normals", output: "2.0*texture($TEXTURE, $UV).rgb-vec3(1.0)" },
  { name: "Thickness", output_type: "f", map: "thickness", output: "texture($TEXTURE, $UV).r" },
  { name: "Adjacency", output_type: "rgb", map: "adjacency", output: "texture($TEXTURE, $UV).rgb" },
];

/** Where Mesh Map nodes get the current mesh's maps (set by the paint module, src/engine/paint/meshmaps.ts):
 *  the texture of a map, and the bounding box of the mesh. */
export const meshMapHooks = {
  texture: null as null | ((renderer: unknown, map: string) => { target: unknown; sig: string } | null),
  aabb: null as null | (() => { position: number[]; size: number[] } | null),
};

/** Maps baked from the current mesh (the one in the 3D preview, or the painted model). Until a mesh is set, the map is neutral. */
export class GenMeshMap extends GenTexture {
  private ownAabb = { position: [0, 0, 0], size: [1, 1, 1] };
  get aabb() {
    return meshMapHooks.aabb?.() ?? this.ownAabb;
  }
  set aabb(v) {
    this.ownAabb = v;
  }
  externalTarget(renderer: unknown) {
    return meshMapHooks.texture?.(renderer, MESH_MAPS[this.mapIndex].map) ?? null;
  }
  override getType() {
    return "meshmap";
  }
  override getTypeName() {
    return "Mesh Map";
  }
  override getDescription() {
    return "Mesh Map\nGenerates mesh maps for the current custom mesh";
  }
  override getParameterDefs(): ParameterDef[] {
    return [{ name: "map", type: "enum", values: MESH_MAPS.map((m) => ({ name: m.name, value: m.map })), label: "Map", default: 0 }];
  }
  get mapIndex() {
    const i = Math.round(Number(this.getParameter("map") ?? 0));
    return i >= 0 && i < MESH_MAPS.length ? i : 0;
  }
  override getOutputDefs(): PortDef[] {
    return [{ type: MESH_MAPS[this.mapIndex].output_type }];
  }
  override _getShaderCode(uv: string, _o: number, context: GenContext): ShaderCode {
    const g = this.genName;
    const m = MESH_MAPS[this.mapIndex];
    const rv = new ShaderCode();
    rv.outputType = m.output_type;
    const textureName = `${g}_meshmap_${m.map}`;
    let variant = context.getVariant(this, uv);
    if (variant === -1) {
      variant = context.getVariant(this, uv);
      rv.addUniform(textureName, "sampler2D", this.textureRef(`_meshmap_${m.map}`));
      const v3 = (a: number[]) => `vec3(${a.map((x) => x.toFixed(9)).join(", ")})`;
      let code = (m.code ? m.code + "\n" : "") + `${registry.ioTypes[m.output_type].type} ${g}_${variant} = ${m.output};\n`;
      code = code.replaceAll("$NODE", g).replaceAll("$TEXTURE", textureName).replaceAll("$UV", uv).replaceAll("$AABB_POSITION", v3(this.aabb.position)).replaceAll("$AABB_SIZE", v3(this.aabb.size));
      rv.code = code;
    }
    rv.outputValues[rv.outputType] = `${g}_${variant}`;
    return rv;
  }
}

/** Export node: writes its input to an image file when the project is exported */
export class GenExport extends Gen {
  override getType() {
    return "export";
  }
  override getTypeName() {
    return "Export";
  }
  override getDescription() {
    return "Export\nExports its input as an image file when the material is exported";
  }
  override getParameterDefs(): ParameterDef[] {
    return [
      { name: "size", label: "Size", type: "size", first: 4, last: 13, default: 10 },
      { name: "format", label: "Format", default: 0, type: "enum", values: ["PNG", "JPG", "WEBP"].map((n) => ({ name: n, value: n })) },
      { name: "suffix", label: "Filename", type: "string", default: "$project" },
    ];
  }
  override getInputDefs(): PortDef[] {
    return [{ name: "in", type: "rgba" }];
  }
}

export class GenAutoExport extends Gen {
  override getType() {
    return "autoexport";
  }
  override getTypeName() {
    return "Auto Export";
  }
  override getParameterDefs(): ParameterDef[] {
    return [
      { name: "size", label: "Size", type: "size", first: 4, last: 13, default: 4 },
      { name: "filename", label: "Filename", type: "string", default: "test.png" },
    ];
  }
  override getInputDefs(): PortDef[] {
    return [{ name: "in", type: "rgba" }];
  }
}

/** Debug node: shows the shader generated for its input */
export class GenDebug extends Gen {
  override getType() {
    return "debug";
  }
  override getTypeName() {
    return "Debug";
  }
  override getDescription() {
    return "Debug\nShows generated shader of an input";
  }
  override getInputDefs(): PortDef[] {
    return [{ name: "in", type: "rgba" }];
  }
}

/** Webcam: the browser's camera, when the user allows it */
export class GenWebcam extends GenTexture {
  override getType() {
    return "webcam";
  }
  override getTypeName() {
    return "Webcam";
  }
  override getOutputDefs(): PortDef[] {
    return [{ type: "rgb" }];
  }
  override _getShaderCode(uv: string, o: number, context: GenContext): ShaderCode {
    const sc = this._getShaderCodeLod(`vec2(1.0-(${uv}).x, (${uv}).y)`, o, context);
    sc.outputValues.rgb = `(${sc.outputValues.rgba}).rgb`;
    sc.outputType = "rgb";
    return sc;
  }
}
