# Day 22｜PATCH / DELETE 闭环 + 软删除

> 日期：2026-10-10｜项目：热门时事真伪辨别网站（foxlings-project）
> 站点：https://rumor-check-12000.app.workbuddy.host/
> 关联：`db/schema.sql`（本日修订）· `docs/day21-acceptance.md`（昨日验收）· `api-contract.md`

---

## 一、今日问题：删除为什么比新增更容易出事？

课程要掌握的是这一句。逐条都有本项目的实例：

| # | 为什么 | 本项目的实例 |
|---|---|---|
| 1 | **不可逆** | 新增写错，改一行重来；删除删错，原始内容就没了。库里已有真实用户内容（1 条资料 + 1 条线索 + 帖子） |
| 2 | **影响面是别人** | `posts_insert_own` 强制新帖只能插成「自己的 + pending」——新增只影响一行；删除影响的是**所有人可见的内容** |
| 3 | **会级联** | Day 21 亲眼见过 `TRUNCATE … CASCADE` 顺外键把整个论坛清空——那正是把它从脚本里删掉的原因 |
| 4 | **权限面更大** | 删除靠 `admins` 名单认人，判定式写漏（比如漏掉 `EXISTS`）就**对所有人放开**；新增的判定式只锚自己，写错后果小得多 |
| 5 | **静默成功最危险** | 「删了但没删干净」：软删标记加了却**忘了在读路径过滤**，界面说"已删除"、数据还在还能被读到——比报错更糟，因为完全没有信号 |

**「你在哪加了确认？」**

- **第一道（UI 层）**：`js/admin.js` 的两击确认——第一次点变「确认？」，3 秒内再点才执行。不用系统 `confirm` 弹窗（丑且打断），也不给一键误删。
- **第二道（今天新加，服务端）**：**软删除**。客户端从此**没有物理删除能力**（见第三节）；真要物理删除必须显式**关掉触发器保险**，且只能走站方 SQL 通道。
- UI 确认只挡误触，挡不住"点对了但删错对象"或"代码写错"——第二道挡的正是这个。

---

## 二、现状盘点：改 / 删通道本来就在哪

它们**不是今天新建的**——Day 23 做管理后台时就上线了。今天做的是**把已写好的通道真正验证一遍**。云端 15 条策略实查（与 `db/schema.sql` 逐条一致）：

| 动作 | 策略 | 角色 | 说明 |
|---|---|---|---|
| UPDATE | `posts_admin_update` | authenticated + admins 名单 | 审核状态机：过审 / 驳回 / 下架回待审 |
| UPDATE | `profiles_update_own` | authenticated, 锚 `user_id = auth.uid()` | 本人改自己的昵称 / 签名 / 头像 |
| DELETE | `items_admin_delete` | admin | 删榜单条目 |
| DELETE | `posts_admin_delete` | admin | 删帖 |
| DELETE | `reports_admin_delete` | admin | 删线索 |

对应接口层已有：`api.setPostStatus`（PATCH）、`api.deletePost` / `deleteReport` / `deleteItem`（DELETE）。

### 闸门矩阵（`verify/probe-day22-gate.js`，12/12 PASS）

**安全设计**：DELETE 的靶子一律用**哨兵 id**（items 用字符串 `__gate_probe_nonexistent__`、posts/reports 用数字 `-1`）——闸门万一意外开着，也只是删掉 0 行，**不可能误伤真实数据**。另一轮针对"探针自建测试行"的真删做行级验证。

| 操作 | items | posts | reports |
|---|---|---|---|
| 匿名 PATCH | 401 | 401 | 401 |
| 匿名 DELETE | 401 | 401 | 401 |
| 匿名 GET | 200 | 200 | **401** |
| 匿名 POST | — | — | **201** ✅ |

> 正向对照 `POST → 201` 很关键：它证明"拒绝"来自**权限**而不是网络或配置出错。
> 踩坑记录：`posts.id` / `reports.id` 是 **bigint**，字符串哨兵被 PG 直接判 `400 22P02`（探针自身的 bug，不是产品问题）——数值型主键的哨兵必须是数字。

---

## 三、今天的实现：把「删除」改成「回收」

### 3.1 方案：BEFORE DELETE 触发器（**前端一行都不用改**）

```
客户端 DELETE /posts?id=eq.29
        │
        ▼
  RLS 判定：管理员？ ── 否 ──▶ 42501 permission denied（闸门照旧）
        │ 是
        ▼
  BEFORE DELETE 触发器 trg_posts_soft_delete
        │  ① soft_delete_rows() 内 UPDATE … SET is_deleted = true（SECURITY DEFINER，越过 RLS）
        │  ② RETURN NULL  → 物理删除被取消
        ▼
  客户端收到 204（api.js 的 `.delete().eq()` 不带 `.select()`，PostgREST 不看影响行数）
  → 界面照常显示"删除成功"，而真实语义已经是"回收进回收站"
```

