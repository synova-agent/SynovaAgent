/**
 * tests/onboarding/gap-questioner.test.ts — `src/onboarding/gap-questioner.ts` 配对测试（铁律 48）
 *
 * 覆盖: 正常路径（空图 ⇒ 有序全量追问表）｜降级路径（本体缺/坏 ⇒ 不抛 + degraded + errors）｜
 *       边界（observed 按 label 命中 / 有穷性）｜V2 映射表（悬空 = 0）｜V3 确定性 + 闭合｜
 *       🔴 V4 反例（锚点：删掉来源节点 ⇒ 本文件必红 —— 见下）
 *
 * 🔴 V4「改坏即红」的可复跑方式（**不动 `extensions/ontology/**`** —— 那是 K12-07 写集）:
 *   `cp -R extensions/ontology /tmp/onto-broken && rm /tmp/onto-broken/resource/money.json`
 *   `SYNO_ONTOLOGY_DIR=/tmp/onto-broken npx vitest run tests/onboarding/gap-questioner.test.ts`
 *   ⇒ 下方「本体锚点」用例必红（money 问题随来源节点一起消失）；清掉注入 ⇒ 全绿。
 *   注入缝 = 本文件读 `SYNO_ONTOLOGY_DIR` 后按显式入参传给生产函数（生产函数不读 env）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { buildQuestionTable, type GapQuestionInput, type GapQuestionReport } from '../../src/onboarding/gap-questioner';

/** 仓库根（vitest 以项目根为 cwd）；显式传 rootDir ⇒ 用例不受 chdir 影响 */
const REPO_ROOT = process.cwd();

/** 🔴 反例注入缝：指向「被改坏的本体副本」时，下方锚点用例必红 */
const INJECTED = process.env['SYNO_ONTOLOGY_DIR'];
const INJECTED_ONTOLOGY = INJECTED === undefined || INJECTED.length === 0 ? undefined : INJECTED;

/** 统一入口：rootDir 固定为仓库根，本体目录按注入缝覆盖（未注入 ⇒ 走生产缺省解析） */
function run(input: GapQuestionInput = {}): GapQuestionReport {
  return buildQuestionTable({ rootDir: REPO_ROOT, ontologyDir: INJECTED_ONTOLOGY, ...input });
}

let fixtureRoot = '';

/** 造一个最小本体目录（fixture）：返回目录路径；内容按 `相对路径 → 原文` 写入 */
function makeOntology(files: ReadonlyArray<{ path: string; content: string }>): string {
  const dir = join(fixtureRoot, 'ontology');
  for (const f of files) {
    const abs = join(dir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, 'utf8');
  }
  return dir;
}

/** 一个形状合法的节点类型 JSON 原文 */
function nodeJson(id: string, label: string, description = '测试用类型。'): string {
  return JSON.stringify({
    $id: id,
    label,
    tags: ['resource'],
    requiredProps: ['entity_type'],
    optionalProps: { a: 'string', b: 'number', c: 'string', d: 'string', e: 'string' },
    description,
  });
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'gap-questioner-'));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('正常路径 — 空图 ⇒ 有序全量追问表', () => {
  it('空图（缺省 observed）⇒ 产出追问表，order 连续 0..n-1 且节点在前、边在后', () => {
    const r = run();
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.order)).toEqual(r.questions.map((_q, i) => i));

    const kinds = r.questions.map((q) => q.sourceKind);
    const firstEdge = kinds.indexOf('edge');
    if (firstEdge >= 0) {
      expect(kinds.slice(0, firstEdge).every((k) => k === 'node')).toBe(true);
      expect(kinds.slice(firstEdge).every((k) => k === 'edge')).toBe(true);
    }

    const nodeIds = r.questions.filter((q) => q.sourceKind === 'node').map((q) => q.sourceId);
    const edgeIds = r.questions.filter((q) => q.sourceKind === 'edge').map((q) => q.sourceId);
    expect(nodeIds).toEqual([...nodeIds].sort());
    expect(edgeIds).toEqual([...edgeIds].sort());
  });

  it('每条问题都有非空文本与来源 id（本卡核心交付物 = 文本 + 来源 id）', () => {
    const r = run();
    expect(r.questions.every((q) => q.text.length > 0)).toBe(true);
    expect(r.questions.every((q) => q.sourceId.length > 0)).toBe(true);
    expect(r.questions.every((q) => q.id.startsWith('gq-node-') || q.id.startsWith('gq-edge-'))).toBe(true);
  });

  it('有穷性：问题集 ⊆ 本体类型集（gapCount ≤ sourceCount 且 count 为有限数）', () => {
    const r = run();
    expect(r.gapCount).toBe(r.questions.length);
    expect(r.sourceCount).toBeGreaterThan(0);
    expect(r.gapCount).toBeLessThanOrEqual(r.sourceCount);
    expect(Number.isFinite(r.gapCount)).toBe(true);
  });
});

