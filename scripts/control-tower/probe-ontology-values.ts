#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-ontology-values.ts — #234 K4-01「值域迁移」判据探针
 *
 * 卡面（Done 真源）: CTO 2026-10-11 裁定「以权威文档15 §3.5.1 数值区间为权威值域」
 *   （裁定全文入仓: `docs/synova/coordination/K4-审计定稿与卡面全套.md` §三bis）
 *
 * ═══ 权威源（仓内原件，逐条可核；禁引用仓外路径）═══════════════════════════════
 *   ① §3.5.1 表（一手原文，**在仓内**）:
 *      `docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/`
 *      `SYNOVA-RESEARCH-第三章-投入建议引擎-v1-0-20260714.md`
 *      锚点串（稳定，非行号）: `### 3.5.1 滞后时间的数据来源`
 *      原文注: 「`action_effect_lag` 定义在 42 边体系中（权威01 第二章），每条边有
 *      `minMonths` 和 `maxMonths` 两个值。」
 *      ⚠️ 派单件曾称「权威文档15 第三章正文**不在本仓**」—— **实测为假**（错在把文件名片段
 *      「投入建议引擎」当目录名；真目录名 =「企业循环溢出导航系统」）。本探针直接引一手原文，
 *      **不**声明所谓的"来源局限"（照派单件写会变成写假）。同节 8 条与 CTO 裁定 §三bis 的逐条
 *      引文**逐字一致** ⇒ 两条独立路径互证。
 *   ② §3.4 桶标签取值规范表（换算规则的另一半依据）:
 *      同目录 `SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md`
 *      锚点串: `**action_effect_lag 取值规范**`
 *      原表: `immediate`=即时生效无延迟 / `1_month`=约1个月 / `1-3_months`=1~3个月 /
 *            `3-6_months`=3~6个月 / `6-12_months`=6~12个月 / `>12_months`=超过12个月
 *   ③ E 号权威名: 同目录 `SYNOVA-RESEARCH-第二章-42条因果边权威定义-v1-0-20260714.md`
 *      （`### E-NN: NAME` 逐条标题，实测恰 42 条）
 *
 * ═══ 形态口径（CTO 裁定 ① vs 既有门禁的冲突，如实登记）════════════════════════
 *   CTO 裁定 ① 原文: 「代码的桶标签**改为数值区间**（`[min, max]`，单位月；
 *   `immediate` ⇒ `[0, 0.5]`）」；裁定 ②「**不双存**」。
 *   §3.5.1 末注主张对象形态 `{ minMonths: number, maxMonths: number }`，但两道**既有**写集外门禁
 *   硬要求**非空字符串**:
 *     · `scripts/control-tower/check-ontology-fields.sh` 的 `isinstance(d[fld], str)`
 *     · `src/l4/ontology-loader.ts` 的 `typeof raw === 'string'`
 *   ⇒ 本探针采用**字符串形数值区间** `"[min,max]"`（无空格、十进制小数保留原样）。
 *   ⚠️ 形态统一（是否改为对象）属**另案**：改那两道门禁 = 改门禁语义 ⇒ 必须上报，本卡不碰。
 *
 * ═══ 判定面（每条都可判、可跑红；逐条注明「测不出什么」见 LIMITS）═══════════════
 *   G0 迁移面    base `ba1b22a8b5` 实测桶标签**恰 5 条**（`immediate`×1 / `1_month`×1 /
 *                `1-3_months`×1 / `3-6_months`×2）；换算依据 = doc15 第一章 §3.4 桶图例
 *                （CTO 裁定 ① **明文只给 `immediate ⇒ [0,0.5]` 一条**，其余 4 桶按图例语言换算）
 *   G1 值域      因果边（`tags` 含 `causal`）的 `action_effect_lag` ∈ {字符串形区间} ∪ {`unknown`}
 *                ⇒ 否则 `值域违规`（例: 散文串 / 空串 / 非法区间）
 *   G2 桶标签残留 §3.4 六个桶标签出现在**任何**边上 ⇒ `桶标签残留`（CTO 裁定 ① 明文要改掉）
 *                ⚠️ G1–G4 **分层不早退**：同一条改动可**同时**命中多层
 *                （卡面反例②「`operational_execution` 改回 `3-6_months` ⇒ 报『值域违规 **+**
 *                 与 §3.5.1 相冲』」即此要求——一层 `continue` 掉后两层就会漏报）
 *   G3 §3.5.1 对齐 8 条 E 号分两类：
 *                · **同标签命中 4 条**（E-07/E-17/E-23/E-38）⇒ 值必须 === §3.5.1 值
 *                  否则 `与 §3.5.1 相冲`
 *                · **无同标签 4 条**（E-15/E-24/E-25/E-37）⇒ 值必须仍为 `unknown`
 *                  （**只登记、不改值**）否则 `缺口登记不符`
 *   G4 未覆盖项登记 §3.5.1 未覆盖的 3 条 E 号（E-05/E-13/E-28）**不判相冲**，但必须登记在册
 *                且值 === 登记值（登记值来源逐条注明）⇒ 否则 `登记不符`
 *   G5 非因果登记 唯一域外边（`tags` 不含 `causal`）必须 === `NON_CAUSAL_REGISTRY`
 *                ⇒ 否则 `非因果登记不符`（防"再塞一条散文值进来"）
 *   G6 换算规则   `intervalToBucket` 必须能与 §3.4 桶表往返对齐（规则自洽，非恒真）
 *   G7 两节交叉校验 §3.4（桶）↔ §3.5.1（数值）**双向**：一致者不得登记为互斥；互斥者必须登记。
 *                实测互斥 **3 条**（E-23/E-25/E-37）—— 与 CTO 记录「E-23/E-37」有出入（多出 E-25），
 *                本文件以实测为准并如实登记差异；E-25 的对应件本轮**值不动**，仅作风险登记
 *
 * ═══ 覆盖力档位（禁把 L1 报成 L2）═════════════════════════════════════════════
 *   本探针 = **L1 真读盘**（只读 `extensions/ontology/edge-types/**` 的 JSON + 只读位不读文档正文）。
 *   它证明「盘上值域已迁移且与 §3.5.1 对齐」；**不**证明任何生产代码消费了 `action_effect_lag`
 *   —— 实测 `src/` + `packages/` 对该字段**零消费方**（#1134 已实证，本卡未改）。读取侧接线
 *   不在本卡写集 ⇒ 属遗留项。
 *
 * 契约 (铁律 47):
 *   @input    — 无入参。扫描目录 = `$SYNO_EDGE_TYPES_DIR` ?? `<repo-root>/extensions/ontology/edge-types`
 *               repo-root = `$SYNOVA_REPO_ROOT` ?? 自 `process.cwd()` 逐级上溯（须含该目录）
 *   @output   — stdout 分段报告 + 末行 `RESULT=`（机器可读计数）；末段打印 LIMITS
 *   @degraded — 无降级分支：目录缺失 / 零 *.json / JSON 解析失败 ⇒ `[FAIL]` + exit 2（fail-closed，
 *               禁与「通过」混同，铁律 11）；判定违规 ⇒ exit 1
 *   退出码: 0 = 全绿 / 1 = 判定违规 / 2 = 探针自身异常
 *
 * 写集说明: 本文件属 #234 / #235（K4-01 / K4-02）写集；`scripts/control-tower/**` 其余文件**只读不碰**。
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ═══════════════════════════════════════════════════════════════════
// 常量（冻结口径；改口径 = 改卡，不许就地放宽）
// ═══════════════════════════════════════════════════════════════════

