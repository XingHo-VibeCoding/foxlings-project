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
     硬门槛总数 85 → 87（F 组换 2 增 2，A 组新增 2）。 */
const fs = require('fs');
const PW = require('C:/Users/狐灵/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/playwright-core');

const ROOT = 'D:/AI/foxlings-project';
const BASE = 'http://localhost:8000';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

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

  // B1 hover 有反馈
  await card.hover();
  await page.waitForTimeout(400);
  R['B1_卡片hover有反馈'] = (await card.evaluate((el) => getComputedStyle(el).transform)) !== 'none';
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);

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
     另断：L2 查证四步清单常显、L3 未做能力必须有「开发中」标注（不许假装已有）、
     两模块互斥显示、溯源模块可深链（分享/刷新不丢模块）。 */
  await page.goto(BASE + '/#/search', { waitUntil: 'networkidle' });
  await page.waitForSelector('#search-input');
  await page.fill('#search-input', 'zzz绝不存在zzz');
  await page.waitForTimeout(400);

  // ① 站内模块：无命中给两条路（清空关键词 / 去全网溯源）
  R['S1_站内无命中给溯源出口'] = (await page.locator('#search-results .empty-jump').count()) >= 1 &&
    (await page.locator('#search-results #search-to-trace').count()) === 1;
  R['S2_查证清单四步齐备'] = (await page.locator('#view-search .guide-steps li').count()) === 4;
  R['S3_未做的能力有标注'] = (await page.locator('#view-search .soon').count()) === 1;

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

  /* ---- F 组：论坛（F3 骨架 · Day 19 新增） ----
     论坛的立身之本，逐条钉死：
       ① 骨架必须真是能用的列表（占位块已撤，帖子真的渲染出来）；
       ② **未过审的帖子不得进公开列表**——审核机制是法规前提，先在界面上立住；
       ③ 无命中不是死胡同（清空出口 + 能恢复）；
       ④ 用户内容必须写明社区规则与审核（合规底线，不能只有一句「开发中」）；
       ⑤ 没做的能力如实标注，样例数据必须标明是样例（与检索页同一条诚实底线）。 */
  await page.goto(BASE + '/#/forum', { waitUntil: 'networkidle' });
  await page.waitForSelector('#forum-list .post-card');

  R['F1_论坛已换真骨架'] = (await page.locator('#view-forum .placeholder').count()) === 0 &&
    (await page.locator('#forum-list .post-card').count()) === APPROVED_POSTS.length;

  // 待审样例的标题一个字都不许出现在公开列表里
  R['F2_未过审帖子不进公开列表'] = await page.evaluate((titles) => {
    const txt = (document.querySelector('#forum-list') || {}).textContent || '';
    return titles.length > 0 && titles.every((t) => txt.indexOf(t) === -1);
  }, PENDING_TITLES);

  // 分类筛选：点「已解决」后列表里只剩这一类，且回「全部」能恢复
  R['F3_分类筛选生效'] = await (async () => {
    await page.locator('#forum-cats .chip[data-cat="已解决"]').click();
    await page.waitForTimeout(350);
    const cats = await page.locator('#forum-list .post-cat').allTextContents();
    const only = cats.length > 0 && cats.every((t) => t.trim() === '已解决');
    const uniq = (await page.locator('#forum-cats .chip.active').count()) === 1;
    await page.locator('#forum-cats .chip[data-cat="all"]').click();
    await page.waitForTimeout(350);
    const back = (await page.locator('#forum-list .post-card').count()) === APPROVED_POSTS.length;
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
    const back = (await page.locator('#forum-list .post-card').count()) === APPROVED_POSTS.length &&
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

  /* ---- A 组：架构分层（Day 21 板块三收口） ----
     「分层」在本项目的含义：页面只认 api.xxx() 与 auth.xxx()，
     谁直接摸 SDK / 数据库 / 本地 json，谁就是在给下一次换数据源埋雷。
     扫的是源码不是运行时 —— 运行时盯不住「哪一层写的这行代码」。 */
  const PAGE_SCRIPTS = ['js/data.js', 'js/home.js', 'js/search.js', 'js/forum.js', 'js/mine.js', 'js/detail.js'];
  const readSrc = (f) => { try { return fs.readFileSync(ROOT + '/' + f, 'utf8'); } catch (e) { return ''; } };

  R['A1_页面不绕过接口层碰数据'] = PAGE_SCRIPTS.every((f) =>
    !/cloud\.database|\.from\(["']|WorkBuddyCloud|fetch\(/.test(readSrc(f)));

  // 身份动作同理：登录/发码/验证只许出现在 auth.js，页面只调 auth.xxx()
  R['A2_身份动作只在身份层'] = PAGE_SCRIPTS.every((f) =>
    !/sendOtp|verifyOtp|signInWithPassword|resetPasswordForEmail|onAuthStateChange/.test(readSrc(f)));

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
