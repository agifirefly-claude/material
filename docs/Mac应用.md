# Material Pro 的 Mac 应用

Material Pro 用 Electron 封装成 macOS 应用。Electron 自带 Chromium，项目的所有测试也都在 Chromium 上跑，所以网页版能用的功能（WebGL2、浮点渲染目标、3D 预览、绘画模式、摄像头节点）在应用里表现一致。

应用与网页版是同一份代码：`npm run build` 生成的 `dist/` 原样打进应用。页面检测到桌面桥接 `window.materialPro` 时改用原生功能，否则保持浏览器行为。

## 与网页版的区别

| 功能 | 网页版 | Mac 应用 |
| --- | --- | --- |
| 保存项目 | 每次下载一个 .ptex | 第一次弹出保存对话框，之后 ⌘S 直接覆盖原文件；⌘⇧S 另存为 |
| 打开项目 | 浏览器文件选择 | 原生打开对话框，可选 .ptex / .json / .mmg / .mmpp / .zip |
| 导出（贴图、引擎包） | 下载 zip | 弹出保存对话框，写到你选的位置 |
| Auto Export 节点 | 仅支持 File System Access API 的浏览器 | 选一次文件，之后图变化自动写盘 |
| 打开文件 | — | 在 Finder 双击 .ptex / .mmpp、拖到 Dock 图标、File > Open Recent |
| 菜单 | 页面内菜单 | 另有系统菜单栏（File / Edit / View / Window / Help），带快捷键 |
| 窗口 | — | 记住窗口位置和大小；只运行一个实例，再次打开文件会交给已有窗口 |
| 标题栏 | — | 显示当前文件，有未保存修改时关闭按钮带圆点 |

绘画项目保存为一个 `.mmpp.zip`（含图层和模型；用内置模型时只记模型名）。第一次保存或“另存为”时弹出保存对话框，之后“保存”直接写回这个文件；从 Finder 或打开对话框打开的 `.mmpp.zip` 也直接写回原文件。用 Finder 打开 .mmpp 时，应用会一起读取它所在文件夹里的图层图片和模型文件，保存时另存为 `.mmpp.zip`。

## 构建

需要 Node.js 22 和 macOS（dmg 只能在 macOS 上生成）。

```bash
npm ci
```

```bash
npm run electron:build
```

产物在 `release/`：

- `Material-Pro-<版本>-arm64.dmg` / `-arm64.zip`：Apple 芯片
- `Material-Pro-<版本>-x64.dmg` / `-x64.zip`：Intel

只要一种架构或一种格式时，参数会传给 electron-builder：

```bash
npm run electron:build -- --arm64
```

```bash
npm run electron:build -- --mac zip
```

构建脚本先自己下载 Electron 的 zip（放在 `release/electron-dist/`，下次直接用），用 `node_modules/electron/checksums.json` 里的 SHA-256 校验后交给 electron-builder（`electronDist`）。这样 electron-builder 不再去 GitHub 取 `SHASUMS256.txt`：Electron v45.2.3 的这个文件在 GitHub 上一直返回 504，导致打包失败。下载先试 GitHub，失败再试镜像（默认 npmmirror，可用环境变量 `ELECTRON_MIRROR` 指定）；不论从哪里下载，校验不通过的文件都会被丢弃。

开发时直接运行（会先构建 `dist/`）：

```bash
npm run electron:dev
```

自检（打开窗口、检查 WebGL2 与 EXT_color_buffer_float、打开示例、渲染、通过 File > Save 保存再打开、原地保存）：

```bash
npm run build && npm run electron:smoke
```

检查打好的应用时把可执行文件路径传进去：

```bash
node electron/smoke.mjs "release/mac-arm64/Material Pro.app/Contents/MacOS/Material Pro"
```

在 Linux 上自检会自动用 xvfb-run 和 SwiftShader（软件 WebGL2）。

GitHub Actions（`.github/workflows/mac-app.yml`）在推送到 main、推送 `v*` 标签或手动触发时构建 dmg 和 zip，上传为 Actions 产物；推送标签时同时发布到 GitHub Release。