/** 边类型目录（仓库相对路径；`SYNO_EDGE_TYPES_DIR` 注入缝覆盖，测试沙箱隔离用） */
export const EDGE_DIR_REL = 'extensions/ontology/edge-types';

/** 显式降级标记（**非**第七个档位）：未标定，不得静默） */
export const UNKNOWN_MARKER = 'unknown';

/** 非因果结构性边登记（`tags` 不含 `causal`）—— 唯一域外件，值**不改**，登记接受 */
export const NON_CAUSAL_REGISTRY: readonly string[] = ['edge/goal_decomposition'];

/**
 * §3.5.1 八条（一手原文表；`min`/`max` 单位月）。
 *
 * `alignment` 口径（**与 §3.5.1 的「边名称」列做精确串比对得出**，实测见交付件 §A）:
 *   · `exact_label`    —— 仓内存在 `label` **精确等于** 该 E 号权威名的件（4 条）
 *   · `no_same_label`  —— 无精确同标签件（4 条）⇒ **只登记，不改值**（现值 `unknown` 保持）
 *
 * `expectation`:
 *   · `align_value`  —— 该件值**必须 === §3.5.1 值**（§3.5.1 覆盖且同标签命中 ⇒ 权威优先）
 *   · `register_gap` —— 该件值**必须 === `unknown`**（§3.5.1 无同标签边 ⇒ 登记为缺口，
 *                        **禁**把语义近邻硬当同一边而自填值 —— 自填比 `unknown` 更危险）
 */
export interface S351Entry {
  readonly e: string;
  readonly authName: string;
  /** 精确同标签件；无同标签时填**语义近邻件**（供登记/缺件检查，**不**作为取值依据） */
  readonly file: string;
  readonly min: number;
  readonly max: number;
  readonly alignment: 'exact_label' | 'no_same_label';
  readonly expectation: 'align_value' | 'register_gap';
  readonly basis: string;
}

