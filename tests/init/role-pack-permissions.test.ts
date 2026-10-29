/**
 * tests/init/role-pack-permissions.test.ts — 岗位包「工具与权限」编译判据（#1075 P2-4a）
 *
 * 断言对象 = **生产路径**（`src/init/role-pack-permissions.ts` 的 `loadRolePackPermissions()`）——
 *   禁 grep 当验收（规格 §4 V-02）。夹具六件过 P2-1 的 v3 校验（结构/refs/pieces 对账全部真跑，
 *   本文件不伪造 `RolePack` 对象），审批记录走 P2-1 的 `judgeRolePackApproval()` 路径；
 *   **不 mock 被测模块**、不 mock 生产纯核（指纹用 `computeRolePackContentHash()` 现算真值）。
 *
 * 判据分组（与规格 §2.3-A/B、§4 J1/J2/J4/J5、§4.5-C2、§10 逐条对齐）:
 *   J1 审批 scope 两态：`content+permissions` ⇒ `allowlist = 声明 ∩ known`（保声明序）；
 *      `content` ＋ 声明了 `tool` ⇒ `permissionsPending === true` ⇒ `allowlist = []`（全拒）＋ "权限待批" warn；
 *      `content` ＋ 无 `tool` 声明 ⇒ `permissionsPending === false`（P2-1 口径）且 `allowlist = []` 合法。
 *   J2 分类语义：未声明的已注册工具**不进** allowlist；声明但未注册 ⇒ `declaredUnavailable`（可见）；
 *      重复 `tool` 去重；`knownTools` 缺省／空数组 ⇒ 全 `declaredUnavailable`、allowlist 空。
 *   J4 声明未落地可见：出厂 `finance` **真包只读** ⇒ `declaredUnavailable` 含三条 `analysis.*`、allowlist=0、
 *      `disabled = ['capability.evolution-write']`、**不抛错**、留一条点名 warn。
 *   J5 自校验／撤销：改临时包内容不改审批 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`（P2-1 审批门子案映射，②a）；
 *      删审批记录 ⇒ `E_ROLE_PACK_NOT_APPROVED`；反向对照（改内容后同步更新记录 ⇒ 重新可用）。
 *   C2 边界：capabilities 0 条合法；64 过／65 拒；tool 名 120 过／121 拒；capabilities.yaml 64 KiB 过／+1 拒
 *      （未进入解析）；同 `tool` 既 `enabled` 又 `enabled:false` ⇒ **disabled 优先**；非法形状与重复键 ⇒ 同码。
 *   ＋ ① `E_ROLE_PACK_NOT_FOUND`；G2 每个失败码必有一条 `log.warn({roleId, code, reason, degraded:true})`。
 *
 * 🔴 期望值来源：错误码／限额阈值／分类结果全部**字面量硬编码**（规格 §4.5-C1／§4.5-C2／§2.3-B 逐字）；
 *   夹具侧的 `contentHash` 用生产纯核现算真值（它不是断言期望值，而是"给审批记录填一个正确指纹"的
 *   唯一可靠办法 —— 手写 hex 必撞 `E_ROLE_PACK_CONTENT_CHANGED`）。
 *
 * 隔离手法：不落仓 —— 每个用例在 `mkdtempSync` 造**仓库形状**临时根
 *   `<fixture>/extensions/presets/roles/<id>/` 六件 ＋ `<fixture>/.synova/approvals/<id>.json`，
 *   `SYNOVA_PRESETS_ROOT` 指向内容根（生产同规则：审批根 = 内容根 `../..`）。**禁写真仓／禁写三包**。
 *   角色 id 一律用**非出厂** id `ops`（出厂三包只信代码锚，记录覆盖不了锚 —— P2-1 KL-P2-6）；
 *   唯一的出厂包用例（J4 finance）**只读**真内容根（`delete SYNOVA_PRESETS_ROOT`）。
 *
 * 环境前提：`SYNOVA_ORG_ID` 不设 ⇒ 审批租户 `default`（夹具记录的 `orgId` 与之同值）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadRolePackPermissions,
  type RolePackPermissionsCode,
  type RolePackToolPermissions,
} from '../../src/init/role-pack-permissions';
import { clearPresetCache } from '../../src/init/preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（G2 判据：每个失败码必有一条 log.warn；三种"空"各留一条 warn）
// 范式同 tests/init/role-pack-persona.test.ts
// ══════════════════════════════════════════════════════════════════════════════

const logCalls = vi.hoisted(() => [] as { level: string; meta?: Record<string, unknown>; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const make = (level: string) => (meta?: Record<string, unknown>, msg?: unknown) => {
    logCalls.push({ level, meta, msg });
  };
  const m = {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    fatal: make('fatal'),
  };
  return { logger: m, createLogger: () => m };
});

// ══════════════════════════════════════════════════════════════════════════════
// 常量（本文件独立声明；与规格 §2.3／§4.5-C2 同值）
// ══════════════════════════════════════════════════════════════════════════════

/** 六件（**顺序即契约顺序**；本文件独立声明 —— 生产侧漂移由本文件的写入/断言显形） */
const PIECES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/** 夹具角色 id：**非出厂**（出厂 finance/hr/sales 只信代码锚） */
const ROLE_ID = 'ops';

