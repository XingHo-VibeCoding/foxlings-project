-- ============================================================================
-- schema.sql — 数据表结构 + RLS 闸门定稿
--   Day 16 建档 · Day 21 修订为可重复执行 · Day 22 加软删除 · Day 24 撤软删除、加公告表
--
-- 目标：**表结构先定下来，后面每个接口都在同一套字段上工作，不会每屏各造一套。**
-- 字段命名与 api-contract.md 第一节**完全一致**，接口层不做改名/映射。
--
-- 方言：PostgreSQL 15+（JSONB 支持好）。若目标库是 MySQL 8：
--       JSONB → JSON、SMALLINT 原样、TIMESTAMPTZ → DATETIME、BIGSERIAL → BIGINT AUTO_INCREMENT。
--
-- ── 契约：本脚本**可以连续执行任意次**（幂等，Day 21 定稿）──
--   ① 所有建表/建索引带 IF NOT EXISTS；策略先 DROP POLICY IF EXISTS 再 CREATE；
--   ② 函数用 CREATE OR REPLACE；
--   ③ **不删任何数据**，也不重置浏览量等活数据。
--   验证过的执行方式：把 { BEGIN…COMMIT } 之间的语句逐条送入托管后端 exec_sql
--   （该通道一次只收一条语句），连跑两轮零报错，事后 SELECT 行数不变。
--   ⚠️ 唯一注意：`DROP POLICY IF EXISTS` + `CREATE POLICY` 之间有一个极短的窗口，
--      生产环境应整包在事务里执行（见文件首尾的 BEGIN/COMMIT），不要在高峰期单条上线。
--   ⚠️ 走**数据通道**（前端 / PostgREST）推送时，请求体含 `CREATE TABLE` / `ALTER TABLE`
--      / `TRUNCATE TABLE` 字面会被网关 WAF 回 403 → 走 MCP 的 exec_sql（migrate 模式）
--      不受此限，DDL 一律走那条通道。
--
-- ── Day 24 变更：一次回退 + 一次新增 ──
--   ① **撤掉软删除**。Day 22 曾用 BEFORE DELETE 触发器把删除改写成 is_deleted 标记，
--      给误删留一条找回的路。跑过一轮之后站方（产品决策）认为「没必要留数据，堆着没用」——
--      删除就该是不可逆的。于是触发器、soft_delete_rows()、restore_item/report、
--      is_deleted 列、以及为看回收站而设的 items_admin_read 策略**全部移除**，
--      三条读策略恢复干净形态。
--      「不可逆」这件事于是回到它该在的位置：**在按钮上做两击确认 + 把话说清楚**
--      （js/admin.js 的 armDangerous 与「永久删除」文案），而不是在数据库里偷偷留副本。
--   ② **新增 announcements 表**：论坛顶部的站方公告栏（置顶公共栏）。
--      公开可读；只有 admins 名单里的人能发/改/删 —— 社区规则由站方在后台维护，
--      页面只负责展示与轮播，规则文案改一次全站生效，不用改代码。
--
-- 当前状态（Day 24）：
--   六张表 + 一个函数（bump_item_view）+ 十七条 RLS 策略
--   **全部在托管后端云库落地**，本文件是权威定义。
--   items 23 条种子；posts 7 条（6 approved + 1 pending 样例）；announcements 2 条；
--   reports / profiles / admins 各若干。
--   前端已全部切到云库（js/api.js），data/*.json 降级为种子源头（db/*-to-sql.js 的输入）。
--   执行通道：托管后端的 exec_sql（**一次只收一条语句**），种子由 --single 模式生成。
--   ⚠️ 平台事实：未登录时 auth.uid() 返回字符串 'anon'（不是 NULL）——
--      涉权限的策略必须写 TO authenticated，见 api-contract.md 第四节。
--   pg_trgm 扩展已于 Day 21 确认可装（此前"未装"的注释作废），三元组索引正常建立。
--
-- 幂等性验证记录（Day 21）：整包拆成 60 条语句执行多轮 —— 第 1 轮补齐缺失的索引，
--   此后每轮前后九项状态全等；两个种子脚本（items / posts）同样连跑两轮零报错，
--   并额外做了反证：「改坏一条标题 → 重灌 → 逐字还原」、「库里与种子文件不一致 → 重灌 → 对齐」。
--   完整证据见 docs/day21-acceptance.md 第 ① 项。
--
-- 灌种子的正确姿势（两种，都幂等）：
--   node db/json-to-sql.js > db/seed.sql   # 完整脚本：INSERT … ON CONFLICT (id) DO UPDATE
--   node db/json-to-sql.js --single        # 单条 INSERT（托管后端 exec_sql 用）
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- ① items — 核查条目（榜单与详情页的唯一数据源）
--
-- 关于 sources：**不拆成独立表**，用 JSONB 内嵌。
--   理由：每条只有 2–5 个信源，读法永远是「跟着条目一起取」，拆表只会平白多一次 JOIN；
--   而且信源不需要独立主键、不需要被别的表引用。
--   什么时候该拆：出现「按信源反查所有条目」「统计某机构被引用次数」这类需求时再拆，
--   那时用 JSONB 也能平滑迁出（jsonb_array_elements 一行 SQL 就能转表）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
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
  heat        SMALLINT    NOT NULL DEFAULT 0            -- 人工热度 0-100（编辑填的「初始票数」）
              CHECK (heat BETWEEN 0 AND 100),
  heat_note   TEXT,                                     -- 热度角标文案，如「微博热搜前 10」
  views       INTEGER     NOT NULL DEFAULT 0            -- 真实浏览量（Day 23）；只能由函数 +1，客户端改不了
              CHECK (views >= 0),
  cross_check TEXT        CHECK (cross_check IN ('相互印证', '存在矛盾', '信源不足')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()         -- 入库时间（前端不用，后台审计用）
);

COMMENT ON TABLE  items IS '核查条目：辟谣榜与详情页的唯一数据源';
COMMENT ON COLUMN items.heat IS '人工热度 0-100，由编辑填写；缺失/非法时前端回退 0';
COMMENT ON COLUMN items.views IS '真实浏览量：详情页每被一台设备打开一次 +1，只能经 bump_item_view() 自增；前端拿 (heat + views) 计算榜单热度分';
COMMENT ON COLUMN items.cross_check IS '多源比对结论；NULL 或非法值一律按「信源不足」降级';

-- 榜单主查询：先按时间档过滤 updated_at，再按 heat 排序
CREATE INDEX IF NOT EXISTS idx_items_board   ON items (updated_at DESC, heat DESC);
CREATE INDEX IF NOT EXISTS idx_items_verdict ON items (verdict);
-- 站内关键词检索（L1）。注意：中文分词需要 pg_jieba / zhparser 扩展；
-- 未装扩展时先用三元组模糊匹配兜底，够 2000 条以内的规模用。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_items_title_trgm   ON items USING gin (title   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_items_summary_trgm ON items USING gin (summary gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- ①-b bump_item_view —— 热度算法里「点击量」那一半的来源（Day 23 新增）
--
-- 为什么要有这么个函数：items 表**没有任何写策略**，客户端连 UPDATE 权限都没有
-- （实测 PATCH 一律 permission denied for table items）。可浏览量必须在服务端
-- 自增，于是把「+1」这件事本身做成一个函数，闸门不必打开：
--
--   · SECURITY DEFINER —— 以函数定义者的身份执行，越过 items 的只读闸门；
--   · 参数只有条目 id、**没有数字** —— 调用者只能说「+1」，不能说「改成 900」。
--     产品规则「管理员也不能手动调序」由此由函数签名保证，而不是靠自觉；
--   · 原子自增（views = views + 1）—— 并发点击不会像「前端读 n 再写 n+1」那样丢计数；
--   · 条目不存在时一行不改、返回 -1，前端据此静默忽略。
--
-- `SET search_path = public` 是 SECURITY DEFINER 函数的必备项：不锁死搜索路径，
-- 别人就能在别的 schema 里造同名对象，劫持函数体里的表引用。
--
-- 去重（同设备同条目只算一次）**不在这层** —— 函数不知道、也不该知道
-- 「你是不是第一次来」，那件事由前端 localStorage 拦在调用之前（js/detail.js）。
-- 代价说清楚：换浏览器、清缓存、开无痕，同一个人的同一条都会再算一次。
-- 当前规模（浏览量个位数）接受这个误差；将来要更准，得加「访客 × 条目 × 天」日志表。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bump_item_view(p_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v integer;
BEGIN
  UPDATE items SET views = views + 1
   WHERE id = p_id
  RETURNING views INTO v;
  RETURN COALESCE(v, -1);
END;
$$;

-- 未登录访客也要能计数（anon 角色）—— 和 reports 表允许匿名提交同一条思路
GRANT EXECUTE ON FUNCTION bump_item_view(text) TO anon, authenticated;

COMMENT ON FUNCTION bump_item_view(text) IS '给某条核查 +1 次浏览，返回自增后的值；条目不存在返回 -1。SECURITY DEFINER，是 items 只读闸门上唯一放行「+1」的通道';

-- ---------------------------------------------------------------------------
-- ② posts — 论坛帖子（Day 21 启用）
--   author_id 由服务端 auth.uid() 填，客户端不许传（RLS 拒伪造）；未登录时为 'anon'，
--   但插入策略限定 TO authenticated，所以未登录者实际插不进 —— 发帖必须登录。
--   status 的状态机只能由站方管理通道推进：本人插入只允许 pending（posts_insert_own），
--   之后只能由管理员经 posts_admin_update 改。
--   author_name 是展示昵称（发帖时用户自己填），永不参与权限判断。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
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

CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_item ON posts (item_id) WHERE item_id IS NOT NULL;

-- 种子帖的「自然键」（Day 21）：让 db/posts-to-sql.js 能按标题 upsert，而不必
-- TRUNCATE（旧做法会把真实用户的帖子一起清空、并重置 id 序列）。
-- **只覆盖 author_id = 'seed' 的站方种子帖** —— 真实用户不受影响，可以随便取同名标题。
-- 改这个索引的定义，必须同步改 db/posts-to-sql.js 里的 ON CONFLICT 谓词，否则冲突推断会失败。
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_seed_title ON posts (title) WHERE author_id = 'seed';

-- ---------------------------------------------------------------------------
-- ③ reports — 用户提交的线索（Day 21 启用）
--   允许未登录提交：author_id 落 'anon'（平台对未登录的固定标识）。
--   读策略只给 authenticated 的「自己的行」—— 匿名线索对客户端不可见，
--   否则任何访客都能把所有人匿名提交的线索读走（它们全是 'anon'）。
--   上线前需补：匿名提交的频控/人机验证（RLS 只管「谁」，不管「多快」）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
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

CREATE INDEX IF NOT EXISTS idx_reports_queue ON reports (status, created_at);

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
CREATE TABLE IF NOT EXISTS profiles (
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

-- ---------------------------------------------------------------------------
-- ⑤ admins — 管理员名单（Day 23）
--   名单本身无任何写策略：加/撤管理员走站方管理通道，客户端改不了。
--   各表 *_admin_* 策略用 EXISTS 子查询认它，权限真身在这里，前端只是入口。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  user_id     TEXT PRIMARY KEY,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE admins IS '管理员名单：各表 *_admin_* 策略经 EXISTS 认它；无写策略，加人走站方通道';

-- ---------------------------------------------------------------------------
-- ⑤-b announcements — 站方公告（Day 24 新增）
--   论坛顶部的「置顶公共栏」数据源：站方发布的通知与社区规则。
--
--   为什么不复用 posts：公告与帖子是两种东西 ——
--     · 说话的人不同：公告只有站方（admins 名单）能发，帖子任何登录用户都能发；
--     · 生命周期不同：公告长期挂在那儿，帖子会沉下去；
--     · 展示位置不同：公告在论坛页顶部常驻并轮播，帖子在下面的列表里。
--   硬塞进 posts 的话，论坛列表、审核队列、前端筛选每一处都要多加一个
--   「这条是公告、不算帖子」的判断 —— 一处漏了，公告就混进帖子流了。
--   单独一张表，代价只是多两个接口，换来的是两边逻辑互不干扰。
--
--   is_pinned：是否进顶部公共栏。默认 true；置 false 等于「先写好放着、暂不公布」——
--   Day 24 之后删除是不可逆的（软删除已撤），所以站方需要一个「不删也能摘下来」的档位。
--   sort_order：排序权重，大的在前（把「社区规则」这类必须常看的顶在最上面）；
--   同权重时按 id 倒序（新的在前）。前端公告栏按这个顺序轮播。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 60),
  body       TEXT        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  is_pinned  BOOLEAN     NOT NULL DEFAULT true,          -- 是否进顶部公共栏
  sort_order INTEGER     NOT NULL DEFAULT 0,             -- 大的在前；同权重时新的在前
  author_id  TEXT        NOT NULL DEFAULT auth.uid(),    -- 发布人；种子行是 'seed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE announcements IS '站方公告：论坛顶部置顶公共栏的数据源；公开可读，只有 admins 名单里的人能发/改/删';
COMMENT ON COLUMN announcements.sort_order IS '排序权重，大的在前；同权重时新的在前';

-- ---------------------------------------------------------------------------
-- ⑥ RLS 闸门 —— 六张表 17 条策略（Day 21 定稿 · Day 22 增 profiles · Day 23 增 admins 与管理策略 · Day 24 增公告、撤回收站读）
--
-- 三条不变量（也是 api-contract.md 第五节的机器可读版）：
--   1. 六张表**全部开启行级安全**（ENABLE ROW LEVEL SECURITY）；没策略 = 拒绝，是默认态；
--   2. 涉权限的策略一律 TO authenticated —— 因为未登录的 auth.uid() 是 'anon' 不是 NULL，
--      开给 anon 等于把「只读自己的」变成「读所有人的」（见 api-contract.md 第四节）；
--   3. 所有管理策略判定式同一个：EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid())。
--
-- 幂等写法：每条策略都先 DROP POLICY IF EXISTS 再建 —— 重复执行不报错，且策略定义永远随文件走。
-- ---------------------------------------------------------------------------

-- 6.1 先开闸（对已开启者重复执行是空操作）
ALTER TABLE items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- 6.2 items：公开只读，**无任何客户端写策略**
--     浏览量不走写策略，走 bump_item_view() 这个 SECURITY DEFINER 窄口（见 ①-b）。
--     管理员可删条目（删榜单）；注意「不能改热度」是函数签名保证的，不是靠策略。
--     Day 24：读策略回到干净的一句 —— 软删除撤掉后，这里不再需要 is_deleted 条件，
--     目的只为放行整表（详情页、榜单、检索都要读它）。
DROP POLICY IF EXISTS items_read_all ON items;
CREATE POLICY items_read_all ON items
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS items_admin_delete ON items;
CREATE POLICY items_admin_delete ON items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 6.3 posts：公开列表只出 approved；作者总能看见自己的（含 pending/rejected）；
--     插入只能插成「自己的 + pending」；状态机推进只有管理员能动。
DROP POLICY IF EXISTS posts_read ON posts;
CREATE POLICY posts_read ON posts
  FOR SELECT TO anon, authenticated
  USING (status = 'approved' OR author_id = auth.uid());

DROP POLICY IF EXISTS posts_insert_own ON posts;
CREATE POLICY posts_insert_own ON posts
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND status = 'pending');

DROP POLICY IF EXISTS posts_admin_read ON posts;
CREATE POLICY posts_admin_read ON posts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS posts_admin_update ON posts;
CREATE POLICY posts_admin_update ON posts
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS posts_admin_delete ON posts;
CREATE POLICY posts_admin_delete ON posts
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 6.4 reports：未登录可提交（插成 'anon' 自己），但**读不回**自己的匿名行；
--     登录者只能读自己提交的；管理员可读全部、可删。
DROP POLICY IF EXISTS reports_insert ON reports;
CREATE POLICY reports_insert ON reports
  FOR INSERT TO anon, authenticated
  WITH CHECK (NOT (author_id IS DISTINCT FROM auth.uid()));

DROP POLICY IF EXISTS reports_read_own ON reports;
CREATE POLICY reports_read_own ON reports
  FOR SELECT TO authenticated
  USING (author_id = auth.uid());

DROP POLICY IF EXISTS reports_admin_read ON reports;
CREATE POLICY reports_admin_read ON reports
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

DROP POLICY IF EXISTS reports_admin_delete ON reports;
CREATE POLICY reports_admin_delete ON reports
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 6.5 profiles：登录者可读全表（头像昵称要显示给别的读者），只能写自己那行。
DROP POLICY IF EXISTS profiles_read_signed_in ON profiles;
CREATE POLICY profiles_read_signed_in ON profiles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS profiles_insert_own ON profiles;
CREATE POLICY profiles_insert_own ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 6.6 admins：本人只能确认「我是不是管理员」，读不到名单全表；无任何写策略。
DROP POLICY IF EXISTS admins_read_self ON admins;
CREATE POLICY admins_read_self ON admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 6.7 announcements：公开可读（公告就是给人看的，未登录也要看得到）；
--     写操作全部限定在 admins 名单内 —— 一条 FOR ALL 覆盖增 / 改 / 删三种动作。
--     USING 管「对哪些行有效」，WITH CHECK 管「新写入的行合不合法」，两个都写全。
DROP POLICY IF EXISTS announcements_read_all ON announcements;
CREATE POLICY announcements_read_all ON announcements
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS announcements_admin_write ON announcements;
CREATE POLICY announcements_admin_write ON announcements
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

COMMIT;

-- ============================================================================
-- 与 api-contract.md 预留接口的对应
--
--   GET  /api/items          → SELECT * FROM items WHERE updated_at >= now() - $range
--                              [AND verdict = $verdict] [AND (title||summary) ILIKE '%'||$q||'%']
--                              ORDER BY heat DESC LIMIT $limit OFFSET $offset
--   GET  /api/items/:id      → SELECT * FROM items WHERE id = $1
--   POST /api/search         → L3：先走上面的 items 查询做站内命中，再走 AI 拆解指路
--   POST /rpc/bump_item_view → SELECT bump_item_view($id)  —— 唯一改 items 的通道（只能 +1）
--   GET  /api/posts          → SELECT * FROM posts WHERE status = 'approved' ORDER BY created_at DESC
--                              （RLS 的 posts_read 完成过滤；登录者额外看得到自己的 pending）
--   POST /api/posts          → INSERT INTO posts (category, title, body, author_name, item_id)
--                              —— author_id / status 不许传，RLS 强制「本人 + pending」
--   POST /api/reports        → INSERT INTO reports (text, url)，不带 RETURNING（匿名无读权限）
--   GET  /api/reports        → SELECT * FROM reports（RLS 的 reports_read_own 只给登录者自己的行）
--   GET  /api/announcements  → SELECT * FROM announcements WHERE is_pinned
--                              ORDER BY sort_order DESC, id DESC  —— 公开读，未登录也给
--   POST /api/announcements  → INSERT INTO announcements (title, body, sort_order)
--                              —— 只有 admins 名单里的人能写（announcements_admin_write）
--   PATCH/DELETE /api/announcements/:id → 同一条策略放行（FOR ALL）
--
-- 错误返回统一 { "error": { "code": "...", "message": "..." } }，前端按四态规范处理。
-- ============================================================================
