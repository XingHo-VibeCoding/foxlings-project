#!/usr/bin/env node
/* ============================================================
   verify-project.js — 发布前一键验收（项目 Skill：verify-project）

   【它是什么】
   一条命令回答「现在这一版能不能发」，输出**逐项 PASS / FAIL + 证据**。
   检查项全部来自这个项目**真实踩过的坑**，不是通用模板。

   【它为什么长这样：与 preflight-check 的分工】
   本项目已经有一个「发布前检查」引擎（`.workbuddy/skills/preflight-check/`），
   它跑的是「出门前的行李清点」：密钥红线、输入边界、公网可达、.env 忽略生效、
   工作区/远端就绪、线上漂移，共 10 项，并且做过 5 组反证。

   本 Skill 的纪律是：**不重写任何一条规则、也不重写任何一条判断**。
   所以分两半：

     第一组 · 出门前  → 把 preflight-check 当引擎**委托调用**（子进程 + --json），
                        把它的 10 项结果原样并入本报告。
                        密钥口径的唯一真值仍是 check-secrets.js，
                        边界口径的唯一真值仍是 check-boundaries.js —— 一处定义，多层调用。
                        委托失败时**明确报 FAIL**，绝不静默算通过。

     第二组 · 配置与数据库 → 这一段是 **preflight-check 自己声明不覆盖的**
                        （它的「已知边界」里写着「不检查数据库侧」），
                        也是本 Skill 唯一新增的代码：
                          E2  .env.example 在仓库里 / .env 没被提交
                          H1  数据通道探活（本项目的「健康接口」）
                          H2  六张核心表都在
                          H3  读接口拿到真实数据
                          H4  写接口通路活着、且该挡的真被挡住
                          H5  公网首页的数据源是云库、且云库有真实数据

   【跑法】
     node .workbuddy/skills/verify-project/verify-project.js
     node .workbuddy/skills/verify-project/verify-project.js --json 报告.json
     node .workbuddy/skills/verify-project/verify-project.js --with-browser    # 多用浏览器真看一眼首页
     node .workbuddy/skills/verify-project/verify-project.js --site <地址>      # 换域名 / 反证用
     node .workbuddy/skills/verify-project/verify-project.js --tables a,b,c     # 换要查的表名 / 反证用
     node .workbuddy/skills/verify-project/verify-project.js --root <另一个项目根>

   退出码：全部红线 PASS = 0；任一红线 FAIL = 1；参数写错 = 2。

   【实跑踩过的坑（写在这里，免得下次再踩）】
   1. **「表读不到」不等于「表不存在」**：`reports` 匿名读被 RLS 拒，回的是
      HTTP 401 + `DATABASE_42501`；`profiles` / `admins` 回 HTTP 200 + 空数组。
      这三者都是「**表在、策略挡**」—— 不存在的表不会回 RLS 错，只会回 `PGRST205`。
      只认 200 的写法会把三张表全误报成「丢表」。
   2. **写探针的期望结果是「被拒绝」**：不污染线上库的前提下，这是能拿到的最强写信号。
      谁要是图省事写一条真数据进去验证「写成功」，那是拿生产库当靶场。
   3. **首页「有 board-list 元素」不等于「展示出了真实数据」**：静态 HTML 里那个空壳
      一直都在。要证明「数据到位」，得看**行数**（读接口行数 / 页面上的卡片数 / 空态文案里的条数）。
      —— 这是本 Skill 第一次实跑时的一处**漏报**，已修正，见 run-log.md。
   4. **本机 `cdn.jsdelivr.net` 被重置**：线上首页的 SDK 是同步 script，拿不到就一直等。
      所以 `--with-browser` 会把那条 CDN 请求**就地改写**成本地 SDK 副本（路由拦截，不改线上任何东西），
      并在报告里如实注明「CDN 是本地顶替的」。
   ============================================================ */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* ============================== 参数 ============================== */

const argv = process.argv.slice(2);
const opt = {
  root: process.cwd(),
  site: "",
  json: "",
  withBrowser: false,
  withWrite: true, // 写探针默认开：它们全部是「零污染的越权写」，见 checkH4
  tables: "",
  sdk: "",
  playwright: "",
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--root") opt.root = path.resolve(argv[++i] || ".");
  else if (a === "--site") opt.site = String(argv[++i] || "").replace(/\/+$/, "");
  else if (a === "--json") opt.json = path.resolve(argv[++i] || "verify-project.json");
  else if (a === "--with-browser") opt.withBrowser = true;
  else if (a === "--no-write") opt.withWrite = false;
  else if (a === "--tables") opt.tables = String(argv[++i] || "");
  else if (a === "--sdk") opt.sdk = path.resolve(argv[++i] || "");
  else if (a === "--playwright") opt.playwright = path.resolve(argv[++i] || "");
  else if (a === "-h" || a === "--help") {
    console.log("用法：node verify-project.js [--root 项目根] [--site 线上地址] [--json 输出.json]");
    console.log("                        [--with-browser] [--no-write] [--tables a,b,c] [--sdk 本地SDK] [--playwright 模块路径]");
    process.exit(0);
  } else {
    console.log("不认识的参数：" + a + "（用 --help 看用法）");
    process.exit(2);
  }
}
const ROOT = opt.root;
if (!fs.existsSync(path.join(ROOT, "js", "api.js"))) {
  console.log("这不像 foxlings-project 的根目录（找不到 js/api.js）：" + ROOT);
  process.exit(2);
}

