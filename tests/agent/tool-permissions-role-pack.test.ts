/**
 * tests/agent/tool-permissions-role-pack.test.ts — #1075 P2-4a 工具白名单／权限生效（装配面判据）
 *
 * 断言对象 = **生产装配**：真 `ToolRegistry`（`src/agent/tools.ts` 的 `setAllowedTools()`／
 *   `allToolNames()`／`execute()` 白名单拒／`listTools()`／`toOpenAITools()`）＋ 真
 *   `ConversationEngine`（构造期 `rolePack`／`setRolePack()`／`fromState()`／`processMessage()` 入口
 *   惰性应用／`refreshRolePackPermissions()`）＋ 真 `registerBuiltinTools()`（生产注册路径）＋
 *   真 `SessionStore`（`:memory:` SQLite）＋ 真权限编译模块（`src/init/role-pack-permissions.ts`）。
 *   **禁 mock 注册表判定**（铁律 12）；只替换 provider 这一外部传输边界（同 tests/agent/tool-cancel.test.ts 形态）。
 *
 * 判据分组（与派单 §4 逐条对齐）:
 *   J1 时序A：`setRolePack()` 先于 `registerBuiltinTools()` ⇒ 注册表空时**不误判全拒**（execute 返
 *      "未知工具"而非 `TOOL_PERMISSION_DENIED`）；随后 `refreshRolePackPermissions()` 惰性应用成功，
 *      已声明∩已注册工具可执行（真 handler 被调）。
 *   J1 时序B：`new ConversationEngine({rolePack})`（路由 cache-miss 首轮形态）→ 注册工具 →
 *      首轮 `processMessage()` 入口自动应用 ⇒ 白名单生效，**首轮不 fail-open**。
 *   J1 knownTools 原始清单：先应用一次白名单，再把"声明了但当时未注册"的工具晚注册 ⇒ 再次 refresh
 *      必须放行 —— 若实现拿 `listTools()`（已被白名单过滤）当 knownTools，本用例必红。
 *   J1 权限待批：审批 `scope='content'` ＋ 包声明了 tool ⇒ `permissionsPending` ⇒ allowlist=[]（全拒）
 *      ＋ `log.warn` 点名"权限待批"（D4）。
 *   J2 未列即拒：未声明工具 ⇒ 结构化 `TOOL_PERMISSION_DENIED`、handler **零调用**、`log.warn` 恰一条；
 *      `listTools()` 与 `toOpenAITools()` 都不含未列项（且必须清 `_cachedOpenAITools` 旧缓存）。
 *   J3 enabled:false 硬拒：合成夹具 `cap.evolution-write`／`tool:'query_ontology'`／`enabled:false`，
 *      即使另有 enabled 能力声明同一 tool，也**不得**进 allowlist（disabled 优先）；日志点名能力 id。
 *   J6 未绑定零变化（回归）：fresh engine `setRolePack(null)` ⇒ `setAllowedTools(null)`，既有工具全可见可调；
 *      对照：**已绑定但复核失败**（`rolePack=null` 而 `boundRolePackId` 保留）⇒ `[]` fail-closed（D12）。
 *   J5 撤销（engine 面）：已绑定并已放行后**删除审批记录** ⇒ 再次 `refreshRolePackPermissions()` ⇒
 *      `listTools()=[]`、执行返 `TOOL_PERMISSION_DENIED`、日志点名 `E_ROLE_PACK_NOT_APPROVED`。
 *   D8 回滚：`SYNOVA_ROLE_PACK_TOOLS=off` ⇒ `setAllowedTools(null)` ＋ warn（显式降级）。
 *   J1 恢复路径：`fromState` 从快照 `rolePackId` 恢复绑定，refresh 后按快照岗位生效；无 `rolePackId` 的快照零变化。
 *
 * 夹具（隔离手法，同 tests/init/role-pack-persona.test.ts）：每个用例 `mkdtempSync` 造**仓库形状**临时根
 *   `<fixture>/extensions/presets/roles/ops/`（六件齐备＋v3 manifest＋refs 对账）＋
 *   `<fixture>/.synova/approvals/ops.json`（contentHash 用生产纯核现算；approvalId 自绑定）；
 *   `SYNOVA_PRESETS_ROOT` 指向内容根；**禁写真仓/三包**；角色 id 用**非出厂** `ops`。
 *   `knownTools` 走**真实注册表**（`registerBuiltinTools()` ＋ 测试探针工具），不注入假清单。
 *
 * @degraded 本文件只用 logger 捕获判"留痕"（G2）；不产生网络/磁盘写仓副作用。
 * @authority 判据归属 #1075 P2-4a（规格 §4 J1/J2/J3/J6 ＋ §2.3-C/D）；J4/J5 归权限编译模块测试件。
 *
 * 已知限制：
 *   ① 不测真实模型行为（LLM 用 fake provider；只证"白名单进到执行门"）；
 *   ② 不测 J7 改坏必红（由独立自验在隔离沙箱施加，本文件只保留可改坏的判据）；
 *   ③ `query_ontology` 的真实 handler 会打本机 API（J3 只走到白名单拒绝，不进 handler）；
 *   ④ 不覆盖 HTTP 面（路由不新增字段；授权/降级头归 P2-2/P2-3 路由测试件）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '../../src/agent/conversation-engine';
import { registerBuiltinTools } from '../../src/agent/builtin-tools';
import { ToolRegistry, type ToolCallResult, type ToolDefinition } from '../../src/agent/tools';
import { SessionStore } from '../../src/store/session-store';
import { clearPresetCache } from '../../src/init/preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';
import type { RolePackPersona } from '../../src/init/role-pack-persona';
import type { ChatResult, LLMMessage, LLMProvider, StreamCallback } from '../../src/providers/types';

// ══════════════════════════════════════════════════════════════════════════════
// 日志运行期捕获（G2 判据：拒绝/降级必留痕；范式同 tests/init/role-pack-persona.test.ts）
// ══════════════════════════════════════════════════════════════════════════════

const logCalls = vi.hoisted(() => [] as { level: string; meta?: Record<string, unknown>; msg?: unknown }[]);

vi.mock('@synova/logger', () => {
  const capture = (level: string) => (first?: unknown, second?: unknown) => {
    if (typeof first === 'object' && first !== null) {
      logCalls.push({ level, meta: first as Record<string, unknown>, msg: second });
    } else {
      logCalls.push({ level, msg: first ?? second });
    }
  };
  const m = {
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    debug: capture('debug'),
    fatal: capture('fatal'),
    trace: capture('trace'),
  };
  return { logger: m, createLogger: () => m };
});

// ══════════════════════════════════════════════════════════════════════════════
// 夹具常量（本文件独立声明；与规格 §2.3 的字段级契约同值）
// ══════════════════════════════════════════════════════════════════════════════

/** 六件（顺序即契约顺序） */
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

