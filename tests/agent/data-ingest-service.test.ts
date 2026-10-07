/**
 * data-ingest-service.test.ts — 数据接入编排服务单元测试 (L2)
 *
 * D470: 契约错位修复（crm/hr field-mapping + ingest 目标 schema 校验）。
 * D477: standardKey 块读收敛（period 取自白名单映射 props，行级英文键旁路关闭）。
 * 铁律 33: *.test.ts 单元测试。铁律 48: 每用例真实 expect 断言，覆盖正常/降级/边界。
 * 铁律 12: 真实 JSON 文件驱动（loadFieldMapping 直读 extensions/ontology/field-mappings/），不 mock 管线。
 *
 * red→green 证据（S-5）:
 *   修复前（financial 白名单）: 用例1 失败于 props.revenue（全部业务字段被跳过）；
 *   用例2/3/5 因 loadNodeTypeSchema 尚不存在而红（动态导入使 red 定位到用例断言而非模块级 import 错误）；
 *   修复后（目标节点类型 schema 白名单 + crm/hr 映射补字段）: 5 用例全绿。
 *   D477 red: 修复前用例6a 失败于中文键行 standardKey 缺失（row['period'] 英文键直读拿不到中文键值），
 *   用例6b 失败于行级英文 period 键绕过白名单注入 props.period + standardKey；
 *   修复后（standardKey 块消费 props.period）: 6a 生成 D29/D33 契约 standardKey、6b 旁路关闭，全绿。
 */
import { describe, it, expect } from 'vitest';
import {
  loadFieldMapping,
  loadFinancialSchema,
  ingestBatch,
  type FieldMappingConfig,
} from '../../src/agent/data-ingest-service';

/** 注入式 fake store：捕获 createNode 调用（既有测试注入风格，不 vi.mock） */
function fakeStore() {
  const nodes: Array<{ type: string; props: Record<string, unknown>; graph: string }> = [];
  return {
    nodes,
    store: {
      createNode(type: string, props: Record<string, unknown>, graph: string): string {
        nodes.push({ type, props, graph });
        return `node-${nodes.length}`;
      },
    },
  };
}

/** 加载真实 field-mapping JSON；失败信息直指 process.cwd() 根因 */
function requireMapping(name: string): NonNullable<ReturnType<typeof loadFieldMapping>> {
  const m = loadFieldMapping(name);
  if (!m) throw new Error(`${name}.json 未找到 — process.cwd() 必须是仓库根: ${process.cwd()}`);
  return m;
}

/**
 * D470: 动态导入 loadNodeTypeSchema。
 * red 阶段该导出不存在，静态 import 会让整个测试文件在模块加载期报
 * "does not provide an export"，red 证据无法定位到各用例断言；动态导入
 * 使 red 失败点落在调用处（TypeError: not a function），green 后正常。
 */
async function loadNodeSchema(
  targetNodeType: string,
): Promise<{ requiredProps: string[]; optionalProps: Record<string, unknown> } | null> {
  const { loadNodeTypeSchema } = await import('../../src/agent/data-ingest-service');
  return loadNodeTypeSchema(targetNodeType);
}

