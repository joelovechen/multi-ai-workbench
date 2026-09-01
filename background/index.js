importScripts("../shared/services.js");
importScripts("../shared/platform-adapters.js");
importScripts("../shared/prompt-templates.js");

const registry = self.MultiAIServiceRegistry;
const promptTemplates = self.MultiAIPromptTemplates;
const workspaceUrl = chrome.runtime.getURL("workspace/index.html");
const workspaceTabs = new Set();
const CONTEXT_ROOT = "maiw-selection-root";
const CONTEXT_DIRECT = "maiw-selection-direct";
const CONTEXT_MORE = "maiw-selection-more";
const CONTEXT_MANAGE = "maiw-selection-manage";
const CONTEXT_ACTION_PREFIX = "maiw-action:";
const PET_SCRIPT_ID = "maiw-pet-all-websites";
const PET_ORIGINS = ["http://*/*", "https://*/*"];
const sidePanelPorts = new Map();
const sidePanelOpenWindows = new Set();

function normalizedLauncherScope(settings = {}) {
  if (settings.launcherEnabled === false || settings.launcherScope === "off") return "off";
  return settings.launcherScope === "all" ? "all" : "supported";
}

async function syncPetContentScript({ injectOpenTabs = true } = {}) {
  const settings = (await chrome.storage.local.get("maiw.settings"))["maiw.settings"] || {};
  let scope = normalizedLauncherScope(settings);
  const granted = await chrome.permissions.contains({ origins: PET_ORIGINS });
  if (scope === "all" && !granted) {
    scope = "supported";
    await chrome.storage.local.set({ "maiw.settings": { ...settings, launcherEnabled: true, launcherScope: scope } });
  }
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [PET_SCRIPT_ID] });
  if (scope === "all" && granted) {
    if (!registered.length) await chrome.scripting.registerContentScripts([{ id: PET_SCRIPT_ID, matches: PET_ORIGINS, js: ["content/floating-launcher.js"], runAt: "document_idle", persistAcrossSessions: true }]);
    let injected = 0;
    if (injectOpenTabs) {
      const tabs = await chrome.tabs.query({ url: PET_ORIGINS });
      const results = await Promise.allSettled(tabs.filter((tab) => typeof tab.id === "number").map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/floating-launcher.js"] })));
      injected = results.filter((row) => row.status === "fulfilled").length;
    }
    return { ok: true, scope, granted, injected };
  }
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [PET_SCRIPT_ID] });
  const tabs = injectOpenTabs ? await chrome.tabs.query({ url: PET_ORIGINS }) : [];
  const ordinaryTabs = tabs.filter((tab) => typeof tab.id === "number" && !registry.fromUrl(tab.url));
  const results = await Promise.allSettled(ordinaryTabs.map((tab) => chrome.tabs.sendMessage(tab.id, { action: "REMOVE_FLOATING_LAUNCHER" })));
  return { ok: true, scope, granted, injected: 0, removed: results.filter((row) => row.status === "fulfilled").length };
}

function rememberSidePanelPort(windowId, port) {
  if (typeof windowId !== "number") return;
  if (!sidePanelPorts.has(windowId)) sidePanelPorts.set(windowId, new Set());
  sidePanelOpenWindows.add(windowId);
  sidePanelPorts.get(windowId).add(port);
  port.onDisconnect.addListener(() => { const ports = sidePanelPorts.get(windowId); ports?.delete(port); if (!ports?.size) { sidePanelPorts.delete(windowId); sidePanelOpenWindows.delete(windowId); } });
}

async function getActionConfiguration() {
  const stored = await chrome.storage.local.get(["maiw.settings", "maiw.promptTemplates", "maiw.operations", "maiw.operationGroups"]);
  const settings = stored["maiw.settings"] || {};
  const resolved = promptTemplates.resolveConfiguration(stored["maiw.operations"], stored["maiw.operationGroups"], stored["maiw.promptTemplates"], settings.promptMenuTemplateIds);
  if (resolved.migrated) await chrome.storage.local.set({ "maiw.operations": resolved.operations, "maiw.operationGroups": resolved.groups });
  return { settings, ...resolved };
}

