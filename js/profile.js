/* ============================================================
   profile.js — 资料层（Day 22 · 个性化）

   它管三件事，别处不再各写一份：
     ① PRESET_AVATARS：预设头像表 —— 不想传图的人也能有个像样的头像；
     ② 资料缓存 + 头像签名 URL 缓存 —— 一次渲染不许重复请求；
     ③ avatarHtml()：全站唯一一处决定「头像长什么样」，个人主页与论坛共用。

   【为什么头像非要「签名 URL」这种东西】
   云存储没有公开链接（平台设计如此），读图必须先换一个短时有效的签名 URL
   （默认 600 秒，最长 1 小时）。由此推出三条纪律：
     · 签名 URL 绝不写进数据库、绝不持久化 —— 它是一把会过期的钥匙；
     · 同一批路径只签一次，渲染时查缓存；
     · 签名失败不能让页面崩 —— 回落到预设色块，功能照常。
   ============================================================ */

/** 预设头像：浅底 + 深字。色值全部复用站点已登记的 :root 变量（不新增裸色值） */
const PRESET_AVATARS = [
  { id: "p1", word: "讯", bg: "var(--c-doubt-soft)", fg: "var(--c-doubt-deep)" },
  { id: "p2", word: "源", bg: "var(--c-true-soft)", fg: "var(--c-true-deep)" },
  { id: "p3", word: "查", bg: "var(--c-partial-soft)", fg: "var(--c-partial-deep)" },
  { id: "p4", word: "证", bg: "var(--c-fake-soft)", fg: "var(--c-fake-deep)" },
  { id: "p5", word: "录", bg: "var(--c-stat-bg)", fg: "var(--c-summary)" },
  { id: "p6", word: "核", bg: "var(--c-avatar-bg)", fg: "var(--c-primary-dark)" },
];

let __profiles = {};        // user_id → 资料行
let __avUrls = {};          // storage 路径 → 签名 URL
let __profilesReady = false;
let __inflight = null;      // 同一轮里并发调用只发一次请求

/** 按 id 找预设；找不到返回 null（由调用方决定回落） */
function presetOf(id) {
  return PRESET_AVATARS.filter((p) => p.id === id)[0] || null;
}

/**
 * 没设置过头像的人：拿昵称首字 + 一个稳定的哈希挑个配色。
 * 同一个名字每次都是同一个颜色 —— 不这么做的话，刷新一次换一个颜色会很怪。
 */
function defaultPreset(name) {
  const s = String(name || "匿");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  const p = PRESET_AVATARS[h % PRESET_AVATARS.length];
  return { id: p.id, word: s.slice(0, 1), bg: p.bg, fg: p.fg };
}

/** 登录状态变了就整体作废：不能把上一个账号的资料留给下一个人看 */
function resetProfileCache() {
  __profiles = {};
  __avUrls = {};
  __profilesReady = false;
  __inflight = null;
}

/**
 * 取回资料表 + 为其中的上传头像换签名 URL。
 * 个人主页与论坛都在首屏调用它，所以做了「并发去重 + 结果缓存」。
 */
async function ensureProfiles() {
  if (__profilesReady) return __profiles;
  if (__inflight) return __inflight;

  __inflight = (async () => {
    try {
      if (!auth.isSignedIn()) {
        // 未登录：RLS 一行都不给。头像回落到预设块，页面不必因此空白
        __profiles = {};
        __avUrls = {};
        __profilesReady = true;
        return __profiles;
      }

      __profiles = await api.getProfiles();

      const paths = Object.keys(__profiles)
        .map((k) => __profiles[k])
        .filter((p) => p && p.avatar_kind === "upload" && p.avatar_value)
        .map((p) => p.avatar_value);

      __avUrls = await api.signAvatarUrls(paths);
    } catch (err) {
      console.warn("[profile] 资料读取失败（头像回落到默认块）：", err && err.message);
      __profiles = {};
      __avUrls = {};
    }
    __profilesReady = true;
    return __profiles;
  })();

  return __inflight;
}

/** 按 user_id 取资料行（没有则 null） */
function profileOf(uid) {
  return (uid && __profiles[uid]) || null;
}

/** 我自己的资料行 */
function myProfile() {
  return profileOf(auth.uid());
}

/** 上传头像的签名 URL（个人主页预览用） */
function avatarUrlOf(path) {
  return (path && __avUrls[path]) || null;
}