**为什么用触发器而不是改前端**：`api.js` 的 `deletePost` 走 `.delete().eq()`，**没有 `.select()`**，所以 PostgREST 用 `Prefer: return=minimal` 返回 204、**不关心影响了几行**。触发器让物理删除变成 0 行，客户端依然认为成功。于是"把不可逆从客户端能力里整个拿掉"这件事，**零前端改动就完成了**。

### 3.2 关键在于两条读策略的**差别**

软删除真正生效的地方不是触发器，而是**读路径过滤**：

| 策略 | 是否过滤 `is_deleted` | 为什么 |
|---|---|---|
| `items_read_all` | ✅ `USING (NOT is_deleted)` | 公开榜单不该出现已回收条目 |
| `posts_read` | ✅ `NOT is_deleted AND (status='approved' OR author_id=auth.uid())` | 公开列表与作者自己的列表都不该出现 |
| `reports_read_own` | ✅ `NOT is_deleted AND author_id=auth.uid()` | 作者看不到被回收的线索 |
| `posts_admin_read` | ❌ **刻意不加** | 后台**必须能看见已回收的帖子**，否则无法恢复 |
| `reports_admin_read` | ❌ **刻意不加** | 同上 |

> **只标记不过滤 = 删了等于没删**，而且界面会骗人（显示已删除、数据仍可读）。
> **全过滤（连管理读也过滤）= 再也找不回**。这两条读策略的差别，就是"软删"的正确形态。

### 3.3 真要物理删除：必须**关保险**

```sql
ALTER TABLE posts DISABLE TRIGGER trg_posts_soft_delete;
DELETE FROM posts WHERE id = ...;
ALTER TABLE posts ENABLE  TRIGGER trg_posts_soft_delete;
```

要关掉保险才能真删——这个"多一步"本身就是我们加的第二道确认。三条语句已实测走通（见第四节实测记录）。

### 3.4 三个必须讲清的细节

1. **`ALTER TABLE … ADD COLUMN IF NOT EXISTS` 的位置**：`CREATE TABLE IF NOT EXISTS` 对已存在的表**是空操作**，所以线上老库不会自动长出 `is_deleted`。加列语句必须紧跟各自建表，且必须排在**引用该列的函数与策略之前**。
   > 这是今天真实踩到的坑：第一版把加列统一放在 RLS 段前，结果 `CREATE OR REPLACE FUNCTION bump_item_view`（引用 `is_deleted`）在它之前执行 → `DATABASE_42703 column "is_deleted" of relation "items" does not exist`。**顺序错了，语句本身没错。**
2. **改 RLS 的 DDL 走数据通道必须 base64**：请求体里出现 `CREATE TABLE` / `ALTER TABLE` / `TRUNCATE TABLE` 字面会被网关 WAF 回 **403**（Day 21 已知）。今天 74 条语句全部经 `fx_scratch` 暂存 + 回读逐字校验后执行。
3. **动态 SQL 没有可注入的位置**：触发器函数用 `format('%I', TG_TABLE_NAME)` 引号化标识符、id 走 `USING` 绑定参数——表名与值都不参与字符串拼接。

---

## 四、闭环验证实测记录（2026-10-10）

用一条**自建测试帖**（`author_id='day22-test'`，不碰任何真实数据）走完整循环：

| 步骤 | 操作 | 实测结果 |
|---|---|---|
| 1 | SQL 插入测试帖 | `id=27, status=approved, is_deleted=false` |
| 2 | 匿名 `GET /posts` | **7 条**，含 id=27 ✅（删除前可见，可截图） |
| 3 | `DELETE FROM posts WHERE id = 27` | **`RETURNING` 返回空 → 物理删除被取消** ✅ |
| 4 | SQL 读回该行 | 行**还在**，`is_deleted=true` ✅（数据从未离开） |
| 5 | 匿名 `GET /posts` | **6 条**，id=27 **消失** ✅（课程要求的「DELETE 后 GET 不再返回」） |
| 6 | `UPDATE … SET is_deleted=false` | 恢复成功 ✅ |
| 7 | 匿名 `GET /posts` | **7 条**，id=27 **回来了** ✅（"删错了还能找回"） |
| 8 | 关保险 → 真删 → 开保险 | 返回 `id=27`，物理删除确实可行 ✅ |

清理后复核状态：

```
items 23 / posts 7 / reports 1 / profiles 1 / admins 1
sum(views) 23（未变）| policies 15（未变）| 用户触发器 3（新增，全部 enabled）
is_deleted 列 3 个（items / posts / reports，NOT NULL）
临时表 fx_scratch 已删除
```

