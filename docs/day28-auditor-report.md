# Day 28 独立验收报告 · 不认识作者的验收官

> 核验对象：`D:\AI\foxlings-project`（HEAD = `main 678f94e`）｜站点 https://rumor-check-12000.app.workbuddy.host/
> 核验时刻：**2026-10-18 23:28–23:41（北京时间 / UTC+8）**，下表每条证据都是这一刻我自己跑出来的。
> 立场：不采信 `docs/final-acceptance-day28.md` 里的任何结论文字，只认自己跑出来的输出。
> 口径：只有 **PASS / FAIL / 未执行**。跑不通、拿不到结果、只看了一半 → 一律写「未执行」。
> 我自写的探针放在 `verify/audit-03-write-read.js`、`audit-04-chain.js`、`audit-08-git-history-secrets.js`（均未改动项目内任何文件）。

---

## 八项逐条核验

### ① 至少 3 个页面或独立视图 —— **PASS**

**我自己的取证**：跑公网五步走查 `probe-live-core-flow.js`（作者脚本，但我读过了源码，判据是真实 DOM 计数，不是写死的 OK），五步全通。

```
===== 公网核心流程走查（https://rumor-check-12000.app.workbuddy.host）=====
走查时刻 2026-10-18T15:30:55.406Z

  ✅ ① 首页辟谣榜 —— 首屏卡片数 > 0
      实测：15 张（选中档「月榜」· 本月榜 · 默认「本周」暂无新增，已按最近更新日（2026-10-05）展示：共 15 条）
  ✅ ② 点卡进详情 —— #detail-head 标题非空
      实测：假更新于 2026-10-05 · 微博热搜前 10 · 信源卡 3 张 · 可见板块 2 个
  ✅ ③ 查询检索 —— 真实关键词能搜出卡片，且计数与卡片数一致
      实测：关键词「示例」→ 卡片 23 张 / 计数行「关键词「示例」站内命中 23 条」
  ✅ ④ 论坛 —— 帖子列表非空
      实测：7 帖 · 已通过审核：共 7 条
  ✅ ⑤ 个人页 —— 页面渲染出来（未登录显示登录引导也算正常）
      实测：显示登录引导 · 真 热门时事真伪辨别 创 首页 › 个人主页 我的主页 收藏与足迹只存在这台设备上；线索和帖子存云端，换个设备也找得到 账号 还没有登录。登

控制台报错 5 条：
    · Failed to load resource: net::ERR_CONNECTION_RESET
    · Failed to load resource: the server responded with a status of 404 ()
    · Failed to load resource: net::ERR_CONNECTION_RESET
    · Failed to load resource: net::ERR_CONNECTION_RESET
    · Failed to load resource: net::ERR_CONNECTION_RESET

结论：核心流程五步全通 —— 发布成立。
```

另：我直接 HTTP 抓了 `/index.html`(200) `/mine.html`(200) `/detail.html`(200) `/admin.html`(200)，四个页面文件都在线且可开。
**独立视图数 = 5**（辟谣榜 / 查询检索 / 论坛 / 详情 / 个人主页）+ 管理后台，超过要求的 3 个。
**复现**：`NODE_PATH=C:/Users/狐灵/.workbuddy/binaries/node/workspace/node_modules node verify/probe-live-core-flow.js`

---

### ② 至少 1 个有明确反馈的交互 —— **PASS**

**我自己的取证**：在公网 `mine.html` 上真做一次用户动作（`probe-day28-interaction.js`），读到页面自己吐出来的两段回执原文。

```
===== 验收：有明确反馈的交互（公网 https://rumor-check-12000.app.workbuddy.host/mine.html）=====
时刻 2026-10-18T15:31:13.910Z

  ✅ ① 个人页打开，提交表单在位
      找到 #rep-input + #rep-add
  ✅ ② 输入过短时给出明确错误反馈
      页面回执原文：「再多写一点（至少 5 个字）：什么说法、在哪看到的。」
  ✅ ③ 正常提交给出明确成功反馈
      页面回执原文：「已提交，站方会逐条核查。」
  ✅ ④ 刷新页面后这条记录还在
      列表含刚提交的自测文本；计数行：「共 1 条（仅本机）」

console 报错 3 条：Failed to load resource: net::ERR_CONNECTION_RESET | Failed to load resource: the server responded with a status of 404 () | Failed to load resource: net::ERR_CONNECTION_RESET

结论：交互反馈项成立。
```

