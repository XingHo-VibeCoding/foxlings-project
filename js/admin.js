/* ============================================================
   admin.js — 管理后台（Day 23 建 · Day 24 加公告管理、删除改为真删）

   【权限模型，一句话】页面只负责「少让不该进来的人看到界面」，
   真正的闸门是数据库：
     · admins 表（RLS：本人只能读到自己那行）→ auth.isAdmin()；
     · *_admin_* 策略：posts 读/改/删、reports 读/删、items 删、announcements 增/改/删。
   就算有人改前端把界面解开，每个写请求还是会被 RLS 拒。

   【删除是不可逆的】Day 24 撤掉了软删除（站方决定：不留堆着用不上的数据）。
   所以这里每个删除按钮都走**两击确认**：第一次点变成「确认删除？」，
   3 秒内再点才真执行 —— 不用系统 confirm 弹窗（丑且打断），也不许一键误删。
   回收站没了之后，这道确认就是唯一的刹车，不能省。

   【公告】社区规则与站方通知都在这里发。发出去的内容显示在论坛页顶部的公告栏
   （多条时自动轮播）。文案存在数据库里，改一次全站生效，不用改代码、不用重新发版。
   ============================================================ */

let ALL_POSTS = [];
let ALL_REPORTS = [];
let ALL_ITEMS = [];
let ALL_ANNOUNCEMENTS = [];
let editingAnnId = null;      // 非 null 时，公告表单处于「改一条」状态

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
    if (body) body.hidden = true;
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
    if (body) body.hidden = true;
    box.innerHTML =
      '<p class="mine-about">这个账号没有管理权限。如果你应该是管理员，' +
      "让站方把你的账号加进 admins 名单。</p>";
    return;
  }

  box.innerHTML = '<p class="mine-about">身份核对通过。</p>';
  if (body) body.hidden = false;
  await loadAll();
}

/* ---------------- 数据装载 ---------------- */

async function loadAll() {
  // 每块各自兜底：一块读不到不该拖垮另外几块（比如会话恰好过期的那一瞬间）
  const safe = async (label, fn, fallback) => {
    try { return await fn(); }
    catch (err) { console.error("[admin] " + label + "失败：", err); return fallback; }
  };

  ALL_POSTS = await safe("帖子读取", () => api.listAllPosts(), []);
  ALL_REPORTS = await safe("线索读取", () => api.listAllReports(), []);
  // Day 24：条目没有「已回收」这回事了，管理读就是普通读（api.getItems），
  // 排序在这里补 —— 后台列表的顺序要稳定可预期（新的在前）
  ALL_ITEMS = await safe("条目读取", () => api.getItems(), []);
  ALL_ITEMS.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  ALL_ANNOUNCEMENTS = await safe("公告读取", () => api.listAllAnnouncements(), []);

  renderPending();
  renderAllPosts();
  renderItems();
  renderReports();
  renderAnnouncements();
}

/* ---------------- 操作回执 ---------------- */

/* 「删除到底成功没有？」——软删除那会儿，删完列表里那行还在（挂着「已回收」），
   用户看不出发生了什么，怀疑按钮坏了（Day 22 的真实反馈）。
   现在真删，行会直接消失，本来已经是最好的回执；但列表长的时候消失也可能被错过，
   所以再补一句明说的：顶部一条 role=status 的提示，几秒后自己淡出。 */
let flashTimer = null;
function adminFlash(html, ok) {
  const el = document.getElementById("admin-flash");
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
  el.classList.toggle("note-ok", ok === true);
  el.classList.toggle("note-warn", ok === false);
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.hidden = true; el.innerHTML = ""; }, 7000);
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
 * 两击确认：第一次点把按钮换成「确认删除？」并聚焦，3 秒内再点才真正执行。
 * 返回 true 表示这次要点真格的了。
 * confirmText 可传具体文案（默认「确认？」）—— 删除不可逆，把话说满一点。
 */
