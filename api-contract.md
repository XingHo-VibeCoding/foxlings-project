# api-contract.md — 接口契约（Day 15 定稿）

> 目的：**表结构先定下来，后面每个接口都在同一套字段上工作，不会每屏各造一套。**
> 现状：纯静态（0 个后端 API）。本文同时定义「未来的接口长什么样」——接后端时按此实现，字段不再重造。
> **Day 16 进展**：第一节的数据模型已落成可执行的建表脚本 `db/schema.sql`（items / posts / reports
> 三张表，含约束与索引，**尚未执行**）；种子数据转换器 `db/json-to-sql.js` 可把 `data/data.json`
> 生成 `INSERT` 语句。接后端那天：建表 → 灌种子 → 把 `loadVerifiedData()` 切到 `/api/items`，同一天完成。

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

### 本地存储（浏览器 localStorage，不上传任何数据）

| 键 | 结构 | 写入方 | 读取方 |
|---|---|---|---|
| `fx_favs` | string[]（条目 id） | detail.js（收藏按钮） | mine.js（收藏列表） |
| `fx_history` | `{id, at}[]` 最多 20 条 | detail.js（进详情页记录） | mine.js（浏览足迹） |
| `fx_myreports` | `{text, at}[]` 最多 50 条 | mine.js（线索本地暂存）**与 forum.js（论坛发帖暂存，Day 19 起）** | mine.js |

> **Day 19**：`escHtml` / `readJSON` / 上述三个键名统一上移到 `js/data.js`（三页都会加载的公共层）
> —— 论坛要往同一个 `fx_myreports` 写线索，同一份数据只允许有一个定义，接后端替换时也只改这一处。
> 所以「同一份数据只有一个定义」这条纪律在本地存储层先是靠这一处集中的常量来兜底的。

---

## 二、当前接口（0 个后端）

| 调用 | 方向 | 说明 |
|---|---|---|
| `GET data/data.json` | 浏览器 → 静态托管 | 一次性拉全量（当前 <100KB），前端过滤渲染 |

---

## 三、预留接口（接后端时按此实现，不提前写）

接后端的第一步是健康检查（课程 Day 15 的 `/api/health`），随后按模块逐个点亮：

| 接口 | 方法 | 用途 | 状态 |
|---|---|---|---|
| `/api/health` | GET | 部署链路打通验证 | 待接后端 |
| `/api/items` | GET | 条目列表（支持 range / verdict / q / 分页）——替代 data.json | 待接后端 |
| `/api/items/:id` | GET | 单条详情 | 待接后端 |
| `/api/search` | POST | 查询检索：站内命中 + 联网搜索 + AI 整合摘要（L3）。**Day 17 起 L1（站内检索）与 L2（查证四步清单）已用纯静态实现上线**（`js/search.js`）；**Day 18 起检索页拆为两模块：站内搜索 / 全网溯源，溯源结果分「官方来源」「网络来源」两组**——现在的两组入口是人工跳转（site: 限定搜索 + 平台直达），后端接通后把这两组升级为自动抓取 + AI 摘要，返回结构应保持 `official` / `web` 两组划分 | 待接后端 |
| `/api/posts` | GET / POST | 论坛帖子（F3，含审核流）。**Day 19 起界面骨架已上线**（`js/forum.js` 读 `data/posts.json`），字段与 `db/schema.sql` 的 posts 表对齐，另需两个展示字段：`category`（分类：求助溯源 / 已解决 / 经验讨论，接入时补进表结构）与 `replies`（回复数，将来由回复表聚合）。GET 默认只返回 `status = 'approved'`（界面已按此过滤并单列「待审核」计数）；POST 一律写 `status = 'pending'` | 待接后端 |

**约定**：

1. 所有接口出错时返回 `{ "error": { "code": "...", "message": "..." } }`，前端一律按四态规范处理（loading / empty / error / normal），错误态必须给重试出口；
2. **数据迁移纪律**（沿用 TECH_DESIGN 第九节）：data.json 与数据库只许一处为准，禁止双写过渡期超过一天；
3. 接口层字段命名与第一节**完全一致**，不做改名/映射——保证「先定表结构，接口都长在同一套字段上」。
