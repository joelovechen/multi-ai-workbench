import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionPath = join(root, "dist", "multi-ai-workbench-unpacked");
const playwrightModule = process.env.MULTI_AI_PLAYWRIGHT_MODULE;
const playwrightImport = await import(playwrightModule ? pathToFileURL(playwrightModule).href : "playwright");
const { chromium } = playwrightImport.default || playwrightImport;
const profile = mkdtempSync(join(tmpdir(), "multi-ai-workbench-"));
const screenshotPath = resolve(root, "test-screenshots", "workspace.png");
const sideScreenshotPath = resolve(root, "test-screenshots", "sidepanel-adaptive.png");
const affiliateScreenshotPath = resolve(root, "test-screenshots", "affiliate-catalog.png");
mkdirSync(dirname(screenshotPath), { recursive: true });

let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.MULTI_AI_BROWSER_EXECUTABLE || undefined,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const catalog = JSON.parse(readFileSync(join(root, "docs", "affiliate-catalog", "catalog.json"), "utf8"));
  for (const tool of catalog.tools.slice(0, 2)) { tool.status = "active"; tool.visible = true; tool.affiliate.defaultUrl = `https://example.test/register?tool=${tool.id}&ref=smoke`; }
  const catalogPayload = `${JSON.stringify(catalog, null, 2)}\n`;
  const testKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const testPublicKey = testKeys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const catalogSignature = sign("sha256", Buffer.from(catalogPayload), { key: testKeys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  for (const origin of ["https://multi-ai-workbench-catalog.pages.dev", "https://joelovechen.github.io"]) {
    await context.route(`${origin}/**/catalog.json*`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: catalogPayload }));
    await context.route(`${origin}/**/catalog.sig*`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: catalogSignature }));
  }
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/workspace/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate((publicKey) => { globalThis.MultiAIAffiliatePublicKey = publicKey; }, testPublicKey);
  const consentContinue = page.locator("#maiwContinue");
  if (await consentContinue.isVisible()) { await page.selectOption("#maiwPetScope", "supported"); await consentContinue.click(); }
  await page.waitForSelector("#frames .frame-card");
  const guideClose = page.getByRole("button", { name: "知道了" });
  if (await guideClose.isVisible()) await guideClose.click();
  await page.click("#affiliateToggle");
  await page.waitForFunction(() => document.querySelectorAll(".maiw-affiliate-card").length === 2);
  if (!await page.locator(".maiw-affiliate-sponsored").isVisible()) throw new Error("affiliate_disclosure_missing");
  await page.screenshot({ path: affiliateScreenshotPath, fullPage: false });
  await page.click(".maiw-affiliate-head-actions [data-action=close]");
  const defaultServices = await page.locator("#frames .frame-card").evaluateAll((cards) => cards.map((card) => card.dataset.service));
  if (defaultServices.join(",") !== "deepseek,doubao,yuanbao") throw new Error(`unexpected_default_services:${defaultServices.join(",")}`);
  const allAiServices = await page.evaluate(() => MultiAIServiceRegistry.ai.map(({ key, home }) => ({ key, home })));
  if (allAiServices.length !== 13) throw new Error(`sidepanel_catalog_incomplete:${allAiServices.length}`);
  const sidepanelServiceKeys = [...defaultServices, ...allAiServices.map(({ key }) => key).filter((key) => !defaultServices.includes(key))];
  const defaultSidePage = await context.newPage();
  await defaultSidePage.goto(`chrome-extension://${extensionId}/sidepanel/index.html`, { waitUntil: "domcontentloaded" });
  await defaultSidePage.waitForFunction(() => document.querySelectorAll(".ai-frame").length === 13);
  const defaultSideService = await defaultSidePage.locator(".ai-frame.active").getAttribute("data-service");
  if (defaultSideService !== "deepseek") throw new Error(`unexpected_default_side_service:${defaultSideService}`);
  const defaultSideLoadedFrames = await defaultSidePage.locator(".ai-frame").evaluateAll((frames) => frames.filter((frame) => frame.dataset.loaded === "true").map((frame) => frame.dataset.service));
  if (defaultSideLoadedFrames.join(",") !== "deepseek,doubao,yuanbao") throw new Error(`sidepanel_lazy_load_defaults_invalid:${defaultSideLoadedFrames.join(",")}`);
  await defaultSidePage.close();
  const petAssetMetadata = await page.evaluate(async () => {
    const resources = chrome.runtime.getManifest().web_accessible_resources.flatMap((entry) => entry.resources || []).filter((path) => path.startsWith("assets/pet/") && path.endsWith(".webm"));
    const rows = [];
    for (const path of resources) rows.push(await new Promise((resolve) => { const video = document.createElement("video"), done = (ok) => resolve({ path, ok, width: video.videoWidth, height: video.videoHeight }); video.preload = "metadata"; video.muted = true; video.onloadedmetadata = () => done(true); video.onerror = () => done(false); video.src = chrome.runtime.getURL(path); }));
    return rows;
  });
  if (petAssetMetadata.length !== 16 || petAssetMetadata.some((row) => !row.ok || row.width !== 640 || row.height !== 360)) throw new Error(`pet_animation_assets_invalid:${JSON.stringify(petAssetMetadata)}`);

  await page.selectOption("#layout", "2x3");
  if (await page.locator("#frames").getAttribute("data-rows") !== "2") throw new Error("two_row_layout_not_applied");
  if (await page.locator("#frames").evaluate((node) => getComputedStyle(node).display) !== "grid") throw new Error("two_row_layout_not_grid");

  await page.click("#addService");
  if (await page.locator("#servicePanel").isHidden()) throw new Error("service_manager_not_open");
  if (await page.locator("#serviceCatalog .service-option").count() < 10) throw new Error("service_catalog_incomplete");
  for (let index = 0; index < 3; index += 1) await page.locator("#serviceCatalog .service-option:not(.selected):not(:disabled)").first().click();
  await page.click("#serviceApply");
  await page.waitForFunction(() => document.querySelectorAll("#frames .frame-card").length === 6);
  const frameTops = await page.locator("#frames .frame-card").evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
  if (new Set(frameTops).size !== 2) throw new Error("platform_cards_not_split_into_two_rows");

  const before = await page.locator("#composer").boundingBox();
  const handle = await page.locator("#composerDragHandle").boundingBox();
  if (!before || !handle) throw new Error("composer_not_visible");
  await page.mouse.move(handle.x + 40, handle.y + 12); await page.mouse.down(); await page.mouse.move(handle.x + 130, handle.y - 45, { steps: 6 }); await page.mouse.up();
  const after = await page.locator("#composer").boundingBox();
  if (!after || Math.abs(after.x - before.x) < 30) throw new Error("composer_drag_not_applied");

  await page.screenshot({ path: screenshotPath, fullPage: false });
  const aiFixture = `<!doctype html><title>AI fixture</title><style>html,body{margin:0;min-width:960px;min-height:100%;overflow-x:auto}body{display:flex}.fixture-sidebar{position:sticky;left:0;top:0;flex:0 0 260px;width:260px;height:100vh;background:#eef2ff}.fixture-chat{box-sizing:border-box;min-width:700px;padding:8px;flex:1}pre{width:680px;overflow:auto}</style><aside class="fixture-sidebar">History</aside><section class="fixture-chat"><textarea id="prompt-textarea"></textarea><button id="composer-submit-button" aria-label="Send Message">Send</button><main id="messages"><pre>wide code content</pre></main></section><script>document.querySelector('button').onclick=()=>{const q=document.querySelector('textarea').value;const m=document.createElement('div');m.dataset.messageAuthorRole='user';m.dataset.testid='user-message';m.className='font-user-message';m.textContent=q;document.querySelector('#messages').append(m);document.querySelector('textarea').value=''}</script>`;
  for (const { home } of allAiServices) await context.route(`${new URL(home).origin}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: aiFixture }));
  const platformPage = await context.newPage();
  await platformPage.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await platformPage.waitForSelector("#multi-ai-floating-launcher-host", { state: "attached" });
  await platformPage.waitForFunction(() => { const host = document.querySelector("#multi-ai-floating-launcher-host"), delay = Number(host?.dataset.nextRandomDelay); return host?.dataset.mediaReady === "true" && host.dataset.mediaPlaying === "true" && host.dataset.renderWidth === "284" && host.dataset.renderHeight === "160" && host.dataset.animationPack === "rich" && host.dataset.randomFrequency === "normal" && delay >= 30000 && delay <= 60000; }, null, { timeout: 10000 });
  const launcherInjected = await platformPage.locator("#multi-ai-floating-launcher-host").evaluate((node) => !node.hidden);
  const launcherAnimated = await platformPage.locator("#multi-ai-floating-launcher-host").evaluate((node) => node.dataset.mediaReady === "true" && node.dataset.mediaPlaying === "true" && node.dataset.animationState === "idle");
  const launcherHitArea = await platformPage.evaluate(() => { const host = document.querySelector("#multi-ai-floating-launcher-host"), number = (key) => Number(host.dataset[key]), x = number("positionX"), y = number("positionY"), hitLeft = number("hitLeft"), hitTop = number("hitTop"), hitWidth = number("hitWidth"), hitHeight = number("hitHeight"), renderWidth = number("renderWidth"), renderHeight = number("renderHeight"), outside = document.elementFromPoint(x + Math.max(2, hitLeft / 2), y + hitTop + hitHeight / 2), inside = document.elementFromPoint(x + hitLeft + hitWidth / 2, y + hitTop + hitHeight / 2); return { hitLeft, hitTop, hitWidth, hitHeight, renderWidth, renderHeight, outsideIntercepted: outside === host, insideIntercepted: inside === host }; });
  if (!launcherInjected) throw new Error("floating_launcher_not_injected");
  if (!launcherAnimated) throw new Error("floating_launcher_animation_not_ready");
  if (launcherHitArea.hitWidth / launcherHitArea.renderWidth > .45 || launcherHitArea.hitHeight / launcherHitArea.renderHeight < .9 || launcherHitArea.outsideIntercepted || !launcherHitArea.insideIntercepted) throw new Error(`floating_launcher_hit_area_too_large:${JSON.stringify(launcherHitArea)}`);
  await page.evaluate(async () => { const stored = await chrome.storage.local.get("maiw.settings"), settings = stored["maiw.settings"] || {}; await chrome.storage.local.set({ "maiw.settings": { ...settings, launcherStyle: "image", launcherSize: 208 } }); });
  await platformPage.waitForFunction(() => { const host = document.querySelector("#multi-ai-floating-launcher-host"); return host?.dataset.launcherStyle === "image" && host.dataset.launcherSize === "208" && host.dataset.renderWidth === "208" && host.dataset.renderHeight === "208" && host.dataset.mediaPlaying === "false"; });
  const launcherImageMode = true;
  await page.evaluate(async () => { const stored = await chrome.storage.local.get("maiw.settings"), settings = stored["maiw.settings"] || {}; await chrome.storage.local.set({ "maiw.settings": { ...settings, launcherStyle: "animated", launcherSize: 160 } }); });
  await platformPage.waitForFunction(() => { const host = document.querySelector("#multi-ai-floating-launcher-host"); return host?.dataset.launcherStyle === "animated" && host.dataset.launcherSize === "160" && host.dataset.renderWidth === "284" && host.dataset.renderHeight === "160" && host.dataset.mediaPlaying === "true"; });
  await page.evaluate((services) => chrome.storage.local.set({ "maiw.sidepanel": { services, targets: ["chatgpt", "claude"], active: "chatgpt", answerMode: "fast", embedLayoutMode: "adaptive", catalogVersion: 2 } }), sidepanelServiceKeys);
  const sidePage = await context.newPage();
  await sidePage.setViewportSize({ width: 420, height: 900 });
  await sidePage.goto(`chrome-extension://${extensionId}/sidepanel/index.html`, { waitUntil: "domcontentloaded" });
  await sidePage.waitForFunction(() => document.querySelectorAll(".ai-frame").length === 13);
  const modelTabDesign = await sidePage.evaluate(() => { const tab = document.querySelector(".ai-tab"), icon = document.querySelector(".ai-tab-icon"), rail = document.querySelector("#tabList"), active = document.querySelector(".ai-tab.active"), activeRect = active?.getBoundingClientRect(), railRect = rail?.getBoundingClientRect(); return { tabs: document.querySelectorAll(".ai-tab").length, icons: document.querySelectorAll(".ai-tab-icon").length, nameNodes: document.querySelectorAll(".ai-tab-name").length, tabWidth: Math.round(parseFloat(getComputedStyle(tab).width)), iconWidth: Math.round(parseFloat(getComputedStyle(icon).width)), activeCentered: Boolean(activeRect && railRect && Math.abs((activeRect.left + activeRect.right - railRect.left - railRect.right) / 2) < 1), overflow: getComputedStyle(rail).overflow, actionIcons: document.querySelectorAll(".top-action svg").length, carouselArrows: document.querySelectorAll(".carousel-arrow").length }; });
  if (modelTabDesign.tabs !== 13 || modelTabDesign.icons !== 13 || modelTabDesign.nameNodes !== 0 || modelTabDesign.tabWidth !== 34 || modelTabDesign.iconWidth !== 18 || !modelTabDesign.activeCentered || modelTabDesign.overflow !== "hidden" || modelTabDesign.actionIcons !== 4 || modelTabDesign.carouselArrows !== 2) throw new Error(`sidepanel_model_tabs_not_carousel:${JSON.stringify(modelTabDesign)}`);
  await sidePage.click("#managePlatforms");
  const sidepanelManager = await sidePage.evaluate(() => ({ count: document.querySelector("#platformCount")?.textContent, options: document.querySelectorAll("#platformOptions input").length, checked: document.querySelectorAll("#platformOptions input:checked").length, disabled: document.querySelectorAll("#platformOptions input:disabled").length }));
  if (sidepanelManager.count !== "13/13" || sidepanelManager.options !== 13 || sidepanelManager.checked !== 13 || sidepanelManager.disabled !== 0) throw new Error(`sidepanel_manager_incomplete:${JSON.stringify(sidepanelManager)}`);
  await sidePage.click("#managePlatforms");
  const carouselBefore = await sidePage.evaluate(() => { const rail = document.querySelector("#tabList").getBoundingClientRect(), active = document.querySelector(".ai-tab.active").getBoundingClientRect(), right = document.querySelector('.ai-tab[data-carousel-offset="1"]'), rightRect = right.getBoundingClientRect(), center = (rect) => (rect.left + rect.right) / 2; return { active: document.querySelector(".ai-tab.active").dataset.service, right: right.dataset.service, railCenter: center(rail), activeCenter: center(active), rightCenter: center(rightRect) }; });
  await sidePage.locator(`.ai-tab[data-service="${carouselBefore.right}"]`).click(); await sidePage.waitForTimeout(360);
  const carouselAfter = await sidePage.evaluate((previous) => { const rail = document.querySelector("#tabList").getBoundingClientRect(), active = document.querySelector(".ai-tab.active").getBoundingClientRect(), old = document.querySelector(`.ai-tab[data-service="${previous}"]`).getBoundingClientRect(), center = (rect) => (rect.left + rect.right) / 2; return { active: document.querySelector(".ai-tab.active").dataset.service, railCenter: center(rail), activeCenter: center(active), oldCenter: center(old) }; }, carouselBefore.active);
  if (carouselAfter.active !== carouselBefore.right || Math.abs(carouselAfter.activeCenter - carouselAfter.railCenter) >= 1 || carouselAfter.oldCenter >= carouselAfter.activeCenter || carouselBefore.rightCenter <= carouselBefore.activeCenter) throw new Error(`sidepanel_carousel_did_not_center_clicked_tab:${JSON.stringify({ carouselBefore, carouselAfter })}`);
  await sidePage.click("#previousModel"); await sidePage.waitForFunction((service) => document.querySelector(".ai-tab.active")?.dataset.service === service, carouselBefore.active);
  const adaptiveServices = [];
  const startIndex = sidepanelServiceKeys.indexOf(carouselBefore.active), carouselOrder = sidepanelServiceKeys.map((_, index) => sidepanelServiceKeys[(startIndex + index) % sidepanelServiceKeys.length]);
  for (const key of carouselOrder) {
    await sidePage.waitForFunction((service) => document.querySelector(".ai-tab.active")?.dataset.service === service, key); const service = allAiServices.find((entry) => entry.key === key);
    let serviceFrame = null;
    for (let attempt = 0; attempt < 80 && !serviceFrame; attempt += 1) { serviceFrame = sidePage.frames().find((frame) => frame !== sidePage.mainFrame() && frame.url().startsWith(new URL(service.home).origin)); if (!serviceFrame) await new Promise((resolve) => setTimeout(resolve, 100)); }
    if (!serviceFrame) throw new Error(`sidepanel_lazy_frame_missing:${service.key}`);
    await serviceFrame.waitForFunction((key) => document.documentElement.dataset.multiAiSidepanelLayout === "adaptive" && document.documentElement.dataset.multiAiSidepanelService === key && getComputedStyle(document.querySelector(".fixture-sidebar")).display === "none" && document.documentElement.scrollWidth <= innerWidth + 1, service.key);
    adaptiveServices.push(service.key);
    if (adaptiveServices.length < carouselOrder.length) await sidePage.click("#nextModel");
  }
  await sidePage.click("#nextModel"); await sidePage.waitForFunction(() => document.querySelector(".ai-tab.active")?.dataset.service === "chatgpt"); await sidePage.waitForTimeout(300);
  const adaptiveFixtureFrame = sidePage.frames().find((frame) => frame.url().startsWith("https://chatgpt.com/")); if (!adaptiveFixtureFrame) throw new Error("adaptive_fixture_frame_missing");
  await adaptiveFixtureFrame.waitForFunction(() => document.documentElement.dataset.multiAiSidepanelLayout === "adaptive" && getComputedStyle(document.querySelector(".fixture-sidebar")).display === "none" && document.documentElement.scrollWidth <= innerWidth + 1);
  const adaptiveLayout = await adaptiveFixtureFrame.evaluate(() => ({ mode: document.documentElement.dataset.multiAiSidepanelLayout, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, sidebarHidden: getComputedStyle(document.querySelector(".fixture-sidebar")).display === "none", chatWidth: Math.round(document.querySelector(".fixture-chat").getBoundingClientRect().width), codeScrollable: getComputedStyle(document.querySelector("pre")).overflowX === "auto" }));
  await sidePage.click("#managePlatforms"); await sidePage.selectOption("#embedLayoutMode", "original"); await adaptiveFixtureFrame.waitForFunction(() => !document.documentElement.dataset.multiAiSidepanelLayout && document.documentElement.scrollWidth > innerWidth + 100);
  await sidePage.selectOption("#embedLayoutMode", "adaptive"); await adaptiveFixtureFrame.waitForFunction(() => document.documentElement.dataset.multiAiSidepanelLayout === "adaptive" && document.documentElement.scrollWidth <= innerWidth + 1); await sidePage.click("#managePlatforms");
  const compactSideLayout = await sidePage.evaluate(() => { const nav = document.querySelector(".ai-tabs")?.getBoundingClientRect(), full = document.querySelector("#openWorkspace")?.getBoundingClientRect(), tabs = document.querySelector("#tabList")?.getBoundingClientRect(), add = document.querySelector("#managePlatforms")?.getBoundingClientRect(), composer = document.querySelector(".composer")?.getBoundingClientRect(), centerY = (rect) => (rect.top + rect.bottom) / 2; return { hasLegacyHeader: Boolean(document.querySelector(".panel-head")), sameTopRow: Boolean(nav && full && tabs && add && Math.abs(centerY(full) - centerY(tabs)) < 2 && Math.abs(centerY(add) - centerY(tabs)) < 2), floatingComposer: Boolean(composer && composer.left >= 7 && innerWidth - composer.right >= 7 && innerHeight - composer.bottom >= 7), internalControlsHidden: getComputedStyle(document.querySelector(".internal-controls")).display === "none" }; });
  if (compactSideLayout.hasLegacyHeader || !compactSideLayout.sameTopRow || !compactSideLayout.floatingComposer || !compactSideLayout.internalControlsHidden) throw new Error(`sidepanel_not_compact:${JSON.stringify(compactSideLayout)}`);
  const visibleSideFrames = await sidePage.locator(".ai-frame").evaluateAll((frames) => frames.filter((frame) => getComputedStyle(frame).opacity === "1").length);
  if (visibleSideFrames !== 1) throw new Error("sidepanel_must_show_exactly_one_ai");
  await sidePage.evaluate(() => chrome.storage.session.set({ "maiw.pendingTask": { id: crypto.randomUUID(), content: "Extension usability", actionId: "translate-zh", openPicker: false, autoSend: false, targetMode: "selection", createdAt: Date.now() } }));
  await sidePage.waitForFunction(() => document.querySelector("#question")?.value === "Extension usability" && !document.querySelector("#activeTemplate")?.hidden);
  if (!await sidePage.locator("#activeTemplateLabel").textContent().then((value) => value.includes("中英双向翻译"))) throw new Error("prompt_template_not_applied");
  await sidePage.click("#send");
  try { await sidePage.waitForFunction(() => document.querySelector("#status")?.textContent.includes("2 个 AI 均已确认发送"), null, { timeout: 45000 }); }
  catch (error) { console.error(JSON.stringify({ sideStatus: await sidePage.locator("#status").textContent(), sideFailureReasons: await sidePage.locator("#status").getAttribute("title"), tabStatuses: await sidePage.locator(".ai-tab").evaluateAll((tabs) => tabs.map((tab) => ({ service: tab.dataset.service, status: tab.dataset.status }))), frames: sidePage.frames().map((frame) => frame.url()) })); throw error; }
  const sidePanelLayout = await sidePage.evaluate(async () => chrome.sidePanel?.getLayout ? (await chrome.sidePanel.getLayout()).side : "unavailable");
  const chatgptFixtureFrame = sidePage.frames().find((frame) => frame.url().startsWith("https://chatgpt.com/"));
  const sentTemplatePrompt = chatgptFixtureFrame ? await chatgptFixtureFrame.locator("#messages").textContent() : "";
  if (!sentTemplatePrompt.includes("Extension usability") || !sentTemplatePrompt.includes("如果内容主要是中文") || !sentTemplatePrompt.includes("如果内容主要是英文")) throw new Error("composed_prompt_not_sent");
  await sidePage.screenshot({ path: sideScreenshotPath, fullPage: false });
  const serviceCards = await page.locator("#serviceCatalog .service-option").count();
  await page.click("#settingsToggle");
  await page.click('[data-settings-tab="operations"]');
  const builtInPresetCount = await page.locator("#promptTemplateList .prompt-template-row").count();
  if (builtInPresetCount !== 3) throw new Error(`built_in_operations_not_simplified:${builtInPresetCount}`);
  await page.click("#newPromptTemplate"); await page.fill("#promptTemplateName", "冒烟测试操作"); await page.selectOption("#promptTemplateCategory", "custom"); await page.fill("#promptTemplatePrompt", "请检查以下内容：{{content}}"); await page.locator("#promptTemplateForm").getByRole("button", { name: "保存操作" }).click();
  await page.waitForFunction(() => document.querySelector("#promptTemplateList")?.textContent.includes("冒烟测试操作"));
  const customTemplateStored = await page.evaluate(async () => (await chrome.storage.local.get("maiw.operations"))["maiw.operations"]?.some((row) => row.name === "冒烟测试操作"));
  if (!customTemplateStored) throw new Error("custom_operation_not_saved");
  await page.click("#settingsClose");
  await page.click("#sidePanelToggle");
  for (let attempt = 0; attempt < 80 && !page.isClosed(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!page.isClosed()) { console.error(JSON.stringify({ switchStatus: await page.locator("#status").textContent(), openPages: context.pages().map((candidate) => candidate.url()) })); throw new Error("workspace_page_not_closed_after_sidepanel_switch"); }
  const workspaceTabsAfterSideSwitch = context.pages().filter((candidate) => candidate.url().includes(`/workspace/index.html`)).length;
  if (workspaceTabsAfterSideSwitch !== 0) throw new Error("workspace_tab_remained_after_sidepanel_switch");
  const beforeFullSwitch = new Set(context.pages()); await sidePage.click("#openWorkspace");
  let reopenedWorkspace = null;
  for (let attempt = 0; attempt < 80 && !reopenedWorkspace; attempt += 1) { reopenedWorkspace = context.pages().find((candidate) => !beforeFullSwitch.has(candidate) && candidate.url().includes(`/workspace/index.html`)); if (!reopenedWorkspace) await new Promise((resolve) => setTimeout(resolve, 100)); }
  if (!reopenedWorkspace) throw new Error("workspace_not_opened_from_sidepanel");
  await context.route("https://www.doubao.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: aiFixture }));
  await context.route("https://gemini.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: aiFixture }));
  await reopenedWorkspace.evaluate(async () => {
    const stored = await chrome.storage.local.get("maiw.settings"), settings = stored["maiw.settings"] || {};
    await chrome.storage.local.set({
      "maiw.settings": { ...settings, services: ["doubao", "gemini"], openBehavior: "resume", currentSessionId: "bad-route-session" },
      "maiw.history": [{ id: "bad-route-session", summary: "旧会话", questions: [{ id: "q1", text: "旧问题", createdAt: Date.now() }], services: ["doubao", "gemini"], urls: { doubao: "https://www.doubao.com/chat/old-session", gemini: "https://gemini.google.com/_/bscframe" }, pinned: false, createdAt: Date.now(), updatedAt: Date.now() }]
    });
  });
  await reopenedWorkspace.reload({ waitUntil: "domcontentloaded" }); await reopenedWorkspace.waitForFunction(() => document.querySelectorAll("#frames .frame-card").length === 2);
  const restoredUrls = await reopenedWorkspace.locator("#frames .frame-card").evaluateAll((cards) => Object.fromEntries(cards.map((card) => [card.dataset.service, card.querySelector("iframe")?.getAttribute("src")])));
  if (restoredUrls.doubao !== "https://www.doubao.com/chat/" || restoredUrls.gemini !== "https://gemini.google.com/app") throw new Error(`unsafe_workspace_url_restore:${JSON.stringify(restoredUrls)}`);
  console.log(JSON.stringify({ extensionId, screenshotPath, sideScreenshotPath, affiliateScreenshotPath, affiliateCatalogVerified: true, defaultServices, defaultSideService, defaultSideLoadedFrames, sidepanelServices: sidepanelServiceKeys, sidepanelManager, adaptiveServices, layout: "2x3", platformPanels: frameTops.length, visualRows: new Set(frameTops).size, serviceCards, composerMoved: true, petAnimationAssets: petAssetMetadata.length, launcherInjected, launcherAnimated, launcherHitArea, launcherImageMode, compactSideLayout, modelTabDesign, adaptiveLayout, sidePanelVisibleFrames: visibleSideFrames, sidePanelParallelSend: true, promptTemplateApplied: true, builtInPresetCount, customTemplateSaved: true, sidePanelLayout, workspaceClosedOnSideSwitch: true, workspaceOpenedOnFullSwitch: true, safeWorkspaceUrlRestore: true }));
} finally {
  if (context) await context.close();
  rmSync(profile, { recursive: true, force: true });
}
