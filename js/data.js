/* ============================================================
   data.js — 数据加载与校验（TECH_DESIGN 第七节错误处理规范）
   职责：拉取 data.json → 校验字段 → 通过的条目交给页面渲染；
   坏条目跳过并在控制台警告，页面照常渲染其余条目。
   ============================================================ */

const VERDICTS = ["真", "假", "存疑", "部分属实"];

/**
 * 加载并校验数据。返回 Promise<Array>（只含通过校验的条目）。
 * 全部失败时 reject，由调用方显示重试界面。
 */
async function loadVerifiedData() {
  let raw;
  try {
    const resp = await fetch("data/data.json");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    raw = await resp.json();
  } catch (err) {
    console.error("[data] 数据加载失败：", err);
    throw err; // 调用方显示重试按钮
  }

  const items = Array.isArray(raw.items) ? raw.items : [];
  const good = [];

  items.forEach((item, i) => {
    const problems = [];
    if (!item.id) problems.push("缺 id");
    if (!item.title) problems.push("缺 title");
    if (!VERDICTS.includes(item.verdict)) problems.push("verdict 非法：" + item.verdict);
    if (!item.summary) problems.push("缺 summary");
    if (!Array.isArray(item.sources) || item.sources.length < 2) problems.push("sources 不足 2 条");
    if (!item.origin) problems.push("缺 origin（允许值为「未能溯源」+已知流传信息）");
    if (!item.first_seen) problems.push("缺 first_seen");
    if (!item.updated_at) problems.push("缺 updated_at");

    if (problems.length) {
      console.warn("[data] 第 " + (i + 1) + " 条被跳过（" + problems.join("；") + "）", item);
    } else {
      good.push(item);
    }
  });

  return good;
}

/** 显示"加载失败 + 重试"界面（渲染进指定容器） */
function showLoadError(container, retryFn) {
  container.innerHTML =
    '<div class="empty-state">数据加载失败，可能是网络抖动。<br><br>' +
    '<button class="tab" id="retry-btn">重试</button></div>';
  const btn = container.querySelector("#retry-btn");
  if (btn) btn.addEventListener("click", retryFn);
}

/** 按条目 id 从地址栏读取详情页参数 */
function getIdFromUrl() {
  return new URLSearchParams(location.search).get("id");
}
