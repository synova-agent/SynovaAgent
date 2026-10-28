/**
 * tests/init/role-pack-approval.test.ts — 岗位包审批门判据（#1075 P2-1：J2–J8 ＋ §4.5-C2 边界）
 *
 * 断言对象 = **生产路径**（`src/init/role-pack-approval.ts` 的 `readApprovalRecord()`／
 *   `judgeRolePackApproval()`；J2 另断 `src/init/role-pack-schema.ts` 的 `computeRolePackContentHash()`）——
 *   禁 grep 当验收（规格 §4 V-02）。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J2 内容指纹（raw bytes）：三包 contentHash **逐字**等于独立脚本产出的三字面量；改一字节／改五件任一／
 *      改 manifest `displayName`／**重排 JSON 空白（语义相同）** ⇒ hash 必变（钉死"raw bytes、非 canonical"）。
 *   J3 无记录＝pending（不生效）：pending ＋ code ＋ `log.info`；审批目录不存在（ENOENT）仍 pending；
 *      记录 contentHash 全 0 ⇒ `E_APPROVAL_CONTENT_CHANGED`；自洽记录 ＋ 匹配 ⇒ approved。
 *   J4 租户字段：记录 orgId 不符 ⇒ `E_APPROVAL_ORG_MISMATCH`；租户体检**先于**自绑定；同记录在匹配实例通过。
 *   J5 串岗/身份换牌：记录拷到别的岗位键 ⇒ `E_APPROVAL_ROLE_MISMATCH`；身份体检**先于**自绑定；无记录的换岗名 ⇒ pending。
 *   J6 自绑定（单字段篡改）＋权限粒度：只改 scope／approverRole／approvedAt／approverId ⇒ `E_APPROVAL_ID_MISMATCH`；
 *      scope 缺省按 content；`permissionsPending` 三态。
 *   J7 出厂锚优先：锚不符 ⇒ `E_FACTORY_ANCHOR_MISMATCH`；**改内容＋写完全匹配的记录 ⇒ 仍锚不符 ＋ `log.warn`**；
 *      锚命中 ⇒ approved（scope/permissionsPending 来自锚）；锚查找**不走原型链**。
 *   J8 fail-closed 边界：非普通文件（目录／**FIFO**／**符号链接**）⇒ `E_APPROVAL_INVALID`；8193 B ⇒ INVALID、
 *      **恰 8192 B 放行**；审批目录不可读（**chmod `0o111`**：有 x 无 r ⇒ 必须先探审批根 `R_OK`，
 *      否则按名 lstat 仍成功会误判成 pending）／记录文件不可读 ⇒ 非出厂 unverified（`log.error` 带 code）、
 *      出厂不受影响（只信代码锚）。
 *   C2 记录形状边界：JSON 坏／schemaVersion≠1／缺字段／contentHash 非 64 hex／空文件／非对象／roleId 含路径分隔符。
 *
 * 🔴 期望值来源（gate-A B11）：J2 的三行 hex 由**独立 python 脚本**（hashlib 直读文件字节，
 *   `/tmp/rp-p2-fingerprints.txt`）产出后**硬编码**进本文件；**禁**用被测实现生成期望值（同源自证）。
 *   同理，记录的 `approvalId` 自绑定由本文件**独立实现** `digestOf()` 计算（不调生产函数）——
 *   生产实现写错 ⇒ 本文件必红。
 *
 * 隔离手法：不落仓 —— 每个用例在 `mkdtempSync` 临时根造 `.synova/approvals/<roleId>.json`；
 *   **禁写真仓 `.synova/`**；用后 `rmSync` 清理（chmod 用例先恢复权限再删，见 `trackMode()`）。
 *
 * 环境前提：`id -u ≠ 0`（J8 的 chmod 判据依赖；root 下 `chmod` 不产生 `EACCES` ⇒ 相关用例 `skipIf` 并在用例名说明）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FACTORY_APPROVALS,
  judgeRolePackApproval,
  readApprovalRecord,
} from '../../src/init/role-pack-approval';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（G2 判据：pending=log.info／unverified=log.error／出厂有记录=log.warn）
// 范式同 tests/init/role-pack-schema.test.ts 与 tests/l4/ontology-loader-param-bridge-1031.test.ts:41-49
// ══════════════════════════════════════════════════════════════════════════════

const logCalls = vi.hoisted(() => [] as { level: string; meta?: unknown; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const make = (level: string) => (meta?: unknown, msg?: unknown) => {
    logCalls.push({ level, meta, msg });
  };
  const m = { info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug'), fatal: make('fatal') };
  return { logger: m, createLogger: () => m };
});

// ══════════════════════════════════════════════════════════════════════════════
// 常量与夹具（本文件自足；不引第二套判定实现）
// ══════════════════════════════════════════════════════════════════════════════

const REPO_ROOT = resolve(__dirname, '../..');
const ROLES_ROOT = join(REPO_ROOT, 'extensions', 'presets', 'roles');

/**
 * 六件顺序（规格 §5-⑤ 的 PIECES；本文件**独立声明**，不引被测实现的清单 ——
 * 若生产侧顺序漂移，J2 三字面量必红，属信号正确）。
 */