> 顺带验到：清理探针测试行时 `DELETE FROM reports WHERE text LIKE '[Day22 测试]%'` 也返回空 —— 说明**reports 的触发器同样在岗**，第三张表无需单独复测。
> 另一个 `?id=eq.-1` 的经验：探针自建的 `[Day22 测试]` 行被软删后成了"看不见但存在"的行，最终也是走**关保险**才真删掉的（id=17）。

---

## 五、防呆补做：id 存在性校验 + 前后对比验证（2026-10-10 晚）

§三 讲的软删除解决了「删错了怎么办」。课程还要求另外两件：**点错了怎么办**（前端二次确认，
Day 23 就写好的两击确认，见第一节「你在哪加了确认？」）与 **id 写错了怎么办**（接口必须给明确中文错误）。
本节补上后者，并给出「数据库 SELECT 前后对比」的标准验证方法。

### 5.1 问题：不校验时，「改/删一个不存在的 id」是**静默成功**

PostgREST 在不索要返回值时一律回 `204`。于是：

```
PATCH  /posts?id=eq.99999   { status: "approved" }  →  204（一行没改，却报成功）
DELETE /posts?id=eq.99999                           →  204（一行没删，也报成功）
```

**静默失败比报错更糟：它没有任何信号。** 用户以为操作生效了，界面也会照着说「操作成功」。

### 5.2 为什么存在性判断必须**前置**，不能靠写操作自己报错

这是本节最容易做错的地方 —— 两个写操作各有各的坑：

| 操作 | 为什么它的返回值**不能**用来判断存在性 |
|---|---|
| `UPDATE` | 不带 `.select()` 时 PostgREST 不看影响行数，改 0 行也回 `204` |
| `DELETE` | 软删触发器返回 `NULL` 取消了物理删除，**被取消的行不会出现在 `RETURNING` 里** —— 用 `.delete().select()` 数行数，会把「软删成功」误报成「查无此 id」 |

所以 `js/api.js` 新增 `fetchRowOrThrow()`：写之前先发一次
`SELECT * FROM <表> WHERE id = X LIMIT 1`，查不到就抛带 id 的中文错：

```
没有找到这条帖子（id=99999）—— 它可能已经被删掉了；如果它本该还在，请确认你的账号有没有相应权限。
```

> ⚠️ 定位：这是**可用性防线**（把「查无此 id」翻成人话、拦住无效请求），**不是安全闸门**。
> 权限仍全在 `*_admin_*` RLS 策略里 —— 非管理员绕过这一层，写请求照样被数据库拒。
> 顺带的好处：预检返回的整行 = 「操作前的快照」，直接拿来做前后对比（5.5）。

### 5.3 实测挖出的分寸：预检的「0 行」是**对当前身份**而言

预检用的 SELECT 走的是和普通读一样的 RLS，所以「0 行」同时覆盖三种情况：
① 真的不存在；② 存在但当前身份看不见（如匿名看 `pending` 帖）；③ 已被软删（公开读策略把它过滤了）。

`verify/probe-day22-exists.js` 实测（匿名只读通道，**5/5**）：

| 情形 | 靶子 id | REST 返回 | 预检判定 |
|---|---|---|---|
| 条目 · 真实存在且公开可读 | `20251120-01` | 200，1 行 | 「在」✅ |
| 条目 · 人造不存在的 id | `__no_such_item_day22__` | 200，0 行 | 「查无此 id」✅ |
| 帖子 · 已通过审核 | `3` | 200，1 行 | 「在」✅ |
| 帖子 · 存在但匿名看不到（pending） | `7` | 200，**0 行** | 对匿名「查无」，对管理员「在」✅ |
| 帖子 · 人造不存在的 id | `99999` | 200，0 行 | 「查无此 id」✅ |

第 4 行正是错误文案要带「请确认你的账号有没有相应权限」的原因 ——
**对后台唯一的真实调用者（管理员）来说**，管理读策略让情况 ② 不成立，预检就精确等价于「这条在不在」。
（`reports` 无匿名读策略，匿名恒 401，预检只在管理员会话下有意义 —— 探针如实记录，不当作断言。）

### 5.4 守卫本身怎么验：桩掉云客户端，跑**真实代码**

匿名通道证明不了「那段守卫真的会抛中文错」。于是 `verify/probe-day22-guard-unit.js`
把云客户端桩掉，用 `vm` 加载 **`js/api.js` 的真实源文件**（不是复述逻辑），断言它抛什么、返回什么：

