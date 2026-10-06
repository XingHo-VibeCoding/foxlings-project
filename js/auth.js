/* ============================================================
   auth.js — 身份层（Day 21：论坛发帖需要一个「谁发的」）

   【为什么单独一层】
   论坛不是匿名留言板：帖子得有人负责，所以发帖前必须先有身份。
   页面只说「要登录」，不认识 SDK 的 auth 接口 —— 与数据层同一个道理，
   换认证方式只改这一个文件。

   【一个必须说清的边界，本地开发天天撞】
   托管后端的邮箱登录只在**已注册的发布域名**上可用（服务端按 Origin 校验），
   localhost / 预览环境登不上。这不是 bug，是服务端的绑定规则。
   所以 authHostOk() 先判断当前域名，不满足时直接把原因写在界面上 ——
   让「为什么登不上」当场可见，而不是让人以为网络有问题。

   【这里不做的事】
   · 不用匿名登录、不造「本地假用户」——身份必须是真的（SDK 也不提供匿名登录）。
   · 不在 localStorage 存任何身份：会话由 SDK 自己保管（只存访问令牌 + 刷新句柄）。
     本文件只记一个「上次填的邮箱」，纯粹为了少打一次字。

   【登录方式：只有邮箱】
   Web 应用不支持手机号/微信登录（那是小程序的），所以这里只有邮箱：
     ① 验证码登录：输邮箱 → 收码 → 填码即登录；新邮箱同时设一个密码（注册）
     ② 密码登录：邮箱 + 密码；旁边给「忘记密码」入口
   ============================================================ */

const AUTH_EMAIL_KEY = "fx_last_email";   // 上次填的邮箱（便利性，不是凭证）

let __session = null;        // 当前会话；null = 未登录
const __listeners = [];      // 会话变化订阅者（页面靠它刷新界面）
let __pendingOtp = null;     // 待验证的挑战：{ email, verificationId, isExistingUser }
let __requireResolve = null; // auth.require() 挂起的 Promise 的 resolve
let __countdownTimer = null; // 重发倒计时

/** 登录是否可用：当前域名必须是发布域名（服务端按 Origin 校验，本地预览不在白名单里） */
function authHostOk() {
  try {
    return location.hostname === new URL(window.CLOUD_CONFIG.endpoint).hostname;
  } catch (e) {
    return false;
  }
}

/** 邮箱脱敏显示：zhang@example.com → z***@example.com（界面上不铺全量邮箱） */
function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at <= 0) return s;
  return s.slice(0, 1) + "***" + s.slice(at);
}

/** 把 SDK 的 error 翻成能看懂的话 */
function authErrorText(error, fallback) {
  const kind = (error && error.kind) || "";
  if (kind === "unauthenticated" || kind === "invalid_grant") return "邮箱或密码不对，请重试。";
  if (kind === "network" || kind === "backend-unavailable") return "网络不通，请稍后再试。";
  return (error && error.message) || fallback || "操作失败，请重试。";
}

