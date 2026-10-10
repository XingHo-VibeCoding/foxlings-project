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
>
> **Day 22 进展（单条记录的「改」与「删」补齐 + 防呆）**：`api.setPostStatus()`（PATCH：审核状态机）
> 与 `api.deletePost()` / `api.deleteReport()` / `api.deleteItem()`（DELETE）收口完成。
> 三张表的删除全部改为**软删除**（`is_deleted` 标记 + BEFORE DELETE 触发器，见第五节），
> 客户端从此**不具备物理删除能力**；同时给改/删补上 **id 存在性校验**（不存在的 id 返回明确中文错误，
> 不再静默 204）与前端**两击确认**。这三件事合称「防呆三件套」，见第六节。
>
> **Day 24 进展（撤软删除 + 站方公告栏）**：
> ① **删除回到「真删」**。Day 22 那一整套软删除（`is_deleted` 列 + `soft_delete_rows()` 触发器
> + `restore_item` / `restore_report` 函数 + 回收站读策略 `items_admin_read`）**全部撤除** ——
> 站方的产品决定是「没必要留数据，堆着也没用」。于是 `api.deleteXxx()` 的 DELETE **真的删行**，
> 并且统一带 `.delete().select()`：一次请求同时完成「删掉」与「拿到删掉的那一行」。
> 「不可逆」这件事于是回到它该在的地方 —— **按钮上的两击确认 + 「删除不可恢复」的明说**，
> 而不是在数据库里偷偷留副本。决定与代价见第七节。
> ② **新增站方公告栏**：`announcements` 表（公开可读、只有 `admins` 名单里的人能写）
> + 接口 `api.listAnnouncements()` / `listAllAnnouncements()` / `createAnnouncement()` /
> `updateAnnouncement()` / `deleteAnnouncement()`；论坛页顶部轮播展示、管理后台负责发布。
> **社区规则从此是数据、不是代码** —— 站方在后台改一次，全站立即生效，不用改前端、不用重新发版。

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
| `heat` | number | 否 | **0-100 整数，编辑填的「人工热度」；缺失/非法时前端回退 0**（Day 15 新增；Day 23 起不再单独排序，见下面的热度分公式） |
| `heat_note` | string | 否 | 热度说明（展示为角标，如「微博热搜前 10」） |
| `views` | number | 否 | **真实浏览量：详情页每被一台设备打开一次 +1**（Day 23 新增）。**只读字段** —— 客户端只能经 `bump_item_view()` 说「+1」，不能指定数值（见第二节） |
| `cross_check` | string | 否 | 三选一：相互印证 / 存在矛盾 / 信源不足（非法值按「信源不足」降级） |

**辟谣榜热度分（Day 23 定稿，实现在 `js/home.js`）**：

```
score = (heat + views) × 0.5 ^ (距 updated_at 的天数 / 14)
```

- 人工 `heat` 当**初始票数** —— 开站时 `views` 全是 0，只按浏览排会退化成时间序，
  编辑的判断仍是冷启动阶段最可靠的信号；
- 真实 `views` 叠在同一把标尺上，**一次浏览 = 一点热度**，于是「大家实际关心什么」
  能一点点顶掉「编辑觉得什么重要」；
- 时间按**半衰期**衰减（14 天减半）。常量 `HEAT_HALF_LIFE_DAYS` 在 `home.js`，
  改它等于改榜单性格：调小更偏「最新」，调大更偏「最热」；
- ⚠️ 公式是**拿站内 23 条真数据跑过才定的**：`(小时+2)^1.5` 那种 HN 式写法下，
  4 天的差距就相当于 35 次浏览，结果 22/23 条纯粹按日期排、浏览数完全扳不动。
  思路没错，陡度选错了 —— 所以这里记下来，免得下次又凭直觉挑指数。

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

