# 项目现状盘点（2026-10-14 · Day 26 收尾）

目的：进入「修缮正式」阶段前先把家底摊开。**每条都带可复现证据**，不写「看起来还行」。

判据来源：`PRD.md` §五 验收标准（A1–A12b）、`TESTING.md`、`api-contract.md`、
今天实跑的 `verify-project.js`（13 项红线）与 `preflight-check.js`（10 项）。

---

## 一、已经做好 / 及格的

### 1. 四个页面齐活，主流程闭环

| 页面 | 实际内容 | 证据 |
|---|---|---|
| `index.html` | 三 tab：**辟谣榜**（日/周/月/年四档 + 结论 chip + 关键词）、**查询检索**（L1 站内 + L2 查证四步 + L3 AI 溯源助手）、**论坛**（发帖 → 人工审核 → 公告栏 + 社区规则） | `grep -n 'id="' index.html`；view-board / view-search / view-forum 三段 |
| `detail.html` | 溯源时间线（三节点）+ 信源比对（可点链接）+ 比对结论行 + 信源内搜索 | `detail.html:31-47`；`js/detail.js:189-214` |
| `mine.html` | 我的资料（昵称/签名/头像）+ 收藏 + 足迹 + 我提交的待核查 + 方法论 | `js/mine.js` 650 行 |
| `admin.html` | 五区块：待审帖 / 全部帖 / 榜单条目 / 线索收件箱 / 站方公告；门禁走 `auth.isAdmin()` | `js/admin.js` 630 行 |

### 2. 数据层：**零缺失**（这一层是真及格）

实跑核对 23 条种子（`data/data.json`）：

| 检查 | 结果 |
|---|---|
| id / title / verdict / summary / updated_at / sources 缺失 | **0 / 23（每项都是 0）** |
| `sources` ≥ 2 条（PRD A10） | **23 / 23** |
| 每条信源都有可点链接（PRD A7） | **23 / 23** |
| 结论四档齐全（PRD A2） | 假 8 / 存疑 7 / 部分属实 4 / 真 4 |
| 比对结论三选一（PRD A9） | 相互印证 12 / 信源不足 6 / 存在矛盾 5，**非法值有兜底** |
| 溯源时间线（PRD A6） | 三节点由 `first_seen` + `origin` + `updated_at` 构造，字段 23/23 在；`origin` 里写明「最早可见流传…」或「溯源中断」，不硬编 |
| 权威信源（PRD A11） | 抽样见 `mohrss.gov.cn` 等官方域名；**未逐条全量核**（见 §三·5） |

### 3. 后端接上并收口

- 前端**零直接数据访问**：页面只认 `api.xxx`，接口层唯一入口 `js/api.js`（827 行）。
- 云端：六张表 + **17 条 RLS** + 2 个函数（`bump_item_view` / `enforce_report_rate_limit`）+ 1 触发器；`db/schema.sql` 与线上一致。
- 关键安全性质：**items 没有任何 UPDATE 策略 = 热度不可篡改**；越权写实测被拒（HTTP 401 + `DATABASE_42501`）。
- 删除是**真删不可逆**（Day 24 拍板撤软删除），两击确认 + 明写不可恢复。

### 4. 账号与个人化（线上真机跑通过）

邮箱登录（仅发布域名可用）→ 发帖进审核队列 → 保存资料 → 上传头像，
2026-10-08 项目本人在发布域名上实测全链路通过（`PRODUCT-PLAN-v2.md` §二·9④）。

### 5. AI 溯源助手（L3）

`js/ai.js`：keyless、只支持 `stream:true`、模型实测选 `hunyuan-chat`（默认 `auto` 首字 150s+ 不可用）。
定位守得住：**AI 不判真伪**，只做拆解与指路，面板挂「不联网 · AI 生成 · 不是结论」。

### 6. 错误处理与安全（Day 23 / 25）

