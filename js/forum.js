/* ============================================================
   forum.js — 论坛（F3）
     Day 19 建界面骨架（读本地样例帖 + 发帖暂存本机）
     Day 21 接后端：帖子读云库、发帖写云库（一律先进人工审核队列）

   论坛在本站的位置：工具查不到的消息，交给人来找线索。
   已删的短视频、私密群聊里的截图，恰恰是自动化工具够不着、最需要人工补位的地方。

   【Day 21 起，两件事不再由前端说了算】
     ① 「谁能看到哪条帖子」——由数据库策略 posts_read 决定：
        访客只拿到 approved；作者本人额外拿到自己那条 pending。
        所以本文件**不做 status 过滤**：前端再筛一次等于把安全逻辑放错地方。
     ② 「帖子能不能发出去」——由数据库策略 posts_insert_own 决定：
        只能插入「自己的 + 待审的」。客户端想直接发一条 approved 会被拒。
   前端这一层只负责：调接口、按四态渲染、把失败原因讲成人话。

   发帖需要身份：未登录时只给一个登录出口，不给能提交的表单
   （身份层在 js/auth.js，登录方式只有邮箱）。
   四态与全站一致：loading / 正常 / 空（零帖子与筛空是两套文案）/ 错误（带重试）。
   ============================================================ */

const POST_CATS = ["求助溯源", "已解决", "经验讨论"];
const CAT_ALL = "all";
const POST_STATUS = ["pending", "approved", "rejected"];
const NAME_KEY = "fx_forum_name";     // 记住上次填的昵称，纯粹为了少打一次字

let ALL_POSTS = [];              // 接口层返回的全部帖子（含我自己那条待审）
let POST_STATE = "loading";      // loading / ok / error（与首页数据状态机同构）
let forumCat = CAT_ALL;          // 当前分类
let forumKeyword = "";           // 当前关键词

/* 分类标签不做颜色区分：分类不是核查结论，不复用结论四色，
   三档靠文字分辨（C5 文案通道），样式统一走 .post-cat。 */

/* ---------------- 数据：加载 + 校验 ---------------- */

/**
 * 从接口层取帖子并校验。规矩与 data.js 对核查条目一致：
 * 缺必填字段或枚举非法的条目跳过、在控制台警告，其余照常渲染。
 * 这里**不过滤 status** —— 过滤在数据库的 RLS 里，见文件头注释。
 */
async function loadVerifiedPosts() {
  const list = await api.getPosts();
  const good = [];

  (Array.isArray(list) ? list : []).forEach((post, i) => {
    const problems = [];
    if (!post.id) problems.push("缺 id");
    if (!post.title) problems.push("缺 title");
    if (!post.body) problems.push("缺 body");
    if (POST_CATS.indexOf(post.category) === -1) problems.push("category 非法：" + post.category);
    if (POST_STATUS.indexOf(post.status) === -1) problems.push("status 非法：" + post.status);
    if (!post.created_at) problems.push("缺 created_at");

    if (problems.length) {
      console.warn("[forum] 第 " + (i + 1) + " 条帖子被跳过（" + problems.join("；") + "）", post);
    } else {
      good.push(post);
    }
  });

  return good;
}

/** 演示开关与 data.js 同一套（?demo=loading|empty|error），方便验收三种非正常状态 */
async function loadPostsForPage() {
  const demo = readDemoState();
  if (demo === "error") throw new Error("演示：强制加载失败（?demo=error）");
  if (demo === "empty") return [];
  if (demo === "loading") await new Promise((r) => setTimeout(r, 60000));
  return loadVerifiedPosts();
}