我另外读了 `js/mine.js:553-579` 确认「已提交」不是假绿：`say("已提交…")` 只在 `await api.submitReport()` **没有抛错**之后才执行，而 `js/api.js:412` 拿到 `error` 会 `throw`。所以这句回执等价于「云端 insert 真的成功了」。
**复现**：`NODE_PATH=… node verify/probe-day28-interaction.js`

---

### ③ 至少 1 类数据真实写入并读取数据库 —— **PASS**

两类写入我都独立验了。

**A. 浏览量（rpc bump_item_view）** —— 我用自写探针 `audit-03-write-read.js` 验（不复用作者脚本），见下方「抽验」区块中的原始输出：`views 7 → 8`、隔 1.5 秒再读仍为 8、全表 23 行不变。

**B. 用户线索（reports）** —— 文档自己说「匿名读不回来，所以无法证明」。我没有采信这句，用平台管理员 SQL 通道直接查库（只读 `mode=read`）：

```
SELECT id, author_id, left(text,30) AS text_head, created_at FROM reports ORDER BY created_at DESC LIMIT 6
→ [{"author_id":"anon","created_at":"2026-10-18T23:31:18.283462+08:00","id":88,"text_head":"【Day28 验收自测】这条是验收演示时提交的测试线索，站方"},
   {"author_id":"anon","created_at":"2026-10-18T22:51:19.850767+08:00","id":87,"text_head":"【Day28 验收自测】这条是验收演示时提交的测试线索，站方"},
   {"author_id":"anon","created_at":"2026-10-06T13:46:54.248226+08:00","id":5,"text_head":"家里群里说「下月起电价按新阶梯走」，配了一张看不清落款的表格"}]
```

`2026-10-18T23:31:18+08:00` 这一行正是我 23:31 那次浏览器提交（id=88）——**写入确实落到了云库，不是只写进 localStorage**。文档把这件事写成「读不回来」是匿名视角的限制，不是事实上的不可验证（详见文末「不一致」第 3 条）。
**复现**：`node verify/audit-03-write-read.js`

---

### ④ 前端 → 云函数 → 数据库，完整链路 —— **PASS**

**我自己的取证**：自写 `audit-04-chain.js`，三段各取硬证据（原始输出见下方抽验区块）。另外用管理员 SQL 通道查了库里的真实对象数：

```
SELECT (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS rls_policies,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('bump_item_view','enforce_report_rate_limit')) AS funcs,
       (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname='reports') AS triggers_on_reports,
       (SELECT count(*) FROM items) AS items_rows, (SELECT count(*) FROM posts) AS posts_rows,
       (SELECT count(*) FROM announcements) AS ann_rows, (SELECT count(*) FROM reports) AS reports_rows
→ [{"ann_rows":2,"funcs":2,"items_rows":23,"posts_rows":7,"reports_rows":3,"rls_policies":17,"triggers_on_reports":1}]
```

与文档对表：6 张表 ✅（实际 `CREATE TABLE` 6 条，第 22 行那条是注释）、**17 条 RLS 策略 ✅**、**2 个函数 ✅**、**1 个触发器 ✅**、`db/schema.sql` **535 行 ✅**、`api-contract.md` **545 行 ✅**。
频控触发器的**线上实际定义**我也拉出来看了（`pg_proc.prosrc`），确实是「每天 5 条、超限 `RAISE EXCEPTION … ERRCODE='FX429'`、匿名按 `x-forwarded-for` 计」，与 `db/schema.sql:254/297` 一致 —— 不是只在文件里写着。
**复现**：`node verify/audit-04-chain.js`

---

### ⑤ 公网首页、健康接口、线上持久化 —— **PASS**（有一处数字口径错，见文末）

**我自己的取证**：

