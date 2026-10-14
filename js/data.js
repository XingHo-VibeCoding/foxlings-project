/* ============================================================
   data.js — 数据加载与校验（TECH_DESIGN 第七节错误处理规范）
   职责：拉取 data.json → 校验字段 → 通过的条目交给页面渲染；
   坏条目跳过并在控制台警告，页面照常渲染其余条目。
   ============================================================ */

const VERDICTS = ["真", "假", "存疑", "部分属实"];

/**
 * 加载并校验数据。返回 Promise<Array>（只含通过校验的条目）。
 * 全部失败时 reject，由调用方显示重试界面。
 *
 * Day 20：数据来源从「直接 fetch data.json」改为走接口层 api.getItems() ——
 * 本函数不再关心数据存在哪（云数据库 or 本地文件），那是 api.js 的事。
 * 校验逻辑原样保留：后台录错的数据同样要被挡在页面之外。
 */
async function loadVerifiedData() {
  let rawItems;
  try {
    rawItems = await api.getItems();
  } catch (err) {
    console.error("[data] 数据加载失败：", err);
    throw err; // 调用方显示重试按钮
  }

  const items = Array.isArray(rawItems) ? rawItems : [];
  const good = [];

  items.forEach((item, i) => {
    const problems = [];
    if (!item.id) problems.push("缺 id");
    if (!item.title) problems.push("缺 title");
    if (!VERDICTS.includes(item.verdict)) problems.push("verdict 非法：" + item.verdict);
    if (!item.summary) problems.push("缺 summary");
    if (!Array.isArray(item.sources) || item.sources.length < 2) problems.push("sources 不足 2 条");
    if (!item.origin) problems.push("缺 origin（允许值为「未能溯源」+已知流传信息）");
    if (!item.first_seen) problems.push("缺 first_seen");
    if (!item.updated_at) problems.push("缺 updated_at");

    if (problems.length) {
      console.warn("[data] 第 " + (i + 1) + " 条被跳过（" + problems.join("；") + "）", item);
    } else {
      good.push(item);
    }
  });

  return good;
}

/* ============================================================
   Day 13：列表「四种状态」的统一渲染
   正常态（有数据）由各视图自己渲染列表；这里只管另外三种：
     loading 加载中 / empty 空 / error 错误
   约定：容器内一律使用 .empty-state 作为外层类（另加 state-xxx 修饰类），
        出口按钮统一用 .empty-jump —— 与既有样式和 Skill 检查保持一致。
   ============================================================ */

/**
 * 把某个列表容器渲染成指定状态。
 * @param {HTMLElement} container 列表容器
 * @param {"loading"|"empty"|"error"} state
 * @param {Object} [opts]
 *   text        空状态的说明文案
 *   action      出口按钮文案（不传则没有按钮）
 *   actionId    出口按钮的 id（保持既有测试选择器可用）
 *   onAction    出口按钮点击回调
 *   desc        错误状态的补充说明
 *   onRetry     错误状态「重试」回调
 */
function renderListState(container, state, opts) {
  opts = opts || {};
  const box = document.createElement("div");
  box.className = "empty-state state-" + state;
  // 加载中/空是状态播报；错误用 alert 让读屏软件立刻读出
  box.setAttribute("role", state === "error" ? "alert" : "status");

  if (state === "loading") {
    box.innerHTML =
      '<span class="spinner" aria-hidden="true"></span><span>正在加载…</span>';
  } else if (state === "error") {
    box.innerHTML =
      '<strong class="state-title">数据加载失败</strong>' +
      '<span class="state-desc">' + (opts.desc || "可能是网络不通，或数据服务暂时不可用——过一会儿点「重试」。") + "</span>" +
      '<button type="button" class="empty-jump" data-state-act="retry">重试</button>';
  } else {
    let extra = "";
    if (opts.action && opts.actionData) {
      Object.keys(opts.actionData).forEach((k) => {
        extra += " data-" + k + '="' + opts.actionData[k] + '"';
      });
    }
    // 出口既可以是按钮（留在本页做事），也可以是链接（跳到别的页面）
    let actionHtml = "";
    if (opts.action && opts.actionHref) {
      actionHtml = '<a class="empty-jump" href="' + opts.actionHref + '">' + opts.action + "</a>";
    } else if (opts.action) {
      actionHtml =
        '<button type="button" class="empty-jump" data-state-act="act"' +
        (opts.actionId ? ' id="' + opts.actionId + '"' : "") + extra + ">" + opts.action + "</button>";
    }
    box.innerHTML =
      '<span class="state-desc">' + (opts.text || "暂无数据") + "</span>" + actionHtml;
  }

  container.innerHTML = "";
  container.appendChild(box);

  if (state === "loading") return;
  const btn = box.querySelector("[data-state-act]");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (state === "error") { if (opts.onRetry) opts.onRetry(); return; }
    if (opts.onAction) opts.onAction();
  });
}

