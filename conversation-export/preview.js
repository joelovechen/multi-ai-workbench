(function initConversationPreview() {
  "use strict";
  const core = globalThis.MultiAIConversationExport;
  const params = new URLSearchParams(location.search);
  const jobId = params.get("job") || "";
  const locale = chrome.i18n?.getUILanguage?.().toLowerCase().startsWith("zh") ? "zh" : "en";
  const $ = (selector) => document.querySelector(selector);
  const state = { conversation: null, selected: new Set(), autoFormat: params.get("auto") === "1" ? params.get("format") : "" };
  const words = locale === "zh" ? {
    title: "对话导出", loading: "正在读取当前对话…", noJob: "导出任务不存在或已过期。请返回 AI 页面重新打开导出中心。", copied: "已复制 Markdown。", downloaded: "文件已保存。", selected: "条消息已选择", partial: "当前平台按网页可见内容抓取，长对话可能只包含已经加载的消息。", empty: "没有可导出的消息。", fileTitle: "文件标题", choose: "选择消息", all: "全选", start: "起始消息", end: "结束消息", apply: "应用范围", search: "搜索对话", searchPlaceholder: "输入关键词筛选", metadata: "包含平台、来源和导出时间", thinking: "包含思考过程", preview: "预览", close: "关闭", copy: "复制 Markdown", plain: "TXT", image: "长图", print: "打印 / PDF"
  } : { title: "Conversation Export", loading: "Loading the current conversation…", noJob: "This export job is missing or expired. Open the export center again from the AI page.", copied: "Markdown copied.", downloaded: "File saved.", selected: "messages selected", partial: "This platform is extracted from the visible page. Long chats may include only loaded messages.", empty: "There are no messages to export.", fileTitle: "File title", choose: "Select messages", all: "Select all", start: "Start message", end: "End message", apply: "Apply range", search: "Search conversation", searchPlaceholder: "Filter by keyword", metadata: "Include platform, source, and export time", thinking: "Include reasoning", preview: "Preview", close: "Close", copy: "Copy Markdown", plain: "TXT", image: "Long image", print: "Print / PDF" };

  function setStatus(message, error = false) { const node = $("#status"); node.textContent = message; node.style.color = error ? "#dc2626" : ""; }
  function selectedConversation() { state.conversation.title = $("#titleInput").value.trim() || state.conversation.title; return core.selectedConversation(state.conversation, state.selected); }
  function options() { return { includeMetadata: $("#includeMetadata").checked, includeThinking: $("#includeThinking").checked, userLabel: locale === "zh" ? "用户" : "User", assistantLabel: locale === "zh" ? "助手" : "Assistant" }; }
  function saveBlob(content, mime, extension) { const blob = content instanceof Blob ? content : new Blob([content], { type: mime }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${core.sanitizeFilename(state.conversation.title)}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1500); setStatus(words.downloaded); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
  function plainMessage(message) { return message.contents.map((content) => content.content || content.alt || content.name || (content.sources || []).map((row) => `${row.title} ${row.url}`).join("\n")).filter(Boolean).join("\n\n"); }
  function updateSelection() { const total = state.conversation.messages.length; $("#selectionCount").textContent = `${state.selected.size} / ${total}`; $("#selectAll").checked = state.selected.size === total; document.querySelectorAll(".message input").forEach((input) => { input.checked = state.selected.has(input.value); }); }
  function render() {
    const messages = $("#messages"); messages.textContent = "";
    const search = $("#searchInput").value.trim().toLowerCase();
    state.conversation.messages.forEach((message, index) => {
      const article = document.createElement("article"); article.className = `message ${message.role}`; article.dataset.id = message.id;
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = message.id; checkbox.checked = state.selected.has(message.id); checkbox.addEventListener("change", () => { checkbox.checked ? state.selected.add(message.id) : state.selected.delete(message.id); updateSelection(); });
      const head = document.createElement("div"); head.className = "message-head"; const role = document.createElement("strong"); role.textContent = message.role === "user" ? (locale === "zh" ? "用户" : "User") : (message.model || state.conversation.platformName); const number = document.createElement("small"); number.textContent = `#${index + 1}`; head.append(role, number);
      const body = document.createElement("div"); body.className = "message-body"; body.textContent = plainMessage(message); article.hidden = Boolean(search && !body.textContent.toLowerCase().includes(search)); article.append(checkbox, head, body); messages.append(article);
    });
    updateSelection();
  }
  function fillRange() { const start = $("#rangeStart"), end = $("#rangeEnd"); start.textContent = ""; end.textContent = ""; state.conversation.messages.forEach((message, index) => { for (const select of [start, end]) { const option = document.createElement("option"); option.value = String(index); option.textContent = `${index + 1}. ${plainMessage(message).slice(0, 34)}`; select.append(option); } }); end.value = String(Math.max(0, state.conversation.messages.length - 1)); }
  async function exportAs(format) {
    const data = selectedConversation(); if (!data.messages.length) { setStatus(words.empty, true); return; }
    if (format === "copy") { await navigator.clipboard.writeText(core.markdownFromConversation(data, options())); setStatus(words.copied); return; }
    if (format === "markdown") return saveBlob(core.markdownFromConversation(data, options()), "text/markdown;charset=utf-8", "md");
    if (format === "text") return saveBlob(core.textFromConversation(data, options()), "text/plain;charset=utf-8", "txt");
    if (format === "json") return saveBlob(core.jsonFromConversation(data), "application/json;charset=utf-8", "json");
    if (format === "pdf") { window.print(); return; }
    if (format === "word") { const body = core.textFromConversation(data, options()).split("\n").map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`).join(""); return saveBlob(`<!doctype html><html><meta charset="utf-8"><body><h1>${escapeHtml(data.title)}</h1>${body}</body></html>`, "application/msword;charset=utf-8", "doc"); }
    if (format === "image") return exportImage(core.textFromConversation(data, options()));
  }
  function exportImage(text) { const lines = []; const width = 1080, padding = 64, maxChars = 52; for (const raw of text.split("\n")) { if (!raw) lines.push(""); else for (let i = 0; i < raw.length; i += maxChars) lines.push(raw.slice(i, i + maxChars)); } const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = Math.min(30000, Math.max(360, padding * 2 + lines.length * 34)); const context = canvas.getContext("2d"); context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#172033"; context.font = '22px system-ui,"Microsoft YaHei",sans-serif'; lines.slice(0, Math.floor((canvas.height - padding * 2) / 34)).forEach((line, index) => context.fillText(line, padding, padding + 28 + index * 34, width - padding * 2)); canvas.toBlob((blob) => blob && saveBlob(blob, "image/png", "png"), "image/png"); }
  async function initialize() {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; $("#pageTitle").textContent = words.title; document.title = words.title;
    for (const [selector, key] of [["#titleLabel", "fileTitle"], ["#selectLabel", "choose"], ["#selectAllLabel", "all"], ["#rangeStartLabel", "start"], ["#rangeEndLabel", "end"], ["#applyRange", "apply"], ["#searchLabel", "search"], ["#metadataLabel", "metadata"], ["#thinkingLabel", "thinking"], ["#previewLabel", "preview"], ["#closeButton", "close"]]) $(selector).textContent = words[key];
    $("#searchInput").placeholder = words.searchPlaceholder; const formatLabels = { copy: words.copy, text: words.plain, image: words.image, pdf: words.print }; for (const [format, label] of Object.entries(formatLabels)) document.querySelector(`[data-format="${format}"]`).textContent = label;
    if (!jobId) throw new Error(words.noJob);
    const key = `maiw.conversationExportJob.${jobId}`, stored = await chrome.storage.session.get(key), job = stored[key]; if (!job?.conversation) throw new Error(words.noJob);
    state.conversation = core.normalizeConversation(job.conversation); state.selected = new Set(state.conversation.messages.map((message) => message.id));
    $("#titleInput").value = state.conversation.title; $("#sourceLabel").textContent = `${state.conversation.platformName} · ${state.conversation.messages.length} ${words.selected}`; $("#meta").textContent = state.conversation.sourceUrl;
    const warnings = [...state.conversation.warnings]; if (state.conversation.completeness !== "complete") warnings.unshift(words.partial); if (warnings.length) { $("#warningCard").hidden = false; $("#warningCard").textContent = [...new Set(warnings)].join(" "); }
    fillRange(); render(); setStatus(""); if (state.autoFormat) setTimeout(() => exportAs(state.autoFormat).catch((error) => setStatus(error.message, true)), 250);
  }
  $("#selectAll").addEventListener("change", (event) => { state.selected = event.target.checked ? new Set(state.conversation.messages.map((message) => message.id)) : new Set(); updateSelection(); });
  $("#applyRange").addEventListener("click", () => { const from = Math.min(Number($("#rangeStart").value), Number($("#rangeEnd").value)), to = Math.max(Number($("#rangeStart").value), Number($("#rangeEnd").value)); state.selected = new Set(state.conversation.messages.slice(from, to + 1).map((message) => message.id)); updateSelection(); });
  $("#searchInput").addEventListener("input", render); document.querySelector(".export-bar").addEventListener("click", (event) => { const button = event.target.closest("button[data-format]"); if (button) exportAs(button.dataset.format).catch((error) => setStatus(error.message, true)); });
  $("#themeButton").addEventListener("click", () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }); $("#closeButton").addEventListener("click", () => close());
  initialize().catch((error) => { $("#sourceLabel").textContent = error.message; setStatus(error.message, true); });
})();
