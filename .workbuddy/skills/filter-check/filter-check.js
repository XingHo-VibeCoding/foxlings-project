/* filter-check.js — 检查【任意已登记列表组件】的筛选交互
   覆盖：三态（有结果 / 无结果 / 清空恢复）、零数据态、无障碍底线、回归底线
   用法：
     node filter-check.js             # 检查默认组件（board + favs）
     node filter-check.js board       # 只检查某个组件
     node filter-check.js board favs  # 检查多个
   前置：项目根目录已起 http.server 8000（--bind 127.0.0.1）

   Day 15 变更记录（导航结构重构）：
     · 原 `feed`（首页·热点卡片流）组件并入 `board` —— 两个列表页合并成一个辟谣榜，
       三态断言一条不删，只是换了容器 id（#card-list → #board-list）；
     · `favs`（我的收藏）从「首页视图」搬到独立页 mine.html，选择器同步更新。

   Day 16 变更记录（数据源扩充）：
     · 种子数据由 5 条换成 23 条 —— **条数一律从 data/data.json 现算**（基线条数、
       某个结论的条数、某个关键词的条数），不再写死 5 / 4 / 1 这些魔术数字；
     · 挑哪一条来验（详情页信源、收藏对象）也从上往下现取，不再写死 demo-005。
     · 教训：写死数据值的检查脚本，数据一换就全线超时——看着像页面坏了，
       其实是脚本自己过期了。断言强度没降，只是不再假设数据长什么样。 */
const fs = require('fs');
const pw = require('C:/Users/狐灵/.workbuddy/binaries/node/versions/22.22.2-3/node_modules/playwright-core');

const BASE = 'http://localhost:8000';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const NO_MATCH = 'zzz绝不存在zzz';
const EMPTY_TEXT = '没有找到相关内容'; // 全站统一的无结果文案

/* ---------------- 从数据源现算基线，不写死数字 ---------------- */

const ROOT = 'D:/AI/foxlings-project';
const ITEMS = (JSON.parse(fs.readFileSync(ROOT + '/data/data.json', 'utf8')).items) || [];
if (!ITEMS.length) { console.error('脚本失败: data/data.json 里没有可用条目'); process.exit(1); }

