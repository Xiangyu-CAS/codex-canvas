const board = document.querySelector("#board");
const world = document.querySelector("#world");
const objectLayer = document.querySelector("#objects");
const emptyState = document.querySelector("#emptyState");
const projectTitle = document.querySelector("#projectTitle");
const projectOptionsButton = document.querySelector(".project-header button");
const settingsButton = document.querySelector("#settingsButton");
const settingsMenu = document.querySelector("#settingsMenu");
const toolbar = document.querySelector("#selectionToolbar");
const moreMenu = document.querySelector("#selectionMoreMenu");
const zoomLabel = document.querySelector("#zoomLabel");
const toast = document.querySelector("#toast");
const toolDock = document.querySelector(".tool-dock");
const zoomWheelSensitivity = 0.0024;
const maxWheelZoomDelta = 160;
const languageStorageKey = "agentCanvasLanguage";

const translations = {
  en: {
    agentCanvas: "Agent canvas",
    canvasTools: "Canvas tools",
    canvasViewControls: "Canvas view controls",
    settings: "Settings",
    language: "Language",
    projectOptions: "Project options",
    textPlaceholder: "Text",
    placeholderSuffix: "is a placeholder in this milestone.",
    actions: {
      "quick-edit": "Quick Edit",
      "upscale": "Upscale",
      "remove-bg": "Remove BG",
      "eraser": "Eraser",
      "edit-elements": "Elements",
      "edit-text": "Text",
      "multi-angles": "Multi-Angles",
      "move-object": "Move Object",
      "more": "More",
      "download": "Download"
    },
    actionNames: {
      "quick-edit": "Quick Edit",
      "upscale": "Upscale",
      "remove-bg": "Remove BG",
      "eraser": "Eraser",
      "edit-elements": "Edit Elements",
      "edit-text": "Edit Text",
      "multi-angles": "Multi-Angles",
      "move-object": "Move Object",
      "more": "More",
      "download": "Download"
    },
    tools: {
      select: "Select",
      reference: "Reference",
      image: "Image",
      grid: "Layout",
      frame: "Frame",
      pencil: "Pencil",
      text: "Text",
      "image-generator": "Image generator",
      "upload-image": "Upload image"
    },
    controls: {
      reset: "Reset view",
      layers: "Layers",
      search: "Search",
      export: "Export"
    }
  },
  zh: {
    agentCanvas: "Agent 画布",
    canvasTools: "画布工具",
    canvasViewControls: "画布视图控制",
    settings: "设置",
    language: "语言",
    projectOptions: "项目选项",
    textPlaceholder: "文字",
    placeholderSuffix: "在当前版本中还是占位功能。",
    actions: {
      "quick-edit": "快捷编辑",
      "upscale": "放大",
      "remove-bg": "去背景",
      "eraser": "橡皮工具",
      "edit-elements": "编辑元素",
      "edit-text": "编辑文字",
      "multi-angles": "多角度",
      "move-object": "移动对象",
      "more": "更多",
      "download": "下载"
    },
    actionNames: {
      "quick-edit": "快捷编辑",
      "upscale": "放大",
      "remove-bg": "去背景",
      "eraser": "橡皮工具",
      "edit-elements": "编辑元素",
      "edit-text": "编辑文字",
      "multi-angles": "多角度",
      "move-object": "移动对象",
      "more": "更多",
      "download": "下载"
    },
    tools: {
      select: "选择",
      reference: "参考",
      image: "图片",
      grid: "布局",
      frame: "画框",
      pencil: "画笔",
      text: "文字",
      "image-generator": "生图",
      "upload-image": "上传图片"
    },
    controls: {
      reset: "重置视图",
      layers: "图层",
      search: "搜索",
      export: "导出"
    }
  }
};

let state = null;
let selectedId = null;
let hasUserSelection = false;
let activeTool = "select";
let editingTextId = null;
let language = loadLanguage();
let drag = null;
let drawing = null;
let viewport = { x: 0, y: 0, zoom: 0.72 };
let pan = null;
let viewportSaveTimer = null;
let isMoreMenuOpen = false;

applyLanguage();
await loadState();
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
  showToast(`${t("projectOptions")} ${t("placeholderSuffix")}`);
});

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
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

toolDock.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (!button) return;
  event.preventDefault();
  setActiveTool(button.dataset.tool);
});

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action) {
    event.stopPropagation();
    if (action === "more") {
      isMoreMenuOpen = !isMoreMenuOpen;
      updateSelectionUi();
      return;
    }
    isMoreMenuOpen = false;
    updateSelectionUi();
    showToast(`${labelAction(action)} ${t("placeholderSuffix")}`);
  }
});

