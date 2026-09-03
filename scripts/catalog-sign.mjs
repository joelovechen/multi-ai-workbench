import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicKey, sign } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const privatePath = join(root, ".secrets", "affiliate-catalog-private.pem");
if (!existsSync(privatePath)) execFileSync(process.execPath, [join(root, "scripts", "catalog-keys.mjs")], { stdio: "inherit" });
execFileSync(process.execPath, [join(root, "scripts", "catalog-validate.mjs")], { stdio: "inherit" });
const catalogPath = join(root, "docs", "affiliate-catalog", "catalog.json");
const payload = readFileSync(catalogPath);
const privateKey = readFileSync(privatePath);
const signature = sign("sha256", payload, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
writeFileSync(join(root, "docs", "affiliate-catalog", "catalog.sig"), `${signature}\n`);
const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
writeFileSync(join(root, "shared", "affiliate-public-key.js"), `(function(g){\"use strict\";g.MultiAIAffiliatePublicKey=\"${publicDer}\";})(globalThis);\n`);
console.log("目录签名和扩展公钥已更新。");
