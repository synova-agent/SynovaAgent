/**
 * tests/init/role-pack-output-standard.test.ts — 岗位包「可机判输出标准」编译判据（#1075 P2-3）
 *
 * 断言对象 = **生产路径**（`src/init/role-pack-output-standard.ts` 的 `loadRolePackOutputStandard()` ＋
 *   `src/output/contract-validator.ts` 的 `validateContractObject()`）——禁 grep 当验收（规格 §4 V-02）。
 *   夹具六件过 P2-1 的 v3 校验（结构/refs/pieces 对账全部真跑，本文件不伪造 `RolePack` 对象），
 *   审批记录走 P2-1 的 `judgeRolePackApproval()` 路径。
 *
 * 判据分组（与规格 §4 逐条对齐）:
 *   J1 编译（machine→checks）：出厂 `finance` 只读编译出 ≥2 条 checks；无 machine ⇒ `unverifiable` 可见；
 *      非法正则 ⇒ `E_ROLE_PACK_OUTPUT_INVALID` 点名 criterion id。
 *   J2 合标过／违标点名：合标文本 ⇒ `ok:true`／0 errors；缺「报告期」⇒ `ok:false` 且点名 `ac.period-declared`。
 *   J4 审批门：非出厂 `ops` 无记录 ⇒ `E_ROLE_PACK_NOT_APPROVED`（pending）；撤销（删记录）⇒ 同码。
 *   J6 限额/边界：criteria 32/33；text 200/201；pattern 200/201 与非法正则；两件 64 KiB/+1；
 *      `criteria` 缺段/非数组；`machine` 非对象/kind 非白名单/pattern 缺省。
 *   ＋ G2 可见性：`unverifiable` 必有一条 `log.info`（禁静默丢弃）；NOT_FOUND；回滚开关纯核。
 *   ＋ 两条 **fault injection**（不可稳定复现的残窗）：load↔snapshot 快照失败 ⇒ INVALID；
 *     快照指纹 ≠ 校验期指纹 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`（规格 §4.5-C1 四码的第 3 码）。
 *
 * 🔴 期望值来源：错误码/限额阈值全部**字面量硬编码**（规格 §4.5-C1／§4.5-C2 逐字）；夹具侧的
 *   `contentHash` 用生产纯核现算真值（它不是断言期望值，而是"给审批记录填一个正确指纹"的唯一可靠办法）。
 * 🔴 两条 fault injection 只注入**不可观测残窗**（TOCTOU 窗口）；正常/降级/边界用例**不 mock 语义**。
 *
 * 隔离手法：不落仓 —— 每个用例在 `mkdtempSync` 造仓库形状临时根
 *   `<fixture>/extensions/presets/roles/<id>/` 六件 ＋ `<fixture>/.synova/approvals/<id>.json`，
 *   `SYNOVA_PRESETS_ROOT` 指向内容根（生产同规则：审批根 = 内容根 `../..`）。**禁写真仓**。
 *   出厂 `finance` 用例**只读**真内容根（`delete SYNOVA_PRESETS_ROOT` ⇒ 默认 `extensions/presets`）。
 *   失败台账 `SYNOVA_OUTPUT_CONTRACT_SINK` 一律指临时文件（**绝不**写仓 `data/`）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isRolePackOutputEnabled,
  loadRolePackOutputStandard,
  type LoadRolePackOutputStandardResult,
  type RoleOutputStandard,
  type RolePackOutputStandardCode,
} from '../../src/init/role-pack-output-standard';
import { readPieceBytesOnce } from '../../src/init/role-pack-persona';
import { computeRolePackContentHash } from '../../src/init/role-pack-schema';
import { clearPresetCache } from '../../src/init/preset-loader';
import { validateContractObject } from '../../src/output/contract-validator';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（G2 判据：失败码必有一条 warn；unverifiable 必有一条 info）
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

/**
 * 两个残窗的**故障注入**替身（默认透传真实实现）。
 *
 * 为什么需要：① `pack.validation.contentHash` 与本次自读**同源** ⇒ "指纹不等"只在 load↔snapshot
 * 的 TOCTOU 窗口内出现（规格 §4.5-C1 明示），单测无法稳定制造；② 快照读失败同理。
 * 注入的是**条件**（"此刻指纹不等"／"此刻快照失败"），不是被测语义 ⇒ 断言仍打在真实码与点名字段上。
 */
