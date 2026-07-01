const board = document.querySelector("#board");
const world = document.querySelector("#world");
const objectLayer = document.querySelector("#objects");
const emptyState = document.querySelector("#emptyState");
const boardShell = document.querySelector(".board-shell");
const projectTitle = document.querySelector("#projectTitle");
const projectOptionsButton = document.querySelector(".project-header button");
const projectMenu = document.querySelector("#projectMenu");
const settingsButton = document.querySelector("#settingsButton");
const settingsMenu = document.querySelector("#settingsMenu");
const appVersionValue = document.querySelector("#appVersionValue");
const appUpdateButton = document.querySelector("#appUpdateButton");
const appUpdateLabel = document.querySelector("#appUpdateLabel");
const appUpdateStatus = document.querySelector("#appUpdateStatus");
const toolbar = document.querySelector("#selectionToolbar");
const quickEditComposer = document.querySelector("#quickEditComposer");
const quickEditPrompt = document.querySelector("#quickEditPrompt");
const editTextPanel = document.querySelector("#editTextPanel");
const editTextList = document.querySelector("#editTextList");
const editTextStatus = document.querySelector("#editTextStatus");
const expandPanel = document.querySelector("#expandPanel");
const expandScale = document.querySelector("#expandScale");
const expandPreset = document.querySelector("#expandPreset");
const expandRatios = document.querySelector("#expandRatios");
const quickEditCancel = document.querySelector("#quickEditCancel");
const quickEditRun = document.querySelector("#quickEditRun");
const quickEditMarkupControls = document.querySelector("#quickEditMarkupControls");
const quickEditColorPalette = document.querySelector("#quickEditColorPalette");
const zoomLabel = document.querySelector("#zoomLabel");
const toast = document.querySelector("#toast");
const toolDock = document.querySelector(".tool-dock");
const imageUploadInput = document.querySelector("#imageUploadInput");
const colorPalette = document.querySelector("#colorPalette");
const canvasSearch = createCanvasSearchUi();
const zoomWheelSensitivity = 0.0024;
const maxWheelZoomDelta = 160;
const uploadMaxDisplaySize = 420;
const searchDebounceMs = 180;
const languageStorageKey = "codexCanvasLanguage";
const toolColorStorageKey = "codexCanvasToolColor";
const toolColors = ["#202124", "#d93025", "#f9ab00", "#188038", "#1a73e8", "#9334e6", "#ffffff"];
const initialSearchParams = new URLSearchParams(window.location.search);
let currentProjectId = initialSearchParams.get("project") || "";
let currentThreadId = initialSearchParams.get("threadId") || initialSearchParams.get("thread-id") || "";
let registeredProjects = [];
const pendingTextRecognitionCancels = new Set();

const translations = {
  en: {
    codexCanvas: "Codex canvas",
    canvasTools: "Canvas tools",
    canvasViewControls: "Canvas view controls",
    settings: "Settings",
    language: "Language",
    appVersion: "Version",
    checkUpdates: "Check updates",
    updateNow: "Update",
    updateChecking: "Checking...",
    updateAvailable: "Available",
    updateCurrent: "Current",
    updateUnavailable: "Unavailable",
    updateRunning: "Updating...",
    updateDone: "Updated. Refresh canvas to use the new version.",
    updateFailed: "Update failed.",
    projectOptions: "Project options",
    switchCanvas: "Switch canvas",
    currentCanvas: "Current",
    promptHistory: "Prompt history",
    promptHistorySearch: "Filter prompts",
    promptHistoryLoading: "Loading prompts...",
    promptHistoryEmpty: "No matching prompts.",
    promptHistoryFailed: "Prompt history failed to load.",
    promptHistoryApplied: "Prompt added to Quick Edit.",
    promptHistoryCopied: "Prompt copied.",
    promptHistoryTab: "Prompts",
    versionBrowserTab: "Versions",
    versionBrowserSearch: "Filter versions",
    versionBrowserLoading: "Loading versions...",
    versionBrowserEmpty: "No matching version groups.",
    versionBrowserFailed: "Version groups failed to load.",
    versionGroupLabel: "Group by",
    versionGroupSource: "Source",
    versionGroupBatch: "Batch",
    versionGroupLayout: "Layout",
    versionGroupPrompt: "Prompt",
    versionGroupCount: "objects",
    versionGroupCompare: "Compare",
    versionGroupAnnotate: "Diff",
    versionDiffLabel: "Pixel diff",
    textPlaceholder: "Text",
    quickEditPlaceholder: "Describe your edit here",
    expandPlaceholder: "Describe what should extend beyond the image edges",
    quickEditEmpty: "Describe the edit first.",
    expandEmpty: "Describe what to extend first.",
    expandTitle: "Expand",
    expandScale: "Scale",
    expandPreset: "Preset",
    expandPresetGeneral: "General",
    expandPresetPhoto: "Photo",
    expandPresetPoster: "Poster",
    expandPresetProduct: "Product",
    expandOriginalRatio: "Original ratio",
    cropApply: "Apply",
    editTextPlaceholder: "Describe the text change here",
    editTextEmpty: "Describe the text change first.",
    editTextTitle: "Edit Text",
    editTextRecognizing: "Recognizing text...",
    editTextNoText: "No editable text was recognized.",
    editTextNoChanges: "Edit at least one recognized text item first.",
    searchLabel: "Search canvas",
    searchPlaceholder: "Search name, prompt, text, source, metadata",
    searchAllTypes: "All",
    searchEmpty: "No matching objects",
    searchHint: "Search canvas objects",
    searchFailed: "Search failed.",
    cancel: "Cancel",
    run: "Run",
    jobStarted: "started. This can take a few minutes.",
    jobRunning: "Running...",
    jobDone: "finished and was added to the canvas.",
    jobFailed: "failed.",
    chatSendStarted: "Sending image to bound chat...",
    chatSendDone: "Image sent to bound chat.",
    fileMentionCopied: "@file reference copied. Paste it into the Codex chat box.",
    fileMentionCopyFailed: "Could not copy @file reference.",
    chatNotBound: "Bind this canvas to a Codex thread first.",
    uploadDone: "Image uploaded.",
    uploadFailed: "Image upload failed.",
    downloadFailed: "Download failed.",
    actions: {
      "quick-edit": "Quick Edit",
      "remove-bg": "Remove BG",
      "expand": "Expand",
      "crop": "Crop",
      "edit-elements": "Edit Elements",
      "reset-layer-group": "Reset group",
      "layer-up": "Layer up",
      "layer-down": "Layer down",
      "group-layer-group": "Group",
      "edit-text": "Edit Text",
      "send-to-chat": "Send to chat",
      "copy-file-mention": "Copy @file",
      "download": "Download"
    },
    actionNames: {
      "quick-edit": "Quick Edit",
      "remove-bg": "Remove BG",
      "expand": "Expand",
      "crop": "Crop",
      "edit-elements": "Edit Elements",
      "reset-layer-group": "Reset group",
      "layer-up": "Layer up",
      "layer-down": "Layer down",
      "group-layer-group": "Group",
      "edit-text": "Edit Text",
      "send-to-chat": "Send to chat",
      "copy-file-mention": "Copy @file",
      "download": "Download"
    },
    tools: {
      select: "Select",
      pencil: "Pencil",
      text: "Text",
      "upload-image": "Upload image"
    },
    controls: {
      reset: "Reset view"
    },
    objectTypes: {
      image: "Image",
      text: "Text",
      drawing: "Drawing",
      job: "Job"
    }
  },
  zh: {
    codexCanvas: "Agent 画布",
    canvasTools: "画布工具",
    canvasViewControls: "画布视图控制",
    settings: "设置",
    language: "语言",
    appVersion: "版本",
    checkUpdates: "检查更新",
    updateNow: "更新",
    updateChecking: "检查中...",
    updateAvailable: "可更新",
    updateCurrent: "已最新",
    updateUnavailable: "不可用",
    updateRunning: "更新中...",
    updateDone: "已更新，刷新画布后生效。",
    updateFailed: "更新失败。",
    projectOptions: "项目选项",
    switchCanvas: "切换画布",
    currentCanvas: "当前",
    promptHistory: "提示词历史",
    promptHistorySearch: "筛选提示词",
    promptHistoryLoading: "正在加载提示词...",
    promptHistoryEmpty: "没有匹配的提示词。",
    promptHistoryFailed: "提示词历史加载失败。",
    promptHistoryApplied: "已填入快捷编辑。",
    promptHistoryCopied: "已复制提示词。",
    promptHistoryTab: "提示词",
    versionBrowserTab: "版本",
    versionBrowserSearch: "筛选版本",
    versionBrowserLoading: "正在加载版本...",
    versionBrowserEmpty: "没有匹配的版本分组。",
    versionBrowserFailed: "版本分组加载失败。",
    versionGroupLabel: "分组",
    versionGroupSource: "来源",
    versionGroupBatch: "批次",
    versionGroupLayout: "布局",
    versionGroupPrompt: "提示词",
    versionGroupCount: "个对象",
    versionGroupCompare: "比较",
    versionGroupAnnotate: "差异",
    versionDiffLabel: "像素差异",
    textPlaceholder: "文字",
    quickEditPlaceholder: "描述你想怎么改这张图",
    expandPlaceholder: "描述要向画面边缘外扩展什么内容",
    quickEditEmpty: "先描述你想怎么改。",
    expandEmpty: "先描述要扩展什么内容。",
    expandTitle: "扩图",
    expandScale: "Scale",
    expandPreset: "Preset",
    expandPresetGeneral: "General",
    expandPresetPhoto: "Photo",
    expandPresetPoster: "Poster",
    expandPresetProduct: "Product",
    expandOriginalRatio: "Original ratio",
    cropApply: "应用",
    editTextPlaceholder: "描述要替换或修改的文字",
    editTextEmpty: "先描述你想改哪些字。",
    editTextTitle: "编辑文字",
    editTextRecognizing: "正在识别文字...",
    editTextNoText: "没有识别到可编辑文字。",
    editTextNoChanges: "先修改至少一项识别文字。",
    searchLabel: "搜索画布",
    searchPlaceholder: "搜索名称、prompt、文字、来源、元数据",
    searchAllTypes: "全部",
    searchEmpty: "没有匹配对象",
    searchHint: "搜索画布对象",
    searchFailed: "搜索失败。",
    cancel: "取消",
    run: "运行",
    jobStarted: "已开始，可能需要几分钟。",
    jobRunning: "运行中...",
    jobDone: "已完成并添加到画布。",
    jobFailed: "失败。",
    chatSendStarted: "正在发送图片到已绑定对话...",
    chatSendDone: "图片已发送到已绑定对话。",
    fileMentionCopied: "@file 引用已复制，请粘贴到 Codex 聊天框。",
    fileMentionCopyFailed: "无法复制 @file 引用。",
    chatNotBound: "请先把画布绑定到 Codex thread。",
    uploadDone: "图片已上传。",
    uploadFailed: "图片上传失败。",
    downloadFailed: "下载失败。",
    actions: {
      "quick-edit": "快捷编辑",
      "remove-bg": "去背景",
      "expand": "扩图",
      "crop": "裁剪",
      "edit-elements": "编辑元素",
      "reset-layer-group": "重置组",
      "layer-up": "上移一层",
      "layer-down": "下移一层",
      "group-layer-group": "成组",
      "edit-text": "编辑文字",
      "send-to-chat": "发送到对话",
      "copy-file-mention": "复制 @文件",
      "download": "下载"
    },
    actionNames: {
      "quick-edit": "快捷编辑",
      "remove-bg": "去背景",
      "expand": "扩图",
      "crop": "裁剪",
      "edit-elements": "编辑元素",
      "reset-layer-group": "重置组",
      "layer-up": "上移一层",
      "layer-down": "下移一层",
      "group-layer-group": "成组",
      "edit-text": "编辑文字",
      "send-to-chat": "发送到对话",
      "copy-file-mention": "复制 @文件",
      "download": "下载"
    },
    tools: {
      select: "选择",
      pencil: "画笔",
      text: "文字",
      "upload-image": "上传图片"
    },
    controls: {
      reset: "重置视图"
    },
    objectTypes: {
      image: "图片",
      text: "文字",
      drawing: "绘图",
      job: "任务"
    }
  }
};

let state = null;
let selectedId = null;
let selectedIds = new Set();
let hasUserSelection = false;
let activeTool = "select";
let activeColor = loadToolColor();
let editingTextId = null;
let language = loadLanguage();
let drag = null;
let resize = null;
let drawing = null;
let marquee = null;
let cropSession = null;
let cropDrag = null;
let viewport = { x: 0, y: 0, zoom: 0.72 };
let pan = null;
let viewportSaveTimer = null;
let quickEditObjectId = null;
let quickEditAction = null;
let activeTextRecognitionId = null;
let editTextItems = [];
let expandConfig = { scale: "1", preset: "general", ratio: "original", frame: null, sourceStart: null };
const runningJobs = new Map();
let searchTimer = null;
let searchRequestId = 0;
let searchResults = [];
let promptHistoryUi = null;
let promptHistoryFetchToken = 0;
let versionBrowserFetchToken = 0;
let promptHistorySearchTimer = null;
let promptHistoryMode = "prompts";
let versionBrowserGroups = [];
let versionDiffOverlay = null;
let versionDiffHeatmapToken = 0;
let appUpdateInfo = null;
let appUpdateBusy = false;
const composerImageActions = new Set(["quick-edit", "expand", "edit-text"]);
const immediateImageJobActions = new Set(["remove-bg", "edit-elements"]);
const groupSelectionActions = new Set(["reset-layer-group", "layer-up", "layer-down", "group-layer-group"]);
const undoStack = [];
const maxUndoStackSize = 50;
let undoInProgress = false;
const singleSelectionActions = new Set([
  ...composerImageActions,
  ...immediateImageJobActions,
  "crop",
  "send-to-chat",
  "copy-file-mention"
]);

initPromptHistoryUi();
applyLanguage();
renderColorPalette();
await loadProjects();
await loadState();
refreshAppUpdateStatus({ checkRemote: true }).catch(() => {});
setInterval(loadState, 2000);

projectTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    projectTitle.blur();
  }
  if (event.key === "Escape") {
    projectTitle.value = state?.title || "Untitled";
    projectTitle.blur();
  }
});

projectTitle.addEventListener("blur", saveProjectTitle);

projectOptionsButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleProjectMenu();
});

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  closeCanvasSearch({ keepQuery: true });
  closePromptHistoryPanel();
  settingsMenu.hidden = !settingsMenu.hidden;
  if (settingsMenu.hidden) {
    settingsMenu.classList.remove("language-open");
  }
});

settingsMenu.addEventListener("click", (event) => {
  const languageRow = event.target.closest("[data-settings-row='language']");
  if (languageRow) {
    event.stopPropagation();
    settingsMenu.classList.toggle("language-open");
    languageRow.classList.toggle("active", settingsMenu.classList.contains("language-open"));
    return;
  }

  const button = event.target.closest("[data-language]");
  if (!button) return;
  event.stopPropagation();
  setLanguage(button.dataset.language);
});

appUpdateButton?.addEventListener("click", (event) => {
  event.preventDefault();
  if (appUpdateBusy) return;
  if (appUpdateInfo?.updateAvailable) {
    runAppUpdate();
  } else {
    refreshAppUpdateStatus({ checkRemote: true, showToastOnError: true });
  }
});

toolDock.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (!button) return;
  event.preventDefault();
  setActiveTool(button.dataset.tool);
});

imageUploadInput.addEventListener("change", () => {
  const files = [...imageUploadInput.files].filter(isUploadImageCandidate);
  imageUploadInput.value = "";
  if (!files.length) return;
  uploadImageFiles(files);
});

colorPalette.addEventListener("click", (event) => {
  const button = event.target.closest("[data-color]");
  if (!button) return;
  event.preventDefault();
  setActiveColor(button.dataset.color);
});

quickEditColorPalette?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-color]");
  if (!button) return;
  event.preventDefault();
  setActiveColor(button.dataset.color);
});

quickEditMarkupControls?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-quick-edit-tool]");
  if (!button) return;
  event.preventDefault();
  setActiveTool(button.dataset.quickEditTool);
});

canvasSearch.input.addEventListener("input", scheduleCanvasSearch);
canvasSearch.type.addEventListener("change", runCanvasSearch);
canvasSearch.input.addEventListener("focus", () => {
  settingsMenu.hidden = true;
  projectMenu.hidden = true;
  closePromptHistoryPanel();
  canvasSearch.panel.classList.add("active");
  if (canvasSearch.input.value.trim() || searchResults.length) {
    renderCanvasSearchResults(searchResults);
  }
});
canvasSearch.input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeCanvasSearch();
    return;
  }
  if (event.key === "Enter") {
    const firstResult = canvasSearch.results.querySelector("[data-search-result-id]");
    if (!firstResult) return;
    event.preventDefault();
    focusSearchResult(firstResult.dataset.searchResultId);
  }
});
canvasSearch.results.addEventListener("click", (event) => {
  const button = event.target.closest("[data-search-result-id]");
  if (!button) return;
  event.preventDefault();
  focusSearchResult(button.dataset.searchResultId);
});

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view-action]");
  if (viewButton) {
    event.stopPropagation();
    event.preventDefault();
    if (viewButton.dataset.viewAction === "reset") {
      resetViewport();
      return;
    }
    if (viewButton.dataset.viewAction === "upload") {
      imageUploadInput.click();
      return;
    }
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) {
    event.stopPropagation();
    updateSelectionUi();
    if (composerImageActions.has(action)) {
      openImageActionComposer(action);
      return;
    }
    if (action === "crop") {
      startCropMode();
      return;
    }
    if (immediateImageJobActions.has(action)) {
      startImageJob(action);
      return;
    }
    if (action === "download") {
      downloadSelectedImage();
      return;
    }
    if (action === "reset-layer-group") {
      resetSelectedLayerGroup();
      return;
    }
    if (action === "layer-up" || action === "layer-down") {
      moveSelectedLayerInGroup(action === "layer-up" ? "up" : "down");
      return;
    }
    if (action === "group-layer-group") {
      toggleSelectedLayerGroupLock();
      return;
    }
    if (action === "send-to-chat") {
      sendSelectedImageToChat();
      return;
    }
    if (action === "copy-file-mention") {
      copySelectedFileMention();
      return;
    }
    showToast(labelAction(action));
  }
});