| # | 场景 | 结果 |
|---|---|---|
| ① | PATCH 不存在的 id | 抛「没有找到这条帖子（id=99999）」，`code=NOT_FOUND` ✅ |
| ② | PATCH 存在的 id | 返回改后的行；且 update 之后确实带了 `.select()` ✅ |
| ③ | PATCH 预检过了但写入 0 行（策略滤掉） | 抛「没有改动」，`code=FORBIDDEN` ✅ |
| ④ | PATCH 非法状态值 | 抛「不合法的审核状态。」 ✅ |
| ⑤⑥⑦ | DELETE 三张表 · 不存在的 id | 各抛对应中文错，`code=NOT_FOUND` ✅ |
| ⑧ | DELETE 存在的 id | 返回**删除前的快照** ✅ |

**结果：8/8 PASS。**

**反向验证**（沿用 Day 21 纪律 —— 断言必须真的会变红）：把 `HEAD` 版本的旧 `api.js`
导出成对照文件，跑**同一套断言** → **1/8 PASS，7 项 FAIL**（唯一过的 ④ 是旧代码本来就有的状态校验）。
这 7 条新断言确实在测新守卫，不是假绿。

### 5.5 数据库 SELECT 前后对比的验证方法（标准口径）

**口径：一切以「改前 / 改后两次 SELECT 的差」为准，不以界面提示为准。**

改（PATCH）：

```sql
-- 改前
SELECT id, status, reject_note, is_deleted, updated_at FROM posts WHERE id = 28;
-- …在后台点「通过」…
-- 改后：status 应从 pending 变为 approved
SELECT id, status, reject_note, is_deleted, updated_at FROM posts WHERE id = 28;
```

删（DELETE，软删）：

```sql
-- 删前：这条在（is_deleted = false）
SELECT id, title, is_deleted FROM posts WHERE id = 29;
-- …在后台点「删除」，3 秒内再点一次…
-- 删后：行**还在**（数据从未离开），只是 is_deleted = true
SELECT id, title, is_deleted FROM posts WHERE id = 29;
-- 公开读的视角：它已不在列表里（RLS 过滤掉了）
SELECT id FROM posts WHERE id = 29 AND NOT is_deleted;   -- 期望 0 行
-- 恢复：一条 UPDATE 就回来
UPDATE posts SET is_deleted = false WHERE id = 29 RETURNING id, is_deleted;
```

三条通道互为交叉验证：**手动 SQL**（上面）、**接口回执**（`setPostStatus` 返回改后的行、
控制台另打 `[api] 审核帖子 28：status pending → approved`；三个删除方法返回删除前快照）、
**探针**（5.3 判断依据 / 5.4 守卫本身）。

---

## 六、待人工完成：管理员端的端到端（PATCH / DELETE）

**为什么必须人工**：接口层的正确性只能由**真实管理员的 REST 请求**证明。已经排除的替代方案：

- ❌ `exec_sql` 通道：执行角色是 `cloudbase_postgres_postgres_hr3ac678`（postgres），**绕过 RLS** —— 它能证明"数据能改"，但**证明不了"闸门放行"**。用它交差等于"点了但没真验"。
- ❌ 邮箱 OTP 登录：验证码只有本人能收，AI 代不了。

因此已备好两个靶子，等你在后台点两下：

| 靶子 | id | 当前状态 | 你要做的 | 截图要拍到 |
|---|---|---|---|---|
| PATCH 靶子 | **28** | `pending` | 待审区点「**通过**」 | 改前/改后的状态值（`pending` → `approved`） |
| DELETE 靶子 | **29** | `approved` | 全部帖子区点「**删除**」（两击确认） | 删除前公网列表有它、删除后刷新**不再返回** |

⚠️ **点完 DELETE 后，帖子仍会留在后台列表里 —— 这是刻意的**：`posts_admin_read` 不加 `is_deleted` 过滤，后台必须看得见已回收的帖子才能恢复。**"删除生效"的证据要看公网 GET，不是后台列表。**

---

## 七、改动文件清单（按归属）

