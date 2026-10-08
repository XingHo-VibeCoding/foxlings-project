/* ============================================================
   detail.js — 详情页逻辑（Day 7 第 4 步 / Day 8 补完）
   F1 溯源时间线（允许「溯源中断」，禁止硬编出处）
   F2 信源比对（≥2 条可点击信源 + 比对结论三选一）
   ============================================================ */

const CROSS_LABELS = ["相互印证", "存在矛盾", "信源不足"];

/** 结论标签 → CSS 类名（与 home.js 一致） */
function verdictTag(verdict) {
  return '<span class="tag tag-' + verdict + '">' + verdict + "</span>";
}

/** 渲染核查档案头部：标题 / 结论标签 / 摘要 / 日期 */
function renderHead(item) {
  const el = document.getElementById("detail-head");
  el.innerHTML =
    "<div>" + verdictTag(item.verdict) +
    '<span class="card-date">更新于 ' + item.updated_at + " · " + (item.heat_note || "") + "</span></div>" +
    '<h2 class="detail-title">' + item.title + "</h2>" +
    '<p class="card-summary">' + item.summary + "</p>";
}

/* ============================================================
   Day 11：一键复制结论（纯前端交互，不依赖后端）
   反馈设计：点击后按钮本身变身——成功变绿「✓ 已复制」并弹跳一下，
   失败变红并提示原因，2 秒后自动复原；aria-live 让读屏软件也能听到
   ============================================================ */

let copyResetTimer = null; // 连续点击时先清掉上一次的复原定时器，避免状态被旧计时器打断

/** 组装要复制的文本：标题 + 结论 + 摘要 + 详情页链接 */
function buildCopyText(item) {
  return (
    "【真伪辨别】" + item.title + "\n" +
    "结论：" + item.verdict + "（人工核查 · 示例数据，仅供演示）\n" +
    "摘要：" + item.summary + "\n" +
    "详情页：" + location.href
  );
}

/** 按钮进入某个反馈状态（success / fail），并在 delay 后复原 */
function setCopyState(btn, state, text, delay) {
  btn.className = "copy-btn" + (state ? " copy-" + state : "");
  btn.textContent = text;
  if (copyResetTimer) clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    btn.className = "copy-btn";
    btn.textContent = "📋 复制本条结论";
    copyResetTimer = null;
  }, delay);
}

/** 兜底复制：剪贴板 API 不可用时用老办法（选中临时文本框 + execCommand） */
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok;
}

/* ============================================================
   Day 11 模板练习：收藏 / 撤销收藏（临时状态版，不依赖后端）
   状态机：未收藏 → 保存中(禁用) → 已收藏 → 撤销中(禁用) → 未收藏；
   任一处理失败 → 红色提示 2 秒 → 回到操作前状态。
   今天数据存 localStorage（fx_favs）；将来接后端只需替换 simulateFav，
   状态机与反馈逻辑不动。
   ============================================================ */

/* FAV_KEY（收藏键名）Day 19 上移到 data.js 公共层，本页直接使用不再声明 */
const FAV_FAIL_KEY = "fx_fav_fail"; // 失败模拟开关（测试用：设为 "1" 强制失败）
let currentItemId = "";          // 当前详情页条目 id（收藏按钮操作目标）

/** 读收藏列表（localStorage 损坏时按空列表处理，不让页面挂掉） */
function getFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY));
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

/** 模拟保存/撤销请求：今天用 setTimeout 顶替网络请求 */
function simulateFav(willSave) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 测试开关或 URL ?favfail=1 时模拟失败，将来删掉这个判断即可
      const forcedFail = localStorage.getItem(FAV_FAIL_KEY) === "1" ||
        location.search.indexOf("favfail=1") !== -1;
      if (forcedFail) { reject(new Error("模拟保存失败")); return; }
      try {
        let favs = getFavs();
        const id = currentItemId;
        if (willSave) {
          if (favs.indexOf(id) === -1) favs.push(id);
        } else {
          favs = favs.filter((x) => x !== id);
        }
        localStorage.setItem(FAV_KEY, JSON.stringify(favs));
        resolve();
      } catch (e) { reject(e); }
    }, 500);
  });
}

