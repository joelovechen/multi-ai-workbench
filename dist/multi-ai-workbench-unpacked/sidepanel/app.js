(function initSidePanel() {
  "use strict";
  const registry = globalThis.MultiAIServiceRegistry, promptTemplates = globalThis.MultiAIPromptTemplates;
  const $ = (selector) => document.querySelector(selector);
  const sidepanelServices = [...registry.defaults, ...registry.ai.map((service) => service.key).filter((key) => !registry.defaults.includes(key))];
  const sidepanelMaxFrames = registry.ai.length, sidepanelCatalogVersion = 2;
  const state = { services: [], targets: new Set(), active: "", locale: "zh", answerMode: "expert", embedLayoutMode: "adaptive", files: [], ready: new Set(), statuses: new Map(), operations: [], groups: [], activeActionId: "", recentActionIds: [], actionContext: {}, failedServices: new Set(), lastPayload: null, lastSent: null };
  const pending = new Map(), readyOrigins = new Map(); let draftTimer = 0, initialized = false, deferredTask = null, lastCarouselWheelAt = 0, affiliateController = null;

  function setStatus(message, error = false) { const node = $("#status"); node.textContent = message; node.classList.toggle("error", error); }
  async function persist() { await chrome.storage.local.set({ "maiw.sidepanel": { services: state.services, targets: [...state.targets], active: state.active, answerMode: state.answerMode, embedLayoutMode: state.embedLayoutMode, recentActionIds: state.recentActionIds, catalogVersion: sidepanelCatalogVersion }, "maiw.sidepanelDraft": { text: $("#question").value, actionId: state.activeActionId } }); }
  function scheduleDraftSave() { clearTimeout(draftTimer); draftTimer = setTimeout(() => void persist(), 250); }
  function statusLabel(status) { return { pending: "正在发送", ok: "已确认", error: "发送失败", login: "需要登录", unread: "已完成" }[status] || ""; }

  function activateTab(key) {
    if (!state.services.includes(key)) return;
    state.active = key; if (state.statuses.get(key) === "unread") state.statuses.set(key, "ok");
    ensureFrameLoaded(key);
    for (const frame of document.querySelectorAll(".ai-frame")) frame.classList.toggle("active", frame.dataset.service === key);
    renderTabs(); void persist();
  }

  function rotateModel(direction) {
    if (state.services.length < 2) return;
    const current = Math.max(0, state.services.indexOf(state.active)), next = (current + direction + state.services.length) % state.services.length;
    activateTab(state.services[next]);
  }

  function renderTabs() {
    const list = $("#tabList"), existing = new Map([...list.querySelectorAll(".ai-tab")].map((button) => [button.dataset.service, button])), activeIndex = Math.max(0, state.services.indexOf(state.active)), length = state.services.length;
    for (const [key, button] of existing) if (!state.services.includes(key)) button.remove();
    state.services.forEach((key, index) => {
      const service = registry.byKey[key]; if (!service) return;
      const status = state.statuses.get(key) || "", selected = state.active === key; let button = existing.get(key);
      if (!button) {
        const iconWrap = document.createElement("span"), icon = document.createElement("img"), fallback = document.createElement("span"); button = document.createElement("button"); button.className = "ai-tab"; button.dataset.service = key; button.type = "button"; button.setAttribute("role", "tab");
        iconWrap.className = "ai-tab-icon-wrap"; icon.className = "ai-tab-icon"; icon.src = chrome.runtime.getURL(`assets/platform-icons/${key}.png`); icon.alt = ""; icon.addEventListener("error", () => icon.classList.add("is-broken"), { once: true }); fallback.className = "ai-tab-fallback"; fallback.textContent = service.name.slice(0, 2); iconWrap.append(icon, fallback); button.append(iconWrap);
        button.addEventListener("click", () => activateTab(key)); button.addEventListener("keydown", (event) => { if (event.key === "ArrowLeft") rotateModel(-1); else if (event.key === "ArrowRight") rotateModel(1); else if (event.key === "Home") activateTab(state.services[0]); else if (event.key === "End") activateTab(state.services.at(-1)); else return; event.preventDefault(); requestAnimationFrame(() => list.querySelector(".ai-tab.active")?.focus()); }); list.append(button);
      }
      let offset = index - activeIndex; const half = Math.floor(length / 2); if (offset > half) offset -= length; if (offset < -half) offset += length; const distance = Math.abs(offset), scale = distance === 0 ? 1.08 : distance === 1 ? .96 : distance === 2 ? .86 : .76;
      button.className = `ai-tab${selected ? " active" : ""}`; button.dataset.service = key; button.dataset.status = status; button.type = "button"; button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(selected)); button.setAttribute("aria-label", `${service.name}${statusLabel(status) ? `，${statusLabel(status)}` : ""}`); button.title = statusLabel(status) ? `${service.name} · ${statusLabel(status)}` : `切换到 ${service.name}`;
      button.dataset.carouselOffset = String(offset); button.dataset.carouselDistance = String(distance); button.tabIndex = selected ? 0 : -1; button.setAttribute("aria-hidden", String(distance > 3)); button.style.setProperty("--carousel-x", `${offset * 37}px`); button.style.setProperty("--carousel-scale", String(scale)); button.style.setProperty("--carousel-opacity", distance === 0 ? "1" : distance === 1 ? ".92" : distance === 2 ? ".62" : distance === 3 ? ".24" : "0"); button.style.zIndex = String(20 - Math.min(distance, 10));
      list.append(button);
    });
    $("#previousModel").disabled = state.services.length < 2; $("#nextModel").disabled = state.services.length < 2;
  }

  function renderFrames() {
    const stack = $("#frameStack"); stack.replaceChildren(); state.ready.clear(); readyOrigins.clear();
    for (const key of state.services) {
      const iframe = document.createElement("iframe"), shouldLoad = key === state.active || state.targets.has(key); iframe.className = `ai-frame${state.active === key ? " active" : ""}`; iframe.dataset.service = key; iframe.dataset.home = registry.byKey[key].home; iframe.dataset.loaded = String(shouldLoad); iframe.src = shouldLoad ? registry.byKey[key].home : "about:blank"; iframe.title = registry.byKey[key].name;
      iframe.addEventListener("load", () => { state.ready.delete(key); readyOrigins.delete(key); if (!state.failedServices.has(key)) state.statuses.set(key, ""); renderTabs(); }); stack.append(iframe);
    }
    renderTabs(); renderTargets();
  }

  function ensureFrameLoaded(key) {
    const iframe = document.querySelector(`.ai-frame[data-service="${CSS.escape(key)}"]`); if (!iframe || iframe.dataset.loaded === "true") return false;
    iframe.dataset.loaded = "true"; iframe.src = iframe.dataset.home || registry.byKey[key]?.home || "about:blank"; return true;
  }

  function renderManager() {
    const holder = $("#platformOptions"); holder.replaceChildren(); $("#platformCount").textContent = `${state.services.length}/${sidepanelMaxFrames}`;
    for (const service of registry.ai) {
      const label = document.createElement("label"), input = document.createElement("input"); label.className = "platform-option"; input.type = "checkbox"; input.checked = state.services.includes(service.key); input.disabled = !input.checked && state.services.length >= sidepanelMaxFrames;
      input.addEventListener("change", async () => { if (input.checked) state.services.push(service.key); else state.services = state.services.filter((key) => key !== service.key); if (!state.services.length) { state.services = [service.key]; input.checked = true; return setStatus("侧栏至少保留一个 AI。", true); } state.targets = new Set([...state.targets].filter((key) => state.services.includes(key))); if (input.checked) state.targets.add(service.key); if (!state.services.includes(state.active)) state.active = state.services[0]; renderManager(); renderFrames(); await persist(); });
      label.append(input, document.createTextNode(service.name)); holder.append(label);
    }
  }

  function renderTargets() {
    const menu = $("#targetMenu"); menu.replaceChildren();
    for (const key of state.services) {
      const label = document.createElement("label"), input = document.createElement("input"); label.className = "target-option"; input.type = "checkbox"; input.checked = state.targets.has(key);
      input.addEventListener("change", () => { if (input.checked) { state.targets.add(key); ensureFrameLoaded(key); } else state.targets.delete(key); renderTargets(); void persist(); }); label.append(input, document.createTextNode(registry.byKey[key].name)); menu.append(label);
    }
    const count = state.targets.size; $("#targetToggle").textContent = count === state.services.length ? `全部 ${count} 个 AI⌄` : `${count} 个 AI⌄`;
  }

  function allTemplates() { return state.operations.filter((row) => row.enabled && row.showInPicker); }
  function activeTemplate() { return promptTemplates.find(state.activeActionId, state.operations); }
  function updateFrameInset() { const height = Math.ceil(document.querySelector(".composer")?.getBoundingClientRect().height || 138), bottom = height + 16; $("#frameStack").style.bottom = `${bottom}px`; $("#templatePicker").style.bottom = `${bottom}px`; $("#targetMenu").style.bottom = `${bottom}px`; }
  function renderActiveTemplate() { const operation = activeTemplate(); $("#activeTemplate").hidden = !operation; $("#activeTemplateLabel").textContent = operation ? `${operation.icon} ${operation.name}` : ""; $("#templateToggle").textContent = operation ? "✨ 更换操作" : "✨ 选择操作"; updateFrameInset(); }
  function applyTemplate(id, context = null) { state.activeActionId = promptTemplates.find(id, state.operations)?.enabled ? id : ""; if (context) state.actionContext = context; if (state.activeActionId) state.recentActionIds = [state.activeActionId, ...state.recentActionIds.filter((item) => item !== state.activeActionId)].slice(0, 5); renderActiveTemplate(); scheduleDraftSave(); }
  function composedQuestion() { return promptTemplates.build(activeTemplate(), { content: $("#question").value, ...state.actionContext }); }

  async function activateOperation(operation, context = null, execute = false) {
    if (!operation) return;
    applyTemplate(operation.id, context);
    if (operation.targetMode === "fixed") {
      const fixed = operation.serviceKeys.filter((key) => registry.byKey[key]?.kind === "ai").slice(0, sidepanelMaxFrames);
      const merged = [...new Set([...state.services, ...fixed])].slice(-sidepanelMaxFrames); const changed = merged.join() !== state.services.join(); state.services = merged; state.targets = new Set(fixed);
      if (fixed.length) state.active = fixed[0]; if (changed) { renderFrames(); renderManager(); } else { for (const frame of document.querySelectorAll(".ai-frame")) frame.classList.toggle("active", frame.dataset.service === state.active); renderTabs(); renderTargets(); }
    } else if (operation.targetMode === "active") { state.targets = new Set([state.active]); renderTargets(); }
    else if (operation.targetMode === "ask") { $("#targetMenu").hidden = false; renderTargets(); execute = false; }
    await persist(); if (execute && operation.execution === "direct" && $("#question").value.trim()) void ask();
  }

  function templateButton(template) {
    const button = document.createElement("button"), icon = document.createElement("span"), text = document.createElement("span"), strong = document.createElement("strong"), small = document.createElement("small");
    button.className = "template-item"; button.dataset.templateId = template.id; icon.className = "template-icon"; icon.textContent = template.shortcutSlot ? String(template.shortcutSlot) : template.icon; strong.textContent = template.name;
    const targetText = template.targetMode === "fixed" ? `${template.serviceKeys.length} 个固定 AI` : template.targetMode === "active" ? "当前 AI" : template.targetMode === "ask" ? "执行时选择" : "当前已选 AI"; small.textContent = targetText; text.append(strong, small); button.append(icon, text);
    button.addEventListener("click", () => { $("#templatePicker").hidden = true; void activateOperation(template, state.actionContext, true); }); return button;
  }

  function renderTemplatePicker(filter = "") {
    const query = String(filter).trim().toLowerCase(), all = allTemplates().filter((row) => !query || `${row.name} ${row.category}`.toLowerCase().includes(query)), recent = $("#templateRecent"); recent.replaceChildren();
    const recentRows = state.recentActionIds.map((id) => allTemplates().find((row) => row.id === id)).filter(Boolean).slice(0, 3);
    if (recentRows.length && !query) { const title = document.createElement("strong"), holder = document.createElement("div"); title.textContent = "最近使用"; holder.className = "recent-chips"; for (const row of recentRows) holder.append(templateButton(row)); recent.append(title, holder); }
    const list = $("#templateList"); list.replaceChildren();
    const sections = [{ id: "", name: "直接操作" }, ...state.groups.filter((row) => row.enabled).map((row) => ({ id: row.id, name: row.name }))];
    for (const sectionInfo of sections) { const rows = all.filter((row) => (row.groupId || "") === sectionInfo.id); if (!rows.length) continue; const section = document.createElement("section"), heading = document.createElement("h3"); heading.textContent = sectionInfo.name; section.append(heading); for (const row of rows) section.append(templateButton(row)); list.append(section); }
    if (!all.length) { const empty = document.createElement("p"); empty.className = "template-empty"; empty.textContent = "没有找到操作"; list.append(empty); }
  }

  function waitUntilReady(key, timeout = 15000) { if (state.ready.has(key)) return Promise.resolve(true); return new Promise((resolve) => { const started = Date.now(), timer = setInterval(() => { if (state.ready.has(key) || Date.now() - started > timeout) { clearInterval(timer); resolve(state.ready.has(key)); } }, 200); }); }
  async function frameCommand(key, action, payload = {}) {
    const iframe = document.querySelector(`.ai-frame[data-service="${CSS.escape(key)}"]`); if (!iframe?.contentWindow) return { ok: false, reason: "frame_missing" }; if (!await waitUntilReady(key)) return { ok: false, reason: "frame_not_ready" };
    const requestId = crypto.randomUUID(); return new Promise((resolve) => { const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, reason: "sidepanel_command_timeout" }); }, 30000); pending.set(requestId, (result) => { clearTimeout(timer); resolve(result); }); iframe.contentWindow.postMessage({ source: "multi-ai-sidepanel", requestId, service: key, action, ...payload }, readyOrigins.get(key)); });
  }
  async function applyEmbedLayoutToReadyFrames() { await Promise.allSettled([...state.ready].map((key) => frameCommand(key, "SET_EMBED_LAYOUT", { mode: state.embedLayoutMode }))); }

  addEventListener("message", (event) => {
    const data = event.data; if (!data || !["multi-ai-sidepanel-ready", "multi-ai-sidepanel-result"].includes(data.source)) return;
    const iframe = [...document.querySelectorAll(".ai-frame")].find((frame) => frame.contentWindow === event.source); if (!iframe || iframe.dataset.service !== data.service || registry.fromUrl(event.origin)?.key !== data.service) return;
    if (data.source === "multi-ai-sidepanel-ready") { state.ready.add(data.service); readyOrigins.set(data.service, event.origin); queueMicrotask(() => void frameCommand(data.service, "SET_EMBED_LAYOUT", { mode: state.embedLayoutMode })); return; } if (readyOrigins.get(data.service) !== event.origin) return;
    const complete = pending.get(data.requestId); if (!complete) return; pending.delete(data.requestId); complete(data.result || { ok: false, reason: "empty_response" });
  });

  function fileToPayload(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: String(reader.result).split(",")[1] || "" }); reader.readAsDataURL(file); }); }
  function validateFiles(files) { const values = [...files]; if (values.length > 3) throw new Error("最多选择 3 个附件"); if (values.some((file) => file.size > 10 * 1024 * 1024)) throw new Error("单个附件不能超过 10 MB"); if (values.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) throw new Error("附件总大小不能超过 20 MB"); return values; }

  async function ask(options = {}) {
    const sourceText = options.sourceText || $("#question").value.trim(), question = options.question || composedQuestion(), targets = (options.targets || [...state.targets]).filter((key) => state.services.includes(key));
    if (!sourceText) return setStatus("请先输入问题。", true); if (!targets.length) return setStatus("请至少选择一个发送平台。", true);
    if (!options.retry && state.lastSent?.sourceText === sourceText && Date.now() - state.lastSent.at < 10000 && !confirm("刚刚已经发送过相同问题，仍然发送吗？")) return;
    $("#send").disabled = true; $("#statusActions").hidden = true; updateFrameInset(); setStatus(`正在发送到 ${targets.length} 个 AI…`); for (const key of targets) { state.statuses.set(key, "pending"); ensureFrameLoaded(key); } renderTabs();
    try {
      const attachments = options.attachments || await Promise.all(state.files.map(fileToPayload)), configuredMode = activeTemplate()?.answerMode, answerMode = ["expert", "fast"].includes(configuredMode) ? configuredMode : state.answerMode; state.lastPayload = { question, sourceText, attachments, answerMode, targets }; state.lastSent = { sourceText, at: Date.now() };
      const results = await Promise.all(targets.map(async (key) => { const result = await frameCommand(key, "SEND_PROMPT", { question, attachments, answerMode }); state.statuses.set(key, result.ok ? (state.active === key ? "ok" : "unread") : "error"); renderTabs(); return { service: key, ...result }; }));
      const failed = results.filter((row) => !row.ok); state.failedServices = new Set(failed.map((row) => row.service)); $("#status").title = failed.map((row) => `${registry.byKey[row.service]?.name || row.service}：${row.reason || "unknown"}`).join("；"); setStatus(failed.length ? `${results.length - failed.length}/${results.length} 个 AI 已确认，${failed.length} 个可重试。` : `${results.length} 个 AI 均已确认发送。`, failed.length > 0); $("#statusActions").hidden = !failed.length; updateFrameInset();
      if (!failed.length) { $("#question").value = ""; state.files = []; $("#attachments").value = ""; $("#fileSummary").textContent = ""; applyTemplate(""); await persist(); }
    } catch (error) { setStatus(error.message || String(error), true); $("#statusActions").hidden = false; updateFrameInset(); } finally { $("#send").disabled = false; }
  }

  async function consumePendingTask(task) {
    if (!task?.id || Date.now() - Number(task.createdAt || 0) > 120000) return; await chrome.storage.session.remove("maiw.pendingTask"); $("#question").value = String(task.content || ""); state.actionContext = { pageTitle: task.pageTitle || "", pageUrl: task.pageUrl || "" };
    const operation = promptTemplates.find(task.actionId, state.operations); if (operation) await activateOperation(operation, state.actionContext, false); else applyTemplate("", state.actionContext);
    if (task.notice) setStatus(task.notice, true);
    if (task.openPicker) { $("#templatePicker").hidden = false; renderTemplatePicker(); setTimeout(() => $("#templateSearch").focus(), 0); } else if (task.autoSend) void ask(); else { if (!task.notice) setStatus(task.content ? "请确认内容和发送平台后执行。" : "未读取到选中文字，请输入问题。"); $("#question").focus(); } scheduleDraftSave();
  }

  async function initialize() {
    const stored = await chrome.storage.local.get(["maiw.sidepanel", "maiw.sidepanelDraft", "maiw.settings", "maiw.promptTemplates", "maiw.operations", "maiw.operationGroups"]), saved = stored["maiw.sidepanel"] || {}, draft = stored["maiw.sidepanelDraft"] || {}, main = stored["maiw.settings"] || {};
    const consent = await globalThis.MultiAIPrivacyUI.ensureConsent({ locale: main.locale }); state.locale = consent.locale;
    const configuration = promptTemplates.resolveConfiguration(stored["maiw.operations"], stored["maiw.operationGroups"], stored["maiw.promptTemplates"], main.promptMenuTemplateIds); state.operations = configuration.operations; state.groups = configuration.groups; if (configuration.migrated) await chrome.storage.local.set({ "maiw.operations": state.operations, "maiw.operationGroups": state.groups });
    const catalogMigrated = Number(saved.catalogVersion || 0) < sidepanelCatalogVersion;
    const candidates = (catalogMigrated ? sidepanelServices : Array.isArray(saved.services) ? saved.services : sidepanelServices).filter((key) => registry.byKey[key]?.kind === "ai").slice(0, sidepanelMaxFrames); state.services = candidates.length ? candidates : [...sidepanelServices]; state.active = state.services.includes(saved.active) ? saved.active : "deepseek";
    const targets = Array.isArray(saved.targets) ? saved.targets.filter((key) => state.services.includes(key)) : registry.defaults; state.targets = new Set(targets.length ? targets : registry.defaults); state.answerMode = saved.answerMode === "fast" ? "fast" : "expert"; state.embedLayoutMode = saved.embedLayoutMode === "original" ? "original" : "adaptive"; state.recentActionIds = (Array.isArray(saved.recentActionIds) ? saved.recentActionIds : saved.recentTemplateIds || []).slice(0, 5);
    $("#answerMode").value = state.answerMode; $("#embedLayoutMode").value = state.embedLayoutMode; $("#question").value = String(draft.text || ""); state.activeActionId = promptTemplates.find(draft.actionId || draft.templateId, state.operations)?.id || ""; renderFrames(); renderManager(); renderActiveTemplate(); renderTemplatePicker(); affiliateController = globalThis.MultiAIAffiliateCatalog.mount({ button: $("#affiliateToggle"), locale: state.locale, compact: true }); if (catalogMigrated) await persist();
    if (chrome.sidePanel?.getLayout) { try { const layout = await chrome.sidePanel.getLayout(); if (layout.side === "left") { const notice = $("#sideNotice"); notice.textContent = "浏览器当前把原生侧栏放在左侧；请在浏览器外观设置中切换到右侧。"; notice.hidden = false; } } catch { /* 旧版浏览器不支持读取方向 */ } }
    initialized = true; const pendingTask = deferredTask || (await chrome.storage.session.get("maiw.pendingTask"))["maiw.pendingTask"]; deferredTask = null; if (pendingTask) await consumePendingTask(pendingTask);
  }

  $("#managePlatforms").addEventListener("click", () => { const manager = $("#platformManager"), opening = manager.hidden; manager.hidden = !opening; $("#managePlatforms").setAttribute("aria-expanded", String(opening)); renderManager(); });
  $("#previousModel").addEventListener("click", () => rotateModel(-1));
  $("#nextModel").addEventListener("click", () => rotateModel(1));
  $("#tabList").addEventListener("wheel", (event) => { const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX; if (!delta) return; event.preventDefault(); const now = Date.now(); if (now - lastCarouselWheelAt < 180) return; lastCarouselWheelAt = now; rotateModel(delta > 0 ? 1 : -1); }, { passive: false });
  $("#targetToggle").addEventListener("click", () => { $("#targetMenu").hidden = !$("#targetMenu").hidden; $("#templatePicker").hidden = true; });
  $("#templateToggle").addEventListener("click", () => { $("#templatePicker").hidden = !$("#templatePicker").hidden; $("#targetMenu").hidden = true; if (!$("#templatePicker").hidden) { renderTemplatePicker($("#templateSearch").value); $("#templateSearch").focus(); } });
  $("#templateSearch").addEventListener("input", (event) => renderTemplatePicker(event.target.value)); $("#clearTemplate").addEventListener("click", () => applyTemplate("")); $("#templatePreview").addEventListener("click", () => alert(composedQuestion() || "请先输入内容。"));
  $("#manageTemplates").addEventListener("click", async () => { await chrome.storage.session.set({ "maiw.openSettings": "operations" }); const currentWindow = await chrome.windows.getCurrent(); await chrome.runtime.sendMessage({ action: "OPEN_WORKSPACE", windowId: currentWindow.id }); });
  $("#answerMode").addEventListener("change", (event) => { state.answerMode = event.target.value; void persist(); }); $("#question").addEventListener("input", scheduleDraftSave);
  $("#embedLayoutMode").addEventListener("change", async (event) => { state.embedLayoutMode = event.target.value === "original" ? "original" : "adaptive"; await persist(); await applyEmbedLayoutToReadyFrames(); setStatus(state.embedLayoutMode === "adaptive" ? "已启用侧栏自动适应宽度。" : "已恢复平台原始布局。"); });
  $("#attachments").addEventListener("change", (event) => { try { state.files = validateFiles(event.target.files); $("#fileSummary").textContent = state.files.map((file) => file.name).join("、"); setStatus(""); } catch (error) { state.files = []; event.target.value = ""; setStatus(error.message, true); } });
  $("#send").addEventListener("click", () => void ask()); $("#question").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } });
  $("#retryFailed").addEventListener("click", () => { if (state.lastPayload && state.failedServices.size) void ask({ retry: true, targets: [...state.failedServices], attachments: state.lastPayload.attachments, question: state.lastPayload.question, sourceText: state.lastPayload.sourceText }); }); $("#openActive").addEventListener("click", () => chrome.tabs.create({ url: registry.byKey[state.active]?.home }));
  $("#openWorkspace").addEventListener("click", async () => { const currentWindow = await chrome.windows.getCurrent(); chrome.runtime.sendMessage({ action: "OPEN_WORKSPACE", windowId: currentWindow.id }); });
  $("#minimizePanel").addEventListener("click", async () => { const currentWindow = await chrome.windows.getCurrent(); const result = await chrome.runtime.sendMessage({ action: "MINIMIZE_UI", windowId: currentWindow.id }); if (result?.sidePanel?.unsupported) window.close(); });
  addEventListener("keydown", (event) => { if ($("#templatePicker").hidden || event.ctrlKey || event.altKey || event.metaKey || /INPUT|TEXTAREA/.test(event.target?.tagName || "")) return; const slot = Number(event.key); if (slot < 1 || slot > 8) return; const operation = state.operations.find((row) => row.enabled && row.showInPicker && row.shortcutSlot === slot); if (operation) { event.preventDefault(); $("#templatePicker").hidden = true; void activateOperation(operation, state.actionContext, true); } });
  chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName === "session" && changes["maiw.pendingTask"]?.newValue) { if (initialized) void consumePendingTask(changes["maiw.pendingTask"].newValue); else deferredTask = changes["maiw.pendingTask"].newValue; } if (areaName === "local" && (changes["maiw.operations"] || changes["maiw.operationGroups"])) { const configuration = promptTemplates.resolveConfiguration(changes["maiw.operations"]?.newValue || state.operations, changes["maiw.operationGroups"]?.newValue || state.groups); state.operations = configuration.operations; state.groups = configuration.groups; if (!activeTemplate()) applyTemplate(""); renderTemplatePicker($("#templateSearch").value); } });
  chrome.runtime.onMessage.addListener((message) => { if (message?.action === "PLATFORM_NEEDS_LOGIN" && state.services.includes(message.service)) { state.statuses.set(message.service, "login"); state.failedServices.add(message.service); renderTabs(); $("#statusActions").hidden = false; updateFrameInset(); setStatus(`${registry.byKey[message.service]?.name || message.service} 可能需要先登录。`, true); } });
  new ResizeObserver(updateFrameInset).observe(document.querySelector(".composer"));
  const sidePanelPort = chrome.runtime.connect({ name: "maiw-sidepanel" });
  sidePanelPort.onMessage.addListener((message) => { if (message?.action === "CLOSE_SIDE_PANEL") window.close(); });
  chrome.windows.getCurrent().then((currentWindow) => sidePanelPort.postMessage({ action: "SIDEPANEL_READY", windowId: currentWindow.id })).catch(() => {});
  initialize().catch((error) => setStatus(`侧栏初始化失败：${error.message}`, true));
})();
