/**
 * tests/sentinel/type-casing.test.ts — #1379 判据载体（**对照表即判据**，可复跑）
 *
 * 一致的定义（CTO 2026-10-08 改判 X）：**读写匹配** —— 每个【读侧字面量】要么有同名写入者，
 *   要么在【无源登记】里显式列出（归 #1381 轴迁移）；**不追求"轴内单一风格"**（那不可判、无收益）。
 *
 * 覆盖：(1) 旧字面量零残留（'TEAM' / 'Goal'）(2) 逐对核验读写匹配（对照表）(3) V3 空读必留痕
 * 口径：扫描 `src/` + `extensions/` 的 .ts/.tsx；**注释行按 R92 排除**
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['src', 'extensions'];
/** 无源登记（读侧有、写侧 0）—— 归 #1381「轴迁移」；此处**显式列出**，禁默认通过 */
const NO_SOURCE_REGISTRY: Record<string, string> = {
  // 以下均为【实测】：读侧有字面量、全仓无同名写入者 ⇒ 归 #1381（轴迁移 / 建映射）
  Financial: '#1381（孤轴：0 写入者；含 business-model-canvas:149、environment-rent-dependency:39 …）',
  FINANCIAL: '#1381（孤轴：raw SQL 侧写法）',
  Tool: '#1381（孤轴：0 写入者）',
  TOOL: '#1381（孤轴：raw SQL 侧写法）',
  APP: '#1381（孤轴：raw SQL 侧写法）',
  SOFTWARE: '#1381（孤轴：raw SQL 侧写法）',
  Event: '#1381（待核：本体轴可能对应 activity/*）',
  Client: '#1381（待核）',
  Process: '#1381（待核）',
  Risk: '#1381（孤轴：0 写入者；briefing-generator:73）',
  Capability: '#1381（孤轴：0 写入者；business-model-canvas:169）',
  Evidence: '#1381（孤轴：0 写入者；quality-firewall:54）',
  Agent: '#1381（孤轴：0 写入者；network-power:39、niche-squeeze:13）',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '_extinct' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const isComment = (line: string): boolean => {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};
const readLines = (files: string[]): Array<{ f: string; n: number; line: string }> => {
  const out: Array<{ f: string; n: number; line: string }> = [];
  for (const f of files) readFileSync(f, 'utf-8').split('\n').forEach((line, i) => {
    if (line.includes('graph_nodes') || line.includes('queryNodes(')) out.push({ f, n: i + 1, line });
  });
  return out;
};

describe('#1379 遗留轴一致性（对照表即判据）', () => {
  const files = ROOTS.flatMap(r => walk(r));
  const lines = readLines(files).filter(x => !isComment(x.line));

  it('V1 旧字面量零残留：type=\'TEAM\' / queryNodes(\'Goal\' / type=\'Goal\'', () => {
    const bad = lines.filter(x => /type\s*=\s*'TEAM'|queryNodes\('Goal'|type\s*=\s*'Goal'/.test(x.line));
    expect(bad.map(x => `${x.f}:${x.n}`)).toEqual([]);
  });

  it('V2 对照表：每个读侧字面量 ⇒ 同名写入者 或 在【无源登记】中（禁默认通过）', () => {
    const reads = new Set<string>();
    for (const { line } of lines) {
      for (const m of line.matchAll(/type\s*=\s*'([A-Za-z_]+)'/g)) reads.add(m[1]);
      for (const m of line.matchAll(/queryNodes\('([A-Za-z_]+)'/g)) reads.add(m[1]);
    }
    const writeSrc = files.map(f => readFileSync(f, 'utf-8')).join('\n');
    // 只认【同名】写入者（禁用"存在任意 NodeType 写入"这类过宽兜底 —— 那会让判据失去判别性，R109）
    const hasWriter = (t: string): boolean => new RegExp(`createNodes?\\(\\s*'${t}'`).test(writeSrc);
    const unmatched = [...reads].filter(t => !hasWriter(t) && !(t in NO_SOURCE_REGISTRY));
    expect(unmatched, `以下读侧字面量既无同名写入者、也不在无源登记：${unmatched.join(', ')}`).toEqual([]);
  });

  it('V3 空读必留痕：两处哨兵空读路径均含显式 warn（reason=empty-read）', () => {
    for (const f of ['src/sentinel/adapters/cash-flow-sentinel.ts', 'src/sentinel/adapters/goal-alignment-sentinel.ts']) {
      const src = readFileSync(f, 'utf-8');
      expect(src, `${f} 应含 empty-read 显式留痕`).toContain("reason: 'empty-read'");
      expect(src).toMatch(/log\.warn\(/);
    }
  });
});
