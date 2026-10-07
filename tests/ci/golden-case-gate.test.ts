/**
 * tests/ci/golden-case-gate.test.ts — D300 黄金数据集门禁接线测试
 *
 * 验证 C-G1 修复的物理接线（A线产品完整性审计第三章）：
 *   1. pre-push-check.sh 必须调用 golden-case-checker.ts（F1 门禁）
 *   2. pre-push-check.sh 必须调用 diagnosis-quality-check.sh（结构检查）
 *   3. ci.yml golden-case job 必须存在且调用两个门禁
 *   4. 10 个黄金案例 fixture 存在且 JSON 可解析（夹具完整性 — 防无声退化）
 *
 * 失败即门禁未接线 — 无声退化防护失效。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** 读文件, 不存在则抛错（测试失败） */
function readFile(relPath: string): string {
  const fullPath = path.join(REPO_ROOT, relPath);
  return fs.readFileSync(fullPath, 'utf-8');
}

describe('D300 接线 — CI 门禁调用方（D-A/D1202: pre-push 侧已退役，权威在 CI）', () => {
  const ci = readFile('.github/workflows/ci.yml');

  it('ci.yml golden-case job 存在（合并级必需 context 之一）', () => {
    expect(ci).toContain('golden-case:');
    expect(ci).toContain('Golden Case F1 Gate');
  });

  it('ci.yml golden-case job 调用 golden-case-checker 与诊断质量检查', () => {
    expect(ci).toContain('golden-case-checker');
    expect(ci).toContain('diagnosis-quality-check.sh');
  });

  it('pre-push 侧已退役（D-A: 本地不再重复跑 60s+ 的黄金面）', () => {
    const prepush = readFile('scripts/pre-push-check.sh');
    expect(prepush).not.toContain('npx tsx scripts/ci/golden-case-checker.ts');
  });
});

describe('D300 接线 — CI job', () => {
  const ci = readFile('.github/workflows/ci.yml');

  it('ci.yml 存在 golden-case job', () => {
    expect(ci).toMatch(/^\s*golden-case:/m);
  });

  it('golden-case job 调用两个门禁（F1 + 结构检查）', () => {
    // 提取 golden-case job 块, 断言其中包含两个门禁命令
    const jobBlock = ci.match(/golden-case:[\s\S]*?(?=^\s{2}\w[\w-]*:|\n\s*\n\s*\w[\w-]*:|$)/);
    const block = jobBlock ? jobBlock[0] : ci;
    expect(block).toMatch(/golden-case-checker\.ts/);
    expect(block).toMatch(/diagnosis-quality-check\.sh/);
  });
});

describe('D300 夹具完整性 — 黄金案例 fixture', () => {
  const fixturesDir = path.join(REPO_ROOT, 'tests', 'fixtures', 'golden-cases');

  it('fixture 目录存在且包含 11 个黄金案例（D396 新增 golden-case-11 快照用例）', () => {
    expect(fs.existsSync(fixturesDir)).toBe(true);
    const files = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.endsWith('.json') && f.startsWith('golden-case'));
    expect(files.length).toBe(11);
  });

  it('每个 fixture 均为可解析 JSON 且含 expected 字段（冻结快照结构）', () => {
    const files = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.endsWith('.json') && f.startsWith('golden-case'));
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf-8')) as {
        id?: string;
        expected?: { matchedEdgeIds?: unknown[]; rootCauseNodeTypes?: unknown[]; severity?: unknown };
      };
      expect(data.id, `${f} 缺少 id`).toBeTruthy();
      expect(data.expected, `${f} 缺少 expected`).toBeTruthy();
      expect(Array.isArray(data.expected?.matchedEdgeIds), `${f} expected.matchedEdgeIds 非数组`).toBe(true);
      expect(Array.isArray(data.expected?.rootCauseNodeTypes), `${f} expected.rootCauseNodeTypes 非数组`).toBe(true);
      expect(typeof data.expected?.severity, `${f} expected.severity 非字符串`).toBe('string');
    }
  });
});
