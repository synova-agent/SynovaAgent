/**
 * tests/agent/conversation-engine-role.test.ts — #1075 P2-2 岗位人设注入判据（J1a／J2／J3／J7a／J10）
 *
 * 断言对象 = **生产路径**（`src/agent/conversation-engine.ts` 的 `new ConversationEngine()`／
 *   `getMessages()`／`setRolePack()`／`advancePhase()`／`serialize()`／`fromState()`）——
 *   禁 grep 当验收（规格 §4 V-02）。夹具 = 对象字面量 `RolePackPersona`（不读磁盘：本层只消费
 *   已解析的 persona；磁盘解析/审批/限额归 `tests/init/role-pack-persona.test.ts`）。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J1a 人设注入（unit）：构造带 `rolePack` ⇒ `getMessages()[0].content` 含 `## 岗位设定：<roleId>` ＋ addendum 原文；
 *       顺序硬约束：`## 你的角色`（L1）索引 < `## 岗位设定：` 索引 < `## 当前阶段` 索引。
 *   J1  降级：`systemAddendum: ''` ⇒ **无**岗位设定段，但清单段仍在（两段独立）。
 *   J2  清单注入（不解析内容）：`[必带]`／`[选带]` ＋ label ＋ why ＋ `（source: <指针>`；
 *       **反例**：source 指向的真实文件内含哨兵串 ⇒ 提示词**不含**该串（只注入指针）；
 *       **反例**：`contexts: []` ⇒ 无清单标题。
 *   J3  无包基线**逐字一致**：无 `rolePack` 构造 ⇒ `sha256(system)` === 硬编码常量（`LEN=1462`）。
 *       🔴 常量来源 = base 树 `b8edf9860` 的临时测试（规格 §5-④，CTO 实测）；**禁**由实现现算再比
 *       （同源自证）。本批 verifier 已在 base 树独立复现两遍（逐字一致）。
 *   J7a 持久化：`serialize()` 含 `rolePackId`；`fromState(state, {rolePack})` ⇒ 人设段回来；
 *       **反例**：无 rolePack 时 `serialize()` **不含** `rolePackId` 键（保 J3 基线形态）；
 *       **撤场景**：`fromState(state, {rolePack:null})` ⇒ 快照里的旧人设段被刷掉；
 *       **兼容**：不传 `rolePack`（`undefined`）⇒ 既有恢复行为逐字不变。
 *   J10 改坏必红（编码成员执行，见回执）：删 `buildRoleLayer` 注入／删 `serialize` 的 `rolePackId`。
 *
 * @degraded 本文件只读引擎输出；不产生日志判据（降级头/HTTP 面归 `tests/routes/conversations-role.test.ts`）。
 * @authority 判据归属 #1075 P2-2（规格 §4 J1a/J2/J3/J7a）；本文件不测路由、不测磁盘解析。
 *
 * 已知限制：
 *   ① 不测真实模型效果（只证"进了系统提示词"——规格 §10-L8）；
 *   ② 不测 `SYNOVA_ROLE_PACK_PERSONA=off` 回滚开关（开关在 `buildRoleLayer`，归 persona 模块测试）；
 *   ③ 相位推进只经 `advancePhase()` 公开方法（PhaseStateMachine 路径需状态机夹具，与本判据无关）；
 *   ④ 不覆盖 HTTP 授权/审批门（J4–J8 归路由测试件）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, ChatResult, StreamCallback } from '../../src/providers/types';
import { ConversationEngine } from '../../src/agent/conversation-engine';
import type { RolePackPersona } from '../../src/init/role-pack-persona';

// ══════════════════════════════════════════════════════════════════════════════
// 夹具（fake provider ＋ persona 字面量；零磁盘依赖，除 J2 反例的哨兵文件）
// ══════════════════════════════════════════════════════════════════════════════

function fakeProvider(reply = '（fake）请补充报告期。'): LLMProvider {
  return {
    name: 'fake-role-engine',
    baseUrl: 'fake://role-engine',
    async chat(): Promise<ChatResult> {
      return { content: reply, model: 'fake' };
    },
    async stream(_msgs, cb: StreamCallback): Promise<void> {
      cb.onComplete?.({ content: reply, model: 'fake' });
    },
    async healthCheck() { return { healthy: true, latencyMs: 1 }; },
    listModels() { return ['fake']; },
  };
}

const provider = fakeProvider();

/** 可搜的人设原文（防"只有标题没有正文"的假绿） */
const ADDENDUM = 'PERSONA_ADDENDUM_7c1：所有结论必须标明报告期与口径来源；缺报告期先追问，不得用「大概」替代。';