### announcements（站方公告，存于云库 `announcements` 表 · Day 24）

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | BIGINT | 主键，自增 | 公告序号 |
| `title` | TEXT | trim 后 2–60 字 | 标题，在论坛公告栏里显示为一行小标题 |
| `body` | TEXT | trim 后 1–2000 字 | 正文。**换行会原样显示**（`white-space: pre-line`）—— 规则本来就是一条一行写的 |
| `is_pinned` | BOOLEAN | 默认 `true` | **是否公布**。`false` = 先写好放着、前台看不到。读策略是 `USING (is_pinned)`，所以匿名**真的读不到**，不是靠前端过滤 |
| `sort_order` | INTEGER | 默认 0 | 排序权重，**大的在前**；同权重时新的在前。公告栏按这个顺序轮播 |
| `author_id` | TEXT | 默认 `auth.uid()` | 发布人；种子行是 `'seed'`。**不参与权限判断**（权限认的是 `admins` 表） |
| `created_at` / `updated_at` | TIMESTAMPTZ | 默认 now() | 创建 / 最后修改时间 |

**为什么不复用 `posts`**（Day 24 的取舍）：公告只有站方能发、长期挂着、显示在论坛页顶部常驻轮播；
帖子任何登录用户都能发、会沉下去、显示在下面的列表里。硬塞进 `posts` 的话，
论坛列表、审核队列、前端筛选每一处都要多加一个「这条是公告、不算帖子」的判断 ——
一处漏了，公告就混进帖子流了。单独一张表，代价只是多两个接口。

### 本地存储（浏览器 localStorage）

| 键 | 结构 | 写入方 | 读取方 | 说明 |
|---|---|---|---|---|
| `fx_favs` | string[]（条目 id） | detail.js（收藏按钮） | mine.js（收藏列表） | 个人偏好，不上传 |
| `fx_history` | `{id, at}[]` 最多 20 条 | detail.js（进详情页记录） | mine.js（浏览足迹） | 同上 |
| `fx_myreports` | `{text, at}[]` 最多 50 条 | mine.js（未登录提交线索时留底） | mine.js | **Day 21 起降级为「本机留底」**：线索一律写云库；未登录提交的线索在云端是匿名的（本人回读不到），所以在本机留一份，列表上明确标「仅本机」 |
| `fx_forum_name` | string | forum.js（发帖成功后记住昵称） | forum.js | 纯便利，不是身份 |
| `fx_viewed` | string[]（条目 id） | detail.js（浏览上报成功时） | detail.js | **Day 23 新增**：记「这台设备已经给哪几条计过浏览」。浏览量要读成「多少人关心这条」，不是「页面被刷了几次」，否则按住 F5 就能把一条顶上榜。**代价说清楚**：换浏览器 / 清缓存 / 无痕会重复计一次，当前规模（个位数）接受 |

> **Day 19**：`escHtml` / `readJSON` / 存储键名统一上移到 `js/data.js`（三页都会加载的公共层）。
> **Day 21**：身份不存 localStorage —— 会话由 SDK 自己保管（只存访问令牌 + 刷新句柄），
> 本文件只记「上次填的邮箱」（`fx_last_email`，在 auth.js 里）。没有假用户、没有匿名登录。

---

## 二、当前接口（Day 22 起：5 张表 + 云存储 + 数据库函数全走接口层）

