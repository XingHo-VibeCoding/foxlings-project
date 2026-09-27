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

/** 渲染信源比对（F2 / PRD A7-A9）：≥2 张可点击信源卡 + 比对结论 */
function renderSources(item) {
  const wrap = document.getElementById("source-cards");
  wrap.innerHTML = item.sources
    .map((s) => {
      let host = "";
      try { host = new URL(s.url).hostname; } catch (e) { host = "（链接格式异常）"; }
      return (
        '<a class="src-card" href="' + s.url + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="src-name">📎 ' + s.name + "</span>" +
        '<span class="card-date">查证日期 ' + s.date + " · " + host + "</span>" +
        '<span class="src-open">点开原文亲自验证 ↗</span></a>'
      );
    })
    .join("");

  // 比对结论（三选一），未填或非法值按「信源不足」降级处理
  const cc = CROSS_LABELS.indexOf(item.cross_check) !== -1 ? item.cross_check : "信源不足";
  document.getElementById("cross-check").textContent =
    "比对结论：" + cc + (cc === "信源不足" ? "（待核实）" : "");
  document.getElementById("section-sources").hidden = false;
}

/** 入口：按地址栏 ?id= 加载对应条目 */
async function initDetail() {
  const head = document.getElementById("detail-head");
  const id = getIdFromUrl();

  let items;
  try {
    items = await loadVerifiedData();
  } catch (err) {
    showLoadError(head, initDetail);
    return;
  }

  const item = items.find((it) => it.id === id);
  if (!item) {
    head.innerHTML =
      '<div class="empty-state">没有找到这条核查档案（id：' + (id || "空") + "）。<br>" +
      '<a href="index.html" class="back-link">← 回首页挑一条</a></div>';
    return;
  }

  renderHead(item);
  renderTimeline(item);
  renderSources(item);
}

initDetail();
