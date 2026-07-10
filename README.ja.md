# Codex-Canvas

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

Codex-Canvas は Codex 向けの無限キャンバス Plugin です。API 設定は不要で、Codex 組み込みの GPT-image-2 ワークフローを使ってローカルキャンバス上で画像編集を行えます。Codex の中で直接キャンバスを開き、生成された画像を現在のプロジェクトに収集し、視覚素材を整理、注釈、編集、比較、再利用できます。

Codex に Lovart に近い作業スタイルを追加します。片側でチャットし、もう片側でキャンバスを使いながら、同じ創作ループに合わせて設計された強力な画像編集ツールを利用できます。

<p align="center">
  <img src="assets/readme/overview.webp" alt="Open Codex Canvas" width="760">
</p>

## インストール

次のプロンプトを Codex にコピーしてください。

```text
https://github.com/Xiangyu-CAS/codex-canvas.git とその INSTALL.md に従って Codex-Canvas をインストールしてください。
インストール後、現在の Codex 会話で `@Codex-Canvas codex canvas を開いて` と入力して起動するようユーザーに伝えてください。
```

完全なインストール手順は [`INSTALL.md`](INSTALL.md) を参照してください。

インストール後、現在の Codex 会話でキャンバスを開きます。

```text
@Codex-Canvas codex canvas を開いて
```

## Roadmap

- [x] GPT-image-2 による画像編集
- [ ] 編集可能な PPT の生成とエクスポート
- [ ] draw.io フローチャートの生成と編集

## 主な機能

### 1. キャンバスを開き、生成画像を自動収集

現在の Codex 会話で `@Codex-Canvas codex canvas を開いて` と入力すると、Codex-Canvas は in-app browser でプロジェクトのローカルキャンバスを開きます。左側でチャットを続けながら、右側で視覚素材を管理できます。thread をバインドすると、Codex-Canvas は `~/.codex/generated_images/<thread-id>` にあるその thread の出力だけを収集し、他のプロジェクト、他の thread、プロジェクト全体はスキャンしません。生成結果はその thread のキャンバスに保存されます。

<p align="center">
  <img src="assets/readme/auto-collect.webp" alt="生成画像の自動収集" width="640">
</p>

### 2. Quick Edit: 注釈で変更内容を伝える

Quick Edit では、選択した画像に直接注釈を付けられます。ブラシの印、色、テキスト指示が編集参考としてモデルに渡されるため、部分的な置き換え、オブジェクトの追加、主要なレイアウトを保ったまま細部を調整する作業に適しています。

<p align="center">
  <img src="assets/readme/quick-edit-comparison.webp" alt="Quick Edit comparison" width="700">
</p>

### 3. Edit Elements: レイヤーに分離して再配置

Edit Elements は画像を背景、テキスト、商品、人物、価格タグなどの移動可能なレイヤーに分離します。分離したレイヤーはキャンバス上で再配置でき、Codex-Canvas は前景オブジェクトに隠れていた背景の補完も続けられます。Edit Elements グループの任意のレイヤーをダウンロードすると、グループ全体が PSD として書き出され、各キャンバスレイヤーが Photoshop レイヤーに対応します。Photoshop や Photopea などの専門ツールでさらに編集できます。

<p align="center">
  <img src="assets/readme/edit-elements-comparison.webp" alt="Edit Elements comparison" width="700">
</p>

### 4. Edit Text: 画像内テキストを認識して書き換え

Edit Text は画像内のテキストを認識し、編集可能なフィールドとして一覧表示します。各行を修正しながら、元のタイポグラフィ、レイアウト関係、視覚的な雰囲気をできるだけ維持するようモデルに依頼できます。

<p align="center">
  <img src="assets/readme/edit-text-comparison.webp" alt="Edit Text comparison" width="700">
</p>

### 5. Remove BG: ワンステップで背景削除

ポスター、ポートレート、商品画像などの素材に対して、Codex-Canvas は透明背景の結果をキャンバス上に直接生成できます。結果は同じプロジェクトキャンバスに残るため、合成、レイアウト、Codex での再利用にすぐ使えます。

<p align="center">
  <img src="assets/readme/remove-bg-result.webp" alt="Remove BG result" width="560">
</p>

### 6. Expand: 新しい比率へアウトペイント

Expand は視覚的な拡張フレームと、1:1、3:4、16:9、9:16 などの一般的なアスペクト比プリセットを提供します。先に新しいキャンバス範囲を決めてから、モデルに周辺の画像内容を補完させられます。

<p align="center">
  <img src="assets/readme/expand-comparison.webp" alt="Expand comparison" width="700">
</p>

## 機能

- Codex の in-app browser でローカル無限キャンバスを開きます。
- Codex/ImageGen の出力をバインドされた thread のキャンバスへ自動収集し、他のプロジェクトや会話から分離します。
- キャンバス画像のアップロード、インポート、配置、選択、ドラッグ、削除、ダウンロードに対応します。
- 選択した画像へのブラシ注釈と一時的なテキストラベルに対応します。
- Quick Edit に対応し、注釈の色やテキストラベルを編集参考としてモデルに渡します。
- 背景削除に対応します。
- 調整可能な拡張プレビューフレーム付きの Expand/outpaint に対応します。
- Edit Text に対応します。ローカル OCR が利用可能な場合は優先的に使用し、必要に応じて Codex の視覚認識へフォールバックします。
- Edit Elements に対応し、画像を前景オブジェクト/テキストレイヤーと背景レイヤーに分離します。
- Edit Elements の背景補完に対応し、背景レイヤーをその場で置き換えます。
- Edit Elements のレイヤーグループを PSD ファイルとしてダウンロードできます。各キャンバスレイヤーは Photoshop レイヤーに対応します。
- prompt 履歴と生成バージョングループを表示できます。
- Codex 会話ごとに別々のキャンバスを保持し、コンテキストの混在を防ぎます。
- 選択した画像を `@file` 参照としてコピーし、Codex チャットへ貼り戻せます。

## 使用上の注意

Codex-Canvas はキャンバスデータを現在のプロジェクトの `canvas/` ディレクトリに保存します。生成素材、ジョブログ、中間ファイルはプロジェクト内にローカル保存されます。

`Send to chat` は現在、Codex app-server を経由するプロトタイプの経路です。プロトコル層では送信できますが、現在表示されている Codex デスクトップ版のチャット UI に必ず表示されるとは限りません。より確実な手順は `Copy @file` を使い、その参照を現在の Codex チャットボックスへ貼り付けることです。

## 開発

よく使うローカルコマンド:

```bash
npm install
npm test
node ./bin/codex-canvas.mjs open --project .
```

関連ドキュメント:

- [`INSTALL.md`](INSTALL.md): インストール手順と任意のローカル依存関係。
- [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md): 現在の canvas-to-chat の検証結果と制限。

## 謝辞

キャンバスのアイデアを提供してくれた [Cowart](https://github.com/zhongerxin/Cowart) に感謝します。
