# NOTICE

Material Pro 是独立维护的项目。下面说明其中哪些内容来自其它项目，以及它们的许可证。

## 节点库、示例与引擎设计：Material Maker

`library/` 下的节点定义、示例材质、节点菜单与别名、笔刷、着色器公共函数、导出模板、端口预览函数、预览环境列表、法文和中文翻译目录，以及 `src/engine` 的着色器生成规则，最初来自 [Material Maker](https://github.com/RodZill4/material-maker)（作者 Rodolphe Suescun 及贡献者，MIT 许可证，原文见 [`library/LICENSE-material-maker.md`](library/LICENSE-material-maker.md)）。

导入时的版本是 Material Maker 的提交 `7d6daae3c74c09720afe4138ce09699ab3591ce1`（2026-10-24）。

导入之后，这些内容就是本项目自己的源码，在 `library/` 里维护、修改和扩充，不再与 Material Maker 同步。Material Maker 的后续更新只作为参考：如果想借鉴，用 `scripts/compare-reference.mjs` 列出差异，人工判断后再改 `library/`（见 [docs/节点库维护.md](docs/节点库维护.md)）。

导入后本项目做的修改：

- `library/nodes/bricks_nontileable.json`：改为调用 `bricks` 节点里已改名的 `oldbricks_*`、`oldbrick*` 函数。原版这个节点无法编译。

## 预览模型和环境贴图

- `public/meshes/pillow.obj`、`suzanne.obj`、`vase.obj`：来自 Material Maker 的 `material_maker/meshes/`，MIT 许可证。文件头显示由 Blender 2.82 导出；`suzanne.obj` 是 Blender 的 Suzanne 猴头基本体，Blender 基金会允许任何人使用。
- `public/hdri/photo_studio_01_1k.hdr`、`epping_forest_01_1k.hdr`、`moonless_golf_1k.hdr`：Poly Haven（原 HDRI Haven）的图片，CC0 许可证，经由 Material Maker 的 `material_maker/environments/hdris/` 取得。

## 其它

- Godot 引擎的色调映射算法（AgX、Reinhard、Filmic、ACES，见 `src/ui/preview3d/postprocess.ts`）按 Godot（MIT 许可证）的源码移植。
- Cocos Creator 导出参照了 cocos-engine 仓库 v3.8.6 的文件格式：只使用了内置标准着色器的 UUID 常量和材质、`.meta` 文件的结构，没有复制它的代码。
