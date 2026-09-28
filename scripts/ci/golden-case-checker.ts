#!/usr/bin/env tsx
/**
 * scripts/ci/golden-case-checker.ts — 黄金案例 F1 门禁评分器 (D51)
 *
 * 第9份权威文档 §5.2: "不用哨兵触发率作为门禁。用5个黄金案例的冻结
 * 静态快照数据跑完整诊断→F1-Score匹配——关键边命中率+根因节点匹配率+
 * 告警级别一致率——三者均=100%时CI门禁判定通过。"
 *
 * 用法: npx tsx scripts/ci/golden-case-checker.ts
 *   退出码: 0 = 通过(三者均100%), 1 = 不通过(详细diff输出)
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  runComputeSnapshot,
  runFindingsSnapshot,
  runExpertReportAssertion,
  recordComputeSnapshot,
  runGoldenDatasetCheck,
} from './golden-snapshot-runner';
import type {
  ComputeSnapshotSection,
  FindingsSnapshotSection,
  ExpertReportSection,
  SnapshotCheckResult,
} from './golden-snapshot-runner';

// ═══ 类型定义 ═══

/** 黄金案例 fixture 格式 */
export interface GoldenCase {
  id: string;
  title: string;
  description: string;
  frozenAt: string;
  input: GoldenCaseInput;
  expected: GoldenCaseExpectation;
  /** D396: compute 快照段（可选，向后兼容旧 fixture） */
  compute?: ComputeSnapshotSection;
  /** D396: findings 快照段（可选） */
  findings?: FindingsSnapshotSection;
  /** D396: 专家报告结构断言段（可选） */
  expertReport?: ExpertReportSection;
}

interface GoldenCaseInput {
  sentinelFindings: SentinelFinding[];
  graphEdges: string[];
}

interface SentinelFinding {
  id: string;
  sentinel: string;
  severity: string;
  title: string;
  matchedEdgeIds: string[];
  detectedAt: string;
}

interface GoldenCaseExpectation {
  rootCauseEdgeIds: string[];
  rootCauseNodeTypes: string[];
  severity: string;
  matchedEdgeIds: string[];
  explanation: string;
}

/** F1 评分结果 */
interface F1Result {
  edgeHitRate: number;        // 0-1
  nodeMatchRate: number;      // 0-1
  severityMatch: boolean;     // true/false
  passed: boolean;            // 三者均=1.0
  details: {
    expectedEdgeIds: string[];
    actualEdgeIds: string[];
    missingEdges: string[];
    extraEdges: string[];
    expectedNodeTypes: string[];
    actualNodeTypes: string[];
    expectedSeverity: string;
    actualSeverity: string;
  };
}

/** 汇总报告 */
interface CheckerReport {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  results: {
    caseId: string;
    title: string;
    passed: boolean;
    f1: Omit<F1Result, 'passed'>;
    /** D396: 三层快照结果（存在则记录，不存在则为 undefined） */
    snapshot?: {
      compute?: SnapshotCheckResult;
      findings?: SnapshotCheckResult;
      expertReport?: SnapshotCheckResult;
    };
  }[];
  summary: string;
}

// ═══ 常量 ═══

/** 边ID => 节点类型 映射（用于从边推断节点类型） */
const EDGE_TO_NODE: Record<string, string> = {
  'E-05': 'CAPITAL_ACQUISITION',
  'E-12': 'RESOURCE_ALLOCATION',
  'E-23': 'OPERATIONAL_EXECUTION',
  'E-31': 'CLIENT_RETENTION',
  'E-07': 'TALENT_ACQUISITION',
  'E-33': 'MARKET_COMPETITION',
  'E-11': 'EFFICIENCY_ATTRACTION',
  'E-17': 'RULE_CONSTRAINT',
  'E-19': 'KNOWLEDGE_SHARING',
  'E-24': 'TECH_INFRASTRUCTURE',
  'E-30': 'MARKET_SHARE_CAPTURE',
};

// ═══ F1 计算核心 ═══

/**
 * 计算 F1-Score 的三个维度。
 *
 * @param actual — 实际诊断结果(从输入推导)
 * @param expected — 预期结果(从fixture读取)
 * @returns F1Result
 */