vi.mock('../../src/init/role-pack-schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/init/role-pack-schema')>();
  return { ...actual, computeRolePackContentHash: vi.fn(actual.computeRolePackContentHash) };
});

vi.mock('../../src/init/role-pack-persona', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/init/role-pack-persona')>();
  return { ...actual, readPieceBytesOnce: vi.fn(actual.readPieceBytesOnce) };
});

// ══════════════════════════════════════════════════════════════════════════════
// 常量（本文件独立声明；与规格 §2.3／§4.5-C2 同值）
// ══════════════════════════════════════════════════════════════════════════════

/** 六件（**顺序即契约顺序**） */
const PIECES = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
] as const;

/** 夹具角色 id：**非出厂**（出厂 finance/hr/sales 只信代码锚，记录不得覆盖锚） */
const ROLE_ID = 'ops';

/** 出厂包（只读编译面；`machine` 由 T1 同批落入，本文件不改它） */
const FACTORY_ROLE_ID = 'finance';

/** `meta.generatedAt` 注入值（确定性断言） */
const NOW = '2026-10-29T12:00:00.000Z';

/** 64 KiB（本批自设的两件字节上限） */
const PIECE_MAX_BYTES = 64 * 1024;

/** 审批记录的时间/身份/租户字段（自绑定口径同 P2-1 §2.2-D9） */
const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_p23_output_fixture';
const APPROVER_ROLE = 'super-admin';
const APPROVAL_ORG_ID = 'default';

/** 缺省 `acceptance-criteria.yaml`：1 条机器可判 ＋ 1 条散文（unverifiable） */
const DEFAULT_CRITERIA = `roleId: ${ROLE_ID}
version: 2
criteria:
  - id: ac.period-declared
    text: 每个结论都带报告期
    check: 正文含「报告期」
    machine:
      kind: textPattern
      pattern: '报告期'
  - id: ac.no-fabrication
    text: 数据不足时列出缺口，不编造
    check: emptyState 被遵守
`;

/** 缺省 `output-template.ref`（展示标准；本批不产生 checks） */
const DEFAULT_TEMPLATE = `templateId: ops.standard
sections:
  - id: headline
    title: 一句话结论
    must: [结论, 报告期]
emptyState: 数据不足时明确列出「缺什么数据」。
`;

// ══════════════════════════════════════════════════════════════════════════════
// 夹具（仓库形状临时根；每个用例一个）
// ══════════════════════════════════════════════════════════════════════════════

let fixture: string;
let root: string;
let sink: string;
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];
const ORIGINAL_SINK = process.env['SYNOVA_OUTPUT_CONTRACT_SINK'];
const ORIGINAL_ORG_ID = process.env['SYNOVA_ORG_ID'];
const ORIGINAL_ROLLBACK = process.env['SYNOVA_ROLE_PACK_OUTPUT'];

/** 内容根：`<fixture>/extensions/presets`（= `SYNOVA_PRESETS_ROOT`） */
function rolesRoot(): string {
  return join(root, 'roles');
}

/** 审批根（生产同规则）：内容根 `../..` ⇒ `<fixture>/.synova/approvals` */
function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