| 调用 | 方向 | 说明 |
|---|---|---|
| `items` 表 SELECT | 浏览器 → 云数据库（SDK 直连） | 由 `api.getItems()` 收口。`data/data.json` 是种子源头（`db/json-to-sql.js` 的输入），不再是运行时数据源 |
| `posts` 表 SELECT / INSERT | 同上 | 读：`api.getPosts()`（RLS 只给 approved，登录者额外拿到自己那条 pending）；写：`api.createPost()`（需登录，一律落 `pending`）。`data/posts.json` 是种子源头（`db/posts-to-sql.js` 的输入） |
| `reports` 表 INSERT / SELECT | 同上 | 写：`api.submitReport()`（未登录也可，author_id 落 `'anon'`；**不带 `.select()`** —— 匿名无读权限，`INSERT … RETURNING` 会整体失败）；读：`api.getMyReports()`（仅登录者，只回读自己提交的） |
| `auth.*`（邮箱登录） | 浏览器 → 认证服务 | 由 `js/auth.js` 收口：验证码登录/注册（`sendOtp` + `verifyOtp`）、密码登录（`signInWithPassword`）、忘记密码（`resetPasswordForEmail` + `updateUser`）。**只在发布域名可用** |
| `profiles` 表 SELECT / INSERT / UPDATE | 浏览器 → 云数据库（SDK 直连） | 读：`api.getProfiles()`（一次全量取回建映射 —— 当前真实用户个位数；**用户上百要改成按需**，否则这下会把全站昵称/签名都拉下来）；写：`api.saveProfile()`（新建时**不传 user_id**，交给 DEFAULT `auth.uid()`；更新时 eq 定位，影响 0 行直接报错不静默） |
| `posts` / `reports` / `items` 表单条的 UPDATE / DELETE | 浏览器 → 云数据库（SDK 直连） | **Day 22 新增 · Day 24 改口径**。改 = `api.setPostStatus(id, status, rejectNote)`（审核状态机，仅管理员，RLS 再核一遍）——改前先 SELECT 确认这条在，查无此 id 抛中文错误，不静默、不崩；删 = `api.deletePost(id)` / `api.deleteReport(id)` / `api.deleteItem(id)` —— **真删**（Day 24 起没有回收站），统一带 `.delete().select()`：删掉的那一行作为返回值回来，拿不到就说明 id 不存在或权限不够，当场抛中文错（见第六节） |
| 云存储 `shared/<uid>/avatars/*` | 浏览器 → 云存储（SDK 直连） | 由 `api.uploadAvatar()` / `api.removeAvatar()` / `api.signAvatarUrls()` 收口。头像**必须放 `shared`**（`users/` 只有本人读得到，而头像要显示给别人）；读图要先换**签名 URL**（最长 1 小时，绝不入库、绝不持久化） |
| `bump_item_view` 函数（**rpc**） | 浏览器 → 云数据库（SDK 直连数据库函数） | 由 `api.bumpItemView(id)` 收口，**Day 23 新增**。items 表没有任何写策略（客户端连 UPDATE 权限都没有），所以浏览量不走表、走函数：`bump_item_view(p_id)` 是 SECURITY DEFINER，以定义者身份在服务端**原子自增**，越过只读闸门。参数只有条目 id、**没有数字** —— 调用者能表达的只有「给这条 +1」，于是「管理员也不能手动调序」是**函数签名**保证的，不是靠自觉。触发点是详情页打开，前端按「同设备同条目一次」去重 |
| `announcements` 表 SELECT / INSERT / UPDATE / DELETE | 浏览器 → 云数据库（SDK 直连） | **Day 24 新增**。读：`api.listAnnouncements()`（**展示口径**，只出 `is_pinned = true` 的）/ `api.listAllAnnouncements()`（**后台口径**，含「先写好、暂不公布」的稿子）；写：`api.createAnnouncement()` / `api.updateAnnouncement()` / `api.deleteAnnouncement()`（仅 `admins` 名单成员，由 `announcements_admin_write` 放行）。**公告是数据不是代码** —— 站方在后台写社区规则，改一次全站生效，不用改前端也不用重新发版 |

**分层规则（Day 21 板块三，已入 frontend-rules 硬门槛 A 组；Day 22 补云存储；Day 23 补 rpc）**：
页面脚本（data/home/search/forum/mine/detail/profile/admin）只许调 `api.xxx()`、`auth.xxx()` 与 `profile.*()`，
不得出现 `cloud.database` / `cloud.storage` / `.from(` / `rpc(` / `WorkBuddyCloud` / `fetch(`；登录动作只许待在 auth.js。

---

## 三、预留接口（接后端时按此实现，不提前写）

接后端的第一步是健康检查（课程 Day 15 的 `/api/health`），随后按模块逐个点亮：

