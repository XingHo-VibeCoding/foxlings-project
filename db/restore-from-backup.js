/* db/restore-from-backup.js — 把备份还原成「可执行的恢复 SQL」
 *
 * 为什么单独一个文件：备份不是备份，「能导回来」才算。
 * 这一步只做一件事 —— 把 db/export-data.js 导出的 json 变成一串 INSERT 语句，
 * 交给人用 MCP exec_sql **一条一条**执行（数据通道拦 DDL/批量，一次只收一条）。
 *
 * 用法：
 *   node db/restore-from-backup.js --dir <备份目录>           # 生成 restore.sql + 打印执行指引
 *   node db/restore-from-backup.js --dir <备份目录> --print   # 把全部语句打到屏幕上
 *
 * 安全设计（都是"宁可不动数据"）：
 *   · manifest 里 items 不是 full → 直接拒绝生成（半份备份导入 = 把缺的行留在缺失状态）
 *   · 一律 ON CONFLICT (id) DO NOTHING → 重复执行不产生重复行，也不会覆盖现场已有数据
 *   · 只生成 INSERT，不生成 UPDATE/DELETE —— 恢复工具不该有"顺手改一下"的能力
 */
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const DIR = arg('dir', '');
if (!DIR) { console.error('缺少 --dir <备份目录>'); process.exit(1); }
const PRINT = process.argv.includes('--print');
const CHUNK = Number(arg('chunk', '20'));

const ROOT = path.resolve(__dirname, '..');

/**
 * 这张表的 id 是不是 GENERATED ALWAYS AS IDENTITY？
 * 必须是：identity 列**不允许**显式插值（实测会回 428C9），恢复时要加 OVERRIDING SYSTEM VALUE。
 * 口径以 db/schema.sql 为准（数据库结构改了就同步那个文件），而不是硬编码在脚本里。
 * 实测（2026-10-15，information_schema）：announcements / posts / reports 都是 ALWAYS。
 */
function isIdentityTable(table) {
  let sql;
  try { sql = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'); }
  catch (e) { return null; }                       // 读不到 schema → 不敢断言
  const seg = sql.split(/CREATE\s+TABLE/i).slice(1).find((s) => {
    const firstLine = s.split('\n')[0];        // 形如 " IF NOT EXISTS announcements ("
    return new RegExp('\\b' + table + '\\b').test(firstLine);
  });
  if (!seg) return null;
  const body = seg.split(/^\);/m)[0];
  return /id\s+BIGINT\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY/i.test(body);
}

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
if (!manifest.tables || !manifest.tables.items || manifest.tables.items.extent !== 'full') {
  console.error('✗ 这份备份的 items 不是 full 全量 → 拒绝生成恢复语句。');
  console.error('  半份备份导回去，只会得到"少了一部分行"的库，比不导更危险。');
  process.exit(1);
}

const stmts = [];
const summary = [];
for (const [table, info] of Object.entries(manifest.tables)) {
  const f = path.join(DIR, table + '.json');
  if (!fs.existsSync(f)) continue;
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!rows.length) continue;

  // 列 = 所有行键的并集（别假设每行键都一样），顺序按首行
  const cols = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
  const colList = cols.map((c) => '"' + c + '"').join(', ');
  const idn = isIdentityTable(table);
  const override = idn === true ? ' OVERRIDING SYSTEM VALUE' : '';
  const idnNote = idn === true ? 'identity 列 → 加 OVERRIDING SYSTEM VALUE'
    : idn === false ? '普通列' : 'schema.sql 里没找到这张表 → 按普通列生成（执行时报错就是判错了，回来看这里）';

  const before = stmts.length;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const values = batch.map((r) => '(' + cols.map((c) => lit(r[c])).join(', ') + ')').join(',\n  ');
    stmts.push('INSERT INTO ' + table + ' (' + colList + ')' + override + ' VALUES\n  ' + values +
      '\nON CONFLICT (id) DO NOTHING;');
  }
  // identity 表：显式插了 id 之后必须把序列推到最大值，否则下次正常插入会撞主键
  if (idn === true) {
    stmts.push('SELECT setval(pg_get_serial_sequence(\'' + table + '\', \'id\'), ' +
      'COALESCE((SELECT MAX(id) FROM ' + table + '), 1));');
  }
  summary.push('  ' + table.padEnd(14) + ' ' + rows.length + ' 行 → ' +
    (stmts.length - before) + ' 条语句   [' + idnNote + ']');
}

const out = path.join(DIR, 'restore.sql');
fs.writeFileSync(out, '-- 由 db/restore-from-backup.js 从 ' + manifest.exportedAt + ' 的备份生成（提交 ' + manifest.commit + '）\n' +
  '-- 逐条执行；已存在的行会被跳过（ON CONFLICT DO NOTHING）。\n\n' + stmts.join('\n\n') + '\n');

console.log('备份来源 ' + DIR);
console.log('生成 ' + stmts.length + ' 条语句：');
summary.forEach((s) => console.log(s));
console.log('写入 ' + out);
console.log('');
console.log('执行方式：把语句**一条一条**贴进 MCP exec_sql（数据通道一次只收一条）。');
console.log('执行完必须复查：行数与备份 manifest 的 dbCount 一致，且新值能被匿名接口读到。');
if (!Object.keys(manifest.tables).includes('profiles') || manifest.tables.profiles.extent !== 'full') {
  console.log('⚠️ 提醒：profiles / admins / reports 不在可恢复范围内（匿名身份读不到）—— 这份备份救不了它们的误删。');
}
if (PRINT) { console.log('\n----- restore.sql -----\n'); console.log(stmts.join('\n\n')); }
