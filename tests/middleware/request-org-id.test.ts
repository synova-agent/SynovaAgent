/**
 * tests/middleware/request-org-id.test.ts — #1228 S0-2b · `resolveRequestOrgId` 纯函数边界值（U-6）
 *
 * 判据源：`.handbook/派单件/2026-10-31-规格-1228-S0-2b-自报租户点收口-v5.md` §3 U-6（C2 边界值逐条）。
 *
 * 契约（铁律 47）:
 *   @input  declared（请求体/查询串/路径参数原值）／ identity（`req.auth.orgId`）／ instanceOrgId（`loadConfig().orgId`）
 *   @output ok:true  ⇒ { orgId=来源, source='identity'|'instance' }；ok:false ⇒ { code:'CROSS_ORG_DENIED', reason }
 *   @degraded 无（本函数无降级路径；身份缺失 ⇒ 回落实例配置，不是降级）
 *
 * 反例抓手（改坏必红）：
 *   · 把「非字符串/空白 ⇒ 未声明」改成 `String(declared)` ⇒ 42/['org-a']/{} 三条必红；
 *   · 把「身份优先」改成「实例优先」⇒ `'org-a'` vs instance `'inst-org'` 的 identity 判据必红；
 *   · 把 `auth_org_missing` / `org_mismatch` 二态合并 ⇒ 对应 reason 断言必红。
 *
 * 铁律 48：每条用例均有真断言（禁空壳）；铁律 38：零 `as any` / `as unknown as`。
 */
import { describe, it, expect } from 'vitest';
import { resolveRequestOrgId, RequestOrgConfigError, type JwtPayload } from '../../src/middleware/auth';

const INST_ORG = 'inst-org';

/** 构造验签身份载荷（不涉及签名——本件只测纯函数取值/比对面） */
function authFor(orgId: string): { auth: JwtPayload } {
  return {
    auth: { sub: 'u-6', role: 'admin', orgId, iat: 0, exp: 0, jti: 'u-6-jti' },
  };
}

/** 无身份（白名单匿名路径 / 裸挂 router 的真实形态） */
const NO_IDENTITY: { auth?: JwtPayload } = {};

describe('#1228 U-6 · resolveRequestOrgId 边界值（declared × identity × instance）', () => {
  it("声明 'org-b' ≠ 身份 'org-a' ⇒ 拒绝 reason='org_mismatch'", () => {
    expect(resolveRequestOrgId(authFor('org-a'), 'org-b', INST_ORG)).toEqual({
      ok: false,
      code: 'CROSS_ORG_DENIED',
      reason: 'org_mismatch',
    });
  });

  it("声明 'org-a' = 身份 'org-a' ⇒ 通过，source='identity'，orgId='org-a'（身份优先于实例）", () => {
    expect(resolveRequestOrgId(authFor('org-a'), 'org-a', INST_ORG)).toEqual({
      ok: true,
      orgId: 'org-a',
      source: 'identity',
    });
  });

  it("未声明 + 身份在场 ⇒ 通过，source='identity'（实例配置不参与）", () => {
    expect(resolveRequestOrgId(authFor('org-a'), undefined, INST_ORG)).toEqual({
      ok: true,
      orgId: 'org-a',
      source: 'identity',
    });
  });

  it("空串／纯空白视为未声明 ⇒ 通过（不得当字符串比对上）", () => {
    for (const declared of ['', '   ', '\t\n']) {
      expect(resolveRequestOrgId(authFor('org-a'), declared, INST_ORG)).toEqual({
        ok: true,
        orgId: 'org-a',
        source: 'identity',
      });
    }
  });

  it('非字符串（数字／数组／对象）视为未声明 ⇒ 通过（禁用 String() 强转成来源）', () => {
    for (const declared of [42, ['org-a'], { orgId: 'org-a' }, null] as unknown[]) {
      expect(resolveRequestOrgId(authFor('org-a'), declared, INST_ORG)).toEqual({
        ok: true,
        orgId: 'org-a',
        source: 'identity',
      });
    }
  });

  it("身份缺失 + 声明 'other' ≠ 实例 ⇒ 拒绝 reason='auth_org_missing'", () => {
    expect(resolveRequestOrgId(NO_IDENTITY, 'other', INST_ORG)).toEqual({
      ok: false,
      code: 'CROSS_ORG_DENIED',
      reason: 'auth_org_missing',
    });
  });

  it("身份缺失 + 未声明 ⇒ 通过，source='instance'，orgId=实例组织", () => {
    expect(resolveRequestOrgId(NO_IDENTITY, undefined, INST_ORG)).toEqual({
      ok: true,
      orgId: INST_ORG,
      source: 'instance',
    });
  });

  it("身份缺失 + 声明 ' inst-org '（前后空白）⇒ trim 后一致，通过（source='instance'）", () => {
    expect(resolveRequestOrgId(NO_IDENTITY, ' inst-org ', INST_ORG)).toEqual({
      ok: true,
      orgId: INST_ORG,
      source: 'instance',
    });
  });

  it('实例组织非法（undefined／空串／纯空白）⇒ fail loud（ORG_INSTANCE_MISSING），不静默兜底', () => {
    for (const instance of [undefined, '', '   ']) {
      let caught: unknown = null;
      try {
        resolveRequestOrgId(authFor('org-a'), undefined, instance as string);
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(RequestOrgConfigError);
      if (caught instanceof RequestOrgConfigError) {
        expect(caught.code).toBe('ORG_INSTANCE_MISSING');
        expect(caught.phase).toBe('request');
        expect(caught.retryable).toBe(false);
      }
    }
  });

  it('身份带前后空白（测试夹具形态）⇒ trim 后作为来源（不回落到实例组织）', () => {
    expect(resolveRequestOrgId(authFor(' org-a '), 'org-a', INST_ORG)).toEqual({
      ok: true,
      orgId: 'org-a',
      source: 'identity',
    });
  });
});
