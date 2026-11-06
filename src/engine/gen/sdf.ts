/* Port of MMGenSDF (addons/material_maker/engine/nodes/gen_sdf.gd): the "Easy SDF" node, whose shader model is
 * generated from a scene of SDF items (see ../sdf/builder.ts). */
import { deserializeValue } from "../params/types";
import { deserializeScene, ensureIndexes, getColorCode, sceneToShaderModel, sdfItemType, serializeScene, type SdfScene } from "../sdf/builder";
import type { Dict, ParameterDef } from "./base";
import { GenShader } from "./shader";

export class GenSDF extends GenShader {
  /** editor mode: item parameters become node parameters and the distance function takes an item index (MM's builder preview) */
  editor = false;
  expressions = false;
  nodeParameters: Dict[] = [];
  scene: SdfScene[] = [];

  override getType() {
    return "sdf";
  }
  override getTypeName() {
    return "Easy SDF";
  }

  /** "SDF2D" or "SDF3D", from the first item; "" when the scene is empty */
  getSceneType(): string {
    if (!this.scene.length) return "";
    return sdfItemType(this.scene[0].type)?.category ?? "";
  }

  setSdfScene(s: SdfScene[]): void {
    this.scene = s;
    ensureIndexes(this.scene);
    const sceneType = this.getSceneType();
    const sm: Dict = { includes: [], parameters: [] };
    let uv = "$uv";
    let distanceFunction: string;
    let colorFunction: string;
    let defaultAlbedo = "vec4(0.0, 0.0, 0.0, 1.0)";
    if (sceneType === "SDF3D") {
      distanceFunction = "float $(name)_d(vec3 uv";
      colorFunction = "float $(name)_c(vec3 uv";
      defaultAlbedo = "vec4(1.0, 1.0, 1.0, 1.0)";
    } else {
      uv = "$uv-vec2(0.5)";
      distanceFunction = "float $(name)_d(vec2 uv";
      colorFunction = "float $(name)_c(vec2 uv";
    }
    if (this.editor) distanceFunction += ", int index";
    distanceFunction += ") {\n";
    colorFunction += ", out vec4 albedo, out float metallic, out float roughness, out vec3 emission) {\n";
    if (this.editor) colorFunction += "int index = 0;\n";
    colorFunction += `albedo = ${defaultAlbedo};\n`;
    colorFunction += "metallic = 0.0;\nroughness = 1.0;\nemission = vec3(0.0);\n";
    let first = true;
    const parameterDefs: ParameterDef[] = structuredClone(this.nodeParameters) as ParameterDef[];
    for (const p of parameterDefs) p.label = (p.shortdesc as string) ?? "";
    for (const i of this.scene) {
      if (i.hidden) continue;
      const ism = sceneToShaderModel(i, "uv", this.editor);
      if (ism.includes) sm.includes.push(...ism.includes);
      if (ism.parameters) parameterDefs.push(...ism.parameters);
      if (ism.code !== undefined) {
        const code = String(ism.code).replaceAll("$(name_uv)", "");
        distanceFunction += code;
        colorFunction += code;
      }
      if (ism.outputs?.length) {
        const field = sceneType === "SDF2D" ? "sdf2d" : "sdf3d";
        if (ism.outputs[0][field] !== undefined) {
          const outName = String(ism.outputs[0][field]).replaceAll("$(name_uv)", "");
          if (first) {
            distanceFunction += `float return_value = ${outName};\n`;
            colorFunction += `float return_value = ${outName};\n`;
            first = false;
          } else {
            distanceFunction += `return_value = min(return_value, ${outName});\n`;
            colorFunction += `return_value = min(return_value, ${outName});\n`;
          }
        }
      }
    }
    const fakeScene: SdfScene = { index: 0, type: sceneType === "SDF2D" ? "Union" : "Union3D", children: this.scene, parameters: {} };
    const channels = [
      { name: "Albedo", channel: "albedo", type: "rgba", glsl_type: "vec4" },
      { name: "Metallic", channel: "metallic", type: "float", glsl_type: "float" },
      { name: "Roughness", channel: "roughness", type: "float", glsl_type: "float" },
      { name: "Emission", channel: "emission", type: "color", glsl_type: "vec3" },
    ];
    for (const c of channels) {
      const cc = getColorCode(fakeScene, { uv: "uv", channel: c.channel, target: c.channel, type: c.type, glsl_type: c.glsl_type }, this.editor);
      if (cc.color !== undefined) colorFunction += `\n// ${c.name}\n{\n${cc.color}}\n`;
    }
    colorFunction += "\n";
    if (first) {
      distanceFunction += "return 1.0;";
      colorFunction += "return 1.0;";
    } else if (this.editor) {
      distanceFunction += "return index == 0 ? return_value : 1.0;";
      colorFunction += "return index == 0 ? return_value : 1.0;";
    } else {
      distanceFunction += "return return_value;";
      colorFunction += "return return_value;";
    }
    distanceFunction += "}\n";
    colorFunction += "}\n";
    colorFunction = colorFunction.replaceAll("$(name_uv)", "");
    sm.instance = distanceFunction + colorFunction;
    sm.code = "vec4 $(name_uv)_albedo;\nfloat $(name_uv)_metallic;\nfloat $(name_uv)_roughness;\nvec3 $(name_uv)_emission;\n";
    if (sceneType === "SDF3D") {
      sm.code += `$(name)_c(${uv}.xyz*vec3(1.0, -1.0, -1.0), $(name_uv)_albedo, $(name_uv)_metallic, $(name_uv)_roughness, $(name_uv)_emission);\n`;
      sm.outputs = [{ sdf3d: this.editor ? `@NOCODE $(name)_d(${uv}, 0)` : `@NOCODE $(name)_d(${uv}*vec3(1.0, -1.0, -1.0))`, type: "sdf3d" }];
      sm.parameters = parameterDefs;
      sm.outputs.push({ tex3d: "$(name_uv)_albedo.rgb", type: "tex3d", shortdesc: "Albedo" });
      sm.outputs.push({ tex3d_gs: "clamp($(name_uv)_metallic, 0.0, 1.0)", type: "tex3d_gs", shortdesc: "Metallic" });
      sm.outputs.push({ tex3d_gs: "clamp($(name_uv)_roughness, 0.0, 1.0)", type: "tex3d_gs", shortdesc: "Roughness" });
      sm.outputs.push({ tex3d: "$(name_uv)_emission", type: "tex3d", shortdesc: "Emission" });
    } else {
      sm.parameters = parameterDefs;
      sm.code += `$(name)_c(${uv}, $(name_uv)_albedo, $(name_uv)_metallic, $(name_uv)_roughness, $(name_uv)_emission);\n`;
      if (this.editor) {
        parameterDefs.push({ default: -1, name: "index", type: "float" });
        sm.outputs = [{ sdf2d: `@NOCODE $(name)_d(${uv}, 0)`, type: "sdf2d" }];
      } else sm.outputs = [{ sdf2d: `@NOCODE $(name)_d(${uv})`, type: "sdf2d", shortdesc: "SDF" }];
      sm.outputs.push({ rgba: "$(name_uv)_albedo", type: "rgba", shortdesc: "Albedo" });
      sm.outputs.push({ f: "$(name_uv)_metallic", type: "f", shortdesc: "Metallic" });
      sm.outputs.push({ f: "$(name_uv)_roughness", type: "f", shortdesc: "Roughness" });
      sm.outputs.push({ rgb: "$(name_uv)_emission", type: "rgb", shortdesc: "Emission" });
    }
    for (const p of parameterDefs) {
      if (!(p.name in this.parameters)) this.parameters[p.name] = p.type === "float" ? Number(p.default) : deserializeValue(p.default);
    }
    if (this.editor && this.expressions) {
      for (const p of parameterDefs) {
        if (p.parmexpr !== undefined) {
          sm.code = sm.code.replaceAll("$" + p.name, p.parmexpr);
          sm.instance = sm.instance.replaceAll("$" + p.name, p.parmexpr);
        }
      }
    }
    this.setShaderModel(sm);
  }

  /** gen_sdf.gd replaces _serialize entirely: the shader model is not saved, the scene is */
  override _serialize(data: Dict): Dict {
    data.node_parameters = structuredClone(this.nodeParameters);
    data.sdf_scene = serializeScene(this.scene);
    return data;
  }

  override _deserialize(data: Dict): void {
    if (data.node_parameters) this.nodeParameters = structuredClone(data.node_parameters);
    if (data.sdf_scene) this.setSdfScene(deserializeScene(data.sdf_scene));
    else this.setSdfScene([]);
    if (data.generic_size !== undefined) this.setGenericSize(data.generic_size);
  }
}
