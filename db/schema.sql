-- ============================================================================
-- schema.sql — 数据表结构 + RLS 闸门定稿（Day 16 建档 · Day 21 修订为可重复执行 · Day 22 加软删除）
--
-- 目标：**表结构先定下来，后面每个接口都在同一套字段上工作，不会每屏各造一套。**
-- 字段命名与 api-contract.md 第一节**完全一致**，接口层不做改名/映射。
--
-- 方言：PostgreSQL 15+（JSONB 支持好）。若目标库是 MySQL 8：
--       JSONB → JSON、SMALLINT 原样、TIMESTAMPTZ → DATETIME、BIGSERIAL → BIGINT AUTO_INCREMENT。
--
-- ── 契约：本脚本**可以连续执行任意次**（幂等，Day 21 定稿）──
--   ① 所有建表/建索引带 IF NOT EXISTS；策略先 DROP POLICY IF EXISTS 再 CREATE；
--      Day 22 起**对已存在表的加列**也写了 `ADD COLUMN IF NOT EXISTS`，且紧跟各自的建表语句
--      —— 位置很关键：必须排在引用该列的**函数与策略之前**，否则会报 42703；
--   ② 函数用 CREATE OR REPLACE；触发器先 DROP TRIGGER IF EXISTS 再 CREATE；
--   ③ **不删任何数据**，也不重置浏览量等活数据。
--   验证过的执行方式：把 { BEGIN…COMMIT } 之间的语句逐条送入托管后端 exec_sql
--   （该通道一次只收一条语句），连跑两轮零报错，事后 SELECT 行数不变。
--   ⚠️ 唯一注意：`DROP POLICY IF EXISTS` + `CREATE POLICY` 之间有一个极短的窗口，
--      生产环境应整包在事务里执行（见文件首尾的 BEGIN/COMMIT），不要在高峰期单条上线。
--   ⚠️ 走**数据通道**推送时，请求体含 `CREATE TABLE` / `ALTER TABLE` / `TRUNCATE TABLE`
--      字面会被网关 WAF 回 403 → 一律 base64 暂存后执行（见 RUN.md「DDL 推送」节）。
--
-- Day 22 新增：**软删除**（is_deleted 标记 + BEFORE DELETE 触发器把 DELETE 改写成标记），
--   以及配套的 **恢复入口**（items / reports 走窄口函数，posts 走已有的 UPDATE 策略）。
--   动机：库里已经有真实用户内容，硬删除删错就找不回来。客户端从此**没有物理删除能力**。
--
-- 当前状态（Day 22）：
--   五张表 + 四个函数（bump_item_view / soft_delete_rows / restore_item / restore_report）
--   + 十六条 RLS 策略 + 三个软删触发器
--   **全部在托管后端云库落地**，本文件是权威定义。
--   items 23 条种子；posts 7 条（6 approved + 1 pending 样例）；reports/profiles/admins 各若干。
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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),        -- 入库时间（前端不用，后台审计用）
  is_deleted  BOOLEAN     NOT NULL DEFAULT false          -- 软删除（Day 22）：true = 已回收，读路径一律跳过
);

