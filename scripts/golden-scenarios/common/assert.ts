/**
 * assert.ts — GSS 机器断言引擎（黄金场景共享基建 3/4）
 *
 * 一句话: 按 expect.json 逐条断言产品物理输出 → evidence JSON（calc-progress.py 直接消费）。
 *
 * 契约:
 *   @input  — --expect <expect.json>（断言清单，结构契约见 expect-schema.json）
 *             [--out <证据路径>]（默认 scripts/golden-scenarios/evidence/<场景>-<日期>.json）
 *             [--date YYYY-MM-DD]（默认今天）
 *   @output — evidence JSON（calc-progress 兼容: schema=1 / record_type=scenario /
 *             verdicts:[{acceptance_point, verdict, quote}]）+ stdout 摘要
 *   @exit   — 0 = 全部断言 pass；1 = 任一断言 fail/error（D328 三态：业务阻断）
 *             2 = 断言清单非法/IO 失败（fail-closed，绝不把"没跑成"当"通过"）
 *   @degraded — 查询失败（sqlite 语法错/HTTP 连不上）记 verdict="error" 并显式告警
 *               —— 三态语义: "真空结果"（查询成功零结果）≠ "查询失败"（K3 P0-3 fail-open 教训）
 *
 * 红线（GSS 设计 §2.3）:
 *   - 每条断言必须带 purpose（证明产品哪个承诺）——缺 purpose 拒绝执行（防恒真/空壳）
 *   - 断言只认产品物理输出（HTTP 响应/表行数/文件内容/进程退出码），不认 agent 自述
 *   - 场景判定 = 机器判定（exit 0/1），禁止"人工看看差不多"
 */
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ESM 下加载 better-sqlite3（仓库依赖，场景运行时必有）
const require = createRequire(import.meta.url);
// ESM 主模块判断（package.json type=module 下 require.main 不可用）
const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'scripts', 'golden-scenarios', 'evidence');

const CHECK_TYPES = new Set(['http', 'sqlite', 'file', 'process']);
const ROWS_OPS = new Set(['>=1', '==0', '>0', '>=0']);
const CELL_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains']);

interface Assertion {
  id: string;
  desc: string;
  purpose: string;
  check: Record<string, unknown>;
  expect: Record<string, unknown>;
}

interface ExpectDoc {
  scenario_id: string;
  evidence_map: Array<{ acceptance_point: string; assertion_ids: string[] }>;
  assertions: Assertion[];
}

export interface AssertionResult {
  id: string;
  desc: string;
  purpose: string;
  verdict: 'pass' | 'fail' | 'error';
  detail: string;
}

// ─── 结构校验（fail-closed，expect-schema.json 的执行体；抛错由 main 转 exit 2） ───
export class ExpectDocError extends Error {}

export function validateExpectDoc(doc: unknown): ExpectDoc {
  const d = doc as ExpectDoc;
  const problems: string[] = [];
  if (!d || typeof d !== 'object') problems.push('expect.json 必须是对象');
  if (typeof d.scenario_id !== 'string' || !/^GS-\d{2}$/.test(d.scenario_id))
    problems.push('scenario_id 缺失或格式非法（需 GS-XX）');
  if (!Array.isArray(d.assertions) || d.assertions.length < 3)
    problems.push('assertions 必须 ≥3 条（正常 + 降级 + 负向，GSS 设计 §2.3）');
  if (!Array.isArray(d.evidence_map)) problems.push('evidence_map 缺失（验收点 ↔ 断言映射）');
  for (const a of d.assertions || []) {
    if (!a.id || typeof a.desc !== 'string' || !a.desc) problems.push(`断言缺 id/desc: ${JSON.stringify(a)}`);
    if (typeof a.purpose !== 'string' || !a.purpose.trim())
      problems.push(`断言 ${a.id} 缺 purpose——恒真/空壳断言禁止（写明证明产品哪个承诺）`);
    if (!a.check || !CHECK_TYPES.has(String(a.check.type)))
      problems.push(`断言 ${a.id} check.type 非法（白名单: ${[...CHECK_TYPES].join('/')}）`);
    if (!a.expect || Object.keys(a.expect).length === 0)
      problems.push(`断言 ${a.id} expect 为空——禁止恒真断言`);
    if (a.expect && 'rows' in a.expect && !ROWS_OPS.has(String(a.expect.rows)))
      problems.push(`断言 ${a.id} expect.rows 操作符非法（白名单: ${[...ROWS_OPS].join('/')}）`);
    if (a.expect && typeof a.expect.cell === 'object' && a.expect.cell !== null) {
      const op = String((a.expect.cell as { op?: string }).op || '');
      if (!CELL_OPS.has(op)) problems.push(`断言 ${a.id} expect.cell.op 非法（白名单: ${[...CELL_OPS].join('/')}）`);
    }
  }
  if (problems.length) {
    throw new ExpectDocError('断言清单非法（fail-closed）:\n  - ' + problems.join('\n  - '));
  }
  return d;
}