async function rebuildContextMenus() {
  if (!chrome.contextMenus) return;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: CONTEXT_ROOT, title: "多AI问答助手", contexts: ["selection"] });
  chrome.contextMenus.create({ id: CONTEXT_DIRECT, parentId: CONTEXT_ROOT, title: "问 直接提问", contexts: ["selection"] });
  const { settings, operations, groups } = await getActionConfiguration();
  const visible = operations.filter((row) => row.enabled && row.showInContextMenu);
  const groupedMode = settings.contextMenuMode === "grouped";
  const groupMap = new Map(groups.filter((row) => row.enabled).map((row) => [row.id, row]));
  const usedGroups = new Set();
  for (const operation of visible) {
    let parentId = CONTEXT_ROOT;
    if (groupedMode && operation.groupId && groupMap.has(operation.groupId)) {
      parentId = `maiw-group:${operation.groupId}`;
      if (!usedGroups.has(parentId)) { chrome.contextMenus.create({ id: parentId, parentId: CONTEXT_ROOT, title: groupMap.get(operation.groupId).name, contexts: ["selection"] }); usedGroups.add(parentId); }
    }
    const shortcut = operation.shortcutSlot ? `${operation.shortcutSlot} ` : "";
    chrome.contextMenus.create({ id: `${CONTEXT_ACTION_PREFIX}${operation.id}`, parentId, title: `${shortcut}${operation.icon} ${operation.name}`, contexts: ["selection"] });
  }
  chrome.contextMenus.create({ id: "maiw-selection-separator", parentId: CONTEXT_ROOT, type: "separator", contexts: ["selection"] });
  chrome.contextMenus.create({ id: CONTEXT_MORE, parentId: CONTEXT_ROOT, title: "选择其他操作…", contexts: ["selection"] });
  chrome.contextMenus.create({ id: CONTEXT_MANAGE, parentId: CONTEXT_ROOT, title: "管理右键操作…", contexts: ["selection"] });
}

async function queueSidePanelTask(tab, task) {
  const windowId = await resolveWindowId(tab?.windowId, tab);
  const { operations } = await getActionConfiguration();
  const operation = task.actionId ? operations.find((row) => row.id === task.actionId && row.enabled) : null;
  const content = String(task.content || "").trim().slice(0, 20000);
  const targetMode = operation?.targetMode || "selection";
  const requestedAutoSend = task.autoSend ?? operation?.execution === "direct";
  const pendingTask = {
    id: crypto.randomUUID(), content, actionId: operation?.id || "", openPicker: Boolean(task.openPicker),
    autoSend: Boolean(requestedAutoSend && (operation || task.directAsk) && content && content.length <= 5000 && targetMode !== "ask"),
    targetMode, serviceKeys: operation?.serviceKeys || [], answerMode: operation?.answerMode || "inherit",
    pageTitle: String(task.pageTitle || tab?.title || "").slice(0, 500), pageUrl: String(task.pageUrl || tab?.url || "").slice(0, 4000),
    notice: requestedAutoSend && content.length > 5000 ? "选中文字较长，请确认内容后再发送。" : (!operation && task.actionId ? "绑定的操作不存在或已停用，请重新选择。" : ""), createdAt: Date.now()
  };
  await chrome.storage.session.set({ "maiw.pendingTask": pendingTask });
  return { windowId, pendingTask };
}

async function runSelectionAction(tab, task) {
  const windowId = await resolveWindowId(tab?.windowId, tab);
  const openPromise = chrome.sidePanel.open({ windowId });
  const queued = queueSidePanelTask(tab, task);
  await openPromise; await queued; await closeWorkspaceForSidePanel(windowId);
}

async function readSelectionFromTab(tab) {
  if (typeof tab?.id !== "number" || !chrome.scripting) return "";
  try {
    const rows = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => String(globalThis.getSelection?.()?.toString() || document.activeElement?.value?.substring?.(document.activeElement.selectionStart, document.activeElement.selectionEnd) || "").trim()
    });
    return rows.map((row) => String(row.result || "").trim()).find(Boolean) || "";
  } catch { return ""; }
}

function matchesWorkspaceUrl(url) {
  if (typeof url !== "string" || !url.startsWith(workspaceUrl)) return false;
  const suffix = url.slice(workspaceUrl.length);
  return suffix === "" || suffix.startsWith("?") || suffix.startsWith("#");
}

async function queryWorkspaceTabs() {
  try {
    const matched = await chrome.tabs.query({ url: `${workspaceUrl}*` });
    if (matched?.length) return matched;
  } catch (error) {
    console.warn("[多AI问答助手] 按地址查询工作台失败，改用全量扫描。", error);
  }
  const allTabs = await chrome.tabs.query({});
  return (allTabs || []).filter((tab) => matchesWorkspaceUrl(tab.url));
}

async function isWorkspaceTab(tabId) {
  if (workspaceTabs.has(tabId)) return true;
  try {
    const tab = await chrome.tabs.get(tabId);
    const matches = matchesWorkspaceUrl(tab.url);
    if (matches) workspaceTabs.add(tabId);
    return matches;
  } catch { return false; }
}

