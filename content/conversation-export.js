(function initConversationExtractor() {
  "use strict";

  if (window.top !== window || globalThis.__MAIW_CONVERSATION_EXTRACTOR__) return;
  globalThis.__MAIW_CONVERSATION_EXTRACTOR__ = true;

  const registry = globalThis.MultiAIServiceRegistry;
  const profiles = {
    chatgpt: { selectors: ["[data-message-author-role]"], complete: true },
    gemini: { selectors: ["user-query", "model-response"], complete: false },
    claude: { selectors: ["[data-testid='user-message']", "[data-testid='assistant-message']", ".font-claude-message"], complete: false },
    deepseek: { selectors: ["[data-role='user']", "[data-role='assistant']", "[class*='message'][class*='user']", "[class*='message'][class*='assistant']"], complete: false },
    doubao: { selectors: ["[data-testid*='message']", "[class*='message-item']", "[class*='message'][class*='user']", "[class*='message'][class*='assistant']"], complete: false },
    yuanbao: { selectors: ["[class*='agent-chat__bubble']", "[class*='message'][class*='user']", "[class*='message'][class*='assistant']"], complete: false },
    kimi: { selectors: ["[class*='chat-content-item']", "[class*='message'][class*='user']", "[class*='message'][class*='assistant']"], complete: false },
    qianwen: { selectors: ["[data-role='user']", "[data-role='assistant']", "[class*='message'][class*='user']", "[class*='message'][class*='assistant']"], complete: false },
    zhipu: { selectors: ["[class*='message'][class*='user']", "[class*='message'][class*='assistant']", "[class*='chat-item']"], complete: false },
    minimax: { selectors: ["[class*='message'][class*='user']", "[class*='message'][class*='assistant']", "[class*='chat-item']"], complete: false },
    zhida: { selectors: ["[class*='message'][class*='user']", "[class*='message'][class*='assistant']", "[class*='answer']"], complete: false },
    copilot: { selectors: ["[data-content='user-message']", "[data-content='ai-message']", "[class*='user-message']", "[class*='assistant-message']"], complete: false },
    grok: { selectors: ["[data-testid*='message']", "[class*='message'][class*='user']", "[class*='message'][class*='assistant']"], complete: false }
  };
  const removeSelectors = "script,style,noscript,button,input,textarea,select,form,nav,aside,svg,canvas,[contenteditable='true'],[aria-hidden='true'],[role='button']";

  function visible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
  }

  function roleFor(element, index) {
    const explicit = element.getAttribute("data-message-author-role") || element.getAttribute("data-role") || "";
    if (/user|human|query/i.test(explicit)) return "user";
    if (/assistant|bot|model|ai/i.test(explicit)) return "assistant";
    const signal = [element.tagName, element.id, element.className, element.getAttribute("data-testid"), element.getAttribute("aria-label")].join(" ");
    if (/user|human|query|question|mine|right/i.test(signal)) return "user";
    if (/assistant|agent|bot|model|answer|response|markdown|claude/i.test(signal)) return "assistant";
    const nearby = element.querySelector("[data-message-author-role],[data-role]")?.getAttribute("data-message-author-role") || "";
    if (/user/i.test(nearby)) return "user";
    if (/assistant/i.test(nearby)) return "assistant";
    return index % 2 === 0 ? "user" : "assistant";
  }

  function cleanClone(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(removeSelectors).forEach((node) => node.remove());
    clone.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name) || ["style", "class", "id", "nonce", "srcdoc"].includes(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
    });
    return clone;
  }

  function markdownNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "img") { const src = node.currentSrc || node.getAttribute("src") || ""; return src ? `![${node.getAttribute("alt") || "image"}](${src})` : ""; }
    if (tag === "a") { const text = [...node.childNodes].map(markdownNode).join("").trim() || node.href; return node.href ? `[${text}](${node.href})` : text; }
    if (tag === "pre") { const code = node.innerText.trim(), language = node.querySelector("code")?.className.match(/language-([\w-]+)/)?.[1] || ""; return `\n\`\`\`${language}\n${code}\n\`\`\`\n`; }
    if (tag === "code") return `\`${node.textContent || ""}\``;
    const body = [...node.childNodes].map(markdownNode).join("");
    if (/^h[1-6]$/.test(tag)) return `\n${"#".repeat(Number(tag[1]))} ${body.trim()}\n`;
    if (tag === "li") return `\n- ${body.trim()}`;
    if (tag === "blockquote") return `\n${body.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n`;
    if (tag === "tr") return `| ${[...node.children].map((cell) => cell.innerText.trim().replace(/\|/g, "\\|")).join(" | ")} |\n`;
    if (["p", "div", "section", "article", "ul", "ol", "table"].includes(tag)) return `\n${body.trim()}\n`;
    return body;
  }

  function candidateElements(profile) {
    const elements = [...document.querySelectorAll(profile.selectors.join(","))].filter((element) => visible(element) && element.innerText?.trim().length);
    const unique = [];
    for (const element of elements) {
      if (unique.some((row) => row === element || row.contains(element))) continue;
      for (let index = unique.length - 1; index >= 0; index -= 1) if (element.contains(unique[index])) unique.splice(index, 1);
      unique.push(element);
    }
    return unique.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  function extractTitle(service) {
    const selectors = ["h1", "[data-testid*='conversation-title']", "[class*='conversation-title']", "[class*='chat-title']"];
    for (const selector of selectors) { const value = document.querySelector(selector)?.textContent?.trim(); if (value && value.length < 180) return value; }
    return document.title.replace(/\s*[-|·]\s*(ChatGPT|Claude|Gemini|DeepSeek|豆包|Kimi|千问|腾讯元宝).*$/i, "").trim() || `${service.name} conversation`;
  }

  function extractConversation() {
    const service = registry?.fromUrl(location.href);
    if (!service || service.kind !== "ai") throw new Error("unsupported_page");
    const profile = profiles[service.key]; if (!profile) throw new Error("platform_adapter_missing");
    const elements = candidateElements(profile), messages = [], seen = new Set();
    elements.forEach((element, index) => {
      const clone = cleanClone(element), text = clone.innerText?.replace(/\n{3,}/g, "\n\n").trim() || "";
      if (!text || text.length < 2) return;
      const role = roleFor(element, index), fingerprint = `${role}:${text.slice(0, 300)}`;
      if (seen.has(fingerprint)) return; seen.add(fingerprint);
      const contents = [], markdown = [...clone.childNodes].map(markdownNode).join("").replace(/\n{3,}/g, "\n\n").trim();
      if (markdown) contents.push({ type: "markdown", content: markdown });
      for (const image of clone.querySelectorAll("img[src]")) { const url = image.getAttribute("src"); if (url && /^https?:|^data:|^blob:/.test(url)) contents.push({ type: "image", url, alt: image.getAttribute("alt") || "" }); }
      messages.push({ id: element.getAttribute("data-message-id") || element.id || `message-${messages.length + 1}`, role, contents });
    });
    if (!messages.length) throw new Error("conversation_not_found");
    return { id: location.pathname, platform: service.key, platformName: service.name, title: extractTitle(service), sourceUrl: location.href, exportedAt: Date.now(), completeness: profile.complete ? "unknown" : "partial", warnings: profile.complete ? ["The visible conversation was extracted; verify long conversations before export."] : ["This platform currently uses page extraction and may include only loaded messages."], messages };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== "MAIW_EXTRACT_CONVERSATION") return false;
    try { sendResponse({ ok: true, conversation: extractConversation() }); }
    catch (error) { sendResponse({ ok: false, reason: error.message || "extract_failed" }); }
    return false;
  });
})();
