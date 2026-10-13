#!/usr/bin/env node
/* ============================================================
   preflight-check.js — 发布前检查（一键串起门槛 + 补上没人管的几项）

   【它解决什么问题】
   「发布前该查什么」如果只活在人脑里，等于没定：漏掉哪一项，没人会发现。
   这个脚本把发布前的必查项固化成一条命令，并且**只做两件事**：

     ① 把已经存在的门槛串成一条流水 —— 不重写规则
        check-secrets.js  是「密钥口径」的唯一真值来源
        check-boundaries.js 是「输入边界口径」的唯一真值来源
        本文件只**调用**它们、只**读**它们导出的规则表，绝不抄第二份。
        （两份定义各自演化，就会出现「一个脚本说 0 条、另一个说有 3 条」的糊涂账。）

     ② 补上现有门槛没覆盖的四类检查
        公网可达与资源齐全 / .env 忽略是否**真生效** / 工作区与远端是否就绪 / 线上是不是最新版

   【三档结论 —— 跳过不等于通过】
     🔴 红线  blocker   任一失败 = 不可发布（退出码 1）
     🟡 提醒  warn      不阻塞发布，但发布前一定要知道
     ⚪ 跳过  skip      环境或开关所限 —— 明细里必须写明**为什么跳过**，
                        不允许把「没检查」伪装成「检查过了」

   用法：
     node .workbuddy/skills/preflight-check/preflight-check.js
     node .workbuddy/skills/preflight-check/preflight-check.js --json 输出.json
     node .workbuddy/skills/preflight-check/preflight-check.js --with-browser   # 连前端工艺门槛一起跑
     node .workbuddy/skills/preflight-check/preflight-check.js --root <另一个项目根>   # 在副本上跑（反证用）
     node .workbuddy/skills/preflight-check/preflight-check.js --site <另一个线上地址>
   ============================================================ */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/* ============================== 参数 ============================== */

const argv = process.argv.slice(2);
const opt = {
  root: path.resolve(__dirname, "..", "..", ".."), // 本文件在 .workbuddy/skills/preflight-check/ → 上三级是项目根
  json: null,
  site: null,
  withBrowser: false,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--root") opt.root = path.resolve(argv[++i] || ".");
  else if (a === "--json") opt.json = path.resolve(argv[++i] || "preflight.json");
  else if (a === "--site") opt.site = String(argv[++i] || "");
  else if (a === "--with-browser") opt.withBrowser = true;
  else if (a === "-h" || a === "--help") {
    console.log("用法：node preflight-check.js [--root 项目根] [--site 线上地址] [--json 输出.json] [--with-browser]");
    process.exit(0);
  } else {
    console.log("未知参数：" + a + "（--help 看用法）");
    process.exit(2);
  }
}

const ROOT = opt.root;

/* ============================== 输出样式 ============================== */

const COLOR_ON = !process.env.NO_COLOR;
const c = {
  dim: (s) => (COLOR_ON ? "\x1b[2m" + s + "\x1b[0m" : s),
  ok: (s) => (COLOR_ON ? "\x1b[32m" + s + "\x1b[0m" : s),
  bad: (s) => (COLOR_ON ? "\x1b[31m" + s + "\x1b[0m" : s),
  warn: (s) => (COLOR_ON ? "\x1b[33m" + s + "\x1b[0m" : s),
  b: (s) => (COLOR_ON ? "\x1b[1m" + s + "\x1b[0m" : s),
};

const MARK = { PASS: "[PASS]", FAIL: "[FAIL]", WARN: "[WARN]", SKIP: "[SKIP]" };
const paint = (r) => (r.status === "PASS" ? c.ok(MARK.PASS) : r.status === "FAIL" ? c.bad(MARK.FAIL) : r.status === "WARN" ? c.warn(MARK.WARN) : c.dim(MARK.SKIP));

/* ============================== 小工具 ============================== */