export const S351_TABLE: readonly S351Entry[] = [
  { e: 'E-07', authName: 'TALENT_ACQUISITION', file: 'talent_acquisition.json', min: 1, max: 3,
    alignment: 'exact_label', expectation: 'align_value',
    basis: 'label=TALENT_ACQUISITION 精确命中（§3.5.1 原文行：`| E-07 | TALENT_ACQUISITION | 1 | 3 | 招聘周期：发布→入职→上手 |`）；§3.4 附录A 亦为 `1-3_months` ⇒ 两节一致' },
  { e: 'E-15', authName: 'HUMAN_DEPLOYMENT', file: 'talent_deployment.json', min: 1, max: 3,
    alignment: 'no_same_label', expectation: 'register_gap',
    basis: 'label 精确命中 0 件（实测 56 件 label 无 HUMAN_DEPLOYMENT）⇒ 登记为缺口、**不改值**。语义近邻 = talent_deployment（description「人力分配到任务」同义），但**近邻 ≠ 同标签** ⇒ 不据以取值' },
  { e: 'E-17', authName: 'INCENTIVE_ALIGNMENT', file: 'incentive_alignment.json', min: 0.5, max: 1,
    alignment: 'exact_label', expectation: 'register_gap',
    basis: 'label=INCENTIVE_ALIGNMENT 精确同标签命中，但**本卡不改其值**（队长 2026-10-12 裁定 (a)）：该件 base 现值为 `unknown`，**不在 §3.4 桶域内 ⇒ 无可迁移之物**；把未标定字段标定为已标定 = **语义升级/新增数据**，属扩面，须 CTO 定（纪律「不许自填」）。⇒ 登记为「§3.5.1 有值、本卡不落值」待 CTO 追认。🔴 与卡面 Done ②「能对上的逐条对齐」存在**口径缺口**，已在交付件 §8 显式登记。§3.5.1 值为 (0.5,1)' },
  { e: 'E-23', authName: 'OPERATIONAL_EXECUTION', file: 'operational_execution.json', min: 0, max: 0.5,
    alignment: 'exact_label', expectation: 'align_value',
    basis: 'label=OPERATIONAL_EXECUTION 精确命中（§3.5.1 原文行：`| E-23 | OPERATIONAL_EXECUTION | 0 | 0.5 | 运营调整：决策→执行变化（实时） |`）。🔴 与 §3.4/附录A（`3-6_months`⇒[3,6]）**互斥**，按 CTO 裁定 ④ 以 §3.5.1 优先（`S34_VS_S351_CONFLICTS`）' },
  { e: 'E-38', authName: 'TALENT_RETENTION', file: 'talent_retention.json', min: 3, max: 6,
    alignment: 'exact_label', expectation: 'register_gap',
    basis: 'label=TALENT_RETENTION 精确同标签命中，但**本卡不改其值**（队长 2026-10-12 裁定 (a)，理由同 E-17）：base 现值 `unknown`，不在桶域内。⇒ 登记为「§3.5.1 有值、本卡不落值」待 CTO 追认。§3.5.1 值为 (3,6)；§3.4/附录A 亦为 `3-6_months` ⇒ **两源一致**（仅"落不落值"未定）' },
  { e: 'E-25', authName: 'BRAND_CONSTRUCTION', file: 'brand_building.json', min: 6, max: 12,
    alignment: 'no_same_label', expectation: 'register_gap',
    basis: 'label 精确命中 0 件 ⇒ 登记为缺口、**不改值**。语义近邻候选 = brand_building（label BRAND_BUILDING「品牌建设」）；🔴 排除 brand_builds.json 的依据（可判）：实测 56 件中仅 **42** 件属规范化标签族（tags 含 first_order|second_order）——恰与权威01 第二章的 42 条 E 号同数；brand_building 属该族，brand_builds（tags=causal|growth|marketing|lagged）**不属**' },
  { e: 'E-24', authName: 'INNOVATION', file: 'innovation_output.json', min: 6, max: 18,
    alignment: 'no_same_label', expectation: 'register_gap',
    basis: 'label 精确命中 0 件 ⇒ 登记为缺口、**不改值**。语义近邻 = innovation_output（label INNOVATION_OUTPUT，属规范化标签族 42 件之一）；§3.4 附录A **无** E-24 ⇒ 两节不可比' },
  { e: 'E-37', authName: 'PROFIT_REINVEST', file: 'profit_reinvestment.json', min: 3, max: 9,
    alignment: 'no_same_label', expectation: 'register_gap',
    basis: 'label 精确命中 0 件 ⇒ 登记为缺口、**不改值**。语义近邻 = profit_reinvestment（label PROFIT_REINVESTMENT，属规范化标签族）。🔴 与 §3.4 附录A（`6-12_months`⇒[6,12]）**互斥**，以 §3.5.1 优先（登记见下）' },
];

/**
 * §3.4 附录A「42边ID速查」中**与 §3.5.1 八字重合**的 E 号桶值（原文：`| E-xx | 中文名 | … | 典型 actionEffectLag |`）。
 * 用于 G7 的**双向**交叉校验：一致 ⇒ 必须不在 `S34_VS_S351_CONFLICTS`；不一致 ⇒ 必须在内。
 */