function basePersona(overrides: Partial<RolePackPersona> = {}): RolePackPersona {
  return {
    roleId: 'ops',
    systemAddendum: ADDENDUM,
    contexts: [
      {
        id: 'ops.period',
        label: '报告期',
        source: 'extensions/ontology/outcome/financial.json#requiredProps.period',
        why: '无报告期的指标不可比较',
        required: true,
      },
      {
        id: 'company.bp',
        label: '公司业务说明',
        source: 'profile.business-plan',
        why: '结论要落回业务动作',
        required: false,
      },
    ],
    ...overrides,
  };
}

/** `getMessages()[0].content`（system 层；缺 system 直接断言失败，不静默取空串） */
function systemContent(engine: ConversationEngine): string {
  const first = engine.getMessages()[0];
  expect(first?.role, 'getMessages()[0] 必须是 system 层').toBe('system');
  return first?.content ?? '';
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** J3 基准（base 树 `b8edf9860` 的临时测试产出；规格 §5-④ 原样硬编码，禁现算） */
const J3_BASELINE_LEN = 1462;
const J3_BASELINE_SHA256 = '976ca690d56eeb91ccc24b9d81c1b86b322217cacb4006e9c3f66c95e42dfd33';

// J2 反例夹具目录（afterEach 统一清理，失败也清）
const sandboxes: string[] = [];
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p22-engine-role-'));
  sandboxes.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// J1a · 人设注入（unit）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1a 人设注入：角色包进系统提示词', () => {
  it('J1a-1 构造带 rolePack ⇒ getMessages()[0] 含「## 岗位设定：ops」＋ addendum 原文', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    const system = systemContent(engine);
    expect(system).toContain('## 岗位设定：ops');
    expect(system).toContain(ADDENDUM);
  });

  it('J1a-2 顺序硬约束：L1「## 你的角色」索引 <「## 岗位设定：ops」索引 <「## 当前阶段」索引', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    const system = systemContent(engine);
    const l1Index = system.indexOf('## 你的角色');
    const roleIndex = system.indexOf('## 岗位设定：ops');
    const phaseIndex = system.indexOf('## 当前阶段');
    expect(l1Index).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(l1Index);
    expect(phaseIndex).toBeGreaterThan(roleIndex);
  });

  it('J1-降级 systemAddendum 为空 ⇒ 无岗位设定段，但清单段仍在（两段独立）', () => {
    const engine = new ConversationEngine(provider, {
      orgId: 'default',
      rolePack: basePersona({ systemAddendum: '' }),
    });
    const system = systemContent(engine);
    expect(system).not.toContain('## 岗位设定：');
    expect(system).toContain('## 该岗位应带的上下文');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · 上下文清单注入（只注入指针，不解析内容）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2 清单注入：只给指针，不偷读内容', () => {
  it('J2-1 两条 contexts ⇒ 含 [必带]／[选带] ＋ label ＋ why ＋（source: 指针）', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    const system = systemContent(engine);
    expect(system).toContain('## 该岗位应带的上下文（按需读取，不要凭空假设）');
    expect(system).toContain(
      '- [必带] 报告期 —— 无报告期的指标不可比较（source: extensions/ontology/outcome/financial.json#requiredProps.period）',
    );
    expect(system).toContain('- [选带] 公司业务说明 —— 结论要落回业务动作（source: profile.business-plan）');
  });

  it('J2-反例 source 指向的文件内容含哨兵串 ⇒ 系统提示词不含该串（只注入指针）', () => {
    const dir = sandbox();
    const sentinelPath = join(dir, 'sentinel-context.md');
    writeFileSync(sentinelPath, 'SENTINEL_BODY_9f3\n这段正文绝不允许进提示词。', 'utf8');
    const engine = new ConversationEngine(provider, {
      orgId: 'default',
      rolePack: basePersona({
        contexts: [
          { id: 'ops.sentinel', label: '哨兵样本', source: sentinelPath, why: '验证只注入指针', required: true },
        ],
      }),
    });
    const system = systemContent(engine);
    // 指针在（证注入路径真的跑了），正文不在（证没偷读）
    expect(system).toContain(`（source: ${sentinelPath}）`);
    expect(system).not.toContain('SENTINEL_BODY_9f3');
    expect(system).not.toContain('这段正文绝不允许进提示词');
  });

  it('J2-反例 contexts 为空 ⇒ 无清单标题（addendum 段仍在）', () => {
    const engine = new ConversationEngine(provider, {
      orgId: 'default',
      rolePack: basePersona({ contexts: [] }),
    });
    const system = systemContent(engine);
    expect(system).not.toContain('## 该岗位应带的上下文');
    expect(system).toContain('## 岗位设定：ops');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 · 无包基线逐字一致（基准由 base 树产出，禁同源自证）
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 无包基线：提示词逐字不变', () => {
  it('J3-1 无 rolePack 构造 ⇒ length ＝ 1462 且 sha256 ＝ 976ca690…fd33', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default' });
    const system = systemContent(engine);
    expect(system.length).toBe(J3_BASELINE_LEN);
    expect(sha256(system)).toBe(J3_BASELINE_SHA256);
  });

  it('J3-2 无 rolePack 时不含任何岗位段（基线与岗位层互斥）', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default' });
    const system = systemContent(engine);
    expect(system).not.toContain('## 岗位设定：');
    expect(system).not.toContain('## 该岗位应带的上下文');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J7a · 持久化（serialize ＋ fromState 是生产恢复 API）
// ══════════════════════════════════════════════════════════════════════════════

describe('J7a 持久化：serialize 带 rolePackId，fromState 恢复人设', () => {
  it('J7a-1 有 rolePack ⇒ serialize().rolePackId ＝ ops；fromState(state,{rolePack}) ⇒ 人设段回来', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    const state = engine.serialize();
    expect(state.rolePackId).toBe('ops');

    const restored = ConversationEngine.fromState(fakeProvider(), state, { rolePack: basePersona() });
    const system = systemContent(restored);
    expect(system).toContain('## 岗位设定：ops');
    expect(system).toContain(ADDENDUM);
  });

  it('J7a-2 反例 无 rolePack 时 serialize() 不含 rolePackId 键（保 J3 基线形态）', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default' });
    const state = engine.serialize();
    expect('rolePackId' in state).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(state, 'rolePackId')).toBe(false);
  });

  it('J7a-3 撤场景 fromState(state,{rolePack:null}) ⇒ 快照里的旧人设段被刷掉', () => {
    const withPersona = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    const snapshot = withPersona.serialize();
    expect(snapshot.rolePackId).toBe('ops');

    const restored = ConversationEngine.fromState(fakeProvider(), snapshot, { rolePack: null });
    const system = systemContent(restored);
    expect(system).not.toContain('## 岗位设定：');
    expect(system).not.toContain(ADDENDUM);
    // 撤回后 = 无包基线形态（逐字回到 J3 基准）
    expect(system.length).toBe(J3_BASELINE_LEN);
    expect(sha256(system)).toBe(J3_BASELINE_SHA256);
  });

  it('J7a-4 兼容 不传 rolePack（undefined）⇒ 既有恢复行为逐字不变（快照 messages 原样保留）', () => {
    const withPersona = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    const snapshot = withPersona.serialize();
    const restored = ConversationEngine.fromState(fakeProvider(), snapshot, {});
    expect(systemContent(restored)).toBe(snapshot.messages[0]?.content);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// setRolePack · 每轮刷新（幂等 ＋ 可清空 ＋ 相位重建不丢）
// ══════════════════════════════════════════════════════════════════════════════

describe('setRolePack：每轮刷新人设（幂等、可清空、相位重建不丢）', () => {
  it('setRolePack-1 注入 → 清空 → 再注入，三段内容各自稳定（幂等）', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default' });
    const baseline = systemContent(engine);
    expect(baseline).not.toContain('## 岗位设定：');

    engine.setRolePack(basePersona());
    const injected = systemContent(engine);
    expect(injected).toContain('## 岗位设定：ops');

    engine.setRolePack(basePersona());
    expect(systemContent(engine)).toBe(injected); // 幂等：同入参 ⇒ 同内容

    engine.setRolePack(null);
    const cleared = systemContent(engine);
    expect(cleared).not.toContain('## 岗位设定：');
    expect(cleared.length).toBe(J3_BASELINE_LEN);
    expect(sha256(cleared)).toBe(J3_BASELINE_SHA256);

    engine.setRolePack(null);
    expect(systemContent(engine)).toBe(cleared); // 幂等：null 连调一致
  });

  it('setRolePack-2 相位重建不丢人设：advancePhase() 后人设段仍在且相位段已更新', () => {
    const engine = new ConversationEngine(provider, { orgId: 'default', rolePack: basePersona() });
    engine.advancePhase();
    const system = systemContent(engine);
    expect(system).toContain('## 岗位设定：ops');
    expect(system).toContain(ADDENDUM);
    expect(system).toContain('## 当前阶段：Phase 1');
  });
});