const auth = {
  /* ---------------- 会话 ---------------- */

  get session() { return __session; },

  isSignedIn() { return !!__session; },

  /** 当前用户标识（只用于界面判断，权限永远由数据库 RLS 决定） */
  uid() { return __session && __session.user ? __session.user.id : null; },

  /** 订阅会话变化；返回取消订阅函数 */
  onChange(fn) {
    __listeners.push(fn);
    return () => {
      const i = __listeners.indexOf(fn);
      if (i !== -1) __listeners.splice(i, 1);
    };
  },

  /** 启动时调用：恢复已有会话（刷新页面不用重新登录），并订阅后续变化 */
  async init() {
    try {
      const { data } = await getCloudClient().auth.getSession();
      __session = data || null;
    } catch (e) {
      console.warn("[auth] 会话恢复失败（未登录状态继续）：", e && e.message);
      __session = null;
    }

    try {
      getCloudClient().auth.onAuthStateChange((event, session) => {
        __session = session || null;
        __listeners.forEach((fn) => fn(__session, event));
      });
    } catch (e) {
      console.warn("[auth] 会话订阅失败：", e && e.message);
    }

    __listeners.forEach((fn) => fn(__session, "INIT"));
  },

  /* ---------------- 登录动作 ---------------- */

  /**
   * ① 发送验证码（登录 / 注册共用）。
   * 挑战存在模块作用域里，**不能**放在事件处理器内 —— 提交时要用同一次发送的结果，
   * 否则会变成「每点一次登录就重新发一条验证码」。
   */
  async sendCode(email) {
    const sent = await getCloudClient().auth.sendOtp({ email: email });
    if (sent.error) throw new Error(authErrorText(sent.error, "验证码发送失败。"));

    __pendingOtp = {
      email: email,
      verificationId: sent.data.verificationId,
      isExistingUser: sent.data.isExistingUser,
    };
    return __pendingOtp;
  },

  /** 当前挑战（界面据此决定是否显示「设置密码」一行） */
  pendingOtp() { return __pendingOtp; },

  /**
   * ② 提交验证码登录 / 注册。
   * 新邮箱必须同时给密码（这是注册），老邮箱不需要 —— SDK 会在缺密码时直接拒绝建号，
   * 所以这里按 isExistingUser 决定传不传 password。
   */
  async verifyCode(code, password) {
    const pending = __pendingOtp;
    if (!pending) throw new Error("请先获取验证码。");

    const done = await getCloudClient().auth.verifyOtp({
      email: pending.email,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code,
      password: pending.isExistingUser ? undefined : password,
    });
    if (done.error) throw new Error(authErrorText(done.error, "验证码不正确或已过期。"));

    __pendingOtp = null;
    __session = done.data && done.data.session ? done.data.session : __session;
    return done.data;
  },

  /** ③ 邮箱 + 密码登录 */
  async signInWithPassword(email, password) {
    const res = await getCloudClient().auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw new Error(authErrorText(res.error, "邮箱或密码不对，请重试。"));
    __session = res.data || __session;
    return res.data;
  },

  /** ④ 忘记密码：先发重置码，再带码改密（成功后 SDK 会直接把人登进去） */
  async sendResetCode(email) {
    const started = await getCloudClient().auth.resetPasswordForEmail(email);
    if (started.error) throw new Error(authErrorText(started.error, "重置邮件发送失败。"));
    return started.data;   // 持有它，下一步用它 updateUser
  },

  async resetPassword(handle, nonce, newPassword) {
    if (!handle) throw new Error("请先获取重置码。");
    const done = await handle.updateUser({ nonce: nonce, password: newPassword });
    if (done.error) throw new Error(authErrorText(done.error, "重置码不正确或已过期。"));
    __session = done.data && done.data.session ? done.data.session : __session;
    return done.data;
  },

  /** 退出登录 */
  async signOut() {
    try {
      await getCloudClient().auth.signOut();
    } catch (e) {
      console.warn("[auth] 退出时出错（本地状态照常清空）：", e && e.message);
    }
    __session = null;
    __listeners.forEach((fn) => fn(null, "SIGNED_OUT"));
  },

  /* ---------------- 需要登录才能做的事 ---------------- */

  /**
   * 页面用这个来「要一个身份」：已登录直接放行；
   * 未登录就弹登录框，等用户登完（或关掉）再决定。
   */
  require(reason) {
    if (__session) return Promise.resolve(true);
    if (!authHostOk()) {
      openAuthPanel("blocked");
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      __requireResolve = resolve;
      openAuthPanel("login", reason);
    });
  },

  openLogin(reason) { openAuthPanel("login", reason); },
  closeLogin() { closeAuthPanel(false); },
};

/* ============================================================
   登录面板（DOM 由这里生成，三个页面只引入 auth.js 就有）
   ============================================================ */