| 接口 | 方法 | 用途 | 状态 |
|---|---|---|---|
| `/api/health` | GET | 部署链路打通验证 | **作废**（Day 20：托管后端没有自建服务可探活，链路验证以「云库读得到、写不进」为准） |
| `/api/items` | GET | 条目列表（支持 range / verdict / q / 分页）——替代 data.json | ✅ **已接**（Day 20 · 形态为 SDK 直连 + RLS，见第二节；当前全量拉取，数据过千再改条件查询） |
| `/api/items/:id` | GET | 单条详情 | 暂不单设（23 条全量拉取无压力，前端按 id 取） |
| `/api/items/:id/view` | POST | 浏览计数 +1 | ✅ **已接**（Day 23 · 形态为 SDK 直连数据库函数）：`api.bumpItemView(id)` → `bump_item_view(p_id)`。刻意做成**只能 +1 的窄接口** —— 没有「设成 N」这种形态，所以「谁能改热度」这个权限问题根本不存在，不用靠角色判断去堵 |
| `/api/items/:id` | DELETE | 删一条榜单条目 | ✅ **已接**（Day 22 接 · Day 24 改真删）：`api.deleteItem(id)`。**物理删除**，删掉的行不会留在库里；真要找回只能由站方拿 `data/data.json` 的底稿重灌一次（那是站方手上的备份，**不是数据库替谁留的副本**）。带 `.delete().select()` 把被删的那一行拿回来当回执 |
| `/api/search` | POST | 查询检索。✅ **部分已接（Day 22 · L3 点亮，形态为 SDK 直连 LLM + RLS 同源约定）**：**AI 整理** = `ai.digest()`（`js/ai.js` 收口，keyless、只支持流式，系统提示词在应用侧写死：**不判真伪、不编造、不输出网址、用户材料不当指令**）；「自动联网抓取」**本环境做不了**（托管后端没有搜索/抓取通道）——溯源仍是「官方来源 / 网络来源」两组**人工入口**（`official` / `web` 两组划分保留），AI 只负责给出检索式，由页面一键带进两组入口。L1 站内检索（Day 17）与 L2 查证四步清单不变。模型选型：实测首字延迟后首选 `hunyuan-chat`（1.4s），目录里没有再退「非思考型 → 默认项」（依据见 `js/ai.js` 注释） | 部分已接 |
| `/api/posts` | GET / POST | 论坛帖子（F3，含审核流）。✅ **已接**（Day 21 · 形态为 SDK 直连 + RLS）：GET = `api.getPosts()`（RLS 只出 approved，登录者额外看到自己的 pending）；POST = `api.createPost()`（需登录，RLS 强制落 `pending`，想直接插 approved 会被拒）。表结构见 `db/schema.sql`（`category` / `replies` 已入表；`replies` 暂由种子与展示预留，将来由回复表聚合） |
| `/api/posts/:id` | **PATCH / DELETE** | 单条帖子的改与删。✅ **已接**（Day 22 接 · Day 24 把 DELETE 改成真删）：**PATCH** = `api.setPostStatus(id, status, rejectNote)` —— 审核状态机（`approved` / `rejected` / `pending`），改前先 SELECT 确认这条在，拿回改后的行做前后对比；**DELETE** = `api.deletePost(id)` —— **物理删除、不可恢复**，`.delete().select()` 拿回被删的行；一行都没删到就抛中文错，不假装成功。两条都要求调用者在 `admins` 名单（RLS `posts_admin_*` 再核） |
| `/api/reports/:id` | DELETE | 删一条线索。✅ **已接**（Day 22 接 · Day 24 改真删）：`api.deleteReport(id)`，**物理删除、不可恢复**。仅管理员（`reports_admin_delete`） |
| `/api/reports` | POST / GET | 待核查线索。✅ **已接**（Day 21）：POST = `api.submitReport()`（未登录可提交，作者落 `'anon'`）；GET = `api.getMyReports()`（只回读登录者自己提交的；匿名线索不提供客户端回读） |
| `/api/profile` | GET / PUT | 个人资料（昵称 / 个性签名 / 头像）。✅ **已接**（Day 22 · SDK 直连数据库 + 云存储）：GET = `api.getProfiles()`；PUT = `api.saveProfile()`；头像文件走 `api.uploadAvatar()` + `api.signAvatarUrls()`。表结构见 `db/schema.sql` 第 ④ 节 |
| `/api/admin` | 多个 | **管理后台（Day 23 新增 · Day 24 扩公告，仅 `admins` 表成员）**：`api.amIAdmin()`（判定，RLS 空 = 否）；`api.listAllPosts()`（含待审/已拒）；`api.setPostStatus(id, status, rejectNote)`（审核：approved / rejected / pending）；`api.deletePost(id)`；`api.listAllReports()`（全部线索）；`api.deleteReport(id)`；`api.getItems()`（榜单条目 —— Day 24 起条目没有「已回收」这回事，后台跟前台读的是同一份）；`api.deleteItem(id)`；`api.listAllAnnouncements()` / `api.createAnnouncement()` / `api.updateAnnouncement()` / `api.deleteAnnouncement()`（**Day 24 新增**：站方公告的增删改）。页面 `admin.html` + `js/admin.js`；**删除类操作一律两击确认** —— Day 24 撤掉回收站之后，这道确认是唯一的刹车。**每个写请求都被 `*_admin_*` RLS 策略再核一遍**，非管理员调用一律被数据库拒绝 |
| `/api/announcements` | GET / POST | 站方公告的读与发布。✅ **已接**（Day 24）：GET = `api.listAnnouncements()`（**公开读，未登录也看得到**；RLS 的公开读策略写的是 `USING (is_pinned)`，所以「先写好、暂不公布」的稿子匿名根本读不到 —— 这条靠策略实现，不靠前端自觉过滤）；POST = `api.createAnnouncement()`（须 `admins` 成员） |
| `/api/announcements/:id` | **PATCH / DELETE** | 改一条公告（标题 / 正文 / 排序 / 是否公布）与删一条。✅ **已接**（Day 24）：`api.updateAnnouncement(id, patch)` / `api.deleteAnnouncement(id)`，由 `announcements_admin_write`（`FOR ALL`）放行 |

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

