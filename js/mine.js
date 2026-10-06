/* ============================================================
   mine.js — 个人主页（P1）
     Day 15 起四块内容：收藏 / 足迹 / 我提交的线索 / 关于与方法论
     Day 21 起线索接后端：提交写云库，登录后可从云库回读

   【哪块在本地、哪块在云上 —— 必须分得清，不能让用户误以为都存好了】
     fx_favs     收藏        只在本机（个人偏好，不上传）
     fx_history  浏览足迹    只在本机（同上）
     reports     我提交的线索 Day 21 起**写云库**；未登录提交时在本机留一份底
                             （未登录的线索在云端是匿名的，本人回读不到，所以留底）
     fx_myreports 本机留底   仅作未登录时的回看，不再是数据源

   身份来自 js/auth.js：登录只为了记住「哪条是你提交的」，本期不涉及收藏上云。
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

/* ---------------- ⓪ 账号 ---------------- */

/** 账号区块：未登录给登录出口；已登录显示脱敏邮箱与退出 */
function renderAccount() {
  const box = document.getElementById("account-body");
  if (!box) return;

  if (!auth.isSignedIn()) {
    box.innerHTML =
      '<p class="mine-about">还没有登录。登录只用来记住「哪条帖子、哪条线索是你提交的」——' +
      '用邮箱收一个验证码就行，不用注册流程；本站不收集手机号。</p>' +
      '<button type="button" class="empty-jump" id="account-signin">登录 / 注册</button>';
    const btn = document.getElementById("account-signin");
    if (btn) btn.addEventListener("click", () => {
      auth.openLogin("登录后，你提交的帖子和线索会记在你自己名下。");
    });
    return;
  }

  const email = auth.session && auth.session.user ? auth.session.user.email : "";
  box.innerHTML =
    '<p class="mine-about">已登录：' + escHtml(email ? maskEmail(email) : "（邮箱未显示）") + '</p>' +
    '<p class="mine-about">帖子与线索都存在云端，换个设备登录也能看到。</p>' +
    '<button type="button" class="auth-link" id="account-signout">退出登录</button>';

  const out = document.getElementById("account-signout");
  if (out) out.addEventListener("click", async () => {
    out.disabled = true;
    await auth.signOut();          // 退出会触发 onChange，界面由那里统一刷新
  });
}

/* ---------------- ③ 我提交的待核查（写云库；未登录时本机留底） ---------------- */

let MY_REPORTS = [];        // 登录时从云端取回的线索

/** 取线索：登录走云端；未登录时云端回读不到匿名线索，只读本机留底 */
async function loadReports() {
  if (!auth.isSignedIn()) { MY_REPORTS = []; return; }
  MY_REPORTS = await api.getMyReports();
}

/** 列表行统一成 {text, at, cloud} —— 两种来源在界面上必须显示得出来 */
function reportRows() {
  if (auth.isSignedIn()) {
    return MY_REPORTS.map((r) => ({
      text: r.text,
      at: Date.parse(r.created_at) || Date.now(),
      cloud: true,
    }));
  }
  const local = readJSON(REP_KEY, []);
  return Array.isArray(local)
    ? local.map((r) => ({ text: r.text, at: r.at, cloud: false }))
    : [];
}

function renderReports() {
  const box = document.getElementById("rep-list");
  const countEl = document.getElementById("rep-count");
  const hintEl = document.getElementById("rep-hint");
  if (!box || !countEl || !hintEl) return;

  const signed = auth.isSignedIn();
  hintEl.textContent = signed
    ? "看到查不到出处的消息就提交上来，站方会逐条核查。你提交的线索存在云端，换个设备也看得到。"
    : "看到查不到出处的消息就提交上来，站方会逐条核查。未登录也能提交，但只在这台设备上留一份记录——登录后提交的才会跟着账号走。";

  const rows = reportRows();
  countEl.textContent = rows.length
    ? "共 " + rows.length + " 条（" + (signed ? "云端" : "仅本机") + "）"
    : "";

  if (!rows.length) {
    box.innerHTML = '<p class="mine-about">' +
      (signed ? "还没有提交过线索。" : "这台设备上还没有提交记录。") + "</p>";
    return;
  }

  box.innerHTML = "";
  rows.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "mine-item mine-report";
    // 线索是用户输入，一律转义后再拼（不能直接当 HTML 用）
    row.innerHTML = '<span class="mine-item-title">' + escHtml(r.text) + "</span>" +
      '<span class="mine-item-date">' + fmtTime(r.at) + "</span>" +
      (r.cloud
        ? ""
        : '<button type="button" class="rep-del" data-idx="' + i + '" aria-label="删除这条本机记录">删除</button>');
    box.appendChild(row);
  });
}

function initReports() {
  const input = document.getElementById("rep-input");
  const btn = document.getElementById("rep-add");
  const note = document.getElementById("rep-note");
  if (!input || !btn) return;

  const say = (html, ok) => {
    if (!note) return;
    note.innerHTML = html;
    note.classList.toggle("note-ok", ok === true);
    note.classList.toggle("note-warn", ok === false);
  };

  btn.addEventListener("click", async () => {
    const text = input.value.trim();
    // 长度规则与数据库 CHECK 一致（5–500），前端先拦一道只为早提示
    if (!text) { say("先写一句你看到的消息。", false); input.focus(); return; }
    if (text.length < 5) { say("再多写一点（至少 5 个字）：什么说法、在哪看到的。", false); input.focus(); return; }
    if (text.length > 500) { say("太长了，500 字以内。", false); input.focus(); return; }

    const idle = btn.textContent;
    btn.disabled = true;
    btn.textContent = "提交中…";
    say("");

    try {
      await api.submitReport({ text: text });

      // 未登录提交的线索在云端是匿名的（本人回读不到），所以在本机留一份底
      if (!auth.isSignedIn()) {
        const list = readJSON(REP_KEY, []);
        const arr = Array.isArray(list) ? list : [];
        arr.unshift({ text: text, at: Date.now() });
        localStorage.setItem(REP_KEY, JSON.stringify(arr.slice(0, 50)));
      }

      input.value = "";
      say("已提交，站方会逐条核查。", true);
      await refreshReports();
    } catch (err) {
      say(escHtml(err.message || "提交失败，请重试。"), false);
    } finally {
      btn.disabled = false;
      btn.textContent = idle;
    }
  });

  // 删除：只删本机留底（云端记录不提供自行删除，走事件委托）
  const list = document.getElementById("rep-list");
  if (list) {
    list.addEventListener("click", (e) => {
      const del = e.target.closest(".rep-del");
      if (!del) return;
      const arr = readJSON(REP_KEY, []);
      if (!Array.isArray(arr)) return;
      arr.splice(Number(del.dataset.idx), 1);
      localStorage.setItem(REP_KEY, JSON.stringify(arr));
      renderReports();
    });
  }
}

/** 重新取线索并重绘（登录状态变化 / 提交成功后调用） */
async function refreshReports() {
  try {
    await loadReports();
  } catch (err) {
    console.error("[mine] 线索读取失败：", err);
  }
  renderReports();
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
renderAccount();
renderReports();
initData();

// 登录 / 退出后：账号区与线索区一起刷新（线索的来源会跟着变）
auth.onChange(async () => {
  renderAccount();
  await refreshReports();
});
refreshReports();