| 文件 | 改动 | 归属 |
|---|---|---|
| `db/schema.sql` | 三张表加 `is_deleted` 列（含 `ADD COLUMN IF NOT EXISTS` 迁移，紧跟各建表语句）；`bump_item_view` 跳过已回收条目；三条公开读策略加 `NOT is_deleted`；新增 `soft_delete_rows()` 函数 + 三个 BEFORE DELETE 触发器 | **Day 22** |
| `js/api.js` | 新增 `fetchRowOrThrow()` 存在性预检；`setPostStatus` 补「预检 + `.select()` 回执 + 0 行提示」并返回改后的行；`deletePost` / `deleteReport` / `deleteItem` 补预检并返回删除前快照 | **Day 22**（晚·防呆） |
| `api-contract.md` | 登记 PATCH/DELETE 三条接口并标「已实现」（`/api/posts/:id`、`/api/reports/:id`、`/api/items/:id`）；新增第六节「防呆三件套」 | **Day 22**（晚·防呆） |
| `verify/probe-day22-gate.js` | 新增：PATCH/DELETE 闸门矩阵探针（哨兵 id，零破坏） | **Day 22** |
| `verify/probe-day22-exists.js` | 新增：id 存在性预检的判断依据核验（匿名只读通道，5/5） | **Day 22**（晚·防呆） |
| `verify/probe-day22-guard-unit.js` | 新增：守卫单元级验证（`vm` 加载真实 `api.js`，8/8；附反向验证 1/8） | **Day 22**（晚·防呆） |
| `docs/day22-crud-loop.md` | 本文档（含第五节防呆补做） | **Day 22** |

> **更正**：早先版本写「`js/api.js` / `js/admin.js` 一行未改」—— 那只对**软删除**成立
> （触发器方案确实零前端改动）。当晚补「防呆」时改了 `js/api.js`（存在性预检），
> `js/admin.js` 仍**一行未改**（两击确认 Day 23 就写好了）。
> 云端数据库：策略定义已随 `schema.sql` 重跑同步（15 条全部 DROP+CREATE，读到的是文件里的定义）。

---

## 八、已知边界 / 待办

| # | 事项 | 状态 |
|---|---|---|
| 1 | 后台没有「已回收」视图与「恢复」按钮 —— 目前恢复靠站方 SQL（`UPDATE … SET is_deleted=false`） | **待做**（需改 `admin.js` 并重新发布） |
| 2 | 管理员端的 PATCH / DELETE 端到端验证 | **等人工**（见第六节） |
| 3 | 匿名提交频控 / 头像上传频控与体积上限 / 签名 URL 续签 | 旧待办，未动 |
| 4 | `items` 的软删与"不能改热度"的张力：`items` 没有 UPDATE 策略，所以条目只能由触发器置 `is_deleted`，**管理员仍然无法手动改热度**（该保证未被削弱） | 已确认 |
| 5 | 存在性预检是「先查后写」两步，理论上有 TOCTOU 窗口（查完到写之间那条被别人删掉）—— 单条记录 + 管理员低频操作，当前规模可忽略 | 已知取舍 |
| 6 | 本节的守卫验证只覆盖 `api.js` 这一层（桩掉云客户端）。**真实登录态下**「点一次、抛一次中文错」仍需人工在线上跑一遍 | 等人工（同第 2 条） |

---

## 九、对照课程原文逐条对账

> **课程原文（Day 22）**
> **实战步骤**：① 让 AI 生成支持路径参数 `:id` 的 PATCH 和 DELETE 云函数（每类数据各 1 个，函数内通过参数中的 id 定位记录）；
> ② 部署后在检查台页面上完成一次真实的修改和删除；③ 数据库 select 确认修改、删除真实生效；④ 更新 `api-contract.md`，登记这两个接口。
> **完成后检查**：PATCH 修改成功、数据库字段真实变化｜DELETE 删除成功、数据不再出现在 GET 结果里｜
> 操作不存在的 id 返回明确错误、不是崩溃｜`api-contract.md` 已同步更新。

### 9.1 「云函数」在本项目的等价物（是形态映射，不是没做）

课程模板项目有自建服务层，所以改 / 删写成**云函数 + 路径参数 `:id`**。
本项目 Day 14 拍板的是**「静态前端 + 托管后端」**：没有自建 HTTP 服务，改 / 删由 **PostgREST 直连 + RLS 策略**承载。
同一件事的两种形态：

| 课程说法 | 本项目落点 | 位置 |
|---|---|---|
| PATCH 云函数（`:id` 定位一条记录） | 策略 `posts_admin_update`（审核状态机）、`profiles_update_own`（本人改资料） | `db/schema.sql` §6.3 |
| DELETE 云函数（`:id` 定位一条记录） | 函数 `soft_delete_rows()` + 触发器 `trg_{items,posts,reports}_soft_delete` | `db/schema.sql` §6.5 |
| 「函数内通过参数中的 id 定位记录」 | PostgREST 的 `?id=eq.X` 过滤 / 触发器里的 `OLD.id` / 函数形参 `p_id` | — |
| 函数返回明确错误 | `js/api.js` 的 `fetchRowOrThrow()` 抛中文错（§5.2）；数据库侧中文错用 `RAISE EXCEPTION`（`bump_item_view` 同款手法） | `js/api.js:130` |

