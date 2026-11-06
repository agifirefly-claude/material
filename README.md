# Material Pro

[Material Maker](https://github.com/RodZill4/material-maker) 的 Web 版重构：在浏览器里用节点图生成程序化贴图和 PBR 材质。节点库、示例、着色器代码生成规则和引擎导出模板都来自 Material Maker，用 TypeScript + WebGL2 重新实现，不需要安装，也不依赖 Godot。

每个材质都是一张完整的节点图，可以逐个节点查看参数、端口连接、上游依赖，以及这个节点每个输出最终生成的 GLSL。

## 能做什么

| 方面 | 内容 |
| --- | --- |
| 节点库 | Material Maker 的全部 399 个节点定义和 328 个库条目（形状、图案、噪声、滤镜、变换、SDF、3D 纹理、工作流……），可按名称、类型、别名搜索 |
| 节点图 | 拖拽添加、按端口类型校验连线、子图（双击进入、面包屑和层级面板导航、选中节点打组为子图）、参数面板（Remote）、开关、转接点、传送门、注释；复制、粘贴、复制节点、撤销、重做 |
| 参数 | 浮点（拖动调节，或输入表达式如 `$rnd(0,1)`）、尺寸、枚举、布尔、颜色、渐变、曲线、多边形和折线、样条、像素图、网格变形；泛型端口数量；随机种子 |
| 分析 | 每个节点：端口表（每个输入来自哪里、每个输出去往哪里）、上游依赖树（可跨子图跳转）、着色器模型（参数在代码里的实际取值、各输出表达式、code、instance、global）、所选输出最终生成的 GLSL（片段或完整着色器）及其 uniform 的实时值；整个图：节点类型统计 |
| 预览 | 节点内缩略图（与 Material Maker 一样按需显示，也可全部显示）、2D 大图（可平铺查看接缝、可存 PNG）、3D PBR 预览（球、立方体、圆柱、平面、圆环、环结，或载入 OBJ/GLB 模型；两种环境光照；可开置换）；用到时间的节点会持续动画 |
| 文件 | 打开和保存 Material Maker 的 `.ptex` 工程（格式相同，双向通用）；43 个官方示例；自动保存到浏览器 |
| 导出 | 材质贴图打包（albedo、ORM、normal OpenGL/DirectX、height、AO、metallic、roughness、emission、SSS）；以及 Material Maker 的引擎导出目标：Blender、glTF、Godot 3/4、Unity 3D/HDRP/URP、Unreal 4/5，包括动态材质生成的引擎着色器代码 |

## 启动

需要 Node 22 以上。

```bash
npm install
```

```bash
npm run dev
```

然后打开 http://127.0.0.1:5173 。

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 生成数据、类型检查、生产构建到 `dist/` |
| `npm run data` | 从 `third_party/material-maker` 重新生成 `public/data`（节点、示例、模板） |
| `npm run typecheck` | 类型检查 |
| `npm test` | 单元测试 |
| `node tests/run-harness.mjs nodes` | 在无头 Chromium 里编译全部节点 |
| `node tests/run-harness.mjs examples` | 渲染全部示例里每个节点的每个输出 |
| `node tests/run-harness.mjs exports` | 跑一遍所有材质类型的所有导出目标 |
| `node tests/run-harness.mjs shot bricks 0 512 out.png` | 把示例材质的某个输出渲染成 PNG |

浏览器需要支持 WebGL2 和浮点渲染目标（`EXT_color_buffer_float`），主流桌面浏览器都支持。

## 兼容性

用上面的测试台验证：

- **节点**：399 个里 392 个单独编译通过。剩下 7 个在 Material Maker 里也一样：有的只能在 3D 绘制模式下用，有的必须连接输入，有的引用了上游已改名的函数，有的在输入未连接时的默认值本身就不合法。
- **示例**：43 个里 42 个所有节点、所有输出都能渲染。`doc_tools` 里有一个自定义节点在函数里用了未声明的变量，上游也编译不过。
- **导出**：7 种材质类型的 39 个导出目标都能生成文件，模板指令全部处理完毕。

Material Maker 的节点代码按桌面 GLSL 4.50 写（在 Godot 里作为 Vulkan 计算着色器运行），WebGL2 只支持 GLSL ES 3.00。差异由 `src/engine/render/glsl-fix.ts` 处理：

- 把 `{...}` 数组初始化改写成数组构造
- 给 GLSL ES 的保留字（`input`、`output`、`filter`……）改名
- 编译失败时按报错定位：根据函数声明，把应为浮点的整数实参改成浮点，然后重新编译

## 结构

| 目录 | 内容 | 对应 Material Maker |
| --- | --- | --- |
| `third_party/material-maker/` | 原样保留的节点定义、示例、库、模板、着色器函数和许可证 | `addons/material_maker/nodes`、`material_maker/examples`、`material_maker/library` |
| `src/engine/gen/` | 节点类型：着色器节点、图、输入输出、参数面板、开关、Buffer、迭代 Buffer、图片、文字、材质、网格贴图…… | `engine/nodes/gen_*.gd` |
| `src/engine/params/` | 参数类型：渐变、曲线、多边形、样条、像素、网格变形 | `types/*.gd` |
| `src/engine/loader.ts` | 由文件数据创建节点 | `engine/loader.gd` |
| `src/engine/export.ts` | 引擎导出：模板、条件、代码生成、HLSL/Unity/Unreal 转换 | `gen_material.gd` 的导出部分 |
| `src/engine/render/` | WebGL2 渲染器：着色器拼装、Buffer 依赖链、迭代、缓存、GLSL 兼容 | `engine/pipeline`、`multi_renderer.gd`、`mm_deps` |
| `src/ui/` | React 界面：节点图（React Flow）、库、检查器、预览、文件 | `material_maker/` 下的界面 |

生成着色器的核心（`$变量` 替换、输入函数、泛型端口 `#`、instance 函数的 variation 参数、`$rnd`、变体去重、globals 按引用裁剪……）是逐函数对照 `gen_shader.gd` 和 `gen_base.gd` 移植的，所以同一张图生成的代码和 Material Maker 基本一致，`.ptex` 文件也能互通。

## 还没有移植的部分

- 3D 绘制模式（笔刷、图层、在模型上绘制）
- 网格贴图烘焙（曲率、AO、厚度等）。`Mesh Map` 节点目前输出中性值。
- 3D 纹理材质、光线步进材质、天空材质的 3D 预览。这三种材质可以正常编辑和导出。
- 从 Material Maker 网站下载共享节点、全局参数、导出目标里的自定义 GDScript、摄像头节点

## 许可证

MIT。节点库、示例和模板来自 Material Maker（MIT，© 2018-present Rodolphe Suescun and contributors），许可证见 `third_party/material-maker/LICENSE.md`。HDR 环境贴图来自 Poly Haven（CC0）。
