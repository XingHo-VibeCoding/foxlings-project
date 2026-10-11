#!/usr/bin/env node
/* ============================================================
   env-to-js.js — 把 .env 里的**前端可见配置**转成页面能读到的 js/env.local.js

   【为什么需要它】
   本项目是「静态前端 + 托管后端」，**没有构建步骤** ——
   没有 webpack/vite 那种在打包时注入 import.meta.env 的机会。
   所以「统一走环境变量」在这里落地成两步：
     .env（人写的真值，忽略） --本脚本--> js/env.local.js（页面读的 window.__ENV__，忽略）
   页面侧读法见 js/cloud-config.js 顶部。

   【为什么只转一部分键】
   .env 里有两组键（见 .env.example）：
     组 A 前端可见（WB_*）—— 公开标识，转；
     组 B 只在服务端（DATABASE_URL / SERVICE_ROLE_KEY / LLM_API_KEY）—— **跳过**。
   理由不是「怕麻烦」，是「凭据不进浏览器」这条边界本身。脚本主动把它拦在生成环节，
   比靠人记得别写进去可靠 —— 写进 js/env.local.js 的键，一定会被页面读到。

   用法：node env-to-js.js [--env .env] [--out js/env.local.js]
   ============================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const FRONT_KEYS = ["WB_SITE_ORIGIN", "WB_ENDPOINT", "WB_PUBLISHABLE_KEY"];

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const envPath = path.resolve(ROOT, arg("env", ".env"));
const outPath = path.resolve(ROOT, arg("out", "js/env.local.js"));

if (!fs.existsSync(envPath)) {
  console.error("找不到 " + path.relative(ROOT, envPath) + "。先 `cp .env.example .env`，填好真实值再跑。");
  process.exit(1);
}

/* 只认 `KEY=VALUE`；`#` 开头的注释与空行忽略；值两侧的引号去掉 */
const parsed = {};
const skipped = [];
fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (!m) return;
  const key = m[1];
  const val = m[2].trim().replace(/^["']|["']$/g, "");
  if (!val) return;                       // 空值（.env.example 里组 B 的常态）不算配置
  if (FRONT_KEYS.indexOf(key) === -1) { skipped.push(key); return; }
  parsed[key] = val;
});

if (!parsed.WB_ENDPOINT && !parsed.WB_SITE_ORIGIN && !parsed.WB_PUBLISHABLE_KEY) {
  console.error("在 " + path.relative(ROOT, envPath) + " 里没找到任何前端可见的键（" + FRONT_KEYS.join(" / ") + "）。");
  console.error("组 B 的服务端凭据**刻意不转**：它们不该进浏览器。");
  process.exit(1);
}

const banner = [
  "/* 由 env-to-js.js 从 " + path.relative(ROOT, envPath).replace(/\\/g, "/") + " 生成 —— **不要提交**（已在 .gitignore）。",
  "   改配置请改 .env 再重跑：node env-to-js.js",
  "   这里只会出现前端可见的键（" + FRONT_KEYS.join(" / ") + "）。 */",
  "",
].join("\n");

const body = Object.keys(parsed)
  .map((k) => "  " + k + ": " + JSON.stringify(parsed[k]) + ",")
  .join("\n");

fs.writeFileSync(outPath, banner + "window.__ENV__ = {\n" + body + "\n};\n", "utf8");

/* 打印时把值遮掉一部分 —— 终端输出可能被截图 / 贴进群里 */
const mask = (v) => (v.length <= 12 ? v : v.slice(0, 12) + "…(" + v.length + " 字符)");

console.log("已生成 " + path.relative(ROOT, outPath).replace(/\\/g, "/") + "：");
Object.keys(parsed).forEach((k) => console.log("  " + k + " = " + mask(parsed[k])));
if (skipped.length) {
  console.log("已跳过（服务端凭据不进浏览器）：" + [...new Set(skipped)].join(", "));
}
