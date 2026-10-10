/* ============================================================
   api.js — 数据接口层（Day 20 接读接口 · Day 21 接写接口 · Day 22 补改/删防呆）

   【它在整个作品里的位置】
     页面脚本（home.js / detail.js / search.js / mine.js / forum.js）
       ↓  只认识 api.xxx()
      api.js  ← 唯一的数据出入口
       ↓
     云数据库（唯一的运行时数据源）

   为什么要单独一层：以前每个页面各写各的 fetch，数据源一变就要改五个地方。
   收成一层之后，换数据源（data.json → 云数据库 → 将来别的）只改这一个文件。

   【一个必须讲清楚的点】
   课程里「读接口 / 写接口 / 后端分层」讲的是「前端 → HTTP 接口 → 服务层 → 数据访问层」
   那种形态。本项目走的是托管后端，它的形态是 **SDK 直连数据库**，没有自建的 HTTP
   服务层 —— 所以「接口层」落在前端这一层薄薄的函数上。

   那「安全闸门」在哪？不在这一层，在**数据库的 RLS 策略**里：
   前端代码谁都能改、能绕，但它绕不过服务端策略。三张表的闸门各自是：

     items    只有一条 SELECT（任何人可读）—— 读得到，写不进（站方经管理通道维护）
     posts    SELECT 只给 approved（或作者本人看自己的）｜ INSERT 只给**已登录**用户，
              且只能插「自己的 + 待审」
     reports  INSERT 允许未登录（author_id 落为 'anon'）；SELECT **只给已登录用户看自己的** ——
              匿名身份读不到任何线索，否则访客能把所有人匿名提交的线索都读走

   【一个实测出来的平台事实，写策略时必须知道】
   未登录时 auth.uid() 返回的是字符串 'anon'，**不是 NULL**。踩过的两个坑：
     · 若把「只读自己的」策略开放给 anon 角色，等于公开了所有匿名行（它们都是 'anon'）；
     · 若把「必须登录才能插」的策略开放给 anon 角色，则未登录者也满足
       author_id = auth.uid()（默认值同为 'anon'），发帖门槛形同虚设。
   所以涉权限的策略一律写成 TO authenticated；数据库默认拒绝，不用自己判空。

   注意两件「接口层故意不传」的东西，它们由数据库决定，传了反而会被拒：
     · 帖子的 author_id —— 服务端用 auth.uid() 填，客户端伪造会被 RLS 拒
     · 帖子的 status    —— 默认 pending，客户端想直接插 approved 一样会被 RLS 拒
   这正是「安全不放在前端」的意思：前端这一层只管「怎么调」，不管「准不准」。

   【关于 data/data.json 与 data/posts.json】
   它们不再是运行时数据源，而是**种子数据的源头** —— db/*-to-sql.js 从它们生成入库
   语句。所以「同一份数据只有一个定义」这条纪律仍然成立：
   内容改 json → 跑脚本同步进库 → 页面读库。单向同步，不是双写。
   （Day 20 实测：本地开发地址跨域读云端是通的，所以不做「本地读文件」的分叉，
     避免出现两个数据源。）
   ============================================================ */

let __cloudClient = null;

/** 取得（并复用）云服务客户端 —— 整个应用只初始化一次 */
function getCloudClient() {
  if (__cloudClient) return __cloudClient;
  const S = window.WorkBuddyCloud;
  if (!S || typeof S.createWorkBuddyCloud !== "function") {
    throw new Error("云服务 SDK 未加载（CDN 脚本没读到，或网络不通）");
  }
  __cloudClient = S.createWorkBuddyCloud({
    endpoint: window.CLOUD_CONFIG.endpoint,
    publishableKey: window.CLOUD_CONFIG.publishableKey,
  });
  return __cloudClient;
}

/** 把 {data, error} 信封拆开：有错就抛（错误码翻成能看懂的话），没消息就返回 data */
function unwrap(result, what) {
  const { data, error } = result || {};
  if (error) {
    console.error("[api] " + what + "失败：", error);
    const e = new Error(describeError(error, what));
    e.code = error.code;
    throw e;
  }
  return data;
}

