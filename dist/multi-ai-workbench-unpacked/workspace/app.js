(function initWorkbench() {
  "use strict";

  const registry = globalThis.MultiAIServiceRegistry;
  const promptTemplates = globalThis.MultiAIPromptTemplates;
  const exportCore = globalThis.MultiAIExportCore;
  const state = { services: [...registry.defaults], serviceDraft: [], serviceCategory: "ai", layout: "auto", theme: "light", locale: "zh", openBehavior: "resume", answerMode: "expert", launcherEnabled: true, launcherScope: "supported", launcherStyle: "animated", launcherSize: 160, launcherAnimationPack: "rich", launcherRandomFrequency: "normal", contextMenuMode: "flat", operations: [], operationGroups: [], commandShortcuts: {}, composerPosition: null, widths: {}, frameUrls: {}, history: [], currentSessionId: "", files: [], lastQuestion: "", selections: [], selectionService: "", pickerServices: new Set(), workspaceTabId: null, workspaceWindowId: null };
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    frames: $("#frames"), template: $("#frameTemplate"), question: $("#question"), send: $("#send"), status: $("#status"),
    files: $("#attachments"), fileSummary: $("#fileSummary"), add: $("#addService"), layout: $("#layout"), composer: $("#composer"),
    theme: $("#themeToggle"), historyPanel: $("#historyPanel"), historyList: $("#historyList"), servicePanel: $("#servicePanel"), settingsPanel: $("#settingsPanel"),
    exportPanel: $("#exportPanel"), exportList: $("#exportList"), notesPanel: $("#notesPanel"), notesList: $("#notesList"), backdrop: $("#drawerBackdrop")
  };
  const serviceIconFiles = { doubao: "doubao.png", kimi: "kimi.png", deepseek: "deepseek.svg", zhipu: "zhipu.png", qianwen: "qianwen.png", yuanbao: "yuanbao.png", minimax: "minimax.png", zhida: "zhida.png", chatgpt: "chatgpt.png", gemini: "gemini.png", copilot: "copilot.png", grok: "grok.png", claude: "claude.png", google: "google.png", bing: "bing.ico", baidu: "baidu.png", wechat: "wechat.png", zhihu: "zhihu.ico" };

  const storageGet = (keys) => chrome.storage.local.get(keys);
  const storageSet = (value) => chrome.storage.local.set(value);
  const sendRuntime = (message) => new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(chrome.runtime.lastError ? { ok: false, reason: chrome.runtime.lastError.message } : response)));

  function setStatus(message, isError = false) {
    elements.status.textContent = message;
    elements.status.style.color = isError ? "#dc2626" : "";
  }

  function setFrameStatus(serviceKey, text, kind = "") {
    const element = elements.frames.querySelector(`[data-service="${CSS.escape(serviceKey)}"] .frame-status`);
    if (!element) return;
    element.textContent = text; element.className = `frame-status ${kind}`.trim();
  }

  function serviceUrl(service, question = "") {
    return question && service.query ? service.query.replace("{q}", encodeURIComponent(question)) : service.home;
  }

  function sanitizeFrameUrls(values, startup = false) {
    const result = {};
    for (const [key, value] of Object.entries(values && typeof values === "object" ? values : {})) {
      if (startup && !registry.restoresOnStartup(key)) continue;
      const url = registry.normalizeFrameUrl(key, value); if (url) result[key] = url;
    }
    return result;
  }

  function applyLayout() {
    const count = state.services.length;
    let rows, columns;
    if (state.layout === "auto") {
      rows = count > 3 ? 2 : 1;
      columns = Math.min(5, Math.max(1, Math.ceil(count / rows)));
    } else {
      const parts = state.layout.split("x").map(Number);
      rows = parts[0] === 2 ? 2 : 1;
      columns = Math.min(5, Math.max(1, parts[1] || 3));
    }
    elements.frames.dataset.rows = String(rows);
    elements.frames.style.setProperty("--columns", columns);
    elements.layout.value = state.layout;
    elements.layout.title = `${rows === 2 ? "双行" : "单行"} · ${columns} 列 · ${count} 个平台`;
  }

  async function persistSettings() {
    await storageSet({ "maiw.settings": { services: state.services, layout: state.layout, theme: state.theme, locale: state.locale, openBehavior: state.openBehavior, answerMode: state.answerMode, launcherEnabled: state.launcherEnabled, launcherScope: state.launcherScope, launcherStyle: state.launcherStyle, launcherSize: state.launcherSize, launcherAnimationPack: state.launcherAnimationPack, launcherRandomFrequency: state.launcherRandomFrequency, contextMenuMode: state.contextMenuMode, composerPosition: state.composerPosition, widths: state.widths, currentSessionId: state.currentSessionId } });
  }

  function openDrawer(panel) {
    for (const drawer of document.querySelectorAll(".drawer")) drawer.hidden = drawer !== panel;
    panel.hidden = false; elements.backdrop.hidden = false;
  }

  function closeDrawers() {
    for (const drawer of document.querySelectorAll(".drawer")) drawer.hidden = true;
    elements.backdrop.hidden = true;
  }

  function fillGroupOptions() { const select = $("#operationGroup"); select.replaceChildren(new Option("直接显示", "")); for (const group of state.operationGroups) select.append(new Option(group.name, group.id)); }
  function renderOperationServices(selected = []) { const holder = $("#operationServices"); holder.replaceChildren(); for (const service of registry.ai) { const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.value = service.key; input.checked = selected.includes(service.key); label.append(input, document.createTextNode(service.name)); holder.append(label); } holder.hidden = $("#operationTargetMode").value !== "fixed"; }
  function openPromptTemplateForm(operation = null) {
    const source = operation || { id: "", name: "", icon: "自", category: "custom", prompt: "请按以下要求处理内容：\n\n{{content}}", enabled: true, showInContextMenu: true, showInPicker: true, groupId: "", targetMode: "selection", serviceKeys: [], answerMode: "inherit", execution: "preview", shortcutSlot: 0 };
    fillGroupOptions(); $("#promptTemplateId").value = source.id || ""; $("#promptTemplateName").value = source.name; $("#operationIcon").value = source.icon || "自"; $("#promptTemplateCategory").value = source.category || "custom"; $("#operationGroup").value = source.groupId || ""; $("#operationEnabled").checked = source.enabled !== false; $("#operationShowContext").checked = source.showInContextMenu !== false; $("#operationShowPicker").checked = source.showInPicker !== false; $("#promptTemplatePrompt").value = source.prompt; $("#operationTargetMode").value = source.targetMode || "selection"; $("#operationExecution").value = source.execution || "preview"; $("#operationAnswerMode").value = source.answerMode || "inherit"; $("#operationShortcutSlot").value = String(source.shortcutSlot || 0); renderOperationServices(source.serviceKeys || []); $("#deleteOperation").hidden = Boolean(source.builtin) || !source.id; $("#restoreOperation").hidden = !source.builtin; $("#promptTemplateForm").hidden = false; $("#operationGroupForm").hidden = true; $("#promptTemplateName").focus();
  }
  async function savePromptTemplates() { await storageSet({ "maiw.operations": state.operations, "maiw.operationGroups": state.operationGroups }); await persistSettings(); renderPromptTemplates(); }
  function operationTargetLabel(row) { return row.targetMode === "fixed" ? `${row.serviceKeys.length} 个固定 AI` : row.targetMode === "active" ? "当前 AI" : row.targetMode === "ask" ? "每次选择" : "当前已选 AI"; }
  function renderShortcutList() { const holder = $("#shortcutList"); holder.replaceChildren(); for (let slot = 1; slot <= 8; slot += 1) { const row = document.createElement("div"); row.className = "shortcut-row"; const operation = state.operations.find((item) => item.shortcutSlot === slot); row.innerHTML = `<strong>快捷操作 ${slot}</strong><span>${operation?.name || "未绑定操作"}</span><code>${state.commandShortcuts[`action-slot-${slot}`] || "未设置按键"}</code>`; holder.append(row); } }
  function renderPromptTemplates() {
    const groupsHolder = $("#operationGroupList"); groupsHolder.replaceChildren();
    for (const group of state.operationGroups) { const row = document.createElement("div"); row.className = "operation-group-row"; const name = document.createElement("strong"); name.textContent = `分组：${group.name}`; const edit = document.createElement("button"); edit.textContent = "编辑"; edit.addEventListener("click", () => { $("#operationGroupId").value = group.id; $("#operationGroupName").value = group.name; $("#operationGroupForm").hidden = false; $("#promptTemplateForm").hidden = true; }); const remove = document.createElement("button"); remove.textContent = "删除"; remove.addEventListener("click", async () => { if (!confirm(`删除分组“${group.name}”吗？其中的操作将移到直接显示。`)) return; state.operationGroups = state.operationGroups.filter((item) => item.id !== group.id); state.operations = state.operations.map((item) => item.groupId === group.id ? { ...item, groupId: "" } : item); await savePromptTemplates(); }); row.append(name, edit, remove); groupsHolder.append(row); }
    const holder = $("#promptTemplateList"); holder.replaceChildren();
    for (const operation of state.operations) {
      const row = document.createElement("div"); row.className = "prompt-template-row"; row.draggable = true; row.dataset.operationId = operation.id;
      const menuLabel = document.createElement("label"), menu = document.createElement("input"); menu.type = "checkbox"; menu.checked = operation.showInContextMenu; menuLabel.title = "显示在网页右键菜单"; menuLabel.append(menu, document.createTextNode("右键")); menu.addEventListener("change", async () => { operation.showInContextMenu = menu.checked; await savePromptTemplates(); });
      const meta = document.createElement("div"), name = document.createElement("strong"), detail = document.createElement("small"); meta.className = "prompt-template-meta"; name.textContent = `${operation.shortcutSlot ? `${operation.shortcutSlot} ` : ""}${operation.icon} ${operation.name}`; const groupName = state.operationGroups.find((item) => item.id === operation.groupId)?.name; detail.textContent = `${groupName ? `${groupName} · ` : ""}${operationTargetLabel(operation)} · ${operation.execution === "direct" ? "直接发送" : "发送前预览"}`; meta.append(name, detail);
      const actions = document.createElement("div"), edit = document.createElement("button"); actions.className = "prompt-template-actions"; edit.textContent = "编辑"; edit.addEventListener("click", () => openPromptTemplateForm(operation)); actions.append(edit); row.append(menuLabel, meta, actions);
      row.addEventListener("dragstart", () => row.classList.add("dragging")); row.addEventListener("dragend", async () => { row.classList.remove("dragging"); state.operations = [...holder.querySelectorAll("[data-operation-id]")].map((node, index) => ({ ...state.operations.find((item) => item.id === node.dataset.operationId), order: index })); await savePromptTemplates(); }); row.addEventListener("dragover", (event) => { event.preventDefault(); const dragging = holder.querySelector(".dragging"); if (dragging && dragging !== row) holder.insertBefore(dragging, event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? row : row.nextSibling); }); holder.append(row);
    }
    const visibleCount = state.operations.filter((row) => row.enabled && row.showInContextMenu).length; $("#menuLengthHint").textContent = visibleCount > 12 ? `当前显示 ${visibleCount} 个操作，右键菜单可能过长。` : `当前右键显示 ${visibleCount} 个操作，可拖动调整顺序。`; renderShortcutList();
  }
  function showSettingsTab(tab) { const operations = tab === "operations"; $("#settingsGeneral").hidden = operations; $("#operationSettings").hidden = !operations; for (const button of $("#settingsTabs").querySelectorAll("button")) button.classList.toggle("active", button.dataset.settingsTab === (operations ? "operations" : "general")); if (operations) renderPromptTemplates(); }

  function servicesForCategory(category) {
    if (category === "ai") return registry.ai;
    return registry.auxiliary.filter((service) => service.kind === category);
  }

  function renderServiceManager() {
    const selected = $("#selectedServices"), catalog = $("#serviceCatalog"), query = $("#serviceSearch").value.trim().toLowerCase();
    selected.replaceChildren(); catalog.replaceChildren();
    $("#serviceCount").textContent = `已添加 ${state.serviceDraft.length}/${registry.maxFrames}`;
    if (!state.serviceDraft.length) selected.textContent = "尚未选择平台";
    for (const key of state.serviceDraft) {
      const service = registry.byKey[key]; if (!service) continue;
      const item = document.createElement("div"); item.className = "selected-service"; item.draggable = true; item.dataset.service = key;
      const handle = document.createElement("span"); handle.textContent = "☰"; const name = document.createElement("span"); name.textContent = service.name;
      const remove = document.createElement("button"); remove.textContent = "×"; remove.title = `移除 ${service.name}`; remove.addEventListener("click", () => { state.serviceDraft = state.serviceDraft.filter((value) => value !== key); renderServiceManager(); });
      item.addEventListener("dragstart", () => item.classList.add("dragging")); item.addEventListener("dragend", () => item.classList.remove("dragging"));
      item.addEventListener("dragover", (event) => { event.preventDefault(); const dragged = selected.querySelector(".dragging"); if (!dragged || dragged === item) return; selected.insertBefore(dragged, event.clientX < item.getBoundingClientRect().left + item.offsetWidth / 2 ? item : item.nextSibling); state.serviceDraft = [...selected.querySelectorAll("[data-service]")].map((node) => node.dataset.service); });
      item.append(handle, name, remove); selected.append(item);
    }
    for (const service of servicesForCategory(state.serviceCategory).filter((row) => !query || row.name.toLowerCase().includes(query) || row.key.includes(query))) {
      const isSelected = state.serviceDraft.includes(service.key), atLimit = state.serviceDraft.length >= registry.maxFrames;
      const button = document.createElement("button"); button.className = `service-option${isSelected ? " selected" : ""}`; button.disabled = !isSelected && atLimit;
      const avatar = document.createElement("span"); avatar.className = "service-avatar"; avatar.textContent = service.name.slice(0, 1);
      const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = service.name; const hint = document.createElement("small"); hint.textContent = isSelected ? "已添加 · 点击移除" : (atLimit ? "已达到 10 个上限" : "点击添加"); copy.append(name, hint); button.append(avatar, copy);
      button.addEventListener("click", () => { state.serviceDraft = isSelected ? state.serviceDraft.filter((value) => value !== service.key) : [...state.serviceDraft, service.key]; renderServiceManager(); }); catalog.append(button);
    }
  }

  function openServiceManager() {
    state.serviceDraft = [...state.services]; $("#serviceSearch").value = ""; renderServiceManager(); openDrawer(elements.servicePanel);
  }

  function removeService(key) {
    state.services = state.services.filter((item) => item !== key); renderFrames(); persistSettings();
  }

  function renderFrames() {
    elements.frames.replaceChildren();
    for (const key of state.services) {
      const service = registry.byKey[key];
      if (!service) continue;
      const card = elements.template.content.firstElementChild.cloneNode(true);
      card.dataset.service = key;
      card.querySelector(".frame-name").textContent = service.name;
      card.querySelector(".frame-service-tab").title = service.name;
      const serviceIcon = card.querySelector(".service-icon"); serviceIcon.src = `../assets/platform-icons/${serviceIconFiles[key] || "google.ico"}`; serviceIcon.alt = `${service.name} 图标`;
      const iframe = card.querySelector("iframe"); iframe.src = state.frameUrls[key] || serviceUrl(service);
      if (Number(state.widths[key]) >= 280) card.style.setProperty("--frame-width", `${state.widths[key]}px`);
      card.querySelector(".frame-actions").addEventListener("click", (event) => handleFrameAction(event, service, iframe));
      card.querySelector(".col-resizer").addEventListener("pointerdown", (event) => beginResize(event, card));
      card.addEventListener("dragstart", () => card.classList.add("dragging"));
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", (event) => reorderFrame(event, card));
      elements.frames.append(card);
    }
    applyLayout();
  }

  function showFrameNotice(serviceKey, url) {
    const card = elements.frames.querySelector(`[data-service="${CSS.escape(serviceKey)}"]`); if (!card || card.querySelector(".frame-notice")) return;
    const notice = document.createElement("div"); notice.className = "frame-notice"; notice.append(document.createTextNode("检测到平台登录页面，请在新标签页完成登录后刷新本列。"));
    const open = document.createElement("button"); open.textContent = "打开平台"; open.addEventListener("click", () => chrome.tabs.create({ url: url || registry.byKey[serviceKey]?.home })); const refresh = document.createElement("button"); refresh.textContent = "刷新"; refresh.addEventListener("click", () => { const frame = card.querySelector("iframe"); frame.src = state.frameUrls[serviceKey] || registry.byKey[serviceKey].home; notice.remove(); }); notice.append(open, refresh); card.append(notice);
  }

  function reorderFrame(event, target) {
    event.preventDefault();
    const dragged = elements.frames.querySelector(".dragging");
    if (!dragged || dragged === target) return;
    const rect = target.getBoundingClientRect();
    const before = elements.frames.dataset.rows === "2" ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2;
    elements.frames.insertBefore(dragged, before ? target : target.nextSibling);
    state.services = [...elements.frames.children].map((card) => card.dataset.service);
    persistSettings();
  }

  function beginResize(event, card) {
    event.preventDefault(); event.stopPropagation();
    if (elements.frames.dataset.rows !== "1") return;
    const next = card.nextElementSibling;
    if (!(next instanceof HTMLElement)) return;
    const startX = event.clientX, leftWidth = card.getBoundingClientRect().width, rightWidth = next.getBoundingClientRect().width;
    const move = (moveEvent) => { const delta = moveEvent.clientX - startX; const left = Math.max(280, leftWidth + delta); const right = Math.max(280, rightWidth - delta); card.style.setProperty("--frame-width", `${left}px`); next.style.setProperty("--frame-width", `${right}px`); };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); state.widths[card.dataset.service] = Math.round(card.getBoundingClientRect().width); state.widths[next.dataset.service] = Math.round(next.getBoundingClientRect().width); persistSettings(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
  }

  async function handleFrameAction(event, service, iframe) {
    const action = event.target.closest("button")?.dataset.action;
    if (!action) return;
    if (action === "close") { if (confirm(`关闭「${service.name}」列？关闭后该列未保存的页面状态可能丢失。`)) removeService(service.key); return; }
    const currentUrl = state.frameUrls[service.key] || iframe.src || service.home;
    if (action === "reload") { iframe.src = currentUrl; return; }
    if (action === "open") { await chrome.tabs.create({ url: currentUrl }); return; }
    if (action === "new") {
      const response = await sendRuntime({ action: "NEW_CHAT_ALL", services: [service.key] });
      const result = response?.results?.[0];
      delete state.frameUrls[service.key];
      if (!result?.ok) { iframe.src = result?.fallbackUrl || service.home; setStatus(`${service.name} 未找到新对话控件，已返回起始页。`, true); }
      else setStatus(`${service.name} 已进入新对话。`);
      await persistSessionUrls(); return;
    }
    if (action === "copy-link") { try { await navigator.clipboard.writeText(currentUrl); setStatus("已复制链接。"); } catch (error) { setStatus(`复制失败：${error.message}`, true); } return; }
    if (action === "locate") { await sendRuntime({ action: "LOCATE_QUESTION_ALL", services: [service.key], question: state.lastQuestion }); return; }
    if (action === "pick") { const enabled = !state.pickerServices.has(service.key); if (enabled) state.pickerServices.add(service.key); else state.pickerServices.delete(service.key); setStatus(enabled ? `请在 ${service.name} 面板中连续点击要摘取的内容，再次点击“摘取”退出。` : `已退出 ${service.name} 拾取模式。`); await sendRuntime({ action: "SET_PICKER_MODE", service: service.key, enabled }); return; }
    if (action === "highlight") { const response = await sendRuntime({ action: "SET_HIGHLIGHT_MODE", service: service.key, enabled: true }); setStatus(response?.ok ? `已开启 ${service.name} 划线模式，选中文字即可添加笔记。` : "划线模式暂不可用。", !response?.ok); }
  }

  function validateFiles(files) {
    const selected = [...files];
    const allowedExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "pdf", "doc", "docx", "txt", "md", "xls", "xlsx", "csv"]);
    if (selected.length > 3) throw new Error("最多选择 3 个附件。");
    if (selected.some((file) => !file.type.startsWith("image/") && !allowedExtensions.has(file.name.split(".").pop()?.toLowerCase()))) throw new Error("存在不支持的附件格式。");
    if (selected.some((file) => file.size > 10 * 1024 * 1024)) throw new Error("单个附件不能超过 10 MB。");
    if (selected.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) throw new Error("附件总大小不能超过 20 MB。");
    return selected;
  }

  function renderFiles() {
    elements.fileSummary.replaceChildren();
    for (const [index, file] of state.files.entries()) { const chip = document.createElement("span"); chip.className = "file-chip"; chip.append(document.createTextNode(file.name)); const remove = document.createElement("button"); remove.textContent = "×"; remove.title = "移除附件"; remove.addEventListener("click", () => { state.files.splice(index, 1); renderFiles(); }); chip.append(remove); elements.fileSummary.append(chip); }
  }

  function clampComposerPosition(position = state.composerPosition) {
    const margin = 8, rect = elements.composer.getBoundingClientRect();
    const fallback = { x: Math.max(margin, (innerWidth - rect.width) / 2), y: Math.max(70, innerHeight - rect.height - 20) };
    const source = position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : fallback;
    state.composerPosition = { x: Math.round(Math.min(Math.max(margin, source.x), Math.max(margin, innerWidth - rect.width - margin))), y: Math.round(Math.min(Math.max(70, source.y), Math.max(70, innerHeight - rect.height - margin))) };
    elements.composer.style.left = `${state.composerPosition.x}px`; elements.composer.style.top = `${state.composerPosition.y}px`; elements.composer.style.transform = "none";
  }

  function resetComposerPosition(save = true) {
    state.composerPosition = null; elements.composer.style.left = "50%"; elements.composer.style.top = "calc(100vh - 178px)"; elements.composer.style.transform = "translateX(-50%)";
    requestAnimationFrame(() => { clampComposerPosition(null); if (save) persistSettings(); });
  }

  function bindComposerDrag() {
    const handle = $("#composerDragHandle"); let origin = null;
    handle.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; const rect = elements.composer.getBoundingClientRect(); origin = { pointerX: event.clientX, pointerY: event.clientY, x: rect.left, y: rect.top }; handle.setPointerCapture(event.pointerId); event.preventDefault(); });
    handle.addEventListener("pointermove", (event) => { if (!origin) return; clampComposerPosition({ x: origin.x + event.clientX - origin.pointerX, y: origin.y + event.clientY - origin.pointerY }); });
    const end = (event) => { if (!origin) return; origin = null; if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); persistSettings(); };
    handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  }

  function applyLocale() {
    const en = state.locale === "en"; document.documentElement.lang = en ? "en" : "zh-CN";
    $("#newChat").title = en ? "New chat" : "新对话"; $("#newChat").setAttribute("aria-label", $("#newChat").title);
    $("#historyToggle").title = en ? "History" : "历史记录"; $("#historyToggle").setAttribute("aria-label", $("#historyToggle").title);
    $("#settingsToggle").title = en ? "Settings" : "配置"; $("#settingsToggle").setAttribute("aria-label", $("#settingsToggle").title);
    elements.add.title = en ? "Manage platforms" : "管理平台（添加、移除和排序）"; elements.add.setAttribute("aria-label", en ? "Manage platforms" : "管理平台");
    elements.question.placeholder = en ? "Ask multiple AI services at once…" : "输入一个问题，同时询问多个 AI…"; elements.send.textContent = en ? "Send to all" : "同时提问";
    $("#attachLabel").childNodes[0].nodeValue = en ? "Add files" : "添加附件";
    for (const button of [$("#historyClose"), $("#exportClose"), $("#notesClose"), $("#serviceClose"), $("#settingsClose")]) button.setAttribute("aria-label", en ? "Close" : "关闭");
    $("#locale").value = state.locale;
  }

  function fileToPayload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: String(reader.result).split(",")[1] || "" });
      reader.readAsDataURL(file);
    });
  }

  function createSession() {
    const session = { id: crypto.randomUUID(), summary: "新会话（尚未提问）", questions: [], services: [...state.services], urls: {}, pinned: false, createdAt: Date.now(), updatedAt: Date.now() };
    state.history.unshift(session); state.currentSessionId = session.id; return session;
  }

  async function saveHistory(question) {
    let session = state.history.find((row) => row.id === state.currentSessionId);
    if (!session) session = createSession();
    session.questions.push({ id: crypto.randomUUID(), text: question, createdAt: Date.now() });
    session.summary = session.questions[0].text.slice(0, 80); session.services = [...state.services]; session.urls = { ...state.frameUrls }; session.updatedAt = Date.now();
    state.history = state.history.slice(0, 100);
    await storageSet({ "maiw.history": state.history });
    await persistSettings();
    renderHistory(); renderQuestionRail();
  }

  async function startNewChat() {
    const aiKeys = state.services.filter((key) => registry.byKey[key]?.kind === "ai");
    const response = aiKeys.length ? await sendRuntime({ action: "NEW_CHAT_ALL", services: aiKeys }) : { results: [] };
    const failures = (response?.results || []).filter((row) => !row.ok);
    for (const row of failures) {
      const frame = elements.frames.querySelector(`[data-service="${CSS.escape(row.service)}"] iframe`);
      if (frame) frame.src = row.fallbackUrl || registry.byKey[row.service]?.home;
    }
    createSession(); state.frameUrls = {}; state.lastQuestion = ""; elements.question.value = "";
    await storageSet({ "maiw.history": state.history }); await persistSettings(); renderHistory(); renderQuestionRail();
    setStatus(failures.length ? `已创建新会话；${failures.length} 个平台已返回起始页。` : "已在各平台创建新会话。", failures.length > 0);
  }

  async function persistSessionUrls() {
    const session = state.history.find((row) => row.id === state.currentSessionId);
    if (!session) return;
    session.urls = { ...state.frameUrls }; session.updatedAt = Date.now();
    await storageSet({ "maiw.history": state.history });
  }

  async function ask() {
    const question = elements.question.value.trim();
    if (!question) return setStatus("请先输入问题。", true);
    if (!state.services.length) return setStatus("请先添加至少一个平台。", true);
    elements.send.disabled = true; setStatus("正在准备并发送问题…"); state.lastQuestion = question;
    try {
      const aiKeys = state.services.filter((key) => registry.byKey[key]?.kind === "ai");
      for (const key of aiKeys) setFrameStatus(key, "发送中…");
      const payloads = await Promise.all(state.files.map(fileToPayload));
      for (const key of state.services) {
        const service = registry.byKey[key];
        if (service?.kind !== "ai") {
          const frame = elements.frames.querySelector(`[data-service="${CSS.escape(key)}"] iframe`);
          if (frame) frame.src = serviceUrl(service, question);
        }
      }
      const response = aiKeys.length ? await sendRuntime({ action: "DISPATCH_PROMPT", services: aiKeys, question, attachments: payloads, answerMode: state.answerMode }) : { ok: true, results: [] };
      await saveHistory(question);
      const failureLabels = { input_not_found: "输入框未就绪", file_input_not_found: "未找到附件入口", upload_failed: "附件上传失败", upload_unconfirmed: "附件未确认", manual_confirmation_required: "请手动确认发送", send_confirmation_timeout: "发送未确认", frame_not_ready: "页面未就绪" };
      for (const row of response?.results || []) setFrameStatus(row.service, row.ok ? "已确认" : (failureLabels[row.reason] || "发送失败"), row.ok ? "ok" : "error");
      const failures = (response?.results || []).filter((row) => !row.ok);
      setStatus(failures.length ? `${aiKeys.length - failures.length} 个 AI 已处理，${failures.length} 个面板尚未就绪；可在面板内重试或新标签页打开。` : "问题已发送到所选平台。", failures.length > 0);
    } catch (error) { setStatus(error.message || String(error), true); }
    finally { elements.send.disabled = false; }
  }

  function renderHistory() {
    elements.historyList.replaceChildren();
    if (!state.history.length) { elements.historyList.textContent = "还没有提问记录。"; return; }
    const sorted = [...state.history].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    for (const row of sorted) {
      const item = document.createElement("article"); item.className = "history-item";
      const text = document.createElement("div"); text.textContent = `${row.pinned ? "📌 " : ""}${row.summary || "新会话（尚未提问）"}`;
      const time = document.createElement("time"); time.textContent = new Date(row.updatedAt || row.createdAt).toLocaleString();
      const actions = document.createElement("div"); actions.className = "history-actions";
      const pin = document.createElement("button"); pin.textContent = row.pinned ? "取消置顶" : "置顶"; pin.addEventListener("click", async (event) => { event.stopPropagation(); row.pinned = !row.pinned; await storageSet({ "maiw.history": state.history }); renderHistory(); });
      const remove = document.createElement("button"); remove.textContent = "删除"; remove.addEventListener("click", async (event) => { event.stopPropagation(); state.history = state.history.filter((entry) => entry.id !== row.id); await storageSet({ "maiw.history": state.history }); renderHistory(); });
      actions.append(pin, remove); item.append(text, time);
      for (const [index, question] of (row.questions || []).entries()) { const button = document.createElement("button"); button.className = "history-question"; button.textContent = `问题 ${index + 1}：${question.text}`; button.addEventListener("click", async (event) => { event.stopPropagation(); state.currentSessionId = row.id; state.services = (row.services || []).filter((key) => registry.byKey[key]).slice(0, registry.maxFrames); state.frameUrls = sanitizeFrameUrls(row.urls); state.lastQuestion = question.text; elements.question.value = question.text; closeDrawers(); renderFrames(); renderHistory(); renderQuestionRail(); await persistSettings(); setTimeout(() => sendRuntime({ action: "LOCATE_QUESTION_ALL", services: state.services, question: question.text }), 1000); }); item.append(button); }
      item.append(actions);
      item.addEventListener("click", async () => { state.currentSessionId = row.id; state.services = (row.services || []).filter((key) => registry.byKey[key]).slice(0, registry.maxFrames); state.frameUrls = sanitizeFrameUrls(row.urls); await persistSettings(); renderFrames(); renderHistory(); });
      elements.historyList.append(item);
    }
  }

  async function navigateQuestion(index) {
    const session = state.history.find((row) => row.id === state.currentSessionId), question = session?.questions?.[index];
    if (!question) return;
    state.lastQuestion = question.text; elements.question.value = question.text; renderQuestionRail();
    await sendRuntime({ action: "LOCATE_QUESTION_ALL", services: state.services, question: question.text });
  }

  function renderQuestionRail() {
    /* 问题导航已统一到历史抽屉；保留空函数兼容现有会话更新链。 */
  }

  function sanitizeHtml(html, baseUrl) {
    const documentValue = new DOMParser().parseFromString(`<main>${html || ""}</main>`, "text/html");
    for (const node of documentValue.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select,canvas")) node.remove();
    for (const element of documentValue.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || ["srcdoc", "style"].includes(attribute.name.toLowerCase())) element.removeAttribute(attribute.name);
      for (const name of ["href", "src"]) { const value = element.getAttribute(name); if (!value) continue; try { const url = new URL(value, baseUrl || location.href); if (!["http:", "https:", "data:"].includes(url.protocol)) element.removeAttribute(name); else element.setAttribute(name, url.href); } catch { element.removeAttribute(name); } }
    }
    return documentValue.querySelector("main");
  }

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (!(node instanceof Element)) return "";
    const body = [...node.childNodes].map(nodeToMarkdown).join("");
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${body.trim()}\n\n`;
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") return `${body.trim()}\n\n`;
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${body}**`;
    if (tag === "em" || tag === "i") return `*${body}*`;
    if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${body}\``;
    if (tag === "pre") return `\n\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
    if (tag === "blockquote") return `${body.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "li") { const ordered = node.parentElement?.tagName.toLowerCase() === "ol"; const index = ordered ? [...node.parentElement.children].indexOf(node) + 1 : 0; return `${exportCore.listPrefix(ordered, index)} ${body.trim()}\n`; }
    if (tag === "ul" || tag === "ol") return `${body}\n`;
    if (tag === "a") return `[${body.trim() || node.getAttribute("href")}](${node.getAttribute("href") || ""})`;
    if (tag === "img") return `![${node.getAttribute("alt") || "图片"}](${node.getAttribute("src") || ""})`;
    if (tag === "tr") return `| ${[...node.children].map((cell) => (cell.textContent || "").trim().replace(/\|/g, "\\|")).join(" | ")} |\n`;
    if (tag === "table") {
      const rows = [...node.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => cell.textContent || ""));
      return rows.length ? `\n${exportCore.tableToMarkdown(rows)}\n\n` : "";
    }
    return body;
  }

  function exportText() {
    return state.selections.map((row) => { const root = sanitizeHtml(row.html, row.url); const markdown = [...root.childNodes].map(nodeToMarkdown).join("").replace(/\n{3,}/g, "\n\n").trim(); return `## ${registry.byKey[row.service]?.name || row.service}\n\n${markdown || row.text.trim()}`; }).join("\n\n---\n\n");
  }

  function buildExportContainer(owner = document) {
    const container = owner.createElement("main"); container.className = "multi-ai-export";
    const heading = owner.createElement("h1"); heading.textContent = "多AI问答助手 · 内容摘取"; container.append(heading);
    for (const row of state.selections) { const article = owner.createElement("article"); const title = owner.createElement("h2"); title.textContent = registry.byKey[row.service]?.name || row.service; article.append(title); const fragment = owner.createElement("div"); if (row.crop) fragment.style.clipPath = `inset(${row.crop.top}% ${row.crop.right}% ${row.crop.bottom}% ${row.crop.left}%)`; const clean = sanitizeHtml(row.html, row.url); for (const child of [...clean.childNodes]) fragment.append(owner.importNode(child, true)); article.append(fragment); container.append(article); }
    return container;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  }

  async function inlineRemoteImages(container) {
    let failed = 0;
    const images = [...container.querySelectorAll("img")];
    await Promise.all(images.map(async (image) => {
      const source = image.src;
      if (!source || source.startsWith("data:")) return;
      try {
        const response = await fetch(source, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith("image/") || !blob.size) throw new Error("invalid_image");
        image.src = await blobToDataUrl(blob);
      } catch { failed += 1; image.replaceWith(image.ownerDocument.createTextNode(`[图片加载失败：${image.alt || source}]`)); }
    }));
    return { total: images.length, failed };
  }

  async function waitForImages(container, timeout = 12000) {
    const images = [...container.querySelectorAll("img")];
    await Promise.race([
      Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener("load", resolve, { once: true }); image.addEventListener("error", resolve, { once: true }); }))),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);
  }

  async function downloadMarkdown() {
    if (!state.selections.length) return setStatus("摘取篮为空。", true);
    const content = `# 多AI问答助手内容摘取\n\n${exportText()}\n`;
    download(new Blob([content], { type: "text/markdown;charset=utf-8" }), `多AI摘取-${new Date().toISOString().slice(0, 10)}.md`);
    try { await navigator.clipboard.writeText(content); setStatus("Markdown 已下载并复制到剪贴板。"); }
    catch { setStatus("Markdown 已下载；浏览器未允许复制到剪贴板。"); }
  }

  async function exportPng() {
    if (!state.selections.length) return setStatus("摘取篮为空。", true);
    const mount = buildExportContainer(); mount.style.cssText = "position:fixed;left:-12000px;top:0;width:1000px;padding:48px;background:#fff;color:#18202f;font:18px/1.65 system-ui;"; document.body.append(mount);
    try {
      const imageResult = await inlineRemoteImages(mount); await waitForImages(mount); await document.fonts?.ready;
      const width = 1096, fullHeight = Math.max(500, mount.scrollHeight + 96), slices = exportCore.pageSlices(fullHeight), pages = slices.length;
      const clone = mount.cloneNode(true); clone.style.cssText = "width:1000px;padding:48px;background:#fff;color:#18202f;font:18px/1.65 system-ui;";
      const serialized = new XMLSerializer().serializeToString(clone);
      for (let page = 0; page < pages; page += 1) {
        const { offset, height } = slices[page];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="transform:translateY(-${offset}px)">${serialized}</div></foreignObject></svg>`;
        const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); if (!context) throw new Error("canvas_unavailable"); context.drawImage(image, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png")); if (!blob) throw new Error("canvas_empty");
        download(blob, `多AI摘取-${new Date().toISOString().slice(0, 10)}${pages > 1 ? `-${page + 1}` : ""}.png`);
      }
      setStatus(`PNG 已下载（${pages} 页，图片 ${imageResult.total - imageResult.failed}/${imageResult.total} 成功）。`, imageResult.failed > 0);
    } catch (error) { setStatus(`PNG 生成失败：${error.message}。可改用 Markdown 或 PDF。`, true); }
    finally { mount.remove(); }
  }

  async function printSelections() {
    if (!state.selections.length) return setStatus("摘取篮为空。", true);
    const popup = window.open("", "_blank", "popup,width=900,height=700");
    if (!popup) return setStatus("浏览器阻止了打印窗口，请允许弹窗后重试。", true);
    popup.document.title = "多AI问答助手内容摘取";
    const style = popup.document.createElement("style"); style.textContent = "body{max-width:850px;margin:40px auto;padding:0 24px;font:16px/1.7 system-ui;color:#18202f}article{break-inside:avoid;border-top:1px solid #ddd;padding:18px 0}h1{font-size:28px}h2{color:#4f46e5}p{white-space:pre-wrap}"; popup.document.head.append(style);
    const content = buildExportContainer(popup.document); popup.document.body.append(content);
    const imageResult = await inlineRemoteImages(content); await waitForImages(content); await popup.document.fonts?.ready;
    popup.focus(); popup.print();
    setStatus(`打印页面已准备完成（图片 ${imageResult.total - imageResult.failed}/${imageResult.total} 成功）。`, imageResult.failed > 0);
  }

  function renderSelections() {
    elements.exportList.replaceChildren();
    for (const [index, row] of state.selections.entries()) {
      const item = document.createElement("article"); item.className = "export-item";
      const title = document.createElement("strong"); title.textContent = registry.byKey[row.service]?.name || row.service;
      const text = document.createElement("div"); text.contentEditable = "true"; text.title = "可直接编辑导出内容"; const clean = sanitizeHtml(row.html, row.url); for (const child of [...clean.childNodes]) text.append(document.importNode(child, true)); text.addEventListener("input", () => { row.html = text.innerHTML; row.text = text.innerText; });
      const remove = document.createElement("button"); remove.textContent = "移除"; remove.addEventListener("click", () => { state.selections.splice(index, 1); renderSelections(); });
      const restore = document.createElement("button"); restore.textContent = "恢复原始"; restore.addEventListener("click", () => { row.html = row.originalHtml; row.text = row.originalText; renderSelections(); });
      const crop = document.createElement("button"); crop.textContent = "二次裁剪"; crop.addEventListener("click", () => { const value = prompt("输入上、右、下、左裁剪百分比（例如 0,10,0,10）", row.crop ? `${row.crop.top},${row.crop.right},${row.crop.bottom},${row.crop.left}` : "0,0,0,0"); if (value == null) return; const values = value.split(",").map((part) => Math.max(0, Math.min(45, Number(part.trim()) || 0))); if (values.length !== 4) return setStatus("裁剪值必须为四个百分比。", true); row.crop = { top: values[0], right: values[1], bottom: values[2], left: values[3] }; text.style.clipPath = `inset(${values[0]}% ${values[1]}% ${values[2]}% ${values[3]}%)`; });
      item.append(title, text, crop, restore, remove); elements.exportList.append(item);
    }
  }

  async function renderNotes() {
    const stored = await storageGet(["maiw.highlights"]), rows = stored["maiw.highlights"] || [];
    elements.notesList.replaceChildren();
    if (!rows.length) { elements.notesList.textContent = "暂无划线或标记。"; return; }
    for (const row of [...rows].reverse()) { const item = document.createElement("article"); item.className = "history-item"; const title = document.createElement("strong"); title.textContent = registry.byKey[row.service]?.name || row.service; const text = document.createElement("p"); text.textContent = row.text; const note = document.createElement("p"); note.textContent = row.note ? `笔记：${row.note}` : ""; const actions = document.createElement("div"); actions.className = "history-actions"; const copy = document.createElement("button"); copy.textContent = "复制"; copy.addEventListener("click", () => navigator.clipboard.writeText(row.text)); const jump = document.createElement("button"); jump.textContent = "跳转"; jump.addEventListener("click", async () => { const session = state.history.find((entry) => Object.values(entry.urls || {}).includes(row.url)); if (session) { state.currentSessionId = session.id; state.services = session.services; state.frameUrls = sanitizeFrameUrls(session.urls); renderFrames(); await persistSettings(); } closeDrawers(); setTimeout(() => sendRuntime({ action: "LOCATE_QUESTION_ALL", services: [row.service], question: row.text }), 1200); }); actions.append(copy, jump); item.append(title, text, note, actions); elements.notesList.append(item); }
  }

  async function initialize() {
    const stored = await storageGet(["maiw.settings", "maiw.history", "maiw.guideSeen", "maiw.promptTemplates", "maiw.operations", "maiw.operationGroups"]);
    const settings = stored["maiw.settings"] || {};
    const validServices = Array.isArray(settings.services) ? settings.services.filter((key) => registry.byKey[key]).slice(0, registry.maxFrames) : null;
    if (validServices?.length) state.services = validServices;
    const validLayouts = ["auto", "1x1", "1x2", "1x3", "1x4", "1x5", "2x2", "2x3", "2x4", "2x5"];
    if (validLayouts.includes(settings.layout)) state.layout = settings.layout;
    else if (["1", "2", "3", "4", "5"].includes(settings.layout)) state.layout = `1x${settings.layout}`;
    if (["light", "dark"].includes(settings.theme)) state.theme = settings.theme;
    if (["zh", "en"].includes(settings.locale)) state.locale = settings.locale;
    const consent = await globalThis.MultiAIPrivacyUI.ensureConsent({ locale: state.locale, onLocaleChange: (locale) => { state.locale = locale; } });
    state.locale = consent.locale;
    if (["new", "resume"].includes(settings.openBehavior)) state.openBehavior = settings.openBehavior;
    if (["expert", "fast"].includes(settings.answerMode)) state.answerMode = settings.answerMode;
    if (typeof settings.launcherEnabled === "boolean") state.launcherEnabled = settings.launcherEnabled;
    state.launcherScope = !state.launcherEnabled || settings.launcherScope === "off" ? "off" : (settings.launcherScope === "all" ? "all" : "supported");
    state.launcherStyle = settings.launcherStyle === "image" ? "image" : "animated";
    state.launcherSize = Math.min(240, Math.max(96, Number(settings.launcherSize) || 160));
    state.launcherAnimationPack = settings.launcherAnimationPack === "basic" ? "basic" : "rich";
    state.launcherRandomFrequency = ["off", "low", "normal", "high"].includes(settings.launcherRandomFrequency) ? settings.launcherRandomFrequency : "normal";
    state.contextMenuMode = settings.contextMenuMode === "grouped" ? "grouped" : "flat";
    const configuration = promptTemplates.resolveConfiguration(stored["maiw.operations"], stored["maiw.operationGroups"], stored["maiw.promptTemplates"], settings.promptMenuTemplateIds); state.operations = configuration.operations; state.operationGroups = configuration.groups; if (configuration.migrated) await storageSet({ "maiw.operations": state.operations, "maiw.operationGroups": state.operationGroups });
    if (settings.composerPosition && Number.isFinite(settings.composerPosition.x) && Number.isFinite(settings.composerPosition.y)) state.composerPosition = settings.composerPosition;
    state.widths = settings.widths && typeof settings.widths === "object" ? settings.widths : {};
    state.history = Array.isArray(stored["maiw.history"]) ? stored["maiw.history"].filter((row) => Array.isArray(row.questions)) : [];
    state.currentSessionId = typeof settings.currentSessionId === "string" ? settings.currentSessionId : "";
    if (state.openBehavior === "new" || !state.history.some((row) => row.id === state.currentSessionId)) createSession();
    else state.frameUrls = sanitizeFrameUrls(state.history.find((row) => row.id === state.currentSessionId)?.urls, true);
    document.documentElement.dataset.theme = state.theme; renderFrames(); renderHistory(); renderQuestionRail(); applyLocale();
    $("#openBehavior").value = state.openBehavior; $("#answerMode").value = state.answerMode; $("#settingsAnswerMode").value = state.answerMode; $("#launcherScope").value = state.launcherScope; $("#launcherStyle").value = state.launcherStyle; $("#launcherAnimationPack").value = state.launcherAnimationPack; $("#launcherRandomFrequency").value = state.launcherRandomFrequency; $("#launcherSize").value = String(state.launcherSize); $("#launcherSizeValue").value = `${state.launcherSize} px`; $("#contextMenuMode").value = state.contextMenuMode; const commands = await chrome.commands.getAll(); state.commandShortcuts = Object.fromEntries(commands.map((row) => [row.name, row.shortcut])); renderPromptTemplates();
    requestAnimationFrame(() => {
      if (state.composerPosition) clampComposerPosition();
      else if (settings.questionPosition === "top") clampComposerPosition({ x: (innerWidth - elements.composer.getBoundingClientRect().width) / 2, y: 78 });
      else resetComposerPosition(false);
    });
    const registration = await sendRuntime({ action: "REGISTER_WORKSPACE" }); state.workspaceTabId = registration?.tabId ?? null; state.workspaceWindowId = registration?.windowId ?? null;
    const openSettings = (await chrome.storage.session.get("maiw.openSettings"))["maiw.openSettings"]; if (["templates", "operations"].includes(openSettings)) { await chrome.storage.session.remove("maiw.openSettings"); openDrawer(elements.settingsPanel); showSettingsTab("operations"); }
    if (!stored["maiw.guideSeen"]) showInstallGuide();
  }

  function showInstallGuide() {
    const guide = document.createElement("div"); guide.style.cssText = "position:fixed;z-index:80;inset:0;display:grid;place-items:center;background:#0008";
    const card = document.createElement("section"); card.style.cssText = "max-width:430px;padding:24px;background:var(--panel);border-radius:16px;box-shadow:var(--shadow)";
    const title = document.createElement("h2"); title.textContent = "一次提问，同时查看多个回答"; const body = document.createElement("p"); body.textContent = "拖动提问卡顶部手柄可调整位置；点击顶部的平台管理按钮可集中添加、移除和排序平台。在支持的网站中，还可以点击圆形启动球返回工作台。"; const close = document.createElement("button"); close.className = "primary"; close.textContent = "知道了"; close.addEventListener("click", async () => { guide.remove(); await storageSet({ "maiw.guideSeen": true }); }); card.append(title, body, close); guide.append(card); document.body.append(guide);
  }

  elements.send.addEventListener("click", ask);
  elements.question.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); } });
  elements.files.addEventListener("change", () => { try { state.files = validateFiles([...state.files, ...elements.files.files]); renderFiles(); setStatus(""); } catch (error) { elements.files.value = ""; setStatus(error.message, true); } });
  elements.question.addEventListener("paste", (event) => { const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/")); if (!images.length) return; try { state.files = validateFiles([...state.files, ...images]); renderFiles(); } catch (error) { setStatus(error.message, true); } });
  elements.add.addEventListener("click", openServiceManager);
  $("#framesPrev").addEventListener("click", () => elements.frames.scrollBy({ left: -elements.frames.clientWidth * .9, behavior: "smooth" }));
  $("#framesNext").addEventListener("click", () => elements.frames.scrollBy({ left: elements.frames.clientWidth * .9, behavior: "smooth" }));
  elements.layout.addEventListener("change", () => { state.layout = elements.layout.value; applyLayout(); persistSettings(); });
  elements.theme.addEventListener("click", async () => { state.theme = state.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = state.theme; await persistSettings(); await sendRuntime({ action: "SET_APPEARANCE", services: state.services, theme: state.theme }); });
  $("#settingsToggle").addEventListener("click", () => { openDrawer(elements.settingsPanel); showSettingsTab("general"); });
  $("#aboutToggle").addEventListener("click", () => globalThis.MultiAIPrivacyUI.openAbout(state.locale));
  $("#aboutOpen").addEventListener("click", () => globalThis.MultiAIPrivacyUI.openAbout(state.locale));
  $("#privacyPolicyOpen").addEventListener("click", () => globalThis.MultiAIPrivacyUI.openPrivacy(state.locale));
  $("#sidePanelToggle").addEventListener("click", async () => {
    if (typeof state.workspaceWindowId !== "number") return setStatus("无法识别当前浏览器窗口。", true);
    try { await chrome.sidePanel.open({ windowId: state.workspaceWindowId }); await sendRuntime({ action: "CLOSE_WORKSPACE_FOR_SIDE_PANEL", windowId: state.workspaceWindowId }); }
    catch (error) { setStatus(`侧栏打开失败：${error.message}`, true); }
  });
  $("#minimizeToggle").addEventListener("click", async () => { if (typeof state.workspaceWindowId === "number") await sendRuntime({ action: "MINIMIZE_UI", windowId: state.workspaceWindowId }); });
  $("#locale").addEventListener("change", async (event) => { state.locale = event.target.value; applyLocale(); await persistSettings(); });
  $("#openBehavior").addEventListener("change", (event) => { state.openBehavior = event.target.value; persistSettings(); });
  $("#answerMode").addEventListener("change", (event) => { state.answerMode = event.target.value; $("#settingsAnswerMode").value = state.answerMode; persistSettings(); });
  $("#settingsAnswerMode").addEventListener("change", (event) => { state.answerMode = event.target.value; $("#answerMode").value = state.answerMode; persistSettings(); });
  $("#settingsTabs").addEventListener("click", (event) => { const button = event.target.closest("button[data-settings-tab]"); if (button) showSettingsTab(button.dataset.settingsTab); });
  $("#contextMenuMode").addEventListener("change", (event) => { state.contextMenuMode = event.target.value === "grouped" ? "grouped" : "flat"; persistSettings(); });
  $("#newPromptTemplate").addEventListener("click", () => openPromptTemplateForm());
  $("#cancelPromptTemplate").addEventListener("click", () => { $("#promptTemplateForm").hidden = true; });
  $("#operationTargetMode").addEventListener("change", () => renderOperationServices([...$("#operationServices").querySelectorAll("input:checked")].map((input) => input.value)));
  $("#promptTemplateForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const existingId = $("#promptTemplateId").value, id = existingId || `custom-${crypto.randomUUID()}`, existing = state.operations.find((row) => row.id === id), shortcutSlot = Number($("#operationShortcutSlot").value) || 0;
    const serviceKeys = [...$("#operationServices").querySelectorAll("input:checked")].map((input) => input.value); if ($("#operationTargetMode").value === "fixed" && !serviceKeys.length) return setStatus("固定调用模式至少选择一个 AI。", true);
    const operation = promptTemplates.normalizeOperation({ ...existing, id, name: $("#promptTemplateName").value, icon: $("#operationIcon").value || "自", category: $("#promptTemplateCategory").value, groupId: $("#operationGroup").value, enabled: $("#operationEnabled").checked, showInContextMenu: $("#operationShowContext").checked, showInPicker: $("#operationShowPicker").checked, prompt: $("#promptTemplatePrompt").value, targetMode: $("#operationTargetMode").value, serviceKeys, execution: $("#operationExecution").value, answerMode: $("#operationAnswerMode").value, shortcutSlot, order: existing?.order ?? state.operations.length });
    if (!operation) return setStatus("操作名称和提示词不能为空。", true); if (shortcutSlot) state.operations = state.operations.map((row) => row.id !== id && row.shortcutSlot === shortcutSlot ? { ...row, shortcutSlot: 0 } : row); state.operations = [...state.operations.filter((row) => row.id !== id), operation].sort((a, b) => a.order - b.order); $("#promptTemplateForm").hidden = true; await savePromptTemplates(); setStatus(`操作“${operation.name}”已保存。`);
  });
  $("#deleteOperation").addEventListener("click", async () => { const id = $("#promptTemplateId").value, operation = state.operations.find((row) => row.id === id); if (!operation || operation.builtin || !confirm(`删除操作“${operation.name}”吗？`)) return; state.operations = state.operations.filter((row) => row.id !== id); $("#promptTemplateForm").hidden = true; await savePromptTemplates(); });
  $("#restoreOperation").addEventListener("click", async () => { const id = $("#promptTemplateId").value, restored = promptTemplates.restoreBuiltin(id); if (!restored) return; const existing = state.operations.find((row) => row.id === id); restored.order = existing?.order ?? restored.order; state.operations = state.operations.map((row) => row.id === id ? restored : (restored.shortcutSlot && row.shortcutSlot === restored.shortcutSlot ? { ...row, shortcutSlot: 0 } : row)); openPromptTemplateForm(restored); await savePromptTemplates(); setStatus(`“${restored.name}”已恢复默认。`); });
  $("#newOperationGroup").addEventListener("click", () => { $("#operationGroupId").value = ""; $("#operationGroupName").value = ""; $("#operationGroupForm").hidden = false; $("#promptTemplateForm").hidden = true; $("#operationGroupName").focus(); });
  $("#cancelOperationGroup").addEventListener("click", () => { $("#operationGroupForm").hidden = true; });
  $("#operationGroupForm").addEventListener("submit", async (event) => { event.preventDefault(); const existingId = $("#operationGroupId").value, id = existingId || `group-${crypto.randomUUID()}`, group = promptTemplates.normalizeGroup({ id, name: $("#operationGroupName").value, order: state.operationGroups.find((row) => row.id === id)?.order ?? state.operationGroups.length }); if (!group) return setStatus("分组名称不能为空。", true); state.operationGroups = [...state.operationGroups.filter((row) => row.id !== id), group].sort((a, b) => a.order - b.order); $("#operationGroupForm").hidden = true; await savePromptTemplates(); });
  $("#openShortcutSettings").addEventListener("click", () => chrome.tabs.create({ url: navigator.userAgent.includes("Edg/") ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts" }));
  $("#newChat").addEventListener("click", startNewChat);
  $("#historyToggle").addEventListener("click", () => openDrawer(elements.historyPanel));
  $("#historyClose").addEventListener("click", closeDrawers);
  $("#notesToggle")?.addEventListener("click", async () => { await renderNotes(); openDrawer(elements.notesPanel); });
  $("#notesClose").addEventListener("click", closeDrawers);
  $("#exportClose").addEventListener("click", closeDrawers);
  $("#serviceClose").addEventListener("click", closeDrawers); $("#serviceCancel").addEventListener("click", closeDrawers);
  $("#serviceApply").addEventListener("click", async () => { state.services = [...state.serviceDraft]; closeDrawers(); renderFrames(); await persistSettings(); setStatus(`已应用 ${state.services.length} 个平台。`); });
  $("#serviceSearch").addEventListener("input", renderServiceManager);
  $("#serviceCategories").addEventListener("click", (event) => { const button = event.target.closest("button[data-category]"); if (!button) return; state.serviceCategory = button.dataset.category; for (const item of $("#serviceCategories").querySelectorAll("button")) item.classList.toggle("active", item === button); renderServiceManager(); });
  $("#settingsClose").addEventListener("click", closeDrawers); elements.backdrop.addEventListener("click", closeDrawers);
  $("#launcherScope").addEventListener("change", async (event) => {
    let scope = event.target.value;
    if (scope === "all") {
      const granted = await chrome.permissions.request({ origins: ["http://*/*", "https://*/*"] });
      if (!granted) { scope = "supported"; event.target.value = scope; setStatus("未获得全网页权限，已改为仅在支持的平台显示。", true); }
    } else {
      await chrome.permissions.remove({ origins: ["http://*/*", "https://*/*"] });
    }
    state.launcherScope = scope; state.launcherEnabled = scope !== "off"; await persistSettings(); const result = await sendRuntime({ action: "SYNC_LAUNCHER_SCOPE" });
    if (result?.ok && scope !== "off") setStatus(scope === "all" ? `桌宠已启用，并已尝试补充到 ${result.injected || 0} 个已打开网页。` : "桌宠仅在支持的 AI/搜索平台显示。");
  });
  $("#launcherStyle").addEventListener("change", async (event) => { state.launcherStyle = event.target.value === "image" ? "image" : "animated"; await persistSettings(); setStatus(state.launcherStyle === "image" ? "已切换为图片桌宠。" : "已切换为动画桌宠。"); });
  $("#launcherAnimationPack").addEventListener("change", async (event) => { state.launcherAnimationPack = event.target.value === "basic" ? "basic" : "rich"; await persistSettings(); setStatus(state.launcherAnimationPack === "rich" ? "已启用丰富动画。" : "已切换为基础动画。"); });
  $("#launcherRandomFrequency").addEventListener("change", async (event) => { state.launcherRandomFrequency = ["off", "low", "normal", "high"].includes(event.target.value) ? event.target.value : "normal"; await persistSettings(); setStatus(state.launcherRandomFrequency === "off" ? "随机休闲动作已关闭。" : "随机休闲动作频率已更新。"); });
  $("#launcherSize").addEventListener("input", (event) => { $("#launcherSizeValue").value = `${event.target.value} px`; });
  $("#launcherSize").addEventListener("change", async (event) => { state.launcherSize = Math.min(240, Math.max(96, Number(event.target.value) || 160)); $("#launcherSizeValue").value = `${state.launcherSize} px`; await persistSettings(); setStatus(`桌宠大小已调整为 ${state.launcherSize} px。`); });
  $("#resetLauncherPosition").addEventListener("click", async () => { await chrome.storage.local.remove("maiw.launcherPosition"); setStatus("网页桌宠位置已恢复默认。"); });
  $("#resetComposerPosition").addEventListener("click", () => { resetComposerPosition(); setStatus("提问框位置已恢复默认。"); });
  $("#exportMarkdown").addEventListener("click", downloadMarkdown);
  $("#exportPng").addEventListener("click", exportPng);
  $("#exportPdf").addEventListener("click", printSelections);
  $("#exportClear").addEventListener("click", () => { state.selections = []; renderSelections(); });
  bindComposerDrag();
  window.addEventListener("resize", () => { if (state.composerPosition) clampComposerPosition(); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawers(); });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action === "FRAME_NAVIGATED" && (state.workspaceTabId == null || message.tabId === state.workspaceTabId) && registry.byKey[message.service] && typeof message.url === "string") {
      const url = registry.normalizeFrameUrl(message.service, message.url); if (url) { state.frameUrls[message.service] = url; persistSessionUrls(); }
    }
    if (message?.action === "PLATFORM_NEEDS_LOGIN") showFrameNotice(message.service, message.url);
    if (message?.action === "PLATFORM_READY") elements.frames.querySelector(`[data-service="${CSS.escape(message.service)}"] .frame-notice`)?.remove();
    if (message?.action === "PICKER_RESULT" && message.item) {
      if (state.selectionService !== message.service) state.selections = [];
      state.selectionService = message.service;
      if (message.selected === false) state.selections = state.selections.filter((row) => row.id !== message.item.id);
      else { const text = String(message.item.text || "").trim(), html = message.item.html || ""; state.selections.push({ id: message.item.id, service: message.service, text, originalText: text, html, originalHtml: html, rect: message.item.rect || null, crop: null, url: message.item.url || state.frameUrls[message.service] || "" }); }
      renderSelections(); openDrawer(elements.exportPanel); setStatus(`已从 ${registry.byKey[message.service]?.name || message.service} 添加一项摘取。`);
    }
  });
  initialize().catch((error) => setStatus(`初始化失败：${error.message}`, true));
})();
