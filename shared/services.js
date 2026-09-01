(function initMultiAIServiceRegistry(global) {
  "use strict";
  const commonInputs = ["textarea", "[contenteditable='true'][role='textbox']", "[contenteditable='true']", "div.ProseMirror", "div.ql-editor"];
  const commonSends = ["button[type='submit']", "button[aria-label*='Send']", "button[aria-label*='发送']", "button[data-testid*='send']", "[role='button'][aria-label*='Send']", "[role='button'][aria-label*='发送']"];
  const adapters = {
    doubao: { inputSelectors: ["[data-testid*='chat-input'] textarea", "textarea[data-testid*='input']", "div[contenteditable='true']", ...commonInputs], sendSelectors: ["button[data-testid*='send']", "button[aria-label*='发送']", ...commonSends], modeLabels: { expert: ["深度思考", "专家"], fast: ["快速", "普通"] } },
    kimi: { inputSelectors: ["div.chat-input-editor[contenteditable='true']", "div.ProseMirror", ...commonInputs], sendSelectors: ["button.send-button", "button[class*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "K1.5"], fast: ["快速", "普通"] } },
    deepseek: { inputSelectors: ["#chat-input", "textarea[placeholder*='DeepSeek']", ...commonInputs], sendSelectors: ["button[aria-label='发送消息']", "button[class*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "DeepThink"], fast: ["深度思考", "DeepThink"] } },
    zhipu: { inputSelectors: ["textarea[class*='input']", "div.ProseMirror", ...commonInputs], sendSelectors: ["button[class*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "专家"], fast: ["快速", "标准"] } },
    qianwen: { inputSelectors: ["div.ProseMirror", "textarea[class*='chat']", ...commonInputs], sendSelectors: ["button[class*='send']", "button[data-testid*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "思考"], fast: ["快速", "非思考"] } },
    yuanbao: { inputSelectors: ["div[contenteditable='true'][class*='input']", "textarea[class*='input']", ...commonInputs], sendSelectors: ["button[class*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "专家"], fast: ["快速", "标准"] } },
    minimax: { inputSelectors: ["textarea[placeholder]", "div.ProseMirror", ...commonInputs], sendSelectors: ["button[class*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "专家"], fast: ["快速", "标准"] } },
    zhida: { inputSelectors: ["textarea[class*='input']", "div[contenteditable='true']", ...commonInputs], sendSelectors: ["button[class*='send']", ...commonSends], modeLabels: { expert: ["深度思考", "专业"], fast: ["快速", "简洁"] } },
    chatgpt: { inputSelectors: ["#prompt-textarea", "div.ProseMirror[contenteditable='true']", ...commonInputs], sendSelectors: ["#composer-submit-button", "button[data-testid='send-button']", ...commonSends], fileSelectors: ["input[type='file'][multiple]", "input[type='file']"] },
    gemini: { inputSelectors: ["div.ql-editor[contenteditable='true']", "rich-textarea div[contenteditable='true']", ...commonInputs], sendSelectors: ["button.send-button", "button[aria-label*='Send message']", ...commonSends], modeLabels: { expert: ["Deep Research", "思考"], fast: ["快速", "Fast"] } },
    copilot: { inputSelectors: ["textarea#userInput", "textarea[aria-label*='Copilot']", ...commonInputs], sendSelectors: ["button[aria-label*='Submit']", "button[aria-label*='发送']", ...commonSends] },
    grok: { inputSelectors: ["textarea[placeholder]", "div[contenteditable='true']", ...commonInputs], sendSelectors: ["button[aria-label*='Submit']", "button[data-testid*='send']", ...commonSends] },
    claude: { inputSelectors: ["div.ProseMirror[contenteditable='true']", "div[contenteditable='true'][data-placeholder]", ...commonInputs], sendSelectors: ["button[aria-label*='Send Message']", "button[aria-label*='发送']", ...commonSends] }
  };
  const ai = [
    ["doubao", "豆包", "https://www.doubao.com/chat/", ["doubao.com"]],
    ["kimi", "Kimi", "https://www.kimi.com/", ["kimi.com"]],
    ["deepseek", "DeepSeek", "https://chat.deepseek.com/", ["chat.deepseek.com"]],
    ["zhipu", "智谱清言", "https://chatglm.cn/main/alltoolsdetail", ["chatglm.cn"]],
    ["qianwen", "千问", "https://www.qianwen.com/chat/", ["qianwen.com", "qwen.com", "chat.qwen.ai"]],
    ["yuanbao", "腾讯元宝", "https://yuanbao.tencent.com/", ["yuanbao.tencent.com"]],
    ["minimax", "MiniMax", "https://agent.minimaxi.com/", ["agent.minimaxi.com", "minimaxi.com"]],
    ["zhida", "知乎直答", "https://zhida.zhihu.com/", ["zhida.zhihu.com"]],
    ["chatgpt", "ChatGPT", "https://chatgpt.com/", ["chatgpt.com"]],
    ["gemini", "Gemini", "https://gemini.google.com/app", ["gemini.google.com"]],
    ["copilot", "Copilot", "https://www.copilot.com/", ["copilot.com", "copilot.microsoft.com"]],
    ["grok", "Grok", "https://grok.com/", ["grok.com"]],
    ["claude", "Claude", "https://claude.ai/new", ["claude.ai"]]
  ].map(([key, name, home, hosts]) => ({ key, name, kind: "ai", home, hosts, fileSelectors: ["input[type='file']"], supportsAttachments: true, attachmentStrategy: ["chatgpt", "gemini", "copilot", "claude", "grok"].includes(key) ? "auto-discovery" : "file-input", ...adapters[key] }));
  const auxiliary = [
    { key: "google", name: "Google", kind: "search", home: "https://www.google.com/", hosts: ["google.com"], query: "https://www.google.com/search?q={q}" },
    { key: "bing", name: "Bing", kind: "search", home: "https://www.bing.com/", hosts: ["bing.com"], query: "https://www.bing.com/search?q={q}" },
    { key: "baidu", name: "百度", kind: "search", home: "https://www.baidu.com/", hosts: ["baidu.com"], query: "https://www.baidu.com/s?wd={q}" },
    { key: "wechat", name: "公众号", kind: "content", home: "https://weixin.sogou.com/", hosts: ["weixin.sogou.com"], query: "https://weixin.sogou.com/weixin?type=2&query={q}" },
    { key: "zhihu", name: "知乎", kind: "content", home: "https://zhihu.sogou.com/", hosts: ["zhihu.sogou.com"], query: "https://www.sogou.com/sogou?insite=zhihu.com&query={q}" }
  ];
  const services = [...ai, ...auxiliary];
  const byKey = Object.fromEntries(services.map((service) => [service.key, service]));
  function normalizeHost(hostname) { return String(hostname || "").toLowerCase().replace(/^www\./, ""); }
  function hostMatches(hostname, expected) { const host = normalizeHost(hostname); const suffix = normalizeHost(expected); return host === suffix || host.endsWith(`.${suffix}`); }
  function fromUrl(url) {
    try { const host = new URL(url).hostname; return services.find((service) => service.hosts.some((candidate) => hostMatches(host, candidate))) || null; }
    catch { return null; }
  }
  function normalizeFrameUrl(serviceKey, value) {
    const service = byKey[serviceKey]; if (!service || typeof value !== "string") return "";
    try {
      const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || !service.hosts.some((host) => hostMatches(url.hostname, host))) return "";
      if (serviceKey === "gemini" && url.pathname.startsWith("/_/")) return "";
      return url.href;
    } catch { return ""; }
  }
  function restoresOnStartup(serviceKey) { return serviceKey !== "doubao"; }
  global.MultiAIServiceRegistry = Object.freeze({ services: Object.freeze(services), ai: Object.freeze(ai), auxiliary: Object.freeze(auxiliary), byKey: Object.freeze(byKey), defaults: Object.freeze(["deepseek", "doubao", "yuanbao"]), maxFrames: 10, fromUrl, hostMatches, normalizeFrameUrl, restoresOnStartup });
})(typeof self !== "undefined" ? self : window);