// ─── check 执行器（三态: pass/fail/error） ───
function runHttp(check: Record<string, unknown>): { status: number; body: string } {
  // 同步执行: 用子进程 curl 保证零异步依赖（Windows Git Bash 自带 curl）
  const url = String(check.url);
  const r = childProcess.spawnSync('curl', ['-sS', '-w', '\n__STATUS__:%{http_code}', url], {
    encoding: 'utf-8', timeout: Number(check.timeoutMs || 30000),
  });
  if (r.error) {
    const err = new Error(`HTTP 请求失败: ${r.error.message}`);
    (err as Error & { code: string }).code = 'ASSERT_HTTP_ERROR';
    throw err;
  }
  const parts = r.stdout.split('__STATUS__:');
  return { status: Number(parts[1]?.trim() || 0), body: parts[0] || '' };
}

function runSqlite(check: Record<string, unknown>): { rows: number; firstRow: Record<string, unknown> | null } {
  const Database = require('better-sqlite3');
  const db = new Database(String(check.db), { readonly: true });
  try {
    const rows = db.prepare(String(check.sql)).all() as Array<Record<string, unknown>>;
    return { rows: rows.length, firstRow: rows[0] || null };
  } catch (e) {
    const err = new Error(`SQL 查询失败: ${e instanceof Error ? e.message : e}`);
    (err as Error & { code: string }).code = 'ASSERT_SQLITE_ERROR';
    throw err;
  } finally {
    db.close();
  }
}

function runFile(check: Record<string, unknown>): { exists: boolean; content: string } {
  const p = String(check.path);
  if (!fs.existsSync(p)) return { exists: false, content: '' };
  try {
    return { exists: true, content: fs.readFileSync(p, 'utf-8') };
  } catch (e) {
    const err = new Error(`文件读取失败: ${e instanceof Error ? e.message : e}`);
    (err as Error & { code: string }).code = 'ASSERT_FILE_ERROR';
    throw err;
  }
}

function runProcess(check: Record<string, unknown>): { exitCode: number; stdout: string } {
  const r = childProcess.spawnSync(String(check.command), (check.args as string[]) || [], {
    encoding: 'utf-8', timeout: Number(check.timeoutMs || 60000), cwd: String(check.cwd || REPO_ROOT),
  });
  if (r.error) {
    const err = new Error(`进程执行失败: ${r.error.message}`);
    (err as Error & { code: string }).code = 'ASSERT_PROCESS_ERROR';
    throw err;
  }
  return { exitCode: r.status ?? -1, stdout: r.stdout || '' };
}

