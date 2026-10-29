/**
 * tests/agent/knowledge-search-tool.test.ts — #1075 P2-4b-B **B-J3/B-J5/B-J6** 判据
 *
 * 判据对象（真类，不 mock 管线）:
 *   · `ToolRegistry.setSystemToolProvider`（系统工具：**不注册**、进 listTools/toOpenAITools、
 *     不进 allToolNames、执行不穿岗位白名单）—— B-J3；
 *   · `createKnowledgeSearchTool`（工具边界 `pkbDomain → domain` 映射、结构化错误、limit 钳位）—— B-J3/B-J6；
 *   · `KnowledgeStore.update()` 的**写丢修复**（`pkb_domain/pkb_type/pkb_source` 三列）—— B-J5；
 *   · ConversationEngine 的注入/撤销/开关（`SYNOVA_ROLE_KNOWLEDGE`）—— B-J3。
 *
 * 🔴 真依赖（禁 mock 判定）:
 *   · 真 `ConversationEngine` ＋ 真 `ToolRegistry`（只替换 LLM 传输边界为 fake provider）；
 *   · 真 better-sqlite3（`SYNOVA_DB_PATH` → `mkdtemp` 临时库 ＋ `initEngineContext()`；
 *     **绝不触碰** 仓库 `data/synova.db`）；
 *   · 真 `KnowledgeStore`（FTS/LIKE ＋ matchFilter 全走生产实现）。
 *
 * 判据分组（规格 §4）:
 *   B-J3 系统工具仅角色会话：角色会话 listTools 含 `search_knowledge`、`allToolNames()` **不含**、
 *        execute 真过滤（scope＋敏感度）；无岗位 ⇒ 不存在；撤销（persona=null 已绑定）⇒ 工具在但 0 结果；
 *        回滚开关 `SYNOVA_ROLE_KNOWLEDGE=off` ⇒ 卸载；与 `SYNOVA_ROLE_PACK_TOOLS` **互不替代**。
 *   B-J5 写丢修复：insert 后三列 NULL → update → 三列有值（raw SQL 判据）；其余列不被写坏。
 *   B-J6 无岗位零变化：无工具、无 provider、execute=未知工具、回复与 provider 定值一致。
 *
 * 已知限制:
 *   ① 不测真实 LLM（fake provider 定值回复），只证"工具/过滤面"接线；
 *   ② 审批记录是夹具直写（生产审批写入面归 P3），不证审批写路径；
 *   ③ 历史未打标数据仍需回填（规格 §10-L1），本文件只证"新打标生效"。
 *
 * @degraded 本文件对降级面的判据 = 结构化 error code ＋ `degraded:true` 标记（不逐字断日志文案）。
 * @authority 判据归属 #1075 P2-4b-B（规格 §4 B-J3/B-J5/B-J6）。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConversationEngine } from '../../src/agent/conversation-engine';
import { createKnowledgeSearchTool } from '../../src/agent/builtin-tools';
import type { ToolCallResult } from '../../src/agent/tools';
import { clearPresetCache } from '../../src/init/preset-loader';
import { ROLE_PACK_PIECES, computeRolePackContentHash } from '../../src/init/role-pack-schema';
import type { RolePackPersona } from '../../src/init/role-pack-persona';
import type { ChatResult, LLMMessage, LLMProvider, StreamCallback } from '../../src/providers/types';

// ══════════════════════════════════════════════════════════════════════════════
// 真 SQLite（临时库）＋ 引擎上下文（env 必须在 initEngineContext() **之前**落）
// ══════════════════════════════════════════════════════════════════════════════

const REQUIRE_TMP = mkdtempSync(join(tmpdir(), 'p24bb-search-tool-'));
const DB_FILE = join(REQUIRE_TMP, 'p24bb-search-tool.db');
process.env.SYNOVA_DB_PATH = DB_FILE;
process.env.DEV_MODE = 'false';

import { initEngineContext, getDatabase, closeEngineContext } from '../../src/init/engine-context';
import { KnowledgeStore } from '../../src/l4/knowledge-store';

// ══════════════════════════════════════════════════════════════════════════════
// 夹具常量（非出厂角色 id；出厂三包只信代码锚）
// ══════════════════════════════════════════════════════════════════════════════

const ROLE = 'ops';
/** refs 用的 scope 名 —— 🔴 必须命中同包 `scopes[].id`（loader IO 壳会核） */
const REF_SCOPE = 'ops.demo';
const APPROVED_AT = '2026-10-28T00:00:00.000Z';
const APPROVER_ID = 'u_p24bb_tool_fixture';
const APPROVER_ROLE = 'super-admin';
const APPROVAL_ORG_ID = 'default';
const FAKE_REPLY = '（fake）已按岗位口径给出结论。';

