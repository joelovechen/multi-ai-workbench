(function initMultiAIPageBridge() {
  "use strict";

  const registry = globalThis.MultiAIServiceRegistry;
  const service = registry?.fromUrl(location.href);
  if (!service) return;

  function callMainWorld(action, payload = {}, timeout = 3000) {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const listener = (event) => { if (event.detail?.id !== id) return; document.removeEventListener("maiw:main-response", listener, true); clearTimeout(timer); resolve(event.detail); };
      const timer = setTimeout(() => { document.removeEventListener("maiw:main-response", listener, true); resolve({ ok: false, reason: "main_world_timeout" }); }, timeout);
      document.addEventListener("maiw:main-response", listener, true);
      document.dispatchEvent(new CustomEvent("maiw:main-request", { detail: { id, action, ...payload } }));
    });
  }

  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  function querySelectorAllDeep(selector, root = document) {
    const matches = [];
    const visit = (scope) => {
      try { matches.push(...scope.querySelectorAll(selector)); }
      catch { return; }
      let elements = [];
      try { elements = scope.querySelectorAll("*"); } catch { return; }
      for (const element of elements) if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(root); return matches;
  }

  function findFirst(selectors) {
    for (const selector of selectors || []) {
      const match = querySelectorAllDeep(selector).find(visible);
      if (match) return match;
    }
    return null;
  }
  function findFirstAny(selectors) { for (const selector of selectors || []) { const match = querySelectorAllDeep(selector)[0]; if (match) return match; } return null; }
  function findAll(selectors, onlyVisible = true) {
    const found = new Set();
    for (const selector of selectors || []) {
      try { for (const element of querySelectorAllDeep(selector)) if (!onlyVisible || visible(element)) found.add(element); }
      catch { /* 单个失效选择器不应中断其他候选 */ }
    }
    return [...found];
  }
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const normalizedText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  async function waitFor(check, timeout = 10000, interval = 250) {
    const deadline = Date.now() + timeout;
    let lastValue;
    while (Date.now() < deadline) {
      lastValue = check();
      if (lastValue) return lastValue;
      await sleep(interval);
    }
    return null;
  }

  async function setInputValue(element, value) {
    const mainResult = await callMainWorld("SET_INPUT", { selectors: service.inputSelectors, value });
    if (mainResult.ok) return mainResult;
    element.focus();
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: value }));
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    } else {
      element.textContent = "";
      try { document.execCommand("insertText", false, value); }
      catch { element.textContent = value; }
      if (!normalizedText(element.textContent)) element.textContent = value;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return { ok: true, fallback: "isolated-world" };
  }

  function attachmentSnapshot() {
    return findAll(service.attachmentEvidenceSelectors).map((element) => normalizedText(`${element.textContent || ""} ${element.getAttribute("src") || ""} ${element.getAttribute("aria-label") || ""}`)).filter(Boolean);
  }

  function findBestFileInput() {
    const candidates = findAll(service.fileSelectors, false).filter((element) => element instanceof HTMLInputElement && element.type === "file");
    return candidates.sort((left, right) => {
      const score = (input) => {
        const description = `${input.accept || ""} ${input.outerHTML || ""}`;
        if (/avatar|头像|profile/i.test(description)) return -100;
        return Number(input.multiple) * 8 + Number(/image|pdf|text|doc|sheet|\*/i.test(input.accept || "")) * 5 + Number(Boolean(input.closest("form,[class*='composer' i],[class*='input' i]"))) * 3;
      };
      return score(right) - score(left);
    })[0] || null;
  }

  async function attachFiles(attachments) {
    if (!attachments?.length) return { ok: true, attached: 0, confirmed: true };
    let input = findBestFileInput();
    if (!input && service.attachmentStrategy === "auto-discovery") {
      const trigger = findFirst(service.attachmentTriggerSelectors) || findAll(["button", "[role='button']"]).find((element) => /上传|附件|文件|图片|相册|photo|image|upload|file|attach|添加|更多|\+/i.test(normalizedText(`${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`)));
      if (trigger) { trigger.click(); input = await waitFor(findBestFileInput, 3000, 150); }
    }
    const transfer = new DataTransfer();
    for (const item of attachments) {
      const bytes = Uint8Array.from(atob(item.data || ""), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.type || "application/octet-stream" }));
    }
    const before = attachmentSnapshot();
    if (input instanceof HTMLInputElement) {
      const mainResult = await callMainWorld("ASSIGN_FILES", { selectors: service.fileSelectors, attachments }, 5000);
      try { if (!mainResult.ok) input.files = transfer.files; }
      catch (error) { return { ok: false, attached: 0, reason: "file_assignment_failed", detail: error.message }; }
      if (!mainResult.ok) { input.dispatchEvent(new Event("input", { bubbles: true, composed: true })); input.dispatchEvent(new Event("change", { bubbles: true, composed: true })); }
    } else if (service.attachmentStrategy === "auto-discovery") {
      const target = findFirst(service.inputSelectors) || document.activeElement;
      if (!(target instanceof HTMLElement)) return { ok: false, attached: 0, reason: "file_input_not_found" };
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
      target.dispatchEvent(paste);
    } else return { ok: false, attached: 0, reason: "file_input_not_found" };

    const containsDocument = attachments.some((item) => !String(item.type || "").startsWith("image/"));
    if (containsDocument && input instanceof HTMLInputElement && input.files?.length === attachments.length) {
      await sleep(700);
      const explicitError = findAll(service.uploadErrorSelectors).find((element) => /失败|错误|重试|failed|error|retry/i.test(normalizedText(element.textContent || element.getAttribute("aria-label"))));
      if (!explicitError) return { ok: true, confirmed: true, attached: attachments.length, evidence: "document-input-handoff" };
    }
    let busyObserved = false;
    const result = await waitFor(() => {
      const error = findAll(service.uploadErrorSelectors).find((element) => /失败|错误|重试|failed|error|retry/i.test(normalizedText(element.textContent || element.getAttribute("aria-label"))));
      if (error) return { ok: false, reason: "upload_failed", detail: normalizedText(error.textContent || error.getAttribute("aria-label")) };
      const busy = findAll(service.uploadBusySelectors).length > 0;
      busyObserved ||= busy;
      const after = attachmentSnapshot();
      const namesSeen = attachments.filter((item) => normalizedText(document.body.innerText).includes(item.name)).length;
      const evidenceIncrease = after.length >= before.length + attachments.length || namesSeen === attachments.length;
      if (evidenceIncrease && !busy) return { ok: true, confirmed: true, attached: attachments.length, evidence: namesSeen === attachments.length ? "filenames" : "preview-count" };
      if (busyObserved && !busy && after.length > before.length) return { ok: true, confirmed: true, attached: Math.min(attachments.length, after.length - before.length), evidence: "upload-finished" };
      return null;
    }, service.uploadTimeout, 300);
    return result || { ok: false, confirmed: false, attached: 0, reason: "upload_unconfirmed" };
  }

  function clickMode(answerMode) {
    const control = service.modeControl;
    if (!control) return { supported: false, changed: false };
    const labels = control.type === "toggle" ? control.labels : control[answerMode];
    if (!labels.length) return { supported: false };
    const candidates = [...document.querySelectorAll("button,[role='button']")].filter(visible);
    const button = candidates.find((element) => labels.some((label) => `${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`.includes(label)));
    if (!button) return { supported: true, changed: false };
    const pressed = button.getAttribute("aria-pressed") === "true" || button.dataset.state === "on" || button.classList.contains("active");
    const shouldClick = control.type === "choice" ? !pressed : (answerMode === "expert" ? !pressed : pressed);
    if (shouldClick) button.click();
    return { supported: true, changed: shouldClick, selected: shouldClick || pressed };
  }

  function questionEvidenceCount(question) {
    const needle = normalizedText(question).slice(0, 180);
    if (!needle) return 0;
    return findAll(service.messageSelectors).filter((element) => normalizedText(element.textContent).includes(needle)).length;
  }

  async function confirmQuestion(question, baseline, timeout) {
    const initialUrl = location.href;
    return waitFor(() => {
      const count = questionEvidenceCount(question);
      if (count > baseline) return { confirmed: true, evidence: "user-message", count };
      if (location.href !== initialUrl && count > 0) return { confirmed: true, evidence: "navigation-and-message", count };
      return null;
    }, timeout, 350);
  }

  async function sendPrompt(message) {
    const input = findFirst(service.inputSelectors);
    if (!input) return { ok: false, reason: "input_not_found" };
    const mode = clickMode(message.answerMode);
    const baseline = questionEvidenceCount(message.question);
    await setInputValue(input, message.question);
    const attachmentResult = await attachFiles(message.attachments);
    if (message.attachments?.length && (!attachmentResult.ok || attachmentResult.attached !== message.attachments.length)) return { ok: false, reason: attachmentResult.reason || "attachment_incomplete", mode, ...attachmentResult };
    let previousOffset = 0;
    for (const offset of service.sendRetryOffsets || [0, 1200, 3000]) {
      await sleep(Math.max(0, offset - previousOffset)); previousOffset = offset;
      const alreadyConfirmed = await confirmQuestion(message.question, baseline, 150);
      if (alreadyConfirmed) return { ok: true, stage: "confirmed", mode, ...attachmentResult, ...alreadyConfirmed };
      const send = findFirst(service.sendSelectors);
      const inputText = normalizedText(input.textContent || input.value);
      if (send && !send.matches(":disabled,[aria-disabled='true']")) send.click();
      else if (inputText) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      } else break;
      const confirmation = await confirmQuestion(message.question, baseline, Math.min(2200, service.confirmTimeout));
      if (confirmation) return { ok: true, stage: "confirmed", mode, ...attachmentResult, ...confirmation };
    }
    const finalConfirmation = await confirmQuestion(message.question, baseline, service.confirmTimeout);
    if (finalConfirmation) return { ok: true, stage: "confirmed", mode, ...attachmentResult, ...finalConfirmation };
    const inputText = normalizedText(input.textContent || input.value);
    return { ok: false, stage: inputText ? "filled" : "unconfirmed", reason: inputText ? "manual_confirmation_required" : "send_confirmation_timeout", needsConfirmation: true, mode, ...attachmentResult };
  }

  async function startNewChat() {
    const beforeUrl = location.href;
    const beforeMessages = findAll(service.messageSelectors).length;
    const trigger = findFirst(service.newChatSelectors);
    if (!trigger) return { ok: false, reason: "new_chat_control_not_found", fallbackUrl: service.home };
    trigger.click();
    const result = await waitFor(() => {
      const input = findFirst(service.inputSelectors);
      const messages = findAll(service.messageSelectors).length;
      if (input && (location.href !== beforeUrl || messages < beforeMessages || beforeMessages === 0)) return { ok: true, stage: "new_chat_confirmed", url: location.href };
      return null;
    }, 8000, 300);
    return result || { ok: false, reason: "new_chat_unconfirmed", fallbackUrl: service.home };
  }

  function locateQuestion(question) {
    if (!question) return { ok: false, reason: "empty_question" };
    const needle = question.trim().slice(0, 100);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) { return node.nodeValue?.includes(needle) && visible(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
    });
    const node = walker.nextNode();
    if (!node?.parentElement) return { ok: false, reason: "question_not_found" };
    node.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });
    const old = node.parentElement.style.outline;
    node.parentElement.style.outline = "3px solid #4f46e5";
    setTimeout(() => { node.parentElement.style.outline = old; }, 1800);
    return { ok: true };
  }

  let pickerEnabled = false;
  let pickerTarget = null;
  const pickedElements = new Map();
  let dragStart = null, dragBox = null, suppressPickerClick = false;
  function pickerMove(event) {
    if (!pickerEnabled || !(event.target instanceof HTMLElement)) return;
    if (pickerTarget && !pickerTarget.dataset.multiAiPickerId) pickerTarget.style.removeProperty("outline");
    pickerTarget = event.target;
    pickerTarget.style.setProperty("outline", "2px solid #0891b2", "important");
  }
  function pickerClick(event) {
    if (!pickerEnabled || !(event.target instanceof HTMLElement)) return;
    if (suppressPickerClick) { suppressPickerClick = false; event.preventDefault(); event.stopPropagation(); return; }
    event.preventDefault(); event.stopPropagation();
    const target = event.target;
    const rect = target.getBoundingClientRect();
    const existingId = target.dataset.multiAiPickerId;
    if (existingId && pickedElements.has(existingId)) {
      const selected = pickedElements.get(existingId); pickedElements.delete(existingId);
      for (const element of Array.isArray(selected) ? selected : [selected]) { delete element.dataset.multiAiPickerId; element.style.removeProperty("outline"); }
      chrome.runtime.sendMessage({ action: "PICKER_RESULT", service: service.key, selected: false, item: { id: existingId } }).catch(() => {});
      return;
    }
    const id = crypto.randomUUID(); target.dataset.multiAiPickerId = id; pickedElements.set(id, target);
    target.style.setProperty("outline", "3px solid #0891b2", "important");
    chrome.runtime.sendMessage({ action: "PICKER_RESULT", service: service.key, selected: true, item: { id, text: target.innerText || target.textContent || "", html: target.outerHTML, url: location.href, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } }).catch(() => {});
  }
  function pickerPointerDown(event) {
    if (!pickerEnabled || !event.shiftKey) return;
    event.preventDefault(); dragStart = { x: event.clientX, y: event.clientY };
    dragBox = document.createElement("div"); dragBox.style.cssText = "position:fixed;z-index:2147483646;border:2px dashed #0891b2;background:#0891b222;pointer-events:none"; document.documentElement.append(dragBox);
  }
  function pickerPointerMove(event) {
    if (!dragStart || !dragBox) return;
    const left = Math.min(dragStart.x, event.clientX), top = Math.min(dragStart.y, event.clientY), width = Math.abs(event.clientX - dragStart.x), height = Math.abs(event.clientY - dragStart.y);
    Object.assign(dragBox.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }
  function pickerPointerUp(event) {
    if (!dragStart || !dragBox) return;
    const left = Math.min(dragStart.x, event.clientX), top = Math.min(dragStart.y, event.clientY), right = Math.max(dragStart.x, event.clientX), bottom = Math.max(dragStart.y, event.clientY);
    dragBox.remove(); dragBox = null; dragStart = null; suppressPickerClick = true;
    const candidates = [...document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,pre,blockquote,ul,ol,table,article,[role='article']")].filter((element) => { const rect = element.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2; return visible(element) && cx >= left && cx <= right && cy >= top && cy <= bottom; }).slice(0, 30);
    if (!candidates.length) return;
    const id = crypto.randomUUID();
    for (const candidate of candidates) { candidate.dataset.multiAiPickerId = id; candidate.style.setProperty("outline", "3px solid #0891b2", "important"); }
    pickedElements.set(id, candidates);
    chrome.runtime.sendMessage({ action: "PICKER_RESULT", service: service.key, selected: true, item: { id, text: candidates.map((row) => row.innerText || row.textContent || "").join("\n\n"), html: candidates.map((row) => row.outerHTML).join("\n"), url: location.href, rect: { x: left, y: top, width: right - left, height: bottom - top } } }).catch(() => {});
  }
  function setPicker(enabled) {
    pickerEnabled = enabled;
    if (!enabled && pickerTarget && !pickerTarget.dataset.multiAiPickerId) pickerTarget.style.removeProperty("outline");
    pickerTarget = null;
    document.removeEventListener("mousemove", pickerMove, true);
    document.removeEventListener("click", pickerClick, true);
    document.removeEventListener("pointerdown", pickerPointerDown, true); document.removeEventListener("pointermove", pickerPointerMove, true); document.removeEventListener("pointerup", pickerPointerUp, true);
    if (enabled) {
      document.addEventListener("mousemove", pickerMove, true);
      document.addEventListener("click", pickerClick, true);
      document.addEventListener("pointerdown", pickerPointerDown, true); document.addEventListener("pointermove", pickerPointerMove, true); document.addEventListener("pointerup", pickerPointerUp, true);
    }
    return { ok: true, enabled };
  }

  let highlightEnabled = false;
  let highlightToolbar = null;
  function styleMark(mark, style, color) {
    mark.style.background = style === "marker" ? color : "transparent";
    mark.style.textDecoration = style === "wavy" ? `underline wavy ${color} 2px` : style === "underline" ? `underline solid ${color} 2px` : "none";
    mark.style.textDecorationSkipInk = "none";
  }
  function pageToast(message) { const toast = document.createElement("div"); toast.textContent = message; toast.style.cssText = "position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);padding:8px 12px;background:#18202f;color:#fff;border-radius:8px;font:13px system-ui"; document.documentElement.append(toast); setTimeout(() => toast.remove(), 2400); }
  async function updateHighlightRow(id, patch) { const key = "maiw.highlights", stored = await chrome.storage.local.get(key), rows = stored[key] || [], row = rows.find((item) => item.id === id); if (row) Object.assign(row, patch); await chrome.storage.local.set({ [key]: rows }); return row; }
  function renderNoteBadge(mark, row) {
    document.querySelector(`[data-multi-ai-note-id="${CSS.escape(row.id)}"]`)?.remove();
    if (!row.note || row.noteHidden) return;
    const badge = document.createElement("aside"); badge.dataset.multiAiNoteId = row.id; const rect = mark.getBoundingClientRect(), position = row.notePosition || { x: rect.right + scrollX + 8, y: rect.top + scrollY };
    badge.style.cssText = `position:absolute;z-index:2147483645;left:${position.x}px;top:${position.y}px;max-width:260px;padding:8px;background:#fffbeb;color:#713f12;border:1px solid #facc15;border-radius:8px;box-shadow:0 4px 16px #0003;font:13px/1.4 system-ui;cursor:move`;
    const text = document.createElement("span"); text.textContent = row.note; const hide = document.createElement("button"); hide.textContent = "隐藏"; hide.style.marginLeft = "8px"; hide.addEventListener("click", async (event) => { event.stopPropagation(); await updateHighlightRow(row.id, { noteHidden: true }); badge.remove(); }); const remove = document.createElement("button"); remove.textContent = "删除笔记"; remove.addEventListener("click", async (event) => { event.stopPropagation(); mark.title = ""; await updateHighlightRow(row.id, { note: "", noteHidden: false }); badge.remove(); }); badge.append(text, hide, remove);
    badge.addEventListener("pointerdown", (event) => { if (event.target instanceof HTMLButtonElement) return; const startX = event.clientX, startY = event.clientY, left = badge.offsetLeft, top = badge.offsetTop; const move = (moveEvent) => { badge.style.left = `${left + moveEvent.clientX - startX}px`; badge.style.top = `${top + moveEvent.clientY - startY}px`; }; const end = async () => { removeEventListener("pointermove", move); removeEventListener("pointerup", end); await updateHighlightRow(row.id, { notePosition: { x: badge.offsetLeft, y: badge.offsetTop } }); }; addEventListener("pointermove", move); addEventListener("pointerup", end, { once: true }); });
    document.body.append(badge);
  }
  async function persistHighlight(mark, text, style, color, note = "") {
    const key = "maiw.highlights", stored = await chrome.storage.local.get(key), rows = Array.isArray(stored[key]) ? stored[key] : [];
    const id = mark.dataset.multiAiHighlightId || crypto.randomUUID(); mark.dataset.multiAiHighlightId = id; mark.dataset.multiAiHighlight = "true"; mark.title = note;
    const existing = rows.find((row) => row.id === id);
    const parentText = mark.parentElement?.textContent || "", textIndex = parentText.indexOf(text), contextBefore = textIndex >= 0 ? parentText.slice(Math.max(0, textIndex - 48), textIndex) : "", contextAfter = textIndex >= 0 ? parentText.slice(textIndex + text.length, textIndex + text.length + 48) : "";
    const data = { id, service: service.key, url: location.href, text, contextBefore, contextAfter, style, color, note, noteHidden: existing?.noteHidden || false, notePosition: existing?.notePosition || null, createdAt: existing?.createdAt || Date.now() };
    if (!existing && text.trim().length < 2 && contextBefore.length + contextAfter.length < 8) { pageToast("划线过短且上下文不足，刷新后将丢失"); renderNoteBadge(mark, data); return data; }
    if (!existing && rows.length >= 1000) { pageToast("本地划线已达上限，无法保存更多"); return data; }
    if (existing) Object.assign(existing, data); else rows.push(data);
    await chrome.storage.local.set({ [key]: rows.slice(-1000) });
    renderNoteBadge(mark, data); return data;
  }
  async function deleteHighlight(mark) {
    const id = mark.dataset.multiAiHighlightId, key = "maiw.highlights", stored = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: (stored[key] || []).filter((row) => row.id !== id) });
    document.querySelector(`[data-multi-ai-note-id="${CSS.escape(id)}"]`)?.remove();
    mark.replaceWith(...mark.childNodes);
  }
  function closeHighlightToolbar() { highlightToolbar?.remove(); highlightToolbar = null; }
  function wrapRange(range, mark) {
    try { range.surroundContents(mark); return true; }
    catch {
      try { const fragment = range.extractContents(); mark.append(fragment); range.insertNode(mark); return true; }
      catch { return false; }
    }
  }
  function showHighlightToolbar(range, existingMark = null) {
    closeHighlightToolbar();
    const toolbar = document.createElement("div"); highlightToolbar = toolbar;
    toolbar.setAttribute("role", "toolbar"); toolbar.style.cssText = "position:fixed;z-index:2147483647;display:flex;gap:4px;padding:6px;background:#18202f;color:#fff;border-radius:9px;box-shadow:0 5px 20px #0005;font:12px system-ui;";
    const rect = (existingMark || range).getBoundingClientRect(); toolbar.style.left = `${Math.max(8, Math.min(innerWidth - 340, rect.left))}px`; toolbar.style.top = `${Math.max(8, rect.top - 45)}px`;
    const actions = [["复制", "copy"], ["马克笔", "marker"], ["波浪线", "wavy"], ["直线", "underline"], ["写想法", "note"], ["显隐笔记", "note-toggle"], ["删除", "clear"]];
    for (const [label, action] of actions) { const button = document.createElement("button"); button.textContent = label; button.style.cssText = "border:0;border-radius:5px;padding:4px 6px;cursor:pointer"; button.addEventListener("click", async (event) => { event.stopPropagation(); const text = existingMark?.textContent || range.toString(); if (action === "copy") await navigator.clipboard.writeText(text); else if (action === "clear") { if (existingMark) await deleteHighlight(existingMark); } else if (action === "note-toggle" && existingMark) { const row = await updateHighlightRow(existingMark.dataset.multiAiHighlightId, {}); if (row) { row.noteHidden = !row.noteHidden; await updateHighlightRow(row.id, { noteHidden: row.noteHidden }); renderNoteBadge(existingMark, row); } } else { let mark = existingMark; if (!mark) { mark = document.createElement("mark"); if (!wrapRange(range, mark)) { pageToast("当前页面结构无法完成划线"); closeHighlightToolbar(); return; } } const style = action === "note" ? (mark.dataset.highlightStyle || "marker") : action; const color = mark.dataset.highlightColor || "#fde047"; const note = action === "note" ? (prompt("输入笔记", mark.title || "") ?? mark.title ?? "") : (mark.title || ""); mark.dataset.highlightStyle = style; mark.dataset.highlightColor = color; styleMark(mark, style, color); await persistHighlight(mark, text, style, color, note); } closeHighlightToolbar(); getSelection()?.removeAllRanges(); }); toolbar.append(button); }
    for (const color of ["#fde047", "#86efac", "#93c5fd", "#f9a8d4"]) { const button = document.createElement("button"); button.title = "选择划线颜色"; button.style.cssText = `width:18px;height:18px;border:1px solid #fff;border-radius:50%;background:${color};cursor:pointer`; button.addEventListener("click", async () => { let mark = existingMark; const text = existingMark?.textContent || range.toString(); if (!mark) { mark = document.createElement("mark"); if (!wrapRange(range, mark)) { pageToast("当前页面结构无法完成划线"); return; } } const style = mark.dataset.highlightStyle || "marker"; mark.dataset.highlightStyle = style; mark.dataset.highlightColor = color; styleMark(mark, style, color); await persistHighlight(mark, text, style, color, mark.title || ""); closeHighlightToolbar(); }); toolbar.append(button); }
    document.documentElement.append(toolbar);
  }
  function saveHighlight(event) {
    if (!highlightEnabled) return;
    const existing = event.target instanceof Element ? event.target.closest("mark[data-multi-ai-highlight]") : null;
    if (existing) { showHighlightToolbar(existing.getBoundingClientRect(), existing); return; }
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const text = selection.toString().trim();
    if (!text) return;
    showHighlightToolbar(selection.getRangeAt(0).cloneRange());
  }
  function setHighlight(enabled) {
    highlightEnabled = enabled;
    document.removeEventListener("mouseup", saveHighlight, true);
    if (enabled) document.addEventListener("mouseup", saveHighlight, true);
    return { ok: true, enabled };
  }

  function applyAppearance(theme) {
    document.documentElement.dataset.multiAiTheme = theme;
    document.documentElement.style.colorScheme = theme;
    let style = document.getElementById("multi-ai-embed-style");
    if (!style) { style = document.createElement("style"); style.id = "multi-ai-embed-style"; (document.head || document.documentElement).append(style); }
    style.textContent = theme === "dark" ? "html,body{color-scheme:dark!important}::-webkit-scrollbar{width:7px;height:7px}::-webkit-scrollbar-thumb{background:#64748b;border-radius:9px}body>aside:not([data-multi-ai-note-id]),[class*='sidebar'][class*='desktop']{max-width:48px!important;overflow:hidden!important}" : "::-webkit-scrollbar{width:7px;height:7px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:9px}body>aside:not([data-multi-ai-note-id]),[class*='sidebar'][class*='desktop']{max-width:48px!important;overflow:hidden!important}";
    return { ok: true, theme };
  }

  async function restoreHighlights() {
    const stored = await chrome.storage.local.get("maiw.highlights");
    const rows = (stored["maiw.highlights"] || []).filter((row) => row.service === service.key && row.url === location.href);
    for (const row of rows) {
      const nodes = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode(node) { return node.parentElement?.closest("mark[data-multi-ai-highlight],script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
      let node, text = "";
      while ((node = walker.nextNode())) { nodes.push({ node, start: text.length, end: text.length + (node.nodeValue || "").length }); text += node.nodeValue || ""; }
      const anchor = `${row.contextBefore || ""}${row.text}${row.contextAfter || ""}`;
      const anchorIndex = anchor ? text.indexOf(anchor) : -1;
      const start = anchorIndex >= 0 ? anchorIndex + (row.contextBefore || "").length : text.indexOf(row.text);
      if (start < 0) continue;
      const end = start + row.text.length, startEntry = nodes.find((entry) => start >= entry.start && start < entry.end), endEntry = nodes.find((entry) => end > entry.start && end <= entry.end);
      if (!startEntry || !endEntry) continue;
      const range = document.createRange(); range.setStart(startEntry.node, start - startEntry.start); range.setEnd(endEntry.node, end - endEntry.start);
      const mark = document.createElement("mark"); mark.dataset.multiAiHighlight = "true"; mark.dataset.multiAiHighlightId = row.id; mark.dataset.highlightStyle = row.style || "marker"; mark.dataset.highlightColor = row.color || "#fde047"; if (row.note) mark.title = row.note; styleMark(mark, row.style || "marker", row.color || "#fde047");
      if (wrapRange(range, mark)) renderNoteBadge(mark, row);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.service && message.service !== service.key) return false;
    if (message?.action === "SEND_PROMPT") { sendPrompt(message).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message })); return true; }
    if (message?.action === "NEW_CHAT") { startNewChat().then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message, fallbackUrl: service.home })); return true; }
    if (message?.action === "LOCATE_QUESTION") { sendResponse(locateQuestion(message.question)); return false; }
    if (message?.action === "PICKER_MODE") { sendResponse(setPicker(Boolean(message.enabled))); return false; }
    if (message?.action === "HIGHLIGHT_MODE") { sendResponse(setHighlight(Boolean(message.enabled))); return false; }
    if (message?.action === "SET_APPEARANCE") { sendResponse(applyAppearance(message.theme === "dark" ? "dark" : "light")); return false; }
    return false;
  });
  async function handleSidePanelCommand(message) {
    if (message.action === "SEND_PROMPT") return sendPrompt(message);
    if (message.action === "NEW_CHAT") return startNewChat();
    if (message.action === "LOCATE_QUESTION") return locateQuestion(message.question);
    if (message.action === "SET_APPEARANCE") return applyAppearance(message.theme === "dark" ? "dark" : "light");
    return { ok: false, reason: "unknown_sidepanel_action" };
  }
  const extensionOrigin = new URL(chrome.runtime.getURL("/")).origin;
  addEventListener("message", (event) => {
    const message = event.data;
    if (window.parent === window || event.source !== window.parent || event.origin !== extensionOrigin || message?.source !== "multi-ai-sidepanel" || message.service !== service.key || typeof message.requestId !== "string") return;
    handleSidePanelCommand(message).then((result) => window.parent.postMessage({ source: "multi-ai-sidepanel-result", requestId: message.requestId, service: service.key, result }, extensionOrigin)).catch((error) => window.parent.postMessage({ source: "multi-ai-sidepanel-result", requestId: message.requestId, service: service.key, result: { ok: false, reason: error.message } }, extensionOrigin));
  });
  const announceSidePanelReady = () => { if (window.parent !== window) window.parent.postMessage({ source: "multi-ai-sidepanel-ready", service: service.key }, extensionOrigin); };
  announceSidePanelReady(); setTimeout(announceSidePanelReady, 600); setTimeout(announceSidePanelReady, 1800);
  setTimeout(() => restoreHighlights().catch(() => {}), 1200);
  let lastReportedUrl = location.href;
  const reportNavigation = () => {
    if (location.href === lastReportedUrl) return;
    lastReportedUrl = location.href;
  };
  setInterval(reportNavigation, 750);
  addEventListener("popstate", reportNavigation);
  addEventListener("hashchange", reportNavigation);
  chrome.storage.local.get("maiw.settings").then((stored) => applyAppearance(stored["maiw.settings"]?.theme === "dark" ? "dark" : "light"));
  function hasExplicitLoginEvidence() {
    if (/\/(login|signin|sign-in|passport)(\/|$)/i.test(location.pathname)) return true;
    const authInput = findFirst(["input[type='password']", "input[autocomplete='one-time-code']", "input[placeholder*='手机号']", "input[placeholder*='手机号码']"]);
    if (authInput) return true;
    const loginLabels = new Set(["登录", "立即登录", "扫码登录", "手机号登录", "sign in", "log in"]);
    const visibleLoginActions = [...document.querySelectorAll("button,[role='button'],a")].filter((node) => {
      const rect = node.getBoundingClientRect(), text = (node.textContent || "").trim().toLowerCase();
      return rect.width > 0 && rect.height > 0 && loginLabels.has(text);
    });
    return visibleLoginActions.length >= 2;
  }
  const reportPlatformReady = () => chrome.runtime.sendMessage({ action: "PLATFORM_READY", service: service.key, url: location.href }).catch(() => {});
  setTimeout(async () => {
    const ready = await waitFor(() => findFirst(service.inputSelectors), 16000, 500);
    if (ready) { reportPlatformReady(); return; }
    if (service.kind === "ai" && hasExplicitLoginEvidence()) chrome.runtime.sendMessage({ action: "PLATFORM_NEEDS_LOGIN", service: service.key, url: location.href, reason: "explicit_login_page" }).catch(() => {});
    const lateReady = await waitFor(() => findFirst(service.inputSelectors), 30000, 1000);
    if (lateReady) reportPlatformReady();
  }, 1500);
})();