/** 按当前收藏状态渲染按钮文案与样式 */
function paintFav(btn, state) {
  // state: idle | saving | saved | undoing | fail
  btn.disabled = state === "saving" || state === "undoing";
  btn.className = "fav-btn" + (state === "saved" ? " fav-saved" : "") +
    (state === "fail" ? " fav-fail" : "");
  const labels = {
    idle: "☆ 收藏这条",
    saving: "保存中…",
    saved: "★ 已收藏（再点撤销）",
    undoing: "撤销中…",
    fail: "保存失败，请重试"
  };
  btn.textContent = labels[state] || labels.idle;
  btn.setAttribute("aria-live", "polite");
}

/** 渲染收藏按钮并绑定切换逻辑（在复制按钮之后调用） */
function renderFavButton(item) {
  currentItemId = item.id;
  const head = document.getElementById("detail-head");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "fav-btn";
  paintFav(btn, getFavs().indexOf(item.id) !== -1 ? "saved" : "idle");
  head.appendChild(btn);

  let busy = false;        // 处理期间拦住重复点击（配合 disabled 双保险）
  let failTimer = null;    // 失败提示的复原定时器；重试点击时要先清掉，避免旧定时器覆盖新状态

  btn.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    if (failTimer) { clearTimeout(failTimer); failTimer = null; }
    const wasSaved = getFavs().indexOf(currentItemId) !== -1;
    paintFav(btn, wasSaved ? "undoing" : "saving");
    try {
      await simulateFav(!wasSaved);
      paintFav(btn, wasSaved ? "idle" : "saved");
    } catch (err) {
      // 失败：红色提示 2 秒，然后回到操作前的状态；期间按钮保持可点，随时能按提示重试
      btn.disabled = false;
      btn.className = "fav-btn fav-fail";
      btn.textContent = "保存失败，请重试";
      failTimer = setTimeout(() => paintFav(btn, wasSaved ? "saved" : "idle"), 2000);
    }
    busy = false;
  });
}

/** 渲染复制按钮并绑定点击反馈（在 renderHead 之后调用） */
function renderCopyButton(item) {
  const head = document.getElementById("detail-head");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.id = "copy-btn";
  btn.textContent = "📋 复制本条结论";
  btn.setAttribute("aria-live", "polite"); // 状态文字变化会自动播报给读屏软件
  head.appendChild(btn);

  btn.addEventListener("click", async () => {
    const text = buildCopyText(item);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(btn, "success", "✓ 已复制，去粘贴看看", 2000);
    } catch (err) {
      // 降级：老浏览器 / 非安全上下文
      if (fallbackCopy(text)) {
        setCopyState(btn, "success", "✓ 已复制，去粘贴看看", 2000);
      } else {
        setCopyState(btn, "fail", "复制失败，请手动选择文字复制", 2600);
      }
    }
  });
}

/**
 * 渲染溯源时间线（F1 / PRD A6）：
 * 节点 1 = 消息开始流传（first_seen）；节点 2 = 最早出处或「溯源中断」（origin）；
 * 节点 3 = 当前核查状态（updated_at + verdict）。origin 如实呈现，绝不硬编。
 */
