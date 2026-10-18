# 8 项交付清单（Day 28 一页速览）

> 本文件由 `verify/gen-acceptance-checklist.js` **解析 `docs/final-acceptance-day28.md` 自动生成**，状态不手写，改源文档后重跑脚本即同步。
> 站点：https://rumor-check-12000.app.workbuddy.host/　｜　源文件 HEAD：`60df8e4`　｜　独立复核：`docs/day28-auditor-report.md`

## 勾选状态

| ✅ | # | 交付项 | 结论 | 一句话证据 | 自己复现 |
|:---:|:---:|---|---|---|---|
| ✅ | 1 | 至少 3 个页面或独立视图 | **PASS** | 公网五步走查（同一脚本、同一 URL，今晚 22:5x 又跑了一遍，**第二次仍全通**）：① 首页辟谣榜 15 张卡 ② 详情页（信源卡 3 张、板块 2 个）③ 查询检索「示例」→ 卡片 23 张 / 计数行「命中 23 条」，两者交叉核对一致 ④ 论坛 7 帖 ⑤ 个人页渲染正常（未登录显示登录引导） | `node verify/probe-live-core-flow.js` |
| ✅ | 2 | 至少 1 个有明确反馈的交互 | **PASS** | 在公网 `mine.html` 真做一次用户动作（`verify/probe-day28-interaction.js`）： ／ · 输入「短」→ 页面回执原文：**「再多写一点（至少 5 个字）：什么说法、在哪看到的。」**（错误反馈） ／ · 输入正常文本 → 回执原文：**「已提交，站方会逐条核查。」**（成功反馈） ／ · **刷新页面后这条记录仍在**，计数行「共 1 条（仅本机）」 | `node verify/probe-day28-interaction.js` |
| ✅ | 3 | 至少 1 类数据真实写入并读取数据库 | **PASS** | **A. 浏览量** `rpc bump_item_view`：✅ 落库：views **2 → 3**；隔 1.2 秒再读**仍是 3**（刷新后持久化）：✅ **能**（items 匿名可读，可当场验证）；**B. 用户线索**（今晚演示时真提交的那条）：✅ 写入成功（回执「已提交」）：⚠️ **匿名读不回来**（reports 401）—— **这是权限设计不是故障**：线索只有本人/管理员… | `—` |
| ✅ | 4 | 前端 → 云函数 → 数据库，完整链路 | **PASS** | 前端：`js/api.js`（唯一接口层）：线上 `js/api.js` 含云库读取路径 `database.from("items")`；云函数 / 服务端逻辑：2 个函数 + 1 个触发器：`bump_item_view`、`enforce_report_rate_limit`；触发器为 `BEFORE INSERT`（每人每天 5 条，超限 `FX429`）：③-A 当场调用了函数；频控触发… | `js/api.js` |
| ✅ | 5 | 公网首页、健康接口、线上持久化 | **PASS** | 公网首页：✅ HTTP 200，含「辟谣榜」（页面 **21647 字节**；探针曾写的「15726」是 JS 字符数，口径错，已按验收官实测改正）；健康接口：✅ 数据网关 HTTP 200（899ms，自述 `standard public schema v15`）。**口径写清楚**：本项目**没有** `/api/health`（`api-contract.md:179` 已作废并写明理由：… | `api-contract.md:179` |
| ✅ | 6 | CloudBase 资源和到期风险已记录 | **PASS** | ⚠️ 措辞更正（验收官 2026-10-18 纠正）：原写「误删当前不可恢复」**把缺口说大了** —— 验收官用管理员 SQL 通道实际读到了 `reports` 的 3 行。**准确说法是「匿名备份覆盖不到，恢复需管理员通道」**，不是事实上的不可恢复。 | `docs/resources-and-expiry.md` |
| ✅ | 7 | 回滚手册和数据导出方式已交付 | **PASS** | 回滚手册（三层 + 触发判断表 8 条）：`docs/rollback-manual.md`：✅ 第一层**已实操演练 2 次**（A：回退 109s/恢复 40s；B：回退 123s/恢复 34s，数据零变化）；第二、三层显式标注「手册内容，不实操」并写明原因；回滚锚点：`v1.0.0`=`f3d9f0d`、`v0.9.0`=`d94034a`（已推远端）：✅；数据导出：`node db/exp… | `node db/export-data.js --out <仓库外目录>` |
| ✅ | 8 | 密钥、.env 和私人信息没进 Git | **PASS** | 仓库红线扫描：`node check-secrets.js` → **红线 0 条**；`.env.example` 只有占位符（与线上真值比对过，无真值）；全 git 历史：preflight **S2**（含历史提交）与 **S1b**（未跟踪文件补扫）均 PASS；`.env` 真的被忽略：**E1** 问的是 git 本人：`git check-ignore -v .env` → `.gi… | `node check-secrets.js` |

**统计**：PASS 8 项（其中「部分达成」0 项）｜FAIL 0 项｜未执行 0 项

> ✅ = PASS（当场验过）｜◐ = PASS 但有一处只达成一部分，明细写在源文档该项里｜❌ = FAIL｜— = 未执行

## 1 分钟当场展示怎么点

1. 打开 https://rumor-check-12000.app.workbuddy.host/ → 首屏卡片 + 顶部两张统计卡（①③）
2. 点一张卡 → 详情页信源与板块（①）
3. 底部切到「查询检索」输「示例」→ 23 条，与计数行一致（①）
4. 右上角头像进个人页 → 提交一句 ≥5 字 → 回执「已提交，站方会逐条核查。」（②）
5. 刷新页面 → 那条还在（③⑤）
6. 三条命令：`node check-secrets.js`（⑧）／`node tools/check-live-version.js main`（⑤）／`node verify/probe-day28-write-persist.js`（③⑤）
7. 文档当场打开：`docs/rollback-manual.md`（回滚）＋ `db/export-data.js`（备份）＋ `docs/resources-and-expiry.md`（资源与到期）（⑥⑦）

---

生成时刻：2026-10-18T16:03:47.216Z　｜　源文档字节数：9648