- 错误三类归属 `classifyError()` → 用户输入错 / 网络错 / 服务端错，界面一律中文；服务端错打可 grep 的 `[api][server-error]`。
- 全局兜底：`unhandledrejection` + `error` → 底部中文横幅，连环报错只更新同一条。
- **密钥红线 0 命中**（工作区 + 全部 56 个提交历史）；`.env` 真被忽略（`git check-ignore -v` 原样命中）。

### 7. 自检工具体系（这是本项目的护城河）

| 工具 | 规模 | 跑法 |
|---|---|---|
| `check-secrets.js` | 密钥红线 | `node check-secrets.js` |
| `check-boundaries.js` | 输入边界四处一致性 | `node check-boundaries.js` |
| `preflight-check` Skill | 10 项（红线 6 / 提醒 3 / 跳过 1）+ 5 组反证 | `node .workbuddy/skills/preflight-check/preflight-check.js` |
| `verify-project` Skill | 13 项红线（含数据库侧）+ 2 组反证 + 独立复算 | `node .workbuddy/skills/verify-project/verify-project.js` |
| 离线单测 | `test-day25-errors.js`（82 条）、`test-day24-localstorage.js`（20 条） | 直接 node 跑 |

### 8. 文档齐

`PRD.md` / `TECH_DESIGN.md` / `TESTING.md` / `RUN.md` / `api-contract.md`（545 行，含 6.6/6.7/6.8）/
`PRODUCT-PLAN-v2.md` / `WEEKLY-W2/W3` / `docs/` 12 篇（day20–25 + 安全审计 + 核心流程清单）。

---

## 二、及格，但**会腐烂**的（修缮重点）

### 1. ~~⚠️ 首页默认档当前为空 —— PRD A1 / A3 此刻不成立~~ → **已修（Day 26，方案②）**

原记录：线上首页 `#board-list` **卡片 0 张**，空态写「本周暂无新增核查，本月有 15 条 查看本月」。
根因：数据最新 `updated_at = 2026-10-05`，**已 9 天没更新**；而榜单默认落「本周」档 —— 不是「暂时空」，是设计的必然结果。
PRD A3 原文自己承诺「默认档位为周榜——**保证首屏可见 5–10 条（否则 A1 不成立）**」。

**已处理**：`js/home.js` 新增首屏自动回落 —— 周榜为空时落到**最近的更长非空档**，按钮高亮同步，
计数行如实标注「默认「本周」暂无新增，已按最近更新日（2026-10-05）展示」。
三条约束保证不跟用户抢按钮：有筛选时不动作 / 整页只做一次 / 用户手点后永久作废。

> **复算命令**（别信正文，信命令）：
> ```
> node verify/probe-board-fallback.js            # 期望 23/23 PASS
> node verify/probe-board-fallback.js --bust     # 反证：期望 9 项变红
> ```

- **遗留**：首屏现在 **15 张**，PRD A1 要的是 5–10 张 —— 这是**数据量**的结果（全站 23 条，没有哪一档落在 5–10），
  靠灌内容解决，不是首页机制问题。
- **好的副作用**：下面第 3 条「周榜为空导致页面级选择器超时」这个原因已经消失，前端门槛已复跑通过。

### 2. ~~线上落后本地 8 个文件~~ → **2026-10-14 已发布，漂移归零**

原记录：D3 测出 `mine.html` / `admin.html` / `css/style.css` / `js/{api,data,forum,mine,admin}.js` 与仓库 blob sha 不一致（一度是 9 个）。
**已处理**：2026-10-14 复用原应用发布（`wbapp_0VXBJtQxVqDiyV4xUOto06`，分享链接不变），发布后 D3 变 **PASS —— 11 个文件与 HEAD 逐字节一致**。

> ⚠️ **这一条本身就是「写死数字会腐烂」的现场教材**：原书写「8 个文件」，写完全天就变成 9；修完又变成 0。
> **复算命令**（别信正文里的数字，信命令）：
> ```
> node .workbuddy/skills/preflight-check/preflight-check.js
> ```
> 看 `D3 线上版本漂移` 那一行。同类可复算项：`verify-project.js`（13 项红线）、`verify/probe-product-audit.js`（PRD A1~A12）。

