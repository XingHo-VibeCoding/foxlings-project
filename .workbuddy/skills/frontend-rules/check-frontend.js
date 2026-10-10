/* check-frontend.js — frontend-rules Skill 的执行脚本
   六组检查：L 页面层级 / C 颜色与字体 / B 卡片与按钮 / M 移动端 / R 回归底线 / O 观察项
   用法：node check-frontend.js   （需先在项目根目录起 http.server 8000 --bind 127.0.0.1）
   硬门槛（L/C/B/M/R）有任一失败 → 打印 FAIL 行并以退出码 1 结束
   观察项（O）只报告不阻塞，需由项目主人拍板

   Day 15 变更记录（导航结构重构）：
     导航从「首页内三个同页视图」改为「三个主 tab + 个人主页独立页」，
     因此 N 组与 L4 的断言由「写死 #view-feed / #tab-feed」改为「读 data-view 动态推导」，
     **断言强度不变**：首屏落位并规范化 hash、切视图地址栏同步、刷新保持、后退可用、
     非法 hash 回落默认视图、四种状态齐备——一条都没少，只是不再假设视图叫什么名字。

   Day 16 变更记录（数据源扩充）：
     种子数据由 5 条 demo-* 换成 23 条 —— 凡「挑一条真实数据来验」的地方
     （详情页复制、浏览足迹、溢出巡检）一律改为从 data/data.json 现取，不再写死 id。
     写死 id 的代价这次亲身踩到：数据一换，断言全卡在超时，看着像页面崩了。

   Day 17 变更记录（检索页骨架）：
     新增 S 组三条断言，卡住检索页的两件核心交付物（站外兜底入口、L2 查证四步）
     以及「未做的能力必须标注开发中」这条诚实性底线。

   Day 18 变更记录（检索页拆成两个模块）：
     检索页由「一个检索框 + 站外兜底链接」拆成两个模块：站内搜索 / 全网溯源
     （溯源结果再分「官方来源」「网络来源」两组）。S 组随之扩写到 8 条：
     原来那条「站外兜底 ≥3 个跳转按钮」改为「无命中给溯源出口」——
     因为兜底入口现在有了更好的归宿（切模块继续查），比丢四个站外链接更顺；
     新增：官方组/网络组成组且新标签打开、入口带关键词直达、两模块互斥且高亮唯一、
     溯源模块随关键词刷新且清空回引导、溯源模块可深链（#/search/trace）。
     断言强度只增不减：S 组 3 → 9 条，硬门槛总数 68 → 74。

   Day 19 变更记录（论坛骨架）：
     论坛从占位块换成真骨架（列表 + 分类/关键词筛选 + 发帖暂存 + 社区规则）。
     新增 F 组 9 条：占位已换真骨架、**未过审帖子不得进公开列表**（审核机制）、
     分类筛选生效、无命中给清空出口且能恢复、发帖区标注开发中、审核规则已写明、
     样例帖已标明、发帖暂存写进与个人主页同一个键、论坛按钮触控达标。
     硬门槛总数 74 → 83。

   Day 21 变更记录（论坛接后端 · 发帖需登录）：
     帖子改从云库读、发帖写云库（先进审核队列），发帖前必须先登录。
     F 组两条随语义更换（**不是删掉**）：
       · 「发帖区标注开发中」→「未登录时不给发帖表单」——能力接通了，诚实性底线的
         标的从"标注开发中"变成"别假装能发"；
       · 「发帖暂存写同一键」→「登录出口能开面板且入口齐全」——链条从本机暂存
         升级成真发布，要盯的就变成登录面板四个入口（邮箱/验证码/密码/忘记密码）
         一个都不能少，少一个就有用户进不来。
     新增两条平台约束：只提供邮箱登录（手机号、微信是小程序端的，Web 上做了也是假的）、
     登录面板的按钮同样要 ≥44px（面板挂在 body 上，B5/F9 都扫不到它）。

   Day 21 板块三变更记录（分层收口）：
     新增 A 组 2 条，把「分层」从口头约定变成硬门槛：页面脚本（data/home/search/
     forum/mine/detail）不得出现 cloud.database / .from( / WorkBuddyCloud / fetch(，
     登录动作只许待在 auth.js —— 源码扫描，改哪层就在哪层。
     硬门槛总数 85 → 87（F 组换 2 增 2，A 组新增 2）。

   Day 22 变更记录（点亮 L3 · AI 溯源助手）：
     L3 从「界面占位」变成真能力（把材料拆成「主张 / 常见套路 / 必查三件事 / 检索式」，
     并给可点的检索式），于是两处语义随能力升级更换（同样是**换标的**，不是删断言）：
       · S3「未做的能力标注开发中」→「能力边界标注不联网」——接通的是"整理"，
         没接通的是"联网抓取"（托管后端只有 LLM、没有搜索通道），要标的正是后一条；
       · A 组新增 3 条守 AI 的纪律：页面脚本不许自己调模型（只许 ai.js）、
         调用必须走流式且 messages[0] 是 system、提示词里必须留着「不做真伪判决」
         与「不许输出网址」两条底线 —— 第一条是产品定位，第二条是防编造。
     新增 S 组 4 条盯 AI 区的界面纪律（引导态不留白、AI 生成标注在位、
     输入过短不发模型请求、按钮触控达标）。
     硬门槛总数 87 → 94。
     硬门槛总数 94 → 100（个性化那一版）。

   Day 23 变更记录（管理后台 · 浏览量 · 热度算法）：
     ① 管理后台（admin.html / js/admin.js）纳入检查面：该页一并进了静态审计、
        A 组分层扫描与 H 组结构契约（admin.js 已是 PAGE_SCRIPTS 的一员），
        另加「后台入口默认 hidden、由服务端判定点亮」的显隐契约。
        硬门槛总数 100 → 105。
     ② 辟谣榜排序由「heat 降序」改成「(heat + 真实浏览) × 0.5^(距今天数/14)」。
        浏览量走数据库函数 bump_item_view 原子自增 —— items 表本身仍然只读，
        客户端连 UPDATE 权限都没有（实测 PATCH 一律 permission denied），
        所以「+1」是墙上开的一扇小窗，不是拆门。新增 V 组 6 条：
        分层 2 条（页面不许出现 bump_item_view / 接口层必须实现它）、
        公式 1 条（半衰期常量与 heatScore 都在位）、
        端到端机制 2 条（打开详情真 +1 / 同设备不重复计数）、
        呈现 1 条（有浏览量的卡片必须把数字露出来）；A1 的正则补上 rpc(。
        ⚠️ V4/V5 会真写一次线上浏览计数（靶子取 SEED_ITEMS[1]，与前面用
        SEED_ITEMS[0] 的断言错开）—— 那是脚本自己打开详情页产生的真实浏览。
        硬门槛总数 105 → 111。
     ③ 「拿本地种子当死基准」这个坑当天第三次踩到：种子里那条「【待审样例】」
        在管理后台被真的点了「通过」之后，它**本来就该**出现在公开列表里，
        而 F2 的老写法（拿种子 pending 标题去页面上搜）只会红给你看。
        F2 改成自适应：靶子 = 「种子说 pending」∩「云端此刻确实还没过审」
        （云端状态由页面自己读，访客身份读得到就说明已过审），
        一条可验靶子都没有时记观察项、不判失败。
        另新增 F12 从源码层堵住通往坏结果的唯一那条路：
        论坛不许出现管理侧的 listAllPosts / listAllReports（读了全量等于
        把审核闸门从数据库搬到前端把守）。
        硬门槛总数 111 → 112。
     ④ Day 21 第三周验收：复验挖出一个真 bug —— `.card.pop { animation: popIn .45s both }`
        的 `both` 把动画结束后的 transform 长期锁住，CSS 动画优先级又压过 :hover 普通声明，
        于是「卡片悬停上移」在现场从来没生效过（只有阴影变深）。
        **旧断言为什么没拦住**：它只查 `transform !== 'none'`，而动画留下的单位矩阵
        `matrix(1,0,0,1,0,0)` 也不是 'none' —— 弱断言式的假绿。
        修两处：B1 改成**实测 Y 位移是否真的变了**（弱断言 → 强断言），
        另加 B1b 从源码层堵住根因（`.card.pop` 的动画填充不许是 both/forwards）。
        硬门槛总数 112 → 113。 */