function git(args, ms) {
  const r = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: ms || 60000,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    out: (r.stdout || "").replace(/\s+$/, ""),
    err: (r.stderr || "").trim(),
    error: r.error ? r.error.code + ": " + r.error.message : null,
  };
}

/* 取某个提交里的文件原文。**不能复用上面的 git()** —— 那个会对输出做 trim，
   末尾的换行会被吃掉，于是「完全相同的文件」也会被判成不同。
   这个坑是实跑时抓到的：改用 git() 时 11 个文件全报「漂移」。 */
function gitBlob(rel, rev) {
  const r = spawnSync("git", ["show", (rev || "HEAD") + ":" + rel], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return !r.error && r.status === 0 ? r.stdout : null;
}

function runNode(rel, ms) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return { ok: false, missing: true, out: "", err: "文件不存在：" + rel };
  const r = spawnSync(process.execPath, [abs], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: ms || 180000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: Object.assign({}, process.env, { NO_COLOR: "1" }), // 抓文本给报告用，不要 ANSI 色码
  });
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    out: r.stdout || "",
    err: (r.stderr || "").trim(),
    error: r.error ? r.error.code + ": " + r.error.message : null,
  };
}

const trimLines = (arr) => arr.map((s) => String(s).trim()).filter(Boolean);

function rows(text) {
  return String(text || "").split(/\r?\n/);
}

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);
const lf = (s) => String(s).replace(/\r\n/g, "\n"); // 仓库里是 LF，工作区可能是 CRLF（core.autocrlf=true）

async function fetchBuf(url, ms) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(ms || 20000),
      headers: { "user-agent": "foxlings-preflight-check/1.0" },
    });
    const ab = await r.arrayBuffer();
    return { ok: true, status: r.status, buf: Buffer.from(ab), ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: (e && e.name ? e.name + ": " : "") + ((e && e.message) || String(e)), ms: Date.now() - t0 };
  }
}

/* ============================== 上下文 ============================== */

const ctx = {};

function readSite() {
  if (opt.site) return opt.site.replace(/\/+$/, "");
  try {
    const src = fs.readFileSync(path.join(ROOT, "js/cloud-config.js"), "utf8");
    const m = /endpoint:\s*"([^"]+)"/.exec(src);
    if (m) return m[1].replace(/\/+$/, "");
  } catch (e) {
    /* 读不到就是读不到，下面会如实标 SKIP */
  }
  return null;
}

const liveCache = new Map();
function liveGet(p) {
  if (!liveCache.has(p)) liveCache.set(p, fetchBuf(ctx.site + p, 20000));
  return liveCache.get(p);
}

/* 红线规则表：从 check-secrets.js 读，**不在这里抄第二份**。
 *
 * ⚠️ 一定要在**子进程**里 require，绝不能在本进程 require。
 * 实跑时踩到过：check-secrets.js 的历史版本末尾是无条件的 `main()` + `process.exit()`，
 * 在本进程 require 它 = 执行整轮扫描 + 当场退出本进程 ——
 * 现象是「报告打了一半、JSON 没写、退出码 0」，也就是**最坏的那种假绿**。
 * 放进子进程之后，旧版顶多让子进程退出，parent 拿到空结果 → 如实标 SKIP。
 *
 * RegExp 过不了 JSON，所以子进程里就转成 source/flags，回来再重建。 */
