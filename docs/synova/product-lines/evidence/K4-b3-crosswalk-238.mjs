/**
 * docs/synova/product-lines/evidence/K4-b3-crosswalk-238.mjs — #238 编号权威表 可映射性底稿（只读）
 *
 * 用途：在 base `ba1b22a8b5` 上，对四套编号做可映射性实测，供 #238 出表时引用。
 * 判定：本件是**事实底稿**，不是权威表；只回答"能不能按名字对上"，不裁定语义等价。
 *
 * 契约:
 *   @input  — 无参数。读取 ${cwd}/ 下的：
 *               extensions/ontology/edge-types/*.json            （词表，56 件）
 *               docs/synova/research/权威文档01-.../第二章-42条因果边权威定义-*.md（两位式 E-nn）
 *               data/golden/wani-baby-v1.json                     （私有式 E-x.y → {label,value}）
 *               _patch_d66.cjs                                    （E-x.y 唯一系统性载体）
 *               cycles/**\/*.cycle.json                           （判据① 被检体）
 *   @output — stdout：四套编号的条数、逐条映射、双向缺口统计
 *   @degraded — `_patch_d66.cjs` 的 (E-x.y,label) 解析器未命中 → 打印 `⚠ patch 解析降级`，
 *               不静默（铁律 11）；本件不因该降级而改变其余结论。
 *   退出码 — 恒 0（只读呈报件，不是门禁）
 *
 * 口径声明（A7：报数必写口径名）:
 *   - 归一化 = 小写 + 只留 [a-z0-9]（`norm()`）；「按名字对上」= 归一后字符串相等
 *   - 形态交集 = 把 `E-nn` 与 `E-x.y` 各自 norm 后取交集（实测 24 条 ⇒ 形态不可区分两套编号）
 *   - 本件**不**编造版本号；无 CLI 参数；只读，不写任何被检体
 *
 * 用法:
 *   node docs/synova/product-lines/evidence/K4-b3-crosswalk-238.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// ── 1. 词表（56 件）──
const EDGE = join(ROOT, 'extensions', 'ontology', 'edge-types');
const vocab = [];
for (const n of readdirSync(EDGE).filter((n) => n.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(join(EDGE, n), 'utf-8'));
  vocab.push({ file: n, id: j.$id, label: j.label });
}
const byLabel = new Map(vocab.map((v) => [String(v.label), v]));

// ── 2. 权威文档01 第二章：E-nn NAME ──
const AUTH = join(ROOT, 'docs', 'synova', 'research',
  '权威文档01-本体层因果体系权威规范-20260714',
  'SYNOVA-RESEARCH-第二章-42条因果边权威定义-v1-0-20260714.md');
const authNum = new Map();
for (const m of readFileSync(AUTH, 'utf-8').matchAll(/^###\s+(E-\d{2})\s*:\s*([A-Z0-9_]+)/gm)) {
  authNum.set(m[1], m[2]);
}

// ── 3. golden：E-x.y → {label,value} ──
const golden = JSON.parse(readFileSync(join(ROOT, 'data', 'golden', 'wani-baby-v1.json'), 'utf-8'));
const gEdges = golden.edges ?? {};

// ── 4. _patch_d66.cjs：E-x.y → label（尽力解析，失败即显式降级）──
let patchPairs = [];
try {
  const src = readFileSync(join(ROOT, '_patch_d66.cjs'), 'utf-8');
  for (const m of src.matchAll(/['"]?(E-\d+\.\d+)['"]?\s*:\s*\{[^}]*?label\s*:\s*['"]([A-Z0-9_]+)['"]/g)) {
    patchPairs.push([m[1], m[2]]);
  }
  if (patchPairs.length === 0) {
    for (const m of src.matchAll(/label\s*:\s*['"]([A-Z0-9_]+)['"][^}]*?(E-\d+\.\d+)/g)) {
      patchPairs.push([m[2], m[1]]);
    }
  }
} catch (e) { console.log(`⚠ patch 解析降级: ${e.message}`); }

console.log('═══ 四套编号的可映射性事实 ═══');
console.log(`词表 edge-types                       = ${vocab.length} 件 / $id distinct ${new Set(vocab.map(v=>v.id)).size} / label distinct ${new Set(vocab.map(v=>v.label)).size}`);
console.log(`权威文档01 第二章 E-nn 定义            = ${authNum.size} 条`);
console.log(`golden edges 键                        = ${Object.keys(gEdges).length} 条`);
console.log(`_patch_d66.cjs 解析出的 (E-x.y, label) = ${patchPairs.length} 条  ${patchPairs.length === 0 ? '← 解析降级，未取得' : ''}`);

// ── A. 权威 E-nn ↔ 词表 ──
console.log('');
console.log('─── A. 权威文档01 两位式 E-nn → 词表（按 NAME 归一匹配）───');
let hitA = 0; const missA = [];
const vocabByNorm = new Map();
for (const v of vocab) vocabByNorm.set(norm(String(v.label)), v);
for (const [e, name] of [...authNum].sort()) {
  const v = vocabByNorm.get(norm(name));
  if (v) { hitA++; console.log(`  ${e} ${name} → ${v.id}  [${v.label}]`); }
  else missA.push(`${e} ${name}`);
}
console.log(`  命中 ${hitA}/${authNum.size}；未命中 ${missA.length}`);
for (const m of missA) console.log(`  MISS ${m}  ⇒ 词表无同名项`);

// ── B. golden E-x.y → 词表 ──
console.log('');
console.log('─── B. golden 私有式 E-x.y → 词表（经 label 中介）───');
let hitB = 0; const missB = [];
for (const [e, obj] of Object.entries(gEdges).sort()) {
  const lbl = obj && obj.label;
  const v = lbl ? byLabel.get(String(lbl)) : undefined;
  if (v) hitB++;
  else missB.push(`${e} label=${lbl}`);
}
console.log(`  命中 ${hitB}/${Object.keys(gEdges).length}；未命中 ${missB.length}`);
for (const m of missB) console.log(`  MISS ${m}  ⇒ 词表无该 label`);

// ── C. 双向覆盖 ──
console.log('');
console.log('─── C. 覆盖缺口统计（双向）───');
const vocabMatchedByA = new Set();
for (const [, name] of authNum) { const v = vocabByNorm.get(norm(name)); if (v) vocabMatchedByA.add(v.file); }
console.log(`  词表 ${vocab.length} 件中，能被权威两位式 E-nn 命中的 = ${vocabMatchedByA.size}；无法命中 = ${vocab.length - vocabMatchedByA.size}`);

// ── D. golden ↔ 权威 ──
console.log('');
console.log('─── D. golden 私有式 E-x.y 与 权威两位式 E-nn 是否同名不同物 ──');
const gSets = new Set(Object.keys(gEdges).map((k) => norm(k)));
const aSets = new Set([...authNum.keys()].map((k) => norm(k)));
const inter = [...gSets].filter((x) => aSets.has(x));
console.log(`  golden 形态 ${Object.keys(gEdges).length} 条；权威形态 ${authNum.size} 条；**形态交集 = ${inter.length}**`);
console.log(`  ⇒ ${inter.length === 0 ? '两套编号**形态互斥**（私有式 vs 两位式），必须靠 label 中介' : '存在同形项：' + JSON.stringify(inter)}`);

// ── E. 判据① 相关：cycles 引用的 15 distinct ──
console.log('');
console.log('─── E. 判据① 相关：cycles 引用的 distinct 是否全部可经词表命中 ──');
const cyc = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.endsWith('.cycle.json')) cyc.push(p);
  }
};
walk(join(ROOT, 'cycles'));
const refs = new Set(); const ids = new Set();
for (const f of cyc) {
  const j = JSON.parse(readFileSync(f, 'utf-8'));
  for (const n of j.nodes ?? []) if (Array.isArray(n.edgeRefs)) for (const v of n.edgeRefs) refs.add(typeof v === 'string' ? v : JSON.stringify(v));
  for (const m of j.mapping ?? []) if (typeof m.edgeId === 'string') ids.add(m.edgeId);
}
const union = new Set([...refs, ...ids]);
const uniqLabels = new Set(vocab.map((v) => String(v.label)));
const uniqIds = new Set(vocab.map((v) => String(v.id)));
let ok = 0; const bad = [];
for (const v of union) { if (uniqIds.has(v) || uniqLabels.has(v)) ok++; else bad.push(v); }
console.log(`  cycles 引用 distinct = ${union.size}；命中 $id∪label = ${ok}；未命中 = ${bad.length} ${JSON.stringify(bad)}`);

// ── F. B2 要求：本件测不出什么 ──
console.log('');
console.log('─── F. 本件测不出什么（B2 强制声明）───');
console.log('  ① 只测「编号/命名可否按名字对应」，**测不出**语义等价是否成立（需裁定，非计算）。');
console.log('  ② **测不出**该边在图上是否真被使用（那是消费面，属 #239 接线门禁）。');
console.log('  ③ **测不出** packages/ontology/** 第二套词表的对齐情况（本件只看 extensions/ontology/）。');
console.log('  ④ `_patch_d66.cjs` 的解析依赖源码书写形态；形态一变即降级，降级时**不静默**。');