document.addEventListener("keydown", (event) => {
  if (!["Backspace", "Delete"].includes(event.key)) return;
  if (!selectedId || isEditableTarget(event.target)) return;
  event.preventDefault();
  deleteSelectedObject();
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
    selectObject(null);
    startPan(event);
  }
});

document.addEventListener("pointerdown", (event) => {
  const isSettingsEvent = event.target.closest("#settingsMenu, #settingsButton");
  if (!isSettingsEvent) {
    settingsMenu.hidden = true;
    settingsMenu.classList.remove("language-open");
    settingsMenu.querySelector("[data-settings-row='language']")?.classList.remove("active");
  }
  if (isSettingsEvent) return;
  if (!selectedId) return;
  if (event.target.closest(".canvas-object, .selection-toolbar, .selection-more-menu")) return;
  selectObject(null);
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

async function loadState() {
  if (drag) return;
  const response = await fetch("/api/state");
  state = await response.json();
  if (!hasUserSelection || !state.objects.some((object) => object.id === selectedId)) {
    selectedId = null;
    hasUserSelection = false;
  }
  state.selection = selectedId;
  render();
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

  for (const object of state.objects) {
    const element = document.createElement("div");
    element.className = `canvas-object ${object.type || "image"}-object${object.id === selectedId ? " selected" : ""}`;
    element.style.left = `${object.x}px`;
    element.style.top = `${object.y}px`;
    element.style.width = `${object.width}px`;
    element.style.height = `${object.height}px`;
    element.dataset.id = object.id;

    if (object.type === "drawing") {
      element.append(renderDrawingObject(object));
    } else if (object.type === "text") {
      element.append(renderTextObject(object));
    } else {
      const image = document.createElement("img");
      image.src = object.src;
      image.alt = object.name || "Canvas image";
      image.draggable = false;
      element.append(image);
    }

    if ((object.type || "image") === "image" && object.id === selectedId && hasUserSelection) {
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
    }

    element.addEventListener("pointerdown", (event) => {
      if (object.type === "text" && editingTextId === object.id && event.target.closest(".text-content")) return;
      startDrag(event, object);
    });
    objectLayer.append(element);
  }

  updateSelectionUi();
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
    selectedId = object.id;
    hasUserSelection = true;
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

function startDrag(event, object) {
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget;
  if (element.setPointerCapture) {
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Continue with window-level pointer listeners if capture is unavailable.
    }
  }
  selectedId = object.id;
  hasUserSelection = true;
  if (state) state.selection = object.id;
  element.classList.add("selected", "dragging");
  drag = {
    id: object.id,
    element,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    objectX: object.x,
    objectY: object.y
  };
  updateSelectionUi();
  fetch("/api/selection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: object.id })
  }).catch(() => {});

  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag, { once: true });
  window.addEventListener("pointercancel", endDrag, { once: true });
}

function moveDrag(event) {
  if (!drag) return;
  const object = state.objects.find((item) => item.id === drag.id);
  if (!object) return;
  object.x = Math.round(drag.objectX + (event.clientX - drag.startX) / viewport.zoom);
  object.y = Math.round(drag.objectY + (event.clientY - drag.startY) / viewport.zoom);
  drag.element.style.left = `${object.x}px`;
  drag.element.style.top = `${object.y}px`;
  updateSelectionUi();
}