describe('data-ingest-service — D470 目标 schema 校验', () => {
  it('用例1 缺陷A修复: crm-standard 行写入 revenue/status，其余指标被目标 schema 跳过且非静默（red→green）', async () => {
    const mapping = requireMapping('crm-standard');
    const fake = fakeStore();
    // 数字以字符串喂入，顺带覆盖 ingestRow 的 Number 转换路径
    const row = {
      市场份额: '12.5',
      净推荐值: '60',
      客户满意度: '85',
      品牌知名度: '70',
      客户集中度: '0.3',
      流失率: '0.05',
      收入: '1200',
      客户状态: 'active',
      期间: '2026-Q2',
    };

    const result = await ingestBatch(fake.store, mapping, [row]);

    expect(result.ok).toBe(true);
    expect(result.nodesCreated).toBe(1);
    expect(result.nodeType).toBe('resource/client');   // #1395：写入侧对齐本体轴
    // red 点: 修复前 financial 白名单跳过全部业务字段 → revenue undefined → 失败
    expect(fake.nodes[0].props.revenue).toBe(1200);
    expect(fake.nodes[0].props.status).toBe('active');
    // D7 固化: market_share/nps 等 6 指标 + period 不在 Client schema → 不写入
    expect(fake.nodes[0].props).not.toHaveProperty('nps');
    expect(fake.nodes[0].props).not.toHaveProperty('market_share');
    expect(fake.nodes[0].props).not.toHaveProperty('period');
    expect(fake.nodes[0].props.financialType).toBe('crm-standard');
    expect(result.errors).toEqual([]);
    // 7 个被跳过 prop（6 指标 + period）全部进入 warnings —— 非静默（铁律 31）
    expect(result.warnings).toHaveLength(7);
    expect(result.warnings.some((w) => w.includes('nps'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('period'))).toBe(true);
  });

  it('用例2 crm 契约: 映射与 Client schema 双向对齐（静态）', async () => {
    const mapping = requireMapping('crm-standard');
    expect(mapping.targetNodeType).toBe('resource/client');   // #1395

    const revenue = mapping.mappings.find((m) => m.prop === 'revenue');
    expect(revenue).toEqual({ externalField: '收入', prop: 'revenue', type: 'number' });
    const status = mapping.mappings.find((m) => m.prop === 'status');
    expect(status).toEqual({ externalField: '客户状态', prop: 'status', type: 'string' });

    const schema = await loadNodeSchema('resource/client');   // #1395：限定名
    if (!schema) throw new Error('client.json 未加载 — process.cwd() 必须是仓库根');
    expect(schema.requiredProps).toContain('name');
    expect(schema.optionalProps).toHaveProperty('revenue', 'number');
    expect(schema.optionalProps).toHaveProperty('status', 'string');
  });

  it('用例3 hr 契约: per-person 字段写入 + 聚合指标跳过非静默 + PII 掩码既有行为', async () => {
    const mapping = requireMapping('hr-standard');
    expect(mapping.targetNodeType).toBe('Person');   // #1395：hr-standard 属 **B2**（本批 B1 未处理 ⇒ 仍遗留名）
    for (const [externalField, prop] of [
      ['姓名', 'name'],
      ['知识领域', 'skills'],
      ['角色', 'role'],
      ['所属团队', 'teamId'],
    ]) {
      expect(mapping.mappings.find((m) => m.prop === prop)).toEqual({
        externalField,
        prop,
        type: 'string',
      });
    }

    const schema = await loadNodeSchema('Person');   // #1395：hr-standard 属 B2 ⇒ 遗留名（B1 只支持限定名，双形态兼容）
    if (!schema) throw new Error('person.json 未加载 — process.cwd() 必须是仓库根');
    const valid = new Set([...Object.keys(schema.optionalProps), ...schema.requiredProps]);
    for (const p of ['name', 'skills', 'role', 'teamId']) {
      expect(valid.has(p), `${p} 应在 Person schema 白名单`).toBe(true);
    }
    // D7 固化: 团队聚合指标与 period 不属于 Person 资源节点——
    // 修复前被 financial 白名单跳过，修复后被 person 白名单跳过，行为等价、通道由静默变 warnings
    expect(valid.has('headcount')).toBe(false);
    expect(valid.has('period')).toBe(false);

    const fake = fakeStore();
    // row1: 姓名/角色避开姓氏+字的任意位置子串（S2 chinese_name 正则匹配任何位置，
    // 如"工程师"的"程师"即命中）与英文姓名模式，防 S2 掩码干扰契约断言；
    // 提供 员工总数 触发 skip-warning 路径，其余 5 个聚合字段缺失——
    // 白名单检查先于缺失检查，聚合字段走 warning 不产生 error
    const row1 = {
      姓名: '测试员工',
      知识领域: '机器学习,数据分析',
      角色: '研发',
      所属团队: 'team-01',
      期间: '2026-H1',
      员工总数: '100',
    };
    // row2: 记录 D34 既有行为——真实姓名经 PII scrub(S2) 掩码为 [姓名]（防未来误改 scrub 写入顺序）
    const row2 = {
      姓名: '张伟',
      知识领域: '深度学习',
      角色: '研究员',
      所属团队: 'team-02',
      期间: '2026-H1',
    };

    const result = await ingestBatch(fake.store, mapping, [row1, row2]);

    expect(result.ok).toBe(true);
    expect(result.nodesCreated).toBe(2);
    expect(result.nodeType).toBe('Person');   // #1395：hr-standard 属 **B2**

    const node1 = fake.nodes[0].props;
    expect(node1.name).toBe('测试员工');
    expect(node1.skills).toBe('机器学习,数据分析');
    expect(node1.role).toBe('研发');
    expect(node1.teamId).toBe('team-01');
    expect(node1).not.toHaveProperty('headcount');
    expect(node1).not.toHaveProperty('period');
    // 无 PII 命中的行不写 pii_scrubbed 键（仅 matches>0 或 scrub 异常降级时写）
    expect(node1).not.toHaveProperty('pii_scrubbed');

    const node2 = fake.nodes[1].props;
    expect(node2.name).toBe('[姓名]');
    expect(node2.pii_scrubbed).toBe(true);

    // 每行 7 个跳过（headcount + 5 聚合 + period，均为目标 schema 白名单外）× 2 行 = 14
    expect(result.warnings).toHaveLength(14);
    expect(result.warnings.some((w) => w.includes('headcount'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('period'))).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('用例4 未知 prop 边界: 跳过且非静默 + 目标 schema 缺失 fail-open 非静默', async () => {
    // 场景 A: 真实 Client schema + 内联 config 的未知 prop
    const boundaryConfig: FieldMappingConfig = {
      name: 'boundary-test',
      label: '边界测试',
      targetNodeType: 'Client',
      mappings: [{ externalField: '神秘字段', prop: 'bogus_field', type: 'string' }],
    };
    const fakeA = fakeStore();
    const resultA = await ingestBatch(fakeA.store, boundaryConfig, [{ 神秘字段: 'x' }]);

    expect(resultA.ok).toBe(true);
    expect(resultA.nodesCreated).toBe(1);
    expect(resultA.errors).toEqual([]);
    expect(fakeA.nodes[0].props).not.toHaveProperty('bogus_field');
    expect(fakeA.nodes[0].props.financialType).toBe('boundary-test');
    // 非只 log.warn 无痕: 跳过信号在 API 响应 warnings 中可查
    expect(resultA.warnings.some((w) => w.includes('bogus_field'))).toBe(true);

    // 场景 B: 目标 schema 缺失（resource/ 与 outcome/ 均无 nonexistenttype.json）→ fail-open 不阻断
    const missingConfig: FieldMappingConfig = {
      name: 'missing-schema-test',
      label: '缺失schema测试',
      targetNodeType: 'NonExistentType',
      mappings: [{ externalField: 'X', prop: 'weird_prop', type: 'string' }],
    };
    const fakeB = fakeStore();
    const resultB = await ingestBatch(fakeB.store, missingConfig, [{ X: 'y' }]);

    expect(resultB.ok).toBe(true);
    expect(resultB.nodesCreated).toBe(1);
    expect(fakeB.nodes[0].props.weird_prop).toBe('y');
    expect(resultB.warnings.some((w) => w.includes('NonExistentType') && w.includes('跳过字段校验'))).toBe(true);
  });

  it('用例5 Financial 回归: loadNodeTypeSchema 回退 financial.json，erp-standard 行为不变', async () => {
    // 回退分支接线: Financial 显式走 loadFinancialSchema()（legacy 语义逐位保留）
    const financialSchema = loadFinancialSchema();
    const nodeSchema = await loadNodeSchema('Financial');
    expect(nodeSchema).toEqual(financialSchema);
    expect(financialSchema.requiredProps).toEqual(['period']);
    expect(financialSchema.optionalProps).toHaveProperty('total_revenue');
    expect(financialSchema.optionalProps).not.toHaveProperty('nps');
    // outcome/ 搜索路径: Operational 的 schema 在 outcome/operational.json（D4 决策）
    expect(await loadNodeSchema('Operational')).not.toBeNull();

    const mapping = requireMapping('erp-standard');
    expect(mapping.targetNodeType).toBe('Financial');   // #1395：erp-standard 属 **B2**（本批 B1 未处理）
    const fake = fakeStore();
    const row = {
      营业收入: '1200',
      经营现金流: '300',
      固定资产净值: '800',
      总负债: '500',
      所有者权益: '900',
      现金余额: '150',
      毛利润: '400',
      营业费用: '200',
      总资产: '2000',
      流动资产: '600',
      流动负债: '250',
      应收账款: '180',
      存货: '120',
      期间: '2026-Q2',
    };

    const result = await ingestBatch(fake.store, mapping, [row]);

    expect(result.ok).toBe(true);
    expect(result.nodesCreated).toBe(1);
    expect(result.nodeType).toBe('Financial');   // #1395：erp-standard 属 **B2**（B1 已支持限定名，但该 mapping 待 B2 改）
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    const props = fake.nodes[0].props;
    const expected = {
      total_revenue: 1200,
      operating_cashflow: 300,
      net_ppe: 800,
      total_debt: 500,
      equity: 900,
      cash: 150,
      gross_margin: 400,
      operating_expense: 200,
      total_assets: 2000,
      current_assets: 600,
      current_liabilities: 250,
      receivables: 180,
      inventory: 120,
      period: '2026-Q2',
    };
    for (const [k, v] of Object.entries(expected)) {
      expect(props[k], `${k} 应写入`).toBe(v);
    }
    expect(props.financialType).toBe('erp-standard');
  });

  it('用例6a standardKey 收敛: 中文键「期间」行经白名单映射生成 standardKey（D29/D33 契约回归）', async () => {
    // D477: standardKey 块 period 来源 = 映射白名单校验后的 props.period。
    // red 点: 修复前 row['period'] 直读英文键，中文键行 props.period 已写入但 standardKey 不生成。
    // green: standardKey = ${graph}:${targetNodeType}:${period}:${validFrom}（D29/D33 契约格式不变）
    const mapping = requireMapping('erp-standard');
    const fake = fakeStore();
    const row = {
      营业收入: '1200',
      经营现金流: '300',
      固定资产净值: '800',
      总负债: '500',
      所有者权益: '900',
      现金余额: '150',
      毛利润: '400',
      营业费用: '200',
      总资产: '2000',
      流动资产: '600',
      流动负债: '250',
      应收账款: '180',
      存货: '120',
      期间: '2026-Q2',
    };

    const result = await ingestBatch(fake.store, mapping, [row]);

    expect(result.ok).toBe(true);
    expect(result.nodesCreated).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(fake.nodes[0].props.period).toBe('2026-Q2');
    // deriveValidFrom('2026-Q2') = '2026-04-01'（src/l3/period-utils.ts 契约）
    expect(fake.nodes[0].props.standardKey).toBe('default:Financial:2026-Q2:2026-04-01');
  });

  it('用例6b standardKey 收敛: 行级英文 period 键不再绕过白名单注入 props.period/standardKey', async () => {
    // D477: 行含英文 'period' 键但映射外部键为中文「期间」（crm-standard）。
    // red 点: 修复前 row['period'] 直读注入 props.period + standardKey（白名单旁路，D470 审计 #2）。
    // green: period 仅能经白名单映射通道写入，行级英文键被忽略（本行「期间」缺失 → 无 period/standardKey）。
    const mapping = requireMapping('crm-standard');
    const fake = fakeStore();
    const row = {
      收入: '1200',
      客户状态: 'active',
      period: '2026-Q2',
    };

    const result = await ingestBatch(fake.store, mapping, [row]);

    expect(result.ok).toBe(true);
    expect(result.nodesCreated).toBe(1);
    expect(fake.nodes[0].props.revenue).toBe(1200);
    expect(fake.nodes[0].props.status).toBe('active');
    // red 点: 修复前此处被注入（props.period === '2026-Q2'）→ 断言失败；修复后旁路关闭
    expect(fake.nodes[0].props).not.toHaveProperty('period');
    expect(fake.nodes[0].props).not.toHaveProperty('standardKey');
  });
});
