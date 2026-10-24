/**
 * tests/agent/tool-args-validation.test.ts — #915 Q-1 工具入参统一校验（运行时面判据）
 *
 * 判据源（唯一准绳）：
 *   handbook 派单件/2026-10-24-规格-915-Q1-工具入参校验.md
 *   §5.1（S1–S7 ＋ S5b）＋ §5.1bis（库存断言①–⑤）；改坏⇒红 M1/M2 见 PR 正文。
 *
 * 覆盖矩阵（正常 / 降级 / 边界 / 棘轮）：
 *   正常   S3 合法入参行为不变（防「全拒」假绿）｜库存③ 36 个 schema 全可编译
 *   降级   S4 回滚开关 SYNO_TOOL_ARGS_VALIDATION=0 直达 handler｜S6 schema 不可编译 ⇒ fail-closed ＋ degraded 留痕
 *   边界   S1 类型错／S2 缺必填／S5 非对象（null／数组／标量）／S5b 对象性兜底先于 zod 编译／S7 enum 越界
 *   棘轮   库存① 36 真注册 ＋ 8 未接线缺席｜② 空 schema 集合｜④ 34 错型探针 ＋ 2 nullary 豁免（skip===2）｜⑤ baseline 交叉对账
 *
 * 铁律 33/47/48：走真实 ToolRegistry.execute 路径（零 mock 替身），每条用例必有断言调用（禁空壳）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ToolRegistry, validateToolArgs } from '../../src/agent/tools';
import type { ToolCallResult, ToolDefinition } from '../../src/agent/tools';
import { registerBuiltinTools } from '../../src/agent/builtin-tools';
import { SessionStore } from '../../src/store/session-store';

// ═══ 探针：S1–S7 用最小 ToolRegistry（handler 即 spy）═══

interface ProbeRegistry {
  registry: ToolRegistry;
  /** handler 实收入参序列 —— spy 面（spy===0 即证明 handler 未被调用） */
  calls: Array<Record<string, unknown>>;
}

function makeProbe(name: string, parameters: ToolDefinition['parameters']): ProbeRegistry {
  const calls: Array<Record<string, unknown>> = [];
  const registry = new ToolRegistry();
  registry.register({
    name,
    description: `#915 Q-1 探针工具 ${name}`,
    parameters,
    handler: async (params) => {
      calls.push(params);
      return { ok: true };
    },
  });
  return { registry, calls };
}

/** 结构化 error 断言（禁 cast：用 typeof 收窄；失败文本直接点名 code 期望值） */
function expectInvalidArgs(result: ToolCallResult): {
  name: string;
  code: string;
  message: string;
  violations?: string[];
} {
  expect(result.error).toMatchObject({ name: 'ToolArgsError', code: 'INVALID_ARGS' });
  const err = result.error;
  if (typeof err !== 'object' || err === null) {
    throw new Error(`期望结构化 ToolArgsError，实得: ${String(err)}`);
  }
  return err;
}

const ORG_SCHEMA: ToolDefinition['parameters'] = {
  type: 'object',
  properties: { orgId: { type: 'string' } },
  required: ['orgId'],
};

const REF_SCHEMA: ToolDefinition['parameters'] = {
  type: 'object',
  properties: { a: { $ref: '#/defs/x' } },
};

// ═══ S1–S7 ＋ S5b（§5.1）═══

