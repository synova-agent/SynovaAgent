/**
 * tests/runtime/approval-seam.test.ts — K12-19 / Issue #202（原 RB-05）人在环审批缝**本体**配对测试
 *
 * 判据对象: `src/runtime/approval-seam.ts`
 * 配对理由: pre-commit 组 2b 要求 `src/<path>.ts → tests/<path>.test.ts` **严格路径镜像**
 *   （无 basename 回退，实测见交付回执）；本文件即该镜像位。
 *   生产入口（`src/routes/self-ops.ts`）的安全判据在 `tests/security/approval-seam.test.ts`。
 *
 * 本文件**不吃 grep**（判例 V-01/V-02）: 每一组断言都**真调用**被测入口、**真观测**返回值与留痕字段。
 * 唯一一处静态事实（HIGH_RISK_ACTIONS 与 DANGEROUS_OPS 逐项相等）也是靠 `listAvailableOps()`
 * **真调用**取到的清单做比对，不是读源码字符串。
 *
 * 覆盖（铁律 48: 正常路径 + 降级路径 + 边界）:
 *   ① 清单口径        —— HIGH_RISK_ACTIONS ⇔ system-self-ops 的 dangerous 操作（防两处漂移）
 *   ② V2 无人应答 ⇒ 拒 —— 四个变体逐个断言（无应答 / 超时 / 应答缺失 / 应答非法）
 *   ③ 不变量          —— `allowed === true` **当且仅当**人类显式批准（表驱动，含边界输入）
 *   ④ V3 有答 ⇒ 按答执行（批准 / 拒绝两态）
 *   ⑤ 降级诚实        —— 判不了 ⇒ degraded=true + errors[] 非空（铁律 24/31，禁空吞）
 *   ⑥ V4 声明缺失即报错 —— 缺失 / 形态非法 / 缺省裁决非 reject 三条都抛
 *   ⑦ V5 判别力        —— 无人应答(拒) 与 有答批准(准) 必须可区分（改坏即红的单测面）
 */
import { describe, it, expect } from 'vitest';
import {
  HIGH_RISK_ACTIONS,
  requestApproval,
  resolveApprovalPolicy,
  type ApprovalOutcome,
} from '../../src/runtime/approval-seam';
import { listAvailableOps } from '../../src/deploy/system-self-ops';

/** 被测的高风险动作（取自实现自己导出的清单，避免测试另造一套口径） */
const HIGH_RISK = HIGH_RISK_ACTIONS[0];
/** 一个明确不在高风险清单内的安全动作 */
const SAFE_OP = 'clear-cache';
/** 探针/测试代理的请求者标识 */
const ACTOR = 'approval-seam.test';

/** 四要素留痕判定（卡面 V2: 谁 / 何时 / 什么动作 / 为什么拒） */
const TRAIL_ASPECTS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: '谁', pattern: /actor|who|user|operator|requester|principal|subject|initiator/i },
  { label: '何时', pattern: /timestamp|when|time|date|at$/i },
  { label: '什么动作', pattern: /action|operation|target|resource|what/i },
  { label: '为什么拒', pattern: /reason|why|justification|cause|explanation|basis/i },
];

