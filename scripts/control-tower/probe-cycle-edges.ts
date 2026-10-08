/**
 * scripts/control-tower/probe-cycle-edges.ts — #978（0-4）判据交付物
 *
 * 背景：`cycles/**\/*.cycle.json` 的 `nodes[].edgeRefs` / `mapping[].edgeId` 曾写旧编号
 * `E-<大版本>.<小版本>`（正文 45 处 / distinct 17 条）。代码边本体
 * `extensions/ontology/edge-types/*.json` 用的是 `$id`=`edge/<snake>` + `label`=UPPER。
 * 两套互不相认 ⇒ 循环引用 ∩ 代码边 = ∅。本探针是卡面 §十 判据的**机器可跑形态**。
 *
 * 判据（卡面 §十 原文）:
 *   ① 循环配置里 `E-[0-9]+\.[0-9]+` 形态出现次数 = 0
 *   ② 每条 `edgeRefs`/`edgeId` 值 ⊆ 代码边 `$id` ∪ `label`（或明确标 `unknown`）
 *   ③ 低可信条目要么定稿、要么显式保留 `unknown` —— 不许猜（本探针只**呈报** unknown 计数，不判内容）
 *   ④ 本探针自身 exit 0
 *
 * ⚠️ 口径声明（与卡面一致，勿漂移）:
 *   ① 的计数口径 = `git grep -ohE "E-[0-9]+\.[0-9]+" -- cycles/` 的文件级出现次数
 *      （含 `_` 前缀文件；45 = `nodes[].edgeRefs` 22 处 + `mapping[].edgeId` 23 处）。
 *      distinct = 17，两数口径不同，不得混用。
 *
 * 契约:
 *   @input   — 无参数。读取 `${cwd}/cycles/**\/*.cycle.json`（被检体）
 *              + `${cwd}/extensions/ontology/edge-types/*.json`（目标词表）
 *   @output  — stdout：判据①②③ 的原始计数与逐条明细；exit code 见下
 *   @degraded — `cycles/` 或 `edge-types/` 缺失/为空 → exit 2（fail-closed，绝不静默通过）；
 *               单个 .cycle.json 解析失败 → 计入违规 + 打 `❌`，exit 1（不吞错）
 *   退出码   — 0 = ①② 全通过；1 = 存在违规；2 = 输入缺失（降级）
 *
 * 用法:
 *   npx tsx scripts/control-tower/probe-cycle-edges.ts
 *
 * 反例（判别性，卡面 §十 补强判据）:
 *   ⑤ 任一条 `edgeRefs` 值改回 `E-1.1` 形态 ⇒ 判据① 必红（非 0）
 *   ⑥ 只改 `nodes[].edgeRefs` 不改 `mapping[].edgeId` ⇒ 判据① 仍 > 0（残留 23 处）
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';

const CWD = process.cwd();
const CYCLES_ROOT = join(CWD, 'cycles');
const EDGE_TYPES_ROOT = join(CWD, 'extensions', 'ontology', 'edge-types');

/** 旧编号形态（卡面 §十 判据① 原文正则） */
const LEGACY_ID_RE = /E-[0-9]+\.[0-9]+/g;
/** 允许的“显式未定稿”占位符（卡面 §十 判据② 原文） */
const UNKNOWN_TOKEN = 'unknown';

interface Violation {
  file: string;
  where: string;
  value: string;
  reason: string;
}

interface CycleFileReport {
  file: string;
  legacyOccurrences: number;
  edgeRefs: number;
  mappingEdgeIds: number;
  loaderVisible: boolean;
  unknownCount: number;
}

/** 递归收集 `*.cycle.json`，目录名排序保证输出稳定（可复核）。 */
function collectCycleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCycleFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.cycle.json')) out.push(full);
  }
  return out;
}

/** 目标词表：代码边 `$id` ∪ `label`。 */
function loadVocabulary(): { ids: Set<string>; labels: Set<string> } {
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const name of readdirSync(EDGE_TYPES_ROOT).filter(n => n.endsWith('.json')).sort()) {
    const raw = readFileSync(join(EDGE_TYPES_ROOT, name), 'utf-8');
    const parsed = JSON.parse(raw) as { $id?: unknown; label?: unknown };
    if (typeof parsed.$id === 'string') ids.add(parsed.$id);
    if (typeof parsed.label === 'string') labels.add(parsed.label);
  }
  return { ids, labels };
}

/** 读取单个循环配置（只做结构反射，不复制 cycle-types 口径）。 */
interface CycleShape {
  nodes?: Array<{ id?: unknown; edgeRefs?: unknown }>;
  mapping?: Array<{ nodeId?: unknown; edgeId?: unknown }>;
}

