/**
 * rename-check.mts — D967④ 改名判别性复核（自建夹具）
 * A) 采用实现路径（ALTER … RENAME TO）→ 旧表数据必须原地保留
 * B) 反事实陷阱（CREATE 新表 + 不搬运）→ 新表 0 行、旧表数据孤悬 = 静默丢数据
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, rmSync } from 'fs';
const WT = process.argv.find(a => a.startsWith('--wt='))!.slice(5);
const OUT = '/tmp/verify-d967';
const { BaselineStore } = await import(`${WT}/src/sentinel/baseline-store.ts`);

const OLD_DDL = `
CREATE TABLE sentinel_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sentinel_id TEXT NOT NULL,
  finding_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT NOT NULL
);
CREATE INDEX idx_sentinel_baselines_sid ON sentinel_baselines(sentinel_id, checked_at);`;

function seed(path: string) {
  if (existsSync(path)) rmSync(path, { force: true });
  copyFileSync(`${OUT}/prod.db`, path);
  const db = new Database(path);
  db.exec('DROP TABLE IF EXISTS sentinel_baselines');
  db.exec('DROP TABLE IF EXISTS sentinel_alert_stats');
  db.exec(OLD_DDL);
  const ins = db.prepare('INSERT INTO sentinel_baselines (sentinel_id, finding_count, critical_count, warning_count, checked_at) VALUES (?,?,?,?,?)');
  ins.run('sentinel-cash-runway', 5, 1, 4, '2026-09-01T00:00:00Z');
  ins.run('sentinel-cash-runway', 7, 2, 5, '2026-09-02T00:00:00Z');
  ins.run('sentinel-unit-economics', 3, 0, 3, '2026-09-02T00:00:00Z');
  db.close();
}
const tables = (db: Database.Database) => (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sentinel_baselines','sentinel_alert_stats') ORDER BY name").all() as Array<{ name: string }>).map(r => r.name);
const indexes = (db: Database.Database) => (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%sentinel%' ORDER BY name").all() as Array<{ name: string }>).map(r => r.name);
const count = (db: Database.Database, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

console.log('═══ A) 实现路径：ALTER TABLE … RENAME TO（PR-B 代码）═══');
{
  const p = `${OUT}/rename-A.db`;
  seed(p);
  const db = new Database(p);
  console.log(`before: tables=${JSON.stringify(tables(db))} old_rows=${count(db, 'sentinel_baselines')} indexes=${JSON.stringify(indexes(db))}`);
  const store = new BaselineStore();
  store.setDatabase(db as never);
  console.log(`after : tables=${JSON.stringify(tables(db))} new_rows=${count(db, 'sentinel_alert_stats')} indexes=${JSON.stringify(indexes(db))}`);
  const rows = db.prepare('SELECT sentinel_id, finding_count, checked_at FROM sentinel_alert_stats ORDER BY sentinel_id, checked_at').all();
  console.log('搬运后数据:', JSON.stringify(rows));
  // 追加一条新记录仍可用（写路径指向新名）
  db.prepare('INSERT INTO sentinel_alert_stats (sentinel_id, finding_count, critical_count, warning_count, checked_at) VALUES (?,?,?,?,?)')
    .run('sentinel-cash-runway', 9, 3, 6, '2026-09-03T00:00:00Z');
  console.log(`追加后 new_rows=${count(db, 'sentinel_alert_stats')}`);
  // 幂等：再次 setDatabase 不应重复改名/报错
  const store2 = new BaselineStore();
  store2.setDatabase(db as never);
  console.log(`幂等再跑: tables=${JSON.stringify(tables(db))} new_rows=${count(db, 'sentinel_alert_stats')}`);
  db.close();
}

console.log('\n═══ B) 反事实陷阱：建新表（不搬运）会怎样 ═══');
{
  const p = `${OUT}/rename-B.db`;
  seed(p);
  const db = new Database(p);
  console.log(`before: tables=${JSON.stringify(tables(db))} old_rows=${count(db, 'sentinel_baselines')}`);
  // 模拟错误实现：直接 CREATE 新表 + 新索引，不 RENAME、不搬运
  db.exec(`CREATE TABLE IF NOT EXISTS sentinel_alert_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sentinel_id TEXT NOT NULL,
    finding_count INTEGER NOT NULL DEFAULT 0, critical_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0, checked_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_sentinel_alert_stats_sid ON sentinel_alert_stats(sentinel_id, checked_at);`);
  console.log(`after : tables=${JSON.stringify(tables(db))} new_rows=${count(db, 'sentinel_alert_stats')} old_rows_still_there=${count(db, 'sentinel_baselines')}`);
  const store = new BaselineStore();
  store.setDatabase(db as never);
  const st = store.getBaseline('sentinel-cash-runway');
  console.log('应用层 getBaseline(sentinel-cash-runway) =', JSON.stringify(st), '← runCount=0 即历史静默消失');
  db.close();
}
