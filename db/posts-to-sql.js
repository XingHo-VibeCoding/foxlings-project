#!/usr/bin/env node
/* ============================================================================
   posts-to-sql.js — 把 data/posts.json 转成可执行的 INSERT 语句（论坛种子数据）
   零依赖，用 Node 直接跑。

   用法：
     node db/posts-to-sql.js > db/seed-posts.sql     # 完整事务脚本（psql -f 灌库）
     node db/posts-to-sql.js --single                # 单条 INSERT（托管后端 exec_sql 用）

   为什么要有它：与 json-to-sql.js 同理 —— data/posts.json 是论坛的**种子源头**，
   入库不该人工抄一遍。校验规则与 js/forum.js 的 loadVerifiedPosts() 逐条对齐，
   防止「前端能显示、库里灌不进」。

   两处与 items 表不同的地方（都由 RLS 决定，不是随便定的）：
     ① 不插入 id：posts.id 是 GENERATED ALWAYS AS IDENTITY，由数据库生成；
        前端也不再依赖固定 id（排序看 created_at）。
     ② author_id 用 'seed'：权限列由服务端 auth.uid() 填，客户端永不传。
        种子是站方代发，故给一个固定的非用户标识 —— 真实用户 uid 是随机串，
        不会与 'seed' 相撞，因此种子帖在 RLS 下只可能以「已通过」身份被人看到。
   ============================================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data", "posts.json");

const CATS = ["求助溯源", "已解决", "经验讨论"];
const STATUSES = ["pending", "approved", "rejected"];
const SEED_AUTHOR_ID = "seed";   // 站方种子标识（非用户 uid）

/** SQL 字面量：单引号翻倍；空值一律 NULL */
function q(v) {
  return v === null || v === undefined || v === "" ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'";
}
/** 非负整数（replies 用） */
function n(v) {
  const x = typeof v === "number" && isFinite(v) ? Math.round(v) : 0;
  return x < 0 ? 0 : x;
}
/** 日期 → 显式带时区的字面量（避免依赖数据库的 TimeZone 设置） */
function d(v) {
  return "'" + String(v).slice(0, 10) + "T00:00:00+08:00'::timestamptz";
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const posts = Array.isArray(raw.posts) ? raw.posts : [];
  const good = [];
  const skipped = [];

  posts.forEach((p, i) => {
    const problems = [];
    if (!p.title) problems.push("缺 title");
    if (!p.body) problems.push("缺 body");
    if (!CATS.includes(p.category)) problems.push("category 非法：" + p.category);
    if (!STATUSES.includes(p.status)) problems.push("status 非法：" + p.status);
    if (!p.created_at) problems.push("缺 created_at");
    if (!p.author_name) problems.push("缺 author_name");
    if (problems.length) skipped.push("第 " + (i + 1) + " 条（" + problems.join("；") + "）");
    else good.push(p);
  });

  const rows = good.map((p) =>
    "  (" + [
      q(p.category), q(p.title), q(p.body),
      q(SEED_AUTHOR_ID), q(p.author_name),
      p.item_id ? q(p.item_id) : "NULL",
      q(p.status), n(p.replies), d(p.created_at),
    ].join(", ") + ")"
  );

  const insert =
    "INSERT INTO posts (category, title, body, author_id, author_name, item_id, status, replies, created_at) VALUES\n" +
    rows.join(",\n") + ";";

  if (process.argv.includes("--single")) {
    process.stdout.write(insert + "\n");
    if (skipped.length) process.stderr.write("[warn] 已跳过：" + skipped.join("；") + "\n");
    process.stderr.write("[ok] 生成单条 INSERT，" + good.length + " 条帖子\n");
    return;
  }

  const out = [];
  out.push("-- 本文件由 db/posts-to-sql.js 从 data/posts.json 自动生成，请勿手工编辑。");
  out.push("-- 生成时间：" + new Date().toISOString());
  out.push("-- 帖子数：" + good.length + (skipped.length ? "（跳过 " + skipped.length + " 条非法）" : ""));
  out.push("");
  out.push("BEGIN;");
  out.push("");
  out.push("-- 幂等重灌：种子数据可反复执行（id 由序列重新生成，不要写死引用）");
  out.push("TRUNCATE TABLE posts RESTART IDENTITY CASCADE;");
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
