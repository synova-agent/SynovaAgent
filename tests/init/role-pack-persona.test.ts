/**
 * tests/init/role-pack-persona.test.ts — 岗位包人设＋上下文清单解析判据（#1075 P2-2）
 *
 * 断言对象 = **生产路径**（`src/init/role-pack-persona.ts` 的 `loadRolePackPersona()`／`buildRoleLayer()`）——
 *   禁 grep 当验收（规格 §4 V-02）。夹具六件过 P2-1 的 v3 校验（结构/refs/pieces 对账全部真跑，
 *   本文件不伪造 `RolePack` 对象），审批记录走 P2-1 的 `JudgeRolePackApproval` 路径。
 *
 * 判据分组（与规格 §4 逐条对齐；本文件负责 J4／J9／J11／J12 ＋ 审批门 ＋ hash 自校验 ＋ J2 纯核面）:
 *   J4  创建门（数据面）：approved ⇒ ok；无记录 ⇒ `E_ROLE_PACK_NOT_APPROVED(pending)`；记录指纹不符 ⇒
 *       同码但 `unverified`（可区分）；撤销（删记录）⇒ 回到 pending。
 *   D11 hash 自校验：六件之一被改而记录指纹未更新 ⇒ `E_ROLE_PACK_CONTENT_CHANGED`，且该码**先于**审批门
 *       （此时记录已 stale＝unverified，却返回 CONTENT_CHANGED ⇒ 顺序可证）。
 *   J11 L10 闭环：第 7 个文件 ⇒ `E_ROLE_PACK_PERSONA_UNREADABLE`（第②道 `validation.ok`，reason 含
 *       `ROLE_PACK_PIECES_MISMATCH`）；`context-manifest.yaml` 换成符号链接 ⇒ 同码（同样先被第②道 pieces 集合拦下，
 *       本模块第③道的 `lstatSync` 分支作为**第二道**保留 —— 见模块 JSDoc「六件都做 lstat」）。
 *   J12 读入上限：恰 64 KiB(65536 B) ⇒ 通过；65537 B ⇒ `E_ROLE_PACK_PERSONA_INVALID`（点名文件＋字节数，未解析）。
 *       J12 的第二半（"别名膨胀样本 <64 KiB ⇒ 解析后限额触发"）由 **J12-c** 直接覆盖：YAML 锚点 ＋ 33 个别名
 *       ⇒ 文件远小于 64 KiB 却有 33 条 `contexts` 结构 ⇒ 由**解析后**的 `contexts ≤ 32` 限额拦下（点名 `contexts`）。
 *       🔴 这条证的是"**文件小 ≠ 结构小**"：64 KiB 闸之外，解析后限额是独立的一道。
 *   J9  限额边界（不截断）：`systemAddendum` 缺省/空白 ⇒ `''`、4000 过／4001 报错点名；`contexts` 32 过／33 报错；
 *       `label` 80/81、`why` 200/201、`source` 200/201（临界含、超 1 必红）。**期望码是字面量**，不由被测实现生成。
 *   J2  纯核面：`buildRoleLayer()` 逐字格式（整串精确相等）、两段皆空 ⇒ `''`、只出一段 ⇒ 不补分隔符；
 *       D13 回滚开关 ⇒ `''` ＋ `log.warn(degraded:true)`；**反例防偷解析** ⇒ `source` 指向的真实文件里写
 *       `SENTINEL_BODY_9f3`，输出**不含**该串（只注入指针）。
 *
 * 🔴 期望值来源：错误码与格式串全部**字面量硬编码**（规格 §4.5-C1／§2.3-C 逐字）；夹具侧的
 *   `contentHash` 用生产纯核 `computeRolePackContentHash()` **现算真值**（它不是断言期望值，而是
 *   "给审批记录填一个正确指纹"的唯一可靠办法 —— 手写 hex 必撞 `E_ROLE_PACK_CONTENT_CHANGED`）。
 *   唯一用生产函数产出期望值的是 `roleContentHash()`（同上，属夹具构造，不属判据）。
 *
 * 隔离手法：不落仓 —— 每个用例在 `mkdtempSync` 造**仓库形状**临时根
 *   `<fixture>/extensions/presets/roles/<id>/` 六件 ＋ `<fixture>/.synova/approvals/<id>.json`，
 *   `SYNOVA_PRESETS_ROOT` 指向内容根（生产同规则：审批根 = 内容根 `../..`）。
 *   **禁写真仓**；用后 `rmSync` 清理（失败也清）。
 *   角色 id 一律用**非出厂** id `ops`（出厂三包只信代码锚，记录覆盖不了锚 —— P2-1 KL-P2-6）。
 *
 * 环境前提：`SYNOVA_ORG_ID` 不设 ⇒ 审批租户 `default`；`SYNOVA_ROLE_PACK_PERSONA` 由用例自己开关并在
 *   afterEach 还原（不污染同进程的其它件）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRoleLayer,
  loadRolePackPersona,
  type RolePackPersona,
  type RolePackPersonaCode,
} from '../../src/init/role-pack-persona';
import { clearPresetCache } from '../../src/init/preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（G2 判据：每个失败码必有一条 log.warn；D13 回滚必带 degraded:true）
// 范式同 tests/init/role-pack-approval.test.ts:60-72
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
// 常量（本文件独立声明；与规格 §2.3 的字段级契约同值）
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

/** 夹具角色 id：**非出厂**（出厂 finance/hr/sales 只信代码锚，记录不得覆盖锚） */
const ROLE_ID = 'ops';