document.addEventListener("keydown", (event) => {
  if (isUndoShortcut(event)) {
    if (isNativeUndoTarget(event.target)) return;
    event.preventDefault();
    undoLastCanvasAction();
    return;
  }
  if (!selectedIds.size && !selectedId) return;
  if (["Backspace", "Delete"].includes(event.key)) {
    if (isDeleteEditingTarget(event.target)) return;
    event.preventDefault();
    deleteSelectedObject();
    return;
  }
  if (isShortcutEditingTarget(event.target)) return;
  if (event.key === "Enter" || event.key === " ") {
    if (selectedIds.size > 1) return;
    const object = state.objects.find((item) => item.id === selectedId);
    if (!object || (object.type || "image") !== "image") return;
    event.preventDefault();
    frameSelectedImageForViewing(object);
  }
});

board.addEventListener("pointerdown", (event) => {
  if (event.target === board || event.target === world || event.target === objectLayer) {
    if (activeTool === "pencil") {
      startDrawing(event);
      return;
    }
    if (activeTool === "text") {
      createTextObject(event);
      return;
    }
    if (event.button === 1 || event.altKey) {
      startPan(event);
      return;
    }
    startMarqueeSelection(event);
  }
});

document.addEventListener("pointerdown", (event) => {
  const isSettingsEvent = event.target.closest("#settingsMenu, #settingsButton");
  const isPromptHistoryEvent = event.target.closest(".prompt-history-panel, .prompt-history-button");
  const isCanvasSearchEvent = event.target.closest(".canvas-search");
  if (!isSettingsEvent) {
    settingsMenu.hidden = true;
    settingsMenu.classList.remove("language-open");
    settingsMenu.querySelector("[data-settings-row='language']")?.classList.remove("active");
  }
  if (!isPromptHistoryEvent) {
    closePromptHistoryPanel();
  }
  if (!isCanvasSearchEvent) {
    closeCanvasSearch({ keepQuery: true });
  }
  if (!event.target.closest("#projectMenu, .project-header button")) {
    projectMenu.hidden = true;
  }
  if (isSettingsEvent || isPromptHistoryEvent || isCanvasSearchEvent) return;
  if (!quickEditObjectId && !selectedId && selectedIds.size === 0) return;
  if (event.target.closest(".canvas-object, .selection-toolbar, .quick-edit-composer, .color-palette, .tool-dock, .prompt-history-panel, .prompt-history-button, .canvas-search")) return;
  closeQuickEdit({ keepPrompt: true });
  selectObject(null);
});

quickEditComposer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuickEdit();
});

quickEditCancel.addEventListener("click", () => closeQuickEdit());

expandScale?.addEventListener("change", () => {
  expandConfig.scale = expandScale.value || "1";
  expandConfig.frame = null;
  updateExpandPreview();
});

expandPreset?.addEventListener("change", () => {
  expandConfig.preset = expandPreset.value || "general";
});

expandRatios?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-expand-ratio]");
  if (!button) return;
  expandConfig.ratio = button.dataset.expandRatio || "original";
  expandConfig.frame = null;
  updateExpandRatioButtons();
  updateExpandPreview();
});

quickEditPrompt.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeQuickEdit();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    submitQuickEdit();
  }
});

board.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = board.getBoundingClientRect();
    const before = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const delta = clamp(event.deltaY, -maxWheelZoomDelta, maxWheelZoomDelta);
    const factor = Math.exp(-delta * zoomWheelSensitivity);
    viewport.zoom = clamp(viewport.zoom * factor, 0.12, 2.2);
    viewport.x = event.clientX - rect.left - before.x * viewport.zoom;
    viewport.y = event.clientY - rect.top - before.y * viewport.zoom;
  } else {
    viewport.x -= event.deltaX;
    viewport.y -= event.deltaY;
  }
  applyViewport();
  updateSelectionUi();
  scheduleViewportSave();
}, { passive: false });

function initPromptHistoryUi() {
  if (!boardShell) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "prompt-history-button";
  button.innerHTML = `
    <svg class="prompt-history-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3 -6.7L3 8"></path>
      <path d="M3 3v5h5"></path>
      <path d="M12 7v5l4 2"></path>
    </svg>
  `;

  const panel = document.createElement("section");
  panel.className = "prompt-history-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="prompt-history-header">
      <div class="prompt-history-title"></div>
    </div>
    <div class="prompt-history-tabs" role="tablist">
      <button type="button" data-discovery-mode="prompts"></button>
      <button type="button" data-discovery-mode="versions"></button>
    </div>
    <label class="prompt-history-search">
      <svg class="prompt-history-search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21 -4.3 -4.3"></path>
      </svg>
      <input type="search" autocomplete="off" spellcheck="false" />
    </label>
    <label class="version-group-select">
      <span></span>
      <select>
        <option value="sourceObjectId"></option>
        <option value="batchId"></option>
        <option value="layoutMode"></option>
        <option value="prompt"></option>
      </select>
    </label>
    <div class="prompt-history-list" role="listbox"></div>
    <div class="prompt-history-status"></div>
  `;

  promptHistoryUi = {
    button,
    panel,
    title: panel.querySelector(".prompt-history-title"),
    tabs: [...panel.querySelectorAll("[data-discovery-mode]")],
    search: panel.querySelector("input"),
    groupBy: panel.querySelector(".version-group-select select"),
    groupByLabel: panel.querySelector(".version-group-select span"),
    groupByWrap: panel.querySelector(".version-group-select"),
    list: panel.querySelector(".prompt-history-list"),
    status: panel.querySelector(".prompt-history-status")
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePromptHistoryPanel();
  });

  promptHistoryUi.search.addEventListener("input", () => {
    window.clearTimeout(promptHistorySearchTimer);
    promptHistorySearchTimer = window.setTimeout(() => fetchDiscoveryPanel(), 180);
  });

  promptHistoryUi.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePromptHistoryPanel();
    }
  });

  promptHistoryUi.groupBy.addEventListener("change", () => fetchVersionGroups());

  panel.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-discovery-mode]");
    if (tab) {
      event.preventDefault();
      setDiscoveryMode(tab.dataset.discoveryMode);
      return;
    }

    const annotate = event.target.closest("[data-version-group-overlay-index]");
    if (annotate) {
      event.preventDefault();
      annotateVersionGroup(Number(annotate.dataset.versionGroupOverlayIndex));
      return;
    }

    const compare = event.target.closest("[data-version-group-index]");
    if (compare) {
      event.preventDefault();
      compareVersionGroup(Number(compare.dataset.versionGroupIndex));
      return;
    }

    const versionObject = event.target.closest("[data-version-object-id]");
    if (versionObject) {
      event.preventDefault();
      closePromptHistoryPanel();
      focusSearchResult(versionObject.dataset.versionObjectId);
      return;
    }

    const item = event.target.closest("[data-prompt]");
    if (!item) return;
    event.preventDefault();
    applyPromptFromHistory(item.dataset.prompt || "");
  });

  boardShell.append(button, panel);
  updatePromptHistoryLabels();
}

function togglePromptHistoryPanel() {
  if (!promptHistoryUi) return;
  const nextOpen = promptHistoryUi.panel.hidden;
  if (nextOpen) {
    settingsMenu.hidden = true;
    projectMenu.hidden = true;
    promptHistoryUi.panel.hidden = false;
    promptHistoryUi.button.classList.add("active");
    fetchDiscoveryPanel();
    window.requestAnimationFrame(() => promptHistoryUi.search.focus());
  } else {
    closePromptHistoryPanel();
  }
}

function closePromptHistoryPanel() {
  if (!promptHistoryUi || promptHistoryUi.panel.hidden) return;
  promptHistoryUi.panel.hidden = true;
  promptHistoryUi.button.classList.remove("active");
}

function setDiscoveryMode(mode) {
  const nextMode = mode === "versions" ? "versions" : "prompts";
  if (promptHistoryMode === nextMode) return;
  promptHistoryMode = nextMode;
  promptHistoryUi.search.value = "";
  updatePromptHistoryLabels();
  fetchDiscoveryPanel();
  window.requestAnimationFrame(() => promptHistoryUi.search.focus());
}

function fetchDiscoveryPanel() {
  if (promptHistoryMode === "versions") return fetchVersionGroups();
  return fetchPromptHistory();
}

async function fetchPromptHistory() {
  if (!promptHistoryUi || promptHistoryUi.panel.hidden) return;
  const token = ++promptHistoryFetchToken;
  versionBrowserFetchToken += 1;
  const query = promptHistoryUi.search.value.trim();
  renderPromptHistoryStatus(t("promptHistoryLoading"));
  promptHistoryUi.list.replaceChildren();

  try {
    const url = new URL(apiPath("/api/prompts"), window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "20");
    const response = await fetch(`${url.pathname}${url.search}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t("promptHistoryFailed"));
    if (token !== promptHistoryFetchToken) return;
    renderPromptHistoryItems(Array.isArray(payload.prompts) ? payload.prompts : []);
  } catch (error) {
    if (token !== promptHistoryFetchToken) return;
    renderPromptHistoryStatus(error?.message || t("promptHistoryFailed"));
  }
}

async function fetchVersionGroups() {
  if (!promptHistoryUi || promptHistoryUi.panel.hidden) return;
  const token = ++versionBrowserFetchToken;
  promptHistoryFetchToken += 1;
  const query = promptHistoryUi.search.value.trim();
  renderPromptHistoryStatus(t("versionBrowserLoading"));
  promptHistoryUi.list.replaceChildren();

  try {
    const url = new URL(apiPath("/api/versions"), window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("groupBy", promptHistoryUi.groupBy.value || "sourceObjectId");
    url.searchParams.set("limit", "20");
    url.searchParams.set("objectLimit", "6");
    const response = await fetch(`${url.pathname}${url.search}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t("versionBrowserFailed"));
    if (token !== versionBrowserFetchToken) return;
    renderVersionGroups(Array.isArray(payload.groups) ? payload.groups : []);
  } catch (error) {
    if (token !== versionBrowserFetchToken) return;
    renderPromptHistoryStatus(error?.message || t("versionBrowserFailed"));
  }
}

function renderPromptHistoryItems(items) {
  promptHistoryUi.list.replaceChildren();
  if (!items.length) {
    renderPromptHistoryStatus(t("promptHistoryEmpty"));
    return;
  }
  promptHistoryUi.status.textContent = "";
  for (const item of items) {
    const prompt = String(item.prompt || "").trim();
    if (!prompt) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-history-item";
    button.dataset.prompt = prompt;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", prompt);

    const text = document.createElement("span");
    text.className = "prompt-history-text";
    text.textContent = prompt;
    button.append(text);

    const metaText = promptHistoryMeta(item);
    if (metaText) {
      const meta = document.createElement("span");
      meta.className = "prompt-history-meta";
      meta.textContent = metaText;
      button.append(meta);
    }
    promptHistoryUi.list.append(button);
  }
  if (!promptHistoryUi.list.children.length) {
    renderPromptHistoryStatus(t("promptHistoryEmpty"));
  }
}

function renderPromptHistoryStatus(message) {
  if (!promptHistoryUi) return;
  promptHistoryUi.status.textContent = message;
}

function renderVersionGroups(groups) {
  promptHistoryUi.list.replaceChildren();
  versionBrowserGroups = groups;
  if (!groups.length) {
    renderPromptHistoryStatus(t("versionBrowserEmpty"));
    return;
  }
  promptHistoryUi.status.textContent = "";

  for (const [index, group] of groups.entries()) {
    const section = document.createElement("section");
    section.className = "version-group";

    const header = document.createElement("div");
    header.className = "version-group-header";

    const title = document.createElement("span");
    title.className = "version-group-title";
    title.textContent = versionGroupTitle(group);
    header.append(title);

    const count = document.createElement("span");
    count.className = "version-group-count";
    count.textContent = `${group.count || 0} ${t("versionGroupCount")}`;
    header.append(count);

    const actions = document.createElement("div");
    actions.className = "version-group-actions";

    const compare = document.createElement("button");
    compare.type = "button";
    compare.className = "version-group-action version-group-compare";
    compare.dataset.versionGroupIndex = String(index);
    compare.textContent = t("versionGroupCompare");
    actions.append(compare);

    const annotate = document.createElement("button");
    annotate.type = "button";
    annotate.className = "version-group-action version-group-overlay";
    annotate.dataset.versionGroupOverlayIndex = String(index);
    annotate.textContent = t("versionGroupAnnotate");
    annotate.disabled = !(Array.isArray(group.objects) && group.objects.length >= 2);
    actions.append(annotate);
    header.append(actions);
    section.append(header);

    const objects = Array.isArray(group.objects) ? group.objects : [];
    for (const object of objects) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "version-group-object";
      button.dataset.versionObjectId = object.id;

      if (object.src) {
        const thumb = document.createElement("img");
        thumb.className = "version-group-thumb";
        thumb.src = assetUrl(object.src, object);
        thumb.alt = "";
        thumb.loading = "lazy";
        button.append(thumb);
      } else {
        button.classList.add("no-thumb");
      }

      const body = document.createElement("span");
      body.className = "version-group-object-body";

      const name = document.createElement("span");
      name.className = "version-group-object-name";
      name.textContent = object.name || object.prompt || object.id;
      body.append(name);

      const meta = document.createElement("span");
      meta.className = "version-group-object-meta";
      meta.textContent = versionObjectMeta(object);
      body.append(meta);

      button.append(body);
      section.append(button);
    }
    promptHistoryUi.list.append(section);
  }
}

function compareVersionGroup(index) {
  const objects = canvasObjectsForVersionGroup(index);
  if (!objects.length) return;

  versionDiffOverlay = null;
  closePromptHistoryPanel();
  closeQuickEdit({ keepPrompt: true });
  setLocalSelection(objects.map((object) => object.id), { fromUser: true });
  render();
  frameWorldBounds(boundsForObjects(objects), {
    paddingX: 96,
    paddingTop: 104,
    paddingBottom: 148,
    minZoom: 0.12,
    maxZoom: 1
  });
}

function annotateVersionGroup(index) {
  const objects = canvasObjectsForVersionGroup(index);
  if (objects.length < 2) return;

  closePromptHistoryPanel();
  closeQuickEdit({ keepPrompt: true });
  const ids = objects.map((object) => object.id);
  setLocalSelection(ids, { fromUser: true });
  versionDiffOverlay = { ids };
  render();
  frameWorldBounds(boundsForObjects(objects), {
    paddingX: 104,
    paddingTop: 112,
    paddingBottom: 156,
    minZoom: 0.12,
    maxZoom: 1
  });
}

function canvasObjectsForVersionGroup(index) {
  const group = versionBrowserGroups[index];
  const ids = (Array.isArray(group?.objects) ? group.objects : [])
    .map((object) => object.id)
    .filter(Boolean);
  return ids
    .map((id) => state?.objects.find((object) => object.id === id))
    .filter(Boolean);
}

function versionGroupTitle(group) {
  const value = String(group.value || "").trim();
  if (!value) return group.groupBy || "";
  if (value.length <= 72) return value;
  return `${value.slice(0, 69)}...`;
}

function versionObjectMeta(object) {
  const type = objectTypeLabel(object.type);
  const date = object.createdAt ? new Date(object.createdAt) : null;
  const dateText = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString(language === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" })
    : "";
  return [type, object.layoutMode, object.batchId, dateText].filter(Boolean).join(" · ");
}

function promptHistoryMeta(item) {
  const name = String(item.objectName || "").trim();
  const date = item.createdAt ? new Date(item.createdAt) : null;
  const dateText = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString(language === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" })
    : "";
  return [name, dateText].filter(Boolean).join(" · ");
}

function applyPromptFromHistory(prompt) {
  const nextPrompt = String(prompt || "").trim();
  if (!nextPrompt) return;
  closePromptHistoryPanel();

  if (!quickEditComposer.hidden && quickEditAction !== "edit-text" && !quickEditPrompt.hidden) {
    setQuickEditPromptValue(nextPrompt);
    return;
  }

  const object = state?.objects.find((item) => item.id === selectedId);
  if (object && (object.type || "image") === "image" && hasUserSelection && quickEditAction !== "edit-text") {
    openImageActionComposer("quick-edit");
    window.requestAnimationFrame(() => setQuickEditPromptValue(nextPrompt));
    return;
  }

  copyPromptToClipboard(nextPrompt);
}

function setQuickEditPromptValue(prompt) {
  quickEditPrompt.value = prompt;
  quickEditPrompt.focus();
  quickEditPrompt.setSelectionRange(quickEditPrompt.value.length, quickEditPrompt.value.length);
  showToast(t("promptHistoryApplied"));
}

async function copyPromptToClipboard(prompt) {
  try {
    await navigator.clipboard?.writeText(prompt);
    showToast(t("promptHistoryCopied"));
  } catch {
    showToast(prompt);
  }
}

async function loadState() {
  if (drag || resize || marquee || editingTextId || isComposerActive()) return;
  const response = await fetch(apiPath("/api/state"));
  state = await response.json();
  selectedIds = new Set([...selectedIds].filter((id) => state.objects.some((object) => object.id === id)));
  if (selectedId && !state.objects.some((object) => object.id === selectedId)) {
    selectedId = null;
  }
  if (!hasUserSelection || (!selectedId && selectedIds.size === 0)) {
    selectedIds.clear();
    selectedId = null;
    hasUserSelection = false;
  }
  state.selection = selectedId;
  render();
}

async function loadProjects() {
  const response = await fetch("/api/projects");
  const payload = await response.json();
  registeredProjects = Array.isArray(payload.projects) ? payload.projects : [];
  if (!currentProjectId && registeredProjects.length > 0) {
    currentProjectId = registeredProjects[0].id;
    const url = new URL(window.location.href);
    url.searchParams.set("project", currentProjectId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }
  renderProjectMenu();
}

async function toggleProjectMenu() {
  if (!projectMenu) return;
  if (projectMenu.hidden) {
    await loadProjects().catch(() => {});
    projectMenu.hidden = false;
  } else {
    projectMenu.hidden = true;
  }
}

function renderProjectMenu() {
  if (!projectMenu) return;
  projectMenu.replaceChildren();

  const title = document.createElement("div");
  title.className = "project-menu-title";
  title.textContent = t("switchCanvas");
  projectMenu.append(title);

  for (const project of registeredProjects) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.projectId = project.id;
    button.className = project.id === currentProjectId ? "active" : "";

    const name = document.createElement("span");
    name.className = "project-menu-name";
    name.textContent = project.title || basename(project.projectDir) || project.id;
    button.append(name);

    const pathLabel = document.createElement("span");
    pathLabel.className = "project-menu-path";
    pathLabel.textContent = project.id === currentProjectId ? t("currentCanvas") : project.projectDir;
    button.append(pathLabel);

    button.addEventListener("click", () => switchProject(project));
    projectMenu.append(button);
  }
}

function switchProject(project) {
  const projectId = project?.id || "";
  if (!projectId || projectId === currentProjectId) {
    projectMenu.hidden = true;
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("project", projectId);
  if (project.chatThreadId) url.searchParams.set("threadId", project.chatThreadId);
  else url.searchParams.delete("threadId");
  window.location.href = `${url.pathname}${url.search}`;
}

function createCanvasSearchUi() {
  const panel = document.createElement("section");
  panel.className = "canvas-search";

  const inputWrap = document.createElement("div");
  inputWrap.className = "canvas-search-input-wrap";
  inputWrap.append(createSvgIcon("canvas-search-icon", [
    "M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0",
    "M21 21l-6 -6"
  ]));

  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.className = "canvas-search-input";
  inputWrap.append(input);

  const type = document.createElement("select");
  type.className = "canvas-search-type";
  for (const value of ["", "image", "text", "drawing", "job"]) {
    const option = document.createElement("option");
    option.value = value;
    option.dataset.searchTypeOption = value || "all";
    type.append(option);
  }
  inputWrap.append(type);
  panel.append(inputWrap);

  const results = document.createElement("div");
  results.className = "canvas-search-results";
  results.hidden = true;
  panel.append(results);

  boardShell?.append(panel);
  return { panel, input, type, results };
}

function createSvgIcon(className, paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add(className);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function scheduleCanvasSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runCanvasSearch, searchDebounceMs);
}

async function runCanvasSearch() {
  window.clearTimeout(searchTimer);
  const query = canvasSearch.input.value.trim();
  const type = canvasSearch.type.value;
  const requestId = ++searchRequestId;
  canvasSearch.panel.classList.add("active");

  if (!query) {
    searchResults = [];
    renderCanvasSearchResults([]);
    return;
  }

  try {
    const url = new URL(apiPath("/api/search"), window.location.origin);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "12");
    if (type) url.searchParams.set("type", type);
    const response = await fetch(`${url.pathname}${url.search}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t("searchFailed"));
    if (requestId !== searchRequestId) return;
    searchResults = Array.isArray(payload.results) ? payload.results : [];
    renderCanvasSearchResults(searchResults);
  } catch (error) {
    if (requestId !== searchRequestId) return;
    searchResults = [];
    renderCanvasSearchMessage(error?.message || t("searchFailed"));
  }
}

function renderCanvasSearchResults(results) {
  canvasSearch.results.replaceChildren();
  canvasSearch.results.hidden = false;

  const query = canvasSearch.input.value.trim();
  if (!query) {
    renderCanvasSearchMessage(t("searchHint"));
    return;
  }
  if (!results.length) {
    renderCanvasSearchMessage(t("searchEmpty"));
    return;
  }

  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "canvas-search-result";
    button.dataset.searchResultId = result.id;

    const title = document.createElement("span");
    title.className = "canvas-search-result-title";
    title.textContent = searchResultTitle(result);
    button.append(title);

    const meta = document.createElement("span");
    meta.className = "canvas-search-result-meta";
    meta.textContent = searchResultMeta(result);
    button.append(meta);

    const snippet = searchResultSnippet(result);
    if (snippet) {
      const detail = document.createElement("span");
      detail.className = "canvas-search-result-detail";
      detail.textContent = snippet;
      button.append(detail);
    }

    canvasSearch.results.append(button);
  }
}

