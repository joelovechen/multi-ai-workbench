(function initFloatingLauncher() {
  "use strict";

  if (window.top !== window || document.getElementById("multi-ai-floating-launcher-host")) return;

  const host = document.createElement("div");
  host.id = "multi-ai-floating-launcher-host";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    .pet-launcher{--pet-width:284px;--pet-height:160px;--hit-left:82px;--hit-top:5px;--hit-width:120px;--hit-height:150px;position:fixed;z-index:2147483646;width:var(--pet-width);height:var(--pet-height);display:grid;place-items:center;pointer-events:none;color:#172033;font:600 12px/1.3 system-ui,"Microsoft YaHei",sans-serif;user-select:none}
    .pet-hit{position:absolute;z-index:2;left:var(--hit-left);top:var(--hit-top);width:var(--hit-width);height:var(--hit-height);padding:0;border:0;border-radius:42%;background:transparent;cursor:grab;pointer-events:auto;touch-action:none}
    .pet-media{grid-area:1/1;width:var(--pet-width);height:var(--pet-height);display:block;object-fit:contain;pointer-events:none;-webkit-user-drag:none;filter:drop-shadow(0 10px 14px rgba(15,23,42,.28));transition:filter .18s ease,transform .18s ease}.pet-fallback{opacity:0}.fallback .pet-video,.image-mode .pet-video{display:none}.fallback .pet-fallback,.image-mode .pet-fallback{opacity:1}.tip{position:absolute;right:calc(var(--pet-width) - var(--hit-left) + 8px);top:50%;width:max-content;max-width:190px;padding:8px 10px;border:1px solid rgba(148,163,184,.35);border-radius:10px;background:rgba(15,23,42,.9);color:#fff;box-shadow:0 8px 24px rgba(15,23,42,.2);opacity:0;transform:translate(6px,-50%);pointer-events:none;transition:.18s ease}.dock-left .tip{right:auto;left:calc(var(--hit-left) + var(--hit-width) + 8px);transform:translate(-6px,-50%)}.tip strong,.tip span{display:block}.tip span{margin-top:2px;color:#cbd5e1;font-size:11px}
    .pet-hit:hover~.pet-media{transform:translateY(-2px) scale(1.06);filter:drop-shadow(0 13px 18px rgba(79,70,229,.34))}.pet-hit:hover~.tip,.pet-hit:focus-visible~.tip{opacity:1;transform:translate(0,-50%)}
    .pet-hit:active{cursor:grabbing}.pet-hit:active~.pet-media{transform:scale(.98)}
    .pet-hit:focus-visible{outline:3px solid rgba(79,70,229,.38);outline-offset:3px}
    .export-center{position:fixed;z-index:2147483647;width:min(360px,calc(100vw - 20px));max-height:min(680px,calc(100vh - 20px));overflow:auto;pointer-events:auto;border:1px solid rgba(148,163,184,.3);border-radius:18px;background:#fff;color:#172033;box-shadow:0 22px 60px rgba(15,23,42,.26);font:500 13px/1.45 system-ui,"Microsoft YaHei",sans-serif}.export-center[hidden]{display:none}.export-center.dark{background:#172033;color:#e5e7eb;border-color:#334155}.export-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(148,163,184,.24);background:inherit}.export-brand{display:flex;align-items:center;gap:9px}.export-brand img{width:34px;height:34px;object-fit:contain}.export-brand strong,.export-brand small{display:block}.export-brand small{color:#64748b;font-size:11px}.export-head-actions{display:flex;gap:5px}.export-center button{box-sizing:border-box;border:1px solid rgba(148,163,184,.3);border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}.export-head-actions button{width:30px;height:30px;padding:0}.platform-strip{display:flex;gap:6px;padding:10px 12px;overflow-x:auto}.platform-link{flex:0 0 34px;height:34px;padding:0;border-radius:50%!important;color:#fff!important;font-weight:800!important;border:0!important}.export-body{padding:0 12px 12px}.custom-export{width:100%;display:flex;align-items:center;gap:12px;padding:13px;text-align:left;border-color:#818cf8!important;background:linear-gradient(135deg,#eef2ff,#f5f3ff)!important;color:#312e81!important}.custom-export b{display:block;font-size:14px}.custom-export span{color:#6366f1;font-size:11px}.custom-icon{font-size:24px}.section-label{display:flex;justify-content:space-between;margin:13px 2px 8px}.section-label small,.export-status{color:#64748b;font-size:11px}.quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.quick-grid button{min-height:62px;padding:8px 4px}.quick-grid b,.quick-grid span{display:block}.quick-grid b{font-size:17px;color:#4f46e5}.quick-grid span{margin-top:3px;font-size:11px}.copy-full{width:100%;margin-top:8px;padding:9px}.export-status{min-height:18px;margin:8px 2px 0}.export-footer{display:flex;justify-content:space-between;gap:6px;padding:10px 12px;border-top:1px solid rgba(148,163,184,.24)}.export-footer button{flex:1;padding:7px 4px;font-size:11px}
    @media(max-width:640px){.tip{display:none}}
  `;
  const stage = document.createElement("div"); stage.className = "pet-launcher";
  const button = document.createElement("button");
  const animationUrls = {
    idle: chrome.runtime.getURL("assets/pet/pet-idle.webm"),
    click: chrome.runtime.getURL("assets/pet/pet-click.webm"),
    drag: chrome.runtime.getURL("assets/pet/pet-drag.webm")
  };
  const clickAnimations = ["pet-click.webm", "pet-click-happy.webm", "pet-click-shy.webm", "pet-click-laugh.webm", "pet-click-angry.webm"].map((name) => chrome.runtime.getURL(`assets/pet/${name}`));
  const ambientAnimations = ["pet-random-look.webm", "pet-random-yawn.webm", "pet-random-stretch.webm", "pet-random-cube.webm", "pet-random-code.webm", "pet-random-snack.webm", "pet-random-hum.webm", "pet-random-dance.webm", "pet-random-think.webm"].map((name) => chrome.runtime.getURL(`assets/pet/${name}`));
  const fallbackUrl = chrome.runtime.getURL("assets/launcher-pet.png");
  button.type = "button"; button.className = "pet-hit"; button.title = "单击打开侧栏，双击打开全屏"; button.setAttribute("aria-label", "多AI提问助手桌宠：单击打开侧栏，双击打开全屏，拖动可调整位置");
  stage.innerHTML = `<video class="pet-media pet-video" autoplay loop muted playsinline preload="auto" aria-hidden="true"></video><img class="pet-media pet-fallback" src="${fallbackUrl}" alt=""><span class="tip"><strong>单击打开侧栏</strong><span>双击全屏 · 三击导出</span></span>`; stage.prepend(button);
  const exportCenter = document.createElement("section"); exportCenter.className = "export-center"; exportCenter.hidden = true; exportCenter.innerHTML = `
    <div class="export-head"><div class="export-brand"><img src="${fallbackUrl}" alt=""><div><strong data-i18n="title">对话导出</strong><small data-i18n="subtitle">从当前 AI 网页整理与保存</small></div></div><div class="export-head-actions"><button data-panel-action="theme" title="切换主题">◐</button><button data-panel-action="close" title="关闭">×</button></div></div>
    <div class="platform-strip" aria-label="AI platforms"></div><div class="export-body"><button class="custom-export" data-export="custom"><span class="custom-icon">✦</span><span><b data-i18n="custom">自定义导出</b><span data-i18n="customHint">预览、筛选消息并选择格式</span></span></button><div class="section-label"><strong data-i18n="quick">快速导出</strong><small data-i18n="visible">当前网页对话</small></div><div class="quick-grid"><button data-export="pdf"><b>PDF</b><span data-i18n="pdf">打印 / PDF</span></button><button data-export="markdown"><b>MD</b><span>Markdown</span></button><button data-export="text"><b>TXT</b><span data-i18n="text">纯文本</span></button><button data-export="word"><b>W</b><span>Word</span></button><button data-export="image"><b>PNG</b><span data-i18n="image">长图</span></button><button data-export="json"><b>{ }</b><span>JSON</span></button></div><button class="copy-full" data-export="copy" data-i18n="copy">复制完整对话 Markdown</button><div class="export-status" role="status"></div></div><div class="export-footer"><button data-panel-action="settings" data-i18n="settings">手势设置</button><button data-panel-action="help" data-i18n="help">使用说明</button><button data-panel-action="feedback" data-i18n="feedback">反馈</button></div>`;
  shadow.append(style, stage, exportCenter); document.documentElement.append(host);

  const video = stage.querySelector(".pet-video");
  let dragging = null;
  let moved = false;
  let position = null;
  let activationCount = 0;
  let activationTimer = 0;
  let animationState = "";
  let currentAnimationUrl = "";
  let launcherSize = 160;
  let launcherStyle = "animated";
  let launcherAnimationPack = "rich";
  let launcherRandomFrequency = "normal";
  let launcherEdgeGap = 4;
  let launcherEdgeSnap = true;
  let launcherLocale = "zh";
  let launcherActions = { single: "sidepanel", double: "workspace", triple: "export-center" };
  let randomAnimationTimer = 0;
  let lastPickedUrl = "";
  const snapThreshold = 24;
  const platformLinks = [
    ["D", "DeepSeek", "https://chat.deepseek.com/", "#2563eb"], ["豆", "豆包", "https://www.doubao.com/chat/", "#6366f1"], ["元", "腾讯元宝", "https://yuanbao.tencent.com/chat/", "#0ea5e9"], ["K", "Kimi", "https://www.kimi.com/", "#111827"], ["千", "千问", "https://www.qianwen.com/", "#7c3aed"], ["G", "ChatGPT", "https://chatgpt.com/", "#10a37f"], ["✦", "Gemini", "https://gemini.google.com/", "#4285f4"], ["C", "Claude", "https://claude.ai/", "#d97757"]
  ];
  const strip = exportCenter.querySelector(".platform-strip");
  for (const [mark, name, url, color] of platformLinks) { const item = document.createElement("button"); item.className = "platform-link"; item.textContent = mark; item.title = name; item.style.background = color; item.addEventListener("click", () => window.open(url, "_blank", "noopener")); strip.append(item); }

  const actionLabel = (action, en) => ({ sidepanel: en ? "side panel" : "侧栏", workspace: en ? "full screen" : "全屏", "export-center": en ? "export center" : "导出中心", hide: en ? "hide pet" : "隐藏桌宠", none: en ? "no action" : "无操作" })[action] || action;
  function applyText() {
    const en = launcherLocale === "en";
    button.title = en ? `Click: ${actionLabel(launcherActions.single, true)}; double-click: ${actionLabel(launcherActions.double, true)}; triple-click: ${actionLabel(launcherActions.triple, true)}` : `单击：${actionLabel(launcherActions.single, false)}；双击：${actionLabel(launcherActions.double, false)}；三击：${actionLabel(launcherActions.triple, false)}`;
    button.setAttribute("aria-label", `${button.title}${en ? "; drag to move" : "；拖动可调整位置"}`);
    stage.querySelector(".tip strong").textContent = en ? `Click · ${actionLabel(launcherActions.single, true)}` : `单击 · ${actionLabel(launcherActions.single, false)}`;
    stage.querySelector(".tip span").textContent = en ? `Double · ${actionLabel(launcherActions.double, true)}  Triple · ${actionLabel(launcherActions.triple, true)}` : `双击 · ${actionLabel(launcherActions.double, false)}  三击 · ${actionLabel(launcherActions.triple, false)}`;
    const labels = en ? { title: "Conversation Export", subtitle: "Save the current AI chat", custom: "Custom export", customHint: "Preview, select messages and choose a format", quick: "Quick export", visible: "Current webpage chat", pdf: "Print / PDF", text: "Plain text", image: "Long image", copy: "Copy full chat as Markdown", settings: "Gesture settings", help: "Help", feedback: "Feedback" } : { title: "对话导出", subtitle: "从当前 AI 网页整理与保存", custom: "自定义导出", customHint: "预览、筛选消息并选择格式", quick: "快速导出", visible: "当前网页对话", pdf: "打印 / PDF", text: "纯文本", image: "长图", copy: "复制完整对话 Markdown", settings: "手势设置", help: "使用说明", feedback: "反馈" };
    for (const node of exportCenter.querySelectorAll("[data-i18n]")) node.textContent = labels[node.dataset.i18n] || node.textContent;
  }
  const dimensions = () => {
    const maxWidth = Math.max(72, innerWidth);
    if (launcherStyle === "image") { const size = Math.min(launcherSize, maxWidth); return { width: size, height: size }; }
    const desiredWidth = Math.round(launcherSize * 16 / 9);
    if (desiredWidth <= maxWidth) return { width: desiredWidth, height: launcherSize };
    return { width: maxWidth, height: Math.round(maxWidth * 9 / 16) };
  };
  const hitDimensions = (size) => launcherStyle === "image"
    ? { left: Math.round(size.width * .14), top: Math.round(size.height * .06), width: Math.round(size.width * .72), height: Math.round(size.height * .9) }
    : { left: Math.round(size.width * .29), top: Math.round(size.height * .03), width: Math.round(size.width * .42), height: Math.round(size.height * .94) };

  function clamp(next) {
    const launcher = dimensions();
    const hit = hitDimensions(launcher), minX = launcherEdgeGap - hit.left, maxX = innerWidth - hit.left - hit.width - launcherEdgeGap, minY = launcherEdgeGap - hit.top, maxY = innerHeight - hit.top - hit.height - launcherEdgeGap;
    return { x: Math.round(Math.min(Math.max(minX, next.x), Math.max(minX, maxX))), y: Math.round(Math.min(Math.max(minY, next.y), Math.max(minY, maxY))) };
  }

  function snapToEdge(next) {
    const launcher = dimensions(), hit = hitDimensions(launcher), snapped = { ...clamp(next) };
    const left = snapped.x + hit.left, right = innerWidth - (left + hit.width), top = snapped.y + hit.top, bottom = innerHeight - (top + hit.height);
    if (left <= snapThreshold) snapped.x = launcherEdgeGap - hit.left;
    else if (right <= snapThreshold) snapped.x = innerWidth - hit.left - hit.width - launcherEdgeGap;
    if (top <= snapThreshold) snapped.y = launcherEdgeGap - hit.top;
    else if (bottom <= snapThreshold) snapped.y = innerHeight - hit.top - hit.height - launcherEdgeGap;
    return clamp(snapped);
  }

  function applyPosition(next) {
    const launcher = dimensions();
    const hit = hitDimensions(launcher);
    position = clamp(next || { x: innerWidth - hit.left - hit.width - launcherEdgeGap, y: Math.max(80, (innerHeight - launcher.height) / 2) });
    stage.style.left = `${position.x}px`; stage.style.top = `${position.y}px`; host.dataset.positionX = String(position.x); host.dataset.positionY = String(position.y);
    stage.classList.toggle("dock-left", position.x + hit.left + hit.width / 2 < innerWidth / 2);
    positionExportCenter();
  }

  function positionExportCenter() {
    if (exportCenter.hidden || !position) return;
    const launcher = dimensions(), hit = hitDimensions(launcher), panel = exportCenter.getBoundingClientRect();
    const petCenter = position.x + hit.left + hit.width / 2, leftSide = petCenter >= innerWidth / 2;
    let x = leftSide ? position.x + hit.left - panel.width - 10 : position.x + hit.left + hit.width + 10;
    let y = position.y + hit.top + hit.height / 2 - panel.height / 2;
    x = Math.max(10, Math.min(innerWidth - panel.width - 10, x)); y = Math.max(10, Math.min(innerHeight - panel.height - 10, y));
    exportCenter.style.left = `${Math.round(x)}px`; exportCenter.style.top = `${Math.round(y)}px`;
  }

  function applyAppearance(settings = {}) {
    launcherLocale = settings.locale === "en" ? "en" : "zh";
    const allowedActions = new Set(["sidepanel", "workspace", "export-center", "hide", "none"]);
    launcherActions = { single: allowedActions.has(settings.launcherSingleAction) ? settings.launcherSingleAction : "sidepanel", double: allowedActions.has(settings.launcherDoubleAction) ? settings.launcherDoubleAction : "workspace", triple: allowedActions.has(settings.launcherTripleAction) ? settings.launcherTripleAction : "export-center" }; applyText();
    launcherSize = Math.min(240, Math.max(96, Number(settings.launcherSize) || 160));
    launcherStyle = settings.launcherStyle === "image" ? "image" : "animated";
    launcherAnimationPack = settings.launcherAnimationPack === "basic" ? "basic" : "rich";
    launcherRandomFrequency = ["off", "low", "normal", "high"].includes(settings.launcherRandomFrequency) ? settings.launcherRandomFrequency : "normal";
    launcherEdgeGap = Math.min(32, Math.max(0, Number.isFinite(Number(settings.launcherEdgeGap)) ? Number(settings.launcherEdgeGap) : 4));
    launcherEdgeSnap = settings.launcherEdgeSnap !== false;
    const launcher = dimensions();
    const hit = hitDimensions(launcher); for (const [name, value] of Object.entries(hit)) launcherElementStyle(name, value);
    function launcherElementStyle(name, value) { stage.style.setProperty(`--hit-${name}`, `${value}px`); host.dataset[`hit${name[0].toUpperCase()}${name.slice(1)}`] = String(value); }
    stage.style.setProperty("--pet-width", `${launcher.width}px`); stage.style.setProperty("--pet-height", `${launcher.height}px`);
    host.dataset.launcherStyle = launcherStyle; host.dataset.launcherSize = String(launcherSize); host.dataset.animationPack = launcherAnimationPack; host.dataset.randomFrequency = launcherRandomFrequency; host.dataset.edgeGap = String(launcherEdgeGap); host.dataset.edgeSnap = String(launcherEdgeSnap); host.dataset.renderWidth = String(launcher.width); host.dataset.renderHeight = String(launcher.height);
    stage.classList.toggle("image-mode", launcherStyle === "image"); stage.classList.remove("fallback");
    if (launcherStyle === "image") { clearRandomAnimation(); video.pause(); } else if (!host.hidden && !document.hidden) { animationState = ""; playAnimation("idle"); scheduleRandomAnimation(); }
    applyPosition(position);
  }

  function showFallback() {
    stage.classList.add("fallback"); host.dataset.mediaReady = "false";
    clearRandomAnimation(); video.pause();
  }

  function pickAnimation(pool) {
    const candidates = pool.filter((url) => url !== lastPickedUrl), values = candidates.length ? candidates : pool;
    const selected = values[Math.floor(Math.random() * values.length)] || pool[0]; lastPickedUrl = selected || ""; return selected;
  }

  function clearRandomAnimation() {
    if (randomAnimationTimer) clearTimeout(randomAnimationTimer);
    randomAnimationTimer = 0; delete host.dataset.nextRandomDelay;
  }

  function scheduleRandomAnimation() {
    clearRandomAnimation();
    if (launcherStyle !== "animated" || launcherAnimationPack !== "rich" || launcherRandomFrequency === "off" || host.hidden || document.hidden) return;
    const ranges = { low: [60000, 120000], normal: [30000, 60000], high: [15000, 30000] }, [minimum, maximum] = ranges[launcherRandomFrequency] || ranges.normal;
    const delay = Math.round(minimum + Math.random() * (maximum - minimum)); host.dataset.nextRandomDelay = String(delay);
    randomAnimationTimer = setTimeout(() => {
      randomAnimationTimer = 0;
      if (!dragging && animationState === "idle" && !document.hidden && !host.hidden) playAnimation("ambient", pickAnimation(ambientAnimations));
      else scheduleRandomAnimation();
    }, delay);
  }

  function playAnimation(state, requestedUrl) {
    if (launcherStyle === "image") return;
    const nextUrl = requestedUrl || animationUrls[state]; if (!nextUrl) return;
    if (animationState === state && currentAnimationUrl === nextUrl) { if (video.paused && !host.hidden && !document.hidden) video.play().catch(showFallback); return; }
    if (state !== "idle") clearRandomAnimation();
    animationState = state; currentAnimationUrl = nextUrl; host.dataset.animationState = state; host.dataset.animationFile = nextUrl.split("/").pop() || ""; host.dataset.mediaReady = "false"; stage.classList.remove("fallback"); video.loop = state === "idle" || state === "drag"; video.src = nextUrl;
    const playback = video.play(); if (playback?.catch) playback.catch(showFallback);
  }

  function setEnabled(enabled) {
    host.hidden = !enabled;
    if (enabled && !document.hidden && launcherStyle === "animated") { playAnimation("idle"); scheduleRandomAnimation(); } else { clearRandomAnimation(); video.pause(); }
  }

  function openSidePanel() {
    chrome.runtime.sendMessage({ action: "TOGGLE_SIDE_PANEL" }, () => void chrome.runtime.lastError);
  }

  function openWorkspace() {
    chrome.runtime.sendMessage({ action: "OPEN_WORKSPACE" }, () => void chrome.runtime.lastError);
  }

  function toggleExportCenter(force) {
    exportCenter.hidden = typeof force === "boolean" ? !force : !exportCenter.hidden;
    if (!exportCenter.hidden) { exportCenter.querySelector(".export-status").textContent = launcherLocale === "en" ? "Choose an export method. The chat is read only after you choose." : "请选择导出方式；选择后才会读取当前对话。"; requestAnimationFrame(positionExportCenter); }
  }

  function executeLauncherAction(action) {
    playAnimation("click", launcherAnimationPack === "rich" ? pickAnimation(clickAnimations) : animationUrls.click);
    if (action === "sidepanel") openSidePanel();
    else if (action === "workspace") openWorkspace();
    else if (action === "export-center") toggleExportCenter();
    else if (action === "hide") setEnabled(false);
  }

  function queueActivation() {
    activationCount += 1;
    if (activationTimer) clearTimeout(activationTimer);
    if (activationCount >= 3) { activationCount = 0; activationTimer = 0; executeLauncherAction(launcherActions.triple); return; }
    activationTimer = setTimeout(() => { const count = activationCount; activationCount = 0; activationTimer = 0; executeLauncherAction(count === 2 ? launcherActions.double : launcherActions.single); }, 360);
  }

  function exportErrorMessage(reason) {
    const en = launcherLocale === "en";
    if (reason === "unsupported_page") return en ? "Open this center on a supported AI chat webpage." : "请在支持的 AI 对话网页中使用导出。";
    if (reason === "conversation_not_found") return en ? "No visible conversation was found. Open a chat and try again." : "未找到可见对话，请先打开具体对话后重试。";
    return en ? `Export failed: ${reason || "unknown error"}` : `导出失败：${reason || "未知错误"}`;
  }

  function runExport(format) {
    const status = exportCenter.querySelector(".export-status"); status.textContent = launcherLocale === "en" ? "Reading the current conversation…" : "正在读取当前网页对话…";
    chrome.runtime.sendMessage({ action: "START_CONVERSATION_EXPORT", format }, async (response) => {
      if (chrome.runtime.lastError || !response?.ok) { status.textContent = exportErrorMessage(response?.reason || chrome.runtime.lastError?.message); return; }
      if (format === "copy") { try { await navigator.clipboard.writeText(response.text || ""); status.textContent = launcherLocale === "en" ? "Conversation copied as Markdown." : "完整对话已复制为 Markdown。"; } catch { status.textContent = launcherLocale === "en" ? "Clipboard permission was denied." : "无法写入剪贴板，请使用自定义导出。"; } return; }
      status.textContent = launcherLocale === "en" ? "Export preview opened." : "已打开导出预览。";
    });
  }

  async function savePosition() {
    if (!position) return;
    await chrome.storage.local.set({ "maiw.launcherPosition": position });
  }

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = stage.getBoundingClientRect();
    dragging = { pointerX: event.clientX, pointerY: event.clientY, x: rect.left, y: rect.top };
    moved = false; button.setPointerCapture(event.pointerId); event.preventDefault();
  });
  button.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.pointerX, dy = event.clientY - dragging.pointerY;
    if (Math.hypot(dx, dy) > 6 && !moved) { moved = true; if (activationTimer) clearTimeout(activationTimer); activationCount = 0; clearRandomAnimation(); playAnimation("drag"); }
    if (moved) applyPosition({ x: dragging.x + dx, y: dragging.y + dy });
  });
  button.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = null; if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (moved) { if (launcherEdgeSnap) applyPosition(snapToEdge(position)); void savePosition(); playAnimation("idle"); scheduleRandomAnimation(); } else queueActivation();
  });
  button.addEventListener("pointercancel", () => { dragging = null; if (moved) { if (launcherEdgeSnap) applyPosition(snapToEdge(position)); void savePosition(); playAnimation("idle"); scheduleRandomAnimation(); } });
  button.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); executeLauncherAction(event.shiftKey ? launcherActions.double : launcherActions.single); } });
  exportCenter.addEventListener("click", (event) => {
    const exportButton = event.target.closest("button[data-export]"); if (exportButton) { runExport(exportButton.dataset.export); return; }
    const actionButton = event.target.closest("button[data-panel-action]"); if (!actionButton) return;
    if (actionButton.dataset.panelAction === "close") toggleExportCenter(false);
    else if (actionButton.dataset.panelAction === "theme") exportCenter.classList.toggle("dark");
    else if (actionButton.dataset.panelAction === "settings") chrome.runtime.sendMessage({ action: "OPEN_LAUNCHER_SETTINGS" }, () => void chrome.runtime.lastError);
    else if (actionButton.dataset.panelAction === "help") exportCenter.querySelector(".export-status").textContent = launcherLocale === "en" ? "Custom export opens a preview. Quick export reads the visible chat and starts the chosen format." : "自定义导出会先打开预览；快速导出会读取当前可见对话并启动所选格式。";
    else if (actionButton.dataset.panelAction === "feedback") window.open("https://github.com/joelovechen/multi-ai-workbench/issues", "_blank", "noopener");
  });
  window.addEventListener("resize", () => { applyPosition(position); void savePosition(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearRandomAnimation(); video.pause(); } else if (!host.hidden) { playAnimation("idle"); scheduleRandomAnimation(); } });
  video.addEventListener("ended", () => { if (animationState === "click" || animationState === "ambient") { playAnimation("idle"); scheduleRandomAnimation(); } });
  video.addEventListener("loadeddata", () => { host.dataset.mediaReady = "true"; });
  video.addEventListener("playing", () => { host.dataset.mediaPlaying = "true"; });
  video.addEventListener("pause", () => { host.dataset.mediaPlaying = "false"; });
  video.addEventListener("error", showFallback);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes["maiw.settings"]) { applyAppearance(changes["maiw.settings"].newValue || {}); setEnabled(changes["maiw.settings"].newValue?.launcherEnabled !== false); }
    if (changes["maiw.launcherPosition"]) applyPosition(changes["maiw.launcherPosition"].newValue || null);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.action !== "REMOVE_FLOATING_LAUNCHER") return;
    clearRandomAnimation(); video.pause(); host.remove();
  });

  chrome.storage.local.get(["maiw.settings", "maiw.launcherPosition"]).then((stored) => {
    applyAppearance(stored["maiw.settings"] || {}); applyPosition(stored["maiw.launcherPosition"] || null); setEnabled(stored["maiw.settings"]?.launcherEnabled !== false);
  });
})();
