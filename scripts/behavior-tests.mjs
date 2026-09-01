import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sandbox = { self: {}, URL };
vm.runInNewContext(readFileSync(join(root, "shared/services.js"), "utf8"), sandbox);
vm.runInNewContext(readFileSync(join(root, "shared/platform-adapters.js"), "utf8"), sandbox);
vm.runInNewContext(readFileSync(join(root, "shared/prompt-templates.js"), "utf8"), sandbox);
const registry = sandbox.self.MultiAIServiceRegistry;
const promptTemplates = sandbox.self.MultiAIPromptTemplates;
vm.runInNewContext(readFileSync(join(root, "shared/export-core.js"), "utf8"), sandbox);
const exportCore = sandbox.self.MultiAIExportCore;

test("默认平台为 DeepSeek、豆包和腾讯元宝，侧栏首选 DeepSeek", () => {
  assert.deepEqual([...registry.defaults], ["deepseek", "doubao", "yuanbao"]);
});

test("13 个 AI 均具备完整可靠性适配合同", () => {
  assert.equal(registry.ai.length, 13);
  for (const service of registry.ai) {
    assert.ok(service.inputSelectors.length, `${service.key}: input`);
    assert.ok(service.sendSelectors.length, `${service.key}: send`);
    assert.ok(service.messageSelectors.length, `${service.key}: confirmation`);
    assert.ok(service.newChatSelectors.length, `${service.key}: new chat`);
    assert.ok(service.attachmentEvidenceSelectors.length, `${service.key}: attachment evidence`);
    assert.ok(service.attachmentTriggerSelectors.length, `${service.key}: attachment discovery`);
    assert.equal(service.sendRetryOffsets[0], 0, `${service.key}: retry starts immediately`);
    assert.equal([...service.sendRetryOffsets].sort((a, b) => a - b).join(","), [...service.sendRetryOffsets].join(","), `${service.key}: retry order`);
    assert.ok(service.uploadTimeout >= 10000, `${service.key}: upload timeout`);
    assert.ok(service.confirmTimeout >= 8000, `${service.key}: confirmation timeout`);
  }
});

test("附件策略与参考行为矩阵一致", () => {
  const discovery = registry.ai.filter((service) => service.attachmentStrategy === "auto-discovery").map((service) => service.key).sort();
  assert.equal(discovery.join(","), "chatgpt,claude,copilot,gemini,grok");
  assert.equal(registry.ai.filter((service) => service.attachmentStrategy === "file-input").length, 8);
});

test("模式控件区分独立选项和二态开关", () => {
  for (const service of registry.ai.filter((row) => row.modeControl)) {
    const control = service.modeControl;
    assert.ok(["choice", "toggle"].includes(control.type));
    if (control.type === "choice") {
      assert.ok(control.expert?.length && control.fast?.length, service.key);
      assert.notDeepEqual(control.expert, control.fast, `${service.key}: expert/fast must differ`);
    } else assert.ok(control.labels?.length, service.key);
  }
});

test("主机识别不把相似恶意域名识别为平台", () => {
  assert.equal(registry.fromUrl("https://chatgpt.com/abc")?.key, "chatgpt");
  assert.equal(registry.fromUrl("https://chatgpt.com.example.invalid/"), null);
  assert.equal(registry.fromUrl("not-a-url"), null);
});

test("全屏会话 URL 只接受平台主页面并阻止错误启动恢复", () => {
  assert.equal(registry.normalizeFrameUrl("gemini", "https://gemini.google.com/_/bscframe"), "");
  assert.equal(registry.normalizeFrameUrl("gemini", "https://gemini.google.com/app"), "https://gemini.google.com/app");
  assert.equal(registry.normalizeFrameUrl("gemini", "https://example.com/app"), "");
  assert.equal(registry.normalizeFrameUrl("doubao", "https://www.doubao.com/chat/old-session"), "https://www.doubao.com/chat/old-session");
  assert.equal(registry.restoresOnStartup("doubao"), false);
  assert.equal(registry.restoresOnStartup("gemini"), true);
  const background = readFileSync(join(root, "background/index.js"), "utf8"), workspace = readFileSync(join(root, "workspace/app.js"), "utf8");
  assert.match(background, /details\.parentFrameId !== 0/);
  assert.match(background, /onHistoryStateUpdated\.addListener/);
  assert.doesNotMatch(background, /action === "PAGE_NAVIGATED"/);
  assert.match(workspace, /sanitizeFrameUrls\([^\n]+, true\)/);
});

