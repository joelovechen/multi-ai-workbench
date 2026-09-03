import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const secrets = join(root, ".secrets");
const privatePath = join(secrets, "affiliate-catalog-private.pem");
const publicPath = join(secrets, "affiliate-catalog-public.pem");
if (existsSync(privatePath) || existsSync(publicPath)) throw new Error("签名密钥已存在，拒绝覆盖。");
mkdirSync(secrets, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
console.log(`已生成目录签名密钥。私钥仅保存在：${privatePath}`);
