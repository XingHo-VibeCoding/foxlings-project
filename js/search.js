/* ============================================================
   search.js — 查询检索（主打功能）
   页内两个模块（共用一个检索框，输入一次即可来回切）：
     ① 站内搜索（inside）—— 查本站已核查库，命中直接给卡片（可点进详情）
     ② 全网溯源（trace） —— 上半是 **AI 溯源助手**（L3，Day 22 点亮）：粘一段材料，
                            AI 拆成「主张 / 常见套路 / 必查三件事 / 检索式」四段；
                            下半是「官方来源」「网络来源」两组入口，拿 AI 给的检索式
                            一键带进去，自己点开比对。本站不做裁判。
   模块切换走地址栏第二段（#/search/inside、#/search/trace）：
   刷新、分享链接、浏览器前进后退都能回到同一个模块——与 Day 13 的视图路由同一套原则。
   还缺的一角（如实标注，不假装已有）：
     · 「自动联网抓取」—— 托管后端只有 LLM、没有搜索/抓取通道，做不了。
       所以 AI 给的是「该去搜什么」，网上「已经有什么」仍需人点开入口自己看。
   与全站一致的部分：四态沿用 renderListState / stateGuard，命中卡片复用 renderCard。
   ============================================================ */

let searchKeyword = ""; // 输入框当前内容（两个模块共用；清空即回引导态）

const SEARCH_MODES = ["inside", "trace"];
const MODE_LABELS = { inside: "站内搜索", trace: "全网溯源" };

/* escHtml（用户输入转义）Day 19 上移到 data.js 公共层 —— 论坛也要用同一份实现，
   这里不再重复定义，只保留调用。 */

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
   模块二上半：AI 溯源助手（Day 22 点亮 L3）
   干什么：把用户粘进来的一段材料交给 AI，拆成「主张 / 常见套路 / 必查三件事 / 检索式」。
   不干什么：**不判真伪**。判真伪是本站没有的能力，也是本站不背的责任——
            AI 只做整理与指路，看的人自己去核对原始出处。
   为什么不做「自动联网」：托管后端只有 LLM，没有搜索/抓取通道。所以措辞必须诚实：
            AI 给的是「该去搜什么」，不是「网上已经有什么」。
   安全纪律（三条都不能省）：
     · 模型输出属于不可信内容 → 一律 escHtml / textContent 落地，绝不 innerHTML 直插；
     · 用户输入只当材料，不进系统提示词（提示词在 ai.js，用户输入在下一条 user 消息里）；
     · 这是个能烧应用方额度的按钮 → 冷却 + 运行中禁用，别让人连点。
   ============================================================ */

let aiRunning = false;      // 正在流式输出
let aiController = null;    // 停止用的中断器
let aiLastInput = "";       // 上次整理的材料（重试、交站方核查时复用）
let aiCooldownTimer = null; // 冷却倒计时（1 秒一跳，归零自停）
let aiSlowTimer = null;     // 「模型还在处理」提示（等太久要出声）

const AI_IDLE_TEXT =
  "粘一条要核查的说法进来，AI 会把它拆成「主张 / 常见套路 / 必查三件事 / 检索式」四段。" +
  "它只做整理，不下判断——说法真假，对着原始出处自己看。";

function aiBox() {
  return document.getElementById("ai-result");
}

/** 引导态：还没开始整理时，结果区不留白 */
function renderAiIdle() {
  const box = aiBox();
  if (!box) return;
  renderListState(box, "empty", { text: AI_IDLE_TEXT });
}

/** 流式态：先给一条「正在整理」+ 一块逐字长出来的文本区 */
function renderAiStreaming() {
  const box = aiBox();
  if (!box) return;
  box.innerHTML =
    '<div class="ai-stream">' +
      '<p class="ai-stream-title">' +
        '<span class="spinner" aria-hidden="true"></span>' +
        '<span id="ai-stream-label">AI 正在整理…</span>' +
        '<span class="ai-hint">（可以随时点「停止」）</span>' +
      "</p>" +
      '<pre class="ai-stream-text" id="ai-stream-text"></pre>' +
    "</div>";

  /* 有些模型会先长时间「想」再动笔（实测默认模型首字能等 150 秒）。
     等太久不吭声，用户会以为页面卡死 —— 15 秒还没吐字就换一句话说明。 */
  clearTimeout(aiSlowTimer);
  aiSlowTimer = setTimeout(() => {
    const label = document.getElementById("ai-stream-label");
    if (label && aiRunning) label.textContent = "模型还在处理，再多等一会儿…";
  }, 15000);
}