function readSecretRules() {
  const code =
    "try{var m=require(process.argv[1]);" +
    "var f=function(a){return (a||[]).map(function(x){return {name:x.name,source:x.re.source,flags:x.re.flags}})};" +
    "process.stdout.write(JSON.stringify({red:f(m.RED_LINES),allow:f(m.ALLOW_LINES),text:m.TEXT_EXT}));}" +
    "catch(e){process.exit(3);}";

  const r = spawnSync(process.execPath, ["-e", code, path.join(ROOT, "check-secrets.js")], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return null;

  try {
    const o = JSON.parse(r.stdout);
    if (!o || !Array.isArray(o.red) || !o.red.length) return null;
    const rebuild = (a) => (a || []).map((x) => ({ name: x.name, re: new RegExp(x.source, x.flags) }));
    return { RED_LINES: rebuild(o.red), ALLOW_LINES: rebuild(o.allow), TEXT_EXT: o.text || [] };
  } catch (e) {
    return null;
  }
}

/* 用给定的规则表扫一段文本。
 * 这里只提供「逐行套规则」这个动作 —— 规则本身仍然只有 check-secrets.js 一个定义处。
 * （单条规则的正则自己也包一层 try：判别器/正则把检查脚本带崩，是这条流水最不该出的错。） */
function scanWithRules(file, text, rules) {
  const hits = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      rules.forEach((r) => {
        let hit = false;
        try {
          hit = r.re.test(line);
        } catch (e) {
          hit = false;
        }
        if (hit) hits.push({ file, line: i + 1, rule: r.name, sample: line.trim().slice(0, 90) });
      });
    });
  return hits;
}

function listUntrackedTextFiles(rules) {
  const r = git(["ls-files", "--others", "--exclude-standard"]);
  if (!r.ok) return null;
  return r.out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => rules.TEXT_EXT.includes(path.extname(f).toLowerCase()));
}

/* ============================== 检查项 ============================== */

const checks = [];
const add = (o) => {
  checks.push(o);
  return o;
};

/* ---------- 🔴 S1 密钥红线 · 工作区 ---------- */
function checkS1() {
  const base = {
    id: "S1",
    title: "密钥红线 · 工作区（跟踪文件 + 未跟踪文件）",
    level: "blocker",
    detail: [],
  };

  // 甲：委托 check-secrets.js（覆盖 红线 / 配置类文件 / 豁免 / .env.example 样板 四组）
  const r = runNode("check-secrets.js", 180000);
  if (r.missing) {
    return add(Object.assign(base, { status: "FAIL", summary: "找不到 check-secrets.js", detail: ["项目根下没有 check-secrets.js —— 门槛本身不见了"] }));
  }
  if (r.error) {
    return add(Object.assign(base, { status: "FAIL", summary: "门槛没能跑起来", detail: [r.error] }));
  }

  const outLines = rows(r.out);
  const hits = trimLines(outLines.filter((l) => /:\d+\s+\[/.test(l)));
  const probs = trimLines(outLines.filter((l) => /仓库里存在|\.gitignore 缺少规则|含\*\*线上真实值\*\*|^\s{4}第 \d+ 行/.test(l)));
  // 注意：check-secrets 的输出里「结论：」出现两次（豁免组也有一句）。
  // 只认最后那条总判定，否则会把「豁免说明」当成结论抄进报告。
  const conclusion = (outLines.filter((l) => /结论：(PASS|FAIL)/.test(l))[0] || "").replace(/^.*?结论：/, "结论：").trim();

  if (!r.ok) {
    return add(
      Object.assign(base, {
        status: "FAIL",
        summary: "红旗 " + (hits.length || "?") + " 条" + (probs.length ? " + 配置/样板问题 " + probs.length + " 个" : ""),
        detail: hits.concat(probs).slice(0, 12),
        note: conclusion || undefined,
      })
    );
  }

  // 乙：补一层 —— check-secrets 走的是 git 跟踪范围，**未跟踪的新文件它看不见**。
  //     发布前恰恰是「刚写的新文件」最可能带着密钥进去，所以这里用同一份规则表补扫。
  const rules = readSecretRules();
  if (!rules) {
    return add(
      Object.assign(base, {
        status: "WARN",
        summary: "跟踪文件 0 条（未跟踪文件这一层没扫成）",
        detail: ["check-secrets.js 没有导出规则表，未跟踪文件补扫跳过 —— 这一层**没有验过**"],
        note: "补上 check-secrets.js 末尾的 module.exports 即可",
      })
    );
  }

  const untracked = listUntrackedTextFiles(rules);
  if (untracked === null) {
    return add(
      Object.assign(base, {
        status: "WARN",
        summary: "跟踪文件 0 条（未跟踪文件这一层没扫成）",
        detail: ["git ls-files --others 失败，未跟踪文件补扫跳过"],
      })
    );
  }

  const extra = [];
  untracked.forEach((f) => {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, f), "utf8");
    } catch (e) {
      return;
    }
    scanWithRules(f, text, rules.RED_LINES).forEach((h) => extra.push(h.file + ":" + h.line + "  [" + h.rule + "]  " + h.sample));
  });

  if (extra.length) {
    return add(
      Object.assign(base, {
        status: "FAIL",
        summary: "跟踪文件 0 条，但**未跟踪文件**里有 " + extra.length + " 条",
        detail: extra.slice(0, 12),
        note: "这条只有补扫能抓到：git 跟踪范围里看不到未跟踪文件，而新写的文件最容易带密钥",
      })
    );
  }

  return add(
    Object.assign(base, {
      status: "PASS",
      summary: "跟踪文件 0 条 · 未跟踪文本文件 " + untracked.length + " 个也 0 条",
      detail: [],
    })
  );
}