/** Postgres / 网关错误码 → 人话。模板见 cloud-service/database/code-generation.md 的错误表 */
function describeError(error, what) {
  // 实测（Day 22）：网关会给数据库错误码加 DATABASE_ 前缀 —— RLS 拒绝报的是
  // "DATABASE_42501" 而不是 "42501"。不剥掉前缀，下面所有分支都命中不了，
  // 用户会看到 "new row violates row-level security policy" 这种英文原文。
  const code = String((error && error.code) || "").replace(/^DATABASE_/, "");
  if (code === "42501" || code === "23502") {
    // 23502 = author_id 非空约束被拒，在发帖场景下等价于「没登录」
    return "这条操作没有被允许——如果是在发帖，请先登录再试。";
  }
  if (code === "23514") return "内容不符合格式要求（标题或正文长度不对）。";
  if (code === "23505") return "这条已经存在了。";
  if (code === "42P01") return "数据表还没建好，请联系站方。";
  return (what || "操作") + "失败：" + (error.message || code || "未知错误");
}

/** 云存储错误 → 人话。存储的报错不带 SQL 码，只能看 status 与 code 两条线 */
function describeStorageError(error) {
  const code = String((error && error.code) || "");
  const msg = String((error && error.message) || "");
  const status = (error && error.status) || 0;

  // 实测：未登录调存储会拿到 {code:"MISSING_CREDENTIALS", status:401}
  if (code === "MISSING_CREDENTIALS" || status === 401) return "上传头像需要先登录。";
  // 本地开发地址跨域调云存储会被 CORS 拦（x-client-info 头不被允许），
  // 发布后的网址是同源、不走 preflight —— 所以这里把话说清楚，别让人以为图片有问题
  if (/failed to fetch|network ?error|load failed/i.test(msg)) {
    return "上传没连上（网络不通，或本地开发地址被跨域拦了）。请在发布后的网址上重试。";
  }
  if (status === 413 || /too large|exceed|maximum/i.test(msg)) return "图片太大了，换一张小一点的（2MB 以内）。";
  if (status === 422 || /mime|content-?type|not supported/i.test(msg)) return "只支持 JPG / PNG / WebP 三种图片。";
  return "头像上传失败：" + (msg || code || "未知错误");
}

/* ---------------- 单条记录的「存在性预检」（Day 22 防呆） ----------------

   课程要求：操作一个**不存在的 id** 时，接口要给出**明确的中文错误**，不能静默、不能崩。

   为什么这里必须单独发一场 SELECT，而不是靠写操作自己报错：

     · PATCH：PostgREST 在不索要返回值时，不管改到几行都只回 204 ——
       传个不存在的 id 也「成功」，用户以为改上了，实际一行没动（静默失败最坑）；
     · DELETE：三张表都装了 BEFORE DELETE 触发器把物理删除改写成「置 is_deleted」，
       触发返回 NULL 取消了这次删除 —— **被取消的行不会出现在 RETURNING 里**，
       所以「删到没删到」根本无法从 DELETE 的返回里看出来。
       用 `.delete().select()` 去数行数，会把「软删成功」误报成「查无此 id」。

   所以：把「这条在不在」的判断**前置到写操作之前**，一次 SELECT 说清楚。

   ⚠️ 定位要说清：这是**可用性防线**（把「查无此 id」翻成人话、拦住无效请求），
      **不是安全闸门**。真正的权限仍在各表 *_admin_* RLS 策略里 ——
      非管理员即便绕过这一层，写请求照样被数据库拒（0 行或 42501）。

   返回查到的整行：它顺带就是需求里要的「操作前的快照」，可直接拿来做前后对比。 */
async function fetchRowOrThrow(table, id, label) {
  const rows = unwrap(
    await getCloudClient().database.from(table).select("*").eq("id", id).limit(1),
    label + "预检"
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    const e = new Error(
      "没有找到这条" + label + "（id=" + id + "）—— 它可能已经被删掉了；" +
      "如果它本该还在，请确认你的账号有没有相应权限。"
    );
    e.code = "NOT_FOUND";
    throw e;
  }
  return row;
}

