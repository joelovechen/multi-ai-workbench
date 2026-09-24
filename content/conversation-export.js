(function () {
  "use strict";
  if (top !== window || globalThis.__MAIW_CONVERSATION_EXTRACTOR__) return;
  globalThis.__MAIW_CONVERSATION_EXTRACTOR__ = 1;
  let extractionController = null;
  let extractionTaskId = "";
  const R = globalThis.MultiAIConversationExportPlatforms,
    s = (ms) => new Promise((r) => setTimeout(r, ms)),
    cl = (v) =>
      String(v ?? "")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    tm = (v) =>
      !v
        ? null
        : typeof v === "number"
          ? v < 1e12
            ? v * 1000
            : v
          : Date.parse(v) || null;
  const msg = (id, role, contents, createdAt, model) => ({
      id: String(id),
      role,
      createdAt: tm(createdAt),
      model,
      contents: contents.length
        ? contents
        : [{ type: "markdown", content: "" }],
    }),
    txt = (v, type = "markdown") => (cl(v) ? [{ type, content: cl(v) }] : []);
  async function retry(run, label = "request", attempts = 2) {
    let lastError;
    for (let index = 0; index < attempts; index += 1) {
      if (extractionController?.signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await run(index);
      } catch (error) {
        lastError = error;
        if (error?.name === "AbortError") throw error;
        if (index + 1 < attempts) await s(300 * (index + 1));
      }
    }
    throw lastError || Error(`${label}_failed`);
  }
  async function json(url, init = {}) {
    return retry(async () => {
      const r = await fetch(url, { credentials: "include", signal: extractionController?.signal, ...init });
      if (!r.ok) throw Error(`request_failed:${r.status}`);
      const data = await r.json();
      if (data == null || typeof data !== "object")
        throw Error("invalid_json_response");
      return data;
    });
  }
  function main(action, payload = {}, timeout = 15000) {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const listener = (e) => {
        if (e.detail?.id !== id) return;
        clearTimeout(timer);
        document.removeEventListener("maiw:main-response", listener, true);
        resolve(e.detail);
      };
      const timer = setTimeout(() => {
        document.removeEventListener("maiw:main-response", listener, true);
        resolve({ ok: false, reason: "main_world_timeout" });
      }, timeout);
      document.addEventListener("maiw:main-response", listener, true);
      document.dispatchEvent(
        new CustomEvent("maiw:main-request", {
          detail: { id, action, ...payload },
        }),
      );
    });
  }
  async function capture() {
    const r = await main("EXPORT_GET_CONTEXT");
    return r.ok ? r.context || {} : {};
  }
  const at = (value, path, fallback = null) => {
    try {
      let current = value;
      for (const key of path) current = current?.[key];
      return current ?? fallback;
    } catch {
      return fallback;
    }
  };
  function rpcPayload(text, rpc) {
    const found = [];
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (
        value[0] === "wrb.fr" &&
        value[1] === rpc &&
        typeof value[2] === "string"
      )
        found.push(JSON.parse(value[2]));
      for (const item of value) if (Array.isArray(item)) walk(item);
    };
    for (const line of String(text).split("\n")) {
      try {
        walk(JSON.parse(line));
      } catch {}
    }
    if (!found.length) {
      const re = new RegExp(
        `\\[\\s*"wrb\\.fr"\\s*,\\s*"${rpc}"\\s*,\\s*("(?:\\\\.|[^"\\\\])*")`,
      );
      const match = String(text).match(re);
      if (match) found.push(JSON.parse(JSON.parse(match[1])));
    }
    return found[0];
  }
  function notebookContents(value) {
    const sources = new Map(),
      cleaned = String(value || "").replace(/<a2ui-json>\s*([\s\S]*?)\s*<\/a2ui-json>/gi, (whole, payload) => {
        try {
          const rows = JSON.parse(payload);
          if (!Array.isArray(rows)) return whole;
          for (const row of rows) for (const component of row?.updateComponents?.components || []) {
            if (component?.component !== "SourceImportCard") continue;
            for (const source of component.sources || []) if (/^https?:\/\//i.test(source?.url || "")) {
              const url = source.url, domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
              sources.set(url, { title: cl(source.title || source.sourceName || domain || url), url, domain });
            }
          }
          return "";
        } catch {
          return whole;
        }
      }),
      contents = txt(cleaned);
    if (sources.size) contents.push({ type: "sources", sources: [...sources.values()] });
    return contents;
  }
  async function sapi(origin) {
    const cookie = (name) =>
        document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] || "",
      secure = /^(?:https:|chrome-extension:|moz-extension:)/.test(origin),
      primary = secure
        ? cookie("SAPISID") || cookie("__Secure-3PAPISID")
        : cookie("APISID") || cookie("__Secure-3PAPISID"),
      hashes = [];
    const digest = async (value, label) => {
      if (!value) return;
      const stamp = Math.floor(Date.now() / 1000),
        bytes = new TextEncoder().encode(`${stamp} ${value} ${origin}`),
        hash = [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
      hashes.push(`${label} ${stamp}_${hash}`);
    };
    await digest(primary, secure ? "SAPISIDHASH" : "APISIDHASH");
    if (secure) {
      await digest(
        cookie("__Secure-1PAPISID") || cookie("__1PSAPISID"),
        "SAPISID1PHASH",
      );
      await digest(
        cookie("__Secure-3PAPISID") || cookie("__3PSAPISID"),
        "SAPISID3PHASH",
      );
    }
    return hashes.join(" ");
  }
  function strings(value, out = []) {
    if (typeof value === "string" && cl(value)) out.push(cl(value));
    else if (Array.isArray(value)) for (const item of value) strings(item, out);
    return out;
  }
  function walk(value, visit, seen = new Set()) {
    if (value == null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    visit(value);
    for (const child of Array.isArray(value) ? value : Object.values(value))
      walk(child, visit, seen);
  }
  function sourcesFrom(value) {
    const found = new Map();
    walk(value, (row) => {
      if (Array.isArray(row)) return;
      const url = row.url || row.page_url || row.link || row.base?.url;
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
      const title = cl(
        row.title || row.siteName || row.name || row.base?.siteName || url,
      );
      if (!found.has(url)) found.set(url, { title, url });
    });
    return [...found.values()];
  }
  function imagesFrom(value, origin = "generated") {
    const found = new Map();
    walk(value, (row) => {
      if (Array.isArray(row)) return;
      const candidates = [
        row.imageUrl,
        row.image_url,
        row.fileUri,
        row.original,
        row.thumbnail,
        row.url,
      ];
      for (const url of candidates)
        if (
          typeof url === "string" &&
          /^https?:\/\//i.test(url) &&
          /image|img|thumbnail|usercontent|assets\.grok|rc_gen_image/i.test(
            `${url} ${row.type || ""} ${row.mime_type || row.fileMimeType || ""}`,
          )
        )
          found.set(url, { type: "image", imageUrl: url, imageOrigin: origin });
    });
    return [...found.values()];
  }
  function htmlMarkdown(value) {
    return cl(
      String(value || "")
        .replace(
          /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          (_match, url, label) => `[${String(label).replace(/<[^>]+>/g, "").trim() || url}](${url})`,
        )
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\uE200[\s\S]*?\uE201/g, "")
        .replace(/【[^】]*】/g, ""),
    );
  }
  function nodeMarkdown(element) {
    if (!element) return "";
    const render = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
      if (!(node instanceof Element)) return "";
      if (/^(SCRIPT|STYLE|BUTTON|SVG)$/i.test(node.tagName)) return "";
      if (node.hasAttribute("data-xpm-copy-root")) {
        const latex =
          node.getAttribute("data-xpm-latex") ||
          [...node.querySelectorAll("[data-xpm-latex]")]
            .map((item) => item.getAttribute("data-xpm-latex") || "")
            .filter(Boolean)
            .join("");
        if (latex) {
          const display = node.style?.display || node.getAttribute("style") || "";
          return /inline/i.test(display)
            ? `$${latex}$`
            : `\n\n$$\n${latex}\n$$\n\n`;
        }
      }
      const children = [...node.childNodes].map(render).join("");
      if (node.tagName === "IMG") {
        const url =
          [
            node.getAttribute("src"),
            node.currentSrc,
            node.getAttribute("data-src"),
            node.closest("a")?.getAttribute("href"),
          ].find((value) =>
            /^(?:https?:\/\/|data:image\/[\w.+-]+;base64,)/i.test(value || ""),
          ) || "";
        return /^https?:\/\/|^data:image\//i.test(url)
          ? `\n\n![${node.getAttribute("alt") || "image"}](${url})\n\n`
          : "";
      }
      if (node.tagName === "A") {
        const url = node.href || node.getAttribute("href") || "";
        const label = cl(children || node.getAttribute("aria-label") || url);
        return label && url ? `[${label}](${url})` : label;
      }
      if (node.tagName === "PRE") return `\n\n\`\`\`\n${cl(node.innerText)}\n\`\`\`\n\n`;
      if (node.tagName === "CODE") return `\`${children}\``;
      if (node.tagName === "BLOCKQUOTE")
        return `\n\n\`\`\`text\n${cl(node.textContent)}\n\`\`\`\n\n`;
      if (/^H[1-6]$/.test(node.tagName))
        return `\n\n${"#".repeat(Number(node.tagName[1]))} ${cl(children)}\n\n`;
      if (node.tagName === "LI") return `\n- ${cl(children)}`;
      if (node.tagName === "BR") return "\n";
      if (/^(P|DIV|SECTION|ARTICLE|UL|OL|TABLE|TR)$/.test(node.tagName))
        return `\n${children}\n`;
      return children;
    };
    return cl(render(element));
  }
  function googleAnswerContents(markdown) {
    const pattern = /!\[[^\]]*]\((https:\/\/lens\.usercontent\.google\.com\/banana[^)\s]*)\)/g,
      contents = [];
    let offset = 0,
      match;
    while ((match = pattern.exec(markdown))) {
      const before = cl(markdown.slice(offset, match.index));
      if (before) contents.push({ type: "markdown", content: before });
      contents.push({
        type: "image",
        imageUrl: match[1],
        imageOrigin: "generated",
      });
      offset = match.index + match[0].length;
    }
    const after = cl(markdown.slice(offset));
    if (after) contents.push({ type: "markdown", content: after });
    return contents;
  }
  function googleAnswerRoot(turnRoot, mainColumn) {
    const clone = mainColumn.cloneNode(true),
      containerIds = [...mainColumn.querySelectorAll("[data-container-id]")]
        .map((node) => node.getAttribute("data-container-id"))
        .filter((value) => value && value !== "main-col");
    for (const id of new Set(containerIds))
      for (const target of turnRoot.querySelectorAll("[data-target-container-id]"))
        if (target.getAttribute("data-target-container-id") === id)
          clone.append(target.cloneNode(true));
    return clone;
  }
  function chatgptWritingBlocks(contents, writingBlocks) {
    const out = [];
    for (const content of contents) {
      if (content.type !== "markdown" || !content.content.includes(":::writing")) {
        out.push(content);
        continue;
      }
      const pattern = /:::writing\{([^}]*)\}\s*\n([\s\S]*?)\n:::/g;
      let offset = 0,
        match;
      while ((match = pattern.exec(content.content))) {
        const before = cl(content.content.slice(offset, match.index));
        if (before) out.push({ type: "markdown", content: before });
        const attrs = Object.fromEntries(
            [...match[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g)].map(
              (item) => [item[1], item[2] || item[3] || item[4] || ""],
            ),
          ),
          block = attrs.id ? writingBlocks?.[attrs.id] : null;
        out.push({
          type: "writing_block",
          content: cl(block?.content || match[2]),
          title: block?.title || block?.metadata?.subject || attrs.title || attrs.subject || "",
          writingBlock: {
            id: attrs.id || "",
            variant: block?.variant || attrs.variant || "document",
            edited: block?.edited,
            updatedAt: block?.updated_at,
          },
        });
        offset = match.index + match[0].length;
      }
      const after = cl(content.content.slice(offset));
      if (after) out.push({ type: "markdown", content: after });
    }
    return out;
  }
  function chatgptReferenceContents(references) {
    const out = [];
    for (const reference of references || []) {
      if (reference?.type === "image_group") {
        const images = (reference.images || [])
          .map((item) => item?.image_result || item)
          .map((item) => ({
            imageUrl:
              item?.content_url ||
              item?.original_content_url ||
              item?.thumbnail_url ||
              "",
            thumbnailUrl: item?.thumbnail_url || "",
            linkUrl: item?.url || "",
            title: item?.title || "",
            width: item?.content_size?.width,
            height: item?.content_size?.height,
          }))
          .filter((item) => item.imageUrl);
        if (images.length)
          out.push({ type: "image_group", imageGroup: { images: images.slice(0, 12), columns: 3 } });
      }
      const products = reference?.type === "product_entity"
        ? [reference.product]
        : reference?.type === "products"
          ? reference.products || []
          : [];
      for (const product of products)
        if (product?.title)
          out.push({
            type: "shopping_card",
            shoppingCard: {
              title: product.title,
              url:
                product.url ||
                reference.safe_urls?.[0] ||
                `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(product.title)}`,
              price: product.price || "",
              description: product.description || "",
              image: product.image_urls?.[0] || "",
              rating: product.rating,
              reviewCount: product.num_reviews,
              merchant: product.merchants || "",
            },
          });
    }
    return out;
  }
  function grokCardContents(cards) {
    const generated = new Map();
    for (const raw of cards || []) {
      let card = raw;
      if (typeof raw === "string")
        try {
          card = JSON.parse(raw);
        } catch {
          continue;
        }
      const chunk = card?.image_chunk;
      if (chunk?.imageUrl && (card.cardType === "generated_image_card" || card.type === "render_generated_image")) {
        const key = `${card.id || "unknown"}:${chunk.imageIndex ?? chunk.imageUuid ?? chunk.imageUrl}`,
          previous = generated.get(key),
          score = (item) =>
            Number(!String(item?.image_chunk?.imageUrl || "").includes("-part-")) * 1e9 +
            Number(item?.image_chunk?.progress || 0) * 1e4 +
            Number(item?.image_chunk?.seq || 0);
        if (!previous || score(card) >= score(previous)) generated.set(key, card);
      }
    }
    const out = [];
    for (const card of [...generated.values()].sort(
      (a, b) => Number(a.image_chunk?.imageIndex || 0) - Number(b.image_chunk?.imageIndex || 0),
    )) {
      if (cl(card.image_chunk?.imagePrompt?.prompt || card.prompt))
        out.push({ type: "markdown", content: cl(card.image_chunk?.imagePrompt?.prompt || card.prompt) });
      const imageUrl = /^https?:\/\//i.test(card.image_chunk.imageUrl)
        ? card.image_chunk.imageUrl
        : `https://assets.grok.com/${String(card.image_chunk.imageUrl).replace(/^\//, "")}`;
      out.push({ type: "image", imageUrl, imageOrigin: "generated" });
    }
    return out;
  }
  function grokInlineContents(rawText, cards) {
    const cardMap = new Map();
    for (const raw of cards || []) {
      let card = raw;
      if (typeof raw === "string")
        try {
          card = JSON.parse(raw);
        } catch {
          continue;
        }
      const image = card?.image;
      if (
        typeof card?.id === "string" &&
        image &&
        (card.type === "render_searched_image" || card.cardType === "image_card") &&
        (image.original || image.thumbnail)
      )
        cardMap.set(card.id, card);
    }
    const out = [],
      pending = [],
      pattern = /<grok:render\b([^>]*)>[\s\S]*?<\/grok:render>/g,
      flushImages = () => {
        if (!pending.length) return;
        out.push({
          type: "image_group",
          imageGroup: {
            images: pending.splice(0),
            columns: 3,
            aspectRatio: "16 / 9",
          },
        });
      },
      addText = (value) => {
        const clean = cl(
          value
            .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$$$1$$$$")
            .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$"),
        );
        if (clean) out.push({ type: "markdown", content: clean });
      };
    let offset = 0,
      matched = false;
    for (const match of String(rawText || "").matchAll(pattern)) {
      const before = rawText.slice(offset, match.index),
        id = match[1]?.match(/\bcard_id\s*=\s*["']([^"']+)["']/)?.[1],
        card = id ? cardMap.get(id) : null;
      if (card) {
        if (cl(before)) {
          flushImages();
          addText(before);
        }
        const image = card.image,
          imageUrl = image.original || image.thumbnail;
        if (imageUrl && pending.length < 12) {
          pending.push({
            imageUrl,
            thumbnailUrl: image.thumbnail || "",
            linkUrl: image.link || "",
            title: image.title || image.source || "",
            width: image.original_width,
            height: image.original_height,
          });
          matched = true;
        }
      } else {
        flushImages();
        addText(before);
      }
      offset = (match.index || 0) + match[0].length;
    }
    flushImages();
    addText(String(rawText || "").slice(offset));
    if (!matched && !out.length) addText(rawText);
    return out;
  }
  function grokChunkImages(chunks) {
    const found = new Map();
    for (const chunk of chunks || []) {
      const image = chunk?.renderGeneratedImage?.imageChunk;
      if (!image?.imageUrl) continue;
      const key = `${chunk.renderGeneratedImage?.id || "unknown"}:${image.imageIndex ?? image.imageUuid ?? image.imageUrl}`,
        previous = found.get(key),
        score = (item) =>
          Number(!String(item?.imageUrl || "").includes("-part-")) * 1e9 +
          Number(item?.progress || 0) * 1e4 +
          Number(item?.seq || 0);
      if (!previous || score(image) >= score(previous)) found.set(key, image);
    }
    return [...found.values()]
      .sort((a, b) => Number(a.imageIndex || 0) - Number(b.imageIndex || 0))
      .map((image) => ({
        type: "image",
        imageUrl: /^https?:\/\//i.test(image.imageUrl)
          ? image.imageUrl
          : `https://assets.grok.com/${String(image.imageUrl).replace(/^\//, "")}`,
        imageOrigin: "generated",
      }));
  }
  function grokUploadedImages(files) {
    return (files || [])
      .filter((file) => file?.fileMimeType?.startsWith("image/") && file.fileUri)
      .map((file) => ({
        type: "image",
        imageUrl: /^https?:\/\//i.test(file.fileUri)
          ? file.fileUri
          : `https://assets.grok.com/${String(file.fileUri).replace(/^\//, "")}`,
        imageOrigin: "uploaded",
      }));
  }
  function uniqueContents(contents) {
    const seen = new Set();
    return contents.filter((content) => {
      const key =
        content.type === "image"
          ? `image:${content.imageUrl || content.url}`
          : content.type === "sources"
            ? `sources:${(content.sources || []).map((row) => row.url).join("|")}`
            : content.type === "image_group"
              ? `group:${(content.imageGroup?.images || []).map((row) => row.imageUrl).join("|")}`
              : "";
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function chatgptContents(message) {
    if (!message || message.metadata?.is_visually_hidden_from_conversation)
      return [];
    const role = message.author?.role,
      type = message.content?.content_type;
    if (
      role !== "user" &&
      !(role === "assistant" && message.recipient === "all") &&
      !(role === "tool" && type === "multimodal_text")
    )
      return [];
    let contents = [];
    for (const part of message.content?.parts || []) {
      if (typeof part === "string" && cl(part)) contents.push(...txt(part));
      else if (part?.content_type === "audio_transcription")
        contents.push(...txt(part.text));
      else if (part?.content_type === "image_asset_pointer") {
        const pointer = String(part.asset_pointer || "").replace(
          /^(?:sediment|file-service):\/\/file_/,
          "",
        );
        const image = /^https?:\/\//i.test(part.asset_pointer || "")
          ? part.asset_pointer
          : [...document.images].find((item) =>
              String(item.src || "").includes(pointer),
            )?.src;
        if (image)
          contents.push({
            type: "image",
            imageUrl: image,
            imageOrigin: role === "user" ? "uploaded" : "generated",
          });
      }
    }
    for (const file of message.metadata?.attachments || [])
      if (String(file.mime_type || "").startsWith("image/") && file.url)
        contents.push({
          type: "image",
          imageUrl: file.url,
          imageOrigin: "uploaded",
        });
      else contents.push({ type: "attachment", attachment: file });
    const sources = sourcesFrom(message.metadata?.content_references || []);
    if (sources.length) contents.push({ type: "sources", sources });
    contents = chatgptWritingBlocks(contents, message.metadata?.writing_blocks);
    contents.push(
      ...chatgptReferenceContents(message.metadata?.content_references),
    );
    return uniqueContents(contents);
  }
  function chatgptPath(data, leafId) {
    const nodes = Object.values(data.mapping || {}),
      root =
        data.mapping?.["client-created-root"] ||
        nodes.find((node) => node?.parent == null),
      reachable = new Set(),
      stack = root?.id ? [root.id] : [];
    while (stack.length) {
      const id = stack.pop();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      stack.push(...(data.mapping?.[id]?.children || []));
    }
    const leaves = [...reachable]
        .map((id) => data.mapping[id])
        .filter(
          (node) =>
            node?.message &&
            !(node.children || []).some((id) => reachable.has(id)),
        )
        .sort(
          (left, right) =>
            Number(right.message?.create_time || 0) -
            Number(left.message?.create_time || 0),
        ),
      leaf = data.mapping?.[leafId] || leaves[0];
    if (!leaf || !root) return [];
    return branch(
      nodes,
      "id",
      "parent",
      "message.create_time",
      leaf.id,
    ).filter((node) => reachable.has(node.id));
  }
  function chatgptMessages(data, id, leafId = data.current_node) {
    const path = chatgptPath(data, leafId),
      messages = [];
    let pending = [],
      ids = [];
    for (let index = 0; index < path.length; index += 1) {
      const node = path[index],
        message = node.message,
        next = path[index + 1]?.message,
        contents = chatgptContents(message);
      pending.push(...contents);
      ids.push(node.id);
      const closesTurn =
        message?.author?.role === "user" ||
        message?.end_turn === true ||
        next?.author?.role === "user" ||
        !next;
      if (!closesTurn || !pending.length) continue;
      const role = message?.author?.role === "user" ? "user" : "assistant";
      messages.push(
        msg(
          node.id,
          role,
          uniqueContents(pending),
          message?.create_time,
          message?.metadata?.model_slug ||
            message?.metadata?.default_model_slug ||
            data.default_model_slug ||
            "chatgpt",
        ),
      );
      messages[messages.length - 1].ids = [...ids];
      pending = [];
      ids = [];
    }
    return messages;
  }
  function chatgptConversation(data, id) {
    const nodes = Object.values(data.mapping || {}),
      leaves = nodes
        .filter((node) => node?.message && !(node.children || []).length)
        .sort((left, right) => {
          if (left.id === data.current_node) return -1;
          if (right.id === data.current_node) return 1;
          return Number(right.message?.create_time || 0) - Number(left.message?.create_time || 0);
        }),
      messageMap = new Map(),
      branches = [];
    for (let index = 0; index < leaves.length; index += 1) {
      const leaf = leaves[index],
        branchMessages = chatgptMessages(data, id, leaf.id);
      if (!branchMessages.length) continue;
      branchMessages.forEach((message) => {
        if (!messageMap.has(message.id)) messageMap.set(message.id, message);
      });
      branches.push({
        id: `branch-${leaf.id}`,
        title: `Branch ${index + 1}`,
        leafMessageId: branchMessages.at(-1)?.id || leaf.id,
        messageIds: branchMessages.map((message) => message.id),
      });
    }
    const requested = `branch-${data.current_node || leaves[0]?.id || "current"}`;
    return {
      messages: [...messageMap.values()].sort(
        (left, right) => (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0),
      ),
      branches,
      activeBranchId: branches.some((row) => row.id === requested)
        ? requested
        : branches[0]?.id || "",
    };
  }
  async function resolveChatgptShareImages(data) {
    const conversationId = data.conversation_id;
    if (!conversationId) return data;
    const cache = new Map(),
      resolvePointer = async (pointer) => {
        if (/^https?:\/\//i.test(pointer || "")) return pointer;
        const raw = String(pointer || "")
            .replace(/^sediment:\/\//, "")
            .replace(/^file-service:\/\//, ""),
          separator = raw.indexOf("?"),
          fileId = (separator < 0 ? raw : raw.slice(0, separator)).trim();
        if (!fileId.startsWith("file_")) return "";
        const params = new URLSearchParams(
          separator < 0 ? "" : raw.slice(separator + 1),
        );
        if (!params.has("shared_conversation_id"))
          params.set("shared_conversation_id", conversationId);
        const endpoint = `/backend-api/files/download/${encodeURIComponent(fileId)}?${params}`;
        if (!cache.has(endpoint))
          cache.set(
            endpoint,
            json(endpoint)
              .then((result) =>
                result.status === "success" ? result.download_url || "" : "",
              )
              .catch(() => ""),
          );
        return cache.get(endpoint);
      },
      tasks = [];
    for (const node of Object.values(data.mapping || {})) {
      const message = node?.message;
      for (const part of message?.content?.parts || [])
        if (
          part?.content_type === "image_asset_pointer" &&
          typeof part.asset_pointer === "string"
        )
          tasks.push(
            resolvePointer(part.asset_pointer).then((url) => {
              if (url) part.asset_pointer = url;
            }),
          );
      for (const attachment of message?.metadata?.attachments || [])
        if (
          String(attachment?.mime_type || "").startsWith("image/") &&
          typeof attachment?.id === "string" &&
          !attachment.url
        )
          tasks.push(
            resolvePointer(attachment.id).then((url) => {
              if (url) attachment.url = url;
            }),
          );
    }
    await Promise.all(tasks);
    return data;
  }
  function turboDeferred() {
    const value = {};
    value.promise = new Promise((resolve, reject) => {
      value.resolve = resolve;
      value.reject = reject;
    });
    return value;
  }
  function turboHydrate(index, state) {
    if (typeof index === "number" && index < 0) {
      if (index === -1) return undefined;
      if (index === -2) return NaN;
      if (index === -3) return -Infinity;
      if (index === -4) return -0;
      if (index === -5) return null;
      if (index === -6) return Infinity;
      if (index === -7) return undefined;
    }
    if (typeof index !== "number") return index;
    if (Object.prototype.hasOwnProperty.call(state.hydrated, index))
      return state.hydrated[index];
    const raw = state.values[index];
    if (raw == null || typeof raw !== "object")
      return (state.hydrated[index] = raw);
    if (Array.isArray(raw)) {
      if (typeof raw[0] === "string") {
        const [tag, first, second] = raw;
        if (tag === "D") return (state.hydrated[index] = new Date(first));
        if (tag === "U") return (state.hydrated[index] = new URL(first));
        if (tag === "B") return (state.hydrated[index] = BigInt(first));
        if (tag === "R")
          return (state.hydrated[index] = new RegExp(first, second));
        if (tag === "P") {
          if (Object.prototype.hasOwnProperty.call(state.hydrated, first))
            return (state.hydrated[index] = state.hydrated[first]);
          const pending = state.deferred[first] || turboDeferred();
          state.deferred[first] = pending;
          return (state.hydrated[index] = pending.promise);
        }
        if (tag === "E") {
          const error = new Error(first);
          error.stack = second;
          return (state.hydrated[index] = error);
        }
        if (tag === "Z")
          return (state.hydrated[index] = turboHydrate(first, state));
        if (tag === "S") {
          const set = new Set();
          state.hydrated[index] = set;
          for (let offset = 1; offset < raw.length; offset += 1)
            set.add(turboHydrate(raw[offset], state));
          return set;
        }
        if (tag === "M") {
          const map = new Map();
          state.hydrated[index] = map;
          for (let offset = 1; offset < raw.length; offset += 2)
            map.set(
              turboHydrate(raw[offset], state),
              turboHydrate(raw[offset + 1], state),
            );
          return map;
        }
        if (tag === "N") {
          const object = Object.create(null);
          state.hydrated[index] = object;
          for (const [key, value] of Object.entries(first || {}))
            object[turboHydrate(Number(key.slice(1)), state)] = turboHydrate(
              value,
              state,
            );
          return object;
        }
        if (tag === "SingleFetchClassInstance")
          return (state.hydrated[index] = turboHydrate(first, state));
        if (tag === "SingleFetchFallback")
          return (state.hydrated[index] = undefined);
        if (tag === "SingleFetchRedirect")
          return (state.hydrated[index] = { redirect: turboHydrate(first, state) });
        if (tag === "SanitizedError") {
          const message = turboHydrate(second, state),
            error = new Error(message);
          error.name = turboHydrate(first, state) || "Error";
          error.stack = turboHydrate(raw[3], state);
          return (state.hydrated[index] = error);
        }
        throw Error(`unsupported_turbo_tag:${tag}`);
      }
      const array = [];
      state.hydrated[index] = array;
      for (let offset = 0; offset < raw.length; offset += 1)
        if (raw[offset] !== -1)
          array[offset] = turboHydrate(raw[offset], state);
      return array;
    }
    const object = {};
    state.hydrated[index] = object;
    for (const [key, value] of Object.entries(raw))
      object[turboHydrate(Number(key.slice(1)), state)] = turboHydrate(
        value,
        state,
      );
    return object;
  }
  async function parseChatgptShareHtml(html) {
    const pattern =
        /(?:window\.)?__reactRouterContext\.streamController\.enqueue\(("(?:\\.|[^"\\])*")\);/g,
      chunks = [];
    for (const match of String(html).matchAll(pattern)) chunks.push(JSON.parse(match[1]));
    if (!chunks.length) throw Error("share_stream_chunks_missing");
    const lines = chunks.join("").split("\n").filter(Boolean),
      state = { values: [], hydrated: [], deferred: {} };
    if (!lines.length) throw Error("share_stream_empty");
    state.values.push(...JSON.parse(lines.shift()));
    const root = turboHydrate(0, state);
    for (const line of lines) {
      const separator = line.indexOf(":"),
        prefix = line[0],
        id = Number(line.slice(1, separator)),
        pending = state.deferred[id];
      if (!pending || separator < 2) continue;
      try {
        const added = JSON.parse(line.slice(separator + 1));
        let value;
        if (typeof added === "number") value = turboHydrate(added, state);
        else {
          const start = state.values.length;
          state.values.push(...added);
          value = turboHydrate(start, state);
        }
        prefix === "P" ? pending.resolve(value) : pending.reject(value);
      } catch (error) {
        pending.reject(error);
      }
    }
    const loaderData = root?.loaderData;
    if (!loaderData || typeof loaderData !== "object")
      throw Error("share_loader_data_missing");
    const routeKey = Object.keys(loaderData).find((key) =>
      key.startsWith("routes/share."),
    );
    if (!routeKey) throw Error("share_route_data_missing");
    const response = await loaderData[routeKey]?.serverResponse,
      data = response?.data;
    if (response?.type !== "data" || !data?.mapping)
      throw Error("share_conversation_data_invalid");
    return data;
  }
  function claudeCoworkMessages(events, sessionId) {
    const rows = [...events].sort(
        (left, right) => Number(left.sequence_num) - Number(right.sequence_num),
      ),
      isClientUser = (event) => {
        const message = event.payload?.message,
          content = message?.content;
        return (
          event.event_type === "user" &&
          event.source === "client" &&
          message?.role === "user" &&
          event.payload?.shouldQuery !== false &&
          event.payload?.session_id === sessionId &&
          !(
            typeof content === "string" &&
            /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(content)
          )
        );
      },
      firstUser = rows.findIndex(isClientUser),
      scoped = firstUser >= 0 ? rows.slice(firstUser) : rows,
      questions = new Map(),
      answers = new Map(),
      files = new Map(),
      out = [];
    for (const event of scoped) {
      const content = event.payload?.message?.content;
      if (
        event.event_type === "assistant" &&
        event.source === "worker" &&
        Array.isArray(content)
      )
        for (const item of content) {
          if (item.type === "tool_use" && item.name === "AskUserQuestion" && item.id)
            questions.set(item.id, item.input?.questions || []);
          if (item.type === "tool_use" && item.name === "Write") {
            const path = item.input?.file_path,
              body = item.input?.content;
            if (typeof path === "string" && typeof body === "string")
              files.set(path, body);
          }
        }
      const result = event.payload?.tool_use_result;
      if (result?.answers && typeof result.answers === "object")
        for (const item of Array.isArray(content) ? content : [])
          if (item.type === "tool_result" && questions.has(item.tool_use_id))
            answers.set(item.tool_use_id, result.answers);
      if (typeof result?.filePath === "string" && typeof result?.content === "string")
        files.set(result.filePath, result.content);
    }
    const add = (event, role, contents) => {
      if (!contents.length) return;
      const previous = out[out.length - 1];
      if (previous?.role === role) {
        previous.contents.push(...contents);
        previous.updatedAt = Math.max(
          Number(previous.updatedAt) || 0,
          tm(event.created_at) || 0,
        );
        return;
      }
      const message = msg(
        `claude_cowork_${event.event_id || event.sequence_num}`,
        role,
        contents,
        event.created_at,
        "claude",
      );
      message.updatedAt = tm(event.created_at);
      out.push(message);
    };
    for (const event of scoped) {
      const message = event.payload?.message,
        content = message?.content,
        result = event.payload?.tool_use_result;
      if (isClientUser(event)) {
        add(
          event,
          "user",
          blocks(
            Array.isArray(content)
              ? content
              : [{ type: "text", text: content }],
          ),
        );
        continue;
      }
      if (
        event.event_type === "assistant" &&
        event.source === "worker" &&
        message?.role === "assistant" &&
        Array.isArray(content)
      ) {
        const assistant = [];
        for (const item of content)
          if (item.type === "text") assistant.push(...txt(item.text));
          else if (item.type === "tool_use" && item.name === "AskUserQuestion") {
            const prompts = questions.get(item.id) || [],
              answered = answers.has(item.id),
              markdown = prompts
                .flatMap((question) => {
                  const title = cl(question.question);
                  if (!title) return [];
                  const options = (question.options || [])
                    .map((option) => cl(option.label))
                    .filter(Boolean);
                  return [
                    `**${title}**${answered || !options.length ? "" : `\n\n${options.map((option) => `- ${option}`).join("\n")}`}`,
                  ];
                })
                .join("\n\n");
            assistant.push(...txt(markdown));
          }
        add(event, "assistant", assistant);
        continue;
      }
      if (event.event_type === "user" && event.source === "worker") {
        if (result?.artifact_id && typeof result.path === "string") {
          const html = files.get(result.path);
          if (html && /\.html?$/i.test(result.path)) {
            add(event, "assistant", [
              {
                type: "html_widget",
                content: html.replace(
                  /<link\b[^>]*href=["']https:\/\/(?:font\.|fonts\.)[^>]+>/gi,
                  "",
                ),
                title: result.title || "",
                htmlWidget: {
                  provider: "claude",
                  documentType: "document",
                  resizeMode: "auto",
                },
              },
            ]);
          }
        }
        for (const item of Array.isArray(content) ? content : []) {
          if (!item.tool_use_id || !answers.has(item.tool_use_id)) continue;
          const answer = Object.values(answers.get(item.tool_use_id))
            .flatMap((value) => (Array.isArray(value) ? value : [value]))
            .map(cl)
            .filter(Boolean)
            .join("\n");
          add(event, "user", txt(answer));
        }
      }
    }
    return out;
  }
  function perplexityContents(blocksValue) {
    if (!Array.isArray(blocksValue)) return [];
    const contents = [],
      webResults = blocksValue.flatMap((block) =>
        block?.intended_usage === "web_results"
          ? block.web_result_block?.web_results || []
          : [],
      ),
      sources = new Map(),
      images = new Set(),
      primary = [],
      fallback = [],
      workflow = [],
      plans = [];
    const clean = (value) =>
        typeof value === "string" && value.trim() ? value.trim() : "",
      collectMedia = (items) => {
        for (const item of items || []) {
          const url = item?.medium === "image" ? clean(item.image) : "";
          if (url && !images.has(url)) {
            images.add(url);
            contents.push({ type: "image", imageUrl: url, imageOrigin: "web" });
          }
        }
      },
      collectSources = (items) => {
        for (const item of items || []) {
          const url = clean(item?.url);
          if (!/^https?:\/\//i.test(url) || sources.has(url)) continue;
          let domain = clean(
            item.meta_data?.citation_domain_name || item.meta_data?.domain_name,
          );
          try {
            domain ||= new URL(url).hostname.replace(/^www\./, "");
          } catch {}
          sources.set(url, {
            title: clean(item.name || item.title) || domain || url,
            url,
            domain,
          });
        }
      };
    for (const block of blocksValue) {
      const usage = typeof block?.intended_usage === "string" ? block.intended_usage : "";
      if (usage === "media_items") collectMedia(block.media_block?.media_items);
      else if (usage.startsWith("ask_text")) {
        const answer = clean(block.markdown_block?.answer);
        if (answer) (usage === "ask_text" ? primary : fallback).push(answer);
        collectMedia(block.markdown_block?.media_items);
      } else if (usage === "workflow_root") {
        for (const step of block.workflow_block?.steps || [])
          for (const item of step.items || [])
            if (item.type === "WORKFLOW_ITEM_SOURCES")
              collectSources(item.payload?.sources_payload?.sources);
            else if (item.type === "WORKFLOW_ITEM_TEXT") {
              const payload = item.payload?.text_payload,
                answer = clean(payload?.text);
              if ((item.variant === "answer" || payload?.variant === "answer") && answer)
                workflow.push(answer);
            }
      } else if (usage === "plan")
        for (const goal of block.plan_block?.goals || [])
          if (goal.final === true && clean(goal.description))
            plans.push(clean(goal.description));
    }
    const answer =
      primary[0] ||
      fallback[0] ||
      (workflow.length ? workflow.join("\n\n") : "") ||
      plans.at(-1) ||
      "";
    if (answer) {
      const cited = answer.replace(/\[(\d+)\]/g, (match, value) => {
        const result = webResults[Number(value) - 1],
          url = result?.url;
        if (!/^https?:\/\//i.test(url || "")) return match;
        let label =
          result.meta_data?.citation_domain_name ||
          result.meta_data?.domain_name ||
          "";
        try {
          const target = new URL(url);
          target.searchParams.set("share_frome", "aipt");
          label ||= target.hostname.replace(/^www\./, "");
          return `[${label}](${target})`;
        } catch {
          return match;
        }
      });
      contents.push({ type: "markdown", content: cited });
    }
    if (sources.size)
      contents.push({ type: "sources", sources: [...sources.values()] });
    return contents;
  }
  function doubaoImageKey(url) {
    try {
      return new URL(url).pathname.split("~")[0];
    } catch {
      return String(url || "").split("?")[0];
    }
  }
  function doubaoPushImage(contents, seen, url, origin, access) {
    const clean = String(url || "").trim().replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(clean)) return;
    const key = doubaoImageKey(clean);
    if (seen.has(key)) return;
    seen.add(key);
    contents.push({
      type: "image",
      imageUrl: clean,
      imageOrigin: origin,
      imageAccess: access,
    });
  }
  function doubaoTextContents(value, contents, seen) {
    const text = String(value || ""),
      pattern =
        /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)|<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    let offset = 0,
      match;
    while ((match = pattern.exec(text))) {
      const before = cl(text.slice(offset, match.index));
      if (before) contents.push({ type: "markdown", content: before });
      const url = match[1] || match[2] || "",
        generated = url.includes("rc_gen_image");
      doubaoPushImage(
        contents,
        seen,
        url,
        generated ? "generated" : "web",
        generated ? "private" : "public",
      );
      offset = match.index + match[0].length;
    }
    const after = cl(text.slice(offset));
    if (after) contents.push({ type: "markdown", content: after });
  }
  function doubaoGeneratedUrls(value, out = [], seen = new Set()) {
    if (typeof value === "string") {
      for (const match of value.matchAll(
        /https?:\/\/[^\s"'\\)<\]>]*rc_gen_image[^\s"'\\)<\]>]*/g,
      ))
        out.push(match[0].replace(/\\u0026/g, "&"));
      return out;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return out;
    seen.add(value);
    if (Array.isArray(value))
      for (const item of value) doubaoGeneratedUrls(item, out, seen);
    else
      for (const [key, item] of Object.entries(value))
        if (!/icon|logo/i.test(key)) doubaoGeneratedUrls(item, out, seen);
    return out;
  }
  function doubaoSources(blocksValue) {
    const sources = new Map(),
      visit = (value, seen = new Set()) => {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
          for (const item of value) visit(item, seen);
          return;
        }
        const card = value.text_card;
        if (card?.url && !sources.has(card.url)) {
          let domain = card.sitename || card.site_name || "";
          try {
            domain ||= new URL(card.url).hostname;
          } catch {}
          sources.set(card.url, {
            title: card.title || domain || card.url,
            url: card.url,
            domain,
          });
        }
        for (const item of Object.values(value)) visit(item, seen);
      };
    for (const block of blocksValue || [])
      if (block.content?.search_query_result_block)
        visit(block.content.search_query_result_block);
    return [...sources.values()];
  }
  function done(p, x, method = "site-api") {
    const messages = (x.messages || []).filter((m) =>
      m.contents?.some(
        (c) =>
          cl(c.content) ||
          c.url ||
          c.imageUrl ||
          c.attachment ||
          c.sources?.length ||
          c.imageGroup?.images?.length ||
          c.videoBlocks?.length ||
          c.shoppingCard ||
          c.shoppingTable ||
          c.htmlWidget ||
          c.chart ||
          c.writingBlock ||
          c.fileChanges,
      ),
    );
    if (!messages.length) throw Error("conversation_not_found");
    return {
      id: x.id || location.pathname,
      platform: p.id,
      platformName: p.name,
      title: cl(x.title) || cl(document.title) || `${p.name} conversation`,
      sourceUrl: location.href,
      exportedAt: Date.now(),
      completeness: x.partial ? "partial" : "complete",
      warnings: x.partial
        ? ["未能证明更早内容已全部加载，本次导出可能不完整。"]
        : [],
      extraction: {
        state: "ready",
        method,
        reachedTop: !!x.reachedTop,
        stable: !!x.stable,
      },
      activeBranchId: cl(x.activeBranchId),
      branches: Array.isArray(x.branches) ? x.branches : [],
      messages,
    };
  }
  function branch(
    rows,
    id = "id",
    parent = "parentId",
    time = "createTime",
    leafId,
  ) {
    const field = (row, key) =>
      String(key)
        .split(".")
        .reduce((value, part) => value?.[part], row),
      rowId = (row) => field(row, id),
      parentId = (row) => field(row, parent),
      rowTime = (row) => field(row, time);
    const map = new Map(rows.map((x) => [rowId(x), x])),
      parents = new Set(rows.map(parentId).filter(Boolean));
    let row =
        map.get(leafId) ||
        rows
          .filter((x) => !parents.has(rowId(x)))
          .sort((a, b) => (tm(rowTime(b)) || 0) - (tm(rowTime(a)) || 0))[0],
      out = [],
      seen = new Set();
    while (row && !seen.has(rowId(row))) {
      seen.add(rowId(row));
      out.push(row);
      row = map.get(parentId(row));
    }
    return out.reverse();
  }
  function blocks(items, fallback = "", refs = null) {
    const out = [];
    const references = new Map();
    for (const row of [
      ...(refs?.searchChunks || []),
      ...(refs?.usedSearchChunks || []),
    ])
      if (row?.id != null && row?.base?.url)
        references.set(String(row.id), row.base);
    for (const block of items || [])
      if (block?.tool?.contents)
        for (const content of block.tool.contents) {
          const result = content?.searchResult;
          if (result?.id != null && result?.base?.url)
            references.set(String(result.id), result.base);
        }
    for (const b of items || []) {
      const thinking =
          b?.think?.content ||
          (b?.type === "thinking" ? b?.thinking : "") ||
          b?.thinking_content,
        rawText =
          b?.text?.content ||
          (typeof b?.text === "string" ? b.text : "") ||
          (typeof b?.content === "string" ? b.content : ""),
        text = String(rawText || "").replace(/\[\^(\d+)\^\]/g, (_m, id) => {
          const source = references.get(id);
          return source
            ? `[${source.siteName || source.title || id}](${source.url})`
            : "";
        });
      if (typeof thinking === "string" && cl(thinking))
        out.push({ type: "thinking", content: cl(thinking) });
      if (typeof text === "string" && cl(text))
        out.push({ type: "markdown", content: cl(text) });
      if (b?.type === "image" && b?.source?.data)
        out.push({
          type: "image",
          imageUrl: `data:${b.source.media_type || "image/png"};base64,${b.source.data}`,
          imageOrigin: "uploaded",
        });
      if (b?.file) {
        const ext = String(b.file.meta?.ext || "").toLowerCase(),
          mimeTypes = {
            png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
            webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
            svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain",
            md: "text/markdown", csv: "text/csv", doc: "application/msword",
            docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            xls: "application/vnd.ms-excel",
            xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ppt: "application/vnd.ms-powerpoint",
            pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
          size = Number(b.file.meta?.sizeBytes || b.file.size || 0),
          url = b.file.blob?.signUrl ||
            b.file.parseResult?.thumbnail?.previewUrl ||
            b.file.parseResult?.thumbnail?.thumbnailUrl ||
            b.file.parseResult?.thumbnail?.mobileThumbnailUrl ||
            b.file.url;
        out.push({
          type: "attachment",
          attachment: {
            id: b.file.id || b.id || "kimi-file",
            name: b.file.meta?.name || b.file.name || "attachment",
            size: Number.isFinite(size) ? size : 0,
            file_token_size: Number.isFinite(size) ? size : 0,
            mime_type: mimeTypes[ext] ||
              (b.file.meta?.type === "FILE_TYPE_IMAGE" ? (ext ? `image/${ext}` : "image/*") : "application/octet-stream"),
            source: "kimi",
            url,
            is_big_paste: false,
          },
        });
      }
      if (b?.type === "tool_use" && b?.name === "artifacts" && b.input?.content)
        out.push({
          type: "code",
          language: b.input.language || b.input.type || "text",
          content: cl(b.input.content),
        });
      if (
        b?.type === "tool_use" &&
        b?.name === "chart_display_v0" &&
        ["line", "bar"].includes(b.input?.style) &&
        Array.isArray(b.input?.series)
      )
        out.push({
          type: "chart",
          chart: {
            title: b.input.title || "",
            style: b.input.style,
            series: b.input.series,
            xAxis: b.input.x_axis || {},
            yAxis: b.input.y_axis || {},
          },
        });
      if (
        b?.type === "tool_use" &&
        (b?.name === "visualize:show_widget" ||
          b?.message === "show_widget" ||
          b?.input?.widget_code)
      ) {
        const widget = cl(b.input?.widget_code || b.input?.code || "");
        if (widget)
          out.push({
            type: "html_widget",
            content: widget,
            title: b.input?.title || "",
            htmlWidget: {
              provider: "claude",
              documentType: "fragment",
              resizeMode: "auto",
            },
          });
      }
      if (b?.type === "tool_result") {
        for (const item of Array.isArray(b.content) ? b.content : []) {
          if (item?.type === "text" && cl(item.text))
            out.push({ type: "markdown", content: cl(item.text) });
          out.push(...imagesFrom(item, "web"));
          if (item?.type === "image_gallery") {
            const images = (item.images || [])
              .filter((image) => /^https?:\/\//.test(image?.url || ""))
              .map((image) => ({
                imageUrl: image.url,
                thumbnailUrl: image.thumbnail_url || "",
                linkUrl: image.page_url || "",
                title: image.title || image.source || "",
                width: image.width,
                height: image.height,
              }));
            if (images.length)
              out.push({
                type: "image_group",
                imageGroup: { images: images.slice(0, 12), columns: Math.min(3, images.length) },
              });
          }
        }
      }
    }
    const sources = sourcesFrom(items);
    if (sources.length) out.push({ type: "sources", sources });
    return out.length ? out : txt(fallback);
  }
  const A = {
    async deepseek(p) {
      const id = location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/i)?.[1];
      let token;
      try {
        token = JSON.parse(localStorage.userToken || "null")?.value;
      } catch {}
      if (!id) throw Error("conversation_id_missing");
      if (!token) throw Error("login_required");
      const d = await json(
          `/api/v0/chat/history_messages?chat_session_id=${id}&cache_version=0`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        rows = d?.data?.biz_data?.chat_messages || [],
        session = d?.data?.biz_data?.chat_session || {},
        map = new Map(rows.map((x) => [x.message_id, x])),
        path = [],
        seen = new Set();
      if (!Array.isArray(rows) || !session || typeof session !== "object")
        throw Error("invalid_conversation_response");
      let cur = session.current_message_id;
      while (cur != null && !seen.has(cur)) {
        const x = map.get(cur);
        if (!x) break;
        seen.add(cur);
        path.push(x);
        cur = x.parent_id;
      }
      if (cur != null && seen.has(cur)) throw Error("conversation_branch_cycle");
      const messages = path
        .reverse()
        .filter((x) => x.status === "FINISHED")
        .map((x) => {
          let c = [];
          if (cl(x.thinking_content))
            c.push({ type: "thinking", content: cl(x.thinking_content) });
          c.push(
            ...txt(
              [
                (x.files || []).map((f) => `[文件: ${f.file_name}]`).join("\n"),
                x.content,
              ]
                .filter(Boolean)
                .join("\n\n"),
            ),
          );
          return msg(
            `${id}_${x.message_id}`,
            x.role === "USER" ? "user" : "assistant",
            c,
            x.inserted_at,
            "deepseek",
          );
        });
      return done(p, { id, title: session.title, messages });
    },
    async chatgpt(p) {
      const id = location.pathname.match(
        /\/(?:c|g|gg|share)\/([a-f0-9-]+)/i,
      )?.[1];
      if (!id) throw Error("conversation_id_missing");
      const isShare = /^\/share\//i.test(location.pathname);
      if (isShare) {
        const result = await main("EXPORT_CHATGPT_SHARE_DATA", {}, 5000);
        let shareData = result.ok ? result.data : null;
        if (!shareData) {
          const response = await fetch(location.href, {
            credentials: "include",
            signal: extractionController?.signal,
            headers: { Accept: "text/html" },
          });
          if (!response.ok) throw Error(`share_page_request_failed:${response.status}`);
          shareData = await parseChatgptShareHtml(await response.text());
        }
        const data = await resolveChatgptShareImages(shareData),
          tree = chatgptConversation(data, id);
        return done(p, {
          id: data.conversation_id || id,
          title: data.title,
          ...tree,
        });
      }
      const captured = (await capture()).chatgpt || {};
      let token = String(captured.authorization || "").replace(/^Bearer\s+/i, "");
      try {
        token ||=
          (await json("/api/auth/session?unstable_client=true")).accessToken ||
          "";
      } catch {}
      const h = { Accept: "application/json", ...(captured.extraHeaders || {}) };
      if (token) h.Authorization = `Bearer ${token}`;
      const did = document.cookie.match(/(?:^|;\s*)oai-did=([^;]+)/)?.[1];
      if (did) h["oai-device-id"] = did;
      const d = await json(`/backend-api/conversation/${id}`, { headers: h });
      if (!d.mapping || typeof d.mapping !== "object")
        throw Error("invalid_conversation_response");
      const tree = chatgptConversation(d, id);
      return done(p, { id, title: d.title, ...tree });
    },
    async claude(p) {
      const share = location.pathname.match(/^\/share\/([A-Za-z0-9_-]+)/)?.[1],
        cowork = location.pathname.match(/^\/cowork\/(cse_[A-Za-z0-9_-]+)/)?.[1],
        chat = location.pathname.match(/\/chat\/([a-f0-9-]+)/i)?.[1],
        id = share || cowork || chat;
      let org = decodeURIComponent(
          document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1] || "",
        );
      if (!id) throw Error("conversation_id_missing");
      if (share && !org)
        try {
          const suffix = `/chat_snapshots/${encodeURIComponent(share)}`;
          for (const entry of [...performance.getEntriesByType("resource")].reverse()) {
            const target = new URL(entry.name);
            if (!target.pathname.endsWith(suffix)) continue;
            const match = target.pathname.match(
              /^\/api\/organizations\/([^/]+)\/chat_snapshots\//,
            );
            if (match) {
              org = decodeURIComponent(match[1]);
              break;
            }
          }
        } catch {}
      if (!org && !cowork) throw Error("login_required");
      if (cowork) {
        const events = new Map(),
          seen = new Set();
        let cursor = "",
          completed = false;
        for (let page = 0; page < 100; page += 1) {
          const url = new URL(`/v1/code/sessions/${cowork}/events`, location.origin);
          url.searchParams.set("limit", cursor ? "500" : "100");
          if (cursor) url.searchParams.set("cursor", cursor);
          const data = await json(url.href, {
            headers: {
              Accept: "*/*",
              "anthropic-beta": "ccr-byoc-2025-07-29",
              "anthropic-client-feature": "ccr",
              "anthropic-client-platform": "web_claude_ai",
              "anthropic-client-version": "1.0.0",
              "anthropic-version": "2023-06-01",
              ...(org ? { "x-organization-uuid": org } : {}),
            },
          });
          if (!Array.isArray(data.data)) throw Error("claude_cowork_page_invalid");
          for (const event of data.data)
            events.set(
              event.event_id || `${event.sequence_num}:${event.event_type}`,
              event,
            );
          if (!data.next_cursor || !data.data.length) {
            completed = true;
            break;
          }
          if (seen.has(data.next_cursor))
            throw Error("claude_cowork_pagination_repeated");
          seen.add(data.next_cursor);
          cursor = data.next_cursor;
        }
        if (!completed) throw Error("claude_cowork_pagination_limit");
        const messages = claudeCoworkMessages([...events.values()], cowork);
        return done(p, { id: cowork, title: "Claude Cowork", messages });
      }
      if (share) {
        const d = await json(
            `/api/organizations/${encodeURIComponent(org)}/chat_snapshots/${encodeURIComponent(share)}?rendering_mode=messages&render_all_tools=true`,
          ),
          rows = [...(d.chat_messages || [])].sort(
            (a, b) => Number(a.index) - Number(b.index),
          ),
          messages = rows.flatMap((x) => {
            if (x.truncated || !["human", "assistant"].includes(x.sender))
              return [];
            const contents = blocks(x.content);
            return contents.length
              ? [
                  msg(
                    `claude_${x.uuid}`,
                    x.sender === "human" ? "user" : "assistant",
                    contents,
                    x.created_at,
                    "claude",
                  ),
                ]
              : [];
          });
        if (!d.uuid || !Array.isArray(d.chat_messages))
          throw Error("invalid_conversation_response");
        return done(p, { id: share, title: d.snapshot_name, messages });
      }
      const d = await json(
          `/api/organizations/${org}/chat_conversations/${chat}?tree=True&rendering_mode=messages&render_all_tools=true`,
        ),
        rows = d.chat_messages || [],
        path = branch(
          rows,
          "uuid",
          "parent_message_uuid",
          "updated_at",
          d.current_leaf_message_uuid,
        ),
        messages = path.flatMap((x) => {
          if (x.truncated) return [];
          const c = blocks(x.content);
          for (const f of x.files || []) {
            const url = f.preview_url || f.thumbnail_url || f.preview_asset?.url;
            if (f.file_kind === "image" && url)
              c.push({
                type: "image",
                imageUrl: new URL(url, location.origin).href,
                imageOrigin: "uploaded",
              });
          }
          for (const f of x.attachments || [])
            if (f.file_type === "txt" && cl(f.extracted_content))
              c.push(...txt(f.extracted_content));
            else
              c.push({
                type: "attachment",
                attachment: {
                  id: f.id || f.file_name,
                  name: f.file_name,
                  mime_type: f.file_type,
                },
              });
          return c.length
            ? [
                msg(
                  `claude_${x.uuid}`,
                  x.sender === "human" ? "user" : "assistant",
                  c,
                  x.created_at,
                  "claude",
                ),
              ]
            : [];
        });
      return done(p, { id: chat, title: d.name, messages });
    },
    async grok(p) {
      const shared = location.pathname.match(/^\/share\/([^/]+)/)?.[1];
      if (shared) {
        const d = await json(
            `/rest/app-chat/share_links/${encodeURIComponent(shared)}?useChunk=true`,
          );
        if (!d.conversation?.conversationId || !Array.isArray(d.responses))
          throw Error("invalid_conversation_response");
        const
          id = d.conversation?.conversationId || shared,
          messages = (d.responses || [])
            .filter((x) => !x.partial)
            .sort((a, b) => (tm(a.createTime) || 0) - (tm(b.createTime) || 0))
            .map((x) => {
              const rawText =
                x.message ||
                  (x.inputChunks || []).map((y) => y.text?.text || "").join("") ||
                  (x.outputChunks || []).map((y) => y.text?.text || "").join(""),
                c = grokCardContents(x.cardAttachmentsJson);
              c.push(
                ...(x.generatedImageUrls || []).map((imageUrl) => ({
                  type: "image",
                  imageUrl: /^https?:\/\//i.test(imageUrl)
                    ? imageUrl
                    : `https://assets.grok.com/${String(imageUrl).replace(/^\//, "")}`,
                  imageOrigin: "generated",
                })),
                ...grokChunkImages(x.outputChunks),
              );
              c.push(...grokUploadedImages(x.fileAttachmentsMetadata));
              c.push(...grokInlineContents(rawText, x.cardAttachmentsJson));
              const sources = sourcesFrom(x);
              if (sources.length) c.push({ type: "sources", sources });
              return msg(
                `grok_${x.responseId}`,
                x.sender === "human" ? "user" : "assistant",
                uniqueContents(c),
                x.createTime,
                x.model || "grok",
              );
            });
        return done(p, { id, title: d.conversation?.title, messages });
      }
      const id = location.pathname.match(/^\/c\/([a-f0-9-]+)/i)?.[1];
      if (!id) throw Error("conversation_id_missing");
      const tree = await json(
          `/rest/app-chat/conversations/${id}/response-node?includeThreads=true`,
        ),
        ids = (tree.responseNodes || []).map((x) => x.responseId);
      if (!ids.length) throw Error("conversation_not_found");
      const d = await json(
          `/rest/app-chat/conversations/${id}/load-responses`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ responseIds: ids }),
          },
        ),
        messages = (d.responses || [])
          .filter((x) => !x.partial)
          .sort((a, b) => (tm(a.createTime) || 0) - (tm(b.createTime) || 0))
          .map((x) => {
            const content =
              x.message ||
              (x.sender === "human"
                ? (x.inputChunks || []).map((y) => y.text?.text || "")
                : (x.outputChunks || []).map((y) => y.text?.text || "")
              ).join("");
            const c = grokCardContents(x.cardAttachmentsJson);
            c.push(
              ...(x.generatedImageUrls || []).map((imageUrl) => ({
                type: "image",
                imageUrl: /^https?:\/\//i.test(imageUrl)
                  ? imageUrl
                  : `https://assets.grok.com/${String(imageUrl).replace(/^\//, "")}`,
                imageOrigin: "generated",
              })),
              ...grokChunkImages(x.outputChunks),
            );
            c.push(...grokUploadedImages(x.fileAttachmentsMetadata));
            c.push(...grokInlineContents(content, x.cardAttachmentsJson));
            const sources = sourcesFrom(x);
            if (sources.length) c.push({ type: "sources", sources });
            return msg(
              `grok_${x.responseId}`,
              x.sender === "human" ? "user" : "assistant",
              uniqueContents(c),
              x.createTime,
              x.model || "grok",
            );
          });
      return done(p, { id, messages });
    },
    async kimi(p) {
      const id = location.pathname.match(/\/chat\/([^/?#]+)/)?.[1],
        captured = (await capture()).kimi || {},
        cookieAuth = document.cookie.match(/(?:^|;\s*)kimi-auth=([^;]+)/)?.[1],
        auth = captured.authorization || (cookieAuth ? `Bearer ${cookieAuth}` : "");
      if (!id) throw Error("conversation_id_missing");
      if (!auth) throw Error("login_required");
      const d = await json(
          captured.url ||
            `${location.origin}/apiv2/kimi.gateway.chat.v1.ChatService/ListMessages`,
          {
            method: "POST",
            headers: {
              authorization: auth,
              "connect-protocol-version": "1",
              "content-type": "application/json",
              "x-msh-platform": "web",
              "x-msh-version": "1.0.0",
              ...(captured.extraHeaders || {}),
            },
            body: JSON.stringify({ chat_id: id, page_size: 1000 }),
          },
        ),
        messages = branch(d.messages || []).flatMap((x) =>
          ["user", "assistant"].includes(x.role) &&
          x.status === "MESSAGE_STATUS_COMPLETED"
            ? [
                msg(
                  x.id,
                  x.role,
                  blocks(x.blocks, "", x.refs),
                  x.createTime,
                  "kimi",
                ),
              ]
            : [],
        );
      if (!Array.isArray(d.messages)) throw Error("invalid_conversation_response");
      return done(p, { id, title: d.title, messages });
    },
    async qwen(p) {
      const id = decodeURIComponent(
        location.pathname.match(/\/(?:c|chat)\/([^/?#]+)/)?.[1] || "",
      );
      if (!id) throw Error("conversation_id_missing");
      let token = localStorage.token || "";
      try {
        const x = JSON.parse(token);
        token =
          typeof x === "string" ? x : x?.access_token || x?.token || token;
      } catch {}
      const h = { accept: "application/json" };
      if (token)
        h.authorization = /^bearer /i.test(token) ? token : `Bearer ${token}`;
      const r = await json(`/api/v2/chats/${id}`, { headers: h }),
        d = r.data,
        history = d?.chat?.history,
        convert = (x) => {
          if (!["user", "assistant"].includes(x.role)) return [];
          const c = [];
          if (cl(x.reasoning_content))
            c.push({ type: "thinking", content: cl(x.reasoning_content) });
          c.push(...txt(x.content));
          for (const f of x.files || [])
            if ((f.type === "image" || String(f.file_type || "").startsWith("image/")) && f.url)
              c.push({ type: "image", imageUrl: f.url, imageOrigin: "uploaded" });
            else c.push({ type: "attachment", attachment: f });
          const sourceRows = [];
          for (const z of x.content_list || [])
            if (z.phase === "thinking_summary") {
              const summaries = z.extra?.summary_thought?.content || [];
              if (Array.isArray(summaries) && summaries.length)
                c.push(...txt(summaries.join("\n\n"), "thinking"));
            } else if (z.phase === "answer") c.push(...txt(z.content));
            else if (z.phase === "image_gen" && z.content)
              c.push({
                type: "image",
                imageUrl: z.content,
                imageOrigin: "generated",
              });
            else sourceRows.push(z);
          const sources = sourcesFrom([...(x.content_list || []), ...sourceRows]);
          if (sources.length) c.push({ type: "sources", sources });
          return c.length
            ? [
                msg(
                  x.id,
                  x.role,
                  c,
                  x.timestamp,
                  x.modelName || x.model || "qwen",
                ),
              ]
            : [];
        },
        treeRows = Object.values(history?.messages || {}),
        parentIds = new Set(treeRows.map((row) => row.parentId).filter(Boolean)),
        activeLeaf = history?.currentId || d?.currentId,
        leaves = treeRows
          .filter((row) => !parentIds.has(row.id))
          .sort((left, right) => {
            if (left.id === activeLeaf) return -1;
            if (right.id === activeLeaf) return 1;
            return (tm(right.timestamp) || 0) - (tm(left.timestamp) || 0);
          }),
        messageMap = new Map(),
        branches = [];
      for (let index = 0; index < leaves.length; index += 1) {
        const leaf = leaves[index],
          branchMessages = branch(
            treeRows,
            "id",
            "parentId",
            "timestamp",
            leaf.id,
          ).flatMap(convert);
        if (!branchMessages.length) continue;
        branchMessages.forEach((message) => {
          if (!messageMap.has(message.id)) messageMap.set(message.id, message);
        });
        branches.push({
          id: `branch-${leaf.id}`,
          title: `Branch ${index + 1}`,
          leafMessageId: branchMessages.at(-1)?.id || leaf.id,
          messageIds: branchMessages.map((message) => message.id),
        });
      }
      const requestedBranchId = `branch-${activeLeaf || leaves[0]?.id || "current"}`,
        messages = [...messageMap.values()].sort(
          (left, right) => (Number(left.createdAt) || 0) - (Number(right.createdAt) || 0),
        );
      if (!r.success || !history?.messages)
        throw Error("invalid_conversation_response");
      return done(p, {
        id: d?.id || id,
        title: d?.title,
        messages,
        branches,
        activeBranchId: branches.some((row) => row.id === requestedBranchId)
          ? requestedBranchId
          : branches[0]?.id || "",
      });
    },
    async copilot(p) {
      const id = location.pathname.match(/\/chats\/([^/?#]+)/)?.[1];
      if (!id) throw Error("conversation_id_missing");
      let auth = "",
        identity = "";
      for (const st of [localStorage, sessionStorage])
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i) || "";
          try {
            const x = JSON.parse(st.getItem(k));
            if (k.includes("offline_access"))
              auth ||=
                `${x?.body?.token_type || "Bearer"} ${x?.body?.access_token || ""}`.trim();
            if (k.includes("@@user@@"))
              identity ||= String(x?.decodedToken?.user?.sub || "").split(
                /[-|]/,
              )[0];
          } catch {}
        }
      const h = { Accept: "*/*" };
      if (auth) h.Authorization = auth;
      if (identity) h["X-Useridentitytype"] = identity;
      const d = await json(`/c/api/conversations/${id}/history?api-version=2`, {
          headers: h,
        }),
        messages = [...(d.results || [])].reverse().flatMap((x) => {
          const role = x.author?.type === "human" ? "user" : "assistant",
            c = [];
          for (const z of x.content || [])
            (z.type === "text"
              ? c.push(...txt(z.text))
              : z.type === "citation" &&
                c.push({
                  type: "sources",
                  sources: [{ title: z.title || z.url, url: z.url }],
                }),
              z.type === "image" && c.push({ type: "image", imageUrl: z.url }));
          return c.length
            ? [msg(`copilot_${x.id}`, role, c, x.createdAt, "copilot")]
            : [];
        });
      if (!Array.isArray(d.results)) throw Error("invalid_conversation_response");
      return done(p, { id, messages });
    },
    async m365copilot(p) {
      const id = location.pathname.match(
        /\/chat\/conversation\/([^/?#]+)/,
      )?.[1];
      if (!id) throw Error("conversation_id_missing");
      const d = await json(
          `/chat/conversation/${id}?es=SSR&redirfrom=userTypeCookie`,
          {
            headers: {
              "x-host-context": JSON.stringify({
                clientPlatform: "web",
                hostName: "officeweb",
                appName: "SSR",
                appMode: "default",
              }),
              "x-route-id": "chat-history",
              "x-session-id": crypto.randomUUID(),
              "x-slim-rehydration": "true",
            },
          },
        ),
        raw = d.store?.rawConversationResponse || {},
        messages = (raw.messages || []).flatMap((x, i) => {
          if (
            !["user", "bot"].includes(x.author) ||
            x.messageType === "Progress" ||
            x.contentType === "SearchResults"
          )
            return [];
          const t = htmlMarkdown(x.text);
          return t
            ? [
                msg(
                  x.messageId || i,
                  x.author === "user" ? "user" : "assistant",
                  txt(t),
                  x.createdAt || x.timestamp,
                  "m365copilot",
                ),
              ]
            : [];
        });
      return done(p, {
        id: raw.conversationId || id,
        title: raw.chatName,
        messages,
      });
    },
    async githubcopilot(p) {
      const id = location.pathname.match(/\/copilot\/c\/([a-f0-9-]+)/i)?.[1];
      let token;
      try {
        token = JSON.parse(localStorage.COPILOT_AUTH_TOKEN || "null")?.value;
      } catch {}
      if (!id || !token)
        throw Error(!id ? "conversation_id_missing" : "login_required");
      const d = await json(
          `https://api.individual.githubcopilot.com/github/chat/threads/${id}/messages`,
          {
            credentials: "same-origin",
            headers: {
              Authorization: `GitHub-Bearer ${token}`,
              "X-Github-Api-Version": "2025-05-01",
              "Copilot-Integration-Id": "copilot-chat",
            },
          },
        ),
        messages = [...(d.messages || [])]
          .sort((a, b) => (tm(a.createdAt) || 0) - (tm(b.createdAt) || 0))
          .flatMap((x) =>
            cl(x.content)
              ? [
                  msg(
                    x.id,
                    x.role === "user" ? "user" : "assistant",
                    txt(x.content),
                    x.createdAt,
                    "githubcopilot",
                  ),
                ]
              : [],
          );
      if (!Array.isArray(d.messages)) throw Error("invalid_conversation_response");
      return done(p, { id, title: d.thread?.name, messages });
    },
    async googleaistudio(p) {
      const id = location.pathname.match(/^\/prompts\/([A-Za-z0-9_-]+)/)?.[1];
      if (!id) throw Error("conversation_id_missing");
      const bridge = await main("EXPORT_GET_CONTEXT"),
        keys = bridge.globals?.aiStudioKeys || [],
        ctx = bridge.context?.aistudio || {};
      let apiKey = "";
      for (const key of keys || [])
        try {
          const data = JSON.parse(
            document.getElementById(String(key))?.textContent || "null",
          );
          if (data?.WIu0Nc) {
            apiKey = data.WIu0Nc;
            break;
          }
        } catch {}
      const authorization = await sapi("https://aistudio.google.com");
      if (!authorization || !apiKey) throw Error("request_capture_missing");
      const url =
          ctx.resolveUrl ||
          "https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ResolveDriveResource",
        r = await retry(async () => {
          const result = await main(
            "EXPORT_PAGE_FETCH",
            {
              url,
              options: {
                method: "POST",
                headers: {
                  authorization,
                  "content-type": "application/json+protobuf",
                  "x-goog-api-key": apiKey,
                  "x-goog-authuser": "0",
                  "x-user-agent": "grpc-web-javascript/0.1",
                },
                body: JSON.stringify([id]),
                rawBody: true,
              },
            },
            30000,
          );
          if (!result.ok)
            throw Error(result.reason || "aistudio_request_failed");
          return result;
        }, "aistudio_request");
      if (!r.ok || !Array.isArray(r.data))
        throw Error("aistudio_request_failed");
      const d = r.data,
        list = at(d, [0, 13, 0], []),
        model = String(at(d, [0, 3, 2], "")),
        messages = [];
      let pending = [];
      const flush = () => {
        if (!pending.length) return;
        const c = [];
        for (const row of pending) {
          const value = at(row, [0], "");
          if (cl(value))
            c.push({
              type: at(row, [19], 0) === 1 ? "thinking" : "markdown",
              content: cl(value),
            });
        }
        if (c.length)
          messages.push(
            msg(`google_${messages.length}`, "assistant", c, null, model),
          );
        pending = [];
      };
      for (const row of list) {
        if (!Array.isArray(row)) continue;
        const role = at(row, [8], "");
        if (role === "user") {
          flush();
          messages.push(
            msg(
              `google_${messages.length}`,
              "user",
              txt(at(row, [0], "")),
              null,
              "googleaistudio",
            ),
          );
        } else if (role === "model") pending.push(row);
      }
      flush();
      return done(p, { id, title: String(at(d, [0, 4, 0], "")), messages });
    },
    async notebooklm(p) {
      const id = location.pathname.match(/^\/notebook\/([^/]+)/)?.[1];
      if (!id) throw Error("conversation_id_missing");
      const bridge = await main("EXPORT_GET_CONTEXT"),
        ctx = bridge.context?.notebooklm || {},
        wiz = bridge.globals?.wiz || {},
        fSid = wiz.FdrFJe || "",
        bl = wiz.cfb2h || "",
        atToken = ctx.atToken || "",
        conversation = ctx.conversationUuid || "";
      if (!fSid || !bl || !atToken) throw Error("request_capture_missing");
      let req = Number.parseInt(ctx.reqId || "", 10);
      req = Number.isFinite(req)
        ? req + 100000
        : Math.floor(Math.random() * 9000000) + 1000000;
      const call = async (rpc, args, requestId) => retry(async () => {
        const url = `${location.origin}/_/LabsTailwindUi/data/batchexecute?rpcids=${rpc}&source-path=${encodeURIComponent(location.pathname)}&bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(fSid)}&hl=en&_reqid=${requestId}&rt=c`,
          form = new URLSearchParams();
        form.set(
          "f.req",
          JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]),
        );
        form.set("at", atToken);
        const response = await fetch(url, {
          method: "POST",
          signal: extractionController?.signal,
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "x-same-domain": "1",
          },
          body: form,
        });
        if (!response.ok) throw Error(`request_failed:${response.status}`);
        const payload = rpcPayload(await response.text(), rpc);
        if (payload == null) throw Error("notebooklm_rpc_frame_missing");
        return payload;
      }, `notebooklm_${rpc}`);
      const summary = await call("VfAZjd", [id, [2]], req),
        messages = [
          msg(
            `${id}_summary`,
            "assistant",
            notebookContents(at(summary, [0, 0, 0], "")),
            Date.now(),
            "notebooklm",
          ),
        ];
      if (conversation) {
        let cursor = null,
          page = 0,
          all = [],
          completed = false;
        const seenCursors = new Set();
        for (; page < 500; page += 1) {
          const payload = await call(
              "khqZz",
              [[], null, null, conversation, 100, cursor],
              req + 1 + page,
            ),
            rows = at(payload, [0], []);
          if (!Array.isArray(rows)) throw Error("notebooklm_page_invalid");
          all.push(...rows);
          const nextCursor = at(payload, [1], null);
          if (!nextCursor || rows.length < 100) {
            completed = true;
            break;
          }
          if (seenCursors.has(nextCursor))
            throw Error("notebooklm_pagination_repeated");
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
        if (!completed) throw Error("notebooklm_pagination_limit");
        all.reverse().forEach((row, index) => {
          const stamp = Array.isArray(at(row, [1], null))
              ? Number(at(row, [1, 0], 0)) * 1000 +
                Math.floor(Number(at(row, [1, 1], 0)) / 1e6)
              : Number(at(row, [1], 0)) * 1000,
            user = at(row, [3], ""),
            answer = at(row, [4, 0, 0], "");
          if (cl(user))
            messages.push(
              msg(
                `${at(row, [0], index)}_user`,
                "user",
                txt(user),
                stamp,
                "notebooklm",
              ),
            );
          if (cl(answer))
            messages.push(
              msg(
                at(row, [0], index),
                "assistant",
                notebookContents(answer),
                stamp,
                "notebooklm",
              ),
            );
        });
      }
      return done(p, { id, title: "NotebookLM Conversation", messages });
    },
    async gemini(p) {
      const G = globalThis.MultiAIGeminiConversation;
      if (!G) throw Error("gemini_core_missing");
      const share = location.pathname.match(/^\/share\/([^/]+)/)?.[1],
        id = share || location.pathname.split("/").filter(Boolean).at(-1);
      if (!id) throw Error("conversation_id_missing");
      let nextRequestId = 0;
      const request = async (rpc, args, requireToken) => {
        let lastError;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const bridge = await main("EXPORT_GET_CONTEXT"),
              wiz = bridge.globals?.wiz || {},
              context = bridge.context?.gemini || {},
              fSid = wiz.FdrFJe || "",
              bl = wiz.cfb2h || "",
              base = wiz.Im6cmf || "/_/BardChatUi",
              token = wiz.SNlM0e || "";
            if (!fSid || !bl || (requireToken && !token))
              throw Error("gemini_request_context_missing");
            const captured = Number.parseInt(context.reqId || "", 10),
              baseline = Number.isFinite(captured)
                ? captured + 100000
                : Math.floor(Math.random() * 9000000) + 1000000;
            nextRequestId = Math.max(nextRequestId + 100000, baseline);
            const url = `${location.origin}${base}/data/batchexecute?rpcids=${rpc}&source-path=${encodeURIComponent(location.pathname)}&bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(fSid)}&hl=en&_reqid=${nextRequestId}&rt=c`,
              form = new URLSearchParams();
            form.set(
              "f.req",
              JSON.stringify([[[rpc, JSON.stringify(args), null, "generic"]]]),
            );
            if (token) form.set("at", token);
            const response = await fetch(url, {
              method: "POST",
              signal: extractionController?.signal,
              credentials: "include",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "x-same-domain": "1",
                ...(context.extHeaders || {}),
              },
              body: form,
            });
            if (!response.ok) throw Error(`gemini_request_failed:${response.status}`);
            return G.parseBatchResponse(await response.text(), rpc);
          } catch (error) {
            lastError = error;
            if (attempt === 0) await s(300);
          }
        }
        throw lastError || Error("gemini_request_failed");
      };
      if (share) {
        const payload = await request("ujx1Bf", [null, id, [4]], false),
          root = at(payload, [0], null),
          items = at(root, [1], []),
          turns = Array.isArray(items)
            ? items.map(G.parseTurn).filter(Boolean)
            : [];
        return done(p, {
          id: at(root, [3], id),
          title: at(root, [2, 1], ""),
          messages: G.messagesFromTurns(turns),
        });
      }
      let cursor = null,
        turns = [],
        completed = false;
      const seenCursors = new Set();
      for (let pageNumber = 0; pageNumber < 500; pageNumber += 1) {
        const payload = await request("hNvQHb", [
            `c_${id}`,
            G.PAGE_SIZE,
            cursor,
            1,
            [0],
            [4],
            null,
            1,
          ], true),
          page = G.parsePage(payload);
        turns.unshift(...page.turns);
        if (page.rawCount < G.PAGE_SIZE || !page.cursor) {
          completed = true;
          break;
        }
        if (seenCursors.has(page.cursor)) throw Error("gemini_pagination_repeated");
        seenCursors.add(page.cursor);
        cursor = page.cursor;
      }
      if (!completed) throw Error("gemini_pagination_limit");
      return done(p, { id, messages: G.messagesFromTurns(turns) });
    },
    async yuanbao(p) {
      const m = location.pathname.match(/^\/chat\/([^/]+)\/([^/?#]+)/);
      if (!m) throw Error("conversation_id_missing");
      const agentId = decodeURIComponent(m[1]),
        id = decodeURIComponent(m[2]),
        all = new Map(),
        seen = new Set();
      let offset = 0,
        first = null,
        completed = false;
      for (let page = 0; page < 1000; page++) {
        const d = await json("/api/user/agent/conversation/v1/detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            conversationId: id,
            limit: 100,
            offset,
          }),
        });
        if (!Array.isArray(d.convs))
          throw Error("invalid_conversation_response");
        first ||= d;
        const fingerprint = d.convs
          .map((x) => x.id || `${x.index}:${x.createTime}`)
          .join("|");
        if (seen.has(fingerprint)) throw Error("pagination_repeated");
        seen.add(fingerprint);
        for (const x of d.convs)
          all.set(x.id || `${x.index}:${x.createTime}`, x);
        if (!d.hasMore) {
          completed = true;
          break;
        }
        if (!d.convs.length) throw Error("pagination_empty");
        const next = Math.min(
          ...d.convs.map((x) => x.index).filter(Number.isFinite),
        );
        if (!Number.isFinite(next) || next <= 0 || (offset && next >= offset))
          throw Error("pagination_stalled");
        offset = next;
      }
      if (!completed) throw Error("yuanbao_pagination_limit");
      const messages = [...all.values()]
        .filter((x) => !x.skipConv && !x.hideConv)
        .sort(
          (a, b) =>
            (a.index ?? 1e15) - (b.index ?? 1e15) ||
            (a.createTime || 0) - (b.createTime || 0),
        )
        .flatMap((x) => {
          const c = [];
          for (const speech of [...(x.speechesV2 || [])].sort(
            (a, b) => (a.speechIndex || 0) - (b.speechIndex || 0),
          ))
            for (const z of speech.content || []) {
              if (z.type === "text") c.push(...txt(z.msg));
              else if (z.type === "think")
                c.push(...txt(z.content, "thinking"));
              else if (z.type === "image" && z.url)
                c.push({
                  type: "image",
                  imageUrl: z.url,
                  imageOrigin: "generated",
                });
              else if (z.type === "deepSearch")
                c.push(
                  ...txt(
                    (z.contents || [])
                      .filter((y) => y.type === "text")
                      .map((y) => y.msg)
                      .join("\n\n"),
                    "thinking",
                  ),
                );
              else if (z.type === "searchGuid") {
                const sources = (z.docs || [])
                  .filter((y) => y.url)
                  .map((y) => ({
                    title: y.title || y.url,
                    url: y.url,
                    domain: y.web_site_name || y.source || "",
                  }));
                if (sources.length) c.push({ type: "sources", sources });
              }
            }
          if (!c.length) c.push(...txt(x.displayPrompt || x.speech));
          return c.length
            ? [
                msg(
                  x.id || `${id}_${x.index}`,
                  x.speaker === "human" ? "user" : "assistant",
                  c,
                  (x.createTime || 0) * 1000,
                  "yuanbao",
                ),
              ]
            : [];
        });
      return done(p, { id, title: first?.title, messages });
    },
    async perplexity(p) {
      const id = location.pathname.match(
        /^\/(?:search|computer\/tasks)\/([^/]+)/,
      )?.[1];
      if (!id) throw Error("conversation_id_missing");
      const ctx = (await capture()).perplexity,
        isComputer = /^\/computer\/tasks\//.test(location.pathname),
        url = new URL(ctx?.url || `/rest/thread/${id}`, location.origin),
        useCases = [
          "answer_modes",
          "media_items",
          "knowledge_cards",
          "inline_entity_cards",
          "place_widgets",
          "finance_widgets",
          "sports_widgets",
          "flight_status_widgets",
          "shopping_widgets",
          "jobs_widgets",
          "search_result_widgets",
          "clarification_responses",
          "inline_images",
          "inline_assets",
          "placeholder_cards",
          "diff_blocks",
          "inline_knowledge_cards",
          "entity_group_v2",
          "refinement_filters",
          "canvas_mode",
          "maps_preview",
          "answer_tabs",
          "price_comparison_widgets",
          ...(isComputer
            ? [
                "workflow_steps",
                "workflow_widgets",
                "navigation_results",
                "background_agents",
                "unified_assets",
              ]
            : []),
        ];
      if (!ctx?.url) {
        url.searchParams.set("with_parent_info", "true");
        url.searchParams.set("with_schematized_response", "true");
        url.searchParams.set("version", "2.18");
        url.searchParams.set("source", "default");
        url.searchParams.set("from_first", String(!isComputer));
        url.searchParams.set("with_first_entry", "false");
        url.searchParams.set("with_latest_entry", "false");
        for (const value of useCases)
          url.searchParams.append("supported_block_use_cases", value);
      }
      const entries = new Map();
      let cursor = "";
      let completed = false;
      const seenCursors = new Set();
      for (let page = 0; page < 500; page++) {
        const before = entries.size;
        url.searchParams.set("limit", page ? "100" : "10");
        url.searchParams.set("offset", "0");
        if (cursor) url.searchParams.set("cursor", cursor);
        else url.searchParams.delete("cursor");
        const h = {
            "x-app-api-client": "default",
            "x-app-api-version": "2.18",
            "x-perplexity-request-reason": isComputer
              ? "computer-thread"
              : "search-components",
            "x-perplexity-request-try-number": "1",
            ...(ctx?.headers || {}),
            "x-perplexity-request-endpoint": url.href,
            "x-request-id": crypto.randomUUID(),
          },
          d = await json(url.href, { headers: h });
        for (const x of d.entries || []) if (x.uuid) entries.set(x.uuid, x);
        if (!Array.isArray(d.entries)) throw Error("perplexity_page_invalid");
        if (!d.has_next_page || !d.next_cursor) {
          completed = true;
          break;
        }
        if (entries.size === before || seenCursors.has(d.next_cursor))
          throw Error("perplexity_pagination_repeated");
        seenCursors.add(d.next_cursor);
        cursor = d.next_cursor;
      }
      if (!completed) throw Error("perplexity_pagination_limit");
      const rows = [...entries.values()].sort(
          (a, b) =>
            (tm(a.entry_updated_datetime || a.updated_datetime) || 0) -
            (tm(b.entry_updated_datetime || b.updated_datetime) || 0),
        ),
        messages = [];
      for (const x of rows) {
        const at = x.entry_updated_datetime || x.updated_datetime,
          model = x.user_selected_model || "perplexity",
          u = [];
        for (const image of x.attachments || []) {
          if (typeof image !== "string") continue;
          try {
            const target = new URL(image),
              isImage =
                target.pathname.includes("/attachments/images/") ||
                /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(
                  target.pathname,
                );
            if (["http:", "https:"].includes(target.protocol) && isImage)
              u.push({
                type: "image",
                imageUrl: image,
                imageOrigin: "uploaded",
              });
          } catch {}
        }
        u.push(...txt(x.query_str));
        if (u.length)
          messages.push(msg(`${x.uuid}_user`, "user", u, at, model));
        const a = perplexityContents(x.blocks);
        if (a.length)
          messages.push(msg(`${x.uuid}_assistant`, "assistant", a, at, model));
      }
      return done(p, {
        id,
        title: rows.find((x) => x.thread_title)?.thread_title,
        messages,
      });
    },
    async doubao(p) {
      const id = decodeURIComponent(
          location.pathname.match(/^\/chat\/([^/?#]+)/)?.[1] || "",
        ),
        template = (await capture()).doubao;
      if (!id) throw Error("conversation_id_missing");
      if (!template?.body?.uplink_body?.pull_singe_chain_uplink_body)
        throw Error("request_capture_missing");
      const seed = template.body.uplink_body.pull_singe_chain_uplink_body;
      let cursor = Number(seed.anchor_index),
        pages = [],
        seen = new Set(),
        completed = false;
      for (let page = 0; page < 500; page++) {
        if (!Number.isSafeInteger(cursor) || cursor < 0 || seen.has(cursor))
          throw Error("pagination_stalled");
        seen.add(cursor);
        const body = structuredClone(template.body);
        body.uplink_body.pull_singe_chain_uplink_body.conversation_id = id;
        body.uplink_body.pull_singe_chain_uplink_body.anchor_index = cursor;
        body.sequence_id = crypto.randomUUID();
        const r = await retry(async () => {
          const result = await main(
            "EXPORT_PAGE_FETCH",
            {
              url: template.url,
              options: {
                method: "POST",
                headers: {
                  accept: "application/json, text/plain, */*",
                  "agw-js-conv": "str",
                  "content-type": "application/json; encoding=utf-8",
                },
                body,
              },
            },
            30000,
          );
          if (!result.ok || result.data?.status_code !== 0)
            throw Error("doubao_request_failed");
          return result;
        }, "doubao_request");
        if (!r.ok || r.data?.status_code !== 0)
          throw Error("doubao_request_failed");
        pages.push(r.data);
        const d = r.data.downlink_body?.pull_singe_chain_downlink_body;
        if (!d) throw Error("invalid_conversation_response");
        if (!d.has_more) {
          completed = true;
          break;
        }
        if (d.next_index == null || d.next_index === "")
          throw Error("doubao_next_cursor_missing");
        cursor = Number(d.next_index);
      }
      if (!completed) throw Error("doubao_pagination_limit");
      const map = new Map();
      for (const page of pages)
        for (const x of page.downlink_body?.pull_singe_chain_downlink_body
          ?.messages || [])
          if (x.message_id) map.set(x.message_id, x);
      const rows = [...map.values()].sort((a, b) => {
          const indexDifference =
            Number(a.index_in_conv) - Number(b.index_in_conv);
          return Number.isFinite(indexDifference) && indexDifference !== 0
            ? indexDifference
            : (tm(a.create_time) || 0) - (tm(b.create_time) || 0);
        }),
        messages = [],
        replyGroups = new Map();
      for (const x of rows) {
        if (![1, 2].includes(x.user_type)) continue;
        const c = [],
          thinking = new Set(),
          images = new Set();
        if (cl(x.thinking_content)) thinking.add(cl(x.thinking_content));
        for (const b of x.content_block || []) {
          const thought = cl(
            b.content?.thinking_block?.text ||
              b.content?.thinking_block?.content,
          );
          if (thought) thinking.add(thought);
        }
        for (const thought of thinking) c.push(...txt(thought, "thinking"));
        let hasBlockText = false;
        for (const b of x.content_block || []) {
          if (cl(b.content?.text_block?.text)) {
            hasBlockText = true;
            doubaoTextContents(b.content.text_block.text, c, images);
          }
          for (const a of b.content?.attachment_block?.attachments || []) {
            const image =
              a.image?.image_ori?.url ||
              a.image?.image_preview?.url ||
              a.image?.image_thumb?.url;
            if (image)
              doubaoPushImage(c, images, image, "uploaded", "private");
            else if (a.file)
              c.push({
                type: "attachment",
                attachment: {
                  id: a.identifier || a.file.id,
                  name: a.file.name || a.file.file_name || "attachment",
                  size: Number(a.file.size || 0),
                  mime_type: a.file.mime_type || "application/octet-stream",
                  url: a.file.url,
                },
              });
          }
          if (!b.content?.search_query_result_block)
            for (const image of doubaoGeneratedUrls(b.content))
              doubaoPushImage(c, images, image, "generated", "private");
        }
        const sources = doubaoSources(x.content_block);
        if (sources.length) c.push({ type: "sources", sources });
        if (!hasBlockText)
          doubaoTextContents(
            x.content || (x.user_type === 2 ? x.brief : ""),
            c,
            images,
          );
        if (!c.length) continue;
        const message = msg(
            x.message_id,
            x.user_type === 1 ? "user" : "assistant",
            c,
            x.create_time,
            "doubao",
          );
        message.updatedAt = tm(x.update_time) || message.createdAt;
        const
          replyKey = x.user_type === 1 ? cl(x.ext?.reply_unique_key) : "",
          existing = replyKey ? replyGroups.get(replyKey) : null;
        if (existing) {
          existing.ids = [...new Set([...(existing.ids || [existing.id]), message.id])];
          existing.id = message.id;
          existing.contents.push(...message.contents);
          existing.createdAt = Math.min(
            Number(existing.createdAt) || Number(message.createdAt),
            Number(message.createdAt) || Number(existing.createdAt),
          );
          existing.updatedAt = Math.max(
            Number(existing.updatedAt) || 0,
            Number(message.updatedAt) || 0,
          );
          continue;
        }
        messages.push(message);
        if (replyKey) replyGroups.set(replyKey, message);
      }
      return done(p, {
        id,
        title: messages
          .find((x) => x.role === "user")
          ?.contents.find((x) => x.content)
          ?.content?.slice(0, 60),
        messages,
      });
    },
    async googlesearch(p) {
      const id =
          new URL(location.href).searchParams.get("mtid") ||
          new URL(location.href).searchParams.get("q") ||
          location.href,
        subtrees = [...document.querySelectorAll('[data-subtree="aimc"]')],
        roots = [];
      for (const subtree of subtrees) {
        let root = subtree;
        for (let depth = 0; depth < 10 && root; depth += 1) {
          const hasQuestion = root.querySelector('span[jsname="y5v2y"], .iMqumd');
          if (
            hasQuestion &&
            root.querySelectorAll('[data-subtree="aimc"]').length === 1
          )
            break;
          root = root.parentElement;
        }
        if (root && !roots.includes(root)) roots.push(root);
      }
      if (!roots.length) roots.push(...document.querySelectorAll(".CKgc1d"));
      const messages = [];
      roots.forEach((root, index) => {
        const questionNode = root.querySelector(
            'span[jsname="y5v2y"], .iMqumd',
          ),
          question = cl(questionNode?.textContent || ""),
          mainColumns = [...root.querySelectorAll('[data-container-id="main-col"]')],
          answerRoots = mainColumns.length ? mainColumns : [root],
          answer = answerRoots
            .map((source) => {
              const clone =
                source === root ? source.cloneNode(true) : googleAnswerRoot(root, source);
              clone
                .querySelectorAll(
                  'span[jsname="y5v2y"], .iMqumd,script,style,button,[role="button"]',
                )
                .forEach((node) => node.remove());
              return nodeMarkdown(clone);
            })
            .filter(Boolean)
            .join("\n\n"),
          stamp = root.querySelector(".UYpEO")?.textContent || null;
        if (question)
          messages.push(
            msg(`${id}_${index}_user`, "user", txt(question), stamp, "googlesearch"),
          );
        const contents = googleAnswerContents(answer);
        const sourceMap = new Map();
        const sourceLinks = root.querySelectorAll("ul.bTFeG li a[href]");
        for (const link of sourceLinks) {
          let url = link.href;
          try {
            const parsed = new URL(url, location.origin);
            if (parsed.pathname === "/url" && parsed.searchParams.get("url"))
              url = parsed.searchParams.get("url");
          } catch {}
          if (/^https?:\/\//i.test(url) && !sourceMap.has(url))
            sourceMap.set(url, {
              title: cl(link.getAttribute("aria-label") || link.textContent || url),
              url,
            });
        }
        if (sourceMap.size)
          contents.push({ type: "sources", sources: [...sourceMap.values()] });
        if (contents.length)
          messages.push(
            msg(
              `${id}_${index}_assistant`,
              "assistant",
              contents,
              stamp,
              "googlesearch",
            ),
          );
      });
      return done(
        p,
        { id, title: cl(document.title), messages },
        "page-structure",
      );
    },
  };
  const P = {
    gemini: ["user-query", "model-response", "[data-test-id*='response']"],
    notebooklm: ["chat-message", "mat-card[class*='message']"],
    grok: [
      "[data-testid='user-message']",
      "[data-testid='assistant-message']",
      "[id^='response']",
    ],
    perplexity: ["[data-testid*='message']", "[class*='prose']"],
    doubao: ["[data-testid*='message']", "[class*='message-item']"],
    googleaistudio: ["[data-turn-role]"],
    googlesearch: ["[data-subtree='aimc']", ".CKgc1d"],
    yuanbao: [
      "[class*='agent-chat__bubble']",
      "[class*='message'][class*='user']",
      "[class*='message'][class*='assistant']",
    ],
  };
  function rows(p) {
    const a = [...document.querySelectorAll(P[p].join(","))].filter((e) =>
        cl(e.innerText),
      ),
      out = [];
    for (const e of a) {
      if (out.some((x) => x.contains(e))) continue;
      for (let i = out.length - 1; i >= 0; i--)
        if (e.contains(out[i])) out.splice(i, 1);
      out.push(e);
    }
    return out;
  }
  async function dom(p) {
    const key = p.adapter || p.id;
    if (!P[key]) throw Error("platform_adapter_missing");
    const scroll =
        [
          ...document.querySelectorAll(
            "main,[class*='message-list'],[class*='conversation']",
          ),
        ]
          .filter((e) => e.scrollHeight > e.clientHeight + 80)
          .sort(
            (a, b) =>
              b.scrollHeight -
              b.clientHeight -
              (a.scrollHeight - a.clientHeight),
          )[0] || document.scrollingElement,
      old = scroll.scrollTop;
    let prev = -1,
      stable = 0;
    for (let i = 0; i < 60; i++) {
      scroll.scrollTop = 0;
      await s(300);
      const n = rows(key).length;
      stable = n === prev ? stable + 1 : 0;
      prev = n;
      if (scroll.scrollTop < 3 && stable > 2) break;
    }
    const top = scroll.scrollTop < 3;
    scroll.scrollTop = old;
    const seen = new Set(),
      messages = [];
    rows(key).forEach((e, i) => {
      const d = [
          e.getAttribute("data-role"),
          e.getAttribute("data-turn-role"),
          e.className,
          e.id,
          e.getAttribute("data-testid"),
        ].join(" "),
        role = /user|human|query/i.test(d)
          ? "user"
          : /assistant|model|answer|response|bot/i.test(d)
            ? "assistant"
            : i % 2
              ? "assistant"
              : "user",
        t = cl(e.innerText),
        k = `${role}:${t.slice(0, 600)}`;
      if (!t || seen.has(k)) return;
      seen.add(k);
      const c = txt(t);
      for (const im of e.querySelectorAll("img[src]"))
        c.push({ type: "image", imageUrl: im.currentSrc || im.src });
      messages.push(
        msg(
          e.dataset.messageId || e.id || messages.length + 1,
          role,
          c,
          e.querySelector("time[datetime]")?.dateTime,
          key,
        ),
      );
    });
    return done(
      p,
      { messages, partial: true, reachedTop: top, stable: stable > 2 },
      "dom-fallback",
    );
  }
  async function extract() {
    const p = R?.fromUrl(location.href);
    if (!p) throw Error("unsupported_page");
    const adapter = p.adapter || p.id,
      fn = A[adapter];
    if (fn) return fn(p);
    return dom(p);
  }
  function inspect() {
    const p = R?.fromUrl(location.href);
    return p
      ? {
          supported: true,
          platform: p.id,
          platformName: p.name,
          state: "conversation",
        }
      : { supported: false, state: "unsupported" };
  }
  chrome.runtime.onMessage.addListener((m, _s, r) => {
    if (m?.action === "MAIW_CANCEL_CONVERSATION_EXTRACTION") {
      if (!m.taskId || m.taskId === extractionTaskId) extractionController?.abort();
      r({ ok: true });
      return false;
    }
    if (m?.action === "MAIW_FETCH_EXPORT_ASSET") {
      const url = String(m.url || "");
      if (!/^https?:\/\//i.test(url) && !url.startsWith("data:")) { r({ ok: false, reason: "asset_url_invalid" }); return false; }
      const isSameOrigin = url.startsWith(location.origin);
      const init = isSameOrigin ? { credentials: "include", cache: "no-store" } : { cache: "no-store" };
      fetch(url, init).then(async (response) => {
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const rawMime = (response.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
        if (rawMime && (rawMime.includes("text/html") || rawMime.includes("application/json"))) {
          throw Error(`invalid_content_type:${rawMime}`);
        }
        const blob = await response.blob();
        if (!blob || blob.size === 0) throw Error("empty_response");
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
        r({ ok: true, dataUrl, mime: blob.type || rawMime || "application/octet-stream", size: blob.size });
      }).catch((error) => r({ ok: false, reason: error.message || "asset_fetch_failed" }));
      return true;
    }
    if (m?.action === "MAIW_INSPECT_CONVERSATION_PAGE") {
      r({ ok: true, ...inspect() });
      return false;
    }
    if (m?.action !== "MAIW_EXTRACT_CONVERSATION") return false;
    extractionController?.abort();
    extractionController = new AbortController();
    extractionTaskId = String(m.taskId || "");
    extract(m.options || {})
      .then((conversation) => r({ ok: true, conversation }))
      .catch((e) => r({ ok: false, reason: e?.name === "AbortError" ? "cancelled" : e.message || "extract_failed" }))
      .finally(() => { extractionController = null; extractionTaskId = ""; });
    return true;
  });
})();
