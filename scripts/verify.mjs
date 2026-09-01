import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const petAnimations = [
  "pet-idle.webm", "pet-click.webm", "pet-drag.webm", "pet-click-happy.webm", "pet-click-shy.webm", "pet-click-laugh.webm", "pet-click-angry.webm",
  "pet-random-look.webm", "pet-random-yawn.webm", "pet-random-stretch.webm", "pet-random-cube.webm", "pet-random-code.webm", "pet-random-snack.webm", "pet-random-hum.webm", "pet-random-dance.webm", "pet-random-think.webm"
].map((name) => `assets/pet/${name}`);
const required = [
  "manifest.json", "background/index.js", "content/bridge.js", "content/main-world.js", "content/floating-launcher.js", "shared/services.js",
  "shared/platform-adapters.js", "shared/prompt-templates.js", "scripts/behavior-tests.mjs",
  "shared/export-core.js",
  "workspace/index.html", "workspace/app.js", "workspace/styles.css", "rules/embed-headers.json",
  "sidepanel/index.html", "sidepanel/app.js", "sidepanel/styles.css",
  "README.md", "PRIVACY.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "assets/launcher-pet.png", ...petAnimations, "shared/privacy-ui.js", "privacy/index.html", "privacy/styles.css", "privacy/app.js"
];
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

for (const file of required) check(existsSync(join(root, file)), `缺少文件：${file}`);
const productIcon = existsSync(join(root, "assets/launcher-pet.png")) ? readFileSync(join(root, "assets/launcher-pet.png")) : null;
check(productIcon?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && productIcon.length === 40188, "统一产品图标不是指定的 notify-test PNG");
for (const name of readdirSync(join(root, "assets/platform-icons"))) {
  const data = readFileSync(join(root, "assets/platform-icons", name));
  const prefix = data.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  const validSvg = name.toLowerCase().endsWith(".svg") && prefix.startsWith("<svg");
  check(validSvg || !prefix.startsWith("<"), `平台图标包含网页响应而不是图像：assets/platform-icons/${name}`);
}
for (const file of petAnimations) {
  const data = existsSync(join(root, file)) ? readFileSync(join(root, file)) : null;
  check(data?.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), `桌宠动画不是有效 WebM/EBML 文件：${file}`);
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
check(manifest.manifest_version === 3, "manifest_version 必须为 3");
check(manifest.name === "多AI问答助手", "Manifest 产品名不一致");
check(!manifest.permissions?.includes("identity"), "不得申请 identity 登录权限");
check(!manifest.permissions?.includes("cookies"), "不得申请 cookies 权限");
check(["contextMenus", "activeTab", "scripting"].every((permission) => manifest.permissions?.includes(permission)), "选中文字入口缺少最小必要权限");
check(!manifest.optional_permissions?.includes("bookmarks"), "不得保留无关书签权限");
check(Boolean(manifest.commands?.["ask-selection"] && manifest.commands?.["open-template-picker"]), "选中文字快捷键声明不完整");
for (let slot = 1; slot <= 8; slot += 1) check(Boolean(manifest.commands?.[`action-slot-${slot}`]), `快捷操作 ${slot} 未声明`);
check(manifest.content_scripts?.some((entry) => entry.world === "MAIN" && entry.run_at === "document_start" && entry.js?.includes("content/main-world.js")), "受控输入和附件必须有 document_start MAIN world 桥接");
check(manifest.content_scripts?.some((entry) => entry.js?.includes("content/floating-launcher.js") && entry.all_frames !== true), "网页启动球必须只在顶层受支持页面注入");
check(manifest.web_accessible_resources?.some((entry) => entry.resources?.includes("assets/launcher-pet.png") && entry.matches?.length), "桌宠图像未按受支持域名声明为可访问资源");
check(petAnimations.every((asset) => manifest.web_accessible_resources?.some((entry) => entry.resources?.includes(asset))), "桌宠 WebM 动画资源声明不完整");
check(Object.values(manifest.icons || {}).every((path) => path === "assets/launcher-pet.png") && manifest.action?.default_icon?.["16"] === "assets/launcher-pet.png", "扩展图标未使用图片桌宠素材");
check(["workspace/index.html", "sidepanel/index.html", "privacy/index.html"].every((file) => readFileSync(join(root, file), "utf8").includes('rel="icon" type="image/png" href="../assets/launcher-pet.png"')), "扩展页面 favicon 未统一使用产品图标");
check(manifest.permissions?.includes("sidePanel") && manifest.side_panel?.default_path === "sidepanel/index.html", "原生侧栏权限或入口缺失");

