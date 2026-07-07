---
name: codex-canvas
description: 打开并操作 Codex-Canvas，让它既可以作为独立 Agent Skill 使用，也可以继续作为 Codex 插件使用。适用于用户输入 /canvas、要求打开本地无限画布、把生成图片收集到画布、把画布图片发送回 Codex 对话，或运行 Quick Edit、Remove BG、Expand、Edit Text、Edit Elements 等 Codex-Canvas 图片操作。
---

# Codex-Canvas

当项目以独立 Skill 形式安装时，使用这个根 `SKILL.md` 作为 Codex-Canvas 的入口。当同一个项目以 Codex 插件形式安装时，保留 `.codex-plugin/plugin.json` 和 `skills/` 下的专用操作技能，不改变原插件安装路径。

## 定位运行时

1. 将当前 skill 目录或插件目录视为 `<codex-canvas-root>`。
2. 执行 CLI 前，先确认 `<codex-canvas-root>/bin/codex-canvas.mjs` 存在。
3. 使用 Node.js 18.18 或更新版本运行命令。
4. 将所有画布数据保存在当前工作区的 `canvas/` 目录下。

## 打开画布

1. 使用以下命令启动或复用项目本地画布：
   `node <codex-canvas-root>/bin/codex-canvas.mjs open --project <workspace>`
2. 如果能拿到当前 Codex thread id，传入 `--thread-id <thread-id>`。Codex-Canvas 也会读取 `CODEX_THREAD_ID` 和 `CODEX_CANVAS_CODEX_THREAD_ID`。
3. 优先使用 `open`，不要直接用 `start`；`open` 会复用健康的已保存运行时，只在需要时启动 detached server。
4. 当 Codex in-app browser 控制能力可用时，直接在 Codex 内置浏览器打开返回的 URL。
5. 如果当前环境无法控制内置浏览器，返回画布 URL 的 Markdown 链接。不要启动系统默认浏览器。

## 图片收集

1. 对生成或编辑后的图片，尽量将输出保存到当前工作区。
2. 已知图片路径时，用以下命令导入：
   `node <codex-canvas-root>/bin/codex-canvas.mjs import <image-path> --project <workspace>`
3. 如果输出路径不明确，用以下命令收集近期图片：
   `node <codex-canvas-root>/bin/codex-canvas.mjs collect --project <workspace> --since-minutes 30 --limit 5`
4. 遵守 Codex-Canvas 的放置规则：同一批生成图横向排列；从画布对象派生的结果放到源图片右侧。

## AI 操作边界

AI 图片操作必须使用稳定的 Codex-Canvas action id 和后端 job。不要把具体操作 prompt 写进前端代码。

- `quick-edit`：使用 `skills/canvas-quick-edit/SKILL.md`。
- `remove-bg`：使用 `skills/canvas-remove-bg/SKILL.md`。
- `expand`：使用 `skills/canvas-expand/SKILL.md`。
- `edit-text`：使用 `skills/canvas-edit-text/SKILL.md`。
- `edit-elements`：使用 `skills/canvas-edit-elements/SKILL.md`。

只有在对应 action 被请求时，才加载匹配的操作技能。平移、缩放、拖拽、选择、删除、铅笔绘制、文本对象编辑、工具栏状态、视口 framing 等确定性画布交互应保留在本地应用代码中。

## 跨平台规则

- 保持 macOS 和 Windows 跨平台兼容。
- 核心行为不要依赖 AppleScript、`osascript`、System Events、Windows UI Automation、坐标点击、模拟按键、剪贴板粘贴或操作系统特定的浏览器启动方式。
- 优先使用 Codex 支持的浏览器、插件、MCP、CLI 和后端 job 集成面。
- 修改工具栏、dock 和控件 UI 时，使用成熟图标集和应用既有图标风格。

## 插件兼容

不要要求 `.codex-plugin/plugin.json` 指向这个根 skill。插件安装路径应继续暴露现有 `skills/` 目录和 MCP server 配置。这个根 `SKILL.md` 只用于让仓库也能作为独立 skill 安装或上传，同时不影响插件安装。
