/* ============================================================
   home.js — 首页逻辑
   Day 15（v2 改版）：
     · 导航收敛为三个视图（辟谣榜 / 查询检索 / 论坛），hash 路由不引库
     · 原「热点卡片流」并入辟谣榜 —— 辟谣榜 = 全站条目按热度排序的列表，
       两者差别只是一组筛选条件，保留两个列表页属重复（v2 决策 2026-10-04）
     · 卡片升级为「排行榜条目」：序号 + 结论色条 + 热度角标 + 数据徽卡
   ============================================================ */

let ALL_ITEMS = []; // 全量数据（已通过 data.js 校验）

/** 结论标签 → CSS 类名（对应 style.css 的 .tag-存疑 等中文类名） */
function verdictTag(verdict) {
  return '<span class="tag tag-' + verdict + '">' + verdict + '</span>';
}

/** 热度取值：heat 缺失或不合法时回退 0（老数据也不至于排不出来） */
function heatOf(item) {
  return typeof item.heat === "number" && isFinite(item.heat) ? item.heat : 0;
}

/** 榜单排序：热度降序；热度相同按更新时间倒序 */
function sortByHeat(items) {
  return items.slice().sort((a, b) =>
    heatOf(b) - heatOf(a) ||
    String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
  );
}

/** 渲染单条榜单卡片（对应 PRD A1：标题 / 结论标签 / 摘要 / 更新日期） */
function renderCard(item, index) {
  const card = document.createElement("a");
  card.className = "card pop";
  card.href = "detail.html?id=" + encodeURIComponent(item.id);
  card.dataset.verdict = item.verdict;          // 驱动左侧结论色条（装饰 D4）
  card.style.animationDelay = (index * 0.06) + "s";

  const rank = String(index + 1).padStart(2, "0");  // 装饰 D3：01 / 02 / 03
  const heat = item.heat_note
    ? '<span class="heat-badge">' + item.heat_note + "</span>"   // 装饰 D5
    : "";

  card.innerHTML =
    '<span class="card-rank" aria-hidden="true">' + rank + "</span>" +
    '<div class="card-body">' +
      '<div class="card-top">' + verdictTag(item.verdict) + heat +
      '<span class="card-date">更新于 ' + item.updated_at + "</span></div>" +
      '<h3 class="card-title">' + item.title + "</h3>" +
      '<p class="card-summary">' + item.summary + "</p>" +
      '<p class="card-meta">信源 ' + item.sources.length + " 条（点开详情可逐一验证）</p>" +
    "</div>";
  return card;
}

/* ============================================================
   数据状态机（Day 13 起）：loading / ok / error
   「空」是各视图自己的语义，由各视图渲染
   ============================================================ */

let DATA_STATE = "loading";

/** 所有需要重绘的视图（新视图加进来时在这里挂一笔） */
function renderAllViews() {
  renderBoard();
}

/**
 * 状态闸门：数据处于「加载中 / 错误」时直接渲染对应状态并返回 true，调用方立即收工。
 * 这样每个视图都能看到完整的四种状态，不会出现「加载失败却永远停在加载中」。
 */
function stateGuard(listEl) {
  if (DATA_STATE === "loading") { renderListState(listEl, "loading"); return true; }
  if (DATA_STATE === "error") {
    renderListState(listEl, "error", { onRetry: initData });
    return true;
  }
  return false;
}

/** 入口：加载数据 → 落到 ok / error → 视图一次性渲染 */
async function initData() {
  DATA_STATE = "loading";
  renderAllViews();

  try {
    ALL_ITEMS = await loadItemsForPage(); // ?demo= 演示开关在 data.js 里统一处理
    DATA_STATE = "ok";
  } catch (err) {
    console.error("[home] 数据加载失败：", err);
    DATA_STATE = "error";
  }

  renderAllViews();
}

/* ============================================================
   视图一：辟谣榜（默认视图）
   数据对象 = data.json 全量条目；三组筛选叠加生效：
     ① 时间档（日 / 周 / 月 / 年，按 updated_at 距今天数）
     ② 核查结论（全部 / 真 / 假 / 部分属实 / 存疑）
     ③ 关键词（标题 + 摘要）
   排序：热度降序
   ============================================================ */

const VERDICT_ALL = "all";
const BOARD_RANGES = { day: 1, week: 7, month: 31, year: 365 };
const RANGE_NAMES = { day: "今日", week: "本周", month: "本月", year: "今年" };

let boardRange = "week";   // 当前时间档（默认周榜：一屏能看全，符合 PRD A1「5–10 张卡片」）
let boardKeyword = "";     // 当前关键词
let verdictFilter = VERDICT_ALL; // 当前结论筛选

/** updated_at 是否落在最近 days 天内（含今天） */
function inRange(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false; // 日期字段非法：不匹配（错误处理规范）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = (today - d) / 86400000;
  return diffDays >= 0 && diffDays < days;
}