const COLOR_ON = !process.env.NO_COLOR;
const c = {
  b: (s) => (COLOR_ON ? "\x1b[1m" + s + "\x1b[0m" : s),
  dim: (s) => (COLOR_ON ? "\x1b[2m" + s + "\x1b[0m" : s),
  ok: (s) => (COLOR_ON ? "\x1b[32m" + s + "\x1b[0m" : s),
  bad: (s) => (COLOR_ON ? "\x1b[31m" + s + "\x1b[0m" : s),
  warn: (s) => (COLOR_ON ? "\x1b[33m" + s + "\x1b[0m" : s),
};
const MARK = { PASS: "[PASS]", FAIL: "[FAIL]", WARN: "[WARN]", SKIP: "[SKIP]" };
const paint = (r) =>
  r.status === "PASS" ? c.ok(MARK.PASS) : r.status === "FAIL" ? c.bad(MARK.FAIL) : r.status === "WARN" ? c.warn(MARK.WARN) : c.dim(MARK.SKIP);

/* ============================== 小工具 ============================== */

function git(args, ms) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: ms || 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, out: "", error: r.error.code + " " + r.error.message, status: r.status };
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), status: r.status };
}

/** 发一个 HTTP 请求，把「网络失败」和「HTTP 错误码」分开报 —— 这两类的处置完全不同 */
async function httpJson(url, o) {
  const opts = Object.assign({}, o);
  const ms = opts.ms || 15000;
  delete opts.ms;
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(ms) }, opts));
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* 不是 JSON 就算了，text 还在 */
    }
    return { ok: true, status: r.status, headers: r.headers, text, json, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.name + " " + e.message + (e.cause && e.cause.code ? "（" + e.cause.code + "）" : ""), ms: Date.now() - t0 };
  }
}

/** 从 js/cloud-config.js 里读 endpoint / publishableKey（这两个值是公开标识，不是密钥） */
function readCloudConfig() {
  const p = path.join(ROOT, "js", "cloud-config.js");
  if (!fs.existsSync(p)) return null;
  const t = fs.readFileSync(p, "utf8");
  const ep = (t.match(/endpoint:\s*"([^"]+)"/) || [])[1] || "";
  const key = (t.match(/publishableKey:\s*"([^"]+)"/) || [])[1] || "";
  if (!ep || !key) return null;
  return { endpoint: ep.replace(/\/+$/, ""), publishableKey: key, file: p };
}

const checks = [];
const add = (o) => {
  checks.push(o);
  return o;
};

/* ============================== 第一组：委托 preflight-check ============================== */

/**
 * 走到这里的每一步都不能「猜」：
 *  - 找不到引擎 → FAIL（不是 SKIP）—— 出门前的红线没人替我们跑了，这是必须知道的事；
 *  - 引擎跑挂 → FAIL，并把退出码与 stderr 摊开；
 *  - 引擎跑了但没落 JSON → FAIL（说明它的报告契约变了），并提示去看它的 stdout。
 */
function runPreflight(site) {
  const engine = path.join(ROOT, ".workbuddy", "skills", "preflight-check", "preflight-check.js");
  const base = { id: "P0", title: "委托 preflight-check 引擎", level: "blocker", group: "preflight", detail: [] };
  if (!fs.existsSync(engine)) {
    return {
      engineOk: false,
      checks: [
        add(
          Object.assign(base, {
            status: "FAIL",
            summary: "找不到 preflight-check 引擎",
            detail: [
              "期望路径：" + engine,
              "第一组（密钥 / 边界 / 公网 / .env）全部没跑 —— 这些是红线，不能当成「通过」",
              "补回 .workbuddy/skills/preflight-check/ 再跑一次",
            ],
          })
        ),
      ],
      checksOut: [],
    };
  }
  const outPath = opt.json
    ? opt.json.replace(/\.json$/i, "") + ".preflight.json"
    : path.join(os.tmpdir(), "verify-project-preflight.json");
  const args = [engine, "--root", ROOT, "--json", outPath];
  if (site) args.push("--site", site);
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 300000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: process.env });
  if (r.error) {
    return {
      engineOk: false,
      checks: [add(Object.assign(base, { status: "FAIL", summary: "引擎没跑起来", detail: [r.error.code + " " + r.error.message] }))],
      checksOut: [],
    };
  }
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch (e) {
    return {
      engineOk: false,
      checks: [
        add(
          Object.assign(base, {
            status: "FAIL",
            summary: "引擎没有落出 JSON 报告",
            detail: [
              "退出码 " + r.status + "｜期望的报告文件：" + outPath,
              "stderr：" + (r.stderr || "(空)").split("\n").slice(0, 3).join(" / "),
              "引擎的报告契约变了 —— 第一组的结果不可采信",
            ],
          })
        ),
      ],
      checksOut: [],
    };
  }
  const out = (report.checks || []).map((x) => add(Object.assign({}, x, { group: "preflight" })));
  add(
    Object.assign(base, {
      status: "PASS",
      summary: "引擎跑通，交出 " + out.length + " 项（结论：" + (report.verdict && report.verdict.label) + "）",
      detail: ["引擎自己的报告落在：" + outPath, "版本 " + (report.git && report.git.branch) + " · " + (report.git && report.git.head)],
    })
  );
  return { engineOk: true, checks: out, report };
}