const fs = require('fs');

/* playwright-core 与 Edge 的定位（Day 22 修）
   原写法把 node 运行时目录 + 版本号写死。当天环境换过运行时目录的版本号，
   三个检查脚本一起失灵（报的却是「找不到模块」）—— 是脚本自己过期了，不是页面坏了。
   改成候选顺序查找；Edge 的两种安装位置也一并兜底。 */
function pickRequire(cands) {
  for (const p of cands) { try { return require(p); } catch (e) { /* 试下一个 */ } }
  return null;
}
const PW = pickRequire([
  'C:/Users/狐灵/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
  'playwright-core',
]);
if (!PW) { console.error('脚本失败: 找不到 playwright-core（请在托管 node 工作区 npm install playwright-core）'); process.exit(1); }

const ROOT = 'D:/AI/foxlings-project';
const BASE = 'http://localhost:8000';
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p)) || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/* 示例条目 id **不写死**，从 data.json 动态取。
   Day 16 教训：种子数据从 demo-005 换成 20261005-01 后，写死 id 的断言全部
   停在「等 #copy-btn 出现」而超时，看起来像页面坏了，其实是脚本自己过期了。
   凡是「挑一条真实数据来验」的地方，都从数据源现取。 */
const SEED_ITEMS = (JSON.parse(fs.readFileSync(ROOT + '/data/data.json', 'utf8')).items) || [];
const SAMPLE_ID = (SEED_ITEMS[0] || {}).id || '';
if (!SAMPLE_ID) { console.error('脚本失败: data/data.json 里没有可用条目'); process.exit(1); }

/* 论坛帖子同理：条数与「待审样例」都从 data/posts.json 现取，不写死。
   待审样例是 F2 的靶子——没有它 F2 会直接 FAIL，而不是静默通过。 */
const SEED_POSTS = (JSON.parse(fs.readFileSync(ROOT + '/data/posts.json', 'utf8')).posts) || [];
const APPROVED_POSTS = SEED_POSTS.filter((p) => p.status === 'approved');
const PENDING_TITLES = SEED_POSTS.filter((p) => p.status !== 'approved').map((p) => String(p.title).slice(0, 10));
if (!APPROVED_POSTS.length) { console.error('脚本失败: data/posts.json 里没有已通过的帖子'); process.exit(1); }

const R = {}; // 硬门槛
const O = {}; // 观察项

/* ============ 一、静态审计：读文件、算色值 ============ */

const css = fs.readFileSync(ROOT + '/css/style.css', 'utf8');
const pages = {
  index: fs.readFileSync(ROOT + '/index.html', 'utf8'),
  detail: fs.readFileSync(ROOT + '/detail.html', 'utf8'),
  mine: fs.readFileSync(ROOT + '/mine.html', 'utf8'),
  admin: fs.readFileSync(ROOT + '/admin.html', 'utf8'),
};

// 取出 :root 里成对的变量名 → 色值
const rootBlock = (css.match(/:root\s*\{([\s\S]*?)\}/) || [, ''])[1];
const varMap = {};
(rootBlock.match(/--[\w-]+\s*:\s*#[0-9a-fA-F]{3,6}/g) || []).forEach((pair) => {
  const [k, v] = pair.split(/\s*:\s*/);
  varMap[k.trim()] = v.trim().toLowerCase();
});

