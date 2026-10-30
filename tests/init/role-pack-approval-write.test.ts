/**
 * tests/init/role-pack-approval-write.test.ts — 审批**写入器**判据（#1075 P3 / T1：J2–J6 ＋ §4.5-C2）
 *
 * 断言对象 = **生产路径**：`src/init/role-pack-approval-write.ts` 的 `approveRolePack()`／`revokeRolePack()`
 *   ＋ `src/init/preset-loader.ts` 的 `resolveApprovalsRoot()`；**禁 grep 当验收**（规格 §4 判据总纲）。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J2 · 批准落盘＋自绑定：成功记录字段齐备且落盘 JSON 与返回记录一致；`contentHash` 与 `approvalId`
 *       **由本文件独立实现复算**（禁同源自证 —— 期望值不调被测函数）；重复同 hash 同 scope ⇒ `unchanged`
 *       且**不重写**；同 hash 换 scope ⇒ 新记录；记录 ≤8 KiB；POSIX 0600。
 *   J3 · 冲突/出厂/穿越：指纹不等或期望值形状非法 ⇒ 409 且无写入；出厂三包 ⇒ 403 无写入；roleId 形状/穿越 ⇒ 400；
 *       角色不存在 ⇒ 404；scope 非法 ⇒ 422；缺件 ⇒ 500（fail loud，不静默）；既有记录跨 org ⇒ 403 不覆盖。
 *   J4 · 撤销与幂等：撤销删记录并回传被删记录（供路由层记 oldValue）；再撤 ⇒ 404（**不** 200 幂等）；
 *       跨 org ⇒ 403 不删；记录损坏 ⇒ 500 不删（不盲删）。
 *   C2 · 边界与回滚：`SYNOVA_APPROVAL_WRITE=off` ⇒ 503（写/撤都关，读路径不受影响）；记录 >8 KiB ⇒ 500 无写入；
 *       写盘失败（审批根是普通文件）⇒ 500 ＋ `log.error(degraded)`；actor 空／now 非法 ⇒ 500；
 *       损坏记录 ⇒ 批准覆盖修复（`log.warn` 留痕）；`resolveApprovalsRoot(contentRoot)` 与 loader 判定同值。
 *   C2 · 模块边界（补充 check-architecture.sh）：写入器**不** import `AuditService`／`src/l4/**`（铁律 39 ＋ D6）。
 *
 * 🔴 改坏必红（J9 的**单元级载体**）：contentHash／approvalId 的期望值来自本文件**独立实现**
 *   ⇒ 生产实现改算法/字段顺序/分隔符/漏绑 scope ⇒ 必红；写入器吞 IO（不 `log.error`）⇒ C2 用例必红。
 *
 * 隔离手法：每个用例 `mkdtempSync` 临时根（`contentRoot = <tmp>/extensions/presets`、
 *   `approvalsRoot = <tmp>/.synova/approvals`）；**禁写真仓 `.synova/`**；`afterEach` 清理临时根与环境开关。
 */
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createLogger } from '@synova/logger';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FACTORY_APPROVALS, readApprovalRecord } from '../../src/init/role-pack-approval';
import {
  approveRolePack,
  revokeRolePack,
  type ApprovalActor,
  type ApproveRolePackInput,
  type RolePackApprovalScope,
  type WriteResult,
} from '../../src/init/role-pack-approval-write';
import { resolveApprovalsRoot } from '../../src/init/preset-loader';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（G2 判据：IO 失败必须 log.error ＋ degraded；损坏记录修复须 log.warn）
// 范式同 tests/init/role-pack-approval.test.ts:47-56
// ══════════════════════════════════════════════════════════════════════════════

const logCalls = vi.hoisted(() => [] as { level: string; meta?: unknown; msg?: unknown }[]);

/** 本文件日志（`@synova/logger` 已被下方 `vi.mock` 替换为捕获器 ⇒ 写入 logCalls，供 hasLog 断言）。 */
const log = createLogger('tests/role-pack-approval-write');

