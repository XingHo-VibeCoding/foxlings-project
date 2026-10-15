/* check-live-version.js — 「线上现在跑的是哪一版？」逐字节核验
 *
 * 用法：node tools/check-live-version.js [提交号|tag] [--site <地址>]
 *   不传 ref 则对比 HEAD；不传 --site 则用环境变量 FX_SITE 或内置默认地址。
 *
 * 判据不靠肉眼看版本号，而是把线上 11 个页面资产的 sha256 与
 * `git show <ref>:<file>` 的 sha256 逐一比对：
 *   全部一致 → 线上 = 那一版
 *   否则列出不一致的文件（这就是回退演练的「回退生效」证据）
 *
 * 只读，不写仓库；不依赖浏览器与 CDN。
 *
 * 放在仓库内（tools/）的原因：回滚手册要求同伴也能跑这一步。
 * 路径一律相对本脚本定位（__dirname/.. = 仓库根），换台机器、换个克隆目录都能用。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');                 // 仓库根 = 本脚本的上一级
const SITE = (process.env.FX_SITE || 'https://rumor-check-12000.app.workbuddy.host').replace(/\/+$/, '');
const FILES = [
  'index.html', 'mine.html', 'admin.html', 'detail.html', 'css/style.css',
  'js/api.js', 'js/data.js', 'js/home.js', 'js/forum.js', 'js/mine.js', 'js/admin.js',
];

// 取第一个非 flag 的参数作为 ref
const REF = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'HEAD';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

(async () => {
  const refSha = execSync('git rev-parse ' + REF, { cwd: ROOT }).toString().trim();
  console.log('目标版本 ' + REF + ' = ' + refSha.slice(0, 7) + '   线上 ' + SITE);

  const same = [], diff = [], bad = [];
  for (const f of FILES) {
    let local;
    try {
      local = execSync('git show ' + REF + ':' + f, { cwd: ROOT, maxBuffer: 1 << 24 }).toString('utf8');
    } catch (e) { bad.push(f + '（仓库里没有这个文件）'); continue; }
    let live;
    try {
      const r = await fetch(SITE + '/' + f);
      if (r.status !== 200) { bad.push(f + '（HTTP ' + r.status + '）'); continue; }
      live = await r.text();
    } catch (e) { bad.push(f + '（取不到：' + e.message + '）'); continue; }
    const a = sha(local.replace(/\r\n/g, '\n')), b = sha(live.replace(/\r\n/g, '\n'));
    (a === b ? same : diff).push(f + ' ' + (a === b ? a : '仓库 ' + a + ' ≠ 线上 ' + b));
  }

  console.log('一致 ' + same.length + ' / ' + FILES.length + ' 项');
  same.forEach((s) => console.log('  ✓ ' + s));
  diff.forEach((s) => console.log('  ✗ ' + s));
  bad.forEach((s) => console.log('  ? ' + s));

  const verdict = diff.length === 0 && bad.length === 0;
  console.log(verdict ? '结论：线上 = ' + REF : '结论：线上 ≠ ' + REF + '（差 ' + (diff.length + bad.length) + ' 项）');

  // 顺带打一个语义标记：首屏回落代码在不在这份线上 home.js 里
  try {
    const home = await (await fetch(SITE + '/js/home.js')).text();
    console.log('语义标记：线上 js/home.js 含 autoFallbackRange = ' + home.includes('autoFallbackRange'));
  } catch (e) { /* 前面已经报过取不到 */ }

  process.exit(verdict ? 0 : 1);
})();
