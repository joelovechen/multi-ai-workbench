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
vm.runInNewContext(readFileSync(join(root, "shared/conversation-export-core.js"), "utf8"), sandbox);
const conversationExport = sandbox.self.MultiAIConversationExport;
vm.runInNewContext(readFileSync(join(root, "shared/gemini-conversation-core.js"), "utf8"), sandbox);
const geminiConversation = sandbox.self.MultiAIGeminiConversation;
const archiveSandbox = { self: { MultiAIConversationExport: conversationExport }, TextEncoder, Uint8Array, Uint32Array, DataView, Blob, Date };
vm.runInNewContext(readFileSync(join(root, "shared/archive-core.js"), "utf8"), archiveSandbox);
const archiveCore = archiveSandbox.self.MultiAIArchive;
const assetSandbox = {
  self: { MultiAIConversationExport: conversationExport },
  fetch: globalThis.fetch,
  Blob,
  URL,
  TextEncoder,
  Uint8Array,
  Buffer,
  structuredClone,
  chrome: { runtime: {}, tabs: {} }
};
vm.runInNewContext(readFileSync(join(root, "conversation-export/asset-manager.js"), "utf8"), assetSandbox);
const assetManagerModule = assetSandbox.self.MultiAIAssetManager;
const affiliateSandbox = { chrome: { runtime: { getManifest: () => ({ version: "0.6.0" }) } }, URL, self: {} };
vm.runInNewContext(readFileSync(join(root, "shared/affiliate-catalog.js"), "utf8"), affiliateSandbox);
const affiliateCatalog = affiliateSandbox.MultiAIAffiliateCatalog;

test("默认平台为 DeepSeek、豆包和腾讯元宝，侧栏首选 DeepSeek", () => {
  assert.deepEqual([...registry.defaults], ["deepseek", "doubao", "yuanbao"]);
});

test("Gemini batchexecute 分页会恢复时间顺序并保留附件、思考与图片", () => {
  const row = (id, question) => {
    const value = [];
    value[0] = [null, id];
    value[2] = [[]];
    value[2][0][0] = question;
    value[2][0][4] = [[]];
    value[2][0][4][0][3] = [[null, null, `${id}.pdf`, `https://files.test/${id}.pdf`, null, `${id}-file`, null, null, null, null, null, "application/pdf", null, [0, 0, 42]]];
    value[3] = [[[]]];
    value[3][0][0][1] = [`answer-${id}`];
    value[3][0][0][37] = [[`thinking-${id}`]];
    value[3][3] = `${id}-answer`;
    value[3][21] = "Gemini 2.5";
    value[3][12] = [[[[null, null, null, "https://lh3.googleusercontent.com/gg-image"]]]];
    value[4] = [1700000000];
    return value;
  };
  const payload = [[row("new", "new question"), row("old", "old question")], "next-cursor"];
  const framed = `)]}'\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify(payload)]])}`;
  const page = geminiConversation.parsePage(geminiConversation.parseBatchResponse(framed, "hNvQHb"));
  assert.equal(page.rawCount, 2);
  assert.equal(page.cursor, "next-cursor");
  assert.equal(page.turns[0].renderId, "old");
  assert.equal(page.turns[1].renderId, "new");
  const messages = geminiConversation.messagesFromTurns(page.turns);
  assert.equal(messages.length, 4);
  assert.ok(messages[0].contents.some((item) => item.type === "attachment" && item.size === 42));
  assert.ok(messages[1].contents.some((item) => item.type === "thinking"));
  assert.ok(messages[1].contents.some((item) => item.type === "image"));
});

