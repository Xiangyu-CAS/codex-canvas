# Agent-Canvas
Agent-Canvas 是一款面向 Codex 的本地无限画布插件。用户可以在 Codex 中打开画布，将 `imagegen` skill 生成或编辑的图片自动收录到项目画布中，并在画布上继续进行图像整理、标注、局部编辑和版本迭代。

项目目标是把 Codex 的对话式图像生成能力扩展为更接近 `Lovart` 的画布式视觉工作流：图片不再只是散落在对话上下文里的附件，而是成为可以被选择、编辑、比较和复用的项目资产。


## 背景
- 1️⃣ Codex app 自带 `in-app browser`，天然适合形成左侧对话、右侧画布的工作形态。对于需要反复生成、比较和修改图片的用户来说，这种形态可以承载类似 `Lovart` 的画布式图像编辑体验。
- 2️⃣ Codex 自带 `imagegen` skill，并使用 `gpt-image-2` 进行图像生成和编辑。用户无需额外配置或购买 API，就可以在 Codex 内完成基础的图像生产流程，这为开源插件的传播和使用降低了门槛。
- 3️⃣ [Cowart](https://github.com/zhongerxin/Cowart) 已经验证了 Codex + 本地无限画布的方向：它基于 tldraw 提供项目本地画布、图片收录、AI image holder 和标注驱动改图等能力。相比更完整的画布式图像编辑产品，Agent-Canvas 仍可继续扩展更高级的多对象编排、版式和设计协作能力。
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

- `agent-canvas open`：后台启动或复用本地画布服务，并输出当前项目画布 URL。
- `agent-canvas start`：前台启动本地画布服务，并默认开启项目图片自动收集。
- `agent-canvas import <image-path>`：将本地图片复制到当前项目的 `canvas/assets/`，并插入画布。
- `agent-canvas collect`：扫描项目内和 `~/.codex/generated_images` 中最近生成的图片并导入画布，作为 `imagegen` 输出路径不明确时的兜底收集器。
- `agent-canvas search`：按名称、prompt、文本、来源路径和图层组元数据搜索画布对象，用于快速定位项目资产。
- `agent-canvas prompts`：列出最近使用过的唯一 prompt，支持按文本过滤，用于复用项目提示词。
- `agent-canvas versions` 和画布内 discovery 面板：按 `sourceObjectId`、`batchId`、`layoutMode` 或 `prompt` 分组查看画布对象版本历史，在面板中预览缩略图，并可在画布中框选同组版本做并排比较或绘制临时像素差异热力图。
- MCP 工具：提供 `open_canvas`、`add_image`、`collect_recent_images`、`canvas_status`、`search_canvas`、`prompt_history`、`version_groups`、`start_image_job`、`send_to_chat`，方便 Codex 在会话中打开画布、收录图片、搜索资产、提示词和版本分组、触发稳定 action 和读取状态。`start_image_job` 使用 `quick-edit`、`remove-bg` 等稳定图片 action id；`send_to_chat` 使用稳定 `send-to-chat` action id，提示词由后端固定生成。
- 画布 UI：提供 Lovart 风格的浅色无限画布、底部浮动工具栏、图片选择态、非破坏性裁剪和浮动编辑工具栏。
- 单端口多画布页：默认统一使用 `127.0.0.1:43217`。再次在新 Codex 会话或新项目中打开 `/canvas` 时，现有服务会注册新的项目画布，并返回带 `?project=<id>` 的 URL；同一 workspace 会按 Codex thread 隔离为不同 canvas，左上角项目菜单可以在已注册画布页之间切换。
- AI 图片操作：`Quick Edit`、`Remove BG`、`Expand`、`Edit Text`、`Edit Elements` 通过稳定 action id 创建后台 job，由后端映射到对应 Agent-Canvas operation skill 和 Codex/ImageGen 执行，再把结果回填到源图右侧。`Expand` 会按用户描述对选中图像做扩图/outpaint；`Edit Elements` 会生成实例分割图，本地拆出透明对象/文字图层和补全背景，并作为锁定图层组放回画布。
- Canvas-to-chat：已 smoke test 跑通 Codex app-server `turn/start` 携带 `localImage` 的路径；发送必须绑定明确的 Codex thread，每个 thread 使用独立 canvas，可通过 `--thread-id`、MCP `open_canvas.threadId` 或 `/api/chat-binding` 写入；详见 [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md)。

基础运行：

```bash
node ./bin/agent-canvas.mjs open --project .
```

CLI 选项支持 `--name value` 和 `--name=value` 两种形式；未知命令或缺少必填参数时会向 stderr 输出错误并以非零状态退出。

安装依赖：

```bash
npm install
```

`npm install` 只安装 Node 包，不会在生命周期脚本中自动安装用户级 Python 依赖。可选依赖需要显式检查或安装：`rapidocr_onnxruntime` 用于 `Edit Text` 的本地快速文字识别，`Pillow` 和 `numpy` 用于 `Edit Elements` 的本地拆层与背景处理。OCR 不可用时会回退到 Codex 视觉识别，拆层依赖不可用时 `Edit Elements` 会在本地处理阶段报出明确错误。

检查本地可选依赖：

```bash
npm run doctor:ocr
npm run doctor:image-deps
npm run doctor:deps
```

显式安装本地可选依赖：

```bash
npm run setup:deps
npm run setup:ocr
npm run setup:image-deps
```

显式安装命令会通过 Python `pip install --user` 安装缺失依赖；如果需要跳过 OCR 安装，可以设置：

```bash
AGENT_CANVAS_SKIP_OCR_INSTALL=1 npm run setup:deps
```

如果只想跳过 `Edit Elements` 的本地图像处理依赖安装，可以设置：

```bash
AGENT_CANVAS_SKIP_IMAGE_DEPS_INSTALL=1 npm run setup:deps
```

导入图片：

```bash
node ./bin/agent-canvas.mjs import ./example.png --project .
```

兜底收集最近图片：

```bash
node ./bin/agent-canvas.mjs collect --project . --since-minutes 30 --limit 5
```

未指定 `--from` 时，`collect` 会默认扫描 `~/.codex/generated_images` 和当前项目目录；如需限定扫描范围，可以传入逗号分隔的 `--from <dir,dir>`。

搜索画布资产：

```bash
node ./bin/agent-canvas.mjs search "skyline" --project . --json
```

查看 prompt 历史：

```bash
node ./bin/agent-canvas.mjs prompts "product" --project . --json
```

查看版本分组：

```bash
node ./bin/agent-canvas.mjs versions "product" --project . --group-by sourceObjectId --json
```

作用域选择：

```bash
node ./bin/agent-canvas.mjs status --project . --thread-id <codex-thread-id> --json
node ./bin/agent-canvas.mjs import ./example.png --project . --canvas-id <canvas-id>
```

`--thread-id` 会选择绑定到该 Codex thread 的独立画布；`--canvas-id` 会直接选择明确的 Agent-Canvas 画布作用域，并覆盖由 `--thread-id` 推导出的作用域。MCP 工具同样暴露 `threadId` 和 `canvasId` 参数，用于把读写操作定位到同一项目下的指定画布。

运行验证：

```bash
npm test
npm run smoke:visual
npm run visual:regression
```

`visual:regression` 会把固定桌面/移动端的 discovery、选中工具栏、Expand composer、Crop overlay、版本比较、版本标注叠层和 Edit Text 截图与 `scripts/reference-screenshots/` 中的基线 PNG 比较；需要刷新基线时运行 `npm run visual:regression -- --update`。

## Codex 插件安装

本地开发时可以把当前仓库暴露给 Codex personal marketplace：

```bash
npm run install:personal
```

该命令会跨平台创建或更新 `~/plugins/agent-canvas`，并把 `agent-canvas` 写入 `~/.agents/plugins/marketplace.json`。写入的插件条目形如：

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

安装器只会创建或更新指向当前仓库的 symlink/junction；如果 `~/plugins/agent-canvas` 已经是普通文件或目录，命令会拒绝覆盖并提示先移除该路径。测试或临时安装可以设置 `AGENT_CANVAS_PERSONAL_HOME=/path/to/home npm run install:personal`，这样会写入该目录下的 `plugins/agent-canvas` 和 `.agents/plugins/marketplace.json`，不影响真实用户目录。

Codex 可能会把 personal plugin 复制到自己的版本化 cache 目录中运行。开发机如果需要让已安装插件实时使用当前源码，可以额外运行：

```bash
npm run install:dev-cache
```

该命令会把当前版本的 `~/.codex/plugins/cache/personal/agent-canvas/<plugin-version>` 改成指向当前仓库的 symlink/junction；如果原 cache 目录已经存在，会先改名为 `.backup-<timestamp>` 备份。这个命令只用于本地开发同步，不建议普通用户使用。普通用户应通过 `git pull --ff-only` 或重新安装发布版本来更新。

发布前可以检查插件包内容：

```bash
npm pack --dry-run --json
```

包内应包含 `.codex-plugin/plugin.json`、`.mcp.json`、`skills/`、`src/`、`public/` 和 `bin/`，不应包含本地运行态的 `canvas/`、`.git/` 或 `node_modules/`。

安装后新建 Codex 会话，尝试输入 `/canvas`。当前本机已验证 `/canvas` 可以触发 `agent-canvas:canvas` skill，并在 Codex `in-app browser` 中打开 `http://127.0.0.1:43217/?project=<id>`。如果某些 Codex 版本没有把插件 skill 暴露为 slash command，可以使用 `$canvas` 或直接说“打开 Agent-Canvas 画布”。

## 数据目录

运行后会在当前项目生成：

```text
canvas/
  agent-canvas.json
  threads/
    <canvasId>/
      agent-canvas.json
      assets/
      jobs/
  assets/
  jobs/
```

跨项目的画布列表会持久化在 `~/.agents/agent-canvas/projects.json`，用于在本地 Agent-Canvas 服务重启后恢复左侧项目菜单。测试或隔离环境可以通过 `AGENT_CANVAS_PROJECT_REGISTRY_PATH` 指向其他 registry 文件。

`agent-canvas.json` 保存默认画布对象和选区状态；绑定 Codex thread 后，每个 thread 的画布状态保存在 `canvas/threads/<canvasId>/agent-canvas.json`。`assets/` 保存导入的图片文件，`jobs/` 保存后台 AI 操作的日志、中间产物和输出。

服务启动后会监听项目内和 `~/.codex/generated_images` 中新产生的图片文件，并保留周期扫描作为兜底，然后导入画布。自动收集会忽略 `canvas/`、`node_modules/`、`.git/` 等目录，并在成功扫描后推进每个项目画布的扫描水位；如果不希望自动收集，可以使用 `--no-auto-collect`。
