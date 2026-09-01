(function initFloatingLauncher() {
  "use strict";

  if (window.top !== window || document.getElementById("multi-ai-floating-launcher-host")) return;

  const host = document.createElement("div");
  host.id = "multi-ai-floating-launcher-host";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    button{--pet-width:284px;--pet-height:160px;position:fixed;z-index:2147483646;width:var(--pet-width);height:var(--pet-height);padding:0;border:0;border-radius:24px;display:grid;place-items:center;background:transparent;color:#172033;font:600 12px/1.3 system-ui,"Microsoft YaHei",sans-serif;filter:drop-shadow(0 10px 14px rgba(15,23,42,.28));cursor:grab;user-select:none;touch-action:none;transition:filter .18s ease,transform .18s ease}
    .pet-media{grid-area:1/1;width:var(--pet-width);height:var(--pet-height);display:block;object-fit:contain;pointer-events:none;-webkit-user-drag:none;transition:transform .18s ease}.pet-fallback{opacity:0}.fallback .pet-video,.image-mode .pet-video{display:none}.fallback .pet-fallback,.image-mode .pet-fallback{opacity:1}.tip{position:absolute;right:calc(var(--pet-width) - 10px);top:50%;width:max-content;max-width:190px;padding:8px 10px;border:1px solid rgba(148,163,184,.35);border-radius:10px;background:rgba(15,23,42,.9);color:#fff;box-shadow:0 8px 24px rgba(15,23,42,.2);opacity:0;transform:translate(6px,-50%);pointer-events:none;transition:.18s ease}.tip strong,.tip span{display:block}.tip span{margin-top:2px;color:#cbd5e1;font-size:11px}
    button:hover{transform:scale(1.06);filter:drop-shadow(0 13px 18px rgba(79,70,229,.34))}button:hover .pet-media{transform:translateY(-2px)}button:hover .tip,button:focus-visible .tip{opacity:1;transform:translate(0,-50%)}
    button:active{cursor:grabbing;transform:scale(.98)}
    button:focus-visible{outline:3px solid rgba(79,70,229,.38);outline-offset:3px}
    @media(max-width:640px){.tip{display:none}}
  `;
  const button = document.createElement("button");
  const animationUrls = {
    idle: chrome.runtime.getURL("assets/pet/pet-idle.webm"),
    click: chrome.runtime.getURL("assets/pet/pet-click.webm"),
    drag: chrome.runtime.getURL("assets/pet/pet-drag.webm")
  };
  const clickAnimations = ["pet-click.webm", "pet-click-happy.webm", "pet-click-shy.webm", "pet-click-laugh.webm", "pet-click-angry.webm"].map((name) => chrome.runtime.getURL(`assets/pet/${name}`));
  const ambientAnimations = ["pet-random-look.webm", "pet-random-yawn.webm", "pet-random-stretch.webm", "pet-random-cube.webm", "pet-random-code.webm", "pet-random-snack.webm", "pet-random-hum.webm", "pet-random-dance.webm", "pet-random-think.webm"].map((name) => chrome.runtime.getURL(`assets/pet/${name}`));
  const fallbackUrl = chrome.runtime.getURL("assets/launcher-pet.png");
  button.type = "button"; button.innerHTML = `<video class="pet-media pet-video" autoplay loop muted playsinline preload="auto" aria-hidden="true"></video><img class="pet-media pet-fallback" src="${fallbackUrl}" alt=""><span class="tip"><strong>单击打开侧栏</strong><span>双击打开全屏 · 拖动移动位置</span></span>`; button.title = "单击打开侧栏，双击打开全屏"; button.setAttribute("aria-label", "多AI提问助手桌宠：单击打开侧栏，双击打开全屏，拖动可调整位置");
  shadow.append(style, button); document.documentElement.append(host);

  const video = button.querySelector(".pet-video");
  let dragging = null;
  let moved = false;
  let position = null;
  let lastClickAt = 0;
  let animationState = "";
  let currentAnimationUrl = "";
  let launcherSize = 160;
  let launcherStyle = "animated";
  let launcherAnimationPack = "rich";
  let launcherRandomFrequency = "normal";
  let randomAnimationTimer = 0;
  let lastPickedUrl = "";
  const margin = 12;
  const dimensions = () => {
    const maxWidth = Math.max(72, innerWidth - margin * 2);
    if (launcherStyle === "image") { const size = Math.min(launcherSize, maxWidth); return { width: size, height: size }; }
    const desiredWidth = Math.round(launcherSize * 16 / 9);
    if (desiredWidth <= maxWidth) return { width: desiredWidth, height: launcherSize };
    return { width: maxWidth, height: Math.round(maxWidth * 9 / 16) };
  };

  function clamp(next) {
    const launcher = dimensions();
    return { x: Math.round(Math.min(Math.max(margin, next.x), Math.max(margin, innerWidth - launcher.width - margin))), y: Math.round(Math.min(Math.max(margin, next.y), Math.max(margin, innerHeight - launcher.height - margin))) };
  }

  function applyPosition(next) {
    const launcher = dimensions();
    position = clamp(next || { x: innerWidth - launcher.width - margin, y: Math.max(80, (innerHeight - launcher.height) / 2) });
    button.style.left = `${position.x}px`; button.style.top = `${position.y}px`;
  }

  function applyAppearance(settings = {}) {
    launcherSize = Math.min(240, Math.max(96, Number(settings.launcherSize) || 160));
    launcherStyle = settings.launcherStyle === "image" ? "image" : "animated";
    launcherAnimationPack = settings.launcherAnimationPack === "basic" ? "basic" : "rich";
    launcherRandomFrequency = ["off", "low", "normal", "high"].includes(settings.launcherRandomFrequency) ? settings.launcherRandomFrequency : "normal";
    const launcher = dimensions();
    button.style.setProperty("--pet-width", `${launcher.width}px`); button.style.setProperty("--pet-height", `${launcher.height}px`);
    host.dataset.launcherStyle = launcherStyle; host.dataset.launcherSize = String(launcherSize); host.dataset.animationPack = launcherAnimationPack; host.dataset.randomFrequency = launcherRandomFrequency; host.dataset.renderWidth = String(launcher.width); host.dataset.renderHeight = String(launcher.height);
    button.classList.toggle("image-mode", launcherStyle === "image"); button.classList.remove("fallback");
    if (launcherStyle === "image") { clearRandomAnimation(); video.pause(); } else if (!host.hidden && !document.hidden) { animationState = ""; playAnimation("idle"); scheduleRandomAnimation(); }
    applyPosition(position);
  }

  function showFallback() {
    button.classList.add("fallback"); host.dataset.mediaReady = "false";
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
    animationState = state; currentAnimationUrl = nextUrl; host.dataset.animationState = state; host.dataset.animationFile = nextUrl.split("/").pop() || ""; host.dataset.mediaReady = "false"; button.classList.remove("fallback"); video.loop = state === "idle" || state === "drag"; video.src = nextUrl;
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

  function handleSingleActivation() {
    const now = Date.now();
    if (now - lastClickAt > 360) { playAnimation("click", launcherAnimationPack === "rich" ? pickAnimation(clickAnimations) : animationUrls.click); openSidePanel(); }
    lastClickAt = now;
  }

  async function savePosition() {
    if (!position) return;
    await chrome.storage.local.set({ "maiw.launcherPosition": position });
  }

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = button.getBoundingClientRect();
    dragging = { pointerX: event.clientX, pointerY: event.clientY, x: rect.left, y: rect.top };
    moved = false; button.setPointerCapture(event.pointerId); event.preventDefault();
  });
  button.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.pointerX, dy = event.clientY - dragging.pointerY;
    if (Math.hypot(dx, dy) > 5 && !moved) { moved = true; clearRandomAnimation(); playAnimation("drag"); }
    if (moved) applyPosition({ x: dragging.x + dx, y: dragging.y + dy });
  });
  button.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = null; if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (moved) { void savePosition(); playAnimation("idle"); scheduleRandomAnimation(); } else handleSingleActivation();
  });
  button.addEventListener("pointercancel", () => { dragging = null; if (moved) { void savePosition(); playAnimation("idle"); scheduleRandomAnimation(); } });
  button.addEventListener("dblclick", (event) => { event.preventDefault(); lastClickAt = 0; playAnimation("click", launcherAnimationPack === "rich" ? pickAnimation(clickAnimations) : animationUrls.click); openWorkspace(); });
  button.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.shiftKey ? openWorkspace() : openSidePanel(); } });
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