test("17 个导出入口均使用专用抓取适配器且接口失败不静默降级", () => {
  const platformsSandbox = { URL };
  vm.runInNewContext(readFileSync(join(root, "shared/conversation-export-platforms.js"), "utf8"), platformsSandbox);
  const source = readFileSync(join(root, "content/conversation-export.js"), "utf8");
  const adapters = new Set(platformsSandbox.MultiAIConversationExportPlatforms.platforms.map((row) => row.adapter || row.id));
  assert.equal(platformsSandbox.MultiAIConversationExportPlatforms.platforms.length, 17);
  assert.equal(adapters.size, 16);
  for (const adapter of adapters)
    assert.match(source, new RegExp(`async ${adapter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(p\\)`), adapter);
  assert.match(source, /if \(fn\) return fn\(p\)/);
  assert.doesNotMatch(source, /if \(fn\)[\s\S]{0,180}catch[\s\S]{0,180}return dom\(p\)/);
});

test("对话导出生成真正 DOCX ZIP，空选择不会退回全选", async () => {
  const conversation = { id: "demo", platform: "deepseek", platformName: "DeepSeek", title: "Demo", messages: [{ id: "m1", role: "user", contents: [{ type: "text", content: "Hello" }] }] };
  assert.equal(conversationExport.selectedConversation(conversation, new Set()).messages.length, 0);
  const blob = archiveCore.docxBlob(conversationExport.normalizeConversation(conversation));
  const data = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...data.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.match(new TextDecoder().decode(data), /word\/document\.xml/);
});

