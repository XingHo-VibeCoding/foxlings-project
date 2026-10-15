/* check-data-counts.js — 数据完整性探针（回滚演练的证据：数据没被回滚弄坏）
 *
 * 用法：
 *   node tools/check-data-counts.js --tag before --out a.json
 *   node tools/check-data-counts.js --tag after  --out b.json --compare a.json
 *
 * 判据：
 *   · 行数：用 Prefer: count=exact 拿 content-range 的库里总数（不是「取回多少行」）
 *   · 内容：对匿名可读的三张表逐行做 sha256
 *     ⚠️ 指纹**排除 views 列** —— 访客点进详情页会让 views 变化，那是真实业务写入，
 *        不是损坏。把它算进指纹 = 制造假警报。
 *
 * 只读，不写云端。
 *
 * 放在仓库内（tools/）的原因：回滚手册「回滚后四层验证」的第 3 层要用它。
 * 云配置路径相对本脚本定位（__dirname/.. = 仓库根），换克隆目录也能用。
 * ⚠️ 教训：回滚前必须先用同一脚本采一份基线快照，否则 --compare 无参照物。
 */
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const TAG = arg('tag', 'snapshot');
const OUT = arg('out', '');
const CMP = arg('compare', '');
const TABLES = ['items', 'posts', 'announcements'];
const VOLATILE = ['views'];   // 会被真实访问改动的列，不进指纹

const cfgPath = path.resolve(__dirname, '..', 'js', 'cloud-config.js');
const cfgText = fs.readFileSync(cfgPath, 'utf8');
const EP = ((cfgText.match(/endpoint:\s*"([^"]+)"/) || [])[1] || '').replace(/\/+$/, '');
const KEY = (cfgText.match(/publishableKey:\s*"([^"]+)"/) || [])[1] || '';
const HEADERS = { 'x-wb-webapp-access-key': KEY, Prefer: 'count=exact' };
const sha = (s) => require('crypto').createHash('sha256').update(s).digest('hex').slice(0, 16);

(async () => {
  const snap = { tag: TAG, at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const r = await fetch(EP + '/.cloud/database/rest/' + t + '?select=*&order=id&limit=1000', { headers: HEADERS });
    const rows = await r.json();
    const range = r.headers.get('content-range') || '';
    const dbCount = (range.match(/\/(\d+)\s*$/) || [])[1];
    const stripped = rows.map((row) => {
      const o = Object.assign({}, row);
      VOLATILE.forEach((k) => delete o[k]);
      return o;
    });
    const viewsSum = rows.reduce((s, x) => s + (Number(x.views) || 0), 0);
    snap.tables[t] = {
      http: r.status,
      got: rows.length,
      dbCount: dbCount !== undefined ? Number(dbCount) : null,
      viewsSum,
      hash: sha(JSON.stringify(stripped)),
    };
    const v = snap.tables[t];
    console.log('  ' + t.padEnd(14) + ' HTTP ' + v.http + '  行数 ' + v.got + '/' + v.dbCount +
      '  views 合计 ' + v.viewsSum + '  指纹 ' + v.hash);
  }
  if (OUT) { fs.writeFileSync(OUT, JSON.stringify(snap, null, 2)); console.log('快照写入 ' + OUT); }

  if (CMP) {
    const a = JSON.parse(fs.readFileSync(CMP, 'utf8'));
    console.log('\n对比 ' + a.tag + '（' + a.at + '） → ' + TAG + '（' + snap.at + '）');
    let bad = 0;
    for (const t of TABLES) {
      const x = a.tables[t], y = snap.tables[t];
      const sameCount = x.got === y.got && x.dbCount === y.dbCount;
      const sameHash = x.hash === y.hash;
      if (!sameCount || !sameHash) bad++;
      console.log('  ' + (sameCount && sameHash ? '✓ 一致' : '✗ 变化') + '  ' + t.padEnd(14) +
        '行数 ' + x.got + '/' + x.dbCount + ' → ' + y.got + '/' + y.dbCount +
        '  指纹 ' + (sameHash ? '相同' : x.hash + ' → ' + y.hash));
    }
    console.log(bad === 0 ? '结论：数据零变化（回滚没有碰到数据）'
      : '结论：有 ' + bad + ' 张表发生变化 —— 先查清是业务写入还是损坏，再继续');
    process.exit(bad === 0 ? 0 : 1);
  }
})();
