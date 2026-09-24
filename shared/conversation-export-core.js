(function initConversationExportCore(global) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const TEXT_TYPES = new Set(["markdown", "text", "thinking", "code", "code_block", "formula", "blockquote", "writing_block"]);
  const RICH_TYPES = new Set(["image", "image_group", "attachment", "sources", "video_blocks", "shopping_card", "shopping_table", "html_widget", "chart", "table", "file_changes", "divider"]);
  const safeText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const safeRole = (value) => ["user", "assistant", "system", "tool"].includes(value) ? value : "assistant";
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalizeUrl = (value) => safeText(value);

  function normalizeSource(row) {
    if (!row || typeof row !== "object") return null;
    const url = normalizeUrl(row.url || row.link || row.uri);
    if (!url) return null;
    return { title: safeText(row.title || row.name || row.domain || url), url, domain: safeText(row.domain || row.sourceName || row.source), snippet: safeText(row.snippet || row.description || row.text), favicon: normalizeUrl(row.favicon || row.icon) };
  }

  function normalizeImage(row) {
    if (!row || typeof row !== "object") return null;
    const url = normalizeUrl(row.url || row.imageUrl || row.src);
    if (!url) return null;
    const rawCandidates = Array.isArray(row.candidates) && row.candidates.length ? row.candidates : (row.thumbnailUrl ? [url, row.thumbnailUrl] : [url]);
    const candidates = [...new Set(rawCandidates.map(normalizeUrl).filter(Boolean))];
    return {
      url,
      imageUrl: url,
      candidates: candidates.length ? candidates : [url],
      thumbnailUrl: normalizeUrl(row.thumbnailUrl),
      title: safeText(row.title || row.alt),
      alt: safeText(row.alt || row.title),
      width: Number(row.width) || null,
      height: Number(row.height) || null,
      sourceUrl: normalizeUrl(row.sourceUrl || row.pageUrl),
      imageOrigin: safeText(row.imageOrigin),
      imageAccess: safeText(row.imageAccess),
      mimeType: safeText(row.mimeType || row.mime_type)
    };
  }

  function normalizeContent(content) {
    if (!content || typeof content !== "object") return null;
    const aliases = { code: "code_block", latex: "formula", source: "sources", imageGroup: "image_group" };
    const rawType = aliases[content.type] || content.type || "text";
    const type = TEXT_TYPES.has(rawType) || RICH_TYPES.has(rawType) ? rawType : "text";
    if (TEXT_TYPES.has(type)) {
      const value = safeText(content.content ?? content.text ?? content.value);
      return value ? { type, content: value, language: safeText(content.language || content.lang), title: safeText(content.title), displayMode: Boolean(content.displayMode || content.block), writingBlock: clone(content.writingBlock) || null } : null;
    }
    if (type === "divider") return { type };
    if (type === "image") { const image = normalizeImage(content); return image ? { type, ...image } : null; }
    if (type === "attachment") {
      const source = content.attachment || content, name = safeText(source.name || source.fileName || source.id);
      const url = normalizeUrl(source.url || source.downloadUrl);
      const previewUrl = normalizeUrl(source.previewUrl || source.thumbnailUrl);
      const rawCandidates = Array.isArray(source.candidates) && source.candidates.length ? source.candidates : [url, previewUrl];
      const candidates = [...new Set(rawCandidates.map(normalizeUrl).filter(Boolean))];
      const mimeType = safeText(source.mimeType || source.mime_type || source.type);
      return name ? {
        type,
        name,
        url: url || candidates[0] || "",
        imageUrl: url || candidates[0] || "",
        previewUrl,
        candidates: candidates.length ? candidates : (url ? [url] : []),
        mimeType,
        size: Number(source.size || source.file_token_size) || 0,
        width: Number(source.width) || null,
        height: Number(source.height) || null,
        imageAccess: safeText(source.imageAccess || (mimeType.startsWith("image/") ? "private" : "")),
        imageOrigin: safeText(source.imageOrigin || (mimeType.startsWith("image/") ? "attachment" : ""))
      } : null;
    }
    if (type === "sources") {
      const sources = (Array.isArray(content.sources) ? content.sources : []).map(normalizeSource).filter(Boolean);
      return sources.length ? { type, title: safeText(content.title), sources } : null;
    }
    if (type === "image_group") {
      const group = content.imageGroup || content.image_group || content, images = (Array.isArray(group.images) ? group.images : []).map(normalizeImage).filter(Boolean);
      return images.length ? { type, imageGroup: { title: safeText(group.title), columns: Math.max(1, Math.min(6, Number(group.columns) || 3)), aspectRatio: safeText(group.aspectRatio), images } } : null;
    }
    if (type === "video_blocks") {
      const videos = (Array.isArray(content.videoBlocks) ? content.videoBlocks : []).map((row) => ({ title: safeText(row?.title || row?.url), url: normalizeUrl(row?.url), thumbnailUrl: normalizeUrl(row?.thumbnailUrl || row?.thumbnail), duration: safeText(row?.duration), channel: safeText(row?.channel || row?.author) })).filter((row) => row.url);
      return videos.length ? { type, videoBlockTitle: safeText(content.videoBlockTitle || content.title), videoBlocks: videos } : null;
    }
    if (type === "html_widget") {
      const value = String(content.content ?? content.html ?? "").trim();
      return value ? { type, content: value, title: safeText(content.title), htmlWidget: clone(content.htmlWidget) || null } : null;
    }
    if (type === "table") {
      const headers = (Array.isArray(content.headers) ? content.headers : []).map(safeText), rows = (Array.isArray(content.rows) ? content.rows : []).map((row) => Array.isArray(row) ? row.map(safeText) : []);
      return headers.length || rows.length ? { type, title: safeText(content.title), headers, rows } : null;
    }
    const payloadKey = type === "shopping_card" ? "shoppingCard" : type === "shopping_table" ? "shoppingTable" : type === "chart" ? "chart" : "fileChanges";
    const payload = clone(content[payloadKey] || content.payload);
    return payload ? { type, [payloadKey]: payload } : null;
  }

  function normalizeMessage(message, index) {
    const source = Array.isArray(message?.contents) ? message.contents : [{ type: "text", content: message?.text }], contents = source.map(normalizeContent).filter(Boolean);
    if (!contents.length) return null;
    return { id: safeText(message.id) || `message-${index + 1}`, parentId: safeText(message.parentId), branchId: safeText(message.branchId), role: safeRole(message.role), model: safeText(message.model), displayModel: safeText(message.displayModel), createdAt: Number(message.createdAt ?? message.created_at) || null, updatedAt: Number(message.updatedAt ?? message.updated_at) || null, ids: Array.isArray(message.ids) ? message.ids.map(safeText).filter(Boolean) : [], contents };
  }

  function normalizeBranch(branch, index, messageIds) {
    if (!branch || typeof branch !== "object") return null;
    const ids = (Array.isArray(branch.messageIds) ? branch.messageIds : []).map(safeText).filter((id) => messageIds.has(id));
    return { id: safeText(branch.id || branch.branchId) || `branch-${index + 1}`, title: safeText(branch.title || branch.name) || `Branch ${index + 1}`, parentBranchId: safeText(branch.parentBranchId), leafMessageId: safeText(branch.leafMessageId || ids.at(-1)), messageIds: ids };
  }

  function normalizeConversation(input = {}) {
    const messages = (Array.isArray(input.messages) ? input.messages : []).map(normalizeMessage).filter(Boolean), messageIds = new Set(messages.map((message) => message.id));
    const branches = (Array.isArray(input.branches) ? input.branches : []).map((branch, index) => normalizeBranch(branch, index, messageIds)).filter(Boolean);
    return { schemaVersion: SCHEMA_VERSION, id: safeText(input.id || input.pageId) || crypto.randomUUID(), platform: safeText(input.platform || input.model) || "unknown", platformName: safeText(input.platformName || input.displayModel || input.platform) || "AI", title: safeText(input.title) || "AI conversation", sourceUrl: safeText(input.sourceUrl || input.fromUrl), model: safeText(input.model), createdAt: Number(input.createdAt || input.createAt) || null, updatedAt: Number(input.updatedAt || input.lastUpdateAt) || null, exportedAt: Number(input.exportedAt) || Date.now(), completeness: ["complete", "partial", "unknown"].includes(input.completeness) ? input.completeness : "unknown", extractionMethod: safeText(input.extractionMethod), warnings: Array.isArray(input.warnings) ? input.warnings.map(safeText).filter(Boolean) : [], activeBranchId: safeText(input.activeBranchId || branches[0]?.id), branches, messages };
  }

  function selectedConversation(conversation, selectedIds) {
    const normalized = normalizeConversation(conversation);
    if (selectedIds == null) return normalized;
    const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []), messages = normalized.messages.filter((message) => selected.has(message.id)), available = new Set(messages.map((message) => message.id));
    const branches = normalized.branches.map((branch) => ({ ...branch, messageIds: branch.messageIds.filter((id) => available.has(id)) })).filter((branch) => branch.messageIds.length);
    return { ...normalized, messages, branches };
  }

  function markdownTable(headers, rows) {
    const width = Math.max(headers.length, ...rows.map((row) => row.length), 0);
    if (!width) return "";
    const escape = (value) => safeText(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>"), head = Array.from({ length: width }, (_, index) => escape(headers[index] || `Column ${index + 1}`));
    return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${Array.from({ length: width }, (_, index) => escape(row[index])).join(" | ")} |`)].join("\n");
  }

  function contentMarkdown(content, options = {}) {
    if (content.type === "thinking") return options.includeThinking ? `> Thinking\n> ${content.content.replace(/\n/g, "\n> ")}` : "";
    if (content.type === "code" || content.type === "code_block") return `\`\`\`${content.language || ""}\n${content.content}\n\`\`\``;
    if (content.type === "formula") return content.displayMode ? `$$\n${content.content}\n$$` : `$${content.content}$`;
    if (content.type === "blockquote") return content.content.split("\n").map((line) => `> ${line}`).join("\n");
    if (content.type === "divider") return "---";
    if (content.type === "image") return `![${content.alt || content.title || "image"}](${content.url})`;
    if (content.type === "attachment") {
      if (content.mimeType?.startsWith("image/") && (content.url || content.previewUrl)) {
        const imgUrl = content.url || content.previewUrl;
        return `![${content.name || "image"}](${imgUrl})`;
      }
      return content.url ? `[📎 ${content.name}](${content.url})` : `📎 ${content.name}`;
    }
    if (content.type === "sources") return [content.title ? `### ${content.title}` : "", ...content.sources.map((row, index) => `${index + 1}. [${row.title || row.url}](${row.url})${row.snippet ? ` — ${row.snippet}` : ""}`)].filter(Boolean).join("\n");
    if (content.type === "image_group") return [content.imageGroup.title ? `### ${content.imageGroup.title}` : "", ...content.imageGroup.images.map((row) => `![${row.alt || row.title || "image"}](${row.url || row.imageUrl})`)].filter(Boolean).join("\n\n");
    if (content.type === "video_blocks") return [content.videoBlockTitle, ...content.videoBlocks.map((row) => `[${row.title || row.url}](${row.url})${row.channel ? ` — ${row.channel}` : ""}`)].filter(Boolean).join("\n\n");
    if (content.type === "writing_block") return `${content.title ? `### ${content.title}\n\n` : ""}${content.content}`;
    if (content.type === "html_widget") return `${content.title ? `### ${content.title}\n\n` : ""}\`\`\`html\n${content.content}\n\`\`\``;
    if (content.type === "table") return [content.title ? `### ${content.title}` : "", markdownTable(content.headers, content.rows)].filter(Boolean).join("\n\n");
    if (content.type === "chart") return `\`\`\`json\n${JSON.stringify(content.chart, null, 2)}\n\`\`\``;
    if (content.type === "shopping_card") { const row = content.shoppingCard || {}, images = row.images || (row.image ? [row.image] : []); return [row.title ? `### ${row.title}` : "", row.price, row.description, ...images.map((image) => `![${row.title || "product"}](${typeof image === "string" ? image : image.url || image.imageUrl})`), row.url ? `[Open product](${row.url})` : ""].filter(Boolean).join("\n\n"); }
    if (content.type === "shopping_table") { const table = content.shoppingTable || {}; if (Array.isArray(table.columns) || Array.isArray(table.rows)) return `${markdownTable(table.columns || [], table.rows || [])}\n\n\`\`\`json\n${JSON.stringify({ columns: table.columns || [] }, null, 2)}\n\`\`\``; const products = Array.isArray(table.products) ? table.products : [], headers = ["Product", ...(table.attributes || []).map((row) => row.title || row.name || String(row))], rows = products.map((product) => [product.title || product.name || "", ...(product.attributes || []).map((row) => row.value || row.text || String(row))]); return markdownTable(headers, rows) || `\`\`\`json\n${JSON.stringify(table, null, 2)}\n\`\`\``; }
    if (content.type === "file_changes") return (content.fileChanges?.files || []).map((row) => `- ${row.path || row.name}: +${row.added || 0} / -${row.removed || 0}`).join("\n");
    return content.content || "";
  }

  function markdownFromConversation(conversation, options = {}) {
    const data = normalizeConversation(conversation), lines = [];
    if (options.frontmatter) lines.push("---", `title: ${JSON.stringify(data.title)}`, `platform: ${JSON.stringify(data.platformName)}`, `exported: ${new Date(data.exportedAt).toISOString()}`, "---", "");
    lines.push(`# ${data.title}`, "");
    if (options.includeMetadata !== false) { lines.push(`- Platform: ${data.platformName}`); if (data.model) lines.push(`- Model: ${data.model}`); if (data.completeness) lines.push(`- Completeness: ${data.completeness}`); if (options.includeSource !== false && data.sourceUrl) lines.push(`- Source: ${data.sourceUrl}`); lines.push(`- Exported: ${new Date(data.exportedAt).toISOString()}`, ""); }
    const branchByMessage = new Map(); if (options.includeBranches !== false) for (const branch of data.branches) for (const id of branch.messageIds) if (!branchByMessage.has(id)) branchByMessage.set(id, branch.title);
    let previousBranch = "";
    for (const message of data.messages) {
      const branchTitle = branchByMessage.get(message.id) || "";
      if (branchTitle && branchTitle !== previousBranch && data.branches.length > 1) lines.push(`## ${branchTitle}`, "");
      previousBranch = branchTitle || previousBranch;
      const role = message.role === "user" ? (options.userLabel || "User") : message.role === "system" ? "System" : message.role === "tool" ? "Tool" : (message.displayModel || message.model || options.assistantLabel || data.platformName || "Assistant"), timestamp = options.showTimestamp && message.createdAt ? ` · ${new Date(message.createdAt).toLocaleString()}` : "";
      lines.push(`${data.branches.length > 1 ? "###" : "##"} ${role}${timestamp}`, "");
      lines.push(message.contents.map((content) => contentMarkdown(content, options)).filter(Boolean).join("\n\n"), "");
    }
    return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
  }

  function textFromConversation(conversation, options = {}) {
    return markdownFromConversation(conversation, options).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^#{1,6}\s+/gm, "").replace(/\`\`\`[^\n]*\n([\s\S]*?)\`\`\`/g, "$1").replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/^>\s?/gm, "").replace(/[\*_`]/g, "");
  }
  const jsonFromConversation = (conversation) => `${JSON.stringify(normalizeConversation(conversation), null, 2)}\n`;

  function collectAssets(conversation) {
    const data = normalizeConversation(conversation), assets = [], seen = new Set();
    const add = (url, kind, name, ownerId, path, candidates = [], mimeType = "") => {
      url = normalizeUrl(url);
      if (!url || seen.has(`${kind}:${url}`)) return;
      seen.add(`${kind}:${url}`);
      const validCandidates = [...new Set([url, ...(Array.isArray(candidates) ? candidates : [])].map(normalizeUrl).filter(Boolean))];
      assets.push({ id: `asset-${assets.length + 1}`, url, kind, name: safeText(name) || kind, ownerId, path, candidates: validCandidates, mimeType: safeText(mimeType) });
    };
    for (const message of data.messages) for (let index = 0; index < message.contents.length; index += 1) {
      const content = message.contents[index], base = ["messages", message.id, "contents", index];
      if (content.type === "image") add(content.url, "image", content.alt || content.title, message.id, [...base, "url"], content.candidates, content.mimeType);
      if (content.type === "attachment") {
        const isImg = content.mimeType?.startsWith("image/");
        add(content.url, isImg ? "image" : "attachment", content.name, message.id, [...base, "url"], content.candidates, content.mimeType);
        if (content.previewUrl) add(content.previewUrl, "image", `${content.name}-preview`, message.id, [...base, "previewUrl"], [content.previewUrl], "image/jpeg");
      }
      if (content.type === "image_group") content.imageGroup.images.forEach((image, imageIndex) => add(image.url || image.imageUrl, "image", image.alt || image.title, message.id, [...base, "imageGroup", "images", imageIndex, "url"], image.candidates, image.mimeType));
      if (content.type === "video_blocks") content.videoBlocks.forEach((video, videoIndex) => add(video.thumbnailUrl, "image", video.title, message.id, [...base, "videoBlocks", videoIndex, "thumbnailUrl"]));
      if (content.type === "shopping_card") { const card = content.shoppingCard || {}, images = card.images || (card.image ? [card.image] : []); images.forEach((image, imageIndex) => add(typeof image === "string" ? image : image?.url || image?.imageUrl, "image", card.title || "product", message.id, [...base, "shoppingCard", "images", imageIndex])); }
      if (content.type === "shopping_table") (content.shoppingTable?.products || []).forEach((product, productIndex) => { const images = product.images || (product.image ? [product.image] : []); images.forEach((image, imageIndex) => add(typeof image === "string" ? image : image?.url || image?.imageUrl, "image", product.title || product.name || "product", message.id, [...base, "shoppingTable", "products", productIndex, "images", imageIndex])); });
    }
    return assets;
  }

  function sanitizeFilename(value, fallback = "ai-conversation") { const cleaned = safeText(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120); return cleaned || fallback; }

  global.MultiAIConversationExport = Object.freeze({ SCHEMA_VERSION, normalizeContent, normalizeConversation, selectedConversation, contentMarkdown, markdownFromConversation, textFromConversation, jsonFromConversation, collectAssets, sanitizeFilename });
})(typeof self !== "undefined" ? self : globalThis);
