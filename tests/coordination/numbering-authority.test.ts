/**
 * tests/coordination/numbering-authority.test.ts — #238（K4-05）编号权威表的**机器化断言**
 *
 * 契约:
 *   @input  — 读仓内原件（只读）:
 *               · extensions/ontology/edge-types/*.json          （代码词表）
 *               · 权威文档01 第二/四章 .md                        （权威两位式 E 号定义面）
 *               · data/golden/wani-baby-v1.json                  （私有式 E-x.y 的唯一 label 载体）
 *               · _patch_d66.cjs                                 （私有式 E-x.y 的编号集合载体）
 *               · cycles/**\/*.cycle.json                         （引用对齐判据的被检体）
 *               · docs/synova/coordination/numbering-authority.md（本卡交付件，做文件级一致性核对）
 *               · docs/synova/GLOSSARY.md                         （矛盾注记是否落地）
 *   @output — 断言通过 / 抛出；每个测试用例都有真 `expect()`，覆盖：正常路径 + 边界 + 降级/冲突路径
 *   @degraded — 任一原件缺失 → 直接 fail（`existsSync` 显式断言，**不静默通过**；铁律 11）
 *
 * 反例分辨力（"删掉即报红"）:
 *   · 删/改 `extensions/ontology/edge-types/*.json` 任一 `label` ⇒ §「字符串同义 13 条」必红
 *   · 改 golden `E-4.1.label` ⇒ §「golden 经 label 命中 34/36」必红
 *   · 改 `cycles/**` 任一引用为不存在的 `$id` ⇒ §「引用对齐全命中」必红
 *   · 删 `numbering-authority.md` 的任一条待裁登记 ⇒ §「交付件一致性」必红
 *
 * 🔴 本件**承接**其他两件的部分「删件/改集」覆盖（#234 续做第二笔，U-4）：
 *   · 本件 §二 的 **#1350 集合锚**（`REQUIRED_IDS`）负责抓「必含边被删」，且**点名**
 *   · 本件**自身**的删件检测 = 该集合锚 ＋ 扫盘 ↔ 件内解析 1:1（`files.length` vs `edges.length`）
 *   ⚠️ 反过来说：`edge-lag-values.test.ts` / `edge-transfer-functions.test.ts` 的删件检测**已外包到本件与 `-1134`**；
 *      若本件被改坏或跳过，**那两件的删件覆盖会静默消失**（无其他防线）。
 */

// 🔴 全量差集判据的口径（U-6，CTO 2026-10-13）：
//   全量套件存在 flaky（实测 ≥5 件在全量负载下跨轮互翻，±1 级噪声）⇒ **单次全量差集含噪声**。
//   ⇒ 判据口径 = **两次跑交 ∩**（`head红 ∩ head红'` 再与 base 比），**禁单次跑定论**。
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const EDGE_DIR = join(ROOT, 'extensions', 'ontology', 'edge-types');
const CH2 = join(
  ROOT,
  'docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/SYNOVA-RESEARCH-第二章-42条因果边权威定义-v1-0-20260714.md',
);
const CH4 = join(
  ROOT,
  'docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/SYNOVA-RESEARCH-第四章-边节点映射矩阵-v1-0-20260714.md',
);
const CH1 = join(
  ROOT,
  'docs/synova/research/权威文档01-本体层因果体系权威规范-20260714/SYNOVA-RESEARCH-第一章-五断裂点穷举-v1-0-20260714.md',
);
const GOLDEN = join(ROOT, 'data', 'golden', 'wani-baby-v1.json');
const PATCH66 = join(ROOT, '_patch_d66.cjs');
const AUTHORITY = join(ROOT, 'docs', 'synova', 'coordination', 'numbering-authority.md');
const GLOSSARY = join(ROOT, 'docs', 'synova', 'GLOSSARY.md');

const LEGACY_ID_RE = /E-\d+\.\d+/g;

interface CodeEdge {
  id: string;
  label: string;
}