test("发送链禁止把未确认状态报告为成功", () => {
  const bridge = readFileSync(join(root, "content/bridge.js"), "utf8");
  assert.match(bridge, /questionEvidenceCount/);
  assert.match(bridge, /upload_unconfirmed/);
  assert.match(bridge, /send_confirmation_timeout/);
  assert.doesNotMatch(bridge, /ok:\s*true,\s*stage:\s*"filled"/);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  assert.ok(manifest.content_scripts.some((entry) => entry.world === "MAIN" && entry.run_at === "document_start"));
});

test("工作台导出包含表格表头分隔、图片内联和长图分页", () => {
  assert.equal(exportCore.tableToMarkdown([["名称", "值"], ["A|B", "2"]]), "| 名称 | 值 |\n| --- | --- |\n| A\\|B | 2 |");
  assert.equal(exportCore.listPrefix(true, 2), "2.");
  assert.equal(JSON.stringify(exportCore.pageSlices(30001)), JSON.stringify([{ offset: 0, height: 14000 }, { offset: 14000, height: 14000 }, { offset: 28000, height: 2001 }]));
  const workspace = readFileSync(join(root, "workspace/app.js"), "utf8");
  assert.match(workspace, /tableToMarkdown/);
  assert.match(workspace, /inlineRemoteImages/);
  assert.match(workspace, /pageSlices/);
  assert.match(workspace, /document\.fonts/);
});