const api = {
  /* ---------------- 核查条目（读） ---------------- */

  /**
   * 读接口：取全部核查条目。
   * 返回条目数组（字段与 data/data.json 完全一致，不做改名/映射 —— 见 api-contract.md）。
   * 出错时抛出，由页面按四态规范渲染错误态。
   */
  async getItems() {
    const data = unwrap(await getCloudClient().database.from("items").select("*"), "条目读取");
    return Array.isArray(data) ? data : [];
  },

  /* ---------------- 论坛帖子（读 + 写） ---------------- */

  /**
   * 读接口：取帖子。
   * 默认只拿到「已通过审核」的；已登录时还会带上自己那条待审的 ——
   * 这不是前端筛的，是 RLS 给的：posts_read = (status = 'approved' OR author_id = auth.uid())。
   * 所以页面上「待审帖只有作者看得到」是数据库保证的，不是界面演出来的。
   */
  async getPosts() {
    const data = unwrap(
      await getCloudClient().database
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      "帖子读取"
    );
    return Array.isArray(data) ? data : [];
  },

  /**
   * 写接口：发帖。**必须先登录**（未登录时服务端 auth.uid() 为空，插入会被拒）。
   * 故意不传 author_id 与 status：前者由 auth.uid() 填，后者默认 pending 进审核队列。
   * 返回新建的那一行（含数据库生成的 id）。
   */
  async createPost({ category, title, body, authorName, itemId }) {
    const row = {};
    row.category = category;
    row.title = title;
    row.body = body;
    row.author_name = authorName;
    if (itemId) row.item_id = itemId;   // 关联核查是可选的，没有就不传这一列

    const data = unwrap(
      await getCloudClient().database.from("posts").insert(row).select(),
      "发帖"
    );
    return Array.isArray(data) ? data[0] : data;
  },

  /* ---------------- 待核查线索（读 + 写） ---------------- */

  /**
   * 写接口：提交一条待核查线索。**允许未登录提交**（author_id 落为 'anon' = 匿名），
   * 但 RLS 规定 author_id 只能等于调用者身份，所以伪造别人的署名会被拒。
   *
   * 刻意**不加 .select()**：匿名角色没有 reports 的读权限 —— 这正是我们想要的，
   * 否则任何访客都能读到别人提交的线索（它们的 author_id 全是 'anon'）。
   * 而 PostgreSQL 的 INSERT ... RETURNING 需要 SELECT 权限，加了反而会让匿名提交整体被拒。
   * 提交后由页面重新拉列表即可，不需要这次插入的回执。
   */
  async submitReport({ text, url }) {
    const row = { text };
    if (url) row.url = url;

    const { error } = await getCloudClient().database.from("reports").insert(row);
    if (error) {
      console.error("[api] 提交线索失败：", error);
      const e = new Error(describeError(error, "提交线索"));
      e.code = error.code;
      throw e;
    }
    return true;
  },

  /**
   * 读接口：我提交过的线索。未登录时 RLS 给不出任何行（author_id 为 NULL 无从匹配），
   * 返回空数组 —— 页面据此提示「未登录时只在你这台设备上留底」。
   */
  async getMyReports() {
    const data = unwrap(
      await getCloudClient().database
        .from("reports")
        .select("*")
        .order("created_at", { ascending: false }),
      "线索读取"
    );
    return Array.isArray(data) ? data : [];
  },

  /* ---------------- 个人资料（读 + 写） ---------------- */

  /**
   * 读接口：取资料，返回「user_id → 资料行」的映射。
   *
   * 一次全量取回在前端建表 —— 当前站内真实用户是个位数，这样最省事。
   * **规模提醒**：用户上百之后要改成按需查询（论坛只取当页作者），否则这一下会把
   * 全站昵称/签名都拉下来。已经写进 api-contract.md 的「已知取舍」。
   *
   * 未登录时 RLS 一行都不给 → 空映射，页面自动回落到默认头像块。
   */
  async getProfiles() {
    const data = unwrap(
      await getCloudClient().database.from("profiles").select("*"),
      "资料读取"
    );
    const map = {};
    (Array.isArray(data) ? data : []).forEach((p) => {
      if (p && p.user_id) map[p.user_id] = p;
    });
    return map;
  },

  /**
   * 写接口：保存我的资料（没有就新建，有就更新）。
   *
   * 两种走法各自把「我是谁」交给最可信的一方：
   *   · 新建 → **故意不传 user_id**，由数据库默认值 auth.uid() 填。
   *     这是服务端自己的判断，比前端传来的可靠（前端只负责说「存什么」）。
   *   · 更新 → eq 定位用调用方给的 userId，但服务端 RLS 还会再核一遍
   *     （只能改 user_id = auth.uid() 的那一行）；影响 0 行时直接报错，不静默。
   *
   * hasExisting 由调用方从前端缓存判断（省一次请求），判断错了也就是多插一次，
   * 会被主键挡住而不是写坏数据。
   */
  async saveProfile({ userId, nickname, bio, avatarKind, avatarValue, hasExisting }) {
    const row = {
      nickname: nickname,
      bio: bio || "",
      avatar_kind: avatarKind || "preset",
      avatar_value: avatarValue || null,
      updated_at: new Date().toISOString(),
    };

    const q = (hasExisting && userId)
      ? getCloudClient().database.from("profiles").update(row).eq("user_id", userId).select()
      : getCloudClient().database.from("profiles").insert(row).select();

    const data = unwrap(await q, "资料保存");
    const saved = (Array.isArray(data) && data[0]) || null;
    if (!saved) {
      // UPDATE 影响 0 行时 PostgREST 返回空数组 —— 静默吞掉会让用户以为存上了
      throw new Error("保存没有生效（多半是登录状态过期了）。刷新页面重新登录后再试一次。");
    }
    return saved;
  },

  /* ---------------- 头像文件（云存储） ---------------- */

  /**
   * 上传头像 → shared/<uid>/avatars/<随机名>。
   *
   * 为什么放 shared 而不是 users：users/ 只有本人读得到，而头像要显示在别人的页面上；
   * shared/<ownerUid>/ 正好是「所有登录用户可读、只有 owner 能改删」。
   * 返回存储给的 { path, id, fullPath }。
   */
  async uploadAvatar(userId, blob, contentType) {
    const ext = contentType === "image/png" ? "png" : "jpg";
    const name = "avatars/" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 8) + "." + ext;
    const path = getCloudClient().storage.sharedPath(userId, name);

    const res = await getCloudClient().storage.upload(path, blob, {
      contentType: contentType,
      cacheControl: "3600",
      metadata: { purpose: "avatar" },
    });
    if (res && res.error) {
      console.error("[api] 头像上传失败：", res.error);
      const e = new Error(describeStorageError(res.error));
      e.code = res.error.code;
      throw e;
    }
    return res.data;      // { path, id, fullPath }
  },

  /** 删掉换下来的旧头像。清理失败不影响主流程（最多留个孤儿文件）。 */
  async removeAvatar(path) {
    if (!path) return;
    try {
      const res = await getCloudClient().storage.remove([path]);
      if (res && res.error) console.warn("[api] 旧头像删除失败（忽略）：", res.error.message);
    } catch (e) {
      console.warn("[api] 旧头像删除失败（忽略）：", e && e.message);
    }
  },

  /**
   * 批量为头像路径换签名 URL，返回 { path → signedUrl }。
   * 签名有效期取 3600 秒（SDK 允许的上限），够一次浏览会话用。
   * 失败时返回空表而不是抛错 —— 头像挂了不该让整页垮掉。
   */
  async signAvatarUrls(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (!list.length) return {};

    const res = await getCloudClient().storage.createSignedUrls(list, 3600);
    if (res && res.error) {
      console.warn("[api] 头像签名失败（回落到默认头像）：", res.error.message);
      return {};
    }

    const map = {};
    (Array.isArray(res.data) ? res.data : []).forEach((x) => {
      // SDK 的形状：每项是 {...原响应, signedUrl}（见 sdk-global.js createSignedUrls）
      if (x && x.path && x.signedUrl) map[x.path] = x.signedUrl;
    });
    return map;
  },

  /** 单张签名（刚上传完立刻预览用） */
  async signAvatarUrl(path) {
    if (!path) return null;
    const res = await getCloudClient().storage.createSignedUrl(path, 3600);
    if (res && res.error) {
      console.warn("[api] 头像签名失败：", res.error.message);
      return null;
    }
    return (res.data && res.data.signedUrl) || null;
  },

  /* ---------------- 浏览计数（Day 23 · 热度算法的「点击量」那一半） ----------------

     为什么用数据库函数（rpc）而不是 UPDATE：
     items 表**没有任何写策略**，客户端连 UPDATE 权限都没有（实测 PATCH 一律
     permission denied for table items）。可「浏览量」又必须在服务端自增 ——
     于是把「+1」这件事本身做成一个函数，闸门不用开：

       · 函数是 SECURITY DEFINER，以定义者身份执行，越过 items 的只读闸门；
       · 调用者只能「说 +1」，**不能指定数值**（参数只有条目 id，没有数字），
         所以「管理员不能手动调序」这条产品规则是由函数签名保证的，不是靠自觉；
       · 顺带拿到原子性：并发点击不会像「前端读 n 再写 n+1」那样把计数丢掉。

     一句话：墙没拆，墙上开了一扇只容 +1 通过的小窗。

     ⚠️ 去重不在这一层 —— 本函数只管「确实要加一次」，
         「同设备同条目只算一次」由 detail.js 的 reportView 用 localStorage 拦在前面。 */
  async bumpItemView(id) {
    if (!id) return -1;
    const res = await getCloudClient().database.rpc("bump_item_view", { p_id: id });
    if (res && res.error) {
      // 浏览量不是核心功能：失败只记一笔，不往页面上抛（用户没必要看见）
      console.warn("[api] 浏览量自增失败（忽略）：", res.error.message || res.error.code);
      return -1;
    }
    // 函数返回自增后的值；条目不存在时返回 -1（没有行被改动）
    return typeof res.data === "number" ? res.data : -1;
  },

  /* ---------------- 管理侧（Day 23） ----------------
     权限全部在服务端：六条 *_admin_* RLS 策略只认 admins 表里的人，
     前端这里的每个方法都只是「入口」，非管理员调用会被 RLS 拒掉。 */

  /** 我是不是管理员：RLS 保证非管理员/未登录读 admins 永远是空 —— 空即否 */
  async amIAdmin() {
    const data = unwrap(
      await getCloudClient().database.from("admins").select("user_id").limit(1),
      "管理员校验"
    );
    return Array.isArray(data) && data.length > 0;
  },

  /** 管理员读全部帖子（含待审/已拒）—— 普通用户的 RLS 只给 approved 或自己的 */
  async listAllPosts() {
    const data = unwrap(
      await getCloudClient().database.from("posts")
        .select("*").order("created_at", { ascending: false }),
      "帖子读取"
    );
    return Array.isArray(data) ? data : [];
  },

  /**
   * 审核（PATCH）：status 只认 approved / rejected / pending（pending 用于「撤回下架」）。
   *
   * Day 22 补「防呆」三步，缺一不可：
   *   ① 改之前先 SELECT 确认这条在 —— 不在就抛中文错，不让「改 0 行」冒充成功；
   *   ② 改的时候带 `.select()` 拿回**改后的行** —— 既是回执，也是「改前/改后」的对比素材；
   *   ③ 万一预检过了、写入却 0 行（策略把这次改动滤掉了），再给一条权限方向的提示，
   *      任何情况都不静默通过。
   * 返回改后的行（含 status / reject_note / updated_at）。控制台另记一行「改前 → 改后」。
   */
  async setPostStatus(id, status, rejectNote) {
    if (["approved", "rejected", "pending"].indexOf(status) === -1) {
      throw new Error("不合法的审核状态。");
    }
    const before = await fetchRowOrThrow("posts", id, "帖子");

    const patch = { status: status, updated_at: new Date().toISOString() };
    if (status === "rejected") patch.reject_note = rejectNote || "";
    if (status === "approved") patch.reject_note = "";   // 过审顺手清掉旧理由

    const data = unwrap(
      await getCloudClient().database.from("posts").update(patch).eq("id", id).select(),
      "帖子审核"
    );
    const after = Array.isArray(data) ? data[0] : data;
    if (!after) {
      const e = new Error(
        "这条帖子没有改动（id=" + id + "）—— 数据库把这次改动拒了，多半是账号没有管理权限。"
      );
      e.code = "FORBIDDEN";
      throw e;
    }
    console.log("[api] 审核帖子 " + id + "：status " + before.status + " → " + after.status);
    return after;
  },

  /**
   * 删帖（DELETE → 软删除）。Day 22 补防呆：删之前先确认这条在，
   * 不在就抛中文错，而不是默默回 204 让人以为删掉了。
   *
   * 为什么存在性判断必须前置、不能用 `.delete().select()` 数行数：
   * 触发器把物理删除取消了，被取消的行**不会出现在 RETURNING 里** ——
   * 数行数会把「软删成功」误报成「查无此 id」。详见 fetchRowOrThrow 的注释。
   * 返回被回收的那一行（删除前的快照）。
   */
  async deletePost(id) {
    const row = await fetchRowOrThrow("posts", id, "帖子");
    unwrap(
      await getCloudClient().database.from("posts").delete().eq("id", id),
      "帖子删除"
    );
    console.log("[api] 已回收帖子 " + id + "（软删除：is_deleted=true，公网 GET 立即不再返回）");
    return row;
  },

  /** 管理员读全部线索（普通登录用户只能回读自己的，RLS 定的） */
  async listAllReports() {
    const data = unwrap(
      await getCloudClient().database.from("reports")
        .select("*").order("created_at", { ascending: false }),
      "线索读取"
    );
    return Array.isArray(data) ? data : [];
  },

  /** 删线索（软删除）。Day 22 防呆：先确认这条在，不在即抛中文错。返回删除前的行。 */
  async deleteReport(id) {
    const row = await fetchRowOrThrow("reports", id, "线索");
    unwrap(
      await getCloudClient().database.from("reports").delete().eq("id", id),
      "线索删除"
    );
    console.log("[api] 已回收线索 " + id + "（软删除）");
    return row;
  },

  /** 榜单条目删除（软删除；删错可从 data/data.json 重新灌回，数据有种子兜底） */
  async deleteItem(id) {
    const row = await fetchRowOrThrow("items", id, "条目");
    unwrap(
      await getCloudClient().database.from("items").delete().eq("id", id),
      "条目删除"
    );
    console.log("[api] 已回收条目 " + id + "（软删除）");
    return row;
  },
};
