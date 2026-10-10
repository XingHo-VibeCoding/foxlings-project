/* ============================================================
   forum.js — 论坛（F3）
     Day 19 建界面骨架（读本地样例帖 + 发帖暂存本机）
     Day 21 接后端：帖子读云库、发帖写云库（一律先进人工审核队列）
     Day 24 加站方公告栏：内容存云库（announcements 表），管理员在后台发布，多条自动轮播

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
    '<p class="post-meta">' + avatarHtml(post.author_id, post.author_name, "fx-avatar-xs") +
      '<span class="post-meta-name">发起人：' + escHtml(post.author_name || "匿名") + "</span></p>" +
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

  if (signed) fillComposeName();
}

/**
 * 发帖区的昵称：优先用「我的资料」里的昵称（省得每次重填），
 * 已经填了就不覆盖 —— 用户手改到一半时把内容冲掉比不预填更讨厌。
 */
function fillComposeName() {
  const el = document.getElementById("compose-name");
  if (!el || el.value.trim()) return;
  const me = myProfile();
  el.value = (me && me.nickname) || localStorage.getItem(NAME_KEY) || "";
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

/**
 * 取发帖表单的五个节点。缺任何一个都说明界面结构坏了。
 * Day 22 教训：这里原本是 `if (!x) return;` —— 一旦 HTML 与脚本对不上，
 * 提交就成了「点下去毫无反应」，而且控制台一声不响，最难查。
 * 现在改成抛错，由下面的 catch 统一变成用户看得见的一句话。
 */
function composeFields() {
  const f = {
    name: document.getElementById("compose-name"),
    title: document.getElementById("compose-title"),
    cat: document.getElementById("compose-cat"),
    body: document.getElementById("compose-body"),
    btn: document.getElementById("compose-submit"),
  };
  const missing = Object.keys(f).filter((k) => !f[k]);
  if (missing.length) {
    throw new Error("发帖表单结构异常（缺少 " + missing.join(" / ") + "），请刷新页面后重试。");
  }
  return f;
}

async function submitCompose(e) {
  e.preventDefault();

  // 按钮先进入忙态：无论后面哪一步出错，用户都知道「点了，正在处理」
  const btn = document.getElementById("compose-submit");
  const idle = btn ? btn.textContent : "提交审核";
  if (btn) { btn.disabled = true; btn.textContent = "提交中…"; }

  try {
    const f = composeFields();
    const v = {
      name: f.name.value.trim(),
      title: f.title.value.trim(),
      cat: f.cat.value,
      body: f.body.value.trim(),
    };

    const bad = validateCompose(v);
    if (bad) { composeSay(bad, false); return; }
    composeSay("");

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
    f.title.value = "";
    f.body.value = "";
    composeSay("已提交，进入人工审核队列。通过后会出现在上面的列表里" +
      "（在那之前只有你自己看得到它）。", true);
    await refreshPosts();          // 把「我的待审」拉出来给作者看见
  } catch (err) {
    // 任何异常都要变成用户看得见的一句话：静默失败是最难查的 bug
    console.error("[forum] 发帖失败：", err);
    composeSay(escHtml(err.message || "提交失败，请重试。"), false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = idle; }
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

  // 昵称不在这里预填：资料是异步取回来的，等 renderCompose 在资料就绪后再填
  // （fillComposeName 只在输入框为空时动手，不会冲掉用户已经打的字）

  // 登录 / 退出后：发帖区与徽卡都要跟着变，列表也可能多出「我的待审」
  auth.onChange(async () => {
    resetProfileCache();   // 换人了：资料与头像签名一律作废
    renderCompose();
    await refreshPosts();
  });

  renderCompose();
}

/** 数据入口：加载帖子 → 落到 ok / error → 渲染 */
async function initForumData() {
  POST_STATE = "loading";
  renderForumView();

  // 公告与帖子并行取，但**不等它**：公告是附属信息，读到就画，读不到整块收起来，
  // 绝不因为它把帖子列表拖成错误态（loadNotices 自己兜底，不会抛）。
  loadNotices();

  try {
    // 帖子与资料一起等：头像要等资料（含签名 URL）就绪再画，
    // 否则会先渲染一批色块、再整屏重画一次，闪得很难看
    ALL_POSTS = (await Promise.all([loadPostsForPage(), ensureProfiles()]))[0];
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
    // 资料也要重取：换了头像/昵称后，这里得跟着变
    ALL_POSTS = (await Promise.all([loadVerifiedPosts(), ensureProfiles()]))[0];
    POST_STATE = "ok";
  } catch (err) {
    console.error("[forum] 帖子刷新失败：", err);
    return;
  }
  renderForumView();
  renderCompose();
}

/* ---------------- 站方公告栏（Day 24） ----------------

   内容来自云库 announcements 表，由管理员在后台发布 —— 前端只负责显示与轮播，
   一个字都不判断内容。改一句社区规则不用改代码、不用重新发版。

   轮播的三条分寸：
     · **只有一条时不转**，也不显示切换控件（没得切，控件只会碍眼）；
     · 多条时自动转，但鼠标停进去 / 键盘焦点落进来就暂停 —— 正在读的那条不该被抢走；
     · 用户自己切过之后重新计时（刚点完立刻又被自动跳走，是最烦人的那种）。
   还有一条是给屏幕阅读器的：自动轮播**不播报**（每隔几秒打断一次根本没法用），
   只有用户主动切换时，才往 #notice-live 里写一句。

   为什么这里不怕「公告条数是活的」：渲染的就是「当时读到几条就几条」，
   没有任何写死的基准 —— 后台加一条，刷新页面就多一条。 */

const NOTICE_INTERVAL_MS = 6000;   // 自动轮播间隔：读得完一条的时间，不给太快

let NOTICES = [];
let noticeIndex = 0;
let noticeTimer = null;

/** 一条公告 → 一张牌 */
function renderNoticeItem(a, i) {
  const el = document.createElement("article");
  el.className = "notice-item";
  el.setAttribute("role", "group");
  el.setAttribute("aria-roledescription", "公告");
  el.setAttribute("aria-label", (i + 1) + " / " + NOTICES.length + "：" + (a.title || "站方公告"));
  el.innerHTML =
    '<h4 class="notice-item-title">' + escHtml(a.title || "") + "</h4>" +
    '<p class="notice-item-body">' + escHtml(a.body || "") + "</p>";
  return el;
}

/** 视窗高度跟着当前那条走：公告长短不一时，下面不留一大块空白 */
function syncNoticeHeight() {
  const vp = document.getElementById("notice-viewport");
  const track = document.getElementById("notice-track");
  if (!vp || !track || !track.children[noticeIndex]) return;
  vp.style.height = track.children[noticeIndex].offsetHeight + "px";
}

/** 把轨道移到第 index 条（越界自动环绕）。announce = true 时才播报给屏幕阅读器 */
function showNotice(index, announce) {
  const track = document.getElementById("notice-track");
  if (!track || !NOTICES.length) return;

  noticeIndex = (index + NOTICES.length) % NOTICES.length;
  track.style.transform = "translateX(-" + (noticeIndex * 100) + "%)";

  const pos = document.getElementById("notice-pos");
  if (pos) pos.textContent = (noticeIndex + 1) + " / " + NOTICES.length;

  syncNoticeHeight();

  if (announce) {
    const live = document.getElementById("notice-live");
    const cur = NOTICES[noticeIndex];
    if (live && cur) {
      live.textContent = "第 " + (noticeIndex + 1) + " 条，共 " + NOTICES.length + " 条：" + (cur.title || "");
    }
  }
}

function stepNotice(dir, byUser) {
  showNotice(noticeIndex + dir, byUser);
  if (byUser) restartNoticeTimer();   // 用户刚切过：重新计时，别马上又被自动跳走
}

function stopNoticeTimer() {
  if (noticeTimer) { clearInterval(noticeTimer); noticeTimer = null; }
}

function restartNoticeTimer() {
  stopNoticeTimer();
  if (NOTICES.length < 2) return;   // 只有一条：定住不动
  // 用户系统里开了「减少动效」就不自动转 —— 手动切换照样能用
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  noticeTimer = setInterval(() => stepNotice(1, false), NOTICE_INTERVAL_MS);
}

function renderNotices() {
  const bar = document.getElementById("notice-bar");
  const track = document.getElementById("notice-track");
  const nav = document.getElementById("notice-nav");
  if (!bar || !track) return;

  // 一条公告都没有：整块收起来，不留一个空框在那儿
  if (!NOTICES.length) {
    bar.hidden = true;
    stopNoticeTimer();
    return;
  }

  bar.hidden = false;
  track.innerHTML = "";
  NOTICES.forEach((a, i) => track.appendChild(renderNoticeItem(a, i)));

  // 切换控件「有的切」时才出现
  if (nav) nav.hidden = NOTICES.length < 2;

  noticeIndex = 0;
  showNotice(0, false);
  restartNoticeTimer();
}

/** 读公告并渲染。失败只记一笔、把整块收起来 —— 公告读不到不该让论坛整页变错误态 */
async function loadNotices() {
  try {
    NOTICES = await api.listAnnouncements();
  } catch (err) {
    console.error("[forum] 公告读取失败（整块收起，不影响帖子）：", err);
    NOTICES = [];
  }
  renderNotices();
}

function initNoticeUI() {
  const prev = document.getElementById("notice-prev");
  const next = document.getElementById("notice-next");
  if (prev) prev.addEventListener("click", () => stepNotice(-1, true));
  if (next) next.addEventListener("click", () => stepNotice(1, true));

  const bar = document.getElementById("notice-bar");
  if (bar) {
    // 鼠标停进来 / 键盘焦点落进来 = 正在读，暂停；离开再接着转
    bar.addEventListener("mouseenter", stopNoticeTimer);
    bar.addEventListener("mouseleave", restartNoticeTimer);
    bar.addEventListener("focusin", stopNoticeTimer);
    bar.addEventListener("focusout", restartNoticeTimer);
  }

  // 切到别的标签页时不必偷偷转，回来接着转
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopNoticeTimer();
    else restartNoticeTimer();
  });

  // 换行 / 缩放会让每条公告的高度变，视窗高度得跟着重算
  window.addEventListener("resize", syncNoticeHeight);
}

/* 注册进首页的视图渲染表（home.js 定义）：切视图 / 核查数据就绪时统一重绘
   —— 帖子里的「相关核查」链接要等 items 就绪才能补上，这条注册是它的保障。 */
VIEW_RENDERERS.push(renderForumView);

initNoticeUI();
initForumUI();
initForumData();