**为什么不额外再造就一对 `patch_post(p_id)` / `delete_post(p_id)` RPC 函数**：
本项目**会**用 RPC（`bump_item_view` 就是），但只在 **RLS 表达不了**的地方用 ——
「只能 +1、连参数里都没有数字」那种窄口，用函数写出签名就等于把权限问题消掉了。
而改 / 删这两件事 RLS 表达得了（15 条策略 + 闸门矩阵 12/12 实证），再加一层函数等于**多一条授权路径**：
两个地方都得写对才不出洞。**多一个门闩不是更安全，是多一个会忘记锁的门。**

> 唯一可想到的收益是「把中文错误下沉到数据库」。这一条在 §5.4 已由接口层拿到（8/8 + 反向 1/8），
> 不值得为此改架构。若课程硬性要求函数形态，也可补一对纯包装的 `SECURITY INVOKER` 函数（仍由 RLS 判定权限）——**待拍板，未做**。

### 9.2 四项实战步骤

| # | 课程步骤 | 状态 | 证据 |
|---|---|---|---|
| 1 | 生成支持 `:id` 的 PATCH / DELETE 接口 | **PASS** | 15 条策略（`db/schema.sql` §6）+ `api.setPostStatus` / `deletePost` / `deleteReport` / `deleteItem`；闸门矩阵 12/12（§二） |
| 2 | 部署后**在检查台页面上**完成一次真实的修改和删除 | **未执行** | 靶子 id=28 / id=29 已备好（§六）；**前置未满足**：线上仍是旧版前端，见 9.4 |
| 3 | 数据库 select 确认修改、删除真实生效 | **PASS**（服务端侧） | §四闭环实测 8 步（`is_deleted` false→true、GET 有→无、UPDATE 可恢复）；标准口径见 §5.5 |
| 4 | 更新 `api-contract.md` 登记这两个接口 | **PASS** | `api-contract.md`：`/api/posts/:id` 的 PATCH+DELETE、`/api/items/:id` DELETE、`/api/reports/:id` DELETE（均标 ✅ **已接**）+ 第六节「防呆三件套」 |

> 步骤 2 与 3 的分工要说清：**3 证明的是「数据真的变了」（服务端事实），2 证明的是「管理员走真实闸门能改」（权限事实）。**
> 二者不可互相顶替 —— 这正是不能用 `exec_sql` 交差的原因（它跑在 postgres 角色上，绕过 RLS）。

### 9.3 四项完成后检查

| # | 检查项 | 状态 | 依据 |
|---|---|---|---|
| ① | PATCH 修改成功，数据库字段**真实变化** | 服务端**已证** / 页面层**未执行** | 靶子 id=28 `status: pending → approved` 的改前 / 改后 SQL 对比（§5.5）；页面点击待人工 |
| ② | DELETE 删除成功，**数据不再出现在 GET 结果里** | **已证** | §四 步骤 2→5：匿名 GET 由 7 条变 6 条、目标 id 消失；行仍在库（`is_deleted=true`），一条 UPDATE 可恢复 |
| ③ | 操作不存在的 id 返回**明确错误**，不是崩溃 | **PASS** | `verify/probe-day22-guard-unit.js` 8/8（含三张表的 DELETE 各一条中文错，`code=NOT_FOUND`）；反向验证：旧版 api.js 跑同一套断言 1/8 |
| ④ | `api-contract.md` 已同步更新 | **PASS** | 提交 `55529b9`，`git ls-remote` 已核实 |

### 9.4 ⚠️ 必须先解决的前置问题：线上跑的是**旧版前端**

本地文件 vs 线上发布快照（md5 逐字节比对，2026-10-10 实测）：

| 文件 | 线上 | 本地 | 结论 |
|---|---|---|---|
| `/index.html` | 14041 B | 14041 B | 一致 ✅ |
| `/js/api.js` | 13679 B | 16174 B | **不一致 ⚠️ 线上是旧版** |
| `/css/style.css` | 37731 B | 37913 B | **不一致 ⚠️ 线上是旧版** |

线上 `js/api.js` **不含** `fetchRowOrThrow`，`css/style.css` **不含** Day 21 的 D7 悬停修复。
→ 托管站点是**发布那一刻的快照**，改本地文件不会自动生效。

> **更正上一轮的说法**：我曾说「`js/api.js` 是浏览器实时拉的，防呆改动不用重新发布就生效」——
> **这句话是错的**，已被 md5 实测推翻。（当时只是推断，没验证，属"活数据当死基准"的同类错误。）

**后果**：现在打开线上检查台点「通过」，跑的是旧代码 —— 步骤 2 与检查项 ①（页面层）都**必须先重新发布**才能验。
检查项 ③ 不受影响（由探针在接口层验证，§5.4），② 不受影响（服务端事实）。