/* ---------- 🔴 S2 密钥红线 · 全部 Git 历史 ---------- */
function checkS2() {
  const base = { id: "S2", title: "密钥红线 · 全部 Git 历史", level: "blocker", detail: [] };
  const rules = readSecretRules();
  if (!rules) {
    return add(
      Object.assign(base, {
        status: "SKIP",
        summary: "拿不到红线规则表，没扫",
        detail: ["check-secrets.js 未导出 RED_LINES —— 历史这一层**没有验过**（不是通过）"],
      })
    );
  }

  const nCommit = git(["rev-list", "--all", "--count"]);
  if (!nCommit.ok) {
    return add(Object.assign(base, { status: "SKIP", summary: "git 不可用", detail: [nCommit.error || nCommit.err] }));
  }

  // 甲：补丁体（新增行）
  const patch = git(["log", "--all", "--no-color", "-p", "-U0"], 180000);
  if (!patch.ok) {
    return add(Object.assign(base, { status: "SKIP", summary: "git log 取不到", detail: [patch.error || patch.err] }));
  }
  // 逐行扫补丁体的新增行，同时跟踪「当前在哪个文件里」——
  // check-secrets.js 是**规则的定义处**，它的注释里必然写着各种密钥形态的样子
  // （比如一条带账号密码的连接串长什么样）。工作区扫描早就把它排除（f !== SELF），
  // 历史扫描如果不排除，第一轮实跑就会报假阳性：命中它自己的注释。
  const hits = [];
  let currentFile = "";
  rows(patch.out).forEach((l) => {
    const head = /^\+\+\+ b\/(.+)$/.exec(l);
    if (head) {
      currentFile = head[1];
      return;
    }
    if (l[0] !== "+" || l.startsWith("+++")) return;
    if (path.basename(currentFile) === "check-secrets.js") return;
    const body = l.slice(1);
    rules.RED_LINES.forEach((rule) => {
      if (rule.re.test(body)) hits.push({ where: "提交内容 (" + currentFile + ")", rule: rule.name, sample: body.trim().slice(0, 90) });
    });
  });

  // 乙：提交信息（有人会把密钥写进 commit message / 分支名）
  const msgs = git(["log", "--all", "--no-color", "--pretty=format:%h %s%n%b"], 60000);
  if (msgs.ok) {
    rows(msgs.out).forEach((l) => {
      rules.RED_LINES.forEach((rule) => {
        if (rule.re.test(l)) hits.push({ where: "提交信息", rule: rule.name, sample: l.trim().slice(0, 90) });
      });
    });
  }

  if (hits.length) {
    return add(
      Object.assign(base, {
        status: "FAIL",
        summary: hits.length + " 条命中（历史里删不掉 —— 只能作废密钥）",
        detail: hits.slice(0, 12).map((h) => "[" + h.where + "][" + h.rule + "] " + h.sample),
        note: "历史里出现过真密钥 = 该密钥必须去对应平台作废重发，改代码和清历史都不算处理",
      })
    );
  }

  return add(
    Object.assign(base, {
      status: "PASS",
      summary: nCommit.out + " 个提交（全部分支）· 补丁体与提交信息均 0 条",
      detail: [],
    })
  );
}

