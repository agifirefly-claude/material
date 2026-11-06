# m3e 材质包规范（m3e-material，版本 1）

本规范定义 Material Pro 导出、m3e-canvas-pro 导入的材质文件，以及材质在 m3e-canvas-pro 文档里的存放和绘制方式。

规范的参考实现是 [`src/formats/m3e-material.ts`](../src/formats/m3e-material.ts)。它不依赖任何库，m3e-canvas-pro 可以原样复制为 `lib/material.ts`。参考实现包括：

- 类型定义
- 读取与清洗：`openMaterialFile`、`cleanMaterial`、`cleanMaterialLayer`
- 绘制：`materialLayerCss`

本文与参考实现不一致时，以参考实现为准。行为由 `tests/unit/m3e-material.test.ts` 约束。

## 1. 设计要点

材质在 m3e-canvas-pro 里的用途是给 UI 部件做表面（卡片、按钮、面板的底），不是 3D 渲染。所以材质包携带的主要是两张可直接平铺的图：

| 图 | 内容 | 用法 |
| --- | --- | --- |
| `surface` | 成品表面：上色、打光、带浮雕 | 原样平铺，即“原样”模式 |
| `shading` | 表面的明暗细节，不带颜色：灰度图，平均亮度处为中灰（128），比平均亮的地方更亮，暗的地方更暗（浮雕、遮蔽、图案） | 用 `overlay` 混合叠在任意颜色上，即“染色”模式。同一种材质可以随主题色、深浅模式变化 |

PBR 原始贴图（albedo、normal、height、orm、emission）可选，留给以后做动态光照或 3D 用途。

规范和 m3e-canvas-pro 现有结构保持一致：

- **图层**：材质是外观填充层（`ItemLook.fills`）的一种新类型 `material`，和 `solid`、`linear`、`radial`、`conic` 并列，同样参与叠放、清洗和生成 CSS。
- **材质库**：材质放在文档的材质库 `Doc.materials` 里，图层只按 id 引用，结构与 `Doc.components` 的做法一致。所以导入材质是往库里添加，不会替换工程。
- **图片存储**：图片是 `data:image/...;base64` 字符串。`lib/assets.ts` 的 `stripAssets` 会遍历文档里的所有字符串，把大图挪进 IndexedDB，所以材质图不需要新的存储机制。
- **安全**：沿用 `lib/look.ts` 的原则，文件不能把自己的 CSS 带进页面。图片只接受 png、webp、jpeg 三种格式的 base64 data URL，所有数值都会被限定在范围内，不认识的字段一律丢弃。

## 2. 文件格式

扩展名为 `.m3e-material.json`，内容是 UTF-8 编码的 JSON。一个文件可以包含一个或多个材质，多个材质就构成一个材质库。

```jsonc
{
  "format": "m3e-material",      // 固定
  "version": 1,                   // 读取方遇到更高的版本应拒绝
  "generator": { "name": "Material Pro", "version": "0.1.0" },
  "materials": [ MaterialDef, ... ]   // 最多 200 个
}
```

### MaterialDef

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 小写字母、数字和短横线，最长 64 个字符。不合法时由 `name` 生成；与已有 id 重复时追加 `-2`、`-3`…… |
| `name` | string | 是 | 显示名，最长 80 个字符 |
| `description` | string | 否 | 最长 500 个字符 |
| `tile` | number | 是 | 缩放为 100% 时，一个平铺单元的显示尺寸（px），范围 8–2048 |
| `resolution` | number | 是 | 图片的像素尺寸，范围 8–8192 |
| `light` | `{ azimuth, elevation }` | 是 | 烘焙 `surface` 和 `shading` 时用的光。`azimuth` 为方位角，从屏幕上方开始顺时针计（0–360），315 表示左上方来光；`elevation` 为光源高度（1–90） |
| `maps.surface` | image | 是 | 成品表面 |
| `maps.shading` | image | 是 | 明暗细节（灰度） |
| `maps.albedo` | image | 否 | 基础色（sRGB），alpha 为不透明度，不含光照 |
| `maps.normal` | image | 否 | 切线空间法线，OpenGL 约定（绿色朝上） |
| `maps.height` | image | 否 | 高度，白色为高 |
| `maps.orm` | image | 否 | R=遮蔽，G=粗糙度，B=金属度 |
| `maps.emission` | image | 否 | 自发光（sRGB） |
| `swatch.average` | `#rrggbb` | 是 | 平均色 |
| `swatch.palette` | `#rrggbb[]` | 是 | 主色，最多 6 个，按占比从高到低 |
| `swatch.lightness` | number | 是 | 平均明度（0–100），文字压在材质上时可据此选择深色或浅色 |
| `fallbackLook` | ItemLook | 否 | 只用颜色近似这个材质的外观（渐变、描边、阴影、噪点），能通过 m3e-canvas-pro 现有的 `cleanLook` |
| `source` | `{ app, version?, project?, projectFormat? }` | 否 | 来源。`project` 是 Material Pro 的工程（`.ptex` 文本），可以用来回到 Material Pro 继续编辑 |
| `tags` | string[] | 否 | 最多 20 个 |