describe('S1–S7 运行时判据（dispatch 前校验 / 结构化错误 / fail-closed / 回滚）', () => {
  it('S1 类型错 ⇒ error.code=INVALID_ARGS 且 violations[0] 点名 $.orgId', async () => {
    const probe = makeProbe('probe', ORG_SCHEMA);
    const result = await probe.registry.execute('probe', { orgId: 123 });
    const err = expectInvalidArgs(result);
    expect(err.violations?.[0]).toMatch(/^\$\.orgId: /);
    expect(probe.calls.length).toBe(0);
  });

  it('S2 缺必填 ⇒ INVALID_ARGS 且 handler spy = 0', async () => {
    const probe = makeProbe('probe', ORG_SCHEMA);
    const result = await probe.registry.execute('probe', {});
    // 先钉 spy（M2「校验挪到 dispatch 之后」必须在此红：此时 spy=1）
    expect(probe.calls.length, 'S2 handler spy 必须为 0 —— 校验必须先于 dispatch').toBe(0);
    expectInvalidArgs(result);
  });

  it('S3 合法入参 ⇒ handler 正常执行且 error === undefined（防「全拒」假绿）', async () => {
    const probe = makeProbe('probe', ORG_SCHEMA);
    const result = await probe.registry.execute('probe', { orgId: 'org-1' });
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(probe.calls.length).toBe(1);
    expect(probe.calls[0]).toEqual({ orgId: 'org-1' });
  });

  it('S4 SYNO_TOOL_ARGS_VALIDATION=0 ⇒ 直达 handler（回滚态，spy = 1）', async () => {
    const probe = makeProbe('probe', ORG_SCHEMA);
    const saved = process.env.SYNO_TOOL_ARGS_VALIDATION;
    process.env.SYNO_TOOL_ARGS_VALIDATION = '0';
    try {
      const result = await probe.registry.execute('probe', { orgId: 123 });
      expect(result.error).toBeUndefined();
      expect(probe.calls.length).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.SYNO_TOOL_ARGS_VALIDATION;
      else process.env.SYNO_TOOL_ARGS_VALIDATION = saved;
    }
  });

  it('S5 非对象入参（null／数组／标量）⇒ violations[0] 恒等于「$: 入参必须是 JSON 对象」且 spy = 0', async () => {
    const probe = makeProbe('probe', ORG_SCHEMA);
    const badParams = [null, [1, 2], 'x'];
    for (const bad of badParams) {
      const result = await probe.registry.execute('probe', bad);
      const err = expectInvalidArgs(result);
      expect(err.violations?.[0]).toBe('$: 入参必须是 JSON 对象');
      expect(err.violations?.length).toBe(1);
    }
    expect(probe.calls.length).toBe(0);
  });

  it('S5b $ref schema ＋ null 入参 ⇒ INVALID_ARGS（对象性兜底先于 zod 编译，非 ARGS_SCHEMA_UNCOMPILABLE）', async () => {
    const probe = makeProbe('probe_ref_null', REF_SCHEMA);
    const result = await probe.registry.execute('probe_ref_null', null);
    const err = expectInvalidArgs(result);
    expect(err.code).not.toBe('ARGS_SCHEMA_UNCOMPILABLE');
    expect(err.violations?.[0]).toBe('$: 入参必须是 JSON 对象');
    expect(probe.calls.length).toBe(0);
  });

  it('S6 schema 不可编译（$ref）＋ 对象入参 ⇒ ARGS_SCHEMA_UNCOMPILABLE、handler 不执行、degraded 留痕', async () => {
    const probe = makeProbe('probe_uncompilable', REF_SCHEMA);
    const result = await probe.registry.execute('probe_uncompilable', {});
    expect(typeof result.error).toBe('object');
    const err = result.error;
    if (typeof err !== 'object' || err === null) {
      throw new Error(`期望结构化 ToolArgsError，实得: ${String(err)}`);
    }
    expect(err.name).toBe('ToolArgsError');
    expect(err.code).toBe('ARGS_SCHEMA_UNCOMPILABLE');
    expect(probe.calls.length).toBe(0);

    // 单测面：degraded 字段必须可证（留痕），且 violations 非空（fail-closed 可归因）
    const tool = probe.registry.getTool('probe_uncompilable');
    expect(tool).toBeDefined();
    if (!tool) throw new Error('探针工具 probe_uncompilable 未注册');
    const unit = validateToolArgs(tool, {});
    expect(unit.degraded).toBeDefined();
    expect(unit.degraded?.startsWith('schema_uncompilable: ')).toBe(true);
    expect(unit.violations.length).toBeGreaterThan(0);
  });

  it('S7 enum 越界 ⇒ INVALID_ARGS 且 violations 含 $.mode', async () => {
    const probe = makeProbe('probe_enum', {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['a', 'b'] } },
    });
    const result = await probe.registry.execute('probe_enum', { mode: 'c' });
    const err = expectInvalidArgs(result);
    expect((err.violations ?? []).some((v) => v.includes('$.mode'))).toBe(true);
  });
});

// ═══ 库存棘轮（§5.1bis；扫描源＝运行时注册表，与闸 R3 的静态扫描互为独立派生）═══

function makeRealRegistry() {
  const db = new Database(':memory:');
  const store = new SessionStore(db);
  const registry = new ToolRegistry();
  registerBuiltinTools(
    registry,
    store,
    'tool-args-validation-probe-session',
    () => 0,
    () => 'tool-args-validation-probe-org',
  );
  return { registry, db };
}

/** 空 schema 判据：properties 缺失或零键（同闸 R1/R3 的「空 schema」口径） */
function hasEmptyProperties(tool: ToolDefinition): boolean {
  const properties = tool.parameters.properties;
  return !properties || Object.keys(properties).length === 0;
}