/** 每来一小段就往文本区追加（用 textContent：模型输出不可信，不进 HTML 解析） */
function appendAiChunk(fullText) {
  const el = document.getElementById("ai-stream-text");
  if (!el) return;
  clearTimeout(aiSlowTimer);              // 已经开始吐字，撤掉「还在处理」提示
  const label = document.getElementById("ai-stream-label");
  if (label) label.textContent = "AI 正在整理…";
  el.textContent = fullText;
  el.scrollTop = el.scrollHeight;   // 跟着长，别让用户自己滚
}

/**
 * 完成态：把 AI 的四段文本渲染成卡片。
 * @param {string} fullText AI 输出全文
 * @param {Object} [opts]  note = 顶部提示（例如「已停止，下面是已经整理出的部分」）
 */
function renderAiResult(fullText, opts) {
  opts = opts || {};
  const box = aiBox();
  if (!box) return;

  const parsed = ai.parseAiSections(fullText);
  let html = "";

  if (opts.note) html += '<p class="ai-warn">' + escHtml(opts.note) + "</p>";
  if (!parsed.parsed) {
    // 模型没按四段格式走：不假装结构正确，直接说清并原样展示
    html += '<p class="ai-warn">AI 这次没按四段格式输出，下面是原文：</p>';
  }

  parsed.sections.forEach((sec) => {
    html += '<article class="ai-card">' +
      '<h5 class="ai-card-title">' + escHtml(sec.title) + "</h5>";

    if (sec.kind === "steps") {
      const steps = ai.splitAiSteps(sec.body);
      html += steps.length
        ? '<ol class="ai-steps">' + steps.map((t) => "<li>" + escHtml(t) + "</li>").join("") + "</ol>"
        : '<p class="ai-card-body">' + escHtml(sec.body) + "</p>";
    } else if (sec.kind === "chips") {
      const queries = ai.splitAiQueries(sec.body);
      html += queries.length
        ? '<p class="ai-card-note">点一个组合，直接带进下面的溯源入口：</p>' +
          '<div class="ai-queries">' +
            queries.map((q) =>
              '<button type="button" class="ai-query" data-ai-query="' + escHtml(q) + '">' +
                escHtml(q) +
              "</button>"
            ).join("") +
          "</div>"
        : '<p class="ai-card-body">' + escHtml(sec.body) + "</p>";
    } else if (sec.kind === "list") {
      const lines = ai.splitAiSteps(sec.body);   // 同样按行拆（容忍模型不写项目符号）
      html += lines.length > 1
        ? '<ul class="ai-list">' + lines.map((t) => "<li>" + escHtml(t) + "</li>").join("") + "</ul>"
        : '<p class="ai-card-body">' + escHtml(sec.body) + "</p>";
    } else {
      html += '<p class="ai-card-body">' + escHtml(sec.body) + "</p>";
    }
    html += "</article>";
  });

  // 页脚是「诚实性底线」的落地处：AI 生成 + 不是结论 + 不联网 + 给出人工出口
  html += '<p class="ai-foot">' +
    '<span class="ai-badge">AI 生成</span>' +
    "以上是 AI 对材料的<b>初步整理，不是结论</b>：它不联网核对，也可能出错。" +
    "请点上面的检索入口，以官方通报和原始出处为准。" +
    "</p>" +
    '<div class="ai-actions">' +
      '<a class="ai-golink" href="index.html#/forum">拿不准？去论坛问 →</a>' +
      '<button type="button" class="ai-report" id="ai-report">把这条交站方核查</button>' +
      '<span class="ai-rep-note" id="ai-rep-note" aria-live="polite"></span>' +
    "</div>";

  box.innerHTML = html;
}

/** 运行按钮的状态与倒计时（冷却中就别让人点） */
function paintAiBar() {
  const run = document.getElementById("ai-run");
  const stop = document.getElementById("ai-stop");
  const left = ai.cooldownLeft();

  if (stop) stop.hidden = !aiRunning;
  if (run) {
    run.disabled = aiRunning || left > 0;
    run.textContent = aiRunning ? "整理中…" : (left > 0 ? "冷却 " + left + "s" : "让 AI 拆解");
  }
}