test("参考插件的富内容类型会被统一模型保留并写入 Markdown", () => {
  const richContents = [
    { type: "image_group", imageGroup: { images: [{ imageUrl: "https://example.test/a.png", title: "A" }] } },
    { type: "video_blocks", videoBlockTitle: "Videos", videoBlocks: [{ url: "https://example.test/v", title: "V" }] },
    { type: "shopping_card", shoppingCard: { title: "Product", price: "$9", url: "https://example.test/p" } },
    { type: "shopping_table", shoppingTable: { columns: ["Name"], rows: [["P"]] } },
    { type: "html_widget", title: "Widget", content: "<div>Hello</div>" },
    { type: "chart", chart: { type: "bar", data: [1, 2] } },
    { type: "writing_block", title: "Draft", content: "Body" },
    { type: "file_changes", fileChanges: { files: [{ path: "app.js", added: 2, removed: 1 }] } },
  ];
  const conversation = conversationExport.normalizeConversation({
    id: "rich",
    title: "Rich",
    messages: [{ id: "m1", role: "assistant", contents: richContents }],
  });
  assert.deepEqual(conversation.messages[0].contents.map((item) => item.type), richContents.map((item) => item.type));
  const markdown = conversationExport.markdownFromConversation(conversation);
  for (const signal of ["![A]", "Videos", "Product", '"columns"', "<div>Hello</div>", '"type": "bar"', "Draft", "app.js: +2 / -1"])
    assert.match(markdown, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("豆包抓取与参考实现一致合并 reply_unique_key，并去重思考和图片", () => {
  const source = readFileSync(join(root, "content/conversation-export.js"), "utf8");
  assert.match(source, /reply_unique_key/);
  assert.match(source, /replyGroups\.get\(replyKey\)/);
  assert.match(source, /existing\.contents\.push\(\.\.\.message\.contents\)/);
  assert.match(source, /thinking = new Set\(\)/);
  assert.match(source, /images = new Set\(\)/);
  assert.match(source, /search_query_result_block/);
});

test("项目采用 Unlicense 且第三方许可证声明完整", () => {
  const license = readFileSync(join(root, "LICENSE"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const notice = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
  assert.match(license, /free and unencumbered software released into the public domain/);
  assert.equal(packageJson.license, "Unlicense");
  assert.match(notice, /AI Exporter 4\.4\.6/);
  assert.match(notice, /free and unencumbered software released into the public domain/);
  assert.match(notice, /https:\/\/unlicense\.org/);
  assert.match(notice, /dsh-pet/);
  assert.match(notice, /MIT License/);
});

test("高差异平台采用参考实现的完整轮次与富内容规则", () => {
  const extractor = readFileSync(join(root, "content/conversation-export.js"), "utf8");
  const mainWorld = readFileSync(join(root, "content/main-world.js"), "utf8");
  const gemini = readFileSync(join(root, "shared/gemini-conversation-core.js"), "utf8");
  for (const signal of [
    "chatgptMessages", "chatgptContents", "resolveChatgptShareImages",
    "claudeCoworkMessages", "AskUserQuestion", "html_widget",
    "perplexityContents", "WORKFLOW_ITEM_SOURCES", "share_frome",
    "googleAnswerContents", "data-xpm-latex", "imageOrigin: \"generated\"",
    "grokCardContents", "uniqueContents",
  ]) assert.ok(extractor.includes(signal), `缺少参考对齐信号：${signal}`);
  for (const signal of ["SAPISID1PHASH", "SAPISID3PHASH", "tool.contents", "mobileThumbnailUrl", "SourceImportCard"])
    assert.ok(extractor.includes(signal), `缺少认证、引用或附件对齐信号：${signal}`);
  for (const signal of ["shopping_card", "shopping_table", "image_group", "video_blocks", "html_widget", "deep_research_confirmation_content"])
    assert.ok(gemini.includes(signal), `Gemini 缺少富内容对齐信号：${signal}`);
  assert.match(mainWorld, /EXPORT_CHATGPT_SHARE_DATA/);
});

test("推广目录强制双语、安全链接、状态过滤和动态排序", () => {
  const catalog = JSON.parse(readFileSync(join(root, "docs/affiliate-catalog/catalog.json"), "utf8"));
  assert.equal(affiliateCatalog.validateCatalog(catalog), true);
  assert.equal(affiliateCatalog.visibleTools(catalog, "all", "", "zh").length, 0);
  const active = structuredClone(catalog);
  active.tools[0].status = "active"; active.tools[0].visible = true; active.tools[0].affiliate.defaultUrl = "https://example.test/register?ref=abc";
  active.tools[1].status = "active"; active.tools[1].visible = true; active.tools[1].affiliate.defaultUrl = "https://example.test/register?ref=def"; active.tools[1].sort = 1;
  assert.equal(affiliateCatalog.visibleTools(active, "coding", "代码", "zh")[0].id, "coderabbit");
  assert.equal(affiliateCatalog.visibleTools(active, "coding", "frontend", "en")[0].id, "kombai");
  active.tools[0].affiliate.defaultUrl = "javascript:alert(1)";
  assert.equal(affiliateCatalog.visibleTools(active, "all", "", "zh").some((row) => row.id === "coderabbit"), false);
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

  for (const id of ["composerDragHandle", "servicePanel", "selectedServices", "serviceCatalog", "settingsPanel", "launcherScope", "launcherStyle", "launcherAnimationPack", "launcherRandomFrequency", "launcherSize", "launcherSizeValue", "launcherEdgeGap", "launcherEdgeGapValue", "launcherEdgeSnap", "launcherSingleAction", "launcherDoubleAction", "launcherTripleAction", "minimizeToggle"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<img class="brand-mark" src="\.\.\/assets\/launcher-pet\.png"/); assert.doesNotMatch(html, /<span class="brand-mark">多<\/span>/);
  assert.match(html, /value="2x5"/);
  assert.doesNotMatch(html, /questionRail|quickAccess|快捷入口/);
  assert.match(css, /\.frames\[data-rows="2"\]\{display:grid/);
  for (const signal of ["serviceDraft", "renderServiceManager", "bindComposerDrag", "clampComposerPosition", "launcherScope", "launcherStyle", "launcherAnimationPack", "launcherRandomFrequency", "launcherSize", "launcherEdgeGap", "launcherEdgeSnap", "MINIMIZE_UI"]) assert.match(app, new RegExp(signal));
  assert.equal(manifest.optional_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  const launcherEntry = manifest.content_scripts.find((entry) => entry.js?.includes("content/floating-launcher.js"));
  assert.ok(launcherEntry);
  assert.notEqual(launcherEntry.all_frames, true);
  assert.match(launcher, /window\.top !== window/);
  assert.match(launcher, /attachShadow/);
  assert.match(launcher, /Math\.hypot\(dx, dy\) > 6/);
  assert.match(launcher, /action: "TOGGLE_SIDE_PANEL"/);
  assert.match(launcher, /action: "OPEN_WORKSPACE"/);
  assert.match(launcher, /activationCount >= 3/);
  assert.match(launcher, /launcherActions\.triple/);
  assert.match(launcher, /START_CONVERSATION_EXPORT/);
  assert.doesNotMatch(launcher, /addEventListener\("dblclick"/);
  assert.match(launcher, /assets\/launcher-pet\.png/);
  for (const asset of ["pet-idle.webm", "pet-click.webm", "pet-drag.webm"]) assert.match(launcher, new RegExp(asset.replace(".", "\\.")));
  for (const signal of ["clickAnimations", "ambientAnimations", "scheduleRandomAnimation", "nextRandomDelay", "animationPack", "randomFrequency", "pet-launcher", "pet-hit", "hitDimensions", "--hit-left", "--hit-width", "launcherEdgeGap", "launcherEdgeSnap", "snapToEdge", "edgeGap", "edgeSnap"]) assert.match(launcher, new RegExp(signal));
  assert.equal(manifest.icons["128"], "assets/launcher-pet.png"); assert.equal(manifest.action.default_icon["16"], "assets/launcher-pet.png");
  assert.match(launcher, /image-mode/); assert.match(launcher, /launcherSize = 160/); assert.match(launcher, /Math\.min\(240, Math\.max\(96/);
  for (const signal of ["playAnimation(\"idle\")", "playAnimation(\"click\",", "playAnimation(\"drag\")", "playAnimation(\"ambient\",", "showFallback"]) assert.match(launcher, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(launcher, /reduceMotion\.matches[^\n]*showFallback/);
});

test("网页对话导出使用统一数据模型、真实抓取消息和独立预览页", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const background = readFileSync(join(root, "background/index.js"), "utf8");
  const extractor = readFileSync(join(root, "content/conversation-export.js"), "utf8");
  const mainWorld = readFileSync(join(root, "content/main-world.js"), "utf8");
  const exportPlatforms = readFileSync(join(root, "shared/conversation-export-platforms.js"), "utf8");
  const preview = readFileSync(join(root, "conversation-export/preview.js"), "utf8");
  const launcher = readFileSync(join(root, "content/floating-launcher.js"), "utf8");
  const entry = manifest.content_scripts.find((row) => row.js?.includes("content/conversation-export.js"));
  assert.ok(entry?.js.includes("shared/conversation-export-platforms.js") && entry?.js.includes("shared/conversation-export-core.js") && entry?.js.includes("shared/gemini-conversation-core.js") && entry?.js.includes("shared/archive-core.js"));
  for (const signal of ["G.PAGE_SIZE", "gemini_request_context_missing", "gemini_pagination_repeated", "gemini_pagination_limit", "notebooklm_pagination_limit", "perplexity_pagination_limit", "yuanbao_pagination_limit", "doubao_pagination_limit", "if (fn) return fn(p)"]) assert.match(extractor, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const signal of ["MAIW_EXTRACT_CONVERSATION", "conversation_not_found", "completeness", "history_messages", "current_message_id", "ListMessages", "api/v2/chats", "backend-api/conversation", "hNvQHb", "ujx1Bf", "VfAZjd", "khqZz", "ResolveDriveResource", "response-node", "load-responses", "conversation/v1/detail"]) assert.ok(extractor.includes(signal), `导出适配器缺少 ${signal}`);
  for (const signal of ["EXPORT_GET_CONTEXT", "EXPORT_PAGE_FETCH", "pull_singe_chain_uplink_body", "supported_block_use_cases", "im/chain/single", "WIZ_global_data"]) assert.ok(mainWorld.includes(signal), `主世界捕获器缺少 ${signal}`);
  for (const id of ["chatgpt", "gemini", "claude", "notebooklm", "grok", "deepseek", "perplexity", "kimi-ai", "kimi-com", "qwen", "doubao", "googleaistudio", "googlesearch", "copilot", "m365copilot", "githubcopilot", "yuanbao"]) assert.match(exportPlatforms, new RegExp(`id: "${id}"`));
  assert.equal((exportPlatforms.match(/icon: "/g) || []).length, 17);
  for (const signal of ["direct: true", "saveDirectExport", "一键导出全部对话", "direct-confirm", "completeness !== \"complete\""]) assert.match(launcher, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(manifest.web_accessible_resources.some((row) => row.resources?.includes("assets/platform-icons/*")));
  assert.match(background, /MultiAIConversationExportPlatforms/);
  for (const signal of ["START_CONVERSATION_EXPORT", "chrome.storage.session", "conversation-export/preview.html", "frameId: 0"]) assert.match(background, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const signal of ["selectedConversation", "markdownFromConversation", "textFromConversation", "jsonFromConversation", "window.print", "ImageExport.exportPages"]) assert.match(preview, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const conversation = { id: "test", title: "Example", platform: "deepseek", platformName: "DeepSeek", messages: [{ id: "u1", role: "user", contents: [{ type: "text", content: "Hello" }] }, { id: "a1", role: "assistant", contents: [{ type: "markdown", content: "World" }] }] };
  assert.match(conversationExport.markdownFromConversation(conversation), /## User[\s\S]*Hello[\s\S]*## DeepSeek[\s\S]*World/);
  assert.equal(conversationExport.selectedConversation(conversation, new Set(["a1"])).messages.length, 1);
  assert.match(conversationExport.jsonFromConversation(conversation), /"schemaVersion": 2/);
});

test("首次使用语言跟随浏览器界面语言，已有选择优先", () => {
  const privacy = readFileSync(join(root, "shared/privacy-ui.js"), "utf8");
  const workspace = readFileSync(join(root, "workspace/app.js"), "utf8");
  const sidepanel = readFileSync(join(root, "sidepanel/app.js"), "utf8");
  assert.match(privacy, /chrome\.i18n\?\.getUILanguage\?\.\(\)/);
  assert.match(privacy, /navigator\.languages\?\.find\(Boolean\)/);
  assert.match(privacy, /\["zh", "en"\]\.includes\(savedLocale\)/);
  assert.doesNotMatch(privacy, /accepted\.locale \|\| locale/);
  assert.match(workspace, /savedLocale \|\| undefined/);
  assert.match(sidepanel, /savedLocale \|\| undefined/);
  assert.doesNotMatch(sidepanel, /locale: "zh"/);
  const background = readFileSync(join(root, "background/index.js"), "utf8"), sideHtml = readFileSync(join(root, "sidepanel/index.html"), "utf8");
  assert.doesNotMatch(background, /details\.reason === "install"\) void openOrFocusWorkspace/);
  assert.match(background, /maiw\.sidepanelTutorialPending/); assert.match(background, /setBadgeText/);
  for (const id of ["gestureTutorial", "tutorialSingleTitle", "tutorialDoubleTitle", "tutorialTripleTitle", "finishGestureTutorial"]) assert.match(sideHtml, new RegExp(`id="${id}"`));
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
  for (const id of ["tabList", "frameStack", "targetMenu", "send", "managePlatforms", "minimizePanel", "previousModel", "nextModel", "embedLayoutMode"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /class="panel-head"/);
  assert.match(html, /<nav class="ai-tabs"[^>]*>[\s\S]*?<button id="minimizePanel"[\s\S]*?<div class="tab-rail"><div id="tabList" role="tablist"[\s\S]*?<button id="managePlatforms"[\s\S]*?<button id="openWorkspace"/);
  assert.match(html, /class="top-action fullscreen-tab"[\s\S]*?<svg/);
  assert.match(css, /\.ai-frame\{[^}]*opacity:0/);
  assert.match(css, /\.ai-frame\.active\{[^}]*opacity:1/);
  assert.match(css, /\.composer\{[^}]*left:8px;right:8px;bottom:8px/);
  assert.match(css, /\.internal-controls\{display:none!important\}/);
  for (const signal of ["frameCommand", "Promise.all(targets.map", "readyOrigins", "multi-ai-sidepanel-ready", "getLayout", "maiw-sidepanel", "MINIMIZE_UI", "ai-tab-icon", "aria-selected", "ArrowLeft", "carouselOffset", "--carousel-x", "rotateModel", "lastCarouselWheelAt", "SET_EMBED_LAYOUT", "embedLayoutMode", "sidepanelServices", "sidepanelMaxFrames", "sidepanelCatalogVersion", "ensureFrameLoaded"]) assert.match(app, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const signal of ["applyEmbedLayout", "data-multi-ai-sidepanel-layout", "data-multi-ai-sidepanel-service", "data-multi-ai-compact-wide", "data-multi-ai-compact-sidebar", "MutationObserver", "SET_EMBED_LAYOUT"]) assert.match(bridge, new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(bridge, /event\.origin !== extensionOrigin/);
  assert.match(bridge, /unknown_sidepanel_action/);
  assert.match(launcher, /--pet-width:284px;--pet-height:160px/);
  assert.match(launcher, /launcherSize \* 16 \/ 9/);
  assert.match(workspace, /chrome\.sidePanel\.open\(\{ windowId: state\.workspaceWindowId \}\)/);
  assert.match(workspace, /CLOSE_WORKSPACE_FOR_SIDE_PANEL/);
});

test("Gemini 图片导出全链路契约：RPC 真实 URL 提取、内联替换、附件归类、候选降级与 DOCX 嵌入", async () => {
  // 1. Manifest host permissions
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  assert.ok(manifest.host_permissions.includes("https://*.googleusercontent.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.usercontent.google.com/*"));

  // 2. Gemini batchexecute generated image parsing & inline replacement
  const row = (id) => {
    const value = [];
    value[0] = [null, id];
    value[2] = [[]];
    value[2][0][0] = "Draw a cat";
    value[2][0][4] = [[]];
    // User uploaded attachment image:
    value[2][0][4][0][3] = [[
      null, null, "user-cat.jpg",
      "https://lh3.googleusercontent.com/user-cat-fallback",
      null, "user-cat-ref", null, null, null, null, null,
      "image/jpeg",
      "https://lh3.googleusercontent.com/user-cat-thumb",
      [0, 0, 1024]
    ]];
    value[3] = [[[]]];
    // Answer text with image placeholder token
    value[3][0][0][1] = [
      "Here is your cat:\nhttps://lh3.googleusercontent.com/gg/placeholder-cat\nHope you like it!"
    ];
    value[3][3] = "answer-cat";
    value[3][21] = "Gemini 2.5";
    // Generated image metadata at [3][12]:
    value[3][12] = [
      [
        [
          [
            null, null, null,
            "https://lh3.googleusercontent.com/gg/real-cat-highres",
            null, null,
            "https://lh3.googleusercontent.com/gg/real-cat-thumb"
          ],
          "http://googleusercontent.com/image_generation_content/cat-marker",
          null, null, null, null, null, null, null, null, null, null, null,
          "https://lh3.googleusercontent.com/gg/placeholder-cat"
        ]
      ]
    ];
    return value;
  };

  const framed = `)]}'\n${JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify([[row("turn-1")], null])]])}`;
  const page = geminiConversation.parsePage(geminiConversation.parseBatchResponse(framed, "hNvQHb"));
  const messages = geminiConversation.messagesFromTurns(page.turns);
  assert.equal(messages.length, 2);

  // User message has attachment
  const userAttachment = messages[0].contents.find((c) => c.type === "attachment");
  assert.ok(userAttachment);
  assert.equal(userAttachment.imageOrigin, "attachment");
  assert.equal(userAttachment.imageAccess, "private");
  assert.ok(userAttachment.candidates.length >= 2);

  // Assistant message has inline image replaced into contents
  const assistantContents = messages[1].contents;
  assert.equal(assistantContents[0].type, "markdown");
  assert.match(assistantContents[0].content, /Here is your cat:/);
  assert.equal(assistantContents[1].type, "image");
  assert.equal(assistantContents[1].url, "https://lh3.googleusercontent.com/gg/real-cat-highres");
  assert.ok(assistantContents[1].candidates.includes("https://lh3.googleusercontent.com/gg/real-cat-thumb"));
  assert.equal(assistantContents[2].type, "markdown");
  assert.match(assistantContents[2].content, /Hope you like it!/);

  // 3. collectAssets and Markdown serialization
  const normalized = conversationExport.normalizeConversation({
    id: "test-gemini",
    platform: "gemini",
    platformName: "Gemini",
    title: "Cat Chat",
    messages
  });

  const assetsWithoutAttachments = conversationExport.collectAssets(normalized).filter((a) => a.kind !== "attachment");
  // Both generated image and image attachment are retained as kind "image"!
  assert.equal(assetsWithoutAttachments.length, 2);
  assert.ok(assetsWithoutAttachments.some((a) => a.url === "https://lh3.googleusercontent.com/gg/real-cat-highres"));
  assert.ok(assetsWithoutAttachments.some((a) => a.url === "https://lh3.googleusercontent.com/user-cat-fallback"));

  // Markdown serialization emits Markdown images for image attachments
  const md = conversationExport.markdownFromConversation(normalized);
  assert.match(md, /!\[user-cat\.jpg\]\(https:\/\/lh3\.googleusercontent\.com\/user-cat-fallback\)/);
  assert.match(md, /!\[Gemini generated image\]\(https:\/\/lh3\.googleusercontent\.com\/gg\/real-cat-highres\)/);

  // 4. AssetManager candidate fallback and error handling
  const assetMgr = new assetManagerModule.AssetManager();
  const tinyPngBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // Candidate fallback: primary candidate is invalid, secondary candidate is valid data URI
  const resolvedItem = await assetMgr.fetch(
    "https://invalid-host-should-fail.example.test/img.png",
    null,
    [tinyPngBase64]
  );
  assert.ok(resolvedItem);
  assert.ok(resolvedItem.dataUrl.startsWith("data:image/png;base64,"));

  // Embedded conversation replaces URLs with resolved dataUrl
  const resolvedMap = new Map();
  resolvedMap.set("https://lh3.googleusercontent.com/gg/real-cat-highres", resolvedItem);
  resolvedMap.set("https://lh3.googleusercontent.com/user-cat-fallback", resolvedItem);

  const embedded = assetMgr.embeddedConversation(normalized, resolvedMap);
  const embeddedAssistantImage = embedded.messages[1].contents.find((c) => c.type === "image");
  assert.equal(embeddedAssistantImage.url, resolvedItem.dataUrl);

  // 5. DOCX generation embeds images into word/media/
  const docxBlob = await archiveCore.docxBlobWithAssets(normalized, {}, resolvedMap);
  const docxBytes = new Uint8Array(await docxBlob.arrayBuffer());
  assert.deepEqual([...docxBytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const docxText = new TextDecoder().decode(docxBytes);
  assert.match(docxText, /word\/media\/image1\.png/);
  assert.match(docxText, /word\/media\/image2\.png/);
  assert.match(docxText, /<a:blip r:embed="rId/);
});