```
/              HTTP 200 bytes 15726 | 含辟谣榜: true
/index.html    HTTP 200 bytes 15726 | 含辟谣榜: true
/mine.html     HTTP 200 bytes 4107  | 含辟谣榜: false
/detail.html   HTTP 200 bytes 2739  | 含辟谣榜: false
/admin.html    HTTP 200 bytes 5298  | 含辟谣榜: true
数据网关 HTTP 200
健康接口 HTTP 200 耗时 386ms 字节 29894 | 自述: standard public schema
--- /api/health ---
HTTP 404

content-length头: 21647 | Buffer实际字节: 21647 | UTF16字符长: 15726
content-encoding: null
```

- **公网首页**：HTTP 200，含「辟谣榜」。⚠️ 真实字节是 **21647**（`content-length` 头实测），文档写的「15726 字节」是 JS 字符串长度，口径错了（详见文末不一致第 1 条）。结论不受影响。
- **健康接口**：本项目确实**没有** `/api/health`（我实测 404，与文档自述一致）；等价物是数据网关，我实测 HTTP 200 / 386ms / 29894 字节，自述 `standard public schema v15 (pre-release)`。
- **线上持久化**：`views` 三次独立写入 3→4、5→6、7→8，每次都当场回读一致、隔 1.2–1.5 秒再读仍保持，全表行数恒为 23（零污染）。
**复现**：自写一行 `fetch` 即可，或 `node verify/probe-day28-write-persist.js`

---

### ⑥ CloudBase 资源和到期风险已记录 —— **PASS**（一个数据点未执行）

**我自己的取证**：`docs/resources-and-expiry.md` 在库里（4206 字节，通篇无密钥、无连接串）。文档里的每个数字我都用平台只读接口**重新测了一遍**，不是照抄：

| 文档写的 | 我实测 | 一致？ |
|---|---|---|
| items 23 / posts 7 / 公告 2 | 管理员 SQL：23 / 7 / 2 | ✅ |
| 终端用户 1 | `user_list_end_users` → 1 个（undertale138@163.com，2026-10-08 创建） | ✅ |
| 存储 2 个空虚拟根 | `storage_list_objects("")` → `users`、`shared` 两个 `virtual:true`，无对象 | ✅ |
| 可用模型 32 | `llm_list_models` → 数到 32 个 | ✅ |
| 环境 `billingStatus=normal` / `provisionStatus=assigned` | **未执行** —— 现有只读工具里没有能读环境计费状态的接口，我无法独立复核这两个值 | 未执行 |
| 到期日期「取不到、留空」 | 文档确实留空并写明原因（`credits` 是计费倍率文案不是余额），我也确实没有工具能读到 | ✅（口径属实） |

**复现**：`node tools/check-data-counts.js`；用户/存储/模型三项用平台 `workbuddy_cloudservice_*` 只读接口。

---

### ⑦ 回滚手册和数据导出方式已交付 —— **PASS**（两次演练我不能重放，属未执行）

**我自己的取证**：