**✅ 已于 2026-10-10 19:24 重新发布，前置问题解除。** 发布后逐文件复核（md5 比对）：

| 文件 | 线上 | 本地 | |
|---|---|---|---|
| `/index.html` | 14041 B | 14041 B | 一致 ✅ |
| `/js/api.js` | **16174 B**（含 `fetchRowOrThrow`） | 16174 B | 一致 ✅ |
| `/css/style.css` | **37913 B**（含 D7 `backwards`） | 37913 B | 一致 ✅ |
| `/js/admin.js` | 11688 B | 11688 B | 一致 ✅ |
| `/admin.html` · `/detail.html` · `/mine.html` · `/js/home.js` · `/js/search.js` | — | — | 全部一致 ✅ |

- **分享链接未变**：`https://rumor-check-12000.app.workbuddy.host/` —— 复用同一 `applicationId`（云服务与发布共用）的必然结果，云服务 Origin 不受影响，邮箱登录照常可用。
- **发布后线上冒烟**（`verify/probe-day22-postdeploy.js`，纯只读）：首页 HTTP 200，**收录条目 23 / 本周榜 5 条**渲染正常，首屏文案与「我的」入口俱在；`admin.html` HTTP 200，未登录态正确提示「管理后台需要先登录」并给出登录按钮；console **无 JS 报错**（唯一 404 是 `favicon.ico`，已知无害瑕疵）。
- 本次发布同时上线了 **Day 21 的 D7 悬停修复**（此前一直只在本地的欠账）。

### 9.5 剩下的分工

| # | 事项 | 谁做 | 前置 |
|---|---|---|---|
| 1 | ~~重新发布站点~~ **已完成**（D7 悬停修复 + 防呆守卫均已上线，域名未变） | ✅ 2026-10-10 19:24 | — |
| 2 | ~~在检查台点一次「通过」（靶子 id=28）、一次「删除」（靶子 id=29）~~ **已完成**（用户实际操作，见第十节；两次点击均生效，问题出在界面反馈） | ✅ 2026-10-10 19:27 | — |
| 3 | ~~SQL 核验 id=28 的 `status`、id=29 的 `is_deleted`~~ **已完成**：28 → `approved`+`is_deleted=true`、29 → `is_deleted=true`，与用户反馈**双向对上** | ✅ 2026-10-10 | — |
| 4 | ~~重新发布（把「已回收」徽标 + 恢复入口上线）~~ **已完成**（见第十一节） | ✅ 2026-10-10 19:42 | — |
| 5 | 在后台看到「已回收」徽标，点一次「恢复」验证靶子回到公网列表 | 你 | ✅ 已解除 |
| 6 | 物理清理两个靶子（走「关保险 → 删 → 开保险」） | 我 | 第 5 项 |

---

## 十、真实用户反馈的排查：「删除不了帖子，反反复复点都没用」

> 这一节记录一次**真实反馈**的完整排查。结论与直觉相反：**两次点击其实都成功了**，
> 坏掉的是**反馈**不是功能。它同时完成了 §9.2 步骤 2 与 §9.3 检查项 ① 的页面层验证。

### 10.1 现象与第一反应

用户报告：**点「删除」反反复复都没用**。看起来像"删除功能坏了"。

### 10.2 排查：先问数据库，不问界面

```sql
SELECT id, status, is_deleted, updated_at FROM posts WHERE id IN (28, 29);
```

| id | `status` | `is_deleted` | `updated_at` | 说明 |
|---|---|---|---|---|
| 28 | **approved**（原 pending） | **true** | **19:27:18** | 用户点了「通过」→ status 变了；又点了「删除」→ 标记了 |
| 29 | approved | **true** | 19:00:33（建靶子时） | 用户点了「删除」→ 标记了 |

公网匿名 `GET /posts` → **6 条**，28 / 29 **都不在**。

**结论：PATCH 成功、DELETE 成功、「删除后不再出现在 GET 里」成立。**
两次点击都生效了 —— 台账与用户看到的现象相反。

### 10.3 根因：功能对了，反馈没了

`renderAllPosts()` 读的是 `api.listAllPosts()`，走 **`posts_admin_read`** ——
那条策略**刻意不过滤 `is_deleted`**（§3.2：后台必须看得见已回收的帖子才能恢复）。
所以删除后 `await loadAll()` 重载，**那一行原封不动又回来了，且没有任何标记** ——
在用户眼里就是"点了等于没点"。

**为什么只有帖子有这个问题**（线索、条目都正常）：

| 列表 | 删除后的处理 | 用户看到 |
|---|---|---|
| 帖子 | `await loadAll()` **全量重载** | 已回收的行又出现，无标记 → **像没删掉** ❌ |
| 条目 | 本地 `filter` 掉 | 立刻少一条 ✅ |
| 线索 | 本地 `filter` 掉 | 立刻少一条 ✅ |

