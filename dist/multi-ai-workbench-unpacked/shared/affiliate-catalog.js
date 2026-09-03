(function initAffiliateCatalog(global) {
  "use strict";

  const CACHE_KEY = "maiw.affiliateCatalog.cache";
  const PREF_KEY = "maiw.affiliateCatalog.preferences";
  const CHECK_THROTTLE = 60_000;
  const CLICK_FRESHNESS = 5 * 60_000;
  const OFFLINE_MAX_AGE = 24 * 60 * 60_000;
  const SOURCES = [
    { id: "cloudflare", base: "https://multi-ai-workbench-catalog.pages.dev/affiliate-catalog/" },
    { id: "github", base: "https://joelovechen.github.io/multi-ai-workbench/affiliate-catalog/" }
  ];
  const copy = {
    zh: {
      title: "AI 工具精选", entry: "AI 工具精选", sponsored: "推广", subtitle: "发现适合编程、创作和办公的 AI 工具",
      disclosure: "部分链接为推广链接。你通过这些链接注册或付费时，开发者可能获得佣金，但不会增加你的购买价格。推荐工具由第三方独立提供。",
      search: "搜索 AI 工具…", all: "全部", empty: "暂时没有可用的推广工具。", unavailable: "推荐目录暂时不可用，请稍后重试。",
      loading: "正在更新推荐目录…", refreshed: "目录已更新", cached: "当前显示缓存内容", copyCode: "复制", copied: "已复制", close: "关闭",
      refresh: "刷新", privacy: "隐私政策", hide: "隐藏推荐入口", featured: "精选", openFailed: "链接校验失败，请刷新后重试。"
    },
    en: {
      title: "Featured AI Tools", entry: "Featured AI Tools", sponsored: "Sponsored", subtitle: "Discover AI tools for coding, creativity, and productivity",
      disclosure: "Some links are affiliate links. The developer may earn a commission if you register or purchase through them, at no additional cost to you. Recommended tools are independently provided by third parties.",
      search: "Search AI tools…", all: "All", empty: "No sponsored tools are currently available.", unavailable: "Recommendations are temporarily unavailable. Please try again later.",
      loading: "Updating recommendations…", refreshed: "Catalog updated", cached: "Showing cached content", copyCode: "Copy", copied: "Copied", close: "Close",
      refresh: "Refresh", privacy: "Privacy Policy", hide: "Hide recommendations", featured: "Featured", openFailed: "The link could not be verified. Refresh and try again."
    }
  };

  const runtime = { catalog: null, sourceBase: "", lastCheckedAt: 0, lastError: "", listeners: new Set() };
  const localeOf = (value) => value === "en" ? "en" : "zh";
  const remoteLocale = (value) => localeOf(value) === "en" ? "en" : "zh-CN";
  const bytesFromBase64 = (value) => Uint8Array.from(atob(String(value).trim()), (character) => character.charCodeAt(0));
  const digest = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const semver = (value) => String(value || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  function versionAtLeast(current, minimum) { const a = semver(current), b = semver(minimum); for (let index = 0; index < 3; index += 1) { if ((a[index] || 0) > (b[index] || 0)) return true; if ((a[index] || 0) < (b[index] || 0)) return false; } return true; }
  function activeAt(row, now = Date.now()) { return (!row.startsAt || Date.parse(row.startsAt) <= now) && (!row.endsAt || Date.parse(row.endsAt) > now); }
  function safeAsset(path) { return typeof path === "string" && /^icons\/[a-z0-9/_.-]+\.(?:svg|png|webp)$/i.test(path) && !path.includes(".."); }
  function safeUrl(value) { try { const url = new URL(value); return url.protocol === "https:" ? url.href : ""; } catch { return ""; } }
  function localized(row, locale) { return row?.i18n?.[remoteLocale(locale)] || row?.i18n?.en || {}; }
  function toolUrl(tool, locale) { return safeUrl(tool?.affiliate?.localizedUrls?.[remoteLocale(locale)] || tool?.affiliate?.defaultUrl); }
  function visibleTools(catalog, category = "all", query = "", locale = "zh") {
    const needle = query.trim().toLocaleLowerCase();
    return (catalog?.tools || []).filter((tool) => tool.status === "active" && tool.visible && activeAt(tool) && toolUrl(tool, locale))
      .filter((tool) => category === "all" || tool.categoryIds?.includes(category))
      .filter((tool) => { const text = localized(tool, locale); return !needle || `${text.name || ""} ${text.description || ""}`.toLocaleLowerCase().includes(needle); })
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort - b.sort || a.id.localeCompare(b.id));
  }
  function validateCatalog(catalog) {
    if (!catalog || catalog.schemaVersion !== 1 || !Number.isInteger(catalog.catalogVersion) || catalog.catalogVersion < 1 || !catalog.supportedLocales?.includes("zh-CN") || !catalog.supportedLocales?.includes("en")) return false;
    if (!versionAtLeast(chrome.runtime.getManifest().version, catalog.minExtensionVersion) || Date.parse(catalog.expiresAt) <= Date.now()) return false;
    const categories = new Set();
    for (const category of catalog.categories || []) { if (!/^[a-z0-9-]+$/.test(category.id) || categories.has(category.id) || !safeAsset(category.icon) || !localized(category, "zh").name || !localized(category, "en").name) return false; categories.add(category.id); }
    const tools = new Set();
    for (const tool of catalog.tools || []) { if (!/^[a-z0-9-]+$/.test(tool.id) || tools.has(tool.id) || !["draft", "active", "inactive"].includes(tool.status) || !safeAsset(tool.icon) || !tool.categoryIds?.every((id) => categories.has(id)) || !localized(tool, "zh").name || !localized(tool, "en").name) return false; if (tool.status === "active" && tool.visible && !toolUrl(tool, "zh")) return false; tools.add(tool.id); }
    return true;
  }
  async function verifyPayload(payload, signature) {
    if (!global.MultiAIAffiliatePublicKey) return false;
    try {
      const key = await crypto.subtle.importKey("spki", bytesFromBase64(global.MultiAIAffiliatePublicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytesFromBase64(signature), new TextEncoder().encode(payload));
    } catch { return false; }
  }
  async function fetchSource(source) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4500), bucket = Math.floor(Date.now() / CHECK_THROTTLE);
    try {
      const [catalogResponse, signatureResponse] = await Promise.all([
        fetch(`${source.base}catalog.json?v=${bucket}`, { cache: "no-store", signal: controller.signal }),
        fetch(`${source.base}catalog.sig?v=${bucket}`, { cache: "no-store", signal: controller.signal })
      ]);
      if (!catalogResponse.ok || !signatureResponse.ok) throw new Error(`http_${catalogResponse.status}_${signatureResponse.status}`);
      const payload = await catalogResponse.text(), signature = await signatureResponse.text();
      if (!await verifyPayload(payload, signature)) throw new Error("invalid_signature");
      const catalog = JSON.parse(payload);
      if (!validateCatalog(catalog)) throw new Error("invalid_catalog");
      return { catalog, payloadHash: await digest(payload), sourceBase: source.base, sourceId: source.id };
    } finally { clearTimeout(timer); }
  }
  async function cached() {
    const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
    if (!stored?.catalog || !validateCatalog(stored.catalog) || Date.now() - Number(stored.checkedAt || 0) > OFFLINE_MAX_AGE) return null;
    return stored;
  }
  async function refresh(force = false) {
    if (!force && Date.now() - runtime.lastCheckedAt < CHECK_THROTTLE && runtime.catalog) return { catalog: runtime.catalog, sourceBase: runtime.sourceBase, cached: true };
    runtime.lastCheckedAt = Date.now();
    const results = (await Promise.allSettled(SOURCES.map(fetchSource))).filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (results.length) {
      const highest = Math.max(...results.map((result) => result.catalog.catalogVersion));
      const candidates = results.filter((result) => result.catalog.catalogVersion === highest);
      if (new Set(candidates.map((result) => result.payloadHash)).size > 1) throw new Error("source_version_conflict");
      const existing = await cached(), historicalVersion = Math.max(Number(existing?.highestVersion || 0), Number(existing?.catalog?.catalogVersion || 0));
      if (highest < historicalVersion) throw new Error("catalog_rollback_blocked");
      const selected = candidates.find((result) => result.sourceId === "cloudflare") || candidates[0];
      const record = { catalog: selected.catalog, sourceBase: selected.sourceBase, payloadHash: selected.payloadHash, checkedAt: Date.now(), highestVersion: highest };
      await chrome.storage.local.set({ [CACHE_KEY]: record }); runtime.catalog = record.catalog; runtime.sourceBase = record.sourceBase; runtime.lastError = ""; return { ...record, cached: false };
    }
    const fallback = await cached();
    if (!fallback) throw new Error("catalog_unavailable");
    runtime.catalog = fallback.catalog; runtime.sourceBase = fallback.sourceBase; runtime.lastError = "catalog_unavailable"; return { ...fallback, cached: true };
  }
  function assetUrl(path, base = runtime.sourceBase) { return safeAsset(path) && /^https:\/\//.test(base) ? new URL(path, base).href : ""; }

  function mount(options) {
    const button = options.button;
    if (!button) throw new Error("affiliate_entry_missing");
    let locale = localeOf(options.locale), category = "all", query = "", layer = null;
    const t = () => copy[locale];
    function labelEntry() { button.title = `${t().entry} · ${t().sponsored}`; button.setAttribute("aria-label", button.title); const label = button.querySelector("[data-affiliate-label]"); if (label) label.textContent = t().entry; const badge = button.querySelector("[data-affiliate-badge]"); if (badge) badge.textContent = t().sponsored; }
    async function syncVisibility() { const prefs = (await chrome.storage.local.get(PREF_KEY))[PREF_KEY] || {}; button.hidden = prefs.showEntry === false; }
    function close() { layer?.remove(); layer = null; button.focus(); }
    function renderCards() {
      if (!layer) return;
      const grid = layer.querySelector(".maiw-affiliate-grid"), empty = layer.querySelector(".maiw-affiliate-empty"); grid.replaceChildren();
      const tools = visibleTools(runtime.catalog, category, query, locale); empty.hidden = tools.length > 0; empty.textContent = runtime.catalog ? t().empty : t().unavailable;
      for (const tool of tools) {
        const text = localized(tool, locale), card = document.createElement("article"); card.className = "maiw-affiliate-card";
        const icon = document.createElement("img"); icon.className = "maiw-affiliate-icon"; icon.alt = ""; icon.src = assetUrl(tool.icon); icon.onerror = () => { icon.hidden = true; card.classList.add("icon-failed"); };
        const body = document.createElement("div"); body.className = "maiw-affiliate-body"; const heading = document.createElement("h3"); heading.textContent = text.name; const description = document.createElement("p"); description.textContent = text.description;
        const meta = document.createElement("div"); meta.className = "maiw-affiliate-meta"; const sponsored = document.createElement("span"); sponsored.textContent = t().sponsored; meta.append(sponsored); if (tool.featured) { const featured = document.createElement("span"); featured.textContent = t().featured; meta.append(featured); }
        body.append(heading, description, meta);
        if (tool.affiliate?.showInviteCode && tool.affiliate.inviteCode) { const code = document.createElement("div"); code.className = "maiw-affiliate-code"; const value = document.createElement("code"); value.textContent = `${text.inviteCodeLabel || ""}: ${tool.affiliate.inviteCode}`; const copyButton = document.createElement("button"); copyButton.type = "button"; copyButton.textContent = t().copyCode; copyButton.onclick = async () => { await navigator.clipboard.writeText(tool.affiliate.inviteCode); copyButton.textContent = t().copied; setTimeout(() => { copyButton.textContent = t().copyCode; }, 1200); }; code.append(value, copyButton); body.append(code); }
        const open = document.createElement("button"); open.type = "button"; open.className = "maiw-affiliate-open"; open.textContent = text.buttonText; open.onclick = async () => { open.disabled = true; try { if (Date.now() - runtime.lastCheckedAt > CLICK_FRESHNESS) await refresh(true); const current = visibleTools(runtime.catalog, "all", "", locale).find((row) => row.id === tool.id), url = toolUrl(current, locale); if (!url) throw new Error("inactive"); await chrome.tabs.create({ url, active: true }); } catch { layer.querySelector(".maiw-affiliate-status").textContent = t().openFailed; } finally { open.disabled = false; } }; body.append(open); card.append(icon, body); grid.append(card);
      }
    }
    function renderFilters() {
      if (!layer) return; const holder = layer.querySelector(".maiw-affiliate-categories"); holder.replaceChildren();
      const rows = [{ id: "all", i18n: { "zh-CN": { name: t().all }, en: { name: t().all } } }, ...(runtime.catalog?.categories || []).filter((row) => row.visible).sort((a, b) => a.sort - b.sort)];
      for (const row of rows) { const item = document.createElement("button"); item.type = "button"; item.classList.toggle("active", row.id === category); item.textContent = localized(row, locale).name; item.onclick = () => { category = row.id; renderFilters(); renderCards(); }; holder.append(item); }
    }
    function renderShell() {
      if (!layer) return; layer.querySelector("h2").textContent = t().title; layer.querySelector(".maiw-affiliate-sponsored").textContent = t().sponsored; layer.querySelector(".maiw-affiliate-subtitle").textContent = t().subtitle; layer.querySelector(".maiw-affiliate-disclosure").textContent = t().disclosure; layer.querySelector("input").placeholder = t().search; layer.querySelector("[data-action=refresh]").title = t().refresh; layer.querySelector("[data-action=close]").title = t().close; layer.querySelector("[data-action=privacy]").textContent = t().privacy; layer.querySelector("[data-action=hide]").textContent = t().hide; renderFilters(); renderCards();
    }
    async function open() {
      if (layer) return; layer = document.createElement("div"); layer.className = `maiw-affiliate-layer${options.compact ? " compact" : ""}`; layer.setAttribute("role", "dialog"); layer.setAttribute("aria-modal", "true");
      layer.innerHTML = '<section class="maiw-affiliate-dialog"><header><div><div class="maiw-affiliate-title"><h2></h2><span class="maiw-affiliate-sponsored"></span></div><p class="maiw-affiliate-subtitle"></p></div><div class="maiw-affiliate-head-actions"><button type="button" data-action="refresh" aria-label="Refresh">↻</button><button type="button" data-action="close" aria-label="Close">×</button></div></header><p class="maiw-affiliate-disclosure"></p><input class="maiw-affiliate-search" type="search"><nav class="maiw-affiliate-categories"></nav><div class="maiw-affiliate-status" role="status"></div><div class="maiw-affiliate-grid"></div><p class="maiw-affiliate-empty"></p><footer><button type="button" data-action="privacy"></button><button type="button" data-action="hide"></button></footer></section>';
      layer.onclick = (event) => { if (event.target === layer) close(); }; layer.querySelector("[data-action=close]").onclick = close; layer.querySelector("[data-action=privacy]").onclick = () => global.MultiAIPrivacyUI?.openPrivacy(locale); layer.querySelector("[data-action=hide]").onclick = async () => { await chrome.storage.local.set({ [PREF_KEY]: { showEntry: false } }); await syncVisibility(); close(); };
      layer.querySelector("input").oninput = (event) => { query = event.target.value; renderCards(); }; layer.querySelector("[data-action=refresh]").onclick = () => update(true); document.body.append(layer); renderShell(); layer.querySelector("input").focus();
      const cachedRecord = await cached(); if (cachedRecord) { runtime.catalog = cachedRecord.catalog; runtime.sourceBase = cachedRecord.sourceBase; renderShell(); layer.querySelector(".maiw-affiliate-status").textContent = t().cached; }
      await update(false);
    }
    async function update(force) { if (!layer) return; const status = layer.querySelector(".maiw-affiliate-status"); status.textContent = t().loading; try { const result = await refresh(force); renderShell(); status.textContent = result.cached ? t().cached : t().refreshed; } catch { runtime.catalog = null; renderShell(); status.textContent = t().unavailable; } }
    function onKey(event) { if (event.key === "Escape" && layer) close(); }
    button.addEventListener("click", open); addEventListener("keydown", onKey); labelEntry(); void syncVisibility();
    return { setLocale(value) { locale = localeOf(value); labelEntry(); renderShell(); }, syncVisibility, destroy() { close(); button.removeEventListener("click", open); removeEventListener("keydown", onKey); } };
  }

  global.MultiAIAffiliateCatalog = Object.freeze({ mount, refresh, validateCatalog, visibleTools, localized, toolUrl, assetUrl, sources: SOURCES });
})(globalThis);