## 安装未签名的应用

默认构建不带 Apple 开发者证书（只做 ad hoc 签名），第一次打开时 Gatekeeper 会拦截。任选一种方式放行：

1. 打开 dmg，把 Material Pro 拖进“应用程序”。
2. 在“应用程序”里按住 Control 点 Material Pro，选“打开”，在弹窗里再点“打开”。
3. 如果提示“已损坏，无法打开”或没有“打开”按钮（macOS 15 起常见）：打开“系统设置 > 隐私与安全性”，在下方找到 Material Pro 被阻止的提示，点“仍要打开”。
4. 也可以在终端去掉隔离属性：

```bash
xattr -dr com.apple.quarantine "/Applications/Material Pro.app"
```

只需放行一次。

## 签名和公证

有 Apple Developer Program 账号时，可以签名并公证，用户双击即可打开。

签名（Developer ID Application 证书导出为 .p12）：

| 环境变量 | 内容 |
| --- | --- |
| `CSC_LINK` | .p12 文件路径，或其 base64 内容 |
| `CSC_KEY_PASSWORD` | .p12 的密码 |

本机钥匙串里已有证书时也可以用 `CSC_NAME="Developer ID Application: 名字 (TEAMID)"`。

公证（签名之后自动进行），二选一：

| 环境变量 | 内容 |
| --- | --- |
| `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` | Apple ID、App 专用密码、团队 ID |
| `APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` | App Store Connect API 密钥文件路径、密钥 ID、Issuer ID |

没有设置 `CSC_LINK` / `CSC_NAME` 时，`electron/build-mac.mjs` 自动改为 ad hoc 签名，不会去钥匙串里找证书。

在 GitHub Actions 中把以下内容存为仓库 Secrets，工作流会自动使用：`MAC_CERTIFICATE_P12_BASE64`（`base64 -i cert.p12` 的输出）、`MAC_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

应用启用了 Hardened Runtime，权限声明在 `build/entitlements.mac.plist`：JIT（V8 需要）、摄像头（Webcam 节点）、以及 ad hoc 构建所需的关闭库校验。

## 文件关联

应用注册为以下文件的默认编辑器：

| 扩展名 | 类型 |
| --- | --- |
| `.ptex` | 材质项目 |
| `.mmpp` | 绘画项目 |

安装后在 Finder 双击即可用 Material Pro 打开。如果仍由其他应用打开：选中文件，⌘I 打开“显示简介”，在“打开方式”里选 Material Pro，点“全部更改…”。

## 安全

- 页面运行在沙盒渲染进程中：开启 contextIsolation，关闭 nodeIntegration，页面拿不到 Node.js。
- 页面从 `app://material-pro/` 加载，响应带内容安全策略（只允许应用自身的脚本）。
- 页面只能通过 `electron/preload.cjs` 暴露的几个函数访问系统：打开/保存对话框，以及写入用户在对话框里选过（或从 Finder 打开）的文件。主进程拒绝写其他路径。
- 窗口不会被导航到其他网址；外部链接（如帮助文档）用系统浏览器打开。
- 只授予摄像头、剪贴板和全屏权限。

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `electron/main.cjs` | 主进程：窗口、`app://` 协议、对话框、菜单、文件关联、最近文件、单实例 |
| `electron/preload.cjs` | 页面可用的 `window.materialPro` |
| `electron/selftest.cjs`、`electron/smoke.mjs` | 自检 |
| `electron/build-mac.mjs` | 构建脚本（下载并校验 Electron，处理签名） |
| `electron-builder.yml` | 打包配置 |
| `build/icon.svg`、`build/icon.png` | 应用图标（`node build/render-icon.mjs` 由 SVG 生成 PNG，打包时转成 .icns） |
| `src/ui/platform.ts`、`src/ui/hostIntegration.ts` | 页面一侧：检测桥接、原地保存、菜单命令、Finder 打开的文件 |
