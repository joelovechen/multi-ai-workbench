# 隐私政策 / Privacy Policy

生效日期：2026 年 9 月 1 日 / Effective date: September 1, 2026

多AI问答助手不设产品账号，不收集遥测，不托管 API 密钥，不运行问题中转服务器。数据主要保存在用户的浏览器中。只有用户主动发送时，问题、选中文字和附件才会直接交给所选第三方平台。

Multi-AI Assistant has no product account, telemetry, API-key hosting, or operator-run prompt proxy. Data is mainly stored in the user's browser. Questions, selected text, and files are sent directly to selected third-party services only when the user initiates the action.

## 处理的数据

- 本地设置、历史、提示词操作、侧栏草稿、划线笔记、相关页面地址以及首次告知确认记录保存在当前浏览器。
- 用户主动发送、执行右键菜单或快捷键操作时，相关问题、选中文字和附件会直接提交给所选第三方平台。
- 扩展不主动读取 Cookie、密码或登录凭据，不包含广告、用户画像、遥测或第三方分析 SDK。

## 权限用途

- `storage` 保存本地数据。
- `tabs` 和 `webNavigation` 识别平台与导航状态。
- `scripting`、`activeTab` 和 `contextMenus` 在用户主动操作时读取选中文字。
- `declarativeNetRequest` 仅对列明平台的子框架调整嵌入相关响应头。
- 已支持 AI/搜索平台的主机权限用于嵌入平台页面和执行用户主动发起的操作。
- `http://*/*` 与 `https://*/*` 是可选权限。只有用户选择“所有普通网页显示桌宠”并在浏览器授权后才启用，仅用于注入桌宠入口；桌宠脚本不读取、记录或上传网页正文。用户可改回“仅支持平台”或关闭桌宠并撤销该权限。

## 保存、删除和联系

本地数据保留至用户主动删除、清除扩展数据或卸载插件。附件仅在当次发送中临时处理。本插件不专门面向未满 13 周岁儿童。如数据处理方式发生重大变化，将提升告知版本以重新获得用户确认。

- 开发者：[joelovechen](https://github.com/joelovechen)
- 联系方式：[GitHub Issues](https://github.com/joelovechen/multi-ai-workbench/issues)
- 开源地址：[github.com/joelovechen/multi-ai-workbench](https://github.com/joelovechen/multi-ai-workbench)

扩展内的完整中英文隐私页面为 `privacy/index.html`。
