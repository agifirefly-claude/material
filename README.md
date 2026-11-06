# Material Pro

在浏览器里用节点图生成程序化贴图和 PBR 材质的独立应用。它最初由 [Material Maker](https://github.com/RodZill4/material-maker) 重构而来：节点库、示例、着色器代码生成规则和引擎导出模板都源自 Material Maker，用 TypeScript + WebGL2 重新实现，不需要安装，也不依赖 Godot。

现在节点库等数据是本项目自己维护的源码（`library/`），不再与 Material Maker 同步；Material Maker 的后续更新只作为参考。来源与许可证见 [NOTICE.md](NOTICE.md)，维护方法见 [docs/节点库维护.md](docs/节点库维护.md)，使用说明见 [docs/用户手册.md](docs/用户手册.md)。

每个材质都是一张完整的节点图，可以逐个节点查看参数、端口连接、上游依赖，以及这个节点每个输出最终生成的 GLSL。

## 能做什么

| 方面 | 内容 |
| --- | --- |
| 节点库 | Material Maker 的全部 399 个节点定义和 328 个库条目（形状、图案、噪声、滤镜、变换、SDF、3D 纹理、工作流……），可按名称、类型、别名搜索 |
| 节点图 | 拖拽添加、按端口类型校验连线、子图（双击进入、面包屑和层级面板导航、选中节点打组为子图）、参数面板（Remote）、开关、转接点、传送门、注释；复制、粘贴、复制节点、撤销、重做 |
| 参数 | 浮点（拖动调节，或输入表达式如 `$rnd(0,1)`）、尺寸、枚举、布尔、颜色、渐变、曲线、多边形和折线、样条、像素图、网格变形；泛型端口数量；随机种子 |
| Easy SDF | Material Maker 的 SDF 场景构建器：71 种 2D/3D 形状、布尔、平滑布尔、变形、生成器、颜色和纹理元素，在检查器里以场景树编辑 |
| 分析 | 每个节点：端口表（每个输入来自哪里、每个输出去往哪里）、上游依赖树（可跨子图跳转）、着色器模型（参数在代码里的实际取值、各输出表达式、code、instance、global）、所选输出最终生成的 GLSL（片段或完整着色器）及其 uniform 的实时值；整个图：节点类型统计 |
| 预览 | 节点内缩略图（与 Material Maker 一样按需显示，也可全部显示）、2D 大图（可平铺查看接缝、可存 PNG）、3D PBR 预览（球、立方体、圆柱、平面、圆环、环结，或载入 OBJ/GLB 模型；两种环境光照；可开置换）。3D 纹理材质、光线步进材质、天空材质由渲染器直接光线追踪显示。用到时间的节点会持续动画 |
| 文件 | 打开和保存 Material Maker 的 `.ptex` 工程（格式相同，双向通用）；43 个官方示例；自动保存到浏览器 |
| 导出 | 按框架分组（文件 → 导出…）：Blender、Unity（内置管线/URP/HDRP）、Godot 3/4、Unreal 4/5（Material Maker 的导出目标，含动态材质生成的引擎着色器代码）；Cocos Creator 3.x（`.mtl` 材质加贴图和 `.meta`）；glTF（`.glb`，通过 Khronos 官方校验，Cocos、Blender、Godot、Unity、Unreal、three.js、Babylon.js 都能导入）；m3e-canvas-pro（m3e 材质包，规范见 [docs/m3e-material.md](docs/m3e-material.md)）；贴图包（albedo、ORM、normal OpenGL/DirectX、height、AO、metallic、roughness、emission、SSS） |

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
| `npm run data` | 从 `library/` 重新生成 `public/data`（节点、示例、菜单、模板、翻译），并把 `docs/用户手册.md` 复制为应用内“帮助 → 用户手册”显示的 `public/docs/manual.md` |
| `npm run check:i18n` | 列出没有中文翻译的界面字符串和节点库字符串（节点名、参数、端口、说明、菜单），应为 0 |
| `npm run compare:reference -- <material-maker 目录>` | 只读地列出 `library/` 与某个 Material Maker 版本的差异，供人工参考 |
| `npm run typecheck` | 类型检查 |
| `npm test` | 单元测试 |
| `node tests/run-harness.mjs nodes` | 在无头 Chromium 里编译全部节点 |
| `node tests/run-harness.mjs examples` | 渲染全部示例里每个节点的每个输出 |
| `node tests/run-harness.mjs exports` | 跑一遍所有材质类型的所有导出目标 |
| `node tests/run-harness.mjs sdf` | 编译每种 Easy SDF 元素和若干组合场景 |
| `node tests/run-harness.mjs bake <目录>` | 给一个球体烘焙全部网格贴图，存成 PNG |
| `node tests/run-harness.mjs paint <目录>` | 在球体上用库里的笔刷画几笔、撤销、加遮罩和程序图层、保存再读回，存成 PNG |
| `node tests/run-harness.mjs shot bricks 0 512 out.png` | 把示例材质的某个输出渲染成 PNG |
| `npm run cli -- export "materials/*.ptex" -t "Godot/Godot 4 Standard" -o build` | 命令行批量导出，见 [docs/命令行.md](docs/命令行.md) |
| `npm run test:ui` | 界面回归测试（Playwright 驱动真实界面，约 5 分钟），见 [tests/ui/README.md](tests/ui/README.md) |
| `npm run test:cli` | 命令行导出的测试 |
| `npm run test:worker` | Worker 渲染与页面渲染逐像素一致、导出等图片加载、删除节点后释放渲染结果；网格贴图在 paint worker 里烘焙、绘制工程异步合成和保存，结果与页面同步路径一致且页面不卡 |
| `npm run perf` | 测量导出和预览时页面的卡顿（Worker 与页面渲染对比），结果见 [docs/性能.md](docs/性能.md) |
| `npm run test:engines` | 用本机的 Godot、Blender 检查导出能否正确导入（未安装的跳过），其他引擎的手动清单见 [docs/本地验证.md](docs/本地验证.md) |

CI（`.github/workflows/ci.yml`）在每次推送和合并请求时运行类型检查、单元测试、翻译检查、构建、节点/示例/SDF、e2e、命令行测试、Worker 渲染测试和界面回归测试。不安装游戏引擎，引擎导入在本地检查。

浏览器需要支持 WebGL2 和浮点渲染目标（`EXT_color_buffer_float`），主流桌面浏览器都支持。

## 兼容性

用上面的测试台验证：

- **节点**：399 个全部单独编译通过。
- **示例**：43 个示例里所有节点、所有输出都能渲染。
- **导出**：7 种材质类型的 39 个导出目标都能生成文件，模板指令全部处理完毕。
- **AgX 色调映射、自动导出写文件**：`npm run test:e2e`，AgX 与 Godot 公式的误差在浮点精度内（约 1e-7）；自动导出在选定文件后写入，输入变化时重写，无关改动不写。
- **Easy SDF**：250 个测试场景（每种元素的最小场景，加上 2D/3D 组合场景，普通和编辑两种模式）都能编译，保存后重新加载结果一致。
- **单元测试**：每个示例在 Node 里生成全部着色器代码不留未解析变量，保存再加载与原图一致。

其中有 7 个节点和 1 个示例在 Material Maker 原版里单独使用也编译不过，这里一并修正了：

- `bricks_nontileable` 调用的函数已在上游 `bricks` 节点里改名为 `oldbricks_*`、`oldbrick*`。修正直接写在 `library/nodes/bricks_nontileable.json` 里。
- `brush_triplanar` 和用到它的 `mesh_3d` 读取模型的包围盒、位置贴图和法线贴图；这些变量原版只在预览着色器里声明。现在渲染器在用到时声明，并绑定当前模型的烘焙贴图。
- `fast_blur_shader` 在输入未连接时采样一个颜色值：未连接时改为给一张空贴图。
- `kaleidoscope`、`kaleidoscope2` 在输入未连接时，默认值拼出了逗号表达式：未连接时只取坐标参数。
- `twist` 的输入默认值是 `vec2`，端口类型却是 `float`：输入默认值按端口类型自动转换。
- `doc_tools` 示例里的自定义函数用了没有作为参数传入的随机变量：着色器顶部提供这两个变量的全局默认值。

Easy SDF 移植时修正了两处上游问题：2D 颜色元素原本复用了 3D 的颜色脚本，会把 2D 坐标传给 3D 噪声函数而编译失败；2D FBM 纹理调用的函数在 `fbm2` 节点里已经改名。

Material Maker 的节点代码按桌面 GLSL 4.50 写（在 Godot 里作为 Vulkan 计算着色器运行），WebGL2 只支持 GLSL ES 3.00。差异由 `src/engine/render/glsl-fix.ts` 处理：

- 把 `{...}` 数组初始化改写成数组构造
- 给 GLSL ES 的保留字（`input`、`output`、`filter`……）改名
- 编译失败时按报错定位：根据函数声明，把应为浮点的整数实参改成浮点，然后重新编译

## 结构

| 目录 | 内容 | 对应 Material Maker |
| --- | --- | --- |
| `library/` | 本项目维护的节点库：节点定义、示例、节点菜单和图标、笔刷、端口类型和预览函数、导出模板、着色器公共函数、翻译 | 源自 `addons/material_maker/nodes`、`material_maker/examples`、`material_maker/library`、`material_maker/locale` |
| `src/engine/gen/` | 节点类型：着色器节点、图、输入输出、参数面板、开关、Buffer、迭代 Buffer、图片、文字、材质、网格贴图…… | `engine/nodes/gen_*.gd` |
| `src/engine/params/` | 参数类型：渐变、曲线、多边形、样条、像素、网格变形 | `types/*.gd` |
| `src/engine/loader.ts` | 由文件数据创建节点 | `engine/loader.gd` |
| `src/engine/export.ts` | 引擎导出：模板、条件、代码生成、HLSL/Unity/Unreal 转换 | `gen_material.gd` 的导出部分 |
| `src/engine/sdf/` | Easy SDF 的元素类型和场景到着色器的生成 | `sdf_builder/` |
| `src/engine/preview3d.ts` | 3D 纹理、光线步进、天空材质的预览着色器 | 这几种材质的 `preview_shader` |
| `src/engine/render/` | WebGL2 渲染器：着色器拼装、Buffer 依赖链、迭代、缓存、GLSL 兼容 | `engine/pipeline`、`multi_renderer.gd`、`mm_deps` |
| `src/ui/` | React 界面：节点图（React Flow）、库、检查器、预览、文件 | `material_maker/` 下的界面 |

生成着色器的核心（`$变量` 替换、输入函数、泛型端口 `#`、instance 函数的 variation 参数、`$rnd`、变体去重、globals 按引用裁剪……）是逐函数对照 `gen_shader.gd` 和 `gen_base.gd` 移植的，所以同一张图生成的代码和 Material Maker 基本一致，`.ptex` 文件也能互通。

## 3D 绘制和网格贴图

“文件 › 新建绘制项目”选一个模型（内置形状，或 OBJ/GLB/glTF）和贴图尺寸，进入绘制模式：

- **视图**：3D 视图里左键绘制、右键旋转、中键平移、滚轮缩放；可打开 2D 贴图视图，直接在贴图空间里画
- **工具**：自由点、自由线、直线、印章、取色、ID 遮罩，加橡皮、填充，以及“视图空间 / 通过视图的贴图空间”两种绘制方式
- **笔刷设置**：尺寸、硬度、不透明度、间距、角度、图案缩放、抖动；数位笔压力可以控制尺寸、不透明度和硬度。Shift 拖动调尺寸和硬度，Ctrl 拖动调图案
- **笔刷**：Material Maker 的 24 个笔刷全部可用。笔刷就是节点图，绘制时下方的节点编辑器显示的就是当前笔刷，可以直接改；笔刷的参数面板（它的 Remote 节点）在右侧。当前笔刷可以存进笔刷库
- **图层**：绘制图层（albedo、金属度/粗糙度、自发光、法线、深度/AO 五个通道）、程序图层（由笔刷图填满，改图即更新）、遮罩图层（作用于所在图层），支持嵌套、拖动排序、显隐、每个通道的不透明度
- **合成与导出**：从下往上合成出 7 张材质贴图，再由法线和深度生成法线贴图；可导出贴图包，也可以经材质节点走 Material Maker 的全部引擎导出目标
- **撤销**：按图层逐笔撤销、重做
- **文件**：保存为 zip，里面是 Material Maker 的 `.mmpp`、各图层 PNG 和模型。打开时可以选这个 zip，也可以把 Material Maker 存的 `.mmpp`、它的图层 PNG 和模型一起选上

绘制用到的网格贴图（以及 `Mesh Map` 节点）按 `map_generator` 的流程在 WebGL2 里烘焙：位置、法线、切线、曲率、AO、弯曲法线、厚度、邻接、接缝。材质模式下，`Mesh Map` 节点使用 3D 预览里当前显示的模型。

和 Material Maker 的差别：

- 光线投射类贴图（AO、弯曲法线、厚度）用本项目自己的 BVH 结构和遍历，光线生成和累计方式与原版一致
- 曲率按原版的公式计算，但原版假设顺时针绕序（Godot），这里按逆时针换了符号，凸面同样为正
- 每个通道单独一遍绘制（原版一次计算着色器写所有通道），结果相同
- “效果”类笔刷（模糊、去色、晕染）读取当前图层：原版现在的绘制模板没有声明这些纹理，这三个笔刷在原版里编译失败；这里补上了，读的是这一笔开始时的图层
- 浏览器里没有文件系统：项目存为一个 zip。`Mesh Map` 节点按 2048×2048 烘焙（与原版相同，可在偏好设置里改；光线数、AO 距离和偏移、降噪半径也在那里）

## 还没有移植的部分

- 导出目标里的自定义 GDScript（Material Maker 自带的导出目标都没有用到）

按需求不迁移：Material Maker 网站的登录，以及在网站上下载和分享节点、材质、环境。

逐项对照见 [docs/迁移清单.md](docs/迁移清单.md)。

## 独立性

本项目是独立的应用，不依赖 m3e-canvas-pro。与 m3e-canvas-pro 的唯一联系是 m3e 材质包这个文件格式：
- 规范：[docs/m3e-material.md](docs/m3e-material.md)
- 参考实现：`src/formats/m3e-material.ts`，不依赖任何库，可以直接复制过去使用

## 许可证

MIT。节点库、示例和模板来自 Material Maker（MIT，© 2018-present Rodolphe Suescun and contributors），许可证见 `library/LICENSE-material-maker.md`。HDR 环境贴图来自 Poly Haven（CC0）。详细说明见 [NOTICE.md](NOTICE.md)。
