/* ============================================================
   admin.js — 管理后台（Day 23）

   【权限模型，一句话】页面只负责「少让不该进来的人看到界面」，
   真正的闸门是数据库：
     · admins 表（RLS：本人只能读到自己那行）→ auth.isAdmin()；
     · 六条 *_admin_* 策略：posts 读/改/删、reports 读/删、items 删。
   就算有人改前端把界面解锁，每个写请求还是会被 RLS 拒。

   【危险操作的两击确认】删除类按钮第一次点只变成「确认？」，
   3 秒内再点才执行——不用系统 confirm 弹窗（丑且打断），也不许一键误删。
   ============================================================ */

let ALL_POSTS = [];
let ALL_REPORTS = [];
let ALL_ITEMS = [];

/** 结论标签 —— 与 home.js / mine.js 同一套类名（本页不引那些脚本，这里给出同一实现） */
function verdictTag(verdict) {
  return '<span class="tag tag-' + verdict + '">' + verdict + "</span>";
}

/* ---------------- 闸门 ---------------- */

/** 渲染闸门：未登录给登录出口；登录但不是管理员就明说 */
async function renderGate() {
  const box = document.getElementById("admin-gate-body");
  const body = document.getElementById("admin-body");
  if (!box) return;

  if (!auth.isSignedIn()) {
    body.hidden = true;
    box.innerHTML =
      '<p class="mine-about">管理后台需要先登录（邮箱收一个验证码就行）。</p>' +
      '<button type="button" class="empty-jump" id="admin-signin">登录</button>';
    const btn = document.getElementById("admin-signin");
    if (btn) btn.addEventListener("click", () => {
      auth.openLogin("管理后台需要核对身份。");
    });
    return;
  }

  const ok = await auth.isAdmin();
  if (!ok) {
    body.hidden = true;
    box.innerHTML =
      '<p class="mine-about">这个账号没有管理权限。如果你应该是管理员，' +
      "让站方把你的账号加进 admins 名单。</p>";
    return;
  }

  box.innerHTML = '<p class="mine-about">身份核对通过。</p>';
  body.hidden = false;
  await loadAll();
}

/* ---------------- 数据装载 ---------------- */

async function loadAll() {
  // 每块各自兜底：一块读不到不该拖垮另外三块（比如会话恰好过期的那一瞬间）
  const safe = async (label, fn, fallback) => {
    try { return await fn(); }
    catch (err) { console.error("[admin] " + label + "失败：", err); return fallback; }
  };

  ALL_POSTS = await safe("帖子读取", () => api.listAllPosts(), []);
  ALL_REPORTS = await safe("线索读取", () => api.listAllReports(), []);
  ALL_ITEMS = await safe("条目读取", () => api.getItems(), []);
  renderPending();
  renderAllPosts();
  renderItems();
  renderReports();
}

/* ---------------- 通用行渲染 ---------------- */

function fmtTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/** 状态徽标 */
function statusTag(status) {
  const map = { approved: "tag-true", pending: "tag-doubt", rejected: "tag-fake" };
  const name = { approved: "已通过", pending: "待审", rejected: "已拒绝" };
  return '<span class="tag ' + (map[status] || "tag-doubt") + '">' + (name[status] || status) + "</span>";
}

/**
 * 两击确认：第一次点把按钮换成「确认？」并聚焦；
 * 3 秒内再点才真正执行。返回 true 表示这次要点真格的了。
 */
function armDangerous(btn) {
  if (btn.dataset.armed === "1") {
    btn.dataset.armed = "";            // 这次是真执行：先撤下 armed，失败时要重走确认
    return true;
  }
  btn.dataset.armed = "1";
  btn.dataset.idle = btn.textContent;
  btn.textContent = "确认？";
  btn.classList.add("btn-armed");
  setTimeout(() => {
    if (btn.dataset.armed === "1") {
      btn.dataset.armed = "";
      btn.textContent = btn.dataset.idle;
      btn.classList.remove("btn-armed");
    }
  }, 3000);
  return false;
}

