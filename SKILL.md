---
name: codex-canvas
description: 安装、更新并使用 Codex-Canvas。通过 Red SkillHub 或其他 Skill 渠道获得本 Skill 后，继续把最新稳定版 Codex-Canvas 安装为 Codex personal plugin；Skill 安装不是终态。适用于用户要求安装或升级 codex-canvas、输入 /canvas、打开本地无限画布、收集生成图片、把画布图片发送回 Codex 对话，或运行 Quick Edit、Remove BG、Expand、Edit Text、Edit Elements 等图片操作。
---

# Codex-Canvas

把这个根 Skill 作为 Codex-Canvas 的发现和安装入口。最终运行形态必须是完整 Codex 插件：personal marketplace 中存在 `codex-canvas@personal`，Codex 已把插件复制到版本化缓存，并在新任务中加载插件自带的 skills 和 MCP server。

## 安装为 Codex 插件

当用户要求安装、升级或修复 Codex-Canvas，或者当前目录来自 `redskill install codex-canvas` 时，先执行本节。不要在 Skill 文件下载完成后停止。

1. 将包含本文件的目录视为 `<codex-canvas-skill-root>`。如果本 Skill 刚由 RedSkill 安装，优先使用 `redskill install` 输出的安装目录；默认通常是当前 workspace 下的 `skills/codex-canvas/`。
2. 在 `<codex-canvas-skill-root>/scripts/` 中查找唯一以 `install-codex-plugin` 命名的 JavaScript 安装器。仓库源码与 SkillHub 兼容包可能使用不同的模块扩展名；只运行实际存在的那个文件。
3. 执行：
   `node <installer-path> --json`
4. 安装器必须完成整条稳定链路：把官方 GitHub 仓库放到用户长期目录、切换到最新已发布且校验通过的稳定 Release、安装锁定依赖、写入 personal marketplace、执行 `codex plugin add codex-canvas@personal`，再用 `codex plugin list --json` 验证安装状态和版本。
5. 默认跳过可选 RapidOCR 安装，以保持首次安装稳定快速。只有用户明确要求同时安装本地 OCR 时，才追加 `--with-ocr`。
6. 如果安装器报告缺少 `git`、`node`、`npm` 或 `codex`，如实报告缺失项。不要改用未校验的 `main` 分支、手工拼装插件缓存、系统 UI 自动化或直接链接临时 workspace Skill 目录。
7. 成功后告诉用户：插件已经安装，但当前任务不会动态获得刚安装插件的 MCP server 和专用 skills；关闭旧画布并新建一个 Codex 任务，再使用 `@Codex-Canvas`、`$canvas` 或“打开 Codex-Canvas 画布”。

重复执行安装器应更新或复用同一个稳定源码目录和 personal marketplace 条目。遇到非 Codex-Canvas 仓库、脏工作树或普通目录占用了目标位置时必须停止，不得覆盖用户文件。

## 定位运行时

1. 完成上面的插件安装后，优先使用已安装插件缓存中的 Codex-Canvas runtime。只有安装或故障恢复期间才把当前 Skill 目录视为 `<codex-canvas-root>`。
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
   `node <codex-canvas-root>/bin/codex-canvas.mjs import <image-path> --project <workspace> --thread-id <thread-id>`
3. 如果输出路径不明确，用以下命令收集近期图片：
   `node <codex-canvas-root>/bin/codex-canvas.mjs collect --project <workspace> --thread-id <thread-id> --since-minutes 30 --limit 5`
4. 默认收集只扫描 `~/.codex/generated_images/<thread-id>`。未绑定 thread 时默认收集会安全地不执行；只有用户明确要求手动恢复时，才使用 `--from <dir,dir>` 扫描指定目录。
5. 遵守 Codex-Canvas 的放置规则：同一批生成图横向排列；从画布对象派生的结果放到源图片右侧。

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

不要要求 `.codex-plugin/plugin.json` 指向这个根 Skill。Skill 负责发现、bootstrap 和故障恢复；正式使用由 personal marketplace 安装的插件负责。插件安装路径继续暴露现有 `skills/` 目录和 MCP server 配置。
