/* ============================================================
   search.js — 查询检索（主打功能）
   页内两个模块（共用一个检索框，输入一次即可来回切）：
     ① 站内搜索（inside）—— 查本站已核查库，命中直接给卡片（可点进详情）
     ② 全网溯源（trace） —— 把关键词同时投向「官方来源」和「网络来源」两组渠道，
                            自己点开比对。本站不做裁判，只把两边的说法摆到一起。
   模块切换走地址栏第二段（#/search/inside、#/search/trace）：
   刷新、分享链接、浏览器前进后退都能回到同一个模块——与 Day 13 的视图路由同一套原则。
   本期纯静态能做的都做了；还没做的：
     · L3 自动抓取网页 + AI 整合摘要 —— 需后端（api-contract.md 第三节 /api/search），
       界面只留一行「开发中」，不假装已有。
   与全站一致的部分：四态沿用 renderListState / stateGuard，命中卡片复用 renderCard。
   ============================================================ */

let searchKeyword = ""; // 输入框当前内容（两个模块共用；清空即回引导态）

const SEARCH_MODES = ["inside", "trace"];
const MODE_LABELS = { inside: "站内搜索", trace: "全网溯源" };

/** 把用户输入转义后再拼进 HTML —— 检索词是用户可控文本，不能直接当 HTML 用 */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * 当前模块：以地址栏为唯一真相。
 * 这样「刷新 / 把链接发给别人 / 浏览器后退」都落在同一个模块上，
 * 与视图路由（#/board、#/search、#/forum）用的是同一套思路。
 */
