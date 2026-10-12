/**
 * tests/ontology/edge-lag-values.test.ts — #234 / K4-01「`action_effect_lag` 值域迁移」判据件
 *
 * 卡面（Done 真源）: CTO 2026-10-11 裁定「以权威文档15 §3.5.1 数值区间为权威值域」
 *   （裁定全文入仓: `docs/synova/coordination/K4-审计定稿与卡面全套.md` §三bis）
 *
 * 探针（判据载体）: `scripts/control-tower/probe-ontology-values.ts`
 *   · 本件 import 探针的**纯函数 + 判定函数**，沙箱由 `loadEdgeFiles(dir)` 的 `dir` 入参给定
 *     ⇒ 探针**无模块级路径常量**、**无进程内缓存**，故沙箱**不需要子进程**（与 #1134 件不同，
 *     那是因为 `src/l4/ontology-loader.ts` 有模块级 `ONTOLOGY_DIR` + `cache`；本探针无此问题）。
 *
 * 覆盖（铁律 48：正常 / 降级 / 边界 三路径，非空壳）:
 *   正常路径 — ① 仓内真件（git 跟踪的交付物）经探针判定**全绿**（violations 为空）
 *              ② §3.5.1 八条**逐条字面值**断言（不是"存在"，是值相等）
 *              ③ §3.5.1 未覆盖三条**逐条字面值**断言
 *   降级路径 — ④ `unknown`（显式降级标记）计 `unknownCount`，**不**误记为违规、**不**静默吞
 *              ⑤ 目录缺失 / 零 *.json / JSON 损坏 ⇒ 抛 `ProbeEnvError`（fail-closed，禁与"通过"混同）
 *   边界     — ⑥ 区间解析：非法形态 / min>max / 桶标签 / 非字符串 一律 `null`
 *              ⑦ 换算规则：exact 命中 / 跨桶 / 无任何桶重叠
 *
 * 判别性夹具（改坏即红，**非恒真断言**）—— 全部在 `os.tmpdir()` 沙箱内做，**零真仓写入**:
 *   · 任一条改回桶标签 `immediate`        ⇒ `桶标签残留` 必现（CTO 裁定 ① 的执行体）
 *   · `operational_execution` 改回 `3-6_months` ⇒ `与 §3.5.1 相冲` 必现
 *   · 把 `unknown` 改成散文串             ⇒ `值域违规` 必现
 *   · 删掉 §3.5.1 登记件                  ⇒ `§3.5.1 登记件缺失` 必现（防"删掉即通过"）
 *   · 给域外件 `tags` 补 `causal`         ⇒ `非因果登记不符` + `值域违规` 双现
 *   · 再塞一件非因果散文件                ⇒ `非因果登记不符` 必现（禁静默放宽登记面）
 *   · 每条"改坏"后**还原** ⇒ 同一断言回到绿（证明偏离来自改动本身，非恒抛）
 *
 * 🔴 本件**证不了**什么（防「接线了 ≠ 被执行」误读）:
 *   · 本件是 **L1 真读盘 + 纯函数**：证明"盘上值域已迁移、与 §3.5.1 对齐、改坏即红"；
 *     **不**证明任何生产代码路径消费了 `action_effect_lag`。
 *     实测 `src/` + `packages/` 对该字段**零消费方**（#1134 已实证，本卡未改）
 *     ⇒ 读取侧接线不在本卡写集，属遗留项。
 *   · 非因果结构性边（`goal_decomposition.json`）的值**不在**本件值域判定域内（域外登记）；
 *     它在 `tests/l4/edge-lag-unknown-degraded-1134.test.ts` 口径下仍是**唯一的具名规范违规**。
 *     两口径并存且都可见 —— 本件**不宣称**它已被"修好"。
 *
 * 🔴 删件检测**已外包**（本件不再检出「件被删」——期望值与实测值同源，同为扫盘）：
 *   · SPEC 件被删   ⇒ `tests/l4/edge-lag-unknown-degraded-1134.test.ts` 的 `N2-1`（具名清单）抓，且点名
 *   · 预告件被删    ⇒ `tests/ontology/k4-05bis-edge-vocabulary-1350.test.ts` 抓
 *   · 域外集被改    ⇒ 本件集合锚 / `numbering-authority.test.ts` 的 #1350 集合锚
 *   ⚠️ 若上述任一处被改坏或跳过，**本件的删件覆盖会静默消失**（无其他防线）。
 *
 * 契约 (铁律 47):
 *   @input    — 无。真仓根 = `process.cwd()`（vitest cwd = 仓库根）
 *   @output   — vitest 断言；沙箱全部落 `os.tmpdir()`，`afterAll` 清理
 *   @degraded — 无。本件是判据载体，失败即红；探针的"降级/异常"由 `ProbeEnvError` 显式表达并被断言
 *   @零 DB    — 全程不 open 任何 SQLite 文件、不读 `data/synova.db`
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  BUCKET_INTERVALS,
  EDGE_DIR_REL,
  LEGACY_BUCKET_LABELS,
  NON_CAUSAL_REGISTRY,
  OPEN_TAIL_BUCKET,
  PENDING_REGISTERED_ADDITIONS,
  ProbeEnvError,
  S34_TYPICAL_LAG,
  S34_VS_S351_CONFLICTS,
  S351_TABLE,
  S351_UNCOVERED,
  UNKNOWN_MARKER,
  auditLagValues,
  formatInterval,
  intervalToBucket,
  isInLagDomain,
  loadEdgeFiles,
  parseInterval,
} from '../../scripts/control-tower/probe-ontology-values';

const REPO_ROOT = process.cwd();
const REAL_EDGE_DIR = join(REPO_ROOT, EDGE_DIR_REL);

/**
 * 🔴 N2 续做（#234，base `aa085e1f1`）：**件数与域外集一律「扫盘 ＋ 具名登记」推导，禁字面基数**。
 *
 * 原为字面 `56 / 55 / 1`，撞上 #1350（`l3-65`）落地后的 **58 件**。
 * 口径（照 `tests/l4/edge-lag-unknown-degraded-1134.test.ts` 的 N2 版）：
 *   · 件数 = **扫盘**目录实况（禁从文件名推 `$id` —— 实测恰 5 件 `$id` 尾段 ≠ 文件名主干）
 *   · 域外集 = `NON_CAUSAL_REGISTRY`（具名登记）∪ **在场**预告件（`PENDING_REGISTERED_ADDITIONS`）
 *   · 🔴 **在场性筛选**（纪律 #3）：预告件**缺席时不得计入** —— 否则本件在 56 件树上自红
 *   · 真棘轮 = **集合比对**（登记面 ↔ 实测 `tags` 判定），**禁"扫盘实数当期望值"**（恒真 = 假绿）
 */
