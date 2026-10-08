-- ============================================================================
-- schema.sql — 数据表结构定稿（Day 16）
--
-- 目标：**表结构先定下来，后面每个接口都在同一套字段上工作，不会每屏各造一套。**
-- 字段命名与 api-contract.md 第一节**完全一致**，接口层不做改名/映射。
--
-- 方言：PostgreSQL 15+（JSONB 支持好）。若目标库是 MySQL 8：
--       JSONB → JSON、SMALLINT 原样、TIMESTAMPTZ → DATETIME、BIGSERIAL → BIGINT AUTO_INCREMENT。
--
-- 当前状态（Day 21）：三张表都已在托管后端的云库**建好并灌入种子**。
--           items 23 条（md5 双端指纹校验逐字一致）；posts 7 条（6 approved + 1 pending 样例）。
--           前端已全部切到云库（js/api.js），data/*.json 降级为种子源头（db/*-to-sql.js 的输入）。
--           执行通道：托管后端的 exec_sql（**一次只收一条语句**），种子由 --single 模式生成。
--           本文件仍是表结构 + RLS 闸门的**权威文档**（实际策略以 api-contract.md 第五节为准）。
--           ⚠️ 平台事实：未登录时 auth.uid() 返回字符串 'anon'（不是 NULL）——
--           涉权限的策略必须写 TO authenticated，见 api-contract.md 第四节。
--           pg_trgm 扩展未启用（托管环境未装扩展），站内检索先用 ILIKE 兜底（数据量小，够用）。
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
-- ② posts — 论坛帖子（Day 21 已启用）
--   author_id 由服务端 auth.uid() 填，客户端不许传（RLS 拒伪造）；未登录时为 'anon'，
--   但插入策略限定 TO authenticated，所以未登录者实际插不进 —— 发帖必须登录。
--   status 的状态机只能由站方管理通道推进（无 UPDATE 策略）：客户端想直接插 approved 会被拒。
--   author_name 是展示昵称（发帖时用户自己填），永不参与权限判断。
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category    TEXT        NOT NULL DEFAULT '求助溯源'   -- 三选一，与前端 POST_CATS 同步
              CHECK (category IN ('求助溯源', '已解决', '经验讨论')),
  title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 4 AND 60),
  body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 10 AND 1000),
  author_id   TEXT        NOT NULL DEFAULT auth.uid(),  -- 权限字段，客户端永不传
  author_name TEXT        NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 20),
  item_id     TEXT        REFERENCES items(id) ON DELETE SET NULL,  -- 可选：关联到某条核查
  status      TEXT        NOT NULL DEFAULT 'pending'    -- 审核状态机
              CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_note TEXT,                                     -- 驳回理由（回给作者）
  replies     INTEGER     NOT NULL DEFAULT 0 CHECK (replies >= 0),  -- 展示预留，将来由回复表聚合
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE posts IS 'F3 论坛帖子：公开列表只出 approved；pending 仅作者与审核人可见。发帖必须登录（插入策略 TO authenticated）';

CREATE INDEX idx_posts_feed ON posts (status, created_at DESC);
CREATE INDEX idx_posts_item ON posts (item_id) WHERE item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ③ reports — 用户提交的线索（Day 21 已启用）
--   允许未登录提交：author_id 落 'anon'（平台对未登录的固定标识）。
--   读策略只给 authenticated 的「自己的行」—— 匿名线索对客户端不可见，
--   否则任何访客都能把所有人匿名提交的线索读走（它们全是 'anon'）。
--   上线前需补：匿名提交的频控/人机验证（RLS 只管「谁」，不管「多快」）。
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text       TEXT        NOT NULL CHECK (char_length(text) BETWEEN 5 AND 500),
  url        TEXT,                                      -- 可选：原始链接
  author_id  TEXT        DEFAULT auth.uid(),            -- 未登录落 'anon'；伪造他人署名被 RLS 拒
  status     TEXT        NOT NULL DEFAULT 'pending'     -- 线索处理流程
             CHECK (status IN ('pending', 'checking', 'published', 'rejected')),
  item_id    TEXT        REFERENCES items(id) ON DELETE SET NULL,  -- 核查成稿后回填
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE reports IS '用户提交的待核查线索：未登录可提交（author_id 落 anon）；客户端只能回读登录后自己提交的';

CREATE INDEX idx_reports_queue ON reports (status, created_at);

-- ---------------------------------------------------------------------------
-- ④ profiles — 用户资料（Day 22 新增：昵称 / 个性签名 / 头像）
--   用户可见的「我是谁」：昵称与头像会显示在论坛帖子上，属**公开**信息；
--   个性签名只出现在自己的个人主页。
--   avatar_kind / avatar_value 两列表达一个头像：
--     preset → avatar_value 是站内预设 id（如 'p2'），无需文件、无需签名；
--     upload → avatar_value 是云存储对象路径（shared/<uid>/avatars/xxx.jpg）。
--   ⚠️ 头像图片本身存在云存储，读它必须先换**短时签名 URL**（最长 1 小时）——
--      所以签名 URL 绝不写进这张表，每次渲染现取；表里只存路径这个稳定事实。
--   RLS 一律 TO authenticated（未登录连读都不给）：论坛访客看到的作者昵称
--   来自 posts.author_name 这个冗余字段，不需要读这张表。
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
  user_id      TEXT        PRIMARY KEY DEFAULT auth.uid(),  -- 权限字段；新建时客户端不传，由服务端填
  nickname     TEXT        NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 20),
  bio          TEXT        NOT NULL DEFAULT '' CHECK (char_length(bio) <= 80),
  avatar_kind  TEXT        NOT NULL DEFAULT 'preset'
               CHECK (avatar_kind IN ('preset', 'upload')),
  avatar_value TEXT,                                        -- 预设 id，或云存储路径
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE profiles IS '用户资料：昵称与头像公开显示在论坛帖子上；签名只在个人主页。头像文件在云存储 shared/<uid>/avatars/，本表只存路径';

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
--                              （RLS 的 posts_read 完成过滤；登录者额外看得到自己的 pending）
--   POST /api/posts          → INSERT INTO posts (category, title, body, author_name, item_id)
--                              —— author_id / status 不许传，RLS 强制「本人 + pending」
--   POST /api/reports        → INSERT INTO reports (text, url)，不带 RETURNING（匿名无读权限）
--   GET  /api/reports        → SELECT * FROM reports（RLS 的 reports_read_own 只给登录者自己的行）
--
-- 错误返回统一 { "error": { "code": "...", "message": "..." } }，前端按四态规范处理。
-- ============================================================================