export const S34_TYPICAL_LAG: readonly { readonly e: string; readonly bucket: string }[] = [
  { e: 'E-07', bucket: '1-3_months' },
  { e: 'E-15', bucket: '1-3_months' },
  { e: 'E-17', bucket: '1_month' },
  { e: 'E-23', bucket: '3-6_months' },
  { e: 'E-38', bucket: '3-6_months' },
  { e: 'E-25', bucket: '3-6_months' },
  { e: 'E-37', bucket: '6-12_months' },
];

/**
 * 🔴 权威**跨源**互斥登记（**实测**，非照抄）。
 * doc15 内 `action_effect_lag` 存在**三个源**：
 *   S1 = 第三章 §3.5.1 数值表（8 条）｜S2 = 第一章 §3.4 五阀 JSON + cycle 示例（22 条）｜
 *   S3 = 第一章 附录A「42边ID速查」（25 条）
 * 判据 = 把 §3.4/附录A 给的桶按本文件换算规则转成区间，与 §3.5.1 的 `[min,max]` **精确串**比较。
 * 实测互斥 **3 条**：E-23 / E-25 / E-37。
 * ⚠️ 与 CTO 记录「E-23 / E-37」有出入（多出 **E-25**）：CTO 记录只点了两处示例，未穷举。
 * 🔴 E-25 的**风险登记**：其对应件 `brand_building.json` 本轮**值保持 `unknown`、不动**；
 *    但若后人引桶源（S2/S3）把 E-25 落成 `[3,6]`，会与 §3.5.1 的 `(6,12)` 相冲却**看似有据**
 *    ⇒ 以 §3.5.1 为准（本表即该判据的机器可判形态）。
 */
export const S34_VS_S351_CONFLICTS: readonly { readonly e: string; readonly s34: string; readonly s351: string }[] = [
  { e: 'E-23', s34: '3-6_months⇒[3,6]', s351: '[0,0.5]' },
  { e: 'E-25', s34: '3-6_months⇒[3,6]', s351: '[6,12]' },
  { e: 'E-37', s34: '6-12_months⇒[6,12]', s351: '[3,9]' },
];

/**
 * §3.5.1 **未覆盖项**（CTO 裁定 ⑤：登记为「§3.5.1 未覆盖项」，**不视为相冲**）。
 * ⚠️ 三条**均有 §3.4 桶值**（E-05 `immediate` / E-13 `1_month` / E-28 `3-6_months`）
 * ⇒ 按**同一换算规则**落地，标「§3.5.1 未覆盖 + §3.4 换算」。
 */
export interface UncoveredEntry {
  readonly e: string;
  readonly file: string;
  readonly min: number;
  readonly max: number;
  /** 原值桶标签（base 实测），用于回溯换算来源 */
  readonly fromBucket: string;
  /** `rule` = 由 §3.4 桶图例换算直接得出；`derivation` = 换算值**缺 CTO 明文**（提请追认） */
  readonly kind: 'rule' | 'derivation';
  readonly basis: string;
}

export const S351_UNCOVERED: readonly UncoveredEntry[] = [
  { e: 'E-05', file: 'capital_acquisition.json', min: 0, max: 0.5, fromBucket: 'immediate', kind: 'rule',
    basis: '§3.5.1 未覆盖（CTO 裁定 ⑤）；§3.4 桶值 `immediate`。换算 = CTO 裁定 ① 明文（「`immediate` ⇒ `[0, 0.5]`」）⇒ **唯一有 CTO 明文换算的一条**' },
  { e: 'E-13', file: 'capital_allocation.json', min: 0.5, max: 1, fromBucket: '1_month', kind: 'derivation',
    basis: '§3.5.1 未覆盖（CTO 裁定 ⑤）；§3.4 桶值 `1_month`（附录A `| E-13 | 资本配置效率 | 配置 | hard | 1_month |`；且同章 cycle 配置块中 `{"edgeId":"E-13","actionEffectLag":"1_month"}` 实测 **6 处零例外**）。换算 = `[0.5,1]`（**推导值**）：取 `[0.5,1]` 而非 §3.4 文字「约1个月」表面值的 `[0,1]`，理由 = **保 CTO 裁定 ②「数值区间→桶标签」换算规则的唯一性** —— `[0,1]` 会使 `immediate[0,0.5] ⊂ 1_month[0,1]` 重叠 ⇒ 区间→桶反查不可判定。📌 三重支撑（CTO 换算规则 + §3.4 桶图例 + S2/S3 源一致），但**无 CTO 明文**（明文只给 `immediate`）⇒ 标「换算非权威值」，**提请 CTO 追认**' },
  { e: 'E-28', file: 'cross_functional_synergy.json', min: 3, max: 6, fromBucket: '3-6_months', kind: 'rule',
    basis: '§3.5.1 未覆盖（CTO 裁定 ⑤ 明文点名 E-28 CROSS_FUNCTIONAL_SYNERGY）；§3.4 桶值 `3-6_months`（附录A + §3.4 配置块一致）⇒ 按 §3.4 桶图例「3~6个月」换算 `[3,6]`' },
];