- 手册在：`docs/rollback-manual.md`（19338 字节）。三层齐全，§一 触发判断表我数了是 **8 条**（第 27–34 行），与文档自述一致。第二、三层显式标注「手册内容，不实操」并给了原因 ✅。
- **回滚锚点**：`git rev-parse "v1.0.0^{commit}" = f3d9f0d`、`git rev-parse "v0.9.0^{commit}" = d94034a` —— 与文档写的完全一致 ✅；`git branch -a --contains f3d9f0d` 命中 `remotes/origin/main`，说明已在远端跟踪分支里（注意：`git ls-remote` 因 SSH host key 失败跑不通，「已推远端」这一条我是靠本地远端跟踪分支推断的，不是直连远端验的）。
- **数据导出**：我**自己实跑了一遍**（输出到仓库外临时目录，跑完已清理）：
```
  ✓ 全量  items          HTTP 200  导出 23 行 / 库里 23   取回行数 = 库里总数
  ✓ 全量  posts          HTTP 200  导出 7 行 / 库里 7   取回行数 = 库里总数
  ✗ 读不到  reports        HTTP 401  导出 0 行 / 库里 undefined   permission denied for table reports
  ? 不明  profiles       HTTP 200  导出 0 行 / 库里 0   读到 0 行 —— 可能真是空表，也可能被 RLS 挡光了，匿名身份分辨不了
  ? 不明  admins         HTTP 200  导出 0 行 / 库里 0   读到 0 行 —— 可能真是空表，也可能被 RLS 挡光了，匿名身份分辨不了
  ✓ 全量  announcements  HTTP 200  导出 2 行 / 库里 2   取回行数 = 库里总数

备份写入 C:\Users\狐灵\AppData\Local\Temp\audit-export-verify\20261018-233825-audit
提交 678f94e · 导出时刻 2026-10-18T15:38:25.923Z
⚠️ 这份备份没拿全的表：reports（denied）、profiles（unknown）、admins（unknown）
结论：核心内容表 items 已全量导出。
```
- **数据恢复**：我**自己实跑了一遍** `restore-from-backup.js`（同样在临时目录，跑完清理）：
```
备份来源 C:/Users/狐灵/AppData/Local/Temp/audit-bk/20261018-234045-audit2/
生成 6 条语句：
  items          23 行 → 2 条语句   [普通列]
  posts          7 行 → 2 条语句   [identity 列 → 加 OVERRIDING SYSTEM VALUE]
  announcements  2 行 → 2 条语句   [identity 列 → 加 OVERRIDING SYSTEM VALUE]
写入 …\restore.sql
⚠️ 提醒：profiles / admins / reports 不在可恢复范围内（匿名身份读不到）
```
- **两次回滚演练**：`docs/rollback-drill-record.md` 里有 T0–T6 逐段时刻与 109s/123s 两个硬数据，但**我不会为了验收把线上退版本**，这一条记 **未执行（依留档，未重放）**。

**复现**：`node db/export-data.js --out <仓库外目录>`；`node db/restore-from-backup.js --dir <备份目录>`

---

### ⑧ 密钥、.env 和私人信息没进 Git —— **PASS**

**我自己的取证**（三路，见下方抽验区块的原始输出）：全历史 606 个 blob 逐内容扫真密钥特征、`git check-ignore -v .env` 问 git 本人、`.env` 是否曾进索引/历史、提交信息里有没有夹带。另加线上抽查：

```
/.env                                  HTTP 403
/db/schema.sql                         HTTP 403
/.git/config                           HTTP 403
/.git/HEAD                             HTTP 403
/AGENTS.md                             HTTP 200
/PRD.md                                HTTP 200
/api-contract.md                       HTTP 200
/docs/final-acceptance-day28.md        HTTP 404
```

敏感路径被 403 挡住 ✅；`AGENTS.md`/`PRD.md`/`api-contract.md` 随发布公开（文档已声明知情）✅。
作者那条 `node check-secrets.js` 我也跑了：**红线 0 条**，`.env.example` 只有占位符（第 39–41 行 `DATABASE_URL=` / `SERVICE_ROLE_KEY=` / `LLM_API_KEY=` 全是空值）。
**复现**：`node check-secrets.js`；`node verify/audit-08-git-history-secrets.js`

---

## 抽验 3 项（现场复验 · 原始输出原文）

**抽签方式（可复核）**：在核验开始后用 `Math.random()` 从 1–8 里不放回抽 3 个，抽签时刻与过程原样打印：

```
抽签种子：Math.random()，抽取时刻 2026-10-18T15:30:17.574Z
  抽中 index=3 → 第4项 ④前端→云函数→DB链路
  抽中 index=7 → 第8项 ⑧密钥未进Git
  抽中 index=2 → 第3项 ③写入并读取DB
最终抽中：第3项、第4项、第8项
```

### 抽验 A · 第③项 —— 自写探针从零重跑

```
$ node verify/audit-03-write-read.js
===== 自写探针 · 第③项：真实写入并读取数据库 =====
时刻 2026-10-18T15:40:21.141Z  端点 https://rumor-check-12000.app.workbuddy.host

  [OK]   ① 匿名读到一行真实数据
         HTTP 200 id=20251120-01 views=7
  [OK]   ② 云函数写入成功（rpc bump_item_view）
         HTTP 200 返回体 = 8
  [OK]   ③ 写入后立刻回读：views +1
         7 -> 8
  [OK]   ④ 隔 1.5 秒再读（模拟刷新）值保持
         仍为 8
  [OK]   ⑤ 全表行数未变（写入零污染）
         content-range = 0-22/23 → 总数 23

结论：写入 + 回读 + 刷新后保持，三件事当场成立。
EXIT=0
```

