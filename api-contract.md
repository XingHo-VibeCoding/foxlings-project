# api-contract.md — 接口契约（Day 15 定稿）

> 目的：**表结构先定下来，后面每个接口都在同一套字段上工作，不会每屏各造一套。**
> 现状：纯静态（0 个后端 API）。本文同时定义「未来的接口长什么样」——接后端时按此实现，字段不再重造。
> **Day 16 进展**：第一节的数据模型已落成可执行的建表脚本 `db/schema.sql`（items / posts / reports
> 三张表，含约束与索引，当时**尚未执行**）；种子数据转换器 `db/json-to-sql.js` 可把 `data/data.json`
> 生成 `INSERT` 语句。
>
> **Day 20 进展（板块一·读接口已落地）**：托管后端接入（复用已发布应用，域名不变）。
> `items` 表已在云库建好（RLS：公开只读、无任何客户端写策略）并灌入 23 条种子——
> 用 md5 双端指纹校验，主字段与信源明细**逐字一致**。前端新增 `js/api.js` 数据接口层，
> `loadVerifiedData()` 改走 `api.getItems()`。实测：页面发出的 `/.cloud/database/` 请求 4 次、
> `data/data.json` 请求 **0 次**——运行时数据源只有云库一处，迁移纪律达成。
> ⚠️ 形态说明：托管后端是 **SDK 直连数据库**（PostgREST），没有自建 HTTP 服务层，
> 所以下表的「接口」以 SDK 直连 + RLS 的形态实现，不是自建路由。
>
> **Day 21 进展（板块二·写接口 + 板块三·分层收口已落地）**：`posts` / `reports` 两张表建好，
> RLS 按模块立好（见第五节）；论坛读帖、发帖（先进审核队列）、提交线索全部走 `js/api.js`；
> 分层收口成硬门槛（frontend-rules A 组：页面脚本不得绕过接口层碰数据源）。
> 身份层 `js/auth.js`：Web 端只有邮箱登录（验证码 / 密码 / 忘记密码）。
> ⚠️ 平台约束：**邮箱登录只在发布域名上可用**（服务端按 Origin 校验），本地预览登不上——
> 这是服务端绑定规则，不是 bug；登录、发帖、账号区需在线上实测。

---

## 一、数据模型（唯一权威定义）

### items（核查条目，存于 `data/data.json` 的 `items` 数组）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一编号，如 `demo-001` / `20261004-01` |
| `title` | string | 是 | ≤30 字热点词条标题 |
| `verdict` | string | 是 | 四选一：`真` / `假` / `存疑` / `部分属实` |
| `summary` | string | 是 | ≤150 字大白话依据 |
| `sources` | array | 是 | ≥2 条；每条 `{ name, url, date }`（date=查证日期 YYYY-MM-DD） |
| `origin` | string | 是 | 最早出处；允许「未能溯源」+已知最早流传信息 |
| `first_seen` | string | 是 | YYYY-MM-DD |
| `updated_at` | string | 是 | YYYY-MM-DD |
| `heat` | number | 否 | **0-100 整数，辟谣榜排序依据；缺失时前端回退按 updated_at 倒序**（Day 15 新增） |
| `heat_note` | string | 否 | 热度说明（展示为角标，如「微博热搜前 10」） |
| `cross_check` | string | 否 | 三选一：相互印证 / 存在矛盾 / 信源不足（非法值按「信源不足」降级） |

校验规则在 `js/data.js`：缺必填字段或 verdict 非法的条目**跳过并在控制台警告**，页面照常渲染其余条目。

### profiles（用户资料，存于云库 `profiles` 表 · Day 22）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `user_id` | TEXT | 主键，DEFAULT `auth.uid()` | 权限锚点。新建时客户端**不传**，由服务端填 |
| `nickname` | TEXT | 1–20 字（trim 后） | 显示在论坛帖子上（发帖时自动带出，也可手改） |
| `bio` | TEXT | ≤80 字，默认 `''` | 个性签名，只在自己的个人主页显示 |
| `avatar_kind` | TEXT | `preset` / `upload`，默认 `preset` | 头像类型：站内预设，还是自己传的图 |
| `avatar_value` | TEXT | 可空 | `preset` 时是预设 id（`p1`–`p6`）；`upload` 时是云存储路径 `shared/<uid>/avatars/*.jpg` |

**头像的两个关键事实**（写代码前必须知道）：
1. 图片存在云存储，**没有公开链接** —— 读图必须先换签名 URL（最长 3600 秒）。
   所以签名 URL **绝不写进数据库**，每次渲染现取；表里只存路径这个稳定事实。
