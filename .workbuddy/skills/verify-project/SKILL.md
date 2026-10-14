---
name: verify-project
description: foxlings-project 发布前一键验收 —— 逐项 PASS/FAIL + 证据，检查项全部来自本项目真实踩过的坑
usage: node .workbuddy/skills/verify-project/verify-project.js [--json 报告.json] [--with-browser]
---

# verify-project · 发布前一键验收

## 这是什么

一条命令回答「**现在这一版能不能发**」：逐项输出 `[PASS|FAIL|WARN|SKIP] + 证据`，
没有任何「看起来正常」「基本没问题」这类模糊表述。任何一项红线 FAIL，退出码就是 1、结论就是「不可发布」。

检查项**全部来自这个项目真实踩过的坑**（对照表在下面 §坑↔检查项），不是通用模板。

## 在对话里怎么调用

对 AI 说其中任意一句即可：

- 「运行 verify-project」
- 「发布前检查一遍，跑 verify-project，留 JSON」

AI 应当执行（在项目根 `D:\AI\foxlings-project` 下）：

```bash
node .workbuddy/skills/verify-project/verify-project.js --json verify-project.json
```

要更强的页面级证据（浏览器真打开线上首页数卡片）：

```bash
node .workbuddy/skills/verify-project/verify-project.js --with-browser --json verify-project.json
```

## 文件结构

```
.workbuddy/skills/verify-project/
├── SKILL.md            ← 本文件（自足说明：判据、用法、边界）
├── verify-project.js   ← 执行脚本（唯一实现，规则不重抄）
└── run-log.md          ← 建成当日的实跑留痕（两轮 + 反证 + 修正记录）
```

## 命令行用法与参数

```
node verify-project.js [--root 项目根] [--site 线上地址] [--json 输出.json]
                       [--with-browser] [--no-write] [--tables a,b,c]
                       [--sdk 本地SDK路径] [--playwright 模块目录]
```

| 参数 | 作用 |
|---|---|
| `--json <路径>` | 落一份机器可读报告（每个检查项带原始明细），供留档/渲染成图 |
| `--with-browser` | H5 加页面级证据：真开浏览器数线上首页的卡片（默认只用接口层间接判据） |
| `--site <地址>` | 覆盖线上地址。**反证用**：指到没人听的端口，该红的会红 |
| `--tables a,b,c` | 覆盖要查的表名。**反证用**：加一张不存在的表，只有 H2 会红 |
| `--no-write` | 跳过 H4 的写探针（默认开着，全部是零污染的越权写） |
| `--root <目录>` | 检查另一个项目根（默认当前目录；会先验证 `js/api.js` 存在） |

退出码：红线全过 = `0`；任一红线 FAIL = `1`；参数错 = `2`。

依赖：Node（内置 fetch）；git 在 PATH 里（S/D 组要用）；`--with-browser` 另需
playwright-core + Edge + 一份云 SDK 的本地副本（本机拉不到 CDN，见已知边界）。

## 检查项与判据（每一项都写明「怎么算通过」）

### 第一组 · 出门前 —— 委托 preflight-check 引擎

**纪律：不重写任何一条规则。** 密钥口径的唯一真值仍是 `check-secrets.js`，
边界口径的唯一真值仍是 `check-boundaries.js`。本组把已验证过的引擎当子进程调用
（`--json`），10 项结果原样并入本报告；**委托失败 = 明确 FAIL，绝不静默算通过**。

| 项 | 查什么 | 怎么算通过 |
|---|---|---|
| S1 | 密钥红线 · 工作区 | 紧口径（≥16 位字面量/带密码连接串/私钥块）命中 **0 条**，含未跟踪文件补扫 |
| S2 | 密钥红线 · 全部 Git 历史 | 56 个提交（全部分支）的补丁体与提交信息命中 **0 条**（规则定义文件自身排除） |
| S3 | 输入边界 | 数据库 CHECK ↔ 前端 JS ↔ 输入框 maxlength ↔ 接口层自检，每条边界**四处数字全部一致** |
| U1 | 公网可达 | 线上首页 HTTP 200、非空、title 正确 |
| U2 | 公网资源齐全 | 首页依赖的 api.js / data.js / style.css 全部 200 且非空 |
| E1 | .env 忽略真生效 | `git check-ignore -v .env` **原样命中**（写了规则≠规则生效，要问 git 本人） |
| D1 | 工作区干净 | `git status` 无未提交项（否则 WARN：没提交的东西不会上线） |
| D2 | 远端同步 | 本地 HEAD 与 `git ls-remote` 直连取回的远端 main 一致 |
| D3 | 线上版本漂移 | 11 个可发布文件逐一比对 git blob sha，**全部与线上一致**（否则 WARN：线上落后） |
| W1 | 前端工艺门槛 | 默认 SKIP（要本地静态服务+浏览器，单跑数分钟）；加 `--with-browser` 才跑 |

### 第二组 · 配置与数据库 —— 本 Skill 唯一新增的代码

preflight-check 自己声明「**不检查数据库侧**」，这一段补的就是它。