export function computeF1Score(
  actual: { rootCauseEdgeIds: string[]; severity: string; matchedEdgeIds: string[] },
  expected: GoldenCaseExpectation,
): F1Result {
  const actualEdges = actual.matchedEdgeIds || [];
  const expectedEdges = expected.matchedEdgeIds || [];

  // 1. 关键边命中率: 预期边ID是否全部出现在实际边中
  const missingEdges = expectedEdges.filter((e) => !actualEdges.includes(e));
  const extraEdges = actualEdges.filter((e) => !expectedEdges.includes(e));
  const edgeHitRate = expectedEdges.length > 0
    ? (expectedEdges.length - missingEdges.length) / expectedEdges.length
    : 0;

  // 2. 根因节点匹配率
  const actualNodeTypes = actual.rootCauseEdgeIds
    .map((e) => EDGE_TO_NODE[e])
    .filter(Boolean);
  const expectedNodeTypes = expected.rootCauseNodeTypes;
  const matchedNodes = expectedNodeTypes.filter((n) => actualNodeTypes.includes(n));
  const nodeMatchRate = expectedNodeTypes.length > 0
    ? matchedNodes.length / expectedNodeTypes.length
    : 0;

  // 3. 告警级别一致率
  const severityMatch = actual.severity === expected.severity;

  // 三者均=1.0 才算通过
  const passed = edgeHitRate === 1.0 && nodeMatchRate === 1.0 && severityMatch;

  return {
    edgeHitRate,
    nodeMatchRate,
    severityMatch,
    passed,
    details: {
      expectedEdgeIds: expectedEdges,
      actualEdgeIds: actualEdges,
      missingEdges,
      extraEdges,
      expectedNodeTypes: expected.rootCauseNodeTypes,
      actualNodeTypes,
      expectedSeverity: expected.severity,
      actualSeverity: actual.severity,
    },
  };
}

/**
 * 从黄金案例输入推导实际诊断结果。
 * 在生产环境中，这里会调用真实的诊断管线。
 * 当前实现: 从 sentinelFindings 中的 matchedEdgeIds 和 severity 聚合。
 */
export function deriveActual(caseData: GoldenCase): {
  rootCauseEdgeIds: string[];
  severity: string;
  matchedEdgeIds: string[];
} {
  const findings = caseData.input.sentinelFindings;

  // 提取所有匹配的边ID
  const allMatchedEdges = [...new Set(findings.flatMap((f) => f.matchedEdgeIds))];

  // 最高严重度作为整体严重度
  const severityOrder = ['low', 'medium', 'high', 'critical'];
  let maxSeverity = 'low';
  for (const f of findings) {
    if (severityOrder.indexOf(f.severity) > severityOrder.indexOf(maxSeverity)) {
      maxSeverity = f.severity;
    }
  }

  // 根因边: 出现在 critical finding 中的边
  const criticalEdges = [
    ...new Set(
      findings
        .filter((f) => f.severity === 'critical')
        .flatMap((f) => f.matchedEdgeIds),
    ),
  ];

  return {
    rootCauseEdgeIds: criticalEdges.length > 0 ? criticalEdges : allMatchedEdges.slice(0, 1),
    severity: maxSeverity,
    matchedEdgeIds: allMatchedEdges,
  };
}

// ═══ D1056 ③: 快照层三态判定（铁律 47 契约优先） ═══

/**
 * decideSnapshotVerdict — 判定一个黄金案例的快照层结论（纯函数，无 IO）。
 *
 * 契约:
 *   @input  — results: 该案逐层快照结果映射（compute / findings / expertReport 任意组合，
 *             旧 fixture 可能三层皆无 → 空对象）
 *   @output — { covered: boolean; passed: boolean | null }
 *             covered=false → passed=null（未覆盖: **既非 pass 也非 fail**，不作判定）
 *             covered=true  → passed = 各层全部 passed
 *   @degraded — 不适用（纯函数，无 IO；调用方不因此降级）
 *
 * 边界（本函数存在的全部理由）:
 *   空集**必须**返回 passed=null，不得返回 true。
 *   `Object.values({}).every(...)` === true 是空集恒真缺陷 —— 会把"没有快照段的旧
 *   fixture"静默算作快照层通过（覆盖度不可见）。对齐 golden-snapshot-runner.ts
 *   `checked === 0` 的"无检查可执行必须显式可见"范式。
 *   同时保持 D396 向后兼容边界: 未覆盖不阻断（调用方用 `passed !== false` 实现）。
 */
