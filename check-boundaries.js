#!/usr/bin/env node
/* ============================================================
   check-boundaries.js — 输入边界的一致性校验（2026-10-11 立）

   【它解决什么问题】
   「哪些输入接受、哪些拒绝」这件事，最容易坏的方式不是「没人写」，
   而是**两端各写一个数字，改了一边忘了另一边**：
     数据库 CHECK 还是 5–500，前端某天被改成 3–800 ——
     于是用户看到「可以提交」（前端放行），点下去却收到一个看不懂的拒绝（数据库拦）。
   这种坏**没有信号**：不报错、不崩、测试也过，只有真人踩到才知道。

   所以这个脚本把边界当成**契约**来验：
     锚点（真值来源）= 数据库 CHECK 约束（AI 输入那种不落库的，锚点是前端常量）
     跟随者          = 前端 JS 校验 + 输入框 maxlength
   锚点只写在数据库里，跟随者必须与它一致 —— 数字一处定义，多处对齐。

   【为什么不是「在脚本里再抄一份数字」】
   那样就变成 4 份，谁也不知道哪份是真的。锚点从代码里**读出来**，
   脚本自己不持有任何边界数字（除了报告格式）。

   【口径】
     · 规则**没找到** = 失败（说明代码改了、这里没跟上，规则本身腐坏了）
     · 数字**对不上**  = 失败（列出锚点值与实际值）
     · 前端**没有**对应校验 = 不算失败，但要**显式说明**（如 reports.url 当前无 UI 入口）
   用法：node check-boundaries.js
   ============================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const COLOR_ON = !process.env.NO_COLOR;
const c = {
  dim: (s) => (COLOR_ON ? `\x1b[2m${s}\x1b[0m` : s),
  ok: (s) => (COLOR_ON ? `\x1b[32m${s}\x1b[0m` : s),
  bad: (s) => (COLOR_ON ? `\x1b[31m${s}\x1b[0m` : s),
  warn: (s) => (COLOR_ON ? `\x1b[33m${s}\x1b[0m` : s),
  b: (s) => (COLOR_ON ? `\x1b[1m${s}\x1b[0m` : s),
};

/* ---------------------------------------------------------------------------
   一、长度 / 区间类边界
   probes 每项：[ 标签, 文件, 正则, 维度数组, 是否锚点 ]
     维度数组与正则的捕获组**按位置对应**：["min","max"] 表示第 1 组是下限、第 2 组是上限。
     只有一个上限的约束（如 url）就写 ["max"]。
     前端那个「空值即拒」的检查没有数字，用 "exists" 表示 —— 只断言它还在。
   --------------------------------------------------------------------------- */
