# Day 24 主任务 · 真实 Bug 修复记录（2026-10-12）

> 今天只修 **一个** Bug，但要求把「复现 → 定位 → 修复 → 验证」四步都留下证据。
> 本文就是这四步的原始记录；截图与脚本在 `verify/`（探针不进仓库）。
>
> ⚠️ 行号约定：第一节里的 `js/mine.js:474` / `:623` 是**修前**的行号（控制台原文里的那两个数
> 就是它们，照着能对上）；提到「修后行号」的地方都会写明。

---

## 零、一句话说清这个 Bug

**本地存储里混进一个非对象元素（`null`）→ 个人页在启动路径上抛未捕获异常 →
「我的收藏 / 浏览足迹 / 我的资料」三块一起不渲染，页面看起来只是「空的」，没有任何提示。**

严重度不在「那一条数据显示不出来」，而在**它是静默的**：用户看到的是一个半空的页面，
会以为是自己没收藏过、没提交过；排查的人如果不看控制台，第一反应会是「数据丢了」。

---

## 一、复现（第 ① 步）

**触发条件**（就一条）：浏览器里 `fx_myreports` 这个键的值是一个数组，而数组里有 `null`。

**控制台原文**（`verify/day24-bug-before.json`，逐字未改）：

```
Uncaught TypeError: Cannot read properties of null (reading 'text')
    at http://localhost:8000/js/mine.js:474:35
    at Array.map (<anonymous>)
    at reportRows (http://localhost:8000/js/mine.js:474:13)
    at renderReports (http://localhost:8000/js/mine.js:474:1)
    at http://localhost:8000/js/mine.js:623:1
```

**页面死到哪一步**（同一个脚本实测的 DOM 探针）：

| 探针 | 修前实测 | 说明 |
|---|---|---|
| `DATA_STATE` | `loading` | 停在初始值 —— 说明 `initData()` **根本没跑** |
| 我的收藏 | 「共 0 条」＋列表空 | `fx_favs` 里明明有一条合法 id |
| 浏览足迹 | 计数为空、0 行 | |
| 我的资料 | 表单空白 | |
| 我的待核查 | 列表空 | 抛异常的就是这一块的渲染函数 |
| 页面横幅 | 「页面遇到一个没预料到的问题…」 | Day 25 加的全局兜底抓到了它 |

关键在第 1 行：`js/mine.js` 的启动是一串**平铺调用**，
`renderReports()` 排在 `initData()` 与 `initProfile()` **之前**（`js/mine.js:623`）——
它在第 623 行抛出，后面 624 / 625 / 634 行就一行都不会执行。
所以症状不是「线索区坏了」，而是「**从第 623 行往后整段初始化都没了**」。

### 这个坏值是怎么来的（三条真实路径，不是「假想的坏数据」）

1. **`JSON.stringify` 的规范行为**：`JSON.stringify([undefined]) === "[null]"`。
   数组里只要混进一个 `undefined`，落盘就变成 `null`。
2. **`localStorage` 是跨版本的持久状态**：代码升级了，用户浏览器里那份旧值不会自己变干净。
   键名 `fx_myreports` 在 Day 19 被搬过一次家（mine.js → data.js 公共层），
   形状约定变更时**旧值留在用户机器上**，新版代码第一次读到就要面对它。
3. **最有力的依据 —— 同一个存储约定，写的那一端本来就在防**：

   ```js
   // js/detail.js:357（写浏览足迹）
   list = list.filter((x) => x && x.id !== id);   // ← 这个 `x &&` 就是「数组里可能有非对象元素」
   ```
   写的人知道会有坏元素，**读的那一端（`js/mine.js`）没跟上**。
   这不是我设想出来的场景，是这个代码库自己承认过的场景。

---

## 二、定位（第 ② 步）

### 先排除掉其他可能（这一步比结论重要）

| 怀疑对象 | 怎么排掉的 |
|---|---|
| 云端读不到 / 网络问题 | 未登录时 `loadReports()` 直接 return，**根本不会发请求**；控制台里也没有任何网络类报错 |
| 数据本身是空的 | 收藏摘要显示「共 0 条」，但 `fx_favs` 里有一条合法 id、收藏列表却是空的 —— 「有数据但没渲染」＝渲染路径的问题，不是数据源的问题 |
| CDN / SDK 没加载 | 控制台里没有 SDK 相关错误；同一个浏览器把 `fx_myreports` 清掉后**立刻恢复正常** |
| Day 25 新加的全局兜底引入的 | 兜底只负责「显示一条横幅」，异常源清清楚楚写着 `js/mine.js:474`，在兜底代码之外 |
| 收藏 / 足迹的渲染函数各自坏了 | 它们**都没有被执行** —— `DATA_STATE` 停在 `loading` 是硬证据（`renderAll()` 一次都没跑） |

