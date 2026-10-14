# verify-project · 实跑留痕（建成当日：2026-10-14）

纪律：**至少跑两次，第一次专门找误报和漏报**。以下时间线全部真实，
产物在**工作区** `verify/`（不进仓库），真仓库全程零污染。

## 第一轮 · 基线（找茬轮）

```
node verify-project.js --json verify/verify-project-run1.json
```

结果：全绿。**全绿正是最需要怀疑的时候** —— 逐项核对判据，抓到 3 处问题：

| # | 问题 | 定性 | 修正 |
|---|---|---|---|
| 1 | H3 只数「取回多少行」，没用 `Prefer: count=exact` —— 数据超 1000 行时会**假绿** | 漏报 | 加 `Prefer: count=exact`，判据改成「取回行数 == content-range 总数」 |
| 2 | H4 ①的判据只写「返回是数字」，契约其实写明「条目不存在返回 **-1**」（db/schema.sql 注释） | 判据过松 | 收紧到契约值 -1，并加「污染自检」（items 行数前后一致） |
| 3 | H5 的判据里「错误表名」的分界线只是推断，没实测 | 未验证的断言 | 实测：不存在的表回 404+`DATABASE_PGRST205`，与「表在但被拒」的 401+`DATABASE_42501` 形态完全不同，判据成立并写入注释 |

## 第二轮 · 修正后（含浏览器页面级证据）

```
node verify-project.js --with-browser --sdk <本地SDK副本> --json verify/verify-project-run2.json
```

结果：红线 13 项全过 → 可发布。页面级证据抓到**时间依赖数据**的坑：
首页默认「本周」档 0 张卡，但空态写着「本月有 15 条」。

修正：H5 探针升级 —— 空档时**点「查看本月」再数一次卡片**（15 张，直接证据），
不再只依赖空态文案里的间接数字。

## 第三轮 · 措辞修正后定稿

- 发现 H5 报告里按钮名显示为空（`点开「」后`）—— 原因：按钮文字在**跳转后**才读，
  那时空态已被卡片替换。改成从跳转前那一次读，现在正确显示「点开「查看本月」后…」。
- 定稿运行：`verify-project-good.json`（好）／`verify-project-bad.json`（坏）。

## 反证（故意弄坏，看红的是不是正好那一处）

| 反证 | 命令 | 实测结果 | 产物 |
|---|---|---|---|
| ① 地址指错 | `--site http://127.0.0.1:9` | **U1/U2/H1/H2/H3/H4/H5 七项 FAIL**，S1/S2/S3/E1/E2/D2 照旧绿，exit 1 | `verify-project-bad.json` |
| ② 表名加错 | `--tables items,…,no_such_table_at_all` | **只有 H2 FAIL**（认出 404+`PGRST205`），其余全绿，exit 1 | `verify-project-busted-table.json` |

> 反证②第一次落盘时输出文件只有 8 行（`> file 2>&1` 与 preflight 子进程输出抢写所致），
> 直接重跑即完整。结论以重跑为准。

## 独立复算（检测 2：输出可信）

抽 3 项 PASS，用**完全不经过本 Skill 代码**的脚本亲手重做
（`verify/handcheck-verify-project.js`，刻意不 require verify-project.js、不读它的 JSON）：

| 项 | 亲手做法 | 我的结论 | Skill 的结论 | 一致？ |
|---|---|---|---|---|
| H2 | 逐张表 fetch，按状态码+错误码判定 | PASS（6 张表全在） | PASS | ✅ |
| H4 | 亲手发 4 发零污染探针 | PASS（-1 / 401 / 401 / 401，items 仍 23 行） | PASS | ✅ |
| E1 | `git check-ignore -v .env` | PASS（`.gitignore:2` 命中） | PASS | ✅ |

## 「好 / 坏」打卡图

- `verify/verify-project-bad.png` —— 坏 → 7 项红 → 不可发布（exit 1）
- `verify/verify-project-good.png` —— 好 → 13 项红线全过 → 可发布（exit 0）

文字全部逐字来自脚本自己写的 JSON，不是手抄。

## 本轮挖出的实现坑（记在这里防再踩）

1. `jumpText` 在跳转后才读必为空串（空态已被卡片替换）——按钮文字要从跳转前读。
2. `> file 2>&1` 落盘可能被子进程输出抢写截断 —— 判「跑崩」前先重跑一次。
3. PASS 项也要亮证据行，否则「PASS + 证据」只对 FAIL 成立。
