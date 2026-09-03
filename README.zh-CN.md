# 多AI问答助手（Multi AI Workbench）

简体中文 | [English](README.md)

免费、开源、本地优先的 Chrome 与 Microsoft Edge 多 AI 同时提问和答案对比扩展。

## 功能

- 支持 13 个 AI、3 个搜索平台和 2 个内容搜索平台。
- 默认启用 DeepSeek、豆包和腾讯元宝，侧栏首次打开默认显示 DeepSeek。
- 最多同时显示 10 个平台，支持单行、双行、平台管理和拖动排序。
- 提供可拖动提问框，以及一次显示一个 AI、同时支持多个 AI 并行提问的浏览器原生侧栏。
- 全屏工作台与侧栏模式可互斥切换。
- 支持可拖动的动画桌宠或静态图片桌宠入口。
- 支持网页选中文字后通过右键菜单或快捷键直接处理。
- 内置中英双向翻译、总结和通俗释义三个提示词操作。
- 支持自定义操作、分组、排序、目标 AI、回答模式、快捷键和发送前预览。
- 设置、会话、提示词、草稿、划线和笔记保存在浏览器本地。
- 支持 Markdown、PNG 和 PDF 导出。

## 从源码安装

1. 下载或克隆本仓库。
2. 打开 `chrome://extensions` 或 `edge://extensions`。
3. 开启开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 选择仓库根目录，或选择 `dist/multi-ai-workbench-unpacked` 使用已构建版本。

## 开发验证

```powershell
npm test
npm run verify
npm run package
```

第三方 AI 网页可能随时调整页面结构或嵌入策略。自动测试通过不代表所有第三方平台在任何时间都能正常访问。

## 隐私

扩展不提供产品账号、遥测、API 密钥托管、广告 SDK 或开发者中转服务。问题、选中文字和附件仅在用户主动操作后直接发送给用户选择的平台。顶部包含可关闭的“AI 工具精选”入口，其中部分链接为明确标注的推广链接；目录从 GitHub Pages 和 Cloudflare Pages 动态读取，扩展不自行记录点击。详细说明参见 [PRIVACY.md](PRIVACY.md)。

## 开发者与支持

- 开发者：[joelovechen](https://github.com/joelovechen)
- 问题反馈：[GitHub Issues](https://github.com/joelovechen/multi-ai-workbench/issues)
- 开源地址：[github.com/joelovechen/multi-ai-workbench](https://github.com/joelovechen/multi-ai-workbench)

## 开源协议

源码采用 [MIT License](LICENSE)。再分发素材的版权与许可说明参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
