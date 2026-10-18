# foxlings-project

「热门时事真伪辨别」—— 静态前端 + 托管后端（云数据库 / 云存储 / 云 LLM）。定位是**证据整理员，不是审判官**：每个结论都有信源可溯。

## 本地跑起来

```bash
python -m http.server 8000 --bind 127.0.0.1   # 8000 端口被系统保留，必须显式绑地址
# 浏览器打开 http://localhost:8000/
```

## 配置（环境变量）

**仓库里只有不含真值的样板**；真实值写 `.env`（已被忽略）。

```bash
cp .env.example .env    # 填 WB_ENDPOINT / WB_PUBLISHABLE_KEY 等
node env-to-js.js       # 生成 js/env.local.js（已忽略），页面从 window.__ENV__ 读到
```

什么都不配也能跑 —— `js/cloud-config.js` 里有线上那一套默认值。
`.env` 里若混进服务端凭据（`DATABASE_URL` / `SERVICE_ROLE_KEY` / `LLM_API_KEY`），
`env-to-js.js` 会**跳过**它们：凭据不进浏览器这条边界由脚本兜着，不靠人记性。

## 提交前必跑这两条

```bash
node check-secrets.js      # 密钥红线：命中 0 条才算过（含 .env.example 里不许有真值）
node check-boundaries.js   # 输入边界：数据库 CHECK 与前端的数字必须一致
```

## 发布前跑这一条

```bash
node .workbuddy/skills/preflight-check/preflight-check.js

# 留一份机器可读报告 / 连前端工艺门槛一起跑（需先起本地服务）
node .workbuddy/skills/preflight-check/preflight-check.js --json preflight.json
node .workbuddy/skills/preflight-check/preflight-check.js --with-browser
```

它把上面两条门槛串起来，再补上公网可达、`.env` 忽略是否真生效、工作区与远端是否就绪、
线上是不是最新版——按 **红线 / 提醒 / 跳过** 三档给结论：红线全过 = `可发布`（退出码 0），
任一红线失败 = `不可发布`（退出码 1）。用法与判据见
`.workbuddy/skills/preflight-check/SKILL.md`。

要连数据侧一起验（健康接口、六表、读写接口、越权写是否被挡），跑一键验收：

```bash
node .workbuddy/skills/verify-project/verify-project.js --json verify.json
```

## 发布 / 备份 / 回滚

| 文档 | 什么时候看 |
|---|---|
| `docs/release-v1.0.md` | 要发新版：发布前验证项、发布方式、发布后逐项验证、备份怎么做、**发布成立检测实测** |
| `docs/rollback-manual.md` | 线上出事了：三层回退（代码 / 云函数 / 数据）+ 「什么情况必须回滚」判断表 + **手册可执行自检** |
| `docs/rollback-drill-record.md` | 想看演练到底跑没跑：两次演练的**回滚前时刻 / 恢复公网可用时刻 / 总耗时**三个硬数据 |

```bash
# 备份（发布前做；备份目录必须在仓库之外——发布会公开整个项目目录）
node db/export-data.js --out <仓库外目录> --label v1.0.0

# 恢复：把备份还原成可执行的 SQL，再逐条送进云数据库
node db/restore-from-backup.js --dir <备份目录>

# 「线上现在跑的是哪一版」——逐字节比对 11 个页面资产（不依赖浏览器/CDN）
node tools/check-live-version.js v1.0.0

# 「数据有没有被碰」——三张表的行数 + 指纹（回滚前后各跑一次做对比）
node tools/check-data-counts.js --tag 回滚前 --out 快照.json
node tools/check-data-counts.js --tag 回滚后 --compare 快照.json
```

⚠️ 回滚只解决**代码**问题；数据被误删只能靠备份重新导入，两者是分开的两件事。
备份能力边界（哪些表备不到）写在回滚手册 §二·第三层。

> `tools/` 里的两个核验器**刻意放在仓库内**：回滚手册要求同伴也能照着跑，脚本路径一律相对自身定位，换任何克隆目录都能用（原来放在仓库外的工作区，同伴根本拿不到）。

## 找人试用 / 处理卡点 / 查资源

| 文档 | 什么时候用 |
|---|---|
| `docs/trial-kit-outsider.md` | **直接转发给试用者**：手机上的 7 步任务，只说「点什么」，不说原理 |
| `docs/trial-record-template.md` | 试用时你在旁边记：逐步骤原话 + 卡点分类 + 「两处故意含糊」的对照表（**别给试用者看**） |
| `docs/triage-and-fix-prompt.md` | 拿到记录之后：怎么选最高优先级卡点、修复提示词模板、**发给用户的最小复验任务** |
| `docs/cloudbase-resource-check.md` | 查用量 / 看到期 / 导出数据的操作步骤 |
| `docs/resources-and-expiry.md` | 「资源与到期说明」成品（不含任何密钥），每次复测往里填一行 |
| `docs/delivery-inventory-day28.md` | **结营验收清单**（附录 J 重建版）：16 项逐条给「当场怎么展示」，14 过 / 2 如实标记 |
| `docs/day28-retro.md` | 结营复盘：28 天最大的认知改变 |
| `docs/final-acceptance-day28.md` | **最终验收表**：8 项逐条 PASS/FAIL/未执行 + 当场证据 + 已知缺口 |
| `docs/demo-script-day28.md` | 结营演示提纲（3–5 分钟）：用户问题 / 核心流程 / 提示词改写 / 验证方式 / 平台限制 / 后续优化 |
| `docs/delivery-brief-day28.md` | 交付说明：公网地址 / API 文档 / 数据库说明 / 部署清单 / **部署限制 6 条** |
| `docs/demo-run-record-day28.md` | 按提纲真跑一次的留档（脚本生成，数字不手写） |
| `docs/day28-status-and-next.md` | 已完成 / **未完成（如实标记）** / 结营后优化计划（真实数据源 / 注册登录 / 统计页） |

试用链路固定为：**打开 → 看到核心数据 → 完成一次核心操作 → 刷新确认 → 修改 → 删除**。
本项目的核心操作 = 提交一条待核查线索。

## 约定与文档

- `api-contract.md` —— 接口、数据表、RLS 闸门、错误口径、输入边界
- `AGENTS.md` —— 项目内规范（提交纪律、门槛）
- `docs/release-v1.0.md` / `docs/rollback-manual.md` / `docs/rollback-drill-record.md` —— 发布清单 / 回滚手册 / 演练记录
- `tools/` —— 线上版本核验器与数据完整性探针（回滚手册引用）
- `docs/` —— 每日交付留档（含决策留痕与实测证据）
