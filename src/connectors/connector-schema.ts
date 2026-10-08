/**
 * connectors/connector-schema.ts — 连接器侧 schema 契约（#1384 V2b）
 *
 * 两件事（同一主题：**让声明面约束实际面**）：
 *   ① `amount` 语义拆分：category ⇒ 本体字段（**词表只在文件里**：extensions/ontology/field-mappings/csv-money.json）
 *   ② **写入侧** requiredProps 校验：真源 = extensions/ontology/<type>.json
 *
 * 契约（铁律 47）:
 *   @input  splitAmountByCategory(category) ｜ resolveEntityType() ｜ checkRequiredProps(type, props)
 *   @output field ∈ {total_revenue, total_cost, null}（null ⇒ warn）；{ ok, missing, required }
 *   @degraded 映射/schema 文件不可读 ⇒ **显式降级 + log.warn**（映射：一律"未识别"；schema：fail-open 不阻断写入）
 *   @invariant ① **不硬编码词表/requiredProps**（真源都在文件里）；② 只读、不改 props、不写库
 *   @not-here 违反后的处置策略（阻断 vs 降级）由调用方决定；导入面显式声明 entity_type（卡外）
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';

const log = createLogger('connectors/connector-schema');
const logGuard = createLogger('connectors/connector-schema.guard');

interface Rule { target: string; semantics: string; categories: string[] }
interface MoneyMapping { rules: Rule[]; unmatched: { warn: boolean; reason: string }; entityType: { value: string | null; warn: boolean; reason: string } }

let cached: MoneyMapping | null = null;

/** 读映射文件（缺失/损坏 ⇒ fail-closed：空规则 ⇒ 一律未识别 + warn） */
function loadCsvMoneyMapping(): MoneyMapping {
  if (cached) return cached;
  const p = join(process.cwd(), 'extensions', 'ontology', 'field-mappings', 'csv-money.json');
  try {
    cached = JSON.parse(readFileSync(p, 'utf-8')) as MoneyMapping;
    return cached;
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err), degraded: true, reason: 'money-mapping-unreadable' },
      'CSV 金额映射不可读 ⇒ 一律按"未识别"处理（null + warn；不静默）');
    cached = { rules: [], unmatched: { warn: true, reason: 'mapping-unreadable' }, entityType: { value: null, warn: true, reason: 'mapping-unreadable' } };
    return cached;
  }
}

/** 语义拆分：category ⇒ 本体字段（词表来自文件；未识别 ⇒ null + warn） */
export function splitAmountByCategory(
  category: string | undefined,
): { field: string | null; matchedBy?: string; warn: boolean; reason: string } {
  const m = loadCsvMoneyMapping();
  const c = (category ?? '').trim().toLowerCase();
  for (const rule of m.rules) {
    if (rule.categories.some(k => k.toLowerCase() === c)) {
      return { field: rule.target, matchedBy: rule.semantics, warn: false, reason: rule.semantics };
    }
  }
  return { field: null, warn: m.unmatched.warn, reason: m.unmatched.reason };
}

/** `entity_type` 处置（本体 requiredProps，但仓内无定义）⇒ null + warn */
export function resolveEntityType(): { value: string | null; warn: boolean; reason: string } {
  const e = loadCsvMoneyMapping().entityType;
  return { value: e.value, warn: e.warn, reason: e.reason };
}

interface OntologySchema { requiredProps?: string[] }

/** 校验 props 是否满足本体类型的 requiredProps。schema 不可读 ⇒ ok=true + warn（fail-open，不阻断写入）。 */
export function checkRequiredProps(type: string, props: Record<string, unknown>): { ok: boolean; missing: string[]; required: string[] } {
  const p = join(process.cwd(), 'extensions', 'ontology', `${type}.json`);
  let schema: OntologySchema;
  try {
    schema = JSON.parse(readFileSync(p, 'utf-8')) as OntologySchema;
  } catch (err: unknown) {
    logGuard.warn({ type, err: err instanceof Error ? err.message : String(err), degraded: true, reason: 'schema-unreadable' },
      '本体 schema 不可读 ⇒ 跳过校验（不阻断写入；显式降级）');
    return { ok: true, missing: [], required: [] };
  }
  const required = schema.requiredProps ?? [];
  const missing = required.filter(k => props[k] === undefined || props[k] === null || props[k] === '');
  return { ok: missing.length === 0, missing, required };
}
