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
| `http://localhost:8000` | 首页：热点卡片流（默认）+ 辟谣榜（日/周/月/年 + 检索） |
| `http://localhost:8000/detail.html?id=demo-005` | 详情页示例：溯源时间线 + 信源比对 |

点首页任意卡片即可进入对应详情页（地址带 `?id=条目id`）。

## 停止服务器

在终端按 `Ctrl + C`。

## 常见问题

- **页面空白 / 控制台报 fetch 失败**：多半是没走服务器（直接双击打开了 HTML），回到第 2 步；
- **端口被占用**（`Address already in use`）：换个端口，如 `python -m http.server 8001`，访问地址跟着换；
- **数据不显示**：检查 `data/data.json` 是否为合法 JSON（条目需通过 `js/data.js` 的字段校验，坏条目会被跳过并在控制台警告）。

## 部署（后续）

Day 7+ 计划部署到 GitHub Pages：仓库 Settings → Pages → 选择 main 分支根目录。
本文件由 Day 7~8 开发过程创建，运行方式变更时同步更新。