function modeFromHash() {
  const m = String(location.hash || "").match(/^#\/search\/([a-zA-Z]+)/);
  const name = m ? m[1].toLowerCase() : "";
  return SEARCH_MODES.indexOf(name) !== -1 ? name : "inside";
}

/* ============================================================
   模块二：全网溯源 —— 两组渠道
   官方来源用「限定站点的搜索」直达（site: 语法），官网没有公开查询参数的只给入口并在文案里说明；
   网络来源用各平台自己的搜索页，带关键词直达。
   ============================================================ */

/** 限定在某个站点内搜索（site: 语法走百度，国内可达性最好） */
function siteSearch(domain, kw) {
  return "https://www.baidu.com/s?wd=" + encodeURIComponent("site:" + domain + " " + kw);
}

const TRACE_GROUPS = [
  {
    key: "official",
    title: "官方来源",
    note: "权威渠道怎么说 —— 权威集体沉默，本身就是个信号",
    build: (kw) => [
      { name: "中国政府网", scope: "site:gov.cn", note: "国务院与各部委", href: siteSearch("gov.cn", kw) },
      { name: "新华社 / 新华网", scope: "site:news.cn", note: "国家通讯社", href: siteSearch("news.cn", kw) },
      { name: "人民网", scope: "site:people.com.cn", note: "人民日报社", href: siteSearch("people.com.cn", kw) },
      { name: "央视网", scope: "site:cctv.com", note: "中央广播电视总台", href: siteSearch("cctv.com", kw) },
      { name: "联合辟谣平台", scope: "官网", note: "中国互联网联合辟谣平台，进站后再搜一次", href: "https://www.piyao.org.cn/" },
    ],
  },
  {
    key: "web",
    title: "网络来源",
    note: "别处怎么传的 —— 分清一手信息与二次转载",
    build: (kw) => {
      const q = encodeURIComponent(kw);
      return [
        { name: "微博", scope: "实时讨论", note: "看最早发这条的人是谁", href: "https://s.weibo.com/weibo?q=" + q },
        { name: "百度", scope: "全网网页", note: "看还有哪些网站在传", href: "https://www.baidu.com/s?wd=" + q },
        { name: "必应", scope: "全网网页", note: "换一个搜索引擎交叉看", href: "https://www.bing.com/search?q=" + q },
        { name: "知乎", scope: "问答社区", note: "常有人整理过同类谣言的来龙去脉", href: "https://www.zhihu.com/search?type=content&q=" + q },
        { name: "搜狗", scope: "含微信内容", note: "公众号里的说法这里能搜到", href: "https://www.sogou.com/web?query=" + q },
      ];
    },
  },
];

/** 渲染全网溯源模块（两组渠道；未输入关键词时给引导，不留空白） */
function renderTraceResults() {
  const box = document.getElementById("trace-results");
  if (!box) return;

  const kw = searchKeyword.trim();
  if (!kw) {
    renderListState(box, "empty", {
      text: "把要查的消息关键词填进上面的检索框 —— 这里会同时给你「官方来源」和「网络来源」两组溯源入口。",
    });
    return;
  }

  box.innerHTML = "";
  TRACE_GROUPS.forEach((group) => {
    const links = group.build(kw);
    const sec = document.createElement("section");
    sec.className = "trace-group trace-group-" + group.key;
    sec.dataset.group = group.key;

    const linkHtml = links.map((l) =>
      '<a class="trace-link" href="' + l.href + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="tl-top">' +
          '<span class="tl-name">' + l.name + "</span>" +
          '<span class="tl-scope">' + l.scope + "</span>" +
        "</span>" +
        '<span class="tl-note">' + l.note + "</span>" +
      "</a>"
    ).join("");

    sec.innerHTML =
      '<div class="trace-group-head">' +
        '<h4 class="trace-group-title">' + group.title +
          '<span class="trace-count">' + links.length + " 个入口</span></h4>" +
        '<p class="trace-group-note">' + group.note + "</p>" +
      "</div>" +
      '<div class="trace-links">' + linkHtml + "</div>";
    box.appendChild(sec);
  });

  const tip = document.createElement("p");
  tip.className = "trace-tip";
  tip.innerHTML = "在新标签页逐一打开，把看到的<b>日期、发布方、原文链接</b>记下来——" +
    "官方和网络两边的说法对不上时，先信原始出处。" +
    '比对完还是拿不准？<a href="index.html#/forum">发到论坛</a>，让大家一起帮你溯源。';
  box.appendChild(tip);
}

/* ============================================================
   模块一：站内搜索
   ============================================================ */

/** 检索计数与状态说明（aria-live 播报；文案随当前模块变） */
function updateSearchSummary(count) {
  const el = document.getElementById("search-summary");
  if (!el) return;

  const kw = searchKeyword.trim();
  const mode = modeFromHash();

  if (count === null) {
    el.textContent = DATA_STATE === "loading" ? "正在加载站内核查库…" : "站内核查库未就绪";
    return;
  }

  if (mode === "trace") {
    const total = TRACE_GROUPS.reduce((n, g) => n + g.build(kw).length, 0);
    el.textContent = kw
      ? "关键词「" + kw + "」：官方与网络共 " + total + " 个溯源入口，点开逐一比对"
      : "输入关键词后，这里会给出官方与网络两组溯源入口";
    return;
  }

  if (!kw) {
    el.textContent = "站内已收录 " + ALL_ITEMS.length + " 条核查记录，输入关键词开始检索";
    return;
  }
  el.textContent = count
    ? "关键词「" + kw + "」站内命中 " + count + " 条"
    : "关键词「" + kw + "」站内命中 0 条";
}

/**
 * 站内无命中：说清为什么没有 + 给两条路（清空关键词 / 去全网溯源接着查），不留死胡同。
 * 注意：第一个 .empty-jump 必须是「清空关键词」——
 * filter-check 的通用内核靠它验「出口恢复」这一态，顺序不能换。
 */
function renderNoHit(box, kw) {
  box.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "empty-state state-empty";
  wrap.setAttribute("role", "status");
  wrap.innerHTML =
    '<span class="state-desc">没有找到相关内容——站内没有匹配「' + escHtml(kw) + "」的核查记录。</span>" +
    '<button type="button" class="empty-jump" id="search-clear">清空关键词</button>' +
    '<div class="src-jump">' +
      '<p class="src-jump-lead">站内没有，接着上全网溯源——官方渠道和网络渠道一起比：</p>' +
      '<div class="src-jump-btns">' +
        '<button type="button" class="jump-btn" id="search-to-trace" data-mode="trace">打开全网溯源</button>' +
      "</div>" +
    "</div>";
  box.appendChild(wrap);
}

/** 渲染站内搜索模块（四种状态：loading / error / 待输入 / 命中 / 无命中） */
function renderInsideResults() {
  const box = document.getElementById("search-results");
  if (!box) return;

  const kw = searchKeyword.trim();

  // ① 数据本身没就绪：沿用全站统一状态（加载中 / 错误 + 重试）
  if (DATA_STATE !== "ok") {
    if (DATA_STATE === "loading") renderListState(box, "loading");
    else {
      renderListState(box, "error", {
        desc: "站内核查库没读到，暂时没法检索。可以重试，或先去辟谣榜看看。",
        onRetry: initData,
      });
    }
    return;
  }

  // ② 还没输入：不给空白页，给一句引导（查证清单在下方常显）
  if (!kw) {
    renderListState(box, "empty", {
      text: "输入关键词试试——先查站内已核查的条目；没命中时，切到「全网溯源」按官方和网络两组渠道接着查。",
    });
    return;
  }

  // ③ 无命中：给「清空」和「去全网溯源」两个出口
  const hits = ALL_ITEMS.filter((it) => matchKeyword(it, kw));
  if (!hits.length) {
    renderNoHit(box, kw);
    return;
  }

  // ④ 命中：按热度排序；卡片复用辟谣榜样式，但不带榜单序号（检索结果是清单不是榜单）
  const sorted = sortByHeat(hits);
  box.innerHTML = "";
  const list = document.createElement("div");
  list.className = "card-list";
  sorted.forEach((it, i) => list.appendChild(renderCard(it, i, { rank: false })));
  box.appendChild(list);
}

/* ============================================================
   模块切换 + 渲染总入口
   ============================================================ */

/** 按地址栏同步两个模块的显示与切换器高亮 */
function paintSearchMode() {
  const mode = modeFromHash();

  document.querySelectorAll("#search-modes .tab").forEach((btn) => {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  SEARCH_MODES.forEach((m) => {
    const panel = document.getElementById("mode-" + m);
    if (panel) panel.hidden = m !== mode;
  });

  return mode;
}

/** 检索页渲染总入口：切视图 / 数据就绪 / hash 变化时统一重绘两个模块 */
function renderSearchView() {
  paintSearchMode();
  renderInsideResults();
  renderTraceResults();

  if (DATA_STATE !== "ok") { updateSearchSummary(null); return; }
  const kw = searchKeyword.trim();
  updateSearchSummary(kw ? ALL_ITEMS.filter((it) => matchKeyword(it, kw)).length : 0);
}

/** 切模块的唯一入口：改地址栏 → 由 hashchange 统一处理（前进后退才能用） */
function setSearchMode(mode, opts) {
  const next = SEARCH_MODES.indexOf(mode) !== -1 ? mode : "inside";
  const target = "#/search/" + next;
  if (location.hash !== target) {
    location.hash = target;   // hashchange 会触发重绘
    return;
  }
  paintSearchMode();
  if (opts && opts.focusResults) {
    const box = document.getElementById(next === "trace" ? "trace-results" : "search-results");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/** 把检索结果区滚进视野（提交表单后） */
function scrollToResults() {
  const box = document.getElementById(modeFromHash() === "trace" ? "trace-results" : "search-results");
  if (box) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      scrollToResults();
    });
  }

  // 输入即搜（与全站筛选一致的即时反馈；清空即回到引导态）
  if (input) {
    input.addEventListener("input", (e) => {
      searchKeyword = e.target.value;
      renderSearchView();
    });
  }

  // 模块切换
  const modes = document.getElementById("search-modes");
  if (modes) {
    modes.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mode]");
      if (btn) setSearchMode(btn.dataset.mode, { focusResults: true });
    });
  }

  // 示例词
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

  // 结果区里的动态按钮（事件委托）：清空关键词 / 去全网溯源
  const box = document.getElementById("search-results");
  if (box) {
    box.addEventListener("click", (e) => {
      const toTrace = e.target.closest("[data-mode]");
      if (toTrace) { setSearchMode(toTrace.dataset.mode, { focusResults: true }); return; }

      const clear = e.target.closest("#search-clear");
      if (!clear) return;
      searchKeyword = "";
      if (input) input.value = "";
      renderSearchView();
      if (input) input.focus();
    });
  }
}

/* 地址栏第二段变化（点切换器 / 前进后退 / 直接粘贴带 /trace 的链接）→ 重绘模块 */
window.addEventListener("hashchange", () => {
  if (viewFromHash() !== "search") return;   // 不在检索页就不用管
  renderSearchView();
});

/* 注册进首页的视图渲染表（home.js 定义，切视图 / 数据就绪时统一重绘） */
VIEW_RENDERERS.push(renderSearchView);

initSearch();
renderSearchView(); // 首屏：若直接落在 #/search/trace，模块也直接落对