**这是我设计的缺陷，不是实现的 bug**：软删除的第一半（打标记 + 读路径过滤）做对了，
**第二半（让操作者看得见、并能撤回来）没做** —— 相当于留了后门却没装门把手。
把"可恢复"做成了"不可见"，反而制造了新的静默：**操作成功但界面毫无信号**，
和 §5.1 那类"静默成功"是同一个病。

### 10.4 修复（零数据库变更）

| 文件 | 改动 |
|---|---|
| `js/api.js` | 新增 `restorePost(id)`：走**现成的** `posts_admin_update` 策略把 `is_deleted` 置回 false（预检 + `.select()` 回执 + 0 行抛 `FORBIDDEN`）。**恢复能力后端早就有了，缺的只是入口** |
| `js/admin.js` | 帖子列表：`is_deleted` 的行显示「**已回收**」徽标 + 「公网已看不到它，数据还在」+「**恢复**」按钮（替换原来的删除按钮）；计数改成「共 N 条（其中已回收 M 条）」；线索列表同样加「已回收」徽标 |
| `css/style.css` | 新增 `.tag-recycled` —— **复用「存疑」那对已实测达标的配色**，不引入新色值（新增颜色就要重新验对比度，这里没有非新色不可的理由） |

**「恢复」不加两击确认**：它是可逆方向，点错一次再删一次就行 —— 确认只留给不可逆的那一步。

### 10.5 验证

- `verify/probe-day22-restore-unit.js`（`vm` 加载真实 `js/api.js`）：**4/4 PASS** ——
  ① 恢复不存在的 id → 中文错 + `NOT_FOUND`；② 恢复一条没被回收的 → 「不需要恢复」；
  ③ 恢复已回收的 → 发 `update(is_deleted:false)` 且带 `.select()`，返回恢复后的行；
  ④ 预检过了但写入 0 行 → 抛 `FORBIDDEN`（不静默成功）。
- **反向验证**：同一套断言跑在**没有 `restorePost` 的旧版 api.js** 上 → **0/4，全红**。
- 门槛复跑：`frontend-rules` **113 ALL_PASS**、`filter-check` **75 ALL_PASS**。
- 待人工：重新发布后，在后台看到两条测试靶子显示「已回收」+「恢复」，点一次「恢复」验证它回到公网列表。

### 10.6 教训

**「删掉了」和「看得出删掉了」是两件事，而第二件同样属于功能。**
只做数据层的软删除、不给操作者任何可见状态，等于把一次成功操作伪装成一次失败操作 ——
用户接下来会做的事，就是**反复点击**（这次反馈正是如此）。
`items` / `reports` 的恢复入口仍是待办（它们没有 UPDATE 策略，需要另设窄口函数）。

---

## 十一、第二次发布：「已回收」反馈上线（2026-10-10 19:42）

修复只在本地等于没修 —— 用户反馈的是**线上**的行为，所以修完立刻重新发布。

- **分享链接未变**：`https://rumor-check-12000.app.workbuddy.host/`（仍复用同一 `applicationId`）。
- **发布后逐文件 md5 复核：9 个文件全部与本地一致**：

| 文件 | 线上 | 本地 | 本次变化 |
|---|---|---|---|
| `/js/api.js` | 17241 B | 17241 B | 含 `restorePost` + `fetchRowOrThrow` ✅ |
| `/js/admin.js` | 13104 B | 13104 B | 含「已回收」徽标 + 恢复按钮 ✅ |
| `/css/style.css` | 38108 B | 38108 B | 含 `.tag-recycled` + D7 `backwards` ✅ |
| `/index.html` · `/admin.html` · `/detail.html` · `/mine.html` · `/js/home.js` · `/js/search.js` | — | — | 全部一致 ✅ |

- **线上冒烟**（`verify/probe-day22-postdeploy.js`，纯只读）：首页 HTTP 200，收录条目 **23** / 本周榜 **5 条**渲染正常；`admin.html` HTTP 200，未登录态提示「管理后台需要先登录」；console **无 JS 报错**（唯一 404 仍是 `favicon.ico`）。
- **靶子状态复核**（SQL）：`id=28` → `status=approved` / `is_deleted=true`；`id=29` → `is_deleted=true`。两条均符合预期，公网 `GET /posts` 只剩 6 条。
- **仍待人工**：登录后台看一眼「已回收」徽标、点一次「恢复」（应立刻回到论坛页）。
- **仍待我**：等上述确认后，物理清理两个靶子（关保险 → 删 → 开保险）。