const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_p24a_wire_fixture';
const APPROVER_ROLE = 'super-admin';
const APPROVAL_ORG_ID = 'default';

/** 探针工具名（已注册但**未**被包声明 ⇒ 未列即拒的靶） */
const PROBE_DENIED = 'probe_denied_p24a';
/** 探针工具名（包声明且已注册 ⇒ 放行，且能数 handler 调用次数） */
const PROBE_ALLOWED = 'probe_allowed_p24a';
/** 探针工具名（包声明但**首轮未注册** ⇒ 未落地；晚注册后应放行，防 knownTools=listTools 回归） */
const PROBE_LATE = 'probe_late_p24a';

// ══════════════════════════════════════════════════════════════════════════════
// 夹具（仓库形状临时根；每个用例一个）
// ══════════════════════════════════════════════════════════════════════════════

let fixture: string;
let root: string;
const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];
const ORIGINAL_ROLE_PACK_TOOLS = process.env['SYNOVA_ROLE_PACK_TOOLS'];
const ORIGINAL_ORG_ID = process.env['SYNOVA_ORG_ID'];

/** 内容根：`<fixture>/extensions/presets`（= `SYNOVA_PRESETS_ROOT`） */
function rolesRoot(): string {
  return join(root, 'roles');
}

/** 审批根（生产同规则）：内容根 `../..` ⇒ `<fixture>/.synova/approvals` */
function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