/** 出厂包（J4 只读面） */
const FACTORY_ROLE_ID = 'finance';

/** 注入的"已注册工具"清单（= engine 侧 `ToolRegistry.allToolNames()` 的替身，规格 §2.2-B5） */
const KNOWN_TOOLS = ['query_ontology', 'read_document', 'collect_cost_data'] as const;

/** 64 KiB（`capabilities.yaml` 读入上限；规格 §4.5-C2） */
const CAPABILITIES_MAX_BYTES = 64 * 1024;

/** 审批记录的时间/身份/租户字段（自绑定口径见 P2-1 §2.2-D9） */
const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_p24a_perms_fixture';
const APPROVER_ROLE = 'super-admin';
const APPROVAL_ORG_ID = 'default';

/** 一个 `capabilities[]` 条目（`label` 只为人读，被测模块不判 —— KL-5） */
interface CapabilityRow {
  readonly id: string;
  readonly tool?: string;
  readonly enabled?: boolean;
  readonly disabledReason?: string;
}

/** 缺省条目：2 项已注册工具 ＋ 1 项声明未落地（`analysis.variance` 全仓 0 注册 —— 规格 §〇.4） */
const DEFAULT_CAPABILITIES: readonly CapabilityRow[] = [
  { id: 'capability.ontology-query', tool: 'query_ontology', enabled: true },
  { id: 'capability.doc-read', tool: 'read_document', enabled: true },
  { id: 'capability.financial-variance', tool: 'analysis.variance', enabled: true },
];

// ══════════════════════════════════════════════════════════════════════════════
// 夹具构造器（仓库形状临时根；每个用例一个）
// ══════════════════════════════════════════════════════════════════════════════

let fixture: string;
let root: string;
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];

/** 内容根：`<fixture>/extensions/presets`（= `SYNOVA_PRESETS_ROOT`） */
function rolesRoot(): string {
  return join(root, 'roles');
}

/** 审批根（生产同规则）：内容根 `../..` ⇒ `<fixture>/.synova/approvals` */
function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

/** 渲染 `capabilities.yaml`（`[]` 渲染成 `capabilities: []` —— C2 的"0 条"合法形态） */
function capabilitiesYaml(roleId: string, rows: readonly CapabilityRow[]): string {
  const lines: string[] = [`roleId: ${roleId}`, 'version: 2'];
  if (rows.length === 0) {
    lines.push('capabilities: []');
    return `${lines.join('\n')}\n`;
  }
  lines.push('capabilities:');
  for (const row of rows) {
    lines.push(`  - id: ${row.id}`, `    label: ${row.id}`);
    if (row.tool !== undefined) lines.push(`    tool: ${row.tool}`);
    lines.push(`    enabled: ${row.enabled === false ? 'false' : 'true'}`);
    if (row.disabledReason !== undefined) lines.push(`    disabledReason: ${row.disabledReason}`);
  }
  return `${lines.join('\n')}\n`;
}