/** 断言一条留痕记录含齐四要素（字段名可识别且值非空） */
function expectFourAspectTrail(outcome: ApprovalOutcome): void {
  const audit: Record<string, unknown> = { ...outcome.audit };
  for (const aspect of TRAIL_ASPECTS) {
    const key = Object.keys(audit).find((k) => aspect.pattern.test(k));
    expect(key, `留痕缺「${aspect.label}」（现有字段: ${Object.keys(audit).join(',')}）`).toBeDefined();
    const value = key === undefined ? undefined : audit[key];
    expect(value, `留痕「${aspect.label}」的值为空`).toBeTruthy();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 清单口径
// ══════════════════════════════════════════════════════════════════════════════

describe('① 高风险动作清单口径', () => {
  it('HIGH_RISK_ACTIONS 与 system-self-ops 的 dangerous 操作逐项相等（防两处口径漂移）', () => {
    const dangerous = listAvailableOps()
      .filter((o) => o.severity === 'dangerous')
      .map((o) => o.op);
    expect(dangerous.length).toBeGreaterThan(0);
    expect([...HIGH_RISK_ACTIONS].sort()).toEqual([...dangerous].sort());
  });

  it('清单非空且每项都是非空字符串（探针按 HIGH_RISK_ACTIONS[0] 构造动作名）', () => {
    expect(HIGH_RISK_ACTIONS.length).toBeGreaterThan(0);
    for (const action of HIGH_RISK_ACTIONS) {
      expect(typeof action).toBe('string');
      expect(action.length).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ② V2 无人应答 ⇒ 拒 —— 四个变体（创始人明令的硬要求）
// ══════════════════════════════════════════════════════════════════════════════

describe('② V2 无人应答 ⇒ 拒（四个变体逐个实测）', () => {
  it('变体 1｜无应答: ask 返回 undefined ⇒ 拒（不是放行）', async () => {
    const outcome = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => undefined });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.audit.code).toBe('APPROVAL_NO_ANSWER');
    expect(outcome.audit.answered).toBe(false);
    expectFourAspectTrail(outcome);
  });

  it('变体 2｜超时: ask 永不落地 ⇒ 超时 ⇒ 拒（卡面「不许超时放行」）', async () => {
    const outcome = await requestApproval({
      action: HIGH_RISK,
      actor: ACTOR,
      timeoutMs: 25,
      ask: () => new Promise<never>(() => {}),
    });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.audit.code).toBe('APPROVAL_ANSWER_TIMEOUT');
    expect(outcome.audit.reason).toContain('25');
    expectFourAspectTrail(outcome);
  });

  it('变体 3｜应答缺失: 未注入 ask 端口 ⇒ 拒', async () => {
    const outcome = await requestApproval({ action: HIGH_RISK, actor: ACTOR });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.audit.code).toBe('APPROVAL_ANSWER_PORT_MISSING');
    expectFourAspectTrail(outcome);
  });

  it('变体 4｜应答非法: ask 返回无法解释的字面量 ⇒ 判不了 ⇒ 拒 + degraded', async () => {
    const outcome = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => 'maybe' });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.audit.code).toBe('APPROVAL_ANSWER_ILLEGAL');
    expect(outcome.degraded).toBe(true);
    expect(outcome.errors.length).toBeGreaterThan(0);
    expectFourAspectTrail(outcome);
  });

  it('边界: 空串 / null / 数字 / 空对象 / 无裁决对象 —— 一律判拒（不得滑成放行）', async () => {
    const illegalAnswers: ReadonlyArray<unknown> = ['', null, 0, 42, {}, { decision: 'later' }, { ok: true }];
    for (const answer of illegalAnswers) {
      const outcome = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => answer });
      expect(outcome.allowed, `应答 ${JSON.stringify(answer)} 竟然被放行`).toBe(false);
      expect(outcome.decision).toBe('rejected');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 不变量（本缝唯一的判定律）
// ══════════════════════════════════════════════════════════════════════════════

describe('③ 不变量: allowed === true 当且仅当人类显式批准', () => {
  it('表驱动 —— 一张表里只有「显式批准」那几行 allowed=true', async () => {
    const approved = (): string => 'approved';
    const rejected = (): string => 'rejected';
    const table: ReadonlyArray<{ readonly label: string; readonly req: Parameters<typeof requestApproval>[0]; readonly allowed: boolean }> = [
      { label: '显式批准（字面量）', req: { action: HIGH_RISK, actor: ACTOR, ask: approved }, allowed: true },
      { label: '显式批准（对象形态）', req: { action: HIGH_RISK, actor: ACTOR, ask: () => ({ approved: true }) }, allowed: true },
      { label: '显式拒绝', req: { action: HIGH_RISK, actor: ACTOR, ask: rejected }, allowed: false },
      { label: '无应答', req: { action: HIGH_RISK, actor: ACTOR, ask: () => undefined }, allowed: false },
      { label: '应答缺失', req: { action: HIGH_RISK, actor: ACTOR }, allowed: false },
      { label: '非高风险动作', req: { action: SAFE_OP, actor: ACTOR, ask: approved }, allowed: false },
      { label: '动作名缺失', req: { actor: ACTOR, ask: approved }, allowed: false },
      { label: '请求非对象', req: undefined, allowed: false },
    ];
    for (const row of table) {
      const outcome = await requestApproval(row.req);
      expect(outcome.allowed, `「${row.label}」的 allowed 与预期不符（decision=${outcome.decision} code=${outcome.audit.code}）`).toBe(row.allowed);
      expect(outcome.allowed).toBe(outcome.decision === 'approved');
    }
  });

  it('非高风险动作 ⇒ 拒（不得自动放行 —— 否则「非高风险」就是绕过审批的后门）', async () => {
    const outcome = await requestApproval({ action: SAFE_OP, actor: ACTOR, ask: () => 'approved' });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.audit.code).toBe('APPROVAL_ACTION_NOT_HIGH_RISK');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ V3 有答 ⇒ 按答执行
// ══════════════════════════════════════════════════════════════════════════════

describe('④ V3 有答 ⇒ 按答执行（批准 / 拒绝两态）', () => {
  it('批准 ⇒ allowed=true + APPROVAL_GRANTED + 留痕 answered=true', async () => {
    const outcome = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => 'approved' });
    expect(outcome.decision).toBe('approved');
    expect(outcome.allowed).toBe(true);
    expect(outcome.degraded).toBe(false);
    expect(outcome.audit.answered).toBe(true);
    expect(outcome.audit.code).toBe('APPROVAL_GRANTED');
    expect(outcome.audit.actor).toBe(ACTOR);
    expect(outcome.audit.action).toBe(HIGH_RISK);
    expectFourAspectTrail(outcome);
  });

  it('拒绝 ⇒ allowed=false + APPROVAL_REJECTED_BY_HUMAN', async () => {
    const outcome = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => 'rejected' });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.degraded).toBe(false);
    expect(outcome.audit.code).toBe('APPROVAL_REJECTED_BY_HUMAN');
    expectFourAspectTrail(outcome);
  });

  it('异步应答端口（人类应答天然异步）也走同一判定', async () => {
    const outcome = await requestApproval({
      action: HIGH_RISK,
      actor: ACTOR,
      timeoutMs: 1_000,
      ask: async () => 'approved',
    });
    expect(outcome.allowed).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 降级诚实（铁律 24/31: 判不了要说出来，禁空吞）
// ══════════════════════════════════════════════════════════════════════════════

describe('⑤ 降级诚实: 判不了 ⇒ 拒 + degraded + errors[]', () => {
  it('应答端口抛异常 ⇒ 判不了 ⇒ 拒，且 errors[] 非空（不是空 catch）', async () => {
    const outcome = await requestApproval({
      action: HIGH_RISK,
      actor: ACTOR,
      ask: () => {
        throw new Error('channel down');
      },
    });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.allowed).toBe(false);
    expect(outcome.degraded).toBe(true);
    expect(outcome.audit.code).toBe('APPROVAL_ANSWER_PORT_THREW');
    expect(outcome.errors.join('|')).toContain('channel down');
  });

  it('应答端口的 Promise 被拒绝 ⇒ 判不了 ⇒ 拒 + degraded + errors[]', async () => {
    const outcome = await requestApproval({
      action: HIGH_RISK,
      actor: ACTOR,
      timeoutMs: 500,
      ask: async () => {
        throw new Error('channel rejected');
      },
    });
    expect(outcome.allowed).toBe(false);
    expect(outcome.degraded).toBe(true);
    expect(outcome.errors.length).toBeGreaterThan(0);
  });

  it('「确定的拒」不得伪装成降级: 无应答/超时/应答缺失 ⇒ degraded=false', async () => {
    const definite: ReadonlyArray<Parameters<typeof requestApproval>[0]> = [
      { action: HIGH_RISK, actor: ACTOR, ask: () => undefined },
      { action: HIGH_RISK, actor: ACTOR, timeoutMs: 20, ask: () => new Promise<never>(() => {}) },
      { action: HIGH_RISK, actor: ACTOR },
    ];
    for (const req of definite) {
      const outcome = await requestApproval(req);
      expect(outcome.allowed).toBe(false);
      expect(outcome.degraded, `code=${outcome.audit.code} 被错标为降级`).toBe(false);
    }
  });

  it('判不了（degraded）⇒ errors[] 结构性非空（唯一出口强制，不靠每个分支自觉）', async () => {
    const degradedInputs: ReadonlyArray<Parameters<typeof requestApproval>[0]> = [
      { action: HIGH_RISK, actor: ACTOR, ask: () => 'maybe' },
      { action: HIGH_RISK, actor: ACTOR, ask: () => ({ ok: true }) },
      { action: HIGH_RISK, actor: ACTOR, policy: { defaultDecision: 'approve' } },
      { actor: ACTOR, ask: () => 'approved' },
      undefined,
    ];
    for (const req of degradedInputs) {
      const outcome = await requestApproval(req);
      expect(outcome.degraded, `code=${outcome.audit.code} 应为 degraded`).toBe(true);
      expect(outcome.errors.length, `code=${outcome.audit.code} 的 errors[] 为空（静默吞错）`).toBeGreaterThan(0);
      expect(outcome.errors.join('|')).toContain(outcome.audit.code);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ V4 声明缺失即报错（不静默放行）
// ══════════════════════════════════════════════════════════════════════════════

describe('⑥ V4 策略声明缺失 ⇒ 报错', () => {
  it('声明缺失（undefined）⇒ 抛错，不返回缺省策略', () => {
    expect(() => resolveApprovalPolicy(undefined)).toThrow(/声明缺失/);
  });

  it('声明形态非法 ⇒ 抛错（逐个坏形态）', () => {
    expect(() => resolveApprovalPolicy('not-an-object')).toThrow();
    expect(() => resolveApprovalPolicy({ version: 1 })).toThrow();
    expect(() => resolveApprovalPolicy({ version: 0, highRiskActions: ['a'], defaultDecision: 'reject' })).toThrow();
    expect(() => resolveApprovalPolicy({ version: 1, highRiskActions: [], defaultDecision: 'reject' })).toThrow();
  });

  it('缺省裁决不是 reject ⇒ 抛错（fail-closed 是声明本身必须满足的性质）', () => {
    expect(() => resolveApprovalPolicy({ version: 1, highRiskActions: ['a'], defaultDecision: 'approve' })).toThrow(/fail-closed/);
  });

  it('合法声明 ⇒ 冻结的解析结果，缺省 timeoutMs 有值', () => {
    const policy = resolveApprovalPolicy({ version: 1, highRiskActions: ['a'], defaultDecision: 'reject' });
    expect(policy.version).toBe(1);
    expect(policy.highRiskActions).toEqual(['a']);
    expect(policy.timeoutMs).toBeGreaterThan(0);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('宿主递来非法策略 ⇒ 拒（不回落到缺省策略）', async () => {
    const outcome = await requestApproval({
      action: HIGH_RISK,
      actor: ACTOR,
      ask: () => 'approved',
      policy: { defaultDecision: 'approve' },
    });
    expect(outcome.decision).toBe('rejected');
    expect(outcome.audit.code).toBe('APPROVAL_POLICY_INVALID');
    expect(outcome.degraded).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ V5 判别力（「改坏即红」的单测面）
// ══════════════════════════════════════════════════════════════════════════════

describe('⑦ V5 判别力: 无人应答与有答批准必须可区分', () => {
  it('两态决策不同 ⇒ 把「无人应答」改成「默认放行」必被判红', async () => {
    const noAnswer = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => undefined });
    const approved = await requestApproval({ action: HIGH_RISK, actor: ACTOR, ask: () => 'approved' });
    expect(noAnswer.decision).toBe('rejected');
    expect(approved.decision).toBe('approved');
    expect(noAnswer.decision).not.toBe(approved.decision);
    expect(noAnswer.allowed).not.toBe(approved.allowed);
  });
});
