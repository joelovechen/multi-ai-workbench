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
      return [{
        type: "attachment",
        name,
        url: clean(valueAt(record, [3], "")),
        mimeType: clean(valueAt(record, [11], "")),
        size: Array.isArray(dimensions) ? Number(dimensions[2]) || 0 : 0,
      }];
    });
  }

  function generatedImages(row) {
    const urls = new Set();
    const visit = (value) => {
      if (typeof value === "string") {
        if (
          /^https?:\/\/googleusercontent\.com\/image_generation_content\//.test(value) ||
          /^https:\/\/lh3\.googleusercontent\.com\/gg/.test(value)
        ) urls.add(value);
        return;
      }
      if (Array.isArray(value)) for (const item of value) visit(item);
    };
    visit(valueAt(row, [3], []));
    return [...urls].map((url) => ({ type: "image", url, alt: "Gemini generated image" }));
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
    if (answer) assistantContents.push({ type: "markdown", content: answer });
    assistantContents.push(...generatedImages(row));
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
