# 第 3 周验收表 + 演示提纲（Day 21 周验证日）

> 项目：热门时事真伪辨别网站（foxlings-project）——对应课程「今日热搜」案例的自选项目实现
> 验收时间：2026-10-09｜站点：https://rumor-check-12000.app.workbuddy.host/
> **状态只有三档：PASS / FAIL / 未执行**（无「基本完成」）。每项均写明验证方式与证据。

---

## 一、验收表

### ① 建表和种子脚本可重复执行（有 select 证据）

**怎么验证**：把同一份脚本对同一数据库**连续执行两次**，第二次不得报错，且执行后用 `SELECT` 核对行数与内容不变。

| 子项 | 状态 | 证据 |
|---|---|---|
| 建表脚本 `db/schema.sql` 重复执行 | **FAIL** | 重跑 `CREATE TABLE items` → `DATABASE_42P07 relation "items" already exists`（云端实测）。原因：`items` / `posts` / `reports` / `profiles` 均为裸 `CREATE TABLE`，**无 `IF NOT EXISTS`、无 `DROP`**（仅 `admins` 写了 `IF NOT EXISTS`） |
| 种子脚本（完整模式 `node db/json-to-sql.js`）重复执行 | **FAIL（有破坏性副作用）** | 代码层证据 `db/json-to-sql.js:86-93`：脚本自带 `BEGIN; TRUNCATE TABLE items CASCADE; INSERT …; COMMIT;` ——**不会报错**，但 `TRUNCATE … CASCADE` 会沿外键把引用 `items` 的 `posts` 表一并清空（`posts.item_id REFERENCES items(id)`）；即"能重跑"的代价是**连带清空论坛**。⚠️ 此项为代码层判定，未在生产库实测清空效果 |
| 种子入库通道（`--single` 模式，实际入云库用的就是它）重复执行 | **FAIL** | 重跑该 INSERT → `DATABASE_23505 duplicate key value violates unique constraint "items_pkey"`（云端实测）。脚本生成的 INSERT **无 `ON CONFLICT`** |
| 执行后的 select 证据（数据未被破坏） | PASS | 两次失败语句后 `SELECT`：`items 23 / posts 7 / reports 1 / 探针残留 0` —— 语句原子失败，未写入任何行 |

**结论：本项 FAIL。** 修法（见第三节）：schema 加 `IF NOT EXISTS` 与 `DROP POLICY IF EXISTS`；`--single` 的 INSERT 补 `ON CONFLICT (id) DO UPDATE SET …`；完整模式去掉 `CASCADE`。修完需再连续执行两次并给 select 证据。

### ② GET 接口公网可访问且返回真实数据库数据

**怎么验证**：从公网直接请求数据接口，核对返回行数与字段；再打开公网页面，比对页面首条与云库同一条记录一致。

- 状态：**PASS**
- 证据：公网请求 `GET /.cloud/database/rest/items` → **200，返回 23 行**（与云库行数一致，非 mock）；
  公网页面 `#/board` 卡片数 7，**首条卡片标题 = 云库热度榜首条目**（`【示例】网传「10 月起养老金统一上调 8%」？`），
  首条 meta `信源 3 条 · 浏览 9 次` —— 浏览数来自云端 `views` 列，是真实库值。
- 探针：`verify/probe-day21-accept.js`（输出见第四节运行记录）

### ③ POST 接口完成真实写入并读回

**怎么验证**：提交一条数据 → 拿到成功响应 → **换一条通道把它读回来**，确认字段与提交内容一致。

- 状态：**PASS**
- 证据：`POST /.cloud/database/rest/reports` → **201**；随后服务端 `SELECT` 读回：
  `id=12, author_id=anon, status=pending, text=[验收探针] Day21 POST 写入读回 …, created_at=2026-10-09 23:04:38+08` —— 内容、时间戳、作者标识全部对上。