/** 关键词匹配规则：标题 + 摘要（本地静态过滤，无后端） */
function matchKeyword(item, kw) {
  return (item.title + item.summary).indexOf(kw) !== -1;
}

/** 当前时间档内的全部条目（不含结论与关键词筛选） */
function getRangeItems(key) {
  const days = BOARD_RANGES[key];
  return ALL_ITEMS.filter((it) => inRange(it.updated_at, days));
}

/** 找出「比当前档更长、且有条目」的最短档位（给空状态指路，避免停在死胡同） */
function findLongerRange() {
  const order = ["day", "week", "month", "year"];
  const startIdx = order.indexOf(boardRange);
  for (let i = startIdx + 1; i < order.length; i++) {
    const key = order[i];
    const count = getRangeItems(key).length;
    if (count > 0) return { key: key, name: RANGE_NAMES[key], count: count };
  }
  return null;
}

/** 更新计数文案（档位 + 结论 + 关键词都反映进去；清空恢复时也要回到正确数字） */
function updateSummary(count) {
  const el = document.getElementById("filter-summary");
  if (!el) return;
  const parts = [];
  if (verdictFilter !== VERDICT_ALL) parts.push("「" + verdictFilter + "」");
  const kw = boardKeyword.trim();
  if (kw) parts.push("关键词「" + kw + "」");
  el.textContent = RANGE_NAMES[boardRange] + "榜" +
    (parts.length ? " · 筛选 " + parts.join(" + ") : "") + "：共 " + count + " 条";
}

/** 装饰 D6：页头数据徽卡（数字全部由真实数据算出，不是写死的） */
function renderStats() {
  const el = document.getElementById("board-stats");
  if (!el) return;
  if (DATA_STATE !== "ok") { el.innerHTML = ""; return; }

  const total = ALL_ITEMS.length;
  const caught = ALL_ITEMS.filter((it) => it.verdict === "假" || it.verdict === "部分属实").length;
  el.innerHTML =
    '<div class="stat-card"><span class="stat-num">' + total + '</span>' +
    '<span class="stat-label">收录条目</span></div>' +
    '<div class="stat-card"><span class="stat-num">' + caught + '</span>' +
    '<span class="stat-label">已戳穿</span></div>';
}

/** 渲染辟谣榜 */
function renderBoard() {
  const listEl = document.getElementById("board-list");
  const summaryEl = document.getElementById("filter-summary");

  renderStats();

  // 加载中 / 错误：交给状态闸门
  if (stateGuard(listEl)) {
    if (summaryEl) summaryEl.textContent = DATA_STATE === "loading" ? "正在加载数据…" : "数据未就绪";
    return;
  }

  if (!ALL_ITEMS.length) {
    renderListState(listEl, "empty", {
      text: "暂无核查数据（data.json 为空，或全部条目未通过校验）",
    });
    updateSummary(0);
    return;
  }

  let items = getRangeItems(boardRange);
  if (verdictFilter !== VERDICT_ALL) items = items.filter((it) => it.verdict === verdictFilter);
  const kw = boardKeyword.trim();
  if (kw) items = items.filter((it) => matchKeyword(it, kw));

  items = sortByHeat(items);
  updateSummary(items.length);

  // ---- 三种空态：各自有明确出口，不留死胡同 ----
  if (!items.length) {
    const hasVerdict = verdictFilter !== VERDICT_ALL;

    // ① 关键词没匹配上
    if (kw) {
      renderListState(listEl, "empty", {
        text: "没有找到相关内容",
        action: hasVerdict ? "清空全部筛选" : "清空关键词",
        actionId: "board-clear",
        onAction: () => {
          boardKeyword = "";
          const search = document.getElementById("board-search");
          if (search) search.value = "";
          if (hasVerdict) { applyFilter(VERDICT_ALL); return; }
          renderBoard();
        },
      });
      return;
    }

    // ② 结论筛选没结果
    if (hasVerdict) {
      renderListState(listEl, "empty", {
        text: "当前没有「" + verdictFilter + "」结论的核查条目。",
        action: "显示全部",
        actionId: "filter-reset",
        onAction: () => applyFilter(VERDICT_ALL),
      });
      return;
    }

    // ③ 当前时间档本身为空：若更长时间档有条目，指路过去
    const longer = findLongerRange();
    if (longer) {
      renderListState(listEl, "empty", {
        text: RANGE_NAMES[boardRange] + "暂无新增核查，" + longer.name + "有 " + longer.count + " 条",
        action: "查看" + longer.name,
        actionData: { range: longer.key },
      });
      return;
    }
    renderListState(listEl, "empty", {
      text: RANGE_NAMES[boardRange] + "暂无新增核查（数据更新后自动出现在这里）",
    });
    return;
  }

  // ---- 正常态 ----
  listEl.innerHTML = "";
  items.forEach((it, i) => listEl.appendChild(renderCard(it, i)));
}

