# Multi AI Workbench 0.6.0

> Development status, 2026-09-23: automated checks pass and Gemini text/complete-history extraction has been exercised, but Gemini conversations containing images fail during export. The image resource pipeline remains a release blocker; no new 0.6.0 candidate should be published until actual DOCX, ZIP, image, and PDF outputs are verified.

## Conversation export and configurable pet gestures

- Triple-click the desktop pet to open a complete conversation export center without reading the page in advance.
- Configure the single-click, double-click, and triple-click actions independently in Settings.
- Extract conversations from 13 supported AI webpages into one normalized local data model, attempt to load earlier messages, and report complete/partial status from observable evidence.
- Preview, search, filter by role, select, range-select, retry, or cancel resource processing before export.
- Export as Markdown, plain text, JSON, real DOCX, a Markdown resource ZIP, Base64-image Markdown, long PNG, or print/PDF; full-chat Markdown can also be copied directly.
- Use a one-level webpage context menu and configure menu visibility, popup placement, filenames, image strategy, document styling, and PDF page options.
- Export jobs are temporary and remain in extension session storage. No prompt or conversation content is sent to the extension developer.
- Chinese and English labels are available in the new export workflow.

The previous local `ai提问-0.6` folder is an abandoned prototype and is not the source of this release. This release is developed from the verified 0.5.0 mainline.

---

# Multi AI Workbench 0.5.0

## English

- Promotes the tested adaptive side-panel build to the main release line.
- Adds an optional, bilingual AI tools catalog backed by signed static data.
- Fetches catalog data from Cloudflare Pages and GitHub Pages with signature, expiry, conflict, and rollback checks.
- Keeps all draft recommendations hidden until a real affiliate URL is explicitly configured.
- Adds clear sponsorship disclosure, privacy documentation, and a setting to hide the catalog entry.
- Preserves the adaptive platform carousel, multi-platform prompting, prompt templates, page-selection actions, keyboard shortcuts, and desktop-pet launcher.

## 中文

- 将测试完成的侧栏自适应版本提升为正式主线。
- 新增可选的中英双语“AI 工具精选”，配置来自经过签名的静态数据。
- 使用 Cloudflare Pages 与 GitHub Pages 双源加载，并校验签名、有效期、冲突及版本回退。
- 在明确配置真实推广链接前，所有草稿推荐默认隐藏。
- 增加推广关系说明、隐私说明以及隐藏入口的设置项。
- 保留自适应平台转盘、多平台同时提问、提示词模板、网页选中文本操作、快捷键和桌宠入口。