function armDangerous(btn, confirmText) {
  if (btn.dataset.armed === "1") {
    // 这次是真执行：先把按钮恢复原样，失败时要重走确认
    btn.dataset.armed = "";
    btn.textContent = btn.dataset.idle || btn.textContent;
    btn.classList.remove("btn-armed");
    return true;
  }
  btn.dataset.armed = "1";
  btn.dataset.idle = btn.textContent;
  btn.textContent = confirmText || "确认？";
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
        adminFlash("已通过《" + escHtml(p.title) + "》，它现在出现在公开列表里了。", true);
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
        adminFlash("已拒绝《" + escHtml(p.title) + "》，作者能看到驳回原因。", true);
        await loadAll();
      } catch (err) {
        btn.disabled = false;
        rowSay(note, escHtml(err.message || "操作失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- ② 全部帖子（下架 / 删除） ---------------- */

let postKeyword = "";

function renderAllPosts() {
  const box = document.getElementById("all-posts-list");
  const count = document.getElementById("posts-count");
  if (!box) return;

  const kw = postKeyword.trim();
  const list = kw
    ? ALL_POSTS.filter((p) => ((p.title || "") + (p.author_name || "")).indexOf(kw) !== -1)
    : ALL_POSTS;

  count.textContent = "共 " + ALL_POSTS.length + " 条";
  if (kw && list.length !== ALL_POSTS.length) count.textContent += "（筛出 " + list.length + " 条）";

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
    if (act) act.addEventListener("click", async () => {
      act.disabled = true;
      try {
        await api.setPostStatus(p.id, "pending");
        await loadAll();
      } catch (err) {
        act.disabled = false;
        rowSay(note, escHtml(err.message || "操作失败。"), false);
      }
    });

    const delBtn = el.querySelector('[data-act="del"]');
    if (delBtn) delBtn.addEventListener("click", async () => {
      if (!armDangerous(delBtn, "确认删除？")) return;
      delBtn.disabled = true;
      try {
        await api.deletePost(p.id);
        adminFlash("已删除《" + escHtml(p.title) + "》—— 真删，数据库里已经没有了。", true);
        await loadAll();   // 重载把这一行摘掉：行消失本身就是「删掉了」的证据
      } catch (err) {
        delBtn.disabled = false;
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
      '<span class="admin-row-meta">' + escHtml(it.updated_at || "") +
        (it.views ? " · 浏览 " + it.views + " 次" : "") + "</span>" +
      '<div class="admin-row-actions">' +
        '<button type="button" class="admin-btn-danger" data-act="del">删除</button>' +
      "</div>" +
      '<p class="compose-note" role="status"></p>';

    const delBtn = el.querySelector('[data-act="del"]');
    if (delBtn) delBtn.addEventListener("click", async () => {
      if (!armDangerous(delBtn, "确认删除？")) return;
      delBtn.disabled = true;
      try {
        await api.deleteItem(it.id);
        adminFlash("已删除条目《" + escHtml(it.title) + "》—— 真删，数据库里已经没有了。" +
          "（底稿还在 data/data.json，真要恢复得由站方重新灌一次。）", true);
        await loadAll();
      } catch (err) {
        delBtn.disabled = false;
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

    const reportDel = el.querySelector('[data-act="del"]');
    if (reportDel) reportDel.addEventListener("click", async () => {
      if (!armDangerous(reportDel, "确认删除？")) return;
      reportDel.disabled = true;
      try {
        await api.deleteReport(r.id);
        adminFlash("已删除这条线索 —— 真删，数据库里已经没有了。", true);
        await loadAll();
      } catch (err) {
        reportDel.disabled = false;
        rowSay(el.querySelector(".compose-note"), escHtml(err.message || "删除失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- ⑤ 站方公告（Day 24） ---------------- */

/** 公告表单的五个节点；缺任何一个都说明 HTML 与脚本对不上，直接抛错（别静默） */
function annFields() {
  return {
    title: document.getElementById("ann-title"),
    body: document.getElementById("ann-body"),
    order: document.getElementById("ann-order"),
    pinned: document.getElementById("ann-pinned"),
    submit: document.getElementById("ann-submit"),
    cancel: document.getElementById("ann-cancel"),
  };
}

function annSay(html, ok) {
  const note = document.getElementById("ann-note");
  if (!note) return;
  note.innerHTML = html;
  note.classList.toggle("note-ok", ok === true);
  note.classList.toggle("note-warn", ok === false);
}

/** 表单回到「发一条新的」状态 */
function resetAnnForm() {
  editingAnnId = null;
  const f = annFields();
  if (!f.title) return;
  f.title.value = "";
  f.body.value = "";
  f.order.value = "0";
  f.pinned.checked = true;
  f.submit.textContent = "发布公告";
  f.cancel.hidden = true;
  annSay("");
  renderAnnouncements();
}

/** 把某条公告读进表单，进入编辑态 */
function startEditAnn(a) {
  editingAnnId = a.id;
  const f = annFields();
  if (!f.title) return;
  f.title.value = a.title || "";
  f.body.value = a.body || "";
  f.order.value = String(Number(a.sort_order) || 0);
  f.pinned.checked = a.is_pinned !== false;
  f.submit.textContent = "保存修改";
  f.cancel.hidden = false;
  annSay("正在编辑第 " + a.id + " 条公告 —— 改完点「保存修改」。", true);
  f.title.focus();
  renderAnnouncements();
}

/** 提交表单：新建与编辑走同一个入口，靠 editingAnnId 分流 */
async function submitAnnForm(e) {
  e.preventDefault();
  const f = annFields();
  if (!f.title) return;

  const title = f.title.value.trim();
  const body = f.body.value.trim();
  const sortOrder = Number(f.order.value) || 0;
  const isPinned = f.pinned.checked;

  // 前端先照数据库的 CHECK 校验一遍，图个早提示（真正的把关仍在数据库）
  if (title.length < 2 || title.length > 60) { annSay("标题要在 2–60 字之间。", false); return; }
  if (body.length < 1 || body.length > 2000) { annSay("正文要在 1–2000 字之间。", false); return; }

  const btn = f.submit;
  const idle = btn.textContent;
  btn.disabled = true;
  btn.textContent = "保存中…";

  try {
    if (editingAnnId) {
      await api.updateAnnouncement(editingAnnId, { title, body, sortOrder, isPinned });
      adminFlash("公告《" + escHtml(title) + "》已更新，论坛页立刻生效。", true);
    } else {
      await api.createAnnouncement({ title, body, sortOrder, isPinned });
      adminFlash("公告《" + escHtml(title) + "》已" + (isPinned ? "发布，论坛顶部立刻能看到。" : "存稿，前台暂时看不到。"), true);
    }
    resetAnnForm();
    await loadAll();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = idle;
    annSay(escHtml(err.message || "保存失败。"), false);
  }
}

function renderAnnouncements() {
  const box = document.getElementById("ann-list");
  const count = document.getElementById("ann-count");
  if (!box) return;

  const shown = ALL_ANNOUNCEMENTS.filter((a) => a.is_pinned !== false).length;
  count.textContent = ALL_ANNOUNCEMENTS.length
    ? "共 " + ALL_ANNOUNCEMENTS.length + " 条（已公布 " + shown + " 条）"
    : "";

  if (!ALL_ANNOUNCEMENTS.length) {
    box.innerHTML = '<p class="mine-about">还没有公告。发第一条吧——社区规则放这里最合适，' +
      "它会出现在论坛页顶部的公告栏里。</p>";
    return;
  }

  box.innerHTML = "";
  ALL_ANNOUNCEMENTS.forEach((a) => {
    const hidden = a.is_pinned === false;
    const el = document.createElement("article");
    el.className = "admin-row" + (editingAnnId === a.id ? " admin-row-editing" : "");
    el.innerHTML =
      (hidden ? '<span class="tag tag-draft">未公布</span>' : '<span class="tag tag-true">已公布</span>') +
      '<span class="admin-row-title">' + escHtml(a.title) + "</span>" +
      '<span class="admin-row-meta">权重 ' + Number(a.sort_order || 0) + " · " + fmtTime(a.created_at) +
        (editingAnnId === a.id ? " · 正在编辑" : "") + "</span>" +
      '<p class="admin-row-body admin-row-quote">' + escHtml(a.body) + "</p>" +
      '<div class="admin-row-actions">' +
        '<button type="button" class="admin-btn-ghost" data-act="edit">编辑</button>' +
        '<button type="button" class="admin-btn-ghost" data-act="toggle">' +
          (hidden ? "公布它" : "撤下") + "</button>" +
        '<button type="button" class="admin-btn-danger" data-act="del">删除</button>' +
      "</div>" +
      '<p class="compose-note" role="status"></p>';

    const note = el.querySelector(".compose-note");

    el.querySelector('[data-act="edit"]').addEventListener("click", () => startEditAnn(a));

    // 「公布 / 撤下」是可逆操作，不设两击确认
    el.querySelector('[data-act="toggle"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.updateAnnouncement(a.id, { isPinned: hidden });
        adminFlash("公告《" + escHtml(a.title) + "》" +
          (hidden ? "已公布，论坛顶部立刻能看到。" : "已撤下，前台暂时看不到了（内容还在）。"), true);
        await loadAll();
      } catch (err) {
        btn.disabled = false;
        rowSay(note, escHtml(err.message || "操作失败。"), false);
      }
    });

    const delBtn = el.querySelector('[data-act="del"]');
    delBtn.addEventListener("click", async () => {
      if (!armDangerous(delBtn, "确认删除？")) return;
      delBtn.disabled = true;
      try {
        await api.deleteAnnouncement(a.id);
        if (editingAnnId === a.id) resetAnnForm();
        adminFlash("已删除公告《" + escHtml(a.title) + "》—— 真删，数据库里已经没有了。", true);
        await loadAll();
      } catch (err) {
        delBtn.disabled = false;
        rowSay(note, escHtml(err.message || "删除失败。"), false);
      }
    });

    box.appendChild(el);
  });
}

/* ---------------- 启动与筛选绑定 ---------------- */

/* 绑定一律走这层壳：元素缺了就报错到控制台，而不是静默什么都不做。
   （Day 22 的教训：脚本与 HTML 对不上时，界面表现是「点了没反应」，
     而且控制台一声不响 —— 那种 bug 最难查。） */
function bind(id, ev, fn) {
  const el = document.getElementById(id);
  if (!el) {
    console.error("[admin] 界面元素缺失：#" + id + "（HTML 与脚本对不上了）");
    return;
  }
  el.addEventListener(ev, fn);
}

bind("post-search", "input", (e) => { postKeyword = e.target.value; renderAllPosts(); });
bind("item-search", "input", (e) => { itemKeyword = e.target.value; renderItems(); });
bind("ann-form", "submit", submitAnnForm);
bind("ann-cancel", "click", resetAnnForm);

renderGate();

// 登录 / 退出 / 换人：闸门重新核对
auth.onChange(() => {
  renderGate();
});