let fixture: string;
let root: string;
let store: KnowledgeStore;
/** 角色会话可读的块（scope 内 ＋ normal） */
let chunkVisible: string;
/** 域外块（scope 外） */
let chunkOutOfScope: string;
/** scope 内但敏感度 sensitive */
let chunkSensitive: string;

const ORIGINAL_PRESETS_ROOT = process.env['SYNOVA_PRESETS_ROOT'];
const ORIGINAL_ROLE_PACK_TOOLS = process.env['SYNOVA_ROLE_PACK_TOOLS'];
const ORIGINAL_ROLE_KNOWLEDGE = process.env['SYNOVA_ROLE_KNOWLEDGE'];
const ORIGINAL_ORG_ID = process.env['SYNOVA_ORG_ID'];

function rolesRoot(): string {
  return join(root, 'roles');
}

function approvalsRoot(): string {
  return resolve(root, '..', '..', '.synova', 'approvals');
}

// ══════════════════════════════════════════════════════════════════════════════
// 真假厂：fake LLM provider
// ══════════════════════════════════════════════════════════════════════════════

function fakeProvider(reply: string = FAKE_REPLY): LLMProvider {
  return {
    name: 'fake-p24bb-search',
    baseUrl: 'fake://p24bb-search',
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

/** 引擎工厂（`fallbackProvider: null` 关掉环境派生的 failover） */
function newEngine(rolePack?: RolePackPersona | null): ConversationEngine {
  return new ConversationEngine(fakeProvider(), {
    orgId: 'default',
    sessionId: 'p24bb-search-tool',
    fallbackProvider: null,
    ...(rolePack !== undefined ? { rolePack } : {}),
  });
}

/** 夹具人设（只带 roleId；内容面本文件不关心） */
function rolePersona(roleId: string = ROLE): RolePackPersona {
  return { roleId, systemAddendum: 'P24BB_PERSONA_PROBE', contexts: [] };
}

// ══════════════════════════════════════════════════════════════════════════════
// 角色包夹具（仓库形状 ＋ 六件 ＋ 审批记录）
// ══════════════════════════════════════════════════════════════════════════════

function writeRolePack(roleId: string = ROLE): void {
  const dir = join(rolesRoot(), roleId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({
    $schema: '../../schema/role-pack-v3.schema.json',
    schemaVersion: 3,
    name: `role-${roleId}`,
    version: '2.0.0',
    type: 'role-preset',
    displayName: roleId,
    entryPoint: './context-manifest.yaml',
    roleId,
    pieces: [...ROLE_PACK_PIECES],
    refs: [{ kind: 'scope', name: REF_SCOPE }],
  }, null, 2)}\n`, 'utf8');
  writeFileSync(join(dir, 'context-manifest.yaml'), [
    `roleId: ${roleId}`,
    'version: 2',
    'contexts:',
    '  - id: ops.demo',
    '    label: 三表口径',
    `    source: knowledge-scope.yaml#${REF_SCOPE}`,
    '    why: 判断必须建立在同一套口径上',
    '    required: true',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(dir, 'output-template.ref'), 'templateId: demo\nsections:\n  - id: summary\n    title: 摘要\n', 'utf8');
  writeFileSync(join(dir, 'capabilities.yaml'), `roleId: ${roleId}\nversion: 2\ncapabilities: []\n`, 'utf8');
  writeFileSync(join(dir, 'acceptance-criteria.yaml'), `roleId: ${roleId}\nversion: 2\ncriteria:\n  - id: ac.demo\n    text: demo\n`, 'utf8');
  writeFileSync(join(dir, 'knowledge-scope.yaml'), `roleId: ${roleId}\nversion: 2\nscopes:\n  - id: ${REF_SCOPE}\n`, 'utf8');
}

/** 审批记录（approved；contentHash 用生产纯核现算） */
function writeApprovalRecord(roleId: string = ROLE): void {
  const dir = join(rolesRoot(), roleId);
  const contentHash = computeRolePackContentHash(
    ROLE_PACK_PIECES.map((name) => ({ name, bytes: readFileSync(join(dir, name)) })),
  );
  const material = [APPROVAL_ORG_ID, roleId, contentHash, 'content+permissions', APPROVED_AT, APPROVER_ID, APPROVER_ROLE].join('|');
  const approvalId = `apv1:${createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16)}`;
  mkdirSync(approvalsRoot(), { recursive: true });
  writeFileSync(join(approvalsRoot(), `${roleId}.json`), `${JSON.stringify({
    schemaVersion: 1,
    roleId,
    orgId: APPROVAL_ORG_ID,
    approvalId,
    contentHash,
    approverId: APPROVER_ID,
    approverRole: APPROVER_ROLE,
    approvedAt: APPROVED_AT,
    scope: 'content+permissions',
  }, null, 2)}\n`, 'utf8');
}

// ══════════════════════════════════════════════════════════════════════════════
// 断言助手（结构化错误 / 工具名 / raw SQL 三列）
// ══════════════════════════════════════════════════════════════════════════════

function errorOf(result: ToolCallResult): { name: string; code: string; message: string; phase?: string } | undefined {
  const err = result.error;
  return err !== undefined && typeof err !== 'string' ? err : undefined;
}

function listedNames(engine: ConversationEngine): string[] {
  return engine.getToolRegistry().listTools().map((tool) => tool.name);
}

function openAINames(engine: ConversationEngine): string[] {
  return engine.getToolRegistry().toOpenAITools().map((entry) => entry.function.name);
}

/** raw SQL 读三列（B-J5 判据只看库里真值，不看返回值） */
function pkbColumns(id: string): { domain: unknown; type: unknown; source: unknown } {
  const row = getDatabase()
    .prepare('SELECT pkb_domain, pkb_type, pkb_source FROM knowledge_chunks WHERE id=?')
    .get(id) as Record<string, unknown> | undefined;
  expect(row).toBeDefined();
  return { domain: row?.['pkb_domain'], type: row?.['pkb_type'], source: row?.['pkb_source'] };
}

// ══════════════════════════════════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════════════════════════════════

beforeAll(() => {
  initEngineContext(); // 真 SQLite（SYNOVA_DB_PATH = 临时库）
  store = new KnowledgeStore(getDatabase());
  // 三条检索观测样本（同一关键词，不同 scope/敏感度）
  chunkVisible = store.insert({
    text: 'ops 现金流 范围说明',
    sourceType: 'document', sourceId: 'doc-visible', authorityLevel: 'reference',
    accessLevel: 'team', accessSensitivity: 'normal', pkbDomain: REF_SCOPE,
  });
  chunkOutOfScope = store.insert({
    text: 'market 现金流 定价口径',
    sourceType: 'document', sourceId: 'doc-market', authorityLevel: 'reference',
    accessLevel: 'team', accessSensitivity: 'normal', pkbDomain: 'market.pricing',
  });
  chunkSensitive = store.insert({
    text: 'ops 现金流 薪资明细',
    sourceType: 'document', sourceId: 'doc-sensitive', authorityLevel: 'reference',
    accessLevel: 'team', accessSensitivity: 'sensitive', pkbDomain: REF_SCOPE,
  });
});

afterAll(() => {
  closeEngineContext();
  rmSync(REQUIRE_TMP, { recursive: true, force: true });
});

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'p24bb-tool-'));
  root = join(fixture, 'extensions', 'presets');
  mkdirSync(rolesRoot(), { recursive: true });
  process.env['SYNOVA_PRESETS_ROOT'] = root;
  delete process.env['SYNOVA_ROLE_PACK_TOOLS'];
  delete process.env['SYNOVA_ROLE_KNOWLEDGE'];
  delete process.env['SYNOVA_ORG_ID'];
  clearPresetCache();
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
  if (ORIGINAL_PRESETS_ROOT === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
  else process.env['SYNOVA_PRESETS_ROOT'] = ORIGINAL_PRESETS_ROOT;
  if (ORIGINAL_ROLE_PACK_TOOLS === undefined) delete process.env['SYNOVA_ROLE_PACK_TOOLS'];
  else process.env['SYNOVA_ROLE_PACK_TOOLS'] = ORIGINAL_ROLE_PACK_TOOLS;
  if (ORIGINAL_ROLE_KNOWLEDGE === undefined) delete process.env['SYNOVA_ROLE_KNOWLEDGE'];
  else process.env['SYNOVA_ROLE_KNOWLEDGE'] = ORIGINAL_ROLE_KNOWLEDGE;
  if (ORIGINAL_ORG_ID === undefined) delete process.env['SYNOVA_ORG_ID'];
  else process.env['SYNOVA_ORG_ID'] = ORIGINAL_ORG_ID;
  clearPresetCache();
});