function renderTimeline(item) {
  const interrupted = item.origin.indexOf("溯源中断") !== -1 || item.origin.indexOf("未能溯源") !== -1;
  const nodes = [
    { date: item.first_seen, title: "消息开始流传", desc: "该信息最早在公开平台可见的时间点。" },
    {
      date: item.first_seen,
      title: interrupted ? "溯源中断（未确认最早出处）" : "最早出处",
      desc: item.origin
    },
    { date: item.updated_at, title: "当前核查状态：" + item.verdict, desc: "以最新一次人工核查为准；后续有新证据会更新此条目。" }
  ];

  const tl = document.getElementById("timeline");
  tl.innerHTML = nodes
    .map((n) =>
      '<div class="tl-node">' +
      '<div class="tl-dot"></div>' +
      '<div class="tl-body"><div class="tl-head"><span class="tl-title">' + n.title +
      '</span><span class="card-date">' + n.date + "</span></div>" +
      '<p class="tl-desc">' + n.desc + "</p></div></div>"
    )
    .join("");
  document.getElementById("section-timeline").hidden = false;
}

/* ============================================================
   Day 12 延伸：信源关键词筛选
   数据对象 = 本条档案的 sources 列表；匹配「信源名 + 域名」。
   三种情况：有匹配 → 只显示匹配信源 / 无匹配 →「没有找到相关内容」+ 清空出口 /
             清空关键词 → 恢复完整信源列表。
   ============================================================ */

let ALL_SOURCES = [];    // 本条档案的全部信源（筛选的原始数据）
let sourceKeyword = "";  // 当前关键词

/** 取信源域名（链接异常时给可读占位，不让页面挂掉） */
function sourceHost(url) {
  try { return new URL(url).hostname; } catch (e) { return "（链接格式异常）"; }
}

/** 按当前关键词渲染信源列表 + 结果计数 */
function renderSourceList() {
  const wrap = document.getElementById("source-cards");
  const summary = document.getElementById("source-summary");
  const kw = sourceKeyword.trim();

  const list = kw
    ? ALL_SOURCES.filter((s) => (s.name + sourceHost(s.url)).indexOf(kw) !== -1)
    : ALL_SOURCES;

  if (summary) {
    summary.textContent = kw
      ? "筛选关键词「" + kw + "」：共 " + list.length + " 条信源"
      : "共 " + list.length + " 条信源";
  }

  if (!list.length) {
    // 无匹配：统一文案 + 清空出口（清空后恢复完整列表）
    wrap.innerHTML =
      '<div class="empty-state">没有找到相关内容' +
      '<button type="button" class="empty-jump" id="source-clear">清空关键词</button></div>';
    const clearBtn = document.getElementById("source-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        sourceKeyword = "";
        document.getElementById("source-search").value = "";
        renderSourceList();
      });
    }
    return;
  }

  wrap.innerHTML = list
    .map((s) =>
      '<a class="src-card" href="' + s.url + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="src-name">📎 ' + s.name + "</span>" +
      '<span class="card-date">查证日期 ' + s.date + " · " + sourceHost(s.url) + "</span>" +
      '<span class="src-open">点开原文亲自验证 ↗</span></a>'
    )
    .join("");
}

/** 绑定信源关键词输入（只绑一次；输入即过滤，清空即恢复完整列表） */
function initSourceFilter() {
  const search = document.getElementById("source-search");
  if (!search) return;
  search.addEventListener("input", (e) => {
    sourceKeyword = e.target.value;
    renderSourceList();
  });
}

/** 渲染信源比对（F2 / PRD A7-A9）：≥2 张可点击信源卡 + 比对结论 */
function renderSources(item) {
  ALL_SOURCES = Array.isArray(item.sources) ? item.sources : [];
  sourceKeyword = "";
  renderSourceList();

  // 比对结论（三选一），未填或非法值按「信源不足」降级处理
  const cc = CROSS_LABELS.indexOf(item.cross_check) !== -1 ? item.cross_check : "信源不足";
  document.getElementById("cross-check").textContent =
    "比对结论：" + cc + (cc === "信源不足" ? "（待核实）" : "");
  document.getElementById("section-sources").hidden = false;
}