### 二分定位（锁到「一个键、一行」）

保持 `fx_favs` / `fx_history` 不变，只动 `fx_myreports`：

| `fx_myreports` 的值 | 结果 |
|---|---|
| `[]` | 正常 |
| `[{text:"…",at:…}]` | 正常 |
| `[{text:"…",at:…}, null]` | **崩**（`mine.js:474`） |

→ 锁定：`js/mine.js` 的 `reportRows()`。

### 根因

```js
// 修前 js/mine.js:472-475
const local = readJSON(REP_KEY, []);
return Array.isArray(local)
  ? local.map((r) => ({ text: r.text, at: r.at, cloud: false }))   // ← 只判了「是不是数组」
  : [];
```

它只校验到**容器**这一层（「是不是数组」），没有校验**元素**这一层（「元素是不是对象」）。
而 `data.js` 里的 `readJSON()` 注释写的是：

> 读 localStorage 里的 JSON：不存在或坏了都退回默认值（**不让页面挂掉**）

注释只兑现了一半：`JSON.parse` 失败它管了，「**能 parse 但元素形状不对**」它没管 ——
`[null]` 既能 parse 也是数组，于是直接从这道防线中间穿过去。

**同一个根因还有第二个读取点**（`js/mine.js` 的 `renderHistory()`）：

```js
hist.map((h) => ({ item: ITEMS.find((it) => it.id === h.id), at: h.at }))   // 元素是 null 时 h.id 一样抛
```

它这次没暴露，只是因为 `renderReports()` 先抛了、`initData()` 没跑到它而已。

---

## 三、修复（第 ③ 步）

### 改动

**`js/data.js`（新增 1 个函数）** —— 把「元素级校验」补在公共层的 `readJSON` 旁边：

```js
function readJSONList(key, isItem) {
  const raw = readJSON(key, []);
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((x, i) => {
    let ok = false;
    try { ok = !!isItem(x); } catch (e) { ok = false; }   // 判别器自己也不许把页面带崩
    if (ok) out.push({ item: x, raw: i });
  });
  return out;
}
```

**`js/mine.js`（改 3 处）**：
1. `reportRows()` 本地那一路改走 `readJSONList(REP_KEY, isLocalReport)`，并新增判别器
   `isLocalReport()`（必须是对象、文本是非空字符串）；
2. `renderHistory()` 改走 `readJSONList(HIST_KEY, …)`（**同一根因的第二个读取点**）；
3. 删除按钮的 `data-idx` 从「渲染序号 `i`」改成「**原始下标 `r.raw`**」。

### 为什么第 3 处非改不可（这是修复的连带后果，不是顺手多修）

滤掉坏元素之后，如果还用重新编号的 `i`：

| 存储原始值 | 渲染出来的那一行带的下标 | 点「删除」时 `splice` 掉的是 |
|---|---|---|
| `[null, 好线索]`（用 `i`） | `0` | `null` → **用户点的那条纹丝不动**，看起来像「删除按钮坏了」 |
| `[null, 好线索]`（用 `raw`） | `1` | 好线索 ✓ |

也就是说：**不一起改，我就是在修一个 Bug 的同时送一个更隐蔽的 Bug**（静默删错条）。
所以 `readJSONList` 的返回形状里才保留了 `raw`。
`verify/day24-bug-repro.js` 的 `drift` 用例就是专门验这个的（实测删除按钮下标 = 1，删掉的正是被点的那条）。

### 为什么不直接改 `readJSON()`

它还有别的调用方，语义不一样：`fx_favs` 存的是**字符串 id 数组**、`fx_viewed` 同理 ——
对它们来说「元素是字符串」才是合格，硬塞一套对象判别器会把好数据也滤掉。
所以新加一个函数，让调用方提供「什么算合格」，**默认行为一个字不动**。

### 记录但**今天不修**的（今天的纪律是只修一个 Bug）