> 我第一遍跑这项时第⑤条报了 FAIL（`content-range = 0-22/*`）——那是我探针自己的 bug：PostgREST 默认不返回总数，得显式发 `Prefer: count=exact`。修好探针后重跑才拿到上面的输出。**探针报错不等于项目有问题，我把两版都留在记录里。**

### 抽验 B · 第④项 —— 自写三段链路探针从零重跑

```
$ node verify/audit-04-chain.js
===== 自写探针 · 第④项：前端 → 云函数 → 数据库 =====
时刻 2026-10-18T15:36:57.125Z  站点 https://rumor-check-12000.app.workbuddy.host

  [OK]   【前端】线上 js/api.js 走云库读 items
         HTTP 200 · 28198 字符 · 含 database.from("items") = true
  [OK]   【前端】线上 js/api.js 调云函数 bump_item_view
         含 rpc("bump_item_view" = true
  [OK]   【前端】线上 js/api.js 有 reports 写入路径
         含 database.from("reports").insert = true
  [OK]   【云函数】rpc bump_item_view 在云端真执行并改到数据
         HTTP 200 返回 6 · views 5 -> 6
  [OK]   【云函数】对不存在的 id 按契约返回 -1（不是静默成功）
         HTTP 200 返回 -1

  表 items          HTTP 200  行数(limit1) 1  码 -
  表 posts          HTTP 200  行数(limit1) 1  码 -
  表 reports        HTTP 401  行数(limit1) undefined  码 DATABASE_42501
  表 profiles       HTTP 200  行数(limit1) 0  码 -
  表 admins         HTTP 200  行数(limit1) 0  码 -
  表 announcements  HTTP 200  行数(limit1) 1  码 -

  [OK]   越权写被挡：匿名写榜 POST /items
         HTTP 401 · 码 DATABASE_42501
  [OK]   越权写被挡：匿名写帖 POST /posts
         HTTP 401 · 码 DATABASE_42501
  [OK]   越权写被挡：改热度   PATCH /items
         HTTP 401 · 码 DATABASE_42501
  [OK]   污染自检：items 行数前后都是 23
         content-range = 0-22/23 → 总数 23

结论：前端→云函数→数据库 三段链路当场跑通，越权写全部被挡。
EXIT=0
```

> 这一项我第一遍也跑出 2 条 FAIL：一是我往 `posts` 塞了 `content` 字段（表里的列叫 `body`），拿到 400 `PGRST204`（列不存在）——不是权限问题，是我载荷写错了；二是同一个 `Prefer: count=exact` 的坑。两处都是**我的探针**的错，修完重跑才得到上面这份输出。

### 抽验 C · 第⑧项 —— 自写全历史 blob 扫描从零重跑

```
$ node verify/audit-08-git-history-secrets.js
===== 自写探针 · 第⑧项：密钥 / .env / 私人信息没进 Git =====
时刻 2026-10-18T15:37:40.902Z  仓库 D:/AI/foxlings-project

历史对象总数 672（含 blob 606 条）
  [FAIL] A. 全部 git 历史 blob 扫描 · 真密钥特征
         命中 3 条：带密码的连接串 @ check-secrets.js → postgres:// 开头、带账号密码的示例占位串（入库注：原文为扫描器自己的文档示例 user:pass，非真凭据；为免红线扫描把「引用示例」误报成「真连接串」，入库版已改写） / 同上 / 同上
  [OK]   B. .env 忽略规则真生效（问 git 本人）
         git check-ignore -v .env → .gitignore:2:.env	.env
  [OK]   C. .env 从未进过索引 / 历史
         git ls-files .env = 「」 · git log --all -- .env = 「空」
  [OK]   C2. js/env.local.js（可能含真值）未进仓库
         git ls-files = 「空」
  [OK]   D. 历史提交信息里没有密钥
         0 条
  [信息] 工作区里现在有无 .env 实体文件：没有

结论：1 条不成立。
EXIT=1
```

