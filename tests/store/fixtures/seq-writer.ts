/**
 * tests/store/fixtures/seq-writer.ts — E1/R-E1 seq 并发写子进程夹具（**非测试文件**，不被 vitest 收集）
 *
 * 用途（规格 §4.2 判据 ②）:
 *   用**真实 `SessionStore.appendEvent`** 在多个**进程**里并发写**同一会话**，
 *   由父进程（`tests/store/session-seq-concurrency.test.ts` T2a）只读直查 DB 验证
 *   「总数 = 2000 ∧ min=1 ∧ max=2000 ∧ distinct=2000 ∧ 子进程 degraded 合计 = 0」。
 *
 * 为什么必须子进程: better-sqlite3 是同步 API ⇒ 单进程内无法制造写交错（规格 §6）；
 *   且 `UNIQUE(session_id,seq)` 冲突在多进程下才会真实发生（P5 实测旧代码 1936/2000）。
 *
 * 调用方式（父进程原文，逐字）:
 *   spawn(process.execPath, ['--import', 'tsx', <fixture>, <dbPath>, <sessionId>, <count>])
 *   —— 与仓内既有范式同形（`scripts/control-tower/probe-knowledge-scope.ts:1281`）。
 *
 * 契约（铁律 47）:
 *   @input  — argv: dbPath（已由父进程建好 schema/会话的文件库）、sessionId、count
 *   @output — stdout 一行 JSON `{"ok":<n>,"degraded":<n>}`；exit 0 = 跑完
 *   @degraded — appendEvent 返回 degraded 时计入 `degraded`（不吞、不重试到无限）
 *   @exit   — 0 = 正常跑完 ｜ 1 = 运行时抛错（stderr 留原文，父进程判红）｜
 *             2 = 环境/参数失败（三态约定：**环境失败不得被当作通过**）
 */
import Database from 'better-sqlite3';
import { SessionStore } from '../../../src/store/session-store';

const [dbPath, sessionId, rawCount] = process.argv.slice(2);

if (!dbPath || !sessionId || !rawCount) {
  process.stderr.write('ENV: seq-writer 参数缺失，期望 <dbPath> <sessionId> <count>\n');
  process.exit(2);
}

const count = Number.parseInt(rawCount, 10);
if (!Number.isFinite(count) || count <= 0) {
  process.stderr.write(`ENV: seq-writer count 非法: ${rawCount}\n`);
  process.exit(2);
}

const db = new Database(dbPath);
// WAL + busy_timeout：并发写者排队而不是立刻 SQLITE_BUSY（设计稿 §2.2 并发测试规格）。
// busy_timeout 同时会被 SessionStore 构造按 SYNO_SESSION_BUSY_TIMEOUT_MS 重设；此处先设，
// 保证构造期（initSchema 的 DDL）也有等待窗口。
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const store = new SessionStore(db);
let ok = 0;
let degraded = 0;

for (let i = 0; i < count; i++) {
  const res = store.appendEvent(sessionId, 'message', { role: 'user', content: `w-${process.pid}-${i}` });
  if (res.ok) ok += 1;
  else degraded += 1;
}

db.close();
process.stdout.write(`${JSON.stringify({ ok, degraded })}\n`);