function renderCanvasSearchMessage(message) {
  canvasSearch.results.replaceChildren();
  const element = document.createElement("div");
  element.className = "canvas-search-message";
  element.textContent = message;
  canvasSearch.results.append(element);
  canvasSearch.results.hidden = false;
}

async function focusSearchResult(id) {
  const result = searchResults.find((item) => item.id === id);
  let object = state?.objects.find((item) => item.id === id);
  if (!object) {
    await loadState();
    object = state?.objects.find((item) => item.id === id);
  }
  const target = object || result;
  if (!target) {
    showToast(t("searchEmpty"));
    return;
  }

  closeQuickEdit({ keepPrompt: true });
  await selectObject(id, { fromUser: true });
  frameCanvasObject(target);
  closeCanvasSearch({ keepQuery: true });
}

function frameCanvasObject(object) {
  const groupId = object.id ? selectedLayerGroupId() : null;
  const bounds = groupId ? layerGroupBounds(groupId) : boundsForSearchTarget(object);
  frameWorldBounds(bounds, {
    paddingX: 88,
    paddingTop: 104,
    paddingBottom: 148,
    minZoom: 0.16,
    maxZoom: 1.28
  });
}

function boundsForSearchTarget(object) {
  return {
    x: Number.isFinite(object.x) ? object.x : 0,
    y: Number.isFinite(object.y) ? object.y : 0,
    width: Number.isFinite(object.width) && object.width > 0 ? object.width : 1,
    height: Number.isFinite(object.height) && object.height > 0 ? object.height : 1
  };
}

function closeCanvasSearch({ keepQuery = false } = {}) {
  window.clearTimeout(searchTimer);
  canvasSearch.panel.classList.remove("active");
  canvasSearch.results.hidden = true;
  if (!keepQuery) {
    canvasSearch.input.value = "";
    searchResults = [];
    canvasSearch.results.replaceChildren();
  }
}

function searchResultTitle(result) {
  return result.name || result.text || result.prompt || result.id || objectTypeLabel(result.type);
}

function searchResultMeta(result) {
  const type = objectTypeLabel(result.type);
  const fields = Array.isArray(result.matchFields) && result.matchFields.length
    ? result.matchFields.join(", ")
    : "id";
  return `${type} · ${fields}`;
}

function searchResultSnippet(result) {
  const values = [
    result.prompt,
    result.text,
    result.sourcePath,
    result.assetPath,
    result.layerGroupName,
    result.layerGroupKind,
    result.src
  ];
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function render() {
  if (document.activeElement !== projectTitle) {
    projectTitle.value = state.title || "Untitled";
  }
  objectLayer.replaceChildren();
  emptyState.hidden = state.objects.length > 0;
  if (state.viewport && !render.hasLoadedViewport) {
    viewport = {
      x: Number.isFinite(state.viewport.x) ? state.viewport.x : 0,
      y: Number.isFinite(state.viewport.y) ? state.viewport.y : 0,
      zoom: Number.isFinite(state.viewport.zoom) ? state.viewport.zoom : 0.72
    };
    render.hasLoadedViewport = true;
  }
  applyViewport();

  const selectedGroupId = selectedLayerGroupId();
  const visibleSelection = selectedObjectIds();
  for (const object of state.objects) {
    const element = document.createElement("div");
    const objectType = object.type || "image";
    const isSelectedObject = visibleSelection.has(object.id) && !selectedGroupId;
    const isSelectedGroupMember = selectedGroupId && object.layerGroupId === selectedGroupId;
    const isFillingBackground = object.layerGroupKind === "background" && object.layerGroupBackgroundStatus === "filling";
    element.className = `canvas-object ${objectType}-object${object.hasAlpha ? " alpha-image-object" : ""}${isSelectedObject ? " selected" : ""}${isSelectedGroupMember ? " layer-group-member-selected" : ""}${isFillingBackground ? " layer-background-filling" : ""}`;
    element.style.left = `${object.x}px`;
    element.style.top = `${object.y}px`;
    element.style.width = `${object.width}px`;
    element.style.height = `${object.height}px`;
    element.dataset.id = object.id;
    if ((object.type || "image") === "image") {
      applyImageAnnotationMetadata(element, object);
    }

    if (object.type === "drawing") {
      element.append(renderDrawingObject(object));
    } else if (object.type === "text") {
      element.append(renderTextObject(object));
    } else if (object.type === "job") {
      element.append(renderJobObject(object));
    } else {
      element.append(renderImageObject(object));
    }

    if ((object.type || "image") === "image" && object.id === selectedId && selectedIds.size <= 1 && hasUserSelection && !selectedGroupId) {
      const meta = document.createElement("div");
      meta.className = "object-meta";

      const name = document.createElement("span");
      name.className = "object-meta-name";
      name.textContent = object.name || "Image";
      meta.append(name);

      const size = document.createElement("span");
      size.className = "object-meta-size";
      size.textContent = imageSizeLabel(object);
      meta.append(size);

      element.append(meta);
      element.append(renderResizeHandles(object));
      if (cropSession?.objectId === object.id) {
        element.append(renderCropOverlay(object));
      }
    }

    element.addEventListener("pointerdown", (event) => {
      if (activeTool === "pencil") {
        startDrawing(event);
        return;
      }
      if (activeTool === "text") {
        createTextObject(event);
        return;
      }
      const textTarget = event.target.closest(".text-content");
      if (object.type === "text" && editingTextId === object.id && textTarget) {
        if (event.detail >= 2) return;
        textTarget.blur();
        editingTextId = null;
      }
      if ((object.type || "image") === "image" && event.detail >= 2) {
        event.preventDefault();
        event.stopPropagation();
        setLocalSelection([object.id]);
        frameSelectedImageForViewing(object);
        fetch(apiPath("/api/selection"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selection: object.id })
        }).catch(() => {});
        return;
      }
      startDrag(event, object);
    });
    objectLayer.append(element);
  }
  const selectedMemberGroupId = selectedObjectLayerGroupId();
  if (selectedGroupId && hasUserSelection) {
    objectLayer.append(renderLayerGroupSelection(selectedGroupId));
  } else if (selectedMemberGroupId && hasUserSelection) {
    const status = renderLayerGroupBackgroundStatus(selectedMemberGroupId);
    if (status) objectLayer.append(status);
  }
  if (versionDiffOverlay) {
    const overlay = renderVersionDiffOverlay();
    if (overlay) objectLayer.append(overlay);
  }
  const expandPreview = renderExpandPreviewFrame();
  if (expandPreview) objectLayer.append(expandPreview);

  updateSelectionUi();
}

function renderExpandPreviewFrame() {
  if (quickEditAction !== "expand" || quickEditComposer.hidden || !quickEditObjectId) return null;
  const object = state.objects.find((item) => item.id === quickEditObjectId);
  if (!object || (object.type || "image") !== "image") return null;
  const rect = expandPreviewRect(object);
  const frame = document.createElement("div");
  frame.className = "expand-preview-frame";
  frame.style.left = `${rect.x}px`;
  frame.style.top = `${rect.y}px`;
  frame.style.width = `${rect.width}px`;
  frame.style.height = `${rect.height}px`;
  frame.setAttribute("aria-hidden", "true");
  return frame;
}

function renderVersionDiffOverlay() {
  const objects = (versionDiffOverlay?.ids || [])
    .map((id) => state.objects.find((object) => object.id === id))
    .filter(Boolean);
  if (objects.length < 2) {
    versionDiffOverlay = null;
    return null;
  }

  const rawBounds = boundsForObjects(objects);
  const padding = 12;
  const bounds = {
    x: rawBounds.x - padding,
    y: rawBounds.y - padding,
    width: rawBounds.width + padding * 2,
    height: rawBounds.height + padding * 2
  };
  const element = document.createElement("div");
  element.className = "version-diff-overlay";
  element.dataset.versionDiffIds = objects.map((object) => object.id).join(",");
  element.style.left = `${bounds.x}px`;
  element.style.top = `${bounds.y}px`;
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
  const overlayIds = objects.map((object) => object.id);

  const connector = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  connector.classList.add("version-diff-connector");
  connector.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  connector.setAttribute("width", "100%");
  connector.setAttribute("height", "100%");
  connector.setAttribute("aria-hidden", "true");
  for (let index = 1; index < objects.length; index += 1) {
    const previous = objects[index - 1];
    const current = objects[index];
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(previous.x + previous.width / 2 - bounds.x));
    line.setAttribute("y1", String(previous.y + previous.height / 2 - bounds.y));
    line.setAttribute("x2", String(current.x + current.width / 2 - bounds.x));
    line.setAttribute("y2", String(current.y + current.height / 2 - bounds.y));
    connector.append(line);
  }
  element.append(connector);

  const label = document.createElement("div");
  label.className = "version-diff-label";
  label.textContent = `${t("versionDiffLabel")} · ${objects.length} ${t("versionGroupCount")}`;
  element.append(label);

  objects.forEach((object, index) => {
    const box = document.createElement("div");
    box.className = "version-diff-box";
    box.style.left = `${object.x - bounds.x}px`;
    box.style.top = `${object.y - bounds.y}px`;
    box.style.width = `${object.width}px`;
    box.style.height = `${object.height}px`;

    if (index > 0 && (object.type || "image") === "image") {
      const heatmap = document.createElement("canvas");
      heatmap.className = "version-diff-heatmap";
      heatmap.dataset.versionDiffSourceId = objects[0].id;
      heatmap.dataset.versionDiffTargetId = object.id;
      heatmap.setAttribute("aria-hidden", "true");
      box.append(heatmap);
    }
    const badge = document.createElement("span");
    badge.className = "version-diff-index";
    badge.textContent = String(index + 1);
    box.append(badge);
    element.append(box);
  });

  scheduleVersionDiffHeatmaps(overlayIds);
  return element;
}

function scheduleVersionDiffHeatmaps(ids) {
  const token = ++versionDiffHeatmapToken;
  window.requestAnimationFrame(() => {
    populateVersionDiffHeatmaps(ids, token).catch(() => {});
  });
}

async function populateVersionDiffHeatmaps(ids, token) {
  if (!versionDiffOverlay || !sameIdSet(ids, versionDiffOverlay.ids || []) || token !== versionDiffHeatmapToken) return;
  const source = state.objects.find((object) => object.id === ids[0]);
  if (!source || (source.type || "image") !== "image") return;
  const sourceImage = await loadDiffImage(source);
  if (token !== versionDiffHeatmapToken) return;

  const canvases = [...objectLayer.querySelectorAll(".version-diff-heatmap")];
  for (const canvas of canvases) {
    const target = state.objects.find((object) => object.id === canvas.dataset.versionDiffTargetId);
    if (!target || (target.type || "image") !== "image") continue;
    try {
      const targetImage = await loadDiffImage(target);
      if (token !== versionDiffHeatmapToken) return;
      drawVersionDiffHeatmap(canvas, sourceImage, targetImage);
    } catch {
      canvas.hidden = true;
    }
  }
}

function loadDiffImage(object) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = assetUrl(object.src, object);
    if (image.complete && image.naturalWidth > 0) resolve(image);
  });
}

function drawVersionDiffHeatmap(canvas, sourceImage, targetImage) {
  const width = Math.max(1, Math.min(192, targetImage.naturalWidth || sourceImage.naturalWidth || 1));
  const height = Math.max(1, Math.min(192, targetImage.naturalHeight || sourceImage.naturalHeight || 1));
  const sourceCanvas = document.createElement("canvas");
  const targetCanvas = document.createElement("canvas");
  sourceCanvas.width = targetCanvas.width = canvas.width = width;
  sourceCanvas.height = targetCanvas.height = canvas.height = height;

  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const targetContext = targetCanvas.getContext("2d", { willReadFrequently: true });
  const heatmapContext = canvas.getContext("2d");
  sourceContext.drawImage(sourceImage, 0, 0, width, height);
  targetContext.drawImage(targetImage, 0, 0, width, height);

  const sourcePixels = sourceContext.getImageData(0, 0, width, height);
  const targetPixels = targetContext.getImageData(0, 0, width, height);
  const heatmapPixels = heatmapContext.createImageData(width, height);
  let changedPixels = 0;
  for (let index = 0; index < sourcePixels.data.length; index += 4) {
    const delta = Math.abs(sourcePixels.data[index] - targetPixels.data[index])
      + Math.abs(sourcePixels.data[index + 1] - targetPixels.data[index + 1])
      + Math.abs(sourcePixels.data[index + 2] - targetPixels.data[index + 2])
      + Math.abs(sourcePixels.data[index + 3] - targetPixels.data[index + 3]);
    if (delta <= 28) continue;
    changedPixels += 1;
    const strength = Math.min(255, 88 + Math.round(delta / 3));
    heatmapPixels.data[index] = 217;
    heatmapPixels.data[index + 1] = delta > 240 ? 48 : 132;
    heatmapPixels.data[index + 2] = 37;
    heatmapPixels.data[index + 3] = strength;
  }
  heatmapContext.clearRect(0, 0, width, height);
  heatmapContext.putImageData(heatmapPixels, 0, 0);
  canvas.hidden = changedPixels === 0;
  canvas.dataset.changedPixels = String(changedPixels);
  canvas.dataset.changedRatio = String(changedPixels / Math.max(1, width * height));
}

