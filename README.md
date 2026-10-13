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

## 约定与文档

- `api-contract.md` —— 接口、数据表、RLS 闸门、错误口径、输入边界
- `AGENTS.md` —— 项目内规范（提交纪律、门槛）
- `docs/` —— 每日交付留档（含决策留痕与实测证据）