// ══════════════════════════════════════════════════════════════════════════════
// B-J3 系统工具仅角色会话
// ══════════════════════════════════════════════════════════════════════════════

describe('B-J3 · 系统工具 search_knowledge 只在角色会话存在', () => {
  it('B-J3-1 角色会话：listTools/toOpenAITools 含之；allToolNames **不含**（未注册）', () => {
    writeRolePack();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    engine.refreshRolePackPermissions();

    expect(listedNames(engine)).toContain('search_knowledge');
    expect(openAINames(engine)).toContain('search_knowledge');
    // 🔴 不注册：注册表原始清单仍为空 ⇒ P2-4a 的 allToolNames 断言不受影响
    expect(engine.getToolRegistry().allToolNames()).toHaveLength(0);
    expect(engine.getToolRegistry().allToolNames()).not.toContain('search_knowledge');
  });

  it('B-J3-2 角色会话 execute：真过滤（scope 内 ＋ normal 才可见），工具边界映射 domain', async () => {
    writeRolePack();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    engine.refreshRolePackPermissions();

    const result = await engine.getToolRegistry().execute('search_knowledge', { query: '现金流' });
    expect(errorOf(result)).toBeUndefined();
    expect(result['count']).toBe(1);
    const results = result['results'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]?.['id']).toBe(chunkVisible);
    expect(results[0]?.['domain']).toBe(REF_SCOPE);
    // 只暴露对外字段（不泄漏内部 pkbDomain/sensitivity）
    expect(Object.keys(results[0] ?? {}).sort()).toEqual(['domain', 'id', 'snippet', 'text']);
    // 域外块与 sensitive 块都不可见（同一关键词，证明过滤真生效）
    const ids = results.map((r) => r['id']);
    expect(ids).not.toContain(chunkOutOfScope);
    expect(ids).not.toContain(chunkSensitive);
  });

  it('B-J3-3 无岗位：listTools 不含；execute ⇒ 未知工具（不是权限拒绝，也不是可执行）', async () => {
    const engine = newEngine(); // 从未绑定
    engine.refreshRolePackPermissions();
    expect(listedNames(engine)).not.toContain('search_knowledge');
    expect(openAINames(engine)).not.toContain('search_knowledge');

    const result = await engine.getToolRegistry().execute('search_knowledge', { query: '现金流' });
    expect(typeof result.error).toBe('string');
    expect(String(result.error)).toContain('未知工具');
    expect(String(result.error)).not.toContain('TOOL_PERMISSION_DENIED');
  });

  it('B-J3-4 撤销（已绑定 + persona=null）：工具仍在（可见），但过滤面拒绝 ⇒ 0 结果', async () => {
    writeRolePack();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    engine.refreshRolePackPermissions();
    expect(listedNames(engine)).toContain('search_knowledge');

    engine.setRolePack(null); // 复核失败/撤岗：boundRolePackId 保留
    engine.refreshRolePackPermissions();

    expect(listedNames(engine)).toContain('search_knowledge'); // D7：工具可见
    const result = await engine.getToolRegistry().execute('search_knowledge', { query: '现金流' });
    expect(errorOf(result)).toBeUndefined();
    expect(result['count']).toBe(0);          // 但一条都不返
    expect(result['degraded']).toBe(true);    // 且显式标记（不假装"没有数据"）
  });

  it('B-J3-5 回滚开关独立：SYNOVA_ROLE_KNOWLEDGE=off ⇒ 卸载；仅 PACK_TOOLS=off ⇒ 工具仍在', () => {
    writeRolePack();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    engine.refreshRolePackPermissions();
    expect(listedNames(engine)).toContain('search_knowledge');

    // ① 只关知识工具 ⇒ 卸载（provider=null）
    process.env['SYNOVA_ROLE_KNOWLEDGE'] = 'off';
    engine.refreshRolePackPermissions();
    expect(listedNames(engine)).not.toContain('search_knowledge');

    // ② 恢复；只关工具白名单 ⇒ 知识工具**不受影响**（两开关互不替代）
    delete process.env['SYNOVA_ROLE_KNOWLEDGE'];
    process.env['SYNOVA_ROLE_PACK_TOOLS'] = 'off';
    engine.refreshRolePackPermissions();
    expect(listedNames(engine)).toContain('search_knowledge');
  });

  it('B-J3-6 入参边界：query 空/超长 ⇒ 结构化 E_KNOWLEDGE_INVALID_ARGS；limit 越界被钳位（不抛）', async () => {
    writeRolePack();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    engine.refreshRolePackPermissions();
    const registry = engine.getToolRegistry();

    const empty = await registry.execute('search_knowledge', { query: '' });
    expect(errorOf(empty)?.code).toBe('E_KNOWLEDGE_INVALID_ARGS');
    expect(errorOf(empty)?.phase).toBe('validate');

    const tooLong = await registry.execute('search_knowledge', { query: 'x'.repeat(201) });
    expect(errorOf(tooLong)?.code).toBe('E_KNOWLEDGE_INVALID_ARGS');

    const clamped = await registry.execute('search_knowledge', { query: '现金流', limit: 11 });
    expect(errorOf(clamped)).toBeUndefined();
    expect(Number(clamped['count'])).toBeLessThanOrEqual(10);
  });

  it('B-J3-7 filter 缺失（工厂直调）：结构化 E_KNOWLEDGE_UNAVAILABLE，不回落全库', async () => {
    const tool = createKnowledgeSearchTool(() => null);
    const result = await tool.handler({ query: '现金流' });
    const err = errorOf(result as ToolCallResult);
    expect(err?.name).toBe('KnowledgeSearchError');
    expect(err?.code).toBe('E_KNOWLEDGE_UNAVAILABLE');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B-J5 写丢修复（pkb_domain / pkb_type / pkb_source）
// ══════════════════════════════════════════════════════════════════════════════

describe('B-J5 · update() 持久化 pkb_domain/pkb_type/pkb_source', () => {
  it('B-J5-1 insert（不带 pkbDomain）⇒ 三列 NULL（写丢前的可达起点）', () => {
    const id = store.insert({
      text: '写丢修复 行A',
      sourceType: 'document', sourceId: 'doc-blank', authorityLevel: 'reference',
      accessLevel: 'team', accessSensitivity: 'normal',
    });
    expect(pkbColumns(id)).toEqual({ domain: null, type: null, source: null });
  });

  it('B-J5-2 update({pkb_*}) ⇒ 三列都有值（raw SQL 判据）；其它列不被写坏', () => {
    const id = store.insert({
      text: '写丢修复 行B',
      sourceType: 'document', sourceId: 'doc-update', authorityLevel: 'reference',
      accessLevel: 'team', accessSensitivity: 'normal',
    });
    expect(pkbColumns(id)).toEqual({ domain: null, type: null, source: null });

    store.update(id, { pkb_domain: REF_SCOPE, pkb_type: 'policy', pkb_source: 'p24bb-fixture' });

    expect(pkbColumns(id)).toEqual({ domain: REF_SCOPE, type: 'policy', source: 'p24bb-fixture' });
    // 其它列保持（update 不是"整行重建"）
    const row = getDatabase()
      .prepare('SELECT text, access_sensitivity, source_type FROM knowledge_chunks WHERE id=?')
      .get(id) as Record<string, unknown>;
    expect(row['text']).toBe('写丢修复 行B');
    expect(row['access_sensitivity']).toBe('normal');
    expect(row['source_type']).toBe('document');
  });

  it('B-J5-3 insert 带 pkbDomain ⇒ 列即有值；search 结果的内部字段是 pkbDomain（不新增 domain 键）', () => {
    const id = store.insert({
      text: '写丢修复 行C 现金流',
      sourceType: 'document', sourceId: 'doc-domain', authorityLevel: 'reference',
      accessLevel: 'team', accessSensitivity: 'normal', pkbDomain: 'finance.reports',
    });
    expect(pkbColumns(id).domain).toBe('finance.reports');

    const found = store.search('写丢修复 行C', { conditions: [{ field: 'pkb_domain', operator: 'IN', value: ['finance.reports'] }] }, 5);
    expect(found.results.map((r) => r.id)).toContain(id);
    const hit = found.results.find((r) => r.id === id);
    expect(hit?.pkbDomain).toBe('finance.reports');
    expect(hit !== undefined && 'domain' in hit).toBe(false); // search 不新增对外 domain 键
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B-J6 无岗位零变化
// ══════════════════════════════════════════════════════════════════════════════

describe('B-J6 · 无岗位会话零变化', () => {
  it('B-J6-1 无岗位：无系统工具（listTools/toOpenAITools 均不含）、回复与改前一致', async () => {
    const engine = newEngine();
    engine.refreshRolePackPermissions();
    expect(listedNames(engine)).not.toContain('search_knowledge');
    expect(openAINames(engine)).not.toContain('search_knowledge');
    expect(engine.getToolRegistry().allToolNames()).toHaveLength(0);

    const result = await engine.processMessage('请介绍一下你能做什么');
    expect(result.reply).toBe(FAKE_REPLY); // fake provider 定值 ⇒ 无岗位路径未被知识工具改写
    expect(listedNames(engine)).not.toContain('search_knowledge');
  });

  it('B-J6-2 系统工具不进注册表；allowlist 对**注册工具**的过滤语义不被系统工具动摇', () => {
    writeRolePack();
    writeApprovalRecord();
    const engine = newEngine(rolePersona());
    const registry = engine.getToolRegistry();
    registry.register({
      name: 'zz_probe_tool',
      description: '探针',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    });
    engine.refreshRolePackPermissions();

    const names = listedNames(engine);
    expect(names).toContain('search_knowledge');
    // 该岗位包未声明 zz_probe_tool ⇒ allowlist=[]：注册工具照旧被过滤（白名单语义未被系统工具动摇）
    expect(names).not.toContain('zz_probe_tool');
    expect(names).toEqual([...names].sort()); // 合并后仍按 name 排序
    expect(registry.allToolNames()).toEqual(['zz_probe_tool']); // allToolNames 只有注册项
  });
});