// ─── 期望判定 ───
function evaluate(expect: Record<string, unknown>, got: Record<string, unknown>): { pass: boolean; detail: string } {
  const fails: string[] = [];
  if ('status' in expect && got.status !== expect.status)
    fails.push(`status 期望 ${expect.status} 实际 ${got.status}`);
  if ('rows' in expect) {
    const op = String(expect.rows);
    const rows = Number(got.rows);
    const ok = op === '>=1' ? rows >= 1 : op === '>0' ? rows > 0
      : op === '==0' ? rows === 0 : op === '>=0' ? rows >= 0 : null;
    if (ok === null) throw new Error(`rows 操作符非法: ${op}`);
    if (!ok) fails.push(`rows 期望 ${op} 实际 ${rows}`);
  }
  if ('cell' in expect) {
    const cell = expect.cell as { column: string; op: string; value: unknown };
    if (!CELL_OPS.has(cell.op)) throw new Error(`cell.op 非法: ${cell.op}`);
    const firstRow = got.firstRow as Record<string, unknown> | null;
    if (!firstRow) {
      fails.push(`cell 断言要求首行存在但结果为空（真空≠通过）`);
    } else {
      const actual = firstRow[cell.column];
      let cellOk = false;
      if (cell.op === 'eq') cellOk = actual === cell.value;
      else if (cell.op === 'ne') cellOk = actual !== cell.value;
      else if (cell.op === 'contains') cellOk = String(actual).includes(String(cell.value));
      else if (cell.op === 'not_contains') cellOk = !String(actual).includes(String(cell.value));
      else if (typeof actual === 'number' && typeof cell.value === 'number') {
        if (cell.op === 'gt') cellOk = actual > cell.value;
        else if (cell.op === 'gte') cellOk = actual >= cell.value;
        else if (cell.op === 'lt') cellOk = actual < cell.value;
        else if (cell.op === 'lte') cellOk = actual <= cell.value;
      }
      if (!cellOk) fails.push(`cell ${cell.column} ${cell.op} ${JSON.stringify(cell.value)} 实际 ${JSON.stringify(actual)}`);
    }
  }
  if ('exists' in expect && got.exists !== expect.exists)
    fails.push(`exists 期望 ${expect.exists} 实际 ${got.exists}`);
  if ('contains' in expect && !String(got.content || got.body || '').includes(String(expect.contains)))
    fails.push(`contains "${String(expect.contains).slice(0, 60)}" 未命中`);
  if ('notContains' in expect && String(got.content || got.body || '').includes(String(expect.notContains)))
    fails.push(`notContains "${String(expect.notContains).slice(0, 60)}" 不该出现却出现（负向断言失败）`);
  if ('exitCode' in expect && got.exitCode !== expect.exitCode)
    fails.push(`exitCode 期望 ${expect.exitCode} 实际 ${got.exitCode}`);
  if ('stdoutContains' in expect && !String(got.stdout || '').includes(String(expect.stdoutContains)))
    fails.push(`stdoutContains 未命中`);
  return { pass: fails.length === 0, detail: fails.length ? fails.join('; ') : '符合预期' };
}

// ─── 主引擎 ───
/**
 * 观测值摘要 —— 让证据 quote 携带"实际看到什么"。
 *
 * 动机（D804 验收修补 ③）：pass 的 detail 原为恒定 `符合预期`，quote 因此只证明
 * "断言形状对"，不携带真值——GS-01 的 6-1 正是此类：`contains CONSULT_LLM_` 对
 * GREEN 与 RED 同样通过，README 却声称"GREEN/RED 的值由 evidence quote 呈现"。
 * 补上观测摘要后该声称才成立（判据不变，只让真值可见）。
 *
 * @input  — got: check 执行器原始产出（file→content / http→body / process→stdout）
 * @output — 单行摘要 `；实际: <≤160 字符>`；无可摘内容或非字符串产出 → 空串
 * @degraded — 非字符串/空内容 → 空串（不编造观测值；不影响断言判定本身）
 */
function observedExcerpt(got: Record<string, unknown>): string {
  const raw = got.content ?? got.body ?? got.stdout;
  if (typeof raw !== 'string') return '';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return `；实际: ${oneLine.slice(0, 160)}${oneLine.length > 160 ? '…' : ''}`;
}

