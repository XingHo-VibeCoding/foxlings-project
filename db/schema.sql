-- ============================================================================
-- schema.sql — 数据表结构定稿（Day 16）
--
-- 目标：**表结构先定下来，后面每个接口都在同一套字段上工作，不会每屏各造一套。**
-- 字段命名与 api-contract.md 第一节**完全一致**，接口层不做改名/映射。
--
-- 方言：PostgreSQL 15+（JSONB 支持好）。若目标库是 MySQL 8：
--       JSONB → JSON、SMALLINT 原样、TIMESTAMPTZ → DATETIME、BIGSERIAL → BIGINT AUTO_INCREMENT。
--
-- 当前状态：**未执行**。前端仍读 data/data.json（纯静态）。
--           执行时机 = 接后端的那一刻，届时本文件与 db/json-to-sql.js 一起跑。
--           纪律（api-contract.md 第三节）：data.json 与数据库只许一处为准，
--           禁止双写过渡期超过一天 —— 所以「建表」与「切数据源」必须同一天完成。
--
-- 生成种子数据：
--   node db/json-to-sql.js > db/seed.sql     # 由 data/data.json 生成 INSERT
--   psql -d foxlings -f db/schema.sql
--   psql -d foxlings -f db/seed.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ① items — 核查条目（当前唯一在用的表；前端 data.json 的数据库形态）
--
-- 关于 sources：**不拆成独立表**，用 JSONB 内嵌。
--   理由：每条只有 2–5 个信源，读法永远是「跟着条目一起取」，拆表只会平白多一次 JOIN；
--   而且信源不需要独立主键、不需要被别的表引用。
--   什么时候该拆：出现「按信源反查所有条目」「统计某机构被引用次数」这类需求时再拆，
--   那时用 JSONB 也能平滑迁出（jsonb_array_elements 一行 SQL 就能转表）。
-- ---------------------------------------------------------------------------
CREATE TABLE items (
  id          TEXT        PRIMARY KEY,                  -- 如 '20261005-01'
  title       TEXT        NOT NULL,                     -- ≤30 字
  verdict     TEXT        NOT NULL                      -- 四档结论（CHECK 与前端 VERDICTS 同步）
              CHECK (verdict IN ('真', '假', '存疑', '部分属实')),
  summary     TEXT        NOT NULL,                     -- ≤150 字大白话依据
  sources     JSONB       NOT NULL                      -- [{name,url,date}, ...]
              CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) >= 2),
  origin      TEXT        NOT NULL,                     -- 最早出处；允许「未能溯源」+已知流传信息
  first_seen  DATE        NOT NULL,
  updated_at  DATE        NOT NULL,
  heat        SMALLINT    NOT NULL DEFAULT 0            -- 辟谣榜排序依据
              CHECK (heat BETWEEN 0 AND 100),
  heat_note   TEXT,                                     -- 热度角标文案，如「微博热搜前 10」
  cross_check TEXT        CHECK (cross_check IN ('相互印证', '存在矛盾', '信源不足')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()         -- 入库时间（前端不用，后台审计用）
);

COMMENT ON TABLE  items IS '核查条目：辟谣榜与详情页的唯一数据源';
COMMENT ON COLUMN items.heat IS '0-100 整数；缺失/非法时前端回退按 updated_at 倒序';
COMMENT ON COLUMN items.cross_check IS '多源比对结论；NULL 或非法值一律按「信源不足」降级';

-- 榜单主查询：先按时间档过滤 updated_at，再按 heat 排序
CREATE INDEX idx_items_board     ON items (updated_at DESC, heat DESC);
CREATE INDEX idx_items_verdict   ON items (verdict);
-- 站内关键词检索（L1）。注意：中文分词需要 pg_jieba / zhparser 扩展；
-- 未装扩展时先用三元组模糊匹配兜底，够 2000 条以内的规模用。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_items_title_trgm   ON items USING gin (title   gin_trgm_ops);
CREATE INDEX idx_items_summary_trgm ON items USING gin (summary gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- ② posts — 论坛帖子（F3 预留，**当前未启用**）
--   上线前提：用户账号（由托管认证体系提供，故此处只存 author_id 不建 users 表）
--             + 人工审核流（法规要求，自动过滤不够）。
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id          BIGSERIAL   PRIMARY KEY,
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  author_id   UUID        NOT NULL,                     -- 由托管用户认证体系提供
  item_id     TEXT        REFERENCES items(id) ON DELETE SET NULL,  -- 可选：关联到某条核查
  status      TEXT        NOT NULL DEFAULT 'pending'    -- 审核状态机
              CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_note TEXT,                                     -- 驳回理由（回给作者）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE posts IS 'F3 论坛帖子；status 为 pending 时仅作者与审核人可见';

CREATE INDEX idx_posts_feed ON posts (status, created_at DESC);
CREATE INDEX idx_posts_item ON posts (item_id) WHERE item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ③ reports — 用户提交的线索（**当前未启用**，现在走 localStorage 的 fx_myreports）
--   这是「证据整理员」定位的输入端：用户看到可疑消息 → 提交 → 站方核查 → 成稿为 items。
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
  id         BIGSERIAL   PRIMARY KEY,
  text       TEXT        NOT NULL,                      -- 用户描述的线索内容
  url        TEXT,                                      -- 可选：原始链接
  author_id  UUID,                                      -- 允许匿名提交，故可为 NULL
  status     TEXT        NOT NULL DEFAULT 'pending'     -- 线索处理流程
             CHECK (status IN ('pending', 'checking', 'published', 'rejected')),
  item_id    TEXT        REFERENCES items(id) ON DELETE SET NULL,  -- 核查成稿后回填
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE reports IS '用户提交的待核查线索；published 后会回填 item_id 指向成稿';

CREATE INDEX idx_reports_queue ON reports (status, created_at);

COMMIT;

-- ============================================================================
-- 与 api-contract.md 预留接口的对应
--
--   GET  /api/items          → SELECT * FROM items WHERE updated_at >= now() - $range
--                              [AND verdict = $verdict] [AND (title||summary) ILIKE '%'||$q||'%']
--                              ORDER BY heat DESC LIMIT $limit OFFSET $offset
--   GET  /api/items/:id      → SELECT * FROM items WHERE id = $1
--   POST /api/search         → L3：先走上面的 items 查询做站内命中，再走联网搜索 + AI 整合
--   GET  /api/posts          → SELECT * FROM posts WHERE status = 'approved' ORDER BY created_at DESC
--   POST /api/posts          → INSERT INTO posts (..., status) VALUES (..., 'pending')  -- 一律先待审
--   POST /api/reports        → INSERT INTO reports (text, url, author_id) VALUES (...)
--
-- 错误返回统一 { "error": { "code": "...", "message": "..." } }，前端按四态规范处理。
-- ============================================================================