async function openOrFocusWorkspace(clickedTab, preferredWindowId) {
  let tabs = [];
  try {
    tabs = await queryWorkspaceTabs();
  } catch (error) {
    console.warn("[多AI问答助手] 查询已有工作台失败，将新建标签页。", error);
  }
  let candidates = tabs.filter((tab) => typeof tab.id === "number");
  const targetWindowId = typeof preferredWindowId === "number" ? preferredWindowId : clickedTab?.windowId;
  if (typeof targetWindowId === "number") {
    candidates = candidates.filter((tab) => tab.windowId === targetWindowId);
  }
  candidates.sort((a, b) => (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0));
  const existing = candidates[0];
  if (existing) {
    if (typeof existing.windowId === "number") {
      try { await chrome.windows.update(existing.windowId, { focused: true }); } catch { /* 标签仍可正常激活 */ }
    }
    await chrome.tabs.update(existing.id, { active: true });
    workspaceTabs.add(existing.id);
    return existing.id;
  }
  const created = await chrome.tabs.create({ ...(typeof targetWindowId === "number" ? { windowId: targetWindowId } : {}), url: workspaceUrl, active: true });
  if (typeof created.id === "number") workspaceTabs.add(created.id);
  return created.id;
}

async function resolveWindowId(requestedWindowId, senderTab) {
  if (typeof requestedWindowId === "number") return requestedWindowId;
  if (typeof senderTab?.windowId === "number") return senderTab.windowId;
  return (await chrome.windows.getLastFocused()).id;
}

async function closeSidePanelQuietly(windowId) {
  const requestSelfClose = () => {
    const ports = [...(sidePanelPorts.get(windowId) || [])];
    for (const port of ports) { try { port.postMessage({ action: "CLOSE_SIDE_PANEL" }); } catch { /* 已断开的端口会自行清理 */ } }
    if (ports.length) sidePanelOpenWindows.delete(windowId);
    return ports.length;
  };
  if (!chrome.sidePanel?.close) { const requested = requestSelfClose(); return { closed: requested > 0, fallback: true }; }
  try { await chrome.sidePanel.close({ windowId }); sidePanelOpenWindows.delete(windowId); return { closed: true }; }
  catch { const requested = requestSelfClose(); return { closed: requested > 0, fallback: requested > 0 }; }
}

async function switchToWorkspace(clickedTab, requestedWindowId) {
  const windowId = await resolveWindowId(requestedWindowId, clickedTab);
  const tabId = await openOrFocusWorkspace(clickedTab, windowId);
  const sidePanel = await closeSidePanelQuietly(windowId);
  return { ok: true, tabId, windowId, sidePanel };
}

async function switchToSidePanel(senderTab, requestedWindowId) {
  const directWindowId = typeof requestedWindowId === "number" ? requestedWindowId : senderTab?.windowId;
  const windowId = typeof directWindowId === "number" ? directWindowId : await resolveWindowId(requestedWindowId, senderTab);
  // sidePanel.open 必须直接发生在用户手势调用链中；已知窗口时不能先 await。
  const openPromise = chrome.sidePanel.open({ windowId });
  sidePanelOpenWindows.add(windowId);
  await openPromise;
  return closeWorkspaceForSidePanel(windowId);
}

async function toggleSidePanel(senderTab, requestedWindowId) {
  const directWindowId = typeof requestedWindowId === "number" ? requestedWindowId : senderTab?.windowId;
  const windowId = typeof directWindowId === "number" ? directWindowId : await resolveWindowId(requestedWindowId, senderTab);
  if (sidePanelOpenWindows.has(windowId) || sidePanelPorts.get(windowId)?.size) return { ok: true, windowId, mode: "pet", ...(await closeSidePanelQuietly(windowId)) };
  const openPromise = chrome.sidePanel.open({ windowId });
  sidePanelOpenWindows.add(windowId);
  await openPromise;
  await closeWorkspaceForSidePanel(windowId);
  return { ok: true, windowId, mode: "sidepanel" };
}

async function minimizeWorkspace(senderTab, requestedWindowId) {
  const windowId = await resolveWindowId(requestedWindowId, senderTab);
  const sidePanel = await closeSidePanelQuietly(windowId);
  await closeWorkspaceForSidePanel(windowId);
  return { ok: true, windowId, mode: "pet", sidePanel };
}