/** 合法 v3 manifest（refs 与 context-manifest 的 contexts[].source 对账一致） */
function manifestYaml(roleId: string): Record<string, unknown> {
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

/** 能力条目夹具（`enabled` 缺省 true；`tool` 缺省 = 无工具声明） */
interface CapabilityFixture {
  readonly id: string;
  readonly label: string;
  readonly tool?: string;
  readonly enabled?: boolean;
  readonly disabledReason?: string;
}

/** 渲染 `capabilities.yaml`（可造 0 条；tool/enabled/disabledReason 按需出现） */
function capabilitiesYaml(roleId: string, capabilities: readonly CapabilityFixture[]): string {
  const lines: string[] = [`roleId: ${roleId}`, 'version: 2'];
  if (capabilities.length === 0) {
    lines.push('capabilities: []');
    return `${lines.join('\n')}\n`;
  }
  lines.push('capabilities:');
  for (const cap of capabilities) {
    lines.push(`  - id: ${cap.id}`);
    lines.push(`    label: ${cap.label}`);
    if (cap.tool !== undefined) lines.push(`    tool: ${cap.tool}`);
    lines.push(`    enabled: ${cap.enabled === false ? 'false' : 'true'}`);
    if (cap.disabledReason !== undefined) lines.push(`    disabledReason: ${cap.disabledReason}`);
  }
  return `${lines.join('\n')}\n`;
}

/** 缺省能力声明：两条可放行（一条是真实内置工具，一条是测试探针）＋一条未落地 */
function defaultCapabilities(): readonly CapabilityFixture[] {
  return [
    { id: 'capability.progress', label: '诊断进度', tool: 'show_diagnosis_progress', enabled: true },
    { id: 'capability.probe-allowed', label: '探针（已注册）', tool: PROBE_ALLOWED, enabled: true },
    { id: 'capability.variance', label: '财务差异分析', tool: 'analysis.cost-attribution', enabled: true },
  ];
}

/** 五件内容件的缺省载荷（与 manifest refs 对账一致） */
function defaultPieceFiles(roleId: string, capabilities: readonly CapabilityFixture[]): Record<string, string> {
  return {
    'knowledge-scope.yaml': `roleId: ${roleId}\nversion: 2\nscopes:\n  - id: ${roleId}.demo\n`,
    'context-manifest.yaml': [
      `roleId: ${roleId}`,
      'version: 2',
      'contexts:',
      '  - id: ops.demo',
      '    label: 三表口径',
      `    source: knowledge-scope.yaml#${roleId}.demo`,
      '    why: 财务判断必须建立在同一套口径上',
      '    required: true',
      '',
    ].join('\n'),
    'output-template.ref': 'templateId: demo\nsections:\n  - id: summary\n    title: 摘要\n    must:\n      - 有结论\n',
    'capabilities.yaml': capabilitiesYaml(roleId, capabilities),
    'acceptance-criteria.yaml': `roleId: ${roleId}\nversion: 2\ncriteria:\n  - id: ac.demo\n    text: demo\n`,
  };
}

/** 造一个齐备的角色包目录（可覆盖能力声明） */
function writeRole(roleId: string = ROLE_ID, capabilities: readonly CapabilityFixture[] = defaultCapabilities()): string {
  const dir = join(rolesRoot(), roleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifestYaml(roleId), null, 2)}\n`, 'utf8');
  const files = defaultPieceFiles(roleId, capabilities);
  for (const piece of PIECES) {
    if (piece === 'manifest.json') continue;
    writeFileSync(join(dir, piece), files[piece]);
  }
  return dir;
}

/** 六件当前内容指纹（夹具侧用生产纯核现算；手写 hex 必撞 CONTENT_CHANGED） */
function roleContentHash(roleId: string = ROLE_ID): string {
  const dir = join(rolesRoot(), roleId);
  return computeRolePackContentHash(
    ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(dir, name)) })),
  );
}

/** 记录自绑定 approvalId（P2-1 §2.2-D9 公式的夹具侧实现） */
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

/** 写一条审批记录（P3 写入器的测试替身；contentHash 缺省 = 按当前内容算真值） */
function writeApprovalRecord(
  roleId: string = ROLE_ID,
  options: { readonly scope?: 'content' | 'content+permissions' } = {},
): void {
  const contentHash = roleContentHash(roleId);
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

/** 删审批记录（快照不符 ⇒ 下一轮 fail-closed 的撤销动作） */
function removeApprovalRecord(roleId: string = ROLE_ID): void {
  rmSync(join(approvalsRoot(), `${roleId}.json`), { force: true });
}

/** 临时快照（只读，不注内容；`roleId` 仅用于命名） */
function rolePersona(roleId: string = ROLE_ID): RolePackPersona {
  return { roleId, systemAddendum: 'P24A_PERSONA_PROBE', contexts: [] };
}

// ══════════════════════════════════════════════════════════════════════════════
// provider / 引擎 / 注册表 装配（真类；只替换外部传输边界）
// ══════════════════════════════════════════════════════════════════════════════

function fakeProvider(reply = '（fake）请补充报告期。'): LLMProvider {
  return {
    name: 'fake-p24a-wire',
    baseUrl: 'fake://p24a-wire',
    async chat(_messages: LLMMessage[]): Promise<ChatResult> {
      return { content: reply, model: 'fake' };
    },
    async stream(_messages: LLMMessage[], cb: StreamCallback): Promise<void> {
      cb.onComplete?.({ content: reply, model: 'fake' });
    },
    async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
      return { healthy: true, latencyMs: 1 };
    },
    listModels(): string[] {
      return ['fake'];
    },
  };
}

/** 引擎工厂：`fallbackProvider: null` 关掉环境派生的 failover（单 provider，行为可预期） */
function newEngine(rolePack?: RolePackPersona | null): ConversationEngine {
  return new ConversationEngine(fakeProvider(), {
    orgId: 'default',
    sessionId: 'p24a-wire-probe',
    fallbackProvider: null,
    ...(rolePack !== undefined ? { rolePack } : {}),
  });
}

/** 真内存库（`SessionStore` 需真 Database；与 tests/agent/tool-args-validation.test.ts 同法） */
function realSessionStore(): { store: SessionStore; close: () => void } {
  const db = new Database(':memory:');
  return { store: new SessionStore(db), close: () => db.close() };
}

interface Probe {
  readonly tool: ToolDefinition;
  calls: number;
}

/** 计数探针工具（`parameters` 空对象 schema 可编译；handler 只计数） */
function probeTool(name: string): Probe {
  const probe: Probe = {
    calls: 0,
    tool: {
      name,
      description: `p24a 探针 ${name}`,
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        probe.calls += 1;
        return { ok: true, probe: name };
      },
    },
  };
  return probe;
}

/** 结构化错误的 code（字符串错误 ⇒ undefined；判据只认结构化） */
function errorCode(result: ToolCallResult): string | undefined {
  const err = result.error;
  if (err === undefined || typeof err === 'string') return undefined;
  return err.code;
}

/** 结构化错误的 name（同上） */
function errorName(result: ToolCallResult): string | undefined {
  const err = result.error;
  if (err === undefined || typeof err === 'string') return undefined;
  return err.name;
}

/** 结构化错误的 message */
function errorMessage(result: ToolCallResult): string {
  const err = result.error;
  if (err === undefined) return '';
  return typeof err === 'string' ? err : err.message;
}

/** 指定 level ＋ 可选 meta.code 的日志条数 */
function countLogs(level: string, code?: string): number {
  return logCalls.filter((call) => call.level === level && (code === undefined || call.meta?.['code'] === code)).length;
}

/** 某条 warn 的 meta（序列化后）是否点名了给定 token（J3 能力 id／D8 开关名） */
function warnMentions(token: string): boolean {
  return logCalls.some(
    (call) => call.level === 'warn' && call.meta !== undefined && JSON.stringify(call.meta).includes(token),
  );
}

/** 工具名清单（listTools 排序后） */
function listedNames(registry: ToolRegistry): string[] {
  return registry.listTools().map((tool) => tool.name);
}

/** OpenAI schema 里的工具名清单 */
function openAINames(registry: ToolRegistry): string[] {
  return registry.toOpenAITools().map((entry) => entry.function.name);
}

// ══════════════════════════════════════════════════════════════════════════════
// 每用例隔离（env／临时根／日志捕获／预设缓存）
// ══════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'p24a-wire-'));
  root = join(fixture, 'extensions', 'presets');
  mkdirSync(rolesRoot(), { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  delete process.env['SYNOVA_ROLE_PACK_TOOLS'];
  delete process.env['SYNOVA_ORG_ID'];
  logCalls.length = 0;
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
  if (ORIGINAL_ROLE_PACK_TOOLS === undefined) delete process.env['SYNOVA_ROLE_PACK_TOOLS'];
  else process.env['SYNOVA_ROLE_PACK_TOOLS'] = ORIGINAL_ROLE_PACK_TOOLS;
  if (ORIGINAL_ORG_ID === undefined) delete process.env['SYNOVA_ORG_ID'];
  else process.env['SYNOVA_ORG_ID'] = ORIGINAL_ORG_ID;
  clearPresetCache();
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 时序A · setRolePack 先于 registerBuiltinTools（真实生产时序）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 时序A — 绑定早于工具注册：注册表空不误判、refresh 后惰性生效', () => {
  it('J1-A1 注册表空 ⇒ execute 返"未知工具"而非 TOOL_PERMISSION_DENIED；registerBuiltinTools 后 refresh ⇒ 白名单生效', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();

    // ① 生产时序：先 setRolePack（路由 :603），后 registerBuiltinTools（路由 :713）
    engine.setRolePack(rolePersona());
    expect(registry.allToolNames()).toHaveLength(0);

    // ② 注册表仍空 ⇒ 白名单**未应用**（保持 null）⇒ 不得误判为权限拒绝
    const empty = await registry.execute('query_ontology', {});
    expect(typeof empty.error).toBe('string');
    expect(errorCode(empty)).toBeUndefined();
    expect(String(empty.error)).toContain('未知工具');
    expect(String(empty.error)).not.toContain('TOOL_PERMISSION_DENIED');

    // ③ 注册工具（生产注册路径）＋ 探针
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-A1', () => 0, () => 'default');
      const probeAllowed = probeTool(PROBE_ALLOWED);
      registry.register(probeAllowed.tool);

      // ④ 惰性应用：声明∩已注册
      engine.refreshRolePackPermissions();

      // #1075 P2-4b-B：系统工具 `search_knowledge`（provider 注入，**不进 allowlist**）
      //   与岗位声明面并列出现在 LLM 可见面 ⇒ 期望 = allowlist ∪ {search_knowledge}（按 name 排序）。
      //   🔴 allowlist 语义未弱化：未声明/禁用/未注册项仍不得出现（下方 not.toContain 原样保留）。
      expect(listedNames(registry)).toEqual([PROBE_ALLOWED, 'search_knowledge', 'show_diagnosis_progress'].sort());
      // 真 handler 被调（allowed 工具放行 ⇒ 非"全拒"假绿）
      const progress = await registry.execute('show_diagnosis_progress', {});
      expect(progress.error).toBeUndefined();
      expect(progress.phase).toBe(0);
      const probeResult = await registry.execute(PROBE_ALLOWED, {});
      expect(probeResult.error).toBeUndefined();
      expect(probeAllowed.calls).toBe(1);
      // 声明了但未注册 ⇒ 不静默丢弃：log.warn 点名；执行时是"未授予"而非"未落地可见即可跑"
      expect(warnMentions('analysis.cost-attribution')).toBe(true);
      const unavailable = await registry.execute('analysis.cost-attribution', {});
      expect(errorCode(unavailable)).toBe('TOOL_PERMISSION_DENIED');
    } finally {
      close();
    }
  });

  it('J1-A2 未声明/未注册工具都不在 listTools()；白名单外工具不进 LLM 工具清单', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-A2', () => 0, () => 'default');
      registry.register(probeTool(PROBE_ALLOWED).tool);
      const probeDenied = probeTool(PROBE_DENIED);
      registry.register(probeDenied.tool);
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      const listed = listedNames(registry);
      // #1075 P2-4b-B：allowlist ∪ {search_knowledge}（系统工具不穿白名单）
      expect(listed).toEqual([PROBE_ALLOWED, 'search_knowledge', 'show_diagnosis_progress'].sort());
      expect(listed).not.toContain(PROBE_DENIED);
      expect(listed).not.toContain('list_sessions');
      expect(listed).not.toContain('analysis.cost-attribution');
      expect(openAINames(registry)).toEqual(listed);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 时序B · 构造期 rolePack（cache-miss 首轮）＋ 首轮不 fail-open
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 时序B — 构造期注入只记绑定，首轮 processMessage 入口自动应用', () => {
  it('J1-B1 new ConversationEngine({rolePack}) → 注册工具 → 首轮 processMessage 后白名单生效（不 fail-open）', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-B1', () => 0, () => 'default');
      const probeAllowed = probeTool(PROBE_ALLOWED);
      registry.register(probeAllowed.tool);
      const probeDenied = probeTool(PROBE_DENIED);
      registry.register(probeDenied.tool);

      // 构造期只记绑定：注册完成、首轮尚未开始时白名单未下发（这正是 D11 的惰性窗口）
      expect(listedNames(registry)).toContain('list_sessions');

      // 首轮：入口首行 ensurePermissionsApplied() ⇒ 编译＋下发（无需测试手工 refresh）
      const result = await engine.processMessage('请介绍一下你能做什么');
      expect(result.reply.length).toBeGreaterThan(0);

      // 白名单已生效 ⇒ 未声明工具被拒（不存在 fail-open 窗口）
      const denied = await registry.execute(PROBE_DENIED, {});
      expect(errorName(denied)).toBe('ToolPermissionError');
      expect(errorCode(denied)).toBe('TOOL_PERMISSION_DENIED');
      expect(probeDenied.calls).toBe(0);
      const allowed = await registry.execute('show_diagnosis_progress', {});
      expect(allowed.error).toBeUndefined();
      const probeResult = await registry.execute(PROBE_ALLOWED, {});
      expect(probeResult.error).toBeUndefined();
      expect(probeAllowed.calls).toBe(1);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 knownTools 原始清单（禁 listTools 当 knownTools）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 knownTools — 必须用原始清单 allToolNames()，晚注册的声明工具可再次生效', () => {
  it('J1-C1 声明但首轮未注册 ⇒ 后续注册 + refresh ⇒ 放行（若 knownTools=listTools 则必红）', async () => {
    writeRole(ROLE_ID, [
      ...defaultCapabilities(),
      { id: 'capability.probe-late', label: '探针（晚注册）', tool: PROBE_LATE, enabled: true },
    ]);
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-C1', () => 0, () => 'default');
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();
      // 首轮：PROBE_LATE 未注册 ⇒ 不在白名单（但也不阻止其它工具）
      expect(listedNames(registry)).not.toContain(PROBE_LATE);
      expect(warnMentions(PROBE_LATE)).toBe(true);

      // 晚注册（模拟内容批/插件后装）＋ 再解析：必须凭 allToolNames() 看到它
      const late = probeTool(PROBE_LATE);
      registry.register(late.tool);
      engine.refreshRolePackPermissions();

      expect(listedNames(registry)).toContain(PROBE_LATE);
      const result = await registry.execute(PROBE_LATE, {});
      expect(result.error).toBeUndefined();
      expect(late.calls).toBe(1);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J1 权限待批（D4：scope 只批内容 ＋ 包声明了 tool）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 权限待批 — scope=content ⇒ allowlist=[]（全拒）＋ 日志点名', () => {
  it('J1-D1 只批内容 ⇒ 已声明工具也不放行，拒绝码 TOOL_PERMISSION_DENIED，日志含 permissionsPending', async () => {
    writeRole();
    // capabilities 里有 tool ⇒ P2-1 判 permissionsPending = (scope==='content' && hasToolDeclarations) = true
    writeApprovalRecord(ROLE_ID, { scope: 'content' });
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-D1', () => 0, () => 'default');
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      // allowlist=[] ⇒ LLM 看不见任何工具
      // #1075 P2-4b-B：白名单仍为空（岗位声明面无工具），但**系统知识工具**独立于白名单（D4b）
      //   ⇒ LLM 可见面只剩它；allowlist 语义未弱化（下面执行拒绝断言原样保留）。
      expect(listedNames(registry)).toEqual(['search_knowledge']);
      expect(openAINames(registry)).toEqual(['search_knowledge']);
      const result = await registry.execute('show_diagnosis_progress', {});
      expect(errorCode(result)).toBe('TOOL_PERMISSION_DENIED');
      // D4 留痕：engine 侧"权限待批"warn（permissionsPending 字段可判）
      expect(
        logCalls.some((call) => call.level === 'warn' && call.meta?.['permissionsPending'] === true),
      ).toBe(true);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J2 未列即拒（含 handler 零调用／日志恰一条／旧 OpenAI 缓存失效）
// ══════════════════════════════════════════════════════════════════════════════

describe('J2 未列即拒 — 结构化拒绝 + handler 零调用 + 缓存失效', () => {
  it('J2-1 未声明工具 ⇒ TOOL_PERMISSION_DENIED（ToolPermissionError），handler 零调用', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J2', () => 0, () => 'default');
      const probeDenied = probeTool(PROBE_DENIED);
      registry.register(probeDenied.tool);
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      logCalls.length = 0;
      const result = await registry.execute(PROBE_DENIED, {});
      expect(errorName(result)).toBe('ToolPermissionError');
      expect(errorCode(result)).toBe('TOOL_PERMISSION_DENIED');
      expect(errorMessage(result)).toContain(`未被授予工具 "${PROBE_DENIED}"`);
      expect(probeDenied.calls).toBe(0);
    } finally {
      close();
    }
  });

  it('J2-2 每次拒绝恰留一条 log.warn（code=TOOL_PERMISSION_DENIED，点名工具）', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J2W', () => 0, () => 'default');
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      logCalls.length = 0;
      await registry.execute('list_sessions', {});
      expect(countLogs('warn', 'TOOL_PERMISSION_DENIED')).toBe(1);
      expect(
        logCalls.some(
          (call) => call.level === 'warn' && call.meta?.['code'] === 'TOOL_PERMISSION_DENIED' && call.meta?.['name'] === 'list_sessions',
        ),
      ).toBe(true);
    } finally {
      close();
    }
  });

  it('J2-3 应用白名单前已填 _cachedOpenAITools ⇒ 应用后 listTools()/toOpenAITools() 都不含未列项', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J2C', () => 0, () => 'default');
      const probeDenied = probeTool(PROBE_DENIED);
      registry.register(probeDenied.tool);

      // 先填缓存（改前行为：LLM 能看到全部工具）——这行是"旧缓存"判据的起点
      expect(openAINames(registry)).toContain('list_sessions');
      expect(openAINames(registry)).toContain(PROBE_DENIED);

      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      // setAllowedTools 必须清缓存 ⇒ 否则这里仍看得到旧清单（规格 §1.2-2）
      expect(openAINames(registry)).not.toContain('list_sessions');
      expect(openAINames(registry)).not.toContain(PROBE_DENIED);
      expect(listedNames(registry)).not.toContain('list_sessions');
      expect(listedNames(registry)).not.toContain(PROBE_DENIED);
      expect(openAINames(registry)).toEqual(listedNames(registry));
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J3 enabled:false 硬拒（disabled 优先）
// ══════════════════════════════════════════════════════════════════════════════

describe('J3 enabled:false 硬拒 — 同 tool 亦被禁用能力否掉（disabled 优先）', () => {
  it('J3-1 合成夹具 cap.evolution-write/tool:query_ontology/enabled:false ⇒ 即使另有 enabled 声明也拒', async () => {
    writeRole(ROLE_ID, [
      { id: 'capability.ontology', label: '本体图查询', tool: 'query_ontology', enabled: true },
      { id: 'capability.progress', label: '诊断进度', tool: 'show_diagnosis_progress', enabled: true },
      {
        id: 'cap.evolution-write',
        label: '直接改写进化回环',
        tool: 'query_ontology',
        enabled: false,
        disabledReason: '④ 参数层只允许由 ③ 哨兵写（宪章 4.4）',
      },
    ]);
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J3', () => 0, () => 'default');
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      // disabled 优先：query_ontology 不得进白名单（哪怕它还出现在 enabled 能力里）
      // #1075 P2-4b-B：disabled 项仍不进 allowlist（语义未弱化）；系统工具并列可见
      expect(listedNames(registry)).toEqual(['search_knowledge', 'show_diagnosis_progress']);
      const result = await registry.execute('query_ontology', {});
      expect(errorCode(result)).toBe('TOOL_PERMISSION_DENIED');
    } finally {
      close();
    }
  });

  it('J3-2 禁用能力留痕点名 capability id（cap.evolution-write）', async () => {
    writeRole(ROLE_ID, [
      { id: 'capability.ontology', label: '本体图查询', tool: 'query_ontology', enabled: true },
      { id: 'cap.evolution-write', label: '直接改写进化回环', tool: 'query_ontology', enabled: false },
    ]);
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J3L', () => 0, () => 'default');
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();

      // 能力 id 必须在日志里可 grep（不静默丢弃 disabled）
      expect(warnMentions('cap.evolution-write')).toBe(true);
      expect(warnMentions('query_ontology')).toBe(true);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J6 未绑定会话零变化 ＋ 对照（已绑定复核失败 ⇒ fail-closed）
// ══════════════════════════════════════════════════════════════════════════════

describe('J6 未绑定零变化 — setRolePack(null) 恢复既有行为；已绑定复核失败 fail-closed', () => {
  it('J6-1 fresh engine setRolePack(null) ⇒ setAllowedTools(null)：全部工具可见可调，无 TOOL_PERMISSION_DENIED', async () => {
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J6', () => 0, () => 'default');
      engine.setRolePack(null);
      engine.refreshRolePackPermissions();

      // 未绑定 ⇒ 不限制（既有清单全在）
      expect(listedNames(registry)).toContain('list_sessions');
      expect(listedNames(registry)).toContain('query_ontology');
      expect(listedNames(registry)).toContain('show_diagnosis_progress');
      expect(openAINames(registry)).toEqual(listedNames(registry));

      logCalls.length = 0;
      const progress = await registry.execute('show_diagnosis_progress', {});
      expect(progress.error).toBeUndefined();
      expect(progress.phase).toBe(0);
      expect(countLogs('warn', 'TOOL_PERMISSION_DENIED')).toBe(0);
    } finally {
      close();
    }
  });

  it('J6-2 对照：已绑定后复核失败（setRolePack(null)，bound 保留）⇒ [] fail-closed，不全放行', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J6C', () => 0, () => 'default');
      engine.refreshRolePackPermissions();
      expect(listedNames(registry)).toContain('show_diagnosis_progress');

      // 路由复核失败路径：loadRolePackPersona 失败 ⇒ setRolePack(null)（bound 不清空）
      engine.setRolePack(null);
      engine.refreshRolePackPermissions();

      // #1075 P2-4b-B：白名单仍为空（岗位声明面无工具），但**系统知识工具**独立于白名单（D4b）
      //   ⇒ LLM 可见面只剩它；allowlist 语义未弱化（下面执行拒绝断言原样保留）。
      expect(listedNames(registry)).toEqual(['search_knowledge']);
      const result = await registry.execute('show_diagnosis_progress', {});
      expect(errorCode(result)).toBe('TOOL_PERMISSION_DENIED');
      expect(
        logCalls.some((call) => call.level === 'warn' && call.meta?.['reason'] === 'persona-unverified'),
      ).toBe(true);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// J5 撤销 — 删除审批记录 ⇒ refresh 后 allowlist=[] fail-closed（J5 的 engine 面）
// ══════════════════════════════════════════════════════════════════════════════

describe('J5 撤销 — 已绑定岗位删审批记录 ⇒ refresh ⇒ [] fail-closed', () => {
  it('J5-E1 先放行；removeApprovalRecord() 后 refreshRolePackPermissions() ⇒ listTools()=[]、执行返 TOOL_PERMISSION_DENIED、日志含 E_ROLE_PACK_NOT_APPROVED', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-J5', () => 0, () => 'default');
      registry.register(probeTool(PROBE_ALLOWED).tool);
      engine.refreshRolePackPermissions();
      // 撤销前：放行工具可见（证明下面 [] 不是"从来就没放行"）
      // #1075 P2-4b-B：系统工具 `search_knowledge`（provider 注入，**不进 allowlist**）
      //   与岗位声明面并列出现在 LLM 可见面 ⇒ 期望 = allowlist ∪ {search_knowledge}（按 name 排序）。
      //   🔴 allowlist 语义未弱化：未声明/禁用/未注册项仍不得出现（下方 not.toContain 原样保留）。
      expect(listedNames(registry)).toEqual([PROBE_ALLOWED, 'search_knowledge', 'show_diagnosis_progress'].sort());

      // 撤销动作 = 删审批记录（<tmp>/.synova/approvals/<ROLE_ID>.json）⇒ 审批门失守
      removeApprovalRecord();
      logCalls.length = 0;
      engine.refreshRolePackPermissions();

      // fail-closed：白名单空（空名单 ⇒ listTools=[]），LLM 面亦为空
      // #1075 P2-4b-B：白名单仍为空（岗位声明面无工具），但**系统知识工具**独立于白名单（D4b）
      //   ⇒ LLM 可见面只剩它；allowlist 语义未弱化（下面执行拒绝断言原样保留）。
      expect(listedNames(registry)).toEqual(['search_knowledge']);
      expect(openAINames(registry)).toEqual(['search_knowledge']);
      const denied = await registry.execute('show_diagnosis_progress', {});
      expect(errorName(denied)).toBe('ToolPermissionError');
      expect(errorCode(denied)).toBe('TOOL_PERMISSION_DENIED');
      // 留痕点名 NOT_APPROVED（权限模块 reject ＋ engine 编译失败均为同码 typed meta）
      expect(countLogs('warn', 'E_ROLE_PACK_NOT_APPROVED')).toBeGreaterThanOrEqual(1);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// D8 回滚开关
// ══════════════════════════════════════════════════════════════════════════════

describe('D8 回滚 — SYNOVA_ROLE_PACK_TOOLS=off ⇒ 恢复不限制（显式降级）', () => {
  it('D8-1 已应用白名单后置 off ⇒ setAllowedTools(null)＋warn，全部工具重新可见', async () => {
    writeRole();
    writeApprovalRecord();
    const engine = newEngine();
    const registry = engine.getToolRegistry();
    const { store, close } = realSessionStore();
    try {
      registerBuiltinTools(registry, store, 'p24a-D8', () => 0, () => 'default');
      registry.register(probeTool(PROBE_ALLOWED).tool);
      engine.setRolePack(rolePersona());
      engine.refreshRolePackPermissions();
      // #1075 P2-4b-B：系统工具 `search_knowledge`（provider 注入，**不进 allowlist**）
      //   与岗位声明面并列出现在 LLM 可见面 ⇒ 期望 = allowlist ∪ {search_knowledge}（按 name 排序）。
      //   🔴 allowlist 语义未弱化：未声明/禁用/未注册项仍不得出现（下方 not.toContain 原样保留）。
      expect(listedNames(registry)).toEqual([PROBE_ALLOWED, 'search_knowledge', 'show_diagnosis_progress'].sort());

      process.env['SYNOVA_ROLE_PACK_TOOLS'] = 'off';
      engine.refreshRolePackPermissions();

      expect(listedNames(registry)).toContain('list_sessions');
      expect(listedNames(registry)).toContain('query_ontology');
      const progress = await registry.execute('show_diagnosis_progress', {});
      expect(progress.error).toBeUndefined();
      expect(warnMentions('SYNOVA_ROLE_PACK_TOOLS=off')).toBe(true);
    } finally {
      close();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 恢复路径（fromState）
// ══════════════════════════════════════════════════════════════════════════════

describe('J1 恢复路径 — fromState 快照 rolePackId 恢复绑定', () => {
  it('J1-E1 快照带 rolePackId ⇒ fromState 后 refresh 生效；无 rolePackId 的快照 ⇒ 零变化', async () => {
    writeRole();
    writeApprovalRecord();

    // 产出生产快照（serialize 只在绑定岗位时写 rolePackId）
    const bound = newEngine(rolePersona());
    const state = bound.serialize();
    expect(state.rolePackId).toBe(ROLE_ID);

    const restored = ConversationEngine.fromState(fakeProvider(), state, { rolePack: rolePersona() });
    const registry = restored.getToolRegistry();
    const boundStore = realSessionStore();
    const plainStore = realSessionStore();
    try {
      registerBuiltinTools(registry, boundStore.store, 'p24a-E1', () => 0, () => 'default');
      registry.register(probeTool(PROBE_ALLOWED).tool);
      restored.refreshRolePackPermissions();
      // #1075 P2-4b-B：系统工具 `search_knowledge`（provider 注入，**不进 allowlist**）
      //   与岗位声明面并列出现在 LLM 可见面 ⇒ 期望 = allowlist ∪ {search_knowledge}（按 name 排序）。
      //   🔴 allowlist 语义未弱化：未声明/禁用/未注册项仍不得出现（下方 not.toContain 原样保留）。
      expect(listedNames(registry)).toEqual([PROBE_ALLOWED, 'search_knowledge', 'show_diagnosis_progress'].sort());

      // 对照：无 rolePackId 的快照（无岗位会话基线形态）⇒ 恢复后不限制
      const plain = newEngine();
      const plainState = plain.serialize();
      expect('rolePackId' in plainState).toBe(false);
      const plainRestored = ConversationEngine.fromState(fakeProvider(), plainState, {});
      const plainRegistry = plainRestored.getToolRegistry();
      registerBuiltinTools(plainRegistry, plainStore.store, 'p24a-E1p', () => 0, () => 'default');
      plainRestored.refreshRolePackPermissions();
      expect(listedNames(plainRegistry)).toContain('list_sessions');
    } finally {
      boundStore.close();
      plainStore.close();
    }
  });
});