/* ============================== 第二组：本 Skill 新增 ============================== */

/** E2 · .env.example 在仓库里 / .env 没被提交 —— 光看 .gitignore 不够，要问 git 本人「谁在仓库里」 */
function checkE2() {
  const base = { id: "E2", title: "环境变量样板入库、真值不入库", level: "blocker", group: "data", detail: [] };
  const example = git(["ls-files", "--error-unmatch", ".env.example"]);
  const envIgnored = git(["ls-files", "--error-unmatch", ".env"]);
  const detail = [];
  let bad = false;
  if (example.ok) {
    detail.push(".env.example 在仓库里（git ls-files 命中）：" + fs.statSync(path.join(ROOT, ".env.example")).size + " 字节，只有字段名、没有真值（真值由 check-secrets.js 那条红线另查）");
  } else {
    bad = true;
    detail.push("❌ 仓库里没有 .env.example —— 团队没有「要配哪些变量」的入口");
  }
  if (envIgnored.ok) {
    bad = true;
    detail.push("❌ .env 竟然被 git 跟踪了！这是真值入库，立刻处理（换密钥 + 清历史）");
  } else {
    detail.push(".env 不在 git 索引里（被 .gitignore 挡住，E1 另证「规则真生效」）");
  }
  return add(Object.assign(base, { status: bad ? "FAIL" : "PASS", summary: bad ? "样板或真值的入库状态不对" : ".env.example 已入库、.env 没入库", detail }));
}

/** H1 · 数据通道探活 —— 本项目的「健康接口」 */
async function checkH1(ctx) {
  const base = { id: "H1", title: "数据通道探活（本项目的「健康接口」）", level: "blocker", group: "data", detail: [] };
  const url = ctx.endpoint + "/.cloud/database/rest/";
  const r = await httpJson(url, { headers: ctx.headers, ms: 15000 });
  if (!r.ok) {
    return add(Object.assign(base, { status: "FAIL", summary: "连不上数据通道", detail: [url, r.error, "网络不通 = 线上所有人一起白屏，这一条必须先绿"] }));
  }
  if (r.status !== 200) {
    return add(Object.assign(base, { status: "FAIL", summary: "探活端点回了 HTTP " + r.status, detail: [url, "响应前 200 字：" + JSON.stringify(r.text.slice(0, 200))] }));
  }
  const looksPostgrest = !!(r.json && r.json.swagger && r.json.info);
  const detail = [
    url + " → HTTP 200，" + r.ms + "ms，" + r.text.length + " 字节",
    "自述：" + (r.json && r.json.info ? r.json.info.title + " v" + r.json.info.version : "(没解析出自述)"),
  ];
  if (!looksPostgrest) {
    detail.push("响应不像数据服务的自述（缺 swagger / info）—— 可能被网关换成了别的东西，需要人工看一眼");
    return add(Object.assign(base, { status: "WARN", summary: "端点回了 200，但内容不像数据服务", detail }));
  }
  detail.push("⚠️ 口径写清楚：这一条证明的是「**数据网关在线、且自述正常**」，不等于「库里的数据读得到」—— 后者是 H2 / H3 的事。");
  detail.push("本项目**没有** `/api/health`（api-contract.md:179 已作废，理由原文：「托管后端没有自建服务可探活，链路验证以『云库读得到、写不进』为准」）。这条就是它真实的等价物。");
  return add(Object.assign(base, { status: "PASS", summary: "数据网关在线（HTTP 200 + 服务自述正常，" + r.ms + "ms）", detail }));
}

/** H2 · 六张核心表都在 —— 「读不到」和「不存在」必须分开判 */
async function checkH2(ctx) {
  const base = { id: "H2", title: "数据库核心表存在", level: "blocker", group: "data", detail: [] };
  const NAMES = {
    items: "核查条目",
    posts: "论坛帖子",
    reports: "待核查线索",
    profiles: "用户资料",
    admins: "管理员名单",
    announcements: "站方公告",
  };
  const tables = (opt.tables ? opt.tables.split(",") : Object.keys(NAMES)).map((s) => s.trim()).filter(Boolean);
  const missing = [];
  const detail = [];
  for (const t of tables) {
    const r = await httpJson(ctx.endpoint + "/.cloud/database/rest/" + t + "?select=*&limit=1", { headers: ctx.headers, ms: 15000 });
    const label = t + "（" + (NAMES[t] || "未登记") + "）";
    if (!r.ok) {
      missing.push(t);
      detail.push("❌ " + label + " —— 请求失败：" + r.error);
      continue;
    }
    const code = r.json && !Array.isArray(r.json) ? String(r.json.code || "") : "";
    if (r.status === 404 || /PGRST205|does not exist|relation/i.test(code)) {
      missing.push(t);
      detail.push("❌ " + label + " —— 表不存在（HTTP " + r.status + (code ? " / " + code : "") + "）");
      continue;
    }
    if (r.status === 200 && Array.isArray(r.json)) {
      detail.push("✅ " + label + " —— 表在；匿名读 " + (r.json.length ? "拿到 " + r.json.length + " 行" : "返回 0 行（策略挡着，不是丢表）"));
    } else if (r.status === 401 || r.status === 403) {
      detail.push("✅ " + label + " —— 表在；匿名读被拒（HTTP " + r.status + (code ? " / " + code : "") + "）—— RLS 在干活");
    } else {
      detail.push("… " + label + " —— HTTP " + r.status + "（既不是明确的「在」也不是明确的「不在」，需人工看一眼）");
    }
  }
  detail.push("判据：**只有 404 / `PGRST205` 才算「表丢了」**。回 401 或空数组都是「表在、策略挡」—— 本项目踩过这个坑：策略管能不能读，查询管读什么。");
  detail.push("这条判据的分界线是实测过的：拿一个不存在的表名去问，回的是 HTTP 404 + `DATABASE_PGRST205`（「Could not find the table … in the schema cache」）—— 与「表在但被拒」的 401 + `DATABASE_42501` 形态完全不同。可用 `--tables` 换表名复现这条分界线。");
  if (missing.length) {
    detail.unshift("❌ 有 " + missing.length + " 张表找不到：" + missing.join("、"));
    return add(Object.assign(base, { status: "FAIL", summary: missing.length + " 张表找不到：" + missing.join("、"), detail }));
  }
  return add(Object.assign(base, { status: "PASS", summary: tables.length + " 张表全部存在（匿名可见性已逐张记录）", detail }));
}

