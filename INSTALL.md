# Codex-Canvas 安装说明

仓库地址：https://github.com/Xiangyu-CAS/codex-canvas.git

## 让 Codex 自动安装

可以把下面这段作为安装任务发给 Codex：

```text
请根据 https://github.com/Xiangyu-CAS/codex-canvas.git 里的 INSTALL.md 安装 Codex-Canvas。
安装完成后，新建一个 Codex 任务，再使用 @Codex-Canvas 打开画布
```

安装流程是：把仓库 clone 到本机一个长期保留的目录，切换到最新稳定 Release 对应的本地分支，运行 personal marketplace 安装器，然后用 Codex CLI 安装这个 personal plugin。不要直接从 `main` 安装。

## 手动安装

下面使用 `~/src/codex-canvas` 作为示例路径；它不是固定要求，可以换成任意你会长期保留的目录。

```bash
mkdir -p ~/src
git clone https://github.com/Xiangyu-CAS/codex-canvas.git ~/src/codex-canvas
cd ~/src/codex-canvas
npm run checkout:stable
npm ci
npm run install:personal
```

`npm run checkout:stable` 会从最新的稳定 `vX.Y.Z` tag 创建或更新本地 `codex-canvas-stable` 分支，并让它跟踪 `origin/main` 以便发现后续 tag。工作树最终必须精确停在 Release commit；因此即使 clone 时 `main` 已经包含未发布提交，也不会把它们安装给普通用户。

`npm run install:personal` 会创建或更新 `~/plugins/codex-canvas`，并把插件条目写进 `~/.agents/plugins/marketplace.json`。它还会 best-effort 尝试安装 `rapidocr_onnxruntime`，用于 `Edit Text` 本地 OCR；这一步通常需要几十秒到几分钟，取决于 Python、pip、网络和 wheel 缓存。如果安装失败，personal plugin 仍会安装完成，`Edit Text` 会回退到 Codex 视觉识别。

若要跳过 RapidOCR 安装：

```bash
CODEX_CANVAS_SKIP_OCR_INSTALL=1 npm run install:personal
```

或者：

```bash
npm run install:personal -- --skip-ocr
```

## 安装 personal plugin

默认的 personal marketplace 会从 `~/.agents/plugins/marketplace.json` 自动发现，不需要另外注册 marketplace。运行：

```bash
codex plugin add codex-canvas@personal
```

安装后新建一个 Codex 任务，再使用 `@Codex-Canvas` 打开画布，让新版 skills 和 MCP server 从新缓存加载。也可以尝试输入 `/canvas`；如果当前 Codex 版本没有把插件 skill 暴露成 slash command，可以使用 `$canvas` 或直接说“打开 Codex-Canvas 画布”。

## 更新

Codex-Canvas 的稳定更新以 `vX.Y.Z` Git tag 和已完成产物上传的 GitHub Release 为边界。Settings 会确认 Release 同时包含插件包、`release-manifest.json` 和 `SHA256SUMS`，并验证 manifest commit 与 tag 一致；`main` 上尚未发布的提交不会被当作更新。

- 打开画布时只检查是否有新 Release，不会静默修改本地代码。
- 在画布的 **Settings → Version** 点击更新，会把 personal marketplace 指向的源码安全 fast-forward 到最新稳定 tag，安装锁定依赖，然后重新执行 `codex plugin add codex-canvas@personal`，让 Codex 创建新的版本缓存。
- 更新完成后必须关闭旧画布，并新建一个 Codex 任务；仅刷新网页不能重载 MCP server 和 skills。
- 如果曾用不同端口手动启动多个 Canvas server，更新前先关闭其他实例；当前实例会在仍有图片、文字或聊天操作运行时拒绝更新。

也可以通过 CLI 检查或安装：

```bash
node ./bin/codex-canvas.mjs update --check
node ./bin/codex-canvas.mjs update
```

源码目录有未提交修改、本地提交、分支分叉，或 Release tag 与 manifest 版本不一致时，自动更新会停止并显示原因，不会覆盖本地工作。

所有 `0.1.1` 及更早的安装都需要做一次手动 bootstrap，因为旧 cache 里的更新器无法安全迁移自己。最稳妥的方式是保留旧目录，另外创建一个干净的长期 clone：

```bash
git clone https://github.com/Xiangyu-CAS/codex-canvas.git ~/src/codex-canvas-stable
cd ~/src/codex-canvas-stable
npm run checkout:stable
npm ci
npm run install:personal -- --skip-ocr
codex plugin add codex-canvas@personal
```

安装器会把 personal marketplace 的 symlink/junction 从旧 clone 切换到这个稳定 clone。关闭仍在运行的旧画布，然后新建 Codex 任务。确认新版正常后，旧 clone 才可以自行归档或删除。首个采用新机制的稳定版是 `v0.2.0`。

## 可选依赖

其他可选本地依赖可以按需安装；它们用于本地 OCR、Edit Elements 拆层和背景处理，不是打开画布的硬性前置条件：

```bash
npm run setup:deps
```

单独检查或安装 OCR：

```bash
npm run doctor:ocr
npm run setup:ocr
```

单独检查或安装 Edit Elements 本地图像处理依赖：

```bash
npm run doctor:image-deps
npm run setup:image-deps
```

## 安装器行为

`npm run install:personal` 写入的插件条目形如：

```json
{
  "name": "codex-canvas",
  "source": {
    "source": "local",
    "path": "./plugins/codex-canvas"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

安装器只会创建或更新指向当前仓库的 symlink/junction；如果 `~/plugins/codex-canvas` 已经是普通文件或目录，命令会拒绝覆盖并提示先移除该路径。

测试或临时安装可以设置：

```bash
CODEX_CANVAS_PERSONAL_HOME=/path/to/home npm run install:personal
```

这样会写入该目录下的 `plugins/codex-canvas` 和 `.agents/plugins/marketplace.json`，不影响真实用户目录。