/** 最小合法 **v3** manifest（refs 与 `context-manifest.yaml` 的 `contexts[].source` 对账一致） */
function manifestJson(roleId: string): Record<string, unknown> {
  return {
    $schema: '../../schema/role-pack-v3.schema.json',
    schemaVersion: 3,
    name: `role-${roleId}`,
    version: '2.0.0',
    type: 'role-preset',
    displayName: roleId,
    entryPoint: './context-manifest.yaml',
    roleId,
    pieces: [...PIECES],
    refs: [{ kind: 'scope', name: `${roleId}.demo` }],
  };
}

/** 五件内容件的缺省载荷（`knowledge-scope.yaml` 声明 `contexts[].source` 指向的 scope） */
function defaultPieceFiles(roleId: string, capabilitiesSource: string): Record<string, string> {
  return {
    'knowledge-scope.yaml': `roleId: ${roleId}\nversion: 2\nscopes:\n  - id: ${roleId}.demo\n`,
    'context-manifest.yaml':
      `roleId: ${roleId}\nversion: 2\n` +
      `contexts:\n  - id: ${roleId}.demo\n    label: 口径\n    source: knowledge-scope.yaml#${roleId}.demo\n` +
      '    why: 判断必须同口径\n    required: true\n',
    'output-template.ref': 'templateId: demo\nsections:\n  - id: summary\n    title: 摘要\n    must:\n      - 有结论\n',
    'capabilities.yaml': capabilitiesSource,
    'acceptance-criteria.yaml': `roleId: ${roleId}\nversion: 2\ncriteria:\n  - id: ac.demo\n    text: demo\n`,
  };
}

/** 造一个齐备的角色包目录（`files` 覆盖单件；`capabilitiesSource` 覆盖 capabilities.yaml） */
function writeRole(
  options: { readonly roleId?: string; readonly files?: Readonly<Record<string, string>> } = {},
): string {
  const roleId = options.roleId ?? ROLE_ID;
  const dir = join(rolesRoot(), roleId);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    ...defaultPieceFiles(roleId, capabilitiesYaml(roleId, DEFAULT_CAPABILITIES)),
    ...(options.files ?? {}),
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifestJson(roleId), null, 2)}\n`, 'utf8');
  for (const piece of PIECES) {
    if (piece === 'manifest.json') continue;
    writeFileSync(join(dir, piece), files[piece], 'utf8');
  }
  return dir;
}

/** 六件的当前内容指纹（夹具侧：用生产纯核算"记录应当填的正确 truth"） */
function roleContentHash(roleId: string = ROLE_ID): string {
  const dir = join(rolesRoot(), roleId);
  return computeRolePackContentHash(
    ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(dir, name)) })),
  );
}

/**
 * 记录自绑定 `approvalId`（= P2-1 §2.2-D9 公式的**夹具侧**实现）。
 * 被测对象是本模块的折叠行为，公式本身由 `tests/init/role-pack-approval.test.ts` 钉死。
 */
function selfBoundApprovalId(input: {
  readonly orgId: string;
  readonly roleId: string;
  readonly contentHash: string;
  readonly scope: 'content' | 'content+permissions';
}): string {
  const material = [
    input.orgId,
    input.roleId,
    input.contentHash,
    input.scope,
    APPROVED_AT,
    APPROVER_ID,
    APPROVER_ROLE,
  ].join('|');
  return `apv1:${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)}`;
}

/** 写一条审批记录（P3 写入器的测试替身；`contentHash` 缺省 = 按当前内容算真值） */
function writeApprovalRecord(
  options: { readonly roleId?: string; readonly scope?: 'content' | 'content+permissions' } = {},
): void {
  const roleId = options.roleId ?? ROLE_ID;
  const scope = options.scope ?? 'content+permissions';
  const contentHash = roleContentHash(roleId);
  mkdirSync(approvalsRoot(), { recursive: true });
  writeFileSync(
    join(approvalsRoot(), `${roleId}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        roleId,
        orgId: APPROVAL_ORG_ID,
        approvalId: selfBoundApprovalId({ orgId: APPROVAL_ORG_ID, roleId, contentHash, scope }),
        contentHash,
        approverId: APPROVER_ID,
        approverRole: APPROVER_ROLE,
        approvedAt: APPROVED_AT,
        scope,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** 撤销（删记录）—— 复核态回到 `pending` 的动作 */
