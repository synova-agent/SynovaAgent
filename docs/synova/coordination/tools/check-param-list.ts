/**
 * check-param-list.ts — #1047（2-2 参数清单）判据器
 *
 * 契约（铁律 47）:
 *   @input  — 清单文件 `docs/synova/coordination/2-2-参数清单-v1-20261008.md`
 *             （机器可读块 = `<!-- BEGIN-PARAM-JSON -->` … `<!-- END-PARAM-JSON -->` 之间的 ```json 围栏）
 *   @output — stdout 逐项计数；末行 VERDICT=PASS|FAIL
 *   @exit   — 0 = 全部判据通过；1 = 有判据不满足；2 = 清单不可读/JSON 块缺失（**fail-closed**，不与通过混同）
 *   @degraded — 无（纯本地文件读取，无网络）
 *
 * 判据（对应卡面 §⑥）:
 *   C1 每条记录字段集 == 19 字段（无缺无多）
 *   C2 值一律留空（`value === null`）
 *   C3 五域齐全（获取/配置/转化/交付/回收 各 ≥1）
 *   C4 layer 四层齐（L0/L1/L1.5/L2 各 ≥1）+ L0 ≥1 且有依据（source_type=ExternalBaseline）
 *   C5 命名只有一套：`name` 全为 snake_case（camelCase 计数 = 0）；`domain` 只用甲套集合
 *      （不含乙套串 `回流` / `横切感知层` / 含 `/` 的复合串）
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const LIST = join(ROOT, 'docs/synova/coordination/2-2-参数清单-v1-20261008.md');

const EXPECT_FIELDS = [
  'param_id', 'name', 'meaning', 'unit', 'normal_range', 'source_path',
  'source_type', 'source_detail', 'edge_ref', 'edge_id',
  'domain', 'layer', 'hardness', 'coverage',
  'customer_verified', 'missing_data', 'is_estimated', 'confidence', 'value',
];
const DOMAINS = ['获取', '配置', '转化', '交付', '回收'];
const LAYERS = ['L0', 'L1', 'L1.5', 'L2'];
const SNAKE = /^[a-z][a-z0-9_]*$/;
const FORBIDDEN_DOMAIN_TOKENS = ['回流', '横切感知层'];

type Rec = Record<string, unknown>;

function fail(msg: string): never {
  console.log(`❌ ${msg}`);
  console.log('VERDICT=FAIL');
  process.exit(2);
}

let text: string;
try {
  text = readFileSync(LIST, 'utf-8');
} catch (err) {
  fail(`清单不可读（fail-closed）: ${LIST} :: ${(err as Error).message}`);
}

const begin = text.indexOf('<!-- BEGIN-PARAM-JSON -->');
const end = text.indexOf('<!-- END-PARAM-JSON -->');
if (begin < 0 || end < 0 || end <= begin) fail('机器可读块标记缺失（BEGIN/END-PARAM-JSON）');
const block = text.slice(begin, end);
const fenceStart = block.indexOf('```json');
const fenceEnd = block.lastIndexOf('```');
if (fenceStart < 0 || fenceEnd <= fenceStart) fail('机器可读块内未找到 ```json 围栏');

let parsed: { schema_fields?: string[]; domain_set?: string[]; layer_set?: string[]; records?: Rec[] };
try {
  parsed = JSON.parse(block.slice(fenceStart + '```json'.length, fenceEnd));
} catch (err) {
  fail(`机器可读块 JSON 解析失败（fail-closed）: ${(err as Error).message}`);
}

const records = parsed.records ?? [];
const problems: string[] = [];

// C1 — 19 字段
if (!Array.isArray(parsed.schema_fields) || parsed.schema_fields.length !== 19) {
  problems.push(`C1 schema_fields 不是 19 条（实际 ${parsed.schema_fields?.length ?? 'n/a'}）`);
} else if (JSON.stringify(parsed.schema_fields) !== JSON.stringify(EXPECT_FIELDS)) {
  problems.push('C1 schema_fields 与本判据器的字段集不一致');
}
let fieldViolations = 0;
for (const r of records) {
  const keys = Object.keys(r).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...EXPECT_FIELDS].sort())) {
    fieldViolations += 1;
    if (problems.length < 12) problems.push(`C1 ${String(r.param_id)} 字段集不齐（${keys.length} 个）`);
  }
}

// C2 — 值留空
const filled = records.filter((r) => r.value !== null).length;

// C3 — 五域
const domainCount = Object.fromEntries(DOMAINS.map((d) => [d, records.filter((r) => r.domain === d).length]));
const missingDomains = DOMAINS.filter((d) => (domainCount[d] ?? 0) === 0);

// C4 — layer 四层 + L0 依据
const layerCount = Object.fromEntries(LAYERS.map((l) => [l, records.filter((r) => r.layer === l).length]));
const missingLayers = LAYERS.filter((l) => (layerCount[l] ?? 0) === 0);
const badLayers = records.filter((r) => !LAYERS.includes(String(r.layer))).length;
const l0NoBasis = records.filter((r) => r.layer === 'L0' && r.source_type !== 'ExternalBaseline').length;

// C5 — 命名唯一
const camel = records.filter((r) => !SNAKE.test(String(r.name)));
const badDomain = records.filter((r) => FORBIDDEN_DOMAIN_TOKENS.some((t) => String(r.domain).includes(t))
  || String(r.domain).includes('/'));
const distinctNames = new Set(records.map((r) => String(r.name)));

console.log(`LIST=${LIST}`);
console.log(`RECORDS=${records.length}`);
console.log(`C1_FIELD_VIOLATIONS=${fieldViolations}`);
console.log(`C2_VALUE_NON_NULL=${filled}  (期望 0 —— 值留空)`);
console.log(`C3_DOMAIN_COUNTS=${JSON.stringify(domainCount)}  MISSING_DOMAINS=${JSON.stringify(missingDomains)}`);
console.log(`C4_LAYER_COUNTS=${JSON.stringify(layerCount)}  MISSING_LAYERS=${JSON.stringify(missingLayers)}  BAD_LAYER_VALUES=${badLayers}  L0_WITHOUT_BASIS=${l0NoBasis}`);
console.log(`C5_DISTINCT_NAMES=${distinctNames.size}  NON_SNAKE_CASE=${camel.length}  NON_CANONICAL_DOMAIN=${badDomain.length}`);
for (const c of camel.slice(0, 10)) console.log(`  NON_SNAKE ${String(c.param_id)}`);
for (const c of badDomain.slice(0, 10)) console.log(`  BAD_DOMAIN ${String(c.param_id)} = ${String(c.domain)}`);

const ok = records.length >= 145
  && fieldViolations === 0
  && filled === 0
  && missingDomains.length === 0
  && missingLayers.length === 0
  && badLayers === 0
  && l0NoBasis === 0
  && (layerCount['L0'] ?? 0) >= 1
  && camel.length === 0
  && badDomain.length === 0;

if (!ok && problems.length === 0) problems.push('计数判据未全满足（详见上方逐项）');
for (const p of problems) console.log(`❌ ${p}`);
console.log(`VERDICT=${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