function derivedEdgeCounts(dir: string = REAL_EDGE_DIR): {
  files: string[];
  nonCausalIds: string[];
  presentPendingIds: string[];
} {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const presentPending = PENDING_REGISTERED_ADDITIONS.filter((p) => files.includes(p.file));
  const nonCausalIds = [...new Set([...NON_CAUSAL_REGISTRY, ...presentPending.map((p) => p.id)])].sort();
  return { files, nonCausalIds, presentPendingIds: presentPending.map((p) => p.id) };
}

const SANDBOX_BASE = mkdtempSync(join(tmpdir(), 'synova-234-k4-01-'));
afterAll(() => {
  rmSync(SANDBOX_BASE, { recursive: true, force: true });
});

/** 每用例一份独立沙箱（`cpSync` 真仓 edge-types 全量副本）—— 用例之间互不污染 */
let sandboxSeq = 0;
function withSandbox<T>(fn: (dir: string) => T): T {
  sandboxSeq += 1;
  const dir = join(SANDBOX_BASE, `sb-${sandboxSeq}`);
  mkdirSync(dir, { recursive: true });
  cpSync(REAL_EDGE_DIR, dir, { recursive: true });
  return fn(dir);
}

function readJson(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>;
}

function writeJson(dir: string, file: string, doc: Record<string, unknown>): void {
  writeFileSync(join(dir, file), JSON.stringify(doc, null, 2) + '\n', 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════
// A 正常路径 — 真仓（git 跟踪的交付物）
// ═══════════════════════════════════════════════════════════════════════════

describe('A. 真仓基线 — 值域已迁移且与 §3.5.1 对齐（L1 真读盘）', () => {
  const samples = loadEdgeFiles(REAL_EDGE_DIR);
  const audit = auditLagValues(samples);

  it('A1 件数口径：全部 / 因果 / 域外 —— 三数**扫盘推导**（禁字面基数），且违规为空（探针 exit 0 的依据）', () => {
    const d = derivedEdgeCounts();
    // ① 全部 = 扫盘件数（派生，不写死）
    expect(audit.files, `全部件数须 == 扫盘实况（${d.files.length} 件）`).toBe(d.files.length);
    // ② 🔴 集合棘轮：域外集**逐名**比对（登记面 ↔ 实测 tags 判定；多一件/少一件 ⇒ 红 + 点名两侧）
    expect(
      [...audit.nonCausal].sort(),
      `域外集须 == NON_CAUSAL_REGISTRY ∪ 在场预告件\n  实得: ${[...audit.nonCausal].sort().join(', ')}\n  期望: ${d.nonCausalIds.join(', ')}`,
    ).toEqual(d.nonCausalIds);
    // ③ 因果 = 全部 − 域外（派生，不写死）
    expect(audit.causal, '因果 = 件数 − 域外集').toBe(audit.files - d.nonCausalIds.length);
    // ④ 真棘轮（保留）：违规为空
    expect(audit.violations).toEqual([]);
  });

  it('A2 §3.5.1 八条**逐条字面值**断言（2 条落值 + 6 条缺口登记不改值）', () => {
    expect(S351_TABLE).toHaveLength(8);
    expect(S351_TABLE.filter(x => x.expectation === 'align_value')).toHaveLength(2);
    expect(S351_TABLE.filter(x => x.expectation === 'register_gap')).toHaveLength(6);
    for (const x of S351_TABLE) {
      const doc = readJson(REAL_EDGE_DIR, x.file); // 逐件**真读盘**，不靠探针聚合
      if (x.expectation === 'align_value') {
        const want = formatInterval(x.min, x.max);
        expect(doc['action_effect_lag'], `${x.file} (${x.e} ${x.authName}) 必须 === §3.5.1 ${want}`).toBe(want);
      } else {
        // 不落值（无同标签边 或 队长裁定 (a) 不扩迁移面）⇒ 现值必须仍为 `unknown`（禁自填）
        expect(doc['action_effect_lag'], `${x.file} (${x.e} ${x.authName}) 本卡不落值 ⇒ 必须保持 unknown`).toBe('unknown');
      }
    }
    // 「无同标签边」恰 4 条（卡面 Done 的点名）
    expect(S351_TABLE.filter(x => x.alignment === 'no_same_label').map(x => x.e)).toEqual([
      'E-15', 'E-25', 'E-24', 'E-37',
    ]);
    // 「同标签命中但不落值」恰 2 条 = E-17 / E-38（队长 2026-10-12 裁定 (a)：不在桶域内 ⇒ 无可迁移之物）
    expect(S351_TABLE.filter(x => x.alignment === 'exact_label' && x.expectation === 'register_gap').map(x => x.e))
      .toEqual(['E-17', 'E-38']);
  });

  it('A2c §3.4/附录A ↔ §3.5.1 跨源互斥登记**双向**自洽（实测 3 条；CTO 记录只点 2 处示例）', () => {
    expect(S34_VS_S351_CONFLICTS.map(c => c.e)).toEqual(['E-23', 'E-25', 'E-37']);
    // 一致者不得登记为互斥；互斥者必须登记 —— 逐条重算（非照抄常量）
    for (const x of S351_TABLE) {
      const t = S34_TYPICAL_LAG.find(v => v.e === x.e);
      if (!t) continue;
      const b = BUCKET_INTERVALS.find(v => v.label === t.bucket);
      expect(b, `§3.4 桶标签 ${t.bucket} 必须在换算表内`).toBeTruthy();
      const conv = formatInterval(b!.min, b!.max);
      const want = formatInterval(x.min, x.max);
      const listed = S34_VS_S351_CONFLICTS.some(c => c.e === x.e);
      expect(conv === want, `${x.e} 两节一致性判断（§3.4=${conv} vs §3.5.1=${want}）`).toBe(!listed);
    }
    // E-24 在 §3.4 无配对 ⇒ 不可比（防"把不可比误当成一致"）
    expect(S34_TYPICAL_LAG.some(v => v.e === 'E-24')).toBe(false);
  });

  it('A2b §3.5.1 值域形态：单位月 + min ≤ max + 十进制小数保留（防"改了数值但形态错"）', () => {
    for (const x of S351_TABLE) {
      expect(Number.isFinite(x.min)).toBe(true);
      expect(Number.isFinite(x.max)).toBe(true);
      expect(x.min).toBeLessThanOrEqual(x.max);
    }
    // 原文两处小数（E-17 0.5/1、E-23 0/0.5）必须落成 `0.5` 形态，不能被写成 `0.50` / 整数
    expect(formatInterval(0.5, 1)).toBe('[0.5,1]');
    expect(formatInterval(0, 0.5)).toBe('[0,0.5]');
  });

  it('A3 §3.5.1 未覆盖项三条**逐条字面值**断言，且恰 1 条标 derivation（无权威值）', () => {
    expect(S351_UNCOVERED).toHaveLength(3);
    expect(S351_UNCOVERED.filter(x => x.kind === 'derivation')).toHaveLength(1);
    for (const x of S351_UNCOVERED) {
      const doc = readJson(REAL_EDGE_DIR, x.file);
      expect(doc['action_effect_lag'], `${x.file} (${x.e})`).toBe(formatInterval(x.min, x.max));
    }
    // E-13（capital_allocation）是唯一"推导"项 —— 其依据必须点明"提请 CTO 追认"
    const derived = S351_UNCOVERED.find(x => x.kind === 'derivation');
    expect(derived?.file).toBe('capital_allocation.json');
    expect(derived?.e).toBe('E-13');
    expect(derived?.basis).toContain('提请 CTO 追认');
  });

  it('A4 桶标签**零残留**（§3.4 六值逐个性断言 0 命中；CTO 裁定 ① 的执行体）', () => {
    for (const label of LEGACY_BUCKET_LABELS) {
      const hits = samples.filter(s => s.lag === label);
      expect(hits.map(h => h.file), `桶标签 ${label} 必须零残留`).toEqual([]);
    }
    expect(LEGACY_BUCKET_LABELS).toHaveLength(6);
  });

  it('A5 值域分类计数：区间 5 / unknown 50 / 登记 11（逐件可归因；K4-01 定稿实测）', () => {
    expect(audit.intervalCount).toBe(5);   // 迁移面 = 实测 5 条桶标签
    expect(audit.unknownCount).toBe(50);   // 与 base 同值（未扩迁移面）
    expect(audit.registeredCount).toBe(11); // 2 落值 + 6 缺口登记 + 3 未覆盖项
    expect(audit.intervalCount + audit.unknownCount).toBe(audit.causal);
  });

  it('A6 域外登记面恰为 `NON_CAUSAL_REGISTRY` ∪ **在场**预告件（防"再塞一件散文值进来"）', () => {
    const d = derivedEdgeCounts();
    // 具名登记表本身（保留原断言：删条即红）
    expect(NON_CAUSAL_REGISTRY).toEqual(['edge/goal_decomposition']);
    // 🔴 两段式：**登记面（具名）** ↔ **实测判定面（tags）** 集合相等；差一件 ⇒ 红 + 点名两侧
    expect(
      [...audit.nonCausal].sort(),
      `域外登记面不符\n  实得: ${[...audit.nonCausal].sort().join(', ')}\n  期望(NON_CAUSAL_REGISTRY ∪ 在场预告件): ${d.nonCausalIds.join(', ')}`,
    ).toEqual(d.nonCausalIds);
    // 域外件**值未被改动**（本卡不改它；散文值原样保留 ⇒ 与 #1134 件的口径并存）
    const gd = readJson(REAL_EDGE_DIR, 'goal_decomposition.json');
    expect(String(gd['action_effect_lag'])).toContain('结构性从属');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 判别性夹具 — 改坏即红（沙箱；**零真仓写入**）
// ═══════════════════════════════════════════════════════════════════════════

describe('B. 改坏即红 — 沙箱翻转值域（零真仓写入）', () => {
  it('B1 沙箱基线：未经改动 ⇒ 与真仓同判（violations 为空；件数**同源推导**）', () => {
    withSandbox(dir => {
      const a = auditLagValues(loadEdgeFiles(dir));
      expect(a.violations).toEqual([]);
      // 🔴 沙箱 = 真仓 `cpSync` 全量副本 ⇒ 期望值**同源推导**（禁字面 56）
      expect(a.files, '沙箱基线件数须 == 真仓扫盘件数（同源推导）').toBe(derivedEdgeCounts().files.length);
    });
  });

  it('B2 任一条改回桶标签 `immediate` ⇒ `桶标签残留` 必现（反例① 卡面原文）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'capital_acquisition.json');
      doc['action_effect_lag'] = 'immediate';
      writeJson(dir, 'capital_acquisition.json', doc);

      const a = auditLagValues(loadEdgeFiles(dir));
      const text = a.violations.join('\n');
      // 分层判定：同一条改动应**同时**命中三层（禁一层 `continue` 掉后两层）
      expect(text).toContain('桶标签残留');
      expect(text).toContain('值域违规');
      expect(text).toContain('登记不符');          // `immediate` ≠ 登记值 `[0,0.5]`
      expect(a.violations).toHaveLength(3);
      expect(text).toContain('file=capital_acquisition.json');
      expect(text).toContain('"immediate"');
      // 判别性：给"绿"断言施加到改坏输入上 ⇒ 必然抛（防恒真）
      expect(() => expect(a.violations).toEqual([])).toThrow();
    });
  });

  it('B3 `operational_execution` 改回 `3-6_months` ⇒ 报「值域违规 **+** 与 §3.5.1 相冲」（反例② 卡面原文）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'operational_execution.json');
      doc['action_effect_lag'] = '3-6_months';
      writeJson(dir, 'operational_execution.json', doc);

      const a = auditLagValues(loadEdgeFiles(dir));
      const text = a.violations.join('\n');
      expect(text).toContain('桶标签残留');
      expect(text).toContain('值域违规');
      expect(text).toContain('与 §3.5.1 相冲');    // ← 卡面反例② 点名要的这一条
      expect(a.violations).toHaveLength(3);
      expect(text).toContain('OPERATIONAL_EXECUTION');
      expect(text).toContain('3-6_months');
    });
  });

  it('B3b `operational_execution` 改成**区间形态但与 §3.5.1 不同** ⇒ 必报 `与 §3.5.1 相冲`', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'operational_execution.json');
      doc['action_effect_lag'] = formatInterval(3, 6); // 形态合法（是区间），值不是 §3.5.1 的 [0,0.5]
      writeJson(dir, 'operational_execution.json', doc);

      const a = auditLagValues(loadEdgeFiles(dir));
      expect(a.violations).toHaveLength(1);
      expect(a.violations[0]).toContain('与 §3.5.1 相冲');
      expect(a.violations[0]).toContain('OPERATIONAL_EXECUTION');
      expect(a.violations[0]).toContain('"[3,6]"');
      expect(a.violations[0]).toContain('"[0,0.5]"');
    });
  });

  it('B4 把一条 `unknown` 改成散文串 ⇒ `值域违规` 必现（禁把"未标定"改写成"叙事"）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'deploys.json');
      doc['action_effect_lag'] = '3个月左右——视情况而定';
      writeJson(dir, 'deploys.json', doc);

      const a = auditLagValues(loadEdgeFiles(dir));
      expect(a.violations).toHaveLength(1);
      expect(a.violations[0]).toContain('值域违规');
      expect(a.violations[0]).toContain('file=deploys.json');
    });
  });

  it('B5 删掉 §3.5.1 登记件 ⇒ `登记件缺失` 必现（防"删掉即通过"）', () => {
    withSandbox(dir => {
      rmSync(join(dir, 'talent_retention.json'));
      const a = auditLagValues(loadEdgeFiles(dir));
      expect(a.violations.some(v => v.includes('§3.5.1 登记件缺失') && v.includes('talent_retention.json'))).toBe(true);
    });
  });

  it('B6 给域外件补 `causal` 标签 ⇒ `值域违规` ＋ **已登记非因果件缺失**（N2 后的精确串，不钉旧串）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'goal_decomposition.json');
      doc['tags'] = ['structural', 'core', 'causal']; // 假装它是因果边
      writeJson(dir, 'goal_decomposition.json', doc);

      const a = auditLagValues(loadEdgeFiles(dir));
      // ① 该件曾被登记为域外，补 `causal` 后其散文值不再适配因果域 ⇒ `值域违规`（点名该件）
      expect(a.violations.some(v => v.includes('值域违规') && v.includes('goal_decomposition.json'))).toBe(true);
      // ② 🔴 N2 后的**精确**语义：该件**脱离域外集** ⇒ 探针走「已登记件缺失」分支（`probe:592`），
      //    报串 = 「已登记非因果件缺失 $id=edge/goal_decomposition」。
      //    （旧串「非因果登记不符」在 N2 后**只**对应 `probe:599` 的"未登记新增" ⇒ 此处**不得**出现，见 ③。）
      expect(
        a.violations.some(v => v.includes('已登记非因果件缺失') && v.includes('edge/goal_decomposition')),
        `须报「已登记非因果件缺失 $id=edge/goal_decomposition」；实得 violations:\n${a.violations.join('\n')}`,
      ).toBe(true);
      // ③ 反向断言（**两分支不混**）：**不得**报 `未登记新增`（那是 `probe:599`，语义 = 域外在场但未登记）
      expect(a.violations.some(v => v.includes('未登记新增'))).toBe(false);
    });
  });

  it('B7 再塞一件非因果散文件 ⇒ `非因果登记不符` 必现（禁静默放宽登记面）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'constrains.json'); // 该件 tags 无 causal 时会被算作域外
      doc['tags'] = ['causal', 'defensive'];         // 先确保它是因果边，再单独造一件域外件
      writeJson(dir, 'constrains.json', doc);
      writeJson(dir, 'zz-unregistered.json', {
        $id: 'edge/zz_unregistered',
        label: 'ZZ_UNREGISTERED',
        tags: ['structural'],
        action_effect_lag: '随缘',
      });

      const a = auditLagValues(loadEdgeFiles(dir));
      expect(a.violations.some(v => v.includes('非因果登记不符') && v.includes('zz-unregistered.json'))).toBe(true);
    });
  });

  it('B8 还原即绿：B2 的同一改动还原后 ⇒ 回基线（偏离来自改动本身，非恒抛）', () => {
    withSandbox(dir => {
      const path = 'capital_acquisition.json';
      const original = readJson(dir, path);
      expect(original['action_effect_lag']).toBe(formatInterval(0, 0.5));

      const broken = readJson(dir, path);
      broken['action_effect_lag'] = 'immediate';
      writeJson(dir, path, broken);
      const brokenAudit = auditLagValues(loadEdgeFiles(dir));
      expect(brokenAudit.violations).toHaveLength(3); // 分层：桶标签残留 + 值域违规 + 登记不符
      expect(brokenAudit.violations.join('\n')).toContain('桶标签残留');

      writeJson(dir, path, original); // 还原
      expect(auditLagValues(loadEdgeFiles(dir)).violations).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C 降级路径 + 边界
// ═══════════════════════════════════════════════════════════════════════════

describe('C. 降级路径（fail-closed，禁与"通过"混同）', () => {
  it('C1 目录不存在 ⇒ 抛 `ProbeEnvError`（不是 exit 0）', () => {
    expect(() => loadEdgeFiles(join(SANDBOX_BASE, 'no-such-dir'))).toThrow(ProbeEnvError);
  });

  it('C2 零 *.json ⇒ 抛 `ProbeEnvError`（"目录搬走"不是通过）', () => {
    const empty = join(SANDBOX_BASE, 'empty');
    mkdirSync(empty, { recursive: true });
    expect(() => loadEdgeFiles(empty)).toThrow(ProbeEnvError);
  });

  it('C3 JSON 损坏 ⇒ 抛 `ProbeEnvError` 且点名文件', () => {
    withSandbox(dir => {
      writeFileSync(join(dir, 'talent_acquisition.json'), '{ "action_effect_lag": ', 'utf-8');
      let caught: unknown = null;
      try {
        loadEdgeFiles(dir);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ProbeEnvError);
      expect((caught as ProbeEnvError).message).toContain('talent_acquisition.json');
    });
  });

  it('C4 `unknown`/区间都在值域内：缺口登记件被改成**合法区间** ⇒ 只报 `缺口登记不符`，**不**报 `值域违规`', () => {
    withSandbox(dir => {
      // `talent_retention.json` 是 register_gap（现值 unknown，本卡不落值）
      const doc = readJson(dir, 'talent_retention.json');
      doc['action_effect_lag'] = formatInterval(3, 6); // 形态合法（是区间）—— 若真填值就该是这个
      writeJson(dir, 'talent_retention.json', doc);

      const a = auditLagValues(loadEdgeFiles(dir));
      expect(a.violations).toHaveLength(1);
      // 关键分辨力：报的是**登记不符**（值域内 → 只是本卡不该落值），
      // 若区间不在值域内，这里会变成 `值域违规` ⇒ 本断言即红。
      expect(a.violations[0]).toContain('缺口登记不符');
      expect(a.violations[0]).not.toContain('值域违规');
      expect(a.violations[0]).toContain('E-38');
    });
  });
});

describe('D. 边界 — 区间解析 / 值域 / 换算规则（纯函数）', () => {
  it('D1 合法区间可解析（含十进制小数）', () => {
    expect(parseInterval('[1,3]')).toEqual({ min: 1, max: 3 });
    expect(parseInterval('[0,0.5]')).toEqual({ min: 0, max: 0.5 });
    expect(parseInterval('[0.5,1]')).toEqual({ min: 0.5, max: 1 });
    expect(parseInterval('[6,18]')).toEqual({ min: 6, max: 18 });
  });

  it('D2 非法形态一律 `null`（不抛）：桶标签 / 空串 / 非字符串 / min>max / 缺括号 / 带空格', () => {
    expect(parseInterval('immediate')).toBeNull();
    expect(parseInterval('1-3_months')).toBeNull();
    expect(parseInterval('')).toBeNull();
    expect(parseInterval(UNKNOWN_MARKER)).toBeNull();
    expect(parseInterval(3)).toBeNull();
    expect(parseInterval(null)).toBeNull();
    expect(parseInterval('[3,1]')).toBeNull();       // min > max
    expect(parseInterval('[1,]')).toBeNull();         // 缺上界
    expect(parseInterval('1,3]')).toBeNull();         // 缺左括号
    expect(parseInterval('[1, 3]')).toBeNull();       // 契约形态无空格（有空格 = 文档漂移，须显式）
  });

  it('D3 值域判定：区间 ∪ {unknown} 为真，其余为假（逐值可判）', () => {
    expect(isInLagDomain(formatInterval(0, 0.5))).toBe(true);
    expect(isInLagDomain(UNKNOWN_MARKER)).toBe(true);
    expect(isInLagDomain('immediate')).toBe(false);
    expect(isInLagDomain('TBD')).toBe(false);
    expect(isInLagDomain('')).toBe(false);
    expect(isInLagDomain(3)).toBe(false);
    expect(isInLagDomain('[3,1]')).toBe(false);
  });

  it('D4 换算规则（展示层）：五个桶 exact 命中 + 开尾桶 + 跨桶描述 + 无重叠', () => {
    for (const b of BUCKET_INTERVALS) {
      expect(intervalToBucket(b.min, b.max)).toEqual({ exact: b.label, spanning: [] });
    }
    expect(BUCKET_INTERVALS).toHaveLength(5);
    expect(OPEN_TAIL_BUCKET.label).toBe('>12_months');
    // 跨桶：§3.5.1 里两条越桶值必须**如实描述跨到哪些桶**，不得硬塞进单一桶
    expect(intervalToBucket(6, 18)).toEqual({ exact: null, spanning: ['6-12_months', '>12_months'] });
    expect(intervalToBucket(3, 9)).toEqual({ exact: null, spanning: ['3-6_months', '6-12_months'] });
    // 边界：不与任何桶重叠的区间（证明 spanning 非恒真、非恒空）
    expect(intervalToBucket(0, 0)).toEqual({ exact: null, spanning: [] });
    // 端点相接不算重叠（[3,6] 与 [6,12] 在 6 点相接，各归各桶）
    expect(intervalToBucket(3, 6)).toEqual({ exact: '3-6_months', spanning: [] });
  });
});