- 边界一并验证：**匿名提交后客户端读不回**（`GET reports` → 401 `permission denied for table reports`）——这是 `reports_read_own` 策略的预期行为，不是缺陷；
  对照测试 `PATCH items.heat` → **401 `permission denied for table items`**，证明写闸门对客户端关闭。
- 写入数据已清理（`DELETE FROM reports WHERE text LIKE '[验收探针]%'`，清理后 `reports` 仅剩 1 行种子）。
- 探针：`verify/probe-day21-post.js`

### ④ 数据访问层重构完成且接口行为不变

**怎么验证**：① 静态断言——页面脚本不得绕过接口层直连数据源；② 运行时断言——页面发出的数据请求必须全部走接口层，且页面渲染结果与重构前一致。

- 状态：**PASS**
- 证据：
  - 静态：`frontend-rules` 硬门槛 **A 组全过**（页面脚本出现 `cloud.database` / `cloud.storage` / `.from(` / `rpc(` / `fetch(` 即判失败），全量 **113 项 ALL_PASS**；
  - 运行时：公网页面加载期间 `.cloud/database/` 请求 **4 次**、`data.json` / `posts.json` 请求 **0 次**（数据源唯一）；
  - 行为不变：页面卡片数 7、首条标题与云库榜首逐字一致、无 JS 报错（唯一 console 错误为已知无害的 `favicon.ico` 404）。

### ⑤ 检查台公网可访问 + 同伴从自己设备打开成功

**怎么验证**：① 公网 HTTP 探测 + 19 项检查表复跑；② 同伴用**自己的设备与网络**打开链接并勾选三项。

| 子项 | 状态 | 证据 |
|---|---|---|
| 检查台公网可访问 | **PASS** | 公网检查 `probe-online.js` **19/19 PASS**（2026-10-09 复跑）；检查表 `docs/day20-public-check.md` |
| 同伴从自己设备打开成功 | **未执行** | 同伴交叉验证当日未进行；周报第五节留空待回填（清单已备：打开链接 → 检索一条 → 登录发帖看审核提示，三项自己勾） |

### ⑥ 响应形状与 api-contract.md 一致

**怎么验证**：取公网返回的原始 JSON，逐字段比对 `api-contract.md` 第一节的字段清单与取值约束。

- 状态：**PASS**
- 证据（`items`，23 行）：
  - 契约字段**全部存在**：`id / title / verdict / summary / sources / origin / first_seen / updated_at / heat / heat_note / views / cross_check`；
  - 额外列仅 `created_at`（契约已注明为入库审计字段，前端不使用）；
  - 取值约束成立：`verdict` 仅四档 `真/假/存疑/部分属实`；`sources` 全为数组且**最少 2 条**（与 `CHECK jsonb_array_length(sources) >= 2` 一致）。
- 证据（`posts`，7 行）：契约字段**全部存在**、无额外列；`status` 取值仅 `approved`（RLS 只放已过审）。
- 探针：`verify/probe-day21-accept.js`。

### 汇总

| # | 验收项 | 状态 |
|---|---|---|
| ① | 建表和种子脚本可重复执行 | **FAIL**（建表 + `--single` 入库通道均不可重跑；完整模式可重跑但有清空 posts 的副作用） |
| ② | GET 接口公网可访问且返回真实数据库数据 | **PASS** |
| ③ | POST 接口完成真实写入并读回 | **PASS** |
| ④ | 数据访问层重构完成且接口行为不变 | **PASS** |
| ⑤a | 检查台公网可访问 | **PASS** |
| ⑤b | 同伴从自己设备打开成功 | **未执行** |
| ⑥ | 响应形状与 api-contract.md 一致 | **PASS** |

---

## 二、3–5 分钟演示提纲

**演示链接**：https://rumor-check-12000.app.workbuddy.host/

### 0:00–0:40　用户问题