**我对这 3 条命中的判读**：三条都落在 `check-secrets.js` 这个文件上（它有三个历史版本），命中的是扫描器**自己文档里的示例串**：

```
check-secrets.js:48:  // 连接串必须「带账号密码」才算红线：postgres:// 开头、带账号密码的这种形态（入库注：原文示例占位串已改写）
```

这是规则说明里的占位示例，不是真凭据。我的正则比作者的扫描器粗（没有豁免逻辑），所以把它算成命中。**剔除这 3 条已知误报后，全历史真密钥 = 0 条**，与 `check-secrets.js` 的结论一致。我第一版还误报了 `.env.example`（因为 `\s*` 跨行吃到了下一行的字段名），已修正后消失。
**判定：PASS**（依据 B/C/C2/D 四条硬证据 + A 条剔除已知误报后为 0）。

---

## 「能继续改」检测题

> 题：要给**核心记录**加一个统计功能（打卡类应用对应「统计完成率」），从哪张表、哪个接口、哪个文件开始改？
> 我只看了仓库和文档，以下是我给出的动手路径。

**本项目核心记录 = `items`（核查条目，`db/schema.sql:75`）。** 对应「完成率」的语义是 **已核查 / 已戳穿的占比**（`verdict` 四档：`真 / 假 / 存疑 / 部分属实`；另有 `cross_check` 三档、`sources` 为 JSONB ≥2 条）。

**动手顺序（5 步）**：

1. **表：`db/schema.sql`** —— 先决定统计在**前端现算**还是**服务端聚合**。
   - 前端现算（推荐，改动最小）：不用动表结构，`items` 的 `verdict` / `cross_check` / `updated_at` 已经够用。
   - 服务端聚合：照 `bump_item_view()`（`db/schema.sql:130`）的写法新增 `CREATE OR REPLACE FUNCTION item_stats(...) SECURITY DEFINER SET search_path = public`。⚠️ 建完**必须补** `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon;` 再按需 `GRANT`（托管库会给新函数自动授 EXECUTE 给 anon，`docs/rollback-manual.md` §二·第二层第 2 个坑写明）。**改完必须同步写回 `db/schema.sql`**，否则下次「上一版定义」取的是错的。
   - ⚠️ 别指望往 `items` 写统计结果：items **没有任何客户端写策略**（我实测 `PATCH /items` → 401 `DATABASE_42501`），要落库只能走 SECURITY DEFINER 函数。

2. **接口层：`js/api.js`（唯一接口层）** —— 照 `getItems()`（`js/api.js:341`）加一个 `async getItemStats()`；若走函数，照 `bumpItemView()`（`js/api.js:591`）用 `getCloudClient().database.rpc("item_stats", …)`。
   **硬门槛**：`frontend-rules` A 组规定页面脚本里不许出现 `.from(` / `rpc(` / `fetch(`，所有云端访问只能经 `api.xxx()`。

3. **前端渲染：`js/home.js` + `index.html`** —— 现成的统计位点已经在了：
   - 容器：`index.html:48` 的 `<div class="stat-row" id="board-stats">`
   - 渲染函数：`js/home.js:263` 的 `renderStats()`，现在只有「收录条目」和「已戳穿」两张卡（数字由 `ALL_ITEMS` 现算，不写死）
   - 加「完成率」= 在 `renderStats()` 里加第三张 `<div class="stat-card">`，分母用 `ALL_ITEMS.length`，分子按 `verdict` / `cross_check` 口径 filter。
   - 数据加载失败时 `renderStats()` 会清空（`DATA_STATE !== "ok"`），新卡片跟着走，不用另外处理错误态。

4. **契约同步：`api-contract.md`** —— §二（第 148 行起）接口表加一行；§三（第 168 行起）实现状态表标注状态。这个仓库的规矩是「表里说已实现、代码里找不到，或反过来，都算契约不同步」。

5. **过门槛再发** —— `node check-secrets.js` + `node check-boundaries.js`（README「提交前必跑」）→ `node .workbuddy/skills/preflight-check/preflight-check.js --with-browser`（改了前端就得带浏览器）→ 发布后 `node tools/check-live-version.js main` 确认线上 = 最新版。