// WCAG 相对亮度与对比度
function lum(hex) {
  const h = hex.replace('#', '');
  const chan = [0, 2, 4].map((i) => {
    const two = h.length === 3 ? h[i].repeat(2) : h.substr(i, 2);
    const c = parseInt(two, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}
const cr = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const r2 = (n) => Math.round(n * 100) / 100;

/* ---- L 页面层级（静态部分） ---- */
const pageRules = [
  ['L6_lang中文', (h) => /<html\s+lang="zh-CN"/.test(h)],
  ['L6_UTF8', (h) => /charset="UTF-8"/i.test(h)],
  ['L6_viewport', (h) => /name="viewport"/.test(h)],
  ['L1_有container', (h) => /class="container"/.test(h)],
  ['L1_四段式', (h) => /class="site-header"/.test(h) && /<main class="container">/.test(h) && /class="site-footer"/.test(h)],
];
Object.entries(pages).forEach(([name, html]) => {
  pageRules.forEach(([key, fn]) => { R[`${key}_${name}`] = fn(html); });
});
// L5 详情页必须有回家的链接，首页不该有
R['L5_详情页有返回首页'] = /class="back-link"[^>]*href="index\.html"/.test(pages.detail);
R['L5_首页不设返回'] = !/class="back-link"/.test(pages.index);

/* ---- C1 变量齐全 ---- */
const REQUIRED_VARS = ['--c-primary', '--c-bg', '--c-card', '--c-text', '--c-muted',
  '--c-fake', '--c-partial', '--c-true', '--c-doubt',
  '--c-fake-soft', '--c-fake-deep', '--c-partial-soft', '--c-partial-deep',
  '--c-true-soft', '--c-true-deep', '--c-doubt-soft', '--c-doubt-deep'];
R['C1_九个色值变量齐全'] = REQUIRED_VARS.every((v) => varMap[v]);
R['C1_圆角与阴影变量齐全'] = /--radius\s*:/.test(rootBlock) && /--shadow\s*:/.test(rootBlock) && /--shadow-hover\s*:/.test(rootBlock);

/* ---- C2 对比度（正文类，硬门槛 4.5:1） ---- */
R['C2_正文对页面底≥4.5'] = cr(varMap['--c-text'], varMap['--c-bg']) >= 4.5;
R['C2_正文对卡片≥4.5'] = cr(varMap['--c-text'], varMap['--c-card']) >= 4.5;
R['C2_次要文字对卡片≥4.5'] = cr(varMap['--c-muted'], varMap['--c-card']) >= 4.5;
R['C2_次要文字对页面底≥4.5'] = cr(varMap['--c-muted'], varMap['--c-bg']) >= 4.5;
R['C2_主色按钮白字≥4.5'] = cr('#ffffff', varMap['--c-primary']) >= 4.5;

/* ---- C4 色值审计：有没有偷偷新写的颜色 ---- */
const VAR_VALUES = new Set(Object.values(varMap));
const NEUTRAL_WHITELIST = new Set(['#e8eaf1', '#e0e3ec', '#555', '#d0d4e2', '#cdd2e0',
  '#eef1ff', '#4a5165', '#d5d9e4', '#2e49d6', '#fff']);
const allHex = new Set((css.match(/#[0-9a-fA-F]{3,6}/g) || []).map((s) => s.toLowerCase()));
const unregistered = [...allHex].filter((c) => !VAR_VALUES.has(c) && !NEUTRAL_WHITELIST.has(c));
R['C4_无未登记色值'] = unregistered.length === 0;
if (unregistered.length) O['C4_未登记色值明细'] = unregistered.join(' ');

/* ---- C7 字号阶梯 ---- */
const usedFontSizes = [...new Set((css.match(/font-size:\s*(\d+)px/g) || [])
  .map((s) => parseInt(s.match(/\d+/)[0], 10)))].sort((a, b) => a - b);
R['C7_字号不越界'] = usedFontSizes.every((n) => n >= 12 && n <= 22);
O['C7_实际用到的字号'] = usedFontSizes.join(', ');

/* ---- C6 字体栈 ---- */
R['C6_字体栈一致'] = /font-family:\s*"Segoe UI",\s*"Microsoft YaHei",\s*sans-serif/.test(css);

/* ---- C2b 结论标签对比度（浅底 + 深字，12px 小字必须 ≥4.5:1） ----
   Day 12 延伸：原为白字压原色底，实测仅 2.35~4.13:1，不达标；
   改为浅底深字后达标，此处固化为硬门槛，防止改回白字。 */
const TAG_PAIRS = [['假', '--c-fake-soft', '--c-fake-deep'],
  ['部分属实', '--c-partial-soft', '--c-partial-deep'],
  ['真', '--c-true-soft', '--c-true-deep'],
  ['存疑', '--c-doubt-soft', '--c-doubt-deep']];
TAG_PAIRS.forEach(([label, bgV, fgV]) => {
  const fg = varMap[fgV], bg = varMap[bgV];
  if (!fg || !bg) { R[`C2b_标签对比度_${label}≥4.5`] = false; return; }
  const v = cr(fg, bg);
  R[`C2b_标签对比度_${label}≥4.5`] = v >= 4.5;
  O[`标签对比度_${label}`] = r2(v);
});

O['正文对比度_对页面底'] = r2(cr(varMap['--c-text'], varMap['--c-bg']));
O['次要文字对比度_对卡片'] = r2(cr(varMap['--c-muted'], varMap['--c-card']));

/* ============ 二、浏览器实测 ============ */

(async () => {
  const browser = await PW.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 790 } });
  const errors = [];
  // Day 22：AI 调用是「真花钱」的请求，这里把请求记下来（只记不改），
  // 供 S12 断言「输入过短时不该发模型请求」——空点也能烧应用方额度，必须挡住。
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const overflowNow = () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-list .card');

  /* ---- L2/L3 运行时结构 ---- */
  R['L1_容器宽760'] = (await page.locator('.container').first().evaluate(
    (el) => getComputedStyle(el).maxWidth)) === '760px';
  R['L2_单视图可见'] = (await page.locator('.view.active').count()) === 1;
  const viewCount = await page.locator('.view').count();
  const tabBtnCount = await page.locator('#view-tabs button.nav-tab').count();
  R['L2_视图数与tab数一致'] = viewCount === tabBtnCount && viewCount >= 2;
  R['L3_视图切换生效'] = await (async () => {
    const before = await page.locator('.view.active').getAttribute('id');
    await page.locator('#view-tabs button.nav-tab').nth(1).click();
    await page.waitForTimeout(350);
    const after = await page.locator('.view.active').getAttribute('id');
    await page.locator('#view-tabs button.nav-tab').nth(0).click();
    await page.waitForTimeout(350);
    return before !== after;
  })();
  // tab 必须是原生 button（键盘天然可达），不能用 div 冒充
  R['L3_tab是原生button'] = tabBtnCount >= 2;
  // 每个视图都要有 aria-label；标签要能对上一个视图
  R['L4_视图有aria标签'] = await (async () => {
    const views = await page.locator('.view').all();
    for (const v of views) {
      const label = await v.getAttribute('aria-label');
      const labelledby = await v.getAttribute('aria-labelledby');
      if (!label && !labelledby) return false;
    }
    const controls = await page.locator('#view-tabs button.nav-tab').first().getAttribute('aria-controls');
    return !!(await page.locator('#' + controls).count());
  })();
  R['L4_筛选器容器语义'] = (await page.locator('#verdict-filter').getAttribute('role')) === 'group'
    && !!(await page.locator('#verdict-filter').getAttribute('aria-label'));

  /* ---- B1/B3 卡片形态 ---- */
  const card = page.locator('#board-list .card').first();
  R['B1_卡片圆角为变量值'] = (await card.evaluate((el) => getComputedStyle(el).borderRadius)) === '12px';
  R['B1_卡片有阴影'] = (await card.evaluate((el) => getComputedStyle(el).boxShadow)) !== 'none';
  R['B2_卡片是链接'] = (await card.evaluate((el) => el.tagName)) === 'A';
  R['B3_卡片标题16px'] = (await page.locator('.card-title').first().evaluate(
    (el) => getComputedStyle(el).fontSize)) === '16px';
  R['B3_卡片摘要13px'] = (await page.locator('.card-summary').first().evaluate(
    (el) => getComputedStyle(el).fontSize)) === '13px';

  /* ---- C2b 实测：页面上标签的真实渲染色对比度（防 CSS 变量被绕过） ---- */
  const tagPairs = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.tag').forEach((el) => {
      out[el.textContent.trim()] = {
        fg: getComputedStyle(el).color,
        bg: getComputedStyle(el).backgroundColor,
      };
    });
    return out;
  });
  const rgb2hex = (s) => {
    const m = String(s).match(/\d+/g);
    return m ? '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('') : null;
  };
  R['C2b_标签实测_渲染色达标'] = Object.keys(tagPairs).length > 0 &&
    Object.entries(tagPairs).every(([, v]) => {
      const fg = rgb2hex(v.fg), bg = rgb2hex(v.bg);
      return !!(fg && bg) && cr(fg, bg) >= 4.5;
    });
  O['C2b_页面出现的标签'] = Object.keys(tagPairs).join(' / ') || '(无)';
  Object.entries(tagPairs).forEach(([k, v]) => {
    const fg = rgb2hex(v.fg), bg = rgb2hex(v.bg);
    if (fg && bg) O[`标签实测对比度_${k}`] = r2(cr(fg, bg));
  });

  // 装饰角标（热度）同样是小字浅底深字，一并纳入实测
  const badgePairs = await page.evaluate(() => {
    const el = document.querySelector('.heat-badge');
    if (!el) return null;
    return { fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor };
  });
  if (badgePairs) {
    const fg = rgb2hex(badgePairs.fg), bg = rgb2hex(badgePairs.bg);
    R['C2b_热度角标实测_达标'] = !!(fg && bg) && cr(fg, bg) >= 4.5;
    if (fg && bg) O['热度角标实测对比度'] = r2(cr(fg, bg));
  } else {
    O['热度角标实测对比度'] = '页面上没出现 .heat-badge';
  }

  // B1 hover 有反馈（Day 21 加固）
  // 旧写法只查 transform !== 'none' —— 会被入场动画跑完后留下的单位矩阵
  // matrix(1,0,0,1,0,0) 骗过（它也不是 'none'），于是「悬停其实没动」照样绿。
  // 改成实测 Y 位移到底变没变。
  const yOfCard = () => card.evaluate((el) => {
    const t = getComputedStyle(el).transform;
    return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
  });
  // 先把鼠标移开再量基准值，免得上一段交互的悬停残留让基准本身就是 -4
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const hoverYBefore = await yOfCard();
  await card.hover();
  await page.waitForTimeout(450);
  const hoverYAfter = await yOfCard();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  // 断言「真的向上位移了」，而不是「transform 不等于 none」
  R['B1_卡片hover有反馈'] = hoverYAfter < hoverYBefore;
  O['B1_hover位移px'] = hoverYBefore + ' → ' + hoverYAfter;

  // B1b 根因护栏（源码层）：卡片入场动画不许用 both/forwards 填充
  // —— 那会把动画结束后的 transform 长期锁住，压掉 :hover 的位移（Day 21 实测踩过）
  R['B1b_入场动画不长期占用transform'] =
    !/\.card\.pop\s*\{[^}]*animation\s*:[^;}]*\b(both|forwards)\b/.test(css);

  /* ---- B5 触控尺寸：首页所有可点按钮 ---- */
  const tooSmall = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ t: b.textContent.trim().slice(0, 8), h: Math.round(b.getBoundingClientRect().height) }))
      .filter((x) => x.h < 44));
  R['B5_首页按钮均≥44px'] = tooSmall.length === 0;
  if (tooSmall.length) O['B5_过小的按钮'] = JSON.stringify(tooSmall);

  /* ---- B7 焦点环 ---- */
  R['B7_有focus-visible规则'] = /:focus-visible\s*\{[^}]*outline:/.test(css);

  /* ---- M1 三档宽度 × 五个页面的溢出 ----
     Day 15 起覆盖面从「首页 + 详情页」扩到「三视图 + 详情页 + 个人主页」 */
  const widths = [375, 768, 1280];
  const views = ['board', 'search', 'forum'];
  let totalOverflow = 0;
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 790 });
    for (const v of views) {
      await page.goto(BASE + '/#/' + v, { waitUntil: 'networkidle' });
      await page.waitForTimeout(350);
      totalOverflow += await overflowNow();
    }
    await page.goto(BASE + '/detail.html?id=' + SAMPLE_ID, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    totalOverflow += await overflowNow();
    await page.goto(BASE + '/mine.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    totalOverflow += await overflowNow();
  }
  R['M1_三档零横向溢出'] = totalOverflow === 0;
  O['M1_溢出合计px'] = totalOverflow;

  /* ---- N 组：视图路由与四种状态（结构无关写法，Day 15 改） ---- */
  await page.setViewportSize({ width: 1280, height: 790 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-list .card');
  const hashOf = () => page.evaluate(() => location.hash);
  const viewIdOf = () => page.evaluate(() => (document.querySelector('.view.active') || {}).id || '');
  const tabView = (i) => page.locator('#view-tabs .nav-tab').nth(i).getAttribute('data-view');

  // N1 首屏：落在默认视图，且地址栏被规范化成对应 hash
  R['N1_首屏落位并规范化hash'] = await (async () => {
    const id = (await viewIdOf()) || '';
    return id.indexOf('view-') === 0 && (await hashOf()) === '#/' + id.slice(5);
  })();

  // N6 导航标签的无障碍语义（tablist + aria-selected + aria-controls 指到真视图）
  R['N6_标签是tablist语义'] = await (async () => {
    const listRole = await page.locator('#view-tabs').getAttribute('role');
    const first = page.locator('#view-tabs .nav-tab').first();
    const selected = await first.getAttribute('aria-selected');
    const controls = await first.getAttribute('aria-controls');
    const dv = await first.getAttribute('data-view');
    return listRole === 'tablist' && selected === 'true' &&
      controls === 'view-' + dv && (await page.locator('#' + controls).count()) === 1;
  })();

  // N2 切视图时地址栏同步（路由的核心：视图 = 可分享的地址）
  const firstView = await tabView(0);
  const secondView = await tabView(1);
  await page.locator('#view-tabs .nav-tab').nth(1).click();
  await page.waitForTimeout(400);
  R['N2_切视图地址栏同步'] = (await viewIdOf()) === 'view-' + secondView && (await hashOf()) === '#/' + secondView;

  // N3 刷新后仍停在同一视图（纯 class 切换做不到这条）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  R['N3_刷新保持当前视图'] = (await viewIdOf()) === 'view-' + secondView;

  // N4 浏览器后退可用
  await page.goBack();
  await page.waitForTimeout(500);
  R['N4_浏览器后退可用'] = (await viewIdOf()) === 'view-' + firstView;

  // N5 非法 hash 必须回落默认视图，不能白屏
  await page.goto(BASE + '/#/没有这个视图', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  R['N5_非法hash回落默认视图'] = (await viewIdOf()) === 'view-' + firstView;

  // N7 四种状态都要能出现：加载中 / 空 / 错误 / 正常
  await page.goto(BASE + '/?demo=loading', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const stLoading = (await page.locator('#board-list .state-loading .spinner').count()) === 1;
  await page.goto(BASE + '/?demo=empty', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const stEmpty = (await page.locator('#board-list .state-empty').count()) === 1;
  await page.goto(BASE + '/?demo=error', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const stError = (await page.locator('#board-list .state-error').count()) === 1;
  const stRetry = (await page.locator('#board-list .state-error .empty-jump').count()) === 1;
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-list .card');
  const stNormal = (await page.locator('#board-list .empty-state').count()) === 0;
  R['N7_四种状态都能出现'] = stLoading && stEmpty && stError && stNormal;
  R['N8_错误态给出重试出口'] = stRetry;
  O['N7_四态明细'] = JSON.stringify({ loading: stLoading, empty: stEmpty, error: stError, normal: stNormal });

  /* ---- S 组：检索页两个模块的核心交付物（Day 17 新增，Day 18 随模块化扩写） ----
     检索页拆成「站内搜索」+「全网溯源」两个模块，两者的立身之本各断一条：
       站内：没命中必须给出口（清空 + 指向全网溯源），不能只回一句「没找到」就让人走投无路；
       溯源：必须真的分成「官方来源」和「网络来源」两组入口，且入口带关键词直达。
     另断：L2 查证四步清单常显、**能力边界必须有标注**（Day 22 起标的是「不联网」）、
     两模块互斥显示、溯源模块可深链（分享/刷新不丢模块）。 */
  await page.goto(BASE + '/#/search', { waitUntil: 'networkidle' });
  await page.waitForSelector('#search-input');
  await page.fill('#search-input', 'zzz绝不存在zzz');
  await page.waitForTimeout(400);

  // ① 站内模块：无命中给两条路（清空关键词 / 去全网溯源）
  R['S1_站内无命中给溯源出口'] = (await page.locator('#search-results .empty-jump').count()) >= 1 &&
    (await page.locator('#search-results #search-to-trace').count()) === 1;
  R['S2_查证清单四步齐备'] = (await page.locator('#view-search .guide-steps li').count()) === 4;

  /* S3 能力边界标注（Day 17 立，Day 22 换标的）
     Day 17~21：L3 没做，标「开发中」，不许假装已有。
     Day 22：L3 的点亮只点亮了「整理」这半边——「联网抓取」在本环境做不了
     （托管后端只有 LLM、没有搜索通道）。所以标注对象从「开发中」换成「不联网」：
     要标的从来不是「没做」，而是「哪一部分没做」。 */
  R['S3_能力边界有标注'] = (await page.locator('#view-search .soon').count()) === 1 &&
    (await page.locator('#view-search .soon').first().innerText()).trim() === '不联网';

  // ② 溯源模块：从站内无命中处点过去，必须真的切成溯源、并给出两组入口
  await page.locator('#search-results #search-to-trace').click();
  await page.waitForTimeout(400);
  const OFFICIAL = '#trace-results .trace-group-official .trace-link';
  const WEBLINK = '#trace-results .trace-group-web .trace-link';
  const nOfficial = await page.locator(OFFICIAL).count();
  const nWeb = await page.locator(WEBLINK).count();
  R['S4_溯源官方来源成组'] = nOfficial >= 3 &&
    (await page.locator(OFFICIAL + '[target="_blank"]').count()) === nOfficial;
  R['S5_溯源网络来源成组'] = nWeb >= 3 &&
    (await page.locator(WEBLINK + '[target="_blank"]').count()) === nWeb;
  // 入口必须带关键词直达（不能把人丢到首页让他自己再搜一次）
  R['S6_溯源入口带关键词'] =
    (await page.locator(OFFICIAL + '[href*="' + encodeURIComponent('zzz绝不存在zzz') + '"]').count()) >= 1;

  // ③ 两模块互斥：同一时刻只显示一个，切换器唯一高亮且 aria-pressed 同步
  R['S7_两模块互斥且高亮唯一'] = await (async () => {
    const traceOn = await page.locator('#mode-trace').isVisible();
    const insideOn = await page.locator('#mode-inside').isVisible();
    const active = await page.locator('#search-modes .tab.active').count();
    const pressed = await page.locator('#search-modes .tab[aria-pressed="true"]').count();
    return traceOn && !insideOn && active === 1 && pressed === 1;
  })();

  // ④ 溯源模块随关键词刷新 + 清空回引导态（与站内模块同构的三态）
  R['S9_溯源随关键词刷新'] = await (async () => {
    await page.fill('#search-input', '养老金');
    await page.waitForTimeout(400);
    const has = (await page.locator('#trace-results .trace-link').count()) > 0;
    await page.fill('#search-input', '');
    await page.waitForTimeout(400);
    const back = (await page.locator('#trace-results .trace-link').count()) === 0 &&
      (await page.locator('#trace-results .empty-state').count()) === 1;
    return has && back;
  })();

  // ⑤ 深链：直接打开 #/search/trace 也必须落在溯源模块（否则「把链接发给同伴」就失效）
  await page.goto(BASE + '/#/search/trace', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  R['S8_溯源模块可深链'] = (await page.locator('#mode-trace').isVisible()) &&
    !(await page.locator('#mode-inside').isVisible());

  /* ---- S 组续：AI 溯源助手（L3 点亮 · Day 22 新增） ----
     L3 是本站第一个「点一下就会花应用方钱」的功能，界面纪律要单独钉：
     引导态不留白、AI 生成标注在位、**输入过短不许发模型请求**（空点也能烧额度）、
     按钮触控达标。这里刻意**不**在检查里真跑一次模型调用：检查要能离线重复跑，
     而真调用在本地会因 Origin 校验失败 —— 线上真调用由 probe-online.js 负责验。 */
  R['S10_AI区有引导态'] = (await page.locator('#ai-result .empty-state').count()) === 1;
  R['S11_AI生成标注在位'] = (await page.locator('#ai-title .ai-badge').count()) === 1;

  R['S12_输入过短不发模型请求'] = await (async () => {
    const countLlm = () => requests.filter((u) => /\/\.cloud\/llm|chat\/completions/.test(u)).length;
    const before = countLlm();
    await page.fill('#ai-input', '短');
    await page.locator('#ai-run').click();
    await page.waitForTimeout(700);
    const after = countLlm();
    const guided = (await page.locator('#ai-result .empty-state').count()) === 1 &&
      (await page.locator('#ai-result .state-error').count()) === 0;
    await page.fill('#ai-input', '');
    return after === before && guided;
  })();

  R['S13_AI按钮触控达标'] = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.ai-panel button')].filter((b) => b.offsetParent !== null);
    return btns.length >= 3 && btns.every((b) => Math.round(b.getBoundingClientRect().height) >= 44);
  });

  /* ---- F 组：论坛（F3 骨架 · Day 19 新增） ----
     论坛的立身之本，逐条钉死：
       ① 骨架必须真是能用的列表（占位块已撤，帖子真的渲染出来）；
       ② **未过审的帖子不得进公开列表**——审核机制是法规前提，先在界面上立住；
       ③ 无命中不是死胡同（清空出口 + 能恢复）；
       ④ 用户内容必须写明社区规则与审核（合规底线，不能只有一句「开发中」）；
       ⑤ 没做的能力如实标注，样例数据必须标明是样例（与检索页同一条诚实底线）。 */
  await page.goto(BASE + '/#/forum', { waitUntil: 'networkidle' });
  await page.waitForSelector('#forum-list .post-card');

  // 基准不再写死本地种子的条数：论坛是**活的**——用户发的帖过审后就会多出一条。
  // 改成拿页头徽卡「已通过」的数字当基准，与列表条数交叉验证：
  // 两边不一致才是真错；线上比种子多，是正常的。
  const forumApprovedNum = await page.evaluate(() => {
    const cards = document.querySelectorAll('#forum-stats .stat-card');
    for (const c of cards) {
      if ((c.textContent || '').indexOf('已通过') !== -1) {
        const n = c.querySelector('.stat-num');
        return n ? parseInt(n.textContent, 10) : -1;
      }
    }
    return -1;
  });
  const forumListed = await page.locator('#forum-list .post-card').count();

  R['F1_论坛已换真骨架'] = (await page.locator('#view-forum .placeholder').count()) === 0 &&
    forumListed > 0 && forumListed === forumApprovedNum &&
    forumApprovedNum >= APPROVED_POSTS.length;   // 种子帖一条都不能少（线上只多不少）
  if (!R['F1_论坛已换真骨架']) O['F1_基准'] = '列表 ' + forumListed + ' 条 / 徽卡 ' +
    forumApprovedNum + ' 条 / 种子 ' + APPROVED_POSTS.length + ' 条';

  /* 待审样例的标题一个字都不许出现在公开列表里。

     Day 23 修（同一个坑第三次）：靶子不能只认「本地种子的 pending」。
     「【待审样例】」那条在管理后台被真的点了「通过」之后，它**本来就该**出现在
     公开列表里 —— 老写法却把它当泄漏，直接报红。这和当天早些时候
     「拿本地种子条数当死基准」是同一类错误：活数据不能当基准。

     现在的靶子 = 「种子说是 pending」∩「云端此刻确实还没过审」。
     云端状态由页面自己读（访客身份，RLS 只返回 approved）——
     读得到就等于已经过审了，不再是靶子。
     一条可验靶子都没有时（待审帖都处理完了）记观察项、不判失败：
     那时前端本来就无从泄漏，硬报红只会训练人「看见红字当噪声」。 */
  const viewableTitles = await page.evaluate(async () => {
    try { return (await api.getPosts()).map((p) => String(p.title)); }
    catch (e) { return null; }
  });
  const pendTargets = viewableTitles
    ? PENDING_TITLES.filter((t) => !viewableTitles.some((x) => x.indexOf(t) !== -1))
    : [];
  R['F2_未过审帖子不进公开列表'] = await page.evaluate((titles) => {
    if (!titles.length) return true;                    // 没有可验的靶子：无从泄漏
    const txt = (document.querySelector('#forum-list') || {}).textContent || '';
    return titles.every((t) => txt.indexOf(t) === -1);
  }, pendTargets);
  O['F2_靶子'] = pendTargets.length
    ? '可验 ' + pendTargets.length + ' 条（' + pendTargets.join('、') + '）'
    : '无可验靶子 —— 种子里的待审样例在云端已过审（' + PENDING_TITLES.join('、') + '）';

  /* F12：论坛永远只走「普通读接口」。
     别人的待审帖在普通读接口下**根本拿不到**（RLS 的 posts_read 只给 approved
     或作者本人），所以「列表里不出现未过审帖」这件事是数据库保证的。
     能打破它的只有一条路：页面改用管理侧的 listAllPosts() 去读全量 ——
     那等于把审核闸门从数据库搬到前端来把守。
     F2 断的是「结果」，这条断的是「通往坏结果的唯一那条路」，两条合起来才完整。
     （这里不用 readSrc：那个 const 定义在后面的 A 组，提前引用会撞 TDZ。） */
  R['F12_论坛不读全量帖子'] = !/listAllPosts|listAllReports/.test(
    fs.readFileSync(ROOT + '/js/forum.js', 'utf8'));

  // 分类筛选：点「已解决」后列表里只剩这一类，且回「全部」能恢复
  R['F3_分类筛选生效'] = await (async () => {
    await page.locator('#forum-cats .chip[data-cat="已解决"]').click();
    await page.waitForTimeout(350);
    const cats = await page.locator('#forum-list .post-cat').allTextContents();
    const only = cats.length > 0 && cats.every((t) => t.trim() === '已解决');
    const uniq = (await page.locator('#forum-cats .chip.active').count()) === 1;
    await page.locator('#forum-cats .chip[data-cat="all"]').click();
    await page.waitForTimeout(350);
    const back = (await page.locator('#forum-list .post-card').count()) === forumListed;
    return only && uniq && back;
  })();

  // 无命中：零条目 + 统一文案 + 出口按钮，点出口能回到基线
  R['F4_论坛无命中给清空出口'] = await (async () => {
    await page.fill('#forum-search', 'zzz绝不存在zzz');
    await page.waitForTimeout(400);
    const zero = (await page.locator('#forum-list .post-card').count()) === 0;
    const text = (await page.locator('#forum-list').textContent()).indexOf('没有找到相关内容') !== -1;
    const hasExit = (await page.locator('#forum-list .empty-jump').count()) >= 1;
    await page.locator('#forum-list .empty-jump').first().click();
    await page.waitForTimeout(400);
    const back = (await page.locator('#forum-list .post-card').count()) === forumListed &&
      (await page.inputValue('#forum-search')) === '';
    return zero && text && hasExit && back;
  })();

  // Day 21：发帖已接通后端（需登录），所以这条从「标注开发中」改成「门槛立得住」——
  // 未登录只给登录出口，不给能提交的表单（发了也发不出去，界面不该假装可以）
  R['F5_未登录时不给发帖表单'] = (await page.locator('#compose-guest').isVisible()) &&
    !(await page.locator('#compose-form').isVisible());
  R['F6_样例帖已标明'] = (await page.locator('#view-forum .forum-sample-note').textContent())
    .indexOf('样例') !== -1;

  // 合规底线：社区规则里必须写明「审核」这件事
  R['F7_审核规则已写明'] = await (async () => {
    const txt = await page.locator('#view-forum .guide-block').textContent();
    return txt.indexOf('审核') !== -1 && (await page.locator('#view-forum .guide-steps li').count()) === 4;
  })();

  // Day 21：登录出口必须真的能打开登录面板（不能是个死按钮），且四种入口一个不少：
  // 邮箱、验证码、密码登录、忘记密码 —— 少一个就等于某种用户进不来
  R['F8_登录出口能开面板且入口齐全'] = await (async () => {
    await page.locator('#compose-signin').click();
    await page.waitForTimeout(400);
    const open = await page.locator('#auth-mask').isVisible();
    const parts = [
      await page.locator('#auth-email').count(),
      await page.locator('#auth-send').count(),
      await page.locator('#auth-code').count(),
      await page.locator('#auth-modes [data-auth-mode="pwd"]').count(),
      await page.locator('#auth-forgot').count(),
    ];
    const full = parts.every((n) => n === 1);
    await page.locator('#auth-close').click();
    await page.waitForTimeout(300);
    return open && full && !(await page.locator('#auth-mask').isVisible());
  })();

  // 论坛自己的按钮也要够大（B5 只扫得到当前可见视图里的按钮）
  R['F9_论坛按钮均≥44px'] = (await page.evaluate(() =>
    [...document.querySelectorAll('#view-forum button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => Math.round(b.getBoundingClientRect().height))
      .filter((h) => h < 44))).length === 0;

  // Day 21：Web 应用只支持邮箱登录（手机号/微信只在小程序端有）——
  // 界面上不许出现这些入口，免得用户点下去才发现这条路不存在
  R['F10_只提供邮箱登录'] = await (async () => {
    await page.locator('#compose-signin').click();
    await page.waitForTimeout(300);
    const txt = await page.locator('#auth-mask').textContent();
    const bad = /短信登录|微信登录|手机号登录|手机号注册|扫码登录/.test(txt);
    await page.locator('#auth-close').click();
    await page.waitForTimeout(250);
    return !bad;
  })();

  // 登录面板的按钮也要够大：面板挂在 body 上，B5/F9 都扫不到它
  R['F11_面板按钮均≥44px'] = await (async () => {
    await page.locator('#compose-signin').click();
    await page.waitForTimeout(300);
    const small = (await page.evaluate(() =>
      [...document.querySelectorAll('#auth-mask button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => Math.round(b.getBoundingClientRect().height))
        .filter((h) => h < 44))).length;
    await page.locator('#auth-close').click();
    await page.waitForTimeout(250);
    return small === 0;
  })();

  /* ---- Day 24：站方公告栏（发布在后台，展示在论坛顶部） ----
     公告条数是**活数据**（站方随时增删），所以这里一律不写死「应该有 N 条」——
     拿「页面渲染出来的」对「接口层当场读到的」做同源交叉验证
     （Day 23 的教训：活数据当死基准，用户一发帖就误报）。 */
  const noticesFromApi = await page.evaluate(async () => {
    try { return (await api.listAnnouncements()).map((a) => String(a.title || '')); }
    catch (e) { return null; }
  });

  // F13：公告栏与云端一致 —— 有公告就显示且逐条对得上；一条都没有时整块收起（不留空框）
  R['F13_公告栏与云端一致'] = await page.evaluate((titles) => {
    const bar = document.getElementById('notice-bar');
    if (!bar) return false;
    if (!titles || !titles.length) return bar.hidden === true;
    if (bar.hidden) return false;
    const cards = [...bar.querySelectorAll('.notice-item')];
    if (cards.length !== titles.length) return false;
    return titles.every((t, i) => (cards[i].textContent || '').indexOf(t) !== -1);
  }, noticesFromApi);
  O['F13_公告条数'] = noticesFromApi === null ? '接口读取失败' : (noticesFromApi.length + ' 条');

  // F14：多条时真的能手动切 —— 断的不只是文字变了，而是**轨道真的位移了一屏**
  //      （只查 textContent 会漏掉「文字换了但视觉没动」这种坏法，Day 21 的 hover 教训）
  R['F14_公告可手动切换'] = await (async () => {
    if (!noticesFromApi || noticesFromApi.length < 2) return true;   // 只有一条：没得切，跳过
    if (!(await page.locator('#notice-nav').isVisible())) return false;
    const t0 = await page.locator('#notice-track').boundingBox();
    const pos0 = (await page.locator('#notice-pos').textContent()).trim();
    await page.locator('#notice-next').click();
    await page.waitForTimeout(700);
    const t1 = await page.locator('#notice-track').boundingBox();
    const pos1 = (await page.locator('#notice-pos').textContent()).trim();
    const shifted = !!(t0 && t1) && Math.abs(t1.x - t0.x) > 50;
    return pos0 !== pos1 && shifted;
  })();

  /* ---- A 组：架构分层（Day 21 板块三收口） ----
     「分层」在本项目的含义：页面只认 api.xxx() 与 auth.xxx()，
     谁直接摸 SDK / 数据库 / 本地 json，谁就是在给下一次换数据源埋雷。
     扫的是源码不是运行时 —— 运行时盯不住「哪一层写的这行代码」。 */
  const PAGE_SCRIPTS = ['js/data.js', 'js/home.js', 'js/search.js', 'js/forum.js', 'js/mine.js', 'js/detail.js', 'js/profile.js', 'js/admin.js'];
  const readSrc = (f) => { try { return fs.readFileSync(ROOT + '/' + f, 'utf8'); } catch (e) { return ''; } };

  // Day 22：云存储也归「数据源」—— 页面不许自己 upload / createSignedUrls
  // Day 23：rpc( 同属 SDK 直连（浏览自增走的就是它），一并收进接口层
  R['A1_页面不绕过接口层碰数据'] = PAGE_SCRIPTS.every((f) =>
    !/cloud\.database|cloud\.storage|\.from\(["']|rpc\(|WorkBuddyCloud|fetch\(/.test(readSrc(f)));

  // 身份动作同理：登录/发码/验证只许出现在 auth.js，页面只调 auth.xxx()
  R['A2_身份动作只在身份层'] = PAGE_SCRIPTS.every((f) =>
    !/sendOtp|verifyOtp|signInWithPassword|resetPasswordForEmail|onAuthStateChange/.test(readSrc(f)));

  /* Day 22：AI 调用同理，只许出现在 AI 接口层（ai.js）。
     多一层不是为了好看——模型调用是「能烧钱、能被人诱导说话」的能力，
     散在页面里就没法统一加限流、系统提示词与错误分流这三道闸。 */
  R['A3_AI调用只在AI接口层'] = PAGE_SCRIPTS.every((f) =>
    !/chat\.completions|llm\.models|llm\.chat/.test(readSrc(f)));

  /* AI 接口层自己也要守平台纪律（照 cloud-service/llm 的完成标准）：
     只支持流式（非流式会被 SDK 直接拒）、messages[0] 必须是应用方的 system 消息
     （SDK 不替我们补，缺了就报错），而且系统提示词里必须留着两条安全底线。 */
  const aiSrc = readSrc('js/ai.js');
  R['A4_AI调用只流式且system打头'] = /stream:\s*true/.test(aiSrc) &&
    /role:\s*"system"/.test(aiSrc) &&
    !/stream:\s*false/.test(aiSrc);
  R['A5_提示词含不判真伪与禁链'] = /不做真伪判决/.test(aiSrc) &&
    /不要输出任何网址/.test(aiSrc) &&
    /待整理的内容/.test(aiSrc);   // 材料里的「命令」不当指令 —— 防提示注入那条

  /* ---- H 组：HTML 与脚本的结构契约（Day 22 新增 · 源自一次真实事故） ----
     事故复盘：index.html 里发帖区的标题 <h3 id="compose-title"> 和标题输入框
     <input id="compose-title"> 撞了同一个 id。getElementById 只返回文档里第一个，
     forum.js 拿到的「标题输入框」其实是那个 h3，.value 是 undefined，取值当场抛错 ——
     按钮不变、提示不出、请求不发，用户在线上看到的就是「点提交毫无反应」，
     控制台也没有一行红字。这是本项目至今最隐蔽的一个 bug。

     这类错误眼睛看不出来（两处隔了 30 行、看着都挺对），静态一扫就现形。断三条：
       H1 每个 HTML 内部 id 必须唯一 —— 撞名就是给 getElementById 埋雷；
       H2 页面脚本 getElementById 的 id 必须在该页 HTML 里，或在动态生成白名单里；
       H3 白名单不许当后门：写进去的 id 必须真能在某个脚本里找到生成它的代码。 */
  const HTML_OF = {
    'js/data.js': 'index.html',    // 与 home / search / forum 同页，取一个代表
    'js/home.js': 'index.html',
    'js/search.js': 'index.html',
    'js/forum.js': 'index.html',
    'js/mine.js': 'mine.html',
    'js/detail.js': 'detail.html',
    'js/admin.js': 'admin.html',
  };
  const HTML_FILES = ['index.html', 'mine.html', 'detail.html', 'admin.html'];
  // 运行时才生成的 id（AI 面板 / 状态块 / 账号区按钮 / 资料表单 / 管理闸门）：HTML 源里没有它们，属正常
  const DYNAMIC_IDS = ['ai-rep-note', 'ai-report', 'ai-stream-label', 'ai-stream-text',
                       'source-clear', 'account-signin', 'account-signout',
                       'profile-signin', 'pf-preview', 'pf-nickname', 'pf-bio',
                       'pf-presets', 'pf-file', 'pf-note', 'pf-save',
                       'admin-signin'];

  const htmlIds = {};
  HTML_FILES.forEach((f) => {
    htmlIds[f] = [...readSrc(f).matchAll(/(^|["' ])id="([^"]+)"/g)].map((m) => m[2]);
  });

  const dupDetail = [];
  R['H1_页面id不重复'] = HTML_FILES.every((f) => {
    const c = {};
    htmlIds[f].forEach((id) => { c[id] = (c[id] || 0) + 1; });
    const dups = Object.keys(c).filter((k) => c[k] > 1);
    if (dups.length) dupDetail.push(f + ': ' + dups.map((d) => d + ' ×' + c[d]).join('、'));
    return dups.length === 0;
  });
  if (dupDetail.length) O['H1_重复id明细'] = dupDetail.join('；');

  const missDetail = [];
  R['H2_脚本引用的id都在页面里'] = Object.keys(HTML_OF).every((js) => {
    const src = readSrc(js);
    const ids = [...new Set([...src.matchAll(/getElementById\((['"])([^'"]+)\1\)/g)].map((m) => m[2]))];
    const have = new Set(htmlIds[HTML_OF[js]]);
    const miss = ids.filter((id) => !have.has(id) && DYNAMIC_IDS.indexOf(id) === -1);
    if (miss.length) missDetail.push(js + ' → ' + miss.join(' / '));
    return miss.length === 0;
  });
  if (missDetail.length) O['H2_缺失id明细'] = missDetail.join('；');

  const allScriptSrc = PAGE_SCRIPTS.concat(['js/api.js', 'js/auth.js', 'js/ai.js']).map(readSrc).join('\n');
  const orphanIds = DYNAMIC_IDS.filter((id) => allScriptSrc.indexOf('id="' + id + '"') === -1);
  R['H3_白名单里的id确有出处'] = orphanIds.length === 0;
  if (orphanIds.length) O['H3_无出处白名单'] = orphanIds.join(' ');

  /* ---- P 组：个性化（Day 22 新增：昵称 / 个性签名 / 头像） ----
     断三件事：
       P1 论坛帖子真的带头像 —— 不是「代码里写了」而已；
       P2 个人主页在未登录时给的是登录出口，不是一张填不了的表单；
       P3 头像元素有真实宽高 —— 0 宽高说明样式没生效（元素在、但看不见）。 */
  await page.setViewportSize({ width: 1280, height: 790 });
  await page.goto(BASE + '/#/forum', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const postCount = await page.locator('#forum-list .post-card').count();
  const avatarInPosts = await page.locator('#forum-list .post-card .fx-avatar').count();
  R['P1_论坛帖子带头像'] = postCount > 0 && avatarInPosts >= postCount;
  O['P1_帖子与头像'] = postCount + ' 帖 / ' + avatarInPosts + ' 头像';

  const avBox = await page.evaluate(() => {
    const el = document.querySelector('#forum-list .post-card .fx-avatar');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  R['P3_头像尺寸非零'] = !!avBox && avBox.w >= 20 && avBox.h >= 20;
  O['P3_头像实测'] = avBox ? avBox.w + '×' + avBox.h : '(页面上没有头像)';

  await page.goto(BASE + '/mine.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const guestBtn = await page.locator('#profile-body #profile-signin').count();
  const guestForm = await page.locator('#profile-body #pf-nickname').count();
  R['P2_未登录资料区给登录出口'] = guestBtn === 1 && guestForm === 0;

  /* ---- V 组：浏览量 · 热度算法（Day 23 新增） ----
     辟谣榜的排序依据从「按编辑填的 heat 排」换成
     「(heat + 真实浏览) × 时间半衰期衰减」——榜单从此多了一条**能被访客改写**的输入。
     多一条输入就多三处会悄悄跑偏的地方，这一组就是盯它们的：
       V1/V2 分层：浏览自增只能待在接口层（页面脚本连 bump_item_view 都不许出现）；
       V3 公式：排序必须真的带半衰期衰减，别一不留神退回「谁新谁在前」；
       V4/V5 机制：详情页打开真的 +1、同一台设备重复打开不重复计数；
       V6 呈现：有浏览量的卡片必须把数字露出来（算了半天不给人看等于白算）。

     ⚠️ V4/V5 会**真的调一次线上函数**（给靶子条目 +1 次浏览）。
        这不算污染数据 —— 脚本确实打开了那个页面，它就是一次真实浏览；
        靶子专门取 SEED_ITEMS[1]，与前面用 SEED_ITEMS[0] 的断言错开，
        免得「这台设备早就算过了」和「本次该不该新增」混在一起算不清。 */
  const apiSrcV = readSrc('js/api.js');
  const homeSrcV = readSrc('js/home.js');

  R['V1_浏览自增只在接口层'] = PAGE_SCRIPTS.every((f) => !/bump_item_view/.test(readSrc(f)));
  R['V2_接口层实现了浏览自增'] = /rpc\(\s*["']bump_item_view["']/.test(apiSrcV);
  R['V3_榜单用半衰期热度排序'] = /HEAT_HALF_LIFE_DAYS\s*=\s*\d+/.test(homeSrcV) &&
    /Math\.pow\(0\.5,/.test(homeSrcV) &&
    /function\s+heatScore/.test(homeSrcV) &&
    /function\s+viewsOf/.test(homeSrcV);

  // 从页面自己读云端计数：页面本来就连着云库，脚本不必自己拼 endpoint 与 key
  const readViewsOf = (pg, id) => pg.evaluate(async (i) => {
    const list = await api.getItems();
    const it = list.find((x) => x.id === i);
    return it ? (it.views || 0) : -1;
  }, id);
  const waitViewsOf = async (pg, id, expect, ms) => {
    const t0 = Date.now();
    let v = await readViewsOf(pg, id);
    while (v !== expect && Date.now() - t0 < ms) {
      await pg.waitForTimeout(500);
      v = await readViewsOf(pg, id);
    }
    return v;
  };

  const VIEW_ID = (SEED_ITEMS[1] || {}).id || '';
  if (!VIEW_ID) {
    R['V4_详情页打开浏览量加一'] = false;
    R['V5_同设备不重复计数'] = false;
  } else {
    const vCtx = await browser.newContext({ viewport: { width: 1280, height: 790 } }); // 干净 localStorage = 另一台设备
    const vPage = await vCtx.newPage();
    await vPage.goto(BASE + '/index.html', { waitUntil: 'networkidle' });

    const before = await readViewsOf(vPage, VIEW_ID);
    await vPage.goto(BASE + '/detail.html?id=' + encodeURIComponent(VIEW_ID), { waitUntil: 'networkidle' });
    const after1 = await waitViewsOf(vPage, VIEW_ID, before + 1, 8000);
    R['V4_详情页打开浏览量加一'] = after1 === before + 1;
    O['V4_实测'] = '靶子 ' + VIEW_ID + '：' + before + ' → ' + after1;

    await vPage.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
    await vPage.goto(BASE + '/detail.html?id=' + encodeURIComponent(VIEW_ID), { waitUntil: 'networkidle' });
    await vPage.waitForTimeout(2500);
    const after2 = await readViewsOf(vPage, VIEW_ID);
    R['V5_同设备不重复计数'] = after2 === after1;
    O['V5_实测'] = '同一台设备再打开一次后仍为 ' + after2;

    await vCtx.close();
  }

  /* V6：卡片上的浏览数不是「代码里写了」就算数，要真出现在页面上。
     判据取「榜单里凡云端 views>0 的条目，其卡片必须带『浏览 N 次』」——
     全站还没人点开过任何一条时不罚（那时确实无从验），但有数字就必须露出来。 */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-list .card');
  const v6rows = await page.evaluate(async () => {
    const items = await api.getItems();
    const byId = {};
    items.forEach((x) => { byId[x.id] = x.views || 0; });
    return [...document.querySelectorAll('#board-list .card')].map((c) => {
      const id = decodeURIComponent((c.getAttribute('href') || '').split('id=')[1] || '');
      return { id: id, views: byId[id] || 0, meta: c.querySelector('.card-meta').textContent };
    });
  });
  const v6need = v6rows.filter((r) => r.views > 0);
  R['V6_卡片显示浏览量'] = v6need.length === 0 ||
    v6need.every((r) => /浏览\s*\d+\s*次/.test(r.meta));
  O['V6_榜单浏览量分布'] = v6need.length + ' / ' + v6rows.length + ' 张卡带浏览量';

  /* ---- R 回归底线：三个核心动作 ---- */
  await page.setViewportSize({ width: 1280, height: 790 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-list .card');
  await page.locator('#board-list .card').first().click();       // ① 卡片进详情
  await page.waitForTimeout(500);
  R['R_卡片可进详情'] = page.url().includes('detail.html?id=');

  R['R_详情页标题已渲染'] = (await page.locator('#detail-head .detail-title').count()) === 1;
  await page.locator('.back-link').click();                      // ② 详情回首页
  await page.waitForTimeout(500);
  R['R_详情可回首页'] = !page.url().includes('detail.html');

  await page.goto(BASE + '/detail.html?id=' + SAMPLE_ID, { waitUntil: 'networkidle' });
  await page.waitForSelector('#copy-btn');
  await page.locator('#copy-btn').click();                       // ③ 复制结论
  await page.waitForTimeout(300);
  R['R_复制按钮可反馈'] = (await page.locator('#copy-btn').textContent()).includes('已复制');

  // Day 15 新增：浏览足迹确实写进了 localStorage（个人主页的数据来源）
  R['R_浏览足迹已记录'] = await page.evaluate((sid) => {
    try {
      const v = JSON.parse(localStorage.getItem('fx_history'));
      return Array.isArray(v) && v.some((x) => x && x.id === sid);
    } catch (e) { return false; }
  }, SAMPLE_ID);

  // 详情页按钮触控尺寸
  const detailSmall = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => Math.round(b.getBoundingClientRect().height))
      .filter((h) => h < 44));
  R['B5_详情页按钮均≥44px'] = detailSmall.length === 0;

  /* ---- C5 状态反馈不靠颜色单通道（文案也要变） ---- */
  R['C5_反馈含文案变化'] = /已复制|保存中|撤销中|失败/.test(
    fs.readFileSync(ROOT + '/js/detail.js', 'utf8'));

  R['R0_无JS错误'] = errors.length === 0;
  if (errors.length) O['JS错误'] = errors.join(' | ');

  await browser.close();

  /* ============ 三、汇报 ============ */
  const bad = Object.entries(R).filter(([, v]) => v !== true);
  console.log('=== 硬门槛 ===');
  console.log(JSON.stringify(R, null, 2));
  console.log('=== 观察项（不阻塞） ===');
  console.log(JSON.stringify(O, null, 2));
  console.log(bad.length ? 'FAIL: ' + bad.map((x) => x[0]).join(', ')
    : `ALL_PASS（${Object.keys(R).length} 项硬门槛全过，另有 ${Object.keys(O).length} 项观察）`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('脚本失败:', e.message); process.exit(1); });
