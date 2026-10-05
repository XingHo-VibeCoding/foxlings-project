/* ============================================================
   forum.js — 论坛（F3，界面骨架先行 · Day 19）
   论坛要解决的问题：工具查不到的消息，交给人来找线索。
   已删的短视频、私密群聊里的截图，恰恰是自动化工具够不着、
   最需要人工补位的地方——这是论坛在本站的位置。

   本期做到哪（纯静态能做到的）：
     · 帖子列表：读 data/posts.json（样例帖子，全部标注【示例】）
     · 分类 + 关键词两组筛选叠加，三态各有出口（沿用全站范式）
     · 只显示 status = approved 的帖子，并单独列出「待审核」条数
       —— 与将来 GET /api/posts 的默认过滤一致，审核机制在界面上先立住
     · 发帖：后端接通前只能暂存本机（写 REP_KEY，与个人主页同一份数据）
   还没做的（如实标注，不假装已有）：
     · 账号登录、发帖发布、回复、人工审核 —— 需要后端（api-contract.md /api/posts）
   四态与全站一致：loading / 正常 / 空（零帖子与筛空是两套文案）/ 错误（带重试）。
   ============================================================ */

const POST_CATS = ["求助溯源", "已解决", "经验讨论"];
const CAT_ALL = "all";
const POST_STATUS = ["pending", "approved", "rejected"];

let ALL_POSTS = [];              // 通过校验的全部帖子（含待审）
let POST_STATE = "loading";      // loading / ok / error（与首页数据状态机同构）
let forumCat = CAT_ALL;          // 当前分类
let forumKeyword = "";           // 当前关键词

/* 分类标签不做颜色区分：分类不是核查结论，不复用结论四色，
   三档靠文字分辨（C5 文案通道），样式统一走 .post-cat。 */

/* ---------------- 数据：加载 + 校验 ---------------- */

/**
 * 加载并校验帖子。规矩与 data.js 对核查条目一致：
 * 缺必填字段或枚举非法的条目跳过、在控制台警告，其余照常渲染。
 */
async function loadVerifiedPosts() {
  const resp = await fetch("data/posts.json");
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const raw = await resp.json();

  const list = Array.isArray(raw.posts) ? raw.posts : [];
  const good = [];

  list.forEach((post, i) => {
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

/** 已通过审核的帖子，新帖在前 —— 待审的只有作者与审核人可见（与后端过滤一致） */
function approvedPosts() {
  return ALL_POSTS
    .filter((p) => p.status === "approved")
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || (b.id - a.id));
}

/* ---------------- 渲染 ---------------- */

/** 装饰 D6：页头徽卡（数字由真实数据算出：「已通过」= 列表里的帖子数） */
function renderForumStats() {
  const el = document.getElementById("forum-stats");
  if (!el) return;
  if (POST_STATE !== "ok") { el.innerHTML = ""; return; }

  const approved = approvedPosts().length;
  const pending = ALL_POSTS.length - approved;
  el.innerHTML =
    '<div class="stat-card"><span class="stat-num">' + approved + '</span>' +
    '<span class="stat-label">已通过</span></div>' +
    '<div class="stat-card"><span class="stat-num">' + pending + '</span>' +
    '<span class="stat-label">待审核</span></div>';
}

/** 渲染一条帖子 */
function renderPost(post, index) {
  const el = document.createElement("article");
  el.className = "post-card pop";
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
      '<span class="post-cat" data-cat="' + post.category + '">' + post.category + "</span>" +
      (post.replies
        ? '<span class="post-replies">' + post.replies + " 条回复</span>"
        : '<span class="post-replies">还没有回复</span>') +
      '<span class="post-date">' + post.created_at + "</span>" +
    "</div>" +
    '<h3 class="post-title">' + escHtml(post.title) + "</h3>" +
    '<p class="post-body">' + escHtml(post.body) + "</p>" +
    '<p class="post-meta">发起人：' + escHtml(post.author || "匿名") + "</p>" +
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

/** 论坛列表渲染总入口：数据就绪 / 切视图 / 筛选变化时统一重绘 */
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

  const approved = approvedPosts();

  // ③ 零数据态（论坛里一条帖子都没有）：与「筛空」文案必须不同，且给出路
  if (!approved.length) {
    updateForumSummary(0);
    renderListState(box, "empty", {
      text: "论坛还没有帖子。发帖功能接通后，第一条求助就会出现在这里。",
      action: "先去看辟谣榜",
      actionHref: "index.html#/board",
    });
    return;
  }

  // ④ 正常态：分类 + 关键词叠加筛选
  let list = approved;
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
  list.forEach((p, i) => box.appendChild(renderPost(p, i)));
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

/* ---------------- 交互绑定 ---------------- */

/** 发帖区：后端接通前只能暂存本机（与个人主页「我提交的待核查」同一个键） */
function initCompose() {
  const input = document.getElementById("forum-input");
  const btn = document.getElementById("forum-submit");
  const note = document.getElementById("forum-submit-note");
  if (!input || !btn || !note) return;

  const say = (html, ok) => {
    note.innerHTML = html;
    note.classList.toggle("note-ok", ok === true);
    note.classList.toggle("note-warn", ok === false);
  };

  btn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) {                       // 空内容不提交，光标留在输入框
      say("先写一句你看到的消息，再点暂存。", false);
      input.focus();
      return;
    }

    const arr = readJSON(REP_KEY, []);
    const list = Array.isArray(arr) ? arr : [];
    list.unshift({ text: text, at: Date.now() });
    localStorage.setItem(REP_KEY, JSON.stringify(list.slice(0, 50)));

    input.value = "";
    say("已存在本机（共 " + list.length + " 条）——到<a href=\"mine.html\">个人主页</a>最下方「我提交的待核查」就能看到。" +
      "后端接通后，这里会直接公开发布给大家一起溯源。", true);
  });
}

/** 绑定论坛页全部交互（筛选、关键词、发帖） */
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

  initCompose();
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

/* 注册进首页的视图渲染表（home.js 定义）：切视图 / 核查数据就绪时统一重绘
   —— 帖子里的「相关核查」链接要等 items 就绪才能补上，这条注册是它的保障。 */
VIEW_RENDERERS.push(renderForumView);

initForumUI();
initForumData();
