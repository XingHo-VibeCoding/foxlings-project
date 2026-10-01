/* filter3-check.js — frontend-rules Skill：三处数据对象关键词筛选的功能测试
   覆盖：卡片流 / 辟谣榜 / 详情页信源，每处三种情况（有匹配 / 无匹配 / 清空恢复），
   外加组合筛选、出口按钮、既有功能回归、三档溢出、JS 错误。
   用法：node filter3-check.js   （需先在项目根目录起 http.server 8000 --bind 127.0.0.1） */
const pw = require('C:/Users/狐灵/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/playwright-core');

const BASE = 'http://localhost:8000';
const R = {};

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 790 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  /* ============ A. 首页 · 热点卡片流 ============ */
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  const feedCards = () => page.locator('#card-list .card');
  const feedSearch = page.locator('#feed-search');

  R['A0_初始全量5条'] = (await feedCards().count()) === 5;
  R['A0_搜索框存在'] = (await feedSearch.count()) === 1;

  // A1 有匹配 → 只显示匹配内容
  await feedSearch.fill('地铁');
  await page.waitForTimeout(350);
  const titles1 = await page.locator('#card-list .card-title').allTextContents();
  R['A1_有匹配_只显示匹配'] = (await feedCards().count()) === 1 && titles1.every((t) => t.includes('地铁'));
  R['A1_有匹配_计数反馈'] = (await page.locator('#filter-summary').textContent()).includes('共 1 条');

  // A2 无匹配 → 没有找到相关内容 + 出口
  await feedSearch.fill('量子计算机');
  await page.waitForTimeout(350);
  const emptyA = (await page.locator('#card-list .empty-state').textContent()).trim();
  R['A2_无匹配_无卡片'] = (await feedCards().count()) === 0;
  R['A2_无匹配_统一文案'] = emptyA.includes('没有找到相关内容');
  R['A2_无匹配_有清空出口'] = (await page.locator('#feed-clear').count()) === 1;

  // A3 清空输入 → 恢复完整列表
  await feedSearch.fill('');
  await page.waitForTimeout(350);
  R['A3_清空恢复全量'] = (await feedCards().count()) === 5;

  // A3b 点出口按钮 → 恢复完整列表
  await feedSearch.fill('量子计算机');
  await page.waitForTimeout(300);
  await page.locator('#feed-clear').click();
  await page.waitForTimeout(350);
  R['A3b_出口按钮恢复'] = (await feedCards().count()) === 5 && (await feedSearch.inputValue()) === '';

  // A4 组合筛选（结论 + 关键词同时生效）
  await page.locator('#verdict-filter .chip[data-verdict="假"]').click();
  await page.waitForTimeout(300);
  await feedSearch.fill('加油站');
  await page.waitForTimeout(350);
  const sumA4 = await page.locator('#filter-summary').textContent();
  R['A4_组合_命中1条'] = (await feedCards().count()) === 1;
  R['A4_组合_计数含两条件'] = sumA4.includes('「假」') && sumA4.includes('加油站');

  // A5 组合无匹配 → 按钮为「清空全部筛选」→ 一键恢复完整列表
  await feedSearch.fill('地铁');
  await page.waitForTimeout(350);
  R['A5_组合无匹配_按钮语义'] = (await page.locator('#feed-clear').textContent()).trim() === '清空全部筛选';
  await page.locator('#feed-clear').click();
  await page.waitForTimeout(400);
  R['A5_清空全部后恢复全量'] = (await feedCards().count()) === 5 &&
    (await page.locator('#verdict-filter .chip.active').getAttribute('data-verdict')) === 'all';
  R['A5_清空后计数正确'] = (await page.locator('#filter-summary').textContent()).includes('共 5 条');

  /* ============ B. 首页 · 辟谣榜 ============ */
  await page.locator('#view-tabs .tab', { hasText: '辟谣榜' }).click();
  await page.waitForTimeout(400);
  await page.locator('#board-tabs .tab', { hasText: '周榜' }).click();
  await page.waitForTimeout(400);
  const boardCards = () => page.locator('#board-list .card');
  const boardSearch = page.locator('#board-search');
  R['B0_周榜初始1条'] = (await boardCards().count()) === 1;

  await boardSearch.fill('加油站');
  await page.waitForTimeout(350);
  R['B1_有匹配_只显示匹配'] = (await boardCards().count()) === 1;

  await boardSearch.fill('量子计算机');
  await page.waitForTimeout(350);
  const emptyB = (await page.locator('#board-list .empty-state').textContent()).trim();
  R['B2_无匹配_无卡片'] = (await boardCards().count()) === 0;
  R['B2_无匹配_统一文案'] = emptyB.includes('没有找到相关内容');
  R['B2_无匹配_有清空出口'] = (await page.locator('#board-clear').count()) === 1;

  await page.locator('#board-clear').click();
  await page.waitForTimeout(400);
  R['B3_出口恢复完整列表'] = (await boardCards().count()) === 1 && (await boardSearch.inputValue()) === '';

  await boardSearch.fill('量子计算机');
  await page.waitForTimeout(300);
  await boardSearch.fill('');
  await page.waitForTimeout(350);
  R['B3b_清空输入恢复'] = (await boardCards().count()) === 1;

  // B4 回归：Day 10 的档位指路按钮不能被新逻辑弄坏
  await page.locator('#board-tabs .tab', { hasText: '日榜' }).click();
  await page.waitForTimeout(400);
  const jump = page.locator('#board-list .empty-jump');
  R['B4_档位指路按钮仍在'] = (await jump.count()) === 1;
  await jump.click();
  await page.waitForTimeout(400);
  R['B4_点击后切到周榜'] = (await page.locator('#board-tabs .tab.active').textContent()).trim() === '周榜';

  /* ============ C. 详情页 · 信源比对 ============ */
  await page.goto(BASE + '/detail.html?id=demo-005', { waitUntil: 'networkidle' });
  await page.waitForSelector('#source-search');
  const srcCards = () => page.locator('#source-cards .src-card');
  const srcSearch = page.locator('#source-search');
  R['C0_初始2条信源'] = (await srcCards().count()) === 2;
  R['C0_计数显示'] = (await page.locator('#source-summary').textContent()).includes('共 2 条信源');

  await srcSearch.fill('石化');
  await page.waitForTimeout(350);
  const names1 = await page.locator('#source-cards .src-name').allTextContents();
  R['C1_有匹配_按信源名'] = (await srcCards().count()) === 1 && names1[0].includes('中国石化');

  await srcSearch.fill('nea.gov');
  await page.waitForTimeout(350);
  R['C1b_有匹配_按域名'] = (await srcCards().count()) === 1;

  await srcSearch.fill('新华网');
  await page.waitForTimeout(350);
  const emptyC = (await page.locator('#source-cards .empty-state').textContent()).trim();
  R['C2_无匹配_无卡片'] = (await srcCards().count()) === 0;
  R['C2_无匹配_统一文案'] = emptyC.includes('没有找到相关内容');
  R['C2_无匹配_计数归零'] = (await page.locator('#source-summary').textContent()).includes('共 0 条信源');

  await srcSearch.fill('');
  await page.waitForTimeout(350);
  R['C3_清空恢复全量'] = (await srcCards().count()) === 2;

  await srcSearch.fill('新华网');
  await page.waitForTimeout(300);
  await page.locator('#source-clear').click();
  await page.waitForTimeout(350);
  R['C3b_出口按钮恢复'] = (await srcCards().count()) === 2 && (await srcSearch.inputValue()) === '';

  // C4 回归：详情页既有功能没被影响
  R['C4_比对结论仍在'] = (await page.locator('#cross-check').textContent()).includes('比对结论');
  R['C4_复制按钮仍在'] = (await page.locator('#copy-btn').count()) === 1;
  R['C4_收藏按钮仍在'] = (await page.locator('#fav-btn').count()) === 1;
  R['C4_溯源时间线仍在'] = (await page.locator('#timeline .tl-node').count()) === 3;

  /* ============ D. 窄屏溢出与 JS 错误 ============ */
  for (const w of [375, 1280]) {
    await page.setViewportSize({ width: w, height: 790 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card');
    await page.locator('#feed-search').fill('地铁');
    await page.waitForTimeout(350);
    const of1 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.locator('#view-tabs .tab', { hasText: '辟谣榜' }).click();
    await page.waitForTimeout(350);
    const of2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.goto(BASE + '/detail.html?id=demo-005', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.locator('#source-search').fill('石化');
    await page.waitForTimeout(300);
    const of3 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    R['D_溢出0px@' + w] = of1 + of2 + of3 === 0;
  }
  R['D_无JS错误'] = errors.length === 0;
  if (errors.length) console.log('JS错误:', errors.join(' | '));

  await browser.close();
  console.log(JSON.stringify(R, null, 2));
  const bad = Object.entries(R).filter(([k, v]) => !k.startsWith('D_溢出') && v !== true);
  console.log(bad.length ? 'FAIL: ' + bad.map((x) => x[0]).join(', ') : 'ALL_PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('脚本失败:', e.message); process.exit(1); });
