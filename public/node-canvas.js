// Local graph interaction; generation instructions live in the backend action/skill.
export function createNodeCanvas({ shell, world, layer, preferences, getContext, assetUrl, select, request, refresh, toast }) {
  let enabled = preferences.getItem("codex-canvas-nodes") !== "false";
  let targetId = null;
  let scope = null;
  let closedId = null;
  let draft = null;
  let submitting = false;
  let saveTimer;
  let flushSave = () => {};
  let savePending = Promise.resolve();
  let pickerOpen = false;
  let pickerSignature = "";
  let latestContext;
  const ns = "http://www.w3.org/2000/svg";
  const text = (en, zh) => getContext().language === "zh" ? zh : en;
  // Lucide GitBranch, Plus, X, ArrowUp icons.
  const icons = {
    graph: '<circle cx="6" cy="3" r="3"/><path d="M6 6v12"/><circle cx="6" cy="21" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9H6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
    send: '<path d="M12 19V5m-7 7 7-7 7 7"/>'
  };
  function button(label, icon, cls = "") {
    const el = document.createElement("button");
    el.type = "button"; el.className = cls; el.title = label; el.setAttribute("aria-label", label);
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg>`;
    return el;
  }
  const toggle = button("Node canvas / 节点画布", "graph", "node-mode-toggle");
  toggle.id = "nodeModeToggle";
  toggle.append(document.createTextNode("Node canvas"));
  shell.append(toggle);
  const links = document.createElementNS(ns, "svg");
  links.classList.add("node-links"); links.setAttribute("aria-hidden", "true");
  world.prepend(links);
  const panel = document.createElement("section");
  panel.className = "node-composer"; panel.id = "nodeComposer"; panel.hidden = true;
  panel.setAttribute("aria-label", "Reference generation / 参考生成");
  panel.innerHTML = `<header><div><strong class="node-heading"></strong><span class="node-target"></span></div></header>
    <textarea id="nodePrompt" maxlength="4000" aria-label="Generation prompt / 生成提示词"></textarea>
    <div class="node-references"></div><div class="node-picker" hidden></div>
    <footer><span class="node-model" title="Uses the existing Codex image generation connection">Codex · ImageGen</span>
    <label><span class="node-ratio-label"></span><select id="nodeRatio" aria-label="Aspect ratio / 比例"><option value="original">Original</option>${["1:1","16:9","9:16","4:3","3:4","3:2","2:3"].map(x=>`<option>${x}</option>`).join("")}</select></label>
    <label><span class="node-count-label"></span><select id="nodeCount" aria-label="Image count / 张数">${[1,2,3,4].map(x=>`<option>${x}</option>`).join("")}</select></label></footer>
    <p class="node-status" role="status" aria-live="polite"></p>`;
  const close = button("Close / 关闭", "close"); panel.querySelector("header").append(close);
  const send = button("Generate / 生成", "send", "node-send"); send.id = "nodeGenerate"; panel.querySelector("footer").append(send);
  shell.append(panel);
  const prompt = panel.querySelector("textarea");
  const ratio = panel.querySelector("#nodeRatio");
  const count = panel.querySelector("#nodeCount");
  const refs = panel.querySelector(".node-references");
  const picker = panel.querySelector(".node-picker");
  const status = panel.querySelector(".node-status");
  for (const event of ["pointerdown", "wheel", "keydown"]) panel.addEventListener(event, e => e.stopPropagation());
  toggle.addEventListener("click", () => {
    enabled = !enabled; preferences.setItem("codex-canvas-nodes", String(enabled)); closedId = null; update();
  });
  close.addEventListener("click", () => { closedId = targetId; panel.hidden = true; });
  function snapshot() { return JSON.parse(JSON.stringify(draft)); }
  function queueSave() {
    clearTimeout(saveTimer);
    if (!targetId || !draft) return;
    const id = targetId, captured = snapshot(), ctx = getContext();
    const draftKey = `node-draft:${ctx.scope}:${id}`;
    const serialized = JSON.stringify(captured);
    preferences.setItem(draftKey, serialized);
    const url = ctx.apiPath(`/api/objects/${encodeURIComponent(id)}`);
    flushSave = () => {
      clearTimeout(saveTimer);
      flushSave = () => {};
      savePending = savePending.catch(() => {}).then(() => request(url, "PATCH", { generationDraft: captured }, ctx.sessionId)).then(() => {
        if (preferences.getItem(draftKey) === serialized) preferences.setItem(draftKey, "");
      });
      savePending.catch(error => toast(text("Draft could not be saved: ", "草稿未保存：") + error.message));
    };
    saveTimer = setTimeout(() => flushSave(), 250);
  }
  function changed() {
    draft.prompt = prompt.value; draft.ratio = ratio.value; draft.count = Number(count.value);
    queueSave(); updateSend();
  }
  prompt.addEventListener("input", changed); ratio.addEventListener("change", changed); count.addEventListener("change", changed);
  prompt.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!send.disabled) send.click(); } });
  function updateSend() {
    send.disabled = submitting || !draft?.prompt.trim() || !draft.referenceObjectIds.length;
    send.title = submitting ? text("Submitting…", "提交中…") : text("Generate", "生成");
  }
  function drawReferences() {
    refs.replaceChildren();
    const ctx = getContext();
    for (const [index, id] of draft.referenceObjectIds.entries()) {
      const object = ctx.state.objects.find(item => item.id === id);
      if (!object) continue;
      const chip = document.createElement("div"); chip.className = "node-reference"; chip.dataset.referenceId = id;
      const img = document.createElement("img"); img.src = assetUrl(object.src, object); img.alt = object.name || "Reference";
      const label = document.createElement("span"); label.textContent = `${text("Ref", "参考")} ${index + 1}`;
      const remove = button(text("Remove reference", "移除参考图"), "close");
      remove.disabled = id === targetId; remove.title = id === targetId ? text("Selected source", "当前源图") : remove.title;
      remove.addEventListener("click", () => { draft.referenceObjectIds = draft.referenceObjectIds.filter(x => x !== id); queueSave(); drawReferences(); updateSend(); });
      chip.append(img, label, remove); refs.append(chip);
    }
    const add = button(text("Add reference", "添加参考图"), "plus", "node-add-reference"); add.id = "nodeAddReference";
    add.disabled = draft.referenceObjectIds.length >= 8 || submitting;
    add.addEventListener("click", () => { pickerOpen = !pickerOpen; drawPicker(true); }); refs.append(add);
    drawPicker(true);
  }
  function drawPicker(force = false) {
    const images = getContext().state.objects.filter(item => (item.type || "image") === "image");
    const signature = images.map(x => x.id + x.name).join() + draft?.referenceObjectIds.join();
    picker.hidden = !pickerOpen;
    if (!pickerOpen || (!force && signature === pickerSignature)) return;
    pickerSignature = signature; picker.replaceChildren();
    for (const object of images) {
      const item = document.createElement("button"); item.type = "button"; item.dataset.referenceChoice = object.id;
      item.disabled = draft.referenceObjectIds.includes(object.id) || draft.referenceObjectIds.length >= 8;
      const img = document.createElement("img"); img.src = assetUrl(object.src, object); img.alt = "";
      const label = document.createElement("span"); label.textContent = object.name || "Image";
      item.append(img, label); item.addEventListener("click", () => {
        draft.referenceObjectIds.push(object.id); pickerOpen = false; queueSave(); drawReferences(); updateSend();
      }); picker.append(item);
    }
  }
  function open(object, { fresh = false, pick = false } = {}) {
    flushSave();
    targetId = object.id; closedId = null; pickerOpen = pick;
    let saved = object.generationDraft;
    try { saved = JSON.parse(preferences.getItem(`node-draft:${getContext().scope}:${object.id}`) || "null") || saved; } catch {}
    const useSaved = !fresh && saved && (object.type === "job" || saved.referenceObjectIds?.includes(object.id));
    draft = useSaved ? JSON.parse(JSON.stringify(saved)) : { prompt: "", ratio: "original", count: 1, referenceObjectIds: [object.id] };
    const valid = new Set(getContext().state.objects.filter(x => (x.type || "image") === "image").map(x => x.id));
    draft.referenceObjectIds = draft.referenceObjectIds.filter(id => valid.has(id));
    prompt.value = draft.prompt; ratio.value = draft.ratio; count.value = String(draft.count);
    status.textContent = object.status === "failed" ? (object.error || text("Generation failed. You can retry.", "生成失败，可以重试。")) : "";
    drawReferences(); updateSend();
  }
  function ports() {
    for (const element of layer.querySelectorAll(".canvas-object")) {
      const object = latestContext.state.objects.find(x => x.id === element.dataset.id);
      if (!object || (object.type !== "image" && !(object.type === "job" && object.status === "failed" && object.action === "reference-generate"))) continue;
      if (element.querySelector(".node-port")) continue;
      const caption = document.createElement("span"); caption.className = "node-caption";
      caption.textContent = object.name || text("Image", "图片"); element.append(caption);
      const output = button(object.type === "job" ? text("Retry generation", "重试生成") : text("Continue from this image", "从这张图继续生成"), "plus", "node-port node-port-output");
      output.addEventListener("pointerdown", e => e.stopPropagation());
      output.addEventListener("click", e => { e.stopPropagation(); select(object.id); open(object, { fresh: object.type !== "job" }); update(); prompt.focus(); });
      element.append(output);
      if (object.type === "image") {
        const input = button(text("Choose references", "选择参考图"), "plus", "node-port node-port-input");
        input.addEventListener("pointerdown", e => e.stopPropagation());
        input.addEventListener("click", e => { e.stopPropagation(); select(object.id); open(object, { pick: true }); update(); });
        element.append(input);
      }
    }
  }
  function drawLinks() {
    const ctx = getContext(); if (!ctx.state) return;
    links.replaceChildren();
    const objects = new Map(ctx.state.objects.map(x => [x.id, x]));
    for (const target of objects.values()) {
      const ids = target.referenceObjectIds?.length ? target.referenceObjectIds : target.sourceObjectId ? [target.sourceObjectId] : [];
      for (const id of new Set(ids)) {
        const source = objects.get(id); if (!source || source.id === target.id) continue;
        const x1 = source.x + source.width + 10, y1 = source.y + source.height / 2;
        const x2 = target.x - 10, y2 = target.y + target.height / 2;
        const bend = Math.max(70, Math.abs(x2 - x1) * .5);
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`);
        path.dataset.source = id; path.dataset.target = target.id;
        path.classList.toggle("active", ctx.selectedId === target.id || ctx.selectedId === id);
        links.append(path);
      }
    }
  }
  function update() {
    const ctx = getContext(); latestContext = ctx; if (!ctx.state) return;
    shell.classList.toggle("node-mode", enabled); toggle.setAttribute("aria-pressed", String(enabled));
    toggle.lastChild.textContent = text("Node canvas", "节点画布");
    links.style.display = enabled ? "" : "none";
    if (scope !== ctx.scope) { flushSave(); scope = ctx.scope; targetId = null; closedId = null; pickerOpen = false; }
    drawLinks(); if (enabled) ports();
    const selected = ctx.state.objects.find(x => x.id === ctx.selectedId);
    const eligible = selected && ((selected.type || "image") === "image" || (selected.type === "job" && selected.status === "failed" && selected.action === "reference-generate"));
    if (closedId && closedId !== ctx.selectedId) closedId = null;
    panel.hidden = !enabled || !eligible || Boolean(ctx.editing) || closedId === ctx.selectedId;
    if (panel.hidden) return;
    if (targetId !== selected.id) open(selected);
    const ids = new Set(ctx.state.objects.map(x => x.id));
    if (draft.referenceObjectIds.some(id => !ids.has(id))) {
      draft.referenceObjectIds = draft.referenceObjectIds.filter(id => ids.has(id)); drawReferences(); updateSend(); queueSave();
    }
    panel.querySelector(".node-heading").textContent = text("Reference generation", "参考生成");
    panel.querySelector(".node-target").textContent = selected.name || "Image";
    prompt.placeholder = text("Describe the next image. Use reference 1, reference 2…", "描述下一张图，用“参考 1、参考 2”指定人物、风格与构图…");
    panel.querySelector(".node-ratio-label").textContent = text("Ratio", "比例");
    panel.querySelector(".node-count-label").textContent = text("Images", "张数");
    ratio.options[0].textContent = text("Original", "原比例");
    drawPicker();
  }
  send.addEventListener("click", async () => {
    if (send.disabled) return;
    const ctx = getContext(), requestScope = ctx.scope, id = targetId, config = snapshot();
    const source = ctx.state.objects.find(x => x.id === id);
    const url = ctx.apiPath("/api/jobs");
    const objectUrl = ctx.apiPath(`/api/objects/${encodeURIComponent(id)}`);
    submitting = true; flushSave(); updateSend();
    let accepted = 0;
    try {
      await savePending.catch(() => {});
      await request(objectUrl, "PATCH", { generationDraft: config }, ctx.sessionId);
      for (let i = 0; i < config.count; i++) {
        // Capture all URLs before awaiting: switching canvas must never reroute a job.
        await request(url, "POST", { action: "reference-generate", objectId: config.referenceObjectIds[0], referenceObjectIds: config.referenceObjectIds, prompt: config.prompt, ratio: config.ratio }, ctx.sessionId);
        accepted++;
      }
      if (source?.type === "job" && source.status === "failed") await request(objectUrl, "DELETE", undefined, ctx.sessionId);
      if (getContext().scope === requestScope) {
        status.textContent = text(`${accepted} generation job(s) started.`, `已开始 ${accepted} 个生成任务。`);
        await refresh();
      }
    } catch (error) {
      const message = `${accepted ? text(`${accepted} started. `, `已开始 ${accepted} 个。`) : ""}${error.message}`;
      if (getContext().scope === requestScope) status.textContent = message; else toast(message);
    } finally { submitting = false; updateSend(); }
  });
  window.addEventListener("pagehide", () => flushSave());
  return { update, drawLinks, get enabled() { return enabled; }, flush: async () => { flushSave(); await savePending; }, get active() { return !panel.hidden && panel.contains(document.activeElement); } };
}