> "家族群里转来一条『10 月起养老金统一上调 8%』，配了张红头文件截图。我信还是不信？"
> 痛点：**判断真假靠感觉，且找不到可信来源**——不是缺一个"判决"，是缺**可核对的证据链**。
> 产品定位一句话：**证据整理员，不是审判官**；每个结论都有信源可溯。

### 0:40–2:00　核心流程（现场走一遍）

1. **辟谣榜**（首页）：排行榜式条目，序号 + 热度 + 四档结论标签 + 摘要；首条即养老金那条。点开详情 →
2. **详情页**：结论 / 大白话依据 / **多条信源逐条可点开**（官方来源 + 网络来源分组）/ 最早出处与查证日期 → 返回。
3. **查询检索**：输入关键词走 L1 站内检索；切到「全网溯源」走 L3 → **AI 拆解 + 指路**四段卡片（拆解传言 → 关键事实点 → 建议检索式 → 官方/网络两组入口一键带入）。
4. **线索与社区**：查不到的直接「提交线索」（未登录也能交，进待核查队列）；论坛发帖求助 → 提示"已进入审核队列"，**后台过审后才公开**。
5. **个人主页**：昵称 / 签名 / 头像（真图片上传）、收藏与浏览足迹。

### 2:00–3:00　提示词改写（本次的"AI 用法"关键点）

| 原始想法 | 改写后 | 为什么 |
|---|---|---|
| "让 AI 判断这条传言是真是假" | "把这条传言**拆成可检索的关键事实点**，给出**检索式**，**不要判断真伪**，不要编造，不要输出网址" | ① 本环境后端**没有联网检索通道**，AI 判断必然靠训练数据"编"，等于把幻觉包装成结论；② 官方定位是「证据整理员」——**判断权交回用户**，AI 只降低"我该从哪查"的门槛 |

落地：系统提示词在应用侧写死（`js/ai.js`），页面只许调 `ai.digest()`；**AI 不判真伪是产品铁律，不是提示词技巧**。
实测选型：`hunyuan-chat` 首字 1.4s（目录默认模型首字 150s 不可用，依据写在 `js/ai.js` 注释里）。

### 3:00–4:00　验证方式（怎么证明它真的能用）

| 层面 | 怎么验 | 本轮结果 |
|---|---|---|
| 数据真实性 | 公网直接查接口 + 页面首条 vs 云库同条比对 | 23 行来自真库；首条逐字一致（验收表 ②） |
| 写入闭环 | 提交 → 换通道读回 → 清理 | 201 + 读回 id=12（验收表 ③） |
| 权限边界 | 匿名读自己的线索 / 客户端直接改 items | 均 401 被拒（预期行为） |
| 回归底线 | 两套硬门槛 + 公网 19 项 | 113 + 75 + 19 全过 |
| 重构无回退 | 静态分层断言 + 运行时请求来源统计 | 分层 0 违规；`.cloud/database/` 4 次、`data.json` 0 次 |

### 4:00–4:30　收尾与已知边界（如实说）

- 已上线运行：域名固定，数据真实，权限经数据库三层闸收口；
- 待补：匿名提交与头像上传**无频控**、浏览量去重是**本机级**、AI 不联网（有明确的降级方案）；
- 完整清单见 `docs/cloud-data-service-v1.md` 第七节。

---

## 二·附　数据建模对照（课程「主对象 + 记录」范式 → 本项目）

课程给的范式是「**一个主对象 + 一堆时间累积的记录**」两张表（示例：`plan_days` / `checkins`、`books` / `reading_logs`）。本项目落在同一范式上，但记录流有**两条**（线索流与社区流）：

| 范式角色 | 课程示例 | 本项目对应 | 关键字段 |
|---|---|---|---|
| 主对象 | `plan_days` 每日计划 | **`items` 核查条目** | `id / title / verdict / summary / sources(JSONB) / origin / first_seen / updated_at / heat / views` |
| 记录 ① | `checkins` 打卡记录 | **`reports` 用户线索流** | `id / text / author_id / status(pending\|approved\|rejected) / item_id / created_at` |
| 记录 ② | —（本项目扩展） | **`posts` 论坛帖流** | `id / title / body / author_id / item_id / status / replies / created_at` |
| 支撑表 | — | `profiles` / `admins` | 身份与权限，不是业务主对象 |

