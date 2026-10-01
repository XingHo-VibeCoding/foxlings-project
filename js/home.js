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

/** 视图一：热点卡片流（Day 12 起支持按核查结论筛选） */
const VERDICT_ALL = "all";      // 筛选值：全部
let verdictFilter = VERDICT_ALL; // 当前筛选的结论

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

/** 按当前筛选条件渲染卡片流 + 结果计数（筛选三种情况：有结果 / 无结果 / 清空恢复） */
function renderFilteredFeed() {
  const listEl = document.getElementById("card-list");
  const items = verdictFilter === VERDICT_ALL
    ? ALL_ITEMS
    : ALL_ITEMS.filter((it) => it.verdict === verdictFilter);

  resetFilterSummary(items.length);

  if (!items.length) {
    // 无结果：说清楚筛的是什么，并给一键回到全部的出口
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

/** 更新结果计数文案（清空恢复时也要回到正确数字） */
function resetFilterSummary(count) {
  const el = document.getElementById("filter-summary");
  if (!el) return;
  el.textContent = verdictFilter === VERDICT_ALL
    ? "共 " + count + " 条"
    : "筛选「" + verdictFilter + "」：共 " + count + " 条";
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

/** 绑定筛选器点击 */
function initFilter() {
  document.querySelectorAll("#verdict-filter .chip").forEach((chip) => {
    chip.addEventListener("click", () => applyFilter(chip.dataset.verdict));
  });
}

/** 视图切换：卡片流 ↔ 辟谣榜（辟谣榜内容第 3 步填充） */
function initViewTabs() {
  const tabs = document.querySelectorAll("#view-tabs .tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      document.getElementById("view-" + tab.dataset.view).classList.add("active");
      if (tab.dataset.view === "board") renderBoard(); // 切入榜单时立即渲染（修复：此前首次进入榜单是空白）
    });
  });
}

initViewTabs();
initFilter();
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
      // 检索无结果：提示换关键词（原逻辑不动）
      listEl.innerHTML =
        '<div class="empty-state">没有匹配「' + kw + '」的辟谣条目，换个关键词试试</div>';
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

  // 空状态指路按钮：点击切换到更长时间档（事件委托，按钮是动态生成的）
  document.getElementById("board-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".empty-jump");
    if (!btn) return;
    boardRange = btn.dataset.range;
    document.querySelectorAll("#board-tabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.range === boardRange)
    );
    renderBoard();
  });
}

initBoard();
