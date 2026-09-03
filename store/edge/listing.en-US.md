# Microsoft Edge Add-ons listing (English)

## Name

Multi AI Workbench

## Short description

Ask multiple official AI websites at once and compare answers side by side or in the side panel, with local prompts, history, notes, and export.

## Detailed description

Multi AI Workbench is a free, open-source, local-first extension for asking several third-party AI services the same question and comparing their native answers. View services side by side in the full-page workbench, or switch between them in the browser side panel while still sending a question to multiple services.

Key features:

- Ask several AI services at once and compare their answers.
- Display up to 10 services in one-row or two-row workbench layouts with drag ordering and adjustable widths.
- Use a native side panel that shows one service at a time while retaining multi-service sending.
- Start with DeepSeek, Doubao, and Tencent Yuanbao enabled; DeepSeek is the default side-panel service.
- Supports ChatGPT, Gemini, Claude, Kimi, Zhipu Qingyan, Qwen, MiniMax, Zhihu Zhida, Copilot, Grok, and more.
- Attach images and common document formats where the selected service supports them.
- Run bidirectional Chinese/English translation, summarization, or plain-language explanation from selected webpage text using the context menu or keyboard shortcuts.
- Create custom prompt actions, menu groups, target-service combinations, and shortcut slots.
- Keep local session history, question navigation, highlights, notes, and selected-content collections.
- Export user-selected content as Markdown, PNG, or PDF through browser printing.
- Use a draggable static or animated pet launcher on supported sites, or optionally authorize it on regular websites.
- Open an optional Featured AI Tools catalog containing clearly labeled affiliate links. The developer may earn a commission when a user registers or purchases through a link.

Privacy and data handling:

- No extension product account, membership, or API-key management.
- No advertising SDK, telemetry, profiling, or third-party analytics SDK; the optional affiliate catalog does not track clicks.
- Settings, history, prompt actions, drafts, highlights, and notes are stored in the current browser.
- Questions, selected text, and files are submitted directly to services chosen by the user only after a user action.
- The extension operator does not run a prompt proxy and does not receive users' questions or answers.
- The public catalog and icons are fetched from publisher-maintained GitHub Pages and Cloudflare Pages without prompts, answers, or an extension-generated user identifier.
- Third-party services may require sign-in on their official pages and process content under their own terms and privacy policies.

To display official service pages inside the workbench, the extension removes CSP, CSP Report Only, and X-Frame-Options response headers only from subframe requests to listed supported services. It does not modify ordinary top-level pages, request bodies, cookies, or sign-in credentials. If a service changes or cannot be embedded temporarily, its panel still provides an Open in new tab action.

This is an independently developed open-source extension. It is not affiliated with, authorized by, or partnered with any supported service. Service names, trademarks, and icons belong to their respective owners and are used only to identify destinations selected by the user.

Source and support: https://github.com/joelovechen/multi-ai-workbench