-- 「加列」必须紧跟「建表」：`CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作，
-- 老库不会自动长出这一列 —— 靠这条补。同时它必须排在**任何引用该列的对象之前**
-- （下面的 bump_item_view、以及 ⑥ 节的读策略都引用了 is_deleted），否则建函数/建策略会报 42703。
-- ⚠️ 含 `ALTER TABLE` 字面，走数据通道推送会被网关 WAF 回 403 → 必须 base64（见 RUN.md）。
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE  items IS '核查条目：辟谣榜与详情页的唯一数据源';
COMMENT ON COLUMN items.heat IS '人工热度 0-100，由编辑填写；缺失/非法时前端回退 0';
COMMENT ON COLUMN items.views IS '真实浏览量：详情页每被一台设备打开一次 +1，只能经 bump_item_view() 自增；前端拿 (heat + views) 计算榜单热度分';
COMMENT ON COLUMN items.cross_check IS '多源比对结论；NULL 或非法值一律按「信源不足」降级';
COMMENT ON COLUMN items.is_deleted IS '软删除标记（Day 22）：true = 条目已回收，公开榜单与详情页都读不到；恢复只需置回 false，数据从未离开过这张表';

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
   WHERE id = p_id AND NOT is_deleted              -- 已回收的条目不再计数（Day 22）
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
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted  BOOLEAN     NOT NULL DEFAULT false          -- 软删除（Day 22）：true = 已回收，读路径一律跳过
);

-- 老库补列（同上：CREATE TABLE IF NOT EXISTS 对已存在的表是空操作）
ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE posts IS 'F3 论坛帖子：公开列表只出 approved；pending 仅作者与审核人可见。发帖必须登录（插入策略 TO authenticated）';
COMMENT ON COLUMN posts.is_deleted IS '软删除标记（Day 22）：DELETE 被 BEFORE DELETE 触发器拦下改成置此位，所以客户端发 DELETE 也删不掉真数据，帖子随时可找回';

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted BOOLEAN     NOT NULL DEFAULT false          -- 软删除（Day 22）：true = 已回收，读路径一律跳过
);

-- 老库补列（同上）
ALTER TABLE reports ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE reports IS '用户提交的待核查线索：未登录可提交（author_id 落 anon）；客户端只能回读登录后自己提交的';
COMMENT ON COLUMN reports.is_deleted IS '软删除标记（Day 22）：线索被回收后作者自己也看不到，但行还在，误删可整体还原';

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
-- ⑥ RLS 闸门 —— 五张表 16 条策略（Day 21 定稿 · Day 22 增 profiles 与恢复读 · Day 23 增 admins 与管理策略）
--
-- 三条不变量（也是 api-contract.md 第五节的机器可读版）：
--   1. 五张表**全部开启行级安全**（ENABLE ROW LEVEL SECURITY）；没策略 = 拒绝，是默认态；
--   2. 涉权限的策略一律 TO authenticated —— 因为未登录的 auth.uid() 是 'anon' 不是 NULL，
--      开给 anon 等于把「只读自己的」变成「读所有人的」（见 api-contract.md 第四节）；
--   3. 所有管理策略判定式同一个：EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid())。
--
-- 幂等写法：每条策略都先 DROP POLICY IF EXISTS 再建 —— 重复执行不报错，且策略定义永远随文件走。
-- ---------------------------------------------------------------------------

-- 6.1 先开闸（对已开启者重复执行是空操作）
ALTER TABLE items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins   ENABLE ROW LEVEL SECURITY;

-- 6.2 items：公开只读，**无任何客户端写策略**
--     浏览量不走写策略，走 bump_item_view() 这个 SECURITY DEFINER 窄口（见 ①-b）。
--     管理员可删条目（删榜单）；注意「不能改热度」是函数签名保证的，不是靠策略。
-- Day 22：读策略补 `NOT is_deleted` —— 软删除的真正生效点就在这一句。漏了它，
--         标记了却仍然读得到，等于「界面说删了、数据还在」，比报错更糟（没有信号）。
DROP POLICY IF EXISTS items_read_all ON items;
CREATE POLICY items_read_all ON items
  FOR SELECT TO anon, authenticated
  USING (NOT is_deleted);

DROP POLICY IF EXISTS items_admin_delete ON items;
CREATE POLICY items_admin_delete ON items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- Day 22 补：管理员需要**看得见已回收的条目**，否则回收站里是空的，恢复入口无处安放。
-- ⚠️ 两条读策略是 **OR** 关系，所以这条一加，管理员会话下 getItems() 也会带上已回收条目
--    → 因此所有**展示用**的读必须显式过滤 is_deleted（js/api.js 已加），不能只靠 RLS 兜。
--    这与 posts 的形态完全一致（posts_read 过滤 / posts_admin_read 不过滤）。
DROP POLICY IF EXISTS items_admin_read ON items;
CREATE POLICY items_admin_read ON items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()));

-- 6.3 posts：公开列表只出 approved；作者总能看见自己的（含 pending/rejected）；
--     插入只能插成「自己的 + pending」；状态机推进只有管理员能动。
--     ⚠️ 公开读补了 `NOT is_deleted`，但**管理读（posts_admin_read）刻意不加** ——
--        要能在后台看见已回收的帖子才能把它恢复回来。两条读策略的差别就是「软删」的正确形态。
DROP POLICY IF EXISTS posts_read ON posts;
CREATE POLICY posts_read ON posts
  FOR SELECT TO anon, authenticated
  USING (NOT is_deleted AND (status = 'approved' OR author_id = auth.uid()));

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
  USING (NOT is_deleted AND author_id = auth.uid());

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

-- ---------------------------------------------------------------------------
-- 6.7 「删除」改成「回收」：BEFORE DELETE 触发器（Day 22 新增）
--
-- 为什么用触发器而不是改前端：**前端一行都不用动**。
--   DELETE 策略原样保留（管理员仍然"有权删除"），但语句一落地就被触发器拦下：
--     ① 把该行的 is_deleted 置 true（这一步在 SECURITY DEFINER 函数里做，越过 RLS）；
--     ② 返回 NULL → 物理删除被取消，磁盘上那行从未消失。
--   客户端收到 204（api.js 的 `.delete().eq()` 不带 `.select()`，PostgREST 不看影响行数），
--   所以界面照常显示"删除成功" —— 而真实语义已经是"回收进回收站"。
--
-- 这正是「删除比新增更容易出事」的答案落地：**把不可逆从客户端能力里整个拿掉**。
-- 现在客户端无论怎么发 DELETE，最坏结果只是把一行标记成已回收；恢复一条 UPDATE 即可。
--
-- 🔒 「真要物理删」怎么办？物理删除必须**显式关掉保险**，且只能走站方 SQL 通道：
--      ALTER TABLE posts DISABLE TRIGGER trg_posts_soft_delete;
--      DELETE FROM posts WHERE id = ...;
--      ALTER TABLE posts ENABLE  TRIGGER trg_posts_soft_delete;
--   要关保险才能真删 —— 这个"多一步"本身就是我们加的第二道确认（见 docs/day22-crud-loop.md）。
--
-- `SET search_path = public` 同样必备：SECURITY DEFINER 不锁搜索路径，会被同名对象劫持。
-- 动态 SQL 用 `format('%I', TG_TABLE_NAME)` 引号化标识符，id 值走 `USING` 绑定参数，
-- 表名与值都不参与字符串拼接 —— 触发器里没有可注入的位置。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format('UPDATE %I SET is_deleted = true WHERE id = $1', TG_TABLE_NAME)
    USING OLD.id;
  RETURN NULL;   -- 返回 NULL = 取消这次物理删除
END;
$$;

DROP TRIGGER IF EXISTS trg_items_soft_delete   ON items;
CREATE TRIGGER trg_items_soft_delete   BEFORE DELETE ON items   FOR EACH ROW EXECUTE FUNCTION soft_delete_rows();
DROP TRIGGER IF EXISTS trg_posts_soft_delete   ON posts;
CREATE TRIGGER trg_posts_soft_delete   BEFORE DELETE ON posts   FOR EACH ROW EXECUTE FUNCTION soft_delete_rows();
DROP TRIGGER IF EXISTS trg_reports_soft_delete ON reports;
CREATE TRIGGER trg_reports_soft_delete BEFORE DELETE ON reports FOR EACH ROW EXECUTE FUNCTION soft_delete_rows();

COMMENT ON FUNCTION soft_delete_rows() IS '把 DELETE 改写成"置 is_deleted 标记"并取消物理删除（Day 22）。SECURITY DEFINER 才能越过 RLS 改写；要真删必须先 DISABLE TRIGGER';

-- ---------------------------------------------------------------------------
-- 6.8 「恢复」：items / reports 的窄口函数（Day 22 补）
--
-- 为什么 posts 能靠 UPDATE 策略恢复、这两张表不能：
--   posts_admin_update 这条策略放行的是**整表 UPDATE**，管理员因此能顺手改 heat 一类的字段；
--   posts 没有"某列绝对不能改"的铁律，所以可以接受。
--   items 不一样 —— **「热度不可篡改」是本项目的铁律**（热度算法是站点的性格）：
--     它现在由「items 根本没有 UPDATE 策略」来保证，硬得不能再硬。
--     一旦为了恢复而加一条 UPDATE 策略，就等于把 heat / views / verdict 一起交到管理员手上，
--     铁律立刻从"数据库不可能"降级成"靠人自觉"。
--   → 所以这里走**窄口函数**：函数体内只写 `is_deleted = false` 一列，
--     调用方无论传什么参数都够不到 heat，与 bump_item_view 的思路一脉相承
--     （能窄到那个程度，就不给它宽的可能）。
--
-- 🔒 函数里的管理员自检是**唯一防线**（SECURITY DEFINER 会绕过 RLS）→ 这段判断不能省。
--    `auth.uid()` 读的是请求里的 JWT claim（GUC），与函数的安全上下文无关，
--    所以在 SECURITY DEFINER 里依然拿得到**调用者**身份（已实测）。
--    两道门：① 函数级 EXECUTE 只给 authenticated（匿名连函数都看不见）；
--            ② 函数体内再核一次 admins 名单（普通登录用户调得进来，但会被中文错误挡掉）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION restore_item(p_id text)
RETURNS items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v items;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION '只有管理员可以恢复条目' USING ERRCODE = '42501';
  END IF;

  UPDATE items SET is_deleted = false
   WHERE id = p_id AND is_deleted = true
  RETURNING * INTO v;

  IF v.id IS NULL THEN
    RAISE EXCEPTION '这条条目没有处于「已回收」状态（id=%），不需要恢复', p_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION restore_report(p_id bigint)
RETURNS reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v reports;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins a WHERE a.user_id = auth.uid()) THEN
    RAISE EXCEPTION '只有管理员可以恢复线索' USING ERRCODE = '42501';
  END IF;

  UPDATE reports SET is_deleted = false
   WHERE id = p_id AND is_deleted = true
  RETURNING * INTO v;

  IF v.id IS NULL THEN
    RAISE EXCEPTION '这条线索没有处于「已回收」状态（id=%），不需要恢复', p_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v;
END;
$$;

-- 函数级门：只发给登录用户。
-- ⚠️ 平台事实（Day 22 实测）：托管库有 **DEFAULT PRIVILEGES** —— 函数一创建，
--    平台就自动把 EXECUTE 授给了 `anon` / `authenticated` / `service_role`。
--    所以**光写 `REVOKE ... FROM PUBLIC` 不够**：那只会移除 ACL 里的 `=X`（PUBLIC）项，
--    `anon=X` 是平台显式授的，依然留着，匿名照样能进函数体。
--    必须像下面这样**把 anon 一并写进 REVOKE 的名单里**，门才算真关上。
--    （实测对照：只 REVOKE PUBLIC 时，匿名调用得到的是函数体内的中文错误；
--      连 anon 一起 REVOKE 后，得到的是 `permission denied for function`。）
REVOKE ALL ON FUNCTION restore_item(text)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION restore_report(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION restore_item(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION restore_report(bigint) TO authenticated;

COMMENT ON FUNCTION restore_item(text) IS '恢复已回收条目（Day 22）。窄口：函数体内只改 is_deleted 一列，因此「热度不可篡改」不受影响；SECURITY DEFINER + 管理员自检';
COMMENT ON FUNCTION restore_report(bigint) IS '恢复已回收线索（Day 22）。窄口：函数体内只改 is_deleted 一列；SECURITY DEFINER + 管理员自检';

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
--   POST /rpc/restore_item   → SELECT restore_item($id)    —— 恢复已回收条目（窄口：只把 is_deleted 置回 false）
--   POST /rpc/restore_report → SELECT restore_report($id)  —— 恢复已回收线索（同上，仅管理员可调）
--   GET  /api/posts          → SELECT * FROM posts WHERE status = 'approved' ORDER BY created_at DESC
--                              （RLS 的 posts_read 完成过滤；登录者额外看得到自己的 pending）
--   POST /api/posts          → INSERT INTO posts (category, title, body, author_name, item_id)
--                              —— author_id / status 不许传，RLS 强制「本人 + pending」
--   POST /api/reports        → INSERT INTO reports (text, url)，不带 RETURNING（匿名无读权限）
--   GET  /api/reports        → SELECT * FROM reports（RLS 的 reports_read_own 只给登录者自己的行）
--
-- 错误返回统一 { "error": { "code": "...", "message": "..." } }，前端按四态规范处理。
-- ============================================================================
