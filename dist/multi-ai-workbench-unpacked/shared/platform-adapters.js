(function enrichMultiAIAdapters(global) {
  "use strict";
  const registry = global.MultiAIServiceRegistry;
  if (!registry) return;

  const commonMessages = ["[data-message-author-role='user']", "[data-testid*='user-message' i]", "[class*='user-message' i]", "[class*='message-user' i]", "[class*='question' i]"];
  const commonEvidence = ["[data-testid*='attachment' i]", "[class*='attachment' i]", "[class*='upload' i] img", "[class*='file-preview' i]", "[class*='image-preview' i]"];
  const commonBusy = ["[class*='uploading' i]", "[data-state='uploading']", "[aria-label*='uploading' i]", "[aria-label*='上传中']"];
  const commonErrors = ["[class*='upload-error' i]", "[data-state='error']", "[aria-label*='upload failed' i]", "[aria-label*='上传失败']"];
  const commonNewChats = ["button[aria-label*='New chat' i]", "button[aria-label*='新对话']", "a[aria-label*='New chat' i]", "a[aria-label*='新对话']", "[data-testid*='new-chat' i]"];
  const commonAttachmentTriggers = ["button[aria-label*='Attach' i]", "button[aria-label*='附件']", "button[aria-label*='上传']", "button[data-testid*='attach' i]", "button[class*='attach' i]", "button[class*='upload' i]"];
  const configs = {
    doubao: { messageSelectors: ["[data-testid*='message'] [class*='user']"], newChatSelectors: ["button[data-testid*='new-chat']", "a[href='/chat/']"], modeControl: { type: "choice", expert: ["深度思考", "专家"], fast: ["快速", "普通"] } },
    kimi: { messageSelectors: ["[class*='segment-user']", "[class*='chat-content-item'] [class*='user']"], newChatSelectors: ["button[class*='new-chat']", "a[href='/']"], modeControl: { type: "choice", expert: ["深度思考", "K1.5"], fast: ["快速", "普通"] } },
    deepseek: { messageSelectors: ["[class*='message'] [class*='user']"], newChatSelectors: ["a[href='/']", "button[class*='new-chat']"], modeControl: { type: "toggle", labels: ["深度思考", "DeepThink"] } },
    zhipu: { messageSelectors: ["[class*='question-item']", "[class*='message'] [class*='user']"], newChatSelectors: ["button[class*='new-chat']", "a[href*='alltoolsdetail']"], modeControl: { type: "choice", expert: ["深度思考", "专家"], fast: ["快速", "标准"] } },
    qianwen: { messageSelectors: ["[class*='message'] [class*='user']", "[data-role='user']"], newChatSelectors: ["button[class*='new-chat']", "a[href*='/chat']"], modeControl: { type: "toggle", labels: ["深度思考", "思考"] } },
    yuanbao: { messageSelectors: ["[class*='agent-chat'] [class*='user']", "[class*='message'] [class*='user']"], newChatSelectors: ["button[class*='new-chat']", "a[href='/']"], modeControl: { type: "choice", expert: ["深度思考", "专家"], fast: ["快速", "标准"] } },
    minimax: { messageSelectors: ["[class*='message'] [class*='user']"], newChatSelectors: ["button[class*='new-chat']", "a[href='/']"], modeControl: { type: "choice", expert: ["深度思考", "专家"], fast: ["快速", "标准"] }, confirmTimeout: 16000 },
    zhida: { messageSelectors: ["[class*='question']", "[class*='message'] [class*='user']"], newChatSelectors: ["button[class*='new-chat']", "a[href='/']"], modeControl: { type: "choice", expert: ["深度思考", "专业"], fast: ["快速", "简洁"] }, sendRetryOffsets: [0, 1200, 3000, 5000, 8000, 12000], confirmTimeout: 18000 },
    chatgpt: { messageSelectors: ["[data-message-author-role='user']"], newChatSelectors: ["a[data-testid='create-new-chat-button']", "a[href='/']"] },
    gemini: { messageSelectors: ["user-query", "[class*='user-query']"], newChatSelectors: ["a[aria-label*='New chat' i]", "a[href='/app']"], modeControl: { type: "choice", expert: ["Deep Research", "思考"], fast: ["Fast", "快速"] } },
    copilot: { messageSelectors: ["cib-message-group[source='user']", "[data-content='user']"], newChatSelectors: ["button[aria-label*='New topic' i]", "a[href='/']"] },
    grok: { messageSelectors: ["[data-testid*='user-message']", "[class*='message'] [class*='user']"], newChatSelectors: ["a[href='/']", "button[aria-label*='New chat' i]"] },
    claude: { messageSelectors: ["[data-testid*='user-message']", "[class*='font-user-message']"], newChatSelectors: ["a[href='/new']", "button[aria-label*='New chat' i]"] }
  };

  for (const service of registry.ai) {
    const config = configs[service.key] || {};
    Object.assign(service, {
      messageSelectors: [...(config.messageSelectors || []), ...commonMessages],
      attachmentEvidenceSelectors: [...(config.attachmentEvidenceSelectors || []), ...commonEvidence],
      uploadBusySelectors: [...(config.uploadBusySelectors || []), ...commonBusy],
      uploadErrorSelectors: [...(config.uploadErrorSelectors || []), ...commonErrors],
      newChatSelectors: [...(config.newChatSelectors || []), ...commonNewChats],
      attachmentTriggerSelectors: [...(config.attachmentTriggerSelectors || []), ...commonAttachmentTriggers],
      sendRetryOffsets: config.sendRetryOffsets || [0, 1200, 3000],
      uploadTimeout: config.uploadTimeout || 30000,
      confirmTimeout: config.confirmTimeout || 12000,
      modeControl: config.modeControl || null
    });
  }
})(typeof self !== "undefined" ? self : window);