function renderLayerGroupSelection(groupId) {
  const bounds = layerGroupBounds(groupId);
  const anchor = layerGroupMembers(groupId)[0];
  const element = document.createElement("div");
  element.className = "layer-group-selection";
  element.dataset.layerGroupId = groupId;
  element.style.left = `${bounds.x}px`;
  element.style.top = `${bounds.y}px`;
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;

  const label = document.createElement("div");
  label.className = "layer-group-label";
  label.textContent = `${layerGroupLabel(groupId)} · ${layerGroupMembers(groupId).length} layers${layerGroupBackgroundLabel(groupId)}`;
  if (anchor) {
    label.addEventListener("pointerdown", (event) => startDrag(event, anchor, { forceGroup: true }));
  }
  element.append(label);
  return element;
}

function renderLayerGroupBackgroundStatus(groupId) {
  const status = layerGroupBackgroundStatus(groupId);
  if (!status || status === "ready") return null;
  const bounds = layerGroupBounds(groupId);
  const element = document.createElement("div");
  element.className = `layer-group-status layer-group-status-${status}`;
  element.dataset.layerGroupId = groupId;
  element.style.left = `${bounds.x}px`;
  element.style.top = `${bounds.y}px`;
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;

  const label = document.createElement("div");
  label.className = "layer-group-status-label";
  const spinner = document.createElement("span");
  spinner.className = "layer-group-status-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = status === "failed"
    ? (language === "zh" ? "背景补全失败" : "Background fill failed")
    : (language === "zh" ? "背景补全中" : "Filling background");
  label.append(spinner, text);
  element.append(label);
  return element;
}

function updateLayerGroupSelectionElement(groupId) {
  if (!groupId) return;
  const element = objectLayer.querySelector(`.layer-group-selection[data-layer-group-id="${CSS.escape(groupId)}"], .layer-group-status[data-layer-group-id="${CSS.escape(groupId)}"]`);
  if (!element) return;
  const bounds = layerGroupBounds(groupId);
  element.style.left = `${bounds.x}px`;
  element.style.top = `${bounds.y}px`;
  element.style.width = `${bounds.width}px`;
  element.style.height = `${bounds.height}px`;
}

function renderDrawingObject(object) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("drawing-content");
  svg.setAttribute("viewBox", `0 0 ${object.width} ${object.height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathForPoints(object.points || []));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", object.stroke || "#202124");
  path.setAttribute("stroke-width", object.strokeWidth || 4);
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function renderTextObject(object) {
  const text = document.createElement("div");
  text.className = "text-content";
  text.textContent = object.text || "Text";
  text.contentEditable = String(editingTextId === object.id);
  text.spellcheck = false;
  text.style.fontSize = `${object.fontSize || 28}px`;
  text.style.color = object.color || "#202124";
  text.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    editingTextId = object.id;
    setLocalSelection([object.id], { fromUser: true });
    render();
    focusTextObject(object.id);
  });
  text.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      text.blur();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      text.blur();
    }
  });
  text.addEventListener("blur", () => {
    editingTextId = null;
    saveTextObject(object.id, text.textContent || "Text");
  });
  return text;
}

function renderJobObject(object) {
  const shell = document.createElement("div");
  const failed = object.status === "failed";
  shell.className = `job-content ${failed ? "failed" : "running"}`;
  if (failed) shell.title = object.error || "Image job failed.";

  if (object.src) {
    const image = document.createElement("img");
    image.className = "job-preview-image";
    image.src = assetUrl(object.src, object);
    image.alt = "";
    image.draggable = false;
    shell.append(image);
  }

  if (failed) {
    const badge = document.createElement("div");
    badge.className = "job-failed-badge";
    badge.textContent = "!";
    shell.append(badge);

    const message = document.createElement("div");
    message.className = "job-error-message";
    message.textContent = object.error || "Image job failed.";
    shell.append(message);
  } else {
    const ripple = document.createElement("div");
    ripple.className = "job-ripple";
    shell.append(ripple);

    const sheen = document.createElement("div");
    sheen.className = "job-sheen";
    shell.append(sheen);
  }
  return shell;
}

function renderImageObject(object) {
  const frame = document.createElement("div");
  frame.className = "image-content";

  const image = document.createElement("img");
  const label = imageAnnotationLabel(object);
  image.src = assetUrl(object.src, object);
  image.alt = object.name || "Canvas image";
  image.title = label;
  image.setAttribute("aria-label", label);
  image.dataset.objectId = object.id;
  if (object.assetPath) image.dataset.fileMention = `@${object.assetPath}`;
  if (object.assetPath) image.dataset.assetPath = object.assetPath;
  if (object.sourcePath) image.dataset.sourcePath = object.sourcePath;
  image.draggable = false;
  applyImageCrop(image, object);
  frame.append(image);
  return frame;
}

function applyImageAnnotationMetadata(element, object) {
  const label = imageAnnotationLabel(object);
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", label);
  element.title = label;
  element.dataset.objectName = object.name || "Canvas image";
  if (object.assetPath) element.dataset.fileMention = `@${object.assetPath}`;
  if (object.assetPath) element.dataset.assetPath = object.assetPath;
  if (object.sourcePath) element.dataset.sourcePath = object.sourcePath;
}

function imageAnnotationLabel(object) {
  const parts = [
    `Codex-Canvas image`,
    `name: ${object.name || "Image"}`,
    `objectId: ${object.id}`,
    imageSizeLabel(object) ? `size: ${imageSizeLabel(object)}` : "",
    object.assetPath ? `@file: ${object.assetPath}` : "",
    object.sourcePath ? `source: ${object.sourcePath}` : ""
  ].filter(Boolean);
  return parts.join(" | ");
}

function applyImageCrop(image, object) {
  const crop = normalizedCrop(object);
  if (!crop) return;
  image.classList.add("cropped-image");
  image.style.width = `${100 / crop.width}%`;
  image.style.height = `${100 / crop.height}%`;
  image.style.transform = `translate(${-crop.x * 100}%, ${-crop.y * 100}%)`;
}

function normalizedCrop(object) {
  const crop = object?.crop;
  if (!crop || typeof crop !== "object") return null;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const left = clamp(x, 0, 0.98);
  const top = clamp(y, 0, 0.98);
  const right = clamp(left + width, left + 0.01, 1);
  const bottom = clamp(top + height, top + 0.01, 1);
  if (left <= 0.0001 && top <= 0.0001 && right >= 0.9999 && bottom >= 0.9999) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function renderCropOverlay(object) {
  const overlay = document.createElement("div");
  overlay.className = "crop-overlay";
  overlay.addEventListener("pointerdown", (event) => event.stopPropagation());

  const box = cropSessionBoxFor(object);
  for (const [className, style] of cropScrimRects(object, box)) {
    const scrim = document.createElement("div");
    scrim.className = `crop-scrim ${className}`;
    Object.assign(scrim.style, style);
    overlay.append(scrim);
  }

  const cropBox = document.createElement("div");
  cropBox.className = "crop-box";
  cropBox.style.left = `${box.x}px`;
  cropBox.style.top = `${box.y}px`;
  cropBox.style.width = `${box.width}px`;
  cropBox.style.height = `${box.height}px`;
  cropBox.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, .crop-handle")) return;
    startCropDrag(event, "move");
  });

  for (const direction of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const handle = document.createElement("div");
    handle.className = `crop-handle crop-${direction}`;
    handle.dataset.crop = direction;
    handle.addEventListener("pointerdown", (event) => startCropDrag(event, direction));
    cropBox.append(handle);
  }

  const actions = document.createElement("div");
  actions.className = "crop-actions";
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = t("cropApply");
  apply.addEventListener("click", applyCropSession);
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-action";
  cancel.textContent = t("cancel");
  cancel.addEventListener("click", cancelCropSession);
  actions.append(cancel, apply);
  cropBox.append(actions);
  overlay.append(cropBox);
  return overlay;
}

function cropScrimRects(object, box) {
  return [
    ["top", { left: "0px", top: "0px", width: `${object.width}px`, height: `${box.y}px` }],
    ["right", { left: `${box.x + box.width}px`, top: `${box.y}px`, width: `${object.width - box.x - box.width}px`, height: `${box.height}px` }],
    ["bottom", { left: "0px", top: `${box.y + box.height}px`, width: `${object.width}px`, height: `${object.height - box.y - box.height}px` }],
    ["left", { left: "0px", top: `${box.y}px`, width: `${box.x}px`, height: `${box.height}px` }]
  ];
}

function cropSessionBoxFor(object) {
  if (!cropSession || cropSession.objectId !== object.id) return defaultCropBox(object);
  return clampCropBox(cropSession.box, object);
}

function defaultCropBox(object) {
  const insetX = Math.round(Math.min(42, Math.max(12, object.width * 0.12)));
  const insetY = Math.round(Math.min(42, Math.max(12, object.height * 0.12)));
  return clampCropBox({
    x: insetX,
    y: insetY,
    width: object.width - insetX * 2,
    height: object.height - insetY * 2
  }, object);
}

function renderResizeHandles(object) {
  const fragment = document.createDocumentFragment();
  for (const direction of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const handle = document.createElement("div");
    handle.className = `resize-handle resize-${direction}`;
    handle.dataset.resize = direction;
    handle.title = "Resize image";
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (event) => startResize(event, object, direction));
    fragment.append(handle);
  }
  return fragment;
}

function startDrag(event, object, options = {}) {
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget;
  const isExpandPreviewDrag = quickEditAction === "expand"
    && quickEditObjectId === object.id
    && !quickEditComposer.hidden
    && !options.forceGroup;
  const isMultiSelectionDrag = !options.forceGroup && selectedIds.size > 1 && selectedIds.has(object.id);
  const useLayerGroup = object.layerGroupId && (options.forceGroup || object.layerGroupLocked);
  const groupMembers = useLayerGroup ? layerGroupMembers(object.layerGroupId) : [];
  const multiMembers = isMultiSelectionDrag ? selectedObjects() : [];
  if (element.setPointerCapture) {
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Continue with window-level pointer listeners if capture is unavailable.
    }
  }
  if (!isMultiSelectionDrag) {
    setLocalSelection([object.id], { fromUser: true });
  }
  element.classList.add("selected", "dragging");
  drag = {
    id: object.id,
    groupId: useLayerGroup ? object.layerGroupId : null,
    expandPreview: isExpandPreviewDrag ? {
      frame: expandPreviewRect(object)
    } : null,
    multiIds: isMultiSelectionDrag ? multiMembers.map((item) => item.id) : [],
    multiMembers: multiMembers.map((item) => ({ id: item.id, x: item.x, y: item.y })),
    members: groupMembers.map((item) => ({ id: item.id, x: item.x, y: item.y })),
    element,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    objectX: object.x,
    objectY: object.y
  };
  updateSelectionUi();
  fetch(apiPath("/api/selection"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: selectedId })
  }).catch(() => {});

  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag, { once: true });
  window.addEventListener("pointercancel", endDrag, { once: true });
}

function moveDrag(event) {
  if (!drag) return;
  const dx = Math.round((event.clientX - drag.startX) / viewport.zoom);
  const dy = Math.round((event.clientY - drag.startY) / viewport.zoom);
  if (drag.expandPreview) {
    const object = state.objects.find((item) => item.id === drag.id);
    if (!object) return;
    const frame = drag.expandPreview.frame;
    object.x = clamp(Math.round(drag.objectX + dx), frame.x, frame.x + frame.width - object.width);
    object.y = clamp(Math.round(drag.objectY + dy), frame.y, frame.y + frame.height - object.height);
    drag.element.style.left = `${object.x}px`;
    drag.element.style.top = `${object.y}px`;
  } else if (drag.multiMembers?.length) {
    for (const memberStart of drag.multiMembers) {
      const member = state.objects.find((item) => item.id === memberStart.id);
      if (!member) continue;
      member.x = memberStart.x + dx;
      member.y = memberStart.y + dy;
      const memberElement = objectLayer.querySelector(`[data-id="${member.id}"]`);
      if (memberElement) {
        memberElement.style.left = `${member.x}px`;
        memberElement.style.top = `${member.y}px`;
      }
    }
  } else if (drag.groupId) {
    for (const memberStart of drag.members) {
      const member = state.objects.find((item) => item.id === memberStart.id);
      if (!member) continue;
      member.x = memberStart.x + dx;
      member.y = memberStart.y + dy;
      const memberElement = objectLayer.querySelector(`[data-id="${member.id}"]`);
      if (memberElement) {
        memberElement.style.left = `${member.x}px`;
        memberElement.style.top = `${member.y}px`;
      }
    }
  } else {
    const object = state.objects.find((item) => item.id === drag.id);
    if (!object) return;
    object.x = Math.round(drag.objectX + dx);
    object.y = Math.round(drag.objectY + dy);
    drag.element.style.left = `${object.x}px`;
    drag.element.style.top = `${object.y}px`;
  }
  updateLayerGroupSelectionElement(drag.groupId || selectedLayerGroupId());
  updateVersionDiffOverlayElement();
  updateExpandPreviewElement();
  updateSelectionUi();
}

function updateExpandPreviewElement() {
  const element = objectLayer.querySelector(".expand-preview-frame");
  if (!element) return;
  const nextElement = renderExpandPreviewFrame();
  if (nextElement) element.replaceWith(nextElement);
  else element.remove();
}

function updateVersionDiffOverlayElement() {
  const element = objectLayer.querySelector(".version-diff-overlay");
  if (!element) return;
  versionDiffHeatmapToken += 1;
  const nextElement = renderVersionDiffOverlay();
  if (nextElement) element.replaceWith(nextElement);
  else element.remove();
}

async function endDrag(event) {
  window.removeEventListener("pointermove", moveDrag);
  window.removeEventListener("pointerup", endDrag);
  window.removeEventListener("pointercancel", endDrag);
  if (!drag) return;
  const activeDrag = drag;
  const object = state.objects.find((item) => item.id === activeDrag.id);
  const element = activeDrag.element;
  element.classList.remove("dragging");
  if (element.releasePointerCapture) {
    try {
      element.releasePointerCapture(activeDrag.pointerId);
    } catch {
      // Pointer capture may already be gone after cancellation.
    }
  }
  drag = null;
  if (activeDrag.expandPreview) {
    updateExpandPreviewPosition();
    updateSelectionUi();
  } else if (activeDrag.multiMembers?.length) {
    await Promise.all(activeDrag.multiIds.map((id) => {
      const member = state.objects.find((item) => item.id === id);
      if (!member) return Promise.resolve();
      return fetch(apiPath(`/api/objects/${member.id}`), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x: member.x, y: member.y })
      }).catch(() => {});
    }));
    render();
  } else if (activeDrag.groupId) {
    await patchLayerGroupMembersSequentially(layerGroupMembers(activeDrag.groupId), (member) => ({ x: member.x, y: member.y }));
    render();
  } else if (object) {
    await fetch(apiPath(`/api/objects/${object.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: object.x, y: object.y })
    });
    render();
  }
}

function startResize(event, object, direction) {
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget.closest(".canvas-object");
  setLocalSelection([object.id], { fromUser: true });
  element?.classList.add("resizing");
  resize = {
    id: object.id,
    element,
    direction,
    startX: event.clientX,
    startY: event.clientY,
    objectX: object.x,
    objectY: object.y,
    objectWidth: object.width,
    objectHeight: object.height,
    aspectRatio: object.width / Math.max(1, object.height),
    anchorX: direction.includes("w") ? object.x + object.width : object.x,
    anchorY: direction.includes("n") ? object.y + object.height : object.y
  };
  fetch(apiPath("/api/selection"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: object.id })
  }).catch(() => {});

  window.addEventListener("pointermove", moveResize);
  window.addEventListener("pointerup", endResize, { once: true });
  window.addEventListener("pointercancel", endResize, { once: true });
}

function moveResize(event) {
  if (!resize) return;
  const object = state.objects.find((item) => item.id === resize.id);
  if (!object) return;

  const dx = (event.clientX - resize.startX) / viewport.zoom;
  const dy = (event.clientY - resize.startY) / viewport.zoom;
  const next = resizedImageRect(resize, dx, dy);
  Object.assign(object, next);

  if (resize.element) {
    resize.element.style.left = `${object.x}px`;
    resize.element.style.top = `${object.y}px`;
    resize.element.style.width = `${object.width}px`;
    resize.element.style.height = `${object.height}px`;
  }
  updateSelectionUi();
}