/** H3 · 读接口拿到真实数据 —— 不只看「回了 200」，要数行、看形状，还要跟库里的**总数**对上 */
async function checkH3(ctx) {
  const base = { id: "H3", title: "读接口：拿到数据库真实数据", level: "blocker", group: "data", detail: [] };
  const LIMIT = 1000;
  const url = ctx.endpoint + "/.cloud/database/rest/items?select=id,title,verdict,updated_at&limit=" + LIMIT;
  // Prefer: count=exact 让响应头带上「库里的真实总数」（content-range: 0-22/23）。
  // 第一版没带它，content-range 是 `0-22/*` —— 那时「23 行」只能说明「取回了 23 行」，
  // 说明不了「库里就 23 条」；数据涨过 1000 条后这一项会**假绿**。这就是第一遍实跑找到的漏报。
  const r = await httpJson(url, { headers: Object.assign({ Prefer: "count=exact" }, ctx.headers), ms: 20000 });
  if (!r.ok) {
    return add(Object.assign(base, { status: "FAIL", summary: "读接口请求失败", detail: [url, r.error] }));
  }
  if (r.status !== 200 && r.status !== 206 || !Array.isArray(r.json)) {
    return add(
      Object.assign(base, {
        status: "FAIL",
        summary: "读接口没有返回数据数组（HTTP " + r.status + "）",
        detail: [url, "响应前 200 字：" + JSON.stringify(r.text.slice(0, 200))],
      })
    );
  }
  const rows = r.json;
  const badShape = rows.filter((x) => !x || typeof x.id !== "string" || typeof x.title !== "string" || !("updated_at" in x));
  const range = (r.headers && r.headers.get("content-range")) || "";
  const m = range.match(/\/(\d+)\s*$/);
  const total = m ? Number(m[1]) : NaN;
  const detail = [
    url,
    "HTTP " + r.status + "，取回 " + rows.length + " 行，耗时 " + r.ms + "ms，content-range=" + (range || "(无)") + (Number.isFinite(total) ? " → 库里共 " + total + " 条" : ""),
    "前 3 条：" + rows.slice(0, 3).map((x) => x.id + " " + String(x.title).slice(0, 18)).join(" ｜ "),
  ];
  if (!rows.length) {
    detail.push("❌ 读到了 0 行 —— 页面会显示空态。要么库里真没数据，要么 RLS 把公开读也挡了；两种都要查。");
    return add(Object.assign(base, { status: "FAIL", summary: "读接口返回 0 行", detail }));
  }
  if (badShape.length) {
    detail.push("❌ 有 " + badShape.length + " 行缺 id / title / updated_at —— 形状不对，前端拿到会渲染出空白卡");
    return add(Object.assign(base, { status: "FAIL", summary: badShape.length + " 行字段形状不对", detail }));
  }
  if (Number.isFinite(total) && total > LIMIT) {
    detail.push("… 库里共 " + total + " 条，超过本次上限 " + LIMIT + " 条，只读了前 " + LIMIT + " 条 —— 上面的「行数」不是总数，别拿它当全量。");
  } else if (Number.isFinite(total) && rows.length !== total) {
    detail.push("❌ 取回 " + rows.length + " 行，但 content-range 报库里有 " + total + " 条 —— 两个数字对不上，读取被截断或过滤了，必须查清楚");
    return add(Object.assign(base, { status: "FAIL", summary: "取回行数与库里总数对不上（" + rows.length + " vs " + total + "）", detail }));
  } else if (Number.isFinite(total)) {
    detail.push("✅ 取回行数与库里总数一致（都是 " + total + " 条，依据响应头 content-range 的 count=exact）—— 这才叫「读全了」。");
  } else {
    detail.push("… 拿不到精确总数（响应头没有 content-range 的 `/总数`），只能证明「取回了 " + rows.length + " 行且形状正常」，证明不了「这就是全部」。");
    detail.push("这条同时是「首页展示的是数据库真实数据」的一半证据（另一半是 H5）。");
    return add(Object.assign(base, { status: "WARN", summary: "读到 " + rows.length + " 行真实数据，但拿不到总数、无法断言读全", detail }));
  }
  detail.push("这条同时是「首页展示的是数据库真实数据」的一半证据（另一半是 H5）。");
  return add(Object.assign(base, { status: "PASS", summary: "读到 " + rows.length + " 行真实数据，与库里总数 " + total + " 一致，字段形状正常", detail }));
}

