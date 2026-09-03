import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogRoot = join(root, "docs", "affiliate-catalog");
const catalog = JSON.parse(readFileSync(join(catalogRoot, "catalog.json"), "utf8"));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const ids = (rows) => rows.map((row) => row.id);
const safeText = (value) => typeof value === "string" && value.trim() && !/<\/?(?:script|iframe)|on\w+\s*=/i.test(value);
const safeAsset = (value) => typeof value === "string" && /^icons\/[a-z0-9/_.-]+\.(?:svg|png|webp)$/i.test(value) && !value.includes("..");

check(catalog.schemaVersion === 1, "schemaVersion 必须为 1");
check(Number.isInteger(catalog.catalogVersion) && catalog.catalogVersion > 0, "catalogVersion 必须为正整数");
check(catalog.supportedLocales?.includes("zh-CN") && catalog.supportedLocales?.includes("en"), "必须支持 zh-CN 和 en");
check(Number.isFinite(Date.parse(catalog.generatedAt)), "generatedAt 无效");
check(Number.isFinite(Date.parse(catalog.expiresAt)), "expiresAt 无效");
check(new Set(ids(catalog.categories || [])).size === (catalog.categories || []).length, "分类 ID 重复");
check(new Set(ids(catalog.tools || [])).size === (catalog.tools || []).length, "工具 ID 重复");
const categoryIds = new Set(ids(catalog.categories || []));
for (const category of catalog.categories || []) {
  check(/^[a-z0-9-]+$/.test(category.id), `分类 ID 无效：${category.id}`);
  check(Number.isFinite(category.sort), `分类排序无效：${category.id}`);
  check(safeAsset(category.icon), `分类图标路径无效：${category.id}`);
  check(existsSync(join(catalogRoot, normalize(category.icon))), `分类图标不存在：${category.icon}`);
  for (const locale of ["zh-CN", "en"]) check(safeText(category.i18n?.[locale]?.name), `${category.id} 缺少 ${locale} 名称`);
}
for (const tool of catalog.tools || []) {
  check(/^[a-z0-9-]+$/.test(tool.id), `工具 ID 无效：${tool.id}`);
  check(["draft", "active", "inactive"].includes(tool.status), `工具状态无效：${tool.id}`);
  check(Number.isFinite(tool.sort), `工具排序无效：${tool.id}`);
  check(tool.categoryIds?.length && tool.categoryIds.every((id) => categoryIds.has(id)), `工具分类无效：${tool.id}`);
  check(safeAsset(tool.icon), `工具图标路径无效：${tool.id}`);
  check(existsSync(join(catalogRoot, normalize(tool.icon))), `工具图标不存在：${tool.icon}`);
  for (const locale of ["zh-CN", "en"]) {
    check(safeText(tool.i18n?.[locale]?.name), `${tool.id} 缺少 ${locale} 名称`);
    check(safeText(tool.i18n?.[locale]?.description), `${tool.id} 缺少 ${locale} 简介`);
    check(safeText(tool.i18n?.[locale]?.buttonText), `${tool.id} 缺少 ${locale} 按钮文案`);
  }
  if (tool.status === "active" && tool.visible) {
    try { check(new URL(tool.affiliate?.defaultUrl).protocol === "https:", `${tool.id} 推广 URL 必须为 HTTPS`); }
    catch { failures.push(`${tool.id} 缺少有效推广 URL`); }
  }
}
if (failures.length) { console.error(`目录验证失败（${failures.length} 项）：\n- ${failures.join("\n- ")}`); process.exit(1); }
console.log(`目录验证通过：${catalog.categories.length} 个分类、${catalog.tools.length} 个工具。`);