/* ---------- 🔴 S3 输入边界 ---------- */
function checkS3() {
  const base = { id: "S3", title: "输入边界 · 数据库 CHECK ↔ 前端 JS ↔ 输入框 ↔ 接口层", level: "blocker", detail: [] };
  const r = runNode("check-boundaries.js", 120000);
  if (r.missing) return add(Object.assign(base, { status: "FAIL", summary: "找不到 check-boundaries.js", detail: ["项目根下没有 check-boundaries.js"] }));
  if (r.error) return add(Object.assign(base, { status: "FAIL", summary: "门槛没能跑起来", detail: [r.error] }));

  const outLines = rows(r.out);
  const fails = trimLines(outLines.filter((l) => /❌/.test(l)));
  const conclusion = (outLines.filter((l) => /结论：(PASS|FAIL)/.test(l))[0] || "").replace(/^.*?结论：/, "结论：").trim();

  if (!r.ok) {
    return add(
      Object.assign(base, {
        status: "FAIL",
        summary: fails.length ? fails.length + " 处对不上" : "门槛退出码非 0",
        detail: fails.slice(0, 12),
        note: conclusion || undefined,
      })
    );
  }
  return add(Object.assign(base, { status: "PASS", summary: "每条边界的四处数字都对得上（脚本自身不持有任何数字）", detail: [] }));
}

