# 交付说明（Day 28）· 地址 / API / 数据库 / 部署

> 一页看完「这东西在哪、怎么调、数据在哪、怎么发、有什么限制」。
> 版本：main `678f94e`　核对时刻：2026-10-18 23:5x
> 关联：`api-contract.md`（完整契约）、`db/schema.sql`（唯一权威结构）、`docs/final-acceptance-day28.md`（8 项验收）

## 一、公网地址

| 页面 | 地址 |
|---|---|
| 首页（辟谣榜 / 查询检索 / 论坛 三 tab） | https://rumor-check-12000.app.workbuddy.host/ |
| 详情页 | `/detail.html?id=<条目 id>`（从首页点卡片进入） |
| 个人主页 | https://rumor-check-12000.app.workbuddy.host/mine.html（首页右上角头像进入） |
| 管理后台 | `/admin.html`（需管理员身份，入口登录后可见） |

- 应用：`wbapp_0VXBJtQxVqDiyV4xUOto06`（云服务与发布共用，**重新发布必须复用它**）
- 形态：**静态前端 + 托管后端**，无自建服务层。

## 二、API 文档

完整契约在 **`api-contract.md`（545 行）**：接口清单、数据表、RLS 闸门、错误口径、输入边界。
接口层只有一处：**`js/api.js`**（页面脚本一律不许直接摸 SDK 或 fetch，由 `frontend-rules` A 组盯着）。

| 能力 | 接口 | 谁能调 |
|---|---|---|
| 读条目列表 / 单条 | `api.getItems()` / `getItem(id)` | 匿名可读 |
| 读帖子 / 发帖子 | `api.getPosts()` / `createPost()` | 读匿名；**写必须登录** |
| 读公告 | `api.getAnnouncements()`（JS 层再过滤 `is_pinned`） | 匿名只读已公布 |
| 提交待核查线索 | `api.submitReport({text})` | **匿名可写**（频控每天 5 条/人，超限 `FX429`） |
| 读自己的线索 | `api.getMyReports()` | 仅本人（匿名读不到 = 401） |
| 浏览量 +1 | `rpc("bump_item_view")` | 匿名可调用（**唯一的 items 写入通道**，热度不可篡改） |
| AI 拆解材料 | `js/ai.js` 的 `ai.digest()` | keyless、仅流式、**不判真伪** |

**错误口径**：三类（网络 / 权限 / 数据）收口在 `js/api.js`；`classifyError()` 判定 input / network / server，认不出一律算 server；界面中文、英文原文只进 console。

## 三、数据库说明

结构唯一权威：**`db/schema.sql`（535 行）** —— **改云端结构必须同步它**。

| 表 | 用途 | 匿名可见性 |
|---|---|---|
| `items` | 核查条目（核心记录），23 行 | ✅ 可读；**无任何写策略**（改热度 401） |
| `posts` | 论坛帖，7 行 | ✅ 读已通过；写需登录 |
| `reports` | 用户提交的线索 | ❌ 读 401（只有本人/管理员能读）；**匿名可写** |
| `announcements` | 站方公告，2 行 | ✅ 只读已公布 |
| `profiles` / `admins` | 用户资料 / 管理员名单 | 匿名读到 0 行（策略挡，无法判断是否空表） |

- **RLS 17 条策略**（不是前端拦，是数据库层判权）；**2 个函数**：`bump_item_view`、`enforce_report_rate_limit`；**1 个触发器**：reports `BEFORE INSERT`（频控，超限 `FX429`，拿不到 IP 则放行）。
- 匿名导出能备到：items / posts / announcements；备不到：reports（401）、profiles、admins（空数组判不出）→ **恢复需管理员通道**。

## 四、部署清单

| 步骤 | 命令 / 动作 |
|---|---|
| 1 提交前红线 | `node check-secrets.js`（0 条才过）· `node check-boundaries.js` |
| 2 发布前体检 | `node .workbuddy/skills/preflight-check/preflight-check.js`（改前端加 `--with-browser`） |
| 3 一键验收 | `node .workbuddy/skills/verify-project/verify-project.js`（红线 13 项） |
| 4 发布 | 走发布工具，**复用同一 applicationId**，链接不变 |
| 5 发布后核验 | `node tools/check-live-version.js main`（11 个资产逐字节比对） |
| 6 数据体检 | `node tools/check-data-counts.js`（行数 + 指纹，指纹排除 `views` 防假警报） |
| 7 备份 | `node db/export-data.js --out <仓库外目录>`（**目录必须在仓库外**，发布会公开项目目录） |
| 8 恢复 | `node db/restore-from-backup.js --dir <备份目录>` → 生成 `restore.sql`，人工走 SQL 通道执行 |

**回滚锚点（已推远端）**：`v1.0.0` = `f3d9f0d`、`v0.9.0` = `d94034a`。
手册 `docs/rollback-manual.md`（三层 + 触发判断表 8 条）；演练记录 `docs/rollback-drill-record.md`（A：回退 109s / 恢复 40s；B：回退 123s / 恢复 34s，数据零变化）。

## 五、部署限制（要接着改的人先看这段）

1. **静态托管没有一键回滚** —— 回退 = 切 tag → 重新发布 → 逐字节核验，约 30–120 秒。
2. **CDN 单点风险** —— 曾经 4 个页面硬引 `cdn.jsdelivr.net`，该域名抽风则整站空白；已改成 cdn→fastly→unpkg 三来源兜底（Day 27 修）。今晚实测仍有 4–6 次 `ERR_CONNECTION_RESET`，靠第三个来源接管。
3. **没有 `/api/health`** —— 托管后端无自建服务可探活，健康判据是「数据网关 200 + 云库读得到」。
4. **到期时间读不到** —— 官方无接口，只能去控制台人眼抄；文档里留空，**不填估算值**。
5. **发布会把文档一起公开** —— `/AGENTS.md`、`/PRD.md`、`/api-contract.md`、`/docs/**` 线上可读（已知情）；`/.env`、`/db/schema.sql`、`/.git/*` 被 403 挡掉。
6. **匿名身份读不到 3 张表** —— 备份、统计、审计都要走管理员通道。