async function endResize() {
  window.removeEventListener("pointermove", moveResize);
  window.removeEventListener("pointerup", endResize);
  window.removeEventListener("pointercancel", endResize);
  if (!resize) return;
  const object = state.objects.find((item) => item.id === resize.id);
  resize.element?.classList.remove("resizing");
  resize = null;
  if (object) {
    await fetch(apiPath(`/api/objects/${object.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: object.x, y: object.y, width: object.width, height: object.height })
    }).catch(() => {});
    render();
  }
}

function resizedImageRect(start, dx, dy) {
  const direction = start.direction;
  const minSize = 48;
  const ratio = Number.isFinite(start.aspectRatio) && start.aspectRatio > 0 ? start.aspectRatio : 1;
  let width = start.objectWidth;
  let height = start.objectHeight;

  if (direction.includes("e")) width = start.objectWidth + dx;
  if (direction.includes("w")) width = start.objectWidth - dx;
  if (direction.includes("s")) height = start.objectHeight + dy;
  if (direction.includes("n")) height = start.objectHeight - dy;

  const widthFromHeight = height * ratio;
  const heightFromWidth = width / ratio;
  if (direction.length === 1 && (direction === "n" || direction === "s")) {
    width = widthFromHeight;
  } else if (direction.length === 1) {
    height = heightFromWidth;
  } else if (Math.abs(width - start.objectWidth) / Math.max(1, start.objectWidth) >= Math.abs(height - start.objectHeight) / Math.max(1, start.objectHeight)) {
    height = heightFromWidth;
  } else {
    width = widthFromHeight;
  }

  width = Math.max(minSize, width);
  height = width / ratio;
  if (height < minSize) {
    height = minSize;
    width = height * ratio;
  }
  width = Math.round(width);
  height = Math.round(height);

  let x = start.objectX;
  let y = start.objectY;
  if (direction.includes("w")) x = start.anchorX - width;
  else if (direction.includes("e")) x = start.anchorX;
  else x = start.objectX + (start.objectWidth - width) / 2;

  if (direction.includes("n")) y = start.anchorY - height;
  else if (direction.includes("s")) y = start.anchorY;
  else y = start.objectY + (start.objectHeight - height) / 2;

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height
  };
}

function startCropMode() {
  const object = state.objects.find((item) => item.id === selectedId);
  if (!object || (object.type || "image") !== "image" || !hasUserSelection) return;
  closeQuickEdit({ keepPrompt: true });
  cropSession = {
    objectId: object.id,
    box: defaultCropBox(object)
  };
  render();
}

function cancelCropSession(event) {
  event?.preventDefault();
  event?.stopPropagation();
  cropSession = null;
  cropDrag = null;
  render();
}

async function applyCropSession(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (!cropSession) return;
  const object = state.objects.find((item) => item.id === cropSession.objectId);
  if (!object) {
    cancelCropSession();
    return;
  }

  const box = clampCropBox(cropSession.box, object);
  const previousCrop = normalizedCrop(object) || { x: 0, y: 0, width: 1, height: 1 };
  const crop = normalizeCropPatch({
    x: previousCrop.x + previousCrop.width * (box.x / object.width),
    y: previousCrop.y + previousCrop.height * (box.y / object.height),
    width: previousCrop.width * (box.width / object.width),
    height: previousCrop.height * (box.height / object.height)
  });

  try {
    const dataUrl = await renderCroppedImageDataUrl(object, crop);
    const croppedWidth = Math.max(1, Math.round(box.width));
    const croppedHeight = Math.max(1, Math.round(box.height));
    const response = await fetch(apiPath("/api/images"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dataUrl,
        name: croppedImageName(object),
        prompt: `Cropped from ${object.name || object.id}`,
        layoutMode: "canvas-row",
        sourceObjectId: object.id,
        x: Math.round(object.x + object.width + 72),
        y: Math.round(object.y),
        width: croppedWidth,
        height: croppedHeight
      })
    });
    const croppedObject = await response.json();
    if (!response.ok) throw new Error(croppedObject.error || t("jobFailed"));
    cropSession = null;
    cropDrag = null;
    setLocalSelection([croppedObject.id], { fromUser: true });
    await loadState();
  } catch (error) {
    showToast(error?.message || t("jobFailed"));
  }
}

async function renderCroppedImageDataUrl(object, crop) {
  const image = await loadImageForCanvas(assetUrl(object.src, object));
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sourceX = Math.round(crop.x * sourceWidth);
  const sourceY = Math.round(crop.y * sourceHeight);
  const sourceCropWidth = Math.max(1, Math.round(crop.width * sourceWidth));
  const sourceCropHeight = Math.max(1, Math.round(crop.height * sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sourceCropWidth;
  canvas.height = sourceCropHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("jobFailed"));
  context.drawImage(image, sourceX, sourceY, sourceCropWidth, sourceCropHeight, 0, 0, sourceCropWidth, sourceCropHeight);
  return canvas.toDataURL("image/png");
}

function loadImageForCanvas(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("jobFailed")));
    image.src = src;
  });
}

function croppedImageName(object) {
  const name = String(object.name || "cropped-image").trim() || "cropped-image";
  const withoutExtension = name.replace(/\.[a-z0-9]{2,5}$/i, "");
  return `${withoutExtension}-crop.png`;
}

function normalizeCropPatch(crop) {
  const left = clamp(crop.x, 0, 0.98);
  const top = clamp(crop.y, 0, 0.98);
  const right = clamp(left + crop.width, left + 0.01, 1);
  const bottom = clamp(top + crop.height, top + 0.01, 1);
  return {
    x: Number(left.toFixed(4)),
    y: Number(top.toFixed(4)),
    width: Number((right - left).toFixed(4)),
    height: Number((bottom - top).toFixed(4))
  };
}

function startCropDrag(event, direction) {
  if (!cropSession) return;
  event.preventDefault();
  event.stopPropagation();
  const object = state.objects.find((item) => item.id === cropSession.objectId);
  if (!object) return;
  cropDrag = {
    direction,
    objectId: object.id,
    startX: event.clientX,
    startY: event.clientY,
    objectWidth: object.width,
    objectHeight: object.height,
    box: { ...cropSession.box }
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", moveCropDrag);
  window.addEventListener("pointerup", endCropDrag, { once: true });
  window.addEventListener("pointercancel", endCropDrag, { once: true });
}

function moveCropDrag(event) {
  if (!cropDrag || !cropSession) return;
  const object = state.objects.find((item) => item.id === cropDrag.objectId);
  if (!object) return;
  const dx = Math.round((event.clientX - cropDrag.startX) / viewport.zoom);
  const dy = Math.round((event.clientY - cropDrag.startY) / viewport.zoom);
  cropSession.box = cropBoxFromDrag(cropDrag, dx, dy);
  updateCropOverlayElement(object);
}

function endCropDrag() {
  window.removeEventListener("pointermove", moveCropDrag);
  window.removeEventListener("pointerup", endCropDrag);
  window.removeEventListener("pointercancel", endCropDrag);
  cropDrag = null;
}

function cropBoxFromDrag(start, dx, dy) {
  const direction = start.direction;
  const box = { ...start.box };
  if (direction === "move") {
    box.x += dx;
    box.y += dy;
    return clampCropBox(box, { width: start.objectWidth, height: start.objectHeight });
  }
  if (direction.includes("w")) {
    box.x += dx;
    box.width -= dx;
  }
  if (direction.includes("e")) box.width += dx;
  if (direction.includes("n")) {
    box.y += dy;
    box.height -= dy;
  }
  if (direction.includes("s")) box.height += dy;
  return clampCropBox(box, { width: start.objectWidth, height: start.objectHeight });
}

function clampCropBox(box, object) {
  const minSize = Math.min(48, Math.max(24, Math.floor(Math.min(object.width, object.height) / 2)));
  let width = Math.max(minSize, Math.round(box.width));
  let height = Math.max(minSize, Math.round(box.height));
  width = Math.min(width, Math.max(minSize, object.width));
  height = Math.min(height, Math.max(minSize, object.height));
  const x = clamp(Math.round(box.x), 0, Math.max(0, object.width - width));
  const y = clamp(Math.round(box.y), 0, Math.max(0, object.height - height));
  return { x, y, width, height };
}

function updateCropOverlayElement(object) {
  const element = objectLayer.querySelector(`.canvas-object[data-id="${CSS.escape(object.id)}"] .crop-overlay`);
  if (!element) return;
  element.replaceWith(renderCropOverlay(object));
}

async function selectObject(id, { fromUser = false, renderNow = true } = {}) {
  setLocalSelection(id ? [id] : [], { fromUser });
  if (editingTextId && editingTextId !== id) editingTextId = null;
  if (renderNow) render();
  else updateSelectionUi();
  await fetch(apiPath("/api/selection"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: id })
  });
}

function setLocalSelection(ids, { fromUser = true } = {}) {
  const nextIds = ids.filter(Boolean);
  if (cropSession && (nextIds.length !== 1 || nextIds[0] !== cropSession.objectId)) {
    cropSession = null;
    cropDrag = null;
  }
  if (versionDiffOverlay && !sameIdSet(nextIds, versionDiffOverlay.ids || [])) {
    versionDiffOverlay = null;
  }
  selectedIds = new Set(nextIds);
  selectedId = nextIds.length === 1 ? nextIds[0] : null;
  hasUserSelection = nextIds.length > 0 && fromUser;
  if (state) state.selection = selectedId;
}

function sameIdSet(left, right) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((id) => leftSet.has(id));
}

function selectedObjectIds() {
  if (!hasUserSelection) return new Set();
  if (selectedIds.size) return selectedIds;
  return selectedId ? new Set([selectedId]) : new Set();
}

function selectedObjects() {
  const ids = selectedObjectIds();
  return state?.objects.filter((object) => ids.has(object.id)) || [];
}

function startMarqueeSelection(event) {
  event.preventDefault();
  closeQuickEdit({ keepPrompt: true });
  setLocalSelection([]);
  render();
  board.setPointerCapture(event.pointerId);

  const start = pointerToWorld(event);
  const element = document.createElement("div");
  element.className = "marquee-selection";
  element.hidden = true;
  objectLayer.append(element);

  marquee = {
    pointerId: event.pointerId,
    start,
    current: start,
    startClientX: event.clientX,
    startClientY: event.clientY,
    element,
    moved: false
  };

  board.addEventListener("pointermove", moveMarqueeSelection);
  board.addEventListener("pointerup", endMarqueeSelection, { once: true });
  board.addEventListener("pointercancel", cancelMarqueeSelection, { once: true });
}

function moveMarqueeSelection(event) {
  if (!marquee) return;
  marquee.current = pointerToWorld(event);
  marquee.moved ||= Math.hypot(event.clientX - marquee.startClientX, event.clientY - marquee.startClientY) > 4;
  const rect = normalizedRect(marquee.start, marquee.current);

  marquee.element.hidden = !marquee.moved;
  marquee.element.style.left = `${rect.x}px`;
  marquee.element.style.top = `${rect.y}px`;
  marquee.element.style.width = `${rect.width}px`;
  marquee.element.style.height = `${rect.height}px`;

  const ids = marquee.moved
    ? state.objects
      .filter((object) => (object.type || "image") === "image" && rectsIntersect(rect, object))
      .map((object) => object.id)
    : [];
  setLocalSelection(ids, { fromUser: true });
  updateSelectionClasses();
  updateSelectionUi();
}

async function endMarqueeSelection() {
  board.removeEventListener("pointermove", moveMarqueeSelection);
  board.removeEventListener("pointercancel", cancelMarqueeSelection);
  if (!marquee) return;
  const activeMarquee = marquee;
  marquee = null;
  activeMarquee.element.remove();
  releaseBoardPointer(activeMarquee.pointerId);
  if (!activeMarquee.moved) setLocalSelection([]);
  render();
  await fetch(apiPath("/api/selection"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: selectedId })
  }).catch(() => {});
}

function cancelMarqueeSelection() {
  board.removeEventListener("pointermove", moveMarqueeSelection);
  if (!marquee) return;
  const activeMarquee = marquee;
  marquee = null;
  activeMarquee.element.remove();
  releaseBoardPointer(activeMarquee.pointerId);
  setLocalSelection([]);
  render();
}

function releaseBoardPointer(pointerId) {
  try {
    board.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already be released by the browser.
  }
}

function updateSelectionClasses() {
  const ids = selectedObjectIds();
  objectLayer.querySelectorAll(".canvas-object").forEach((element) => {
    element.classList.toggle("selected", ids.has(element.dataset.id));
  });
}

function normalizedRect(a, b) {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
}

function rectsIntersect(a, object) {
  return a.x <= object.x + object.width
    && a.x + a.width >= object.x
    && a.y <= object.y + object.height
    && a.y + a.height >= object.y;
}

function updateSelectionUi() {
  const object = state.objects.find((item) => item.id === selectedId);
  const groupId = selectedLayerGroupId();
  const isGroupSelection = Boolean(groupId);

  if (quickEditObjectId) {
    const quickEditObject = state.objects.find((item) => item.id === quickEditObjectId);
    if (!quickEditObject || (quickEditObject.type || "image") !== "image") {
      hideSelectionToolbar();
      closeQuickEdit({ keepPrompt: true });
      return;
    }
    hideSelectionToolbar();
    updateQuickEditPosition();
    return;
  }

  if (cropSession?.objectId === selectedId) {
    hideSelectionToolbar();
    closeQuickEdit({ keepPrompt: true });
    return;
  }

  if (selectedIds.size > 1 || !object || object.type !== "image" || !hasUserSelection) {
    hideSelectionToolbar();
    closeQuickEdit({ keepPrompt: true });
    return;
  }

  updateToolbarForSelection(isGroupSelection);
  if (isGroupSelection) closeQuickEdit({ keepPrompt: true });
  toolbar.hidden = Boolean(quickEditObjectId);
  const bounds = isGroupSelection ? layerGroupBounds(groupId) : boundsForObjects([object]);
  const topLeft = worldToScreen(bounds.x, bounds.y);
  const bottomRight = worldToScreen(bounds.x + bounds.width, bounds.y + bounds.height);
  const toolbarRect = toolbar.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  const objectCenter = (topLeft.x + bottomRight.x) / 2;
  const topSafeArea = 76;
  const aboveTop = topLeft.y - toolbarRect.height - 26;
  const belowTop = bottomRight.y + 16;
  const preferredTop = aboveTop >= topSafeArea ? aboveTop : belowTop;
  const top = clamp(preferredTop, topSafeArea, Math.max(topSafeArea, boardRect.height - toolbarRect.height - 16));
  const left = clamp(objectCenter - toolbarRect.width / 2, 16, Math.max(16, boardRect.width - toolbarRect.width - 16));
  toolbar.style.transform = `translate(${left}px, ${top}px)`;
  updateQuickEditPosition();
}

function hideSelectionToolbar() {
  toolbar.hidden = true;
  toolbar.classList.remove("has-layer-group-actions");
  const groupBreak = toolbar.querySelector("[data-toolbar-group-break]");
  if (groupBreak) groupBreak.hidden = true;
  toolbar.querySelectorAll("[data-action]").forEach((button) => {
    if (groupSelectionActions.has(button.dataset.action)) button.hidden = true;
    button.disabled = false;
  });
}

function startPan(event) {
  event.preventDefault();
  board.classList.add("dragging");
  board.setPointerCapture(event.pointerId);
  pan = {
    startX: event.clientX,
    startY: event.clientY,
    viewportX: viewport.x,
    viewportY: viewport.y
  };
  board.addEventListener("pointermove", movePan);
  board.addEventListener("pointerup", endPan, { once: true });
}

function startDrawing(event) {
  event.preventDefault();
  selectObject(null, { renderNow: false });
  board.classList.add("drawing");
  board.setPointerCapture(event.pointerId);
  const start = pointerToWorld(event);
  const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  preview.classList.add("drawing-preview");
  preview.setAttribute("width", "1");
  preview.setAttribute("height", "1");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", activeColor);
  path.setAttribute("stroke-width", "4");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  preview.append(path);
  objectLayer.append(preview);
  drawing = {
    pointerId: event.pointerId,
    points: [start],
    preview,
    path
  };
  updateDrawingPreview();
  board.addEventListener("pointermove", moveDrawing);
  board.addEventListener("pointerup", endDrawing, { once: true });
  board.addEventListener("pointercancel", cancelDrawing, { once: true });
}

function moveDrawing(event) {
  if (!drawing) return;
  drawing.points.push(pointerToWorld(event));
  updateDrawingPreview();
}

async function endDrawing() {
  board.classList.remove("drawing");
  board.removeEventListener("pointermove", moveDrawing);
  board.removeEventListener("pointercancel", cancelDrawing);
  if (!drawing) return;
  const points = simplifyPoints(drawing.points);
  drawing.preview.remove();
  drawing = null;
  if (points.length < 2) return;

  const bounds = boundsForPoints(points, 10);
  try {
    const object = await createObject({
      type: "drawing",
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      points: points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y })),
      stroke: activeColor,
      strokeWidth: 4
    });
    setLocalSelection([object.id], { fromUser: true });
    render();
    setActiveTool("select");
  } catch (error) {
    showToast(error?.message || t("jobFailed"));
  }
}

function cancelDrawing() {
  board.classList.remove("drawing");
  board.removeEventListener("pointermove", moveDrawing);
  if (!drawing) return;
  drawing.preview.remove();
  drawing = null;
}

function updateDrawingPreview() {
  if (!drawing) return;
  drawing.path.setAttribute("d", pathForPoints(drawing.points));
}

async function createTextObject(event) {
  event.preventDefault();
  const point = pointerToWorld(event);
  try {
    const object = await createObject({
      type: "text",
      text: t("textPlaceholder"),
      x: Math.round(point.x),
      y: Math.round(point.y),
      width: 220,
      height: 54,
      fontSize: 28,
      color: activeColor
    });
    setLocalSelection([object.id], { fromUser: true });
    editingTextId = object.id;
    render();
    focusTextObject(object.id);
    setActiveTool("select");
  } catch (error) {
    showToast(error?.message || t("jobFailed"));
  }
}

async function createObject(payload) {
  const response = await fetch(apiPath("/api/objects"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const object = await response.json();
  if (!response.ok) throw new Error(object.error || t("jobFailed"));
  state.objects.push(object);
  return object;
}

async function deleteSelectedObject() {
  const ids = selectedIds.size ? [...selectedIds] : (selectedId ? [selectedId] : []);
  if (!ids.length) return;
  const previousObjects = [...state.objects];
  const previousSelection = state.selection;
  const previousSelectedIds = new Set(selectedIds);
  const previousSelectedId = selectedId;
  const deletedEntriesFor = (deleteIds) => state.objects
    .map((object, index) => ({ object: cloneCanvasObject(object), index }))
    .filter((entry) => deleteIds.includes(entry.object.id));
  const restoreDeletedState = (error) => {
    state.objects = previousObjects;
    state.selection = previousSelection;
    selectedIds = previousSelectedIds;
    selectedId = previousSelectedId;
    render();
    showToast(error?.message || t("jobFailed"));
  };
  const groupId = ids.length === 1 ? selectedLayerGroupId() : null;
  if (groupId) {
    const members = layerGroupMembers(groupId);
    const memberIds = members.map((object) => object.id);
    const undoEntries = deletedEntriesFor(memberIds);
    setLocalSelection([]);
    editingTextId = null;
    state.objects = state.objects.filter((object) => object.layerGroupId !== groupId);
    state.selection = null;
    render();
    try {
      await deleteObjectsById(memberIds);
      pushUndoAction({
        type: "delete",
        entries: undoEntries,
        selection: previousSelection,
        selectedId: previousSelectedId,
        selectedIds: [...previousSelectedIds]
      });
    } catch (error) {
      restoreDeletedState(error);
    }
    return;
  }
  const undoEntries = deletedEntriesFor(ids);
  setLocalSelection([]);
  editingTextId = null;
  state.objects = state.objects.filter((object) => !ids.includes(object.id));
  render();
  try {
    await deleteObjectsById(ids);
    pushUndoAction({
      type: "delete",
      entries: undoEntries,
      selection: previousSelection,
      selectedId: previousSelectedId,
      selectedIds: [...previousSelectedIds]
    });
  } catch (error) {
    restoreDeletedState(error);
  }
}

function pushUndoAction(action) {
  if (!action?.type || !Array.isArray(action.entries) || action.entries.length === 0) return;
  undoStack.push(action);
  if (undoStack.length > maxUndoStackSize) undoStack.shift();
}

async function undoLastCanvasAction() {
  if (undoInProgress || undoStack.length === 0) return;
  const action = undoStack.pop();
  undoInProgress = true;
  try {
    if (action.type !== "delete") return;
    const response = await fetch(apiPath("/api/objects/restore"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        objects: action.entries,
        selection: action.selection || action.selectedId || null
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || t("jobFailed"));
    const stateResponse = await fetch(apiPath("/api/state"));
    state = await stateResponse.json();
    const restoredIds = new Set((payload.objects || []).map((object) => object.id));
    const nextSelectedIds = (action.selectedIds || []).filter((id) => restoredIds.has(id));
    if (nextSelectedIds.length > 0) {
      setLocalSelection(nextSelectedIds, { fromUser: true });
    } else if (action.selectedId && restoredIds.has(action.selectedId)) {
      setLocalSelection([action.selectedId], { fromUser: true });
    } else {
      setLocalSelection([]);
    }
    render();
  } catch (error) {
    undoStack.push(action);
    showToast(error?.message || t("jobFailed"));
  } finally {
    undoInProgress = false;
  }
}

function cloneCanvasObject(object) {
  return JSON.parse(JSON.stringify(object));
}

async function deleteObjectsById(ids) {
  if (!ids.length) return;
  const response = await fetch(apiPath("/api/objects"), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || t("jobFailed"));
}

async function uploadImageFiles(files) {
  let nextX = null;
  let lastObject = null;
  let lastError = null;

  for (const file of files) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const naturalSize = await readImageFileSize(dataUrl);
      const displaySize = displaySizeForUpload(naturalSize);
      const position = uploadPosition(displaySize, nextX);
      nextX = position.x + displaySize.width + 72;

      const response = await fetch(apiPath("/api/images"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataUrl,
          name: file.name,
          prompt: "Uploaded from local file",
          layoutMode: "manual",
          x: position.x,
          y: position.y,
          width: displaySize.width,
          height: displaySize.height
        })
      });
      const object = await response.json();
      if (!response.ok) throw new Error(object.error || t("uploadFailed"));
      lastObject = object;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastObject) {
    setLocalSelection([lastObject.id], { fromUser: true });
    await loadState();
  }

  if (lastError) showToast(lastError?.message || t("uploadFailed"));
  else if (lastObject) showToast(t("uploadDone"));
}

function isUploadImageCandidate(file) {
  if (String(file.type || "").startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name || "");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error(t("uploadFailed")));
    reader.readAsDataURL(file);
  });
}

function readImageFileSize(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (size) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(size);
    };
    const timeout = window.setTimeout(() => finish(null), 1500);
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = dataUrl;
  });
}

function displaySizeForUpload(size) {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return { width: 360, height: 360 };
  }
  const scale = Math.min(1, uploadMaxDisplaySize / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  };
}

function uploadPosition(size, nextX) {
  const boardRect = board.getBoundingClientRect();
  const center = screenToWorld(boardRect.width / 2, boardRect.height / 2);
  return {
    x: Math.round(Number.isFinite(nextX) ? nextX : center.x - size.width / 2),
    y: Math.round(center.y - size.height / 2)
  };
}

async function startImageJob(action, options = {}) {
  const object = state.objects.find((item) => item.id === selectedId);
  if (!object || (object.type || "image") !== "image") return;

  showToast(`${labelAction(action)} ${t("jobStarted")}`);
  try {
    const response = await fetch(apiPath("/api/jobs"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        objectId: object.id,
        prompt: options.prompt || "",
        ...(action === "expand" && options.expand ? { expand: options.expand } : {})
      })
    });
    const job = await response.json();
    if (!response.ok) {
      showToast(job.error || `${labelAction(action)} ${t("jobFailed")}`);
      return;
    }
    await loadState();
    frameJobPlacement(object.id, job.placeholder || null);
    pollImageJob(job.id);
  } catch (error) {
    showToast(error?.message || `${labelAction(action)} ${t("jobFailed")}`);
  }
}

async function sendSelectedImageToChat() {
  const object = state.objects.find((item) => item.id === selectedId);
  if (!object || (object.type || "image") !== "image") return;

  showToast(t("chatSendStarted"));
  try {
    const response = await fetch(apiPath("/api/chat-turn"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "send-to-chat",
        objectId: object.id
      })
    });
    const result = await response.json();
    if (!response.ok) {
      const fallback = response.status === 409 ? t("chatNotBound") : `${labelAction("send-to-chat")} ${t("jobFailed")}`;
      throw new Error(result.error || fallback);
    }
    showToast(t("chatSendDone"));
  } catch (error) {
    showToast(error?.message || `${labelAction("send-to-chat")} ${t("jobFailed")}`);
  }
}

async function copySelectedFileMention() {
  const object = state.objects.find((item) => item.id === selectedId);
  if (!object || (object.type || "image") !== "image") return;
  const filePath = object.assetPath || object.sourcePath || "";
  if (!filePath) {
    showToast(t("fileMentionCopyFailed"));
    return;
  }

  try {
    await copyTextToClipboard(`@${filePath}`);
    showToast(t("fileMentionCopied"));
  } catch {
    showToast(t("fileMentionCopyFailed"));
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

function openImageActionComposer(action) {
  const object = state.objects.find((item) => item.id === selectedId);
  if (!object || (object.type || "image") !== "image" || !hasUserSelection) return;
  quickEditAction = action;
  quickEditObjectId = object.id;
  quickEditPrompt.placeholder = composerPlaceholder(action);
  configureComposerMode(action, object);
  quickEditComposer.hidden = false;
  updateColorPalette();
  frameObjectForQuickEdit(object, action);
  updateSelectionUi();
  updateQuickEditPosition();
  if (action === "edit-text") {
    startTextRecognition(object.id);
  } else if (action === "expand") {
    window.requestAnimationFrame(() => expandScale?.focus());
  } else {
    window.requestAnimationFrame(() => quickEditPrompt.focus());
  }
}

function closeQuickEdit({ keepPrompt = false, cancelTextSession = true, restoreExpandPreview = true } = {}) {
  const textRecognitionId = quickEditAction === "edit-text" ? activeTextRecognitionId : null;
  if (cancelTextSession && textRecognitionId) {
    if (textRecognitionId.startsWith("text_")) {
      cancelTextRecognitionSession(textRecognitionId);
    } else {
      pendingTextRecognitionCancels.add(textRecognitionId);
    }
  }
  if (restoreExpandPreview && quickEditAction === "expand") {
    restoreExpandPreviewSource();
  }
  quickEditComposer.hidden = true;
  quickEditObjectId = null;
  quickEditAction = null;
  activeTextRecognitionId = null;
  editTextItems = [];
  editTextList.replaceChildren();
  editTextStatus.textContent = "";
  quickEditRun.disabled = false;
  quickEditComposer.classList.remove("edit-text-mode", "quick-edit-mode", "expand-mode");
  expandConfig.frame = null;
  expandConfig.sourceStart = null;
  expandConfig.placement = null;
  if (!keepPrompt) quickEditPrompt.value = "";
  updateColorPalette();
  updateExpandPreview();
}

async function submitQuickEdit() {
  const action = quickEditAction || "quick-edit";
  if (action === "edit-text") {
    await submitEditText();
    return;
  }
  await flushEditingTextObject();
  const prompt = quickEditPrompt.value.trim();
  if (!prompt && action !== "expand") {
    showToast(composerEmptyMessage(action));
    quickEditPrompt.focus();
    return;
  }
  const objectId = quickEditObjectId;
  if (!objectId) return;
  const expandOptions = action === "expand" ? currentExpandOptions() : null;
  setLocalSelection([objectId], { fromUser: true });
  closeQuickEdit();
  await startImageJob(action, {
    prompt,
    expand: expandOptions
  });
}

async function flushEditingTextObject() {
  if (!editingTextId) return;
  const id = editingTextId;
  const element = objectLayer.querySelector(`[data-id="${CSS.escape(id)}"] .text-content`);
  editingTextId = null;
  if (!element) return;
  await saveTextObject(id, element.textContent || t("textPlaceholder"));
}

async function submitEditText() {
  const objectId = quickEditObjectId;
  const sessionId = activeTextRecognitionId;
  if (!objectId || !sessionId) return;
  const changes = editTextItems
    .map((item, index) => ({
      index: index + 1,
      from: item.text,
      to: String(item.editedText || "").trim(),
      location: item.location,
      style: item.style
    }))
    .filter((item) => item.to && item.to !== item.from);
  if (!changes.length) {
    showToast(t("editTextNoChanges"));
    editTextList.querySelector("input")?.focus();
    return;
  }

  setLocalSelection([objectId], { fromUser: true });
  quickEditRun.disabled = true;

  try {
    const response = await fetch(apiPath(`/api/text-recognition/${sessionId}/run`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "edit-text", changes })
    });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || `${labelAction("edit-text")} ${t("jobFailed")}`);
    closeQuickEdit({ cancelTextSession: false });
    await loadState();
    frameJobPlacement(objectId, job.placeholder || null);
    pollEditTextSession(job.id);
  } catch (error) {
    quickEditRun.disabled = false;
    showToast(error?.message || `${labelAction("edit-text")} ${t("jobFailed")}`);
  }
}

function configureComposerMode(action, object = null) {
  const isEditText = action === "edit-text";
  const isExpand = action === "expand";
  quickEditComposer.classList.toggle("edit-text-mode", isEditText);
  quickEditComposer.classList.toggle("expand-mode", isExpand);
  quickEditComposer.classList.toggle("quick-edit-mode", !isEditText && !isExpand);
  editTextPanel.hidden = !isEditText;
  expandPanel.hidden = !isExpand;
  quickEditPrompt.hidden = isEditText || isExpand;
  editTextPanel.querySelector(".edit-text-title").textContent = t("editTextTitle");
  if (isExpand) {
    quickEditPrompt.value = "";
    activeTextRecognitionId = null;
    editTextItems = [];
    editTextList.replaceChildren();
    editTextStatus.textContent = "";
    quickEditRun.disabled = false;
    initializeExpandPreview(object);
    syncExpandControls();
    updateExpandPreview();
    return;
  }
  if (isEditText) {
    quickEditPrompt.value = "";
    editTextItems = [];
    renderEditTextItems("loading");
  } else {
    activeTextRecognitionId = null;
    editTextItems = [];
    editTextList.replaceChildren();
    editTextStatus.textContent = "";
    quickEditRun.disabled = false;
    updateExpandPreview();
  }
}

async function startTextRecognition(objectId) {
  const recognitionToken = `${objectId}:${Date.now()}`;
  activeTextRecognitionId = recognitionToken;
  quickEditRun.disabled = true;
  renderEditTextItems("loading");

  try {
    const response = await fetch(apiPath("/api/text-recognition"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectId })
    });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || t("jobFailed"));
    if (pendingTextRecognitionCancels.delete(recognitionToken) || activeTextRecognitionId !== recognitionToken) {
      cancelTextRecognitionSession(job.id);
      return;
    }
    activeTextRecognitionId = job.id;
    pollTextRecognitionJob(job.id);
  } catch (error) {
    if (activeTextRecognitionId !== recognitionToken) return;
    editTextStatus.textContent = error?.message || t("jobFailed");
    quickEditRun.disabled = true;
  }
}

function cancelTextRecognitionSession(sessionId) {
  fetch(apiPath(`/api/text-recognition/${sessionId}/run`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "edit-text", cancelled: true })
  }).catch(() => {});
}

function pollTextRecognitionJob(jobId) {
  const tick = async () => {
    if (quickEditAction !== "edit-text" || activeTextRecognitionId !== jobId) return;
    try {
      const response = await fetch(apiPath(`/api/text-recognition/${jobId}`));
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "Text recognition request failed.");
      if (job.stage === "ready") {
        editTextItems = (job.items || []).map((item) => ({
          ...item,
          editedText: item.text
        }));
        renderEditTextItems("done");
        return;
      }
      if (job.status === "done") return;
      if (job.status === "failed") {
        editTextItems = [];
        editTextStatus.textContent = `${labelAction("edit-text")} ${t("jobFailed")} ${job.error || ""}`.trim();
        quickEditRun.disabled = true;
        return;
      }
      window.setTimeout(tick, 1800);
    } catch (error) {
      editTextStatus.textContent = error?.message || t("jobFailed");
      quickEditRun.disabled = true;
    }
  };
  window.setTimeout(tick, 900);
}

function pollEditTextSession(jobId) {
  const tick = async () => {
    try {
      const response = await fetch(apiPath(`/api/text-recognition/${jobId}`));
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "Edit Text status request failed.");
      if (job.status === "done") {
        showToast(`${labelAction("edit-text")} ${t("jobDone")}`);
        await loadState();
        return;
      }
      if (job.status === "failed") {
        showToast(`${labelAction("edit-text")} ${t("jobFailed")} ${job.error || ""}`.trim());
        return;
      }
      window.setTimeout(tick, 2500);
    } catch (error) {
      showToast(error?.message || t("jobFailed"));
    }
  };
  window.setTimeout(tick, 2500);
}

function renderEditTextItems(status) {
  editTextList.replaceChildren();
  editTextStatus.textContent = "";

  if (status === "loading") {
    editTextStatus.textContent = t("editTextRecognizing");
    quickEditRun.disabled = true;
    return;
  }

  if (!editTextItems.length) {
    editTextStatus.textContent = t("editTextNoText");
    quickEditRun.disabled = true;
    return;
  }

  editTextItems.forEach((item, index) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = item.editedText || item.text;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${t("editTextTitle")} ${index + 1}`);
    input.addEventListener("input", () => {
      editTextItems[index].editedText = input.value;
      updateEditTextRunState();
    });
    editTextList.append(input);
  });

  updateEditTextRunState();
  window.requestAnimationFrame(() => {
    updateQuickEditPosition();
    editTextList.querySelector("input")?.focus();
  });
}

