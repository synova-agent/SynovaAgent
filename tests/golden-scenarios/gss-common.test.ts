/**
 * gss-common.test.ts — D361 GSS 基建四工具测试（正常/降级/边界 三路径，铁律 48）
 *
 * 覆盖矩阵:
 *   fresh-db: 临时目录创建（仓库外）/ 铁律 0-4 守卫拒绝真实库（CLI exit 2）/ --ensure-temp 边界
 *   inject: 契约校验 + 归一（externalField→prop）/ 未知字段清单 / 缺必填清单 /
 *           number 归一失败拒绝（不猜值）
 *   assert: 六态判定（http/sqlite/file/process 四型检查）/ 三态语义（真空 vs 查询失败）/
 *           负向断言 notContains / 恒真防护（缺 purpose 拒绝）/ evidence 与 calc 契约对齐 /
 *           exit 0/1 语义
 *   bootstrap: 假服务真实 spawn + healthz 就绪 + 状态文件 + 停止清理（真实路由不 mock，铁律 12）
 */
import { describe, expect, it } from 'vitest';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMON = path.resolve(__dirname, '..', '..', 'scripts', 'golden-scenarios', 'common');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

function runTsx(file: string, args: string[] = [], env: Record<string, string> = {}) {
  return childProcess.spawnSync(TSX, [file, ...args], {
    encoding: 'utf-8',
    timeout: 120000,
    env: { ...process.env, ...env },
  });
}