/**
 * H4 · 写接口：通路活着 + 该挡的真被挡住
 *
 * 【为什么期望结果是「被拒绝」】
 * 这是**唯一不污染线上库**的写验证方式。写一条真数据进去再删掉，
 * 是在生产库上做实验 —— 而且「删掉」这件事本身就是不可逆的（Day 24 起是真删）。
 * 探针全部选成「无论策略怎么变都不会留下数据」或「留下来恰好说明策略坏了」的形状。
 */
async function checkH4(ctx) {
  const base = { id: "H4", title: "写接口：通路活着、越权写被挡住", level: "blocker", group: "data", detail: [] };
  const probe = "__verify_project_probe__";
  const post = (p, body) => httpJson(ctx.endpoint + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, ctx.headers), body: JSON.stringify(body), ms: 20000 });
  const patch = (p, body) => httpJson(ctx.endpoint + p, { method: "PATCH", headers: Object.assign({ "Content-Type": "application/json" }, ctx.headers), body: JSON.stringify(body), ms: 20000 });

  const problems = [];
  const detail = [];

  // 污染自检的基准：写探针跑之前，items 有多少行
  const itemsCount = async () => {
    const r = await httpJson(ctx.endpoint + "/.cloud/database/rest/items?select=id&limit=1", {
      headers: Object.assign({ Prefer: "count=exact" }, ctx.headers),
      ms: 15000,
    });
    if (!r.ok) return null;
    const m = (r.headers.get("content-range") || "").match(/\/(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  };
  const countBefore = await itemsCount();

  // ① 可写通路（RPC）：对**不存在的 id** +1。
  //    db/schema.sql 里 bump_item_view 的注释写明：「条目不存在返回 -1」——
  //    所以这一发的期望值是**恰好 -1**，不是「随便一个数字」。判据松松地写成「是数字」，
  //    就分不出「函数被换掉/被改成永远返回 0」这类坏。
  const a = await post("/.cloud/database/rest/rpc/bump_item_view", { p_id: probe });
  if (!a.ok) {
    problems.push("RPC 探针请求失败：" + a.error);
    detail.push("❌ ① 可写通路  POST /rpc/bump_item_view → 请求失败：" + a.error);
  } else if (a.status !== 200 || a.json !== -1) {
    problems.push("RPC 探针没回契约里的 -1（HTTP " + a.status + "，返回 " + JSON.stringify(a.text.slice(0, 60)) + "）");
    detail.push("❌ ① 可写通路  POST /rpc/bump_item_view {不存在的 id} → HTTP " + a.status + "，返回 " + JSON.stringify(a.text.slice(0, 80)) + "；契约（db/schema.sql 的函数注释）写的是「条目不存在返回 -1」");
  } else {
    detail.push("✅ ① 可写通路  POST /rpc/bump_item_view {不存在的 id} → HTTP 200 且返回 -1，与契约一致（命中 0 行，零污染）");
  }

  // ② 匿名写帖子：契约是「必须登录」，RLS 应拒
  const b = await post("/.cloud/database/rest/posts", { title: probe, body: probe, category: "other" });
  const bCode = b.ok && b.json && !Array.isArray(b.json) ? String(b.json.code || "") : "";
  if (!b.ok) {
    problems.push("写帖子探针请求失败：" + b.error);
    detail.push("❌ ② 匿名写帖  POST /posts → 请求失败：" + b.error);
  } else if (b.status >= 400) {
    detail.push("✅ ② 匿名写帖  POST /posts → 被拒 HTTP " + b.status + (bCode ? " / " + bCode : "") + "（契约：发帖须登录）");
  } else {
    problems.push("匿名竟然写进了 posts（HTTP " + b.status + "）");
    detail.push("❌ ② 匿名写帖  POST /posts → **竟然成功了**（HTTP " + b.status + "）。RLS 的 posts_insert 策略坏了，马上查；探针可能留下了一行 id 含 " + probe + " 的帖子");
  }

  // ③ 匿名写榜单：items 没有任何 INSERT 策略 —— 榜单不可被外部篡改
  const d = await post("/.cloud/database/rest/items", { id: probe, title: probe, verdict: "存疑", summary: probe, sources: [] });
  const dCode = d.ok && d.json && !Array.isArray(d.json) ? String(d.json.code || "") + " " + String(d.json.message || "") : "";
  if (!d.ok) {
    problems.push("写榜单探针请求失败：" + d.error);
    detail.push("❌ ③ 匿名写榜  POST /items → 请求失败：" + d.error);
  } else if (d.status >= 400) {
    detail.push("✅ ③ 匿名写榜  POST /items → 被拒 HTTP " + d.status + (dCode ? " / " + dCode.trim() : "") + "（契约：items 没有 INSERT 策略）");
  } else {
    problems.push("匿名竟然写进了 items（HTTP " + d.status + "）");
    detail.push("❌ ③ 匿名写榜  POST /items → **竟然成功了**（HTTP " + d.status + "）。榜单可被外部篡改，这是最高优先级；探针可能留下了一行 id=" + probe);
  }

  // ④ 热度不可篡改：PATCH 一个不存在的 id —— 要么被策略拒，要么改到 0 行
  const e = await patch("/.cloud/database/rest/items?id=eq." + probe, { id: probe });
  if (!e.ok) {
    problems.push("改榜单探针请求失败：" + e.error);
    detail.push("❌ ④ 改热度    PATCH /items → 请求失败：" + e.error);
  } else if (e.status >= 400) {
    detail.push("✅ ④ 改热度    PATCH /items → 被拒 HTTP " + e.status + "（契约：items 没有任何 UPDATE 策略 = 热度不可篡改）");
  } else if (Array.isArray(e.json) && e.json.length === 0) {
    detail.push("✅ ④ 改热度    PATCH /items → HTTP 200 但返回空数组（改了 0 行，零污染）");
  } else {
    problems.push("PATCH /items 返回了被改的行（HTTP " + e.status + "）");
    detail.push("❌ ④ 改热度    PATCH /items → **返回了被改的行**：" + JSON.stringify(e.text.slice(0, 120)) + "—— 热度可能变得可篡改，必须人工确认");
  }

  // 污染自检：写探针跑完之后，items 行数应当**一个都没变**
  const countAfter = await itemsCount();
  if (countBefore != null && countAfter != null) {
    if (countAfter !== countBefore) {
      problems.push("items 行数被写探针改了（" + countBefore + " → " + countAfter + "）");
      detail.push("❌ 污染自检：items 行数 " + countBefore + " → " + countAfter + "。写探针**不该**改变任何行数，先查清多出来/少了的那一行是什么");
    } else {
      detail.push("✅ 污染自检：items 行数前后都是 " + countBefore + " 条（写探针零污染）");
    }
  } else {
    detail.push("… 污染自检：拿不到精确行数，这一层没验（**跳过不等于没污染**）");
  }
  detail.push("这一层只能看见「匿名角色看得见的行」。探针若真写进了匿名看不见的地方（例如 pending 帖子），这里看不到 —— 那种情况已经由 ②/③ 直接报 FAIL 了。");

  detail.push("判据：四发探针的结果全部与契约一致。写探针的**期望结果就是「被拒绝」** —— 不污染生产库的前提下，这是能拿到的最强写信号：既证明写通道活着，又证明权限边界真的在挡。");
  if (problems.length) {
    detail.unshift("❌ " + problems.join("；"));
    return add(Object.assign(base, { status: "FAIL", summary: problems[0], detail }));
  }
  return add(Object.assign(base, { status: "PASS", summary: "4 发探针结果全部符合契约（可写通路活着，越权写全被挡）", detail }));
}

/** H5 · 公网首页的数据源是云库、且云库有真实数据 */
async function checkH5(ctx) {
  const base = { id: "H5", title: "公网首页展示的是数据库真实数据", level: "blocker", group: "data", detail: [] };
  const detail = [];
  const problems = [];

  // ① 线上接口层确实是走云库的版本（而不是读 data.json 种子的旧写法）
  const api = await httpJson(ctx.endpoint + "/js/api.js", { ms: 15000 });
  if (!api.ok || api.status !== 200) {
    problems.push("线上 js/api.js 取不到（" + (api.ok ? "HTTP " + api.status : api.error) + "）");
    detail.push("❌ 线上 js/api.js 取不到");
  } else if (!api.text.includes('database.from("items")')) {
    problems.push("线上 js/api.js 里没有云库读取路径");
    detail.push("❌ 线上 js/api.js 里找不到 `database.from(\"items\")` —— 线上那一版的榜单可能还在读 data.json 种子，不是数据库真数据");
  } else {
    detail.push("✅ 线上 js/api.js 含云库读取路径 `database.from(\"items\")`（" + api.text.length + " 字节）");
  }

  // ② 云库里确实有行（H3 的结论作为交叉证据）
  const items = await httpJson(ctx.endpoint + "/.cloud/database/rest/items?select=id&limit=1000", { headers: ctx.headers, ms: 20000 });
  const n = items.ok && Array.isArray(items.json) ? items.json.length : -1;
  if (n <= 0) {
    problems.push("云库里读不到条目（" + (items.ok ? n + " 行" : items.error) + "）");
    detail.push("❌ 云库里读到的条目行数 = " + (items.ok ? n : "(请求失败：" + items.error + ")"));
  } else {
    detail.push("✅ 云库里有 " + n + " 条真实条目 —— 首页有数据可展示");
  }

  // ③ 可选的页面级证据（--with-browser）
  if (opt.withBrowser) {
    const b = await browserProbe(ctx);
    if (b.skipped) detail.push("… 页面级证据：跳过（" + b.skipped + "）");
    else if (b.fail) {
      problems.push("页面级证据不成立：" + b.fail);
      detail.push("❌ 页面级证据：" + b.fail);
      (b.detail || []).forEach((x) => detail.push("   " + x));
    } else {
      detail.push("✅ 页面级证据：" + b.summary);
      (b.detail || []).forEach((x) => detail.push("   " + x));
    }
  } else {
    detail.push("… 页面级证据：未取（加 --with-browser 让浏览器真打开线上首页看一眼）。默认只用「接口层走云库 + 云库有行」这两条间接判据。");
  }

  if (problems.length) {
    detail.unshift("❌ " + problems.join("；"));
    return add(Object.assign(base, { status: "FAIL", summary: problems[0], detail }));
  }
  return add(Object.assign(base, { status: "PASS", summary: "首页数据源是云库，且云库有 " + n + " 条真实数据" + (opt.withBrowser ? "（含页面级证据）" : ""), detail }));
}

/**
 * 浏览器探针：真打开线上首页，数页面上的条目。
 *
 * 【为什么要做这一层】「HTML 里有 #board-list 元素」证明不了任何事 —— 那个空壳一直在。
 * 只有页面上**真出现卡片**（或者空态文案里写着一个 ≥1 的条数）才算「数据到位」。
 *
 * 【本机的坑】cdn.jsdelivr.net 被重置，而线上那个 SDK 是同步 script ——
 * 拿不到就一直等，页面永远卡在加载态。所以这里把那条请求**就地改写**成本地 SDK 副本
 * （Playwright 路由拦截，只影响这一次访问，线上一个字节都没改），并在结论里注明。
 */
async function browserProbe(ctx) {
  let chromium;
  const candidates = [];
  if (opt.playwright) candidates.push(path.join(opt.playwright, "playwright-core"), opt.playwright);
  candidates.push(path.join(os.homedir(), ".workbuddy", "binaries", "node", "workspace", "node_modules", "playwright-core"));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        chromium = require(p).chromium;
        break;
      }
    } catch (e) {
      /* 试下一个 */
    }
  }
  if (!chromium) return { skipped: "本机找不到 playwright-core（可用 --playwright <目录> 指定）" };

  // 本地 SDK 副本：本机拉不到 CDN，线上那条同步 script 会把页面卡在加载态，
  // 所以用它顶替那一条请求。按顺序找几处（--sdk 优先）。
  const sdkCandidates = [opt.sdk, path.join(ROOT, "js", "sdk-local.js"), path.join(ROOT, "sdk-global.js"), path.join(os.homedir(), ".workbuddy", "sdk-global.js")].filter(Boolean);
  let sdk = "";
  let sdkFrom = "";
  for (const p of sdkCandidates) {
    if (fs.existsSync(p)) {
      sdk = fs.readFileSync(p, "utf8");
      sdkFrom = p;
      break;
    }
  }
  if (!sdk) return { skipped: "本地没有 SDK 副本（用 --sdk <index.global.js 的路径> 指定），本机又拉不到 CDN，页面渲染不出来" };

  let browser = null;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
  } catch (e) {
    return { skipped: "起不了 Edge（" + e.message.split("\n")[0] + "）" };
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 200)));
    // 只改这一条请求：CDN 的 SDK → 本地副本。线上网站在别的方面完全按原样跑。
    await page.route("**/cdn.jsdelivr.net/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: sdk }));
    await page.goto(ctx.endpoint + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000); // 等云库请求回来并渲染

    const readBoard = () =>
      page.evaluate(() => {
        const list = document.getElementById("board-list");
        const cards = document.querySelectorAll("#board-list .card").length;
        const text = list ? (list.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160) : "(没有 #board-list)";
        const numbers = (text.match(/有\s*(\d+)\s*条/) || [])[1];
        const jump = document.querySelector("#board-list .empty-jump[data-range]");
        return {
          cards,
          text,
          numbers: numbers ? Number(numbers) : -1,
          hasSdk: typeof window.WorkBuddyCloud !== "undefined",
          jumpRange: jump ? jump.dataset.range : "",
          // 按钮上写的就是「查看本月」——直接读它，不在这里抄一份档位名称映射
          jumpText: jump ? jump.textContent.trim() : "",
        };
      });

    const first = await readBoard();
    let second = null;
    if (first.cards === 0 && first.jumpRange) {
      // 当前时间档为空，页面给了指路按钮（例如「查看本月」）—— 点进去再数一次。
      // 空态文案里的数字是**间接**证据；卡片才是直接证据。
      // 这一跳也顺带把「时间依赖数据」这个坑摊开：榜单默认落在本周，数据一周没更新，本周天然 0 条。
      await page.click("#board-list .empty-jump[data-range]");
      await page.waitForTimeout(3000);
      second = await readBoard();
    }
    const seen = second || first;

    const detail = [
      "线上地址：" + ctx.endpoint + "/（CDN 的那条 SDK 请求由本地副本顶替：" + sdkFrom + "，线上一个字节都没改）",
      "第一眼：#board-list 卡片 " + first.cards + " 张｜文本：" + JSON.stringify(first.text),
      "SDK 是否就绪：" + (seen.hasSdk ? "是" : "否"),
    ];
    // 注意：按钮文字要从**跳转前**那一次读（first），跳转成功后空态就被卡片替换了、
    // 按钮已不存在 —— 在 second 里读必然是空串（这是第一版的一处措辞 bug，已修）。
    if (second) detail.push("点了「" + first.jumpText + "」之后：卡片 " + second.cards + " 张｜文本：" + JSON.stringify(second.text));
    if (consoleErrors.length) detail.push("页面未捕获异常 " + consoleErrors.length + " 条：" + consoleErrors.slice(0, 2).join(" ｜ "));

    if (seen.cards > 0) {
      return {
        summary: second
          ? "默认档位为空，点开「" + first.jumpText + "」后页面上真出现了 " + seen.cards + " 张卡片（数据库真数据渲染出来了）"
          : "页面上真出现了 " + seen.cards + " 张卡片",
        detail,
      };
    }
    if (seen.numbers >= 1) {
      return {
        summary: "页面没渲染出卡片，但空态里给出了数据库条数 " + seen.numbers + " 条（读取成功、只是档位内没有新条目）",
        detail,
      };
    }
    return {
      fail: "页面既没有卡片、也没有出现 ≥1 的条数（卡片 " + seen.cards + "，条数 " + seen.numbers + "）—— 页面拿到的不是数据库真数据",
      detail,
    };
  } catch (e) {
    return { skipped: "浏览器探针出错：" + String(e.message).split("\n")[0] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/* ============================== 主流程 ============================== */

function printCheck(r) {
  console.log("  " + paint(r) + "  " + c.b(String(r.id).padEnd(3)) + " " + r.title + "  " + c.dim("— " + r.summary));
  (r.detail || []).forEach((d) => console.log(c.dim("           " + d)));
  if (r.note) console.log(c.dim("           ↳ " + r.note));
}

(async function main() {
  const t0 = Date.now();
  const cfg = readCloudConfig();
  const site = opt.site || (cfg ? cfg.endpoint : "");
  const ctx = {
    endpoint: site,
    headers: cfg ? { "x-wb-webapp-access-key": cfg.publishableKey } : {},
  };

  const head = git(["rev-parse", "--short", "HEAD"]);
  const subject = git(["log", "-1", "--pretty=%s"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

  console.log("");
  console.log(c.b("═══ 发布前验收 · verify-project · foxlings-project ═══"));
  console.log(c.dim("  根目录    ") + ROOT);
  console.log(c.dim("  线上/数据 ") + (site || "（未配置）") + (opt.site && cfg && opt.site !== cfg.endpoint ? c.dim("  ← --site 覆盖了仓库里的 " + cfg.endpoint) : ""));
  console.log(c.dim("  版本      ") + (branch.out || "?") + " · " + (head.out || "?") + "  " + (subject.out || ""));
  console.log(c.dim("  检查时间  ") + new Date().toISOString());
  console.log("");

  if (!cfg) {
    add({
      id: "P0",
      title: "读不到 js/cloud-config.js 里的 endpoint / publishableKey",
      level: "blocker",
      group: "data",
      status: "FAIL",
      summary: "没有数据通道配置，第二组（数据库）全部没跑",
      detail: ["期望文件：" + path.join(ROOT, "js", "cloud-config.js"), "这两个值是公开标识、不是密钥；文件丢了或格式变了都要先修回来"],
    });
  }

  console.log(c.b("【第一组】出门前 —— 委托 preflight-check 引擎（规则不重写，口径只有一处定义）"));
  runPreflight(site);
  checks.filter((x) => x.group === "preflight").forEach(printCheck);
  console.log("");

  console.log(c.b("【第二组】配置与数据库 —— verify-project 新增（preflight-check 声明不覆盖的一段）"));
  checkE2();
  if (cfg && site) {
    await checkH1(ctx);
    await checkH2(ctx);
    await checkH3(ctx);
    if (opt.withWrite) await checkH4(ctx);
    else add({ id: "H4", title: "写接口探针", level: "blocker", group: "data", status: "SKIP", summary: "未跑（--no-write）", detail: ["跳过不等于通过"] });
    await checkH5(ctx);
  }
  checks.filter((x) => x.group === "data").forEach(printCheck);
  console.log("");

  const blockers = checks.filter((x) => x.level === "blocker");
  const blockerFail = blockers.filter((x) => x.status !== "PASS");
  const warns = checks.filter((x) => x.status === "WARN");
  const skips = checks.filter((x) => x.status === "SKIP");

  const label = blockerFail.length ? "不可发布" : "可发布";
  const tail = blockerFail.length
    ? "红线 " + blockerFail.length + " 项失败：" + blockerFail.map((x) => x.id).join(" / ")
    : "红线 " + blockers.length + " 项全过";
  console.log(c.b(blockerFail.length ? c.bad("结论：" + label + " —— " + tail + "。") : c.ok("结论：" + label + " —— " + tail + "，提醒 " + warns.length + " 项、跳过 " + skips.length + " 项。")));
  if (blockerFail.length) console.log(c.dim("  修掉红线再发；红线没清就上线，等于把风险直接交给用户。"));
  console.log("");

  const report = {
    tool: "verify-project",
    version: "1.0",
    root: ROOT,
    endpoint: site,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    git: { branch: branch.out, head: head.out, subject: subject.out },
    checks,
    verdict: {
      label,
      passed: blockerFail.length === 0,
      blockerTotal: blockers.length,
      blockerFail: blockerFail.map((x) => x.id),
      warn: warns.length,
      skip: skips.length,
    },
  };
  if (opt.json) {
    fs.mkdirSync(path.dirname(opt.json), { recursive: true });
    fs.writeFileSync(opt.json, JSON.stringify(report, null, 2), "utf8");
    console.log(c.dim("  JSON 报告：" + opt.json));
  }
  process.exit(blockerFail.length ? 1 : 0);
})();