/** 年榜（365 天内）= 全量视图下的基线，与「今天」无关，不会随时间流逝而失效 */
const inYear = (it) => {
  const d = new Date(String(it.updated_at) + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = (t - d) / 86400000;
  return diff >= 0 && diff < 365;
};
const YEAR_ITEMS = ITEMS.filter(inYear);
const countVerdict = (v) => YEAR_ITEMS.filter((i) => i.verdict === v).length;
const countKeyword = (kw) => YEAR_ITEMS.filter((i) => (i.title + i.summary).indexOf(kw) !== -1).length;

const SAMPLE = ITEMS[0];                       // 挑第一条来验详情页
const SAMPLE_ID = SAMPLE.id;
const SRC_KW = (SAMPLE.sources[0] || {}).name; // 该条第一个信源名，用来验信源筛选

const FAV_IDS = ITEMS.slice(0, 2).map((i) => i.id);
/** 关键词写死、条数现算：数据换了若这个词不再命中，断言会 FAIL 提醒改词，
    而不是让脚本悄悄跳过。 */
const FAV_KW = '养老金';
const FAV_KW_COUNT = ITEMS.slice(0, 2).filter((i) => (i.title + i.summary).indexOf(FAV_KW) !== -1).length;

/* ---------------- 组件登记表：新组件接进来只需加一条 ---------------- */
const COMPS = {
  board: {
    label: '首页·辟谣榜（含原卡片流）',
    prepare: async (page) => {
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('#board-list .card');
      // 切到年榜 = 全量数据，让基线断言与「今天」无关，不会随时间流逝而失效
      await page.locator('#board-tabs .tab', { hasText: '年榜' }).click();
      await page.waitForTimeout(400);
    },
    chips: '#verdict-filter .chip',
    chipKey: 'data-verdict',
    hitChip: { value: '存疑', count: countVerdict('存疑') },
    hitKeyword: { value: '地铁', count: countKeyword('地铁') },
    list: '#board-list',
    itemSel: '.card',
    search: '#board-search',
    summary: '#filter-summary',
    baseline: YEAR_ITEMS.length
  },
  source: {
    label: '详情页·信源比对',
    prepare: async (page) => {
      await page.goto(BASE + '/detail.html?id=' + SAMPLE_ID, { waitUntil: 'networkidle' });
      await page.waitForSelector('#source-cards .src-card');
    },
    chips: null,
    hitKeyword: { value: SRC_KW, count: SAMPLE.sources.filter((s) => (s.name + s.url).indexOf(SRC_KW) !== -1).length },
    list: '#source-cards',
    itemSel: '.src-card',
    search: '#source-search',
    summary: '#source-summary',
    baseline: SAMPLE.sources.length
  },
  favs: {
    label: '个人主页·我的收藏',
    prepare: async (page) => {
      // 造数据：清空后收藏前两条（存疑 / 假各一条，结论标签不同便于肉眼核对）
      await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
      await page.evaluate(() => localStorage.removeItem('fx_favs'));
      for (const id of FAV_IDS) {
        await page.goto(BASE + '/detail.html?id=' + id, { waitUntil: 'networkidle' });
        await page.waitForSelector('#fav-btn');
        await page.locator('#fav-btn').click();
        await page.waitForTimeout(800);
      }
      await page.goto(BASE + '/mine.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('#mine-fav-list .mine-item');
    },
    chips: null,
    hitKeyword: { value: FAV_KW, count: FAV_KW_COUNT },
    list: '#mine-fav-list',
    itemSel: '.mine-item',
    search: '#fav-search',
    summary: '#fav-summary',
    baseline: FAV_IDS.length,
    zeroDataCheck: true // 组件可能有「一条数据都没有」的状态，必须与「筛空」文案不同
  }
};

/* ---------------- 通用检查内核 ---------------- */

/** 安全取文本：元素不存在或取不到时返回 null（让断言报 FAIL，而不是让脚本崩） */
async function textOf(page, sel) {
  if (!sel) return null;
  const loc = page.locator(sel);
  if (!(await loc.count())) return null;
  try { return (await loc.first().textContent({ timeout: 3000 })) || ''; } catch (e) { return null; }
}

async function checkComp(page, key, cfg, R) {
  const p = key + '.';
  const items = () => page.locator(cfg.list + ' ' + cfg.itemSel);
  let emptyText = '';

  await cfg.prepare(page);

  // A0 基线：不加任何筛选时的条数
  R[p + 'A0_基线条数'] = (await items().count()) === cfg.baseline;

  // A0b 条件筛选器存在（登记了 chips 却没渲染出来 = FAIL，避免缺件被静默跳过）
  if (cfg.chips) {
    R[p + 'A0b_条件筛选器存在'] = (await page.locator(cfg.chips).count()) > 0;
  }

  // A1 有结果：条件筛选
  if (cfg.chips && cfg.hitChip) {
    const chip = page.locator(cfg.chips + '[' + cfg.chipKey + '="' + cfg.hitChip.value + '"]');
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(350);
      R[p + 'A1_条件有结果_条数'] = (await items().count()) === cfg.hitChip.count;
      const tags = await page.locator(cfg.list + ' .tag').allTextContents();
      R[p + 'A1_条件有结果_内容匹配'] = tags.length > 0 && tags.every((t) => t.trim() === cfg.hitChip.value);
      const s1 = await textOf(page, cfg.summary);
      R[p + 'C1_计数反映条件'] = s1 !== null &&
        s1.indexOf(cfg.hitChip.value) !== -1 && s1.indexOf(String(cfg.hitChip.count)) !== -1;
      R[p + 'C2_选中态唯一'] = (await page.locator(cfg.chips + '.active').count()) === 1;
      R[p + 'C3_键盘可操作'] = await (async () => {
        await chip.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        return (await items().count()) === cfg.hitChip.count;
      })();
      R[p + 'C4_aria_pressed同步'] = (await chip.getAttribute('aria-pressed')) === 'true';
      const role = await page.locator(cfg.chips.replace(' .chip', '')).getAttribute('role');
      R[p + 'C4_容器语义'] = role === 'group';
      const h = await page.locator(cfg.chips).first().evaluate((el) => el.getBoundingClientRect().height);
      R[p + 'C5_触控高度≥44'] = h >= 44;
      const allChip = page.locator(cfg.chips + '[' + cfg.chipKey + '="all"]');
      if (await allChip.count()) { await allChip.click(); await page.waitForTimeout(300); }
    }
  }

  // A1b 有结果：关键词
  if (cfg.hitKeyword) {
    await page.fill(cfg.search, cfg.hitKeyword.value);
    await page.waitForTimeout(350);
    R[p + 'A1b_关键词有结果_条数'] = (await items().count()) === cfg.hitKeyword.count;
    const txt = await page.locator(cfg.list).textContent();
    R[p + 'A1b_关键词有结果_内容匹配'] = txt.indexOf(cfg.hitKeyword.value) !== -1;
    const s2 = await textOf(page, cfg.summary);
    R[p + 'C1_计数反映关键词'] = s2 !== null && s2.indexOf(cfg.hitKeyword.value) !== -1;
    const live = cfg.summary ? await page.locator(cfg.summary).first().getAttribute('aria-live').catch(() => null) : null;
    R[p + 'C1_计数aria_live'] = live === 'polite';
  }

  // A2 无结果
  await page.fill(cfg.search, NO_MATCH);
  await page.waitForTimeout(400);
  R[p + 'A2_无结果_零条目'] = (await items().count()) === 0;
  emptyText = (await page.locator(cfg.list).textContent()).trim();
  R[p + 'A2_无结果_有文案'] = emptyText.length > 0;
  R[p + 'A2_无结果_文案统一'] = emptyText.indexOf(EMPTY_TEXT) !== -1;
  R[p + 'A2_无结果_有出口按钮'] = (await page.locator(cfg.list + ' .empty-jump').count()) >= 1;

  // A3 清空恢复：优先走出口按钮，再走手动清空
  const exitBtn = page.locator(cfg.list + ' .empty-jump').first();
  if (await exitBtn.count()) {
    await exitBtn.click();
    await page.waitForTimeout(400);
    R[p + 'A3_出口恢复_条数'] = (await items().count()) === cfg.baseline;
    const v = await page.inputValue(cfg.search);
    R[p + 'A3_出口恢复_输入框已清空'] = v === '';
  } else {
    R[p + 'A3_出口恢复_条数'] = false;
    R[p + 'A3_出口恢复_输入框已清空'] = false;
  }
  await page.fill(cfg.search, NO_MATCH);
  await page.waitForTimeout(350);
  await page.fill(cfg.search, '');
  await page.waitForTimeout(400);
  R[p + 'A3b_手动清空恢复_条数'] = (await items().count()) === cfg.baseline;

  // B1 零数据态（仅登记的组件）：与「筛空」文案必须不同
  if (cfg.zeroDataCheck) {
    await page.evaluate(() => localStorage.removeItem('fx_favs'));
    await page.goto(BASE + '/mine.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const zeroText = (await page.locator(cfg.list).textContent()).trim();
    R[p + 'B1_零数据态_有引导文案'] = zeroText.length > 0;
    R[p + 'B1_零数据态_与筛空文案不同'] = zeroText.length > 0 && zeroText !== emptyText && zeroText.indexOf(EMPTY_TEXT) === -1;
  }

  // C6 窄屏溢出
  await page.setViewportSize({ width: 375, height: 700 });
  await page.waitForTimeout(400);
  R[p + 'C6_窄屏无溢出'] = (await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth)) === 0;
  await page.setViewportSize({ width: 1280, height: 790 });
  await page.waitForTimeout(300);
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const want = process.argv.slice(2);
  const keys = want.length ? want : ['board', 'favs'];
  const R = {};
  const browser = await pw.chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 790 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  for (const key of keys) {
    const cfg = COMPS[key];
    if (!cfg) { console.log('未登记的组件：' + key); continue; }
    await checkComp(page, key, cfg, R);
  }

  // D1 默认视图回归：辟谣榜打开就能渲染，切档位后条数正确
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#board-list .card');
  R['D1_辟谣榜默认视图渲染'] = (await page.locator('#board-list .card').count()) >= 1;
  await page.locator('#board-tabs .tab', { hasText: '年榜' }).click();
  await page.waitForTimeout(400);
  R['D1_年榜全量渲染'] = (await page.locator('#board-list .card').count()) === YEAR_ITEMS.length;
  R['D2_无JS错误'] = errors.length === 0;

  await browser.close();
  console.log(JSON.stringify(R, null, 2));
  const bad = Object.entries(R).filter(([, v]) => v !== true);
  console.log(bad.length
    ? 'FAIL(' + bad.length + '): ' + bad.map((x) => x[0]).join(', ')
    : 'ALL_PASS(' + Object.keys(R).length + ')');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('脚本失败:', e.message); process.exit(1); });
