/* ============================================================
   mine.js — 个人主页（P1 本地版）
   四块内容全部零后端，只读写本机 localStorage：
     ① 我的收藏     键 fx_favs（与详情页收藏按钮共用同一份数据）
     ② 浏览足迹     键 fx_history（进详情页就记一笔，最多留 20 条）
     ③ 我提交的线索 键 fx_myreports（本地暂存，论坛开通后可发布）
     ④ 关于与方法论 静态文案（写在 mine.html 里）
   ============================================================ */

/* 本地存储键（FAV_KEY / HIST_KEY / REP_KEY / HIST_MAX）与 readJSON
   在 data.js 里统一定义（Day 19 上移到公共层）——本页直接使用，不再重复声明。 */

let ITEMS = [];
let DATA_STATE = "loading";

/** 结论标签（与 home.js / detail.js 保持同一套类名） */
function verdictTag(verdict) {
  return '<span class="tag tag-' + verdict + '">' + verdict + "</span>";
}

/** 时间戳 → MM-DD HH:mm */
function fmtTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/** 紧凑条目（收藏 / 足迹共用）：标签 + 标题 + 右侧日期 */
function mineLink(item, rightText) {
  const a = document.createElement("a");
  a.className = "mine-item";
  a.href = "detail.html?id=" + encodeURIComponent(item.id);
  a.innerHTML = verdictTag(item.verdict) +
    '<span class="mine-item-title">' + item.title + "</span>" +
    '<span class="mine-item-date">' + (rightText || item.updated_at) + "</span>";
  return a;
}

/* ---------------- ① 我的收藏（支持关键词筛选，三态各有出口） ---------------- */

let favKeyword = "";

/** 关键词匹配：标题 + 摘要（与首页同一套规则） */
function matchKeyword(item, kw) {
  return (item.title + item.summary).indexOf(kw) !== -1;
}

function renderFavs() {
  const box = document.getElementById("mine-fav-list");
  const summaryEl = document.getElementById("fav-summary");

  if (DATA_STATE === "loading") {
    renderListState(box, "loading");
    if (summaryEl) summaryEl.textContent = "正在加载数据…";
    return;
  }
  if (DATA_STATE === "error") {
    renderListState(box, "error", { onRetry: initData });
    if (summaryEl) summaryEl.textContent = "数据未就绪";
    return;
  }

  const ids = readJSON(FAV_KEY, []);
  const owned = Array.isArray(ids) ? ITEMS.filter((it) => ids.indexOf(it.id) !== -1) : [];

  // 状态一：零数据（一条都没收藏）—— 文案必须与「筛空」不同，并给去获取数据的出口
  if (!owned.length) {
    if (summaryEl) summaryEl.textContent = "共 0 条";
    renderListState(box, "empty", {
      text: "还没有收藏任何条目。去辟谣榜点开一条，在详情页按「☆ 收藏这条」就会出现在这里。",
      action: "去辟谣榜看看",
      actionHref: "index.html#/board",
    });
    return;
  }

  const kw = favKeyword.trim();
  const list = kw ? owned.filter((it) => matchKeyword(it, kw)) : owned;

  if (summaryEl) {
    summaryEl.textContent = (kw ? "筛选 关键词「" + kw + "」：" : "") + "共 " + list.length + " 条";
  }

  // 状态二：无结果（筛了但没匹配）—— 统一文案 + 清空出口
  if (!list.length) {
    renderListState(box, "empty", {
      text: "没有找到相关内容",
      action: "清空关键词",
      actionId: "mine-fav-clear",
      onAction: () => {
        favKeyword = "";
        const s = document.getElementById("fav-search");
        if (s) s.value = "";
        renderFavs();
      },
    });
    return;
  }

  // 状态三：有结果
  box.innerHTML = "";
  list.forEach((it) => box.appendChild(mineLink(it)));
}

/** 绑定收藏筛选框（输入即过滤，清空即恢复完整列表） */
function initFavFilter() {
  const s = document.getElementById("fav-search");
  if (!s) return;
  s.addEventListener("input", (e) => {
    favKeyword = e.target.value;
    renderFavs();
  });
}

/* ---------------- ② 浏览足迹 ---------------- */

function renderHistory() {
  const box = document.getElementById("hist-list");
  const countEl = document.getElementById("hist-count");

  if (DATA_STATE !== "ok") { box.innerHTML = ""; countEl.textContent = DATA_STATE === "error" ? "数据未就绪" : ""; return; }

  const hist = readJSON(HIST_KEY, []);
  const list = Array.isArray(hist)
    ? hist.map((h) => ({ item: ITEMS.find((it) => it.id === h.id), at: h.at })).filter((x) => x.item)
    : [];

  countEl.textContent = list.length ? "最近 " + list.length + " 条" : "";

  if (!list.length) {
    box.innerHTML = '<p class="mine-about">还没有浏览记录。从辟谣榜点进任意一条详情，这里就会留下足迹（只存本机）。</p>';
    return;
  }

  box.innerHTML = "";
  list.forEach((x) => box.appendChild(mineLink(x.item, fmtTime(x.at))));
}

/* ---------------- ③ 我提交的待核查 ---------------- */

function renderReports() {
  const box = document.getElementById("rep-list");
  const countEl = document.getElementById("rep-count");
  const list = readJSON(REP_KEY, []);

  if (!Array.isArray(list) || !list.length) {
    countEl.textContent = "";
    box.innerHTML = "";
    return;
  }

  countEl.textContent = "共 " + list.length + " 条（仅本机）";
  box.innerHTML = "";
  list.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "mine-item mine-report";
    row.innerHTML = '<span class="mine-item-title">' + r.text + "</span>" +
      '<span class="mine-item-date">' + fmtTime(r.at) + "</span>" +
      '<button type="button" class="rep-del" data-idx="' + i + '" aria-label="删除这条线索">删除</button>';
    box.appendChild(row);
  });
}

function initReports() {
  const input = document.getElementById("rep-input");
  const btn = document.getElementById("rep-add");

  btn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }   // 空内容不提交，光标留在输入框（防止无效操作）
    const list = readJSON(REP_KEY, []);
    const arr = Array.isArray(list) ? list : [];
    arr.unshift({ text: text, at: Date.now() });
    localStorage.setItem(REP_KEY, JSON.stringify(arr.slice(0, 50)));
    input.value = "";
    renderReports();
  });

  // 删除：事件委托（行是动态生成的）
  document.getElementById("rep-list").addEventListener("click", (e) => {
    const del = e.target.closest(".rep-del");
    if (!del) return;
    const list = readJSON(REP_KEY, []);
    if (!Array.isArray(list)) return;
    list.splice(Number(del.dataset.idx), 1);
    localStorage.setItem(REP_KEY, JSON.stringify(list));
    renderReports();
  });
}

/* ---------------- 启动 ---------------- */

function renderAll() {
  renderFavs();
  renderHistory();
}

async function initData() {
  DATA_STATE = "loading";
  renderAll();

  try {
    ITEMS = await loadItemsForPage(); // ?demo= 演示开关在 data.js 里统一处理
    DATA_STATE = "ok";
  } catch (err) {
    console.error("[mine] 数据加载失败：", err);
    DATA_STATE = "error";
  }

  renderAll();
}

mountDemoBanner();
initFavFilter();
initReports();
renderReports();
initData();
