/**
 * tests/sentinel/tenant-filter-keys.test.ts — **过滤器键枚举判据**（#1375 CTO 硬要求）
 *
 * 规则（CTO 2026-10-08）：归一化必须**一次覆盖所有键** ⇒ 判据 = **非载体键清单必须为空，或逐条登记为"有意为之"**
 *   载体键 = `orgId`｜别名键 = `TENANT_ALIAS_KEYS`（生产同源）｜其余 = **业务键**（登记 + 理由）
 * 口径：`queryNodes(..., { ... })` 的键名枚举（排除 `_extinct/`）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { TENANT_ALIAS_KEYS, withOrgScope } from '../../src/sentinel/org-scope';

/** 有意为之的业务键（**逐条理由**；它们不是租户键，不该被归一化） */
const BUSINESS_KEYS: Record<string, string> = {
  goalId: '按目标过滤（业务实体）',
  name: '按名称查（人员/工作区）',
  status: '按状态过滤（active/pending…）',
  id: '按节点 id 精确定位',
  financialType: '财务子类型（基线共享件）',
  signalId: '按信号 id 查动作',
  ownerDeptId: '按归属部门过滤',
  department: '按部门过滤（提案）',
  email: '按邮箱查用户',
  phone: '按手机号查用户',
  wechatId: '按微信 id 查用户',
  standardKey: '映射标准键（本体桥接）',
  goalType: '按目标类型过滤（mission 等）',
  agentId: '按 agent 实体过滤（agent-observer）',
  platform: '按渠道/平台过滤（agent-observer upsert 键）',
  cycleId: '按周期过滤（cycles 快照）',
  // 🔴 **另一租户机制（登记，不归一化）**：`src/cycles/overflow-graph-bridge.ts:101/159` 用
  //   `graph = \`${enterpriseId}:cycles\`` **按租户分图**承载租户 ⇒ 该过滤键在【同名图内】有效；
  //   若把它改写为 orgId 会**破坏该路径**（图内节点未必带 props.orgId）⇒ **有意为之，须登记**。
  //   ⇒ 与 #1375 的"一次枚举"要求一致：**不是漏掉，是显式登记**（另一实例：同一概念多套机制 = 母题）
  enterpriseId: '另一租户机制（graph 名承载，per-tenant graph）；不归一化，登记为有意为之',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '_extinct' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe('#1375 过滤器键：一次枚举 + 非载体键登记', () => {
  it('🔴 非载体键清单为空 **或** 逐条登记为"有意为之"（禁"改一个漏一个"）', () => {
    const files = [...walk('src'), ...walk('extensions')];
    const found = new Map<string, Set<string>>();
    const re = /queryNodes\(\s*[^,)]*,\s*\{([^}]*)\}/g;
    for (const f of files) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(re)) {
        for (const kv of m[1].split(',')) {
          const k = kv.split(':')[0].trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            if (!found.has(k)) found.set(k, new Set());
            found.get(k)!.add(f);
          }
        }
      }
    }
    const carrier = 'orgId';
    const unknown = [...found.keys()].filter(
      k => k !== carrier && !(TENANT_ALIAS_KEYS as readonly string[]).includes(k) && !(k in BUSINESS_KEYS),
    );
    expect(unknown, `未登记的过滤器键（既非载体/别名、也非业务键）：${unknown.join(', ')}`).toEqual([]);
    // 载体键与别名键都必须**真出现过**（否则枚举口径漂了）
    expect(found.has(carrier)).toBe(true);
    expect(found.has('teamId')).toBe(true);
  });

  it('V-d1 归一化一次覆盖【全部别名键】：**每一次调用**的 filters 都已归一化（含 #1393 并集读后的多次调用）', () => {
    const seen: Array<Record<string, unknown>> = [];
    const scoped = withOrgScope({
      queryNodes: (_t: string, filters?: Record<string, unknown>) => { seen.push(filters ?? {}); return []; },
    }, 'org-A');
    scoped.queryNodes('Agent', { tid: 'x', goalId: 'g1' });
    scoped.queryNodes('Tool', { teamId: 'y', status: 'active' });
    expect(seen.length).toBeGreaterThan(0);
    for (const f of seen) {
      // ① 别名键一律不出现（teamId/tid 被丢弃）
      for (const k of TENANT_ALIAS_KEYS) expect(f).not.toHaveProperty(k);
      // ② 载体键恒为 ctx 值（单一真源）
      expect(f.orgId).toBe('org-A');
    }
    // ③ 业务键保留（示例：goalId / status）
    expect(seen.some(f => f.goalId === 'g1')).toBe(true);
    expect(seen.some(f => f.status === 'active')).toBe(true);
  });
});
