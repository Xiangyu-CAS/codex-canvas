# Codex-Canvas 安装说明

仓库地址：https://github.com/Xiangyu-CAS/codex-canvas.git

## 让 Codex 自动安装

可以把下面这段作为安装任务发给 Codex：

```text
请根据 https://github.com/Xiangyu-CAS/codex-canvas.git 里的 INSTALL.md 安装 Codex-Canvas。
安装完成后，在当前 Codex 对话里使用 @Codex-Canvas 打开画布来启动
```

安装流程是：把仓库 clone 到本机一个长期保留的目录，运行 personal marketplace 安装器，然后用 Codex CLI 安装这个 personal plugin。

## 手动安装

下面使用 `~/src/codex-canvas` 作为示例路径；它不是固定要求，可以换成任意你会长期保留的目录。

```bash
mkdir -p ~/src
git clone https://github.com/Xiangyu-CAS/codex-canvas.git ~/src/codex-canvas
cd ~/src/codex-canvas
npm install
npm run install:personal
```

`npm run install:personal` 会创建或更新 `~/plugins/codex-canvas`，并把插件条目写进 `~/.agents/plugins/marketplace.json`。它还会 best-effort 尝试安装 `rapidocr_onnxruntime`，用于 `Edit Text` 本地 OCR；这一步通常需要几十秒到几分钟，取决于 Python、pip、网络和 wheel 缓存。如果安装失败，personal plugin 仍会安装完成，`Edit Text` 会回退到 Codex 视觉识别。

若要跳过 RapidOCR 安装：

```bash
CODEX_CANVAS_SKIP_OCR_INSTALL=1 npm run install:personal
```

或者：

```bash
npm run install:personal -- --skip-ocr
```

## 注册 personal marketplace

Codex 侧需要把用户 home 目录作为 `personal` marketplace root。先检查当前 Codex CLI 已注册的 marketplace：

```bash
codex plugin marketplace list --json
```

如果还没有 root 指向用户 home 目录的 `personal` marketplace，注册一次：

```bash
codex plugin marketplace add ~
```

然后从 personal marketplace 安装 Codex-Canvas：

```bash
codex plugin add codex-canvas@personal
```

安装后在当前 Codex 对话里使用 `@Codex-Canvas` 打开画布来启动，不要新开对话。也可以尝试输入 `/canvas`；如果当前 Codex 版本没有把插件 skill 暴露成 slash command，可以使用 `$canvas` 或直接说“打开 Codex-Canvas 画布”。

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