/** 入口：按地址栏 ?id= 加载对应条目（Day 13：补齐 加载中 / 正常 / 空 / 错误 四种状态） */
async function initDetail() {
  const head = document.getElementById("detail-head");
  const id = getIdFromUrl();

  // 状态一：加载中
  renderListState(head, "loading");

  let items;
  try {
    items = await loadItemsForPage(); // ?demo= 演示开关在 data.js 里统一处理
  } catch (err) {
    // 状态二：错误（附「下一步怎么做」的指引，不让用户干瞪眼）
    console.error("[detail] 数据加载失败：", err);
    renderListState(head, "error", {
      desc: "这条核查档案没能读出来，可能是网络抖动或 data.json 缺失。",
      onRetry: initDetail,
    });
    return;
  }

  const item = items.find((it) => it.id === id);
  if (!item) {
    // 状态三：空（没有这条档案）——给一条明确的退路
    renderListState(head, "empty", {
      text: "没有找到这条核查档案（id：" + (id || "空") + "）。",
      action: "← 回首页挑一条",
      actionHref: "index.html",
    });
    return;
  }

  // 状态四：正常
  renderHead(item);
  renderCopyButton(item);
  renderFavButton(item);
  renderTimeline(item);
  renderSources(item);
  initSourceFilter();
  recordHistory(item.id);   // 留一笔浏览足迹（个人主页读取）
  reportView(item.id);      // 给这条核查 +1 次浏览（辟谣榜热度算法的输入之一）
}

/* ============================================================
   Day 15：浏览足迹（个人主页「浏览足迹」的数据来源）
   只记 id + 时间，最多留 20 条；无痕模式写不进去也不影响页面。
   ============================================================ */

/* HIST_KEY / HIST_MAX（浏览足迹键名与上限）Day 19 上移到 data.js 公共层 */

function recordHistory(id) {
  if (!id) return;
  try {
    let list = [];
    try {
      const v = JSON.parse(localStorage.getItem(HIST_KEY));
      if (Array.isArray(v)) list = v;
    } catch (e) { list = []; }
    list = list.filter((x) => x && x.id !== id);   // 重复访问只保留最近一次
    list.unshift({ id: id, at: Date.now() });
    localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX)));
  } catch (e) {
    // 无痕模式 / 存储被禁用：忽略即可，浏览足迹不是核心功能
  }
}

/* ============================================================
   Day 23：浏览计数上报 —— 辟谣榜热度算法里「点击量」那一半的来源

   规则：**同设备同条目只算一次**。这个数字要能当「有多少人关心这条」来读，
   而不是「页面被刷了几次」—— 否则自己按住 F5 就能把一条顶上榜。
   去重拦在前端（localStorage 里记下已上报过的 id）；服务端那个函数只管 +1，
   它不知道也不该知道「你是不是第一次来」。

   上报失败一律静默：浏览计数是锦上添花，绝不能因为它没上报成功就影响看档案。
   ============================================================ */

async function reportView(id) {
  if (!id) return;

  const seen = readJSON(VIEW_KEY, []);
  const list = Array.isArray(seen) ? seen : [];
  if (list.indexOf(id) !== -1) return;   // 这条在你这台设备上已经计过了

  list.push(id);
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(list));
  } catch (e) {
    // 无痕模式 / 存储被禁用：继续上报。最坏情况是同一台设备多算几次，不影响页面
  }

  try {
    await api.bumpItemView(id);
  } catch (e) {
    console.warn("[detail] 浏览量上报失败（忽略）：", e && e.message);
  }
}

/** 余力加练：返回上一页——站内进来的走浏览器后退（保留来路的视图与筛选），直接打开的回首页 */
function initBackLink() {
  const link = document.querySelector(".back-link");
  if (!link) return;
  link.addEventListener("click", (e) => {
    const fromSameSite = document.referrer && document.referrer.indexOf(location.origin) === 0;
    if (!fromSameSite) return; // 直接打开或站外进来：走原本的 href 回首页
    e.preventDefault();
    history.back();
  });
}

mountDemoBanner();
initBackLink();
initDetail();