export function runAssertions(doc: ExpectDoc): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (const a of doc.assertions) {
    const res: AssertionResult = { id: a.id, desc: a.desc, purpose: a.purpose, verdict: 'pass', detail: '' };
    try {
      let got: Record<string, unknown>;
      switch (a.check.type) {
        case 'http': {
          const r = runHttp(a.check);
          got = { status: r.status, body: r.body };
          break;
        }
        case 'sqlite': {
          const r = runSqlite(a.check);
          got = { rows: r.rows, firstRow: r.firstRow };
          break;
        }
        case 'file': {
          const r = runFile(a.check);
          got = { exists: r.exists, content: r.content };
          break;
        }
        case 'process': {
          const r = runProcess(a.check);
          got = { exitCode: r.exitCode, stdout: r.stdout };
          break;
        }
        default:
          throw new Error(`未知 check 类型: ${String(a.check.type)}`);
      }
      const ev = evaluate(a.expect, got);
      res.verdict = ev.pass ? 'pass' : 'fail';
      // pass 也带上观测值——evidence quote 必须呈现真值（D804 验收修补 ③）
      res.detail = ev.pass ? `符合预期${observedExcerpt(got)}` : ev.detail;
    } catch (e) {
      // 查询失败 ≠ 真空 ≠ 通过 —— 三态语义（K3 P0-3 fail-open 教训）
      res.verdict = 'error';
      res.detail = `查询失败: ${e instanceof Error ? e.message : e}`;
      console.error(`degraded: 断言 ${a.id} 查询失败（error 态，场景将判 fail）: ${res.detail}`);
    }
    results.push(res);
  }
  return results;
}

export function buildEvidence(doc: ExpectDoc, results: AssertionResult[], date: string, source: string): Record<string, unknown> {
  const verdicts = doc.evidence_map.map((m) => {
    const related = results.filter((r) => m.assertion_ids.includes(r.id));
    const bad = related.filter((r) => r.verdict !== 'pass');
    const quote = related.map((r) => `${r.id} ${r.verdict}: ${r.desc}（${r.detail}）`).join(' | ');
    return { acceptance_point: m.acceptance_point, verdict: bad.length ? 'fail' : 'pass', quote };
  });
  const overall = results.every((r) => r.verdict === 'pass') ? 'pass' : 'fail';
  return {
    schema: 1,
    record_type: 'scenario',
    scenario_id: doc.scenario_id,
    source,
    date,
    verdict: overall,
    verdicts,
    assertions: results,
  };
}

export function main(): void {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const expectPath = get('--expect');
  if (!expectPath) {
    console.error('用法: npx tsx assert.ts --expect <expect.json> [--out <路径>] [--date YYYY-MM-DD]');
    process.exit(2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(expectPath, 'utf-8'));
  } catch (e) {
    console.error(`degraded: expect.json 读取失败: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  let doc: ExpectDoc;
  try {
    doc = validateExpectDoc(raw);
  } catch (e) {
    console.error(`degraded: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const results = runAssertions(doc);
  const date = get('--date') || new Date().toISOString().slice(0, 10);
  const evidence = buildEvidence(doc, results, date, path.relative(REPO_ROOT, expectPath));

  const outPath = get('--out') || path.join(DEFAULT_EVIDENCE_DIR, `${doc.scenario_id}-${date}.json`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.error(`degraded: 证据写入失败 ${outPath}: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const passCount = results.filter((r) => r.verdict === 'pass').length;
  console.log(`[assert] ${doc.scenario_id}: ${passCount}/${results.length} 断言通过 → verdict=${evidence.verdict}`);
  console.log(`[assert] 证据: ${outPath}`);
  for (const r of results) {
    if (r.verdict !== 'pass') console.error(`  ✗ ${r.id} (${r.verdict}): ${r.detail}`);
  }
  process.exit(evidence.verdict === 'pass' ? 0 : 1);
}

if (isMain) {
  main();
}
