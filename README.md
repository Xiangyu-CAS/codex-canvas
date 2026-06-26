# Agent-Canvas
Agent-Canvas 是一款面向 Codex 的本地无限画布插件。用户可以在 Codex 中打开画布，将 `imagegen` skill 生成或编辑的图片自动收录到项目画布中，并在画布上继续进行图像整理、标注、局部编辑和版本迭代。

项目目标是把 Codex 的对话式图像生成能力扩展为更接近 `Lovart` 的画布式视觉工作流：图片不再只是散落在对话上下文里的附件，而是成为可以被选择、编辑、比较和复用的项目资产。


## 背景
- 1️⃣ Codex app 自带 `in-app browser`，天然适合形成左侧对话、右侧画布的工作形态。对于需要反复生成、比较和修改图片的用户来说，这种形态可以承载类似 `Lovart` 的画布式图像编辑体验。
- 2️⃣ Codex 自带 `imagegen` skill，并使用 `gpt-image-2` 进行图像生成和编辑。用户无需额外配置或购买 API，就可以在 Codex 内完成基础的图像生产流程，这为开源插件的传播和使用降低了门槛。
- 3️⃣ [Cowart](https://github.com/zhongerxin/Cowart) 已经验证了 Codex + 本地无限画布的方向：它基于 tldraw 提供项目本地画布、图片收录、AI image holder 和标注驱动改图等能力。但相比更完整的画布式图像编辑产品，仍有扩展空间，例如 `remove BG`、`Edit Elements`、`Edit Text`、`expand/crop` 等功能。
- 4️⃣ Agent-Canvas 已有早期实现基础，核心画布能力已经过验证。此前受限于开源时机和 Codex 图像生成能力尚未完善，用户需要自行配置 API，使用成本较高；现在 Codex 内置 `imagegen` 后，重新启动项目的条件更成熟。
- 5️⃣ 综上所述，Agent-Canvas 可以作为独立项目推进，同时也可以将可复用的能力和经验贡献给 Cowart 生态。

## 架构
Agent-Canvas 可以按四个模块设计：

- **Codex 交互层**：提供 `/canvas` 入口、`imagegen` 工作流封装和画布操作指令，让用户通过 Codex 打开画布、生成图片、编辑选中对象。
- **本地画布层**：启动本地 Web 服务，并在 Codex `in-app browser` 中渲染无限画布。画布负责图片展示、选择、拖拽、标注、裁剪、扩图区域选择等交互。
- **工具通信层**：通过 MCP 工具连接 Codex 和画布，提供读取当前选区、插入图片、导出标注图、更新画布对象等能力。
- **项目数据层**：将画布 JSON、生成图片、编辑中间产物和导出结果保存到当前项目目录，保证视觉资产跟随项目一起管理。

核心流程：

1. 用户在 Codex 中打开 Agent-Canvas，本地服务启动并在 `in-app browser` 中显示画布。
2. 用户在画布中创建或选择图片对象，并通过 Codex 发起生成、改图或编辑请求。
3. Codex 调用 `imagegen` 生成结果，再通过 MCP 工具把图片写回画布。
4. 画布状态和图片资产保存到项目目录，后续可以继续编辑、比较和复用。

## 当前原型

当前版本先实现最小可用闭环：

- `agent-canvas open`：后台启动本地画布服务，并输出画布 URL。
- `agent-canvas start`：前台启动本地画布服务，并默认开启项目图片自动收集。
- `agent-canvas import <image-path>`：将本地图片复制到当前项目的 `canvas/assets/`，并插入画布。
- `agent-canvas collect`：扫描项目内最近生成的图片并导入画布，作为 `imagegen` 输出路径不明确时的兜底收集器。
- MCP 工具：提供 `open_canvas`、`add_image`、`collect_recent_images`、`canvas_status`，方便 Codex 在会话中打开画布和收录图片。
- 画布 UI：提供 Lovart 风格的浅色无限画布、右侧聊天面板、底部浮动工具栏、图片选择态和浮动编辑工具栏。

基础运行：

```bash
node ./bin/agent-canvas.mjs open --project .
```

安装本地 OCR：

```bash
npm install
```

`npm install` 会在 `postinstall` 中自动尝试安装 `rapidocr_onnxruntime`，用于 `Edit Text` 的本地快速文字识别。安装失败不会阻塞 Agent-Canvas；此时会回退到 Codex 视觉识别。也可以手动运行：

```bash
npm run setup:ocr
npm run doctor:ocr
```

如果需要跳过 OCR 安装，可以设置：

```bash
AGENT_CANVAS_SKIP_OCR_INSTALL=1 npm install
```

导入图片：

```bash
node ./bin/agent-canvas.mjs import ./example.png --project .
```

兜底收集最近图片：

```bash
node ./bin/agent-canvas.mjs collect --project . --since-minutes 30 --limit 5
```

## Codex 插件安装

本地开发时可以把当前仓库暴露给 Codex personal marketplace：

```bash
mkdir -p ~/plugins ~/.agents/plugins
ln -sfn /Users/zhuxiangyu/workspace/agent-canvas ~/plugins/agent-canvas
```

`~/.agents/plugins/marketplace.json` 中需要包含：

```json
{
  "name": "agent-canvas",
  "source": {
    "source": "local",
    "path": "./plugins/agent-canvas"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

安装后新建 Codex 会话，尝试输入 `/canvas`。当前本机已验证 `/canvas` 可以触发 `agent-canvas:canvas` skill，并在 Codex `in-app browser` 中打开 `http://127.0.0.1:43217/`。如果某些 Codex 版本没有把插件 skill 暴露为 slash command，可以使用 `$canvas` 或直接说“打开 Agent-Canvas 画布”。

## 数据目录

运行后会在当前项目生成：

```text
canvas/
  agent-canvas.json
  assets/
```

`agent-canvas.json` 保存画布对象和选区状态，`assets/` 保存导入的图片文件。

服务启动后会自动扫描项目内新产生的图片文件，并导入画布。自动扫描会忽略 `canvas/`、`node_modules/`、`.git/` 等目录；如果不希望自动收集，可以使用 `--no-auto-collect`。
