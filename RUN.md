# 运行说明（RUN.md）

本项目是纯静态网站（无后端、无数据库）。因为页面用 `fetch` 读取本地 JSON 数据，
**直接双击 HTML 文件会被浏览器的安全限制拦住**，必须通过一个本地静态服务器打开。

## 启动步骤

1. 打开终端（cmd 或 PowerShell）；
2. 进入项目文件夹：

   ```
   cd /d D:\AI\foxlings-project
   ```

3. 启动静态服务器（任选其一，本机已装 Python 3.13）：

   ```
   python -m http.server 8000
   ```

4. 浏览器打开：<http://localhost:8000>

## 页面导览

| 地址 | 内容 |
|---|---|
| `http://localhost:8000/#/feed` | 首页 · 热点卡片流（默认视图，结论筛选 + 关键词筛选） |
| `http://localhost:8000/#/board` | 首页 · 辟谣榜（日/周/月/年 + 检索） |
| `http://localhost:8000/#/favs` | 首页 · 我的收藏（收藏的条目 + 筛选） |
| `http://localhost:8000/detail.html?id=demo-005` | 详情页示例：溯源时间线 + 信源比对 |

点首页任意卡片即可进入对应详情页（地址带 `?id=条目id`）。

**视图切换走 hash 路由**（Day 13 起）：三个视图对应 `#/feed`、`#/board`、`#/favs`，
刷新、分享链接、浏览器前进/后退都能回到同一个视图；顶部标签支持 ← → / Home / End 键盘切换。

## 状态演示开关（仅供演示与验收）

地址栏加 `?demo=loading|empty|error` 可以强制复现对应的非正常状态（页面顶部会出现一条紫色提示，说明这是演示模式）：

| 地址 | 效果 |
|---|---|
| `http://localhost:8000/?demo=loading` | 停在「加载中」（60 秒后自动恢复） |
| `http://localhost:8000/?demo=empty` | 显示「暂无数据」空状态 |
| `http://localhost:8000/?demo=error` | 显示「数据加载失败 + 重试」错误状态 |

不带该参数（或值非法）时一切照常。此开关仅用于本地演示，接入真实后端后会删除（详见 `frontend-rules` Skill 的 N9 条）。

## 停止服务器

在终端按 `Ctrl + C`。

## 常见问题

- **页面空白 / 控制台报 fetch 失败**：多半是没走服务器（直接双击打开了 HTML），回到第 2 步；
- **端口被占用**（`Address already in use`）：换个端口，如 `python -m http.server 8001`，访问地址跟着换；
- **数据不显示**：检查 `data/data.json` 是否为合法 JSON（条目需通过 `js/data.js` 的字段校验，坏条目会被跳过并在控制台警告）。

## 部署（后续）

Day 7+ 计划部署到 GitHub Pages：仓库 Settings → Pages → 选择 main 分支根目录。
本文件由 Day 7~8 开发过程创建，运行方式变更时同步更新。
