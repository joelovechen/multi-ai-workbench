import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "dist", "multi-ai-workbench-unpacked");
if (existsSync(target)) rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const item of ["manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md", "assets", "background", "content", "rules", "shared", "workspace", "sidepanel", "privacy"]) {
  cpSync(join(root, item), join(target, item), { recursive: true });
}
console.log(`已生成可加载目录：${target}`);