const BOUNDARIES = [
  {
    name: "线索正文（reports.text）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(text\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端 JS 下限", "js/mine.js", /text\.length\s*<\s*(\d+)/, ["min"]],
      ["前端 JS 上限", "js/mine.js", /text\.length\s*>\s*(\d+)/, ["max"]],
      // Day 25 补：接口层的自检也算一条腿 —— 页面校验只保护「页面自己那条路」，
      // 别的调用方会直撞数据库，所以 api.js 里必须有一份同口径的副本，且数字要对得上。
      ["接口层自检", "js/api.js", /assertText\(text,\s*"线索内容",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "mine.html", /id="rep-input"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "帖子标题（posts.title）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(title\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端 JS 下限", "js/forum.js", /title\.length\s*<\s*(\d+)/, ["min"]],
      ["前端 JS 上限", "js/forum.js", /title\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertText\(title,\s*"标题",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "index.html", /id="compose-title"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "帖子正文（posts.body）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(body\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端 JS 下限", "js/forum.js", /body\.length\s*<\s*(\d+)/, ["min"]],
      ["前端 JS 上限", "js/forum.js", /body\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertText\(body,\s*"内容",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "index.html", /id="compose-body"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "发帖昵称（posts.author_name）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(author_name\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端空值判断", "js/forum.js", /if\s*\(!v\.name\)/, ["exists"]],
      // Day 25 补：这条原来只有「非空」+ maxlength 两条腿，中间那一段（前端 JS 上限）
      // 是空的 —— 超过 20 字的称呼会一路撞到数据库 CHECK，用户拿到泛化提示。
      ["前端 JS 上限", "js/forum.js", /v\.name\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertText\(authorName,\s*"称呼",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "index.html", /id="compose-name"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "公告标题（announcements.title）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(btrim\(title\)\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端 JS 下限", "js/admin.js", /title\.length\s*<\s*(\d+)/, ["min"]],
      ["前端 JS 上限", "js/admin.js", /title\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertText\(title,\s*"公告标题",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "admin.html", /id="ann-title"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "公告正文（announcements.body）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(btrim\(body\)\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端 JS 下限", "js/admin.js", /body\.length\s*<\s*(\d+)/, ["min"]],
      ["前端 JS 上限", "js/admin.js", /body\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertText\(body,\s*"公告正文",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "admin.html", /id="ann-body"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "公告排序权重（announcements.sort_order）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /sort_order\s+BETWEEN\s+(-?\d+)\s+AND\s+(-?\d+)/, ["min", "max"], true],
      ["前端 JS 下限", "js/admin.js", /sortOrder\s*<\s*(-?\d+)/, ["min"]],
      ["前端 JS 上限", "js/admin.js", /sortOrder\s*>\s*(-?\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertInt\([^,]*,\s*"排序权重",\s*(-?\d+),\s*(-?\d+)\)/, ["min", "max"]],
      ["输入框 min/max", "admin.html", /id="ann-order"[^>]*min="(-?\d+)"[^>]*max="(-?\d+)"/, ["min", "max"]],
    ],
  },
  {
    name: "个人昵称（profiles.nickname）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(btrim\(nickname\)\)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/, ["min", "max"], true],
      ["前端空值判断", "js/mine.js", /if\s*\(!nick\)/, ["exists"]],
      ["前端 JS 上限", "js/mine.js", /nick\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /assertText\(nickname,\s*"昵称",\s*(\d+),\s*(\d+)\)/, ["min", "max"]],
      ["输入框 maxlength", "js/mine.js", /id="pf-nickname"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "个人签名（profiles.bio）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(bio\)\s*<=\s*(\d+)/, ["max"], true],
      ["前端 JS 上限", "js/mine.js", /bio\.length\s*>\s*(\d+)/, ["max"]],
      ["接口层自检", "js/api.js", /safeBio\.length\s*>\s*(\d+)/, ["max"]],
      ["输入框 maxlength", "js/mine.js", /id="pf-bio"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
  {
    name: "线索原始链接（reports.url）",
    note: "当前 UI 不采集这一列；上限由数据库兜底（匿名可写字段，必须有个头）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /char_length\(url\)\s*<=\s*(\d+)/, ["max"], true],
      // Day 25 补：接口层现在也有一道（将来接上「附链接」输入框时，别漏了这一格）
      ["接口层自检", "js/api.js", /u\.length\s*>\s*(\d+)/, ["max"]],
    ],
  },
  {
    name: "AI 拆解输入（不落库，锚点在前端常量）",
    note: "这段文本只送给 AI、不入库，所以没有数据库约束 —— 真值来源就是 js/ai.js 的常量",
    probes: [
      ["前端常量 下限", "js/ai.js", /AI_MIN_CHARS\s*=\s*(\d+)/, ["min"], true],
      ["前端常量 上限", "js/ai.js", /AI_MAX_CHARS\s*=\s*(\d+)/, ["max"], true],
      ["输入框 maxlength", "index.html", /id="ai-input"[^>]*maxlength="(\d+)"/, ["max"]],
    ],
  },
];

/* ---------------------------------------------------------------------------
   二、枚举类边界：接受哪几个值，也要两端同源
   probes 每项：[ 标签, 文件, 正则, 取值方式, 是否锚点 ]，取值方式 "list" | "options"
   --------------------------------------------------------------------------- */
const ENUMS = [
  {
    name: "帖子分类（posts.category）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /category\s+IN\s*\(([^)]*)\)/, "list", true],
      ["前端常量 POST_CATS", "js/forum.js", /const POST_CATS\s*=\s*\[([^\]]*)\]/, "list"],
      ["表单选项", "index.html", /<select id="compose-cat"[\s\S]*?<\/select>/, "options"],
    ],
  },
  {
    name: "条目结论（items.verdict）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /verdict\s+IN\s*\(([^)]*)\)/, "list", true],
      ["前端常量 VERDICTS", "js/data.js", /const VERDICTS\s*=\s*\[([^\]]*)\]/, "list"],
    ],
  },
  {
    name: "多源比对（items.cross_check）",
    probes: [
      ["数据库 CHECK", "db/schema.sql", /cross_check\s+IN\s*\(([^)]*)\)/, "list", true],
      ["前端常量 CROSS_LABELS", "js/detail.js", /const CROSS_LABELS\s*=\s*\[([^\]]*)\]/, "list"],
    ],
  },
];

/* ---------------------------------- 工具 ---------------------------------- */
const cache = new Map();
function read(rel) {
  if (cache.has(rel)) return cache.get(rel);
  let text = null;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    text = null;
  }
  cache.set(rel, text);
  return text;
}

function quoteList(s) {
  const out = [];
  const re = /'([^']*)'|"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