/** 最小合法 **v3** manifest（refs 与 `context-manifest.yaml` 的 `contexts[].source` 对账一致） */
function manifestDoc(roleId: string): Record<string, unknown> {
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

/** 五件内容件的缺省载荷（可覆盖 criteria/template） */
function pieceFiles(roleId: string, criteria: string, template: string): Record<string, string> {
  return {
    'knowledge-scope.yaml': `roleId: ${roleId}\nversion: 2\nscopes:\n  - id: ${roleId}.demo\n`,
    'context-manifest.yaml':
      `roleId: ${roleId}\nversion: 2\ncontexts:\n  - id: ${roleId}.demo\n` +
      '    label: 三表口径\n' +
      `    source: knowledge-scope.yaml#${roleId}.demo\n` +
      '    why: 财务判断必须建立在同一套口径上\n    required: true\n',
    'output-template.ref': template,
    'capabilities.yaml': `roleId: ${roleId}\nversion: 2\ncapabilities:\n  - id: capability.demo\n    label: demo\n    enabled: true\n`,
    'acceptance-criteria.yaml': criteria,
  };
}

/** 造一个齐备的角色包目录（可覆盖两件的内容） */
function writeRole(
  options: { readonly roleId?: string; readonly criteria?: string; readonly template?: string } = {},
): string {
  const roleId = options.roleId ?? ROLE_ID;
  const dir = join(rolesRoot(), roleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifestDoc(roleId), null, 2)}\n`, 'utf8');
  const files = pieceFiles(roleId, options.criteria ?? DEFAULT_CRITERIA, options.template ?? DEFAULT_TEMPLATE);
  for (const piece of PIECES) {
    if (piece === 'manifest.json') continue;
    writeFileSync(join(dir, piece), files[piece] ?? '');
  }
  return dir;
}

/** 六件的当前内容指纹（夹具侧：给审批记录填"应当等于内容"的正确真值） */
function contentHashOf(roleId: string = ROLE_ID): string {
  const dir = join(rolesRoot(), roleId);
  return computeRolePackContentHash(
    PIECES.map((name) => ({ name, bytes: readFileSync(join(dir, name)) })),
  );
}

/**
 * 记录自绑定 `approvalId`（P2-1 §2.2-D9 公式的**夹具侧独立实现**）。
 * 公式本身由 `tests/init/role-pack-approval.test.ts` 钉死，本文件只复用其口径。
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

/** 写一条审批记录（P3 写入器的测试替身） */
function writeApprovalRecord(roleId: string = ROLE_ID): void {
  const contentHash = contentHashOf(roleId);
  const scope = 'content+permissions' as const;
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

/** 断言拿到 `ok:true` 并返回标准（失败时给出 code／reason，便于定位） */
function expectOk(result: LoadRolePackOutputStandardResult): RoleOutputStandard {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望 ok:true，实得 ${result.code}: ${result.reason}`);
  return result.standard;
}

/** 断言拿到指定错误码并返回 reason（code 由用例字面量钉死，不由被测实现生成） */
function expectFail(result: LoadRolePackOutputStandardResult, code: RolePackOutputStandardCode): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false，实得 ok:true');
  expect(result.code).toBe(code);
  return result.reason;
}

/** 日志里是否出现过带指定 `code` 的 warn（G2：失败必留痕） */
function warnWithCode(code: string): boolean {
  return logCalls.some((call) => call.level === 'warn' && call.meta?.['code'] === code);
}

/** 把一份 YAML 源码补齐到**恰好** `targetBytes` 字节（补一行注释；不破坏结构） */
function padYamlToBytes(source: string, targetBytes: number): string {
  const base = source.endsWith('\n') ? source : `${source}\n`;
  const current = Buffer.byteLength(base, 'utf8');
  if (current >= targetBytes) {
    throw new Error(`夹具源码 ${String(current)} B 已 ≥ 目标 ${String(targetBytes)} B`);
  }
  const need = targetBytes - current;
  if (need < 2) throw new Error('目标字节数不足以容纳一行注释');
  return `${base}#${'#'.repeat(need - 2)}\n`;
}

/** 造 `count` 条无 `machine` 的 criteria（全部应进 unverifiable） */
function manyCriteriaYaml(count: number): string {
  const lines = [`roleId: ${ROLE_ID}`, 'version: 2', 'criteria:'];
  for (let i = 0; i < count; i += 1) {
    const n = String(i).padStart(2, '0');
    lines.push(`  - id: ac.c${n}`, `    text: 标准 ${n}`, `    check: 检查 ${n}`);
  }
  return `${lines.join('\n')}\n`;
}

