# Edge 权限用途说明 / Permission Justifications

以下文本用于 Partner Center 的隐私和权限申报。应与最终上传 ZIP 中的 `manifest.json` 保持一致。

## Single purpose

在用户选择的多个第三方 AI 官方网页中发送同一问题，并在全屏工作台或浏览器侧栏中查看、切换和比较原生回答；提示词、历史、草稿、划线和笔记保存在本地。

Send one user-provided question to selected third-party AI official websites and let the user view, switch between, and compare their native answers in a full-page workbench or browser side panel. Prompts, history, drafts, highlights, and notes are stored locally.

## Permissions

| 权限 | 必要性与实际用途 |
|---|---|
| `storage` | 保存用户选择的平台、布局、主题、语言、提示词操作、会话历史、草稿、划线、笔记和首次告知状态。数据保存在浏览器扩展存储中。 |
| `tabs` | 打开或聚焦工作台、在用户要求时打开第三方平台标签页，并识别工作台标签状态。 |
| `webNavigation` | 跟踪嵌入平台的会话导航并保存可恢复的官方会话 URL。 |
| `sidePanel` | 提供一次显示一个 AI 的 Edge 原生侧栏模式。 |
| `contextMenus` | 在用户选中文字后显示直接提问、翻译、总结、释义和自定义提示词操作。 |
| `activeTab` | 用户触发右键或快捷键时，临时访问当前标签并读取其主动选中的文字。 |
| `scripting` | 在用户授权的页面中注入桌宠入口，并在快捷操作触发时读取当前选区；不用于下载或执行远程代码。 |
| `declarativeNetRequest` | 仅对列明支持平台的 `sub_frame` 请求移除 `Content-Security-Policy`、`Content-Security-Policy-Report-Only` 和 `X-Frame-Options` 响应头，使平台官方网页可显示在用户主动打开的工作台或侧栏。规则不修改普通顶层页面、请求正文、Cookie 或登录凭据。 |
| 支持平台主机权限 | 在用户选择的平台官方页面中显示 iframe、执行用户主动发起的填入/发送操作、处理附件并回传会话导航状态。域名逐项列出，没有强制申请覆盖全部网站的主机权限。 |
| 推荐目录主机权限 | 仅从 `multi-ai-workbench-catalog.pages.dev` 与 `joelovechen.github.io` 获取签名后的公开推荐 JSON 和目录图标。请求不包含用户问题、回答、附件、历史或扩展生成的用户标识。 |
| 可选 `http://*/*`、`https://*/*` | 仅当用户在首次引导或设置中选择“所有普通网页显示桌宠”并确认浏览器授权后启用，用于在普通网页显示本地桌宠按钮。拒绝后完整工作台、侧栏和支持平台功能仍然可用。桌宠脚本不记录或上传网页正文。 |

## Remote code

不使用远程代码。所有 JavaScript、CSS、桌宠和核心产品资源均包含在扩展包中。推荐服务只返回签名后的 JSON 与显示用图标，字段仅通过固定渲染器解释，不执行脚本。第三方 AI 网页作为用户选择的网页内容嵌入，不作为扩展执行代码的来源。

No remote code is used. All extension JavaScript, CSS, pet animations, and core product assets are packaged with the extension. The catalog returns only signed JSON and display icons interpreted by a fixed local renderer; it cannot supply executable code. Third-party AI pages are user-selected web content and are not used as a source of extension code.

## Data-use answers

- 出售个人信息 / Sell personal information: **No**
- 可选推广链接 / Optional affiliate recommendations: **Yes, clearly labeled and user-disableable**
- 基于个人数据的定向营销 / Personalized advertising based on personal data: **No**
- 分析或遥测 / Analytics or telemetry: **No**
- 开发者服务器收集问题或回答 / Operator server receives prompts or answers: **No**
- 本地保存用户生成内容 / Store user-generated content locally: **Yes**
- 用户主动向第三方服务发送内容 / User-initiated transfer to third-party services: **Yes**
- 读取密码、Cookie 或认证令牌 / Read passwords, cookies, or authentication tokens: **No**

公开隐私政策 URL：

https://github.com/joelovechen/multi-ai-workbench/blob/main/PRIVACY.md