let __panelEl = null;
let __panelMode = "otp";      // otp / pwd / reset
let __resetHandle = null;     // 忘记密码流程中持有 resetPasswordForEmail 的返回值
let __newUser = false;        // 本次验证码是否对应「新邮箱」（决定要不要设密码）

/** 面板 HTML：只在本文件里改一处，三个页面自动跟着变 */
function authPanelHtml() {
  return '' +
    '<div class="auth-mask" id="auth-mask" hidden>' +
      '<div class="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">' +
        '<button type="button" class="auth-close" id="auth-close" aria-label="关闭登录窗口">×</button>' +
        '<h2 class="auth-title" id="auth-title">登录 / 注册</h2>' +
        '<p class="auth-sub" id="auth-sub"></p>' +

        '<div class="auth-modes" id="auth-modes" role="group" aria-label="登录方式">' +
          '<button type="button" class="tab active" data-auth-mode="otp" aria-pressed="true">验证码登录</button>' +
          '<button type="button" class="tab" data-auth-mode="pwd" aria-pressed="false">密码登录</button>' +
        '</div>' +

        '<form id="auth-form" novalidate>' +
          '<label class="auth-label" for="auth-email">邮箱</label>' +
          '<input type="email" id="auth-email" class="auth-input" autocomplete="email" placeholder="you@example.com">' +

          '<div class="auth-code-row" id="auth-code-row">' +
            '<input type="text" id="auth-code" class="auth-input" inputmode="numeric" autocomplete="one-time-code" placeholder="收到的验证码">' +
            '<button type="button" class="auth-btn-ghost" id="auth-send">获取验证码</button>' +
          '</div>' +

          '<div id="auth-pwd-row">' +
            '<label class="auth-label" for="auth-pwd" id="auth-pwd-label">密码</label>' +
            '<input type="password" id="auth-pwd" class="auth-input" autocomplete="current-password" placeholder="至少 6 位">' +
          '</div>' +

          '<div class="auth-code-row" id="auth-reset-row" hidden>' +
            '<input type="text" id="auth-reset-code" class="auth-input" inputmode="numeric" placeholder="邮件里的重置码">' +
            '<button type="button" class="auth-btn-ghost" id="auth-reset-send">发送重置码</button>' +
          '</div>' +

          '<p class="auth-note" id="auth-note" role="status"></p>' +
          '<button type="submit" class="auth-btn" id="auth-submit">登录</button>' +
        '</form>' +

        '<p class="auth-alt" id="auth-alt">' +
          '<button type="button" class="auth-link" id="auth-forgot">忘记密码？</button>' +
        '</p>' +

        '<p class="auth-foot">登录只用于「谁发的帖」。本站不收集手机号，也不会把邮箱显示给别人。</p>' +
      '</div>' +
    '</div>';
}

/** 取面板里的元素（面板是动态生成的，用 id 现取，不缓存节点） */
function authEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error("登录面板缺少元素：" + id);
  return el;
}

function authSay(text, kind) {
  const note = authEl("auth-note");
  note.textContent = text || "";
  note.className = "auth-note" + (kind ? " note-" + kind : "");
}

function authBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.idleText = btn.textContent;
    btn.textContent = busyText || "请稍候…";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.idleText || btn.textContent;
    btn.disabled = false;
  }
}

/** 60 秒重发倒计时（面板关闭时清掉，避免定时器泄漏） */
function startCountdown(btn, label) {
  let left = 60;
  clearInterval(__countdownTimer);
  btn.disabled = true;
  btn.textContent = left + " 秒后可重发";
  __countdownTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(__countdownTimer);
      __countdownTimer = null;
      btn.disabled = false;
      btn.textContent = label;
      return;
    }
    btn.textContent = left + " 秒后可重发";
  }, 1000);
}

