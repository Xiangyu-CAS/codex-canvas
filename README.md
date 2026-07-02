# Codex-Canvas
Codex-Canvas 是一款面向 Codex 的本地无限画布插件。用户可以在 Codex 中打开画布，将 `imagegen` skill 生成或编辑的图片自动收录到项目画布中，并在画布上继续进行图像整理、标注、局部编辑和版本迭代。

项目目标是把 Codex 的对话式图像生成能力扩展为更接近 `Lovart` 的画布式视觉工作流：图片不再只是散落在对话上下文里的附件，而是成为可以被选择、编辑、比较和复用的项目资产。


## 背景
- 1️⃣ Codex app 自带 `in-app browser`，天然适合形成左侧对话、右侧画布的工作形态。对于需要反复生成、比较和修改图片的用户来说，这种形态可以承载类似 `Lovart` 的画布式图像编辑体验。
- 2️⃣ Codex 自带 `imagegen` skill，并使用 `gpt-image-2` 进行图像生成和编辑。用户无需额外配置或购买 API，就可以在 Codex 内完成基础的图像生产流程，这为开源插件的传播和使用降低了门槛。
- 3️⃣ [Cowart](https://github.com/zhongerxin/Cowart) 已经验证了 Codex + 本地无限画布的方向：它基于 tldraw 提供项目本地画布、图片收录、AI image holder 和标注驱动改图等能力。相比更完整的画布式图像编辑产品，Codex-Canvas 仍可继续扩展更高级的多对象编排、版式和设计协作能力。
- 4️⃣ Codex-Canvas 已有早期实现基础，核心画布能力已经过验证。此前受限于开源时机和 Codex 图像生成能力尚未完善，用户需要自行配置 API，使用成本较高；现在 Codex 内置 `imagegen` 后，重新启动项目的条件更成熟。
- 5️⃣ 综上所述，Codex-Canvas 可以作为独立项目推进，同时也可以将可复用的能力和经验贡献给 Cowart 生态。

## 架构
Codex-Canvas 可以按四个模块设计：

- **Codex 交互层**：提供 `/canvas` 入口、`imagegen` 工作流封装和画布操作指令，让用户通过 Codex 打开画布、生成图片、编辑选中对象。
- **本地画布层**：启动本地 Web 服务，并在 Codex `in-app browser` 中渲染无限画布。画布负责图片展示、选择、拖拽、标注、裁剪、扩图区域选择等交互。
- **工具通信层**：通过 MCP 工具连接 Codex 和画布，提供读取当前选区、插入图片、导出标注图、更新画布对象等能力。
- **项目数据层**：将画布 JSON、生成图片、编辑中间产物和导出结果保存到当前项目目录，保证视觉资产跟随项目一起管理。

核心流程：

1. 用户在 Codex 中打开 Codex-Canvas，本地服务启动并在 `in-app browser` 中显示画布。
2. 用户在画布中创建或选择图片对象，并通过 Codex 发起生成、改图或编辑请求。
3. Codex 调用 `imagegen` 生成结果，再通过 MCP 工具把图片写回画布。
4. 画布状态和图片资产保存到项目目录，后续可以继续编辑、比较和复用。

## 当前原型

当前版本先实现最小可用闭环：

- `codex-canvas open`：后台启动或复用本地画布服务，并输出当前项目画布 URL。
- `codex-canvas start`：前台启动本地画布服务，并默认开启项目图片自动收集。
- `codex-canvas import <image-path>`：将本地图片复制到当前项目的 `canvas/assets/`，并插入画布。
- `codex-canvas collect`：扫描项目内和 `~/.codex/generated_images` 中最近生成的图片并导入画布，作为 `imagegen` 输出路径不明确时的兜底收集器。
- `codex-canvas search`：按名称、prompt、文本、来源路径和图层组元数据搜索画布对象，用于快速定位项目资产。
- `codex-canvas prompts`：列出最近使用过的唯一 prompt，支持按文本过滤，用于复用项目提示词。
- `codex-canvas versions` 和画布内 discovery 面板：按 `sourceObjectId`、`batchId`、`layoutMode` 或 `prompt` 分组查看画布对象版本历史，在面板中预览缩略图，并可在画布中框选同组版本做并排比较或绘制临时像素差异热力图。
- MCP 工具：提供 `open_canvas`、`add_image`、`collect_recent_images`、`canvas_status`、`search_canvas`、`prompt_history`、`version_groups`、`start_image_job`、`send_to_chat`，方便 Codex 在会话中打开画布、收录图片、搜索资产、提示词和版本分组、触发稳定 action 和读取状态。`start_image_job` 使用 `quick-edit`、`remove-bg` 等稳定图片 action id；`send_to_chat` 使用稳定 `send-to-chat` 或 `mention-file` action id，提示词由后端固定生成。
- 画布 UI：提供 Lovart 风格的浅色无限画布、底部浮动工具栏、图片选择态、非破坏性裁剪和浮动编辑工具栏。
- 单端口多画布页：默认统一使用 `127.0.0.1:43217`。再次在新 Codex 会话或新项目中打开 `/canvas` 时，现有服务会注册新的项目画布，并返回带 `?project=<id>` 的 URL；同一 workspace 会按 Codex thread 隔离为不同 canvas，左上角项目菜单可以在已注册画布页之间切换。
- AI 图片操作：`Quick Edit`、`Remove BG`、`Expand`、`Edit Text`、`Edit Elements` 通过稳定 action id 创建后台 job，由后端映射到对应 Codex-Canvas operation skill 和 Codex/ImageGen 执行，再把结果回填到源图右侧。`Expand` 会按用户描述对选中图像做扩图/outpaint；`Edit Elements` 会生成实例分割图，本地拆出透明对象/文字图层和补全背景，并作为锁定图层组放回画布。
- Canvas-to-chat：已 smoke test 跑通 Codex app-server `turn/start` 携带 `localImage` 或 `mention` 的路径；发送必须绑定明确的 Codex thread，每个 thread 使用独立 canvas，可通过 `--thread-id`、MCP `open_canvas.threadId` 或 `/api/chat-binding` 写入。前端 `@file` 按钮只复制待粘贴引用，不直接发送；详见 [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md)。

基础运行：

```bash
node ./bin/codex-canvas.mjs open --project .
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
CODEX_CANVAS_SKIP_OCR_INSTALL=1 npm run setup:deps
```

如果只想跳过 `Edit Elements` 的本地图像处理依赖安装，可以设置：

```bash
CODEX_CANVAS_SKIP_IMAGE_DEPS_INSTALL=1 npm run setup:deps
```

导入图片：

```bash
node ./bin/codex-canvas.mjs import ./example.png --project .
```

兜底收集最近图片：

```bash
node ./bin/codex-canvas.mjs collect --project . --since-minutes 30 --limit 5
```

未指定 `--from` 时，`collect` 会默认扫描 `~/.codex/generated_images` 和当前项目目录；如需限定扫描范围，可以传入逗号分隔的 `--from <dir,dir>`。

搜索画布资产：

```bash
node ./bin/codex-canvas.mjs search "skyline" --project . --json
```

查看 prompt 历史：

```bash
node ./bin/codex-canvas.mjs prompts "product" --project . --json
```

查看版本分组：

```bash
node ./bin/codex-canvas.mjs versions "product" --project . --group-by sourceObjectId --json
```

作用域选择：

```bash
node ./bin/codex-canvas.mjs status --project . --thread-id <codex-thread-id> --json
node ./bin/codex-canvas.mjs import ./example.png --project . --canvas-id <canvas-id>
```

`--thread-id` 会选择绑定到该 Codex thread 的独立画布；`--canvas-id` 会直接选择明确的 Codex-Canvas 画布作用域，并覆盖由 `--thread-id` 推导出的作用域。MCP 工具同样暴露 `threadId` 和 `canvasId` 参数，用于把读写操作定位到同一项目下的指定画布。

运行验证：

```bash
npm test
npm run smoke:visual
npm run visual:regression
```

`visual:regression` 会把固定桌面/移动端的 discovery、选中工具栏、Expand composer、Crop overlay、版本比较、版本标注叠层和 Edit Text 截图与 `scripts/reference-screenshots/` 中的基线 PNG 比较；需要刷新基线时运行 `npm run visual:regression -- --update`。

## Codex 插件安装

### 让 Codex 自动安装

可以把下面这段作为安装任务发给 Codex。它描述的是 Codex-Canvas 自己的安装流程：先把仓库放到本机一个长期保留的目录，再运行仓库内的 personal marketplace 安装器，最后用 Codex CLI 安装这个 personal plugin。

```text
请帮我安装 Codex-Canvas 插件。

仓库地址是 https://github.com/Xiangyu-CAS/codex-canvas.git。
请把仓库 clone 到一个长期保留的本地目录，例如 ~/src/codex-canvas；如果你已有固定源码目录，也可以使用那个目录。
然后在仓库目录里执行 npm install 和 npm run install:personal。

install:personal 会把插件链接到 ~/plugins/codex-canvas，并维护 ~/.agents/plugins/marketplace.json。
请用 codex plugin marketplace list --json 检查 Codex 是否已经有 root 指向用户 home 目录的 personal marketplace。
如果没有，请执行 codex plugin marketplace add ~。

最后执行 codex plugin add codex-canvas@personal。
安装完成后，请检查 Codex 是否能看到 Codex-Canvas 的 skills/MCP，并提醒我新开一个 Codex 对话来加载新插件。
```

### 手动安装

手动安装分三步：准备源码、注册到 personal marketplace、安装插件。下面使用 `~/src/codex-canvas` 作为示例路径；它不是固定要求，可以换成任意你会长期保留的目录。

先准备源码：

```bash
mkdir -p ~/src
git clone https://github.com/Xiangyu-CAS/codex-canvas.git ~/src/codex-canvas
cd ~/src/codex-canvas
npm install
npm run install:personal
```

`npm run install:personal` 会创建或更新 `~/plugins/codex-canvas`，并把插件条目写进 `~/.agents/plugins/marketplace.json`。因此 Codex 侧需要把用户 home 目录作为 `personal` marketplace root。先检查当前 Codex CLI 已注册的 marketplace：

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

安装后新开一个 Codex 会话，让新的 skills 和 MCP 工具加载进来。可以尝试输入 `/canvas`；如果当前 Codex 版本没有把插件 skill 暴露成 slash command，可以使用 `$canvas` 或直接说“打开 Codex-Canvas 画布”。

可选本地依赖可以按需安装；它们用于本地 OCR、Edit Elements 拆层和背景处理，不是打开画布的硬性前置条件：

```bash
npm run setup:deps
```

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

安装器只会创建或更新指向当前仓库的 symlink/junction；如果 `~/plugins/codex-canvas` 已经是普通文件或目录，命令会拒绝覆盖并提示先移除该路径。测试或临时安装可以设置 `CODEX_CANVAS_PERSONAL_HOME=/path/to/home npm run install:personal`，这样会写入该目录下的 `plugins/codex-canvas` 和 `.agents/plugins/marketplace.json`，不影响真实用户目录。

### 开发同步

Codex 可能会把 personal plugin 复制到自己的版本化 cache 目录中运行。开发机如果需要让已安装插件实时使用当前源码，可以额外运行：

```bash
npm run install:dev-cache
```

该命令会把当前版本的 `~/.codex/plugins/cache/personal/codex-canvas/<plugin-version>` 改成指向当前仓库的 symlink/junction；如果原 cache 目录已经存在，会先改名为 `.backup-<timestamp>` 备份。这个命令只用于本地开发同步，不建议普通用户使用。

## 更新策略

Codex-Canvas 的自动更新策略是保守的 git fast-forward：

```bash
codex-canvas update --check
codex-canvas update
```

用户主动打开画布时也会默认执行同一套 best-effort 更新检查，包括 `/canvas` skill、MCP `open_canvas` 和 CLI `codex-canvas open`。如果更新器能安全 fast-forward，就先更新再继续打开；如果更新器因为本地改动、离线、无上游等原因被阻塞，会跳过更新并继续打开画布。CLI 可用 `codex-canvas open --no-update` 跳过本次打开前更新；MCP 可传 `autoUpdate: false`。

只有当前插件运行目录是 git checkout、当前分支能定位到远端分支、工作区干净、并且本地没有未推送提交时，更新器才会执行 `git pull --ff-only`。如果分支没有显式 upstream，但存在同名的 `origin/<branch>`，更新器会使用 `git pull --ff-only origin <branch>`。这适合从 `https://github.com/Xiangyu-CAS/codex-canvas.git` clone 后通过 `npm run install:personal` 暴露给 Codex 的安装方式。

如果插件是 Codex 已复制到 `~/.codex/plugins/cache/...` 的版本化目录，或是没有 `.git` 的包目录，自动更新会报告 `not-git` 并给出手动 clone/reinstall 建议。遇到本地改动、游离 HEAD、没有远端分支、本地提交领先或分叉历史时，更新器只会返回明确的阻塞原因，不会自动 stash、reset、merge 或覆盖用户文件。解决后重新运行：

```bash
codex-canvas update --check
```

发布前可以检查插件包内容：

```bash
npm pack --dry-run --json
```

包内应包含 `.codex-plugin/plugin.json`、`.mcp.json`、`skills/`、`src/`、`public/` 和 `bin/`，不应包含本地运行态的 `canvas/`、`.git/` 或 `node_modules/`。

安装后新建 Codex 会话，尝试输入 `/canvas`。当前本机已验证 `/canvas` 可以触发 `codex-canvas:canvas` skill，并在 Codex `in-app browser` 中打开 `http://127.0.0.1:43217/?project=<id>`。如果某些 Codex 版本没有把插件 skill 暴露为 slash command，可以使用 `$canvas` 或直接说“打开 Codex-Canvas 画布”。

## 数据目录

运行后会在当前项目生成：

```text
canvas/
  codex-canvas.json
  threads/
    <canvasId>/
      codex-canvas.json
      assets/
      jobs/
  assets/
  jobs/
```

跨项目的画布列表会持久化在 `~/.agents/codex-canvas/projects.json`，用于在本地 Codex-Canvas 服务重启后恢复左侧项目菜单。测试或隔离环境可以通过 `CODEX_CANVAS_PROJECT_REGISTRY_PATH` 指向其他 registry 文件。

`codex-canvas.json` 保存默认画布对象和选区状态；绑定 Codex thread 后，每个 thread 的画布状态保存在 `canvas/threads/<canvasId>/codex-canvas.json`。`assets/` 保存导入的图片文件，`jobs/` 保存后台 AI 操作的日志、中间产物和输出。

服务启动后会监听项目内和 `~/.codex/generated_images` 中新产生的图片文件，并保留周期扫描作为兜底，然后导入画布。自动收集会忽略 `canvas/`、`node_modules/`、`.git/` 等目录，并在成功扫描后推进每个项目画布的扫描水位；如果不希望自动收集，可以使用 `--no-auto-collect`。
