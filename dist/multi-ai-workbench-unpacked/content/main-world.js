(function initMultiAIMainWorldBridge() {
  "use strict";
  if (globalThis.__multiAiMainWorldReady) return;
  globalThis.__multiAiMainWorldReady = true;

  function queryDeep(selector, root = document) {
    const found = [];
    const visit = (scope) => {
      try { found.push(...scope.querySelectorAll(selector)); } catch { return; }
      let elements = [];
      try { elements = scope.querySelectorAll("*"); } catch { return; }
      for (const element of elements) if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(root); return found;
  }
  function first(selectors) { for (const selector of selectors || []) { const value = queryDeep(selector)[0]; if (value) return value; } return null; }
  function bestFileInput(selectors) {
    const values = []; for (const selector of selectors || []) values.push(...queryDeep(selector));
    return [...new Set(values)].filter((element) => element instanceof HTMLInputElement && element.type === "file").sort((left, right) => score(right) - score(left))[0] || null;
    function score(input) { const description = `${input.accept || ""} ${input.outerHTML || ""}`; if (/avatar|头像|profile/i.test(description)) return -100; return Number(input.multiple) * 8 + Number(/image|pdf|text|doc|sheet|\*/i.test(input.accept || "")) * 5; }
  }
  function setValue(element, value) {
    element.focus();
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: value }));
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    } else {
      element.textContent = "";
      try { document.execCommand("insertText", false, value); } catch { element.textContent = value; }
      if (!String(element.textContent || "").trim()) element.textContent = value;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
  function toFiles(attachments) {
    const transfer = new DataTransfer();
    for (const item of attachments || []) {
      const bytes = Uint8Array.from(atob(item.data || ""), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], item.name, { type: item.type || "application/octet-stream" }));
    }
    return transfer;
  }
  function respond(id, result) { document.dispatchEvent(new CustomEvent("maiw:main-response", { detail: { id, ...result } })); }

  document.addEventListener("maiw:main-request", (event) => {
    const request = event.detail || {}, id = request.id;
    if (!id) return;
    try {
      if (request.action === "PING") return respond(id, { ok: true });
      if (request.action === "SET_INPUT") {
        const input = first(request.selectors); if (!input) return respond(id, { ok: false, reason: "input_not_found" });
        setValue(input, String(request.value || "")); return respond(id, { ok: true });
      }
      if (request.action === "ASSIGN_FILES") {
        const input = bestFileInput(request.selectors); if (!input) return respond(id, { ok: false, reason: "file_input_not_found" });
        const transfer = toFiles(request.attachments); input.files = transfer.files;
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true })); input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return respond(id, { ok: input.files?.length === transfer.files.length, assigned: input.files?.length || 0 });
      }
      respond(id, { ok: false, reason: "unknown_action" });
    } catch (error) { respond(id, { ok: false, reason: "main_world_error", detail: error.message }); }
  }, true);
})();