/** 块标量写法的 addendum 原文（`|` 保留尾换行 ⇒ 解析后应**原样**为 `"<本串>\\n"`） */
const ADDENDUM_TEXT = 'PERSONA_ADDENDUM_7c1 财务口径优先';

/** 审批记录的时间/身份/租户字段（自绑定口径见 P2-1 §2.2-D9） */
const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_p22_persona_fixture';
const APPROVER_ROLE = 'super-admin';
const APPROVAL_ORG_ID = 'default';

/** `contexts[]` 的缺省一条（字段名为 YAML 键，值为**原始 YAML 文本** ⇒ 可造非法值） */
const DEFAULT_CONTEXT: Readonly<Record<string, string>> = {
  id: 'ops.demo',
  label: '三表口径',
  source: 'knowledge-scope.yaml#ops.demo',
  why: '财务判断必须建立在同一套口径上',
  required: 'true',
};

/** 条目渲染器：第一个键带 `- `，其余缩进对齐 */
function renderContextItem(item: Readonly<Record<string, string>>): string[] {
  const keys = Object.keys(item);
  return keys.map((key, index) => `  ${index === 0 ? '- ' : '  '}${key}: ${item[key]}`);
}

/**
 * 造一份合法的 `context-manifest.yaml`（可覆盖 contexts／prompt 段以造边界与非法形态）。
 *
 * @param roleId - 顶层 `roleId`（用例可故意写成别的值来测身份绑定）
 * @param options.items - contexts 条目（缺省 = `[DEFAULT_CONTEXT]`；`[]` 渲染成 `contexts: []`）
 * @param options.omitContexts - 整段省略（缺省 ⇒ `[]`）
 * @param options.promptYaml - `prompt:` 段后的原始行（**含缩进**）；给定时不再输出缺省块标量
 * @param options.omitPrompt - 整段省略（缺省/纯空白 ⇒ `''` 的合法形态）
 */
