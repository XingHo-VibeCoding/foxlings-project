/* ============================================================
   home.js — 首页逻辑
   第 2 步：视图切换 + 热点卡片流渲染（辟谣榜第 3 步实现）
   ============================================================ */

let ALL_ITEMS = []; // 全量数据，辟谣榜（第 3 步）复用

/** 结论标签 → CSS 类名（对应 style.css 的 .tag-存疑 等中文类名） */
function verdictTag(verdict) {
  return '<span class="tag tag-' + verdict + '">' + verdict + '</span>';
}

/** 渲染单张卡片：标题 / 结论标签 / 摘要 / 更新日期（对应 PRD A1、A2） */
function renderCard(item, index) {
  const card = document.createElement("a");
  card.className = "card pop";
  card.href = "detail.html?id=" + encodeURIComponent(item.id);
  card.style.animationDelay = (index * 0.08) + "s"; // 卡片进场逐条弹出
  card.innerHTML =
    "<div>" + verdictTag(item.verdict) +
    '<span class="card-date">更新于 ' + item.updated_at + "</span></div>" +
    '<h3 class="card-title">' + item.title + "</h3>" +
    '<p class="card-summary">' + item.summary + "</p>" +
    '<p class="card-meta">信源 ' + item.sources.length + " 条（点开详情可逐一验证）</p>";
  return card;
}

/** 视图一：热点卡片流（Day 12 起支持按核查结论筛选；Day 12 延伸起支持关键词筛选） */
const VERDICT_ALL = "all";        // 筛选值：全部
let verdictFilter = VERDICT_ALL;  // 当前筛选的结论
let feedKeyword = "";             // 当前关键词（与结论筛选「叠加」生效：两个条件同时满足）

/** 关键词匹配规则：标题 + 摘要（本地静态过滤，无后端） */
function matchKeyword(item, kw) {
  return (item.title + item.summary).indexOf(kw) !== -1;
}

/* ============================================================
   Day 13：数据状态机 + 手写 hash 路由
   三个视图共用一份数据，数据状态只有三种：loading / ok / error；
   「空」是各视图自己的语义（无条目 / 筛空 / 零收藏），由各视图渲染。
   ============================================================ */

let DATA_STATE = "loading"; // loading | ok | error

/** 三个列表视图一起渲染（切换视图时不会看到别的视图的残留状态） */
function renderAllViews() {
  renderFeed();
  renderBoard();
  renderFavView();
}

/**
 * 状态闸门：数据处于「加载中 / 错误」时直接渲染对应状态并返回 true，调用方立即收工。
 * 这样三个视图都能看到完整的四种状态，不会再出现「加载失败却永远停在加载中」。
 */
function stateGuard(listEl) {
  if (DATA_STATE === "loading") { renderListState(listEl, "loading"); return true; }
  if (DATA_STATE === "error") {
    renderListState(listEl, "error", { onRetry: initData });
    return true;
  }
  return false;
}

/** 入口：加载数据 → 落到 ok / error → 三个视图一次性渲染 */
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

/** 视图一：热点卡片流（加载/错误 → 状态；数据就绪 → 按当前筛选条件渲染） */
function renderFeed() {
  const listEl = document.getElementById("card-list");
  const summaryEl = document.getElementById("filter-summary");

  if (stateGuard(listEl)) {
    if (summaryEl) summaryEl.textContent = DATA_STATE === "loading" ? "正在加载数据…" : "数据未就绪";
    return;
  }

  if (!ALL_ITEMS.length) {
    renderListState(listEl, "empty", {
      text: "暂无核查数据（data.json 为空，或全部条目未通过校验）",
    });
    resetFilterSummary(0);
    return;
  }

  renderFilteredFeed();
}

/**
 * 按当前筛选条件渲染卡片流 + 结果计数。
 * 三种情况（Day 12 延伸）：
 *   ① 有匹配 → 只显示匹配内容
 *   ② 无匹配 → 显示「没有找到相关内容」，并给出口按钮
 *   ③ 清空关键词 → 恢复完整列表（结论筛选若还在，恢复到该结论的全量）
 */