/** 兼容旧调用：显示"加载失败 + 重试"界面（渲染进指定容器） */
function showLoadError(container, retryFn) {
  renderListState(container, "error", { onRetry: retryFn });
}

/* ============================================================
   Day 13：状态演示开关（仅供本地演示与验收，接后端后可整段删除）
   地址栏 ?demo=loading|empty|error 可以稳定复现三种非正常状态；
   不带该参数（或值非法）时一切照常。
   ============================================================ */

function readDemoState() {
  const v = (new URLSearchParams(location.search).get("demo") || "").toLowerCase();
  return ["loading", "empty", "error"].indexOf(v) !== -1 ? v : "";
}

/**
 * 按演示开关加载数据（首页与详情页共用）：
 *   不带 ?demo=     → 正常加载
 *   ?demo=error     → 直接抛错，走错误状态
 *   ?demo=empty     → 返回空列表，走空状态
 *   ?demo=loading   → 先等 60 秒再加载，便于观察/截图「加载中」
 */
async function loadItemsForPage() {
  const demo = readDemoState();
  if (demo === "error") throw new Error("演示：强制加载失败（?demo=error）");
  if (demo === "empty") return [];
  if (demo === "loading") await new Promise((r) => setTimeout(r, 60000));
  return loadVerifiedData();
}

/** 演示模式下在页面顶部挂一条醒目提示，避免误以为是真故障 */
function mountDemoBanner() {
  const demo = readDemoState();
  if (!demo) return;
  const names = { loading: "加载中", empty: "空", error: "错误" };
  const p = document.createElement("p");
  p.className = "demo-banner";
  p.setAttribute("role", "status");
  p.textContent =
    "🧪 演示模式：正在强制显示「" + names[demo] + "」状态 —— 去掉地址栏里的 ?demo=" + demo + " 即恢复正常";
  const main = document.querySelector("main");
  if (main) main.insertBefore(p, main.firstChild);
}

/** 按条目 id 从地址栏读取详情页参数 */
function getIdFromUrl() {
  return new URLSearchParams(location.search).get("id");
}

/* ============================================================
   Day 19：全站共用的小工具与本地存储键（做论坛时上移到公共层）
   来源：escHtml 原在 search.js、readJSON 与三个键名原在 mine.js / detail.js
        各写一份。论坛（forum.js）也要转义用户输入，
        故上移到三页都会加载的 data.js —— 「同一份数据只有一个定义」，
        将来接后端替换本地存储时也只改这一处。

   Day 26 更正：原注释写「论坛（forum.js）要往同一个键里暂存线索」，与事实不符 ——
        全仓引用 REP_KEY 的只有 mine.js 一个文件（`grep -rn "REP_KEY" js/` 可复现）。
        不实的注释比没有注释更坏：它会让人以为动这个键要连带检查论坛。
   ============================================================ */

/** 本地存储键（api-contract.md 第一节「本地存储」表的唯一实现） */
const FAV_KEY = "fx_favs";        // 收藏的条目 id 列表（detail.js 写 / mine.js 读）
const HIST_KEY = "fx_history";    // 浏览足迹 {id, at}[]（detail.js 写 / mine.js 读）
const REP_KEY = "fx_myreports";   // 我提交的待核查线索 {text, at}[]（只有 mine.js 读写：未登录时的本机留底）
const VIEW_KEY = "fx_viewed";     // 已上报过浏览的条目 id 列表（detail.js 写，防止同一条被重复计数）
const HIST_MAX = 20;              // 浏览足迹最多保留几条

/** 读 localStorage 里的 JSON：不存在或坏了都退回默认值（不让页面挂掉） */
function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}

/* ============================================================
   Day 24 修复：本地存储的**元素级**校验（readJSON 只管到「能 parse」）

   【Bug】readJSON 的注释写着「坏了都退回默认值（不让页面挂掉）」，
   但它只兜住了 JSON.parse 失败这一层。「JSON 能 parse、确实是数组、
   里面却混着非对象元素」这一层没人管 —— `[null]` 就是这种值。
   于是 `arr.map((r) => r.text)` 当场抛
   `TypeError: Cannot read properties of null (reading 'text')`。
   而这类读取点往往在**页面启动路径**上：一抛，后面整段初始化都不跑
   （js/mine.js 的真实症状：收藏 / 浏览足迹 / 我的资料三块一起不渲染，
   用户看到的只是「页面是空的」，完全不知道有一条本机数据坏了）。

   【为什么这不是「假想的坏数据」】
     · `JSON.stringify([undefined])` 的结果就是 `"[null]"`（JSON 规范行为），
       数组里只要混进一个 undefined，落盘就变成 null；
     · localStorage 是**跨版本、跨标签页、用户可手改**的持久状态 ——
       代码可以升级，用户浏览器里那份旧值不会自己变干净；
     · 同一个存储约定的写入端本来就在防这件事：js/detail.js 写浏览足迹时写的是
       `list.filter((x) => x && x.id !== id)` —— 写的人知道可能有非对象元素，
       读的人（js/mine.js）没跟上。

   【返回形状】保留**原始下标** `raw`：调用方要靠它定位（删除按钮的 data-idx）。
   如果把坏元素滤掉后重新编号，用户点的那条与真正删掉的那条就会错位 ——
   那是修一个 Bug 送一个 Bug。 */
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