function loadCodeEdges(): CodeEdge[] {
  return readdirSync(EDGE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const j = JSON.parse(readFileSync(join(EDGE_DIR, f), 'utf-8')) as { $id: string; label: string };
      return { id: j.$id, label: j.label };
    });
}

/** 第二章：`### E-NN: NAME`；第四章：`### E-NN NAME（…）` */
function headings(path: string, kind: 'ch2' | 'ch4'): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const m =
      kind === 'ch2'
        ? /^###\s+(E-\d\d):\s*(\S+)/.exec(line)
        : /^###\s+(E-\d\d)\s+(\S+?)[（(]/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function collectCycleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectCycleFiles(full));
    else if (e.isFile() && e.name.endsWith('.cycle.json')) out.push(full);
  }
  return out;
}

describe('#238 前置：仓内原件存在（缺失即 fail，不静默）', () => {
  it('六个原件路径全部存在', () => {
    for (const p of [EDGE_DIR, CH1, CH2, CH4, GOLDEN, PATCH66, AUTHORITY, GLOSSARY]) {
      expect(existsSync(p), `缺失原件: ${p}`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// #499（2026-10-13）删件锚 ＋ 计数去恒真 ＋ 子串边界 —— 三处**判据自身缺陷**的修复
// ────────────────────────────────────────────────────────────────────────────────
// 反向造红实证（原始输出见 `docs/synova/product-lines/evidence/K2b4-499-20261013.md`）：
//   · 删**非锚**边件（`augments.json`，58→57）⇒ 修前**全绿**（扫盘三数与实测**同源** ⇒ 删件不红）
//   · 只改本文件 `classA` 字面（**文档一字未动**）⇒ 原 `expect(classA.length+classB.length).toBe(19)`
//     即翻红 ⇒ 该断言证的是"本文件写了 19 个字符串"，**不是**"文档里有 19 条"（恒真型）
//   · `E-02` → `E-02X`（前缀变异）⇒ 修前**全绿**（`toContain` 子串命中，`E-02X` ⊃ `E-02`）
//
// 契约（铁律 47）:
//   @input  — `REGISTERED_EDGE_IDS`（具名登记面常量）＋ `extensions/ontology/edge-types/*.json` 扫盘
//             ＋ `docs/synova/coordination/numbering-authority.md` 正文
//   @output — 缺失/多出**逐条点名**；集合双向 `toEqual`
//   @degraded — 无降级：任一侧读不到 ⇒ 前置用例已 fail（不静默通过）
//   @边界   — ① 本锚是**方向性**的：只拦「登记件消失」，**允许**合法新增
//              （保 L2 的 M4 边界 —— `K4-b3-l2seq-58-20261013.md` §四-a 实测「良构唯一新增不红」；
//               「未登记新增」的约束在 `-1134` 的 N2-2，**不在本件**）
//            ② 文档侧判据只说"登记面与文档一致"，**不判**语义等价 / E 号是否正确落到某个 `$id`
// ════════════════════════════════════════════════════════════════════════════════

/**
 * 具名登记面（#499 删件锚）：`extensions/ontology/edge-types/*.json` 的 `$id` 全列，
 * `as_of 918f2ade`（58 件）。与「扫盘推导」的**本质区别**：期望值来自本常量（独立来源），
 * 不与磁盘扫盘同源 ⇒ 删件时两侧**不再同步变化** ⇒ 删件必红 + 点名。
 * 维护：合法新增边**不必**改本清单（方向性检查）；**删除/改名必须显式改本清单并说明理由**。
 */
const REGISTERED_EDGE_IDS: readonly string[] = [
  'edge/assumption_triggered_reallocation',
  'edge/augments',
  'edge/brand_building',
  'edge/brand_builds',
  'edge/capital_acquisition',
  'edge/capital_allocation',
  'edge/capital_source_mix',
  'edge/channel_delivery',
  'edge/competitive_positioning',
  'edge/constrains',
  'edge/couples',
  'edge/cross_functional_synergy',
  'edge/cumulative_learning',
  'edge/customer_data_loop',
  'edge/customer_lockin',
  'edge/data_collection',
  'edge/decision_authority',
  'edge/decision-concentrates',
  'edge/demand_to_spec',
  'edge/deploys',
  'edge/efficiency_attraction',
  'edge/environmental_scan',
  'edge/equipment_acquisition',
  'edge/external-assumption',
  'edge/external_feedback',
  'edge/funds',
  'edge/goal_decomposes_to',
  'edge/goal_decomposition',
  'edge/incentive_alignment',
  'edge/incentive-binds',
  'edge/information_flow',
  'edge/innovation_output',
  'edge/knowledge_reuse',
  'edge/knowledge_sharing',
  'edge/locks-in',
  'edge/market_share_capture',
  'edge/operational_execution',
  'edge/organizational_learning',
  'edge/plan_commits_to',
  'edge/procurement_bargaining',
  'edge/produces',
  'edge/profit_reinvestment',
  'edge/reputation_attraction',
  'edge/reputation_flywheel',
  'edge/retention_protects_knowledge',
  'edge/routine_rigidity',
  'edge/rule_constraint',
  'edge/sensing_calibration',
  'edge/service_support',
  'edge/signal-transmits',
  'edge/signal_upward_pass',
  'edge/talent_acquisition',
  'edge/talent_deployment',
  'edge/talent_filter',
  'edge/talent_retention',
  'edge/tech_infrastructure',
  'edge/trust_friction_reduction',
  'edge/value_pricing',
];

/**
 * `E-NN` token 提取，**带边界**：`E-02X` / `E-021` 不得被当成 `E-02`
 * （卡面④「`TRANSMISSION` ⊃ `MISS` 类子串假阳」的机械防线）。
 */
function eTokens(block: string): string[] {
  const re = /(?<![0-9A-Za-z-])E-\d{2}(?![0-9A-Za-z-])/g;
  return [...new Set(block.match(re) ?? [])].sort();
}

/** 取清单块（首命中即边界）＋ **边界唯一性**断言（标记重复 ⇒ 首命中即边界会漂移 ⇒ 红）。 */
function sliceBlock(doc: string, start: string, end: string, label: string): string {
  const i0 = doc.indexOf(start);
  const i1 = doc.indexOf(end);
  expect(i0, `${label} 起点标记缺失: ${start}`).toBeGreaterThan(0);
  expect(i1, `${label} 终点标记缺失: ${end}`).toBeGreaterThan(i0);
  expect(doc.split(start).length - 1, `${label} 起点标记「${start}」出现多次（首命中即边界 ⇒ 边界会漂移）`).toBe(1);
  expect(doc.split(end).length - 1, `${label} 终点标记「${end}」出现多次（同上）`).toBe(1);
  return doc.slice(i0, i1);
}

/** 从清单块标题取「N 条」的 N。**无标题 ⇒ -1**（上层 `toBe` 必红，且消息带口径）。 */
function headerCount(block: string, cls: 'A' | 'B'): number {
  const m = new RegExp(`${cls} 类（(\\d+)\\s*条）`).exec(block);
  if (!m) return -1;
  return Number(m[1]);
}

/** 集合**双向**差集消息 ＋ **命中行全文**（卡面④：禁拿子串当定性依据）。 */
function setDiffMsg(label: string, got: string[], want: string[], block: string): string {
  const missing = want.filter((t) => !got.includes(t));
  const extra = got.filter((t) => !want.includes(t));
  const lineOf = (t: string): string => {
    const hit = block.split(/\r?\n/).filter((l) => l.includes(t));
    return hit.length > 0 ? hit.map((l) => l.trim()).join('  ⎪  ') : '（该块内无含此串的行）';
  };
  const head = `${label} 类登记面：声明 ↔ 文档实测 不一致（缺失 ${missing.length} 件 / 多出 ${extra.length} 件）`;
  const body = [
    ...missing.map((t) => `  ❌ 缺失 ${t} —— 含该串的行: ${lineOf(t)}`),
    ...extra.map((t) => `  ⚠️ 多出 ${t} —— 含该串的行: ${lineOf(t)}`),
  ];
  return [head, ...body].join('\n');
}

describe('#238 §二 口径读数：词表 / 两章 / golden / patch', () => {
  const edges = loadCodeEdges();

  it('词表件数 / $id distinct / label distinct —— 三数**扫盘推导**（禁字面基数），1:1 无重名', () => {
    // 🔴 N2 续做（#234，base aa085e1f1）：原为字面 `56`，撞上 #1350 落地后的 **58 件**。
    //    改造口径 = 「**派生计数 ＋ 集合棘轮 ＋ 交叉断言**」（照 -1134 的 N2 版），**禁"扫盘实数当期望值"**（恒真 = 假绿）。

    // ① 交叉断言：扫盘文件集 ↔ 件内解析必须 1:1（有文件读不出 / 解析失败 / 未收全 ⇒ 红）
    const files = readdirSync(EDGE_DIR).filter((f) => f.endsWith('.json')).sort();
    expect(
      edges.length,
      `扫盘 ${files.length} 件 ≠ 件内解析 ${edges.length} 件 —— 有件不可读或未收全（件数由扫盘推导，不写死）`,
    ).toBe(files.length);

    const ids = edges.map((e) => e.id);
    const labels = edges.map((e) => e.label);

    // ② 集合棘轮①：`$id` 必 1:1（重复 ⇒ 红 + **点名**重复值）
    const dupIds = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
    expect(dupIds, `$id 重复（词表要求 1:1 无重名）: ${dupIds.join(', ')}`).toEqual([]);

    // ③ 集合棘轮②：`label` 必 1:1（重复 ⇒ 红 + **点名**重复值）
    const dupLabels = [...new Set(labels.filter((v, i) => labels.indexOf(v) !== i))];
    expect(dupLabels, `label 重复（词表要求 1:1 无重名）: ${dupLabels.join(', ')}`).toEqual([]);

    // ④ 三数**同源**显式化：distinct == 扫盘件数（②③ 的等价写法，便于复核员一眼核"三数同源"）
    expect(new Set(ids).size, 'distinct($id) 必须 == 扫盘件数').toBe(files.length);
    expect(new Set(labels).size, 'distinct(label) 必须 == 扫盘件数').toBe(files.length);

    // ⑤ 🔴 集合棘轮③（**必需**）：#1350 两件必须在场。
    //    没有本锚 ⇒「件数」判据对**删除**恒真（扫盘怎么变、两边一起变）⇒ 假绿。删/改名 ⇒ 红 + **点名片名**。
    const REQUIRED_IDS = ['edge/goal_decomposes_to', 'edge/plan_commits_to'];
    const absent = REQUIRED_IDS.filter((id) => !ids.includes(id));
    expect(absent, `#1350 必含边缺失（删除必须显式改本清单）: ${absent.join(', ')}`).toEqual([]);

    // ⑥ 形态：`$id` 前缀正则。
    //    🔴 **不断言**「`$id` 尾段 == 文件名主干」—— 实测**恰 5 件**不相等
    //    （decision-concentrates / external-assumption / incentive-binds / locks-in / signal-transmits）
    //    ⇒ 从文件名推 `$id` 的写法会在这 5 件上必红（纪律 #1）。
    for (const e of edges) expect(e.id).toMatch(/^edge\/[a-z0-9_-]+$/);
  });

  it('删件锚：具名登记面（58 件）全在场 —— 缺一即红 + 点名（#499；补 L2「扫盘推导」的删件盲区）', () => {
    // 🔴 #499 反向造红实证：**删掉非锚件**（`augments.json`，58→57）时上面那条"三数扫盘推导"用例**全绿**
    //    —— 因为期望值与实测值**同源于同一目录**（扫盘 ↔ 扫盘）⇒ 删件两侧同步变化 ⇒ 恒真。
    //    实测原始输出（修前）：`Test Files 1 passed (1) ｜ Tests 19 passed (19)` exit=0。
    //    本锚把期望值换成**独立来源**（具名常量）⇒ 删件必红 + 点名。
    // 边界：**方向性**（只拦登记件消失；允许合法新增 —— 保 L2 §四-a 的 M4 边界）。
    const idsNow = loadCodeEdges().map((e) => e.id);
    const absent = REGISTERED_EDGE_IDS.filter((id) => !idsNow.includes(id));
    expect(
      absent,
      `已登记边缺失 ${absent.length} 件（删件/改名必须显式改 REGISTERED_EDGE_IDS 并说明理由）:\n` +
        absent.map((id) => `  - ${id}`).join('\n'),
    ).toEqual([]);
  });

  it('第二/四章 heading 各 42 条，且 E 号集合完全相同', () => {
    const ch2 = headings(CH2, 'ch2');
    const ch4 = headings(CH4, 'ch4');
    expect(ch2.size).toBe(42);
    expect(ch4.size).toBe(42);
    expect([...ch2.keys()].sort()).toEqual([...ch4.keys()].sort());
    // 边界：首尾两端
    expect(ch2.get('E-01')).toBe('ACTIVE_SCANNING');
    expect(ch2.get('E-42')).toBe('ASSUMPTION_LINKAGE');
  });

  it('章间分歧恰 4 条，且就是 E-08/E-10/E-11/E-12（逐条钉两章的名字）', () => {
    const ch2 = headings(CH2, 'ch2');
    const ch4 = headings(CH4, 'ch4');
    const diff = [...ch2.keys()].filter((k) => ch2.get(k) !== ch4.get(k)).sort();
    expect(diff).toEqual(['E-08', 'E-10', 'E-11', 'E-12']);
    expect(ch2.get('E-08')).toBe('RESOURCE_ACQUISITION');
    expect(ch4.get('E-08')).toBe('TALENT_FILTER');
    expect(ch2.get('E-10')).toBe('DECISION_ALLOCATION');
    expect(ch4.get('E-10')).toBe('EQUIPMENT_DEPLOYMENT');
    expect(ch2.get('E-11')).toBe('TRUST_CONSTRUCTION');
    expect(ch4.get('E-11')).toBe('REPUTATION_ATTRACTION');
    expect(ch2.get('E-12')).toBe('POWER_DISTRIBUTION');
    expect(ch4.get('E-12')).toBe('EFFICIENCY_FINANCING');
  });

  it('第一章：无 `### E-NN` heading，但用**表格**承载同一张 42 行表，且与第四章同名', () => {
    const ch1 = readFileSync(CH1, 'utf-8');
    // 第一章确实没有 heading 形态（早期只扫 heading 会漏判 —— 这正是本用例要钉住的反例面）
    expect(headings(CH1, 'ch2').size).toBe(0);
    // 但正文含整张表：4 条分歧名与第四章一致、与第二章相反
    for (const row of [
      '| E-08 | TALENT_FILTER | 获取 | A4 |',
      '| E-10 | EQUIPMENT_DEPLOYMENT | 获取 | A6 |',
      '| E-11 | REPUTATION_ATTRACTION | 获取 | A7 |',
      '| E-12 | EFFICIENCY_FINANCING | 获取（跨点） | A8 |',
    ]) {
      expect(ch1, `第一章表缺行: ${row}`).toContain(row);
    }
    // 第二章那 4 个名字在第一章**不存在**
    for (const n of ['RESOURCE_ACQUISITION', 'DECISION_ALLOCATION', 'TRUST_CONSTRUCTION', 'POWER_DISTRIBUTION']) {
      expect(ch1, `第一章不该出现第二章的命名: ${n}`).not.toContain(n);
    }
  });

  it('第二章自身不自洽：E-12 在同一文件内被写成两个名字', () => {
    const ch2 = readFileSync(CH2, 'utf-8');
    expect(ch2).toContain('### E-12: POWER_DISTRIBUTION');
    expect(ch2).toContain('E-12 EFFICIENCY_FINANCING（效率→外部融资信号）');
  });
});

describe('#238 §三 表 A：字符串同义命中恰 13 条（低置信项一律不得冒充命中）', () => {
  const edges = loadCodeEdges();
  const byLabel = new Map(edges.map((e) => [e.label, e]));
  const ch2 = headings(CH2, 'ch2');

  it('命中集合 = 精确 13 条，且每条落到唯一 $id', () => {
    const hits = [...ch2.entries()]
      .filter(([, name]) => byLabel.has(name))
      .map(([en, name]) => `${en}->${byLabel.get(name)!.id}`)
      .sort();
    expect(hits).toEqual([
      'E-05->edge/capital_acquisition',
      'E-07->edge/talent_acquisition',
      'E-13->edge/capital_allocation',
      'E-17->edge/incentive_alignment',
      'E-18->edge/rule_constraint',
      'E-20->edge/knowledge_sharing',
      'E-22->edge/routine_rigidity',
      'E-23->edge/operational_execution',
      'E-28->edge/cross_functional_synergy',
      'E-29->edge/tech_infrastructure',
      'E-38->edge/talent_retention',
      'E-39->edge/knowledge_reuse',
      'E-40->edge/reputation_flywheel',
    ]);
    expect(hits.length).toBe(13);
  });

  it('降级路径：29 条未命中**不得**被计为命中（含 4 条章间分歧）', () => {
    const miss = [...ch2.entries()].filter(([, name]) => !byLabel.has(name)).map(([en]) => en);
    expect(miss.length).toBe(42 - 13);
    for (const en of ['E-08', 'E-10', 'E-11', 'E-12', 'E-01', 'E-26', 'E-42']) {
      expect(miss, `${en} 不该被判为字符串命中`).toContain(en);
    }
  });

  it('K4-01 前置：§3.5.1 的 8 条 E 号中字符串同义恰 4 条', () => {
    const eight = ['E-07', 'E-15', 'E-17', 'E-23', 'E-38', 'E-25', 'E-24', 'E-37'];
    const hitInEight = eight.filter((en) => byLabel.has(ch2.get(en) ?? ''));
    expect(hitInEight).toEqual(['E-07', 'E-17', 'E-23', 'E-38']);
  });
});

describe('#238 §五 表 C：golden 私有式 E-x.y 经 label 中介命中 34/36', () => {
  const edges = loadCodeEdges();
  const byLabel = new Map(edges.map((e) => [e.label, e]));

  it('36 键 / 命中 34 / 未命中 2，且未命中就是 E-0.4 与 E-X.1', () => {
    const g = JSON.parse(readFileSync(GOLDEN, 'utf-8')) as { edges: Record<string, { label: string }> };
    const keys = Object.keys(g.edges);
    expect(keys.length).toBe(36);
    const miss = keys.filter((k) => !byLabel.has(g.edges[k].label));
    expect(miss.sort()).toEqual(['E-0.4', 'E-X.1']);
    expect(g.edges['E-0.4'].label).toBe('ASSUMPTION_LINKAGE');
    expect(g.edges['E-X.1'].label).toBe('EXTERNAL_ASSUMPTION');
    expect(keys.length - miss.length).toBe(34);
    // 边界：两个已在交付件中被点名的陷阱样本
    expect(byLabel.get(g.edges['E-4.1'].label)!.id).toBe('edge/value_pricing');
    expect(byLabel.get(g.edges['E-5.5'].label)!.id).toBe('edge/retention_protects_knowledge');
  });

  it('形态归一交集 = 24（同形不同物 ⇒ 禁形态推断）', () => {
    const g = JSON.parse(readFileSync(GOLDEN, 'utf-8')) as { edges: Record<string, { label: string }> };
    const ch2 = headings(CH2, 'ch2');
    const norm = (k: string) => 'E-' + k.replace(/^E-/, '').replace('.', '');
    const inter = [...ch2.keys()].filter((k) => Object.keys(g.edges).map(norm).includes(k));
    expect(inter.length).toBe(24);
    // 反例分辨力：E-11 形态相同但语义不同 —— golden E-1.1 是资本获取，权威 E-11 是信任构建
    expect(norm('E-1.1')).toBe('E-11');
    expect(g.edges['E-1.1'].label).toBe('CAPITAL_ACQUISITION');
    expect(ch2.get('E-11')).toBe('TRUST_CONSTRUCTION');
  });
});

describe('#238 §六 _patch_d66.cjs：编号集合载体，但不是映射依据', () => {
  const raw = readFileSync(PATCH66, 'utf-8');
  const edges = loadCodeEdges();

  it('E-x.y distinct = 34，出现 119 处', () => {
    const occurrences = raw.match(LEGACY_ID_RE) ?? [];
    expect(occurrences.length).toBe(119);
    expect(new Set(occurrences).size).toBe(34);
  });

  it('56 个 code label 在其中 0 命中 ⇒ 不能当 E-x.y→$id 的依据（命中须打**行全文**）', () => {
    const present = edges.filter((e) => raw.includes(e.label));
    // 卡面④：`includes` 是**子串**命中 —— 定性前必须打印命中行全文（防 `MISS` ⊂ `TRANSMISSION` 类假阳）
    const hitLines = present.map((e) => {
      const lines = raw.split(/\r?\n/).filter((l) => l.includes(e.label));
      return `${e.label} @ ${lines.map((l) => l.trim()).join('  ⎪  ')}`;
    });
    expect(present.map((e) => e.label), `子串命中行全文（禁拿子串当定性依据）:\n${hitLines.join('\n')}`).toEqual([]);
  });
});

describe('#238 判据④：cycles 引用对齐全命中（与 probe-cycle-edges.ts 同口径）', () => {
  const edges = loadCodeEdges();
  const ids = new Set(edges.map((e) => e.id));
  const labels = new Set(edges.map((e) => e.label));

  it('occurrences=45 / distinct=15 / hit=15 / miss=0，且 legacy E-x.y = 0', () => {
    const files = collectCycleFiles(join(ROOT, 'cycles'));
    expect(files.length).toBe(6);

    let occurrences = 0;
    let legacy = 0;
    const used = new Map<string, number>();
    for (const f of files) {
      const raw = readFileSync(f, 'utf-8');
      legacy += (raw.match(LEGACY_ID_RE) ?? []).length;
      const shape = JSON.parse(raw) as {
        nodes?: Array<{ edgeRefs?: unknown }>;
        mapping?: Array<{ edgeId?: unknown }>;
      };
      for (const n of shape.nodes ?? []) {
        for (const r of (n.edgeRefs as unknown[]) ?? []) {
          occurrences += 1;
          used.set(String(r), (used.get(String(r)) ?? 0) + 1);
        }
      }
      for (const m of shape.mapping ?? []) {
        occurrences += 1;
        used.set(String(m.edgeId), (used.get(String(m.edgeId)) ?? 0) + 1);
      }
    }

    expect(legacy).toBe(0);
    expect(occurrences).toBe(45);
    expect(used.size).toBe(15);

    let hit = 0;
    let unknownDistinct = 0;
    const missValues: string[] = [];
    for (const v of used.keys()) {
      if (v === 'unknown') unknownDistinct += 1;
      else if (ids.has(v) || labels.has(v)) hit += 1;
      else missValues.push(v);
    }
    const miss = used.size - hit - unknownDistinct;
    expect(hit).toBe(15);
    expect(miss).toBe(0);
    expect(missValues).toEqual([]);
    // 交付件 §1.3 的机器可读摘要形态
    expect(`occurrences=${occurrences} distinct=${used.size} hit=${hit} miss=${miss}`).toBe(
      'occurrences=45 distinct=15 hit=15 miss=0',
    );
  });
});

describe('#238 §七 GLOSSARY 矛盾：已显式标注（不静默）', () => {
  it('表头注记 + 「（权威01）」误标已改正 + 指向权威表路径', () => {
    const g = readFileSync(GLOSSARY, 'utf-8');
    expect(g).toContain('编号口径注记（2026-10-12 加，K4-05 / #238）');
    expect(g).toContain('docs/synova/coordination/numbering-authority.md');
    expect(g).toContain('`E-01 … E-42`');
    // 旧误标不得残留
    expect(g).not.toContain('| **因果层**（权威01） |');
    // 矛盾事实必须被点名
    expect(g).toContain('E-4.1 decision_centralization');
    expect(g).toContain('"E-4.1": { "label": "VALUE_PRICING"');
  });
});

describe('#238 §三 交付件一致性：待裁登记与计数不得被删除', () => {
  const doc = readFileSync(AUTHORITY, 'utf-8');

  it('四类待裁登记与计数核对全部在件', () => {
    expect(doc).toContain('[字符串同义]');
    expect(doc).toContain('[语义同义·附仓内交叉引用件依据]');
    expect(doc).toContain('[章间分歧·待裁]');
    expect(doc).toContain('[待裁·名称层有同根候选]');
    expect(doc).toContain('[待裁·名称层无同根]');
    expect(doc).toContain('13+6+2+2+17+2 = **42**');
  });

  it('CTO 口径裁定的逐字引文与「工作令相反」的声明在件', () => {
    expect(doc).toContain('45 条引用 distinct');
    expect(doc).toContain('一律用 15');
    expect(doc).toContain('工作令 §二① 与该仓内裁定件相反，以裁定件＋实测为准');
  });

  it('两条待裁清单（19 条）逐条在件 —— 计数由**文档实测**推导 ＋ 集合双向 ＋ 子串边界（#499）', () => {
    // 声明面（保留）：与文档实测面**双向**比对（缺失/多出都点名）
    const classA = [
      'E-02', 'E-03', 'E-04', 'E-06', 'E-09', 'E-21', 'E-24', 'E-27', 'E-30',
      'E-32', 'E-33', 'E-34', 'E-35', 'E-36', 'E-37', 'E-41', 'E-42',
    ];
    const classB = ['E-01', 'E-26'];

    // 🔴 #499：原来这里写 `expect(classA.length + classB.length).toBe(19)` ——
    //    `classA`/`classB` 是**本文件自己的字面数组**，该断言与文档内容**无关**（恒真）。
    //    反向造红实证：只改本文件 `classA`（**文档一字未动**）该断言即翻红
    //    ⇒ 它证明的是「本文件写了 19 个字符串」，**不是**「文档里有 19 条」。
    //    ⇒ 计数一律改由**文档实测**推导（见 ②）；文档字面删条目的分辨力由 ③ 的集合双向比对承担。
    const blockA = sliceBlock(doc, 'A 类（17 条）', 'B 类（2 条）', 'A 类清单块');
    const blockB = sliceBlock(doc, 'B 类（2 条）', '⚠️ B 类', 'B 类清单块');
    const docA = eTokens(blockA);
    const docB = eTokens(blockB);

    // ① 标题基数 ↔ 块内实测（两侧**不同源**：标题是文字，块内是真条目）
    expect(
      docA.length,
      `A 类标题写 ${headerCount(blockA, 'A')} 条，块内实测 ${docA.length} 条 —— 标题与块不一致`,
    ).toBe(headerCount(blockA, 'A'));
    expect(
      docB.length,
      `B 类标题写 ${headerCount(blockB, 'B')} 条，块内实测 ${docB.length} 条 —— 标题与块不一致`,
    ).toBe(headerCount(blockB, 'B'));

    // ② 合计由**文档实测**推导（恒真的字面计数已删）
    expect(docA.length + docB.length, `两条待裁清单合计应为 19，文档实测 ${docA.length}+${docB.length}`).toBe(19);

    // ③ 集合**双向**相等：缺失/多出都点名 ＋ **命中行全文**（卡面④：禁拿子串当定性依据）
    expect(docA, setDiffMsg('A', docA, [...classA].sort(), blockA)).toEqual([...classA].sort());
    expect(docB, setDiffMsg('B', docB, [...classB].sort(), blockB)).toEqual([...classB].sort());
  });

  it('§2.3「测不出什么」五条在件（B2 必写）', () => {
    for (const t of ['测不出语义等价是否成立', '测不出该边在图上是否真被使用', '测不出文档正文的语义漂移']) {
      expect(doc).toContain(t);
    }
  });
});