test("后台入口、工作台与原生侧栏互斥切换", async () => {
  let actionClickListener;
  let runtimeMessageListener;
  const tabQueries = [];
  const activatedTabs = [];
  const focusedWindows = [];
  const createdTabs = [];
  const removedTabs = [];
  const openedSidePanels = [];
  const closedSidePanels = [];
  const event = () => ({ addListener() {} });
  const backgroundSandbox = {
    self: { MultiAIServiceRegistry: registry, MultiAIPromptTemplates: promptTemplates },
    importScripts() {},
    console,
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://test-extension/${path}`,
        onInstalled: event(),
        onStartup: event(),
        onConnect: event(),
        onMessage: { addListener(listener) { runtimeMessageListener = listener; } },
        sendMessage: async () => ({}),
        lastError: null,
      },
      storage: { local: { async get() { return {}; }, async set() {} }, session: { async set() {}, async get() { return {}; }, async remove() {} }, onChanged: event() },
      contextMenus: { async removeAll() {}, create() {}, onClicked: event() },
      commands: { onCommand: event() },
      scripting: { async executeScript() { return []; }, async getRegisteredContentScripts() { return []; }, async registerContentScripts() {}, async unregisterContentScripts() {} },
      action: { onClicked: { addListener(listener) { actionClickListener = listener; } } },
      tabs: {
        onRemoved: event(),
        async query(filter) {
          tabQueries.push(filter);
          if (filter.url) return [];
          if (Object.hasOwn(filter, "windowId")) return [{ id: 41, windowId: 7, lastAccessed: 100, url: "chrome-extension://test-extension/workspace/index.html?session=1" }, { id: 9, windowId: 7, lastAccessed: 90, url: "https://example.test/" }];
          return [{ id: 41, windowId: 7, lastAccessed: 100, url: "chrome-extension://test-extension/workspace/index.html?session=1" }];
        },
        async update(tabId, update) { activatedTabs.push([tabId, update]); return { id: tabId }; },
        async create(create) { createdTabs.push(create); return { id: 42 }; },
        async remove(tabIds) { removedTabs.push(...tabIds); },
        async get() { return {}; },
        sendMessage(_tabId, _message, _options, callback) { callback({ ok: true }); },
      },
      windows: { async update(windowId, update) { focusedWindows.push([windowId, update]); } },
      sidePanel: { async open(options) { openedSidePanels.push(options); }, async close(options) { closedSidePanels.push(options); } },
      webNavigation: { onCommitted: event(), onHistoryStateUpdated: event(), async getAllFrames() { return []; } },
      permissions: { async contains() { return false; } },
    },
  };

  assert.doesNotThrow(() => vm.runInNewContext(readFileSync(join(root, "background/index.js"), "utf8"), backgroundSandbox));
  assert.equal(typeof actionClickListener, "function");
  actionClickListener({ windowId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(openedSidePanels.some((row) => row.windowId === 7));
  assert.deepEqual(removedTabs, [41]);
  assert.equal(activatedTabs.at(-1)[0], 9);
  actionClickListener({ windowId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(closedSidePanels.some((row) => row.windowId === 7));

  const workspaceResponse = await new Promise((resolve) => {
    assert.equal(runtimeMessageListener({ action: "OPEN_WORKSPACE", windowId: 7 }, { tab: { id: 9, windowId: 7 } }, resolve), true);
  });
  assert.equal(workspaceResponse.ok, true);
  assert.equal(activatedTabs.length, 2);
  assert.equal(activatedTabs.at(-1)[0], 41);
  assert.equal(activatedTabs.at(-1)[1].active, true);
  assert.equal(focusedWindows.length, 1);
  assert.equal(focusedWindows[0][0], 7);
  assert.equal(focusedWindows[0][1].focused, true);
  assert.equal(createdTabs.length, 0);
  assert.ok(closedSidePanels.length >= 2); assert.equal(closedSidePanels.at(-1).windowId, 7);

  removedTabs.length = 0;
  const sideResponse = await new Promise((resolve) => {
    assert.equal(runtimeMessageListener({ action: "OPEN_SIDE_PANEL" }, { tab: { id: 41, windowId: 7 } }, resolve), true);
  });
  assert.equal(sideResponse.ok, true);
  assert.equal(sideResponse.closedWorkspaceTabs, 1);
  assert.equal(openedSidePanels.length, 2); assert.equal(openedSidePanels.at(-1).windowId, 7);
  assert.deepEqual(removedTabs, [41]);
  assert.equal(activatedTabs.at(-1)[0], 9);
  removedTabs.length = 0;
  const closeResponse = await new Promise((resolve) => {
    assert.equal(runtimeMessageListener({ action: "CLOSE_WORKSPACE_FOR_SIDE_PANEL", windowId: 7 }, { tab: { id: 41, windowId: 7 } }, resolve), true);
  });
  assert.equal(closeResponse.ok, true);
  assert.deepEqual(removedTabs, [41]);
});

test("选中文字、可配置操作和快捷槽位形成完整本地入口", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const background = readFileSync(join(root, "background/index.js"), "utf8");
  const sideHtml = readFileSync(join(root, "sidepanel/index.html"), "utf8");
  const sideApp = readFileSync(join(root, "sidepanel/app.js"), "utf8");
  const workspaceHtml = readFileSync(join(root, "workspace/index.html"), "utf8");
  assert.ok(["contextMenus", "activeTab", "scripting"].every((permission) => manifest.permissions.includes(permission)));
  assert.ok(manifest.commands["ask-selection"] && manifest.commands["open-template-picker"]);
  for (let slot = 1; slot <= 8; slot += 1) assert.ok(manifest.commands[`action-slot-${slot}`]);
  assert.match(background, /selectionText/); assert.match(background, /maiw\.pendingTask/); assert.match(background, /chrome\.sidePanel\.open/);
  for (const id of ["templateToggle", "templatePicker", "activeTemplate", "retryFailed"]) assert.match(sideHtml, new RegExp(`id="${id}"`));
  for (const signal of ["consumePendingTask", "composedQuestion", "failedServices", "maiw.sidepanelDraft"]) assert.match(sideApp, new RegExp(signal.replace(".", "\\.")));
  for (const id of ["contextMenuMode", "operationGroupList", "promptTemplateList", "promptTemplateForm", "shortcutList"]) assert.match(workspaceHtml, new RegExp(`id="${id}"`));
  assert.equal(promptTemplates.builtIns.length, 3);
  assert.deepEqual(Array.from(promptTemplates.builtIns, (row) => row.id), ["translate-zh", "summarize", "explain-simple"]);
  const configuration = promptTemplates.resolveConfiguration();
  assert.equal(configuration.operations.filter((row) => row.showInContextMenu).length, 3);
  assert.equal(configuration.operations.find((row) => row.id === "translate-zh").shortcutSlot, 1);
  assert.equal(configuration.operations.find((row) => row.id === "summarize").shortcutSlot, 2);
  const oldTranslation = "请将以下内容翻译成简体中文。保留原意、段落、代码、Markdown 格式和专有名词，只输出译文。\n\n<待处理内容>\n{{content}}\n</待处理内容>";
  const upgraded = promptTemplates.resolveConfiguration([{ ...configuration.operations[0], name: "翻译成中文", prompt: oldTranslation }, { id: "translate-en", name: "翻译成英文", prompt: "old" }, { id: "custom-keep", name: "保留自定义", prompt: "{{content}}" }], []);
  assert.ok(upgraded.migrated);
  assert.equal(upgraded.operations.find((row) => row.id === "translate-zh").name, "中英双向翻译");
  assert.match(upgraded.operations.find((row) => row.id === "translate-zh").prompt, /主要是中文/);
  assert.ok(!upgraded.operations.some((row) => row.id === "translate-en"));
  assert.ok(upgraded.operations.some((row) => row.id === "custom-keep"));
  const hiddenAfterUpgrade = promptTemplates.resolveConfiguration(configuration.operations.map((row) => row.id === "explain-simple" ? { ...row, showInContextMenu: false } : row), []);
  assert.equal(hiddenAfterUpgrade.operations.find((row) => row.id === "explain-simple").showInContextMenu, false);
  const migrated = promptTemplates.resolveConfiguration(undefined, undefined, [{ id: "custom-legacy", name: "旧操作", prompt: "处理：{{content}}" }], ["custom-legacy"]);
  assert.ok(migrated.migrated && migrated.operations.some((row) => row.id === "custom-legacy" && row.showInContextMenu));
  const duplicateSlots = promptTemplates.resolveConfiguration(configuration.operations.map((row) => ({ ...row, shortcutSlot: row.id === "summarize" ? 1 : row.shortcutSlot })), []);
  assert.equal(duplicateSlots.operations.filter((row) => row.shortcutSlot === 1).length, 1);
  assert.match(promptTemplates.build(promptTemplates.find("translate-zh"), "Hello"), /Hello/);
  assert.match(promptTemplates.build(promptTemplates.find("translate-zh"), "Hello"), /主要是英文/);
  assert.ok(!promptTemplates.build(promptTemplates.find("translate-zh"), "Hello").includes("{{content}}"));
  assert.equal(promptTemplates.build({ prompt: "{{pageTitle}}|{{pageUrl}}|{{content}}" }, { pageTitle: "标题", pageUrl: "https://example.com", content: "正文" }), "标题|https://example.com|正文");
});

test("新版工作台包含双行网格、拖动提问卡、平台抽屉和网页启动球", () => {
  const html = readFileSync(join(root, "workspace/index.html"), "utf8");
  const css = readFileSync(join(root, "workspace/styles.css"), "utf8");
  const app = readFileSync(join(root, "workspace/app.js"), "utf8");
  const launcher = readFileSync(join(root, "content/floating-launcher.js"), "utf8");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

  for (const id of ["composerDragHandle", "servicePanel", "selectedServices", "serviceCatalog", "settingsPanel", "launcherScope", "launcherStyle", "launcherAnimationPack", "launcherRandomFrequency", "launcherSize", "launcherSizeValue", "minimizeToggle"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<img class="brand-mark" src="\.\.\/assets\/launcher-pet\.png"/); assert.doesNotMatch(html, /<span class="brand-mark">多<\/span>/);
  assert.match(html, /value="2x5"/);
  assert.doesNotMatch(html, /questionRail|quickAccess|快捷入口/);
  assert.match(css, /\.frames\[data-rows="2"\]\{display:grid/);
  for (const signal of ["serviceDraft", "renderServiceManager", "bindComposerDrag", "clampComposerPosition", "launcherScope", "launcherStyle", "launcherAnimationPack", "launcherRandomFrequency", "launcherSize", "MINIMIZE_UI"]) assert.match(app, new RegExp(signal));
  assert.equal(manifest.optional_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  const launcherEntry = manifest.content_scripts.find((entry) => entry.js?.includes("content/floating-launcher.js"));
  assert.ok(launcherEntry);
  assert.notEqual(launcherEntry.all_frames, true);
  assert.match(launcher, /window\.top !== window/);
  assert.match(launcher, /attachShadow/);
  assert.match(launcher, /Math\.hypot\(dx, dy\) > 5/);
  assert.match(launcher, /action: "TOGGLE_SIDE_PANEL"/);
  assert.match(launcher, /action: "OPEN_WORKSPACE"/);
  assert.match(launcher, /addEventListener\("dblclick"/);
  assert.match(launcher, /now - lastClickAt > 360/);
  assert.match(launcher, /assets\/launcher-pet\.png/);
  for (const asset of ["pet-idle.webm", "pet-click.webm", "pet-drag.webm"]) assert.match(launcher, new RegExp(asset.replace(".", "\\.")));
  for (const signal of ["clickAnimations", "ambientAnimations", "scheduleRandomAnimation", "nextRandomDelay", "animationPack", "randomFrequency"]) assert.match(launcher, new RegExp(signal));
  assert.equal(manifest.icons["128"], "assets/launcher-pet.png"); assert.equal(manifest.action.default_icon["16"], "assets/launcher-pet.png");
  assert.match(launcher, /image-mode/); assert.match(launcher, /launcherSize = 160/); assert.match(launcher, /Math\.min\(240, Math\.max\(96/);
  for (const signal of ["playAnimation(\"idle\")", "playAnimation(\"click\",", "playAnimation(\"drag\")", "playAnimation(\"ambient\",", "showFallback"]) assert.match(launcher, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(launcher, /reduceMotion\.matches[^\n]*showFallback/);
});

test("原生侧栏支持单 AI 可见、多个 AI 发送和受控跨框架消息", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const html = readFileSync(join(root, "sidepanel/index.html"), "utf8");
  const css = readFileSync(join(root, "sidepanel/styles.css"), "utf8");
  const app = readFileSync(join(root, "sidepanel/app.js"), "utf8");
  const bridge = readFileSync(join(root, "content/bridge.js"), "utf8");
  const launcher = readFileSync(join(root, "content/floating-launcher.js"), "utf8");
  const workspace = readFileSync(join(root, "workspace/app.js"), "utf8");

  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel.default_path, "sidepanel/index.html");
  for (const id of ["tabList", "frameStack", "targetMenu", "send", "managePlatforms", "minimizePanel"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /class="panel-head"/);
  assert.match(html, /<nav class="ai-tabs"[^>]*><button id="minimizePanel"[\s\S]*?<button id="openWorkspace"[\s\S]*?<div id="tabList"[\s\S]*?<button id="managePlatforms"/);
  assert.match(css, /\.ai-frame\{[^}]*opacity:0/);
  assert.match(css, /\.ai-frame\.active\{[^}]*opacity:1/);
  assert.match(css, /\.composer\{[^}]*left:8px;right:8px;bottom:8px/);
  assert.match(css, /\.internal-controls\{display:none!important\}/);
  for (const signal of ["frameCommand", "Promise.all(targets.map", "readyOrigins", "multi-ai-sidepanel-ready", "getLayout", "maiw-sidepanel", "MINIMIZE_UI"]) assert.match(app, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(bridge, /event\.origin !== extensionOrigin/);
  assert.match(bridge, /unknown_sidepanel_action/);
  assert.match(launcher, /--pet-width:284px;--pet-height:160px/);
  assert.match(launcher, /launcherSize \* 16 \/ 9/);
  assert.match(workspace, /chrome\.sidePanel\.open\(\{ windowId: state\.workspaceWindowId \}\)/);
  assert.match(workspace, /CLOSE_WORKSPACE_FOR_SIDE_PANEL/);
});
