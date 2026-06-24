const board = document.querySelector("#board");
const world = document.querySelector("#world");
const objectLayer = document.querySelector("#objects");
const emptyState = document.querySelector("#emptyState");
const projectTitle = document.querySelector("#projectTitle");
const toolbar = document.querySelector("#selectionToolbar");
const moreMenu = document.querySelector("#selectionMoreMenu");
const zoomLabel = document.querySelector("#zoomLabel");
const toast = document.querySelector("#toast");

let state = null;
let selectedId = null;
let hasUserSelection = false;
let drag = null;
let viewport = { x: 0, y: 0, zoom: 0.72 };
let pan = null;
let viewportSaveTimer = null;
let isMoreMenuOpen = false;

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
    showToast(`${labelAction(action)} is a placeholder in this milestone.`);
  }
});

board.addEventListener("pointerdown", (event) => {
  if (event.target === board || event.target === world || event.target === objectLayer) {
    selectObject(null);
    startPan(event);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!selectedId) return;
  if (event.target.closest(".canvas-object, .selection-toolbar, .selection-more-menu")) return;
  selectObject(null);
});

board.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = board.getBoundingClientRect();
    const before = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const factor = Math.exp(-event.deltaY * 0.001);
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
    element.className = `canvas-object${object.id === selectedId ? " selected" : ""}`;
    element.style.left = `${object.x}px`;
    element.style.top = `${object.y}px`;
    element.style.width = `${object.width}px`;
    element.style.height = `${object.height}px`;
    element.dataset.id = object.id;

    const image = document.createElement("img");
    image.src = object.src;
    image.alt = object.name || "Canvas image";
    image.draggable = false;
    element.append(image);

    if (object.id === selectedId && hasUserSelection) {
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

    const label = document.createElement("div");
    label.className = "object-label";
    label.textContent = object.name || "Image";
    element.append(label);

    element.addEventListener("pointerdown", (event) => startDrag(event, object));
    objectLayer.append(element);
  }

  updateSelectionUi();
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

  if (!object || !hasUserSelection) {
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
  return {
    "remove-bg": "Remove BG",
    "quick-edit": "Quick Edit",
    "upscale": "Upscale",
    "eraser": "Eraser",
    "edit-elements": "Edit Elements",
    "edit-text": "Edit Text",
    "multi-angles": "Multi-Angles",
    "move-object": "Move Object",
    "more": "More",
    "download": "Download"
  }[action] || action;
}
