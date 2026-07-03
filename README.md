# Codex-Canvas

Codex-Canvas 是一个面向 Codex 的无限画布Plugin，无需配置API，调用Codex内置GPT-image-2实现画布编辑功能。它可以在 Codex 里打开画布，把生成的图片收录到当前项目中，并让你继续整理、标注、编辑、比较这些视觉资产

这个插件把 Codex 变成更接近 Lovart 的工作形态：一边对话，一边画布，并参照Lovart画布提供许多强大的编辑功能

## 安装

把下面这段复制给 Codex：

```text
请根据 https://github.com/Xiangyu-CAS/codex-canvas.git 里的 INSTALL.md 安装 Codex-Canvas。
安装完成后，提示用户，在当前 Codex 对话里输入： `@Codex-Canvas 打开画布`来启动
```

完整安装说明见 [`INSTALL.md`](INSTALL.md)。

安装完成后，在当前 Codex 对话里打开画布：

```text
@Codex-Canvas 打开画布
```

## 功能

- 在 Codex 的 in-app browser 中打开本地无限画布。
- 自动收集 Codex/ImageGen 生成的图片到当前项目画布。
- 支持上传、导入、排列、选择、拖动、删除和下载画布图片。
- 支持在选中图片上画笔标注和临时文字标注。
- 支持 Quick Edit，并把标注颜色、文字标签等信息传给模型作为编辑参考。
- 支持图片去背景。
- 支持 Expand/outpaint，并提供可调整的扩图预览框。
- 支持 Edit Text；本地 OCR 可用时优先使用本地识别，不可用时回退到 Codex 视觉识别。
- 支持 Edit Elements，把图片拆成前景物体/文字图层和背景图层。
- 支持后台补全 Edit Elements 背景，并原位替换背景层。
- 支持查看 prompt 历史和生成版本分组。
- 不同 Codex 对话可以使用不同画布，避免上下文混在一起。
- 支持复制选中图片的 `@file` 引用，粘贴到 Codex 聊天框中继续使用。

## 使用说明

Codex-Canvas 会把画布数据保存在当前项目的 `canvas/` 目录下。生成资产、任务日志和中间文件都会留在本地项目中。

`Send to chat` 目前还是通过 Codex app-server 提交的原型路径。它可以在协议层完成，但不保证一定出现在当前可见的 Codex 桌面端聊天 UI 中。更可靠的方式是使用 `Copy @file`，然后把引用粘贴到当前 Codex 聊天框。

## 开发

常用本地命令：

```bash
npm install
npm test
node ./bin/codex-canvas.mjs open --project .
```

相关文档：

- [`INSTALL.md`](INSTALL.md)：安装说明和可选本地依赖。
- [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md)：当前 canvas-to-chat 的验证结果和限制。

## 致谢
感谢 [Cowart](https://github.com/zhongerxin/Cowart) 提供的画布思路