/** 切换面板模式：otp（验证码）/ pwd（密码）/ reset（重置密码） */
function applyAuthMode(mode) {
  __panelMode = mode;

  const codeRow = authEl("auth-code-row");
  const pwdRow = authEl("auth-pwd-row");
  const resetRow = authEl("auth-reset-row");
  const pwdLabel = authEl("auth-pwd-label");
  const submit = authEl("auth-submit");
  const alt = authEl("auth-alt");
  const modes = authEl("auth-modes");
  const pwdInput = authEl("auth-pwd");

  modes.hidden = mode === "reset";
  codeRow.hidden = mode !== "otp";
  resetRow.hidden = mode !== "reset";
  pwdRow.hidden = mode === "otp" && !__newUser;

  if (mode === "otp") {
    pwdLabel.textContent = "设置密码（第一次用这个邮箱，以后可以密码登录）";
    pwdInput.setAttribute("autocomplete", "new-password");
    submit.textContent = "登录 / 注册";
    alt.innerHTML = '<button type="button" class="auth-link" id="auth-forgot">忘记密码？</button>';
    authSay("");
  } else if (mode === "pwd") {
    pwdLabel.textContent = "密码";
    pwdInput.setAttribute("autocomplete", "current-password");
    submit.textContent = "登录";
    alt.innerHTML = '<button type="button" class="auth-link" id="auth-forgot">忘记密码？</button>';
    authSay("");
  } else {
    pwdLabel.textContent = "设置新密码";
    pwdInput.setAttribute("autocomplete", "new-password");
    submit.textContent = "重置并登录";
    alt.innerHTML = '<button type="button" class="auth-link" id="auth-back">← 回到登录</button>';
    authSay("填上邮箱，点「发送重置码」，把邮件里的重置码和新密码填进来。");
  }

  modes.querySelectorAll("[data-auth-mode]").forEach((b) => {
    const on = b.dataset.authMode === mode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });

  bindAuthAlt();
}

/** 面板底部那两个随时可能被重建的链接（忘记密码 / 回到登录） */
function bindAuthAlt() {
  const forgot = document.getElementById("auth-forgot");
  if (forgot) forgot.addEventListener("click", () => { __resetHandle = null; applyAuthMode("reset"); });
  const back = document.getElementById("auth-back");
  if (back) back.addEventListener("click", () => { applyAuthMode("otp"); });
}

function openAuthPanel(state, reason) {
  if (!__panelEl) {
    const host = document.createElement("div");
    host.innerHTML = authPanelHtml();
    document.body.appendChild(host.firstChild);
    __panelEl = document.getElementById("auth-mask");
    bindAuthPanel();
  }

  const sub = authEl("auth-sub");
  if (state === "blocked") {
    sub.textContent = "登录只在**发布后的网址**上可用，本地预览登不上（服务端要校验来源域名）。" +
      "部署后的站点可以正常登录。";
    sub.textContent = sub.textContent.replace(/\*\*/g, "");
  } else {
    sub.textContent = reason || "发帖需要一个身份：用邮箱收一个验证码就能登录，不用注册流程。";
  }

  authEl("auth-email").value = localStorage.getItem(AUTH_EMAIL_KEY) || "";
  applyAuthMode("otp");
  __panelEl.hidden = false;
  setTimeout(() => authEl("auth-email").focus(), 30);
}

function closeAuthPanel(ok) {
  if (__panelEl) {
    __panelEl.hidden = true;
    clearInterval(__countdownTimer);
    __countdownTimer = null;
  }
  __pendingOtp = null;
  __resetHandle = null;
  __newUser = false;
  const submit = document.getElementById("auth-submit");
  if (submit) { submit.disabled = false; submit.textContent = "登录 / 注册"; }

  if (__requireResolve) {
    const resolve = __requireResolve;
    __requireResolve = null;
    resolve(!!ok);
  }
}