function renderFilteredFeed() {
  const listEl = document.getElementById("card-list");
  const kw = feedKeyword.trim();

  let items = verdictFilter === VERDICT_ALL
    ? ALL_ITEMS
    : ALL_ITEMS.filter((it) => it.verdict === verdictFilter);
  if (kw) items = items.filter((it) => matchKeyword(it, kw)); // 关键词叠加在结论筛选之上

  resetFilterSummary(items.length);

  if (!items.length) {
    const hasVerdict = verdictFilter !== VERDICT_ALL;
    if (kw) {
      // 关键词没匹配上：统一文案 + 按当前筛选状况决定出口按钮的语义
      renderListState(listEl, "empty", {
        text: "没有找到相关内容",
        action: hasVerdict ? "清空全部筛选" : "清空关键词",
        actionId: "feed-clear",
        onAction: () => {
          feedKeyword = "";
          const search = document.getElementById("feed-search");
          if (search) search.value = "";
          if (hasVerdict) { applyFilter(VERDICT_ALL); return; }
          renderFeed();
        },
      });
      return;
    }
    // 只有结论筛选没结果：说清楚筛的是什么，并给一键回到全部的出口
    renderListState(listEl, "empty", {
      text: "当前没有「" + verdictFilter + "」结论的核查条目。",
      action: "显示全部",
      actionId: "filter-reset",
      onAction: () => applyFilter(VERDICT_ALL),
    });
    return;
  }

  listEl.innerHTML = "";
  items.forEach((item, i) => listEl.appendChild(renderCard(item, i)));
}

/** 更新结果计数文案（结论 + 关键词都反映进去；清空恢复时也要回到正确数字） */
function resetFilterSummary(count) {
  const el = document.getElementById("filter-summary");
  if (!el) return;
  const kw = feedKeyword.trim();
  const parts = [];
  if (verdictFilter !== VERDICT_ALL) parts.push("「" + verdictFilter + "」");
  if (kw) parts.push("关键词「" + kw + "」");
  el.textContent = (parts.length ? "筛选" + parts.join(" + ") + "：" : "") + "共 " + count + " 条";
}