describe('fresh-db（铁律 0-4 守卫 + 临时目录）', () => {
  it('正常: 产出仓库外临时目录', () => {
    const r = runTsx(path.join(COMMON, 'fresh-db.ts'));
    expect(r.status).toBe(0);
    const dir = r.stdout.trim();
    expect(dir).toContain(os.tmpdir());
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('回归: 环境自带 SYNOVA_DB_PATH 也不误伤（防线在 bootstrap 的临时区强制，08-16 决策）', () => {
    const r = runTsx(path.join(COMMON, 'fresh-db.ts'), [], {
      SYNOVA_DB_PATH: path.join(REPO_ROOT, 'data', 'synova.db'),
    });
    expect(r.status).toBe(0);
    const dir = r.stdout.trim();
    expect(dir).toContain(os.tmpdir());
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('边界: --ensure-temp 拒绝仓库内目录', () => {
    const r = runTsx(path.join(COMMON, 'fresh-db.ts'), ['--dir', REPO_ROOT, '--ensure-temp']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('degraded');
  });
});

describe('inject（field-mappings 契约校验）', () => {
  it('正常: 外部字段 → 本体属性归一（erp-standard 真实契约）', async () => {
    const mod = await import(path.join(COMMON, 'inject.ts'));
    const r = mod.inject('erp-standard', { 营业收入: 12345, 期间: '2026-Q2' });
    expect(r.normalized.total_revenue).toBe(12345);
    expect(r.normalized.period).toBe('2026-Q2');
    expect(r.targetNodeType).toBe('Financial');
    expect(r.unknownFields).toEqual([]);
    expect(r.missingRequired.length).toBeGreaterThan(0);
  });

  it('降级: 未知字段进清单（不静默丢）', async () => {
    const mod = await import(path.join(COMMON, 'inject.ts'));
    const r = mod.inject('erp-standard', { 营业收入: 1, 不存在的字段: 'x' });
    expect(r.unknownFields).toContain('不存在的字段');
    expect(r.normalized).not.toHaveProperty('不存在的字段');
  });

  it('边界: number 归一失败 → CLI exit 2（不猜值）', () => {
    const fixture = path.join(os.tmpdir(), `gss-fixture-${Date.now()}.json`);
    fs.writeFileSync(fixture, JSON.stringify({ 营业收入: '不是数字' }), 'utf-8');
    const r = runTsx(path.join(COMMON, 'inject.ts'), ['--mapping', 'erp-standard', '--fixture', fixture]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('INJECT_FIXTURE_ERROR');
    fs.rmSync(fixture, { force: true });
  });
});

describe('assert（三态语义 + 恒真防护 + evidence 契约）', () => {
  it('恒真防护: 缺 purpose / 断言 <3 条 / 空 expect → ExpectDocError', async () => {
    const mod = await import(path.join(COMMON, 'assert.ts'));
    expect(() => mod.validateExpectDoc({
      scenario_id: 'GS-03',
      evidence_map: [],
      assertions: [{ id: 'A1', desc: 'x', check: { type: 'file', path: '/' }, expect: { exists: true } }],
    })).toThrow(mod.ExpectDocError);
    expect(() => mod.validateExpectDoc({
      scenario_id: 'GS-03',
      evidence_map: [],
      assertions: [
        { id: 'A1', desc: 'x', check: { type: 'file', path: '/' }, expect: { exists: true } },
        { id: 'A2', desc: 'x', check: { type: 'file', path: '/' }, expect: { exists: true } },
        { id: 'A3', desc: 'x', check: { type: 'file', path: '/' }, expect: { exists: true } },
      ],
    })).toThrow(/purpose/);
  });

  it('正常+降级+负向: 四型检查全链路判定', async () => {
    const mod = await import(path.join(COMMON, 'assert.ts'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gss-assert-'));
    const dbPath = path.join(tmp, 't.db');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRequire } = await import('module');
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE tickets (id INTEGER PRIMARY KEY, level TEXT)');
    db.prepare('INSERT INTO tickets (level) VALUES (?)').run('critical');
    db.close();

    const helloFile = path.join(tmp, 'report.json');
    fs.writeFileSync(helloFile, JSON.stringify({ title: '首诊报告', hasCapital: true }), 'utf-8');
    const missingFile = path.join(tmp, 'nope.json');

    const doc = mod.validateExpectDoc({
      scenario_id: 'GS-03',
      evidence_map: [
        { acceptance_point: '10-1', assertion_ids: ['A1', 'A2'] },
        { acceptance_point: '10-6', assertion_ids: ['A3', 'A4'] },
      ],
      assertions: [
        { id: 'A1', desc: '工单表有告警行', purpose: '证明告警链路真实写库（验收点 10-1）',
          check: { type: 'sqlite', db: dbPath, sql: 'SELECT COUNT(*) AS c FROM tickets' },
          expect: { rows: '>=1' } },
        { id: 'A2', desc: '报告文件含首诊标题', purpose: '证明报告产出（验收点 10-1）',
          check: { type: 'file', path: helloFile }, expect: { exists: true, contains: '首诊报告' } },
        { id: 'A3', desc: '真空≠通过: 零结果必须用 cell 显式声明（COUNT 恒返回 1 行）', purpose: '证明降级诚实语义',
          check: { type: 'sqlite', db: dbPath, sql: "SELECT COUNT(*) AS c FROM tickets WHERE level = 'info'" },
          expect: { cell: { column: 'c', op: 'eq', value: 0 } } },
        { id: 'A4', desc: '报告不该含老板看不懂的字段', purpose: '负向断言: 不该出现却出现=失败',
          check: { type: 'file', path: missingFile }, expect: { exists: true, notContains: 'raw_salary' } },
      ],
    });
    const results = mod.runAssertions(doc);
    const byId = Object.fromEntries(results.map((r: { id: string }) => [r.id, r]));
    expect(byId.A1.verdict).toBe('pass');
    expect(byId.A2.verdict).toBe('pass');
    expect(byId.A3.verdict).toBe('pass');
    // A4: 文件不存在 + exists:true → fail（不是 error——预期内失败，不是查询失败）
    expect(byId.A4.verdict).toBe('fail');

    const evidence = mod.buildEvidence(doc, results, '2026-08-16', 'expect.json');
    expect(evidence.schema).toBe(1);
    expect(evidence.record_type).toBe('scenario');
    expect(evidence.verdict).toBe('fail');
    expect(Array.isArray(evidence.verdicts)).toBe(true);
    expect(evidence.verdicts[0]).toMatchObject({ acceptance_point: '10-1', verdict: 'pass' });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('三态语义: SQL 语法错误 → error 态（查询失败≠真空≠通过，K3 P0-3 教训）', async () => {
    const mod = await import(path.join(COMMON, 'assert.ts'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gss-assert-'));
    const dbPath = path.join(tmp, 't.db');
    const { createRequire } = await import('module');
    const Database = createRequire(import.meta.url)('better-sqlite3');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE t (id INTEGER)');
    db.close();
    const doc = mod.validateExpectDoc({
      scenario_id: 'GS-03',
      evidence_map: [],
      assertions: [
        { id: 'A1', desc: 'x', purpose: '证明 error 态', check: { type: 'sqlite', db: dbPath, sql: 'BROKEN SQL !!!' }, expect: { rows: '>=1' } },
        { id: 'A2', desc: 'y', purpose: '证明 error 态 2', check: { type: 'file', path: dbPath }, expect: { exists: true } },
        { id: 'A3', desc: 'z', purpose: '证明 error 态 3', check: { type: 'file', path: dbPath }, expect: { exists: true } },
      ],
    });
    const results = mod.runAssertions(doc);
    expect(results[0].verdict).toBe('error');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('exit 语义: 全过 exit 0 / 有失败 exit 1（机器判定）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gss-exit-'));
    const f = path.join(tmp, 'f.txt');
    fs.writeFileSync(f, 'hello', 'utf-8');
    const expectJson = path.join(tmp, 'expect.json');
    fs.writeFileSync(expectJson, JSON.stringify({
      scenario_id: 'GS-03',
      evidence_map: [{ acceptance_point: '10-1', assertion_ids: ['A1', 'A2', 'A3'] }],
      assertions: [
        { id: 'A1', desc: 'a', purpose: 'p1', check: { type: 'file', path: f }, expect: { exists: true, contains: 'hello' } },
        { id: 'A2', desc: 'b', purpose: 'p2', check: { type: 'file', path: f }, expect: { exists: true } },
        { id: 'A3', desc: 'c', purpose: 'p3', check: { type: 'file', path: f }, expect: { exists: true, notContains: 'bye' } },
      ],
    }), 'utf-8');
    const rOk = runTsx(path.join(COMMON, 'assert.ts'), ['--expect', expectJson, '--out', path.join(tmp, 'ev.json')]);
    expect(rOk.status).toBe(0);
    const ev = JSON.parse(fs.readFileSync(path.join(tmp, 'ev.json'), 'utf-8'));
    expect(ev.verdict).toBe('pass');

    fs.writeFileSync(expectJson, JSON.stringify({
      scenario_id: 'GS-03',
      evidence_map: [{ acceptance_point: '10-1', assertion_ids: ['A1', 'A2', 'A3'] }],
      assertions: [
        { id: 'A1', desc: 'a', purpose: 'p1', check: { type: 'file', path: f }, expect: { exists: true, contains: '不存在的内容' } },
        { id: 'A2', desc: 'b', purpose: 'p2', check: { type: 'file', path: f }, expect: { exists: true } },
        { id: 'A3', desc: 'c', purpose: 'p3', check: { type: 'file', path: f }, expect: { exists: true } },
      ],
    }), 'utf-8');
    const rFail = runTsx(path.join(COMMON, 'assert.ts'), ['--expect', expectJson, '--out', path.join(tmp, 'ev2.json')]);
    expect(rFail.status).toBe(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('GS-01 断言契约回归（D804 切片 0：V1 绑定 + 负向断言迁靶）', () => {
  const GS01_DIR = path.join(REPO_ROOT, 'scripts', 'golden-scenarios', 'GS-01-first-diagnosis');
  const GS01_EXPECT = path.join(GS01_DIR, 'expect.json');
  const GS01_RUN = path.join(GS01_DIR, 'run.sh');
  const readExpect = () => JSON.parse(fs.readFileSync(GS01_EXPECT, 'utf-8'));
  // D5（S-12 决策参考）: GS-01 的键空间 = V1 验收点 ID（product-lines.yaml 原文）
  // ∪ 非 V1 自有标签（鉴权契约 S0-* / 桌面端 L1-*）——禁冒充 V1。
  const V1_IDS = new Set(['1-1', '1-3', '1-4', '6-1', '6-2']);
  const NON_V1_LABEL = /^(S\d+-\d+|L1-\d+)$/;

  it('正常: evidence_map 键 ⊆ V1 ID ∪ 非 V1 自有标签，且本片绑定面齐备', () => {
    const doc = readExpect();
    const keys = doc.evidence_map.map((m: { acceptance_point: string }) => m.acceptance_point);
    for (const key of keys) {
      expect(
        V1_IDS.has(key) || NON_V1_LABEL.test(key),
        `验收点键非法（既非 V1 ID 也非非 V1 自有标签）: ${key}`,
      ).toBe(true);
    }
    // 切片 0 绑定面 = 1-1/1-4/6-1（6-2 归切片 5，见 spec §S6 口径）
    for (const id of ['1-1', '1-4', '6-1']) expect(keys).toContain(id);
    // 每条验收点必须由真实断言背书（空背书 = 恒真覆盖，见下条）
    const ids = new Set(doc.assertions.map((a: { id: string }) => a.id));
    for (const m of doc.evidence_map) {
      const backed = (m.assertion_ids || []).filter((id: string) => ids.has(id));
      expect(backed.length, `验收点 ${m.acceptance_point} 无真实断言背书`).toBeGreaterThan(0);
    }
  });

  it('降级: 空背书/悬挂引用恒判 pass（引擎行为）→ 契约层全场景拦截', async () => {
    const mod = await import(path.join(COMMON, 'assert.ts'));
    // ① 引擎行为实证：验收点若引用零条真实断言，buildEvidence 恒判 pass——即使三条断言全红。
    //    这正是"恒真覆盖"白送绿的形态（与 assert.ts §2.3 红线"缺 purpose 拒绝执行"同源动机）。
    const hazards = mod.validateExpectDoc({
      scenario_id: 'GS-03',
      evidence_map: [{ acceptance_point: '10-1', assertion_ids: ['NOT_EXIST'] }],
      assertions: [
        { id: 'A1', desc: 'a', purpose: 'p1', check: { type: 'file', path: '/nonexistent-d804-a' }, expect: { exists: true } },
        { id: 'A2', desc: 'b', purpose: 'p2', check: { type: 'file', path: '/nonexistent-d804-b' }, expect: { exists: true } },
        { id: 'A3', desc: 'c', purpose: 'p3', check: { type: 'file', path: '/nonexistent-d804-c' }, expect: { exists: true } },
      ],
    });
    const hzResults = mod.runAssertions(hazards);
    expect(hzResults.every((r: { verdict: string }) => r.verdict !== 'pass')).toBe(true);
    const hzEvidence = mod.buildEvidence(hazards, hzResults, '2026-09-17', '自检');
    expect(hzEvidence.verdict).toBe('fail');
    expect(hzEvidence.verdicts[0].verdict).toBe('pass'); // ← 恒真覆盖：场景全红，验收点照样绿
    expect(hzEvidence.verdicts[0].quote).toBe('');

    // ② 契约层拦截：全场景 expect.json 扫描，空背书/悬挂引用必须为零（防 D804 切片 5 补 6-2 时误加空条目）
    const scenariosDir = path.join(REPO_ROOT, 'scripts', 'golden-scenarios');
    const dirs = fs.readdirSync(scenariosDir)
      .filter((d) => fs.existsSync(path.join(scenariosDir, d, 'expect.json')));
    expect(dirs.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const dir of dirs) {
      const doc = JSON.parse(fs.readFileSync(path.join(scenariosDir, dir, 'expect.json'), 'utf-8'));
      const known = new Set(doc.assertions.map((a: { id: string }) => a.id));
      for (const m of doc.evidence_map) {
        if ((m.assertion_ids || []).filter((id: string) => known.has(id)).length === 0) {
          offenders.push(`${dir}:${m.acceptance_point}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('验收修补③: pass 的 detail 携带观测真值（GREEN/RED 可区分），长内容截断、空内容不编造', async () => {
    const mod = await import(path.join(COMMON, 'assert.ts'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gss-excerpt-'));
    const statusFile = path.join(tmp, 'status.txt');
    fs.writeFileSync(statusFile, 'CONSULT_LLM_RED (LLM key 未提供 — 诚实 RED)\n', 'utf-8');
    const longFile = path.join(tmp, 'long.txt');
    fs.writeFileSync(longFile, 'x'.repeat(500), 'utf-8');
    const blankFile = path.join(tmp, 'blank.txt');
    fs.writeFileSync(blankFile, '   \n', 'utf-8');

    const doc = mod.validateExpectDoc({
      scenario_id: 'GS-03',
      evidence_map: [{ acceptance_point: '10-1', assertion_ids: ['A1', 'A2', 'A3'] }],
      assertions: [
        { id: 'A1', desc: 'd1', purpose: 'p1', check: { type: 'file', path: statusFile }, expect: { exists: true, contains: 'CONSULT_LLM_' } },
        { id: 'A2', desc: 'd2', purpose: 'p2', check: { type: 'file', path: longFile }, expect: { exists: true } },
        { id: 'A3', desc: 'd3', purpose: 'p3', check: { type: 'file', path: blankFile }, expect: { exists: true } },
      ],
    });
    const results = mod.runAssertions(doc);
    const byId = Object.fromEntries(results.map((r: { id: string; detail: string }) => [r.id, r]));
    // 正常: 真值进 detail —— GREEN/RED 由此可区分（否则 pass 只证明"形状对"）
    expect(byId.A1.verdict).toBe('pass');
    expect(byId.A1.detail).toContain('CONSULT_LLM_RED');
    // 边界: 长内容截断（不把整个文件灌进证据）
    expect(byId.A2.detail).toContain('…');
    expect(byId.A2.detail.length).toBeLessThan(220);
    // 降级: 无可摘内容 → 不编造观测值（保持原语义）
    expect(byId.A3.detail).toBe('符合预期');
    // 端到端: evidence quote 携带真值
    const ev = mod.buildEvidence(doc, results, '2026-09-17', '自检');
    expect(ev.verdicts[0].quote).toContain('CONSULT_LLM_RED');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('边界: 负向 auth 断言靶点 = 受 JWT 保护端点（D590 裁决① 前提不可回归）', () => {
    const doc = readExpect();
    const negatives = doc.assertions.filter((a: { expect?: { contains?: string } }) => a.expect?.contains === '401');
    expect(negatives.length).toBe(1);
    // 靶点产物必须来自 run.sh 对受保护端点的那次无 token 探测
    expect(String(negatives[0].check.path)).toContain('noauth-status.txt');
    expect(fs.readFileSync(GS01_RUN, 'utf-8')).toContain('$BASE/api/config/dump');
    // 前提核验（改 src 白名单即红）：白名单含 consult（免 JWT → 不能当负向靶点）、不含 config/dump（受保护）
    const authSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'middleware', 'auth.ts'), 'utf-8');
    expect(authSrc).toContain("path.startsWith('/api/diagnosis/consult')");
    expect(authSrc).not.toContain('/api/config/dump');
    // consult 免 JWT 的正向契约：无 token + 缺 initiator.role → 400 且非 401
    const consultNoauth = doc.assertions.find((a: { id: string }) => a.id === 'consult-noauth-contract');
    expect(consultNoauth).toBeDefined();
    expect(consultNoauth.expect.contains).toBe('400');
    expect(consultNoauth.expect.notContains).toBe('401');
  });
});

describe('bootstrap（真实 spawn + healthz + 状态文件 + 清理）', () => {
  it('假服务就绪探测全链路（不 mock 管线）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gss-boot-'));
    const mod = await import(path.join(COMMON, 'bootstrap.ts'));
    const dummy = path.resolve(__dirname, 'fixtures', 'dummy-server.ts');
    const r = await mod.bootstrap({
      dataDir: tmp,
      entry: dummy,
      port: 3200 + Math.floor(Math.random() * 500),
      timeoutSec: 30,
    });
    expect(r.ready).toBe(true);
    expect(r.port).toBeGreaterThan(0);
    const state = JSON.parse(fs.readFileSync(path.join(tmp, 'bootstrap-state.json'), 'utf-8'));
    expect(state.pid).toBe(r.pid);
    // 健康探测真实打到假服务
    const curl = childProcess.spawnSync('curl', ['-sS', r.healthz], { encoding: 'utf-8' });
    expect(JSON.parse(curl.stdout).status).toBe('healthy');
    mod.stopBootstrap(r);
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 60000);

  it('降级: 缺 data-dir → exit 2', () => {
    const r = runTsx(path.join(COMMON, 'bootstrap.ts'), []);
    expect(r.status).toBe(2);
  });

  it('守卫: 仓库内目录 → exit 2（铁律 0-4）', () => {
    const r = runTsx(path.join(COMMON, 'bootstrap.ts'), ['--data-dir', REPO_ROOT]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('铁律 0-4');
  });
});