async function closeWorkspaceForSidePanel(windowId) {
  const [allWindowTabs, allWorkspaceTabs] = await Promise.all([chrome.tabs.query({ windowId }), queryWorkspaceTabs()]);
  const workspaceInWindow = allWorkspaceTabs.filter((tab) => tab.windowId === windowId && typeof tab.id === "number");
  if (workspaceInWindow.length) {
    let remaining = allWindowTabs.filter((tab) => !workspaceInWindow.some((workspace) => workspace.id === tab.id));
    if (!remaining.length) remaining = [await chrome.tabs.create({ windowId, active: true })];
    else {
      remaining.sort((a, b) => (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0));
      if (typeof remaining[0].id === "number") await chrome.tabs.update(remaining[0].id, { active: true });
    }
    await chrome.tabs.remove(workspaceInWindow.map((tab) => tab.id));
  }
  return { ok: true, windowId, closedWorkspaceTabs: workspaceInWindow.length };
}

function sendToFrame(tabId, frameId, message) {
  return new Promise((resolve) => chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
    if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message, frameId });
    else resolve({ ...(response || { ok: false, reason: "empty_response" }), frameId });
  }));
}

async function getServiceFrames(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return (frames || []).map((frame) => ({ ...frame, service: registry.fromUrl(frame.url) })).filter((frame) => frame.frameId !== 0 && frame.service);
}

async function dispatchToServices(tabId, serviceKeys, action, payload = {}) {
  const wanted = new Set((serviceKeys || []).map(String));
  return Promise.all([...wanted].map(async (key) => {
    const service = registry.byKey[key];
    if (!service) return { service: key, ok: false, reason: "unknown_service" };
    if (service.kind !== "ai" && action === "SEND_PROMPT") return { service: key, ok: true, stage: "workspace_navigation" };
    let best = { service: key, ok: false, reason: "dispatch_failed" };
    for (let attempt = 0; attempt < 3 && !best.ok; attempt += 1) {
      const frames = await getServiceFrames(tabId);
      const candidates = frames.filter((frame) => frame.service.key === key);
      if (!candidates.length) best = { service: key, ok: false, reason: "frame_not_ready" };
      for (const frame of candidates) {
        const response = await sendToFrame(tabId, frame.frameId, { action, service: key, ...payload });
        best = { service: key, ...response };
        if (response.ok) break;
      }
      if (!best.ok && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 650));
    }
    return best;
  }));
}