/** 应用结论筛选：切换高亮、同步无障碍状态、重渲染 */
function applyFilter(verdict) {
  verdictFilter = verdict;
  document.querySelectorAll("#verdict-filter .chip").forEach((chip) => {
    const on = chip.dataset.verdict === verdict;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderBoard();
}

/** 应用时间档（含高亮同步） */
function applyRange(range) {
  if (!BOARD_RANGES[range]) return;
  boardRange = range;
  document.querySelectorAll("#board-tabs .tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.range === range)
  );
  renderBoard();
}

/** 绑定辟谣榜上的全部交互 */
function initBoard() {
  // 时间档
  document.querySelectorAll("#board-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => applyRange(tab.dataset.range));
  });

  // 结论 chip
  document.querySelectorAll("#verdict-filter .chip").forEach((chip) => {
    chip.addEventListener("click", () => applyFilter(chip.dataset.verdict));
  });

  // 关键词输入（输入即过滤，清空即恢复）
  const search = document.getElementById("board-search");
  if (search) {
    search.addEventListener("input", (e) => {
      boardKeyword = e.target.value;
      renderBoard();
    });
  }

  // 空状态里的动态按钮（事件委托）：
  //   「清空关键词」由 renderListState 的 onAction 处理；
  //   「查看X榜」是带 data-range 的指路按钮，这里接管
  document.getElementById("board-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".empty-jump");
    if (!btn || !btn.dataset.range) return;
    applyRange(btn.dataset.range);
  });
}

/* ============================================================
   Day 13 起：手写 hash 路由（不引入路由库）
   为什么选它：
     ① 刷新 / 分享 / 收藏链接都能回到同一个视图（纯 class 切换做不到）
     ② 浏览器前进后退天然可用，白捡一个「返回上一页」
     ③ 只有三个视图，路由库属于杀鸡用牛刀
   约定：#/board（默认）、#/search、#/forum；空 hash 或非法值一律回落 #/board
   ============================================================ */

const VIEWS = ["board", "search", "forum"];
const VIEW_TITLES = { board: "辟谣榜", search: "查询检索", forum: "论坛" };
const DEFAULT_VIEW = "board";
const BASE_TITLE = "热门时事真伪辨别";

/** 从地址栏解析当前视图；解析不出来就落到默认视图 */
function viewFromHash() {
  const m = String(location.hash || "").match(/^#\/?([a-zA-Z]+)/);
  const name = m ? m[1].toLowerCase() : "";
  return VIEWS.indexOf(name) !== -1 ? name : DEFAULT_VIEW;
}

/** 把界面切到指定视图（只改界面，不动地址栏） */
function paintView(name) {
  const view = VIEWS.indexOf(name) !== -1 ? name : DEFAULT_VIEW;

  VIEWS.forEach((v) => {
    const el = document.getElementById("view-" + v);
    if (el) el.classList.toggle("active", v === view);
  });

  document.querySelectorAll("#view-tabs .nav-tab").forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1; // 键盘 Tab 只停在当前标签上
  });

  document.title = (view === DEFAULT_VIEW ? "" : VIEW_TITLES[view] + " · ") + BASE_TITLE;
}

/** 切视图的唯一入口：同步地址栏 → 由 hashchange 统一处理（这样前进后退才能用） */
function goToView(name) {
  const view = VIEWS.indexOf(name) !== -1 ? name : DEFAULT_VIEW;
  if (viewFromHash() === view) { paintView(view); renderAllViews(); return; }
  location.hash = "#/" + view;
}

function initRouter() {
  const tabs = Array.from(document.querySelectorAll("#view-tabs .nav-tab"));

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => goToView(tab.dataset.view));

    // 可访问的导航标签——左右方向键 / Home / End 在标签间移动
    tab.addEventListener("keydown", (e) => {
      const map = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
      if (!(e.key in map)) return;
      e.preventDefault();
      const next = tabs[(map[e.key] + tabs.length) % tabs.length];
      next.focus();
      goToView(next.dataset.view);
    });
  });

  // 地址栏变化（含浏览器前进 / 后退）→ 切视图并重新渲染
  window.addEventListener("hashchange", () => {
    paintView(viewFromHash());
    renderAllViews();
    window.scrollTo(0, 0);
  });
}

/* ============================================================
   启动
   ============================================================ */

initRouter();
paintView(viewFromHash()); // 首屏按地址栏落位（直接打开 #/search 就停在这一档）
// 地址栏规范化：空 hash 或非法值补成默认视图（replaceState 不产生多余历史记录）
if (!new RegExp("^#/(" + VIEWS.join("|") + ")$").test(location.hash)) {
  history.replaceState(null, "", "#/" + viewFromHash());
}
initBoard();
mountDemoBanner();
initData();