/** 面板事件绑定：只绑一次（面板只创建一次） */
function bindAuthPanel() {
  authEl("auth-close").addEventListener("click", () => closeAuthPanel(auth.isSignedIn()));
  __panelEl.addEventListener("click", (e) => {
    if (e.target === __panelEl) closeAuthPanel(auth.isSignedIn());   // 点遮罩关闭
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && __panelEl && !__panelEl.hidden) closeAuthPanel(auth.isSignedIn());
  });

  authEl("auth-modes").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-auth-mode]");
    if (btn) applyAuthMode(btn.dataset.authMode);
  });

  // 发送验证码（登录用）—— 只发码，不验证，与「提交」严格分开
  authEl("auth-send").addEventListener("click", async () => {
    const email = authEl("auth-email").value.trim();
    if (!email) { authSay("先填邮箱。", "warn"); authEl("auth-email").focus(); return; }

    const btn = authEl("auth-send");
    authBusy(btn, true, "发送中…");
    authSay("");
    try {
      const pending = await auth.sendCode(email);
      localStorage.setItem(AUTH_EMAIL_KEY, email);
      __newUser = pending.isExistingUser === false;
      authSay(__newUser
        ? "验证码已发出。这是第一次用这个邮箱，请同时设置一个密码（至少 6 位）。"
        : "验证码已发出，填进来即可登录。", "ok");
      applyAuthMode("otp");          // 新用户要显示密码行
      startCountdown(btn, "获取验证码");
      authEl("auth-code").focus();
    } catch (err) {
      authBusy(btn, false);
      authSay(err.message, "warn");
    }
  });

  // 发送重置码（忘记密码用）
  authEl("auth-reset-send").addEventListener("click", async () => {
    const email = authEl("auth-email").value.trim();
    if (!email) { authSay("先填邮箱。", "warn"); authEl("auth-email").focus(); return; }

    const btn = authEl("auth-reset-send");
    authBusy(btn, true, "发送中…");
    try {
      __resetHandle = await auth.sendResetCode(email);
      localStorage.setItem(AUTH_EMAIL_KEY, email);
      authSay("重置码已发出，填进来并设置新密码。", "ok");
      startCountdown(btn, "发送重置码");
      authEl("auth-reset-code").focus();
    } catch (err) {
      authBusy(btn, false);
      authSay(err.message, "warn");
    }
  });

  // 提交：三种模式共用一个入口，按 __panelMode 分派
  authEl("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = authEl("auth-email").value.trim();
    const submit = authEl("auth-submit");
    if (!email) { authSay("先填邮箱。", "warn"); authEl("auth-email").focus(); return; }

    authBusy(submit, true, "处理中…");
    try {
      if (__panelMode === "otp") {
        const code = authEl("auth-code").value.trim();
        if (!code) throw new Error("请填验证码（没收到就点「获取验证码」重发）。");
        const pwd = authEl("auth-pwd").value;
        if (__newUser && String(pwd).length < 6) throw new Error("第一次用这个邮箱，请设置至少 6 位的密码。");
        await auth.verifyCode(code, pwd);
      } else if (__panelMode === "pwd") {
        const pwd = authEl("auth-pwd").value;
        if (!pwd) throw new Error("请填密码。");
        await auth.signInWithPassword(email, pwd);
      } else {
        const nonce = authEl("auth-reset-code").value.trim();
        const pwd = authEl("auth-pwd").value;
        if (!nonce) throw new Error("请填邮件里的重置码。");
        if (String(pwd).length < 6) throw new Error("新密码至少 6 位。");
        await auth.resetPassword(__resetHandle, nonce, pwd);
      }

      localStorage.setItem(AUTH_EMAIL_KEY, email);
      closeAuthPanel(true);          // 成功：关面板并把 require() 放行
    } catch (err) {
      authBusy(submit, false);
      authSay(err.message, "warn");
    }
  });
}

/* 启动：等页面脚本都执行完再恢复会话 ——
   这样各页面注册的 onChange 监听器能收到第一次的 INIT 事件，
   不会出现「刷新后其实已登录、界面却还显示未登录」的错位。 */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { auth.init(); });
} else {
  auth.init();
}
