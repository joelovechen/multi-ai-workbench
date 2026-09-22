(function initConversationExportCore(global) {
  "use strict";

  const SCHEMA_VERSION = 1;
  const safeText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const safeRole = (value) => ["user", "assistant", "system"].includes(value) ? value : "assistant";

  function normalizeContent(content) {
    if (!content || typeof content !== "object") return null;
    const richTypes = ["image_group", "video_blocks", "shopping_card", "shopping_table", "html_widget", "chart", "writing_block", "file_changes"];
    const type = ["markdown", "text", "thinking", "code", "image", "attachment", "sources", ...richTypes].includes(content.type) ? content.type : "text";
    if (["markdown", "text", "thinking", "code", "writing_block"].includes(type)) {
      const value = safeText(content.content); if (!value) return null;
      return { type, content: value, language: safeText(content.language), title: safeText(content.title), writingBlock: content.writingBlock || null };
    }
    if (type === "image") {
      const url = safeText(content.url || content.imageUrl); if (!url) return null;
      return { type, url, alt: safeText(content.alt), imageOrigin: safeText(content.imageOrigin), imageAccess: safeText(content.imageAccess) };
    }
    if (type === "attachment") {
      const name = safeText(content.name || content.attachment?.name); if (!name) return null;
      return { type, name, url: safeText(content.url || content.attachment?.url), mimeType: safeText(content.mimeType || content.attachment?.mime_type), size: Number(content.size || content.attachment?.size) || 0 };
    }
    if (type === "sources") {
      const sources = Array.isArray(content.sources) ? content.sources.map((row) => ({ title: safeText(row?.title || row?.domain || row?.url), url: safeText(row?.url) })).filter((row) => row.url) : [];
      return sources.length ? { type: "sources", sources } : null;
    }
    if (type === "image_group") {
      const group = content.imageGroup || content.image_group || {};
      const images = (group.images || []).map((row) => ({ ...row, imageUrl: safeText(row?.imageUrl || row?.url), title: safeText(row?.title) })).filter((row) => row.imageUrl);
      return images.length ? { type, imageGroup: { ...group, images } } : null;
    }
    if (type === "video_blocks") {
      const videos = (content.videoBlocks || []).map((row) => ({ ...row, url: safeText(row?.url), title: safeText(row?.title || row?.url) })).filter((row) => row.url);
      return videos.length ? { type, videoBlockTitle: safeText(content.videoBlockTitle), videoBlocks: videos } : null;
    }
    if (type === "html_widget") {
      const value = safeText(content.content); if (!value) return null;
      return { type, content: value, title: safeText(content.title), htmlWidget: content.htmlWidget || null };
    }
    const payloadKey = type === "shopping_card" ? "shoppingCard" : type === "shopping_table" ? "shoppingTable" : type === "chart" ? "chart" : "fileChanges";
    const payload = content[payloadKey];
    return payload ? { type, [payloadKey]: payload } : null;
  }

  function normalizeMessage(message, index) {
    const contents = (Array.isArray(message?.contents) ? message.contents : [{ type: "text", content: message?.text }]).map(normalizeContent).filter(Boolean);
    if (!contents.length) return null;
    return {
      id: safeText(message.id) || `message-${index + 1}`,
      role: safeRole(message.role),
      model: safeText(message.model),
      createdAt: Number(message.createdAt) || null,
      updatedAt: Number(message.updatedAt) || null,
      ids: Array.isArray(message.ids) ? message.ids.map(safeText).filter(Boolean) : [],
      contents
    };
  }

  function normalizeConversation(input = {}) {
    const messages = (Array.isArray(input.messages) ? input.messages : []).map(normalizeMessage).filter(Boolean);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: safeText(input.id) || crypto.randomUUID(),
      platform: safeText(input.platform) || "unknown",
      platformName: safeText(input.platformName) || safeText(input.platform) || "AI",
      title: safeText(input.title) || "AI conversation",
      sourceUrl: safeText(input.sourceUrl),
      model: safeText(input.model),
      createdAt: Number(input.createdAt) || null,
      updatedAt: Number(input.updatedAt) || null,
      exportedAt: Number(input.exportedAt) || Date.now(),
      completeness: ["complete", "partial", "unknown"].includes(input.completeness) ? input.completeness : "unknown",
      warnings: Array.isArray(input.warnings) ? input.warnings.map(safeText).filter(Boolean) : [],
      messages
    };
  }

  function selectedConversation(conversation, selectedIds) {
    const normalized = normalizeConversation(conversation); if (selectedIds == null) return normalized;
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
    return { ...normalized, messages: normalized.messages.filter((message) => selected.has(message.id)) };
  }

  function contentMarkdown(content, options) {
    if (content.type === "thinking") return options.includeThinking ? `> Thinking\n> ${content.content.replace(/\n/g, "\n> ")}` : "";
    if (content.type === "code") return `\`\`\`${content.language || ""}\n${content.content}\n\`\`\``;
    if (content.type === "image") return `![${content.alt || "image"}](${content.url})`;
    if (content.type === "attachment") return content.url ? `[📎 ${content.name}](${content.url})` : `📎 ${content.name}`;
    if (content.type === "sources") return content.sources.map((row, index) => `${index + 1}. [${row.title || row.url}](${row.url})`).join("\n");
    if (content.type === "image_group") return content.imageGroup.images.map((row) => `![${row.title || "image"}](${row.imageUrl})`).join("\n\n");
    if (content.type === "video_blocks") return [content.videoBlockTitle, ...content.videoBlocks.map((row) => `[${row.title || row.url}](${row.url})`)].filter(Boolean).join("\n\n");
    if (content.type === "writing_block") return `${content.title ? `### ${content.title}\n\n` : ""}${content.content}`;
    if (content.type === "html_widget") return `${content.title ? `### ${content.title}\n\n` : ""}\`\`\`html\n${content.content}\n\`\`\``;
    if (content.type === "chart") return `\`\`\`json\n${JSON.stringify(content.chart, null, 2)}\n\`\`\``;
    if (content.type === "shopping_card") {
      const row = content.shoppingCard || {};
      return [row.title ? `### ${row.title}` : "", row.price, row.description, row.url ? `[Open product](${row.url})` : ""].filter(Boolean).join("\n\n");
    }
    if (content.type === "shopping_table") return `\`\`\`json\n${JSON.stringify(content.shoppingTable, null, 2)}\n\`\`\``;
    if (content.type === "file_changes") return (content.fileChanges?.files || []).map((row) => `- ${row.path}: +${row.added || 0} / -${row.removed || 0}`).join("\n");
    return content.content;
  }

  function markdownFromConversation(conversation, options = {}) {
    const data = normalizeConversation(conversation), lines = [`# ${data.title}`, ""];
    if (options.includeMetadata !== false) {
      lines.push(`- Platform: ${data.platformName}`);
      if (data.model) lines.push(`- Model: ${data.model}`);
      if (options.includeSource !== false && data.sourceUrl) lines.push(`- Source: ${data.sourceUrl}`);
      lines.push(`- Exported: ${new Date(data.exportedAt).toISOString()}`, "");
    }
    for (const message of data.messages) {
      const role = message.role === "user" ? (options.userLabel || "User") : message.role === "system" ? "System" : (message.model || options.assistantLabel || data.platformName || "Assistant");
      const timestamp = options.showTimestamp && message.createdAt ? ` · ${new Date(message.createdAt).toLocaleString()}` : "";
      lines.push(`## ${role}${timestamp}`, "");
      const chunks = message.contents.map((content) => contentMarkdown(content, options)).filter(Boolean);
      lines.push(chunks.join("\n\n"), "");
    }
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  }

  function textFromConversation(conversation, options = {}) {
    return markdownFromConversation(conversation, options)
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/^>\s?/gm, "")
      .replace(/[*_`]/g, "");
  }

  function jsonFromConversation(conversation) {
    return `${JSON.stringify(normalizeConversation(conversation), null, 2)}\n`;
  }

  function sanitizeFilename(value, fallback = "ai-conversation") {
    const cleaned = safeText(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120);
    return cleaned || fallback;
  }

  global.MultiAIConversationExport = Object.freeze({ SCHEMA_VERSION, normalizeContent, normalizeConversation, selectedConversation, contentMarkdown, markdownFromConversation, textFromConversation, jsonFromConversation, sanitizeFilename });
})(typeof self !== "undefined" ? self : globalThis);