/** 统一的行动作错误提示（行内 note 元素） */
function rowSay(el, html, ok) {
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle("note-ok", ok === true);
  el.classList.toggle("note-warn", ok === false);
}

/* ---------------- ① 待审帖子 ---------------- */

function renderPending() {
  const box = document.getElementById("pend-list");
  const count = document.getElementById("pend-count");
  if (!box) return;
  const list = ALL_POSTS.filter((p) => p.status === "pending");
  count.textContent = list.length ? "共 " + list.length + " 条" : "";

  if (!list.length) {
    box.innerHTML = '<p class="mine-about">没有待审的帖子。</p>';
    return;
  }

  box.innerHTML = "";
  list.forEach((p) => {
    const el = document.createElement("article");
    el.className = "admin-row";
    el.innerHTML =
      statusTag(p.status) +
      '<span class="admin-row-title">' + escHtml(p.title) + "</span>" +
      '<span class="admin-row-meta">' + escHtml(p.author_name || "匿名") + " · " + fmtTime(p.created_at) + "</span>" +
      '<p class="admin-row-body">' + escHtml(p.body) + "</p>" +
      '<div class="admin-row-actions">' +
        '<button type="button" class="empty-jump" data-act="approve">通过</button>' +
        '<button type="button" class="admin-btn-ghost" data-act="reject">拒绝</button>' +
      "</div>" +
      '<div class="admin-reject-row" hidden>' +
        '<input type="text" class="compose-input" maxlength="60" placeholder="拒绝理由（可选，作者看得到）">' +
        '<button type="button" class="admin-btn-ghost" data-act="reject-confirm">确认拒绝</button>' +
      "</div>" +
      '<p class="compose-note" role="status"></p>';

    const note = el.querySelector(".compose-note");
    const rejRow = el.querySelector(".admin-reject-row");

    el.querySelector('[data-act="approve"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.setPostStatus(p.id, "approved");
        await loadAll();
      } catch (err) {
        btn.disabled = false;
        rowSay(note, escHtml(err.message || "操作失败。"), false);
      }
    });

    el.querySelector('[data-act="reject"]').addEventListener("click", () => {
      rejRow.hidden = !rejRow.hidden;
      if (!rejRow.hidden) rejRow.querySelector("input").focus();
    });

    el.querySelector('[data-act="reject-confirm"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.setPostStatus(p.id, "rejected", rejRow.querySelector("input").value.trim());
        await loadAll();
      } catch (err) {
        btn.disabled = false;
        rowSay(note, escHtml(err.message || "操作失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- ② 全部帖子（下架 / 删除 / 放回待审） ---------------- */

let postKeyword = "";

function renderAllPosts() {
  const box = document.getElementById("all-posts-list");
  const count = document.getElementById("posts-count");
  if (!box) return;
  count.textContent = "共 " + ALL_POSTS.length + " 条";

  const kw = postKeyword.trim();
  const list = kw
    ? ALL_POSTS.filter((p) => ((p.title || "") + (p.author_name || "")).indexOf(kw) !== -1)
    : ALL_POSTS;

  if (!list.length) {
    box.innerHTML = '<p class="mine-about">没有匹配的帖子。</p>';
    return;
  }

  box.innerHTML = "";
  list.forEach((p) => {
    const el = document.createElement("article");
    el.className = "admin-row";
    el.innerHTML =
      statusTag(p.status) +
      '<span class="admin-row-title">' + escHtml(p.title) + "</span>" +
      '<span class="admin-row-meta">' + escHtml(p.author_name || "匿名") + " · " + fmtTime(p.created_at) + "</span>" +
      '<div class="admin-row-actions">' +
        (p.status === "approved"
          ? '<button type="button" class="admin-btn-ghost" data-act="unpublish">下架（回待审）</button>'
          : '<button type="button" class="admin-btn-ghost" data-act="back-pending">放回待审</button>') +
        '<button type="button" class="admin-btn-danger" data-act="del">删除</button>' +
      "</div>" +
      '<p class="compose-note" role="status"></p>';

    const note = el.querySelector(".compose-note");

    const act = el.querySelector('[data-act="unpublish"], [data-act="back-pending"]');
    if (act) act.addEventListener("click", async (e) => {
      act.disabled = true;
      try {
        await api.setPostStatus(p.id, "pending");
        await loadAll();
      } catch (err) {
        act.disabled = false;
        rowSay(note, escHtml(err.message || "操作失败。"), false);
      }
    });

    el.querySelector('[data-act="del"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (!armDangerous(btn)) return;
      btn.disabled = true;
      try {
        await api.deletePost(p.id);
        await loadAll();
      } catch (err) {
        btn.disabled = false;
        rowSay(note, escHtml(err.message || "删除失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- ③ 辟谣榜条目 ---------------- */

let itemKeyword = "";

function renderItems() {
  const box = document.getElementById("items-list");
  const count = document.getElementById("items-count");
  if (!box) return;
  count.textContent = "共 " + ALL_ITEMS.length + " 条";

  const kw = itemKeyword.trim();
  const list = kw
    ? ALL_ITEMS.filter((it) => ((it.title || "") + (it.summary || "")).indexOf(kw) !== -1)
    : ALL_ITEMS;

  if (!list.length) {
    box.innerHTML = '<p class="mine-about">没有匹配的条目。</p>';
    return;
  }

  box.innerHTML = "";
  list.forEach((it) => {
    const el = document.createElement("div");
    el.className = "admin-row";
    el.innerHTML =
      verdictTag(it.verdict) +
      '<span class="admin-row-title">' + escHtml(it.title) + "</span>" +
      '<span class="admin-row-meta">' + escHtml(it.updated_at || "") + "</span>" +
      '<div class="admin-row-actions">' +
        '<button type="button" class="admin-btn-danger" data-act="del">删除</button>' +
      "</div>" +
      '<p class="compose-note" role="status"></p>';

    el.querySelector('[data-act="del"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (!armDangerous(btn)) return;
      btn.disabled = true;
      try {
        await api.deleteItem(it.id);
        ALL_ITEMS = ALL_ITEMS.filter((x) => x.id !== it.id);
        renderItems();
      } catch (err) {
        btn.disabled = false;
        rowSay(el.querySelector(".compose-note"), escHtml(err.message || "删除失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- ④ 线索收件箱 ---------------- */

function renderReports() {
  const box = document.getElementById("reports-list");
  const count = document.getElementById("reports-count");
  if (!box) return;
  count.textContent = "共 " + ALL_REPORTS.length + " 条";

  if (!ALL_REPORTS.length) {
    box.innerHTML = '<p class="mine-about">还没有收到线索。</p>';
    return;
  }

  box.innerHTML = "";
  ALL_REPORTS.forEach((r) => {
    const el = document.createElement("div");
    el.className = "admin-row";
    el.innerHTML =
      '<span class="admin-row-title admin-row-quote">' + escHtml(r.text) + "</span>" +
      '<span class="admin-row-meta">' +
        (r.author_id === "anon" ? "匿名" : "登录用户 " + String(r.author_id).slice(0, 8) + "…") +
        " · " + fmtTime(r.created_at) + "</span>" +
      '<div class="admin-row-actions">' +
        '<button type="button" class="admin-btn-danger" data-act="del">删除</button>' +
      "</div>" +
      '<p class="compose-note" role="status"></p>';

    el.querySelector('[data-act="del"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (!armDangerous(btn)) return;
      btn.disabled = true;
      try {
        await api.deleteReport(r.id);
        ALL_REPORTS = ALL_REPORTS.filter((x) => x.id !== r.id);
        renderReports();
      } catch (err) {
        btn.disabled = false;
        rowSay(el.querySelector(".compose-note"), escHtml(err.message || "删除失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- 启动与筛选绑定 ---------------- */

document.getElementById("post-search").addEventListener("input", (e) => {
  postKeyword = e.target.value;
  renderAllPosts();
});
document.getElementById("item-search").addEventListener("input", (e) => {
  itemKeyword = e.target.value;
  renderItems();
});

renderGate();

// 登录 / 退出 / 换人：闸门重新核对
auth.onChange(() => {
  renderGate();
});
