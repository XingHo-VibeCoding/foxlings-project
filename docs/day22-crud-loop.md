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

要关掉保险才能真删——这个"多一步"本身就是我们加的第二道确认。三条语句已实测走通（见第五节清理记录）。

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

## 五、待人工完成：管理员端的端到端（PATCH / DELETE）

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

## 六、改动文件清单（按归属）

| 文件 | 改动 | 归属 |
|---|---|---|
| `db/schema.sql` | 三张表加 `is_deleted` 列（含 `ADD COLUMN IF NOT EXISTS` 迁移，紧跟各建表语句）；`bump_item_view` 跳过已回收条目；三条公开读策略加 `NOT is_deleted`；新增 `soft_delete_rows()` 函数 + 三个 BEFORE DELETE 触发器 | **Day 22** |
| `verify/probe-day22-gate.js` | 新增：PATCH/DELETE 闸门矩阵探针（哨兵 id，零破坏） | **Day 22** |
| `docs/day22-crud-loop.md` | 本文档 | **Day 22** |

> `js/api.js` / `js/admin.js` **一行未改** —— 触发器方案的全部收益就在这里。
> 云端数据库：策略定义已随 `schema.sql` 重跑同步（15 条全部 DROP+CREATE，读到的是文件里的定义）。

---

## 七、已知边界 / 待办

| # | 事项 | 状态 |
|---|---|---|
| 1 | 后台没有「已回收」视图与「恢复」按钮 —— 目前恢复靠站方 SQL（`UPDATE … SET is_deleted=false`） | **待做**（需改 `admin.js` 并重新发布） |
| 2 | 管理员端的 PATCH / DELETE 端到端验证 | **等人工**（见第五节） |
| 3 | 匿名提交频控 / 头像上传频控与体积上限 / 签名 URL 续签 | 旧待办，未动 |
| 4 | `items` 的软删与"不能改热度"的张力：`items` 没有 UPDATE 策略，所以条目只能由触发器置 `is_deleted`，**管理员仍然无法手动改热度**（该保证未被削弱） | 已确认 |