/** 一条带单条 machine 的 criteria（用于 text/pattern 边界） */
function singleMachineCriteriaYaml(options: {
  readonly text: string;
  readonly pattern: string;
  readonly kind?: string;
}): string {
  return `roleId: ${ROLE_ID}
version: 2
criteria:
  - id: ac.boundary
    text: ${JSON.stringify(options.text)}
    check: 边界用例
    machine:
      kind: ${options.kind ?? 'textPattern'}
      pattern: ${JSON.stringify(options.pattern)}
`;
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'rp-outstd-'));
  root = join(fixture, 'extensions', 'presets');
  sink = join(fixture, 'output-contract-failures.jsonl');
  mkdirSync(rolesRoot(), { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  process.env['SYNOVA_OUTPUT_CONTRACT_SINK'] = sink;
  delete process.env['SYNOVA_ORG_ID']; // 审批租户 = default（与夹具记录一致）
  delete process.env['SYNOVA_ROLE_PACK_OUTPUT'];
  logCalls.length = 0;
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  for (const [key, original] of [
    ['SYNOVA_PRESETS_ROOT', ORIGINAL_PRESETS_ROOT],
    ['SYNOVA_OUTPUT_CONTRACT_SINK', ORIGINAL_SINK],
    ['SYNOVA_ORG_ID', ORIGINAL_ORG_ID],
    ['SYNOVA_ROLE_PACK_OUTPUT', ORIGINAL_ROLLBACK],
  ] as const) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  clearPresetCache();
  vi.mocked(computeRolePackContentHash).mockClear();
  vi.mocked(readPieceBytesOnce).mockClear();
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 · 编译（machine→checks）—— 出厂 finance 只读编译
// ══════════════════════════════════════════════════════════════════════════════

describe('J1／编译 — 出厂 finance 只读（machine → checks）', () => {
  beforeEach(() => {
    // 出厂包只读真内容根（默认 `extensions/presets`）；临时根只服务 ops 用例
    delete process.env['SYNOVA_PRESETS_ROOT'];
    clearPresetCache();
  });

  it('J1-1 finance 编译出 ≥2 条 checks；meta／fields／sections／pointers／sourcePath 逐字段合规', () => {
    const standard = expectOk(loadRolePackOutputStandard(FACTORY_ROLE_ID, { now: NOW }));

    expect(standard.roleId).toBe(FACTORY_ROLE_ID);
    const ids = standard.contract.checks.map((check) => check.id);
    expect(standard.contract.checks.length).toBeGreaterThanOrEqual(2);
    expect(ids).toContain('role.ac.period-declared');
    expect(ids).toContain('role.ac.source-traceable');
    // 每条 check 的形状：id 前缀 role.／kind 白名单／pattern 与 message 都在
    for (const check of standard.contract.checks) {
      expect(check.id?.startsWith('role.')).toBe(true);
      expect(['textPattern', 'noPattern']).toContain(check.kind);
      expect(typeof check.pattern).toBe('string');
      expect((check.message ?? '').length).toBeGreaterThan(0);
    }
    expect(standard.contract.meta).toEqual({
      id: `role:${FACTORY_ROLE_ID}`,
      version: 1,
      title: `${FACTORY_ROLE_ID} 输出标准`,
      format: 'markdown',
      generatedAt: NOW,
    });
    // 三要素必填（§2.3-B step5 逐字）
    expect(standard.contract.fields).toEqual([
      { path: 'orgId', required: true },
      { path: 'generatedAt', required: true },
      { path: 'text', required: true },
    ]);
    // 本批不判版式（D1/L2）
    expect(standard.contract.sections).toEqual([]);
    expect(standard.contract.pointers).toEqual([]);
    // 错误归属用绝对路径（引擎 makeError 的 sourcePath 取它）
    expect(isAbsolute(standard.contract.sourcePath)).toBe(true);
    expect(standard.contract.sourcePath.endsWith('acceptance-criteria.yaml')).toBe(true);
  });

  it('J1-2 无 machine 的 criterion 进 unverifiable（可见）＋ 必有 log.info 一条（禁静默丢弃）', () => {
    const standard = expectOk(loadRolePackOutputStandard(FACTORY_ROLE_ID, { now: NOW }));

    const unverifiableIds = standard.unverifiable.map((item) => item.id);
    expect(unverifiableIds).toContain('ac.no-fabrication');
    // 它同时**不是** check（可机器判与不可判严格分离）
    expect(standard.contract.checks.map((check) => check.id)).not.toContain('role.ac.no-fabrication');
    // 每条 unverifiable 原样带 id ＋ text
    const noFab = standard.unverifiable.find((item) => item.id === 'ac.no-fabrication');
    expect(noFab?.text.length).toBeGreaterThan(0);

    const infoLog = logCalls.find(
      (call) =>
        call.level === 'info' &&
        call.meta?.['roleId'] === FACTORY_ROLE_ID &&
        call.meta?.['unverifiable'] === standard.unverifiable.length,
    );
    expect(infoLog).toBeDefined();
    expect(infoLog?.meta?.['unverifiableIds']).toContain('ac.no-fabrication');
  });

  it('J1-3 template 原样透出（templateId／sections／emptyState；不产生 checks）', () => {
    const standard = expectOk(loadRolePackOutputStandard(FACTORY_ROLE_ID, { now: NOW }));

    expect(standard.template.templateId).toBe(`${FACTORY_ROLE_ID}.standard`);
    expect(standard.template.sections.length).toBeGreaterThanOrEqual(2);
    const headline = standard.template.sections.find((section) => section.id === 'headline');
    expect(headline?.title.length).toBeGreaterThan(0);
    expect(headline?.must).toContain('结论');
    expect(standard.template.emptyState.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 反例 · 删 machine ⇒ unverifiable；非法正则 ⇒ INVALID 点名 criterion id
// ══════════════════════════════════════════════════════════════════════════════

describe('J1／反例 — machine 缺席与非法正则（非出厂 ops 夹具）', () => {
  it('J1-4 删掉某 criterion 的 machine ⇒ 该条出现在 unverifiable（不得静默消失）', () => {
    const withoutMachine = `roleId: ${ROLE_ID}
version: 2
criteria:
  - id: ac.period-declared
    text: 每个结论都带报告期
    check: 正文含「报告期」
  - id: ac.no-fabrication
    text: 数据不足时列出缺口，不编造
    check: emptyState 被遵守
`;
    writeRole({ criteria: withoutMachine });
    writeApprovalRecord();

    const standard = expectOk(loadRolePackOutputStandard(ROLE_ID, { now: NOW }));

    expect(standard.contract.checks).toEqual([]);
    expect(standard.unverifiable.map((item) => item.id)).toEqual(['ac.period-declared', 'ac.no-fabrication']);
    expect(warnWithCode('E_ROLE_PACK_OUTPUT_INVALID')).toBe(false);
  });

  it('J1-5 非法正则 ⇒ E_ROLE_PACK_OUTPUT_INVALID，reason 点名 criterion id', () => {
    writeRole({
      criteria: singleMachineCriteriaYaml({ text: '每个结论都带报告期', pattern: '[' }),
    });
    writeApprovalRecord();

    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');

    expect(reason).toContain('ac.boundary');
    expect(reason).toContain('非法正则');
    expect(warnWithCode('E_ROLE_PACK_OUTPUT_INVALID')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · 合标过／违标点名（对象契约校验入口）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2／校验 — 合标通过、违标点名（validateContractObject 真跑）', () => {
  beforeEach(() => {
    delete process.env['SYNOVA_PRESETS_ROOT'];
    clearPresetCache();
  });

  /** 合标文本：三条 machine 全覆盖（报告期 ＋ [src: 溯源 ＋ 观察指标） */
  const COMPLIANT_TEXT =
    '报告期：2026-Q3。本期收入环比 +8%。[src:knowledge-scope.yaml#finance.demo]\n' +
    '建议动作：复核应收账款账龄；观察指标：逾期 30 天以上占比。';

  it('J2-1 合标文本 ⇒ ok:true、0 errors、不落账', () => {
    const standard = expectOk(loadRolePackOutputStandard(FACTORY_ROLE_ID, { now: NOW }));

    const result = validateContractObject(
      standard.contract,
      { text: COMPLIANT_TEXT, orgId: 'org-p23-j2', generatedAt: NOW },
      { sinkPath: null, now: NOW },
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.failureRecord).toBeNull();
    expect(result.recorded).toBeNull();
    expect(result.contractId).toBe(`role:${FACTORY_ROLE_ID}`);
    expect(result.contractVersion).toBe(1);
  });

  it('J2-2 缺「报告期」⇒ ok:false，错误 code／fieldPath 点名 ac.period-declared ＋ 落账 1 条', () => {
    const standard = expectOk(loadRolePackOutputStandard(FACTORY_ROLE_ID, { now: NOW }));

    const violatingText =
      '本期收入环比 +8%。[src:knowledge-scope.yaml#finance.demo]\n' +
      '建议动作：复核应收账款账龄；观察指标：逾期 30 天以上占比。';
    const result = validateContractObject(
      standard.contract,
      { text: violatingText, orgId: 'org-p23-j2', generatedAt: NOW },
      { now: NOW },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    // 引擎错误码形态 `<contractId>.<kind>.<fieldPath>`：contractId=role:finance；fieldPath=check id
    expect(result.errors[0].code).toBe(`role:${FACTORY_ROLE_ID}.text.role.ac.period-declared`);
    expect(result.errors[0].fieldPath).toBe('role.ac.period-declared');
    expect(result.errors[0].message).toContain('报告期');

    // 落账走引擎既有 sink（`SYNOVA_OUTPUT_CONTRACT_SINK`）；记录只写码/路径/计数（不写正文 —— 隐私）
    expect(result.failureRecord?.errorCount).toBe(1);
    expect(result.failureRecord?.fieldPaths).toEqual(['role.ac.period-declared']);
    expect(result.recorded?.recorded).toBe(true);
    const lines = readFileSync(sink, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record['errorCount']).toBe(1);
    expect(record['codes']).toEqual([`role:${FACTORY_ROLE_ID}.text.role.ac.period-declared`]);
    expect(record['fieldPaths']).toEqual(['role.ac.period-declared']);
    // 记录不含正文（隐私约束：不写产出内容）
    expect(JSON.stringify(record)).not.toContain('本期收入环比');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 · 审批门（非出厂 ops；出厂三包恒 approved，不能用来测 pending）
// ══════════════════════════════════════════════════════════════════════════════

describe('J4／审批门 — 非出厂 ops 的 pending 与撤销', () => {
  it('J4-1 无审批记录 ⇒ E_ROLE_PACK_NOT_APPROVED（pending；不编译、不校验）', () => {
    writeRole();

    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_NOT_APPROVED');

    expect(reason).toContain('pending');
    expect(reason).not.toContain('unverified');
    expect(warnWithCode('E_ROLE_PACK_NOT_APPROVED')).toBe(true);
    // 不校验 ⇒ 无"编译成功"的 info（loader 自己也会打 info，故按本模块独有的 `contractId` 元字段判）
    expect(logCalls.some((call) => call.level === 'info' && typeof call.meta?.['contractId'] === 'string')).toBe(
      false,
    );
  });

  it('J4-2 approved ⇒ ok；撤销（删记录）⇒ 下一轮即 NOT_APPROVED', () => {
    writeRole();
    writeApprovalRecord();
    expect(expectOk(loadRolePackOutputStandard(ROLE_ID)).roleId).toBe(ROLE_ID);

    removeApprovalRecord();

    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_NOT_APPROVED');
    expect(reason).toContain('pending');
  });

  it('J4-3 不存在岗位 ⇒ E_ROLE_PACK_NOT_FOUND（reason 点名 roleId 与内容根）', () => {
    const reason = expectFail(loadRolePackOutputStandard('no-such-role'), 'E_ROLE_PACK_NOT_FOUND');

    expect(reason).toContain('no-such-role');
    expect(reason).toContain(root);
    expect(warnWithCode('E_ROLE_PACK_NOT_FOUND')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J6 · 限额/边界（§4.5-C2 逐行）
// ══════════════════════════════════════════════════════════════════════════════

describe('J6／限额边界 — 条数／文本／正则／字节（不截断）', () => {
  it('J6-a criteria 空数组 ⇒ 合法（零 checks、零 unverifiable）；32 条 ⇒ 合法（全 unverifiable）', () => {
    writeRole({ criteria: `roleId: ${ROLE_ID}\nversion: 2\ncriteria: []\n` });
    writeApprovalRecord();
    const empty = expectOk(loadRolePackOutputStandard(ROLE_ID, { now: NOW }));
    expect(empty.contract.checks).toEqual([]);
    expect(empty.unverifiable).toEqual([]);

    writeRole({ criteria: manyCriteriaYaml(32) });
    writeApprovalRecord();
    const atLimit = expectOk(loadRolePackOutputStandard(ROLE_ID, { now: NOW }));
    expect(atLimit.unverifiable).toHaveLength(32);
    expect(atLimit.contract.checks).toEqual([]);
  });

  it('J6-b criteria 33 条 ⇒ E_ROLE_PACK_OUTPUT_INVALID（点名条数上限）', () => {
    writeRole({ criteria: manyCriteriaYaml(33) });
    writeApprovalRecord();

    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');

    expect(reason).toContain('33');
    expect(reason).toContain('32');
  });

  it('J6-c criterion text 200 ⇒ 通过；201 ⇒ INVALID（点名 criterion id）', () => {
    writeRole({ criteria: singleMachineCriteriaYaml({ text: '甲'.repeat(200), pattern: '甲' }) });
    writeApprovalRecord();
    expect(expectOk(loadRolePackOutputStandard(ROLE_ID)).unverifiable).toEqual([]);

    writeRole({ criteria: singleMachineCriteriaYaml({ text: '甲'.repeat(201), pattern: '甲' }) });
    writeApprovalRecord();
    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');
    expect(reason).toContain('ac.boundary');
    expect(reason).toContain('201');
  });

  it('J6-d machine.pattern 200 ⇒ 通过；201 ⇒ INVALID（点名 criterion id）', () => {
    writeRole({ criteria: singleMachineCriteriaYaml({ text: '边界文本', pattern: 'a'.repeat(200) }) });
    writeApprovalRecord();
    expect(expectOk(loadRolePackOutputStandard(ROLE_ID)).contract.checks).toHaveLength(1);

    writeRole({ criteria: singleMachineCriteriaYaml({ text: '边界文本', pattern: 'a'.repeat(201) }) });
    writeApprovalRecord();
    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');
    expect(reason).toContain('ac.boundary');
    expect(reason).toContain('201');
  });

  it('J6-e acceptance-criteria.yaml 恰 64 KiB ⇒ 通过；+1 B ⇒ INVALID（点名文件与字节数）', () => {
    const padded = padYamlToBytes(DEFAULT_CRITERIA, PIECE_MAX_BYTES);
    expect(Buffer.byteLength(padded, 'utf8')).toBe(PIECE_MAX_BYTES);
    writeRole({ criteria: padded });
    writeApprovalRecord();
    const standard = expectOk(loadRolePackOutputStandard(ROLE_ID, { now: NOW }));
    expect(standard.contract.checks).toHaveLength(1);

    const over = padYamlToBytes(DEFAULT_CRITERIA, PIECE_MAX_BYTES + 1);
    writeRole({ criteria: over });
    writeApprovalRecord();
    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');
    expect(reason).toContain('acceptance-criteria.yaml');
    expect(reason).toContain(String(PIECE_MAX_BYTES + 1));
  });

  it('J6-f output-template.ref 恰 64 KiB ⇒ 通过；+1 B ⇒ INVALID（点名文件与字节数）', () => {
    const padded = padYamlToBytes(DEFAULT_TEMPLATE, PIECE_MAX_BYTES);
    expect(Buffer.byteLength(padded, 'utf8')).toBe(PIECE_MAX_BYTES);
    writeRole({ template: padded });
    writeApprovalRecord();
    expect(expectOk(loadRolePackOutputStandard(ROLE_ID)).template.sections).toHaveLength(1);

    const over = padYamlToBytes(DEFAULT_TEMPLATE, PIECE_MAX_BYTES + 1);
    writeRole({ template: over });
    writeApprovalRecord();
    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');
    expect(reason).toContain('output-template.ref');
    expect(reason).toContain(String(PIECE_MAX_BYTES + 1));
  });

  it('J6-g criteria 缺段／非数组 ⇒ INVALID（schema required 先拦）', () => {
    writeRole({ criteria: `roleId: ${ROLE_ID}\nversion: 2\n` });
    writeApprovalRecord();
    expect(expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID')).toContain('criteria');

    writeRole({ criteria: `roleId: ${ROLE_ID}\nversion: 2\ncriteria: not-an-array\n` });
    writeApprovalRecord();
    expect(expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID')).toContain('数组');
  });

  it('J6-h machine 非对象／kind 非白名单 ⇒ INVALID；pattern 缺省 ⇒ INVALID', () => {
    writeRole({
      criteria: `roleId: ${ROLE_ID}\nversion: 2\ncriteria:\n  - id: ac.boundary\n    text: 边界\n    machine: not-an-object\n`,
    });
    writeApprovalRecord();
    expect(expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID')).toContain('machine');

    writeRole({ criteria: singleMachineCriteriaYaml({ text: '边界', pattern: 'x', kind: 'range' }) });
    writeApprovalRecord();
    expect(expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID')).toContain('kind');

    writeRole({
      criteria: `roleId: ${ROLE_ID}\nversion: 2\ncriteria:\n  - id: ac.boundary\n    text: 边界\n    machine:\n      kind: textPattern\n`,
    });
    writeApprovalRecord();
    expect(expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID')).toContain('pattern');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// G5 状态 ＋ D9 回滚开关
// ══════════════════════════════════════════════════════════════════════════════

describe('G5／D9 — 状态可区分与回滚开关', () => {
  it('回滚开关：未设/其它值 ⇒ 启用；逐字 off ⇒ 停用 (显式降级，非默认)', () => {
    expect(isRolePackOutputEnabled()).toBe(true);
    process.env['SYNOVA_ROLE_PACK_OUTPUT'] = 'on';
    expect(isRolePackOutputEnabled()).toBe(true);
    process.env['SYNOVA_ROLE_PACK_OUTPUT'] = 'off';
    expect(isRolePackOutputEnabled()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 两条残窗故障注入（load↔snapshot）：CONTENT_CHANGED ＋ INVALID
// ══════════════════════════════════════════════════════════════════════════════

describe('残窗（fault injection）— load↔snapshot 两个不可稳定复现的条件', () => {
  it('快照指纹 ≠ 校验期指纹 ⇒ E_ROLE_PACK_CONTENT_CHANGED（四码的第 3 码可达）', () => {
    writeRole();
    writeApprovalRecord();

    // 注入条件：本次快照算出的指纹为全 f（≠ 装载期 contentHash）
    vi.mocked(computeRolePackContentHash).mockReturnValueOnce('f'.repeat(64));

    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_CONTENT_CHANGED');

    expect(reason).toContain('六件内容已变');
    expect(reason).toContain('f'.repeat(64));
    expect(warnWithCode('E_ROLE_PACK_CONTENT_CHANGED')).toBe(true);
  });

  it('快照读失败 ⇒ E_ROLE_PACK_OUTPUT_INVALID（INVALID 兜 load↔snapshot 窗口）', () => {
    writeRole();
    writeApprovalRecord();

    // 注入条件：装载说 approved，但同一时刻的快照读不到六件
    vi.mocked(readPieceBytesOnce).mockReturnValueOnce({
      ok: false,
      code: 'E_ROLE_PACK_PERSONA_UNREADABLE',
      reason: '(fault injection) 快照读取失败',
    });

    const reason = expectFail(loadRolePackOutputStandard(ROLE_ID), 'E_ROLE_PACK_OUTPUT_INVALID');

    expect(reason).toContain('load↔snapshot');
    expect(reason).toContain('(fault injection)');
  });
});
