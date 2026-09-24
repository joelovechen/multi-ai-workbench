# Multi AI Workbench

[简体中文](README.zh-CN.md) | English

A free, open-source, local-first Chrome and Microsoft Edge extension for asking multiple AI services at once and comparing their answers.

## Features

- Supports 13 AI services, 3 search engines, and 2 content-search services.
- Enables DeepSeek, Doubao, and Tencent Yuanbao by default; the side panel opens DeepSeek first.
- Does not force-open a full-screen page after installation; the first toolbar click opens the side panel and shows a short single/double/triple-click tutorial.
- Shows up to 10 services in one-row or two-row layouts with drag-and-drop ordering.
- Provides a draggable prompt composer and a native browser side panel that displays one AI at a time while still supporting parallel queries.
- Switches cleanly between full-page and side-panel modes.
- Offers a draggable animated or static desktop-pet launcher on supported pages.
- Lets you configure the pet's single-, double-, and triple-click actions; triple-click opens the conversation export center by default.
- Loads earlier messages where the supported AI page permits it and labels every extraction as complete or partial based on observable evidence.
- Provides searchable previews, role/range selection, Markdown, TXT, JSON, real DOCX, Markdown resource ZIP, Base64 images, long PNG, and print/PDF.
- Adds configurable webpage context-menu exports, filenames, image handling, document styling, and PDF page options.
- Covers 17 conversation-export entries with local service-identification icons; Markdown, TXT, DOCX, and JSON can download the full conversation directly without opening the preview page.
- Sends selected webpage text through context-menu actions or keyboard shortcuts.
- Includes three built-in prompt actions: bidirectional Chinese/English translation, summarization, and plain-language explanation.
- Supports custom prompt actions, groups, ordering, target services, answer modes, shortcuts, and send previews.
- Stores settings, sessions, prompt templates, drafts, highlights, and notes locally.
- Exports manually collected content as Markdown, PNG, or PDF.

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the repository root, or `dist/multi-ai-workbench-unpacked` for the packaged build.

## Development

```powershell
npm test
npm run verify
npm run package
```

The supported AI websites can change their DOM and embedding policies. Passing automated tests does not guarantee that every third-party platform is available at all times.

Current export validation note: Gemini text and complete-history extraction has been exercised with a signed-in session, but exporting conversations that contain images currently fails. The image resource pipeline is blocked pending parity repair and output-file verification; do not treat the current development build as a release candidate.

## Privacy

The extension has no product account, telemetry, API-key hosting, advertising SDK, or operator-run prompt proxy. Questions, selected text, and attachments are sent directly to services chosen by the user only after a user action. An optional Featured AI Tools entry contains clearly labeled affiliate links; its signed catalog is fetched from GitHub Pages and Cloudflare Pages without extension-operated click tracking. See [PRIVACY.md](PRIVACY.md).

## Developer and support

- Developer: [joelovechen](https://github.com/joelovechen)
- Support: [GitHub Issues](https://github.com/joelovechen/multi-ai-workbench/issues)
- Source: [github.com/joelovechen/multi-ai-workbench](https://github.com/joelovechen/multi-ai-workbench)

## License

The project source is released under the [Unlicense](LICENSE). Redistributed third-party assets keep their original licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
