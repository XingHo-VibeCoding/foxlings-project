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

/* ============================================================
   Day 13：列表「四种状态」的统一渲染
   正常态（有数据）由各视图自己渲染列表；这里只管另外三种：
     loading 加载中 / empty 空 / error 错误
   约定：容器内一律使用 .empty-state 作为外层类（另加 state-xxx 修饰类），
        出口按钮统一用 .empty-jump —— 与既有样式和 Skill 检查保持一致。
   ============================================================ */

/**
 * 把某个列表容器渲染成指定状态。
 * @param {HTMLElement} container 列表容器
 * @param {"loading"|"empty"|"error"} state
 * @param {Object} [opts]
 *   text        空状态的说明文案
 *   action      出口按钮文案（不传则没有按钮）
 *   actionId    出口按钮的 id（保持既有测试选择器可用）
 *   onAction    出口按钮点击回调
 *   desc        错误状态的补充说明
 *   onRetry     错误状态「重试」回调
 */
function renderListState(container, state, opts) {
  opts = opts || {};
  const box = document.createElement("div");
  box.className = "empty-state state-" + state;
  // 加载中/空是状态播报；错误用 alert 让读屏软件立刻读出
  box.setAttribute("role", state === "error" ? "alert" : "status");

  if (state === "loading") {
    box.innerHTML =
      '<span class="spinner" aria-hidden="true"></span><span>正在加载…</span>';
  } else if (state === "error") {
    box.innerHTML =
      '<strong class="state-title">数据加载失败</strong>' +
      '<span class="state-desc">' + (opts.desc || "可能是网络抖动，或 data.json 没能读到。") + "</span>" +
      '<button type="button" class="empty-jump" data-state-act="retry">重试</button>';
  } else {
    let extra = "";
    if (opts.action && opts.actionData) {
      Object.keys(opts.actionData).forEach((k) => {
        extra += " data-" + k + '="' + opts.actionData[k] + '"';
      });
    }
    // 出口既可以是按钮（留在本页做事），也可以是链接（跳到别的页面）
    let actionHtml = "";
    if (opts.action && opts.actionHref) {
      actionHtml = '<a class="empty-jump" href="' + opts.actionHref + '">' + opts.action + "</a>";
    } else if (opts.action) {
      actionHtml =
        '<button type="button" class="empty-jump" data-state-act="act"' +
        (opts.actionId ? ' id="' + opts.actionId + '"' : "") + extra + ">" + opts.action + "</button>";
    }
    box.innerHTML =
      '<span class="state-desc">' + (opts.text || "暂无数据") + "</span>" + actionHtml;
  }

  container.innerHTML = "";
  container.appendChild(box);

  if (state === "loading") return;
  const btn = box.querySelector("[data-state-act]");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (state === "error") { if (opts.onRetry) opts.onRetry(); return; }
    if (opts.onAction) opts.onAction();
  });
}

/** 兼容旧调用：显示"加载失败 + 重试"界面（渲染进指定容器） */
function showLoadError(container, retryFn) {
  renderListState(container, "error", { onRetry: retryFn });
}

/* ============================================================
   Day 13：状态演示开关（仅供本地演示与验收，接后端后可整段删除）
   地址栏 ?demo=loading|empty|error 可以稳定复现三种非正常状态；
   不带该参数（或值非法）时一切照常。
   ============================================================ */

function readDemoState() {
  const v = (new URLSearchParams(location.search).get("demo") || "").toLowerCase();
  return ["loading", "empty", "error"].indexOf(v) !== -1 ? v : "";
}

/**
 * 按演示开关加载数据（首页与详情页共用）：
 *   不带 ?demo=     → 正常加载
 *   ?demo=error     → 直接抛错，走错误状态
 *   ?demo=empty     → 返回空列表，走空状态
 *   ?demo=loading   → 先等 60 秒再加载，便于观察/截图「加载中」
 */
async function loadItemsForPage() {
  const demo = readDemoState();
  if (demo === "error") throw new Error("演示：强制加载失败（?demo=error）");
  if (demo === "empty") return [];
  if (demo === "loading") await new Promise((r) => setTimeout(r, 60000));
  return loadVerifiedData();
}

/** 演示模式下在页面顶部挂一条醒目提示，避免误以为是真故障 */
function mountDemoBanner() {
  const demo = readDemoState();
  if (!demo) return;
  const names = { loading: "加载中", empty: "空", error: "错误" };
  const p = document.createElement("p");
  p.className = "demo-banner";
  p.setAttribute("role", "status");
  p.textContent =
    "🧪 演示模式：正在强制显示「" + names[demo] + "」状态 —— 去掉地址栏里的 ?demo=" + demo + " 即恢复正常";
  const main = document.querySelector("main");
  if (main) main.insertBefore(p, main.firstChild);
}

/** 按条目 id 从地址栏读取详情页参数 */
function getIdFromUrl() {
  return new URLSearchParams(location.search).get("id");
}
