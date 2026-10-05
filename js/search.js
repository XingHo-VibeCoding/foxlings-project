/* ============================================================
   search.js — 查询检索（主打功能 · 骨架）
   本期真正能用的（纯静态，零后端）：
     · L1 站内检索：输入即搜 data.json 已核查条目，命中直接给卡片（可点进详情）
     · L1 多源兜底：站内没命中时，一键把关键词投向公开搜索 / 辟谣平台
     · L2 查证清单：「自己怎么验一条消息」四步，常显在结果区下方
   还没做的：
     · L3 自动联网检索 + AI 整合摘要 —— 需后端（api-contract.md 第三节 /api/search），
       界面只留一行「开发中」，不假装已有。
   与全站一致的部分：四态沿用 renderListState / stateGuard，卡片复用 renderCard。
   ============================================================ */

let searchKeyword = ""; // 输入框当前内容（即时生效，清空即恢复）

/** 把用户输入转义后再拼进 HTML —— 检索词是用户可控文本，不能直接当 HTML 用 */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * 站外检索入口（站内没命中时的兜底）。
 * 前三个平台的搜索页接受查询参数，带词直达；
 * 中国互联网联合辟谣平台没有公开的查询参数入口，只给官网，需进站后再搜一次——文案里如实说明。
 */
function buildEngineLinks(kw) {
  const q = encodeURIComponent(kw);
  return [
    { name: "百度", href: "https://www.baidu.com/s?wd=" + q },
    { name: "微博", href: "https://s.weibo.com/weibo?q=" + q },
    { name: "必应", href: "https://www.bing.com/search?q=" + q },
    { name: "联合辟谣平台（进站再搜）", href: "https://www.piyao.org.cn/" },
  ];
}

/** 检索计数与状态说明（aria-live 播报，与辟谣榜的 #filter-summary 同款角色） */
function updateSearchSummary(count) {
  const el = document.getElementById("search-summary");
  if (!el) return;

  if (count === null) {
    el.textContent = DATA_STATE === "loading" ? "正在加载站内核查库…" : "站内核查库未就绪";
    return;
  }
  const kw = searchKeyword.trim();
  if (!kw) {
    el.textContent = "站内已收录 " + ALL_ITEMS.length + " 条核查记录，输入关键词开始检索";
    return;
  }
  el.textContent = count
    ? "关键词「" + kw + "」站内命中 " + count + " 条"
    : "关键词「" + kw + "」站内命中 0 条";
}

/** 渲染无命中状态：说清为什么没有 + 给出两条路（清空/站外接着查），不留死胡同 */
function renderNoHit(box, kw) {
  const links = buildEngineLinks(kw).map((e) =>
    '<a class="jump-btn" href="' + e.href + '" target="_blank" rel="noopener noreferrer">' +
    e.name + "</a>"
  ).join("");

  box.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "empty-state state-empty";
  wrap.setAttribute("role", "status");
  wrap.innerHTML =
    '<span class="state-desc">没有找到相关内容——站内没有匹配「' + escHtml(kw) + "」的核查记录。</span>" +
    '<button type="button" class="empty-jump" id="search-clear">清空关键词</button>' +
    '<div class="src-jump">' +
      '<p class="src-jump-lead">换个地方接着查（在新标签打开）：</p>' +
      '<div class="src-jump-btns">' + links + "</div>" +
    "</div>";
  box.appendChild(wrap);
}

/** 渲染查询检索视图（四种状态：loading / error / 待输入 / 命中 / 无命中） */
function renderSearchView() {
  const box = document.getElementById("search-results");
  if (!box) return;

  // ① 数据本身没就绪：沿用全站统一状态（加载中 / 错误 + 重试）
  if (DATA_STATE !== "ok") {
    if (DATA_STATE === "loading") {
      renderListState(box, "loading");
      updateSearchSummary(null);
      return;
    }
    renderListState(box, "error", {
      desc: "站内核查库没读到，暂时没法检索。可以重试，或先去辟谣榜看看。",
      onRetry: initData,
    });
    updateSearchSummary(null);
    return;
  }

  const kw = searchKeyword.trim();

  // ② 还没输入：不给空白页，给一句引导（真正的引导清单在下方常显）
  if (!kw) {
    renderListState(box, "empty", {
      text: "输入关键词试试——先查站内已核查的条目；没命中时，下面还有「自己怎么验」四步和几个公开检索入口。",
    });
    updateSearchSummary(0);
    return;
  }

  const hits = ALL_ITEMS.filter((it) => matchKeyword(it, kw));

  // ③ 无命中
  if (!hits.length) {
    renderNoHit(box, kw);
    updateSearchSummary(0);
    return;
  }

  // ④ 命中：按热度排序；卡片复用辟谣榜样式，但不带榜单序号（检索结果是清单不是榜单）
  const sorted = sortByHeat(hits);
  box.innerHTML = "";
  const list = document.createElement("div");
  list.className = "card-list";
  sorted.forEach((it, i) => list.appendChild(renderCard(it, i, { rank: false })));
  box.appendChild(list);
  updateSearchSummary(sorted.length);
}

/** 绑定检索页交互 */
function initSearch() {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");

  // 显式提交：不刷新页面（纯前端检索），查完把结果区带进视野
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      searchKeyword = input ? input.value : "";
      renderSearchView();
      const box = document.getElementById("search-results");
      if (box) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  // 输入即搜（与全站筛选一致的即时反馈；清空即回到引导态）
  if (input) {
    input.addEventListener("input", (e) => {
      searchKeyword = e.target.value;
      renderSearchView();
    });
  }

  // 示例词与「清空关键词」出口（事件委托，元素是动态生成的）
  const samples = document.getElementById("search-samples");
  if (samples) {
    samples.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sample]");
      if (!btn || !input) return;
      input.value = btn.dataset.sample;
      searchKeyword = btn.dataset.sample;
      renderSearchView();
      input.focus();
    });
  }

  const box = document.getElementById("search-results");
  if (box) {
    box.addEventListener("click", (e) => {
      const btn = e.target.closest("#search-clear");
      if (!btn) return;
      searchKeyword = "";
      if (input) input.value = "";
      renderSearchView();
      if (input) input.focus();
    });
  }
}

/* 注册进首页的视图渲染表（home.js 定义，切视图 / 数据就绪时统一重绘） */
VIEW_RENDERERS.push(renderSearchView);

initSearch();
renderSearchView(); // 首屏：若直接落在 #/search，先把 loading 态画上
