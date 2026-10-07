/**
 * l4/sog-schema-validator.ts — SOG 数据入库 Schema 校验 (v3.3 20.5)
 *
 * 在 graph-store.ts 的 createNode/createEdge 入口处校验数据格式。
 * 校验失败 → 拒绝写入 + 日志告警 + 返回错误（degraded，不崩）。
 * 和 expert output_schema 用同一套类型守卫模式。
 *
 * #980 / 0-6（K8，第0批-止血）: 「未覆盖类型」由**静默放行**（原 `if (!schema) return []`）改为
 * **可见降级** —— 仍然放行（不阻断，卡面硬约束），但登记模块级聚合器 + 边沿触发告警，
 * 并把降级元素与「校验失败」显式区分（避免未覆盖类型打假失败告警）。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('l4/sog-schema-validator');

// ═══ Types ═══

export interface SchemaRule {
  required?: string[];
  properties?: Record<string, PropRule>;
}

export interface PropRule {
  type: 'string' | 'number' | 'boolean';
  min?: number;
  max?: number;
  maxLength?: number;
  enum?: string[];
}

export interface ValidationError {
  nodeType: string;
  field: string;
  value: unknown;
  expected: string;
  /**
   * 降级标记（#980 / 0-6）。仅「schema 未覆盖」路径产生：该元素不是校验失败，
   * 而是「放行 + 可见降级」。已有 8 个 schema 的报错元素不带本字段（缺省 = 硬错误）。
   */
  degraded?: boolean;
}

// ═══ Schema 定义 ═══

const NODE_SCHEMAS: Record<string, SchemaRule> = {
  FINANCIAL: {
    required: [],
    properties: {
      revenue: { type: 'number', min: 0 },
      cost: { type: 'number', min: 0 },
      cash_balance: { type: 'number', min: 0 },
      operating_expenses: { type: 'number', min: 0 },
      accounts_receivable: { type: 'number', min: 0 },
    },
  },
  PERSON: {
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 120 },
      role: { type: 'string', maxLength: 80 },
      team: { type: 'string', maxLength: 80 },
    },
  },
  CLIENT: {
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 120 },
      revenue: { type: 'number', min: 0 },
      status: { type: 'string', enum: ['active', 'churned', 'prospect', 'inactive'] },
      nps: { type: 'number', min: -100, max: 100 },
    },
  },
  RISK: {
    required: ['severity'],
    properties: {
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'warning', 'info'] },
      confidence: { type: 'number', min: 0, max: 1 },
    },
  },
  GOAL: {
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 200 },
      progress: { type: 'number', min: 0, max: 100 },
    },
  },
  AGENT: {
    properties: {
      agent_id: { type: 'string', maxLength: 80 },
      status: { type: 'string', enum: ['active', 'inactive', 'degraded'] },
    },
  },
  TEAM: {
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 120 },
      headcount: { type: 'number', min: 1, max: 100000 },
    },
  },
  DOCUMENT: {
    required: ['name'],
    properties: {
      name: { type: 'string', maxLength: 200 },
      docType: { type: 'string', maxLength: 60 },
    },
  },
};

// ═══ 未覆盖类型聚合器（#980 / 0-6 可见降级）═══

/**
 * nodeType → 命中次数。key 顺序 = 首见序（Map 天然保序）。
 * 用途: 把「静默放行」变成可查询、可告警的降级信号（仍不阻断写入 —— 卡面硬约束）。
 */
const uncoveredTypeHits = new Map<string, number>();

/** 汇总告警步长: 每新增 N 种 distinct 未覆盖类型再汇总一条（边沿触发，禁逐条刷屏）。 */
const UNCOVERED_SUMMARY_EVERY = 20;

/**
 * 登记一次未覆盖类型命中，并按边沿触发规则告警。
 *
 * 契约:
 *   @input  nodeType — 未命中 NODE_SCHEMAS 的节点类型
 *   @output void（副作用: 更新聚合器 + 条件性 log.warn）
 *   @degraded 本函数即降级路径本身；绝不抛
 *
 * 告警规则（防刷屏上界 = 1 + ceil(distinct 数 除以 20)）:
 *   1. 全局首个未覆盖类型 → 立即告警 '未覆盖类型 — 静默放行 (degraded)'
 *   2. 之后每新增 UNCOVERED_SUMMARY_EVERY 种（distinct 数 % 20 === 0）→ 汇总告警 '未覆盖类型 N 个'
 */
function recordUncoveredType(nodeType: string): void {
  const seenBefore = uncoveredTypeHits.get(nodeType) ?? 0;
  uncoveredTypeHits.set(nodeType, seenBefore + 1);
  if (seenBefore > 0) return; // 已登记类型 —— 只在"边沿"告警，不逐条刷屏

  const distinct = uncoveredTypeHits.size;
  const extra = {
    nodeType,
    uncoveredTypes: [...uncoveredTypeHits.keys()], // 类型清单（供定位）
    uncoveredTypesCount: distinct,                 // N = 当前 distinct 数
  };

  if (distinct === 1) {
    log.warn(extra, '未覆盖类型 — 静默放行 (degraded)');
    return;
  }
  if (distinct % UNCOVERED_SUMMARY_EVERY === 0) {
    log.warn(extra, `未覆盖类型 ${distinct} 个`);
  }
}