| 项 | 查什么 | 怎么算通过 |
|---|---|---|
| E2 | 环境变量样板 | `.env.example` 被 git 跟踪、只有字段名没有真值；`.env` 不在 git 索引里 |
| H1 | 数据通道探活 | `GET /.cloud/database/rest/` 回 **HTTP 200 且服务自述含 schema 版本**。口径写死：这证明「网关在线」，**不等于**「数据读得到」（那是 H2/H3 的事）。本项目没有 `/api/health`（api-contract.md:179 已作废），这条是它真实的等价物 |
| H2 | 核心表存在 | 六张表（items/posts/reports/profiles/admins/announcements）逐张问：**只有 404 + `PGRST205` 才算丢表**。401（RLS 拒）或 200 空数组都是「表在、策略挡」—— 分界线实测过：不存在的表回 404+`PGRST205`，与 401+`DATABASE_42501` 形态完全不同 |
| H3 | 读接口拿到真数据 | items 读回**非空数组**、每行含 id/title、且 `Prefer: count=exact` 的 content-range 总数与取回行数**一致**（只数「取回多少」在超 1000 行时会假绿） |
| H4 | 写接口通路 + 越权被挡 | 4 发**零污染**探针全部符合契约：①对不存在的 id 调 `bump_item_view` → 200 且返回 **-1**（schema 注释：条目不存在返回 -1）；②匿名写帖 → 401；③匿名写榜 → 401；④改热度 → 401。跑完再做污染自检（items 行数前后一致） |
| H5 | 首页展示的是数据库真数据 | 三条证据：线上 `js/api.js` 含 `database.from("items")`（不是读 data.json 种子的旧版）＋ 云库有 ≥1 行 ＋（`--with-browser` 时）页面上**真出现卡片**。注意坑：首页默认落「本周」档，数据一周没更新则本周天然 0 条、显示「本月有 N 条」——此时探针会**点「查看本月」再数一次**，卡片数才是直接证据 |

## 输出格式

```
═══ 发布前验收 · verify-project · foxlings-project ═══
【第一组】出门前 —— 委托 preflight-check 引擎
  [PASS]  S1  密钥红线 · 工作区 …  — 跟踪文件 0 条 · 未跟踪文本文件 2 个也 0 条
           ↳ 证据原文（HTTP 状态码、行数、content-range、git 命令的原样输出）缩进在摘要下面
结论：可发布 —— 红线 13 项全过，提醒 2 项、跳过 1 项。
```

三档含义：**红线**（任一 FAIL → exit 1、不可发布）／**提醒**（不拦发布）／**跳过**
（这一层没验过，**不等于通过**）。JSON 报告里每项带完整明细数组。

## 坑 ↔ 检查项 对照（覆盖度）

| 项目真实踩过的坑（出处） | 对应检查项 |
|---|---|
| 密钥一旦泄漏必须全历史搜查（day23） | S1 / S2 |
| `.gitignore` 写了 ≠ 规则生效；`.env.example` 混进真值（day23） | E1 / E2 / S1 |
| 输入边界四处数字漂移（day23 的 check-boundaries） | S3 |
| 本机/用户侧拿不到 CDN、页面卡加载态（day24 实测 jsdelivr 被重置） | U2（资源齐全）+ H5（探针本地顶替并在报告注明） |
| 「表读不到」被误判「表丢了」：reports 401、profiles/admins 空数组（day21~22 RLS 调试） | H2（只认 PGRST205） |
| 错误码现实是 `PGRST205` 不是 `42P01`，认不出的一律按服务端错（day23） | H1/H2 的错误码判据 |
| 匿名越权写必须被 RLS 挡住；items 无 INSERT/UPDATE 策略 = 热度不可篡改（day21/24） | H4 ②③④ |
| 托管库给新函数自动授 EXECUTE 给 anon（day23 踩过） | H4 ①（间接验证函数可执行且签名行为符合契约） |
| 首页默认「本周」档，时间依赖数据让空态≠数据丢失（day24/25 门槛被它卡死过） | H5（点「查看本月」再数卡片） |
| 「HTML 里有 #board-list」证明不了任何事（day25 出图时发现） | H5（只认卡片数/条数，不认元素存在） |
| `content-range` 不加 `count=exact` 拿不到真实总数（本 Skill 第一轮实跑抓到的漏报） | H3 |
| 线上落后本地还照常发（day25 基线发现落后 8 个文件） | D3 |
| 工作区没提交 / 远端不同步就发布（day20~22） | D1 / D2 |
| GET 接口必须回真实数据库数据、响应形状要与契约一致（day21 验收②⑥） | H3（行数 + 字段形状 + 总数一致） |
| PATCH/DELETE 必须有闸门；items 热度不可篡改（day22 闸门矩阵） | H4 ④（PATCH 被拒） |
| 「数据来源铁证」：页面显示的必须是库里的行，不是种子（day20 检查 6） | H5 |

**已知边界（没做到的，写明白）**：不检查登录后的路径（邮箱 OTP 无法匿名复现）；
不检查匿名频控的真实访客 IP（本机出口 IP 由平台通道决定，无法自证，Day 27 真机核对）；
H4 只能看到「匿名角色看得见的行」；W1 默认不跑；DDL 与云端结构不在检查范围（走 MCP 通道，同步 `db/schema.sql`）。

## 反证记录（证明不虚报）

| 故意弄坏 | 期望 | 实测 |
|---|---|---|
| `--site http://127.0.0.1:9`（接口路径指错） | 网络/数据相关项全红 | ✅ U1/U2/H1/H2/H3/H4/H5 七项 FAIL，S1/S2/S3/E1/E2/D2 照旧绿，exit 1 |
| `--tables` 加一张不存在的表 | 只有 H2 红 | ✅ 仅 H2 FAIL（404+`PGRST205` 被认出来），其余全绿 |

另有**独立复算**（不经过本 Skill 的代码，亲手重做）：抽 H2、H4、E1 三项，
结论与 Skill 报告完全一致。留痕见 `run-log.md`。