async function endDrag(event) {
  window.removeEventListener("pointermove", moveDrag);
  window.removeEventListener("pointerup", endDrag);
  window.removeEventListener("pointercancel", endDrag);
  if (!drag) return;
  const object = state.objects.find((item) => item.id === drag.id);
  const element = drag.element;
  element.classList.remove("dragging");
  if (element.releasePointerCapture) {
    try {
      element.releasePointerCapture(drag.pointerId);
    } catch {
      // Pointer capture may already be gone after cancellation.
    }
  }
  drag = null;
  if (object) {
    await fetch(`/api/objects/${object.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: object.x, y: object.y })
    });
    render();
  }
}

async function selectObject(id, { fromUser = false, renderNow = true } = {}) {
  selectedId = id;
  hasUserSelection = Boolean(id) && fromUser;
  if (editingTextId && editingTextId !== id) editingTextId = null;
  if (!id) isMoreMenuOpen = false;
  if (state) state.selection = id;
  if (renderNow) render();
  else updateSelectionUi();
  await fetch("/api/selection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selection: id })
  });
}

function updateSelectionUi() {
  const object = state.objects.find((item) => item.id === selectedId);

  if (!object || object.type !== "image" || !hasUserSelection) {
    toolbar.hidden = true;
    moreMenu.hidden = true;
    return;
  }

  toolbar.hidden = false;
  const topLeft = worldToScreen(object.x, object.y);
  const bottomRight = worldToScreen(object.x + object.width, object.y + object.height);
  const toolbarRect = toolbar.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  const objectCenter = (topLeft.x + bottomRight.x) / 2;
  const top = clamp(topLeft.y - toolbarRect.height - 26, 16, boardRect.height - toolbarRect.height - 16);
  const left = clamp(objectCenter - toolbarRect.width / 2, 16, boardRect.width - toolbarRect.width - 16);
  toolbar.style.transform = `translate(${left}px, ${top}px)`;
  updateMoreMenuPosition();
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
  path.setAttribute("stroke", "#202124");
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
  const object = await createObject({
    type: "drawing",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    points: points.map((point) => ({ x: point.x - bounds.x, y: point.y - bounds.y })),
    stroke: "#202124",
    strokeWidth: 4
  });
  selectedId = object.id;
  hasUserSelection = true;
  state.selection = object.id;
  render();
  setActiveTool("select");
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
  const object = await createObject({
    type: "text",
    text: t("textPlaceholder"),
    x: Math.round(point.x),
    y: Math.round(point.y),
    width: 220,
    height: 54,
    fontSize: 28,
    color: "#202124"
  });
  selectedId = object.id;
  hasUserSelection = true;
  state.selection = object.id;
  render();
  focusTextObject(object.id);
  setActiveTool("select");
}

async function createObject(payload) {
  const response = await fetch("/api/objects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const object = await response.json();
  state.objects.push(object);
  return object;
}

async function deleteSelectedObject() {
  const id = selectedId;
  if (!id) return;
  selectedId = null;
  hasUserSelection = false;
  editingTextId = null;
  isMoreMenuOpen = false;
  state.objects = state.objects.filter((object) => object.id !== id);
  state.selection = null;
  render();
  await fetch(`/api/objects/${id}`, { method: "DELETE" }).catch(() => {});
}

async function saveTextObject(id, text) {
  const object = state.objects.find((item) => item.id === id);
  if (!object) return;
  const nextText = text.trim() || t("textPlaceholder");
  object.text = nextText;
  await fetch(`/api/objects/${id}`, {
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

function setActiveTool(tool) {
  activeTool = tool || "select";
  toolDock.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === activeTool);
  });
  board.classList.toggle("tool-pencil", activeTool === "pencil");
  board.classList.toggle("tool-text", activeTool === "text");
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

function applyLanguage() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  projectOptionsButton.title = t("projectOptions");
  projectOptionsButton.setAttribute("aria-label", t("projectOptions"));
  settingsButton.title = t("settings");
  settingsButton.setAttribute("aria-label", t("settings"));
  board.setAttribute("aria-label", t("agentCanvas"));
  toolDock.setAttribute("aria-label", t("canvasTools"));
  document.querySelector(".canvas-controls")?.setAttribute("aria-label", t("canvasViewControls"));
  settingsMenu.querySelector("[data-settings-row='language']")?.setAttribute("aria-label", t("language"));
  const currentLanguage = settingsMenu.querySelector("[data-language-current]");
  if (currentLanguage) currentLanguage.textContent = language === "zh" ? "简体中文" : "English";

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

  const controlMap = ["reset", "layers", "search", "export"];
  document.querySelectorAll(".canvas-controls button").forEach((button, index) => {
    const label = translations[language].controls[controlMap[index]];
    if (!label) return;
    button.title = label;
    button.setAttribute("aria-label", label);
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
  await fetch("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewport })
  }).catch(() => {});
}

async function saveProjectTitle() {
  if (!state) return;
  const title = projectTitle.value.trim() || "Untitled";
  projectTitle.value = title;
  state.title = title;
  await fetch("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title })
  }).catch(() => {});
}

function applyViewport() {
  world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  zoomLabel.textContent = `${Math.round(viewport.zoom * 100)}%`;
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

function updateMoreMenuPosition() {
  moreMenu.hidden = !isMoreMenuOpen || toolbar.hidden;
  if (moreMenu.hidden) return;

  const moreButton = toolbar.querySelector('[data-action="more"]');
  const buttonRect = moreButton.getBoundingClientRect();
  const menuRect = moreMenu.getBoundingClientRect();
  const boardRect = board.getBoundingClientRect();
  const left = clamp(
    buttonRect.right - boardRect.left - menuRect.width,
    16,
    boardRect.width - menuRect.width - 16
  );
  const top = clamp(
    buttonRect.bottom - boardRect.top + 8,
    16,
    boardRect.height - menuRect.height - 16
  );
  moreMenu.style.transform = `translate(${left}px, ${top}px)`;
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