const PIECE_ORDER = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/**
 * 🔴 J2 期望值（**独立 python 脚本产出**；禁自证 —— gate-A B11）。
 * 由 verifier 的 hashlib 直读脚本对迁移到 v3 后的三包字节产出（`/tmp/rp-p2-fingerprints.txt`，正式值）；
 * 与产品侧 `computeRolePackContentHash()` 的输出**跨实现一致**（verifier 独立核过）。
 * 与 `FACTORY_APPROVALS` 的三行字面量同源 ⇒ 改一包内容时两处必须同批改（L3）。
 */
const FINGERPRINTS: Readonly<Record<'finance' | 'hr' | 'sales', string>> = {
  finance: '9ddbffe2967c0be4a1ddc3d64efbbb35caa12450af46ff78b5ede0abab0cb783',
  hr: '167aba961881c994c25b44c2751835639b5b47f77b84ec793fd4179ae61bc390',
  sales: '27098076f67a2fbd0b866fd5205eb2485637cfd9e954d2bda7741984bf452839',
};

const ORG = 'default';
const OTHER_ORG = 'tenant-b';
const HASH_ALPHA = 'a'.repeat(64);
const HASH_BETA = 'b'.repeat(64);
const ZERO_HASH = '0'.repeat(64);
const FIXED_AT = '2026-10-28T12:00:00.000Z';
/** 非出厂夹具 roleId（临时根下造记录；不碰仓内 .synova/） */
const ROLE = 'ops-analyst';

const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const HAS_MKFIFO = spawnSync('sh', ['-c', 'command -v mkfifo']).status === 0;

type PieceBytes = { name: string; bytes: Buffer };

let tmpRoot = '';
let approvalsRoot = '';

/** chmod 用例登记恢复动作（清理前先恢复权限，否则 rmSync 进不去） */
const restoreModes: { path: string; mode: number }[] = [];

function trackMode(path: string, mode: number): void {
  restoreModes.push({ path, mode });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rp-approval-'));
  approvalsRoot = join(tmpRoot, '.synova', 'approvals');
  mkdirSync(approvalsRoot, { recursive: true });
  logCalls.length = 0;
});