function contextManifestYaml(
  roleId: string,
  options: {
    readonly items?: readonly Readonly<Record<string, string>>[];
    readonly omitContexts?: boolean;
    readonly promptYaml?: string;
    readonly omitPrompt?: boolean;
  } = {},
): string {
  const lines: string[] = [`roleId: ${roleId}`, 'version: 2'];
  if (options.omitContexts !== true) {
    const items = options.items ?? [DEFAULT_CONTEXT];
    if (items.length === 0) {
      lines.push('contexts: []');
    } else {
      lines.push('contexts:');
      for (const item of items) lines.push(...renderContextItem(item));
    }
  }
  if (options.omitPrompt !== true) {
    lines.push('prompt:');
    if (options.promptYaml === undefined) {
      lines.push('  systemAddendum: |', `    ${ADDENDUM_TEXT}`);
    } else {
      lines.push(options.promptYaml);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 最小合法 **v3** manifest（refs 与 `DEFAULT_CONTEXT.source` 对账一致） */
function manifestYaml(roleId: string, refs?: readonly Readonly<Record<string, string>>[]): Record<string, unknown> {
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
    refs: refs ?? [{ kind: 'scope', name: `${roleId}.demo` }],
  };
}

/** 五件内容件的缺省载荷（`knowledge-scope.yaml` 声明 `contexts[].source` 指向的 scope） */
function defaultPieceFiles(roleId: string): Record<string, string> {
  return {
    'knowledge-scope.yaml': `roleId: ${roleId}\nversion: 2\nscopes:\n  - id: ${roleId}.demo\n`,
    'context-manifest.yaml': contextManifestYaml(roleId),
    'output-template.ref': 'templateId: demo\nsections:\n  - id: summary\n    title: 摘要\n    must:\n      - 有结论\n',
    'capabilities.yaml': `roleId: ${roleId}\nversion: 2\ncapabilities:\n  - id: capability.demo\n    label: demo\n    enabled: true\n`,
    'acceptance-criteria.yaml': `roleId: ${roleId}\nversion: 2\ncriteria:\n  - id: ac.demo\n    text: demo\n`,
  };
}

/** 用例内可覆盖的角色布局 */
interface RoleLayout {
  readonly manifest?: Record<string, unknown>;
  readonly files?: Readonly<Record<string, string | Buffer>>;
  readonly omit?: readonly string[];
  readonly extraFiles?: Readonly<Record<string, string>>;
}

// ══════════════════════════════════════════════════════════════════════════════
// 夹具（仓库形状临时根；每个用例一个）
// ══════════════════════════════════════════════════════════════════════════════

let fixture: string;
let root: string;
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];
const ORIGINAL_ROLLBACK_ENV = process.env['SYNOVA_ROLE_PACK_PERSONA'];

/** 内容根：`<fixture>/extensions/presets`（= `SYNOVA_PRESETS_ROOT`） */
function rolesRoot(): string {
  return join(root, 'roles');
}

/** 审批根（生产同规则）：内容根 `../..` ⇒ `<fixture>/.synova/approvals` */
function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

/** 造一个齐备的角色包目录（可覆盖单件／省略件／加第 7 件） */
function writeRole(roleId: string = ROLE_ID, layout: RoleLayout = {}): string {
  const dir = join(rolesRoot(), roleId);
  mkdirSync(dir, { recursive: true });
  const manifest = layout.manifest ?? manifestYaml(roleId);
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const files: Record<string, string | Buffer> = { ...defaultPieceFiles(roleId), ...(layout.files ?? {}) };
  for (const piece of PIECES) {
    if (piece === 'manifest.json') continue;
    if (layout.omit?.includes(piece) === true) continue;
    const content = files[piece];
    if (content === undefined) continue;
    writeFileSync(join(dir, piece), content);
  }
  for (const [name, content] of Object.entries(layout.extraFiles ?? {})) {
    writeFileSync(join(dir, name), content, 'utf8');
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
  roleId: string = ROLE_ID,
  options: { readonly contentHash?: string; readonly scope?: 'content' | 'content+permissions' } = {},
): void {
  const contentHash = options.contentHash ?? roleContentHash(roleId);
  const scope = options.scope ?? 'content+permissions';
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

/** 断言拿到 `ok:true` 并返回 persona（失败时给出 code／reason，便于定位） */
function expectOk(roleId: string = ROLE_ID): RolePackPersona {
  const result = loadRolePackPersona(roleId);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`期望 ok:true，实得 ${result.code}: ${result.reason}`);
  return result.persona;
}

/** 断言拿到指定错误码并返回 reason（code 由用例字面量钉死，不由被测实现生成） */
function expectFail(roleId: string, code: RolePackPersonaCode): string {
  const result = loadRolePackPersona(roleId);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('期望 ok:false，实得 ok:true');
  expect(result.code).toBe(code);
  return result.reason;
}

/** 把一份 YAML 源码补齐到**恰好** `targetBytes` 字节（补一行注释；不破坏结构与 refs） */
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

/**
 * 造一个 `source` 恰 `totalChars` 字符的**合法**夹具（scope 形态）：
 * `source = knowledge-scope.yaml#<scopeId>`，同包 `knowledge-scope.yaml` 声明该 scope，
 * `manifest.refs` 声明之 —— 否则 P2-1 的 refs 对账会先红（那样就测不到本模块的 source 限额了）。
 */
function scopeSourceFixture(totalChars: number): {
  readonly source: string;
  readonly manifest: Record<string, unknown>;
  readonly files: Record<string, string>;
} {
  const prefix = 'knowledge-scope.yaml#';
  const scopeId = `s${'a'.repeat(Math.max(0, totalChars - prefix.length - 1))}`;
  const source = `${prefix}${scopeId}`;
  if (source.length !== totalChars) throw new Error(`scope source 长度构造失败: ${String(source.length)}`);
  return {
    source,
    manifest: manifestYaml(ROLE_ID, [{ kind: 'scope', name: scopeId }]),
    files: { 'knowledge-scope.yaml': `roleId: ${ROLE_ID}\nversion: 2\nscopes:\n  - id: ${scopeId}\n` },
  };
}

/** 日志里是否出现过带指定 `code` 的 warn（G2：失败必留痕） */
function warnWithCode(code: string): boolean {
  return logCalls.some((call) => call.level === 'warn' && call.meta?.['code'] === code);
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'rp-persona-'));
  root = join(fixture, 'extensions', 'presets');
  mkdirSync(rolesRoot(), { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  delete process.env['SYNOVA_ROLE_PACK_PERSONA'];
  logCalls.length = 0;
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
  if (ORIGINAL_ROLLBACK_ENV === undefined) delete process.env['SYNOVA_ROLE_PACK_PERSONA'];
  else process.env['SYNOVA_ROLE_PACK_PERSONA'] = ORIGINAL_ROLLBACK_ENV;
  clearPresetCache();
});

// ══════════════════════════════════════════════════════════════════════════════
// J4 ＋ 审批门（数据面：创建门／复核态／撤销）
// ══════════════════════════════════════════════════════════════════════════════

describe('J4／审批门 — 人设面的创建门与复核态', () => {
  it('approved 包 ⇒ ok:true；roleId／systemAddendum／contexts 逐字段与包内容一致', () => {
    writeRole();
    writeApprovalRecord();

    const persona = expectOk();

    expect(persona.roleId).toBe(ROLE_ID);
    // 块标量 `|` 的尾换行**原样保留**（不静默改写内容；渲染时由 buildRoleLayer 归一）
    expect(persona.systemAddendum).toBe(`${ADDENDUM_TEXT}\n`);
    expect(persona.contexts).toHaveLength(1);
    expect(persona.contexts[0]).toEqual({
      id: 'ops.demo',
      label: '三表口径',
      source: 'knowledge-scope.yaml#ops.demo',
      why: '财务判断必须建立在同一套口径上',
      required: true,
    });
  });

  it('roleId 不存在 ⇒ E_ROLE_PACK_NOT_FOUND（reason 点名 roleId 与内容根）', () => {
    // 内容根里一个角色都没有
    const reason = expectFail('no-such-role', 'E_ROLE_PACK_NOT_FOUND');

    expect(reason).toContain('no-such-role');
    expect(reason).toContain(root);
    expect(warnWithCode('E_ROLE_PACK_NOT_FOUND')).toBe(true);
  });

  it('无审批记录 ⇒ E_ROLE_PACK_NOT_APPROVED（pending；与 unverified 可区分）', () => {
    writeRole();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_NOT_APPROVED');

    expect(reason).toContain('pending');
    expect(reason).not.toContain('unverified');
    expect(warnWithCode('E_ROLE_PACK_NOT_APPROVED')).toBe(true);
  });

  it('记录指纹与内容不符（内容未动、记录被改）⇒ 同报 CONTENT_CHANGED（P2-1 只知两侧不等，不分方向）', () => {
    writeRole();
    // 指纹全 f ⇒ 与当前六件不符；P2-1 的审批门 code=E_APPROVAL_CONTENT_CHANGED
    writeApprovalRecord(ROLE_ID, { contentHash: 'f'.repeat(64) });

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CONTENT_CHANGED');

    expect(reason).toContain('六件内容与审批记录不符');
    expect(reason).toContain('E_APPROVAL_CONTENT_CHANGED');
  });

  it('记录自绑定被改（指纹对得上）⇒ unverified 归 NOT_APPROVED，与 pending 可区分', () => {
    writeRole();
    writeApprovalRecord();
    // 只改 approvalId ⇒ P2-1 第⑥步 E_APPROVAL_ID_MISMATCH（unverified），内容指纹仍相等
    const recordPath = join(approvalsRoot(), `${ROLE_ID}.json`);
    const record: Record<string, unknown> = JSON.parse(readFileSync(recordPath, 'utf8'));
    record['approvalId'] = 'apv1:0000000000000000';
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_NOT_APPROVED');

    expect(reason).toContain('unverified');
    expect(reason).toContain('E_APPROVAL_ID_MISMATCH');
    expect(reason).not.toContain('审批态 pending');
  });

  it('批准后删记录（撤销）⇒ E_ROLE_PACK_NOT_APPROVED（复核态回到 pending）', () => {
    writeRole();
    writeApprovalRecord();
    expect(expectOk().roleId).toBe(ROLE_ID);

    removeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_NOT_APPROVED');

    expect(reason).toContain('pending');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D11 hash 自校验（六件自读 → 与校验期指纹比对）
// ══════════════════════════════════════════════════════════════════════════════

describe('D11／hash 自校验 — 内容被改即失效，且先于审批门', () => {
  it('六件之一被改而记录指纹仍旧 ⇒ E_ROLE_PACK_CONTENT_CHANGED（不是 NOT_APPROVED）', () => {
    writeRole();
    const hashBeforeTamper = roleContentHash();
    writeApprovalRecord(ROLE_ID, { contentHash: hashBeforeTamper });
    expect(expectOk().roleId).toBe(ROLE_ID);

    // 篡改：往 capabilities.yaml 追加一行注释（结构/refs 仍合法 ⇒ 第②道放行，专测第④道）
    const capabilitiesPath = join(rolesRoot(), ROLE_ID, 'capabilities.yaml');
    writeFileSync(capabilitiesPath, `${readFileSync(capabilitiesPath, 'utf8')}# tampered\n`, 'utf8');

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_CONTENT_CHANGED');

    // 🔴 顺序证据：此刻记录已 stale（P2-1 判 unverified 且 code=E_APPROVAL_CONTENT_CHANGED），
    // 却返回 CONTENT_CHANGED ⇒ 第⑤步的审批门子案映射生效（第④步自读比对只在 TOCTOU 窗口内触发）。
    expect(reason).toContain('六件内容与审批记录不符');
    expect(reason).toContain(hashBeforeTamper);
    expect(warnWithCode('E_ROLE_PACK_CONTENT_CHANGED')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J11 · L10 闭环（第 7 件／符号链接）
// ══════════════════════════════════════════════════════════════════════════════

describe('J11／L10 闭环 — 第 7 件与符号链接', () => {
  it('包内加第 7 个文件 ⇒ E_ROLE_PACK_PERSONA_UNREADABLE（第②道 validation.ok，reason 含 PIECES_MISMATCH）', () => {
    writeRole(ROLE_ID, { extraFiles: { 'seventh-piece.yaml': 'extra: 1\n' } });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_UNREADABLE');

    // 由第②道（P2-1 结构/refs 校验）拦下，不是第③道 lstat —— 见模块 JSDoc 判定序
    expect(reason).toContain('结构/refs 校验未通过');
    expect(reason).toContain('ROLE_PACK_PIECES_MISMATCH');
    expect(reason).toContain('seventh-piece.yaml');
  });

  it('context-manifest.yaml 换成符号链接 ⇒ E_ROLE_PACK_PERSONA_UNREADABLE（由第②道 pieces 集合拦下）', () => {
    writeRole();
    // 把真件挪到包外、原位置换成符号链接（内容不变 ⇒ 指纹仍可对上，专测"非普通文件"这一面）
    const realPath = join(fixture, 'context-manifest.real.yaml');
    const manifestPath = join(rolesRoot(), ROLE_ID, 'context-manifest.yaml');
    const originalContent = readFileSync(manifestPath);
    writeFileSync(realPath, originalContent);
    rmSync(manifestPath);
    symlinkSync(realPath, manifestPath);
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_UNREADABLE');

    // P2-1 的 readdir isFile() 对符号链接为 false ⇒ 第②道 pieces 不一致；本模块第③道 lstat 是第二道
    expect(reason).toContain('结构/refs 校验未通过');
    expect(reason).toContain('ROLE_PACK_PIECES_MISMATCH');
    expect(reason).toContain('context-manifest.yaml');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J12 · 读入上限（lstat 先于解析）
// ══════════════════════════════════════════════════════════════════════════════

describe('J12／读入上限与解析后限额 — 64 KiB 闸 ＋ 别名膨胀（文件小 ≠ 结构小）', () => {
  it('恰 65536 B ⇒ 通过（临界含）', () => {
    const padded = padYamlToBytes(contextManifestYaml(ROLE_ID), 64 * 1024);
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': padded } });
    // 自证夹具真的恰好 65536 B（不是"大概"）
    expect(readFileSync(join(rolesRoot(), ROLE_ID, 'context-manifest.yaml')).length).toBe(65536);
    writeApprovalRecord();

    const persona = expectOk();

    expect(persona.contexts).toHaveLength(1);
  });

  it('65537 B ⇒ E_ROLE_PACK_PERSONA_INVALID，reason 点名文件＋字节数（未进入解析）', () => {
    const oversized = padYamlToBytes(contextManifestYaml(ROLE_ID), 64 * 1024 + 1);
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': oversized } });
    expect(readFileSync(join(rolesRoot(), ROLE_ID, 'context-manifest.yaml')).length).toBe(65537);
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('context-manifest.yaml');
    expect(reason).toContain('65537');
    expect(reason).toContain('64 KiB');
    expect(warnWithCode('E_ROLE_PACK_PERSONA_INVALID')).toBe(true);
  });

  it('J12-c 别名膨胀：文件 <64 KiB 但锚点别名展开成 33 条 contexts ⇒ 解析后限额触发（文件小 ≠ 结构小）', () => {
    // 同一个 context 条目用 YAML 锚点 `&c` 定义，`contexts` 里用 33 个 `*c` 别名引用它。
    // 证据要点：**字节数远小于 64 KiB**（64 KiB 闸不可能拦它），结构却有 33 条 ⇒ 必须由**解析后**的
    // `contexts ≤ 32` 限额拦下（规格 §4 J12 第二支："若样本 <64 KiB 则解析后限额触发；两种都要有用例"）。
    const aliasExpanded = [
      `roleId: ${ROLE_ID}`,
      'version: 2',
      'contextTemplate: &c',
      '  id: ops.demo',
      '  label: 三表口径',
      '  source: knowledge-scope.yaml#ops.demo',
      '  why: 财务判断必须建立在同一套口径上',
      '  required: true',
      'contexts:',
      ...Array.from({ length: 33 }, () => '  - *c'),
      'prompt:',
      '  systemAddendum: |',
      `    ${ADDENDUM_TEXT}`,
      '',
    ].join('\n');
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': aliasExpanded } });

    // 自证"文件小"：实际字节数 ≤ 64 KiB（⇒ 不是第③/④b 道的读入上限拦的）
    const onDiskBytes = readFileSync(join(rolesRoot(), ROLE_ID, 'context-manifest.yaml')).length;
    expect(Buffer.byteLength(aliasExpanded, 'utf8')).toBe(onDiskBytes);
    expect(onDiskBytes).toBeLessThanOrEqual(64 * 1024);
    expect(onDiskBytes).toBeLessThan(4096); // 远小于 64 KiB（同一事实的可读版）

    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    // 点名 contexts 与条数；且确实不是 64 KiB 那一支
    expect(reason).toContain('contexts');
    expect(reason).toContain('33');
    expect(reason).toContain('32');
    expect(reason).not.toContain('64 KiB');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J9 · 限额边界（临界含、超 1 必红、**绝不截断**）
// ══════════════════════════════════════════════════════════════════════════════

describe('J9／systemAddendum 限额（0..4000；缺省/纯空白 ⇒ 空串）', () => {
  it('缺省 prompt 段 ⇒ systemAddendum 为 空串（合法；无「岗位设定」段，清单段仍在）', () => {
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { omitPrompt: true }) } });
    writeApprovalRecord();

    const persona = expectOk();
    const layer = buildRoleLayer(persona);

    expect(persona.systemAddendum).toBe('');
    expect(layer).not.toContain('## 岗位设定：');
    expect(layer).toContain('## 该岗位应带的上下文（按需读取，不要凭空假设）');
  });

  it('纯空白 addendum ⇒ 归一为 空串（合法，不报错）', () => {
    writeRole(ROLE_ID, {
      files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { promptYaml: '  systemAddendum: "   "' }) },
    });
    writeApprovalRecord();

    expect(expectOk().systemAddendum).toBe('');
  });

  it('恰 4000 字符 ⇒ 通过（临界含）', () => {
    const text = 'x'.repeat(4000);
    writeRole(ROLE_ID, {
      files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { promptYaml: `  systemAddendum: "${text}"` }) },
    });
    writeApprovalRecord();

    expect(expectOk().systemAddendum).toHaveLength(4000);
  });

  it('4001 字符 ⇒ E_ROLE_PACK_PERSONA_INVALID，点名 prompt.systemAddendum（不截断）', () => {
    const text = 'x'.repeat(4001);
    writeRole(ROLE_ID, {
      files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { promptYaml: `  systemAddendum: "${text}"` }) },
    });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('prompt.systemAddendum');
    expect(reason).toContain('4001');
    expect(reason).toContain('4000');
  });

  it('非字符串（数字）⇒ E_ROLE_PACK_PERSONA_INVALID，点名 prompt.systemAddendum', () => {
    writeRole(ROLE_ID, {
      files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { promptYaml: '  systemAddendum: 12345' }) },
    });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('prompt.systemAddendum');
    expect(reason).toContain('必须是 string');
  });

  it('显式 null ⇒ E_ROLE_PACK_PERSONA_INVALID（"缺失"≠"null" —— L1 裁定，不放宽）', () => {
    writeRole(ROLE_ID, {
      files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { promptYaml: '  systemAddendum:' }) },
    });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('prompt.systemAddendum');
    expect(reason).toContain('null');
  });
});

describe('J9／contexts 与字段限额（≤32；id 64／label 80／source 200／why 200）', () => {
  it('contexts 恰 32 条 ⇒ 通过（临界含）', () => {
    const items = Array.from({ length: 32 }, (_, index) => ({ ...DEFAULT_CONTEXT, id: `ops.c${String(index)}` }));
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { items }) } });
    writeApprovalRecord();

    expect(expectOk().contexts).toHaveLength(32);
  });

  it('contexts 33 条 ⇒ E_ROLE_PACK_PERSONA_INVALID（reason 点名 33 > 32，不截断）', () => {
    const items = Array.from({ length: 33 }, (_, index) => ({ ...DEFAULT_CONTEXT, id: `ops.c${String(index)}` }));
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { items }) } });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('33');
    expect(reason).toContain('32');
  });

  it('label 80 字符 ⇒ 通过；81 字符 ⇒ INVALID 且点名 contexts[0].label', () => {
    writeRole(ROLE_ID, {
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, label: `"${'l'.repeat(80)}"` }],
        }),
      },
    });
    writeApprovalRecord();
    expect(expectOk().contexts[0]?.label).toHaveLength(80);

    // 同一夹具换成 81 字符 ⇒ 必红（不截断）
    writeRole(ROLE_ID, {
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, label: `"${'l'.repeat(81)}"` }],
        }),
      },
    });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');
    expect(reason).toContain('contexts[0].label');
    expect(reason).toContain('81');
  });

  it('why 200 字符 ⇒ 通过；201 字符 ⇒ INVALID 且点名 contexts[0].why', () => {
    writeRole(ROLE_ID, {
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, why: `"${'w'.repeat(200)}"` }],
        }),
      },
    });
    writeApprovalRecord();
    expect(expectOk().contexts[0]?.why).toHaveLength(200);

    writeRole(ROLE_ID, {
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, why: `"${'w'.repeat(201)}"` }],
        }),
      },
    });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');
    expect(reason).toContain('contexts[0].why');
    expect(reason).toContain('201');
  });

  it('source 200 字符 ⇒ 通过；201 字符 ⇒ INVALID 且点名 contexts[0].source', () => {
    const at200 = scopeSourceFixture(200);
    writeRole(ROLE_ID, {
      manifest: at200.manifest,
      files: {
        ...at200.files,
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, source: at200.source }],
        }),
      },
    });
    writeApprovalRecord();
    expect(expectOk().contexts[0]?.source).toHaveLength(200);

    const at201 = scopeSourceFixture(201);
    writeRole(ROLE_ID, {
      manifest: at201.manifest,
      files: {
        ...at201.files,
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, source: at201.source }],
        }),
      },
    });
    writeApprovalRecord();
    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');
    expect(reason).toContain('contexts[0].source');
    expect(reason).toContain('201');
  });

  it('id 缺省／超 64 字符 ⇒ INVALID 且点名 contexts[0].id', () => {
    const noId: Record<string, string> = { ...DEFAULT_CONTEXT };
    delete noId['id'];
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { items: [noId] }) } });
    writeApprovalRecord();
    const missingReason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');
    expect(missingReason).toContain('contexts[0].id');
    expect(missingReason).toContain('缺省');

    writeRole(ROLE_ID, {
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, id: `"${'i'.repeat(65)}"` }],
        }),
      },
    });
    writeApprovalRecord();
    const tooLongReason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');
    expect(tooLongReason).toContain('contexts[0].id');
    expect(tooLongReason).toContain('65');
  });

  it('required 非 boolean ⇒ INVALID 且点名 contexts[0].required', () => {
    writeRole(ROLE_ID, {
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, required: '1' }],
        }),
      },
    });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('contexts[0].required');
    expect(reason).toContain('boolean');
  });

  it('contexts: [] ⇒ 合法（空清单；无清单段）', () => {
    // refs 必须同步为空：`contexts: []` 投影不出 ref ⇒ manifest.refs 若仍声明 scope 会成为孤儿引用（P2-1 对账）
    writeRole(ROLE_ID, {
      manifest: manifestYaml(ROLE_ID, []),
      files: { 'context-manifest.yaml': contextManifestYaml(ROLE_ID, { items: [] }) },
    });
    writeApprovalRecord();

    const persona = expectOk();

    expect(persona.contexts).toHaveLength(0);
    expect(buildRoleLayer(persona)).not.toContain('## 该岗位应带的上下文');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 结构用例（YAML 语义／身份绑定／类型）
// ══════════════════════════════════════════════════════════════════════════════

describe('结构用例 — YAML 语义与身份绑定', () => {
  it('context-manifest 的 roleId 与目录名不符 ⇒ INVALID（点名两侧值）', () => {
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': contextManifestYaml('someone-else') } });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_INVALID');

    expect(reason).toContain('someone-else');
    expect(reason).toContain(`"${ROLE_ID}"`);
  });

  it('YAML 重复键 ⇒ E_ROLE_PACK_PERSONA_UNREADABLE（重复键按不可读处置）', () => {
    const duplicated = [
      `roleId: ${ROLE_ID}`,
      `roleId: ${ROLE_ID}`,
      'contexts: []',
      '',
    ].join('\n');
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': duplicated } });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_UNREADABLE');

    // 由第②道拦下：P2-1 装载期也要解析同一份 YAML（重复键 ⇒ js-yaml 抛）⇒ validation.ok:false
    expect(reason).toContain('结构/refs 校验未通过');
    expect(reason).toContain('YAML 解析失败');
  });

  it('contexts 条目不是映射（字符串）⇒ E_ROLE_PACK_PERSONA_UNREADABLE（第②道点名 contexts[0]）', () => {
    const broken = `roleId: ${ROLE_ID}\nversion: 2\ncontexts:\n  - just-a-string\n`;
    writeRole(ROLE_ID, { files: { 'context-manifest.yaml': broken } });
    writeApprovalRecord();

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_UNREADABLE');

    // 由第②道拦下（P2-1 的 refs 投影要求每条 contexts 是映射）；本模块第⑥步的同名分支是第二道
    expect(reason).toContain('结构/refs 校验未通过');
    expect(reason).toContain('contexts[0]');
  });

  it('缺一件（acceptance-criteria.yaml）⇒ E_ROLE_PACK_PERSONA_UNREADABLE（第②道 pieces 不一致）', () => {
    writeRole(ROLE_ID, { omit: ['acceptance-criteria.yaml'] });
    // 记录按"缺一件"的现状算不出六件指纹 ⇒ 用显式 hash 造记录（审批门不是本用例的被测面）
    writeApprovalRecord(ROLE_ID, { contentHash: 'a'.repeat(64) });

    const reason = expectFail(ROLE_ID, 'E_ROLE_PACK_PERSONA_UNREADABLE');

    expect(reason).toContain('ROLE_PACK_PIECES_MISMATCH');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 · buildRoleLayer 纯核面（逐字格式／两段皆空／D13／防偷解析）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2／buildRoleLayer — 逐字格式与回滚开关', () => {
  it('逐字格式：段序、[必带]/[选带]、——、source 指针（整串精确相等）', () => {
    const persona: RolePackPersona = {
      roleId: 'ops',
      systemAddendum: 'ADDENDUM_7c1',
      contexts: [
        {
          id: 'ops.three',
          label: '三表口径',
          source: 'extensions/ontology/outcome/financial.json',
          why: '财务判断必须建立在同一套口径上',
          required: true,
        },
        {
          id: 'company.bp',
          label: '公司业务说明',
          source: 'profile.business-plan',
          why: '财务结论要落回业务动作',
          required: false,
        },
      ],
    };

    const expected = [
      '## 岗位设定：ops',
      'ADDENDUM_7c1',
      '',
      '## 该岗位应带的上下文（按需读取，不要凭空假设）',
      '- [必带] 三表口径 —— 财务判断必须建立在同一套口径上（source: extensions/ontology/outcome/financial.json）',
      '- [选带] 公司业务说明 —— 财务结论要落回业务动作（source: profile.business-plan）',
    ].join('\n');

    expect(buildRoleLayer(persona)).toBe(expected);
  });

  it('两段皆空 ⇒ 返回空串（不是分隔符）', () => {
    const layer = buildRoleLayer({ roleId: 'ops', systemAddendum: '', contexts: [] });

    expect(layer).toBe('');
  });

  it('只有 addendum ⇒ 只出第一段（不补清单标题）；只有清单 ⇒ 只出第二段', () => {
    const addendumOnly = buildRoleLayer({
      roleId: 'ops',
      systemAddendum: '只有人设',
      contexts: [],
    });
    expect(addendumOnly).toBe('## 岗位设定：ops\n只有人设');
    expect(addendumOnly).not.toContain('## 该岗位应带的上下文');

    const contextsOnly = buildRoleLayer({
      roleId: 'ops',
      systemAddendum: '',
      contexts: [
        { id: 'ops.x', label: '标签', source: 'profile.business-plan', why: '原因', required: false },
      ],
    });
    expect(contextsOnly).not.toContain('## 岗位设定：');
    expect(contextsOnly.startsWith('## 该岗位应带的上下文（按需读取，不要凭空假设）\n- [选带] 标签')).toBe(true);
  });

  it('D13：SYNOVA_ROLE_PACK_PERSONA=off ⇒ 返回空串 ＋ 一条 log.warn（degraded:true）', () => {
    const persona: RolePackPersona = {
      roleId: 'ops',
      systemAddendum: 'SETTING_9a1',
      contexts: [
        { id: 'ops.x', label: '标签', source: 'profile.business-plan', why: '原因', required: true },
      ],
    };
    expect(buildRoleLayer(persona)).toContain('SETTING_9a1');

    process.env['SYNOVA_ROLE_PACK_PERSONA'] = 'off';
    logCalls.length = 0;

    expect(buildRoleLayer(persona)).toBe('');
    const degradedWarn = logCalls.find(
      (call) => call.level === 'warn' && call.meta?.['degraded'] === true,
    );
    expect(degradedWarn).toBeDefined();
    expect(degradedWarn?.meta?.['env']).toBe('SYNOVA_ROLE_PACK_PERSONA');
  });

  it('反例防偷解析：source 指向的真实文件含 SENTINEL_BODY_9f3 ⇒ 输出不含该串（只注入指针）', () => {
    // 真实存在的内容文件（P2-1 的 kind=file refs 存在性校验需要它存在）
    const contentDir = join(fixture, 'extensions', 'ontology', 'outcome');
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, 'financial.json'), '{"body":"SENTINEL_BODY_9f3"}\n', 'utf8');

    const fileRefPath = 'extensions/ontology/outcome/financial.json';
    writeRole(ROLE_ID, {
      manifest: manifestYaml(ROLE_ID, [{ kind: 'file', path: fileRefPath }]),
      files: {
        'context-manifest.yaml': contextManifestYaml(ROLE_ID, {
          items: [{ ...DEFAULT_CONTEXT, source: fileRefPath, required: 'false' }],
        }),
      },
    });
    writeApprovalRecord();

    const persona = expectOk();
    const layer = buildRoleLayer(persona);

    expect(persona.contexts[0]?.source).toBe(fileRefPath);
    expect(layer).toContain(`（source: ${fileRefPath}）`);
    // 🔴 红线：只注入清单指针，绝不读 source 指向的内容
    expect(layer).not.toContain('SENTINEL_BODY_9f3');
    expect(layer).not.toContain('"body"');
  });
});