/**
 * §3.4 桶标签 ↔ 数值区间（**换算规则**；CTO 裁定 ②「不双存」⇒ 本体层只存区间）。
 * 换算依据 = doc15 **第一章 §3.4**「`action_effect_lag` 取值规范」桶图例：
 *   `immediate`=即时生效无延迟 / `1_month`=**约1个月** / `1-3_months`=1~3个月 /
 *   `3-6_months`=3~6个月 / `6-12_months`=6~12个月 / `>12_months`=超过12个月。
 * ⚠️ CTO 裁定 ① **明文只给 `immediate ⇒ [0, 0.5]` 一条**；其余 4 桶的区间由本图例语言换算得出
 *   ⇒ 交付件已标注「换算依据 = §3.4 桶图例；CTO 明文只覆盖 `immediate`」。
 */
export interface BucketInterval {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

export const BUCKET_INTERVALS: readonly BucketInterval[] = [
  { label: 'immediate', min: 0, max: 0.5 },
  { label: '1_month', min: 0.5, max: 1 },
  { label: '1-3_months', min: 1, max: 3 },
  { label: '3-6_months', min: 3, max: 6 },
  { label: '6-12_months', min: 6, max: 12 },
];
// 🔴 `1_month = [0.5,1]` 而非按 §3.4 文字「约1个月」取 `[0,1]` —— 理由 = **保 CTO 裁定 ② 换算规则的唯一性**：
//    `[0,1]` 会使 `immediate[0,0.5] ⊂ 1_month[0,1]` **重叠** ⇒ 区间→桶**反查不可判定**，
//    而该反查正是 CTO 明文交付项（「用换算而非双存」）。⇒ 桶集互斥成链 [0,0.5]/[0.5,1]/[1,3]/[3,6]/[6,12]。
//    CTO 明文只覆盖 `immediate` 一条 ⇒ 本条标「换算非权威值」，**提请 CTO 追认**。

/** 开区间尾桶（`>12_months`）——无有限上界，不参与 exact 比对，只参与跨桶描述 */
export const OPEN_TAIL_BUCKET: BucketInterval = { label: '>12_months', min: 12, max: Number.POSITIVE_INFINITY };

/** §3.4 六个桶标签（**必须零残留**于本体层；CTO 裁定 ① 明文要改掉） */
export const LEGACY_BUCKET_LABELS: readonly string[] = [
  'immediate', '1_month', '1-3_months', '3-6_months', '6-12_months', '>12_months',
];

const INTERVAL_RE = /^\[(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\]$/;

// ═══════════════════════════════════════════════════════════════════
// 纯函数（无 IO / 无时钟 / 无随机）
// ═══════════════════════════════════════════════════════════════════

/** 格式化为字符串形区间 `[min,max]`（无空格；与 CTO 裁定 ① 的 `[min, max]` 同义） */
export function formatInterval(min: number, max: number): string {
  return `[${min},${max}]`;
}

/** 解析字符串形区间；非区间形态 ⇒ `null`（**不抛**，交由判定计数） */
export function parseInterval(raw: unknown): { min: number; max: number } | null {
  if (typeof raw !== 'string') return null;
  const m = INTERVAL_RE.exec(raw);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min > max) return null;
  return { min, max };
}

/** 值是否落在权威值域（字符串形区间 ∪ `unknown`） */
export function isInLagDomain(raw: unknown): boolean {
  if (raw === UNKNOWN_MARKER) return true;
  return parseInterval(raw) !== null;
}

/** 区间 → 桶标签（**展示层换算**，CTO 裁定 ②；本体层不双存） */
export function intervalToBucket(min: number, max: number): { exact: string | null; spanning: string[] } {
  const all = [...BUCKET_INTERVALS, OPEN_TAIL_BUCKET];
  const exact = all.find(b => b.min === min && b.max === max);
  if (exact) return { exact: exact.label, spanning: [] };
  const spanning = all
    .filter(b => Math.max(min, b.min) < Math.min(max, b.max))
    .map(b => b.label);
  return { exact: null, spanning };
}

// ═══════════════════════════════════════════════════════════════════
// 装载（L1 真读盘）
// ═══════════════════════════════════════════════════════════════════

export interface EdgeFileSample {
  /** **真实文件名**（取自目录实况；**禁**从 `$id` 反推——实测 5 件 `$id` 尾段为连字符而文件名用下划线） */
  file: string;
  id: string;
  label: string;
  tags: string[];
  lag: unknown;
}

export class ProbeEnvError extends Error {}

/** 逐件读盘（JSON 解析失败 ⇒ 抛 `ProbeEnvError` = 探针自身异常，fail-closed） */
export function loadEdgeFiles(dir: string): EdgeFileSample[] {
  if (!existsSync(dir)) {
    throw new ProbeEnvError(`目录不存在: ${dir}（fail-closed——目录搬走/挂载失败不是通过）`);
  }
  const names = readdirSync(dir).filter(n => n.endsWith('.json')).sort();
  if (names.length === 0) {
    throw new ProbeEnvError(`${dir} 下零 *.json（fail-closed）`);
  }
  const out: EdgeFileSample[] = [];
  for (const n of names) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, n), 'utf-8'));
    } catch (e) {
      throw new ProbeEnvError(`JSON 解析失败: ${n}: ${(e as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ProbeEnvError(`顶层不是 JSON 对象: ${n}`);
    }
    const d = parsed as Record<string, unknown>;
    out.push({
      file: n,
      id: typeof d.$id === 'string' ? d.$id : `<NO $id:${n}>`,
      label: typeof d.label === 'string' ? d.label : `<NO label:${n}>`,
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
      lag: d.action_effect_lag,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 判定（G1–G6）
// ═══════════════════════════════════════════════════════════════════

export interface LagAudit {
  files: number;
  causal: number;
  nonCausal: string[];
  /** 规范化标签族（tags 含 first_order|second_order）件数 —— **只报告不阻断**（L3 会 +2 件） */
  canonicalFamily: number;
  unknownCount: number;
  intervalCount: number;
  registeredCount: number;
  /** 逐条人读违规行（**点名真实文件名**，禁聚合掉） */
  violations: string[];
  /** 只报告不阻断行 */
  reportLines: string[];
}

/**
 * 审计一批边类型的 `action_effect_lag`。
 *
 * @input  samples — `loadEdgeFiles()` 的产物（`lag` 运行时类型未知是**刻意的**）
 * @output 计数 + 逐条具名违规行（真文件名 + 原样值）
 * @degraded 无：本函数不吞异常；环境异常由 `loadEdgeFiles` 抛 `ProbeEnvError`（fail-closed）
 * @error  不抛；异常输入落到 `violations` 计数
 */
export function auditLagValues(samples: readonly EdgeFileSample[]): LagAudit {
  const violations: string[] = [];
  const reportLines: string[] = [];
  const byFile = new Map(samples.map(s => [s.file, s]));
  const nonCausal: string[] = [];
  let causal = 0;
  let canonicalFamily = 0;
  let unknownCount = 0;
  let intervalCount = 0;
  let registeredCount = 0;

  for (const s of samples) {
    if (s.tags.includes('first_order') || s.tags.includes('second_order')) canonicalFamily += 1;
    const isCausal = s.tags.includes('causal');

    // G2 桶标签残留（**任何**边都不许留；桶标签是 §3.4 展示层口径，本体层不双存）
    // ⚠️ 此处**不**早退：卡面反例② 要求 `operational_execution` 改回 `3-6_months` 时
    //    同时报出「值域违规 **+** 与 §3.5.1 相冲」⇒ 判定必须**分层**（禁一层 `continue` 掉后两层）。
    if (typeof s.lag === 'string' && LEGACY_BUCKET_LABELS.includes(s.lag)) {
      violations.push(
        `桶标签残留 file=${s.file} $id=${s.id} value=${JSON.stringify(s.lag)} ⇒ CTO 裁定 ①：桶标签改为数值区间`,
      );
    }

    if (!isCausal) {
      nonCausal.push(s.id);
      reportLines.push(`REPORT 非因果结构性边（域外登记，本探针不做值域判定） file=${s.file} $id=${s.id} value=${JSON.stringify(s.lag)}`);
      continue;
    }

    causal += 1;
    const parsed = parseInterval(s.lag);
    if (parsed) {
      intervalCount += 1;
    } else if (s.lag === UNKNOWN_MARKER) {
      unknownCount += 1;
    } else {
      violations.push(
        `值域违规 file=${s.file} $id=${s.id} value=${JSON.stringify(s.lag)} ` +
          `⇒ 既非字符串形数值区间 "[min,max]"、亦非显式降级标记 "unknown"`,
      );
    }

    // G3 §3.5.1 对齐（**独立于**值域判定：形态合法但值不对也要报）
    const s351 = S351_TABLE.find(x => x.file === s.file);
    if (s351) {
      if (s351.expectation === 'align_value') {
        const want = formatInterval(s351.min, s351.max);
        if (s.lag !== want) {
          violations.push(
            `与 §3.5.1 相冲 file=${s.file} $id=${s.id} (${s351.e} ${s351.authName}) 实测=${JSON.stringify(s.lag)} ` +
              `§3.5.1=${JSON.stringify(want)}`,
          );
        } else {
          registeredCount += 1;
        }
      } else if (s.lag !== UNKNOWN_MARKER) {
        // 无同标签边 ⇒ 只登记、不改值：值必须仍为 `unknown`
        violations.push(
          `缺口登记不符 file=${s.file} $id=${s.id} (${s351.e} ${s351.authName} §3.5.1 无同标签边) ` +
            `实测=${JSON.stringify(s.lag)} 期望="unknown"（近邻 ≠ 同标签 ⇒ 禁据以自填值）`,
        );
      } else {
        registeredCount += 1;
      }
    }

    // G4 未覆盖项登记
    const unc = S351_UNCOVERED.find(x => x.file === s.file);
    if (unc) {
      const want = formatInterval(unc.min, unc.max);
      if (s.lag !== want) {
        violations.push(
          `登记不符 file=${s.file} $id=${s.id} (${unc.e} §3.5.1 未覆盖项) 实测=${JSON.stringify(s.lag)} 登记=${JSON.stringify(want)}`,
        );
      } else {
        registeredCount += 1;
      }
    }
  }

  // G3' §3.5.1 登记件必须存在于目录（缺件也是违规——防「删掉即通过」）
  for (const x of S351_TABLE) {
    if (!byFile.has(x.file)) violations.push(`§3.5.1 登记件缺失 file=${x.file} (${x.e} ${x.authName})`);
  }
  for (const x of S351_UNCOVERED) {
    if (!byFile.has(x.file)) violations.push(`未覆盖项登记件缺失 file=${x.file} (${x.e})`);
  }

  // G7 §3.4 ↔ §3.5.1 交叉校验（**双向**，与「取不取值」无关——比的是两节文档本身）
  const s34IntervalOf = (e: string): string | null => {
    const t = S34_TYPICAL_LAG.find(v => v.e === e);
    if (!t) return null;
    const b = BUCKET_INTERVALS.find(v => v.label === t.bucket);
    return b ? formatInterval(b.min, b.max) : null;
  };
  for (const x of S351_TABLE) {
    const conv = s34IntervalOf(x.e);
    if (conv === null) continue; // §3.4 无可比对项 ⇒ 不可比（如 E-24）
    const want = formatInterval(x.min, x.max);
    const listed = S34_VS_S351_CONFLICTS.some(c => c.e === x.e);
    if (conv === want && listed) {
      violations.push(`互斥登记陈旧 ${x.e}（两节实际一致 §3.4=${conv} == §3.5.1=${want}，却登记为互斥）`);
    }
    if (conv !== want && !listed) {
      violations.push(`两节互斥未登记 ${x.e}（§3.4=${conv} ≠ §3.5.1=${want}）⇒ 必须进 S34_VS_S351_CONFLICTS`);
    }
  }
  for (const c of S34_VS_S351_CONFLICTS) {
    const x = S351_TABLE.find(t => t.e === c.e);
    if (!x) {
      violations.push(`互斥登记项不在 §3.5.1 八条内 ${c.e}`);
      continue;
    }
    const conv = s34IntervalOf(c.e);
    if (conv === null || conv === formatInterval(x.min, x.max)) {
      violations.push(`互斥登记项实际不互斥 ${c.e}（§3.4=${conv ?? 'N/A'} vs §3.5.1=${formatInterval(x.min, x.max)}）`);
    }
  }
  reportLines.push(
    `REPORT §3.4↔§3.5.1 互斥登记（按 CTO 裁定以 §3.5.1 优先） ${S34_VS_S351_CONFLICTS.length} 条: ` +
      S34_VS_S351_CONFLICTS.map(c => `${c.e}(${c.s34} vs ${c.s351})`).join(' / '),
  );
  reportLines.push(
    `REPORT §3.5.1 八条中无同标签边（缺口登记·**不改值**） ` +
      `${S351_TABLE.filter(x => x.expectation === 'register_gap').length} 条: ` +
      S351_TABLE.filter(x => x.expectation === 'register_gap').map(x => `${x.e} ${x.authName}`).join(' / '),
  );

  // G5 非因果登记（唯一域外件必须恰为登记集）
  const nonCausalIds = [...nonCausal].sort();
  const nonCausalFiles = samples.filter(s => nonCausal.includes(s.id)).map(s => s.file).sort();
  const wantNonCausal = [...NON_CAUSAL_REGISTRY].sort();
  if (JSON.stringify(nonCausalIds) !== JSON.stringify(wantNonCausal)) {
    violations.push(
      `非因果登记不符 实测域外集=${JSON.stringify(nonCausalIds)} 域外件=${JSON.stringify(nonCausalFiles)} ` +
        `登记集=${JSON.stringify(wantNonCausal)} ⇒ 新增/删除域外边必须显式改登记（禁静默放宽）`,
    );
  }

  // G6 换算规则自洽（往返：桶标签 → 区间 → 桶标签 必须回到自身）
  for (const b of BUCKET_INTERVALS) {
    const rt = intervalToBucket(b.min, b.max);
    if (rt.exact !== b.label) {
      violations.push(`换算规则不自洽 bucket=${b.label} roundTrip=${JSON.stringify(rt.exact)}`);
    }
  }

  if (canonicalFamily !== 0) {
    reportLines.push(
      `REPORT 规范化标签族（tags 含 first_order|second_order）件数 = ${canonicalFamily} ` +
        `（权威01 第二章 E 号恰 42 条；**只报告不阻断**——L3 #1350 会新增 2 件）`,
    );
  }

  return {
    files: samples.length,
    causal,
    nonCausal: nonCausalIds,
    canonicalFamily,
    unknownCount,
    intervalCount,
    registeredCount,
    violations,
    reportLines,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 入口定位
// ═══════════════════════════════════════════════════════════════════

export function resolveEdgeDir(): string {
  const injected = process.env.SYNO_EDGE_TYPES_DIR;
  if (injected && injected.trim().length > 0) return resolve(injected);
  const explicit = process.env.SYNOVA_REPO_ROOT;
  if (explicit && explicit.trim().length > 0) return join(resolve(explicit), EDGE_DIR_REL);
  let cur = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(cur, EDGE_DIR_REL))) return join(cur, EDGE_DIR_REL);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new ProbeEnvError(`定位不到仓库根（自 ${process.cwd()} 逐级上溯均无 ${EDGE_DIR_REL}）`);
}