/* ---------- 🔴 U1 公网可达 ---------- */
async function checkU1() {
  const base = { id: "U1", title: "公网可达 · 线上首页", level: "blocker", detail: [] };
  if (!ctx.site) {
    return add(Object.assign(base, { status: "SKIP", summary: "拿不到线上地址", detail: ["js/cloud-config.js 里没有 endpoint，也传 --site"] }));
  }
  const r = await liveGet("/");
  if (!r.ok) {
    return add(Object.assign(base, { status: "FAIL", summary: "请求失败：" + r.error, detail: ["线上站点打不开，先确认部署状态与域名"] }));
  }
  const text = r.buf.toString("utf8");
  const title = (text.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const problems = [];
  if (r.status !== 200) problems.push("HTTP " + r.status + "（期望 200）");
  if (!text.includes("board-list")) problems.push("页面里没有关键容器 #board-list —— 可能不是本站、或资源没发全");
  if (!/热门时事真伪辨别/.test(title)) problems.push("title 不含站名（实际：" + title + "）");

  if (problems.length) {
    return add(Object.assign(base, { status: "FAIL", summary: "HTTP " + r.status + "，但内容对不上", detail: problems }));
  }
  return add(
    Object.assign(base, {
      status: "PASS",
      summary: "HTTP 200 · " + r.buf.length + " B · " + r.ms + "ms · title「" + title + "」",
      detail: [],
    })
  );
}

/* ---------- 🔴 U2 公网资源齐全 ---------- */
async function checkU2() {
  const base = { id: "U2", title: "公网资源齐全 · 首页依赖的关键静态资源", level: "blocker", detail: [] };
  if (!ctx.site) {
    return add(Object.assign(base, { status: "SKIP", summary: "拿不到线上地址", detail: [] }));
  }
  const need = ["/js/api.js", "/js/data.js", "/css/style.css"];
  const rs = await Promise.all(need.map(liveGet));
  const bad = [];
  const okLines = [];
  need.forEach((p, i) => {
    const r = rs[i];
    if (!r.ok) bad.push(p + " 请求失败：" + r.error);
    else if (r.status !== 200) bad.push(p + " HTTP " + r.status);
    else if (r.buf.length < 500) bad.push(p + " 只有 " + r.buf.length + " B（疑似空文件/占位页）");
    else okLines.push(p + " 200 · " + r.buf.length + " B");
  });
  if (bad.length) return add(Object.assign(base, { status: "FAIL", summary: bad.length + " 个资源有问题", detail: bad }));
  return add(Object.assign(base, { status: "PASS", summary: need.length + " 个资源全部 200 且非空", detail: okLines }));
}

/* ---------- 🔴 E1 .env 忽略「真生效」 ---------- */
function checkE1() {
  const base = { id: "E1", title: ".env 不进仓库 · 忽略规则真生效", level: "blocker", detail: [] };
  const r = git(["check-ignore", "-v", ".env"]);
  const exists = fs.existsSync(path.join(ROOT, ".env"));

  if (r.ok && /\.env/.test(r.out)) {
    return add(
      Object.assign(base, {
        status: "PASS",
        summary: "规则命中，「.env」提交不出去",
        detail: ["git check-ignore -v .env → " + r.out, exists ? "本机存在 .env（已被忽略，属正常开发配置）" : "本机没有 .env"],
        note: "「.gitignore 里写了 .env」和「规则真的生效」是两件事 —— 前面那句由 check-secrets 看文本，这一条问 git 本人",
      })
    );
  }
  return add(
    Object.assign(base, {
      status: "FAIL",
      summary: ".env 没有被忽略",
      detail: [
        "git check-ignore -v .env → " + (r.ok ? "（无输出）" : "退出码 " + r.status + (r.err ? " · " + r.err : "")),
        "没有任何输出 = 没被忽略，需要修 .gitignore",
      ],
    })
  );
}

/* ---------- 🟡 D1 工作区干净 ---------- */
function checkD1() {
  const base = { id: "D1", title: "工作区干净（发布前该先提交）", level: "warn", detail: [] };
  const r = git(["status", "--porcelain"]);
  if (!r.ok) return add(Object.assign(base, { status: "SKIP", summary: "git 不可用", detail: [r.error || r.err] }));
  const list = r.out ? trimLines(rows(r.out)) : [];
  if (!list.length) return add(Object.assign(base, { status: "PASS", summary: "没有未提交改动", detail: [] }));
  return add(
    Object.assign(base, {
      status: "WARN",
      summary: list.length + " 项未提交",
      detail: list.slice(0, 12),
      note: "发布的是「已提交并推送的那一版」—— 工作区里没提交的东西不会上线",
    })
  );
}

/* ---------- 🟡 D2 本地与远端一致 ---------- */
function checkD2() {
  const base = { id: "D2", title: "本地 HEAD 与远端 main 一致", level: "warn", detail: [] };
  const head = git(["rev-parse", "HEAD"]);
  if (!head.ok) return add(Object.assign(base, { status: "SKIP", summary: "拿不到 HEAD", detail: [head.error || head.err] }));

  const ls = spawnSync("git", ["ls-remote", "origin", "main"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 25000,
    windowsHide: true,
    env: process.env, // 需要凭据时，由调用方在环境里给（如 GIT_SSH_COMMAND）
  });
  let remote = null;
  let basis = "直连远端（git ls-remote）";
  if (!ls.error && ls.status === 0 && String(ls.stdout || "").trim()) {
    remote = String(ls.stdout).trim().split(/\s+/)[0];
  } else {
    const ref = git(["rev-parse", "origin/main"]);
    if (ref.ok && ref.out) {
      remote = ref.out;
      basis = "本地远端跟踪分支 origin/main（**没有直连远端** —— 只代表上次 fetch 时的样子）";
    }
  }

  if (!remote) {
    return add(
      Object.assign(base, {
        status: "SKIP",
        summary: "远端读不到",
        detail: ["git ls-remote 与 origin/main 都取不到 —— 推送状态**未核实**"],
      })
    );
  }
  if (remote === head.out) {
    return add(Object.assign(base, { status: "PASS", summary: "两边都是 " + head.out.slice(0, 7), detail: ["依据：" + basis] }));
  }
  return add(
    Object.assign(base, {
      status: "WARN",
      summary: "本地 " + head.out.slice(0, 7) + " ≠ 远端 " + remote.slice(0, 7) + "（还没推上去）",
      detail: ["依据：" + basis],
    })
  );
}

/* ---------- 🟡 D3 线上版本漂移 ---------- */
const LIVE_FILES = [
  "index.html",
  "mine.html",
  "admin.html",
  "detail.html",
  "css/style.css",
  "js/api.js",
  "js/data.js",
  "js/home.js",
  "js/forum.js",
  "js/mine.js",
  "js/admin.js",
];

async function checkD3() {
  const base = { id: "D3", title: "线上版本漂移（线上是不是最新那一版）", level: "warn", detail: [] };
  if (!ctx.site) return add(Object.assign(base, { status: "SKIP", summary: "拿不到线上地址", detail: [] }));

  const rs = await Promise.all(LIVE_FILES.map((f) => liveGet("/" + f)));
  const diff = [];
  const unreachable = [];
  let compared = 0;

  LIVE_FILES.forEach((f, i) => {
    const r = rs[i];
    if (!r.ok || r.status !== 200) {
      unreachable.push(f + "（" + (r.ok ? "HTTP " + r.status : r.error) + "）");
      return;
    }
    const blob = gitBlob(f);
    if (blob === null) {
      unreachable.push(f + "（仓库里没有这个文件）");
      return;
    }
    compared++;
    const a = sha(lf(blob));
    const b = sha(lf(r.buf.toString("utf8")));
    if (a !== b) diff.push(f + "（仓库 " + a + " / 线上 " + b + "）");
  });

  if (unreachable.length === LIVE_FILES.length) {
    return add(Object.assign(base, { status: "SKIP", summary: "线上文件一个都取不到", detail: unreachable.slice(0, 6) }));
  }

  const parts = [];
  if (diff.length) parts.push("线上落后 " + diff.length + " 个文件");
  if (unreachable.length) parts.push(unreachable.length + " 个没比成");

  if (!diff.length && !unreachable.length) {
    return add(
      Object.assign(base, {
        status: "PASS",
        summary: compared + " 个文件与 HEAD 逐字节一致（换行已归一，忽略 CRLF 差异）",
        detail: [],
      })
    );
  }
  return add(
    Object.assign(base, {
      status: "WARN",
      summary: parts.join(" · "),
      detail: diff.concat(unreachable).slice(0, 12),
      note: "线上落后不等于坏 —— 只说明「本地已有更新还没发」。真要发布时，这一项是发完之后的验收依据",
    })
  );
}

/* ---------- ⚪ W1 前端工艺门槛（需本地服务，默认不跑） ---------- */
function checkW1() {
  const base = { id: "W1", title: "前端工艺门槛（frontend-rules / filter-check）", level: "skip", detail: [] };
  if (!opt.withBrowser) {
    return add(
      Object.assign(base, {
        status: "SKIP",
        summary: "未加 --with-browser",
        detail: ["这两条门槛要本地静态服务 + 浏览器渲染，单跑数分钟 —— 因此默认不跑，改由改动前端时单独执行"],
      })
    );
  }
  const probe = spawnSync(process.execPath, ["-e", "fetch('http://127.0.0.1:8000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], {
    encoding: "utf8",
    timeout: 25000,
    windowsHide: true,
  });
  if (probe.status !== 0) {
    return add(
      Object.assign(base, {
        status: "SKIP",
        summary: "本地 8000 没有服务",
        detail: ["先跑：python -m http.server 8000 --bind 127.0.0.1（项目根目录）"],
      })
    );
  }
  const a = runNode(".workbuddy/skills/frontend-rules/check-frontend.js", 420000);
  const b = runNode(".workbuddy/skills/filter-check/filter-check.js", 420000);
  const bad = [];
  if (!a.ok) bad.push("frontend-rules：" + (a.error || "退出码 " + a.status).toString());
  if (!b.ok) bad.push("filter-check：" + (b.error || "退出码 " + b.status).toString());
  if (bad.length) return add(Object.assign(base, { status: "FAIL", summary: "有门槛没全过", detail: bad }));
  return add(Object.assign(base, { status: "PASS", summary: "frontend-rules 与 filter-check 都 ALL_PASS", detail: [] }));
}

/* ============================== 主流程 ============================== */

function printCheck(r) {
  console.log("  " + paint(r) + "  " + c.b(r.id.padEnd(3)) + " " + r.title + "  " + c.dim("— " + r.summary));
  (r.detail || []).forEach((d) => console.log(c.dim("           " + d)));
  if (r.note) console.log(c.dim("           ↳ " + r.note));
}

(async function main() {
  const t0 = Date.now();
  ctx.site = readSite();

  const head = git(["rev-parse", "--short", "HEAD"]);
  const subject = git(["log", "-1", "--pretty=%s"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

  console.log("");
  console.log(c.b("═══ 发布前检查 · foxlings-project ═══"));
  console.log(c.dim("  根目录  ") + ROOT);
  console.log(c.dim("  线上    ") + (ctx.site || "（未配置）"));
  console.log(c.dim("  版本    ") + (branch.out || "?") + " · " + (head.out || "?") + "  " + (subject.out || ""));
  console.log("");

  checkS1();
  checkS2();
  checkS3();
  await checkU1();
  await checkU2();
  checkE1();
  checkD1();
  checkD2();
  await checkD3();
  checkW1();

  const blockers = checks.filter((x) => x.level === "blocker");
  const warns = checks.filter((x) => x.level === "warn");
  const skips = checks.filter((x) => x.level === "skip");
  const blockerFail = blockers.filter((x) => x.status !== "PASS");

  console.log(c.b("🔴 红线 —— 任一失败 = 不可发布"));
  blockers.forEach(printCheck);
  console.log("");
  console.log(c.b("🟡 提醒 —— 不阻塞发布，但发布前要知道"));
  warns.forEach(printCheck);
  console.log("");
  console.log(c.b("⚪ 跳过 —— 跳过不等于通过"));
  skips.forEach(printCheck);
  console.log("");

  const label = blockerFail.length ? "不可发布" : "可发布";
  const tail =
    blockerFail.length
      ? "红线 " + blockerFail.length + " 项失败：" + blockerFail.map((x) => x.id).join(" / ")
      : "红线 " + blockers.length + " 项全过";
  const warnNote = warns.filter((x) => x.status === "WARN").length;
  const skipNote = skips.filter((x) => x.status === "SKIP").length;

  console.log(
    c.b(blockerFail.length ? c.bad("结论：" + label + " —— " + tail + "。") : c.ok("结论：" + label + " —— " + tail + "，提醒 " + warnNote + " 项、跳过 " + skipNote + " 项。"))
  );
  if (blockerFail.length) console.log(c.dim("  修掉红线再发；红线没清就上线，等于把风险直接交给用户。"));

  const report = {
    tool: "preflight-check",
    version: "1.0",
    root: ROOT,
    site: ctx.site,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    git: { branch: branch.out, head: head.out, subject: subject.out },
    checks,
    verdict: {
      label,
      passed: blockerFail.length === 0,
      blockerTotal: blockers.length,
      blockerFail: blockerFail.map((x) => x.id),
      warn: warns.filter((x) => x.status === "WARN").length,
      skip: skips.filter((x) => x.status === "SKIP").length,
    },
  };

  if (opt.json) {
    fs.mkdirSync(path.dirname(opt.json), { recursive: true });
    fs.writeFileSync(opt.json, JSON.stringify(report, null, 2), "utf8");
    console.log(c.dim("  JSON 报告：" + opt.json));
  }
  console.log("");

  process.exit(blockerFail.length ? 1 : 0);
})();
