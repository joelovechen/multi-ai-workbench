# 隐私政策 / Privacy Policy

生效日期：2026 年 9 月 3 日 / Effective date: September 3, 2026

多AI问答助手不设产品账号，不收集遥测，不托管 API 密钥，不运行问题中转服务器。数据主要保存在用户的浏览器中。只有用户主动发送时，问题、选中文字和附件才会直接交给所选第三方平台。扩展包含可关闭的“AI 工具精选”入口，其中部分链接为推广链接。

Multi AI Workbench has no product account, telemetry, API-key hosting, or operator-run prompt proxy. Data is mainly stored in the user's browser. Questions, selected text, and files are sent directly to selected third-party services only when the user initiates the action. The extension includes an optional Featured AI Tools entry containing clearly labeled affiliate links.

## 处理的数据

- 本地设置、历史、提示词操作、侧栏草稿、划线笔记、相关页面地址以及首次告知确认记录保存在当前浏览器。
- 用户主动发送、执行右键菜单或快捷键操作时，相关问题、选中文字和附件会直接提交给所选第三方平台。
- 扩展不主动读取 Cookie、密码或登录凭据，不包含广告 SDK、用户画像、遥测或第三方分析 SDK。
- 扩展从 `multi-ai-workbench-catalog.pages.dev` 和 `joelovechen.github.io` 获取公开的推荐目录与图标。请求不包含问题、回答、选中文字、附件、历史记录或扩展生成的用户标识。

## AI 工具精选与推广链接

- 顶部“AI 工具精选”是可选入口，可在设置中隐藏。
- 部分工具卡包含推广链接。用户通过这些链接注册或付费时，开发者可能获得佣金，但不会增加用户的购买价格。
- 扩展不自行记录工具曝光、点击、注册或付费数据，也不运行跳转中转服务。
- 打开目录时，托管服务会像普通 HTTPS 服务一样接收网络连接通常包含的信息，例如 IP 地址和 User-Agent。
- 用户点击推广链接后进入独立第三方网站；该网站及联盟服务可能根据各自隐私政策使用 Cookie 或其他归因技术。

## Featured AI Tools and affiliate links

- Featured AI Tools is optional and can be hidden in Settings.
- Some tool cards contain affiliate links. The developer may earn a commission if a user registers or purchases through a link, at no additional cost to the user.
- The extension does not operate click tracking or redirect services and does not record impressions, clicks, registrations, or purchases.
- Catalog hosts receive ordinary connection information such as IP address and User-Agent when the public catalog and icons are requested.
- After a user clicks an affiliate link, the independent destination and affiliate network may use cookies or other attribution technologies under their own policies.

## 权限用途

- `storage` 保存本地数据。
- `tabs` 和 `webNavigation` 识别平台与导航状态。
- `scripting`、`activeTab` 和 `contextMenus` 在用户主动操作时读取选中文字。
- `declarativeNetRequest` 仅对清单中支持平台的 `sub_frame` 请求移除 `Content-Security-Policy`、`Content-Security-Policy-Report-Only` 和 `X-Frame-Options` 响应头，使平台官方网页能够显示在用户主动打开的对比工作台或侧栏中。规则不修改普通顶层页面、请求正文、Cookie 或登录凭据。
- 已支持 AI/搜索平台的主机权限用于嵌入平台页面和执行用户主动发起的操作。
- 两个精确的目录主机权限只用于读取签名后的推荐 JSON 和图标，不用于读取用户在这些网站上的页面内容。
- `http://*/*` 与 `https://*/*` 是可选权限。只有用户选择“所有普通网页显示桌宠”并在浏览器授权后才启用，仅用于注入桌宠入口；桌宠脚本不读取、记录或上传网页正文。用户可改回“仅支持平台”或关闭桌宠并撤销该权限。

## 保存、删除和联系

本地数据保留至用户主动删除、清除扩展数据或卸载插件。附件仅在当次发送中临时处理。本插件不专门面向未满 13 周岁儿童。如数据处理方式发生重大变化，将提升告知版本以重新获得用户确认。

本扩展是独立开发的开源工具，与所支持的 AI、搜索或内容平台不存在隶属、授权或合作关系。相关名称、商标和图标归各自权利人所有，仅用于识别用户选择的目标服务。

- 开发者：[joelovechen](https://github.com/joelovechen)
- 联系方式：[GitHub Issues](https://github.com/joelovechen/multi-ai-workbench/issues)
- 开源地址：[github.com/joelovechen/multi-ai-workbench](https://github.com/joelovechen/multi-ai-workbench)

扩展内的完整中英文隐私页面为 `privacy/index.html`。
