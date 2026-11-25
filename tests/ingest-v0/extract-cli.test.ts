/**
 * tests/ingest-v0/extract-cli.test.ts — V2 抽取层**端到端判据**（#1500：规则 → persistFacts → C4 反查）。
 *
 * 覆盖：
 *   · `#1493` 的坑（C4/C2）：同一批对象/关系，**缺 defVersion** ⇒ `synova_context_get` count=0；
 *     带 `defVersion='ingest-v0'` ⇒ count>0（这正是"写入成功但域上下文读不到"的假成功陷阱）；
 *   · 成功路径：目录夹具 → 对象/关系/指标齐备 → C4 count>0 → 报告落盘；
 *   · 不足路径（C6）：无期间/无事实 ⇒ `INSUFFICIENT_INGEST`，退出码 1，不伪造成功；
 *   · 参数错误 ⇒ 退出码 2。
 *
 * 顺序要求（真实引擎单例）：C4 陷阱用例必须**先于**成功用例执行（成功用例结束时会关闭引擎）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runExtract } from '../../scripts/ingest-v0/extract.mjs';
import { initEngineContext, getDatabase } from '../../src/init/engine-context';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { EnterpriseScanStore } from '../../src/l4/enterprise-scan-store';
import { handleDomainToolCall } from '../../src/runtime/dsh/tools';

const FIXTURE_ROOT = path.join(os.tmpdir(), 'ingest-v0', `extract-cli-${process.pid}-${Date.now()}`);
const DB_PATH = path.join(FIXTURE_ROOT, 'synova.db');
fs.mkdirSync(FIXTURE_ROOT, { recursive: true });

const SALES_HTML = `<!DOCTYPE html><html><head><title>测试看板</title></head><body>
<div>数据周期 2026-08-01 ~ 08-31</div>
<h2>销售员业绩排名</h2>
<table>
<tr><th>排名</th><th>销售</th><th>队</th><th>目标</th><th>业绩</th><th>达成率</th></tr>
<tr><td>1</td><td>张测试</td><td>测试队</td><td>¥10,000</td><td>¥8,000</td><td>80.0%</td></tr>
<tr><td>2</td><td>李样例</td><td>样例队</td><td>¥20,000</td><td>¥10,000</td><td>50.0%</td></tr>
</table></body></html>`;

beforeAll(() => {
  process.env.SYNOVA_DB_PATH = DB_PATH;
  process.env.SYNOVA_SKIP_MCP = '1';
  initEngineContext();
});

describe('C4/#1493 — 缺 defVersion 的写入是假成功', () => {
  it('persistFacts 写入成功但 synova_context_get count=0；补 defVersion 后 count>0', () => {
    const store = new EnterpriseScanStore(getDatabase(), new SqliteGraphStore(getDatabase()));
    const relation = {
      type: 'edge/member_of_team',
      businessKey: 'trap/rel',
      fromBusinessKey: 'trap/person',
      toBusinessKey: 'trap/team',
      props: { sourceRef: { file: 'trap.html', locator: 'table[1]/row[1]' } },
    };

    // ① 故意缺 defVersion（#1493 的原始坑）
    const missing = store.persistFacts({
      graph: 'trap-missing-defversion',
      objects: [
        { type: 'resource/person', businessKey: 'trap/person', props: { name: '张测试', period: '2026-08' } },
        { type: 'resource/team', businessKey: 'trap/team', props: { name: '测试队', period: '2026-08' } },
      ],
      relations: [relation],
    });
    expect(missing.facts).toHaveLength(3);
    const missingSnapshot = JSON.parse(
      handleDomainToolCall(
        'synova_context_get',
        { problemId: 'trap/person' },
        { enterpriseId: 'trap-missing-defversion', userId: 'test', scope: 'admin', runId: 'trap-1' },
      ),
    );
    expect(missingSnapshot.count).toBe(0);
    expect(missingSnapshot.insufficient.code).toBe('INSUFFICIENT_CONTEXT');

    // ② 同一形状补上 defVersion ⇒ 域上下文读得到（V2 必须走这条）
    store.persistFacts({
      graph: 'trap-with-defversion',
      objects: [
        { type: 'resource/person', businessKey: 'trap/person', props: { name: '张测试', period: '2026-08', defVersion: 'ingest-v0' } },
        { type: 'resource/team', businessKey: 'trap/team', props: { name: '测试队', period: '2026-08', defVersion: 'ingest-v0' } },
      ],
      relations: [relation],
    });
    const withSnapshot = JSON.parse(
      handleDomainToolCall(
        'synova_context_get',
        { problemId: 'trap/person' },
        { enterpriseId: 'trap-with-defversion', userId: 'test', scope: 'admin', runId: 'trap-2' },
      ),
    );
    expect(withSnapshot.count).toBeGreaterThan(0);
    expect(withSnapshot.items[0].$id).toMatch(/^node-/);
  });
});

describe('CLI — 不足与参数错误', () => {
  it('无期间资料 ⇒ INSUFFICIENT_INGEST（退出码 1，不落库）', async () => {
    const dir = path.join(FIXTURE_ROOT, 'no-period');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '制度.txt'), '这是一份没有任何日期的制度文档。\n', 'utf8');
    const result = await runExtract(['--source', dir, '--db', DB_PATH, '--out', path.join(FIXTURE_ROOT, 'no-period.json'), '--graph', 'itest-no-period'], { tempRoot: FIXTURE_ROOT });
    expect(result.exitCode).toBe(1);
    expect(result.report.status).toBe('insufficient');
    expect(result.report.error.code).toBe('E_INSUFFICIENT_INGEST');
    expect(result.report.insufficient.missing).toContain('period');
    expect(result.report.extraction.objects.total).toBe(0);
  });

  it('缺 --source ⇒ 退出码 2（判不了）', async () => {
    const result = await runExtract(['--db', DB_PATH]);
    expect(result.exitCode).toBe(2);
    expect(result.error.code).toBe('E_BAD_ARGS');
    expect(result.report).toBeNull();
  });
});

describe('CLI — 成功路径（目录 → 落库 → C4）', () => {
  it('对象/关系/指标齐备，C4 count>0，报告与事实带来源指针', async () => {
    const dir = path.join(FIXTURE_ROOT, 'sales-dir');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dashboard.html'), SALES_HTML, 'utf8');
    const reportPath = path.join(FIXTURE_ROOT, 'success-report.json');
    const result = await runExtract([
      '--source', dir,
      '--db', DB_PATH,
      '--out', reportPath,
      '--graph', 'itest-ok',
    ], { tempRoot: FIXTURE_ROOT });

    expect(result.exitCode).toBe(0);
    expect(result.report.status).toBe('ok');
    expect(result.report.extraction.objects.total).toBe(4);
    expect(result.report.extraction.relations.total).toBe(2);
    expect(result.report.extraction.metrics.total).toBe(6);
    expect(result.report.c4.count).toBeGreaterThan(0);
    expect(result.report.c4.ids[0]).toMatch(/^node-/);
    expect(result.report.c4.identity).toBe('local-verify-admin');
    expect(fs.existsSync(reportPath)).toBe(true);

    const persons = result.report.facts.objects.filter((object: { type: string }) => object.type === 'resource/person');
    expect(persons).toHaveLength(2);
    for (const person of persons) {
      expect(person.objectId).toMatch(/^node-/);
      expect(person.period).toBe('2026-08');
      expect(person.defVersion).toBe('ingest-v0');
      expect(person.sourceRef.file).toBe('dashboard.html');
      expect(person.sourceRef.locator).toContain('col[销售]');
    }
    const relation = result.report.facts.relations[0];
    expect(relation.objectId).toMatch(/^edge-/);
    expect(relation.type).toBe('edge/member_of_team');
    const writtenMetrics = result.report.facts.metrics.filter((metric: { written: { written?: boolean } | null }) => metric.written?.written === true);
    expect(writtenMetrics).toHaveLength(6);
    // §7 读对抽检：5 条样本在重读资料里都能找到原文
    expect(result.report.verification.checked).toBe(5);
    expect(result.report.verification.samples.every((sample: { present: boolean }) => sample.present)).toBe(true);
  });
});