/* ============================================================
   Day 26 修复：DOM 上的下标同样不可信（readJSONList 那一族的第二个坑）

   删除按钮把原始下标写在 `data-idx` 属性上，点删除时用
   `Number(del.dataset.idx)` 取回来。这条路径上有两个失真点：
     · 属性不存在（→ `Number(undefined)` = NaN；页面是旧版缓存时就是这样）；
     · 用户按 F12 手改属性（→ 任意值）。
   而 `arr.splice(NaN, 1)` 等价于 `splice(0, 1)` —— **静默删掉第一条**：
   用户点的是第 5 条，消失的却是第 1 条，且没有任何报错。
   和 Day 24 那个坑同源：不是数据坏了，是「谁都没校验这个值」。
   ============================================================ */

/** 把外部来的下标校验成数组里真实存在的下标；非法一律返回 -1，
    调用方**必须显式处理**它 —— 绝不许静默兜底成 0（0 是合法的删除目标，
    兜底成 0 等于替用户选了一条删）。
    注意 `Number("")` 与 `Number(null)` 都是 0，所以不能只靠 Number() 判；
    这里只认两种形态：真整数、纯数字字符串。 */
function safeIndex(value, len) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < len) return value;
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) < len) return Number(value);
  return -1;
}

/** 用户可控文本拼进 HTML 之前必须转义（检索词、帖子标题与正文都走它） */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ============================================================
   Day 25（安全审计补）：未捕获异常的兜底 —— 最后一道网

   【为什么需要它】
   项目里所有「预期会失败」的地方都有 try/catch，报错也都翻成了中文。
   但还有一类：**没人预料到会抛的** —— 某个回调里漏了一个 await、
   某个 SDK 在升级后改了返回形状、某个第三方脚本抛了错。
   这类异常不会走任何 catch，结果就是：点了没反应，控制台里一条红字，
   用户完全不知道发生了什么（这类「静默失败」是最难查的 bug）。

   【它做什么】
   控制台照旧留全部原文（排查用），页面上补一条能看见的中文横幅：
   说清「不是你操作错了」+「刷新可恢复」，并带一个刷新按钮。
   **不弹 alert**（打断且丑），**不吞异常**（原文照样进控制台）。

   【为什么放在 data.js】
   它是四个页面（index / detail / mine / admin）都加载的公共层，
   和 escHtml、renderListState 一样属于「全站共用」。放这儿不用改四个 html。
   ⚠️ 已知边界：脚本加载顺序上 data.js 排在 api.js 之后，
      所以「api.js 自身在解析期就抛错」这种情况它兜不住（那种错页面本来也起不来）。 */
const CRASH_BANNER_ID = "fx-crash-banner";

/** 挂一条横幅；已经挂过就只更新文案（连环报错不会堆出一排横幅）

    这里刻意用 createElement 逐节点搭，而不是 innerHTML + 再取 id：
    页面里本来没有这条横幅，它只在这条路径上被造出来 ——
    写 innerHTML 的话就得多一次按 id 回捞（frontend-rules 的 H2 会把它当成
    「脚本引用了一个页面里不存在的 id」）。节点引用直接握在手里最省事。 */
function mountCrashBanner(text) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(CRASH_BANNER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = CRASH_BANNER_ID;
    el.className = "fx-crash-banner";
    el.setAttribute("role", "alert");

    const span = document.createElement("span");
    span.className = "fx-crash-text";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "empty-jump";
    btn.textContent = "刷新页面";
    btn.addEventListener("click", () => location.reload());

    el.appendChild(span);
    el.appendChild(btn);
    (document.body || document.documentElement).appendChild(el);
  }
  // 第 2 次起只换文案（按钮是同一个，监听器不重复挂）
  const textEl = el.querySelector(".fx-crash-text");
  if (textEl) textEl.textContent = text;
}

/** 未处理的 Promise 拒绝（最常见的漏网形态：忘了 await 的 async 调用） */
window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev && ev.reason;
  console.error("[fx] 未处理的异步错误：", reason);
  // 已经翻成中文的（比如接口层抛出来的）就照原话显示，英文原文不往界面上送
  const msg = reason && /[\u4e00-\u9fa5]/.test(String(reason.message || ""))
    ? String(reason.message)
    : "页面遇到一个没预料到的问题，刚才这一步可能没成功。刷新页面可以恢复正常。";
  mountCrashBanner(msg);
});

/** 未捕获的同步异常（脚本错误；资源加载失败不会走到这里） */
window.addEventListener("error", (ev) => {
  console.error("[fx] 未捕获的错误：", ev && (ev.error || ev.message));
  mountCrashBanner("页面遇到一个没预料到的问题，刚才这一步可能没成功。刷新页面可以恢复正常。");
});