function updateEditTextRunState() {
  if (quickEditAction !== "edit-text") return;
  quickEditRun.disabled = !editTextItems.some((item) => String(item.editedText || "").trim() && String(item.editedText || "").trim() !== item.text);
}

function syncExpandControls() {
  if (expandScale) expandScale.value = expandConfig.scale || "1";
  if (expandPreset) expandPreset.value = expandConfig.preset || "general";
  updateExpandRatioButtons();
}

function updateExpandRatioButtons() {
  expandRatios?.querySelectorAll("[data-expand-ratio]").forEach((button) => {
    const active = button.dataset.expandRatio === expandConfig.ratio;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function updateExpandPreviewPosition() {
  const object = state?.objects?.find((item) => item.id === quickEditObjectId);
  if (!object || !expandConfig.frame) return;
  expandConfig.placement = expandPlacementForObject(object, expandConfig.frame);
}

function currentExpandOptions() {
  const object = state?.objects?.find((item) => item.id === quickEditObjectId);
  const frame = object ? expandPreviewRect(object) : expandConfig.frame;
  return {
    scale: expandConfig.scale || "1",
    preset: expandConfig.preset || "general",
    ratio: expandConfig.ratio || "original",
    placement: object && frame ? expandPlacementForObject(object, frame) : expandConfig.placement || null
  };
}

function expandPlacementForObject(object, frame) {
  return {
    x: Number(((object.x - frame.x) / Math.max(1, frame.width)).toFixed(5)),
    y: Number(((object.y - frame.y) / Math.max(1, frame.height)).toFixed(5)),
    width: Number((object.width / Math.max(1, frame.width)).toFixed(5)),
    height: Number((object.height / Math.max(1, frame.height)).toFixed(5))
  };
}

function restoreExpandPreviewSource() {
  const start = expandConfig.sourceStart;
  if (!start?.id) return;
  const object = state?.objects?.find((item) => item.id === start.id);
  if (!object) return;
  object.x = start.x;
  object.y = start.y;
  const element = objectLayer.querySelector(`[data-id="${CSS.escape(object.id)}"]`);
  if (element) {
    element.style.left = `${object.x}px`;
    element.style.top = `${object.y}px`;
  }
}

function updateExpandPreview() {
  if (quickEditAction === "expand" && quickEditObjectId && !quickEditComposer.hidden) {
    const object = state?.objects?.find((item) => item.id === quickEditObjectId);
    if (object) {
      if (!expandConfig.frame) expandConfig.frame = expandPreviewRect(object);
      updateExpandPreviewPosition();
      frameObjectForQuickEdit(object, "expand");
    }
  }
  objectLayer.querySelector(".expand-preview-frame")?.remove();
  const frame = renderExpandPreviewFrame();
  if (frame) objectLayer.append(frame);
  updateQuickEditPosition();
}

function composerPlaceholder(action) {
  if (action === "edit-text") return t("editTextPlaceholder");
  if (action === "expand") return t("expandPlaceholder");
  return t("quickEditPlaceholder");
}

function composerEmptyMessage(action) {
  if (action === "edit-text") return t("editTextEmpty");
  if (action === "expand") return t("expandEmpty");
  return t("quickEditEmpty");
}

function isComposerActive() {
  return Boolean(quickEditComposer && !quickEditComposer.hidden && quickEditComposer.contains(document.activeElement));
}

function pollImageJob(jobId) {
  window.clearTimeout(runningJobs.get(jobId));
  const tick = async () => {
    try {
      const response = await fetch(apiPath(`/api/jobs/${jobId}`));
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "Job status request failed.");
      if (job.status === "done") {
        runningJobs.delete(jobId);
        showToast(`${labelAction(job.action)} ${t("jobDone")}`);
        await loadState();
        return;
      }
      if (job.status === "failed") {
        runningJobs.delete(jobId);
        showToast(`${labelAction(job.action)} ${t("jobFailed")} ${job.error || ""}`.trim());
        return;
      }
      runningJobs.set(jobId, window.setTimeout(tick, 2500));
    } catch (error) {
      runningJobs.delete(jobId);
      showToast(error?.message || t("jobFailed"));
    }
  };
  runningJobs.set(jobId, window.setTimeout(tick, 2500));
}

async function saveTextObject(id, text) {
  const object = state.objects.find((item) => item.id === id);
  if (!object) return;
  const nextText = text.trim() || t("textPlaceholder");
  object.text = nextText;
  await fetch(apiPath(`/api/objects/${id}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: nextText })
  }).catch(() => {});
  render();
}

function focusTextObject(id) {
  window.requestAnimationFrame(() => {
    const text = objectLayer.querySelector(`[data-id="${id}"] .text-content`);
    if (!text) return;
    text.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

function frameSelectedImageForViewing(object) {
  if (!object || (object.type || "image") !== "image") return;
  closeQuickEdit({ keepPrompt: true });
  setLocalSelection([object.id], { fromUser: true });
  const groupId = selectedLayerGroupId();
  frameWorldBounds(groupId ? layerGroupBounds(groupId) : boundsForObjects([object]), {
    paddingX: 88,
    paddingTop: 104,
    paddingBottom: 148,
    minZoom: 0.18,
    maxZoom: 1.28
  });
}

function isShortcutEditingTarget(target) {
  if (isEditableTarget(target)) return true;
  return Boolean(target.closest("button, [role='button'], .selection-toolbar, .quick-edit-composer, .settings-menu, .color-palette, .prompt-history-panel, .canvas-search"));
}

function isUndoShortcut(event) {
  if (event.defaultPrevented || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "z") return false;
  return event.metaKey || event.ctrlKey;
}

function isNativeUndoTarget(target) {
  return isEditableTarget(target) || Boolean(target.closest(".quick-edit-composer, .prompt-history-panel, .canvas-search"));
}

function isDeleteEditingTarget(target) {
  if (target.closest("input, textarea")) return true;
  const editableText = target.closest(".text-content[contenteditable='true']");
  return Boolean(editableText && editingTextId === selectedId);
}

function setActiveTool(tool) {
  activeTool = tool || "select";
  toolDock.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === activeTool);
  });
  quickEditMarkupControls?.querySelectorAll("[data-quick-edit-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.quickEditTool === activeTool);
    button.setAttribute("aria-pressed", String(button.dataset.quickEditTool === activeTool));
  });
  board.classList.toggle("tool-pencil", activeTool === "pencil");
  board.classList.toggle("tool-text", activeTool === "text");
  updateColorPalette();
}

function loadToolColor() {
  const stored = localStorage.getItem(toolColorStorageKey);
  return toolColors.includes(stored) ? stored : toolColors[0];
}

function renderColorPalette() {
  renderColorPaletteInto(colorPalette);
  if (quickEditColorPalette) renderColorPaletteInto(quickEditColorPalette);
  updateColorPalette();
}

function renderColorPaletteInto(container) {
  container.replaceChildren();
  for (const color of toolColors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch";
    button.dataset.color = color;
    button.style.setProperty("--swatch-color", color);
    button.title = color;
    button.setAttribute("aria-label", `Use color ${color}`);
    container.append(button);
  }
}

function updateColorPalette() {
  colorPalette.hidden = Boolean(quickEditObjectId) || !(activeTool === "pencil" || activeTool === "text");
  for (const palette of [colorPalette, quickEditColorPalette].filter(Boolean)) {
    palette.querySelectorAll("[data-color]").forEach((button) => {
      button.classList.toggle("active", button.dataset.color === activeColor);
    });
  }
}

async function setActiveColor(color) {
  if (!toolColors.includes(color)) return;
  activeColor = color;
  localStorage.setItem(toolColorStorageKey, activeColor);
  updateColorPalette();
  const object = state?.objects.find((item) => item.id === selectedId);
  if (!object) return;
  if (object.type === "drawing") {
    object.stroke = activeColor;
    await patchObjectColor(object.id, { stroke: activeColor });
    render();
  } else if (object.type === "text") {
    object.color = activeColor;
    await patchObjectColor(object.id, { color: activeColor });
    render();
  }
}

async function patchObjectColor(id, patch) {
  await fetch(apiPath(`/api/objects/${id}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  }).catch(() => {});
}

function loadLanguage() {
  const stored = localStorage.getItem(languageStorageKey);
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function setLanguage(nextLanguage) {
  if (!translations[nextLanguage]) return;
  language = nextLanguage;
  localStorage.setItem(languageStorageKey, language);
  applyLanguage();
}

async function refreshAppUpdateStatus({ checkRemote = false, showToastOnError = false } = {}) {
  appUpdateBusy = true;
  renderAppUpdateStatus({ label: t("updateChecking"), disabled: true });
  try {
    const response = await fetch(apiPath(`/api/app-update${checkRemote ? "?check=1" : ""}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t("updateFailed"));
    appUpdateInfo = payload;
    renderAppUpdateStatus();
  } catch (error) {
    appUpdateInfo = null;
    renderAppUpdateStatus({ label: t("updateUnavailable"), disabled: false });
    if (showToastOnError) showToast(error?.message || t("updateFailed"));
  } finally {
    appUpdateBusy = false;
  }
}

async function runAppUpdate() {
  appUpdateBusy = true;
  renderAppUpdateStatus({ label: t("updateRunning"), disabled: true });
  try {
    const response = await fetch(apiPath("/api/app-update"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || t("updateFailed"));
    appUpdateInfo = payload;
    renderAppUpdateStatus();
    showToast(t("updateDone"));
  } catch (error) {
    renderAppUpdateStatus({ label: t("updateFailed"), disabled: false });
    showToast(error?.message || t("updateFailed"));
  } finally {
    appUpdateBusy = false;
  }
}

function renderAppUpdateStatus(override = null) {
  if (!appUpdateButton || !appVersionValue || !appUpdateStatus || !appUpdateLabel) return;
  const version = appUpdateInfo?.pluginVersion || appUpdateInfo?.version || "...";
  appVersionValue.textContent = version;
  appUpdateButton.disabled = Boolean(override?.disabled);

  if (override) {
    appUpdateLabel.textContent = t("checkUpdates");
    appUpdateStatus.textContent = override.label || "";
    return;
  }

  if (!appUpdateInfo) {
    appUpdateLabel.textContent = t("checkUpdates");
    appUpdateStatus.textContent = "";
    return;
  }

  if (!appUpdateInfo.canUpdate) {
    appUpdateLabel.textContent = t("checkUpdates");
    appUpdateStatus.textContent = t("updateUnavailable");
    return;
  }

  if (appUpdateInfo.updateAvailable) {
    appUpdateLabel.textContent = t("updateNow");
    appUpdateStatus.textContent = t("updateAvailable");
  } else {
    appUpdateLabel.textContent = t("checkUpdates");
    appUpdateStatus.textContent = t("updateCurrent");
  }
}

function applyLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  if (quickEditAction) {
    quickEditPrompt.placeholder = composerPlaceholder(quickEditAction);
    editTextPanel.querySelector(".edit-text-title").textContent = t("editTextTitle");
    if (quickEditAction === "edit-text" && !editTextItems.length && editTextStatus.textContent) {
      editTextStatus.textContent = activeTextRecognitionId ? t("editTextRecognizing") : t("editTextNoText");
    }
  }

  projectOptionsButton.title = t("projectOptions");
  projectOptionsButton.setAttribute("aria-label", t("projectOptions"));
  settingsButton.title = t("settings");
  settingsButton.setAttribute("aria-label", t("settings"));
  board.setAttribute("aria-label", t("codexCanvas"));
  toolDock.setAttribute("aria-label", t("canvasTools"));
  canvasSearch.input.placeholder = t("searchPlaceholder");
  canvasSearch.input.setAttribute("aria-label", t("searchLabel"));
  canvasSearch.type.setAttribute("aria-label", t("searchLabel"));
  canvasSearch.panel.setAttribute("aria-label", t("searchLabel"));
  canvasSearch.type.querySelectorAll("[data-search-type-option]").forEach((option) => {
    option.textContent = option.value ? objectTypeLabel(option.value) : t("searchAllTypes");
  });
  if (canvasSearch.panel.classList.contains("active")) {
    renderCanvasSearchResults(searchResults);
  }
  document.querySelector(".canvas-controls")?.setAttribute("aria-label", t("canvasViewControls"));
  settingsMenu.querySelector("[data-settings-row='language']")?.setAttribute("aria-label", t("language"));
  const currentLanguage = settingsMenu.querySelector("[data-language-current]");
  if (currentLanguage) currentLanguage.textContent = language === "zh" ? "简体中文" : "English";
  renderAppUpdateStatus();
  renderProjectMenu();
  updatePromptHistoryLabels();

  settingsMenu.querySelectorAll("[data-language]").forEach((button) => {
    const isSelected = button.dataset.language === language;
    button.classList.toggle("active", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    const label = actionLabel(button.dataset.action);
    button.dataset.tooltip = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    const span = button.querySelector("span:not(.context-icon)");
    if (span) span.textContent = label;
  });

  document.querySelectorAll("[data-tool]").forEach((button) => {
    const label = toolLabel(button.dataset.tool);
    button.dataset.tooltip = label;
    button.title = label;
    button.setAttribute("aria-label", label);
  });

  document.querySelectorAll("[data-quick-edit-tool]").forEach((button) => {
    const label = toolLabel(button.dataset.quickEditTool);
    button.dataset.tooltip = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(button.dataset.quickEditTool === activeTool));
  });

  document.querySelectorAll("[data-view-action]").forEach((button) => {
    const label = viewActionLabel(button.dataset.viewAction);
    button.dataset.tooltip = label;
    button.title = label;
    button.setAttribute("aria-label", label);
  });

  if (state) updateSelectionUi();
}

function updatePromptHistoryLabels() {
  if (!promptHistoryUi) return;
  const label = t("promptHistory");
  promptHistoryUi.button.title = label;
  promptHistoryUi.button.dataset.tooltip = label;
  promptHistoryUi.button.setAttribute("aria-label", label);
  promptHistoryUi.title.textContent = label;
  promptHistoryUi.search.placeholder = promptHistoryMode === "versions" ? t("versionBrowserSearch") : t("promptHistorySearch");
  promptHistoryUi.search.setAttribute("aria-label", promptHistoryUi.search.placeholder);
  promptHistoryUi.groupByLabel.textContent = t("versionGroupLabel");
  promptHistoryUi.groupByWrap.hidden = promptHistoryMode !== "versions";
  promptHistoryUi.tabs.forEach((tab) => {
    const active = tab.dataset.discoveryMode === promptHistoryMode;
    tab.textContent = tab.dataset.discoveryMode === "versions" ? t("versionBrowserTab") : t("promptHistoryTab");
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.setAttribute("role", "tab");
  });
  const labels = {
    sourceObjectId: t("versionGroupSource"),
    batchId: t("versionGroupBatch"),
    layoutMode: t("versionGroupLayout"),
    prompt: t("versionGroupPrompt")
  };
  promptHistoryUi.groupBy.querySelectorAll("option").forEach((option) => {
    option.textContent = labels[option.value] || option.value;
  });
}

function t(key) {
  return translations[language]?.[key] || translations.en[key] || key;
}

function actionLabel(action) {
  return translations[language].actions[action] || translations.en.actions[action] || action;
}

function toolLabel(tool) {
  return translations[language].tools[tool] || translations.en.tools[tool] || tool;
}

function viewActionLabel(action) {
  if (action === "upload") return translations[language].tools["upload-image"];
  if (action === "reset") return translations[language].controls.reset;
  return action;
}

function objectTypeLabel(type) {
  const key = type || "image";
  return translations[language].objectTypes[key] || translations.en.objectTypes[key] || key;
}

function pointerToWorld(event) {
  const rect = board.getBoundingClientRect();
  return screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
}

function pathForPoints(points) {
  if (!points.length) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`;
}

function simplifyPoints(points) {
  const simplified = [];
  for (const point of points) {
    const previous = simplified.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) {
      simplified.push({ x: Math.round(point.x), y: Math.round(point.y) });
    }
  }
  return simplified;
}

function boundsForPoints(points, padding) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const maxX = Math.max(...xs) + padding;
  const maxY = Math.max(...ys) + padding;
  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY))
  };
}

function isEditableTarget(target) {
  return Boolean(target.closest("input, textarea, [contenteditable='true']"));
}

function movePan(event) {
  if (!pan) return;
  viewport.x = pan.viewportX + event.clientX - pan.startX;
  viewport.y = pan.viewportY + event.clientY - pan.startY;
  applyViewport();
  updateSelectionUi();
}

async function endPan() {
  board.classList.remove("dragging");
  board.removeEventListener("pointermove", movePan);
  pan = null;
  await saveViewport();
}

function scheduleViewportSave() {
  window.clearTimeout(viewportSaveTimer);
  viewportSaveTimer = window.setTimeout(saveViewport, 220);
}

async function saveViewport() {
  if (!state) return;
  state.viewport = viewport;
  await fetch(apiPath("/api/state"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewport })
  }).catch(() => {});
}

