# 「能继续改」检测问答记录（Day 28）

> 检测方式：把**只给仓库和文档、不给任何解释**的独立验收官拉进来，问它一道动手题。它答得出合理路径 = 架构与文档足够清楚，作品真的能继续改。
> 验收官：`docs/day28-auditor-report.md`（不认识作者，只拿到公网地址 + 仓库文件）
> 问答时刻：2026-10-18 23:28–23:41（北京时间）｜我把它的行号逐条复核的时刻：2026-10-18 23:59

---

## 问（原题照抄）

> 如果要给你的**核心记录**加一个统计功能（打卡类应用对应「统计完成率」），从哪张表、哪个接口、哪个文件开始改？

规则：验收官只能看仓库和文档，不能问我。

---

## 答（验收官原文，未改写）

**它自己认定核心记录 = `items`（核查条目，`db/schema.sql:75`）。** 对应「完成率」的语义是**已核查 / 已戳穿的占比**（`verdict` 四档：真 / 假 / 存疑 / 部分属实；另有 `cross_check` 三档、`sources` 为 JSONB ≥2 条）。

**动手顺序（它给的 5 步）：**

1. **表：`db/schema.sql`** —— 先决定前端现算还是服务端聚合。
   - 前端现算（推荐，改动最小）：不用动表结构，`items` 的 `verdict` / `cross_check` / `updated_at` 已够用。
   - 服务端聚合：照 `bump_item_view()`（`db/schema.sql:130`）新增 `CREATE OR REPLACE FUNCTION item_stats(...) SECURITY DEFINER SET search_path = public`。⚠️ 建完**必须补** `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon;` 再按需 `GRANT`（托管库会给新函数自动授 EXECUTE 给 anon）。**改完必须同步写回 `db/schema.sql`**。
   - ⚠️ 别指望往 `items` 写统计结果：items **没有任何客户端写策略**（它实测 `PATCH /items` → 401 `DATABASE_42501`），要落库只能走 SECURITY DEFINER 函数。

2. **接口层：`js/api.js`（唯一接口层）** —— 照 `getItems()`（`js/api.js:341`）加 `async getItemStats()`；若走函数，照 `bumpItemView()`（`js/api.js:591`）用 `getCloudClient().database.rpc("item_stats", …)`。
   **硬门槛**：`frontend-rules` A 组规定页面脚本里不许出现 `.from(` / `rpc(` / `fetch(`，所有云端访问只能经 `api.xxx()`。

3. **前端渲染：`js/home.js` + `index.html`** —— 现成统计位点已存在：
   - 容器：`index.html:48` 的 `<div class="stat-row" id="board-stats">`
   - 渲染函数：`js/home.js:263` 的 `renderStats()`，现在只有「收录条目」「已戳穿」两张卡
   - 加「完成率」= 在 `renderStats()` 里加第三张 `<div class="stat-card">`，分母 `ALL_ITEMS.length`，分子按 `verdict` / `cross_check` 口径 filter
   - 数据加载失败时 `renderStats()` 会清空（DATA_STATE ≠ ok），新卡片跟着走，不用另外处理错误态

4. **契约同步：`api-contract.md`** —— §二接口表加一行；§三实现状态表标状态。这仓库的规矩：表里说已实现、代码里找不到，或反过来，都算契约不同步。

5. **过门槛再发** —— `node check-secrets.js` + `node check-boundaries.js` → `node .workbuddy/skills/preflight-check/preflight-check.js --with-browser`（改了前端就得带浏览器）→ 发布后 `node tools/check-live-version.js main` 确认线上 = 最新版。

> **它还自己补了一条我没想到的**：如果「核心记录」指的是**用户提交的线索**（打卡类其实更贴近这个），路径换成 `reports`（`db/schema.sql:194`）→ `js/api.js:403 submitReport()` / `:426 getMyReports()` → `js/mine.js:539 initReports()`。并指出：`reports` 匿名读是 **401**，要统计「处理率」必须先有 `admins` 身份或新开管理员口径函数 —— **这正是文档里没写清楚、改动时最容易踩空的一处**。

**它自己的结论**：能给出合理路径 —— 架构与文档足够清楚。每一步都能指到具体行号。

---

## 我的复核（不采信，逐条查）

它给的 9 个行号我全部打开核对过：

| 它引用的位置 | 我打开看到的实际内容 | 属实？ |
|---|---|:---:|
| `db/schema.sql:75` | `CREATE TABLE IF NOT EXISTS items (` | ✅ |
| `db/schema.sql:130` | `CREATE OR REPLACE FUNCTION bump_item_view(p_id text)` | ✅ |
| `db/schema.sql:194` | `CREATE TABLE IF NOT EXISTS reports (` | ✅ |
| `js/home.js:263` | `function renderStats() {` | ✅ |
| `index.html:48` | `<div class="stat-row" id="board-stats"></div>` | ✅ |
| `js/api.js:341` | `async getItems() {` | ✅ |
| `js/api.js:591` | `async bumpItemView(id) {` | ✅ |
| `js/api.js:403` / `:426` | `async submitReport({ text, url }) {` / `async getMyReports() {` | ✅ |
| `js/mine.js:539` | `function initReports() {` | ✅ |

**9/9 属实，无一处是猜的。**

---

## 判定

**「能继续改」检测：通过。**

最有说服力的不是它答对了，而是这一条：**它不知道我给过什么答案，却指向了和我完全相同的三个改动位点**（`js/home.js` 的 `renderStats()` / `index.html` 的 `#board-stats` / `js/api.js` 加一个统计接口）。两个人从仓库文档里独立读出同一条路径，说明这条路径是**文档里读得出来的**，不是只有我记得。

它还额外给出了我没写进 `docs/day28-status-and-next.md` 的两条：
1. 新建云函数**必须 REVOKE 再 GRANT**（托管库默认把 EXECUTE 授给 anon）—— 这条我只在 `docs/rollback-manual.md` 里提过，没写进优化计划，补上。
2. 若统计对象换成 `reports`（用户线索），**匿名 401 会让「处理率」必须先解决身份** —— 这是文档空白点，已记入未完成项的说明里。

---

## 复现

```bash
node verify/gen-acceptance-checklist.js      # 8 项清单（解析验收表生成，防两处漂移）
```
直接读验收官原文：`docs/day28-auditor-report.md` → 「『能继续改』检测题」一节。
