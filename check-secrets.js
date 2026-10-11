#!/usr/bin/env node
/* ============================================================
   check-secrets.js — 仓库密钥红线检查（Day 23 立）

   【为什么要写它】
   手工搜一次没有意义：下次没人记得该搜哪些词、该排除哪些文件。
   固化成一条命令，才能每次提交前都跑一遍，而且结果可复现。

   【口径：两组模式，性质完全不同，绝不能混为一谈】
     【红线】通用真密钥特征 —— 命中任何一条就是失败（退出码 1）。
             这些值的共同点是「拿到就能用」，所以绝不能进仓库。
     【豁免】本平台 publishable key —— 设计上公开的标识符，只报告、不拦截。
             豁免不是「眼不见为净」，而是「写明理由 + 有实测支撑」：
             它旁边（js/cloud-config.js）就写着为什么它可以进源码，
             并且 2026-10-11 用裸通道实测过它没有任何写权限。

   【扫描范围】git 跟踪的文件（git ls-files）。
   为什么不用「递归读目录」：那会把 .git 内部对象、node_modules、
   以及尚未跟踪的临时文件一起扫进来 —— 它们要么是噪声，要么根本不上仓库。
   提交前跑这一条，覆盖面与「实际会被上传的东西」严格一致。

   用法：node check-secrets.js
   ============================================================ */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SELF = path.basename(__filename);

/** 只扫这些扩展名的文件（二进制 / 图片一律不看） */
const TEXT_EXT = [".js", ".mjs", ".cjs", ".html", ".htm", ".css", ".md", ".sql", ".json", ".svg", ".txt", ".yml", ".yaml", ".toml", ".sh"];