export function decideSnapshotVerdict(
  results: NonNullable<CheckerReport['results'][number]['snapshot']>,
): { covered: boolean; passed: boolean | null } {
  const covered = Object.keys(results).length > 0;
  if (!covered) return { covered: false, passed: null };
  return { covered: true, passed: Object.values(results).every((r) => r.passed) };
}

// ═══ 主函数 ═══

/**
 * 运行全部黄金案例检查。
 * 返回汇总报告并在控制台输出详细结果。
 */
function runAllChecks(): CheckerReport {
  // 使用 import.meta.url 定位 fixtures 目录 (兼容 ESM + Windows)
  const metaUrl = new URL(import.meta.url);
  const currentDir = path.dirname(metaUrl.pathname.replace(/^\/([a-zA-Z]:)/, '$1'));
  const fixturesDir = path.resolve(currentDir, '..', '..', 'tests', 'fixtures', 'golden-cases');

  if (!fs.existsSync(fixturesDir)) {
    console.error(`[ERROR] 黄金案例目录不存在: ${fixturesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json') && f.startsWith('golden-case'));
  files.sort();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Golden Case F1 Gate — 黄金案例回归测试');
  console.log(`  案例数: ${files.length}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (files.length === 0) {
    console.error('[ERROR] 未找到黄金案例文件');
    process.exit(1);
  }

  let passedCases = 0;
  let failedCases = 0;
  // D1056 ③: 快照覆盖度台账 — 让"此案有没有被快照层判定"成为可见事实（原实现不可见）。
  let coveredCases = 0;
  let uncoveredCases = 0;
  const results: CheckerReport['results'] = [];

  for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    const caseData: GoldenCase = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // 推导实际结果
    const actualResult = deriveActual(caseData);
    // 计算 F1（判定逻辑冻结，D396 只加快照层不改判定）
    const f1 = computeF1Score(actualResult, caseData.expected);

    // D396: 三层快照检查（向后兼容——旧 fixture 无快照段则跳过）
    const snapshotResults: NonNullable<CheckerReport['results'][number]['snapshot']> = {};
    if (caseData.compute) snapshotResults.compute = runComputeSnapshot(caseData.compute);
    if (caseData.findings) snapshotResults.findings = runFindingsSnapshot(caseData.findings);
    if (caseData.expertReport) snapshotResults.expertReport = runExpertReportAssertion(caseData.expertReport);
    // D1056 ③ (L-4) 修复: 原为 `Object.values(snapshotResults).every((r) => r.passed)`。
    //   `[].every()` === true —— 空集恒真: 无快照段的旧 fixture 被静默算作「快照层通过」，
    //   既不是真通过也不是任何可见信号（覆盖度不可见）。
    // 判定逻辑抽到 decideSnapshotVerdict（纯函数，可独立判别 + 可被"改坏即红"夹具打靶）。
    // 边界保持: D396 向后兼容契约（旧 fixture 无快照段不阻断）由 `snapshotPassed !== false`
    // 等价实现，且 tests/ci/golden-case-checker.test.ts:255 的既有断言不受影响。
    const snapshotVerdict = decideSnapshotVerdict(snapshotResults);
    const snapshotCovered = snapshotVerdict.covered;
    const snapshotPassed = snapshotVerdict.passed;
    if (snapshotCovered) coveredCases++; else uncoveredCases++;
    const casePassed = f1.passed && snapshotPassed !== false;

    const passEmoji = casePassed ? '✅' : '❌';
    const resultLine = `  ${passEmoji} ${caseData.id}: ${caseData.title}`;

    if (f1.passed) {
      console.log(`${resultLine} — F1 PASS (边缘=1.0, 节点=1.0, 级别=${f1.severityMatch})`);
    } else {
      console.log(`${resultLine} — F1 FAIL`);
      console.log(`     边缘命中率: ${(f1.edgeHitRate * 100).toFixed(0)}% (预期: ${f1.details.expectedEdgeIds.join(', ')})`);
      if (f1.details.missingEdges.length > 0) {
        console.log(`     缺失边: ${f1.details.missingEdges.join(', ')}`);
      }
      console.log(`     节点匹配率: ${(f1.nodeMatchRate * 100).toFixed(0)}% (预期: ${f1.details.expectedNodeTypes.join(', ')})`);
      console.log(`     级别一致: ${f1.severityMatch} (预期: ${f1.details.expectedSeverity}, 实际: ${f1.details.actualSeverity})`);
    }

    // 快照层输出（diff 逐行打印，红-绿演练据此点名 signal）
    if (snapshotResults.compute) {
      const r = snapshotResults.compute;
      console.log(`     compute 快照: ${r.passed ? 'PASS' : 'FAIL'}`);
      if (!r.passed) for (const d of r.diffs) console.log(`       - ${d}`);
    }
    if (snapshotResults.findings) {
      const r = snapshotResults.findings;
      console.log(`     findings 快照: ${r.passed ? 'PASS' : 'FAIL'}`);
      if (!r.passed) for (const d of r.diffs) console.log(`       - ${d}`);
    }
    if (snapshotResults.expertReport) {
      const r = snapshotResults.expertReport;
      console.log(`     专家报告结构断言: ${r.passed ? 'PASS' : 'FAIL'}`);
      if (!r.passed) for (const d of r.diffs) console.log(`       - ${d}`);
    }
    // D1056 ③: 未覆盖必须显式可见 — 不得因"没有可打印的快照行"而被读者读作通过。
    if (!snapshotCovered) {
      console.log('     快照层: 未覆盖（无快照段）— 不作判定');
    }

    if (casePassed) {
      passedCases++;
    } else {
      failedCases++;
    }
    console.log('');

    results.push({
      caseId: caseData.id,
      title: caseData.title,
      passed: casePassed,
      f1: {
        edgeHitRate: f1.edgeHitRate,
        nodeMatchRate: f1.nodeMatchRate,
        severityMatch: f1.severityMatch,
        details: f1.details,
      },
      snapshot: Object.keys(snapshotResults).length > 0 ? snapshotResults : undefined,
    });
  }

  const allPassed = failedCases === 0;

  // ═══ D474 阶段 5: 黄金数据集检查（wani-baby 真实数据 + 期望诊断）═══
  // 数据级快照：对已登记 compute 纯函数跑真实代码 → severity 与 sentinels[哨兵名].expected 对比
  const goldenResult = runGoldenDatasetPhase();
  const goldenPassed = goldenResult.passed;

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  结果: ${allPassed && goldenPassed ? '✅ 全部通过' : '❌ 有未通过案例'}`);
  console.log(`  通过: ${passedCases}/${files.length}`);
  // D1056 ③: 覆盖度汇总 — 11/11 通过不等于 11/11 被快照层判定。
  console.log(`  快照覆盖: ${coveredCases}/${files.length} 案例（未覆盖 ${uncoveredCases} 个 — 无快照段，不作判定）`);
  if (failedCases > 0) {
    console.log(`  失败: ${failedCases}`);
  }
  if (!goldenPassed) {
    console.log(`  黄金数据集: ❌ FAIL`);
    for (const d of goldenResult.diffs) console.log(`       - ${d}`);
  } else {
    console.log(`  黄金数据集: ✅ PASS`);
  }
  console.log('═══════════════════════════════════════════════════════════');

  return {
    totalCases: files.length,
    passedCases,
    failedCases,
    results,
    summary: allPassed && goldenPassed ? 'ALL_PASSED' : 'SOME_FAILED',
  };
}

// ═══ D474: 黄金数据集阶段 ═══

/** 定位仓库根（fileURLToPath 正确解码非 ASCII 路径——K3 审计 P1-1 修复：中文目录下 URL pathname 百分号编码导致恒误拦） */
function repoRootDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, '..', '..');
}

/** 黄金数据集路径（data/golden/wani-baby-v1.json，冻结快照） */
const GOLDEN_DATASET_PATH = path.join(repoRootDir(), 'data', 'golden', 'wani-baby-v1.json');

/**
 * 已登记哨兵 compute 的黄金输入（哨兵 value 是 0-1 打分非 compute 入参；
 * 每个已登记 compute 哨兵提供代表该哨兵语义的输入）。
 * 2026-08-22: 仅 computeCashRunway 已登记（D396 示范），input 与 golden-case-11 fixture 同源。
 * 后续 D355-D360 修复对象按同契约增量登记。
 */
const GOLDEN_COMPUTE_INPUTS: Record<string, unknown> = {
  'cash-runway': [{ cash: 100000, operatingExpense: 30000 }],
};

/**
 * runGoldenDatasetPhase — 黄金数据集门禁阶段（D474 阶段 5）。
 * 读 data/golden/wani-baby-v1.json → runGoldenDatasetCheck（真跑已登记 compute + severity 对比）。
 * @returns SnapshotCheckResult；数据集缺失 → degraded:true（铁律 11/24 不静默 pass）
 */
export function runGoldenDatasetPhase(): SnapshotCheckResult {
  if (!fs.existsSync(GOLDEN_DATASET_PATH)) {
    console.error(`[ERROR] 黄金数据集不存在: ${GOLDEN_DATASET_PATH}`);
    return { passed: false, degraded: true, diffs: [`黄金数据集不存在: ${GOLDEN_DATASET_PATH} — 显式降级`] };
  }
  let dataset: unknown;
  try {
    dataset = JSON.parse(fs.readFileSync(GOLDEN_DATASET_PATH, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] 黄金数据集 JSON 解析失败: ${msg}`);
    return { passed: false, degraded: true, diffs: [`黄金数据集 JSON 解析失败: ${msg} — 显式降级`] };
  }
  console.log('──── 阶段 5: 黄金数据集检查 (D474) ────');
  return runGoldenDatasetCheck(dataset as Parameters<typeof runGoldenDatasetCheck>[0], GOLDEN_COMPUTE_INPUTS);
}

