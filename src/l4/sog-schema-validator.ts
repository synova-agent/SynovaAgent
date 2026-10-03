/**
 * l4/sog-schema-validator.ts — SOG 数据入库 Schema 校验 (v3.3 20.5)
 *
 * 在 graph-store.ts 的 createNode/createEdge 入口处校验数据格式。
 * 校验失败 → 拒绝写入 + 日志告警 + 返回错误（degraded，不崩）。
 * 和 expert output_schema 用同一套类型守卫模式。
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
}

/**
 * 单次 props 校验结论。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: 由 `validateNodeProps(nodeType, props)` 产出。
 * - 输出: `errors` 为空**不等于**校验通过 —— 当 `degraded=true` 时语义是"**未校验**（已放行）"。
 *         `uncoveredType` 仅在 `degraded=true` 时给出，指向缺 schema 的那个 nodeType。
 * - 降级: `degraded=true` 即降级标记（铁律 11/31）——该类型无 schema，数据已放行但**未被校验**。
 *         调用方必须检查，**不得**把 `errors.length === 0` 当作"通过"。
 */
export interface SchemaValidationResult {
  errors: ValidationError[];
  degraded: boolean;
  uncoveredType?: string;
}

/**
 * 本进程内出现过的、无 schema 覆盖的节点类型（去重，按首次出现顺序）。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: 模块内状态，仅在 `validateNodeProps` 命中未知 nodeType 时写入。
 * - 输出: 未覆盖类型名集合；`size` 即告警文案里的「未覆盖类型 N 个」。
 * - 降级: 不适用（纯内存 Set，无 IO、无异常路径）。
 *
 * Why 按"类型"去重而非按"次数"计数: 同一类型在一次诊断中会被写入成百上千次，
 * 按次数报警会把日志淹掉 —— 噪音会让降级信号被无视，正是铁律 11 想防的反面。
 */
const uncoveredNodeTypes = new Set<string>();

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
 * 校验单个节点的 props。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: `nodeType`（节点类型名）+ `props`（待写入的属性）。
 * - 输出: `SchemaValidationResult` —— `errors` 为该次校验发现的错误列表（空 = 无错误）。
 * - 降级: 该 nodeType **无 schema** 时 `degraded=true` + `uncoveredType=nodeType`，`errors` 为空，
 *         **不阻断写入**（文件驱动扩展允许新类型先落地）。降级信号同时以 `log.warn` 显形
 *         （铁律 11/31）。
 */
export function validateNodeProps(nodeType: string, props: Record<string, unknown>): SchemaValidationResult {
  const schema = NODE_SCHEMAS[nodeType];
  if (!schema) {
    // 未知类型 — 不阻断（允许文件驱动扩展），但**不得静默**（铁律 11/31）
    const firstSighting = !uncoveredNodeTypes.has(nodeType);
    uncoveredNodeTypes.add(nodeType);
    if (firstSighting) {
      log.warn(
        {
          code: 'SOG_SCHEMA_UNCOVERED',
          nodeType,
          uncoveredCount: uncoveredNodeTypes.size,
          uncoveredTypes: [...uncoveredNodeTypes],
          coveredCount: Object.keys(NODE_SCHEMAS).length,
        },
        `[SOG-schema] 未覆盖类型 ${uncoveredNodeTypes.size} 个（本次新增 ${nodeType}）— 该类型数据已放行但未校验（degraded，不阻断）`,
      );
    }
    return { errors: [], degraded: true, uncoveredType: nodeType };
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

  return { errors, degraded: false };
}

/**
 * 校验并记录。返回 true = 通过（含"无 schema 放行"的降级放行）。
 *
 * 契约（铁律 47 — 输入/输出/降级）:
 * - 输入: `nodeType` + `props`。
 * - 输出: `true` = 通过或降级放行；`false` = 存在校验错误（错误已逐条 `log.warn`）。
 * - 降级: 无 schema 的类型返回 `true`（**不阻断**，语义同改造前）；降级告警由
 *         `validateNodeProps` 发出，此处不重复打日志（防噪音）。
 */
export function validateAndLog(nodeType: string, props: Record<string, unknown>): boolean {
  const result = validateNodeProps(nodeType, props);

  // 降级放行（无 schema）不计为校验失败 —— 与改造前行为一致（不阻断），告警已在上游发出
  if (result.degraded) return true;
  if (result.errors.length === 0) return true;

  for (const e of result.errors) {
    log.warn({
      nodeType: e.nodeType,
      field: e.field,
      value: String(e.value).slice(0, 60),
      expected: e.expected,
    }, `[SOG-schema] ${e.nodeType}.${e.field} 校验失败: 期望 ${e.expected}`);
  }

  return false;
}