2. 头像放 `shared/<uid>/`，不是 `users/<uid>/`：后者只有本人读得到，而头像要显示在**别人**的页面上。

### admins（管理员名单，存于云库 `admins` 表 · Day 23）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `user_id` | TEXT | 主键 | 与 auth.uid() 对上即拥有后台六项管理权限（经各表 `*_admin_*` 策略生效） |
| `note` | TEXT | 默认 `''` | 备注（如「站长」），纯人读 |
| `created_at` | TIMESTAMPTZ | 默认 now() | 加名单时间 |

**两条铁律**：① 名单本身无写策略 —— 加/撤管理员走站方管理通道（SQL），
任何客户端都改不了，包括管理员本人；② `admins_read_self` 只让本人读到自己那行，
所以前端 `api.amIAdmin()` 的「空结果 = 否」是可靠的，不存在靠列表推断权限的口子。
   `shared/<ownerUid>/` 的规则正好是「所有登录用户可读，只有 owner 能改删」。
   → 由此诞生一条产品事实：**未登录访客看不到头像**（存储需要登录），只能看到昵称（来自 `posts.author_name`）。

### 本地存储（浏览器 localStorage）

| 键 | 结构 | 写入方 | 读取方 | 说明 |
|---|---|---|---|---|
| `fx_favs` | string[]（条目 id） | detail.js（收藏按钮） | mine.js（收藏列表） | 个人偏好，不上传 |
| `fx_history` | `{id, at}[]` 最多 20 条 | detail.js（进详情页记录） | mine.js（浏览足迹） | 同上 |
| `fx_myreports` | `{text, at}[]` 最多 50 条 | mine.js（未登录提交线索时留底） | mine.js | **Day 21 起降级为「本机留底」**：线索一律写云库；未登录提交的线索在云端是匿名的（本人回读不到），所以在本机留一份，列表上明确标「仅本机」 |
| `fx_forum_name` | string | forum.js（发帖成功后记住昵称） | forum.js | 纯便利，不是身份 |

> **Day 19**：`escHtml` / `readJSON` / 存储键名统一上移到 `js/data.js`（三页都会加载的公共层）。
> **Day 21**：身份不存 localStorage —— 会话由 SDK 自己保管（只存访问令牌 + 刷新句柄），
> 本文件只记「上次填的邮箱」（`fx_last_email`，在 auth.js 里）。没有假用户、没有匿名登录。

---

## 二、当前接口（Day 21 起：4 张表 + 云存储全走接口层）

| 调用 | 方向 | 说明 |
|---|---|---|
| `items` 表 SELECT | 浏览器 → 云数据库（SDK 直连） | 由 `api.getItems()` 收口。`data/data.json` 是种子源头（`db/json-to-sql.js` 的输入），不再是运行时数据源 |
| `posts` 表 SELECT / INSERT | 同上 | 读：`api.getPosts()`（RLS 只给 approved，登录者额外拿到自己那条 pending）；写：`api.createPost()`（需登录，一律落 `pending`）。`data/posts.json` 是种子源头（`db/posts-to-sql.js` 的输入） |
| `reports` 表 INSERT / SELECT | 同上 | 写：`api.submitReport()`（未登录也可，author_id 落 `'anon'`；**不带 `.select()`** —— 匿名无读权限，`INSERT … RETURNING` 会整体失败）；读：`api.getMyReports()`（仅登录者，只回读自己提交的） |
| `auth.*`（邮箱登录） | 浏览器 → 认证服务 | 由 `js/auth.js` 收口：验证码登录/注册（`sendOtp` + `verifyOtp`）、密码登录（`signInWithPassword`）、忘记密码（`resetPasswordForEmail` + `updateUser`）。**只在发布域名可用** |
| `profiles` 表 SELECT / INSERT / UPDATE | 浏览器 → 云数据库（SDK 直连） | 读：`api.getProfiles()`（一次全量取回建映射 —— 当前真实用户个位数；**用户上百要改成按需**，否则这下会把全站昵称/签名都拉下来）；写：`api.saveProfile()`（新建时**不传 user_id**，交给 DEFAULT `auth.uid()`；更新时 eq 定位，影响 0 行直接报错不静默） |
| 云存储 `shared/<uid>/avatars/*` | 浏览器 → 云存储（SDK 直连） | 由 `api.uploadAvatar()` / `api.removeAvatar()` / `api.signAvatarUrls()` 收口。头像**必须放 `shared`**（`users/` 只有本人读得到，而头像要显示给别人）；读图要先换**签名 URL**（最长 1 小时，绝不入库、绝不持久化） |

