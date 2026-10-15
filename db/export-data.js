/* db/export-data.js — 发布前数据导出（备份）
 *
 * 为什么要有这个文件：回滚只能救人写坏的**代码**，救不回被删的**数据**。
 * 数据一旦误删，唯一的出路是「发布前导出的备份 + 重新导入」，所以导出必须是发布流程的一环。
 *
 * 用法：
 *   node db/export-data.js --out <备份目录> [--label v1.0.0]
 *
 * ⚠️ 备份目录必须**放在仓库之外**（默认建议工作区）：本项目的发布是「上传整个项目目录」，
 *    备份放进仓库 = 备份会被公开。脚本会检查并拒绝写在仓库内（--force 可强过，但要想清楚）。
 *
 * 输出：<out>/<本地时间>-<label>/ 目录下每张表一个 json + 一份 manifest.json
 * manifest 会如实记下每张表「导出到了什么程度」：full（全量）/ partial（只读到匿名可见的行）/ denied（读不到）
 *
 * 只读，不写云端。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TABLES = ['items', 'posts', 'reports', 'profiles', 'admins', 'announcements'];

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const OUT = arg('out', '');
const LABEL = arg('label', 'manual');
if (!OUT) { console.error('缺少 --out <备份目录>'); process.exit(1); }

/** 从 js/cloud-config.js 读 endpoint / publishableKey —— 这两个是公开标识，不是密钥 */
function readConfig() {
  const t = fs.readFileSync(path.join(ROOT, 'js/cloud-config.js'), 'utf8');
  return {
    endpoint: ((t.match(/endpoint:\s*"([^"]+)"/) || [])[1] || '').replace(/\/+$/, ''),
    key: (t.match(/publishableKey:\s*"([^"]+)"/) || [])[1] || '',
  };
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function gitHead() {
  try {
    return require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch (e) { return 'unknown'; }
}

(async () => {
  const outAbs = path.resolve(OUT);
  if (outAbs.startsWith(path.resolve(ROOT)) && !process.argv.includes('--force')) {
    console.error('✗ 备份目录落在仓库内：' + outAbs);
    console.error('  本项目的发布会把整个项目目录公开 —— 备份进仓库等于把备份也发出去。');
    console.error('  换一个仓库外的目录（例如工作区 verify/backups/），或明确加 --force。');
    process.exit(1);
  }

  const cfg = readConfig();
  if (!cfg.endpoint || !cfg.key) { console.error('✗ 读不到 endpoint / publishableKey（js/cloud-config.js）'); process.exit(1); }
  const headers = { 'x-wb-webapp-access-key': cfg.key };

  const dir = path.join(outAbs, stamp(new Date()) + '-' + LABEL);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    exportedAt: new Date().toISOString(),
    commit: gitHead(),
    label: LABEL,
    endpoint: cfg.endpoint,
    note: '匿名数据角色导出的快照。partial = 只含匿名可见的行（RLS 过滤），denied = 完全读不到。',
    tables: {},
  };

  let coreOk = true;
  for (const t of TABLES) {
    const url = cfg.endpoint + '/.cloud/database/rest/' + t + '?select=*&limit=1000';
    let entry;
    try {
      const r = await fetch(url, { headers: Object.assign({ Prefer: 'count=exact' }, headers) });
      const text = await r.text();
      let rows = null;
      try { rows = JSON.parse(text); } catch (e) { /* 非 JSON */ }
      const range = r.headers.get('content-range') || '';
      const dbCount = (range.match(/\/(\d+)\s*$/) || [])[1];
      if (r.status === 200 && Array.isArray(rows)) {
        if (rows.length === 0) {
          // 关键判据：匿名身份下「200 + 空数组 + count 0」**不能证明表是空的** ——
          // RLS 没有 SELECT 策略时 PostgREST 同样回 200 空数组。分辨不了就只能说分辨不了。
          entry = {
            http: 200, rows: 0, dbCount: dbCount !== undefined ? Number(dbCount) : null,
            extent: 'unknown',
            reason: '读到 0 行 —— 可能真是空表，也可能被 RLS 挡光了，匿名身份分辨不了',
          };
        } else {
          const complete = dbCount !== undefined && Number(dbCount) === rows.length;
          fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(rows, null, 2));
          entry = {
            http: 200, rows: rows.length,
            dbCount: dbCount !== undefined ? Number(dbCount) : null,
            extent: complete ? 'full' : 'partial',
            reason: complete ? '取回行数 = 库里总数' : '只读到匿名可见的行（RLS 过滤掉了一部分）',
          };
        }
      } else {
        entry = { http: r.status, rows: 0, extent: 'denied', reason: (rows && (rows.message || rows.code)) || text.slice(0, 120) };
      }
    } catch (e) {
      entry = { http: 0, rows: 0, extent: 'denied', reason: e.message };
    }
    manifest.tables[t] = entry;
    if (t === 'items' && entry.extent !== 'full') coreOk = false;
    const mark = entry.extent === 'full' ? '✓ 全量'
      : entry.extent === 'partial' ? '~ 部分'
      : entry.extent === 'unknown' ? '? 不明' : '✗ 读不到';
    console.log('  ' + mark + '  ' + t.padEnd(14) + ' HTTP ' + entry.http +
      '  导出 ' + entry.rows + ' 行' + (entry.dbCount !== null ? ' / 库里 ' + entry.dbCount : '') +
      '   ' + entry.reason);
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const weak = Object.entries(manifest.tables)
    .filter(([, v]) => v.extent !== 'full').map(([k, v]) => k + '（' + v.extent + '）');
  console.log('');
  console.log('备份写入 ' + dir);
  console.log('提交 ' + manifest.commit + ' · 导出时刻 ' + manifest.exportedAt);
  if (weak.length) console.log('⚠️ 这份备份没拿全的表：' + weak.join('、') + ' —— 恢复时这部分不可依赖匿名备份，需要管理员通道');
  console.log(coreOk ? '结论：核心内容表 items 已全量导出。' : '结论：items 未能全量导出，这份备份不可用于恢复！');
  process.exit(coreOk ? 0 : 1);
})();
