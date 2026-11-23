/**
 * tests/dsh-sidecar/mcp-probe.test.ts —— Issue #1458（#1457 core 门红的加做部分）
 *
 * 直接 import `scripts/dsh-sidecar/r3-chain/mcp-probe.ts`（真实依赖边，见 install-profile.test.ts
 * 头注的长理由）。用**既有 T2 证据件的真实 steps**复算 11 条断言：既证判定逻辑可复现，
 * 又用"把真实响应改坏"的反例证断言有判别力（不是恒真）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProbeAssertions, summariseProbe } from '../../scripts/dsh-sidecar/r3-chain/mcp-probe';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE_FILE = path.join(REPO_ROOT, 'docs/synova/product-lines/evidence/r3-chain-1455/11-mcp-tools-list.json');

type Step = {
  name: string;
  method: string;
  httpStatus: number;
  contentType: string | null;
  bodyText: string;
  bodyJson: unknown;
};

const loadEvidence = (): { assertions: Record<string, boolean>; steps: Step[] } =>
  JSON.parse(readFileSync(EVIDENCE_FILE, 'utf8'));

/** 深拷贝，避免反例用例改坏共享 fixture。 */
const cloneSteps = (steps: Step[]): Step[] => JSON.parse(JSON.stringify(steps));

describe('mcp-probe / buildProbeAssertions（真实 T2 证据件复算）', () => {
  it('真实 5 步响应 ⇒ 11 条断言与 T2 证据件逐项一致且全 true', () => {
    const evidence = loadEvidence();
    expect(evidence.steps).toHaveLength(5);

    const assertions = buildProbeAssertions(evidence.steps);

    expect(assertions).toEqual(evidence.assertions);
    expect(Object.keys(assertions)).toHaveLength(11);
    expect(Object.values(assertions).every(Boolean)).toBe(true);
    // 两条最容易"恒真"的断言单独钉住
    expect(assertions.positiveSyntheticFalse).toBe(true);
    expect(assertions.negativeCodeDomainEmpty).toBe(true);
  });

  it('正例被改成 synthetic:true ⇒ positiveSyntheticFalse 掉红，整体不得判过', () => {
    const evidence = loadEvidence();
    const steps = cloneSteps(evidence.steps);
    const positive = steps[3].bodyJson as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(positive.result.content[0].text);
    payload.synthetic = true;
    positive.result.content[0].text = JSON.stringify(payload);

    const assertions = buildProbeAssertions(steps);

    expect(assertions.positiveSyntheticFalse).toBe(false);
    expect(Object.values(assertions).every(Boolean)).toBe(false);
    // 其它断言不受牵连（说明这条不是靠整体恒 false 混过去）
    expect(assertions.initializeHttp200).toBe(true);
  });

  it('负例丢 DOMAIN_EMPTY ⇒ negativeCodeDomainEmpty 掉红', () => {
    const evidence = loadEvidence();
    const steps = cloneSteps(evidence.steps);
    const negative = steps[4].bodyJson as { result: { content: Array<{ text: string }> } };
    negative.result.content[0].text = JSON.stringify({ code: 'SOMETHING_ELSE' });

    const assertions = buildProbeAssertions(steps);

    expect(assertions.negativeCodeDomainEmpty).toBe(false);
    expect(Object.values(assertions).every(Boolean)).toBe(false);
  });

  it('tools/list 多广告一个工具 ⇒ toolsListAdvertisesExactlyOneTool 掉红（只读面不得扩张）', () => {
    const evidence = loadEvidence();
    const steps = cloneSteps(evidence.steps);
    const toolsList = steps[2].bodyJson as { result: { tools: Array<{ name: string }> } };
    toolsList.result.tools.push({ name: 'synova_write_something' });

    const assertions = buildProbeAssertions(steps);

    expect(assertions.toolsListAdvertisesExactlyOneTool).toBe(false);
    expect(assertions.toolsListAdvertisesSynovaContextGet).toBe(true);
    expect(Object.values(assertions).every(Boolean)).toBe(false);
  });
});

describe('mcp-probe / summariseProbe', () => {
  it('stdout 摘要只给 5 个键，且 count/code 取自 payload（T2 stdout 同形）', () => {
    const evidence = loadEvidence();
    const positiveText = (evidence.steps[3].bodyJson as { result: { content: Array<{ text: string }> } }).result.content[0].text;
    const negativeText = (evidence.steps[4].bodyJson as { result: { content: Array<{ text: string }> } }).result.content[0].text;

    const summary = summariseProbe({
      ok: true,
      generatedAt: '2026-01-01T00:00:00.000Z',
      url: 'http://127.0.0.1:0/mcp',
      enterpriseId: 'synth-org-test-1458',
      problemId: 'synth-problem-test-1458',
      missingProblemId: 'missing-1458',
      tokenIssued: true,
      tokenLengthNotRecorded: true,
      toolCount: 1,
      toolNames: ['synova_context_get'],
      toolInputSchema: null,
      positivePayload: JSON.parse(positiveText),
      negativePayload: JSON.parse(negativeText),
      assertions: buildProbeAssertions(evidence.steps),
      steps: evidence.steps,
      passed: true,
    });

    expect(Object.keys(summary)).toEqual(['ok', 'assertions', 'toolNames', 'positiveCount', 'negativeCode']);
    expect(summary.ok).toBe(true);
    expect(summary.toolNames).toEqual(['synova_context_get']);
    expect(summary.positiveCount).toBe(2);
    expect(summary.negativeCode).toBe('DOMAIN_EMPTY');
  });
});
