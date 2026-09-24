(function initGeminiConversationCore(global) {
  "use strict";

  const PAGE_SIZE = 100;
  const clean = (value) =>
    String(value ?? "")
      .replace(/\[cite_start\]/g, "")
      .replace(/\[cite:\s*[^\]]+\]/g, "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  function valueAt(value, path, fallback = null) {
    let current = value;
    for (const key of path) current = current?.[key];
    return current ?? fallback;
  }

  function textParts(value, result = []) {
    if (typeof value === "string") {
      const item = clean(value);
      if (item) result.push(item);
    } else if (Array.isArray(value)) {
      for (const item of value) textParts(item, result);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) textParts(item, result);
    }
    return result;
  }

  function findRpcFrame(value, rpcId) {
    if (!Array.isArray(value)) return null;
    if (value[0] === "wrb.fr" && value[1] === rpcId && typeof value[2] === "string") {
      try {
        return JSON.parse(value[2]);
      } catch {
        throw Error("gemini_rpc_payload_invalid");
      }
    }
    for (const item of value) {
      const match = findRpcFrame(item, rpcId);
      if (match !== null) return match;
    }
    return null;
  }

  function parseBatchResponse(source, rpcId) {
    const lines = String(source ?? "").split(/\r?\n/);
    for (const line of lines) {
      const candidate = line.trim();
      if (!candidate.startsWith("[") && !candidate.startsWith("{")) continue;
      try {
        const match = findRpcFrame(JSON.parse(candidate), rpcId);
        if (match !== null) return match;
      } catch (error) {
        if (error?.message === "gemini_rpc_payload_invalid") throw error;
      }
    }
    throw Error("gemini_rpc_frame_missing");
  }

  function attachmentContents(row) {
    const records = valueAt(row, [2, 0, 4, 0, 3], []);
    if (!Array.isArray(records)) return [];
    return records.flatMap((record, index) => {
      if (!Array.isArray(record)) return [];
      const name = clean(valueAt(record, [2], "")) || `attachment-${index + 1}`;
      const dimensions = valueAt(record, [13], []);
      const primaryUrl = clean(valueAt(record, [3], ""));
      const candidates = [];
      if (primaryUrl) candidates.push(primaryUrl);
      const thumb = clean(valueAt(record, [0, 0, 0], "") || valueAt(record, [12, 0, 0], ""));
      if (thumb && !candidates.includes(thumb)) candidates.push(thumb);
      const mimeType = clean(valueAt(record, [11], ""));
      const isImg = mimeType.startsWith("image/");
      return [{
        type: "attachment",
        name,
        url: primaryUrl || candidates[0] || "",
        imageUrl: primaryUrl || candidates[0] || "",
        candidates: candidates.length ? candidates : (primaryUrl ? [primaryUrl] : []),
        mimeType,
        size: Array.isArray(dimensions) ? Number(dimensions[2]) || 0 : 0,
        width: Array.isArray(dimensions) ? Number(dimensions[0]) || null : null,
        height: Array.isArray(dimensions) ? Number(dimensions[1]) || null : null,
        imageAccess: isImg ? "private" : "",
        imageOrigin: isImg ? "attachment" : "",
      }];
    });
  }

  function walkArrays(value, visit, limit = 20000) {
    const stack = Array.isArray(value) ? [value] : [];
    let count = 0;
    while (stack.length && count++ < limit) {
      const row = stack.pop(); visit(row);
      for (let index = row.length - 1; index >= 0; index -= 1) if (Array.isArray(row[index])) stack.push(row[index]);
    }
  }

  function extractGeneratedImages(row) {
    try {
      const list = [];
      const seen = new Set();
      const records = valueAt(row, [3, 12, 0, 0], []) || [];
      if (Array.isArray(records) && records.length) {
        walkArrays(records, (item) => {
          const marker = typeof item[1] === "string" && item[1].startsWith("http://googleusercontent.com/image_generation_content/")
            ? item[1]
            : (typeof valueAt(item, [1, 0], null) === "string" && valueAt(item, [1, 0], "").startsWith("http://googleusercontent.com/image_generation_content/")
              ? valueAt(item, [1, 0], "")
              : null);
          if (marker) {
            const candidates = [];
            let pri = valueAt(item, [0, 3, 3], null);
            if (typeof pri === "string" && pri.startsWith("https://lh3.googleusercontent.com/gg")) candidates.push(pri);
            let alt = valueAt(item, [0, 6, 3], null);
            if (typeof alt === "string" && alt.startsWith("https://lh3.googleusercontent.com/gg") && !candidates.includes(alt)) candidates.push(alt);
            walkArrays(item[0], (node) => {
              for (const cell of node) {
                if (typeof cell === "string" && cell.startsWith("https://lh3.googleusercontent.com/gg") && !candidates.includes(cell)) {
                  candidates.push(cell);
                }
              }
            });
            const downloadUrl = candidates[0] || pri || alt;
            let textToken = null;
            for (let k = item.length - 1; k >= 2; k--) {
              if (typeof item[k] === "string" && item[k].startsWith("https://lh3.googleusercontent.com/gg")) {
                textToken = item[k];
                break;
              }
            }
            if (!textToken) textToken = downloadUrl;
            if (downloadUrl && !seen.has(downloadUrl)) {
              seen.add(downloadUrl);
              if (textToken) seen.add(textToken);
              for (const c of candidates) seen.add(c);
              list.push({ placeholder: textToken, downloadUrl, candidates, marker });
            }
          }
        });
      }
      // Also collect any standalone https://lh3.googleusercontent.com/gg images in row[3][12] for simple fixture compatibility
      if (!list.length) {
        walkArrays(valueAt(row, [3, 12], []), (node) => {
          for (const cell of node) {
            if (typeof cell === "string" && cell.startsWith("https://lh3.googleusercontent.com/gg") && !seen.has(cell)) {
              seen.add(cell);
              list.push({ placeholder: cell, downloadUrl: cell, candidates: [cell], marker: null });
            }
          }
        });
      }
      return list;
    } catch {
      return [];
    }
  }

  function inlineGeneratedImages(row, contents) {
    const images = extractGeneratedImages(row);
    if (!images.length) return contents;
    let current = [...contents];
    const placed = new Set();
    for (const { placeholder, downloadUrl, candidates, marker } of images) {
      const activeUrl = downloadUrl || placeholder;
      if (!marker && !placeholder && !activeUrl) continue;
      const next = [];
      const protectToken = `__PROTECTED_URL_${Math.random().toString(36).slice(2)}__`;
      let replacedInTurn = false;
      for (const item of current) {
        if (!["text", "markdown"].includes(item.type) || !item.content) {
          next.push(item);
          continue;
        }
        let text = item.content;
        if (placeholder && text.includes(`](${placeholder})`)) text = text.split(`](${placeholder})`).join(`](${protectToken})`);
        if (activeUrl && text.includes(`](${activeUrl})`)) text = text.split(`](${activeUrl})`).join(`](${protectToken})`);
        if (marker && text.includes(`](${marker})`)) text = text.split(`](${marker})`).join(`](${protectToken})`);
        const splitText = (source, target) => {
          const out = [];
          source.split(target).forEach((chunk, idx) => {
            if (idx > 0) {
              out.push({
                type: "image",
                url: activeUrl,
                imageUrl: activeUrl,
                candidates: candidates || [activeUrl],
                alt: "Gemini generated image",
                imageOrigin: "generated",
                imageAccess: "private"
              });
              placed.add(placeholder);
              placed.add(activeUrl);
              replacedInTurn = true;
            }
            out.push({ type: item.type, content: chunk });
          });
          return out;
        };
        let segments = [{ type: item.type, content: text }];
        const searchTargets = [];
        if (placeholder) { searchTargets.push("@" + placeholder); searchTargets.push(placeholder); }
        if (activeUrl && activeUrl !== placeholder) { searchTargets.push("@" + activeUrl); searchTargets.push(activeUrl); }
        if (marker) searchTargets.push(marker);
        for (const target of searchTargets) {
          const segs = [];
          for (const seg of segments) {
            if (seg.type === "image" || seg.type === "video_blocks") segs.push(seg);
            else if (target && seg.content && seg.content.includes(target)) segs.push(...splitText(seg.content, target));
            else segs.push(seg);
          }
          segments = segs;
        }
        for (const seg of segments) {
          if (["text", "markdown"].includes(seg.type) && seg.content?.includes(protectToken)) {
            seg.content = seg.content.split(protectToken).join(activeUrl);
          }
          next.push(seg);
        }
      }
      if (replacedInTurn) current = next;
    }
    // Append any generated images that were not placed inline in text
    for (const image of images) {
      const activeUrl = image.downloadUrl || image.placeholder;
      if (!placed.has(image.placeholder) && !placed.has(activeUrl)) {
        current.push({
          type: "image",
          url: activeUrl,
          imageUrl: activeUrl,
          candidates: image.candidates || [activeUrl],
          alt: "Gemini generated image",
          imageOrigin: "generated",
          imageAccess: "private"
        });
      }
    }
    return current;
  }

  function immersiveText(row, value) {
    let result = value;
    const records = valueAt(row, [3, 0, 0, 30], []), pattern = /http:\/\/googleusercontent\.com\/immersive_entry_chip\/(\d+)/g;
    if (Array.isArray(records)) result = result.replace(pattern, (marker, index) => {
      const record = records[Number(index)], title = clean(valueAt(record, [2], "")), description = clean(valueAt(record, [4], ""));
      return [title, description].filter(Boolean).join("\n\n") || marker;
    });
    if (result.includes("http://googleusercontent.com/deep_research_confirmation_content/0")) {
      const research = valueAt(row, [3, 0, 0, 12, 55], null);
      if (Array.isArray(research)) {
        const steps = Array.isArray(research[1]) ? research[1].map((item) => `- ${clean(item?.[1])}${item?.[2] ? `: ${clean(item[2])}` : ""}`).filter((item) => item !== "- ").join("\n") : "";
        result = [clean(research[0]), steps, clean(research[2])].filter(Boolean).join("\n\n");
      }
    }
    return clean(result);
  }

  function youtubeContents(row, value) {
    const blocks = valueAt(row, [3, 0, 0, 12, 4], null), pattern = /http:\/\/googleusercontent\.com\/youtube_content\/(\d+)/g, markers = [...value.matchAll(pattern)];
    if (!Array.isArray(blocks) || !markers.length) return null;
    const out = []; let cursor = 0;
    for (const marker of markers) {
      const before = clean(value.slice(cursor, marker.index)); if (before) out.push({ type: "markdown", content: before });
      const source = blocks.find((item) => clean(valueAt(item, [0, 0, 0], "")) === marker[0]), videos = [];
      for (const item of valueAt(source, [4, 0], [])) if (Array.isArray(item) && clean(item[2]) && clean(item[0])) videos.push({ url: clean(item[2]), title: clean(item[0]), description: Array.isArray(item[5]) ? item[5].join(" ") : "", thumbnailUrl: clean(item[12]), duration: clean(item[9]), channel: clean(item[6]) });
      if (videos.length) out.push({ type: "video_blocks", videoBlockTitle: clean(valueAt(source, [0, 2], "")), videoBlocks: videos });
      cursor = marker.index + marker[0].length;
    }
    const tail = clean(value.slice(cursor)); if (tail) out.push({ type: "markdown", content: tail }); return out.length ? out : null;
  }

  function imageCollectionContents(row, contents) {
    const groups = new Map();
    walkArrays(row, (record) => {
      const marker = valueAt(record, [7, 0], ""), imageUrl = valueAt(record, [0, 0, 0], ""), match = typeof marker === "string" ? marker.match(/^https?:\/\/googleusercontent\.com\/image_collection\/image_retrieval\/(\d+)$/) : null;
      if (!match || typeof imageUrl !== "string" || !/^https?:\/\//.test(imageUrl)) return;
      const thumb = clean(valueAt(record, [12, 0, 0], "") || valueAt(record, [3, 0, 0], ""));
      const candidates = [imageUrl];
      if (thumb && thumb !== imageUrl) candidates.push(thumb);
      const images = groups.get(match[1]) || new Map();
      images.set(imageUrl, {
        imageUrl,
        url: imageUrl,
        thumbnailUrl: thumb,
        candidates,
        sourceUrl: clean(valueAt(record, [1, 0, 0], "")),
        title: clean(valueAt(record, [1, 1], "")),
        width: Number(valueAt(record, [0, 2], 0)) || null,
        height: Number(valueAt(record, [0, 3], 0)) || null,
        imageAccess: "private",
        imageOrigin: "collection"
      });
      groups.set(match[1], images);
    });
    if (!groups.size) return contents;
    const output = [], pattern = /https?:\/\/googleusercontent\.com\/image_collection\/image_retrieval\/(\d+)/g;
    for (const content of contents) {
      if (!["text", "markdown"].includes(content.type) || !content.content) { output.push(content); continue; }
      let cursor = 0, found = false, match;
      while ((match = pattern.exec(content.content))) {
        const group = groups.get(match[1]); if (!group) continue;
        const before = clean(content.content.slice(cursor, match.index)); if (before) output.push({ ...content, content: before });
        const images = [...group.values()].slice(0, 6); output.push({ type: "image_group", imageGroup: { images, columns: images.length <= 4 ? 2 : 3 } }); cursor = match.index + match[0].length; found = true;
      }
      if (!found) output.push(content); else { const tail = clean(content.content.slice(cursor)); if (tail) output.push({ ...content, content: tail }); }
    }
    return output;
  }

  function widgetContents(row, contents) {
    const widgets = new Map();
    walkArrays(valueAt(row, [3, 0, 0, 41], []), (record) => {
      const id = record[0]; if (typeof id !== "string" || !id.startsWith("im_") || widgets.has(id)) return;
      const html = record.find((item) => typeof item === "string" && /^(?:<!doctype\s+html|<html\b)/i.test(item.trim())); if (html) widgets.set(id, html.trim());
    });
    if (!widgets.size) return contents;
    const output = [], pattern = /```json\?chameleon\s*\n([\s\S]*?)\n```/gi;
    for (const content of contents) {
      if (!["text", "markdown"].includes(content.type) || !content.content) { output.push(content); continue; }
      let cursor = 0, found = false, match;
      while ((match = pattern.exec(content.content))) {
        let parsed; try { parsed = JSON.parse(match[1]); } catch { continue; }
        const id = parsed?.props?.id, html = widgets.get(id); if (!html) continue;
        const before = clean(content.content.slice(cursor, match.index)); if (before) output.push({ ...content, content: before });
        const height = Number.parseFloat(parsed?.props?.height) || 700; output.push({ type: "html_widget", content: html, title: "Gemini interactive widget", htmlWidget: { provider: "gemini", documentType: "document", resizeMode: "fixed", height: Math.max(40, Math.min(20000, height)) } }); cursor = match.index + match[0].length; found = true;
      }
      if (!found) output.push(content); else { const tail = clean(content.content.slice(cursor)); if (tail) output.push({ ...content, content: tail }); }
    }
    return output;
  }

  const SHOPPING_MARKER = /^http:\/\/googleusercontent\.com\/shopping_content\/\d+_(?:link|card|carousel|table)$/;
  const SHOPPING_LINK = /http:\/\/googleusercontent\.com\/shopping_content\/\d+_link/g;
  const SHOPPING_BLOCK = /http:\/\/googleusercontent\.com\/shopping_content\/\d+_(?:card|carousel|table)/g;

  function productFromRow(row, imageLimit = 3) {
    if (!Array.isArray(row)) return null;
    const title = clean(valueAt(row, [10], "")), url = valueAt(row, [12], "");
    if (!title || typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
    const images = Array.isArray(row[15])
      ? row[15].map((item) => valueAt(item, [0, 0, 0], "")).filter((item, index, all) => /^https?:\/\//.test(item) && all.indexOf(item) === index).slice(0, imageLimit)
      : [];
    const rating = Number(row[16]), reviewCount = Number(row[17]);
    return {
      title, url, price: clean(row[13]) || undefined,
      description: clean(row[14]) || undefined,
      image: images[0], images: images.length ? images : undefined,
      rating: Number.isFinite(rating) ? rating : undefined,
      reviewCount: Number.isFinite(reviewCount) ? reviewCount : undefined,
      brand: clean(row[20]) || undefined, merchant: clean(row[27]) || undefined,
    };
  }

  function productsIn(value) {
    const products = new Map();
    walkArrays(value, (row) => {
      const product = productFromRow(row, 1);
      if (product) products.set(`${product.url}\n${product.title}`, product);
    });
    return [...products.values()];
  }

  function shoppingTable(row) {
    if (!Array.isArray(row) || !Array.isArray(row[3]) || !Array.isArray(valueAt(row, [5, 1], null)) || !Array.isArray(valueAt(row, [5, 2], null))) return null;
    const attributes = row[5][2].map(clean).filter(Boolean), byKey = new Map(), byTitle = new Map();
    if (!attributes.length) return null;
    for (const item of row[3]) {
      const product = productFromRow(item, 1); if (!product) continue;
      const key = clean(item[19]); if (key) byKey.set(key, product); byTitle.set(product.title, product);
    }
    const products = [], values = [];
    for (const record of row[5][1]) {
      if (!Array.isArray(record) || !Array.isArray(record[2])) continue;
      const product = byKey.get(clean(record[0])) || byTitle.get(clean(record[1]));
      if (!product) continue;
      products.push(product); values.push(attributes.map((_attribute, index) => clean(record[2][index])));
    }
    return products.length >= 2 && values.length === products.length ? { products, attributes, values } : null;
  }

  function shoppingContents(row, value) {
    const data = valueAt(row, [3, 0, 0, 12, 15], null);
    if (!Array.isArray(data)) return null;
    const cards = new Map(), tables = new Map();
    walkArrays(data, (record) => {
      const marker = valueAt(record, [0, 0], "");
      if (typeof marker !== "string" || !SHOPPING_MARKER.test(marker)) return;
      if (marker.endsWith("_table")) {
        const table = shoppingTable(record); if (table) tables.set(marker, table);
      } else {
        const products = marker.endsWith("_carousel") ? productsIn(record) : [productFromRow(valueAt(record, [3, 0], null))].filter(Boolean);
        if (products.length) cards.set(marker, products);
      }
    });
    if (!cards.size && !tables.size) return null;
    const linked = value.replace(SHOPPING_LINK, (marker) => cards.get(marker)?.[0]?.url || marker), output = [];
    let cursor = 0, match;
    SHOPPING_BLOCK.lastIndex = 0;
    while ((match = SHOPPING_BLOCK.exec(linked))) {
      const marker = match[0], table = tables.get(marker), products = cards.get(marker);
      if (!table && !products?.length) continue;
      const before = clean(linked.slice(cursor, match.index)); if (before) output.push({ type: "markdown", content: before });
      if (table) output.push({ type: "shopping_table", shoppingTable: table });
      else for (const product of products) output.push({ type: "shopping_card", shoppingCard: product });
      cursor = match.index + marker.length; while (/\s/.test(linked[cursor] || "")) cursor += 1;
    }
    if (!cursor) return linked !== value ? [{ type: "markdown", content: linked }] : null;
    const tail = clean(linked.slice(cursor)); if (tail) output.push({ type: "markdown", content: tail });
    return output;
  }

  function assistantContentsForRow(row, answer) {
    const value = immersiveText(row, answer), shopping = shoppingContents(row, value);
    let contents = shopping || (value ? [{ type: "markdown", content: value }] : []);
    contents = contents.flatMap((content) => {
      if (!["text", "markdown"].includes(content.type) || !content.content) return [content];
      return youtubeContents(row, content.content) || [content];
    });
    contents = widgetContents(row, contents);
    contents = imageCollectionContents(row, contents);
    contents = inlineGeneratedImages(row, contents);
    return contents;
  }

  function timestamp(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    if (number > 1e15) return Math.floor(number / 1000);
    if (number < 1e12) return Math.floor(number * 1000);
    return Math.floor(number);
  }

  function parseTurn(row, index = 0) {
    if (!Array.isArray(row)) return null;
    const renderId = clean(valueAt(row, [0, 1], "")) || `gemini-turn-${index + 1}`;
    const createdAt = timestamp(valueAt(row, [4, 0], null));
    const question = clean(valueAt(row, [2, 0, 0], ""));
    const answer = clean(textParts(valueAt(row, [3, 0, 0, 1], [])).join("\n"));
    const thinking = clean(textParts(valueAt(row, [3, 0, 0, 37, 0, 0], [])).join("\n"));
    const userContents = attachmentContents(row);
    if (question) userContents.push({ type: "markdown", content: question });
    const assistantContents = [];
    if (thinking) assistantContents.push({ type: "thinking", content: thinking });
    assistantContents.push(...assistantContentsForRow(row, answer));
    if (!userContents.length && !assistantContents.length) return null;
    return {
      renderId,
      createdAt,
      model: clean(valueAt(row, [3, 21], "")) || "Gemini",
      userContents,
      assistantContents,
    };
  }

  function parsePage(payload) {
    if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
      throw Error("gemini_page_payload_invalid");
    }
    const rawItems = payload[0];
    const turns = rawItems.map(parseTurn).filter(Boolean).reverse();
    const cursor = typeof payload[1] === "string" && payload[1] ? payload[1] : null;
    return { rawCount: rawItems.length, turns, cursor };
  }

  function messagesFromTurns(turns) {
    const messages = [];
    for (const turn of turns) {
      if (turn.userContents.length) messages.push({
        id: `${turn.renderId}_user`, role: "user", createdAt: turn.createdAt,
        model: "gemini", contents: turn.userContents,
      });
      if (turn.assistantContents.length) messages.push({
        id: `${turn.renderId}_assistant`, role: "assistant", createdAt: turn.createdAt,
        model: turn.model, contents: turn.assistantContents,
      });
    }
    return messages;
  }

  global.MultiAIGeminiConversation = Object.freeze({
    PAGE_SIZE,
    parseBatchResponse,
    parsePage,
    parseTurn,
    messagesFromTurns,
  });
})(typeof self !== "undefined" ? self : globalThis);
