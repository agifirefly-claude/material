# Material Maker 问题审查

本文逐个审查 Material Maker 在 GitHub 上的 221 个未关闭 issue（2026-11 抓取），看本项目有没有类似问题，以及值不值得处理。Material Maker 现在只是参考，issue 本身不是修改的理由：只有对本项目确实有价值的才处理。

## 1. 方法

每个 issue 先判断**是否适用**：

- **是**：在本项目里复现了，或者读代码能确认同样的问题存在。复现手段是单元测试（`tests/unit/issue-review.test.ts`）、浏览器端测试（`tests/e2e.mjs`），以及临时的 Playwright 脚本（例如下文的平铺审计）。
- **否**：问题出在 Godot、桌面程序、操作系统、驱动、网站、Steam、数位板、原版界面等本项目没有的部分，或者本项目的实现方式本来就不同。
- **不明**：描述不足，或者需要真实的 Godot/Unreal 才能确认，或者还没复现。

再按对本项目的**价值**打分：

| 价值 | 标准 |
| --- | --- |
| 高 | 产出错误的结果（坏文件、错的贴图、死循环），而且落在主流程上：编辑材质、导出到引擎、导出 m3e 材质包 |
| 中 | 结果不理想或用起来不顺，常用功能会碰到，修起来便宜 |
| 低 | 少见的场景、小众需求，或者只是锦上添花 |
| 无 | 与本项目无关 |

**决定**：

| 决定 | 含义 |
| --- | --- |
| 已修复 | 本次修了，带回归测试 |
| 本次实现 | 价值中等、改动小、风险低的增强，本次做了 |
| 增强已实现 | 本项目早已有这个功能 |
| 增强建议 | 有价值，但工作量大或要改不在本次范围的文件，先记下 |
| 暂缓 | 适用或可能适用，但价值不够高、需要真实引擎验证、属于节点数据（另有人维护），或要改本次不能改的文件 |
| 不做 | 价值低，或与本项目目标（PBR 贴图、引擎导出、给 m3e-canvas-pro 做 UI 材质）不符，或原版的行为本来就对 |
| 不适用 | 本项目没有这个问题 |

## 2. 统计

| 决定 | 数量 |
| --- | --- |
| 已修复 | 12 |
| 本次实现 | 5 |
| 增强已实现 | 17 |
| 增强建议 | 11 |
| 暂缓 | 34 |
| 不做 | 45 |
| 不适用 | 97 |
| 合计 | 221 |

## 3. 已修复和本次实现

### 3.1 导出的 .exr 贴图其实是 PNG（[#840](https://github.com/RodZill4/material-maker/issues/840)，高）

Blender 配置把粗糙度、金属度、置换、遮蔽写成 `.exr`，但 `exportForEngine` 不管扩展名，一律用 canvas 编码成 PNG，于是压缩包里的 `bricks_rough.exr` 等文件是 PNG 字节，Blender 读不了。

修复：`src/ui/exporting.ts` 新增 `imageFormatOf`、`encodeTarget`，按文件名选编码器。`.exr` 用已有的 `src/ui/preview2d/exr.ts` 写半精度 OpenEXR，直接取渲染目标的浮点像素；png、jpg、webp 走 canvas。

测试：`tests/unit/issue-review.test.ts`（扩展名判断；Blender 配置确实要求 .exr），`tests/e2e.mjs`“Engine export zips”（真实导出 Blender 压缩包，检查 .exr 文件头是 `76 2f 31 01`，.png 文件头是 PNG）。

### 3.2 Unreal 5 导出脚本缺少 mm.py（[#615](https://github.com/RodZill4/material-maker/issues/615)、[#760](https://github.com/RodZill4/material-maker/issues/760)，高）

UE5 配置生成的 `bricks.py` 先 `sys.path.append('$(material_maker_path)/export')` 再 `import mm`。原版指向安装目录里的 `mm.py`，本项目的压缩包里没有这个文件，路径又被替换成了 `/export`，脚本在 Unreal 里一运行就报 `No module named 'mm'`。

修复：

- 新增 `src/export/unrealMm.ts`：内嵌 `mm.py`（基于原版 `material_maker/misc/export/mm.py`，MIT 许可，文件头保留出处）。去掉了调试用的 `dump()`；相对路径按 `mm.py` 所在的文件夹解析，因为本项目导出的是相对文件名，而原版写的是绝对路径。
- `localizeUnrealScript` 把脚本里查找 `mm.py` 的那一行改成脚本自己的文件夹（`os.path.dirname(os.path.abspath(__file__))`）。
- `exportForEngine` 在有脚本 `import mm` 时把 `mm.py` 放进压缩包。
- 配置里名为 `clipboard` 的文件（原版的意思是“复制到剪贴板”）不再作为一个叫 clipboard 的文件写进压缩包，改为尽量复制到剪贴板。

测试：单元测试检查脚本里用到的每个 `mm.xxx(` 都在 `mm.py` 里有定义、路径行被替换、其他脚本不受影响；e2e 检查压缩包里有 `mm.py`，没有 `clipboard`。

#760 里另外两个错误（HLSL 保留字 `char` 作参数名、动态材质里未声明的变量）要在 UE5 里验证，暂缓。

### 3.3 参数表达式引用自己时卡死（[#562](https://github.com/RodZill4/material-maker/issues/562) 问题 1，高）

浮点参数的表达式会被当作文本代入，再继续替换里面的 `$变量`（这样表达式才能引用命名参数和 `$time`）。如果参数 `a` 的表达式里写了 `$a`（例如命名参数恰好与节点参数同名），替换结果里又出现 `$a`，`GenShader.replaceVariables` 就无限循环，整个界面卡死。两个参数互相引用也一样。

修复：`src/engine/gen/shader.ts` 的 `replaceVariables` 记录正在展开的变量及其文本的起点；同一个变量在自己的展开文本里再次出现时，代入 `(error: a refers to itself)`，着色器编译失败并在节点上报错，而不是卡死。正常的引用（一个参数多次用另一个参数）不受影响。

测试：单元测试覆盖自引用、互相引用、正常引用三种情况。

问题 2、3（命名参数和节点参数、输入同名时互相遮蔽）只在重名时出现，改名即可避开，价值低，暂缓。

### 3.4 小的增强（中）