### 3. 前端工艺门槛：**已经能跑通，但被「本机 CDN 抽风」卡着**（不是代码问题）

| 项 | 2026-10-14 实测 |
|---|---|
| `frontend-rules`（115 项） | **15:55 跑出 `ALL_PASS` —— 115 项硬门槛全过（23 项观察）**。首屏自动回落修掉「周榜为空 → 等 `#board-list .card` 超时」之后，这个门槛第一次真跑完 |
| `frontend-rules` 复跑 ×2 | 同一小时内复跑两次 **FAIL：等 `#board-list .card` 超时**。原因不是代码 —— 诊断脚本抓到 `cdn.jsdelivr.net` **`ERR_CONNECTION_RESET`**，页面自报「数据加载失败…过一会儿点「重试」」（`verify/diag-filtercheck.js`） |
| `filter-check`（75 项） | 卡在同一步、同一个原因 |

> ⚠️ **别把那次 `ALL_PASS` 读成「从此通过」**：它是 CDN 恰好通了的那一刻跑出来的结果。
> **复跑前先确认 CDN 通不通**：
> ```
> node -e "fetch('https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js').then(r=>console.log('CDN',r.status)).catch(e=>console.log('CDN 不通:',e.message))"
> node .workbuddy/skills/frontend-rules/check-frontend.js   # 期望 ALL_PASS（115）
> node .workbuddy/skills/filter-check/filter-check.js       # 期望 ALL_PASS（75）
> ```
> **一点好消息**：这类失败是**响亮地失败**（超时 + 退出码 1），不是静默通过 —— 数据层一挂，`waitForSelector` 立刻报红，**没有假绿**。这比之前的 SKIP 强：SKIP 容易让人误以为「没事」。

### 4. 论坛帖子**没有频控**

`db/schema.sql` 只有 `trg_reports_rate_limit`（`reports` 表，5 条/天）。`posts` 表没有对应触发器 ——
即登录用户可以无限发帖（进审核队列，但能刷）。低危，但确实是缺口。

### 5. PRD A11（权威信源）未逐条核

只验证了「数据里存在官方域名」，没逐条确认「每个真/假结论条目都至少一条权威渠道」。

### 6. ~~三个已记录未修的低优先级 Bug~~ → **Day 26 修缮：全部修掉**

| Bug | 修法 | 证据 |
|---|---|---|
| `js/mine.js` 删除按钮 `Number(dataset.idx)` 未校验 —— `Number(undefined)` = NaN，而 `splice(NaN,1)` 等价 `splice(0,1)`，**静默删掉第一条**（用户点第 5 条、掉的是第 1 条） | 新增 `js/data.js` 的 `safeIndex(value, len)`：非法一律返回 `-1`，调用方**显式处理**（页面中文提示 + 可 grep 的 `[mine][bad-index]`），**绝不用 0 兜底**（0 是合法删除目标） | 离线单测 `verify/test-safeindex.js` **9/9**；端到端探针 `verify/probe-delete-index.js` **9/9**（真 `mine.html`：下标不可信 → 一条不删；下标正常 → 恰好删掉被点的那条） |
| `js/home.js:252` 文案仍写「data.json 为空」（Day 20 起数据已来自云库） | 改为「云端暂无条目，或全部条目未通过校验」 | 探针加载真页面，零未捕获异常 |
| `js/data.js:178` 注释说 `REP_KEY` 与论坛共用，但 `forum.js` 从未引用 | 注释改为「只有 `mine.js` 读写」，并在公共层置顶一条更正说明 | `grep -rn "REP_KEY" js/` 可复现：只有 mine.js |

**负例靶子（证明探针不是只会报绿）**：把校验换回旧写法后跑**同一个探针** →
A2/A3/A4/A5 **四项变红**，实测输出就是「点第 2 条，掉的是第 1 条」（存证 `verify/delete-index-probe-OLD.json`）。
这一条的教训与 Day 24 同源：**外部输入不可信，而且「DOM 上的值」和「localStorage 里的值」一样是外部输入。**

### 7. 「我提交的待核查」两套口径