function resetViewport() {
  viewport = { x: 0, y: 0, zoom: 0.72 };
  applyViewport();
  updateSelectionUi();
  saveViewport();
}

async function saveProjectTitle() {
  if (!state) return;
  const title = projectTitle.value.trim() || "Untitled";
  projectTitle.value = title;
  state.title = title;
  await fetch(apiPath("/api/state"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  }).catch(() => {});
}

function applyViewport() {
  world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  world.style.setProperty("--resize-handle-size", `${8 / viewport.zoom}px`);
  world.style.setProperty("--resize-handle-offset", `${-4 / viewport.zoom}px`);
  world.style.setProperty("--resize-handle-border", `${1.5 / viewport.zoom}px`);
  world.style.setProperty("--resize-handle-radius", `${2 / viewport.zoom}px`);
  zoomLabel.textContent = `${Math.round(viewport.zoom * 100)}%`;
}

function frameObjectForQuickEdit(object, action = "quick-edit") {
  const boardRect = board.getBoundingClientRect();
  if (action === "expand") {
    const preview = expandPreviewRect(object);
    const panelWidth = Math.min(220, Math.max(180, boardRect.width - 48));
    const sideGap = 18;
    const sideMargins = 56;
    const bottomReserve = 120;
    const availableWidth = Math.max(140, boardRect.width - panelWidth - sideGap - sideMargins);
    const availableHeight = Math.max(140, boardRect.height - 96 - bottomReserve);
    const targetZoom = clamp(
      Math.min(availableWidth / preview.width, availableHeight / preview.height),
      0.08,
      0.9
    );
    const previewScreenWidth = preview.width * targetZoom;
    const previewScreenHeight = preview.height * targetZoom;
    const previewLeft = Math.max(24, Math.round((boardRect.width - panelWidth - sideGap - previewScreenWidth) / 2));
    const previewTop = Math.max(72, Math.round((boardRect.height - bottomReserve - previewScreenHeight) / 2));
    viewport.zoom = targetZoom;
    viewport.x = Math.round(previewLeft - preview.x * targetZoom);
    viewport.y = Math.round(previewTop - preview.y * targetZoom);
    applyViewport();
    scheduleViewportSave();
    return;
  }

  if (action === "edit-text") {
    const panelWidth = Math.min(240, Math.max(180, boardRect.width - 48));
    const sideGap = 16;
    const sideMargins = 48;
    const bottomReserve = 132;
    const availableWidth = Math.max(120, boardRect.width - panelWidth - sideGap - sideMargins);
    const availableHeight = Math.max(140, boardRect.height - 104 - bottomReserve);
    const targetZoom = clamp(
      Math.min(availableWidth / object.width, availableHeight / object.height),
      0.18,
      1.05
    );
    const objectScreenWidth = object.width * targetZoom;
    const objectScreenHeight = object.height * targetZoom;
    const objectLeft = Math.max(24, Math.round((boardRect.width - panelWidth - sideGap - objectScreenWidth) / 2));
    const objectTop = Math.max(72, Math.round((boardRect.height - bottomReserve - objectScreenHeight) / 2));
    viewport.zoom = targetZoom;
    viewport.x = Math.round(objectLeft - object.x * targetZoom);
    viewport.y = Math.round(objectTop - object.y * targetZoom);
    applyViewport();
    scheduleViewportSave();
    return;
  }

  const targetZoom = clamp(
    Math.min((boardRect.width - 96) / object.width, (boardRect.height - 240) / object.height),
    0.18,
    0.9
  );
  const objectCenterX = object.x + object.width / 2;
  viewport.zoom = targetZoom;
  viewport.x = Math.round(boardRect.width / 2 - objectCenterX * targetZoom);
  viewport.y = Math.round(82 - object.y * targetZoom);
  applyViewport();
  scheduleViewportSave();
}

