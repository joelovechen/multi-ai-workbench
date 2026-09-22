(function initConversationExportPlatforms(root) {
  "use strict";

  const platforms = Object.freeze([
    {
      id: "chatgpt",
      name: "ChatGPT",
      icon: "chatgpt.png",
      hosts: ["chatgpt.com"],
      paths: [/^\/c\//, /^\/g\//, /^\/gg\//, /^\/share\//],
    },
    {
      id: "gemini",
      name: "Gemini",
      icon: "gemini.png",
      hosts: ["gemini.google.com"],
      paths: [/^\/app\//, /^\/share\//],
    },
    {
      id: "claude",
      name: "Claude",
      icon: "claude.png",
      hosts: ["claude.ai"],
      paths: [/^\/chat\//, /^\/cowork\//, /^\/share\//],
    },
    {
      id: "notebooklm",
      name: "NotebookLM",
      icon: "notebooklm.png",
      hosts: ["notebook.google.com", "notebooklm.google.com"],
      paths: [/^\/notebook\//],
    },
    {
      id: "grok",
      name: "Grok",
      icon: "grok.png",
      hosts: ["grok.com"],
      paths: [/^\/c\//, /^\/share\//],
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      icon: "deepseek.png",
      hosts: ["chat.deepseek.com"],
      paths: [/^\/a\/chat\/s\//],
    },
    {
      id: "perplexity",
      name: "Perplexity",
      icon: "perplexity.ico",
      hosts: ["www.perplexity.ai"],
      paths: [/^\/search\//, /^\/computer\/tasks\//],
    },
    {
      id: "kimi-ai",
      adapter: "kimi",
      name: "Kimi.ai",
      icon: "kimi.png",
      hosts: ["kimi.ai", "www.kimi.ai"],
      paths: [/^\/chat\//],
    },
    {
      id: "kimi-com",
      adapter: "kimi",
      name: "Kimi.com",
      icon: "kimi.png",
      hosts: ["kimi.com", "www.kimi.com"],
      paths: [/^\/chat\//],
    },
    {
      id: "qwen",
      name: "Qwen",
      icon: "qianwen.png",
      hosts: ["chat.qwen.ai"],
      paths: [/^\/(?:c|chat)\//],
    },
    {
      id: "doubao",
      name: "豆包",
      icon: "doubao.png",
      hosts: ["www.doubao.com"],
      paths: [/^\/chat\//],
    },
    {
      id: "googleaistudio",
      name: "Google AI Studio",
      icon: "googleaistudio.png",
      hosts: ["aistudio.google.com"],
      paths: [/^\/prompts\//],
    },
    {
      id: "googlesearch",
      name: "Google 搜索 AI 模式",
      icon: "google.png",
      hosts: ["www.google.com", "www.google.com.hk", "www.google.co.uk"],
      paths: [/^\/search/],
    },
    {
      id: "copilot",
      name: "Microsoft Copilot",
      icon: "copilot.png",
      hosts: ["copilot.microsoft.com"],
      paths: [/^\/chats\//],
    },
    {
      id: "m365copilot",
      name: "Microsoft 365 Copilot",
      icon: "m365copilot.ico",
      hosts: ["m365.cloud.microsoft"],
      paths: [/^\/chat\/conversation\//],
    },
    {
      id: "githubcopilot",
      name: "GitHub Copilot",
      icon: "githubcopilot.png",
      hosts: ["github.com"],
      paths: [/^\/copilot\/c\//],
    },
    {
      id: "yuanbao",
      name: "腾讯元宝",
      icon: "yuanbao.png",
      hosts: ["yuanbao.tencent.com"],
      paths: [/^\/chat\//],
    },
  ]);

  function fromUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    return (
      platforms.find(
        (platform) =>
          platform.hosts.includes(url.hostname) &&
          platform.paths.some((pattern) => pattern.test(url.pathname)),
      ) || null
    );
  }

  const api = Object.freeze({
    platforms,
    byId: Object.freeze(
      Object.fromEntries(platforms.map((row) => [row.id, row])),
    ),
    fromUrl,
  });
  root.MultiAIConversationExportPlatforms = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