| issue | 改动 | 位置 |
| --- | --- | --- |
| [#204](https://github.com/RodZill4/material-maker/issues/204) | 数字框输入 `0,5` 读成 0.5（只处理纯数字，`min(1,2)` 这类表达式不变） | `src/ui/widgets/floatInput.ts`、`FloatEdit.tsx`；单元测试 |
| [#263](https://github.com/RodZill4/material-maker/issues/263) | 浮点参数右键恢复默认值，悬停提示里写明默认值 | `FloatEdit.tsx`、`ParamControl.tsx` |
| [#161](https://github.com/RodZill4/material-maker/issues/161) | Ctrl+S（⌘S）保存工程，不再触发浏览器的“保存网页” | `src/ui/App.tsx` |
| [#175](https://github.com/RodZill4/material-maker/issues/175) | 节点库的悬停提示加上节点说明 | `src/ui/Library.tsx` |
| [#674](https://github.com/RodZill4/material-maker/issues/674) | 2D 预览的导出菜单加“复制”，按所选分辨率把 PNG 放进剪贴板 | `src/ui/Preview2D.tsx` |
| [#492](https://github.com/RodZill4/material-maker/issues/492) | SDF 编辑器里在输入框打字时，Delete/Backspace、Ctrl+C/X/V 不再作用于元素树 | `src/ui/SdfEditor.tsx` |

#161 原文要的是“按上次的名字和格式重新导出”；浏览器每次下载都会弹出或进下载目录，做不到覆盖原文件，所以只做了保存。覆盖写回的需求由已有的自动导出节点（File System Access API）满足。

### 3.5 节点数据（[#1137](https://github.com/RodZill4/material-maker/issues/1137)、[#528](https://github.com/RodZill4/material-maker/issues/528)、[#1205](https://github.com/RodZill4/material-maker/issues/1205)，中）

节点库解耦后，这三处直接改在 `library/nodes/` 里：

- **Tiler 固定偏移在奇数行时错行**（#1137）。`tiler` 的 `instance` 用 `mod(mod(tile_index.y, tile.y), 2.0)` 判断奇偶行。GPU 除法不精确时，`mod(9.0, 9.0)` 可能得到 9 而不是 0，原报告里出错的正好是 5、9、13 行。改为 `mod(floor(mod(tile_index.y+0.5, tile.y)), 2.0)`：整数加 0.5 后再取整，不受除法误差影响。无头 Chromium 用软件渲染，复现不了这个误差，所以还没在真实 GPU 上验证。
- **Blend 的 Dodge 在输入大于 1 时出现色带**（#528）。`blend_dodge_f` 只在 `c1 == 1.0` 时特判，`c1 > 1` 时会除以负数。改为 `(c1>=1.0)?1.0:min(c2/(1.0-c1),1.0)`。`blend2` 共用这个函数。
- **Godot 4 ORM 的贴图读不到**（#1205）。`material`、`material_tesselated` 的 Godot 4 ORM 模板头部是 `format=3`，资源引用却是 Godot 3 写法。改为 `type="Texture2D" id="N"` 和 `ExtResource("N")`。还需要在本地 Godot 4 里确认，步骤见 [本地验证](本地验证.md)。

测试：`tests/unit/issue-review.test.ts`，检查两个节点的代码，并生成一次 Godot 4 ORM 导出，确认用的是 Godot 4 写法。节点编译 399/399、示例 43/43、导出 39/39 不变。

### 3.6 渲染（[#758](https://github.com/RodZill4/material-maker/issues/758)、[#729](https://github.com/RodZill4/material-maker/issues/729)、[#1539](https://github.com/RodZill4/material-maker/issues/1539)、[#751](https://github.com/RodZill4/material-maker/issues/751)，中）

随“渲染放进 Worker”一起完成，详见 [性能](性能.md)：

- **图片还没加载完就导出，得到黑色贴图**（#758、#729）。`Renderer` 和 Worker 渲染服务都有 `imagesLoaded()`，所有导出路径（含抗锯齿导出）都先等图片加载完；Worker 里如果录制时图片还在加载，会重录一次。
- **删除节点后渲染结果不释放**（#1539）。编辑停下 1 秒后，`prune()` 释放不在任何打开工程里的节点的缓冲、迭代缓冲、文字和图片渲染。
- **重着色器卡死**（#751）。大于 1024² 的渲染分成 512² 的块；每组块之间检查 GPU 是否完成，超过时限（预览 8 秒、导出 20 秒）就停下并报“对这个尺寸来说太重”，界面不卡。迭代缓冲的迭代次数上限 1024。已经提交给 GPU 的一块无法中止，真正卡死的着色器会导致 GPU 重置，这时走上下文丢失的恢复流程。

测试：`npm run test:worker`（导出前等图片：取到的颜色正确；反复增删缓冲节点 8 次，缓存大小不变）。

## 4. 适用但暂缓的

### 4.1 节点数据（交给数据维护方）

节点库解耦后成为本项目自己的数据（`library/nodes/`），下面的 Tiler、Dodge 已直接改在数据里，见 3.5。

**平铺审计**。m3e 材质包要求四边无缝，所以用临时 Playwright 脚本把所有无输入的生成节点（97 个）和全部砖块节点，各用 3 个种子渲染 256²，比较左右、上下两条接缝处的跳变与图中央相邻列的跳变（比值 0 表示完全无缝，大于 3 视为可疑）：

- 无输入生成节点：可疑的只有渐变、螺旋渐变、正弦波和 SDF 形状。这些本来就不平铺，没有问题。
- 砖块节点：`bricks_uneven3` 和 `bricks_uneven3_2` 为 28（[#831](https://github.com/RodZill4/material-maker/issues/831)），`skewed_uneven_bricks` 为 10（[#623](https://github.com/RodZill4/material-maker/issues/623)），确认不平铺。其余砖块节点都是 0。

`bricks_uneven3` 的 `bricks_uneven2()` 函数从代码上看在 x、y 方向都是周期的，接缝的来源还没找到，需要单独调试。用这两个节点做 m3e 材质时要注意。

其余节点数据问题（[#849](https://github.com/RodZill4/material-maker/issues/849) Smooth Pixels 插值、[#745](https://github.com/RodZill4/material-maker/issues/745) Random Weave 伪影、[#739](https://github.com/RodZill4/material-maker/issues/739) Circle Splatter 实例 UV）与原版相同，价值低，暂缓。

### 4.2 需要在真实引擎里验证

- **Godot 4 ORM**（[#1205](https://github.com/RodZill4/material-maker/issues/1205)）：模板已改为 Godot 4 写法（见 3.5），还需要在本地 Godot 4 里打开确认 `orm_texture` 能读到。
- **Godot 4 动态材质数组初始化**（[#732](https://github.com/RodZill4/material-maker/issues/732)）、**UE5 动态材质的 HLSL 错误**（[#760](https://github.com/RodZill4/material-maker/issues/760)）：生成的代码与原版相同，需要引擎才能确认。

### 4.3 其他

- [#645](https://github.com/RodZill4/material-maker/issues/645)：canvas 存的是预乘 alpha，带透明度的图导出 PNG 时，低 alpha 处的颜色会损失精度。要换成自己的 PNG 编码器，和 16 位 PNG（[#1309](https://github.com/RodZill4/material-maker/issues/1309)、[#931](https://github.com/RodZill4/material-maker/issues/931)）一起做。
- [#1173](https://github.com/RodZill4/material-maker/issues/1173)、[#1277](https://github.com/RodZill4/material-maker/issues/1277)、[#1124](https://github.com/RodZill4/material-maker/issues/1124)：都与原版跨帧计算的迭代缓冲有关。本项目一次算完，多半不受影响，但还没有专门测，留给 UI 回归测试。

## 5. 增强建议

| issue | 内容 | 为什么现在不做 |
| --- | --- | --- |
| [#931](https://github.com/RodZill4/material-maker/issues/931)、[#1309](https://github.com/RodZill4/material-maker/issues/1309)、[#361](https://github.com/RodZill4/material-maker/issues/361) | 16 位贴图 | 浏览器 canvas 只能读写 8 位，需要自己的 PNG 编解码器。高精度可以先用 EXR |
| [#1352](https://github.com/RodZill4/material-maker/issues/1352) | MaterialX 导出 | 有价值，但工作量大，排在现有引擎导出稳定之后 |
| [#687](https://github.com/RodZill4/material-maker/issues/687)、[#688](https://github.com/RodZill4/material-maker/issues/688) | 禁用节点、暂停计算 | 要改代码生成和节点图视图（`GraphView.tsx` 不在本次范围） |
| [#231](https://github.com/RodZill4/material-maker/issues/231)、[#156](https://github.com/RodZill4/material-maker/issues/156) | 高亮所选节点的连线；节点拖到连线上自动接入 | 同上，要改 `GraphView.tsx` |
| [#1171](https://github.com/RodZill4/material-maker/issues/1171) | 预乘/直通 alpha 转换 | 自定义节点即可实现，单独做节点价值低 |
| [#1126](https://github.com/RodZill4/material-maker/issues/1126) | Adjust HSV 的遮罩输入 | Blend 节点可以实现 |
| [#585](https://github.com/RodZill4/material-maker/issues/585) | 绘制：从图片生成遮罩 | 绘制不是本项目重点 |

## 6. 全部 issue

| 编号 | 标题 | 类型 | 本项目有类似问题 | 价值 | 决定 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| [1623](https://github.com/RodZill4/material-maker/issues/1623) | [macOS] Crash (SIGSEGV in vkQueueSubmit on the rendering thread) when generating an Ambient Occlusion map, stops at 98% | 其他 | 否 | 无 | 不适用 | Godot/Vulkan 驱动崩溃；本项目用 WebGL2 |
| [1622](https://github.com/RodZill4/material-maker/issues/1622) | Baked model normal map texture | 增强 | 是 | 中 | 增强已实现 | 网格贴图烘焙已有法线（`src/engine/paint/meshmaps.ts`） |
| [1611](https://github.com/RodZill4/material-maker/issues/1611) | Crash on shutdown/exit | 缺陷 | 否 | 无 | 不适用 | Godot 程序退出崩溃 |
| [1603](https://github.com/RodZill4/material-maker/issues/1603) | Custom Shader/Custom Material node fails to load when opening PTEX, Vanishes from Graph | 缺陷 | 不明 | 中 | 暂缓 | 自定义着色器节点从 .ptex 读回：我们有节点编辑器往返单元测试覆盖，未能复现；等有样例文件再查 |
| [1581](https://github.com/RodZill4/material-maker/issues/1581) | Color Conversion node - the two Mode options appear to be swapped        (naming does not match Unreal Engine / Blender convention) | 其他 | 否 | 无 | 不做 | 节点公式正确（sRGB→线性本来就变暗）；用户把“按 Non-Color 解读”与“颜色转换”混为一谈。改标签会和其余软件相反 |
| [1577](https://github.com/RodZill4/material-maker/issues/1577) | ptex import addon is no longer up to date with godot or project | 缺陷 | 否 | 无 | 不适用 | Godot 导入插件 |
| [1554](https://github.com/RodZill4/material-maker/issues/1554) | Material Alignment in Preview is Off by Half-Pixel | 缺陷 | 否 | 低 | 不适用 | 3D 预览用 three.js，贴图采样与原版不同 |
| [1540](https://github.com/RodZill4/material-maker/issues/1540) | corrupted size vs. prev_size in fastbins : custom mesh not visible (obj/glb) | 缺陷 | 否 | 无 | 不适用 | Godot 模型加载崩溃；我们用 three.js 加载器 |
| [1539](https://github.com/RodZill4/material-maker/issues/1539) | System runs out of memory when trying to compute nodegraph with multiple Make Tilable Square nodes | 缺陷 | 不明 | 中 | 已修复 | 删除节点后缓冲等渲染结果不释放；现在编辑停下后释放（3.6） |
| [1517](https://github.com/RodZill4/material-maker/issues/1517) | Crash When Changing a Tab when Windows File Manager is Opened while Importing and Exporting | 缺陷 | 否 | 无 | 不适用 | Windows 原生文件对话框 |
| [1506](https://github.com/RodZill4/material-maker/issues/1506) | Segmentation fault on export on linux | 缺陷 | 否 | 无 | 不适用 | Linux 导出段错误（Godot） |
| [1501](https://github.com/RodZill4/material-maker/issues/1501) | Wrong project filename on Save or Save As... | 缺陷 | 否 | 无 | 不适用 | 原版保存对话框逻辑；浏览器下载用工程标题 |
| [1448](https://github.com/RodZill4/material-maker/issues/1448) | Material Maker preview window freezes during loads of certain ptex files | 缺陷 | 否 | 低 | 不适用 | 原版加载时预览卡死；我们的渲染流程不同 |
| [1421](https://github.com/RodZill4/material-maker/issues/1421) | Image node: Add "Open source image location" menu item / button | 增强 | 否 | 无 | 不适用 | 浏览器拿不到文件的本地路径 |
| [1420](https://github.com/RodZill4/material-maker/issues/1420) | Toon/Cel-Shading nodes and packed ILM export templates | 增强 | 否 | 低 | 不做 | 卡通着色专用节点和 ILM 模板，偏离通用 PBR/UI 材质的目标 |
| [1417](https://github.com/RodZill4/material-maker/issues/1417) | Assets Not Added to The Website | 缺陷 | 否 | 无 | 不适用 | 网站（按需求不迁移） |
| [1406](https://github.com/RodZill4/material-maker/issues/1406) | Improved Interface Font | 增强 | 否 | 无 | 不适用 | Godot 界面字体 |
| [1402](https://github.com/RodZill4/material-maker/issues/1402) | Can't Connect to the Website | 缺陷 | 否 | 无 | 不适用 | 网站（按需求不迁移） |
| [1400](https://github.com/RodZill4/material-maker/issues/1400) | Wrong DPI / Resolution on secondary monitor with different display resolution as compared with the main monitor | 缺陷 | 否 | 无 | 不适用 | Godot 多显示器 DPI |
| [1385](https://github.com/RodZill4/material-maker/issues/1385) | MangoHud breaks right click context window, freezes application | 缺陷 | 否 | 无 | 不适用 | MangoHud 与 Godot |
| [1379](https://github.com/RodZill4/material-maker/issues/1379) | My painting related wish list | 增强 | 部分 | 低 | 暂缓 | 绘制功能愿望清单，范围大；绘制不是本项目重点 |
| [1373](https://github.com/RodZill4/material-maker/issues/1373) | Crashing after command line export | 缺陷 | 否 | 无 | 不适用 | 原版命令行导出 |
| [1371](https://github.com/RodZill4/material-maker/issues/1371) | New Paint Project Crash | 缺陷 | 否 | 无 | 不适用 | Godot 崩溃 |
| [1352](https://github.com/RodZill4/material-maker/issues/1352) | Support for MaterialX Export and Integration | 增强 | 否 | 中 | 增强建议 | MaterialX 导出有价值但工作量大，排在引擎导出稳定之后 |
| [1348](https://github.com/RodZill4/material-maker/issues/1348) | Coat shader support | 增强 | 否 | 低 | 不做 | 清漆层要扩展材质模型和所有导出模板，收益小 |
| [1340](https://github.com/RodZill4/material-maker/issues/1340) | EasySDF albedo loses their color when duplicated | 缺陷 | 不明 | 低 | 暂缓 | EasySDF 复制后颜色丢失；SDF 编辑器是移植实现，未复现 |
| [1335](https://github.com/RodZill4/material-maker/issues/1335) | Unable to type in any field | 缺陷 | 否 | 无 | 不适用 | Godot 输入问题 |
| [1318](https://github.com/RodZill4/material-maker/issues/1318) | Tiler node, rotation, scale, value control | 增强 | 否 | 低 | 不做 | 节点功能请求（改节点数据），不在本项目当前目标内 |
| [1311](https://github.com/RodZill4/material-maker/issues/1311) | Preview Texture Misaliged | 缺陷 | 否 | 低 | 不适用 | 原版预览对齐；我们的 2D 预览是自己实现 |
| [1309](https://github.com/RodZill4/material-maker/issues/1309) | PNG Export Bit Depth | 增强 | 是 | 中 | 增强建议 | 16 位 PNG：浏览器 canvas 只能写 8 位，需要自己写 PNG 编码器；EXR 已可用作高精度出口 |
| [1303](https://github.com/RodZill4/material-maker/issues/1303) | Uneven Bricks generates different pattern when used with Blur filter | 缺陷 | 不明 | 低 | 暂缓 | 需要构造随机种子与模糊组合的复现图，暂缓 |
| [1299](https://github.com/RodZill4/material-maker/issues/1299) | Implement Real-time Mirroring/Symmetry for Paint Mode | 增强 | 否 | 低 | 暂缓 | 绘制对称，绘制不是重点 |
| [1288](https://github.com/RodZill4/material-maker/issues/1288) | Material maker does not open correctly on dual monitor setups. | 缺陷 | 否 | 无 | 不适用 | Godot 多显示器 |
| [1277](https://github.com/RodZill4/material-maker/issues/1277) | Symmetric Nearest Neighbor node doesn't properly update | 缺陷 | 不明 | 中 | 暂缓 | 迭代缓冲更新：我们一次算完迭代（与原版跨帧不同），疑似不受影响，未专门验证 |
| [1272](https://github.com/RodZill4/material-maker/issues/1272) | Material Maker 1.5 Source Code Version has a blank window when I run the project | 其他 | 否 | 无 | 不适用 | Godot 源码运行 |
| [1270](https://github.com/RodZill4/material-maker/issues/1270) | app graphichs are not fulliy loading/grainy with update to 1.5 | 缺陷 | 否 | 无 | 不适用 | Godot 渲染 |
| [1259](https://github.com/RodZill4/material-maker/issues/1259) | What are .mmcr files for? | 其他 | 否 | 无 | 不适用 | 提问（.mmcr 文件） |
| [1250](https://github.com/RodZill4/material-maker/issues/1250) | 3D preview resolution decreases with increasing ui scale | 缺陷 | 否 | 无 | 不适用 | Godot 界面缩放 |
| [1239](https://github.com/RodZill4/material-maker/issues/1239) | Segmentation fault on exit | 缺陷 | 否 | 无 | 不适用 | Godot 退出崩溃 |
| [1220](https://github.com/RodZill4/material-maker/issues/1220) | Roughness value overrides texture. | 缺陷 | 否 | 无 | 不适用 | Godot 的 roughness 与贴图相乘，导出写 1.0 正确 |
| [1215](https://github.com/RodZill4/material-maker/issues/1215) | Slovenian translation | 增强 | 否 | 无 | 不做 | 新增语言靠翻译者，不是代码问题 |
| [1210](https://github.com/RodZill4/material-maker/issues/1210) | random crashing and freezing | 缺陷 | 否 | 无 | 不适用 | Godot 崩溃 |
| [1205](https://github.com/RodZill4/material-maker/issues/1205) | ORM texture is not set when exporting to Godot 4 ORM | 缺陷 | 不明 | 中 | 已修复 | 导出的 Godot 4 ORM .tres 用了 Godot 3 写法，已改为 Godot 4 写法；待本地 Godot 4 确认（3.5） |
| [1187](https://github.com/RodZill4/material-maker/issues/1187) | Out of application memory on macOS | 缺陷 | 否 | 无 | 不适用 | macOS 内存（Godot） |
| [1183](https://github.com/RodZill4/material-maker/issues/1183) | Please add sampler2d as a type of input | 增强 | 否 | 低 | 不做 | sampler2D 输入会破坏节点之间的代码生成方式 |
| [1178](https://github.com/RodZill4/material-maker/issues/1178) | Dynamic PBR Material causes flickering of both 2D and 3D previews | 缺陷 | 否 | 无 | 不适用 | Godot 预览闪烁 |
| [1174](https://github.com/RodZill4/material-maker/issues/1174) | Add support for the ARM platform | 增强 | 否 | 无 | 不适用 | 浏览器本来就跨平台 |
| [1173](https://github.com/RodZill4/material-maker/issues/1173) | Fill from color node does not automatically update | 缺陷 | 不明 | 中 | 暂缓 | 同 #1277 |
| [1171](https://github.com/RodZill4/material-maker/issues/1171) | Add premultiplied to straight (and vise-versa) alpha node | 增强 | 否 | 低 | 增强建议 | 预乘/直通 alpha 转换节点，可以用自定义节点做；见下文 |
| [1152](https://github.com/RodZill4/material-maker/issues/1152) | RMB node popup turns black, app freezes on cachyos | 缺陷 | 否 | 无 | 不适用 | Linux 发行版问题 |
| [1150](https://github.com/RodZill4/material-maker/issues/1150) | Preview2D (2) only displays checkers map since program crashed | 缺陷 | 否 | 无 | 不适用 | 原版崩溃后的状态 |
| [1137](https://github.com/RodZill4/material-maker/issues/1137) | Tiler: Fixed offset offsets wrong rows when Tile Y has some odd numbers | 缺陷 | 是 | 中 | 已修复 | Tiler 偏移用 `mod(mod(y, tile.y), 2.0)`，GPU 上除法不精确时奇数行判错；已改为加 0.5 后取整（3.5） |
| [1132](https://github.com/RodZill4/material-maker/issues/1132) | Linux Commandline Batch Export does not work, even in 1.5p1 release. | 缺陷 | 否 | 无 | 不适用 | 原版命令行导出 |
| [1131](https://github.com/RodZill4/material-maker/issues/1131) | Performance Problems with 1.4 | 缺陷 | 否 | 无 | 不适用 | 原版性能 |
| [1126](https://github.com/RodZill4/material-maker/issues/1126) | Add mask input to "Adjust HSV" node | 增强 | 否 | 低 | 增强建议 | 给 Adjust HSV 加遮罩：可用 Blend 节点实现，改节点数据收益小 |
| [1125](https://github.com/RodZill4/material-maker/issues/1125) | Intel igpu crash | 缺陷 | 否 | 无 | 不适用 | Intel 核显 Vulkan |
| [1124](https://github.com/RodZill4/material-maker/issues/1124) | Auto Tones breaking export | 缺陷 | 不明 | 中 | 暂缓 | 原版是迭代缓冲卡住导出；我们的导出同步渲染，单独验证留到 UI 测试 |
| [1110](https://github.com/RodZill4/material-maker/issues/1110) | Albedo channel of PBR output not reading Custom Shader node output correctly | 缺陷 | 不明 | 低 | 暂缓 | 自定义着色器连 PBR 反照率，未复现 |
| [1077](https://github.com/RodZill4/material-maker/issues/1077) | Color picker is not working on Linux | 缺陷 | 否 | 无 | 不适用 | Linux 取色器（Godot） |
| [1067](https://github.com/RodZill4/material-maker/issues/1067) | Shift/Ctrl for node selection | 增强 | 否 | 无 | 增强已实现 | Shift/Ctrl 多选已有 |
| [1048](https://github.com/RodZill4/material-maker/issues/1048) | Zoom without scroll | 增强 | 否 | 无 | 增强已实现 | Ctrl+拖动缩放已有 |
| [1044](https://github.com/RodZill4/material-maker/issues/1044) | Material Export Editor: Create Textures for Enfusion Engine | 增强 | 否 | 低 | 不做 | Enfusion 引擎专用模板，受众太小 |
| [967](https://github.com/RodZill4/material-maker/issues/967) | Hard-coded file system paths in project.godot? | 其他 | 否 | 无 | 不适用 | Godot 工程文件 |
| [954](https://github.com/RodZill4/material-maker/issues/954) | Add Support for View and Normal Based Nodes | 增强 | 否 | 低 | 不做 | 视角相关节点不能烘焙成贴图，与输出平铺贴图的目标冲突 |
| [934](https://github.com/RodZill4/material-maker/issues/934) | Add support for converting height map to a bent normal map | 增强 | 否 | 低 | 不做 | 高度图转弯曲法线：网格烘焙已有弯曲法线，2D 版价值低 |
| [931](https://github.com/RodZill4/material-maker/issues/931) | Support 16-bit channels | 增强 | 是 | 中 | 增强建议 | 同 #1309 |
| [916](https://github.com/RodZill4/material-maker/issues/916) | add a 'to run' section on readme | 增强 | 否 | 无 | 不适用 | 原版 README |
| [849](https://github.com/RodZill4/material-maker/issues/849) | Smooth Pixels node has inconsistent interpolation | 缺陷 | 是 | 低 | 暂缓 | Smooth Pixels 插值不一致，节点数据问题，与原版相同；不影响主流程 |
| [840](https://github.com/RodZill4/material-maker/issues/840) | Export to .exr does not work | 缺陷 | 是 | 高 | 已修复 | Blender 等配置要求 .exr 的贴图，导出时写成了 PNG 字节 |
| [831](https://github.com/RodZill4/material-maker/issues/831) | Uneven Bricks 3 is not tileable | 缺陷 | 是 | 高 | 暂缓 | 已复现：接缝比 28（正常为 0）；节点数据问题，交给数据维护方，复现方法见下文 |
| [825](https://github.com/RodZill4/material-maker/issues/825) | Export SpatialMaterial to Three.js compatible JSON | 增强 | 否 | 低 | 不做 | three.js JSON 材质：已有 glTF/.glb 导出，three.js 直接读 glTF |
| [790](https://github.com/RodZill4/material-maker/issues/790) | Comments duplicate when entering-and-exiting a node group | 缺陷 | 否 | 无 | 不适用 | 原版注释框复制 |
| [786](https://github.com/RodZill4/material-maker/issues/786) | Material Maker Lags on AUR Install, Fails to Start When Built from Source (Arch Linux) | 缺陷 | 否 | 无 | 不适用 | AUR 安装 |
| [783](https://github.com/RodZill4/material-maker/issues/783) | Tutorial is out of date. | 其他 | 否 | 无 | 不适用 | 原版教程 |
| [777](https://github.com/RodZill4/material-maker/issues/777) | Discrepancy between 2D and 3D previews when creating a dynamic unlit material | 缺陷 | 否 | 低 | 不适用 | 我们的 3D 预览用 three.js 自己的着色 |
| [772](https://github.com/RodZill4/material-maker/issues/772) | Node float parameters not being editable on left click | 缺陷 | 否 | 无 | 不适用 | Godot 输入 |
| [762](https://github.com/RodZill4/material-maker/issues/762) | Two-finger scroll on Mac in Preview3D doesn't zoom in/out | 缺陷 | 不明 | 低 | 暂缓 | Mac 触控板双指缩放 3D 预览：three.js 控件支持滚轮，未在 Mac 上验证 |
| [760](https://github.com/RodZill4/material-maker/issues/760) | Unreal Engine 5.4.4 import errors | 缺陷 | 是 | 高 | 已修复 | 同 #615（缺 mm.py）。另报的 HLSL 关键字 `char` 和未声明变量需在 UE5 中验证，暂缓 |
| [758](https://github.com/RodZill4/material-maker/issues/758) | Albedo is black on export | 缺陷 | 不明 | 中 | 已修复 | 图片还没加载完就导出会得到黑图；现在导出先等图片加载完（3.6） |
| [754](https://github.com/RodZill4/material-maker/issues/754) | Model preview rotation loop | 增强 | 否 | 无 | 增强已实现 | 3D 预览自动旋转已有 |
| [752](https://github.com/RodZill4/material-maker/issues/752) | Exported images from the preview of a grayscale/float outputting node only have a red channel set | 缺陷 | 否 | 无 | 不适用 | 灰度节点导出：我们按预览着色器转成 RGB 再写 |
| [751](https://github.com/RodZill4/material-maker/issues/751) | Skewed Brick Causes Lockup and Crash When Added | 缺陷 | 不明 | 中 | 已修复 | 重着色器卡住界面；现在分块渲染、超时停止（3.6） |
| [750](https://github.com/RodZill4/material-maker/issues/750) | Advanced Tiler Should Have a Value Control Input | 增强 | 否 | 低 | 不做 | 节点功能请求 |
| [746](https://github.com/RodZill4/material-maker/issues/746) | Make non-editable nodes not display edit icon | 增强 | 否 | 低 | 不做 | 界面细节，收益小 |
| [745](https://github.com/RodZill4/material-maker/issues/745) | Random Weave node has artifacts on 1.4a | 缺陷 | 是 | 低 | 暂缓 | Random Weave 伪影，节点数据问题，与原版相同 |
| [742](https://github.com/RodZill4/material-maker/issues/742) | Shader Tilling Clamp | 增强 | 否 | 低 | 不做 | 着色器采样夹取：已有平铺/夹取预览选项 |
| [740](https://github.com/RodZill4/material-maker/issues/740) | v1.4a2 sometimes crashes when moving node | 缺陷 | 否 | 无 | 不适用 | Godot 崩溃 |
| [739](https://github.com/RodZill4/material-maker/issues/739) | Circle Splatter's Instance UV Outputs Quads Sometimes | 缺陷 | 是 | 低 | 暂缓 | Circle Splatter 实例 UV，节点数据问题，与原版相同 |
| [732](https://github.com/RodZill4/material-maker/issues/732) | Exporting a dynamic PBR material with colorize node having errors when exported | 缺陷 | 不明 | 中 | 暂缓 | Godot 4 动态材质的数组初始化，需在真实 Godot 4 里验证 |
| [730](https://github.com/RodZill4/material-maker/issues/730) | Random nodes will "jitter" on preview2d in some occasions | 缺陷 | 不明 | 低 | 暂缓 | 随机节点在预览里抖动，未复现 |
| [729](https://github.com/RodZill4/material-maker/issues/729) | Export a black albedo map | 缺陷 | 不明 | 中 | 已修复 | 同 #758，已修复（3.6） |
| [724](https://github.com/RodZill4/material-maker/issues/724) | Export bug | 缺陷 | 不明 | 低 | 暂缓 | 描述不足 |
| [722](https://github.com/RodZill4/material-maker/issues/722) | Blur and Fast Blur is not tileable in 1.4 | 缺陷 | 不明 | 中 | 暂缓 | 模糊节点平铺：要接图片才能测，留给平铺审计脚本的后续版本 |
| [720](https://github.com/RodZill4/material-maker/issues/720) | Add new editor environment for 3D preview | 缺陷 | 否 | 无 | 不适用 | 原版环境编辑器 |
| [706](https://github.com/RodZill4/material-maker/issues/706) | shortcuts being buggy | 其他 | 否 | 无 | 不适用 | 原版快捷键 |
| [703](https://github.com/RodZill4/material-maker/issues/703) | Math Functions turn Colored Images into greyscale | 缺陷 | 否 | 无 | 不做 | Math 节点按设计是标量，彩色请用 Math v3 |
| [700](https://github.com/RodZill4/material-maker/issues/700) | Add a simple tag/keyword for each node, allowing searching related functions by different names | 增强 | 否 | 无 | 增强已实现 | 节点别名搜索已有 |
| [694](https://github.com/RodZill4/material-maker/issues/694) | Create native linux/Ubuntu installer | 增强 | 否 | 无 | 不适用 | 浏览器应用不需要安装包 |
| [693](https://github.com/RodZill4/material-maker/issues/693) | Make configurations in remote and parameter nodes update values in linked controls | 增强 | 否 | 低 | 暂缓 | Remote 节点的配置与联动，需求小众 |
| [692](https://github.com/RodZill4/material-maker/issues/692) | Comments and nodes sometimes block navigation inside the node graph when the mouse is over them | 缺陷 | 否 | 无 | 不适用 | 原版节点图导航 |
| [689](https://github.com/RodZill4/material-maker/issues/689) | Comment / Frame improvement ideas | 增强 | 否 | 低 | 不做 | 注释框改进想法，零散 |
| [688](https://github.com/RodZill4/material-maker/issues/688) | Add an option to temporarily pause computation of the node graph | 增强 | 否 | 中 | 增强建议 | 暂停计算：要改节点图视图（不在本次可改范围） |
| [687](https://github.com/RodZill4/material-maker/issues/687) | Add an option to mute / disable nodes | 增强 | 否 | 中 | 增强建议 | 禁用节点：要改代码生成和节点图视图 |
| [681](https://github.com/RodZill4/material-maker/issues/681) | Crash when tabbing out of various fields in Parameter node | 缺陷 | 否 | 无 | 不适用 | Godot 崩溃 |
| [678](https://github.com/RodZill4/material-maker/issues/678) | Repository cleanup suggestions | 增强 | 否 | 无 | 不适用 | 原版仓库 |
| [677](https://github.com/RodZill4/material-maker/issues/677) | Moving and then deleting control points breaks Tonality gradient | 缺陷 | 不明 | 低 | 暂缓 | 渐变控件删点，我们的控件是重写的，未复现 |
| [676](https://github.com/RodZill4/material-maker/issues/676) | Poor contrast makes text difficult to read | 缺陷 | 否 | 无 | 不适用 | 原版主题 |
| [674](https://github.com/RodZill4/material-maker/issues/674) | Copy texture to clipboard | 增强 | 否 | 中 | 本次实现 | 2D 预览导出菜单新增“复制”，按所选分辨率复制 PNG 到剪贴板 |
| [672](https://github.com/RodZill4/material-maker/issues/672) | Materials with AO turn black when converting to shader in Godot | 缺陷 | 否 | 无 | 不适用 | Godot 端的转换 |
| [666](https://github.com/RodZill4/material-maker/issues/666) | Navigating new node list with arrow keys jumps by 2 lines instead of 1 | 缺陷 | 否 | 无 | 不适用 | 原版列表控件 |
| [665](https://github.com/RodZill4/material-maker/issues/665) | cant use any popup bar (right click, file, even exit program wont work | 缺陷 | 否 | 无 | 不适用 | Godot 弹出菜单 |
| [664](https://github.com/RodZill4/material-maker/issues/664) | Slope Blur Update | 增强 | 否 | 低 | 不做 | 节点功能请求 |
| [663](https://github.com/RodZill4/material-maker/issues/663) | String Concatenation | 增强 | 否 | 无 | 不做 | 字符串拼接参数，与着色器参数模型不符 |
| [662](https://github.com/RodZill4/material-maker/issues/662) | Normal Map node with 'buffer' disabled prevents images loading when opening ptex | 缺陷 | 否 | 无 | 不适用 | 原版加载顺序 |
| [654](https://github.com/RodZill4/material-maker/issues/654) | DXT5 RGBA8 export | 增强 | 否 | 低 | 不做 | DXT5 压缩交给引擎导入时做 |
| [652](https://github.com/RodZill4/material-maker/issues/652) | Add ability to embed resources into .ptex files | 增强 | 否 | 无 | 增强已实现 | 图片可以嵌入工程 |
| [647](https://github.com/RodZill4/material-maker/issues/647) | Feature to import gifs or modify sequences of images at once. | 增强 | 否 | 低 | 不做 | GIF/序列图导入，偏离目标 |
| [646](https://github.com/RodZill4/material-maker/issues/646) | Allow dimensions on items such as filters be customized | 增强 | 否 | 低 | 不做 | 节点尺寸自定义 |
| [645](https://github.com/RodZill4/material-maker/issues/645) | Exporting RGBA preview image clips color components | 缺陷 | 是 | 中 | 暂缓 | 导出带 alpha 的图经 canvas 预乘，低 alpha 处颜色精度损失；要换成自己的 PNG 编码器，和 #1309 一起做 |
| [644](https://github.com/RodZill4/material-maker/issues/644) | Save brushes and materials used within Paint Projects file | 增强 | 否 | 低 | 暂缓 | 绘制工程保存笔刷，绘制不是重点 |
| [639](https://github.com/RodZill4/material-maker/issues/639) | Preview3D Rotation like S.Designer | 增强 | 否 | 低 | 不做 | 3D 预览操作习惯 |
| [638](https://github.com/RodZill4/material-maker/issues/638) | [Feature] Painting: non-PBR workflows | 增强 | 否 | 无 | 不做 | 非 PBR 绘制工作流，偏离目标 |
| [632](https://github.com/RodZill4/material-maker/issues/632) | "Fill to Random Color" produces an adjacent pair of the same color | 缺陷 | 否 | 无 | 不做 | 随机颜色相邻相同是随机性的固有结果 |
| [630](https://github.com/RodZill4/material-maker/issues/630) | Save Preview3D configuration | 增强 | 否 | 低 | 暂缓 | 保存 3D 预览设置，可和 #233 一起做 |
| [628](https://github.com/RodZill4/material-maker/issues/628) | Some shader errors not reported, material just stops updating | 缺陷 | 否 | 无 | 不适用 | 我们直接编译检查并报告错误 |
| [626](https://github.com/RodZill4/material-maker/issues/626) | Support Bevy | 增强 | 否 | 低 | 不做 | Bevy 导出，受众小；glTF 可用 |
| [625](https://github.com/RodZill4/material-maker/issues/625) | World and camera face direction (surface/vertex normal nodes). | 增强 | 否 | 低 | 不做 | 同 #954 |
| [623](https://github.com/RodZill4/material-maker/issues/623) | The 'Skewed Uneven Bricks' texture does not tile | 缺陷 | 是 | 中 | 暂缓 | 已复现：接缝比 10（正常为 0）；节点数据问题，见下文 |
| [622](https://github.com/RodZill4/material-maker/issues/622) | Brick textures do not color match beyond edges when using the warp transform | 缺陷 | 否 | 低 | 不做 | 扭曲后颜色不匹配是扭曲的固有结果 |
| [621](https://github.com/RodZill4/material-maker/issues/621) | Automatic export when outputs change | 增强 | 否 | 无 | 增强已实现 | 自动导出节点已有 |
| [619](https://github.com/RodZill4/material-maker/issues/619) | Preview material in open menu | 增强 | 否 | 低 | 不做 | 打开菜单里预览材质 |
| [617](https://github.com/RodZill4/material-maker/issues/617) | Steam Release | 增强 | 否 | 无 | 不适用 | Steam |
| [615](https://github.com/RodZill4/material-maker/issues/615) | Unreal 5 Export : No module named 'mm' | 缺陷 | 是 | 高 | 已修复 | UE5 导出脚本 `import mm`，压缩包里没有 mm.py |
| [610](https://github.com/RodZill4/material-maker/issues/610) | Crashes during splash screen loading | 缺陷 | 否 | 无 | 不适用 | 启动画面 |
| [589](https://github.com/RodZill4/material-maker/issues/589) | Fontsize / 2 = crash | 缺陷 | 否 | 无 | 不适用 | Godot 字体 |
| [587](https://github.com/RodZill4/material-maker/issues/587) | May add some texture sample filter type control in texture or buffer? | 增强 | 否 | 无 | 增强已实现 | 采样过滤选项已有 |
| [586](https://github.com/RodZill4/material-maker/issues/586) | Material Maker crashes on startup after splash screen on Windows | 缺陷 | 否 | 无 | 不适用 | 启动崩溃 |
| [585](https://github.com/RodZill4/material-maker/issues/585) | [ Feature ] Painting: create mask from image | 增强 | 否 | 低 | 增强建议 | 绘制：从图片生成遮罩 |
| [584](https://github.com/RodZill4/material-maker/issues/584) | [ Feature ] Add drag and drop image support | 增强 | 否 | 无 | 增强已实现 | 拖放图片已有 |
| [583](https://github.com/RodZill4/material-maker/issues/583) | [ Feature ] Painting:  Add plane/cube/sphere model | 增强 | 否 | 无 | 增强已实现 | 绘制用平面/立方体/球体已有 |
| [580](https://github.com/RodZill4/material-maker/issues/580) | Minor UX design error: taskbar title and description still labelled as "Godot Engine" | 缺陷 | 否 | 无 | 不适用 | Godot 任务栏标题 |
| [563](https://github.com/RodZill4/material-maker/issues/563) | All Named Parameters on a Remote Node Disappear when Deleting a Node that is Linked To | 缺陷 | 不明 | 低 | 暂缓 | Remote 节点联动删除，需求小众 |
| [562](https://github.com/RodZill4/material-maker/issues/562) | Remote Named Parameters Naming Collisions | 缺陷 | 是 | 高 | 已修复 | 参数表达式引用自己时代码生成死循环（界面卡死）；改为报错。重名遮蔽（问题 2、3）低价值，暂缓 |
| [561](https://github.com/RodZill4/material-maker/issues/561) | Expressions Dont Work on Group Nodes | 缺陷 | 不明 | 低 | 暂缓 | 组节点上的表达式，未复现 |
| [543](https://github.com/RodZill4/material-maker/issues/543) | "Transform" node doesn't show it's library in the "Add Node Popup" | 缺陷 | 不明 | 低 | 暂缓 | 添加节点弹窗里的分类显示 |
| [537](https://github.com/RodZill4/material-maker/issues/537) | Blender export documentation missing | 其他 | 否 | 无 | 不适用 | 原版文档 |
| [536](https://github.com/RodZill4/material-maker/issues/536) | Mask node | 增强 | 否 | 低 | 不做 | 已有 Blend/Math 可做遮罩 |
| [529](https://github.com/RodZill4/material-maker/issues/529) | Better node collapsing. | 增强 | 否 | 低 | 不做 | 节点折叠方式 |
| [528](https://github.com/RodZill4/material-maker/issues/528) | Dodge in blend node has some weird issues. | 缺陷 | 是 | 中 | 已修复 | Dodge 在输入大于 1 时除以负数；已改为大于等于 1 时取 1（3.5） |
| [526](https://github.com/RodZill4/material-maker/issues/526) | Curvature from normal map or "normal to height node" | 增强 | 否 | 低 | 不做 | 节点功能请求 |
| [525](https://github.com/RodZill4/material-maker/issues/525) | Show and use grid as seperate buttons. | 增强 | 否 | 低 | 不做 | 网格显示按钮 |
| [524](https://github.com/RodZill4/material-maker/issues/524) | Right and Left click panning option in preferences please. | 增强 | 否 | 低 | 不做 | 平移按键偏好 |
| [523](https://github.com/RodZill4/material-maker/issues/523) | Exporting to unreal stops 3d preview from updating when changing nodes values. | 缺陷 | 否 | 无 | 不适用 | 原版导出与预览 |
| [520](https://github.com/RodZill4/material-maker/issues/520) | Lags | 缺陷 | 否 | 无 | 不适用 | 原版性能 |
| [519](https://github.com/RodZill4/material-maker/issues/519) | Settings | 增强 | 否 | 无 | 不适用 | 原版设置 |
| [515](https://github.com/RodZill4/material-maker/issues/515) | Crash when switching between stock themes | 缺陷 | 否 | 无 | 不适用 | Godot 主题 |
| [513](https://github.com/RodZill4/material-maker/issues/513) | Exporting to blender issue | 缺陷 | 否 | 无 | 不适用 | 原版导出竞态 |
| [509](https://github.com/RodZill4/material-maker/issues/509) | Allow HDRi to be loaded from local disk | 增强 | 否 | 无 | 增强已实现 | 本地 HDRI 已支持 |
| [507](https://github.com/RodZill4/material-maker/issues/507) | Depth map exported as black under specific conditions | 缺陷 | 否 | 无 | 不适用 | 原版导出竞态 |
| [502](https://github.com/RodZill4/material-maker/issues/502) | Demo Scenes Missing Files | 缺陷 | 否 | 无 | 不适用 | 原版示例文件 |
| [501](https://github.com/RodZill4/material-maker/issues/501) | Warp Node Issue | 其他 | 不明 | 低 | 暂缓 | 描述不足 |
| [499](https://github.com/RodZill4/material-maker/issues/499) | Export for Minecraft RTX | 增强 | 否 | 低 | 不做 | Minecraft RTX，受众小 |
| [496](https://github.com/RodZill4/material-maker/issues/496) | Small issues with light theme | 缺陷 | 否 | 无 | 不适用 | 原版主题 |
| [494](https://github.com/RodZill4/material-maker/issues/494) | BabylonJS Export Support | 增强 | 否 | 无 | 增强已实现 | glTF 可直接给 Babylon.js |
| [492](https://github.com/RodZill4/material-maker/issues/492) | EasySDF editor deletes current shape when hitting the Delete key while editing a text field | 缺陷 | 是 | 中 | 已修复 | 在 SDF 树里改名时按 Delete/Backspace 会删掉元素 |
| [486](https://github.com/RodZill4/material-maker/issues/486) | Load Material From Website dialog cannot load some thumbnails | 缺陷 | 否 | 无 | 不适用 | 网站 |
| [485](https://github.com/RodZill4/material-maker/issues/485) | Freeze when using 3D preview (the small one) on Wayland + amdgpu | 缺陷 | 否 | 无 | 不适用 | Wayland |
| [479](https://github.com/RodZill4/material-maker/issues/479) | Add .glTF format as an export option | 增强 | 否 | 无 | 增强已实现 | glTF/.glb 导出已有 |
| [476](https://github.com/RodZill4/material-maker/issues/476) | Uniform parameter node | 增强 | 否 | 低 | 不做 | 统一参数节点，已有命名参数 |
| [466](https://github.com/RodZill4/material-maker/issues/466) | Document $time | 增强 | 否 | 低 | 暂缓 | $time 的文档，交给用户手册 |
| [463](https://github.com/RodZill4/material-maker/issues/463) | Custom shader feature needs better docs | 增强 | 否 | 低 | 暂缓 | 自定义着色器文档，交给用户手册 |
| [460](https://github.com/RodZill4/material-maker/issues/460) | Naming Consistency Tracker | 缺陷 | 否 | 无 | 不适用 | 原版命名跟踪 |
| [456](https://github.com/RodZill4/material-maker/issues/456) | Library panel gets pulled in front when loading the UI | 缺陷 | 否 | 无 | 不适用 | 原版面板 |
| [454](https://github.com/RodZill4/material-maker/issues/454) | Refactor and document source code, get rid of technical debt | 增强 | 否 | 无 | 不适用 | 原版代码 |
| [453](https://github.com/RodZill4/material-maker/issues/453) | Polygon Can Extend Past Window/Node Bounds | 缺陷 | 不明 | 低 | 暂缓 | 多边形控件越界 |
| [447](https://github.com/RodZill4/material-maker/issues/447) | Material Maker hard crashes every time I open specific .ptex file. | 缺陷 | 否 | 无 | 不适用 | 原版崩溃 |
| [426](https://github.com/RodZill4/material-maker/issues/426) | RIght clicking after opening crashes the editor | 缺陷 | 否 | 无 | 不适用 | 原版崩溃 |
| [425](https://github.com/RodZill4/material-maker/issues/425) | Doesn't run on OSX Monterey | 缺陷 | 否 | 无 | 不适用 | macOS 版本 |
| [421](https://github.com/RodZill4/material-maker/issues/421) | Making textures that work on a sphere | 增强 | 否 | 低 | 不做 | 球面贴图，偏离平铺贴图目标 |
| [395](https://github.com/RodZill4/material-maker/issues/395) | Enabling standard Godot 3d viewport navigation | 增强 | 否 | 无 | 不适用 | Godot 视口导航 |
| [361](https://github.com/RodZill4/material-maker/issues/361) | 16-bit textures are loaded as 8-bit | 缺陷 | 是 | 中 | 增强建议 | 16 位图片按 8 位读：浏览器解码限制，同 #931 |
| [359](https://github.com/RodZill4/material-maker/issues/359) | No close "x" on inactive open material tabs, but you can still close by clicking in the area | 缺陷 | 否 | 无 | 不适用 | 原版标签页 |
| [357](https://github.com/RodZill4/material-maker/issues/357) | OBM node and object maps referencing | 增强 | 否 | 低 | 不做 | 对象贴图引用 |
| [356](https://github.com/RodZill4/material-maker/issues/356) | New loading screen animation causes the editor to freeze | 缺陷 | 否 | 无 | 不适用 | 启动动画 |
| [343](https://github.com/RodZill4/material-maker/issues/343) | Tangent Space Normals | 增强 | 否 | 无 | 不适用 | 法线已是切线空间 |
| [339](https://github.com/RodZill4/material-maker/issues/339) | Save Preview 2D and 3D configuration? | 增强 | 否 | 低 | 暂缓 | 同 #630 |
| [336](https://github.com/RodZill4/material-maker/issues/336) | 3D viewport tumbles very fast when using a wacom tablet | 缺陷 | 否 | 无 | 不适用 | 数位板 |
| [330](https://github.com/RodZill4/material-maker/issues/330) | The text cursor will never appear when clicking on a value box using a tablet | 缺陷 | 否 | 无 | 不适用 | 数位板 |
| [305](https://github.com/RodZill4/material-maker/issues/305) | Baking AO map takes in account directional light probably | 缺陷 | 否 | 低 | 暂缓 | AO 烘焙与光照，我们的烘焙不受场景光影响 |
| [296](https://github.com/RodZill4/material-maker/issues/296) | "Update Thumbnail" crashes | 缺陷 | 否 | 无 | 不适用 | 原版崩溃 |
| [289](https://github.com/RodZill4/material-maker/issues/289) | Optional input to Voronoi allowing tight control | 增强 | 否 | 低 | 不做 | 节点功能请求 |
| [280](https://github.com/RodZill4/material-maker/issues/280) | Tonality node with no input generates a very buggy output on Intel integrated graphics | 缺陷 | 否 | 无 | 不适用 | Intel 核显 |
| [275](https://github.com/RodZill4/material-maker/issues/275) | Mouse skips on screen after rotating the 3D preview when UI Scale is set to 1.25. | 缺陷 | 否 | 无 | 不适用 | Godot 缩放 |
| [263](https://github.com/RodZill4/material-maker/issues/263) | Way to quickly reset entry fields to default (Right click?). | 增强 | 否 | 中 | 本次实现 | 浮点参数右键恢复默认值 |
| [247](https://github.com/RodZill4/material-maker/issues/247) | After crashing, material maker doesn't properly show hierarchy view | 缺陷 | 否 | 无 | 不适用 | 原版崩溃恢复 |
| [241](https://github.com/RodZill4/material-maker/issues/241) | Add Syntax/Error Highlighting in the Node Editor | 增强 | 否 | 无 | 增强已实现 | 代码编辑器语法高亮已有 |
| [240](https://github.com/RodZill4/material-maker/issues/240) | Proposal - Add a Gabor Noise Texture Node. | 增强 | 否 | 低 | 不做 | Gabor 噪声，已有多种噪声 |
| [233](https://github.com/RodZill4/material-maker/issues/233) | [Proposal] Save preview settings in project file | 增强 | 否 | 低 | 暂缓 | 预览设置存进工程 |
| [231](https://github.com/RodZill4/material-maker/issues/231) | Proposal - (UI/UX) Highlight connections for selected node | 增强 | 否 | 中 | 增强建议 | 高亮所选节点的连线：要改节点图视图（不在本次可改范围） |
| [227](https://github.com/RodZill4/material-maker/issues/227) | Proposal - add another control point to the curve node | 增强 | 否 | 低 | 不做 | 曲线控件已可加点 |
| [224](https://github.com/RodZill4/material-maker/issues/224) | Remove tiler node input bleeding with overlap setting higher than 0 | 增强 | 否 | 低 | 不做 | Tiler 溢出是重叠设置的固有行为 |
| [204](https://github.com/RodZill4/material-maker/issues/204) | When filling up parameter with decimal number, automatically convert "," to "." | 增强 | 否 | 中 | 本次实现 | 数字框输入 `0,5` 自动读成 0.5 |
| [198](https://github.com/RodZill4/material-maker/issues/198) | Material Depth output causes a segfaults at intermediate invalid user input | 其他 | 否 | 无 | 不适用 | 原版段错误 |
| [191](https://github.com/RodZill4/material-maker/issues/191) | How to affect specular power? | 增强 | 否 | 无 | 不适用 | 提问 |
| [184](https://github.com/RodZill4/material-maker/issues/184) | MM_loader isn't declared in current scope | 其他 | 否 | 无 | 不适用 | 原版代码 |
| [182](https://github.com/RodZill4/material-maker/issues/182) | Better Navigation Shortcuts | 增强 | 否 | 低 | 不做 | 导航快捷键 |
| [178](https://github.com/RodZill4/material-maker/issues/178) | [Proposal] Transform a parameter into a input | 增强 | 否 | 低 | 不做 | 参数转输入 |
| [175](https://github.com/RodZill4/material-maker/issues/175) | Show nodes descriptions in node list | 增强 | 否 | 中 | 本次实现 | 节点库悬停提示加上节点说明 |
| [167](https://github.com/RodZill4/material-maker/issues/167) | Make the hierarchy more relevant and easier to navigate | 增强 | 否 | 低 | 不做 | 层级面板改进 |
| [161](https://github.com/RodZill4/material-maker/issues/161) | Quick Save/Export Shortcut | 增强 | 否 | 中 | 本次实现 | Ctrl+S（⌘S）保存工程 |
| [156](https://github.com/RodZill4/material-maker/issues/156) | [Proposal] Automatically chain nodes placed on top of existing connection | 增强 | 否 | 中 | 增强建议 | 拖到连线上自动接入：要改节点图视图 |
| [155](https://github.com/RodZill4/material-maker/issues/155) | [Proposal] Automatically swap inputs when possible | 增强 | 否 | 低 | 不做 | 自动交换输入 |
| [148](https://github.com/RodZill4/material-maker/issues/148) | Add support for input image interpolation modes | 增强 | 否 | 无 | 增强已实现 | 图片插值模式已有 |
| [142](https://github.com/RodZill4/material-maker/issues/142) | Using the hold-drag gestures to use value boxes as sliders fails on drawing tablets under certain conditions | 缺陷 | 否 | 无 | 不适用 | 数位板 |
| [139](https://github.com/RodZill4/material-maker/issues/139) | Can't enable plugin when downloaded from AssetLib | 缺陷 | 否 | 无 | 不适用 | Godot AssetLib |
| [133](https://github.com/RodZill4/material-maker/issues/133) | A lot of leaked nodes | 其他 | 否 | 无 | 不适用 | 原版节点泄漏 |
| [97](https://github.com/RodZill4/material-maker/issues/97) | [Proposal] Add function to lock the rotation axis in 3D view | 其他 | 否 | 低 | 不做 | 锁定 3D 旋转轴 |
| [95](https://github.com/RodZill4/material-maker/issues/95) | [Proposal] Add function to save multiple editor layouts | 其他 | 否 | 无 | 增强已实现 | 布局预设已有 |
| [87](https://github.com/RodZill4/material-maker/issues/87) | Exported textures are mixed up | 其他 | 否 | 无 | 不适用 | 原版导出竞态 |
| [82](https://github.com/RodZill4/material-maker/issues/82) | Font size too small in 4K resolution screen | 其他 | 否 | 无 | 增强已实现 | 界面缩放已有 |
| [31](https://github.com/RodZill4/material-maker/issues/31) | Format GDScript files to follow the GDScript style guide | 其他 | 否 | 无 | 不适用 | GDScript 格式 |