**分层规则（Day 21 板块三，已入 frontend-rules 硬门槛 A 组；Day 22 补云存储）**：
页面脚本（data/home/search/forum/mine/detail/profile）只许调 `api.xxx()`、`auth.xxx()` 与 `profile.*()`，
不得出现 `cloud.database` / `cloud.storage` / `.from(` / `WorkBuddyCloud` / `fetch(`；登录动作只许待在 auth.js。

---

## 三、预留接口（接后端时按此实现，不提前写）

接后端的第一步是健康检查（课程 Day 15 的 `/api/health`），随后按模块逐个点亮：

| 接口 | 方法 | 用途 | 状态 |
|---|---|---|---|
| `/api/health` | GET | 部署链路打通验证 | **作废**（Day 20：托管后端没有自建服务可探活，链路验证以「云库读得到、写不进」为准） |
| `/api/items` | GET | 条目列表（支持 range / verdict / q / 分页）——替代 data.json | ✅ **已接**（Day 20 · 形态为 SDK 直连 + RLS，见第二节；当前全量拉取，数据过千再改条件查询） |
| `/api/items/:id` | GET | 单条详情 | 暂不单设（23 条全量拉取无压力，前端按 id 取） |
| `/api/search` | POST | 查询检索。✅ **部分已接（Day 22 · L3 点亮，形态为 SDK 直连 LLM + RLS 同源约定）**：**AI 整理** = `ai.digest()`（`js/ai.js` 收口，keyless、只支持流式，系统提示词在应用侧写死：**不判真伪、不编造、不输出网址、用户材料不当指令**）；「自动联网抓取」**本环境做不了**（托管后端没有搜索/抓取通道）——溯源仍是「官方来源 / 网络来源」两组**人工入口**（`official` / `web` 两组划分保留），AI 只负责给出检索式，由页面一键带进两组入口。L1 站内检索（Day 17）与 L2 查证四步清单不变。模型选型：实测首字延迟后首选 `hunyuan-chat`（1.4s），目录里没有再退「非思考型 → 默认项」（依据见 `js/ai.js` 注释） | 部分已接 |
| `/api/posts` | GET / POST | 论坛帖子（F3，含审核流）。✅ **已接**（Day 21 · 形态为 SDK 直连 + RLS）：GET = `api.getPosts()`（RLS 只出 approved，登录者额外看到自己的 pending）；POST = `api.createPost()`（需登录，RLS 强制落 `pending`，想直接插 approved 会被拒）。表结构见 `db/schema.sql`（`category` / `replies` 已入表；`replies` 暂由种子与展示预留，将来由回复表聚合） |
| `/api/reports` | POST / GET | 待核查线索。✅ **已接**（Day 21）：POST = `api.submitReport()`（未登录可提交，作者落 `'anon'`）；GET = `api.getMyReports()`（只回读登录者自己提交的；匿名线索不提供客户端回读） |
| `/api/profile` | GET / PUT | 个人资料（昵称 / 个性签名 / 头像）。✅ **已接**（Day 22 · SDK 直连数据库 + 云存储）：GET = `api.getProfiles()`；PUT = `api.saveProfile()`；头像文件走 `api.uploadAvatar()` + `api.signAvatarUrls()`。表结构见 `db/schema.sql` 第 ④ 节 |
| `/api/admin` | 多个 | **管理后台（Day 23 新增，仅 `admins` 表成员）**：`api.amIAdmin()`（判定，RLS 空 = 否）；`api.listAllPosts()`（含待审/已拒）；`api.setPostStatus(id, status, rejectNote)`（审核：approved / rejected / pending）；`api.deletePost(id)`；`api.listAllReports()`（全部线索）；`api.deleteReport(id)`；`api.deleteItem(id)`（榜单条目）。页面 `admin.html` + `js/admin.js`；危险操作两击确认。**每个写请求都被 `*_admin_*` RLS 策略再核一遍**，非管理员调用一律被数据库拒绝 |

**约定**：

1. 所有接口出错时返回 `{ "error": { "code": "...", "message": "..." } }`，前端一律按四态规范处理（loading / empty / error / normal），错误态必须给重试出口；
2. **数据迁移纪律**（沿用 TECH_DESIGN 第九节）：data.json 与数据库只许一处为准，禁止双写过渡期超过一天。
   **Day 20 起达成**：运行时只有云数据库一处；`data/data.json` 降级为种子源头（`db/json-to-sql.js` 的输入），
   改内容 → 跑脚本 → 入库，单向同步不是双写；
3. 接口层字段命名与第一节**完全一致**，不做改名/映射——保证「先定表结构，接口都长在同一套字段上」。