/** 数据库给的是完整时间戳，列表上只显示到日（与核查条目同一口径） */
function fmtPostDate(v) {
  const s = String(v || "");
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** 按审核状态分组：已通过的给所有人看；待审的只可能是「我自己的」（RLS 保证） */
function splitByStatus() {
  return {
    approved: ALL_POSTS.filter((p) => p.status === "approved"),
    minePending: ALL_POSTS.filter((p) => p.status === "pending"),
  };
}

/* ---------------- 渲染 ---------------- */

/** 装饰 D6：页头徽卡。未登录只给「已通过」；登录后多一格「我的待审」 */
function renderForumStats() {
  const el = document.getElementById("forum-stats");
  if (!el) return;
  if (POST_STATE !== "ok") { el.innerHTML = ""; return; }

  const g = splitByStatus();
  let html = '<div class="stat-card"><span class="stat-num">' + g.approved.length + '</span>' +
    '<span class="stat-label">已通过</span></div>';

  if (auth.isSignedIn()) {
    html += '<div class="stat-card"><span class="stat-num">' + g.minePending.length + '</span>' +
      '<span class="stat-label">我的待审</span></div>';
  }
  el.innerHTML = html;
}

/** 渲染一条帖子；isPending = true 时加「审核中」标记（只有作者本人看得到） */
function renderPost(post, index, isPending) {
  const el = document.createElement("article");
  el.className = "post-card pop" + (isPending ? " post-pending" : "");
  el.dataset.cat = post.category;
  el.style.animationDelay = (index * 0.05) + "s";

  // 关联核查：只有该条目确实在站内数据里时才给链接 —— 数据换了也不留死链
  const rel = ALL_ITEMS.find((x) => x.id === post.item_id);
  const relHtml = rel
    ? '<p class="post-rel">相关核查：<a href="detail.html?id=' + encodeURIComponent(rel.id) + '">' +
      escHtml(rel.title) + "</a></p>"
    : "";

  el.innerHTML =
    '<div class="post-top">' +
      '<span class="post-cat" data-cat="' + escHtml(post.category) + '">' + escHtml(post.category) + "</span>" +
      (isPending ? '<span class="post-review">审核中</span>' : "") +
      (post.replies
        ? '<span class="post-replies">' + post.replies + " 条回复</span>"
        : '<span class="post-replies">还没有回复</span>') +
      '<span class="post-date">' + escHtml(fmtPostDate(post.created_at)) + "</span>" +
    "</div>" +
    '<h3 class="post-title">' + escHtml(post.title) + "</h3>" +
    '<p class="post-body">' + escHtml(post.body) + "</p>" +
    '<p class="post-meta">发起人：' + escHtml(post.author_name || "匿名") + "</p>" +
    (isPending ? '<p class="post-pending-note">这条还在人工审核队列里，只有你自己看得到；通过后才会出现在上面的公开列表中。</p>' : "") +
    relHtml;
  return el;
}

/** 计数文案（aria-live 播报；count = null 表示数据没就绪） */
function updateForumSummary(count) {
  const el = document.getElementById("forum-summary");
  if (!el) return;

  if (count === null) {
    el.textContent = POST_STATE === "loading" ? "正在加载帖子…" : "帖子列表未就绪";
    return;
  }

  const parts = [];
  if (forumCat !== CAT_ALL) parts.push("「" + forumCat + "」");
  const kw = forumKeyword.trim();
  if (kw) parts.push("关键词「" + kw + "」");

  el.textContent = (parts.length ? "筛选 " + parts.join(" + ") : "已通过审核") + "：共 " + count + " 条";
}

/** 论坛列表渲染总入口：数据就绪 / 切视图 / 筛选变化 / 登录状态变化时统一重绘 */
function renderForumView() {
  renderForumStats();

  const box = document.getElementById("forum-list");
  if (!box) return;

  // ① 加载中 / ② 错误：沿用全站统一状态与重试出口
  if (POST_STATE !== "ok") {
    if (POST_STATE === "loading") {
      renderListState(box, "loading");
    } else {
      renderListState(box, "error", {
        desc: "帖子列表没读到，可能是网络抖动。可以重试，或先去辟谣榜看看。",
        onRetry: initForumData,
      });
    }
    updateForumSummary(null);
    return;
  }

  const g = splitByStatus();

  // ③ 零数据态（论坛里一条帖子都没有）：与「筛空」文案必须不同，且给出路
  if (!g.approved.length && !g.minePending.length) {
    updateForumSummary(0);
    renderListState(box, "empty", {
      text: "论坛还没有帖子。第一条求助就等你了。",
      action: "先去看辟谣榜",
      actionHref: "index.html#/board",
    });
    return;
  }

  // ④ 正常态：待审的排在前面（提醒作者它在排队），再是公开列表；两组一起过筛选
  let list = g.minePending.concat(g.approved);
  if (forumCat !== CAT_ALL) list = list.filter((p) => p.category === forumCat);
  const kw = forumKeyword.trim();
  if (kw) list = list.filter((p) => (p.title + p.body).indexOf(kw) !== -1);

  updateForumSummary(list.length);

  // ⑤ 筛空：两种成因给两种出口，不留死胡同
  if (!list.length) {
    if (kw) {
      const hasCat = forumCat !== CAT_ALL;
      renderListState(box, "empty", {
        text: "没有找到相关内容",
        action: hasCat ? "清空全部筛选" : "清空关键词",
        actionId: "forum-clear",
        onAction: () => {
          forumKeyword = "";
          const s = document.getElementById("forum-search");
          if (s) s.value = "";
          if (hasCat) { applyForumCat(CAT_ALL); return; }
          renderForumView();
        },
      });
      return;
    }
    renderListState(box, "empty", {
      text: "「" + forumCat + "」这个分类下还没有帖子。",
      action: "显示全部",
      actionId: "forum-cat-reset",
      onAction: () => applyForumCat(CAT_ALL),
    });
    return;
  }

  box.innerHTML = "";
  list.forEach((p, i) => box.appendChild(renderPost(p, i, p.status === "pending")));
}

/** 应用分类筛选：切高亮、同步无障碍状态、重渲染 */
function applyForumCat(cat) {
  forumCat = POST_CATS.indexOf(cat) !== -1 ? cat : CAT_ALL;
  document.querySelectorAll("#forum-cats .chip").forEach((chip) => {
    const on = chip.dataset.cat === forumCat;
    chip.classList.toggle("active", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderForumView();
}

/* ---------------- 发帖（需登录 · 写云库 · 先进审核队列） ---------------- */

/** 按登录状态切换发帖区：未登录给登录出口，已登录给表单 */
function renderCompose() {
  const guest = document.getElementById("compose-guest");
  const form = document.getElementById("compose-form");
  if (!guest || !form) return;

  const signed = auth.isSignedIn();
  guest.hidden = signed;
  form.hidden = !signed;

  const who = document.getElementById("compose-who");
  if (who) {
    const email = auth.session && auth.session.user ? auth.session.user.email : "";
    who.textContent = email ? "已登录：" + maskEmail(email) : "已登录";
  }
}

function composeSay(html, ok) {
  const note = document.getElementById("compose-note");
  if (!note) return;
  note.innerHTML = html;
  note.classList.toggle("note-ok", ok === true);
  note.classList.toggle("note-warn", ok === false);
}

/** 提交前的前端校验：长度规则与数据库 CHECK 一致，早失败早提示（真正的把关仍在数据库） */
function validateCompose(v) {
  if (!v.name) return "填一个称呼吧，会显示在帖子上。";
  if (v.title.length < 4) return "标题太短了，至少 4 个字，说清你要问什么。";
  if (v.title.length > 60) return "标题太长了，60 字以内。";
  if (v.body.length < 10) return "内容太短了，至少 10 个字：在哪看到的、原文怎么说的。";
  if (v.body.length > 1000) return "内容太长了，1000 字以内。";
  return "";
}

async function submitCompose(e) {
  e.preventDefault();

  const nameEl = document.getElementById("compose-name");
  const titleEl = document.getElementById("compose-title");
  const catEl = document.getElementById("compose-cat");
  const bodyEl = document.getElementById("compose-body");
  const btn = document.getElementById("compose-submit");
  if (!nameEl || !titleEl || !catEl || !bodyEl || !btn) return;

  const v = {
    name: nameEl.value.trim(),
    title: titleEl.value.trim(),
    cat: catEl.value,
    body: bodyEl.value.trim(),
  };

  const bad = validateCompose(v);
  if (bad) { composeSay(bad, false); return; }

  const idle = btn.textContent;
  btn.disabled = true;
  btn.textContent = "提交中…";
  composeSay("");

  try {
    // 身份兜底：会话过期时这里会重新弹登录框，登完再继续
    const ok = await auth.require("发帖需要一个身份（帖子得有人负责）。");
    if (!ok) {
      composeSay("要发帖得先登录。登录只需要邮箱收一个验证码。", false);
      return;
    }

    await api.createPost({
      category: v.cat,
      title: v.title,
      body: v.body,
      authorName: v.name,
    });

    localStorage.setItem(NAME_KEY, v.name);
    titleEl.value = "";
    bodyEl.value = "";
    composeSay("已提交，进入人工审核队列。通过后会出现在上面的列表里" +
      "（在那之前只有你自己看得到它）。", true);
    await refreshPosts();          // 把「我的待审」拉出来给作者看见
  } catch (err) {
    composeSay(escHtml(err.message || "提交失败，请重试。"), false);
  } finally {
    btn.disabled = false;
    btn.textContent = idle;
  }
}

/** 绑定论坛页全部交互（筛选、关键词、发帖、登录状态联动） */
function initForumUI() {
  const cats = document.getElementById("forum-cats");
  if (cats) {
    cats.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-cat]");
      if (chip) applyForumCat(chip.dataset.cat);
    });
  }

  const search = document.getElementById("forum-search");
  if (search) {
    search.addEventListener("input", (e) => {
      forumKeyword = e.target.value;
      renderForumView();
    });
  }

  // 未登录时的登录出口
  const signin = document.getElementById("compose-signin");
  if (signin) {
    signin.addEventListener("click", () => {
      auth.openLogin("发帖需要一个身份（帖子得有人负责）。");
    });
  }

  const form = document.getElementById("compose-form");
  if (form) form.addEventListener("submit", submitCompose);

  const nameEl = document.getElementById("compose-name");
  if (nameEl) nameEl.value = localStorage.getItem(NAME_KEY) || "";

  // 登录 / 退出后：发帖区与徽卡都要跟着变，列表也可能多出「我的待审」
  auth.onChange(async () => {
    renderCompose();
    await refreshPosts();
  });

  renderCompose();
}

/** 数据入口：加载帖子 → 落到 ok / error → 渲染 */
async function initForumData() {
  POST_STATE = "loading";
  renderForumView();

  try {
    ALL_POSTS = await loadPostsForPage();
    POST_STATE = "ok";
  } catch (err) {
    console.error("[forum] 帖子加载失败：", err);
    POST_STATE = "error";
  }

  renderForumView();
}

/** 重新拉一次帖子（发帖成功、登录状态变化后调用）。失败不打断当前界面。 */
async function refreshPosts() {
  try {
    ALL_POSTS = await loadVerifiedPosts();
    POST_STATE = "ok";
  } catch (err) {
    console.error("[forum] 帖子刷新失败：", err);
    return;
  }
  renderForumView();
  renderCompose();
}

/* 注册进首页的视图渲染表（home.js 定义）：切视图 / 核查数据就绪时统一重绘
   —— 帖子里的「相关核查」链接要等 items 就绪才能补上，这条注册是它的保障。 */
VIEW_RENDERERS.push(renderForumView);

initForumUI();
initForumData();
