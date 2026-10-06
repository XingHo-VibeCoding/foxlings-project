/* ============================================================
   api.js — 数据接口层（Day 20 接读接口 · Day 21 接写接口）

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
  const code = error.code || "";
  if (code === "42501" || code === "23502") {
    // 23502 = author_id 非空约束被拒，在发帖场景下等价于「没登录」
    return "这条操作没有被允许——如果是在发帖，请先登录再试。";
  }
  if (code === "23514") return "内容不符合格式要求（标题或正文长度不对）。";
  if (code === "23505") return "这条已经存在了。";
  if (code === "42P01") return "数据表还没建好，请联系站方。";
  return (what || "操作") + "失败：" + (error.message || code || "未知错误");
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
};