vi.mock('@synova/logger', () => {
  const make = (level: string) => (meta?: unknown, msg?: unknown) => {
    logCalls.push({ level, meta, msg });
  };
  const m = { info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug'), fatal: make('fatal') };
  return { logger: m, createLogger: () => m };
});

// ══════════════════════════════════════════════════════════════════════════════
// 常量与夹具（本文件自足；不引被测实现当期望值）
// ══════════════════════════════════════════════════════════════════════════════

/** 六件顺序（契约顺序；本文件**独立声明**，生产顺序漂移 ⇒ J2 指纹用例必红）。 */
const PIECES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

const ORG = 'default';
const OTHER_ORG = 'tenant-b';
const ROLE = 'ops-analyst';
const FIXED_NOW = new Date('2026-10-29T01:02:03.456Z');
const FIXED_ISO = '2026-10-29T01:02:03.456Z';
const WRONG_HASH = 'a'.repeat(64);
const SWITCH_ENV = 'SYNOVA_APPROVAL_WRITE';

const IS_WIN32 = process.platform === 'win32';

let tmpRoot = '';
/** 内容根（生产 = `loadRolePacks().root`）：`<tmp>/extensions/presets` */
let contentRoot = '';
/** 审批根（生产 = `resolveApprovalsRoot(contentRoot)`）：`<tmp>/.synova/approvals` */
let approvalsRoot = '';

const roleDirOf = (roleId: string): string => join(contentRoot, 'roles', roleId);
const recordPathOf = (roleId: string): string => join(approvalsRoot, `${roleId}.json`);
const tmpPathOf = (roleId: string): string => `${recordPathOf(roleId)}.tmp`;

/** 造一个六件齐备的岗位包目录（内容与 roleId 绑定 ⇒ 不同 role 指纹不同）；返回 roleDir。 */
function makeRole(roleId: string): string {
  const roleDir = roleDirOf(roleId);
  mkdirSync(roleDir, { recursive: true });
  for (const name of PIECES) {
    writeFileSync(join(roleDir, name), `${roleId}:${name}:v1\n`, 'utf8');
  }
  return roleDir;
}

/**
 * 内容指纹**独立实现**（raw bytes；按 `PIECES` 契约顺序 `sha256(name + '\0' + bytes)`）。
 * 🔴 禁调 `computeRolePackContentHash()` 生成期望值（同源自证 —— gate-A B11 同型）。
 */
function independentContentHash(roleDir: string): string {
  const hash = createHash('sha256');
  for (const name of PIECES) {
    hash.update(name, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(readFileSync(join(roleDir, name)));
  }
  return hash.digest('hex');
}

/**
 * `approvalId` 自绑定**独立实现**（§2.3-C）：
 * `'apv1:' + sha256(orgId|roleId|contentHash|scope|approvedAt|approverId|approverRole).slice(0,16)`。
 * 生产侧同算法但**独立复刻**（上游未导出）⇒ 任一侧漂移，本函数产出必与记录不符。
 */
function independentApprovalId(parts: {
  orgId: string;
  roleId: string;
  contentHash: string;
  scope: RolePackApprovalScope;
  approvedAt: string;
  approverId: string;
  approverRole: string;
}): string {
  const material = [
    parts.orgId,
    parts.roleId,
    parts.contentHash,
    parts.scope,
    parts.approvedAt,
    parts.approverId,
    parts.approverRole,
  ].join('|');
  const digest = createHash('sha256').update(material, 'utf8').digest('hex');
  return `apv1:${digest.slice(0, 16)}`;
}

const ACTOR: ApprovalActor = { id: 'user-1', role: 'admin' };

/** 缺省期望指纹：`ROLE` 目录存在 ⇒ 现场独立指纹；否则用形状合法的错误值（让「无目录」用例走到 404 而非抛）。 */
function defaultExpectedHash(): string {
  try {
    return independentContentHash(roleDirOf(ROLE));
  } catch (err: unknown) {
    // 「ROLE 目录不存在」是部分用例的**正常前提**（404/形状边界）⇒ 回落一个形状合法的错误值。
    // 🔴 非静默吞错（铁律 24/31）：留 log.warn —— 回落原因在日志与断言诊断里可见，不改变行为。
    log.warn({ err }, '夹具缺省期望指纹回落为错误值（ROLE 目录不存在，属用例前提）');
    return WRONG_HASH;
  }
}

/** 一条 approve 入参（按需覆盖；缺省角色包已由 makeRole 造好）。 */
function approveInput(overrides: Partial<ApproveRolePackInput> = {}): ApproveRolePackInput {
  return {
    roleId: ROLE,
    contentRoot,
    approvalsRoot,
    expectedContentHash: defaultExpectedHash(),
    scope: 'content+permissions',
    orgId: ORG,
    actor: ACTOR,
    now: FIXED_NOW,
    ...overrides,
  };
}

/** 断言失败结果并返回它（测试可读性；`ok:true` 时直接抛断言失败）。 */
function expectFail(result: WriteResult): { readonly ok: false; readonly code: string; readonly reason: string } {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('预期失败但返回 ok:true');
  return result;
}

function expectOk(result: WriteResult): { readonly ok: true; readonly record: Record<string, unknown>; readonly unchanged: boolean } {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`预期成功但返回 ${result.code}: ${result.reason}`);
  return result;
}

function hasLog(level: string, code: string): boolean {
  return logCalls.some((call) => call.level === level && JSON.stringify(call.meta ?? {}).includes(code));
}

function readRecordRaw(roleId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(recordPathOf(roleId), 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rp-p3-write-'));
  contentRoot = join(tmpRoot, 'extensions', 'presets');
  approvalsRoot = join(tmpRoot, '.synova', 'approvals');
  mkdirSync(join(contentRoot, 'roles'), { recursive: true });
  delete process.env[SWITCH_ENV];
  logCalls.length = 0;
});

afterEach(() => {
  delete process.env[SWITCH_ENV];
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · 批准落盘 ＋ 自绑定（§2.3-A/C；D2/D9）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2 · 批准落盘＋自绑定', () => {
  it('J2 批准成功：记录九字段齐备、落盘 JSON 与返回记录逐一相等', () => {
    const roleDir = makeRole(ROLE);
    const contentHash = independentContentHash(roleDir);

    const result = expectOk(approveRolePack(approveInput()));
    expect(result.unchanged).toBe(false);
    expect(result.record).toEqual({
      schemaVersion: 1,
      roleId: ROLE,
      orgId: ORG,
      approvalId: expect.stringMatching(/^apv1:[0-9a-f]{16}$/),
      contentHash,
      approverId: 'user-1',
      approverRole: 'admin',
      approvedAt: FIXED_ISO,
      scope: 'content+permissions',
    });
    expect(existsSync(recordPathOf(ROLE))).toBe(true);
    expect(readRecordRaw(ROLE)).toEqual(result.record);
    // 读路径天然复核：写入的记录必须能被 readApprovalRecord 读回（形状契约同源）
    const readBack = readApprovalRecord(ROLE, { approvalsRoot });
    expect(readBack.ok).toBe(true);
  });

  it('J2 contentHash 由六件原始字节独立复算一致（禁同源自证）', () => {
    const roleDir = makeRole(ROLE);
    const record = expectOk(approveRolePack(approveInput())).record;
    expect(record['contentHash']).toBe(independentContentHash(roleDir));
    expect(String(record['contentHash'])).toMatch(/^[0-9a-f]{64}$/);
    // 改一字节 ⇒ 现场指纹必变（raw bytes 语义；写入器必须拒绝 —— 见 J3）
    writeFileSync(join(roleDir, 'capabilities.yaml'), 'tampered\n', 'utf8');
    expect(independentContentHash(roleDir)).not.toBe(record['contentHash']);
  });

  it('J2 approvalId 自绑定独立复算一致（九字段绑定；改 scope 即变）', () => {
    const roleDir = makeRole(ROLE);
    const contentHash = independentContentHash(roleDir);
    const record = expectOk(approveRolePack(approveInput({ expectedContentHash: contentHash }))).record;

    const expected = independentApprovalId({
      orgId: ORG,
      roleId: ROLE,
      contentHash,
      scope: 'content+permissions',
      approvedAt: FIXED_ISO,
      approverId: ACTOR.id,
      approverRole: ACTOR.role,
    });
    expect(record['approvalId']).toBe(expected);

    const otherScope = independentApprovalId({
      orgId: ORG,
      roleId: ROLE,
      contentHash,
      scope: 'content',
      approvedAt: FIXED_ISO,
      approverId: ACTOR.id,
      approverRole: ACTOR.role,
    });
    expect(otherScope).not.toBe(expected);
  });

  it('J2 同 hash 同 scope 再批 ⇒ unchanged:true 且记录不被重写（approvedAt/approvalId 保持首值）', () => {
    makeRole(ROLE);
    const first = expectOk(approveRolePack(approveInput()));
    const rawAfterFirst = readFileSync(recordPathOf(ROLE), 'utf8');

    const second = expectOk(
      approveRolePack(approveInput({ now: new Date('2027-01-01T00:00:00.000Z'), actor: { id: 'user-2', role: 'ga' } })),
    );
    expect(second.unchanged).toBe(true);
    expect(second.record['approvedAt']).toBe(first.record['approvedAt']);
    expect(second.record['approvalId']).toBe(first.record['approvalId']);
    expect(second.record['approverId']).toBe('user-1');
    expect(readFileSync(recordPathOf(ROLE), 'utf8')).toBe(rawAfterFirst);
    expect(hasLog('info', 'unchanged')).toBe(true);
  });

  it('J2 同 hash 换 scope ⇒ 新记录（unchanged:false、scope 更新、approvalId 变）', () => {
    makeRole(ROLE);
    const first = expectOk(approveRolePack(approveInput({ scope: 'content' })));
    expect(first.record['scope']).toBe('content');

    const second = expectOk(approveRolePack(approveInput({ scope: 'content+permissions' })));
    expect(second.unchanged).toBe(false);
    expect(second.record['scope']).toBe('content+permissions');
    expect(second.record['approvalId']).not.toBe(first.record['approvalId']);
    expect(readRecordRaw(ROLE)['scope']).toBe('content+permissions');
  });

  it('J2 记录 ≤ 8 KiB（正常记录尺寸；读路径同上限 8192 B）', () => {
    makeRole(ROLE);
    expectOk(approveRolePack(approveInput()));
    const bytes = Buffer.byteLength(readFileSync(recordPathOf(ROLE), 'utf8'), 'utf8');
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(8192);
  });

  it.skipIf(IS_WIN32)('J2 记录文件模式 0600（仅 POSIX；本用例在 Windows 跳过）', () => {
    expect(IS_WIN32).toBe(false);
    makeRole(ROLE);
    expectOk(approveRolePack(approveInput()));
    expect(statSync(recordPathOf(ROLE)).mode & 0o777).toBe(0o600);
    expect(statSync(approvalsRoot).isDirectory()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 · 冲突/出厂/穿越（§2.2-D2/D3；§2.3-B 码表）
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 · 冲突/出厂/穿越', () => {
  it('J3 指纹不等 ⇒ E_APPROVAL_CONTENT_CHANGED（409），无记录、无 tmp、无审批根', () => {
    makeRole(ROLE);
    const failure = expectFail(approveRolePack(approveInput({ expectedContentHash: WRONG_HASH })));
    expect(failure.code).toBe('E_APPROVAL_CONTENT_CHANGED');
    expect(failure.reason).toContain('内容指纹不符');
    expect(existsSync(recordPathOf(ROLE))).toBe(false);
    expect(existsSync(tmpPathOf(ROLE))).toBe(false);
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 期望指纹形状非法（空/大写/短）⇒ 409 且不做 IO', () => {
    makeRole(ROLE);
    for (const badHash of ['', 'A'.repeat(64), 'abc', 'a'.repeat(65)]) {
      const failure = expectFail(approveRolePack(approveInput({ expectedContentHash: badHash })));
      expect(failure.code).toBe('E_APPROVAL_CONTENT_CHANGED');
      expect(failure.reason).toContain('形状非法');
    }
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 出厂三包 ⇒ E_APPROVAL_FACTORY_LOCKED（写与撤都锁；无写入）', () => {
    const factoryIds = Object.keys(FACTORY_APPROVALS);
    expect(factoryIds).toHaveLength(3);
    for (const factoryId of factoryIds) {
      const approved = expectFail(
        approveRolePack(approveInput({ roleId: factoryId, expectedContentHash: WRONG_HASH })),
      );
      expect(approved.code).toBe('E_APPROVAL_FACTORY_LOCKED');
      const revoked = expectFail(
        revokeRolePack({ roleId: factoryId, approvalsRoot, orgId: ORG, actor: ACTOR }),
      );
      expect(revoked.code).toBe('E_APPROVAL_FACTORY_LOCKED');
    }
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 roleId 形状与穿越（空/超长/分隔符/./../大写）⇒ E_APPROVAL_ROLE_ID_INVALID（400）', () => {
    const badRoleIds = ['', 'a'.repeat(65), 'a/b', '..', '.', '../x', 'Ops', 'x y'];
    for (const badRoleId of badRoleIds) {
      const failure = expectFail(approveRolePack(approveInput({ roleId: badRoleId })));
      expect(failure.code).toBe('E_APPROVAL_ROLE_ID_INVALID');
      expect(failure.reason.length).toBeGreaterThan(0);
    }
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 roleId 长度边界：64 合法（可批准）、65 非法', () => {
    const roleId64 = 'a'.repeat(64);
    makeRole(roleId64);
    expectOk(
      approveRolePack(
        approveInput({ roleId: roleId64, expectedContentHash: independentContentHash(roleDirOf(roleId64)) }),
      ),
    );
    expect(existsSync(recordPathOf(roleId64))).toBe(true);
    expect(expectFail(approveRolePack(approveInput({ roleId: 'a'.repeat(65) }))).code).toBe(
      'E_APPROVAL_ROLE_ID_INVALID',
    );
  });

  it('J3 角色不存在 ⇒ E_APPROVAL_ROLE_NOT_FOUND（404）且不创建审批根', () => {
    const failure = expectFail(approveRolePack(approveInput({ roleId: 'ghost' })));
    expect(failure.code).toBe('E_APPROVAL_ROLE_NOT_FOUND');
    expect(failure.reason).toContain('ghost');
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 scope 非法 ⇒ E_APPROVAL_SCOPE_INVALID（422）且无写入', () => {
    makeRole(ROLE);
    // 运行期防御（HTTP 层 JSON 可传任意值；路由层必须 422）：类型面之外故意注入非法 scope
    const rawScope = 'everything' as RolePackApprovalScope;
    const failure = expectFail(approveRolePack(approveInput({ scope: rawScope })));
    expect(failure.code).toBe('E_APPROVAL_SCOPE_INVALID');
    expect(failure.reason).toContain('everything');
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 角色目录在但缺件 ⇒ E_APPROVAL_IO（500，fail loud；不写盘）', () => {
    const roleDir = makeRole(ROLE);
    const contentHash = independentContentHash(roleDir);
    unlinkSync(join(roleDir, 'acceptance-criteria.yaml'));
    const failure = expectFail(approveRolePack(approveInput({ expectedContentHash: contentHash })));
    expect(failure.code).toBe('E_APPROVAL_IO');
    expect(failure.reason).toContain('六件');
    expect(hasLog('error', 'E_APPROVAL_IO')).toBe(true);
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('J3 既有记录属于其它 org ⇒ E_APPROVAL_ORG_MISMATCH（403），原记录不被覆盖', () => {
    const roleDir = makeRole(ROLE);
    const contentHash = independentContentHash(roleDir);
    mkdirSync(approvalsRoot, { recursive: true });
    const foreignRecord = {
      schemaVersion: 1,
      roleId: ROLE,
      orgId: OTHER_ORG,
      approvalId: 'apv1:0123456789abcdef',
      contentHash,
      approverId: 'foreign-user',
      approverRole: 'admin',
      approvedAt: '2026-10-01T00:00:00.000Z',
      scope: 'content+permissions',
    };
    writeFileSync(recordPathOf(ROLE), JSON.stringify(foreignRecord), 'utf8');

    const failure = expectFail(approveRolePack(approveInput({ expectedContentHash: contentHash })));
    expect(failure.code).toBe('E_APPROVAL_ORG_MISMATCH');
    expect(JSON.parse(readFileSync(recordPathOf(ROLE), 'utf8'))).toEqual(foreignRecord);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 · 撤销与幂等（D4；§10-L5「不 200 幂等」）
// ══════════════════════════════════════════════════════════════════════════════

describe('J4 · 撤销与幂等', () => {
  it('J4 撤销成功：记录文件删除，回传被删记录（含 approvalId）供路由层记 oldValue', () => {
    makeRole(ROLE);
    const approved = expectOk(approveRolePack(approveInput()));
    expect(existsSync(recordPathOf(ROLE))).toBe(true);

    const revoked = expectOk(revokeRolePack({ roleId: ROLE, approvalsRoot, orgId: ORG, actor: ACTOR, now: FIXED_NOW }));
    expect(revoked.unchanged).toBe(false);
    expect(revoked.record).toEqual(approved.record);
    expect(existsSync(recordPathOf(ROLE))).toBe(false);
    expect(readdirSync(approvalsRoot)).toHaveLength(0);
  });

  it('J4 再撤销 ⇒ E_APPROVAL_NOT_FOUND（404，不返回 200 幂等）', () => {
    makeRole(ROLE);
    expectOk(approveRolePack(approveInput()));
    expectOk(revokeRolePack({ roleId: ROLE, approvalsRoot, orgId: ORG, actor: ACTOR }));

    const failure = expectFail(revokeRolePack({ roleId: ROLE, approvalsRoot, orgId: ORG, actor: ACTOR }));
    expect(failure.code).toBe('E_APPROVAL_NOT_FOUND');
    expect(failure.reason).toContain('无审批记录');
  });

  it('J4 撤销时记录 org 不符 ⇒ E_APPROVAL_ORG_MISMATCH（403）且记录仍在', () => {
    makeRole(ROLE);
    expectOk(approveRolePack(approveInput()));
    const before = readFileSync(recordPathOf(ROLE), 'utf8');

    const failure = expectFail(
      revokeRolePack({ roleId: ROLE, approvalsRoot, orgId: OTHER_ORG, actor: ACTOR }),
    );
    expect(failure.code).toBe('E_APPROVAL_ORG_MISMATCH');
    expect(readFileSync(recordPathOf(ROLE), 'utf8')).toBe(before);
  });

  it('J4 记录损坏时撤销 ⇒ E_APPROVAL_IO（500，不盲删、不猜 org）', () => {
    makeRole(ROLE);
    mkdirSync(approvalsRoot, { recursive: true });
    writeFileSync(recordPathOf(ROLE), '{"schemaVersion":1,', 'utf8');

    const failure = expectFail(revokeRolePack({ roleId: ROLE, approvalsRoot, orgId: ORG, actor: ACTOR }));
    expect(failure.code).toBe('E_APPROVAL_IO');
    expect(hasLog('error', 'E_APPROVAL_IO')).toBe(true);
    expect(existsSync(recordPathOf(ROLE))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C2 · 边界、回滚开关与模块边界（§4.5-C2；D6/D10）
// ══════════════════════════════════════════════════════════════════════════════

describe('C2 · 边界与回滚', () => {
  it('C2 SYNOVA_APPROVAL_WRITE=off ⇒ 写与撤都 E_APPROVAL_WRITE_DISABLED（503），无写入', () => {
    makeRole(ROLE);
    expectOk(approveRolePack(approveInput()));
    const before = readFileSync(recordPathOf(ROLE), 'utf8');

    process.env[SWITCH_ENV] = 'off';
    expect(expectFail(approveRolePack(approveInput({ scope: 'content' }))).code).toBe(
      'E_APPROVAL_WRITE_DISABLED',
    );
    expect(expectFail(revokeRolePack({ roleId: ROLE, approvalsRoot, orgId: ORG, actor: ACTOR })).code).toBe(
      'E_APPROVAL_WRITE_DISABLED',
    );
    expect(readFileSync(recordPathOf(ROLE), 'utf8')).toBe(before);
    expect(existsSync(tmpPathOf(ROLE))).toBe(false);
  });

  it('C2 大小写/空白容忍：SYNOVA_APPROVAL_WRITE=" OFF " 也视为关闭；"on" 视为开启', () => {
    makeRole(ROLE);
    process.env[SWITCH_ENV] = ' OFF ';
    expect(expectFail(approveRolePack(approveInput())).code).toBe('E_APPROVAL_WRITE_DISABLED');

    process.env[SWITCH_ENV] = 'on';
    expectOk(approveRolePack(approveInput()));
    expect(existsSync(recordPathOf(ROLE))).toBe(true);
  });

  it('C2 记录超过 8 KiB（actor.id 超长）⇒ E_APPROVAL_IO，无写入', () => {
    makeRole(ROLE);
    const failure = expectFail(
      approveRolePack(approveInput({ actor: { id: 'x'.repeat(9000), role: 'admin' } })),
    );
    expect(failure.code).toBe('E_APPROVAL_IO');
    expect(failure.reason).toContain('超长');
    expect(hasLog('error', 'E_APPROVAL_IO')).toBe(true);
    expect(existsSync(recordPathOf(ROLE))).toBe(false);
  });

  it('C2 写盘失败（审批根位置是普通文件）⇒ E_APPROVAL_IO ＋ log.error(degraded:true)', () => {
    makeRole(ROLE);
    mkdirSync(join(tmpRoot, '.synova'), { recursive: true });
    writeFileSync(approvalsRoot, 'not a directory', 'utf8');

    const failure = expectFail(approveRolePack(approveInput()));
    expect(failure.code).toBe('E_APPROVAL_IO');
    expect(hasLog('error', 'E_APPROVAL_IO')).toBe(true);
    const errorCall = logCalls.find(
      (call) => call.level === 'error' && JSON.stringify(call.meta ?? {}).includes('E_APPROVAL_IO'),
    );
    expect(errorCall).toBeDefined();
    expect(JSON.stringify(errorCall?.meta ?? {})).toContain('"degraded":true');
  });

  it('C2 actor 为空 / now 非法 ⇒ E_APPROVAL_IO（写不出读路径可读的记录）', () => {
    makeRole(ROLE);
    expect(expectFail(approveRolePack(approveInput({ actor: { id: '', role: 'admin' } }))).code).toBe(
      'E_APPROVAL_IO',
    );
    expect(expectFail(approveRolePack(approveInput({ actor: { id: 'u', role: '' } }))).code).toBe(
      'E_APPROVAL_IO',
    );
    expect(expectFail(approveRolePack(approveInput({ now: new Date('not-a-date') }))).code).toBe(
      'E_APPROVAL_IO',
    );
    expect(existsSync(approvalsRoot)).toBe(false);
  });

  it('C2 损坏的记录 ⇒ 批准覆盖修复（log.warn 留痕，不静默）', () => {
    makeRole(ROLE);
    mkdirSync(approvalsRoot, { recursive: true });
    writeFileSync(recordPathOf(ROLE), 'not json at all', 'utf8');

    const result = expectOk(approveRolePack(approveInput()));
    expect(result.unchanged).toBe(false);
    expect(hasLog('warn', 'E_APPROVAL_INVALID')).toBe(true);
    expect(readRecordRaw(ROLE)['schemaVersion']).toBe(1);
    expect(readApprovalRecord(ROLE, { approvalsRoot }).ok).toBe(true);
  });

  it('C2 resolveApprovalsRoot(contentRoot) 与 loader 判定根同值（内容根 ../.. ＋ .synova/approvals）', () => {
    makeRole(ROLE);
    const loaderHook = resolveApprovalsRoot(contentRoot);
    expect(loaderHook).toBe(approvalsRoot);
    expect(loaderHook).toBe(join(tmpRoot, '.synova', 'approvals'));
    expect(loaderHook).toBe(resolve(join(contentRoot, '..', '..'), '.synova', 'approvals'));
    // 生产用法：写入根由内容根派生 ⇒ 与读路径（preset-loader）同源
    expectOk(approveRolePack(approveInput({ approvalsRoot: loaderHook })));
    expect(existsSync(recordPathOf(ROLE))).toBe(true);
  });

  it('C2 模块边界：写入器不 import AuditService／src/l4（审计归路由层，铁律 39 ＋ D6）', () => {
    const source = readFileSync(new URL('../../src/init/role-pack-approval-write.ts', import.meta.url), 'utf8');
    // 只断言 **import 面**（注释里可以点名"审计归路由层"——那不是接线）
    expect(source).not.toMatch(/from\s+['"][^'"]*audit-service/);
    expect(source).not.toMatch(/from\s+['"][^'"]*\/l4\//);
    expect(source).not.toMatch(/^import[^\n]*AuditService/m);
    // 反向：审计 action 字面量不出现（写入器只产 typed 结果，审计归路由层）
    expect(source).not.toContain('role_pack.approved');
  });
});