function main(): number {
  if (!existsSync(CYCLES_ROOT) || !statSync(CYCLES_ROOT).isDirectory()) {
    console.error(`❌ 降级：${CYCLES_ROOT} 不存在 — 被判体缺失，fail-closed（exit 2）`);
    return 2;
  }
  if (!existsSync(EDGE_TYPES_ROOT) || !statSync(EDGE_TYPES_ROOT).isDirectory()) {
    console.error(`❌ 降级：${EDGE_TYPES_ROOT} 不存在 — 目标词表缺失，fail-closed（exit 2）`);
    return 2;
  }

  const { ids, labels } = loadVocabulary();
  if (ids.size === 0 || labels.size === 0) {
    console.error(`❌ 降级：代码边词表为空（$id=${ids.size} label=${labels.size}）— fail-closed（exit 2）`);
    return 2;
  }

  const files = collectCycleFiles(CYCLES_ROOT);
  if (files.length === 0) {
    console.error(`❌ 降级：${CYCLES_ROOT} 下无 *.cycle.json — fail-closed（exit 2）`);
    return 2;
  }

  const reports: CycleFileReport[] = [];
  const violations: Violation[] = [];
  const usedValues = new Map<string, number>();
  let totalLegacy = 0;
  let totalRefs = 0;
  let totalMappings = 0;
  let totalUnknown = 0;

  for (const file of files) {
    const rel = relative(CWD, file).split('\\').join('/');
    const raw = readFileSync(file, 'utf-8');
    const legacyMatches = raw.match(LEGACY_ID_RE) ?? [];
    totalLegacy += legacyMatches.length;
    if (legacyMatches.length > 0) {
      violations.push({
        file: rel,
        where: '(raw)',
        value: [...new Set(legacyMatches)].join(','),
        reason: `判据① 违规：残留旧编号 E-x.y ${legacyMatches.length} 处`,
      });
    }

    let shape: CycleShape;
    try {
      shape = JSON.parse(raw) as CycleShape;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      violations.push({ file: rel, where: '(json)', value: '-', reason: `判据② 无法校验：JSON 解析失败 — ${msg}` });
      reports.push({
        file: rel,
        legacyOccurrences: legacyMatches.length,
        edgeRefs: 0,
        mappingEdgeIds: 0,
        loaderVisible: !rel.split('/').pop()!.startsWith('_'),
        unknownCount: 0,
      });
      continue;
    }

    const nodes = Array.isArray(shape.nodes) ? shape.nodes : [];
    const mapping = Array.isArray(shape.mapping) ? shape.mapping : [];
    let refs = 0;
    let unknown = 0;

    for (const node of nodes) {
      if (!Array.isArray(node.edgeRefs)) continue;
      for (const ref of node.edgeRefs) {
        refs++;
        const value = typeof ref === 'string' ? ref : JSON.stringify(ref);
        usedValues.set(value, (usedValues.get(value) ?? 0) + 1);
        if (value === UNKNOWN_TOKEN) { unknown++; continue; }
        if (!ids.has(value) && !labels.has(value)) {
          violations.push({
            file: rel,
            where: `nodes[${String(node.id)}].edgeRefs`,
            value,
            reason: '判据② 违规：值 ∉ 代码边 $id ∪ label ∪ {unknown}',
          });
        }
      }
    }

    for (const m of mapping) {
      const value = typeof m.edgeId === 'string' ? m.edgeId : JSON.stringify(m.edgeId);
      usedValues.set(value, (usedValues.get(value) ?? 0) + 1);
      if (value === UNKNOWN_TOKEN) { unknown++; continue; }
      if (!ids.has(value) && !labels.has(value)) {
        violations.push({
          file: rel,
          where: `mapping[${String(m.nodeId)}].edgeId`,
          value,
          reason: '判据② 违规：值 ∉ 代码边 $id ∪ label ∪ {unknown}',
        });
      }
    }

    totalRefs += refs;
    totalMappings += mapping.length;
    totalUnknown += unknown;
    reports.push({
      file: rel,
      legacyOccurrences: legacyMatches.length,
      edgeRefs: refs,
      mappingEdgeIds: mapping.length,
      loaderVisible: !rel.split('/').pop()!.startsWith('_'),
      unknownCount: unknown,
    });
  }

  // ─── 判据① ───
  console.log('══════ 判据① 旧编号 E-x.y 出现次数（口径 = git grep -ohE "E-[0-9]+\\.[0-9]+" -- cycles/）');
  console.log(`legacy_occurrences = ${totalLegacy}`);
  console.log('');
  console.log('══════ 逐文件明细');
  console.log('file | legacy_occurrences | edgeRefs | mapping.edgeId | unknown | loader_visible');
  for (const r of reports) {
    console.log(
      `${r.file} | ${r.legacyOccurrences} | ${r.edgeRefs} | ${r.mappingEdgeIds} | ${r.unknownCount} | ${r.loaderVisible ? 'yes' : 'no(_ 前缀, cycle-loader 跳过)'}`,
    );
  }
  console.log(`TOTAL edgeRefs = ${totalRefs}`);
  console.log(`TOTAL mapping.edgeId = ${totalMappings}`);
  console.log(`TOTAL edgeRefs + mapping.edgeId = ${totalRefs + totalMappings}`);
  console.log('');
  console.log('══════ 判据② 取值域');
  console.log(`code_edge_$id_count = ${ids.size}`);
  console.log(`code_edge_label_count = ${labels.size}`);
  console.log(`distinct_values_used = ${usedValues.size}`);
  for (const [value, count] of [...usedValues.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const kind = value === UNKNOWN_TOKEN ? 'unknown' : ids.has(value) ? '$id' : labels.has(value) ? 'label' : 'INVALID';
    console.log(`  ${value}  x${count}  [${kind}]`);
  }
  console.log('');
  console.log('══════ 判据③ unknown 计数（呈报，不判内容）');
  console.log(`unknown_tokens = ${totalUnknown}`);
  console.log('');

  if (violations.length > 0) {
    console.log('══════ ❌ 违规明细');
    for (const v of violations) {
      console.log(`❌ ${v.file} @ ${v.where} :: ${v.value} — ${v.reason}`);
    }
    console.log('');
    console.log(`❌ 结论：${violations.length} 项违规 — exit 1`);
    return 1;
  }

  console.log('✅ 结论：判据① 旧编号 = 0；判据② 全部取值 ∈ 代码边 $id ∪ label ∪ {unknown}；exit 0');
  return 0;
}

process.exit(main());