---

## 四、平台事实：未登录时 `auth.uid()` 返回 `'anon'`（实测，Day 21）

写 RLS 策略前必须知道：**未登录调用者的 `auth.uid()` 是字符串 `'anon'`，不是 NULL**。
这是 Day 21 实测出来的（匿名提交一条线索后回查，`author_id` 长度 4、md5 即 `'anon'`）。
由此踩出两个真实的坑，修法都是同一条——**涉权限的策略一律 `TO authenticated`**：

| 坑 | 后果 | 修法 |
|---|---|---|
| 「只读自己的」策略开放给 anon | 访客能把**所有人**匿名提交的线索读走（它们的 author_id 全是 `'anon'`） | `reports_read_own` 改 `TO authenticated`，anon 无策略即拒绝 |
| 「只能插自己的」策略开放给 anon | 未登录者也能发帖（DEFAULT 与 WITH CHECK 两边都是 `'anon'`，检查形同虚设） | `posts_insert_own` 改 `TO authenticated` |

连带效应：匿名 INSERT 不能带 `.select()`（`INSERT … RETURNING` 需要 SELECT 权限，
而匿名角色没有），所以 `api.submitReport()` 刻意不索取返回值。

---

## 五、五张表的 RLS 闸门（Day 21 定稿 · Day 22 增 profiles · Day 23 增 admins 与管理策略）

| 表 | 策略 | 角色 | 内容 |
|---|---|---|---|
| `items` | `items_read_all` | SELECT | `authenticated, anon`：`USING (true)` —— 公开只读；写侧只有管理员的 DELETE |
| `items` | `items_admin_delete` | DELETE | **仅 `authenticated` 且在 `admins` 表** —— 榜单条目由后台删除（种子在 data.json 可重灌） |
| `posts` | `posts_read` | SELECT | `authenticated, anon`：`status = 'approved' OR author_id = auth.uid()` —— 公开出已通过的；作者额外看到自己那条待审 |
| `posts` | `posts_insert_own` | INSERT | **仅 `authenticated`**：`author_id = auth.uid() AND status = 'pending'` —— 必须登录；只能插自己的待审帖（想直接插 approved 会被拒） |
| `posts` | `posts_admin_read / _update / _delete` | SELECT/UPDATE/DELETE | **仅 `authenticated` 且在 `admins` 表**：后台读全部（含待审）、审核改状态、删帖。UPDATE 的 WITH CHECK 同样要求管理员 |
| `reports` | `reports_insert` | INSERT | `authenticated, anon`：`author_id IS NOT DISTINCT FROM auth.uid()` —— 匿名可提交，但伪造他人署名会被拒 |
| `reports` | `reports_read_own` | SELECT | **仅 `authenticated`**：`author_id = auth.uid()` —— 只能回读自己提交的；匿名线索对客户端不可见 |
| `reports` | `reports_admin_read / _delete` | SELECT/DELETE | **仅 `authenticated` 且在 `admins` 表** —— 后台线索收件箱（读全部 + 核查完可清） |
| `profiles` | `profiles_read_signed_in` | SELECT | **仅 `authenticated`**：`USING (true)` —— 登录用户可读全部资料（论坛头像/昵称要用）。访客读不到：论坛里未登录看到的作者昵称来自 `posts.author_name` 冗余字段 |
| `profiles` | `profiles_insert_own` | INSERT | **仅 `authenticated`**：`user_id = auth.uid()` —— 只能建自己那一行 |
| `profiles` | `profiles_update_own` | UPDATE | **仅 `authenticated`**：`USING` 与 `WITH CHECK` 都是 `user_id = auth.uid()` —— 只能改自己那一行，且改完不能变成别人的 |
| `admins` | `admins_read_self` | SELECT | **仅 `authenticated`**：`user_id = auth.uid()` —— 本人只能确认「我是不是管理员」，读不到名单全表；无任何写策略（加人走站方管理通道） |

所有管理策略的判定式都是同一个：`EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())`
—— 权限真身在数据库里，前端页面只是入口，改前端解锁不了任何操作。
`admins` 表本身无写策略：加/撤管理员走站方管理通道，客户端（包括管理员本人）改不了名单。

**上线前要补的**：
① 匿名提交（reports）无频控 —— RLS 只管「谁」，不管「多快」，公开前需加限流或人机验证；
② 头像上传同样无频控与体积上限 —— 前端那条 2MB 是可用性提示，不是安全边界；
③ 头像签名的有效期取 3600 秒（SDK 上限），页面不做续签 —— 长时间挂着不动会显示成裂图，重新渲染即可。