所有图片的约束相同：
- **格式**：`data:image/(png|webp|jpeg);base64,...`，单张最长 1200 万个字符（约 9 MB）。
- **尺寸**：每张都是 `resolution × resolution`。
- **平铺**：四边无缝，可以直接平铺。

有两种情况整个材质会被丢弃：
- 缺少 `surface` 或 `shading`，或者这两张图不合法。
- 可选贴图不合法时只丢弃那一张，材质本身保留。

## 3. 在 m3e-canvas-pro 文档里

### 3.1 材质库

```ts
// lib/tokens.ts
export type Doc = {
  // ...
  /** 文档里的材质；ItemLook.fills 里的 material 图层按 id 引用 */
  materials?: MaterialDef[];
};
```

### 3.2 材质图层

```ts
// lib/tokens.ts：PaintLayer 增加一种
export type PaintLayer = /* 现有的 solid | linear | radial | conic */ | MaterialLayer;

type MaterialLayer = {
  type: "material";
  material: string;            // Doc.materials 里的 id
  mode?: "surface" | "tint";   // 默认 "surface"
  tint?: ColorRef;             // tint 模式的颜色：主题角色（如 "primary"、"primary/40"）或 hex
  scale?: number;              // 平铺缩放，百分比，5–400，默认 100
  x?: number; y?: number;      // 平铺偏移，占一个单元的百分比，-100–100
  opacity?: number;            // 0–100，默认 100
  blend?: "normal" | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light" | "darken" | "lighten" | "color-burn" | "color-dodge" | "luminosity";
  hidden?: boolean;
};
```

例子：主题主色的按钮，带拉丝金属的质感：

```json
{ "look": { "fills": [{ "type": "material", "material": "brushed-metal", "mode": "tint", "tint": "primary", "scale": 60 }] } }
```

### 3.3 绘制

`materialLayerCss(layer, doc.materials, colorCss)` 返回背景层，从上到下排列。每层的格式和 `lib/look.ts` 里 `textureLayers` 的返回值相同：`{ image, size, position, repeat, blend }`。

- **原样模式**：一层，`url(surface)`，按 `tile × scale` 平铺，偏移为 `x、y × 单元尺寸`。
- **染色模式**：两层：
  - 上层：`url(shading)`，混合方式 `overlay`
  - 下层：`tint` 颜色的纯色层（`linear-gradient(c, c)`）。没有 tint 时，用材质的 `swatch.average`。
- **不透明度**：CSS 背景层本身不能单独设置透明度，所以 `opacity` 单独返回给调用方。推荐的做法是：把材质层画在部件内容下方单独的一层元素上，再给这层元素设置透明度。
- **找不到材质**：返回空数组，即不画。

## 4. m3e-canvas-pro 的改动清单

下面按文件列出接入需要的改动，文件名都是 m3e-canvas-pro 里现有的文件。