chrome.action.onClicked.addListener((tab) => {
  void toggleSidePanel(tab).catch((error) => console.error("[多AI问答助手] 切换侧栏失败。", error));
});
chrome.tabs.onRemoved.addListener((tabId) => workspaceTabs.delete(tabId));
chrome.runtime.onInstalled.addListener((details) => {
  void rebuildContextMenus().catch((error) => console.warn("[多AI问答助手] 创建右键菜单失败。", error));
  void syncPetContentScript().catch((error) => console.warn("[多AI问答助手] 同步桌宠注入失败。", error));
  if (details.reason === "install") void openOrFocusWorkspace();
});
chrome.runtime.onStartup.addListener(() => { void syncPetContentScript().catch(() => {}); });
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes["maiw.settings"] || changes["maiw.promptTemplates"] || changes["maiw.operations"] || changes["maiw.operationGroups"])) void rebuildContextMenus().catch(() => {});
  if (areaName === "local" && changes["maiw.settings"]) void syncPetContentScript().catch(() => {});
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId || "");
  if (menuId === CONTEXT_MANAGE) { void chrome.storage.session.set({ "maiw.openSettings": "operations" }).then(() => switchToWorkspace(tab)).catch(() => {}); return; }
  if (menuId !== CONTEXT_DIRECT && menuId !== CONTEXT_MORE && !menuId.startsWith(CONTEXT_ACTION_PREFIX)) return;
  const actionId = menuId.startsWith(CONTEXT_ACTION_PREFIX) ? menuId.slice(CONTEXT_ACTION_PREFIX.length) : "";
  void runSelectionAction(tab, { content: info.selectionText, pageUrl: info.pageUrl, pageTitle: tab?.title, actionId, directAsk: menuId === CONTEXT_DIRECT, autoSend: menuId === CONTEXT_DIRECT ? true : undefined, openPicker: menuId === CONTEXT_MORE }).catch((error) => console.error("[多AI问答助手] 选中文字处理失败。", error));
});
chrome.commands.onCommand.addListener((command, tab) => {
  const slotMatch = /^action-slot-([1-8])$/.exec(command);
  if (!["ask-selection", "open-template-picker", "open-action-picker"].includes(command) && !slotMatch) return;
  const windowId = tab?.windowId;
  const openPromise = typeof windowId === "number" ? chrome.sidePanel.open({ windowId }) : Promise.resolve();
  void Promise.all([openPromise, readSelectionFromTab(tab), getActionConfiguration()]).then(async ([, content, configuration]) => {
    const operation = slotMatch ? configuration.operations.find((row) => row.enabled && row.shortcutSlot === Number(slotMatch[1])) : null;
    const openPicker = command === "open-template-picker" || command === "open-action-picker" || (slotMatch && !operation);
    await queueSidePanelTask(tab, { content, actionId: openPicker ? "" : operation?.id, directAsk: command === "ask-selection", openPicker, autoSend: command === "ask-selection" ? true : undefined });
    if (typeof windowId === "number") await closeWorkspaceForSidePanel(windowId);
  }).catch((error) => console.error("[多AI问答助手] 快捷键处理失败。", error));
});
function publishWorkspaceFrameNavigation(details) {
  if (details.frameId === 0 || details.parentFrameId !== 0) return;
  void isWorkspaceTab(details.tabId).then((matches) => {
    if (!matches) return;
    const service = registry.fromUrl(details.url);
    const url = service ? registry.normalizeFrameUrl(service.key, details.url) : "";
    if (url) chrome.runtime.sendMessage({ action: "FRAME_NAVIGATED", tabId: details.tabId, service: service.key, url }).catch(() => {});
  });
}
chrome.webNavigation.onCommitted.addListener(publishWorkspaceFrameNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(publishWorkspaceFrameNavigation);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "maiw-sidepanel") return;
  port.onMessage.addListener((message) => { if (message?.action === "SIDEPANEL_READY") rememberSidePanelPort(message.windowId, port); });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;
  if (action === "OPEN_WORKSPACE") { switchToWorkspace(sender.tab, message.windowId).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true; }
  if (action === "OPEN_SIDE_PANEL") {
    switchToSidePanel(sender.tab, message.windowId).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true;
  }
  if (action === "TOGGLE_SIDE_PANEL") { toggleSidePanel(sender.tab, message.windowId).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true; }
  if (action === "MINIMIZE_UI") { minimizeWorkspace(sender.tab, message.windowId).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true; }
  if (action === "SYNC_LAUNCHER_SCOPE") { syncPetContentScript().then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true; }
  if (action === "CLOSE_WORKSPACE_FOR_SIDE_PANEL") { resolveWindowId(message.windowId, sender.tab).then(closeWorkspaceForSidePanel).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true; }
  if (action === "REGISTER_WORKSPACE") { const tabId = sender.tab?.id; if (typeof tabId === "number") workspaceTabs.add(tabId); sendResponse({ ok: typeof tabId === "number", tabId, windowId: sender.tab?.windowId }); return false; }
  if (action === "DISPATCH_PROMPT") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") { sendResponse({ ok: false, reason: "no_workspace_tab" }); return false; }
    dispatchToServices(tabId, message.services, "SEND_PROMPT", { question: String(message.question || ""), attachments: Array.isArray(message.attachments) ? message.attachments : [], answerMode: message.answerMode === "fast" ? "fast" : "expert" })
      .then((results) => sendResponse({ ok: results.some((row) => row.ok), results })).catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }
  if (action === "NEW_CHAT_ALL") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") { sendResponse({ ok: false, reason: "no_workspace_tab" }); return false; }
    dispatchToServices(tabId, message.services, "NEW_CHAT").then((results) => sendResponse({ ok: results.some((row) => row.ok), results })).catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }
  if (action === "LOCATE_QUESTION_ALL") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return false;
    dispatchToServices(tabId, message.services, "LOCATE_QUESTION", { question: String(message.question || "") }).then((results) => sendResponse({ ok: results.some((row) => row.ok), results })).catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }
  if (action === "SET_PICKER_MODE" || action === "SET_HIGHLIGHT_MODE") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return false;
    const frameAction = action === "SET_PICKER_MODE" ? "PICKER_MODE" : "HIGHLIGHT_MODE";
    dispatchToServices(tabId, [message.service], frameAction, { enabled: Boolean(message.enabled) }).then((results) => sendResponse({ ok: results.some((row) => row.ok), results })).catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }
  if (action === "SET_APPEARANCE") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return false;
    dispatchToServices(tabId, message.services, "SET_APPEARANCE", { theme: message.theme === "dark" ? "dark" : "light" }).then((results) => sendResponse({ ok: results.some((row) => row.ok), results })).catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }
  return false;
});