两条设计取舍：
1. **信源不拆表**：`sources` 用 JSONB 内嵌在 `items` 里——它永远跟条目一起读，拆表只会多一次 join，符合"主对象"聚合根的定义；
2. **浏览量走函数不入记录流**：`views` 是 `items` 上的一个计数列，靠 `bump_item_view()` 原子 +1，**不为它建一张"浏览记录表"**——因为站内不需要"谁在什么时候看过"，只需要一个数；建表反而把可聚合的信息降级成难用的明细。

（详细交付说明见 `docs/cloud-data-service-v1.md` 第二节。）

---

## 三、当天发现的待修项（不在本次验收要求内，附在此处备查）

| # | 问题 | 影响 | 建议动作 |
|---|---|---|---|
| 1 | `db/schema.sql` 与 `--single` 种子脚本**不可重复执行** | 验收项 ① FAIL；重灌种子时要手工绕 | schema 加 `IF NOT EXISTS` / `DROP POLICY IF EXISTS`；INSERT 补 `ON CONFLICT (id) DO UPDATE`；完整模式去掉 `CASCADE` |
| 2 | 卡片悬停位移曾失效（`animation-fill-mode: both` 锁死 transform） | 视觉细节 | 已于当日修复并加固门槛（B1/B1b），**线上待发布** |

---

## 四、探针运行记录（原始输出摘要）

> 证据复核：**2026-10-09 23:10 重跑** `probe-day21-accept.js`，数值与出表时逐项一致（`items 23 / posts 7 / 浏览 9 次 / .cloud/database/ 4 次 / data.json 0 次`）。
> 该探针只打开榜单、**不打开详情页**，因此不会给自己刷浏览量、不污染被验数据。

```
$ node verify/probe-day21-accept.js
① items 行数 23 | 字段 id,title,verdict,summary,sources,origin,first_seen,updated_at,heat,heat_note,cross_check,created_at,views
  items 契约字段全在: true | 多出的列: created_at
  posts 行数 7 | 契约字段全在: true | 多出的列: (无)
  verdict 取值: 存疑/真/部分属实/假 | sources 是数组: true | sources 最少条数: 2
  posts.status 取值: approved
② 公网页面卡片数 7 | 云库条目数 23
  首条卡片标题: 【示例】网传「10 月起养老金统一上调 8%」？
  云库热度榜首: 【示例】网传「10 月起养老金统一上调 8%」？ | 一致: true
  首条 meta: 信源 3 条 · 浏览 9 次（点开详情可逐一验证）
  运行时请求 / .cloud/database/ : 4 次 | data.json: 0 次
  JS 报错: console: Failed to load resource: the server responded with a status of 404 ()   ← 已知 favicon.ico

$ node verify/probe-day21-post.js
对照 · PATCH items.heat -> 401 {"code":"DATABASE_42501","message":"permission denied for table items"}
① POST reports -> 201
② 匿名回读 reports -> 401 {"code":"DATABASE_42501","message":"permission denied for table reports"}

$ 云端（exec_sql）重复执行测试
CREATE TABLE items (id text PRIMARY KEY)  -> DATABASE_42P07 relation "items" already exists
INSERT 同 id 一行（同 --single 形态）      -> DATABASE_23505 duplicate key value violates unique constraint "items_pkey"
事后核对                                   -> items 23 / posts 7 / reports 1 / 探针残留 0
```

---

**探针脚本**（工作区 `verify/`）：`probe-day21-accept.js`（形状 + 公网真数据 + 分层）、`probe-day21-post.js`（写入门禁 + POST 读回）