/** 错型探针入参：有 required ⇒ {}（缺必填）；否则首个 property 传错型值（§5.1bis 断言④） */
function wrongTypeParams(tool: ToolDefinition): Record<string, unknown> {
  const required = tool.parameters.required ?? [];
  if (required.length > 0) return {};
  const firstKey = Object.keys(tool.parameters.properties)[0];
  const declaredType = tool.parameters.properties[firstKey].type;
  // 规格映射：string→123；number→'x'；boolean→'x'；array→'x'；object→'x'
  const wrongValue: unknown = declaredType === 'string' ? 123 : 'x';
  return { [firstKey]: wrongValue };
}

describe('inventory 库存棘轮（36 真注册 / 空 schema 2 / 可编译 / 34 错型探针 / baseline 交叉对账）', () => {
  let real: ReturnType<typeof makeRealRegistry>;

  beforeAll(() => {
    real = makeRealRegistry();
  });

  afterAll(() => {
    real.db.close();
  });

  /** §5.1bis 断言①：真注册 36（8 内置 ＋ 26 已接线专家 ＋ 2 pandoc）＋ 8 个未接线工具缺席 */
  it('断言① 运行时注册表恰 36 个工具，且 8 个未接线工具缺席', () => {
    const tools = real.registry.listTools();
    expect(tools.length).toBe(36);

    const names = tools.map((t) => t.name);
    const unwired = [
      'structure_health_check',
      'value_cycle_audit',
      'canvas_scan',
      'revenue_structure',
      'content_scanner',
      'knowledge_extractor',
      'structured_writer',
      'conflict_detector',
    ];
    expect(unwired.length).toBe(8);
    for (const name of unwired) {
      expect(names).not.toContain(name);
    }
  });

  /** §5.1bis 断言②：空 schema 工具名集合恒等于两名（多 ⇒ 新增盲区红；少 ⇒ 修好未删登记红） */
  it('断言② 空 schema 集合恒等于 [list_scheduled_tasks, show_diagnosis_progress]', () => {
    const emptySchemaNames = real.registry
      .listTools()
      .filter(hasEmptyProperties)
      .map((t) => t.name)
      .sort();
    expect(emptySchemaNames).toEqual(['list_scheduled_tasks', 'show_diagnosis_progress']);
  });

  /** §5.1bis 断言③：36 个 schema 全可编译（= 不可编译面棘轮；新增 $ref 工具即红） */
  it('断言③ 每个工具 schema 均派生可编译（validateToolArgs degraded 均 undefined）', () => {
    const tools = real.registry.listTools();
    for (const tool of tools) {
      const unit = validateToolArgs(tool, {});
      expect(unit.degraded, `工具 ${tool.name} 的 schema 应可编译`).toBeUndefined();
    }
    expect(tools.length).toBe(36);
  });

  /** §5.1bis 断言④：34 个错型探针必须 INVALID_ARGS；2 个 nullary 豁免且 skip===2（防滑到 33/34） */
  it('断言④ 34 个错型探针全 INVALID_ARGS；2 个 nullary 豁免且 skip === 2', async () => {
    const tools = real.registry.listTools();
    const nullary = new Set(
      tools.filter(hasEmptyProperties).map((t) => t.name),
    );
    let probed = 0;
    let skipped = 0;

    for (const tool of tools) {
      if (nullary.has(tool.name)) {
        const unit = validateToolArgs(tool, {});
        expect(unit.violations, `nullary 工具 ${tool.name} 空入参不应有违规`).toEqual([]);
        expect(unit.degraded, `nullary 工具 ${tool.name} 不应 degraded`).toBeUndefined();
        skipped++;
        continue;
      }
      const result = await real.registry.execute(tool.name, wrongTypeParams(tool));
      expectInvalidArgs(result);
      probed++;
    }

    expect(probed).toBe(34);
    expect(skipped).toBe(2);
  });

  /** §5.1bis 断言⑤：baseline 登记集合 == 运行时空 schema 集合（单一登记方向，两条独立派生互校） */
  it('断言⑤ scripts/control-tower/tool-args-baseline.txt 登记集合 == 运行时空 schema 集合', () => {
    const baselinePath = join(process.cwd(), 'scripts/control-tower/tool-args-baseline.txt');
    const raw = readFileSync(baselinePath, 'utf-8');
    const baselineNames = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('|')[0].trim())
      .sort();

    const runtimeNames = real.registry
      .listTools()
      .filter(hasEmptyProperties)
      .map((t) => t.name)
      .sort();

    expect(baselineNames).toEqual(runtimeNames);
    expect(baselineNames.length).toBe(2);
  });
});
