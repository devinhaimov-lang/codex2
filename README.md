# Codex Lite

Codex Lite 是一个本地桌面工具，用于管理 Codex / Kiro 账号、查看状态、切换账号，并提供一个内置的本地聊天页面。

当前仓库是 `devinhaimov-lang/codex2` 的 Codex Lite 版本，不是原始 Cockpit Tools 项目说明。

## 功能

- Codex 账号管理
- Kiro 账号管理
- Codex / Kiro 账号切换
- 配额和账号状态查看
- 内置聊天页面
- 聊天记录保存、导入、导出
- 图片保存
- 安装工具页面
- 多语言切换
- Windows / Linux / macOS 桌面应用构建

## 内置聊天服务

聊天页使用本地服务：

```text
http://127.0.0.1:3510/
```

之前这个服务需要额外运行 `/home/kang/codex-lite/server.mjs`。

现在已经集成到 Tauri/Rust 主程序里，应用启动后会自动提供：

- `GET /`
- `GET /api/config`
- `GET /api/models?provider=codex`
- `GET /api/models?provider=kiro`
- `POST /api/chat`

Windows exe 启动时不需要再单独启动 Node 聊天服务。

## 本地开发

安装依赖：

```bash
npm ci
```

启动前端开发服务：

```bash
npm run dev
```

启动 Tauri 开发模式：

```bash
npm run tauri -- dev
```

类型检查：

```bash
npm run typecheck
```

前端构建：

```bash
npm run build
```

Rust 检查：

```bash
cd src-tauri
cargo check
```

Rust 构建：

```bash
cd src-tauri
cargo build
```

## Windows EXE 编译

推荐使用 GitHub Actions 编译 Windows 版本。

操作步骤：

1. 打开 GitHub 仓库的 Actions 页面。
2. 选择 workflow：`Windows EXE`。
3. 点击 `Run workflow`。
4. Branch 选择需要编译的分支，例如：

```text
feature/integrated-chat-windows-build
```

5. 等待构建完成。
6. 下载 artifact：`Codex-Lite-Windows`。

构建产物通常包括：

- NSIS 安装包 `.exe`
- MSI 安装包 `.msi`
- Release 可执行文件 `.exe`

## GitHub Actions

当前仓库包含 Windows 手动构建 workflow：

```text
.github/workflows/windows-exe.yml
```

该 workflow 会在 `windows-latest` 上执行：

```bash
npx tauri build --ci
```

并上传 Windows 构建产物和构建日志。

## 目录说明

```text
src/                              前端 React 代码
src/LiteApp.tsx                   Lite 版本主界面
src/pages/CodexAccountsPage.tsx   Codex 账号页面
src/pages/KiroAccountsPage.tsx    Kiro 账号页面
src/pages/InstallToolsPage.tsx    安装工具页面
src-tauri/                        Tauri / Rust 后端
src-tauri/src/modules/            Rust 功能模块
src-tauri/src/modules/codex_lite_chat.rs
                                  内置聊天服务
src-tauri/resources/codex-lite-chat/
                                  内置聊天页面静态资源
```

## 当前分支说明

`feature/integrated-chat-windows-build` 分支包含：

- 内置 Codex Lite Chat 服务
- Kiro 本地 API 支持
- 聊天页面静态资源打包
- Windows GitHub Actions 构建流程修正
- 命令面板、快捷键弹窗、安装工具页面等 Lite 功能补充

## 注意

- 本项目会在本机启动多个本地服务端口，例如 `3510`、`3520`、`34108`。
- 账号和聊天数据主要保存在本机。
- 不要把包含 token、聊天导出、构建 artifact 的临时文件提交到仓库。