## 五、六张表的 RLS 闸门（Day 21 定稿 · Day 22 增 profiles · Day 23 增 admins 与管理策略 · Day 24 增 announcements、撤掉回收站读）

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
| `announcements` | `announcements_read_all` | SELECT | `authenticated, anon`：`USING (is_pinned)` —— **公开读，但只出已公布的**。「先写好、暂不公布」的稿子（`is_pinned = false`）匿名与访客都读不到；这条过滤靠策略实现，不是靠前端自觉（实测见 `verify/probe-day24-draft.js`） |
| `announcements` | `announcements_admin_write` | ALL | **仅 `authenticated` 且在 `admins` 表**：`FOR ALL` 一条覆盖增/改/删。`USING` 与 `WITH CHECK` 写的是同一个判定式（前者管「对哪些行有效」，后者管「新写入的行合不合法」） |

所有管理策略的判定式都是同一个：`EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())`
—— 权限真身在数据库里，前端页面只是入口，改前端解锁不了任何操作。
`admins` 表本身无写策略：加/撤管理员走站方管理通道，客户端（包括管理员本人）改不了名单。

**上线前要补的**：
① 匿名提交（reports）无频控 —— RLS 只管「谁」，不管「多快」，公开前需加限流或人机验证；
② 头像上传同样无频控与体积上限 —— 前端那条 2MB 是可用性提示，不是安全边界；
③ 头像签名的有效期取 3600 秒（SDK 上限），页面不做续签 —— 长时间挂着不动会显示成裂图，重新渲染即可。

---

## 六、防呆三件套（Day 22）

课程的判断：**改错、反悔是真实应用的常态**，而删除又是**不可逆**的。所以「能不能改/删」之外，
还必须回答「改错了怎么办、删错了怎么办、点错了怎么办、id 写错了怎么办」。四问对应下面三件套。

### 6.1 id 存在性校验 —— 不存在的 id 必须给出明确的中文错误

**问题**：不校验时，「改/删一个不存在的 id」不会报错，而是**静默成功** ——
PostgREST 在不索要返回值时一律回 `204`，前端据此提示「操作成功」。用户以为改上了，其实一行没动。
**静默失败比报错更糟：它没有任何信号。**

**做法**（`js/api.js` 的 `fetchRowOrThrow`）：写操作之前先发一次 `SELECT … WHERE id = … LIMIT 1`，
查不到就抛带 id 的中文错，例如：