/* 跑一条探针，返回 { ok, why, vals } */
function probeNumeric([label, file, re, dims, isAnchor]) {
  const text = read(file);
  const base = { label, file, dims, isAnchor: !!isAnchor };
  if (text === null) return Object.assign(base, { ok: false, why: "文件不存在" });
  const m = re.exec(text);
  if (!m) return Object.assign(base, { ok: false, why: "规则没找到（代码改了、这里没跟上？）" });
  const vals = {};
  dims.forEach((d, i) => {
    if (d === "exists") vals[d] = true;
    else {
      const v = Number(m[i + 1]);
      if (!Number.isFinite(v)) return;
      vals[d] = v;
    }
  });
  return Object.assign(base, { ok: true, vals });
}

function probeEnum([label, file, re, mode, isAnchor]) {
  const text = read(file);
  const base = { label, file, isAnchor: !!isAnchor };
  if (text === null) return Object.assign(base, { ok: false, why: "文件不存在" });
  const m = re.exec(text);
  if (!m) return Object.assign(base, { ok: false, why: "规则没找到（代码改了、这里没跟上？）" });
  const vals = mode === "options"
    ? (m[0].match(/<option value="([^"]+)"/g) || []).map((s) => /value="([^"]+)"/.exec(s)[1])
    : quoteList(m[1]);
  if (!vals.length) return Object.assign(base, { ok: false, why: "取到的候选值为空" });
  return Object.assign(base, { ok: true, vals });
}

const fmt = (v) => (v === undefined ? "—" : String(v));

/* ---------------------------------- 主流程 ---------------------------------- */
let failCount = 0;

console.log(c.b("输入边界一致性校验 · foxlings-project"));
console.log(c.dim("锚点 = 数据库 CHECK（不落库的用前端常量）；跟随者 = 前端 JS 校验 + 输入框 maxlength。"));
console.log(c.dim("锚点从代码里读出来，脚本自身不持有任何边界数字。"));
console.log("");

/* ---- 第一组：长度 / 区间 ---- */
console.log(c.b("【一】长度与区间（接受多少字 / 哪个范围）"));
BOUNDARIES.forEach((b) => {
  const results = b.probes.map(probeNumeric);
  const anchors = results.filter((r) => r.isAnchor && r.ok);
  const header = "  " + b.name;

  if (!anchors.length) {
    failCount++;
    console.log(header);
    results.forEach((r) => console.log(c.bad("      " + r.label.padEnd(18) + " " + r.file.padEnd(16) + " " + (r.ok ? JSON.stringify(r.vals) : r.why))));
    console.log(c.bad("      ❌ 锚点规则没找到 —— 数据库约束被改了？脚本要跟着更新。"));
    return;
  }

  const truth = Object.assign({}, ...anchors.map((a) => a.vals));
  const truthText = ["min", "max"].filter((d) => truth[d] !== undefined).map((d) => d + "=" + truth[d]).join(" · ") || "（仅存在性）";
  console.log(header + c.dim("  锚点 " + truthText));

  results.forEach((r) => {
    if (!r.ok) {
      failCount++;
      console.log(c.bad("      " + r.label.padEnd(18) + " " + r.file.padEnd(16) + " ❌ " + r.why));
      return;
    }
    const bad = [];
    r.dims.forEach((d) => {
      if (d === "exists") return;
      if (truth[d] === undefined) return;          // 锚点没有这一维 → 不比较
      if (r.vals[d] !== truth[d]) bad.push(`${d} 期望 ${truth[d]}、实际 ${r.vals[d]}`);
    });
    const shown = r.dims.map((d) => (d === "exists" ? "存在性检查" : d + "=" + fmt(r.vals[d]))).join(" · ");
    if (bad.length) {
      failCount++;
      console.log(c.bad("      " + r.label.padEnd(18) + " " + r.file.padEnd(16) + " ❌ " + bad.join("；")));
    } else {
      console.log("      " + r.label.padEnd(18) + " " + c.dim(r.file.padEnd(16)) + " ✅ " + c.dim(shown));
    }
  });

  if (b.note) console.log(c.dim("      ↳ " + b.note));
});
console.log("");

/* ---- 第二组：枚举 ---- */
console.log(c.b("【二】枚举（接受哪几个值）"));
ENUMS.forEach((e) => {
  const results = e.probes.map(probeEnum);
  const anchors = results.filter((r) => r.isAnchor && r.ok);
  console.log("  " + e.name);

  if (!anchors.length) {
    failCount++;
    console.log(c.bad("      ❌ 锚点规则没找到：" + (results[0] && results[0].why)));
    return;
  }
  const truth = anchors[0].vals.slice().sort().join(" | ");
  console.log("      " + "锚点".padEnd(20) + c.dim(anchors[0].file.padEnd(16)) + c.dim(truth));

  results.filter((r) => !r.isAnchor).forEach((r) => {
    if (!r.ok) {
      failCount++;
      console.log(c.bad("      " + r.label.padEnd(18) + " " + r.file.padEnd(16) + " ❌ " + r.why));
      return;
    }
    const got = r.vals.slice().sort().join(" | ");
    const same = got === truth;
    const orderSame = r.vals.join(" | ") === anchors[0].vals.join(" | ");
    if (!same) failCount++;
    console.log(
      "      " + r.label.padEnd(18) + " " + c.dim(r.file.padEnd(16)) +
        (same ? " ✅ " : " ❌ 期望 " + truth + "、实际 " + got) +
        (same && !orderSame ? c.dim("（值相同，顺序不同）") : "")
    );
  });
});
console.log("");

/* ---- 结论 ---- */
if (failCount === 0) {
  console.log(c.b(c.ok("结论：PASS —— 每一条边界的「数据库 / 前端 JS / 输入框」三处数字都对得上。")));
} else {
  console.log(c.b(c.bad(`结论：FAIL —— ${failCount} 处对不上（或规则没找到）。`)));
  console.log(c.dim("  改数字时请同时改：数据库 CHECK（schema.sql 与云端）→ 前端 JS 校验 → 输入框 maxlength。"));
}
process.exit(failCount === 0 ? 0 : 1);
