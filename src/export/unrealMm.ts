/* The Python helper module that the Unreal Engine 5 export script imports ("import mm").
 *
 * Based on material_maker/misc/export/mm.py from Material Maker (MIT License,
 * Copyright (c) 2018-present Rodolphe Suescun and contributors). Changes: the dump() debugging helper
 * is left out, and relative file names are read from the folder of this module, which is the
 * folder of the exported files (Material Maker writes absolute paths instead). */
import type { ExportFile } from "../engine/export";

export const UNREAL_MM_PY = `# Helper module for the Unreal Engine 5 material script exported by Material Pro.
# Based on material_maker/misc/export/mm.py from Material Maker (MIT License).
import os
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))

def _path(p):
    return p if os.path.isabs(p) else os.path.join(HERE, p)

class Material:
    def __init__(self, name, create = False):
        self.AR = unreal.AssetRegistryHelpers.get_asset_registry()
        self.AT = unreal.AssetToolsHelpers.get_asset_tools()
        self.MEL = unreal.MaterialEditingLibrary
        if not create:
            for x in self.AR.get_all_assets():
                if x.asset_name == name and x.package_path == "/Game" and x.asset_class_path.asset_name == "Material":
                    self.material = unreal.AssetRegistryHelpers.get_asset(x)
                    return
        self.material = self.AT.create_asset(name, "/Game", unreal.Material, unreal.MaterialFactoryNew())
        self.save()

    def save(self):
        unreal.EditorAssetLibrary.save_asset(self.material.get_path_name())

    def clear(self):
        self.MEL.delete_all_material_expressions(self.material)

    def set_editor_property(self, n, v):
        self.material.set_editor_property(n, v)

    def add_node(self, type, x=0, y=0):
        return self.MEL.create_material_expression(self.material, getattr(unreal, "MaterialExpression"+type), x, y)

    def connect_property(self, source, source_output, property):
        return self.MEL.connect_material_property(source, source_output, property)

    def connect_nodes(self, source, source_output, dest, dest_input):
        return self.MEL.connect_material_expressions(source, source_output, dest, dest_input)

def get_object_from_path(p):
    AR = unreal.AssetRegistryHelpers.get_asset_registry()
    return AR.get_asset_by_object_path(p).get_asset()

def custom_input(n):
    ci = unreal.CustomInput()
    ci.set_editor_property('input_name', n)
    return ci

def custom_output(n, t):
    co = unreal.CustomOutput()
    co.set_editor_property('output_name', n)
    type = unreal.CustomMaterialOutputType.CMOT_FLOAT1
    if t == 2:
        type = unreal.CustomMaterialOutputType.CMOT_FLOAT2
    elif t == 3:
        type = unreal.CustomMaterialOutputType.CMOT_FLOAT3
    elif t == 4:
        type = unreal.CustomMaterialOutputType.CMOT_FLOAT4
    co.set_editor_property('output_type', type)
    return co

def import_texture(src, dest):
    import_task = unreal.AssetImportTask()
    import_task.set_editor_property('filename', _path(src))
    import_task.set_editor_property('destination_path', dest)
    import_task.set_editor_property('save', True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([import_task])
    return import_task.get_objects()[0]

def read_text_file(path):
    with open(_path(path), 'r') as f:
        return f.read()
    return ''

def read_texture_file(path):
    return None
`;

const IMPORT_MM = /^\s*import mm\s*$/m;
/** the line the export template writes to find mm.py in Material Maker's install folder */
const MM_PATH_LINE = /^sys\.path\.append\('[^'\n]*export'\)$/m;

/** whether one of the exported scripts imports mm.py */
export const needsUnrealMm = (plan: ExportFile[]) => plan.some((f) => f.kind === "text" && IMPORT_MM.test(f.text));

/** a script that imports mm.py, made to find it in the script's own folder (where the zip puts it) */
export function localizeUnrealScript(text: string): string {
  if (!IMPORT_MM.test(text)) return text;
  return text.replace(MM_PATH_LINE, "import os\nsys.path.append(os.path.dirname(os.path.abspath(__file__)))");
}