function removeApprovalRecord(roleId: string = ROLE_ID): void {
  rmSync(join(approvalsRoot(), `${roleId}.json`), { force: true });
}

/** 把一份 YAML 源码补齐到**恰好** `targetBytes` 字节（补一行注释；不破坏结构与限额语义） */
function padYamlToBytes(source: string, targetBytes: number): string {
  const base = source.endsWith('\n') ? source : `${source}\n`;
  const current = Buffer.byteLength(base, 'utf8');
  if (current >= targetBytes) {
    throw new Error(`夹具源码 ${String(current)} B 已 ≥ 目标 ${String(targetBytes)} B`);
  }
  const need = targetBytes - current;
  if (need < 2) throw new Error('目标字节数不足以容纳一行注释');
  return `${base}${'#'.repeat(need - 1)}\n`;
}

/** 断言拿到 `ok:true` 并返回 permissions（失败时给出 code／reason，便于定位） */
function expectOk(roleId: string = ROLE_ID, knownTools: readonly string[] = KNOWN_TOOLS): RolePackToolPermissions {
  const result = loadRolePackPermissions(roleId, { knownTools });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望 ok:true，实得 ${result.code}: ${result.reason}`);
  return result.permissions;
}

/** 断言拿到指定错误码并返回 reason（code 由用例字面量钉死，不由被测实现生成） */
function expectFail(roleId: string, code: RolePackPermissionsCode): string {
  const result = loadRolePackPermissions(roleId, { knownTools: KNOWN_TOOLS });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false，实得 ok:true');
  expect(result.code).toBe(code);
  return result.reason;
}

/** 本次用例的 warn 消息列表（G2：禁静默） */
function warnMessages(): string[] {
  return logCalls.filter((call) => call.level === 'warn').map((call) => String(call.msg));
}

// ══════════════════════════════════════════════════════════════════════════════
// 生命周期：每用例独立临时根；env 用后还原（不污染同进程其它件）
// ══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  logCalls.length = 0;
  fixture = mkdtempSync(join(tmpdir(), 'p24a-perms-'));
  root = join(fixture, 'extensions', 'presets');
  mkdirSync(root, { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
  clearPresetCache();
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 · 审批 scope 两态（D4 单一判据）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1／审批 scope 两态', () => {
  it('J1-1 content+permissions ⇒ allowlist=声明∩known（保声明序），未注册项进 declaredUnavailable', () => {
    writeRole();
    writeApprovalRecord();
    const permissions = expectOk();
    expect(permissions.roleId).toBe(ROLE_ID);
    expect(permissions.scope).toBe('content+permissions');
    expect(permissions.permissionsPending).toBe(false);
    expect(permissions.allowlist).toEqual(['query_ontology', 'read_document']);
    expect(permissions.declaredUnavailable).toEqual(['analysis.variance']);
    expect(permissions.disabled).toEqual([]);
    // 未落地项必有可见留痕（禁止静默丢弃）
    expect(warnMessages().some((msg) => msg.includes('未注册的工具'))).toBe(true);
  });

  it('J1-2 content ＋ 声明了 tool ⇒ permissionsPending=true ⇒ allowlist=[]（全拒）＋ "权限待批" warn', () => {
    writeRole();
    writeApprovalRecord({ scope: 'content' });
    const permissions = expectOk();
    expect(permissions.scope).toBe('content');
    expect(permissions.permissionsPending).toBe(true);
    // 🔴 D4：待批 ⇒ 全拒（即使包声明了已注册工具）
    expect(permissions.allowlist).toEqual([]);
    // 全拒 ≠ 看不见：声明侧分类结果照旧如实透出
    expect(permissions.declaredUnavailable).toEqual(['analysis.variance']);
    expect(permissions.disabled).toEqual([]);
    expect(warnMessages().some((msg) => msg.includes('权限待批'))).toBe(true);
  });

  it('J1-3 content ＋ 无 tool 声明（0 条）⇒ permissionsPending=false（P2-1 口径）且 allowlist=[] 合法', () => {
    writeRole({ files: { 'capabilities.yaml': capabilitiesYaml(ROLE_ID, []) } });
    writeApprovalRecord({ scope: 'content' });
    const permissions = expectOk();
    expect(permissions.scope).toBe('content');
    // hasToolDeclarations=false ⇒ P2-1 判 false（无待批权限）—— 本模块只读字段，不自行推导
    expect(permissions.permissionsPending).toBe(false);
    expect(permissions.allowlist).toEqual([]);
    expect(permissions.declaredUnavailable).toEqual([]);
    expect(permissions.disabled).toEqual([]);
    expect(warnMessages().some((msg) => msg.includes('权限待批'))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · 分类语义（未声明／未注册不进 allowlist）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2／分类语义（未声明／未注册不进 allowlist）', () => {
  it('J2-1 未声明的已注册工具不进 allowlist（allowlist 只由声明产生）', () => {
    writeRole({
      files: {
        'capabilities.yaml': capabilitiesYaml(ROLE_ID, [
          { id: 'capability.ontology-query', tool: 'query_ontology', enabled: true },
        ]),
      },
    });
    writeApprovalRecord();
    const permissions = expectOk();
    expect(permissions.allowlist).toEqual(['query_ontology']);
    // 夹具注入的另两个已注册工具（read_document／collect_cost_data）未被声明 ⇒ 不出现
    expect(permissions.allowlist).not.toContain('read_document');
    expect(permissions.allowlist).not.toContain('collect_cost_data');
    expect(permissions.allowlist.length).toBe(1);
  });

  it('J2-2 声明但未注册 ⇒ declaredUnavailable；同包已注册项仍放行（不因一项未落地而全拒）', () => {
    writeRole({
      files: {
        'capabilities.yaml': capabilitiesYaml(ROLE_ID, [
          { id: 'capability.ontology-query', tool: 'query_ontology', enabled: true },
          { id: 'capability.cost-attribution', tool: 'analysis.cost-attribution', enabled: true },
        ]),
      },
    });
    writeApprovalRecord();
    const permissions = expectOk();
    expect(permissions.allowlist).toEqual(['query_ontology']);
    expect(permissions.declaredUnavailable).toEqual(['analysis.cost-attribution']);
  });

  it('J2-3 重复 tool 去重（两条声明同一工具 ⇒ allowlist 只 1 条、不报错）', () => {
    writeRole({
      files: {
        'capabilities.yaml': capabilitiesYaml(ROLE_ID, [
          { id: 'capability.dup-a', tool: 'query_ontology', enabled: true },
          { id: 'capability.dup-b', tool: 'query_ontology', enabled: true },
        ]),
      },
    });
    writeApprovalRecord();
    const permissions = expectOk();
    expect(permissions.allowlist).toEqual(['query_ontology']);
    expect(permissions.allowlist.length).toBe(1);
    expect(permissions.declaredUnavailable).toEqual([]);
  });

  it('J2-4 knownTools 缺省 ⇒ allowlist=[] 且 declaredUnavailable 全量（规格 §2.3-B.5）', () => {
    writeRole();
    writeApprovalRecord();
    const result = loadRolePackPermissions(ROLE_ID); // 不传 knownTools
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`期望 ok:true，实得 ${result.code}: ${result.reason}`);
    expect(result.permissions.allowlist).toEqual([]);
    expect(result.permissions.declaredUnavailable).toEqual([
      'query_ontology',
      'read_document',
      'analysis.variance',
    ]);
  });

  it('J2-5 knownTools=[] ⇒ 全 declaredUnavailable（空清单不得被当"全部已注册"）', () => {
    writeRole();
    writeApprovalRecord();
    const permissions = expectOk(ROLE_ID, []);
    expect(permissions.allowlist).toEqual([]);
    expect(permissions.declaredUnavailable).toEqual([
      'query_ontology',
      'read_document',
      'analysis.variance',
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 · 声明未落地可见 —— 出厂 finance 真包（只读，不改三包）
// ══════════════════════════════════════════════════════════════════════════════

describe('J4／声明未落地可见 — 出厂 finance 真包（只读）', () => {
  it('J4-1 finance：declaredUnavailable=三条 analysis.*、allowlist=0、不抛错、留一条点名 warn', () => {
    // 只读真内容根（默认 `extensions/presets`）—— 本用例不建临时包、不写仓
    delete process.env['SYNOVA_PRESETS_ROOT'];
    clearPresetCache();

    const result = loadRolePackPermissions(FACTORY_ROLE_ID, { knownTools: KNOWN_TOOLS });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`期望 ok:true，实得 ${result.code}: ${result.reason}`);
    const permissions = result.permissions;

    expect(permissions.roleId).toBe('finance');
    expect(permissions.scope).toBe('content+permissions');
    expect(permissions.permissionsPending).toBe(false);
    // 🔴 三包全部 analysis.* 工具全仓 0 注册 ⇒ allowlist 必空（如实暴露，不假装能跑）
    expect(permissions.allowlist).toEqual([]);
    expect(permissions.declaredUnavailable).toEqual([
      'analysis.variance',
      'analysis.cash-runway',
      'analysis.cost-attribution',
    ]);
    // enabled:false 一条（无 tool）⇒ 记 capability id
    expect(permissions.disabled).toEqual(['capability.evolution-write']);

    const declaredWarn = logCalls.find(
      (call) =>
        call.level === 'warn' &&
        Array.isArray(call.meta?.['declaredUnavailable']) &&
        call.meta?.['degraded'] === true,
    );
    expect(declaredWarn).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J5 · 指纹自校验与撤销（D11／D6）
// ══════════════════════════════════════════════════════════════════════════════

describe('J5／指纹自校验与撤销', () => {
  it('J5-1 改临时包内容不改审批 ⇒ E_ROLE_PACK_CONTENT_CHANGED（审批门子案 ②a）', () => {
    writeRole();
    writeApprovalRecord();
    // baseline：先证"改之前可放行"（排除"本来就不可用"的假红）
    expect(expectOk().allowlist).toEqual(['query_ontology', 'read_document']);

    // 改六件之一（仅追加一行注释，六件指纹即变）
    const scopeFile = join(rolesRoot(), ROLE_ID, 'knowledge-scope.yaml');
    writeFileSync(scopeFile, `${readFileSync(scopeFile, 'utf8')}# 审批之后被改\n`, 'utf8');

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CONTENT_CHANGED');
    expect(reason).toContain('E_APPROVAL_CONTENT_CHANGED');
    // 失败必留痕（degraded:true）
    const failWarn = logCalls.find(
      (call) =>
        call.level === 'warn' &&
        call.meta?.['code'] === 'E_ROLE_PACK_CONTENT_CHANGED' &&
        call.meta?.['degraded'] === true,
    );
    expect(failWarn).toBeDefined();
  });

  it('J5-2 删审批记录 ⇒ 下一轮 E_ROLE_PACK_NOT_APPROVED（pending，拒）', () => {
    writeRole();
    writeApprovalRecord();
    expect(expectOk().allowlist.length).toBe(2);

    removeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_NOT_APPROVED');
    expect(reason).toContain('pending');
  });

  it('J5-3 反向对照：改内容后同步更新审批记录 ⇒ 重新可用（证明 J5-1 的码来自"内容与记录不符"）', () => {
    writeRole();
    writeApprovalRecord();
    const scopeFile = join(rolesRoot(), ROLE_ID, 'knowledge-scope.yaml');
    writeFileSync(scopeFile, `${readFileSync(scopeFile, 'utf8')}# 审批后改并重批\n`, 'utf8');
    expectFail(ROLE_ID, 'E_ROLE_PACK_CONTENT_CHANGED');

    writeApprovalRecord(); // 重批（contentHash 按新内容现算）
    expect(expectOk().allowlist).toEqual(['query_ontology', 'read_document']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// C2 · 边界与限额（0／64 条、120／121 字符、64 KiB／+1、去重、disabled 优先、非法形状）
// ══════════════════════════════════════════════════════════════════════════════

describe('C2／边界与限额', () => {
  it('C2-1 capabilities 0 条 ⇒ 合法（allowlist 空，不是错误）', () => {
    writeRole({ files: { 'capabilities.yaml': capabilitiesYaml(ROLE_ID, []) } });
    writeApprovalRecord();
    const permissions = expectOk();
    expect(permissions.allowlist).toEqual([]);
    expect(permissions.disabled).toEqual([]);
    expect(permissions.declaredUnavailable).toEqual([]);
    expect(permissions.permissionsPending).toBe(false);
  });

  it('C2-2 64 条过（allowlist 64）／65 条拒 ⇒ E_ROLE_PACK_CAPABILITIES_INVALID', () => {
    const makeRows = (count: number): CapabilityRow[] =>
      Array.from({ length: count }, (_unused, index) => ({
        id: `cap.bulk-${String(index)}`,
        tool: `tool_bulk_${String(index)}`,
        enabled: true,
      }));

    // 64 条：恰好在上限（全部已注册 ⇒ 全部放行）
    writeRole({ files: { 'capabilities.yaml': capabilitiesYaml(ROLE_ID, makeRows(64)) } });
    writeApprovalRecord();
    const knownTools = Array.from({ length: 64 }, (_unused, index) => `tool_bulk_${String(index)}`);
    const permissions = expectOk(ROLE_ID, knownTools);
    expect(permissions.allowlist.length).toBe(64);
    expect(permissions.declaredUnavailable).toEqual([]);

    // 65 条：超上限 ⇒ INVALID（点名条数，不截断）
    rmSync(rolesRoot(), { recursive: true, force: true });
    removeApprovalRecord();
    writeRole({ files: { 'capabilities.yaml': capabilitiesYaml(ROLE_ID, makeRows(65)) } });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CAPABILITIES_INVALID');
    expect(reason).toContain('65 条 > 上限 64');
  });

  it('C2-3 tool 名 120 字符过／121 字符拒（点名长度上限，不截断）', () => {
    const okTool = `t${'a'.repeat(119)}`; // 恰 120 字符
    expect(okTool.length).toBe(120);
    writeRole({
      files: {
        'capabilities.yaml': capabilitiesYaml(ROLE_ID, [
          { id: 'capability.long-name', tool: okTool, enabled: true },
        ]),
      },
    });
    writeApprovalRecord();
    expect(expectOk(ROLE_ID, [okTool]).allowlist).toEqual([okTool]);

    // 121 字符 ⇒ INVALID
    const badTool = `t${'a'.repeat(120)}`;
    expect(badTool.length).toBe(121);
    rmSync(rolesRoot(), { recursive: true, force: true });
    removeApprovalRecord();
    writeRole({
      files: {
        'capabilities.yaml': capabilitiesYaml(ROLE_ID, [
          { id: 'capability.too-long', tool: badTool, enabled: true },
        ]),
      },
    });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CAPABILITIES_INVALID');
    expect(reason).toContain('121 字符 > 上限 120');
  });

  it('C2-4 capabilities.yaml 恰 64 KiB 过／+1 字节拒（先于解析，未进入 YAML）', () => {
    const base = capabilitiesYaml(ROLE_ID, [{ id: 'capability.edge', tool: 'query_ontology', enabled: true }]);

    // 恰 65536 B ⇒ 过
    writeRole({
      files: { 'capabilities.yaml': padYamlToBytes(base, CAPABILITIES_MAX_BYTES) },
    });
    writeApprovalRecord();
    expect(expectOk().allowlist).toEqual(['query_ontology']);

    // 65537 B ⇒ 拒（字节上限先于解析）
    rmSync(rolesRoot(), { recursive: true, force: true });
    removeApprovalRecord();
    writeRole({
      files: { 'capabilities.yaml': padYamlToBytes(base, CAPABILITIES_MAX_BYTES + 1) },
    });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CAPABILITIES_INVALID');
    expect(reason).toContain('65537 B > 上限 65536 B');
  });

  it('C2-5 同 tool 既 enabled 又 enabled:false ⇒ disabled 优先（allowlist 不含、disabled 点名能力 id）', () => {
    writeRole({
      files: {
        'capabilities.yaml': capabilitiesYaml(ROLE_ID, [
          { id: 'capability.ontology-query', tool: 'query_ontology', enabled: true },
          {
            id: 'capability.evolution-write',
            tool: 'query_ontology',
            enabled: false,
            disabledReason: '④ 参数层只允许由 ③ 哨兵写',
          },
        ]),
      },
    });
    writeApprovalRecord();
    const permissions = expectOk();
    // 🔴 显式禁用优先：即使该工具被 enabled 条目声明、且已注册，也**不得**放行
    expect(permissions.allowlist).toEqual([]);
    // disabled 记能力 id（点名用）＋ 该条声明的 tool
    expect(permissions.disabled).toEqual(['capability.evolution-write', 'query_ontology']);
    expect(warnMessages().some((msg) => msg.includes('禁用'))).toBe(true);
  });

  it('C2-6 非法形状（capabilities 非数组／条目非映射／id 缺／enabled 非 boolean）⇒ 同码', () => {
    const shapes: readonly { readonly name: string; readonly source: string }[] = [
      { name: 'capabilities 非数组', source: `roleId: ${ROLE_ID}\nversion: 2\ncapabilities: {a: 1}\n` },
      {
        name: '条目非映射',
        source: `roleId: ${ROLE_ID}\nversion: 2\ncapabilities:\n  - just-a-string\n`,
      },
      {
        name: 'id 缺省',
        source: `roleId: ${ROLE_ID}\nversion: 2\ncapabilities:\n  - label: x\n    enabled: true\n`,
      },
      {
        name: 'enabled 非 boolean',
        source:
          `roleId: ${ROLE_ID}\nversion: 2\ncapabilities:\n  - id: cap.x\n` +
          '    tool: query_ontology\n    enabled: "yes"\n',
      },
      {
        name: 'tool 非 string',
        source:
          `roleId: ${ROLE_ID}\nversion: 2\ncapabilities:\n  - id: cap.x\n` +
          '    tool: [query_ontology]\n    enabled: true\n',
      },
      {
        name: 'tool 空串',
        source:
          `roleId: ${ROLE_ID}\nversion: 2\ncapabilities:\n  - id: cap.x\n` +
          '    tool: ""\n    enabled: true\n',
      },
    ];

    for (const shape of shapes) {
      // 每个形状一个独立临时内容根（互不继承上一条的 approval／文件）
      rmSync(rolesRoot(), { recursive: true, force: true });
      rmSync(resolve(root, '..', '..', '.synova'), { recursive: true, force: true });
      writeRole({ files: { 'capabilities.yaml': shape.source } });
      writeApprovalRecord();
      const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CAPABILITIES_INVALID');
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('C2-7 重复键 YAML ⇒ E_ROLE_PACK_CAPABILITIES_INVALID（不静默取最后一个）', () => {
    writeRole({
      files: {
        'capabilities.yaml': `roleId: ${ROLE_ID}\nroleId: ${ROLE_ID}\nversion: 2\ncapabilities: []\n`,
      },
    });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CAPABILITIES_INVALID');
    expect(reason).toContain('YAML 解析失败');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ① 装载清单：包不存在
// ══════════════════════════════════════════════════════════════════════════════

describe('①／装载清单', () => {
  it('NOT_FOUND：未装载的 roleId ⇒ E_ROLE_PACK_NOT_FOUND（不抛）', () => {
    const reason = expectFail('ghost', 'E_ROLE_PACK_NOT_FOUND');
    expect(reason).toContain('ghost');
    const failWarn = logCalls.find(
      (call) =>
        call.level === 'warn' &&
        call.meta?.['code'] === 'E_ROLE_PACK_NOT_FOUND' &&
        call.meta?.['roleId'] === 'ghost' &&
        call.meta?.['degraded'] === true,
    );
    expect(failWarn).toBeDefined();
  });
});