function frameJobPlacement(sourceId, placeholder) {
  const source = state.objects.find((item) => item.id === sourceId);
  const target = placeholder
    ? state.objects.find((item) => item.id === placeholder.id) || placeholder
    : null;
  if (!source || !target) return;
  frameWorldBounds(boundsForObjects([source, target]), {
    paddingX: 96,
    paddingTop: 92,
    paddingBottom: 132,
    maxZoom: 0.9
  });
}

function frameWorldBounds(bounds, options = {}) {
  const boardRect = board.getBoundingClientRect();
  const paddingX = options.paddingX ?? 96;
  const paddingTop = options.paddingTop ?? 96;
  const paddingBottom = options.paddingBottom ?? 120;
  const availableWidth = Math.max(120, boardRect.width - paddingX * 2);
  const availableHeight = Math.max(120, boardRect.height - paddingTop - paddingBottom);
  const targetZoom = clamp(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
    options.minZoom ?? 0.12,
    options.maxZoom ?? 1
  );
  const contentCenterX = bounds.x + bounds.width / 2;
  const contentCenterY = bounds.y + bounds.height / 2;
  const screenCenterY = paddingTop + availableHeight / 2;
  viewport.zoom = targetZoom;
  viewport.x = Math.round(boardRect.width / 2 - contentCenterX * targetZoom);
  viewport.y = Math.round(screenCenterY - contentCenterY * targetZoom);
  applyViewport();
  updateSelectionUi();
  scheduleViewportSave();
}

function boundsForObjects(objects) {
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const right = Math.max(...objects.map((object) => object.x + object.width));
  const bottom = Math.max(...objects.map((object) => object.y + object.height));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function expandPreviewRect(object) {
  if (expandConfig.frame && quickEditAction === "expand" && quickEditObjectId === object.id) {
    return { ...expandConfig.frame };
  }
  const size = expandTargetSize(object.width, object.height, expandConfig.ratio, Number(expandConfig.scale) || 1);
  return {
    x: Math.round(object.x + (object.width - size.width) / 2),
    y: Math.round(object.y + (object.height - size.height) / 2),
    width: size.width,
    height: size.height
  };
}

function initializeExpandPreview(object) {
  if (!object) {
    expandConfig.frame = null;
    expandConfig.sourceStart = null;
    return;
  }
  const previousFrame = expandConfig.frame;
  expandConfig.frame = null;
  const frame = expandPreviewRect(object);
  expandConfig.frame = previousFrame || frame;
  expandConfig.sourceStart = {
    id: object.id,
    x: object.x,
    y: object.y
  };
  expandConfig.placement = expandPlacementForObject(object, expandConfig.frame);
}

function expandTargetSize(width, height, ratio, scale = 1) {
  const targetRatio = ratio === "original" ? width / Math.max(1, height) : ratioToNumber(ratio);
  let targetWidth = width;
  let targetHeight = height;
  const currentRatio = width / Math.max(1, height);
  if (currentRatio < targetRatio) {
    targetWidth = height * targetRatio;
  } else if (currentRatio > targetRatio) {
    targetHeight = width / targetRatio;
  }
  return {
    width: Math.max(1, Math.round(Math.max(width, targetWidth * scale))),
    height: Math.max(1, Math.round(Math.max(height, targetHeight * scale)))
  };
}

function ratioToNumber(ratio) {
  const [left, right] = String(ratio || "1:1").split(":").map(Number);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return 1;
  return left / right;
}

function selectedLayerGroupId() {
  const groupId = selectedObjectLayerGroupId();
  return groupId && isLayerGroupLocked(groupId) ? groupId : null;
}

function selectedObjectLayerGroupId() {
  if (!hasUserSelection || !selectedId || !state?.objects) return null;
  const object = state.objects.find((item) => item.id === selectedId);
  return object?.layerGroupId || null;
}

function layerGroupMembers(groupId) {
  if (!groupId || !state?.objects) return [];
  return state.objects
    .filter((object) => object.layerGroupId === groupId)
    .sort((a, b) => (a.layerGroupIndex || 0) - (b.layerGroupIndex || 0));
}

function layerGroupBounds(groupId) {
  const members = layerGroupMembers(groupId);
  return members.length ? boundsForObjects(members) : { x: 0, y: 0, width: 1, height: 1 };
}

function isLayerGroupLocked(groupId) {
  return layerGroupMembers(groupId).some((member) => member.layerGroupLocked === true);
}

function layerGroupLabel(groupId) {
  const member = layerGroupMembers(groupId)[0];
  return member?.layerGroupName || "Layer group";
}

function layerGroupBackgroundLabel(groupId) {
  const status = layerGroupBackgroundStatus(groupId);
  if (!status || status === "ready") return "";
  if (status === "filling") return language === "zh" ? " · 背景补全中" : " · BG filling";
  if (status === "failed") return language === "zh" ? " · 背景补全失败" : " · BG failed";
  return "";
}

function layerGroupBackgroundStatus(groupId) {
  const background = layerGroupMembers(groupId).find((item) => item.layerGroupKind === "background");
  return background?.layerGroupBackgroundStatus || "";
}

function layerGroupOrigin(groupId) {
  const members = layerGroupMembers(groupId);
  const anchor = members.find((item) => item.layerGroupKind === "background")
    || members.find((item) => item.layerGroupRelativeX === 0 && item.layerGroupRelativeY === 0)
    || members[0];
  if (!anchor) return { x: 0, y: 0 };
  return {
    x: anchor.x - (Number.isFinite(anchor.layerGroupRelativeX) ? anchor.layerGroupRelativeX : 0),
    y: anchor.y - (Number.isFinite(anchor.layerGroupRelativeY) ? anchor.layerGroupRelativeY : 0)
  };
}

function updateToolbarForSelection(isGroupSelection) {
  const selectedGroupMemberId = selectedObjectLayerGroupId();
  toolbar.classList.toggle("has-layer-group-actions", Boolean(selectedGroupMemberId));
  const groupBreak = toolbar.querySelector("[data-toolbar-group-break]");
  if (groupBreak) groupBreak.hidden = !selectedGroupMemberId;
  toolbar.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    if (groupSelectionActions.has(action)) button.hidden = !selectedGroupMemberId;
    if (singleSelectionActions.has(action)) button.hidden = isGroupSelection;
  });
  updateGroupActionButton(isGroupSelection);
  updateLayerOrderButtons();
}

function updateGroupActionButton(isGroupSelection) {
  const button = toolbar.querySelector('[data-action="group-layer-group"]');
  if (!button) return;
  const groupId = selectedObjectLayerGroupId();
  const locked = isGroupSelection && groupId && isLayerGroupLocked(groupId);
  const label = locked
    ? (language === "zh" ? "取消成组" : "Ungroup")
    : actionLabel("group-layer-group");
  button.dataset.tooltip = label;
  button.title = label;
  button.setAttribute("aria-label", label);
  const span = button.querySelector("span:not(.context-icon)");
  if (span) span.textContent = label;
}

function updateLayerOrderButtons() {
  const groupId = selectedObjectLayerGroupId();
  const members = layerGroupMembers(groupId);
  const index = members.findIndex((member) => member.id === selectedId);
  const downButton = toolbar.querySelector('[data-action="layer-down"]');
  const upButton = toolbar.querySelector('[data-action="layer-up"]');
  if (downButton) downButton.disabled = index <= 0;
  if (upButton) upButton.disabled = index < 0 || index >= members.length - 1;
}

function worldToScreen(x, y) {
  return {
    x: viewport.x + x * viewport.zoom,
    y: viewport.y + y * viewport.zoom
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - viewport.x) / viewport.zoom,
    y: (y - viewport.y) / viewport.zoom
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function apiPath(pathname) {
  const url = new URL(pathname, window.location.origin);
  if (currentProjectId) url.searchParams.set("project", currentProjectId);
  if (currentThreadId) url.searchParams.set("threadId", currentThreadId);
  return `${url.pathname}${url.search}`;
}

function assetUrl(src, object = null) {
  if (!src) return "";
  try {
    const url = new URL(src, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/assets/") && currentProjectId) {
      url.searchParams.set("project", currentProjectId);
      if (Number.isFinite(object?.assetVersion)) url.searchParams.set("v", String(object.assetVersion));
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return src;
  }
  return src;
}

function basename(filePath) {
  return String(filePath || "").split(/[\\/]/).filter(Boolean).at(-1) || "";
}

async function downloadSelectedImage() {
  const object = state.objects.find((item) => item.id === selectedId);
  if (!object || (object.type || "image") !== "image" || !object.src) return;
  const groupId = selectedObjectLayerGroupId();
  let href;
  let suggestedName;
  let mimeType;
  if (groupId) {
    href = apiPath(`/api/layer-groups/${encodeURIComponent(groupId)}/psd`);
    suggestedName = `${downloadStem(layerGroupLabel(groupId))}.psd`;
    mimeType = "image/vnd.adobe.photoshop";
  } else {
    href = assetUrl(object.src, object);
    suggestedName = downloadName(object);
    mimeType = mimeTypeForDownloadName(suggestedName);
  }

  try {
    await saveUrlWithPicker(href, suggestedName, mimeType);
  } catch (error) {
    if (error?.name === "AbortError") return;
    showToast(error?.message || t("downloadFailed"));
  }
}

async function saveUrlWithPicker(href, suggestedName, mimeType) {
  if (!("showSaveFilePicker" in window)) {
    fallbackAnchorDownload(href, suggestedName);
    return;
  }

  const response = await fetch(href);
  if (!response.ok) throw new Error(t("downloadFailed"));
  const blob = await response.blob();
  const pickerOptions = {
    suggestedName,
    types: downloadPickerTypes(suggestedName, mimeType)
  };
  const handle = await window.showSaveFilePicker(pickerOptions);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function fallbackAnchorDownload(href, suggestedName) {
  const link = document.createElement("a");
  link.href = href;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadPickerTypes(name, mimeType) {
  const extension = downloadExtension(name);
  return [{
    description: extension === ".psd" ? "Photoshop document" : "Image",
    accept: {
      [mimeType || "application/octet-stream"]: [extension]
    }
  }];
}

function mimeTypeForDownloadName(name) {
  const extension = downloadExtension(name);
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".psd") return "image/vnd.adobe.photoshop";
  return "image/png";
}

function downloadExtension(name) {
  const match = String(name || "").match(/(\.[a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : ".png";
}

function downloadName(object) {
  const name = String(object.name || "canvas-image").trim() || "canvas-image";
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(name);
  return hasExt ? name : `${name}.png`;
}

function downloadStem(name) {
  return String(name || "canvas-image")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "canvas-image";
}

async function resetSelectedLayerGroup() {
  const groupId = selectedObjectLayerGroupId();
  if (!groupId) return;
  const origin = layerGroupOrigin(groupId);
  const members = layerGroupMembers(groupId);
  for (const member of members) {
    const relativeX = Number.isFinite(member.layerGroupRelativeX) ? member.layerGroupRelativeX : member.x - origin.x;
    const relativeY = Number.isFinite(member.layerGroupRelativeY) ? member.layerGroupRelativeY : member.y - origin.y;
    member.x = Math.round(origin.x + relativeX);
    member.y = Math.round(origin.y + relativeY);
    if (Number.isFinite(member.layerGroupOriginalLayerWidth)) member.width = member.layerGroupOriginalLayerWidth;
    if (Number.isFinite(member.layerGroupOriginalLayerHeight)) member.height = member.layerGroupOriginalLayerHeight;
  }
  render();
  await patchLayerGroupMembersSequentially(members, (member) => ({
    x: member.x,
    y: member.y,
    width: member.width,
    height: member.height
  }));
}

async function toggleSelectedLayerGroupLock() {
  const groupId = selectedObjectLayerGroupId();
  if (!groupId) return;
  const members = layerGroupMembers(groupId);
  if (!members.length) return;
  const nextLocked = !isLayerGroupLocked(groupId);
  for (const member of members) {
    member.layerGroupLocked = nextLocked;
  }
  render();
  await patchLayerGroupMembersSequentially(members, () => ({ layerGroupLocked: nextLocked }));
}

async function moveSelectedLayerInGroup(direction) {
  const groupId = selectedObjectLayerGroupId();
  if (!groupId || !selectedId) return;
  const members = layerGroupMembers(groupId);
  const currentIndex = members.findIndex((member) => member.id === selectedId);
  const nextIndex = currentIndex + (direction === "up" ? 1 : -1);
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= members.length) return;

  try {
    const response = await fetch(apiPath(`/api/layer-groups/${encodeURIComponent(groupId)}/reorder`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectId: selectedId, direction })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `${labelAction(direction === "up" ? "layer-up" : "layer-down")} ${t("jobFailed")}`);
    await loadState();
  } catch (error) {
    showToast(error?.message || t("jobFailed"));
  }
}

async function patchLayerGroupMembersSequentially(members, patchForMember) {
  for (const member of members) {
    await fetch(apiPath(`/api/objects/${member.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patchForMember(member))
    }).catch(() => {});
  }
}

function updateQuickEditPosition() {
  if (quickEditComposer.hidden || !quickEditObjectId) return;
  const object = state.objects.find((item) => item.id === quickEditObjectId);
  if (!object) {
    closeQuickEdit();
    return;
  }

  const topLeft = worldToScreen(object.x, object.y);
  const bottomRight = worldToScreen(object.x + object.width, object.y + object.height);
  const boardRect = board.getBoundingClientRect();
  const composerRect = quickEditComposer.getBoundingClientRect();
  const objectCenter = (topLeft.x + bottomRight.x) / 2;

  if (quickEditAction === "edit-text") {
    const gap = 12;
    const margin = 16;
    const maxTop = Math.max(margin, boardRect.height - composerRect.height - 88);
    const maxLeft = Math.max(margin, boardRect.width - composerRect.width - margin);
    const objectBox = {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y
    };
    const candidates = [
      { left: bottomRight.x + gap, top: topLeft.y },
      { left: bottomRight.x + gap, top: bottomRight.y - composerRect.height },
      { left: topLeft.x - composerRect.width - gap, top: topLeft.y },
      { left: topLeft.x - composerRect.width - gap, top: bottomRight.y - composerRect.height },
      { left: objectCenter - composerRect.width / 2, top: bottomRight.y + gap },
      { left: objectCenter - composerRect.width / 2, top: topLeft.y - composerRect.height - gap }
    ].map((candidate, index) => {
      const left = clamp(candidate.left, margin, maxLeft);
      const top = clamp(candidate.top, margin, maxTop);
      const rect = {
        left,
        top,
        right: left + composerRect.width,
        bottom: top + composerRect.height
      };
      return { left, top, index, overlap: rectOverlapArea(rect, objectBox) };
    }).sort((a, b) => a.overlap - b.overlap || a.index - b.index);

    quickEditComposer.style.transform = `translate(${candidates[0].left}px, ${candidates[0].top}px)`;
    return;
  }

  if (quickEditAction === "expand") {
    const preview = expandPreviewRect(object);
    const previewTopLeft = worldToScreen(preview.x, preview.y);
    const previewBottomRight = worldToScreen(preview.x + preview.width, preview.y + preview.height);
    const previewCenter = (previewTopLeft.x + previewBottomRight.x) / 2;
    const gap = 12;
    const margin = 16;
    const maxTop = Math.max(margin, boardRect.height - composerRect.height - 88);
    const maxLeft = Math.max(margin, boardRect.width - composerRect.width - margin);
    const previewBox = {
      left: previewTopLeft.x,
      top: previewTopLeft.y,
      right: previewBottomRight.x,
      bottom: previewBottomRight.y
    };
    const candidates = [
      { left: previewBottomRight.x + gap, top: previewTopLeft.y },
      { left: previewBottomRight.x + gap, top: previewBottomRight.y - composerRect.height },
      { left: previewTopLeft.x - composerRect.width - gap, top: previewTopLeft.y },
      { left: previewTopLeft.x - composerRect.width - gap, top: previewBottomRight.y - composerRect.height },
      { left: previewCenter - composerRect.width / 2, top: previewBottomRight.y + gap }
    ].map((candidate, index) => {
      const left = clamp(candidate.left, margin, maxLeft);
      const top = clamp(candidate.top, margin, maxTop);
      const rect = {
        left,
        top,
        right: left + composerRect.width,
        bottom: top + composerRect.height
      };
      return { left, top, index, overlap: rectOverlapArea(rect, previewBox) };
    }).sort((a, b) => a.overlap - b.overlap || a.index - b.index);
    quickEditComposer.style.transform = `translate(${candidates[0].left}px, ${candidates[0].top}px)`;
    return;
  }

  const top = clamp(bottomRight.y + 10, 16, boardRect.height - composerRect.height - 88);
  const left = clamp(objectCenter - composerRect.width / 2, 16, boardRect.width - composerRect.width - 16);
  quickEditComposer.style.transform = `translate(${left}px, ${top}px)`;
}

function rectOverlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}

function imageSizeLabel(object) {
  const width = Math.round(object.naturalWidth || object.width || 0);
  const height = Math.round(object.naturalHeight || object.height || 0);
  return width && height ? `${width} × ${height}` : "";
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function labelAction(action) {
  return translations[language].actionNames[action] || translations.en.actionNames[action] || action;
}
