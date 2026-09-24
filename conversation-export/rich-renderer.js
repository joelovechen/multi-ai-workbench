(function initRichRenderer(global) {
  "use strict";

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const safeUrl = (value) => {
    const url = String(value || "").trim();
    return /^(https?:|data:image\/|blob:|chrome-extension:)/i.test(url) ? url : "";
  };

  function appendInline(target, value) {
    const text = String(value || ""), pattern = /(!?\[([^\]]*)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\$([^$\n]+)\$)/g;
    let cursor = 0, match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) target.append(document.createTextNode(text.slice(cursor, match.index)));
      if (match[1]?.startsWith("![")) {
        const url = safeUrl(match[3]);
        if (url) { const image = el("img", "inline-image"); image.src = url; image.alt = match[2] || "image"; image.loading = "lazy"; target.append(image); }
        else target.append(document.createTextNode(match[0]));
      } else if (match[1]) {
        const url = safeUrl(match[3]);
        if (url) { const link = el("a", "", match[2] || url); link.href = url; link.target = "_blank"; link.rel = "noreferrer noopener"; target.append(link); }
        else target.append(document.createTextNode(match[2] || match[0]));
      } else if (match[4]) target.append(el("code", "inline-code", match[4]));
      else if (match[5]) target.append(el("strong", "", match[5]));
      else if (match[6]) target.append(el("span", "formula inline-formula", match[6]));
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
  }

  function markdown(value) {
    const root = el("div", "markdown-body"), lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (/^```/.test(line)) {
        const language = line.slice(3).trim(), code = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
        const block = el("div", "code-block"), label = el("div", "code-language", language || "code"), pre = el("pre"), codeNode = el("code", "", code.join("\n"));
        pre.append(codeNode); block.append(label, pre); root.append(block); index += 1; continue;
      }
      if (/^\$\$$/.test(line.trim())) {
        const formula = []; index += 1;
        while (index < lines.length && !/^\$\$$/.test(lines[index].trim())) formula.push(lines[index++]);
        root.append(el("div", "formula block-formula", formula.join("\n"))); index += 1; continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) { const node = el(`h${heading[1].length}`); appendInline(node, heading[2]); root.append(node); index += 1; continue; }
      if (/^([-*_])\1{2,}\s*$/.test(line.trim())) { root.append(el("hr")); index += 1; continue; }
      if (/^>\s?/.test(line)) {
        const quote = [], node = el("blockquote");
        while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
        node.append(markdown(quote.join("\n"))); root.append(node); continue;
      }
      if (/^\s*([-*+] |\d+\. )/.test(line)) {
        const ordered = /^\s*\d+\. /.test(line), list = el(ordered ? "ol" : "ul");
        while (index < lines.length && /^\s*([-*+] |\d+\. )/.test(lines[index])) {
          const item = el("li"); appendInline(item, lines[index].replace(/^\s*([-*+] |\d+\. )/, "")); list.append(item); index += 1;
        }
        root.append(list); continue;
      }
      if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[index + 1])) {
        const split = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()), headers = split(line); index += 2;
        const table = el("table", "rich-table"), thead = el("thead"), headRow = el("tr"), tbody = el("tbody");
        headers.forEach((cell) => { const th = el("th"); appendInline(th, cell); headRow.append(th); }); thead.append(headRow);
        while (index < lines.length && lines[index].includes("|")) { const row = el("tr"); split(lines[index++]).forEach((cell) => { const td = el("td"); appendInline(td, cell); row.append(td); }); tbody.append(row); }
        table.append(thead, tbody); root.append(table); continue;
      }
      if (!line.trim()) { index += 1; continue; }
      const paragraph = el("p");
      const chunks = [line]; index += 1;
      while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^```|^>|^\s*([-*+] |\d+\. )/.test(lines[index])) chunks.push(lines[index++]);
      appendInline(paragraph, chunks.join("\n")); root.append(paragraph);
    }
    return root;
  }

  function imageNode(url, alt, className = "rich-image") {
    const figure = el("figure", className), image = el("img");
    image.src = safeUrl(url); image.alt = alt || "image"; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => { figure.classList.add("asset-error"); image.replaceWith(el("a", "asset-fallback", `${alt || "Image"}: ${url || "Unavailable"}`)); });
    figure.append(image); if (alt) figure.append(el("figcaption", "", alt)); return figure;
  }

  function renderSources(content) {
    const box = el("section", "content-card sources-card"), title = el("strong", "content-card-title", content.title || "Sources"), list = el("ol");
    for (const source of content.sources || []) { const item = el("li"), link = el("a", "", source.title || source.url); link.href = safeUrl(source.url); link.target = "_blank"; link.rel = "noreferrer noopener"; item.append(link); if (source.snippet) item.append(el("small", "source-snippet", source.snippet)); list.append(item); }
    box.append(title, list); return box;
  }

  function renderTable(headers, rows, title) {
    const wrapper = el("section", "table-wrap"); if (title) wrapper.append(el("strong", "content-card-title", title));
    const table = el("table", "rich-table"), head = el("thead"), headRow = el("tr"), body = el("tbody");
    (headers || []).forEach((value) => headRow.append(el("th", "", value))); if (headRow.children.length) head.append(headRow);
    (rows || []).forEach((values) => { const row = el("tr"); values.forEach((value) => row.append(el("td", "", value))); body.append(row); });
    table.append(head, body); wrapper.append(table); return wrapper;
  }

  function renderShoppingCard(card) {
    const box = el("article", "product-card"), images = card?.images || (card?.image ? [card.image] : []);
    if (images[0]) box.append(imageNode(typeof images[0] === "string" ? images[0] : images[0].url || images[0].imageUrl, card.title || "Product", "product-image"));
    const body = el("div", "product-body"); if (card?.title) body.append(el("strong", "", card.title)); if (card?.price) body.append(el("span", "product-price", card.price)); if (card?.description) body.append(el("p", "", card.description));
    if (card?.url) { const link = el("a", "", "Open product"); link.href = safeUrl(card.url); link.target = "_blank"; body.append(link); }
    box.append(body); return box;
  }

  function renderChart(chart) {
    const box = el("section", "content-card chart-card"), title = el("strong", "content-card-title", chart?.title || "Chart"), values = Array.isArray(chart?.data) ? chart.data : Array.isArray(chart?.values) ? chart.values : [];
    box.append(title);
    if (values.length && values.every((item) => typeof item === "number" || Number.isFinite(Number(item?.value)))) {
      const max = Math.max(...values.map((item) => Number(typeof item === "number" ? item : item.value)), 1), bars = el("div", "chart-bars");
      values.forEach((item, index) => { const value = Number(typeof item === "number" ? item : item.value), bar = el("div", "chart-bar"); bar.style.setProperty("--bar", `${Math.max(2, value / max * 100)}%`); bar.append(el("span", "", typeof item === "number" ? String(index + 1) : item.label || item.name || String(index + 1)), el("b", "", value)); bars.append(bar); }); box.append(bars);
    } else box.append(el("pre", "json-block", JSON.stringify(chart, null, 2)));
    return box;
  }

  function renderContent(content, options = {}) {
    if (content.type === "thinking" && !options.includeThinking) return null;
    if (["markdown", "text", "writing_block", "blockquote"].includes(content.type)) {
      const section = el("section", `content-block ${content.type}`); if (content.title) section.append(el("strong", "content-card-title", content.title)); section.append(markdown(content.type === "blockquote" ? content.content.split("\n").map((line) => `> ${line}`).join("\n") : content.content)); return section;
    }
    if (content.type === "thinking") { const details = el("details", "thinking-block"); details.open = Boolean(options.expandThinking); details.append(el("summary", "", "Thinking"), markdown(content.content)); return details; }
    if (content.type === "code" || content.type === "code_block") return markdown(`\`\`\`${content.language || ""}\n${content.content}\n\`\`\``);
    if (content.type === "formula") return el("div", `formula ${content.displayMode ? "block-formula" : "inline-formula"}`, content.content);
    if (content.type === "divider") return el("hr");
    if (content.type === "image") return imageNode(content.url, content.alt || content.title);
    if (content.type === "image_group") { const group = el("section", "image-group"); group.style.setProperty("--columns", content.imageGroup.columns || 3); if (content.imageGroup.title) group.append(el("strong", "content-card-title", content.imageGroup.title)); const grid = el("div", "image-grid"); content.imageGroup.images.forEach((image) => grid.append(imageNode(image.url || image.imageUrl, image.alt || image.title))); group.append(grid); return group; }
    if (content.type === "attachment") {
      const isImg = (content.mimeType && content.mimeType.startsWith("image/")) || content.imageAccess || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(content.url || content.name || "");
      if (isImg && content.url) {
        const figure = imageNode(content.url, content.name || "Image attachment", "attachment-image-card");
        const caption = el("figcaption", "attachment-caption");
        const link = el("a", "attachment-name", content.name || "Image");
        link.href = safeUrl(content.url) || "#";
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        const meta = el("small", "attachment-meta", [content.mimeType, content.size ? `${Math.ceil(content.size / 1024)} KB` : ""].filter(Boolean).join(" · "));
        caption.append(link, meta);
        figure.append(caption);
        return figure;
      }
      const link = el("a", "attachment-card");
      link.href = safeUrl(content.url) || "#";
      link.target = "_blank";
      link.append(el("span", "attachment-icon", "📎"), el("span", "attachment-name", content.name), el("small", "", [content.mimeType, content.size ? `${Math.ceil(content.size / 1024)} KB` : ""].filter(Boolean).join(" · ")));
      return link;
    }
    if (content.type === "sources") return renderSources(content);
    if (content.type === "table") return renderTable(content.headers, content.rows, content.title);
    if (content.type === "video_blocks") { const section = el("section", "video-list"); if (content.videoBlockTitle) section.append(el("strong", "content-card-title", content.videoBlockTitle)); content.videoBlocks.forEach((video) => { const link = el("a", "video-card"); link.href = safeUrl(video.url); link.target = "_blank"; if (video.thumbnailUrl) link.append(imageNode(video.thumbnailUrl, video.title, "video-thumbnail")); const label = el("span", ""); label.append(el("strong", "", video.title || video.url)); if (video.channel || video.duration) label.append(el("small", "", [video.channel, video.duration].filter(Boolean).join(" · "))); link.append(label); section.append(link); }); return section; }
    if (content.type === "shopping_card") return renderShoppingCard(content.shoppingCard);
    if (content.type === "shopping_table") { const table = content.shoppingTable || {}; if (Array.isArray(table.columns) || Array.isArray(table.rows)) return renderTable(table.columns || [], table.rows || [], table.title); const attrs = table.attributes || [], headers = ["Product", ...attrs.map((item) => item.title || item.name || String(item))], rows = (table.products || []).map((product) => [product.title || product.name || "", ...(product.attributes || []).map((item) => item.value || item.text || String(item))]); return renderTable(headers, rows, table.title); }
    if (content.type === "chart") return renderChart(content.chart);
    if (content.type === "file_changes") { const section = el("section", "content-card file-changes"); section.append(el("strong", "content-card-title", "File changes")); for (const file of content.fileChanges?.files || []) section.append(el("div", "file-change", `${file.path || file.name || "file"}  +${file.added || 0}  −${file.removed || 0}`)); return section; }
    if (content.type === "html_widget") { const section = el("section", "content-card widget-card"); if (content.title) section.append(el("strong", "content-card-title", content.title)); const frame = el("iframe", "widget-frame"); frame.sandbox = "allow-scripts"; frame.referrerPolicy = "no-referrer"; frame.src = chrome.runtime.getURL("conversation-export/widget-sandbox.html"); frame.addEventListener("load", () => frame.contentWindow?.postMessage({ source: "maiw-widget-render", html: content.content }, "*")); section.append(frame); return section; }
    return el("pre", "json-block", JSON.stringify(content, null, 2));
  }

  function renderMessage(message, index, options = {}) {
    const article = el("article", `message ${message.role}`); article.dataset.messageId = message.id; article.dataset.index = String(index);
    if (options.selectable !== false) { const input = el("input", "message-select"); input.type = "checkbox"; input.value = message.id; input.checked = options.selected !== false; input.setAttribute("aria-label", `Select message ${index + 1}`); if (options.onSelect) input.addEventListener("change", () => options.onSelect(message.id, input.checked)); article.append(input); }
    const head = el("header", "message-head"), role = message.role === "user" ? (options.userLabel || "User") : message.role === "system" ? "System" : message.role === "tool" ? "Tool" : (message.displayModel || message.model || options.assistantLabel || "Assistant");
    head.append(el("strong", "", role), el("small", "", `#${index + 1}${options.showTimestamp && message.createdAt ? ` · ${new Date(message.createdAt).toLocaleString()}` : ""}`)); article.append(head);
    const body = el("div", "message-body rich-message-body"); for (const content of message.contents) { const node = renderContent(content, options); if (node) body.append(node); } article.append(body); return article;
  }

  global.MultiAIRichRenderer = Object.freeze({ markdown, renderContent, renderMessage, imageNode });
})(typeof self !== "undefined" ? self : globalThis);