// ═══ 校验逻辑 ═══

function validateProp(value: unknown, rule: PropRule, nodeType: string, field: string): ValidationError | null {
  if (value === undefined || value === null) return null; // 可选字段跳过

  if (rule.type === 'number' && typeof value !== 'number') {
    return { nodeType, field, value, expected: `number (got ${typeof value})` };
  }
  if (rule.type === 'string' && typeof value !== 'string') {
    return { nodeType, field, value, expected: `string (got ${typeof value})` };
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    return { nodeType, field, value, expected: `boolean (got ${typeof value})` };
  }

  if (rule.type === 'number' && typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) {
      return { nodeType, field, value, expected: `number >= ${rule.min}` };
    }
    if (rule.max !== undefined && value > rule.max) {
      return { nodeType, field, value, expected: `number <= ${rule.max}` };
    }
  }

  if (rule.type === 'string' && typeof value === 'string') {
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      return { nodeType, field, value, expected: `string max ${rule.maxLength} chars (got ${value.length})` };
    }
    if (rule.enum && !rule.enum.includes(value)) {
      return { nodeType, field, value, expected: `one of [${rule.enum.join(', ')}]` };
    }
  }

  return null;
}

/**
 * 校验单个节点的 props。返回错误列表（空 = 通过）。
 *
 * 契约:
 *   @input  nodeType — 节点类型; props — 节点属性
 *   @output schema 未覆盖的类型 → **单元素**降级数组（degraded: true），供调用方区分
 *           「校验失败」与「未覆盖放行」；已覆盖类型 → 与改造前逐字一致的硬错误列表（不含 degraded）
 *   @degraded 未覆盖类型即降级路径: 登记聚合器 + 返回 degraded 元素；**绝不抛**
 */
export function validateNodeProps(nodeType: string, props: Record<string, unknown>): ValidationError[] {
  const schema = NODE_SCHEMAS[nodeType];
  if (!schema) {
    // #980 / 0-6: 原 `return []` 为静默放行 —— 现改为「放行 + 可见降级」（不阻断写入）
    recordUncoveredType(nodeType);
    return [{
      nodeType,
      field: '*',
      value: null,
      expected: 'schema 未覆盖 — 放行 (degraded)',
      degraded: true,
    }];
  }

  const errors: ValidationError[] = [];

  // 必填字段检查
  if (schema.required) {
    for (const field of schema.required) {
      if (props[field] === undefined || props[field] === null || props[field] === '') {
        errors.push({ nodeType, field, value: props[field], expected: 'required, non-empty' });
      }
    }
  }

  // 属性类型检查
  if (schema.properties) {
    for (const [field, rule] of Object.entries(schema.properties)) {
      const err = validateProp(props[field], rule, nodeType, field);
      if (err) errors.push(err);
    }
  }

  return errors;
}

/**
 * 校验并记录。返回 true = 通过（含"仅降级"情形，不阻断写入）。
 *
 * 契约:
 *   @input  nodeType / props
 *   @output true = 无硬错误（无错 或 仅未覆盖降级）；false = 存在硬错误（已逐条 log.warn）
 *   @degraded 未覆盖类型 → 返回 true（不阻断）且**不**输出"校验失败"文案（避免假失败告警）
 */
export function validateAndLog(nodeType: string, props: Record<string, unknown>): boolean {
  const errors = validateNodeProps(nodeType, props);
  // #980 / 0-6: 显式区分「硬错误」与「未覆盖降级」—— degraded 元素不得触发阻断或假失败文案
  const hardErrors = errors.filter(e => !e.degraded);
  if (hardErrors.length === 0) return true;

  for (const e of hardErrors) {
    log.warn({
      nodeType: e.nodeType,
      field: e.field,
      value: String(e.value).slice(0, 60),
      expected: e.expected,
    }, `[SOG-schema] ${e.nodeType}.${e.field} 校验失败: 期望 ${e.expected}`);
  }

  return false;
}

/**
 * 未覆盖类型聚合统计（#980 / 0-6）。供探针 / 运维定位"哪些类型正在静默放行"。
 *
 * @returns uncoveredTypes 首见序 distinct 类型清单；count 其数量（去重口径）
 */
export function getUncoveredTypeStats(): { uncoveredTypes: string[]; count: number } {
  const uncoveredTypes = [...uncoveredTypeHits.keys()];
  return { uncoveredTypes, count: uncoveredTypes.length };
}

/** 清空未覆盖类型聚合器（测试隔离 / 运维复位）。 */
export function resetUncoveredTypeStats(): void {
  uncoveredTypeHits.clear();
}