| 文件 | 改动 |
| --- | --- |
| `lib/material.ts`（新增） | 复制本项目的 `src/formats/m3e-material.ts` |
| `lib/tokens.ts` | `PaintLayer` 增加 `MaterialLayer`；`Doc` 增加 `materials?: MaterialDef[]` |
| `lib/look.ts` | `PAINT_TYPES` 增加 `"material"`；`cleanPaint` 遇到 `type: "material"` 时交给 `cleanMaterialLayer(v, isColorRef)`；`lookStyle` 生成背景时，把 `materialLayerCss` 返回的层和渐变层按顺序合在一起（渐变层的 `size` 为 `auto`、`repeat` 为 `no-repeat`）。`lookStyle` 因此需要拿到文档的材质库，可以加一个参数，或者通过上下文传入 |
| `lib/project.ts` | `cleanBehavior`：对 `materials` 逐个执行 `cleanMaterial`，去掉 id 重复的；`isProject` 不需要改（`materials` 是可选字段）；`PROJECT_VERSION` 不变，因为新字段是可选的，旧版本读到时会忽略 |
| `lib/assets.ts` | 不需要改。`stripAssets` 和 `restoreAssets` 会遍历所有字符串，材质图会自动进 IndexedDB |
| `src/Editor.tsx` | ① 增加材质库状态，和 `components` 一样参与保存、撤销、`restoreAssets`（现在第 870 行附近对 `groups`、`frames`、`components` 调了 `restoreAssets`，加上 `materials`）；② 增加“导入材质…”入口：`accept=".json"`，执行 `openMaterialFile`，再用 `uniqueId` 合并进材质库，不替换工程 |
| `components/LookPanel.tsx` | 填充层的类型选择增加“材质”：材质选择器（缩略图用 `maps.surface`）、模式（原样/染色）、染色颜色（复用现有的颜色选择，支持主题角色）、缩放、偏移、不透明度、混合方式。“复制外观、粘贴外观”继续可用：图层里只有 id |
| `lib/look.ts` 的 `strictLook` | 严格遵守风格时，建议只允许染色模式，并且 tint 只能是主题角色，这样材质仍服从风格的配色 |
| 材质库面板（新增，可选） | 列出 `doc.materials`：缩略图、名称、删除；删除时提示仍有图层在引用它 |
| `lib/codegen.ts`、`lib/exportProject.ts` | 导出 React 工程时，把用到的材质图写成文件（`src/assets/materials/<id>/surface.webp` 等），CSS 引用文件而不是内联 data URL；未被引用的材质不导出 |
| `lib/prompt.ts`、`lib/ai.ts` | 给模型的描述：材质图层写成“材质 <name>（主色 …）”；`lookForModel` 说明模型只能引用文档里已有的材质 id，不能生成图片 |
| 缩略图、画廊 | 用 `swatch.average` 或 `surface` |
| 不支持图片的场合 | 用 `fallbackLook`，或者用 `swatch` 生成渐变 |

## 5. 兼容与版本

- **读取方**：只接受 `format === "m3e-material"` 并且 `version <= 1` 的文件。字段的格式变化会提升 `version`；读取方按 m3e-canvas-pro 工程文件的做法，按版本依次执行迁移。
- **新增可选字段不提升版本**：读取方会忽略不认识的字段。
- **旧版 m3e-canvas-pro 打开带材质的工程**：材质图层不在它的 `PAINT_TYPES` 里，`cleanPaint` 会把这一层丢掉，部件退回其余的填充层，不会出错。

## 6. Material Pro 这一侧

Material Pro 的“文件 → 导出… → m3e-canvas-pro”生成这种文件。可选项包括：
- 平铺尺寸、分辨率、光照方向和高度
- 是否附带 PBR 原始贴图
- 是否附带工程
- WebP 或 PNG

生成过程（`src/export/m3eMaterial.ts`）：

1. 渲染材质的 albedo、ORM、法线、自发光、深度。法线按 Godot 的方式读取：取 XY，重建 Z。未连接的输入不导出。
2. 用给定的光烘焙 `surface`：漫反射加环境光加按粗糙度变化的高光，金属度影响反射颜色，再加上自发光，输出 sRGB。
3. 由 `surface` 的亮度除以平均亮度得到 `shading`。
4. 对 `surface` 做 k-means 聚类，得到 `swatch`。
5. 根据 `swatch` 和浮雕强度生成 `fallbackLook`。