1. **`js/mine.js:594`（修后行号）删除处理里的 `Number(del.dataset.idx)` 没有校验。**
   若 `idx` 缺失/非数字，`arr.splice(NaN, 1)` 会被当成 `splice(0, 1)` —— 静默删掉第一条。
   目前不可达（`data-idx` 由我们自己的渲染代码写入，永远是合法整数），属同一处的健壮性缺口。
2. **`js/home.js:252` 空状态文案仍写着「data.json 为空」。**
   Day 20 就改成读云库了，Day 25 修了 `detail.js` / `data.js` 两处同样的遗留，漏了这一处。
   纯文案问题，不影响功能。
3. **`js/data.js:178` 的注释与代码不符**：写着 `REP_KEY` 是「mine.js 与论坛共用」，
   但 `js/forum.js` 里根本没有用到这个键（已核实：全仓只有 `mine.js` 读写它）。
   注释错会误导后来的人以为「改这个键要顾两个页面」。

---

## 四、验证（第 ④ 步）

### 修前 / 修后对照（同一脚本、同一份坏数据：`fx_myreports=[{…},null]` + `fx_history=[{…},null]`）

| 指标 | 修前 | 修后 |
|---|---|---|
| 未捕获异常 | **1 条**（`TypeError … 'text'` @ `mine.js:474`） | **0 条** |
| 控制台 error | 1 条（兜底横幅） | **0 条** |
| `DATA_STATE` | `loading`（启动中断） | **`ok`** |
| 我的收藏 | 空 | 共 1 条（正常渲染） |
| 浏览足迹 | 空 | 最近 1 条 |
| 我的待核查 | 空 | 共 1 条（仅本机），坏元素被静默剔除 |
| 页面横幅 | 出现「遇到一个没预料到的问题」 | **没出现** |

### 离线回归单测：`verify/test-day24-localstorage.js` —— **20 / 20 通过**

加载的是仓库里**真**的 `js/data.js`（沙箱里只替换 `window` / `localStorage`）。
每组都带**负例靶子**（本项目的老规矩：不证明「旧的会红」等于没验）：

- ① 旧写法 `[null].map(r => r.text)` → **确实抛** `TypeError: Cannot read properties of null`
- ② 旧写法 `[null].map(h => h.id)` → **同样抛**（证明第二个读取点是同一根因、同样致命）
- ③④ 新写法对同样输入不抛；`null` / 空文本 / 数字 / 裸字符串 / 数组元素全被剔，好数据保留
- ⑤ 反证「下标错位」：用渲染序号删掉的是 `null`，用 `raw` 删掉的才是用户点的那条
- ⑥ 判别器自己抛错被吞掉，返回空表（页面不带崩）
- ⑦ 非法 JSON / 非数组 / 键不存在 → 一律空表
- ⑧⑨ 正常数据与好坏混杂的数据：**数量、顺序、文本、raw 都对得上**（别把好数据也滤掉）

### 页面级验证：`verify/day24-bug-repro.js`

| 用例 | 结果 |
|---|---|
| `after / both`（两个键都坏） | 0 异常、`DATA_STATE=ok`、三块全部渲染 ✅ |
| `after / drift`（坏元素在**前**） | 删除按钮下标 = **1**；点击后存储剩 `[null]` —— **删掉的正是被点的那条** ✅ |

### 门槛回归

```
node check-secrets.js     → PASS（红线 0 条）
node check-boundaries.js  → PASS（10 组长度 + 3 组枚举三方一致）
node --check js/mine.js js/data.js → 语法通过
```

### 留证清单

| 文件 | 内容 |
|---|---|
| `verify/day24-bug-before.json` | **修前**的控制台原文与页面探针（报错原文那一行在里面） |
| `verify/day24-bug-before-page.png` | 修前的页面实况（半空 + 兜底横幅） |
| `verify/day24-bug-after-both.json` | 修后（两个键都坏）—— 0 异常 |
| `verify/day24-bug-after-drift.json` | 修后（坏元素在前）—— 删除未错位 |
| `verify/day24-bug-after-page.png` | 修后的页面实况 |
| `verify/test-day24-localstorage.js` | 离线回归单测（20 项，可复跑） |
| `verify/day24-bug-repro.js` | 复现 + 验证脚本（before / after 同一套） |

---

## 五、这个 Bug 留下的教训（一句话）

**「能 parse」不等于「形状对」。**
凡是把外部持久状态读回来当数据用的地方，校验必须做到**元素**这一层 ——
`data.js` 的 `readJSON` 注释本来就写着「坏了不让页面挂掉」，
它只做到一半，剩下那一半就在今天炸了。