describe('🔴 V4 反例锚点 — 来源节点决定问题（删掉来源 ⇒ 本用例必红）', () => {
  it('真实本体：待实例化集合必含 resource/money（节点）与 edge/produces（边）两条来源', () => {
    const r = run();
    expect(r.questions.some((q) => q.sourceId === 'resource/money' && q.sourceKind === 'node')).toBe(true);
    expect(r.questions.some((q) => q.sourceId === 'edge/produces' && q.sourceKind === 'edge')).toBe(true);
  });

  it('问题文本由本体派生（label 出现在文本里 —— 不是写死的问题清单）', () => {
    const r = run();
    const money = r.questions.find((q) => q.sourceId === 'resource/money');
    // 来源缺失时上面这一跑已红；此处用显式断言而非下标取值，失败信息可读
    expect(money === undefined ? '' : money.text).toContain('MONEY');
  });
});

describe('V2 — 「问题 → 来源节点/边」映射表（悬空 = 0）', () => {
  it('mapping 与 questions 一一对应，且每一行都 resolved（悬空 = 0）', () => {
    // 判据侧显式声明两个**必需落点** ⇒ 删掉来源节点/边时本用例经模块自身的悬空判定必红
    const r = run({ requiredSourceIds: ['resource/money', 'edge/produces'] });
    expect(r.mapping.length).toBe(r.questions.length);
    expect(r.mapping.every((row) => row.resolved)).toBe(true);
    expect(r.dangling).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('映射行的 questionId / sourceId 与问题本体逐条一致（可追：问题 → 来源）', () => {
    const r = run();
    for (const q of r.questions) {
      const row = r.mapping.find((m) => m.questionId === q.id);
      expect(row).toBeDefined();
      expect(row?.sourceId).toBe(q.sourceId);
      expect(row?.sourceKind).toBe(q.sourceKind);
    }
  });

  it('每个来源都是**待实例化**的（已实例化的类型不出现在问题里）', () => {
    const r = run();
    const observedOne = r.questions[0];
    expect(observedOne).toBeDefined();
    if (observedOne === undefined) return;
    const observed = observedOne.sourceKind === 'node'
      ? { nodes: [observedOne.sourceId] }
      : { edges: [observedOne.sourceId] };
    const narrowed = run({ observed });
    expect(narrowed.questions.some((q) => q.sourceId === observedOne.sourceId)).toBe(false);
    expect(narrowed.gapCount).toBe(r.gapCount - 1);
  });
});

describe('V3 — 有穷且闭合', () => {
  it('确定性：同输入两次 ⇒ 问题集逐字相同（含顺序）', () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.questions.map((q) => q.id)).toEqual(a.questions.map((q) => q.id));
  });

  it('闭合：缺口填满（observed 覆盖全部来源）⇒ 不再问（空表）', () => {
    const all = run();
    const nodes = all.questions.filter((q) => q.sourceKind === 'node').map((q) => q.sourceId);
    const edges = all.questions.filter((q) => q.sourceKind === 'edge').map((q) => q.sourceId);
    const closed = run({ observed: { nodes, edges } });
    expect(closed.gapCount).toBe(0);
    expect(closed.questions).toEqual([]);
    expect(closed.mapping).toEqual([]);
    expect(closed.dangling).toEqual([]);
    expect(closed.observedCount).toBe(all.sourceCount);
  });
});