/* ---------------- 【红线】通用真密钥特征：命中即失败 ---------------- */
const RED_LINES = [
  { name: "私钥文件块",       re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "AWS Access Key",   re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub Token",     re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "通用 sk- 密钥",     re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "Slack Token",      re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API Key",   re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  // 连接串必须「带账号密码」才算红线：postgres://user:pass@host 这种形态
  { name: "带密码的连接串",    re: /\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis):\/\/[^\s"'`/]+:[^\s"'`@]+@/i },
  { name: "JWT 实串",         re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // 要求后面跟「引号包裹的长值」，避免误伤文档里 service_role=X/… 这类权限示意
  { name: "服务端密钥字段",    re: /(service_role|SECRET_KEY|PRIVATE_KEY|MASTER_KEY|ADMIN_KEY)\s*[:=]\s*["'`][A-Za-z0-9_\-.]{12,}["'`]/i },
  { name: "口令硬编码",        re: /(password|passwd|pwd)\s*[:=]\s*["'`][^"'`\s]{6,}["'`]/i },
];

/* ---------------- 【豁免】设计上可公开的标识：只报告 ---------------- */
const ALLOW_LINES = [
  { name: "本平台 publishable key", re: /wbpk_[A-Za-z0-9_]{20,}/ },
];

/* 颜色：设了 NO_COLOR 就关闭（截图 / 重定向到文件时需要干净文本） */
const COLOR_ON = !process.env.NO_COLOR;
const c = {
  dim: (s) => (COLOR_ON ? `\x1b[2m${s}\x1b[0m` : s),
  ok: (s) => (COLOR_ON ? `\x1b[32m${s}\x1b[0m` : s),
  bad: (s) => (COLOR_ON ? `\x1b[31m${s}\x1b[0m` : s),
  warn: (s) => (COLOR_ON ? `\x1b[33m${s}\x1b[0m` : s),
  b: (s) => (COLOR_ON ? `\x1b[1m${s}\x1b[0m` : s),
};

/* 取要扫的文件清单。两种口径都正当，取得到就用更精确的那个：
     · git ls-files  —— 与实际会被上传的内容严格一致（首选）
     · 目录递归      —— 未提交的新文件也一并扫，比 git 口径更保守（宁可早发现）
   本机 node 起不了子进程（EBUSY），所以这里会走第二个；换台机器有 git 就自动走第一个。 */
const SKIP_DIR = new Set([".git", "node_modules", ".cache", "tmp"]);

function listFiles() {
  const r = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  if (!r.error && r.status === 0 && r.stdout) {
    return { files: r.stdout.split("\n").map((s) => s.trim()).filter(Boolean), source: "git 跟踪范围（与实际上传内容一致）" };
  }
  const out = [];
  (function walk(dir) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP_DIR.has(name)) continue;
      const abs = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else out.push(path.relative(ROOT, abs).replace(/\\/g, "/"));
    }
  })(ROOT);
  return { files: out, source: "目录递归（未提交的新文件也扫，比 git 口径更保守）" };
}

function scanLine(file, text, rules) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    rules.forEach((r) => {
      if (r.re.test(line)) hits.push({ file, line: i + 1, rule: r.name, sample: line.trim().slice(0, 90) });
    });
  });
  return hits;
}

function main() {
  const listed = listFiles();
  const all = listed.files;
  const files = all.filter((f) => f !== SELF && TEXT_EXT.includes(path.extname(f).toLowerCase()));
  const skipped = all.length - files.length;

  console.log(c.b("仓库密钥红线检查 · foxlings-project"));
  console.log(c.dim(`扫描范围：${listed.source}`));
  console.log(c.dim(`         共 ${all.length} 个文件，${files.length} 个文本文件参与扫描，${skipped} 个非文本/本脚本跳过；已排除 ${[...SKIP_DIR].join(" / ")}`));
  console.log("");

  const redHits = [];
  const allowHits = [];
  const unreadable = [];

  files.forEach((f) => {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, f), "utf8");
    } catch (e) {
      unreadable.push(f);
      return;
    }
    redHits.push(...scanLine(f, text, RED_LINES));
    allowHits.push(...scanLine(f, text, ALLOW_LINES));
  });

  // ---- 第 1 组：红线 ----
  console.log(c.b("【红线】通用真密钥特征（命中任何一条 = 失败）"));
  console.log(c.dim("  " + RED_LINES.map((r) => r.name).join(" · ")));
  if (redHits.length === 0) {
    console.log("  结果：" + c.ok("0 条") + "  ✅");
  } else {
    console.log("  结果：" + c.bad(redHits.length + " 条") + "  ❌");
    redHits.forEach((h) => console.log(c.bad(`    ${h.file}:${h.line}  [${h.rule}]  ${h.sample}`)));
  }
  console.log("");

  // ---- 第 2 组：配置类文件是否混进仓库 ----
  console.log(c.b("【配置】.env / 证书 / 私钥类文件是否进了仓库或漏了忽略"));
  const badFiles = all.filter((f) => /(^|\/)\.env|\.pem$|\.key$|(^|\/)id_rsa/i.test(f));
  const ignoreRules = (() => {
    try {
      return fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
    } catch {
      return "";
    }
  })();
  const needRules = [".env", "*.pem", "*.key", "id_rsa*"];
  const missing = needRules.filter((r) => !ignoreRules.includes(r));
  if (badFiles.length === 0 && missing.length === 0) {
    console.log("  仓库内此类文件：" + c.ok("0 个") + "   ·   .gitignore 规则：" + c.ok("齐全") + "  ✅");
  } else {
    if (badFiles.length) console.log(c.bad("  仓库里存在：" + badFiles.join(", ")));
    if (missing.length) console.log(c.bad("  .gitignore 缺少规则：" + missing.join(", ")));
  }
  console.log("");

  // ---- 第 3 组：豁免项 ----
  console.log(c.b("【豁免】本平台 publishable key（公开标识，非密钥）"));
  if (allowHits.length === 0) {
    console.log(c.dim("  未出现。"));
  } else {
    console.log(c.warn(`  命中 ${allowHits.length} 处 —— 以下用途已定性为「可公开」，不计入失败：`));
    allowHits.forEach((h) => console.log(c.warn(`    ${h.file}:${h.line}`)));
    console.log(c.dim("  豁免理由：它只表明「哪个应用发来的请求」，本身不带任何权限；浏览器里本来就可见。"));
    console.log(c.dim("  实测（2026-10-11，裸通道拿它越权）：读公开条目 200 ｜ 改热度 401 ｜ 删条目 401 ｜ 读他人线索 401"));
    console.log(c.dim("  结论：拿到它也只能做「所有人本来就能做的事」。"));
  }
  console.log("");

  if (unreadable.length) console.log(c.dim(`（有 ${unreadable.length} 个文件读不出文本，已跳过：${unreadable.slice(0, 3).join(", ")}）`));

  const pass = redHits.length === 0 && badFiles.length === 0 && missing.length === 0;
  console.log(c.b(pass ? c.ok("结论：PASS —— 红线 0 条，仓库里没有真密钥。") : c.bad("结论：FAIL —— 见上方红色条目，修掉再提交。")));
  process.exit(pass ? 0 : 1);
}

main();
