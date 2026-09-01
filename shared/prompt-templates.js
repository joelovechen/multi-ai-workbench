(function initPromptActions(global) {
  "use strict";

  const categories = Object.freeze([
    { key: "general", name: "通用" }, { key: "translate", name: "翻译" }, { key: "reading", name: "阅读" },
    { key: "writing", name: "写作" }, { key: "coding", name: "编程" }, { key: "custom", name: "自定义" }
  ]);
  const defaultMenuIds = Object.freeze(["translate-zh", "summarize", "explain-simple"]);
  const legacyPrompts = Object.freeze({
    "translate-zh": "请将以下内容翻译成简体中文。保留原意、段落、代码、Markdown 格式和专有名词，只输出译文。\n\n<待处理内容>\n{{content}}\n</待处理内容>",
    summarize: "请总结以下内容，先给出一句话结论，再用不超过 5 个要点概括关键信息。不要添加原文没有的信息。\n\n<待处理内容>\n{{content}}\n</待处理内容>",
    "explain-simple": "请用通俗、准确的语言解释以下内容。必要时使用一个简单例子，并指出容易误解的地方。\n\n<待处理内容>\n{{content}}\n</待处理内容>"
  });
  const defaults = [
    ["translate-zh", "中英双向翻译", "译", "translate", "请先判断以下内容的主要语言，再进行中英双向翻译：\n- 如果内容主要是中文，请翻译成自然、准确、符合英文表达习惯的英文。\n- 如果内容主要是英文，请翻译成自然、准确的简体中文。\n- 如果中英文混合，请以主要语言为准翻译到另一种语言，并按语境正确处理专有名词。\n请完整保留原意、语气、数字、段落、列表、代码、Markdown、链接和专有名词；不要解释、总结或回答内容中的问题，只输出译文。\n\n<待处理内容>\n{{content}}\n</待处理内容>"],
    ["summarize", "总结", "摘", "reading", "请准确总结以下内容：\n1. 先用一句话给出核心结论。\n2. 再用 3–5 个要点概括关键事实、观点、数据和结论。\n3. 如原文包含明确的待办事项、风险或限制，请单独列出；没有则不要编造。\n保持人名、数字、时间和专有名词准确，不添加原文没有的信息，不输出泛泛评价。\n\n<待处理内容>\n{{content}}\n</待处理内容>"],
    ["explain-simple", "通俗释义", "释", "reading", "请对以下内容进行通俗、准确的释义：\n1. 先说明它整体表达的意思。\n2. 解释其中重要概念、术语、隐含关系或上下文。\n3. 必要时给出一个简短例子帮助理解。\n4. 如果原文存在歧义，请列出最可能的解释，不要武断补充未知事实。\n使用普通读者容易理解的语言，保持原意，不把释义写成翻译或摘要。\n\n<待处理内容>\n{{content}}\n</待处理内容>"]
  ];

  function operationFromTuple(row, index) {
    const [id, name, icon, category, prompt] = row;
    return Object.freeze({ id, name, icon, category, prompt, builtin: true, enabled: true, showInContextMenu: defaultMenuIds.includes(id), showInPicker: true, groupId: "", targetMode: "selection", serviceKeys: [], answerMode: "inherit", execution: "direct", shortcutSlot: id === "translate-zh" ? 1 : id === "summarize" ? 2 : 0, order: index });
  }
  const builtIns = Object.freeze(defaults.map(operationFromTuple));
  const builtInById = Object.freeze(Object.fromEntries(builtIns.map((row) => [row.id, row])));

  function normalizeOperation(value, fallback = null) {
    if (!value || typeof value !== "object") return fallback;
    const id = String(value.id || fallback?.id || "").trim();
    const isBuiltin = Boolean(builtInById[id]);
    if (!isBuiltin && !id.startsWith("custom-")) return fallback;
    const base = fallback || builtInById[id] || {};
    const name = String(value.name ?? base.name ?? "").trim().slice(0, 40), prompt = String(value.prompt ?? base.prompt ?? "").trim().slice(0, 12000);
    if (!name || !prompt) return fallback;
    const targetMode = ["selection", "active", "fixed", "ask"].includes(value.targetMode) ? value.targetMode : base.targetMode || "selection";
    return {
      id, name, prompt, builtin: isBuiltin, icon: String(value.icon ?? base.icon ?? "自").slice(0, 2),
      category: categories.some((row) => row.key === value.category) ? value.category : base.category || "custom",
      enabled: value.enabled !== false, showInContextMenu: value.showInContextMenu ?? base.showInContextMenu ?? false,
      showInPicker: value.showInPicker ?? base.showInPicker ?? true, groupId: String(value.groupId || "").slice(0, 80), targetMode,
      serviceKeys: [...new Set(Array.isArray(value.serviceKeys) ? value.serviceKeys.map(String) : base.serviceKeys || [])].slice(0, 10),
      answerMode: ["inherit", "expert", "fast"].includes(value.answerMode) ? value.answerMode : base.answerMode || "inherit",
      execution: ["direct", "preview"].includes(value.execution) ? value.execution : base.execution || "direct",
      shortcutSlot: Math.max(0, Math.min(8, Number(value.shortcutSlot ?? base.shortcutSlot) || 0)), order: Number.isFinite(Number(value.order)) ? Number(value.order) : Number(base.order) || 0
    };
  }

  function normalizeGroup(value, index = 0) {
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim(), name = String(value.name || "").trim().slice(0, 30);
    if (!id.startsWith("group-") || !name) return null;
    return { id, name, enabled: value.enabled !== false, order: Number.isFinite(Number(value.order)) ? Number(value.order) : index };
  }

  function migrateLegacy(customTemplates = [], menuIds = defaultMenuIds) {
    const visible = new Set(Array.isArray(menuIds) ? menuIds : defaultMenuIds);
    const operations = builtIns.map((row) => ({ ...row, showInContextMenu: defaultMenuIds.includes(row.id) }));
    for (const [index, legacy] of (Array.isArray(customTemplates) ? customTemplates : []).entries()) {
      const id = String(legacy?.id || ""); if (!id.startsWith("custom-")) continue;
      const operation = normalizeOperation({ ...legacy, category: legacy.category || "custom", enabled: true, showInContextMenu: visible.has(id), showInPicker: true, targetMode: "selection", execution: "preview", order: operations.length + index });
      if (operation) operations.push(operation);
    }
    return operations;
  }

  function resolveConfiguration(storedOperations, storedGroups, legacyTemplates = [], legacyMenuIds = defaultMenuIds) {
    let migrated = !Array.isArray(storedOperations);
    const source = migrated ? migrateLegacy(legacyTemplates, legacyMenuIds) : storedOperations;
    const hasRetiredBuiltIns = source.some((row) => row?.id && !builtInById[row.id] && !String(row.id).startsWith("custom-"));
    const byId = new Map();
    for (const base of builtIns) {
      const stored = source.find?.((row) => row?.id === base.id); let candidate = stored;
      if (stored && legacyPrompts[base.id] === stored.prompt) { candidate = { ...stored, prompt: base.prompt }; migrated = true; }
      if (candidate?.id === "translate-zh" && candidate.name === "翻译成中文") { candidate = { ...candidate, name: base.name }; migrated = true; }
      if (candidate?.id === "summarize" && candidate.name === "总结内容") { candidate = { ...candidate, name: base.name }; migrated = true; }
      if (candidate?.id === "explain-simple" && candidate.name === "通俗解释") { candidate = { ...candidate, name: base.name }; migrated = true; }
      if (hasRetiredBuiltIns && candidate?.id === "explain-simple" && candidate.showInContextMenu === false) { candidate = { ...candidate, showInContextMenu: true }; migrated = true; }
      byId.set(base.id, normalizeOperation(candidate, base) || { ...base });
    }
    for (const row of source) { if (builtInById[row?.id]) continue; const normalized = normalizeOperation(row); if (normalized) byId.set(normalized.id, normalized); else migrated = true; }
    const operations = [...byId.values()].sort((a, b) => a.order - b.order).map((row, index) => ({ ...row, order: index }));
    const usedSlots = new Set(); for (const row of operations) { if (!row.shortcutSlot || usedSlots.has(row.shortcutSlot)) row.shortcutSlot = 0; else usedSlots.add(row.shortcutSlot); }
    const groups = (Array.isArray(storedGroups) ? storedGroups : []).map(normalizeGroup).filter(Boolean).sort((a, b) => a.order - b.order).map((row, index) => ({ ...row, order: index }));
    const validGroups = new Set(groups.map((row) => row.id)); for (const row of operations) if (row.groupId && !validGroups.has(row.groupId)) row.groupId = "";
    return { operations, groups, migrated };
  }

  function find(id, operations = builtIns) { return (Array.isArray(operations) ? operations : builtIns).find((row) => row.id === id) || null; }
  function build(operation, context) {
    const data = typeof context === "object" && context ? context : { content: context };
    if (!operation) return String(data.content || "").trim();
    return String(operation.prompt || "{{content}}")
      .replaceAll("{{content}}", String(data.content || "").trim())
      .replaceAll("{{pageTitle}}", String(data.pageTitle || "").trim())
      .replaceAll("{{pageUrl}}", String(data.pageUrl || "").trim());
  }
  function restoreBuiltin(id) { return builtInById[id] ? { ...builtInById[id] } : null; }

  global.MultiAIPromptTemplates = Object.freeze({ categories, builtIns, builtInById, defaultMenuIds, normalizeOperation, normalizeGroup, migrateLegacy, resolveConfiguration, find, build, restoreBuiltin });
})(typeof self !== "undefined" ? self : window);