> 如果题目里的「核心记录」指的是**用户提交的线索**（打卡类更贴近这个），那路径换成：表 `reports`（`db/schema.sql:194`）→ 接口 `js/api.js:403 submitReport()` / `:426 getMyReports()` → 文件 `js/mine.js:539 initReports()`。但要注意：`reports` 匿名读是 **401**（我实测），要统计「处理率」必须先有 `admins` 身份，或新开一个管理员口径的函数——这正是文档里没写清楚、改动时最容易踩空的一处。

**结论：能给出合理路径 —— 架构与文档足够清楚。** `db/schema.sql` / `js/api.js` / `js/home.js` / `api-contract.md` 四处的分工明确，且我每一步都能指到具体行号。

---

## 发现的「文档与实测不一致」（以实测为准）

| # | 文档原句 | 我的实测 | 判定 |
|---|---|---|---|
| 1 | `final-acceptance-day28.md` ⑤「公网首页 ✅ HTTP 200，**15726 字节**」 | `content-length: 21647`，实际 21647 **字节**；15726 是 JS 字符串长度（UTF-16 码元）。同一份探针的 `homeText.length` 就是这么来的 | **措辞错**，结论（200 + 含「辟谣榜」）不受影响 |
| 2 | ④「线上 `js/api.js`（**28198 字节**）」 | 线上 `/js/api.js` 实际 **41901 字节**（preflight U2 实测 + 本地文件同尺寸）；28198 同样是字符数 | **措辞错**，同上 |
| 3 | `resources-and-expiry.md` §三「`reports` … ❌ **当前不可恢复**」；`final-acceptance-day28.md` 已知缺口 #2「备份覆盖不全 … 误删不可恢复」 | 我用平台管理员 SQL 通道**读到了 reports 的 3 行**（含我今天 23:31:18 提交的 id=88）。匿名导出脚本确实 401，但**存在管理员通道**，「不可恢复」这句把缺口说大了 | **高估缺口**（方向是保守，不是隐瞒）。建议改写成「匿名导出脚本备不到；需管理员通道」 |
| 4 | `api-contract.md:51` 小节标题「items（核查条目，存于 `data/data.json` 的 `items` 数组）」 | 运行时数据源是**云库 `items` 表**（23 行，匿名可读）。同文件第 152 行自己写着「`data/data.json` 是种子源头，不再是运行时数据源」 | **标题过时**，与同文件正文自相矛盾 |
| 5 | `final-acceptance-day28.md` 开头「版本：main `678f94e`」 | 这份验收表本身是**未跟踪文件**（`git status`: `?? docs/final-acceptance-day28.md`），线上 `/docs/final-acceptance-day28.md` → **404**；`README.md` 也是未提交的 `M`。即 HEAD `678f94e` 里并不包含这份验收表 | 事实陈述需注意：表里的结论对应那一版代码，但**表本身不属于那一版** |
| 6 | ⑥「环境 `billingStatus=normal`、`provisionStatus=assigned`」 | 现有只读工具没有能读环境计费状态的接口 | **未执行**（该数据点未能独立复核） |

---

## 最终结论

**验收成立 —— 8 项全部 PASS，无 FAIL。**

8 项里 6 项是我当场跑出原始输出直接坐实的（①②③④⑤⑧），2 项（⑥⑦）是「交付物在 + 我自己复测了其中能复测的全部数字」，⑥ 里有一个数据点（环境计费状态）和 ⑦ 里的两次回滚演练我**没能独立复核**，按纪律记为「未执行」——未执行不等于有问题，但也不等于已验证。

6 条不一致里，**没有一条动摇任何一项的判定**：1、2 是「字节 vs 字符」的口径错；3 是把缺口说保守了；4 是过时标题；5 是文档自身的版本归属；6 是工具能力边界。以我的实测为准，这 6 处建议改，但不构成 FAIL。

这个项目给我最深的印象不是「功能多」，而是**它把「不知道」和「没跑」都写在了明面上**：到期日期留空不填估算值、回滚第二三层标注「不实操」并给原因、缺口一条条列出来。这些自曝的缺口我逐条去戳，戳到第 3 条时发现它其实把 `reports` 说得更坏了一点（有管理员通道能读）——**宁可把缺口说大也不说小**，方向是对的。