const sandbox = { self: {}, URL };
vm.runInNewContext(readFileSync(join(root, "shared/services.js"), "utf8"), sandbox);
vm.runInNewContext(readFileSync(join(root, "shared/platform-adapters.js"), "utf8"), sandbox);
const registry = sandbox.self.MultiAIServiceRegistry;
check(Boolean(registry), "平台注册表没有成功初始化");
check(registry?.ai?.length === 13, "AI 平台数量应为 13");
check(registry?.auxiliary?.length === 5, "搜索和内容平台数量应为 5");
check(registry?.maxFrames === 10, "最大面板数应为 10");
check(registry?.defaults?.every((key) => registry.byKey[key]), "默认平台包含无效项");
check(JSON.stringify([...registry.defaults]) === JSON.stringify(["deepseek", "doubao", "yuanbao"]), "默认平台必须依次为 DeepSeek、豆包和腾讯元宝");
check(new Set(registry?.ai?.map((service) => service.inputSelectors?.[0])).size >= 10, "平台适配器过度共用输入选择器");
check(registry?.ai?.every((service) => service.inputSelectors?.length && service.sendSelectors?.length), "存在缺少输入或发送选择器的 AI 平台");
check(registry?.ai?.filter((service) => service.modeLabels).length >= 8, "专家/快速模式平台配置不足");
check(registry?.ai?.every((service) => service.messageSelectors?.length && service.newChatSelectors?.length), "存在缺少发送确认或新对话适配的 AI 平台");
check(registry?.ai?.every((service) => service.attachmentEvidenceSelectors?.length && service.uploadErrorSelectors?.length), "存在缺少附件完成/失败证据的 AI 平台");

const backgroundSource = readFileSync(join(root, "background/index.js"), "utf8");
const bridgeSource = readFileSync(join(root, "content/bridge.js"), "utf8");
const workspaceSource = readFileSync(join(root, "workspace/app.js"), "utf8");
for (const signal of ["answerMode", "FRAME_NAVIGATED", "attachment_incomplete", "confirmed"]) check(backgroundSource.includes(signal) || bridgeSource.includes(signal), `发送链缺少实现信号：${signal}`);
for (const signal of ["FRAME_NAVIGATED", "frameUrls", "session.urls", "sanitizeHtml", "nodeToMarkdown", "selected === false", "LOCATE_QUESTION_ALL"]) check(workspaceSource.includes(signal), `工作台缺少实现信号：${signal}`);
for (const signal of ["ClipboardEvent", "modeControl", "upload_unconfirmed", "questionEvidenceCount", "send_confirmation_timeout", "newChatSelectors", "multiAiPickerId", "highlightStyle", "deleteHighlight"]) check(bridgeSource.includes(signal), `页面适配缺少实现信号：${signal}`);
check(!/ok:\s*true,\s*stage:\s*["']filled["']/.test(bridgeSource), "不得把仅填入输入框冒充发送成功");
for (const removed of ["backupExport", "backupImport", "compactToggle"]) check(!workspaceSource.includes(removed), `残留参考范围外功能：${removed}`);
for (const signal of ["selectionText", "maiw.pendingTask", "rebuildContextMenus", "readSelectionFromTab"]) check(backgroundSource.includes(signal), `选中文字入口缺少实现信号：${signal}`);
const sidepanelSource = readFileSync(join(root, "sidepanel/app.js"), "utf8");
for (const signal of ["consumePendingTask", "maiw.sidepanelDraft", "failedServices", "composedQuestion"]) check(sidepanelSource.includes(signal), `侧栏易用性链缺少实现信号：${signal}`);
const privacySource = readFileSync(join(root, "shared/privacy-ui.js"), "utf8");
for (const signal of ["maiw.privacyConsent", "acceptedAt", "privacy/index.html", "No operator data server"]) check(privacySource.includes(signal), `首次隐私告知缺少实现信号：${signal}`);
const workspaceInitialize = workspaceSource.slice(workspaceSource.indexOf("async function initialize()"));
const sidepanelInitialize = sidepanelSource.slice(sidepanelSource.indexOf("async function initialize()"));
check(workspaceInitialize.indexOf("ensureConsent") < workspaceInitialize.indexOf("renderFrames(); renderHistory()"), "全屏工作台必须在加载第三方平台前完成隐私告知");
check(sidepanelInitialize.indexOf("ensureConsent") < sidepanelInitialize.indexOf("renderFrames(); renderManager()"), "侧栏必须在加载第三方平台前完成隐私告知");

const dnrRules = JSON.parse(readFileSync(join(root, "rules/embed-headers.json"), "utf8"));
check(dnrRules.every((rule) => rule.condition?.resourceTypes?.includes("sub_frame")), "嵌入响应头规则必须限定到 sub_frame");
check(dnrRules.every((rule) => Array.isArray(rule.condition?.requestDomains) && rule.condition.requestDomains.length), "嵌入响应头规则必须限定平台域名");

for (const file of ["background/index.js", "content/bridge.js", "content/main-world.js", "content/floating-launcher.js", "shared/services.js", "shared/platform-adapters.js", "shared/prompt-templates.js", "shared/export-core.js", "workspace/app.js", "sidepanel/app.js"]) {
  try { execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" }); }
  catch (error) { failures.push(`${file} 语法检查失败：${error.stderr?.toString() || error.message}`); }
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "dist" || name === "node_modules") return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}
for (const file of sourceFiles(root)) {
  if (!/\.(?:js|json|html|css|md)$/i.test(file)) continue;
  const source = readFileSync(file, "utf8");
  check(!source.includes("<all_urls>"), `发现过宽的主机权限：${relative(root, file)}`);
}

if (failures.length) {
  console.error(`验证失败（${failures.length} 项）：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`验证通过：${required.length} 个必要文件、${registry.ai.length} 个 AI、${registry.auxiliary.length} 个辅助平台。`);