// ═══════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════

function main(): number {
  let dir: string;
  try {
    dir = resolveEdgeDir();
  } catch (e) {
    console.error(`[FAIL] ${(e as Error).message}`);
    return 2;
  }

  let samples: EdgeFileSample[];
  try {
    samples = loadEdgeFiles(dir);
  } catch (e) {
    console.error(`[FAIL] ${(e as Error).message}`);
    return 2;
  }

  const a = auditLagValues(samples);

  console.log(`── 探针: scripts/control-tower/probe-ontology-values.ts（#234 K4-01 值域迁移）`);
  console.log(`── 扫描目录: ${dir}`);
  console.log(`── 权威源: 权威文档15 §3.5.1（一手原文，仓内）+ §3.4 换算表 + 权威01 第二章 E 号名`);
  console.log('');
  console.log(`── G1 值域（因果边）: 区间=${a.intervalCount} unknown=${a.unknownCount}（合计因果边 ${a.causal} / 全部 ${a.files}）`);
  console.log(`── G3 §3.5.1 八条: 精确同标签·取值 ${S351_TABLE.filter(x => x.expectation === 'align_value').length} 条 + 无同标签·缺口登记 ${S351_TABLE.filter(x => x.expectation === 'register_gap').length} 条`);
  console.log(`── G4 §3.5.1 未覆盖项登记: ${S351_UNCOVERED.length} 条（规则 ${S351_UNCOVERED.filter(x => x.kind === 'rule').length} + 推导 ${S351_UNCOVERED.filter(x => x.kind === 'derivation').length}）`);
  console.log(`── G5 非因果域外登记: ${NON_CAUSAL_REGISTRY.length} 条`);
  console.log('');
  for (const l of a.reportLines) console.log(l);
  if (a.reportLines.length > 0) console.log('');
  for (const v of a.violations) console.log(`❌ ${v}`);
  if (a.violations.length > 0) console.log('');

  console.log('── LIMITS（本探针**证不了**什么，防「接线了 ≠ 被执行」误读）');
  console.log('   · [L1 真读盘] 只证明盘上值域已迁移且与 §3.5.1 对齐；**不**证明生产代码消费了该字段');
  console.log('     （实测 src/ + packages/ 对该字段零消费方 ⇒ 读取侧接线不在本卡写集，属遗留项）');
  console.log('   · 非因果结构性边（' + NON_CAUSAL_REGISTRY.join(', ') + '）的值**不做**值域判定——');
  console.log('     它在本探针口径下是「域外登记」，在 #1134 判据口径下仍是「唯一的具名规范违规」（见交付件）；');
  console.log('     两口径并存、都可见，**不是**静默放宽');
  console.log('   · 不比对权威文档正文（E 号 ↔ 文件名映射为冻结表，逐条带依据；正文比对属另案）');
  console.log('');

  const last =
    `RESULT=files=${a.files} causal=${a.causal} noncausal=${a.nonCausal.length} ` +
    `interval=${a.intervalCount} unknown=${a.unknownCount} registered=${a.registeredCount} ` +
    `violations=${a.violations.length}`;
  console.log(last);

  if (a.violations.length > 0) {
    console.error(`[FAIL] 违规 ${a.violations.length} 条（逐条见上）`);
    return 1;
  }
  console.log('[OK] 值域迁移判定全绿');
  return 0;
}

/**
 * 直跑判定：`process.argv[1]` 与 `import.meta.url` 同一文件。
 * 测试侧 import 本模块时**不**触发 `main()`（判定项由测试自己调 `auditLagValues`）。
 */
const argv1 = process.argv[1];
const invokedDirectly = argv1 !== undefined && resolve(argv1) === fileURLToPath(import.meta.url);
if (invokedDirectly || process.env.SYNO_PROBE_FORCE_MAIN === '1') {
  process.exit(main());
}

export { main as probeMain };