afterEach(() => {
  for (const { path, mode } of restoreModes.splice(0)) {
    try {
      chmodSync(path, mode);
    } catch {
      // 用例已删除该路径 / 权限本就恢复 —— 清理阶段可忽略（不外抛，避免掩盖真正的用例失败）
    }
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── 记录构造（自绑定由**本文件独立实现** —— 生产实现写错必红）────────────────

type DigestFields = {
  readonly roleId: string;
  readonly orgId: string;
  readonly contentHash: string;
  readonly scope: 'content' | 'content+permissions';
  readonly approvedAt: string;
  readonly approverId: string;
  readonly approverRole: string;
};

/** D9 自绑定的测试侧独立实现（不引生产函数） */
function digestOf(fields: DigestFields): string {
  const material = [
    fields.orgId,
    fields.roleId,
    fields.contentHash,
    fields.scope,
    fields.approvedAt,
    fields.approverId,
    fields.approverRole,
  ].join('|');
  return `apv1:${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)}`;
}

/** 自洽记录：`approvalId` 由字段算出 ⇒ 不改任何字段时应通过自绑定复算。 */
function selfBound(roleId: string, patch: Partial<DigestFields> = {}): Record<string, unknown> {
  const fields: DigestFields = {
    roleId,
    orgId: ORG,
    contentHash: HASH_ALPHA,
    scope: 'content+permissions',
    approvedAt: FIXED_AT,
    approverId: 'u_123',
    approverRole: 'super-admin',
    ...patch,
  };
  return { schemaVersion: 1, ...fields, approvalId: digestOf(fields) };
}

/** 自洽之后再**单字段篡改**（`approvalId` 保持原签 ⇒ 模拟 J6 的单字段篡改）。 */
function tamperedAfterBinding(roleId: string, patch: Partial<DigestFields>): Record<string, unknown> {
  return { ...selfBound(roleId), ...patch };
}

/** 写记录（对象 ⇒ JSON 序列化；字符串 ⇒ 原样写，用于 JSON 坏/空格填充用例）。 */
function writeRecord(roleId: string, record: unknown, root: string = approvalsRoot): string {
  const file = join(root, `${roleId}.json`);
  writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record), 'utf8');
  return file;
}

/** `judgeRolePackApproval()` 的薄包装（默认夹具根＋orgId；`hasToolDeclarations` 默认 false）。 */
function judgeRole(
  roleId: string,
  contentHash: string,
  extra: { hasToolDeclarations?: boolean; orgId?: string; approvalsRoot?: string } = {},
): ReturnType<typeof judgeRolePackApproval> {
  return judgeRolePackApproval({
    roleId,
    contentHash,
    orgId: extra.orgId ?? ORG,
    approvalsRoot: extra.approvalsRoot ?? approvalsRoot,
    hasToolDeclarations: extra.hasToolDeclarations ?? false,
  });
}

/** 日志断言工具（`code` 缺省 ⇒ 只看级别）。 */
function logMetaCode(call: { meta?: unknown }): unknown {
  const meta = call.meta;
  if (typeof meta !== 'object' || meta === null || !('code' in meta)) return undefined;
  return (meta as { code?: unknown }).code;
}

function hasLog(level: string, code?: string): boolean {
  return logCalls.some((call) => call.level === level && (code === undefined || logMetaCode(call) === code));
}

// ── 内容指纹（J2）────────────────────────────────────────────────────────────

function piecesOf(role: 'finance' | 'hr' | 'sales'): PieceBytes[] {
  return PIECE_ORDER.map((name) => ({ name, bytes: readFileSync(join(ROLES_ROOT, role, name)) }));
}

function flipOneByte(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  copy[0] = copy[0] ^ 0x01;
  return copy;
}

/**
 * 调生产 `computeRolePackContentHash()`（**动态 import**：T1 落地前其余用例仍可跑；
 * 缺该导出 ⇒ 用例红并点名 T1 依赖）。
 */
async function productionHash(pieces: readonly PieceBytes[]): Promise<string> {
  const schema: { computeRolePackContentHash?: (input: readonly PieceBytes[]) => string } =
    await import('../../src/init/role-pack-schema');
  const compute = schema.computeRolePackContentHash;
  if (typeof compute !== 'function') {
    throw new Error('role-pack-schema 未导出 computeRolePackContentHash()（#1075 P2-1/T1 依赖未落地）');
  }
  return compute(pieces);
}

// ══════════════════════════════════════════════════════════════════════════════
// J2 · 内容指纹（六件 raw bytes；期望值＝独立脚本字面量）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2 · 内容指纹（raw bytes，独立期望值）', () => {
  for (const role of ['finance', 'hr', 'sales'] as const) {
    it(`J2 ${role} contentHash 逐字等于独立脚本产出的字面量`, async () => {
      expect(await productionHash(piecesOf(role))).toBe(FINGERPRINTS[role]);
    });
  }

  it('J2 五件内容任一字节变 ⇒ hash 变（逐件）', async () => {
    const original = piecesOf('finance');
    const base = await productionHash(original);
    for (const pieceName of PIECE_ORDER.filter((name) => name !== 'manifest.json')) {
      const mutated = original.map((piece) =>
        piece.name === pieceName ? { name: pieceName, bytes: flipOneByte(piece.bytes) } : piece,
      );
      expect(await productionHash(mutated)).not.toBe(base);
    }
  });

  it('J2 改 manifest displayName ⇒ hash 变（manifest 原始字节参与指纹）', async () => {
    const original = piecesOf('hr');
    const base = await productionHash(original);
    const manifestIndex = original.findIndex((piece) => piece.name === 'manifest.json');
    expect(manifestIndex).toBeGreaterThanOrEqual(0);
    const doc = JSON.parse(original[manifestIndex].bytes.toString('utf8')) as Record<string, unknown>;
    doc['displayName'] = `${String(doc['displayName'])}（已改）`;
    const mutated = [...original];
    mutated[manifestIndex] = { name: 'manifest.json', bytes: Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf8') };
    expect(await productionHash(mutated)).not.toBe(base);
  });

  it('J2 同一 manifest 重排 JSON 空白（语义相同、字节不同）⇒ hash 变（raw bytes，不做 canonical 化）', async () => {
    const original = piecesOf('sales');
    const base = await productionHash(original);
    const manifestIndex = original.findIndex((piece) => piece.name === 'manifest.json');
    expect(manifestIndex).toBeGreaterThanOrEqual(0);
    const originalBytes = original[manifestIndex].bytes;
    const reordered = Buffer.from(
      `${JSON.stringify(JSON.parse(originalBytes.toString('utf8')), null, 4)}\n`,
      'utf8',
    );
    // 反例前提：语义务必相同、字节务必不同 —— 否则本用例会退化成弱断言
    expect(reordered.equals(originalBytes)).toBe(false);
    expect(JSON.parse(reordered.toString('utf8'))).toEqual(JSON.parse(originalBytes.toString('utf8')));
    const mutated = [...original];
    mutated[manifestIndex] = { name: 'manifest.json', bytes: reordered };
    expect(await productionHash(mutated)).not.toBe(base);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 · 无记录 ＝ pending（不生效）
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 · 无记录＝pending（不生效）', () => {
  it('J3 无记录 ⇒ pending ＋ ROLE_PACK_APPROVAL_PENDING ＋ log.info（不透出 scope/approvalId）', () => {
    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('pending');
    expect(res.code).toBe('ROLE_PACK_APPROVAL_PENDING');
    expect(res.scope).toBeUndefined();
    expect(res.approvalId).toBeUndefined();
    expect(hasLog('info', 'ROLE_PACK_APPROVAL_PENDING')).toBe(true);
    // pending **不计 degraded**（§4.5-C1）：不得产出 log.error
    expect(hasLog('error')).toBe(false);
  });

  it('J3 审批目录根本不存在（ENOENT）⇒ 仍 pending（不是 unverified）', () => {
    const res = judgeRole(ROLE, HASH_ALPHA, { approvalsRoot: join(tmpRoot, 'no-such-approvals') });
    expect(res.status).toBe('pending');
    expect(res.code).toBe('ROLE_PACK_APPROVAL_PENDING');
  });

  it('J3 记录 contentHash 全 0（自绑定自洽）⇒ unverified(E_APPROVAL_CONTENT_CHANGED)', () => {
    writeRecord(ROLE, selfBound(ROLE, { contentHash: ZERO_HASH }));
    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_APPROVAL_CONTENT_CHANGED');
    expect(hasLog('error', 'E_APPROVAL_CONTENT_CHANGED')).toBe(true);
  });

  it('J3 自洽记录 ＋ hash 匹配 ⇒ approved（approvalId/scope 透出）', () => {
    const record = selfBound(ROLE, { contentHash: HASH_ALPHA });
    writeRecord(ROLE, record);
    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('approved');
    expect(res.approvalId).toBe(record['approvalId']);
    expect(res.scope).toBe('content+permissions');
    expect(res.permissionsPending).toBe(false);
    expect(hasLog('info')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 · 租户字段（orgId）
// ══════════════════════════════════════════════════════════════════════════════

describe('J4 · 租户字段（orgId）', () => {
  it('J4 记录 orgId=other ⇒ unverified(E_APPROVAL_ORG_MISMATCH)', () => {
    writeRecord(ROLE, selfBound(ROLE, { orgId: OTHER_ORG }));
    const res = judgeRole(ROLE, HASH_ALPHA); // 入参 orgId=default
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_APPROVAL_ORG_MISMATCH');
    expect(hasLog('error', 'E_APPROVAL_ORG_MISMATCH')).toBe(true);
  });

  it('J4 租户体检先于自绑定：改 orgId 且自绑定也不符 ⇒ 仍点名 ORG_MISMATCH（不是 ID_MISMATCH）', () => {
    writeRecord(ROLE, tamperedAfterBinding(ROLE, { orgId: OTHER_ORG })); // 原签按 default 算
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_ORG_MISMATCH');
  });

  it('J4 同一条记录在 orgId 匹配的实例上通过（字段级隔离，不是安全控制 —— L7）', () => {
    writeRecord(ROLE, selfBound(ROLE, { orgId: OTHER_ORG }));
    const res = judgeRole(ROLE, HASH_ALPHA, { orgId: OTHER_ORG });
    expect(res.status).toBe('approved');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J5 · 串岗 / 身份换牌
// ══════════════════════════════════════════════════════════════════════════════

describe('J5 · 串岗 / 身份换牌', () => {
  it('J5 把 finance 记录拷成别的岗位键（记录 roleId=finance，键=ops-analyst）⇒ unverified(E_APPROVAL_ROLE_MISMATCH)', () => {
    writeRecord(ROLE, selfBound('finance')); // 自洽，但 roleId 是 finance
    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_APPROVAL_ROLE_MISMATCH');
    expect(hasLog('error', 'E_APPROVAL_ROLE_MISMATCH')).toBe(true);
  });

  it('J5 身份体检先于自绑定：改 roleId 且自绑定也不符 ⇒ 仍点名 ROLE_MISMATCH（不是 ID_MISMATCH）', () => {
    writeRecord(ROLE, tamperedAfterBinding(ROLE, { roleId: 'hr' })); // 原签按 ops-analyst 算
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_ROLE_MISMATCH');
  });

  it('J5 换岗名（复制出厂内容到 roles/fake）⇒ 记录键 fake 无记录 ⇒ pending（不生效）', () => {
    // 绑定码（ROLE_PACK_ROLE_ID_MISMATCH）属 schema 侧（T1）；本文件只断判定侧"无记录 ⇒ pending"
    expect(judgeRole('fake', HASH_ALPHA).status).toBe('pending');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J6 · 记录自绑定（单字段篡改）＋ 权限粒度
// ══════════════════════════════════════════════════════════════════════════════

describe('J6 · 记录自绑定（单字段篡改）＋ permissionsPending', () => {
  it('J6 只把记录 scope 从 content 改 content+permissions（其余不动）⇒ unverified(E_APPROVAL_ID_MISMATCH)', () => {
    const signed = selfBound(ROLE, { scope: 'content' });
    writeRecord(ROLE, { ...signed, scope: 'content+permissions' }); // approvalId 仍是 content 的签名
    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_APPROVAL_ID_MISMATCH');
    expect(hasLog('error', 'E_APPROVAL_ID_MISMATCH')).toBe(true);
  });

  it('J6 只改 approverRole（其余不动）⇒ unverified(E_APPROVAL_ID_MISMATCH)（N7：approver 段入 digest）', () => {
    writeRecord(ROLE, tamperedAfterBinding(ROLE, { approverRole: 'employee' }));
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_ID_MISMATCH');
  });

  it('J6 只改 approvedAt／approverId ⇒ 逐字段 unverified(E_APPROVAL_ID_MISMATCH)', () => {
    const patches: Partial<DigestFields>[] = [
      { approvedAt: '2026-10-29T00:00:00.000Z' },
      { approverId: 'u_999' },
    ];
    for (const patch of patches) {
      writeRecord(ROLE, tamperedAfterBinding(ROLE, patch));
      expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_ID_MISMATCH');
    }
  });

  it('J6 记录缺 scope ⇒ 按 content（保守）且自绑定按 content 复算', () => {
    const fields = {
      roleId: ROLE,
      orgId: ORG,
      contentHash: HASH_ALPHA,
      approvedAt: FIXED_AT,
      approverId: 'u_123',
      approverRole: 'super-admin',
    };
    const record = { schemaVersion: 1, ...fields, approvalId: digestOf({ ...fields, scope: 'content' }) };
    writeRecord(ROLE, record);
    const res = judgeRole(ROLE, HASH_ALPHA, { hasToolDeclarations: true });
    expect(res.status).toBe('approved');
    expect(res.scope).toBe('content');
    expect(res.permissionsPending).toBe(true);
  });

  it('J6 permissionsPending：content+permissions ⇒ false；content＋声明 tools ⇒ true；content＋无 tools ⇒ false', () => {
    writeRecord(ROLE, selfBound(ROLE, { scope: 'content+permissions' }));
    expect(judgeRole(ROLE, HASH_ALPHA, { hasToolDeclarations: true }).permissionsPending).toBe(false);

    writeRecord(ROLE, selfBound(ROLE, { scope: 'content' }));
    expect(judgeRole(ROLE, HASH_ALPHA, { hasToolDeclarations: true }).permissionsPending).toBe(true);
    expect(judgeRole(ROLE, HASH_ALPHA, { hasToolDeclarations: false }).permissionsPending).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J7 · 出厂锚优先（记录不得覆盖）
// ══════════════════════════════════════════════════════════════════════════════

describe('J7 · 出厂锚优先（记录不得覆盖）', () => {
  it('J7 出厂 finance 内容与锚不符 ⇒ unverified(E_FACTORY_ANCHOR_MISMATCH) ＋ log.error', () => {
    const res = judgeRole('finance', HASH_BETA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_FACTORY_ANCHOR_MISMATCH');
    expect(hasLog('error', 'E_FACTORY_ANCHOR_MISMATCH')).toBe(true);
  });

  it('J7 改出厂内容＋写一条 hash 完全匹配的记录 ⇒ 仍 FACTORY_ANCHOR_MISMATCH ＋ log.warn（记录被忽略）', () => {
    // 记录与"实测 hash"完全一致且自绑定自洽 ⇒ 若记录能覆盖锚，本例会 approved（正是要杀的那条路）
    writeRecord('finance', selfBound('finance', { contentHash: HASH_BETA }));
    const res = judgeRole('finance', HASH_BETA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_FACTORY_ANCHOR_MISMATCH');
    expect(hasLog('warn')).toBe(true);
  });

  it('J7 出厂三包锚命中 ⇒ approved（scope=锚 scope／approvalId=factory:<role>:v1／permissionsPending=false）', () => {
    for (const role of ['finance', 'hr', 'sales'] as const) {
      // 锚常量与 J2 独立字面量**同源**（改出厂内容须两处同批改 —— L3）
      expect(FACTORY_APPROVALS[role].contentHash).toBe(FINGERPRINTS[role]);
      const res = judgeRole(role, FINGERPRINTS[role], { hasToolDeclarations: true });
      expect(res.status).toBe('approved');
      expect(res.approvalId).toBe(`factory:${role}:v1`);
      expect(res.scope).toBe('content+permissions');
      expect(res.permissionsPending).toBe(false);
      // 记录**不是**批准的必需品（无记录也批准 —— §1.2-6）
      expect(readApprovalRecord(role, { approvalsRoot }).ok).toBe(false);
    }
  });

  it('J7 出厂锚查找不走原型链（roleId=constructor／toString／__proto__ 不命中锚 ⇒ pending）', () => {
    for (const roleId of ['constructor', 'toString', '__proto__']) {
      const res = judgeRole(roleId, HASH_ALPHA);
      expect(res.status).toBe('pending'); // 若误命中锚，会走 factory 分支得到 unverified(E_FACTORY_ANCHOR_MISMATCH)
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J8 · fail-closed 边界（记录类型/大小／审批目录不可读）
// ══════════════════════════════════════════════════════════════════════════════

describe('J8 · fail-closed 边界', () => {
  it('J8 记录是目录 ⇒ E_APPROVAL_INVALID（非普通文件）', () => {
    mkdirSync(join(approvalsRoot, `${ROLE}.json`), { recursive: true });
    const read = readApprovalRecord(ROLE, { approvalsRoot });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('E_APPROVAL_INVALID');
    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_APPROVAL_INVALID');
    expect(hasLog('error', 'E_APPROVAL_INVALID')).toBe(true);
  });

  it.skipIf(!HAS_MKFIFO)('J8 记录是 FIFO ⇒ E_APPROVAL_INVALID（lstat 判类型，不阻塞打开）', () => {
    const fifoPath = join(approvalsRoot, `${ROLE}.json`);
    expect(spawnSync('mkfifo', [fifoPath]).status).toBe(0);
    const read = readApprovalRecord(ROLE, { approvalsRoot });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('E_APPROVAL_INVALID');
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('J8 记录是符号链接（指向一条合法记录）⇒ E_APPROVAL_INVALID（lstat 不跟随；若跟随会得到 ROLE_MISMATCH）', () => {
    const target = writeRecord('finance', selfBound('finance'));
    symlinkSync(target, join(approvalsRoot, `${ROLE}.json`));
    const read = readApprovalRecord(ROLE, { approvalsRoot });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('E_APPROVAL_INVALID');
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('J8 记录 8193 B ⇒ E_APPROVAL_INVALID；恰 8192 B ⇒ 放行（尺寸边界）', () => {
    const json = JSON.stringify(selfBound(ROLE));
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThan(8192);
    const padTo = (size: number): string => json + ' '.repeat(size - Buffer.byteLength(json, 'utf8'));

    writeRecord(ROLE, padTo(8192));
    expect(readApprovalRecord(ROLE, { approvalsRoot }).ok).toBe(true);
    expect(judgeRole(ROLE, HASH_ALPHA).status).toBe('approved');

    writeRecord(ROLE, padTo(8193));
    const read = readApprovalRecord(ROLE, { approvalsRoot });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('E_APPROVAL_INVALID');
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it.skipIf(IS_ROOT)('J8 审批目录不可读（chmod 0o111：有 x 无 r）⇒ 非出厂 unverified ＋ log.error；出厂仍 approved（需 id -u≠0）', () => {
    // §10-L11：root 下 chmod 不产生 EACCES ⇒ 本用例 skipIf(IS_ROOT)（用例名已说明）
    expect(typeof process.getuid === 'function' ? process.getuid() : -1).not.toBe(0);
    writeRecord(ROLE, selfBound(ROLE));
    trackMode(approvalsRoot, 0o755);
    chmodSync(approvalsRoot, 0o111);

    // 反例前提（POSIX 实测）：0o111 下**按名** lstat 仍成功 ⇒ 实现若只判记录文件会把
    // "目录不可读"误判成"无记录 ⇒ pending"（fail-open 方向错误）⇒ 必须先探审批根 R_OK。
    expect(() => lstatSync(join(approvalsRoot, `${ROLE}.json`))).not.toThrow();

    const res = judgeRole(ROLE, HASH_ALPHA);
    expect(res.status).toBe('unverified');
    expect(res.code).toBe('E_APPROVAL_INVALID');
    expect(res.reason).toContain('EACCES');
    expect(hasLog('error', 'E_APPROVAL_INVALID')).toBe(true);

    // 🆕 出厂三包不受审批目录影响（只信代码锚）；记录不可读只留 log.warn
    const factory = judgeRole('finance', FINGERPRINTS.finance);
    expect(factory.status).toBe('approved');
    expect(hasLog('warn')).toBe(true);
  });

  it.skipIf(IS_ROOT)('J8 记录文件不可读（chmod 0o000）⇒ E_APPROVAL_INVALID（需 id -u≠0）', () => {
    expect(typeof process.getuid === 'function' ? process.getuid() : -1).not.toBe(0);
    const file = writeRecord(ROLE, selfBound(ROLE));
    trackMode(file, 0o644);
    chmodSync(file, 0o000);

    const read = readApprovalRecord(ROLE, { approvalsRoot });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe('E_APPROVAL_INVALID');
      expect(read.reason).toContain('EACCES');
    }
    expect(judgeRole(ROLE, HASH_ALPHA).status).toBe('unverified');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C2 · 记录形状边界（§4.5-C2；空/临界/超限/异常）
// ══════════════════════════════════════════════════════════════════════════════

describe('C2 · 记录形状边界', () => {
  it('C2 记录 JSON 坏 ⇒ E_APPROVAL_INVALID（不是 pending）', () => {
    writeRecord(ROLE, '{"schemaVersion":1,');
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('C2 空文件（0 B）⇒ E_APPROVAL_INVALID（不是 pending）', () => {
    writeRecord(ROLE, '');
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('C2 记录不是对象（数组）⇒ E_APPROVAL_INVALID', () => {
    writeRecord(ROLE, [selfBound(ROLE)]);
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('C2 schemaVersion=2 ⇒ E_APPROVAL_INVALID（只认 1，不猜版本）', () => {
    writeRecord(ROLE, { ...selfBound(ROLE), schemaVersion: 2 });
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('C2 缺 approvalId ⇒ E_APPROVAL_INVALID（点名该字段）', () => {
    const record = selfBound(ROLE);
    delete record['approvalId'];
    writeRecord(ROLE, record);
    const read = readApprovalRecord(ROLE, { approvalsRoot });
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe('E_APPROVAL_INVALID');
      expect(read.reason).toContain('approvalId');
    }
  });

  it('C2 记录 contentHash 65 hex／非 hex ⇒ E_APPROVAL_INVALID（≤/超/异常三态）', () => {
    for (const badHash of ['a'.repeat(65), 'A'.repeat(64), 'zz'.repeat(32)]) {
      writeRecord(ROLE, { ...selfBound(ROLE), contentHash: badHash });
      const read = readApprovalRecord(ROLE, { approvalsRoot });
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.code).toBe('E_APPROVAL_INVALID');
    }
  });

  it('C2 记录 scope 非法值 ⇒ E_APPROVAL_INVALID', () => {
    writeRecord(ROLE, { ...selfBound(ROLE), scope: 'everything' });
    expect(judgeRole(ROLE, HASH_ALPHA).code).toBe('E_APPROVAL_INVALID');
  });

  it('C2 roleId 含路径分隔符／为 .. ⇒ E_APPROVAL_INVALID（防逃出 approvalsRoot）', () => {
    for (const badRoleId of ['../finance', 'a/b', '..', '']) {
      const read = readApprovalRecord(badRoleId, { approvalsRoot });
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.code).toBe('E_APPROVAL_INVALID');
    }
  });
});
