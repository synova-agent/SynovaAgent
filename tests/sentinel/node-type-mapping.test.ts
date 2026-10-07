/**
 * tests/sentinel/node-type-mapping.test.ts — #1381 映射表判据（V1 逐条带证据）
 *
 * 口径（CTO 2026-10-08）：**覆盖率不是"13 条都在表内"** —— 每条要么有
 *   `writer` / `inline-migration` / `vocab` 证据（且 scope 标对），要么是 `null + warn`（显式无源）。
 * 另：多目标条目的 `rule` 必须**两条分支都被覆盖**（否则 rule 是空的）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadNodeTypeMapping, resolveOntologyTarget } from '../../src/sentinel/node-type-resolver';

const REPO = process.cwd();
const mapping = loadNodeTypeMapping();
/** 本体词表 45 条（真源：packages/ontology/src/node-types.ts） */
const VOCAB = new Set(
  (readFileSync(join(REPO, 'packages/ontology/src/node-types.ts'), 'utf-8').match(/'[a-z]+\/[a-z_]+'/g) ?? [])
    .map(m => m.replace(/'/g, '')),
);
/** #1379 登记的 13 条无源字面量（本表必须全覆盖） */
const NO_SOURCE_LITERALS = ['Financial', 'FINANCIAL', 'Tool', 'TOOL', 'APP', 'SOFTWARE', 'Event', 'Client', 'Process', 'Risk', 'Capability', 'Evidence', 'Agent'];

describe('#1381 词表断轴 · 映射表判据', () => {
  it('V1a 覆盖：13 条无源字面量逐条在表内', () => {
    const missing = NO_SOURCE_LITERALS.filter(t => !mapping.entries[t]);
    expect(missing, `表内缺失：${missing.join(', ')}`).toEqual([]);
  });

  it('V1b 逐条带证据：有目标 ⇒ writer/inline-migration/vocab 证据；无目标 ⇒ null + warn + reason', () => {
    const bad: string[] = [];
    for (const [k, e] of Object.entries(mapping.entries)) {
      if (e.aliasOf) continue;   // 别名条目由 V1d 校验（只维护一份）
      if (e.targets && e.targets.length > 0) {
        const kinds = (e.evidence ?? []).map(x => x.kind);
        if (!kinds.some(x => x === 'writer' || x === 'inline-migration' || x === 'vocab')) bad.push(`${k}: 有目标但无有效证据`);
        for (const t of e.targets) if (!VOCAB.has(t)) bad.push(`${k}: target "${t}" 不在本体词表 45 条内`);
        if (e.targets.length > 1 && !e.rule) bad.push(`${k}: 多目标但缺 rule`);
      } else {
        if (e.warn !== true) bad.push(`${k}: 无目标但未标 warn`);
        if (!e.reason) bad.push(`${k}: 无目标但缺 reason（应显式说明为何不决）`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('V1c scope 正确：证据若全为连接器/工具局部 ⇒ 必须 null + warn（禁把局部当全局）', () => {
    const bad: string[] = [];
    for (const [k, e] of Object.entries(mapping.entries)) {
      const ev = e.evidence ?? [];
      if (ev.length === 0) continue;
      const allLocal = ev.every(x => (x.scope ?? '').startsWith('local('));
      if (allLocal && e.targets && e.targets.length > 0) bad.push(`${k}: 仅局部证据却给了全局目标`);
    }
    expect(bad).toEqual([]);
  });

  it('V1d 别名解析一致：大小写别名与本体条目解析到【同一 target】（含多目标 rule 行为）', () => {
    const pairs: Array<[string, string]> = [['FINANCIAL', 'Financial'], ['TOOL', 'Tool']];
    for (const [alias, canonical] of pairs) {
      const propsLoss = { total_revenue: 1000, gross_margin: 0.8, operating_expense: 300 };
      const propsStock = { cash_balance: 5000, revenue: 1000, cost: 200, period: '2026-09' };
      for (const props of [propsLoss, propsStock, { 未知: 1 }]) {
        const ra = resolveOntologyTarget(alias, props);
        const rc = resolveOntologyTarget(canonical, props);
        expect(ra.target, `${alias} vs ${canonical} 解析不一致`).toBe(rc.target);
        expect(ra.warn).toBe(rc.warn);
      }
    }
  });

  it('V2 rule 两条分支都覆盖：Financial 按 props 键分流到两个本体类型', () => {
    const loss = resolveOntologyTarget('Financial', { total_revenue: 1000, gross_margin: 0.8, operating_expense: 300 });
    expect(loss.target).toBe('outcome/financial');
    const stock = resolveOntologyTarget('Financial', { cash_balance: 5000, revenue: 1000, cost: 200, period: '2026-09' });
    expect(stock.target).toBe('resource/money');
  });

  it('V3 语义不决 ⇒ null + warn（不许猜、不看来源）', () => {
    for (const t of ['APP', 'SOFTWARE', 'Evidence', 'Event', 'Capability']) {
      const r = resolveOntologyTarget(t, { anything: 1 });
      expect(r.target, `${t} 应显式无源`).toBeNull();
      expect(r.warn).toBe(true);
    }
    expect(resolveOntologyTarget('Financial', { 未知键: 1 }).target).toBeNull(); // 多目标但判不出 ⇒ 无源
  });
});