/** 手动塞一条签名 URL 进缓存（刚上传完，省一次往返） */
function cacheAvatarUrl(path, url) {
  if (path && url) __avUrls[path] = url;
}

/**
 * 头像元素的 HTML —— 全站唯一一处决定头像长相。
 * @param uid  作者 id（论坛帖用；种子帖没有账号，传空）
 * @param name 昵称（没有 uid 时按它挑默认块的配色与首字）
 * @param cls  额外类名（尺寸等），如 "fx-avatar-lg"
 */
function avatarHtml(uid, name, cls) {
  const row = profileOf(uid);
  const extra = cls || "";

  // ① 传过图且签名成功 → 用真图
  if (row && row.avatar_kind === "upload" && row.avatar_value && __avUrls[row.avatar_value]) {
    return '<span class="fx-avatar ' + extra + '">' +
      '<img src="' + escHtml(__avUrls[row.avatar_value]) + '" alt="">' +
      "</span>";
  }

  // ② 否则用预设块：选过就用选的那个，没选过按昵称生成一个稳定的
  const preset = (row && presetOf(row.avatar_value)) || defaultPreset((row && row.nickname) || name);
  return '<span class="fx-avatar ' + extra + '" aria-hidden="true" style="background:' +
    preset.bg + ";color:" + preset.fg + '">' + escHtml(String(preset.word || "匿")) + "</span>";
}

/* ============================================================
   页头「我的入口」（Day 23）

   原来页头右上角永远是一个写死的「创」字——登录前后毫无变化，
   用户根本感知不到「我登录了没有」。现在：未登录 = 站标「创」；
   登录后 = 本人的头像（上传图或预设块）+ 昵称，点一下进个人主页。

   只在**有该结构的页面**生效（元素不存在就直接返回），
   所以没引本文件的页面不受影响。
   ============================================================ */

/** 把头像画进一个已有元素（上传图优先，否则预设色块）—— 供页头圆按钮复用 */
function paintAvatarInto(el, uid, name) {
  const row = profileOf(uid);
  const url = row && row.avatar_kind === "upload" && row.avatar_value
    ? __avUrls[row.avatar_value] : null;

  if (url) {
    el.textContent = "";
    const img = document.createElement("img");
    img.src = url;                 // 走 DOM 属性赋值，不当 HTML 拼
    img.alt = "";
    el.appendChild(img);
    el.style.background = "";      // 有真图就不需要底色
    return;
  }

  const preset = (row && presetOf(row.avatar_value)) || defaultPreset((row && row.nickname) || name);
  el.textContent = String(preset.word || "创");
  el.style.background = preset.bg;
  el.style.color = preset.fg;
}

/** 页头入口重绘：未登录回落站标；登录后取资料画自己的头像与昵称；管理员点亮「后台」 */
async function refreshHeaderMe() {
  const host = document.getElementById("header-me");
  const btn = document.getElementById("header-avatar");
  const nameEl = document.getElementById("header-me-name");
  const adminEl = document.getElementById("header-admin");
  if (!host || !btn) return;       // 该页面没有这个结构，安静退出

  if (!auth.isSignedIn()) {
    btn.textContent = "创";
    btn.style.background = "";
    btn.style.color = "";
    if (nameEl) { nameEl.textContent = ""; nameEl.hidden = true; }
    if (adminEl) adminEl.hidden = true;
    host.setAttribute("title", "个人主页");
    host.setAttribute("aria-label", "进入个人主页");
    return;
  }

  await ensureProfiles();          // 取资料（含头像的签名 URL）
  const row = myProfile() || {};
  const nick = row.nickname || "";
  const email = auth.session && auth.session.user ? auth.session.user.email : "";

  paintAvatarInto(btn, auth.uid(), nick || email || "我");
  if (nameEl) { nameEl.textContent = nick; nameEl.hidden = !nick; }
  host.setAttribute("title", (nick ? nick + " · " : "") + "个人主页");
  host.setAttribute("aria-label", "进入个人主页" + (nick ? "（" + nick + "）" : ""));

  // 「后台」入口：显隐完全跟着服务端的判定走（查 admins 表，前端伪造不了）
  if (adminEl) {
    try { adminEl.hidden = !(await auth.isAdmin()); }
    catch (e) { adminEl.hidden = true; }
  }
}

/* 启动：先按未登录画一次，等身份层恢复会话后再重画一遍 */
refreshHeaderMe();
auth.onChange(() => {
  resetProfileCache();             // 换人了：上一账号的资料与签名 URL 一律作废
  refreshHeaderMe();
});