/** 冷却倒计时：每秒重画一次，归零就自己停掉 */
function startAiCooldownTick() {
  if (aiCooldownTimer) { clearInterval(aiCooldownTimer); aiCooldownTimer = null; }
  if (ai.cooldownLeft() <= 0) { paintAiBar(); return; }
  aiCooldownTimer = setInterval(() => {
    paintAiBar();
    if (ai.cooldownLeft() <= 0) {
      clearInterval(aiCooldownTimer);
      aiCooldownTimer = null;
    }
  }, 1000);
}

/** 把 AI 整理用的这条材料交给站方核查（走 api 层，未登录也能提交） */
async function submitAiAsReport() {
  const note = document.getElementById("ai-rep-note");
  const btn = document.getElementById("ai-report");
  const text = aiLastInput.slice(0, 500);   // reports.text 的库约束是 5–500 字

  if (btn) btn.disabled = true;
  if (note) note.textContent = " 提交中…";
  try {
    await api.submitReport({ text });
    if (note) note.textContent = " 已提交，站方会逐条核查。";
  } catch (e) {
    if (note) note.textContent = " 提交失败：" + (e.message || "稍后再试。");
    if (btn) btn.disabled = false;
  }
}

/** 跑一次整理：校验 → 流式 → 卡片 / 中断 / 错误，各态都在这里收口 */
async function runAi() {
  if (aiRunning) return;

  const ta = document.getElementById("ai-input");
  aiLastInput = String(ta ? ta.value : "").trim();

  if (aiLastInput.length < ai.MIN_CHARS) {
    const box = aiBox();
    if (box) {
      renderListState(box, "empty", {
        text: "还没粘材料（或太短了，至少 " + ai.MIN_CHARS + " 个字）。把要核查的那条说法原文贴进上面的框里再点。",
      });
    }
    return;
  }

  aiRunning = true;
  aiController = typeof AbortController === "function" ? new AbortController() : null;
  paintAiBar();
  renderAiStreaming();

  try {
    const full = await ai.digest({
      text: aiLastInput,
      signal: aiController ? aiController.signal : undefined,
      onChunk: (_piece, fullText) => appendAiChunk(fullText),
    });
    renderAiResult(full);
  } catch (e) {
    if (e.aborted) {
      if (e.partial && e.partial.trim()) {
        renderAiResult(e.partial, { note: "已停止。下面是停下来之前整理出的部分——想完整的结果，点「让 AI 拆解」重新来一遍。" });
      } else {
        renderAiIdle();
      }
    } else {
      const box = aiBox();
      if (box) {
        renderListState(box, "error", {
          desc: e.message,
          onRetry: runAi,   // 冷却 / 输入类问题重按也会被同一套校验挡住，文案不会骗人
        });
      }
    }
  } finally {
    clearTimeout(aiSlowTimer);   // 收尾时撤掉「还在处理」提示，别留在下一次
    aiRunning = false;
    aiController = null;
    paintAiBar();
    startAiCooldownTick();
  }
}

/** 绑定 AI 区的交互（输入计数 / 示例 / 整理 / 停止 / 检索式 / 交站方） */
function initAi() {
  const ta = document.getElementById("ai-input");
  const count = document.getElementById("ai-count");

  if (ta) {
    ta.addEventListener("input", () => {
      if (count) count.textContent = ta.value.length + " / " + ai.MAX_CHARS;
    });
  }

  const samples = document.getElementById("ai-samples");
  if (samples) {
    samples.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ai-sample]");
      if (!btn || !ta) return;
      ta.value = btn.dataset.aiSample;
      if (count) count.textContent = ta.value.length + " / " + ai.MAX_CHARS;
      ta.focus();
    });
  }

  const run = document.getElementById("ai-run");
  if (run) run.addEventListener("click", runAi);

  const stop = document.getElementById("ai-stop");
  if (stop) {
    stop.addEventListener("click", () => { if (aiController) aiController.abort(); });
  }

  const box = aiBox();
  if (box) {
    box.addEventListener("click", (e) => {
      // 检索式 → 带进「官方 / 网络」两组入口（AI 指路，人自己去看）
      const q = e.target.closest("[data-ai-query]");
      if (q) {
        const kw = q.dataset.aiQuery;
        searchKeyword = kw;
        const input = document.getElementById("search-input");
        if (input) input.value = kw;
        renderSearchView();
        const traceBox = document.getElementById("trace-results");
        if (traceBox) traceBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      if (e.target.closest("#ai-report")) submitAiAsReport();
    });
  }

  paintAiBar();
  renderAiIdle();
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
initAi();           // AI 溯源助手（L3）自成一套状态，不跟着关键词重绘
renderSearchView(); // 首屏：若直接落在 #/search/trace，模块也直接落对
