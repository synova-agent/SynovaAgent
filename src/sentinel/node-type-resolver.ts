/**
 * sentinel/node-type-resolver.ts — 遗留轴 → 本体轴的**显式映射**解析器（#1381 p0 词表断轴）
 *
 * 契约（铁律 47）:
 *   @input  legacyType：读侧字面量（如 'Financial'）；props：节点 props（用于 rule 分支）
 *   @output { target: string | null, reason: string, warn: boolean }
 *           · 有映射 ⇒ target = 本体轴类型（如 'outcome/financial'）
 *           · 无映射 / 语义不决 ⇒ **target = null + warn = true**（**显式登记，不静默、不猜**）
 *   @degraded 映射文件缺失/不可解析 ⇒ **全部按 null + warn 处理**并 log.warn（fail-closed，不静默回落）
 *   @invariant ① 真源 = 本体轴（CTO 2026-10-08 裁定）；本模块**只读映射文件**，不硬编码映射
 *              ② 语义优先；**不用来源兜底**；连接器局部先例（scope=local(...)）**不得**当全局
 *              ③ 不缓存写操作；不改 `context.db` 语义
 *   @not-here 哨兵接线（批次 B1–B4）；映射层退役（收口形态 A）——见 #1381 §⑩
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';

const log = createLogger('sentinel/node-type-resolver');

interface MappingEvidence { kind: 'writer' | 'inline-migration' | 'vocab' | 'none'; file: string; scope?: string }
interface MappingEntry {
  targets: string[] | null;
  rule?: string;
  warn?: boolean;
  reason?: string;
  aliasOf?: string;
  evidence?: MappingEvidence[];
}
interface MappingFile { entries: Record<string, MappingEntry> }

let cached: MappingFile | null = null;

/** 读映射文件（缺失/损坏 ⇒ fail-closed：空表 + warn，调用方一律 null+warn） */
export function loadNodeTypeMapping(): MappingFile {
  if (cached) return cached;
  const p = join(process.cwd(), 'extensions', 'ontology', 'node-type-mapping.json');
  try {
    cached = JSON.parse(readFileSync(p, 'utf-8')) as MappingFile;
    return cached;
  } catch (err: unknown) {
    log.warn({ err: err instanceof Error ? err.message : String(err), degraded: true, reason: 'mapping-unreadable' },
      '映射文件不可读 ⇒ 全部按"无映射"处理（null + warn；不静默回落）');
    cached = { entries: {} };
    return cached;
  }
}

/**
 * 解析遗留类型 → 本体类型。**语义分支**由 props 判定（rule 可测）。
 * @returns target=null + warn=true 表示【显式无源】（不猜、不静默）
 */
export function resolveOntologyTarget(legacyType: string, props: Record<string, unknown> = {}):
{ target: string | null; reason: string; warn: boolean } {
  const table = loadNodeTypeMapping().entries;
  // aliasOf：**委托**到被指向的条目（只维护一份；别名解析结果必须与本体一致 —— #1381 判据 V1d）
  let entry = table[legacyType];
  const seen = new Set<string>([legacyType]);
  while (entry?.aliasOf && !seen.has(entry.aliasOf)) {
    seen.add(entry.aliasOf);
    entry = table[entry.aliasOf];
  }
  if (!entry) {
    return { target: null, reason: `映射表无此条目（${legacyType}）⇒ 显式无源`, warn: true };
  }
  if (!entry.targets || entry.targets.length === 0) {
    return { target: null, reason: entry.reason ?? '语义不决 ⇒ 显式无源', warn: true };
  }
  if (entry.targets.length === 1) {
    return { target: entry.targets[0], reason: entry.rule ?? '词表直配', warn: false };
  }
  // 多目标 ⇒ 按 props 键语义分（rule 的两条分支）
  const keys = Object.keys(props);
  const lossKeys = ['total_revenue', 'gross_margin', 'operating_expense'];
  const stockKeys = ['cash_balance', 'revenue', 'cost', 'period'];
  if (keys.some(k => lossKeys.includes(k))) {
    return { target: entry.targets[0], reason: 'props 含损益/预算类键 ⇒ 第一目标', warn: false };
  }
  if (keys.some(k => stockKeys.includes(k))) {
    return { target: entry.targets[1], reason: 'props 含存量/现金流类键 ⇒ 第二目标', warn: false };
  }
  return { target: null, reason: '多目标但 props 无法判定语义 ⇒ 显式无源（不用来源兜底）', warn: true };
}