/** 应用筛选：切换高亮、同步无障碍状态、重渲染 */
function applyFilter(verdict) {
  verdictFilter = verdict;
  document.querySelectorAll("#verdict-filter .chip").forEach((chip) => {
    const on = chip.dataset.verdict === verdict;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderFeed();
}

/** 绑定筛选器点击 + 关键词输入（输入即过滤，清空即恢复完整列表） */
function initFilter() {
  document.querySelectorAll("#verdict-filter .chip").forEach((chip) => {
    chip.addEventListener("click", () => applyFilter(chip.dataset.verdict));
  });

  const search = document.getElementById("feed-search");
  if (search) {
    search.addEventListener("input", (e) => {
      feedKeyword = e.target.value;
      renderFeed();
    });
  }
}

/* ============================================================
   视图三：我的收藏
   数据对象 = 用户在详情页收藏过的核查条目（localStorage: fx_favs）
   筛选 = 结论 chip + 关键词（叠加生效）；四种状态：
     零数据（一条都没收藏）/ 无结果（筛空）/ 有结果 / 全部
   ============================================================ */

const FAV_KEY = "fx_favs";
let favKeyword = "";
let favVerdictFilter = VERDICT_ALL;

/** 读收藏 id 列表（localStorage 损坏时按空列表处理） */
function getFavIds() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

/** 更新收藏计数文案（结论 + 关键词都反映进去，清空恢复时也要回到正确数字） */
function updateFavSummary(count) {
  const el = document.getElementById("fav-summary");
  if (!el) return;
  const kw = favKeyword.trim();
  const parts = [];
  if (favVerdictFilter !== VERDICT_ALL) parts.push("「" + favVerdictFilter + "」");
  if (kw) parts.push("关键词「" + kw + "」");
  el.textContent = (parts.length ? "筛选" + parts.join(" + ") + "：" : "") + "共 " + count + " 条";
}

/** 渲染收藏列表：结论 + 关键词叠加筛选；四种状态各自有明确出口，不留死胡同 */
function renderFavView() {
  const listEl = document.getElementById("fav-list");
  const summaryEl = document.getElementById("fav-summary");

  // 加载中 / 错误：交给状态闸门（不能当成「零收藏」，否则会误报空态）
  if (stateGuard(listEl)) {
    if (summaryEl) summaryEl.textContent = DATA_STATE === "loading" ? "正在加载数据…" : "数据未就绪";
    return;
  }

  const ids = getFavIds();
  const owned = ALL_ITEMS.filter((it) => ids.indexOf(it.id) !== -1);

  // 状态一：零数据（一条都没收藏）—— 文案必须与「筛空」不同，并给去获取数据的出口
  if (!owned.length) {
    renderListState(listEl, "empty", {
      text: "还没有收藏任何条目。去「热点卡片流」点开一条，在详情页按「☆ 收藏这条」就会出现在这里。",
      action: "去卡片流看看",
      actionId: "fav-goto-feed",
      onAction: () => { location.hash = "#/feed"; },
    });
    updateFavSummary(0);
    return;
  }

  const kw = favKeyword.trim();
  let items = favVerdictFilter === VERDICT_ALL
    ? owned
    : owned.filter((it) => it.verdict === favVerdictFilter);
  if (kw) items = items.filter((it) => matchKeyword(it, kw)); // 关键词叠加在结论筛选之上

  updateFavSummary(items.length);

  // 状态二：无结果（筛了但没匹配）—— 统一文案 + 出口；若结论筛选也在，出口清掉全部条件
  if (!items.length) {
    const hasVerdict = favVerdictFilter !== VERDICT_ALL;
    renderListState(listEl, "empty", {
      text: "没有找到相关内容",
      action: hasVerdict ? "清空全部筛选" : "清空关键词",
      actionId: "fav-clear",
      onAction: () => {
        favKeyword = "";
        const search = document.getElementById("fav-search");
        if (search) search.value = "";
        if (hasVerdict) { applyFavFilter(VERDICT_ALL); return; }
        renderFavView();
      },
    });
    return;
  }

  // 状态三 / 四：有结果（全部，或经结论/关键词筛选后的子集）
  listEl.innerHTML = "";
  items.forEach((it, i) => listEl.appendChild(renderCard(it, i)));
}

/** 应用收藏页的结论筛选（切换高亮 + 同步无障碍状态 + 重渲染） */
function applyFavFilter(verdict) {
  favVerdictFilter = verdict;
  document.querySelectorAll("#fav-verdict-filter .chip").forEach((chip) => {
    const on = chip.dataset.verdict === verdict;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderFavView();
}

/** 绑定收藏视图：结论 chip + 关键词输入（输入即过滤，清空即恢复完整列表） */
function initFavFilter() {
  document.querySelectorAll("#fav-verdict-filter .chip").forEach((chip) => {
    chip.addEventListener("click", () => applyFavFilter(chip.dataset.verdict));
  });

  const search = document.getElementById("fav-search");
  if (search) {
    search.addEventListener("input", (e) => {
      favKeyword = e.target.value;
      renderFavView();
    });
  }
}

/* ============================================================
   Day 13：手写 hash 路由（不引入路由库）
   为什么选它：
     ① 刷新 / 分享 / 收藏链接都能回到同一个视图（原来的纯 class 切换做不到）
     ② 浏览器前进后退天然可用，白捡一个「返回上一页」
     ③ 只有三个视图，路由库属于杀鸡用牛刀（今日不做：路由库进阶用法）
   约定：#/feed、#/board、#/favs；空 hash 或非法值一律回落到 #/feed
   ============================================================ */

const VIEWS = ["feed", "board", "favs"];
const VIEW_TITLES = { feed: "热点卡片流", board: "辟谣榜", favs: "我的收藏" };
const BASE_TITLE = "热门时事真伪辨别";

/** 从地址栏解析当前视图；解析不出来就当卡片流 */
function viewFromHash() {
  const m = String(location.hash || "").match(/^#\/?([a-zA-Z]+)/);
  const name = m ? m[1].toLowerCase() : "";
  return VIEWS.indexOf(name) !== -1 ? name : "feed";
}

/** 把界面切到指定视图（只改界面，不动地址栏） */
function paintView(name) {
  const view = VIEWS.indexOf(name) !== -1 ? name : "feed";

  VIEWS.forEach((v) => {
    document.getElementById("view-" + v).classList.toggle("active", v === view);
  });

  document.querySelectorAll("#view-tabs .tab").forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1; // 键盘 Tab 只停在当前标签上
  });

  document.title = (view === "feed" ? "" : VIEW_TITLES[view] + " · ") + BASE_TITLE;
}

/** 切视图的唯一入口：同步地址栏 → 由 hashchange 统一处理（这样前进后退才能用） */
function goToView(name) {
  const view = VIEWS.indexOf(name) !== -1 ? name : "feed";
  if (viewFromHash() === view) { paintView(view); renderAllViews(); return; }
  location.hash = "#/" + view;
}

function initRouter() {
  const tabs = Array.from(document.querySelectorAll("#view-tabs .tab"));

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => goToView(tab.dataset.view));

    // 余力加练：可访问的导航标签——左右方向键 / Home / End 在标签间移动
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

initRouter();
paintView(viewFromHash()); // 首屏按地址栏落位（直接打开 #/board 就停在这一档）
// 地址栏规范化：空 hash 或非法值补成 #/feed（replaceState 不产生多余历史记录）
if (!/^#\/(feed|board|favs)$/.test(location.hash)) {
  history.replaceState(null, "", "#/" + viewFromHash());
}
initFilter();
initFavFilter();
mountDemoBanner();
initData();

/* ============================================================
   第 3 步：辟谣榜（日/周/月/年切换 + 关键词检索 + 空状态）
   对应 PRD A3 / A4 / A4b
   ============================================================ */

// 各时间档对应的天数（按 updated_at 距今天数过滤；数据只存一份，四档实时算出）
const BOARD_RANGES = { day: 1, week: 7, month: 31, year: 365 };
const RANGE_NAMES = { day: "今日", week: "本周", month: "本月", year: "今年" };

let boardRange = "day";   // 当前选中的时间档
let boardKeyword = "";    // 当前检索关键词

/** updated_at 是否落在最近 days 天内（含今天） */
function inRange(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return false; // 日期字段非法：不匹配（错误处理规范）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = (today - d) / 86400000;
  return diffDays >= 0 && diffDays < days;
}

/** 辟谣榜条目筛选：verdict 为「假/部分属实」（被戳穿的）+ 时间档 */
function getBoardItems() {
  const days = BOARD_RANGES[boardRange];
  return ALL_ITEMS.filter((it) =>
    (it.verdict === "假" || it.verdict === "部分属实") &&
    inRange(it.updated_at, days)
  );
}

/** 找出「比当前档更长、且有条目」的最短档位（给空状态指路用，避免用户停在死胡同） */
function findLongerRange() {
  const order = ["week", "month", "year"];
  const startIdx = order.indexOf(boardRange);
  for (let i = startIdx + 1; i < order.length; i++) {
    const key = order[i];
    const count = ALL_ITEMS.filter((it) =>
      (it.verdict === "假" || it.verdict === "部分属实") &&
      inRange(it.updated_at, BOARD_RANGES[key])
    ).length;
    if (count > 0) return { key: key, name: RANGE_NAMES[key], count: count };
  }
  return null;
}

/** 渲染辟谣榜视图 */
function renderBoard() {
  const listEl = document.getElementById("board-list");

  // 加载中 / 错误：交给状态闸门
  if (stateGuard(listEl)) return;

  let items = getBoardItems();

  // 检索：关键词实时过滤（标题 + 摘要，本地静态过滤，无后端）
  const kw = boardKeyword.trim();
  if (kw) {
    items = items.filter((it) => (it.title + it.summary).indexOf(kw) !== -1);
  }

  // 空状态：区分「没有辟谣数据」「榜内本来就没有」「检索无结果」三种（PRD A3 / A4b）
  if (!items.length) {
    if (!ALL_ITEMS.length) {
      renderListState(listEl, "empty", {
        text: "暂无辟谣数据（data.json 为空，或全部条目未通过校验）",
      });
      return;
    }
    if (kw) {
      // 检索无结果：统一文案「没有找到相关内容」+ 清空出口（清空后恢复该档完整列表）
      renderListState(listEl, "empty", {
        text: "没有找到相关内容",
        action: "清空关键词",
        actionId: "board-clear",
      });
      return;
    }
    // 当前档为空：若更长时间档有条目，给出指路按钮（修复：之前是死胡同，用户不知道数据其实在周/月/年榜里）
    const longer = findLongerRange();
    if (longer) {
      renderListState(listEl, "empty", {
        text: RANGE_NAMES[boardRange] + "暂无新增辟谣，" + longer.name + "有 " + longer.count + " 条",
        action: "查看" + longer.name,
        actionData: { range: longer.key },
      });
      return;
    }
    renderListState(listEl, "empty", {
      text: RANGE_NAMES[boardRange] + "暂无新增辟谣（数据更新后自动出现在这里）",
    });
    return;
  }

  listEl.innerHTML = "";
  items.forEach((it, i) => listEl.appendChild(renderCard(it, i)));
}

/** 绑定档位切换与检索框事件 */
function initBoard() {
  document.querySelectorAll("#board-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("#board-tabs .tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      boardRange = tab.dataset.range;
      renderBoard();
    });
  });

  document.getElementById("board-search").addEventListener("input", (e) => {
    boardKeyword = e.target.value;
    renderBoard();
  });

  // 空状态按钮（事件委托，按钮是动态生成的）：
  //   「清空关键词」→ 恢复该档完整列表；「查看X榜」→ 切到更长的时间档
  document.getElementById("board-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".empty-jump");
    if (!btn) return;
    if (btn.id === "board-clear") {
      boardKeyword = "";
      document.getElementById("board-search").value = "";
      renderBoard();
      return;
    }
    boardRange = btn.dataset.range;
    document.querySelectorAll("#board-tabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.range === boardRange)
    );
    renderBoard();
  });
}

initBoard();