```
没有找到这条帖子（id=99999）—— 它可能已经被删掉了；如果它本该还在，请确认你的账号有没有相应权限。
```

**改与删，两条路各走各的（Day 24 分开之后更清楚了）**：

- **改（PATCH）**：不带 `.select()` 时 PostgREST 不看影响行数，改 0 行也回 `204`（静默成功）。
  所以**预检必须前置**：写之前先 `SELECT … WHERE id = … LIMIT 1`，查不到就抛中文错。
  顺带的好处是这次预检返回的整行就是「操作前的快照」，直接拿来做前后对比（见 6.4）。
- **删（DELETE）**：Day 24 撤掉软删触发器之后，DELETE 可以直接带 `.select()` ——
  **被删掉的那一行会随返回值回来**；一行都没有，就说明 id 不存在、或账号没有权限，
  同样当场抛中文错。一次请求同时完成「删掉」和「确认删到了」，比「预检 + 删除」两趟更省，
  也不存在两步之间的竞态。
  （**Day 22 不能这么写**：那时触发器把物理删除取消掉，被取消的行不会出现在 `RETURNING` 里，
  拿行数判断会把「软删成功」误报成「查无此 id」。撤掉软删之后，这条限制自然消失了。）

> ⚠️ 定位：这是**可用性防线**，不是安全闸门。真正的权限仍在 `*_admin_*` RLS 策略里 ——
> 非管理员绕过这一层，写请求照样被数据库拒（0 行 / `42501`）。

### 6.2 前端删除二次确认 —— 危险按钮不许一击致命

`js/admin.js` 的 `armDangerous()`：删除类按钮**第一次点只变成「确认？」**并聚焦，
**3 秒内再点才真正执行**，超时自动复原。三个删除入口（帖子 / 榜单条目 / 线索）全部套了它。

为什么不用系统 `confirm()`：丑、打断、且会被浏览器「不再显示此对话框」永久关掉；
自绘两击确认既能挡误触，又不依赖浏览器行为。

它挡的是**手滑点错**；挡不住「点对了但删错对象」或「代码写错了」——那要靠 6.3。

### 6.3 删除不可逆 —— 把「不可逆」放在它该在的地方（Day 24 定稿）

Day 22 曾在数据库里留一手：DELETE 被触发器改写成 `is_deleted = true`，删错了还能捞回来。
**Day 24 整套撤掉了** —— 站方的判断是「没必要留数据，堆着也没用，直接清掉就可以」。

撤掉之后的形态很干净，也很硬：**删除就是物理删除，删掉的行不会留在库里。**
`api.deleteXxx()` 因此变得很短 —— 一条 `.delete().eq("id", id).select()`，拿不到返回行就是没删到。

那「删错了怎么办」？这个问题没有被回避，只是**换了地方回答**：

| 谁来兜 | 怎么兜 |
|---|---|
| **按钮**（js/admin.js） | 两击确认：第一次点变成「确认删除？」，3 秒内再点才执行，超时自动复原 |
| **文案**（admin.html） | 三个删除区块都明写「删除是**不可恢复**的」，不留侥幸心理 |
| **回执**（admin.js） | 删完在页顶说一句「已删除《…》—— 真删，数据库里已经没有了」，并重载列表让它当场消失 |
| **底稿**（data/data.json） | 只有榜单条目留有种子底稿，站方可以重灌 —— 但那是**站方手上的备份**，不是数据库替谁留的副本，两件事别混 |

> 一句话：**既然不可逆是产品决定，就把它摆在操作现场，而不是藏在数据库里留个副本假装安全。**
>
> 藏起来的代价是真实的：一列 `is_deleted` 要跟着走遍所有读路径 —— 三条读策略、
> 两个 `api.getXxx()` 的过滤、后台三个列表的「已回收」分支。任何一处漏掉，得到的都是
> 「界面说删了、数据还在」或者「删了却还读得到」—— **没有信号的那种坏，比报错难查得多。**
> （Day 22 加 `items_admin_read` 时就现过一次形：两条 SELECT 策略是 OR 关系，
> 管理员会话下光靠 RLS 会把已回收的行带出来，展示层必须自己再过滤一次。）