// ═══ 入口 ═══

// 只在直接运行脚本时执行（不被 vitest import 时触发）
const isMainModule = process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, '/'));
if (isMainModule) {
  // D474: --record 模式 — keyless 快照录制（跑真实代码生成冻结候选，不判定）
  if (process.argv.includes('--record')) {
    const fixturesDir = path.join(repoRootDir(), 'tests', 'fixtures', 'golden-cases');
    const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json') && f.startsWith('golden-case'));
    files.sort();
    let recorded = 0;
    for (const file of files) {
      const filePath = path.join(fixturesDir, file);
      const caseData: GoldenCase = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (caseData.compute && caseData.compute.snapshot === undefined) {
        const rec = recordComputeSnapshot(caseData.compute);
        if (rec.error) {
          console.log(`  [${caseData.id}] 录制失败: ${rec.error}`);
        } else {
          console.log(`  [${caseData.id}] compute.snapshot 候选: ${JSON.stringify(rec.snapshot)}`);
          recorded++;
        }
      }
    }
    console.log(`[GATE] --record 完成: ${recorded} 个 fixture 生成快照候选（人工确认后写入 fixture 冻结）`);
    process.exit(0);
  }

  const report = runAllChecks();

  // D474 复核修复: main 入口必须同时检查 golden 阶段（阶段5）结果——
  // 原实现只看 failedCases（golden-case 计数），阶段5（黄金数据集 severity 对比）失败时
  // failedCases=0 但 summary='SOME_FAILED' → 门禁误 exit 0（红但绿）。fail-closed 修复。
  if (report.failedCases > 0 || report.summary !== 'ALL_PASSED') {
    console.error(`\n[GATE] ${report.failedCases} 个黄金案例未通过 或 黄金数据集阶段失败 — 门禁拒绝`);
    process.exit(1);
  } else {
    console.log(`\n[GATE] 全部 ${report.totalCases} 个黄金案例通过 — F1 门禁开放`);
    process.exit(0);
  }
}
