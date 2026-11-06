/* Strings that reach t() through a variable (menu entries, modes, labels kept in data), listed here so
 * scripts/check-i18n.mjs can check they are translated. Keep in step with the data they come from. */
export const DYNAMIC_KEYS: string[] = [
  // docked panel titles (dock/Dock.tsx PANEL_TITLES)
  "Library", "Hierarchy", "3D material", "2D node output", "Reference", "Inspector",
  // 3D preview: rotation speeds, tonemap modes, objects and their settings (preview3d/Menus.tsx, postprocess.ts, objects.ts)
  "Pause", "Slow", "Medium", "Fast",
  "Linear", "Reinhard", "Filmic", "ACES", "AgX",
  // post process fields (preview3d/Menus.tsx PostProcessMenu)
  "Exposure", "White", "White point", "Contrast", "Intensity", "Strength", "Threshold", "Brightness", "Saturation",
  "Far distance", "Far transition", "Near distance", "Near transition", "Blur amount",
  "Cube", "Chamfer", "Cylinder", "Sphere", "Plane", "Curvature", "Prism", "Torus", "Suzanne", "Pillow", "Vase", "Custom model",
  // 2D preview view options (preview2d/view.ts, Preview2D.tsx)
  "Extend", "Repeat", "Clamp", "None", "Corners", "Lines", "Grid", "Light", "Mid-tones", "Dark", "Small", "Large",
  // tones node channels (Tones.tsx)
  "Luminance", "Red", "Green", "Blue", "Alpha",
  // paint tools and layer types (paint/paintStore.ts, paint/PaintPanels.tsx)
  "Free dots", "Free line", "Line", "Stamp", "Colour picker", "ID mask", "Paint layer", "Procedural layer", "Mask",
  // default library names (library/manager.ts)
  "Base library", "User library",
  // paint mode: 2D view channels, side panel tabs, built-in models, pen pressure targets (paint/*.tsx, paint/meshes.ts)
  "Albedo", "Metallic", "Roughness", "Emission", "Normal map", "Depth", "Occlusion",
  "Layers", "Tools & brush", "Settings", "Brush node",
  "sphere", "cube", "cylinder", "torus", "knot", "plane",
  "size", "opacity", "hardness",
  // brush modes and the brush library's names (engine/paint/painter.ts brushMode, public/data/brushes.json)
  "stamp", "pattern", "uv_pattern",
  "Uniform", "Text", "Screws", "Arrows", "Greyscale", "Blur", "Dribble", "Zipper", "Gradient", "Wood", "Metal", "Marble",
  "Dirt", "Snow", "Scratches", "Rust", "Camouflage", "Concrete", "Flatten", "Knit", "Mosaic", "Leaves", "Stamp", "Leather",
  // the Brush node's channel switches (shown as parameters of the brush graph)
  "Paint Albedo", "Paint Metallic", "Paint Roughness", "Paint Emission", "Paint Occlusion", "Paint Depth", "Reset Normal",
  // animation export layouts (preview2d/Dialogs.tsx)
  "Image sequence (zip)", "Spritesheet, 1 row", "Spritesheet, 2 rows", "Spritesheet, 4 rows", "Spritesheet, 8 rows",
  "Spritesheet, 2 columns", "Spritesheet, 4 columns", "Spritesheet, 8 columns",
];