### 6.4 验证方法：数据库 SELECT 前后对比

**核心口径：一切以「改前 / 改后两次 SELECT 的差」为准，不以界面提示为准。**

**① 手动（在后台点一次）**

```sql
-- 改前
SELECT id, status, reject_note, updated_at FROM posts WHERE id = 28;
-- …在后台点「通过」…
-- 改后：status 从 pending 变成 approved
SELECT id, status, reject_note, updated_at FROM posts WHERE id = 28;
```

```sql
-- 删前：这条在
SELECT count(*) FROM posts WHERE id = 29;        -- 期望 1
-- …在后台点「删除」，3 秒内再点一次（两击确认）…
-- 删后：**行真的没了** —— Day 24 起没有 is_deleted 这一列可查，那正是重点
SELECT count(*) FROM posts WHERE id = 29;        -- 期望 0
```

**② 回执式（接口层自带）**：`api.setPostStatus()` 返回**改后的行**，控制台另打一行
`[api] 审核帖子 28：status pending → approved`；三个删除方法返回**被删掉的那一行**
（`.delete().select()` 的返回值）。所以「改前 / 改后」不靠截图猜，接口自己就把两端的值交出来了。

**③ 探针式（可复现）**：`verify/probe-day22-exists.js` —— 对「存在的 id」与「不存在的 id」
各跑一遍读路径，断言前者有行、后者 0 行，证明存在性预检的判断依据可靠（实测记录见
`docs/day22-crud-loop.md`）。

## 七、Day 24 决策留痕：为什么把软删除撤了

**决定**（站方）：**不留「已回收」的数据，删除就是删除。**

落地动作：撤除 `is_deleted` 列（三张表）、`soft_delete_rows()` 与三个 BEFORE DELETE 触发器、
`restore_item` / `restore_report` 两个函数、`items_admin_read` 这条回收站读策略；
三条读策略去掉 `NOT is_deleted` 条件，`bump_item_view` 去掉同名判断。

**当时的权衡（记下来，免得下次又绕一圈）**

| 软删除给什么 | 代价 |
|---|---|
| 误删能一条 `UPDATE` 捞回来 | 一个状态位要渗透进每一条读路径（读策略 ×3、`api.getXxx()` ×2、后台列表 ×3），漏一处就是「删了还读得到」 |
| 后台看得见回收站 | 后台要多一套「已回收 / 恢复」的界面与文案，`items` 还得额外开一条读策略 |
| 对「用户内容不能随便删」有缓冲 | 但本项目的删除**只发生在管理端**（客户端根本没有删除能力），兜的是管理员自己点错 —— 而那件事有更便宜的解法：按钮上的两击确认 |

**结论**：收益（兜住管理员手滑）与代价（一个状态位渗透全站读路径）不成比例，
而手滑这一半已经有更直接、更便宜的防线（两击确认 + 明说不可逆）。→ 撤。

**撤销的验证**（脚本都在 `verify/`，可复现）

| 证据 | 结果 |
|---|---|
| `probe-day24.js`（匿名视角，13 项） | 公告匿名可读 / 匿名写不进；items、posts 公开读正常；三张表匿名 DELETE 依旧 `401`（撤软删 ≠ 开闸门） |
| 管理员 / 非管理员**角色模拟**删同一批测试帖 | 管理员删掉 1 行、该行**真的从表里消失**；非管理员删掉 0 行（被 `posts_admin_delete` 拦下），行还在 |
| `pg_trigger` 查询 | 四张表上非内部触发器 **0 个** —— 软删触发器确已撤除 |
| `information_schema.columns` 查询 | `is_deleted` 列残留 **0** —— 列真的删了，不是留着不用 |
| `probe-day24-draft.js`（3 项） | 造一条 `is_pinned = false` 的公告靶子：匿名全量读看不到、按 id 直查也看不到 —— **策略 `USING (is_pinned)` 真在过滤**（不是「恰好全是 true」的空转断言） |
| frontend-rules 门槛 | **115 项全过**（Day 24 新增 F13 / F14 两条盯公告栏），filter-check **75 项全过** |

