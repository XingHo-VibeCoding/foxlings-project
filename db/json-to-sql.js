#!/usr/bin/env node
/* ============================================================================
   json-to-sql.js — 把 data/data.json 转成可执行的 INSERT 语句（种子数据）
   零依赖，用 Node 直接跑。

   用法：
     node db/json-to-sql.js > db/seed.sql     # 完整事务脚本（psql -f 灌库）
     psql -d foxlings -f db/seed.sql
     node db/json-to-sql.js --single          # 单条 INSERT（托管后端 exec_sql 用）

   Day 20 变更（接托管后端）：执行通道从 psql 换成 exec_sql，而它**一次只收一条语句**，
   原来的 BEGIN/TRUNCATE/COMMIT 多语句脚本用不上。所以加 --single：只吐一条 INSERT，
   可直接贴进 exec_sql（语句含中文，传参时用 base64 更稳）。

   为什么要有它：data.json 是当前**唯一**的数据源，将来建表时不该人工抄一遍。
   这个脚本保证「表里的数据」和「前端看到的数据」永远是同一份（api-contract.md
   第三节的数据迁移纪律）。非法条目与前端 data.js 同规则跳过并警告。
   ============================================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "data.json");
const VERDICTS = ["真", "假", "存疑", "部分属实"];
const CROSS_CHECKS = ["相互印证", "存在矛盾", "信源不足"];

/** SQL 字面量：单引号翻倍；空值一律 NULL */
function q(v) {
  return v === null || v === undefined || v === "" ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'";
}
/** JSONB 字面量 */
function jb(v) {
  return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
}
/** 整数（heat 用）：非有限数一律 0，与前端 heatOf() 同规则 */
function n(v) {
  return typeof v === "number" && isFinite(v) ? Math.round(v) : 0;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const items = Array.isArray(raw.items) ? raw.items : [];
  const good = [];
  const skipped = [];

  // 与 js/data.js 完全相同的校验规则，防止「前端能显示、库里灌不进」
  items.forEach((it, i) => {
    const problems = [];
    if (!it.id) problems.push("缺 id");
    if (!it.title) problems.push("缺 title");
    if (!VERDICTS.includes(it.verdict)) problems.push("verdict 非法：" + it.verdict);
    if (!it.summary) problems.push("缺 summary");
    if (!Array.isArray(it.sources) || it.sources.length < 2) problems.push("sources 不足 2 条");
    if (!it.origin) problems.push("缺 origin");
    if (!it.first_seen) problems.push("缺 first_seen");
    if (!it.updated_at) problems.push("缺 updated_at");
    if (problems.length) skipped.push("第 " + (i + 1) + " 条（" + problems.join("；") + "）");
    else good.push(it);
  });

  const rows = good.map((it) => {
    const cc = CROSS_CHECKS.includes(it.cross_check) ? q(it.cross_check) : "NULL";
    return "  (" +
      [q(it.id), q(it.title), q(it.verdict), q(it.summary), jb(it.sources),
       q(it.origin), q(it.first_seen), q(it.updated_at), n(it.heat),
       it.heat_note ? q(it.heat_note) : "NULL", cc].join(", ") +
      ")";
  });
  const insert = "INSERT INTO items (id, title, verdict, summary, sources, origin, first_seen, updated_at, heat, heat_note, cross_check) VALUES\n" +
    rows.join(",\n") + ";";

  // --single：只吐这一条 INSERT —— 托管后端的 exec_sql 一次只收一条语句
  if (process.argv.includes("--single")) {
    process.stdout.write(insert + "\n");
    if (skipped.length) process.stderr.write("[warn] 已跳过：" + skipped.join("；") + "\n");
    process.stderr.write("[ok] 生成单条 INSERT，" + good.length + " 条记录\n");
    return;
  }

  const out = [];
  out.push("-- 本文件由 db/json-to-sql.js 从 data/data.json 自动生成，请勿手工编辑。");
  out.push("-- 生成时间：" + new Date().toISOString());
  out.push("-- 条目数：" + good.length + (skipped.length ? "（跳过 " + skipped.length + " 条非法）" : ""));
  out.push("");
  out.push("BEGIN;");
  out.push("");
  out.push("-- 幂等重灌：种子数据可反复执行");
  out.push("TRUNCATE TABLE items CASCADE;");
  out.push("");
  out.push(insert);
  out.push("");
  out.push("COMMIT;");
  out.push("");

  process.stdout.write(out.join("\n"));
  if (skipped.length) process.stderr.write("[warn] 已跳过：" + skipped.join("；") + "\n");
  process.stderr.write("[ok] 生成 " + good.length + " 条 INSERT\n");
}

main();
