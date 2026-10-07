/**
 * sentinel/mapped-read.ts — 按【显式映射】读图（#1381 V2a：类型轴打通）
 *
 * 契约（铁律 47）:
 *   @input  legacyType：读侧遗留字面量（如 'FINANCIAL'）；filters/graph 透传给底层读
 *   @output `resolveReadTargets` ⇒ { targets：映射到的本体类型（可多个）; warn; reasons }
 *           `readByMappedType`    ⇒ { rows：**多个目标的并集**; usedTypes; legacyFallback; warn }
 *   @degraded **无映射** ⇒ **回退到遗留字面量**读并 `warn=true`（legacyFallback 显式可见，不静默）
 *             **映射文件不可读** ⇒ 同"无映射"处理（fail-closed；见 node-type-resolver）
 *   @invariant ① 只读映射文件，不硬编码映射；② 多目标 = **并集读**（语义子类并存）；
 *              ③ 不改 store 语义、不写库；④ 返回行形状与底层读一致
 *   @not-here ②③④（props 契约对齐 / 消费侧）⇒ **#1381-V2b（p0）**；映射层退役（收口 A）见 #1381 §⑩
 */
import { createLogger } from '@synova/logger';
import { loadNodeTypeMapping } from './node-type-resolver';

const log = createLogger('sentinel/mapped-read');

interface QueryableReader {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): unknown[];
}

/** 取该遗留类型的**全部**映射目标（并集读用）。无映射 ⇒ targets=[] + warn。 */
export function resolveReadTargets(legacyType: string): { targets: string[]; warn: boolean; reasons: string[] } {
  const table = loadNodeTypeMapping().entries;
  let entry = table[legacyType];
  const seen = new Set<string>([legacyType]);
  const reasons: string[] = [];
  while (entry?.aliasOf && !seen.has(entry.aliasOf)) {
    seen.add(entry.aliasOf);
    entry = table[entry.aliasOf];
  }
  if (!entry) return { targets: [], warn: true, reasons: [`映射表无此条目（${legacyType}）`] };
  if (!entry.targets || entry.targets.length === 0) {
    return { targets: [], warn: true, reasons: [entry.reason ?? '语义不决 ⇒ 显式无源'] };
  }
  reasons.push(entry.rule ?? '词表直配');
  return { targets: entry.targets, warn: false, reasons };
}

/**
 * 按映射读：查**全部**映射目标并取并集；无映射 ⇒ 回退遗留字面量 + warn（显式）。
 */
export function readByMappedType(
  reader: QueryableReader,
  legacyType: string,
  filters?: Record<string, unknown>,
  graph?: string,
): { rows: unknown[]; usedTypes: string[]; legacyFallback: boolean; warn: boolean } {
  const { targets, warn, reasons } = resolveReadTargets(legacyType);
  if (targets.length === 0) {
    log.warn({ legacyType, degraded: true, reason: 'no-mapping', reasons },
      '无映射 ⇒ 回退遗留字面量读（显式 legacyFallback；不静默）');
    return { rows: reader.queryNodes(legacyType, filters, graph), usedTypes: [legacyType], legacyFallback: true, warn: true };
  }
  const rows: unknown[] = [];
  for (const t of targets) rows.push(...reader.queryNodes(t, filters, graph));
  return { rows, usedTypes: targets, legacyFallback: false, warn };
}
