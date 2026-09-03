# Multi AI Workbench

[简体中文](README.zh-CN.md) | English

A free, open-source, local-first Chrome and Microsoft Edge extension for asking multiple AI services at once and comparing their answers.

## Features

- Supports 13 AI services, 3 search engines, and 2 content-search services.
- Enables DeepSeek, Doubao, and Tencent Yuanbao by default; the side panel opens DeepSeek first.
- Shows up to 10 services in one-row or two-row layouts with drag-and-drop ordering.
- Provides a draggable prompt composer and a native browser side panel that displays one AI at a time while still supporting parallel queries.
- Switches cleanly between full-page and side-panel modes.
- Offers a draggable animated or static desktop-pet launcher on supported pages.
- Sends selected webpage text through context-menu actions or keyboard shortcuts.
- Includes three built-in prompt actions: bidirectional Chinese/English translation, summarization, and plain-language explanation.
- Supports custom prompt actions, groups, ordering, target services, answer modes, shortcuts, and send previews.
- Stores settings, sessions, prompt templates, drafts, highlights, and notes locally.
- Exports collected content as Markdown, PNG, or PDF.

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

## Privacy

The extension has no product account, telemetry, API-key hosting, advertising SDK, or operator-run prompt proxy. Questions, selected text, and attachments are sent directly to services chosen by the user only after a user action. An optional Featured AI Tools entry contains clearly labeled affiliate links; its signed catalog is fetched from GitHub Pages and Cloudflare Pages without extension-operated click tracking. See [PRIVACY.md](PRIVACY.md).

## Developer and support

- Developer: [joelovechen](https://github.com/joelovechen)
- Support: [GitHub Issues](https://github.com/joelovechen/multi-ai-workbench/issues)
- Source: [github.com/joelovechen/multi-ai-workbench](https://github.com/joelovechen/multi-ai-workbench)

## License

The source code is released under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for redistributed asset notices.