describe('降级路径 — 本体不可读/坏文件不静默（铁律 11/24/31）', () => {
  it('本体目录不存在 ⇒ **不抛**，degraded + 错误码 + 空表', () => {
    let r: GapQuestionReport | null = null;
    expect(() => {
      r = buildQuestionTable({ ontologyDir: join(fixtureRoot, 'no-such-dir') });
    }).not.toThrow();
    const report = r as GapQuestionReport | null;
    expect(report).not.toBeNull();
    expect(report?.degraded).toBe(true);
    expect(report?.questions).toEqual([]);
    expect(report?.errors.some((e) => e.includes('ONTOLOGY_DIR_MISSING'))).toBe(true);
  });

  it('单文件 JSON 坏 ⇒ 只降级该文件，其余类型照常产出，错误码 ONTOLOGY_JSON_INVALID', () => {
    const dir = makeOntology([
      { path: 'resource/ok.json', content: nodeJson('resource/ok', 'OK') },
      { path: 'resource/broken.json', content: '{ this is not json' },
    ]);
    const r = buildQuestionTable({ ontologyDir: dir });
    expect(r.degraded).toBe(true);
    expect(r.questions.map((q) => q.sourceId)).toEqual(['resource/ok']);
    expect(r.errors.some((e) => e.includes('ONTOLOGY_JSON_INVALID'))).toBe(true);
    expect(r.dangling).toEqual([]);
  });

  it('缺 $id/label ⇒ 记错误码并跳过（不进表，也不静默通过）', () => {
    const dir = makeOntology([
      { path: 'resource/good.json', content: nodeJson('resource/good', 'GOOD') },
      { path: 'outcome/bad.json', content: JSON.stringify({ label: 'NO_ID' }) },
    ]);
    const r = buildQuestionTable({ ontologyDir: dir });
    expect(r.degraded).toBe(true);
    expect(r.questions.map((q) => q.sourceId)).toEqual(['resource/good']);
    expect(r.errors.some((e) => e.includes('ONTOLOGY_SHAPE_INVALID'))).toBe(true);
  });
});

describe('边界 — 悬空判定与 label 命中口径', () => {
  it('🔴 必备落点在本体里查不到 ⇒ **悬空**（V4 反例走的就是这条判定）', () => {
    const dir = makeOntology([
      { path: 'resource/alpha.json', content: nodeJson('resource/alpha', 'ALPHA') },
    ]);
    const ok = buildQuestionTable({ ontologyDir: dir, requiredSourceIds: ['resource/alpha'] });
    expect(ok.dangling).toEqual([]);
    expect(ok.errors.some((e) => e.includes('ONTOLOGY_REQUIRED_MISSING'))).toBe(false);

    // 「删掉来源节点」的最小复现：本体里没有 resource/money，却声明它是必备落点
    const broken = buildQuestionTable({ ontologyDir: dir, requiredSourceIds: ['resource/alpha', 'resource/money'] });
    expect(broken.dangling).toEqual(['resource/money']);
    expect(broken.degraded).toBe(true);
    expect(broken.errors.some((e) => e.includes('ONTOLOGY_REQUIRED_MISSING'))).toBe(true);
  });

  it('observed 用 label 命中同样算已实例化（图里存 label 的口径）', () => {
    const dir = makeOntology([
      { path: 'resource/alpha.json', content: nodeJson('resource/alpha', 'ALPHA') },
      { path: 'resource/beta.json', content: nodeJson('resource/beta', 'BETA') },
    ]);
    const byLabel = buildQuestionTable({ ontologyDir: dir, observed: { nodes: ['ALPHA'] } });
    const byId = buildQuestionTable({ ontologyDir: dir, observed: { nodes: ['resource/alpha'] } });
    expect(byLabel.questions.map((q) => q.sourceId)).toEqual(['resource/beta']);
    expect(byId.questions.map((q) => q.sourceId)).toEqual(['resource/beta']);
    expect(byLabel.observedCount).toBe(1);
  });

  it('本体子目录缺失 ⇒ 记错误码，其余族照常产出', () => {
    const dir = makeOntology([{ path: 'resource/only.json', content: nodeJson('resource/only', 'ONLY') }]);
    const r = buildQuestionTable({ ontologyDir: dir });
    expect(r.questions.map((q) => q.sourceId)).toEqual(['resource/only']);
    expect(r.errors.some((e) => e.includes('ONTOLOGY_SUBDIR_MISSING'))).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it('边类型：端点与属性名进问题文本（提示来自本体，不是写死的）', () => {
    const dir = makeOntology([
      {
        path: 'edge-types/produces.json',
        content: JSON.stringify({
          $id: 'edge/produces',
          label: 'PRODUCES',
          tags: ['causal'],
          allowedFrom: ['activity/production'],
          allowedTo: ['outcome/financial'],
          description: '活动产出结果。',
        }),
      },
    ]);
    const r = buildQuestionTable({ ontologyDir: dir });
    const q = r.questions[0];
    expect(q?.sourceKind).toBe('edge');
    expect(q?.text).toContain('PRODUCES');
    expect(q?.text).toContain('activity/production');
    expect(q?.text).toContain('outcome/financial');
  });
});
