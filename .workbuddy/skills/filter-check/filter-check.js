/* filter-check.js — filter-check Skill 的执行脚本
   检查筛选交互三态（有结果/无结果/清空恢复）+ 可访问性 + 回归底线
   用法：node filter-check.js   （需先在项目根目录起 http.server 8000） */
const pw = require('C:/Users/狐灵/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/playwright-core');

const BASE = 'http://localhost:8000';
const R = {};

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 790 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');

  const chip = (v) => page.locator(`#verdict-filter .chip[data-verdict="${v}"]`);
  const cards = () => page.locator('#card-list .card');

  R['A0_初始_全部'] = (await cards().count()) === 5 && (await page.locator('#filter-summary').textContent()).includes('共 5 条');

  // A1 有结果：存疑（demo 数据 4 条）
  await chip('存疑').click();
  await page.waitForTimeout(300);
  const n1 = await cards().count();
  const tags1 = await page.locator('#card-list .tag').allTextContents();
  R['A1_有结果_条数正确'] = n1 === 4;
  R['A1_有结果_标签全部匹配'] = tags1.length > 0 && tags1.every(t => t.trim() === '存疑');
  R['B1_计数反馈'] = (await page.locator('#filter-summary').textContent()).includes('筛选「存疑」：共 4 条');
  R['B2_选中态唯一'] = (await page.locator('#verdict-filter .chip.active').count()) === 1 &&
    (await page.locator('#verdict-filter .chip.active').getAttribute('data-verdict')) === '存疑';

  // A1b 有结果：假（1 条）
  await chip('假').click();
  await page.waitForTimeout(300);
  R['A1b_假_1条'] = (await cards().count()) === 1;

  // A2 无结果：真（0 条）
  await chip('真').click();
  await page.waitForTimeout(300);
  R['A2_无结果_无卡片'] = (await cards().count()) === 0;
  const emptyText = (await page.locator('#card-list .empty-state').textContent()).trim();
  R['A2_无结果_文案说明筛了什么'] = emptyText.includes('真') && emptyText.includes('没有');
  R['A2_无结果_有出口按钮'] = (await page.locator('#card-list .empty-jump, #filter-reset').count()) >= 1;

  // A3 清空恢复：点空态里的「显示全部」
  await page.locator('#filter-reset').click();
  await page.waitForTimeout(300);
  R['A3_清空恢复_条数'] = (await cards().count()) === 5;
  R['A3_清空恢复_计数文案'] = (await page.locator('#filter-summary').textContent()).includes('共 5 条');
  R['A3_清空恢复_选中回到全部'] = (await page.locator('#verdict-filter .chip.active').getAttribute('data-verdict')) === 'all';

  // A3b 清空恢复（顶部「全部」chip 路径）
  await chip('假').click();
  await page.waitForTimeout(250);
  await chip('all').click();
  await page.waitForTimeout(300);
  R['A3b_全部chip_恢复'] = (await cards().count()) === 5;

  // B3 键盘：聚焦「存疑」按 Enter
  await chip('存疑').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  R['B3_键盘可操作'] = (await cards().count()) === 4;
  await chip('all').click();
  await page.waitForTimeout(250);

  // B4 无障碍状态
  const pressedBefore = await page.locator('#verdict-filter .chip[data-verdict="all"]').getAttribute('aria-pressed');
  await chip('真').click();
  await page.waitForTimeout(250);
  const pressedAfter = await page.locator('#verdict-filter .chip[data-verdict="真"]').getAttribute('aria-pressed');
  const groupRole = await page.locator('#verdict-filter').getAttribute('role');
  const groupLabel = await page.locator('#verdict-filter').getAttribute('aria-label');
  R['B4_aria_pressed同步'] = pressedBefore === 'true' && pressedAfter === 'true';
  R['B4_容器语义'] = groupRole === 'group' && !!groupLabel;
  await chip('all').click();
  await page.waitForTimeout(250);

  // B5 触控尺寸
  const h = await page.locator('#verdict-filter .chip').first().evaluate(el => el.getBoundingClientRect().height);
  R['B5_触控高度≥44'] = h >= 44;

  // B6 窄屏溢出
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(400);
  const of1 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await chip('存疑').click();
  await page.waitForTimeout(300);
  const of2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  R['B6_窄屏无溢出'] = of1 === 0 && of2 === 0;
  await page.setViewportSize({ width: 1280, height: 790 });

  // C1 榜单回归
  await page.locator('#view-tabs .tab', { hasText: '辟谣榜' }).click();
  await page.waitForTimeout(400);
  const boardRendered = (await page.locator('#board-list .card').count()) +
    (await page.locator('#board-list .empty-state').count());
  R['C1_榜单不受影响'] = boardRendered >= 1;

  R['C2_无JS错误'] = errors.length === 0;

  await browser.close();
  console.log(JSON.stringify(R, null, 2));
  const bad = Object.entries(R).filter(([k, v]) => v !== true);
  console.log(bad.length ? 'FAIL: ' + bad.map(x => x[0]).join(', ') : 'ALL_PASS');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