未登录时写 `localStorage` 本机留底，登录后走云库。刷新后「看起来还在」但可能不是云库那条 —— 容易自欺（已写进核心流程清单 C4.4）。

---

## 三、完全没做的

| # | 项目 | 说明 |
|---|---|---|
| 1 | **Day 27 外部真人试用**（第 3 次对外测试） | 三次测试里最难的一次：检验整体是否自解释。前两次分别是 Day 14 同伴互测（实为**降级路径**：本人按清单重走）、Day 21 同伴交叉验证 |
| 2 | **Day 28 验收 / 展示** | `api-contract.md:175` 写明「Day 28 验收时以本表为准：表里说已实现、代码里找不到，或者反过来，都算契约不同步」 |
| 3 | 安全自查清单的**可执行检测** | 要交同伴复跑，只看清单能否得出同样结论。人工环节，一直挂着 |
| 4 | 匿名频控的**真实访客 IP** 核对 | 本机出口 IP 由平台通道决定、每次都变，无法自证；留 Day 27 真机看 `submitter_ip` 分布 |
| 5 | 邮箱 OTP 端到端（真收验证码） | 本机无法自证，需真机 |
| 6 | **内容运营**：每日更新 5–10 条 | PRD §七 成功指标第一条。现最新数据 9 天前 —— 这也是 §二·1 的根因 |
| 7 | Day 15 之前的历史文档 | `docs/` 只有 day20 起，day14/15/16/17/18/19 无仓库留档（覆盖度对照因此只能依据 day20+ 与记忆） |

---

## 四、本期明确不做（PRD §六，不用惦记）

用户注册登录后的社区功能（评论/点赞）、AI 自动核查与自动抓取、可信度评分算法、
手机 APP / 小程序、视频图片鉴伪、多语言、服务端搜索引擎。
（注：用户提交待核查 + 互助溯源论坛原列「不做」，后已升级进本期并已落地 —— PRD 该条为历史记录。）

---

## 五、修缮建议排序（我的意见，最终你定）

| 优先级 | 做什么 | 为什么排这个位置 |
|---|---|---|
| ~~P0~~ ✅ | ~~拍板首页默认档策略（§二·1）~~ → **已按方案② 落地**（Day 26） | 唯一一条**用户一进来就看得见**的缺陷；判据 `verify/probe-board-fallback.js` **23/23** + 反证 9 项变红 |
| ~~P1~~ ✅ | ~~发布一次（复用原 applicationId）~~ → **已发布**（2026-10-14） | 发布前 D3 报「落后 9 个文件」→ 发布后 **11 个文件与 HEAD 逐字节一致**；分享链接不变 |
| ~~P1.5~~ ✅ | ~~正式发布 v1.0 + 静态托管回退演练~~ → **已完成**（2026-10-15 补记） | tag `v1.0.0`=`f3d9f0d`、`v0.9.0`=`d94034a` 已推远端；**两次**回退演练（第二次带数据完整性校验：回退 123 秒 / 恢复 34 秒，数据指纹前后全同）；发布清单 `docs/release-v1.0.md`、回滚手册 `docs/rollback-manual.md`（三层 + 「什么情况必须回滚」判断表 8 条）、备份/恢复链 `db/export-data.js` + `db/restore-from-backup.js`（恢复语句已实跑，零污染） |
| **P1** | 补 `posts` 频控（§二·4） | 唯一的「上线后会被滥用」的洞；小改动、有明确验收方式 |
| **P2** | 补内容（每日 5–10 条）或把「更新节奏」写进站方公告 | PRD §七 成功指标；也是 A1「首屏 5–10 张」唯一能达标的路 |
| **P3** | 等 CDN 通的那一刻复跑 `filter-check` 取读数（§二·3） | 门槛已能跑通（`frontend-rules` 出过一次 ALL_PASS 115），缺的只是环境稳定窗口 |
| — | Day 27 外部真人试用 / Day 28 验收 | 课程节奏，等你说开始 |

> 三个低优先级 Bug 的修复记录（含负例靶子）见 §二·6。
