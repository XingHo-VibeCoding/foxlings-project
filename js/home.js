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

async function renderFeed() {
  const listEl = document.getElementById("card-list");
  listEl.innerHTML = '<div class="empty-state">正在加载…</div>';

  try {
    ALL_ITEMS = await loadVerifiedData();
  } catch (err) {
    showLoadError(listEl, renderFeed);
    return;
  }

  if (!ALL_ITEMS.length) {
    listEl.innerHTML = '<div class="empty-state">暂无数据（data.json 为空或全部条目未通过校验）</div>';
    resetFilterSummary(0);
    return;
  }

  renderFilteredFeed(); // 按当前筛选条件渲染（数据到位后即可筛选）
  renderBoard();        // 数据到位后预先渲染榜单（供切入时直接显示）
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
    if (kw) {
      // 关键词没匹配上：统一文案 + 按当前筛选状况决定出口按钮的语义
      const hasVerdict = verdictFilter !== VERDICT_ALL;
      listEl.innerHTML =
        '<div class="empty-state">没有找到相关内容' +
        '<button type="button" class="empty-jump" id="feed-clear" data-mode="' +
        (hasVerdict ? "all" : "kw") + '">' +
        (hasVerdict ? "清空全部筛选" : "清空关键词") + "</button></div>";
      const clearBtn = document.getElementById("feed-clear");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          feedKeyword = "";
          const search = document.getElementById("feed-search");
          if (search) search.value = "";
          if (clearBtn.dataset.mode === "all") { applyFilter(VERDICT_ALL); return; }
          renderFilteredFeed();
        });
      }
      return;
    }
    // 只有结论筛选没结果：说清楚筛的是什么，并给一键回到全部的出口
    listEl.innerHTML =
      '<div class="empty-state">当前没有「' + verdictFilter + '」结论的核查条目。' +
      '<button type="button" class="empty-jump" id="filter-reset">显示全部</button></div>';
    const resetBtn = document.getElementById("filter-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => applyFilter(VERDICT_ALL));
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
  renderFilteredFeed();
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
      renderFilteredFeed();
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

  // 数据未就绪：不能当成「零收藏」，否则会误报空态
  if (!ALL_ITEMS.length) {
    listEl.innerHTML = '<div class="empty-state">正在加载…</div>';
    return;
  }

  const ids = getFavIds();
  const owned = ALL_ITEMS.filter((it) => ids.indexOf(it.id) !== -1);

  // 状态一：零数据（一条都没收藏）—— 文案必须与「筛空」不同，并给去获取数据的出口
  if (!owned.length) {
    listEl.innerHTML =
      '<div class="empty-state">还没有收藏任何条目。去「热点卡片流」点开一条，在详情页按「☆ 收藏这条」就会出现在这里。' +
      '<button type="button" class="empty-jump" id="fav-goto-feed">去卡片流看看</button></div>';
    updateFavSummary(0);
    const goBtn = document.getElementById("fav-goto-feed");
    if (goBtn) {
      goBtn.addEventListener("click", () => {
        document.querySelector('#view-tabs .tab[data-view="feed"]').click();
      });
    }
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
    listEl.innerHTML =
      '<div class="empty-state">没有找到相关内容' +
      '<button type="button" class="empty-jump" id="fav-clear" data-mode="' +
      (hasVerdict ? "all" : "kw") + '">' +
      (hasVerdict ? "清空全部筛选" : "清空关键词") + "</button></div>";
    const clearBtn = document.getElementById("fav-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        favKeyword = "";
        const search = document.getElementById("fav-search");
        if (search) search.value = "";
        if (clearBtn.dataset.mode === "all") { applyFavFilter(VERDICT_ALL); return; }
        renderFavView();
      });
    }
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

/** 视图切换：卡片流 ↔ 辟谣榜 ↔ 我的收藏（辟谣榜内容第 3 步填充） */
function initViewTabs() {
  const tabs = document.querySelectorAll("#view-tabs .tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      document.getElementById("view-" + tab.dataset.view).classList.add("active");
      if (tab.dataset.view === "board") renderBoard(); // 切入榜单时立即渲染（修复：此前首次进入榜单是空白）
      if (tab.dataset.view === "favs") renderFavView(); // 切入收藏时立即渲染（详情页刚收藏的要能看到）
    });
  });
}

initViewTabs();
initFilter();
initFavFilter();
renderFeed();

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

  if (!ALL_ITEMS.length) {
    listEl.innerHTML = '<div class="empty-state">数据尚未加载完成…</div>';
    return;
  }

  let items = getBoardItems();

  // 检索：关键词实时过滤（标题 + 摘要，本地静态过滤，无后端）
  const kw = boardKeyword.trim();
  if (kw) {
    items = items.filter((it) => (it.title + it.summary).indexOf(kw) !== -1);
  }

  listEl.innerHTML = "";

  // 空状态：区分「榜内本来就没有」和「检索无结果」两种提示（PRD A3 / A4b）
  if (!items.length) {
    if (kw) {
      // 检索无结果：统一文案「没有找到相关内容」+ 清空出口（清空后恢复该档完整列表）
      listEl.innerHTML =
        '<div class="empty-state">没有找到相关内容' +
        '<button type="button" class="empty-jump" id="board-clear">清空关键词</button></div>';
      return;
    }
    // 当前档为空：若更长时间档有条目，给出指路按钮（修复：之前是死胡同，用户不知道数据其实在周/月/年榜里）
    const longer = findLongerRange();
    if (longer) {
      listEl.innerHTML =
        '<div class="empty-state">' +
        RANGE_NAMES[boardRange] + '暂无新增辟谣，' + longer.name + '有 ' + longer.count + ' 条　' +
        '<button type="button" class="empty-jump" data-range="' + longer.key + '">查看' + longer.name + '</button>' +
        "</div>";
      return;
    }
    listEl.innerHTML =
      '<div class="empty-state">' + RANGE_NAMES[boardRange] + '暂无新增辟谣（数据更新后自动出现在这里）</div>';
    return;
  }

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
