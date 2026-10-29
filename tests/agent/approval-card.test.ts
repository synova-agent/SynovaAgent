/**
 * tests/agent/approval-card.test.ts — 审批卡帧**纯构造**判据（#1075 P3 / T3 配对件）
 *
 * 断言对象 = **生产路径**：`src/agent/approval-card.ts` 的 `buildApprovalCardFrame()`（纯函数，无 IO）。
 *   本文件不 mock 被测模块、不断言源码文本（R3.4）、无 skip（R3.3）—— 每例都有行为断言（R3.1）。
 *
 * 判据分组（与规格 §2.3-E ＋ src/agent/approval-card.ts 的契约注释逐条对齐）:
 *   C1 · approved 形态：`type/roleId/status/scope/contentHash/permissionsPending` 逐字段原样映射；
 *        `buttons` 恒三条（id 与 label 顺序＝协议：批准／撤销／查看说明书）；`detailPath === '/role-packs/'+roleId`。
 *   C2 · 非 approved 形态（**不谎报已批**）：`pending`／`unverified` ⇒ `scope===null`、`permissionsPending===null`
 *        （不是 `false`）；包结构校验未通过 ⇒ `contentHash===null`（不可批的失败形态）。
 *   C3 · 纯构造契约：同一入参恒等产出但不共享同一对象；帧可 JSON 序列化（SSE `sendFrame` 即 `JSON.stringify`）。
 *
 * 🔴 改坏必红载体：C1 的字段断言是**字面值**（不是从生产常量回读）⇒ 若把 status/scope 映射改成
 *   "非 approved 也填 false"/"scope 缺省 content"，C2 必红；若按钮顺序或 label 漂移，C1 必红。
 */
import { describe, expect, it } from 'vitest';
import {
  buildApprovalCardFrame,
  type ApprovalCardFrame,
  type ApprovalCardInput,
} from '../../src/agent/approval-card';

/** 协议期望值（**本文件独立声明**；不从生产模块回读，防"同源自证"）。 */
const EXPECTED_BUTTONS = [
  { id: 'approve', label: '批准' },
  { id: 'revoke', label: '撤销' },
  { id: 'detail', label: '查看说明书' },
] as const;

const HASH = 'dd2e6c594f965a7d7694e16a91412459ee650d8addafc494aaa8ab198cb390dc';

/** 缺省一条 approved 入参（＝读路径算好的形态：已批、权限已批、指纹存在）。 */
function input(overrides: Partial<ApprovalCardInput> = {}): ApprovalCardInput {
  return {
    roleId: 'ops-analyst',
    status: 'approved',
    scope: 'content+permissions',
    contentHash: HASH,
    permissionsPending: false,
    ...overrides,
  };
}

describe('C1 · approved 形态（§2.3-E 逐字段）', () => {
  it('C1 approved：type/roleId/status/scope/contentHash/permissionsPending 逐字映射', () => {
    const frame: ApprovalCardFrame = buildApprovalCardFrame(input());
    expect(frame.type).toBe('approval_card');
    expect(frame.roleId).toBe('ops-analyst');
    expect(frame.status).toBe('approved');
    expect(frame.scope).toBe('content+permissions');
    expect(frame.contentHash).toBe(HASH);
    expect(frame.permissionsPending).toBe(false);
  });

  it('C1 approved 且 scope=content、permissionsPending=true 原样透传（卡不篡改读路径口径）', () => {
    const frame = buildApprovalCardFrame(input({ scope: 'content', permissionsPending: true }));
    expect(frame.status).toBe('approved');
    expect(frame.scope).toBe('content');
    expect(frame.permissionsPending).toBe(true);
  });

  it('C1 buttons 恒三条且 id/label 与顺序固定（批准 → 撤销 → 查看说明书）', () => {
    const frame = buildApprovalCardFrame(input());
    expect(frame.buttons).toHaveLength(EXPECTED_BUTTONS.length);
    expect(frame.buttons.map((button) => button.id)).toEqual(['approve', 'revoke', 'detail']);
    expect(frame.buttons.map((button) => button.label)).toEqual(['批准', '撤销', '查看说明书']);
    expect(frame.buttons).toEqual(EXPECTED_BUTTONS);
  });

  it('C1 detailPath === /role-packs/<roleId>（两个 roleId 均成立，非单例硬编码）', () => {
    expect(buildApprovalCardFrame(input({ roleId: 'ops-analyst' })).detailPath).toBe('/role-packs/ops-analyst');
    expect(buildApprovalCardFrame(input({ roleId: 'hr' })).detailPath).toBe('/role-packs/hr');
    expect(buildApprovalCardFrame(input({ roleId: 'hr' })).detailPath).not.toContain('//');
  });
});

describe('C2 · 非 approved 形态（不谎报已批）', () => {
  it('C2 pending ⇒ scope===null、permissionsPending===null（不是 false）、contentHash 可缺省为 null', () => {
    const frame = buildApprovalCardFrame(
      input({ status: 'pending', scope: null, contentHash: null, permissionsPending: null }),
    );
    expect(frame.status).toBe('pending');
    expect(frame.scope).toBeNull();
    expect(frame.permissionsPending).toBeNull();
    expect(frame.contentHash).toBeNull();
  });

  it('C2 unverified（包结构/校验未通过）⇒ contentHash===null 且 scope/permissionsPending===null', () => {
    const frame = buildApprovalCardFrame(
      input({ status: 'unverified', scope: null, contentHash: null, permissionsPending: null }),
    );
    expect(frame.status).toBe('unverified');
    expect(frame.contentHash).toBeNull();
    expect(frame.scope).toBeNull();
    expect(frame.permissionsPending).toBeNull();
  });

  it('C2 非 approved 时卡片仍给全三按钮与 detailPath（看板可导航，动作由写 API 拒）', () => {
    const frame = buildApprovalCardFrame(
      input({ status: 'pending', scope: null, contentHash: null, permissionsPending: null }),
    );
    expect(frame.buttons.map((button) => button.id)).toEqual(['approve', 'revoke', 'detail']);
    expect(frame.detailPath).toBe('/role-packs/ops-analyst');
    expect(frame.type).toBe('approval_card');
  });
});

describe('C3 · 纯构造契约（无共享可变状态、可序列化）', () => {
  it('C3 同一入参两次调用等值但非同一对象（调用方改一帧不影响另一帧）', () => {
    const first = buildApprovalCardFrame(input());
    const second = buildApprovalCardFrame(input());
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first.detailPath).toBe(second.detailPath);
  });

  it('C3 帧可无损 JSON 序列化（SSE sendFrame 的交付形态；null 字段保留）', () => {
    const frame = buildApprovalCardFrame(
      input({ status: 'pending', scope: null, contentHash: null, permissionsPending: null }),
    );
    const parsed: unknown = JSON.parse(JSON.stringify(frame));
    expect(parsed).toEqual(frame);
    expect(JSON.stringify(frame)).toContain('"type":"approval_card"');
    expect(JSON.parse(JSON.stringify(frame))).toHaveProperty('permissionsPending', null);
  });
});
