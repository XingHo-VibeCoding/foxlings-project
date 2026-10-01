/* check-frontend.js — frontend-rules Skill 的执行脚本
   六组检查：L 页面层级 / C 颜色与字体 / B 卡片与按钮 / M 移动端 / R 回归底线 / O 观察项
   用法：node check-frontend.js   （需先在项目根目录起 http.server 8000 --bind 127.0.0.1）
   硬门槛（L/C/B/M/R）有任一失败 → 打印 FAIL 行并以退出码 1 结束
   观察项（O）只报告不阻塞，需由项目主人拍板 */
const fs = require('fs');
const PW = require('C:/Users/狐灵/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/playwright-core');

const ROOT = 'D:/AI/foxlings-project';
const BASE = 'http://localhost:8000';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const R = {}; // 硬门槛
const O = {}; // 观察项

/* ============ 一、静态审计：读文件、算色值 ============ */

const css = fs.readFileSync(ROOT + '/css/style.css', 'utf8');
const pages = {
  index: fs.readFileSync(ROOT + '/index.html', 'utf8'),
  detail: fs.readFileSync(ROOT + '/detail.html', 'utf8'),
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
  await page.waitForSelector('.card');

  /* ---- L2/L3 运行时结构 ---- */
  R['L1_容器宽760'] = (await page.locator('.container').first().evaluate(
    (el) => getComputedStyle(el).maxWidth)) === '760px';
  R['L2_单视图可见'] = (await page.locator('.view.active').count()) === 1;
  const viewCount = await page.locator('.view').count();
  const tabBtnCount = await page.locator('#view-tabs button.tab').count();
  R['L2_视图数与tab数一致'] = viewCount === tabBtnCount && viewCount >= 2;
  R['L3_视图切换生效'] = await (async () => {
    const before = await page.locator('.view.active').getAttribute('id');
    await page.locator('#view-tabs button.tab').nth(1).click();
    await page.waitForTimeout(350);
    const after = await page.locator('.view.active').getAttribute('id');
    await page.locator('#view-tabs button.tab').nth(0).click();
    await page.waitForTimeout(350);
    return before !== after;
  })();
  // tab 必须是原生 button（键盘天然可达），不能用 div 冒充
  R['L3_tab是原生button'] = tabBtnCount >= 2;
  R['L4_视图有aria标签'] = !!(await page.locator('#view-feed').getAttribute('aria-label'));
  R['L4_筛选器容器语义'] = (await page.locator('#verdict-filter').getAttribute('role')) === 'group'
    && !!(await page.locator('#verdict-filter').getAttribute('aria-label'));

  /* ---- B1/B3 卡片形态 ---- */
  const card = page.locator('.card').first();
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

  /* ---- M1 三个宽度 × 三个场景的溢出 ---- */
  const widths = [375, 768, 1280];
  let totalOverflow = 0;
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 790 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card');
    totalOverflow += await overflowNow();                       // 首页·卡片流
    await page.locator('#view-tabs .tab', { hasText: '辟谣榜' }).click();
    await page.waitForTimeout(350);
    totalOverflow += await overflowNow();                       // 首页·辟谣榜
    await page.goto(BASE + '/detail.html?id=demo-005', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    totalOverflow += await overflowNow();                       // 详情页
  }
  R['M1_三档零横向溢出'] = totalOverflow === 0;
  O['M1_溢出合计px'] = totalOverflow;

  /* ---- R 回归底线：三个核心动作 ---- */
  await page.setViewportSize({ width: 1280, height: 790 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  await page.locator('.card').first().click();                   // ① 卡片进详情
  await page.waitForTimeout(500);
  R['R_卡片可进详情'] = page.url().includes('detail.html?id=');

  R['R_详情页标题已渲染'] = (await page.locator('#detail-head .detail-title').count()) === 1;
  await page.locator('.back-link').click();                      // ② 详情回首页
  await page.waitForTimeout(500);
  R['R_详情可回首页'] = !page.url().includes('detail.html');

  await page.goto(BASE + '/detail.html?id=demo-005', { waitUntil: 'networkidle' });
  await page.waitForSelector('#copy-btn');
  await page.locator('#copy-btn').click();                       // ③ 复制结论
  await page.waitForTimeout(300);
  R['R_复制按钮可反馈'] = (await page.locator('#copy-btn').textContent()).includes('已复制');

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
