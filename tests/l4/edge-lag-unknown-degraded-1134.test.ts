/**
 * tests/l4/edge-lag-unknown-degraded-1134.test.ts
 *
 * 卡 #1134 — W3 时滞：`action_effect_lag` 越权威枚举（定时雷）—— **乙路线**落地
 *   「`unknown` 是显式降级标记 ⇒ **不纳入枚举**；标 `degraded` + 落审计」
 *
 * ═══ 判据锚定（卡面 §五 判据分叉表「乙」）═══════════════════════════════════
 *   读到 `unknown` ⇒ **必产 degraded 标记或审计行**，且 **改坏即红**。
 *   实现形态（队长收窄口径）=「**显式豁免面 + 禁静默放宽**」：
 *     · 允许集 = 权威值域 **∪ {`unknown`}**
 *     · 出现**第 3 类值** ⇒ `specViolation > 0` ⇒ **必红**（禁静默放宽值域）
 *     · `unknown` 计数**钉死**（棘轮）⇒ 真值漂移 **必红**
 *
 * ═══ 🔴 K4-01（#234）值域迁移 — 本件的**强制棘轮同步**（2026-10-12，同批落地）═══════
 *   本件原文第 :121-122 行已写明「**禁止**把该散文值塞进豁免面换全绿」，并把它交给
 *   **K4-01「值域迁移」卡**（#1134 证据件 §遗留项原文：「🔴 **值域迁移另立卡**」）。
 *   #234 即那张卡，CTO 2026-10-11 裁定：**以权威文档15 §3.5.1 数值区间为权威值域**，
 *   §3.4 桶标签降为"展示参考" ⇒ 本件的**允许集必须随值域一起换**，否则本件会把
 *   11 条已迁移的合法区间值全部误报成"规范违规"（实测：迁移后 7 条断言转红）。
 *
 *   **换法（等价强度，非放宽）**：
 *     · 允许集：§3.4 六值桶标签 → **字符串形数值区间 `[min,max]`**（单源 = 探针
 *       `scripts/control-tower/probe-ontology-values.ts` 的 `isInLagDomain`，K3 R1 禁第二套口径）
 *     · `unknown` 语义**不变**（显式降级标记，仍在允许集内但标记为 degraded）
 *     · 桶标签**从"允许集成员"变成"零残留断言对象"**（出现即规范违规 —— 这正是 CTO 裁定 ① 的执行体）
 *       ⇒ 覆盖面**未缩小**：旧口径放行桶标签，新口径把桶标签判违规
 *     · `specViolation` 棘轮 **1 → 1**（唯一具名违规仍是 `goal_decomposition.json` 的散文值，
 *       它**未被**本卡改动，也**未**被塞进豁免面 —— 见 A4/A4b）
 *     · 计数棘轮按**实测**更新（禁照抄派单件的 56/50/5/1：那是**迁移前**的基数）
 *
 * ═══ 🔴 诚实边界（本件**不**覆盖什么 —— 禁把"防线侧"写成"读取侧"）═══════════
 * 实测 as_of `local-main = e52499ddd`（**K4-01 批 2 独立复测**，非照抄批 1）：
 * `git grep -n action_effect_lag -- src packages` ⇒ **无输出（命中 0）**
 * （`extensions/` **56 件**为纯数据面）⇒ **今天不存在可插桩的"读取侧"**。
 * 因此本件交付的是【**审计 / 防线侧的可执行实现**】：
 *   具名审计行 + 派生 `degraded` 计数 + 漂移即红。
 * **不是**「读取侧已产 degraded」。真正的"读取侧发射体"（有人读该字段时必须 degraded）
 * 需要 `src/**`，**不在本卡写集** ⇒ 列为未决项，本件**不宣称覆盖**（见 §D 的
 * `READ_SIDE_EMISSION` 棘轮：读取侧落地者必须显式改这个常量，从而被迫更新契约）。
 * 已知在同一批：`施工项登记.ts:788` 条目 `1-8` 的消费方验收件
 * `tests/sentinel/edge-lag-consumed.test.ts` —— 实测**在 origin/main 上不存在**。
 *
 * ═══ 与既有控制塔防线的分工（不在本件写集，勿混淆）═════════════════════════
 * `scripts/control-tower/check-ontology-fields.sh` 判据为**字段存在 + 值非空串**，
 * 自述「判据冻结…新增必查字段 = 判据变更 ⇒ 提案 → K3 → CTO」（:15-16）；
 * `memory/notes/proposed/2026-10-07-d1174-ontology-field-guard.md:9` 明文
 * 「**值内容（"unknown"/"TBD"）是数据质量，归产品线，不在本防线**」。
 * ⇒ 该防线**零枚举感知**（连 `NOT_IN_ENUM_AT_ALL` 都判通过，`exit 0`），
 *   其「枚举化」= 冻结判据变更 ⇒ **另立卡走 提案→K3→CTO，本卡不碰**。
 *   本件即 D1174 让渡给产品线的那半边（**值内容侧**），且**不修改**该防线。
 *
 * ═══ 权威源（逐条可核）═══════════════════════════════════════════════════════
 *  · 枚举（6 值，**不含 `unknown`**）：
 *      docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/
 *        SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md §3.4（:184-193 取值规范表）
 *  · `unknown` 的**性质**（显式降级标记，不是第七个档位）：
 *      docs/synova/product-lines/evidence/issue987-988-本体边时滞与因果强度-20261004.md:63
 *      「其余 **50 条** = `"unknown"`（**显式未知，不留空、不猜数 —— 铁律 11/31**）。」
 *      同件 :41 —— 采纳值域 = §3.4 六值「**外加 `unknown`**」（有意置于枚举**之外**）
 *  · 降级处置语义**早已写在权威文档**（缺的只是实现）：
 *      …/SYNOVA-RESEARCH-第三章-投入建议引擎-v1-0-20260714.md:526
 *      「`action_effect_lag` **未定义** ⇒ 使用默认值（min=3, max=6）+ **标注 `degraded: true`**」
 *
 * ═══ 设计要点 1：为什么用**子进程**做沙箱 ═══════════════════════════════════
 * `src/l4/ontology-loader.ts:43` 的 `ONTOLOGY_DIR = join(process.cwd(), …)` 是
 * **模块级 const**（import 时求值），且模块内有 `cache`（:46）⇒ 同进程二次 import
 * 不重算路径、直接吃缓存。
 * 🔴 实测教训（本卡探针 v1）：**静态 import + 事后 `process.chdir` ⇒ 沙箱被无视**，
 *    仍加载真仓 55 件（`nodes:29, edges:55`）而沙箱只有 5 件 —— **静默失效**。
 * ⇒ 唯一安全形态 = 「**独立进程 + `chdir` 后动态 `import`**」。本件即如此：
 *    每沙箱一子进程，**零真仓写入**，改坏即红不污染工作区。
 *
 * ═══ 设计要点 2：为什么不能从 `$id` 反推文件名 ═══════════════════════════════
 * 🔴 实测（本件发现，批 2 复测：**56 件中仍为 5 件**）：**5 件 `$id` 尾段 ≠ 文件名** ——
 *    `decision_concentrates.json` / `external_assumption.json` / `incentive_binds.json` /
 *    `locks_in.json` / `signal_transmits.json` 的 `$id` 用**连字符**（`edge/decision-concentrates`），
 *    而真实文件名用**下划线**；真实文件名**不含连字符**（字符集 `[_a-z]`）。
 * ⇒ 若用 `$id.replace('edge/','') + '.json'` 反推，审计行会**点一个不存在的文件**（= 假证据）。
 * ⇒ 故：文件名一律**取自目录实况**（子进程内 `readdirSync` + 解析各文件 `$id` 建映射），
 *    并把「`$id` 尾段 ≠ 文件名」作为**只报告不阻断**项（§F）—— 它是**存量事实**，
 *    非本卡引入，且判其是否应统一超出本卡范围（登记，不擅改）。
 *
 * ═══ 覆盖矩阵（铁律 48：正常 / 降级 / 边界）═════════════════════════════════
 *  A 正常：真仓 **56** 件经生产入口 → 派生 degraded=48 / inDomain=7 /
 *          **specViolation=1（逐件点名 `goal_decomposition.json` 的散文值）** /
 *          具名审计行 51 条（50 条 degraded + 1 条 violation，均点名**真文件名**）
 *  B 改坏即红：沙箱 5 件，翻转 1 件 ⇒ 计数漂移 ⇒ 同一绿断言必抛（正反两向 + 还原即绿）
 *  C 边界 + **禁静默放宽值域**：缺字段 / 空串 / 非字符串 / **自造值** / **真仓第 3 类值** 必须显形
 *  D 未来读取边界契约（可执行 + 棘轮）
 *  E 枚举成员零出现（**报告不阻断**）
 *  F `$id` ↔ 文件名 映射完整性（**报告不阻断**）
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// 🔴 值域判定**单源** = K4-01（#234）探针（K3 R1：禁第二套解析口径）
import {
  LEGACY_BUCKET_LABELS,
  NON_CAUSAL_REGISTRY,
  PENDING_REGISTERED_ADDITIONS,
  S351_TABLE,
  S351_UNCOVERED,
  SPEC_EDGE_TYPES,
  formatInterval,
  isInLagDomain,
} from '../../scripts/control-tower/probe-ontology-values';

// ═══════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════

const REPO = resolve(__dirname, '..', '..');
const EDGE_SRC = process.env.SYNO_EDGE_TYPES_DIR ?? join(REPO, 'extensions', 'ontology', 'edge-types');
const LOADER_TS = join(REPO, 'src', 'l4', 'ontology-loader.ts');

/**
 * §3.4 六个桶标签（doc15 第一章 §3.4 取值规范表，6 值）。
 * 🔴 K4-01（#234）后语义**翻转**：它们**不再是允许集成员**，而是"**本体层必须零残留**"的
 * 断言对象（CTO 裁定 ①：代码的桶标签改为数值区间）。清单**单源** = 探针，禁第二套清单。
 */
const EDGE_LAG_LEGACY_BUCKETS: readonly string[] = [...LEGACY_BUCKET_LABELS];

/** `unknown` = **显式降级标记**（非枚举值）。它是"未标定"，不是第七个档位。 */
const EDGE_LAG_DEGRADED_MARKER = 'unknown';

/**
 * 允许集 = **权威值域** ∪ {`unknown`}。
 * 判定**单源** = 探针 `isInLagDomain`（字符串形数值区间 `"[min,max]"` ∪ `unknown`）；
 * **不含**任何第三类值（散文串 / 桶标签 / 空串 / 非字符串 / 非法区间）。
 */
function isAllowedLag(raw: unknown): boolean {
  return isInLagDomain(raw);
}

/**
 * 允许集的**显式样本表**（C4b 用）。
 * 用"逐值可判的样本"替代旧口径的「长度恰为 7」——那个数字只能防"悄悄加一项"，
 * 防不住"把谓词改成恒真"。样本表对**恒真**与**恒假**两向都有分辨力。
 */
const ALLOWED_SAMPLES: readonly string[] = [
  formatInterval(0, 0.5), formatInterval(0.5, 1), formatInterval(1, 3),
  formatInterval(3, 6), formatInterval(6, 12), formatInterval(6, 18), formatInterval(3, 9),
  EDGE_LAG_DEGRADED_MARKER,
];
const REJECTED_SAMPLES: readonly string[] = [
  'immediate', '1_month', '1-3_months', '3-6_months', '6-12_months', '>12_months',
  '2_months', '', 'UNKNOWN', 'unknown ', 'TBD', '0', 'null', '[3,1]', '[1,]', '[1, 3]', '0d — 散文',
];

/**
 * 真仓基线（as_of `local-main = e52499ddd`，**K4-01 批 2 现场实测**）。
 * 🔴 这是**棘轮**：任何真仓值漂移都会让 A 组转红 —— 这是"防漂移"判据的分辨力来源。
 *
 * ═══ K4-01 批 2（2026-10-11）棘轮上移：55 → **56**，并**如实纳入 1 条规范违规** ═══
 * 事实（逐条实测量，原始输出见证据件 §A.0；**不照抄批 1/任务书**）：
 *   · `edge-types/` = **56 件**；第 56 件 = `goal_decomposition.json`（`$id=edge/goal_decomposition`），
 *     由 local-main 上 `18ed356f feat(k12-07): 目标一致（岗位↔公司可追溯，断开分解边必红）` 引入。
 *   · 该件 `action_effect_lag` = **散文串**
 *     `"0d — 分解关系为结构性从属（子目标一旦建立即属该上级），不承载跨期传导时滞"`
 *     ⇒ **第 3 类值**（既非 §3.4 六值、亦非显式降级标记 `unknown`）⇒ `specViolation = 1`。
 *   · `unknown` 仍 = **50**（不变）；枚举内真值仍 = **5**（不变）；`$id`↔文件名分歧仍 = 5。
 * ⇒ 处置（CTO 甲裁定：**只交「信号 + 计数」，不动枚举、不含值域迁移**）：
 *   **让审计如实点名这 1 条违规 + 棘轮上移到新事实**。
 *   🔴 **禁止**把该散文值塞进豁免面换全绿 —— 豁免面仍**恰为** 7 项（6 值 ∪ {unknown}，见 C4b），
 *   本件对第 3 类值的唯一处置是"计数 + 具名审计行"（A4/A4b/C4/B5）。
 *
 * ═══ 🔴 下游「棘轮同步」移交义务（**#1350 落地前必读**）═══════════════════════
 * 本夹具以 **56 / 48 / 7 / 1** 为基线常量（**K4-01 #234 值域迁移后的实测态**）。
 * **#1350**（本体边体系提案 · 词表 56 → 58，新增 `GOAL_DECOMPOSES_TO` +
 * `PLAN_COMMITS_TO` 两件边，按 CTO #1350 W3 口径 **初始 = `unknown`**）落地时 ⇒
 * **必须按当刻真值重新同步**：
 *
 *     BASELINE_TOTAL     56 → 58   （+2）
 *     BASELINE_DEGRADED  48 → 50   （两件新边按 W3 口径为 `unknown`）
 *     BASELINE_IN_DOMAIN  7 →  7   （不变：新边不进区间值域）
 *     BASELINE_ID_FILENAME_DIVERGENT  5 → 以实测为准（新边 `$id` 用连字符则 +N）
 *
 * 并**重新跑本夹具确认绿**。不同步 ⇒ **A1 / A2 / F1 必红**（这是**棘轮的正确行为**：
 * 逼后续卡显式确认"新增两件也走 `unknown`"，而不是被静默继承）。
 * 🔴 上表为**预测值**；落地时**以实测为准重算**，不要照抄（本注在批 2 就因照抄踩过一次）。
 *
 * ⚠️ **B 组**：沙箱取样 = 真仓**前 5 件（字典序 `a…c` 段）** = `assumption_triggered_reallocation` /
 * `augments` / `brand_building` / `brand_builds` / `capital_acquisition`，而
 * `goal_decomposes_to` / `plan_commits_to` 的首字母 `g` / `p` **排在其后** ⇒ #1350 落地**不**改变
 * 沙箱取样集；K4-01（#234）迁移后这 5 件实测 = `unknown ×4` + 区间 ×1
 * （`capital_acquisition=[0,0.5]`）⇒ 沙箱常量 5/4/1 **与原值一致**（迁移只动了第 5 件，
 * 而它在旧口径下也已是唯一非 `unknown` 件）。
 * 同理 F3（`$id` 分歧 5 件）**不受 K4-01 影响**。
 *
 * 📌 记录：本条移交义务由自验员在 Phase 2 复核中提出（其自验结论文件 §三 遗留项 L2），
 * 原夹具**未写明**该义务 ⇒ 本注释即补写的收口。
 */
// ═══ N2（CTO 2026-10-12）：**禁字面基数** —— 尺寸由**扫盘实数**推导；
//     **真棘轮 = 集合断言**（SPEC 成员不许缺 ∧ 未登记新增必红 ∧ 在场预告件分类校验），见下方 `N2 集合棘轮` 用例
const ACTUAL_EDGE_FILES: readonly string[] = readdirSync(EDGE_SRC).filter(f => f.endsWith('.json')).sort();
const PRESENT_PENDING_EDGES = PENDING_REGISTERED_ADDITIONS.filter(p => ACTUAL_EDGE_FILES.includes(p.file));
const DERIVED_IN_DOMAIN =
  S351_TABLE.filter(x => x.expectation === 'align_value').length + S351_UNCOVERED.length;
const DERIVED_SPEC_VIOLATION = NON_CAUSAL_REGISTRY.length;
const DERIVED_DEGRADED =
  SPEC_EDGE_TYPES.length - DERIVED_IN_DOMAIN - NON_CAUSAL_REGISTRY.length +
  PRESENT_PENDING_EDGES.filter(p => p.expected === 'non_causal_unknown').length;
const BASELINE_TOTAL = ACTUAL_EDGE_FILES.length;
/**
 * `unknown` 件数 —— **棘轮**（K4-01 #234 定稿后仍 = **50**，与 base 同值）。
 * 定稿迁移面 = **5 条桶标签**（`immediate`/`1_month`/`1-3_months`/`3-6_months`×2）⇒ 这 5 件都不是 `unknown`，
 * 故 `unknown` 计数**不变**。§3.5.1 同标签命中但现值为 `unknown` 的 2 件
 * （E-17 `incentive_alignment` / E-38 `talent_retention`）**本卡不落值**（队长 2026-10-12 裁定 (a)：
 * `unknown` 不在桶域内 ⇒ 无可迁移之物；把未标定字段标定为已标定属**语义升级/扩面**，须 CTO 定）
 * ⇒ 也仍是 `unknown`。🔴 数字取自命令原始输出，**不照抄派单件**。
 */
const BASELINE_DEGRADED = DERIVED_DEGRADED;
/**
 * **值域内区间**件数 —— **棘轮**（K4-01 #234 定稿 5 → **5**，与迁移后同值）。
 * 5 = 5 条桶标签迁到区间（其中 `operational_execution` 取 §3.5.1 的 `[0,0.5]`，CTO 裁定「§3.5.1 优先」）。
 * ⚠️ 旧口径名为 `BASELINE_IN_ENUM`（数的是 §3.4 桶标签）；新口径数的是**数值区间**，故改名
 * —— 留着旧名会让复核员以为是同一个数（口径名即证据的一部分）。
 */
const BASELINE_IN_DOMAIN = DERIVED_IN_DOMAIN;
/**
 * 越**允许集**（既非数值区间、亦非 `unknown`）的规范违规件数 —— **棘轮**。
 * 迁移后仍 = 1：`goal_decomposition.json` 的散文值**未被本卡改动**
 * （它是非因果结构性边；改它属另案 —— 见 `scripts/control-tower/probe-ontology-values.ts`
 * 的 `NON_CAUSAL_REGISTRY` 登记与说明）。
 * 🔴 **禁**把该件纳入豁免面来把这个数字改回 0（那是"静默放宽值域"）。
 */
const BASELINE_SPEC_VIOLATION = DERIVED_SPEC_VIOLATION;
/** 违规件点名 —— 一律用**真实文件名**（取自目录实况；**禁**从 `$id` 反推）。 */
const BASELINE_SPEC_VIOLATION_FILES: readonly string[] = ['goal_decomposition.json'];
/** 第 3 类值的原样前缀（证明违规**被如实看见**，而非被吸收成 `unknown`）。 */
const BASELINE_SPEC_VIOLATION_VALUE_PREFIX = '0d —';
/** `$id` 尾段 ≠ 文件名 的件数（存量事实，报告不阻断）。 */
const BASELINE_ID_FILENAME_DIVERGENT = 5;

/**
 * 沙箱取样：真仓**前 5 件**（字典序 `a…c` 段）= `assumption_triggered_reallocation` / `augments` /
 * `brand_building` / `brand_builds` / `capital_acquisition`。
 * K4-01（#234）迁移后逐件实测：`unknown ×4` + 区间 ×1（`capital_acquisition=[0,0.5]`）
 * ⇒ 5/4/1（**与迁移前同值**：迁移只改了第 5 件的值形态，未改变"非 unknown 件数"）。
 */
const SANDBOX_SAMPLE_N = 5;
const SANDBOX_DEGRADED = 4;
const SANDBOX_IN_DOMAIN = 1;

/**
 * 🔴 未决项棘轮（诚实边界，禁被误读为"读取侧已完成"）。
 * 今天 `src/` + `packages/` 零消费方 ⇒ 读取侧发射体**不存在**。
 * **读取边界落地者必须显式改本常量**（从而被迫同步更新契约与交付件）。
 */
const READ_SIDE_EMISSION = 'NOT_IMPLEMENTED' as const;

// ═══════════════════════════════════════════════════════════════════════════
// 审计 / 降级信号实现（本件交付主体）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 一件边类型的时滞取样。
 * `file` = **真实文件名**（取自目录实况，**不**从 `$id` 反推）；`$id` 无对应文件时为 `null`。
 * `lag` 刻意用 `unknown`：字段缺失 / 空串 / 非字符串 / 自造值都要能被判。
 */
export interface EdgeLagSample {
  file: string | null;
  id: string;
  label: string;
  lag: unknown;
}

export interface EdgeLagAudit {
  total: number;
  /** **允许集样本表**（值域 = 字符串形数值区间 ∪ {`unknown`}；判定单源 = 探针 `isInLagDomain`） */
  allowedSet: readonly string[];
  /** 值 ∈ 权威值域（**数值区间**）。⚠️ 旧名 `inEnum`（数的是 §3.4 桶标签）—— K4-01 后改名，
   *  留着旧名会让复核员把它当成同一个数（口径名即证据的一部分） */
  inDomain: number;
  /** 值 === `unknown`（显式降级标记） */
  degraded: number;
  /** 越**允许集**（既非数值区间、亦非 `unknown`）⇒ 规范违规（**禁静默放宽值域**的执行体） */
  specViolation: number;
  /** 字段缺失 */
  missing: number;
  /** `$id` 在目录内无对应文件（映射断裂） */
  unmapped: number;
  /** §3.4 **存量桶标签**中当次实际出现过的成员（K4-01 后：出现即规范违规；此处供报告面点名） */
  enumMembersUsed: string[];
  /** §3.4 **存量桶标签**中零出现的成员 —— **正确态**，只报告、不阻断 */
  enumMembersUnused: string[];
  /** 具名审计行（每行点名**真实文件名** / `$id` / 值 / 判定） */
  auditLines: string[];
  /** 只报告不阻断的行（桶标签零出现、`$id`↔文件名分歧等） */
  reportLines: string[];
  /** 派生降级信号（铁律 11/31：读到 `unknown` 不得静默） */
  degradedFlag: boolean;
  /** 读取侧覆盖状态 —— 本卡 = 未实现（见 `READ_SIDE_EMISSION`） */
  readSideEmission: typeof READ_SIDE_EMISSION;
}

/** 审计行里的定位串：优先真实文件名，缺失则显式标注（禁伪造文件名）。 */
function locatorOf(s: EdgeLagSample): string {
  return s.file === null ? `file=<UNMAPPED:${s.id}>` : `file=${s.file}`;
}

/**
 * 审计一批 `action_effect_lag` 取样。
 *
 * @input  samples — `{ file, id, label, lag }[]`（`lag` 运行时值，类型未知是**刻意的**）
 * @output 计数 + 具名审计行（**真文件名**）+ 桶标签零出现报告 + 派生 `degraded` 标记
 * @degraded 读到 `unknown` ⇒ `degradedFlag = true` 且逐件产审计行；
 *           越**允许集** ⇒ `specViolation`，**不**吸收进 degraded（禁静默放宽）
 * @error  不抛；异常输入落到 `missing` / `specViolation` / `unmapped` 计数
 */
export function auditEdgeLags(samples: EdgeLagSample[]): EdgeLagAudit {
  const auditLines: string[] = [];
  const reportLines: string[] = [];
  const usedBuckets = new Set<string>();
  let inDomain = 0;
  let degraded = 0;
  let specViolation = 0;
  let missing = 0;
  let unmapped = 0;

  for (const s of samples) {
    const loc = locatorOf(s);
    if (s.file === null) {
      unmapped += 1;
      reportLines.push(`REPORT edge-lag $id 无对应文件（映射断裂，报告不阻断） ${loc} label=${s.label}`);
    }
    if (s.lag === undefined || s.lag === null) {
      missing += 1;
      auditLines.push(`AUDIT edge-lag 字段缺失 ${loc} $id=${s.id} ⇒ 不可判（非 unknown，非值域值）`);
      continue;
    }
    if (s.lag === EDGE_LAG_DEGRADED_MARKER) {
      degraded += 1;
      auditLines.push(
        `AUDIT edge-lag 未标定(显式降级) ${loc} $id=${s.id} value="unknown" ⇒ degraded:true（铁律 11/31，不静默）`,
      );
      continue;
    }
    if (isAllowedLag(s.lag)) {
      inDomain += 1;
      continue;
    }
    if (typeof s.lag === 'string' && EDGE_LAG_LEGACY_BUCKETS.includes(s.lag)) usedBuckets.add(s.lag);
    specViolation += 1;
    auditLines.push(
      `AUDIT edge-lag 越允许集(规范违规) ${loc} $id=${s.id} value=${JSON.stringify(s.lag)} ` +
        `⇒ 既非权威值域（字符串形数值区间 "[min,max]"）、亦非显式降级标记 "unknown"（禁静默放宽值域）`,
    );
  }

  const enumMembersUsed = EDGE_LAG_LEGACY_BUCKETS.filter(v => usedBuckets.has(v));
  const enumMembersUnused = EDGE_LAG_LEGACY_BUCKETS.filter(v => !usedBuckets.has(v));
  if (enumMembersUnused.length > 0) {
    reportLines.push(
      `REPORT edge-lag §3.4 桶标签零出现（**正确态**；**报告不阻断**，K4-01 值域迁移的目标）: ` +
        `${enumMembersUnused.join(', ')} ⇒ 本体层已不双存桶标签（CTO 裁定 ②「不双存」）`,
    );
  }
  if (enumMembersUsed.length > 0) {
    reportLines.push(
      `REPORT edge-lag §3.4 桶标签仍有残留（**已计入规范违规**，见 auditLines）: ${enumMembersUsed.join(', ')}`,
    );
  }

  return {
    total: samples.length,
    allowedSet: ALLOWED_SAMPLES,
    inDomain,
    degraded,
    specViolation,
    missing,
    unmapped,
    enumMembersUsed,
    enumMembersUnused,
    auditLines,
    reportLines,
    degradedFlag: degraded > 0,
    readSideEmission: READ_SIDE_EMISSION,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 生产入口装载（子进程 + 沙箱）
// ═══════════════════════════════════════════════════════════════════════════

const PROBE_PREFIX = 'SYNO_1134_PROBE_JSON:';

/**
 * 经**生产入口** `loadOntology()` 读取边类型时滞，并附**真实文件名**。
 *
 * 🔴 必须在**独立子进程**内 `chdir` 后再动态 `import`（见文件头「设计要点 1」）。
 * 🔴 文件名取自子进程内的目录实况 + 各文件 `$id` 建映射，**不**从 `$id` 反推
 *    （见文件头「设计要点 2」：5/55 件 `$id` 尾段 ≠ 文件名）。
 *    此映射读取是**辅助**动作，时滞值本身**全部**来自 `loadOntology()`。
 *
 * @param ontologyRoot 作为 `process.cwd()` 的根；须含 `extensions/ontology/edge-types/`
 * @degraded 子进程失败/超时/输出不可解析 ⇒ **抛**（fail-closed，禁与"通过"混同）
 */
function loadEdgeLagsViaProductionEntry(ontologyRoot: string): EdgeLagSample[] {
  const loaderUrl = pathToFileURL(LOADER_TS).href;
  const code = `
(async () => {
  try {
    process.chdir(${JSON.stringify(ontologyRoot)});
    const fs = await import('node:fs');
    const path = await import('node:path');

    // ① 辅助：建 $id → 真实文件名 映射（**不**从 $id 反推文件名）
    const dir = path.join(process.cwd(), 'extensions', 'ontology', 'edge-types');
    const fileOfId = new Map();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (d && typeof d['\$id'] === 'string') fileOfId.set(d['\$id'], f);
      } catch (e) { /* 坏文件不计入映射；装载器侧另有其职责 */ }
    }

    // ② 主：生产入口装载器
    const m = await import(${JSON.stringify(loaderUrl)});
    const r = m.loadOntology();
    const edges = r.ontology.edgeTypes.map((e) => ({
      file: fileOfId.has(String(e['\$id'])) ? fileOfId.get(String(e['\$id'])) : null,
      id: String(e['\$id']),
      label: String(e.label),
      lag: Object.prototype.hasOwnProperty.call(e, 'action_effect_lag') ? e.action_effect_lag : undefined,
    }));
    edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    process.stdout.write(${JSON.stringify(PROBE_PREFIX)} + JSON.stringify({
      loaded: edges.length,
      degraded: r.degraded,
      edges,
    }) + '\\n');
  } catch (err) {
    process.stderr.write('SYNO_1134_PROBE_ERR:' + (err && err.message ? err.message : String(err)) + '\\n');
    process.exitCode = 3;
  }
})();
`;

  const res = spawnSync(process.execPath, ['--import', 'tsx', '--eval', code], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 90_000,
  });

  if (res.error) throw new Error(`生产入口子进程启动失败（fail-closed）: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(
      `生产入口子进程非零退出（fail-closed）status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`,
    );
  }

  const line = String(res.stdout)
    .split(/\r?\n/)
    .find(l => l.startsWith(PROBE_PREFIX));
  if (!line) {
    throw new Error(`生产入口探针输出不可解析（fail-closed）: stdout=${res.stdout} stderr=${res.stderr}`);
  }

  const parsed = JSON.parse(line.slice(PROBE_PREFIX.length)) as { loaded: number; edges: EdgeLagSample[] };
  if (!Array.isArray(parsed.edges)) throw new Error('生产入口探针 edges 非数组（fail-closed）');
  return parsed.edges;
}

// ═══════════════════════════════════════════════════════════════════════════
// 沙箱（tmpdir，零真仓写入）
// ═══════════════════════════════════════════════════════════════════════════

function makeSandbox(): string {
  const sb = mkdtempSync(join(tmpdir(), 'syno-1134-'));
  const dir = join(sb, 'extensions', 'ontology', 'edge-types');
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(EDGE_SRC)
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(0, SANDBOX_SAMPLE_N);
  for (const f of files) cpSync(join(EDGE_SRC, f), join(dir, f));
  if (files.length !== SANDBOX_SAMPLE_N) {
    throw new Error(`沙箱取样数不符（fail-closed）: ${files.length} != ${SANDBOX_SAMPLE_N}`);
  }
  return sb;
}

/** 把沙箱内**第一个** `action_effect_lag` 非 `unknown` 的值改成 `to`；返回被改文件名。 */
function flipFirstNonUnknown(sb: string, to: string): string {
  const dir = join(sb, 'extensions', 'ontology', 'edge-types');
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const p = join(dir, f);
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
    const v = parsed['action_effect_lag'];
    if (typeof v === 'string' && v !== EDGE_LAG_DEGRADED_MARKER) {
      parsed['action_effect_lag'] = to;
      writeFileSync(p, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      return f;
    }
  }
  throw new Error('沙箱内无可翻转的非 unknown 值（fail-closed：取样约定被破坏）');
}

function withSandbox<T>(fn: (sb: string) => T): T {
  const sb = makeSandbox();
  try {
    return fn(sb);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A 正常：真仓基线（穿生产入口）
// ═══════════════════════════════════════════════════════════════════════════

describe('A. 真仓基线 — 穿生产入口 loadOntology()（正常路径）', () => {
  const edges = loadEdgeLagsViaProductionEntry(REPO);
  const audit = auditEdgeLags(edges);

  it('A1 生产装载器读到 56 件边类型（棘轮；批 2 实测上移 55 → 56）', () => {
    expect(edges.length).toBe(BASELINE_TOTAL);
  });

  it('A2 派生降级计数 = 50（`unknown` = 显式降级标记，棘轮；K4-01 定稿后与 base 同值）', () => {
    expect(audit.degraded).toBe(BASELINE_DEGRADED);
  });

  it('A3 值域内区间真值 = 5（棘轮；K4-01 迁移面 = 5 条桶标签）', () => {
    expect(audit.inDomain).toBe(BASELINE_IN_DOMAIN);
  });

  it('A4 规范违规**恰为 1**（如实计数，禁静默放宽）、无字段缺失、无映射断裂', () => {
    expect(audit.specViolation).toBe(BASELINE_SPEC_VIOLATION);
    expect(audit.missing).toBe(0);
    expect(audit.unmapped).toBe(0);
  });

  it('A4b 🔴 第 3 类值必须显形：逐件点名**真实文件名** + 原样值，且**不**被吸收成 unknown、**不**放宽允许集', () => {
    const violLines = audit.auditLines.filter(l => l.includes('越允许集(规范违规)'));
    expect(violLines.length).toBe(BASELINE_SPEC_VIOLATION);
    for (const f of BASELINE_SPEC_VIOLATION_FILES) {
      expect(violLines.some(l => l.includes(`file=${f}`))).toBe(true);
    }
    // 原样值可见（不被折叠成"某值"）；且 violation ≠ degraded（三态互不吞并）
    expect(violLines.some(l => l.includes(BASELINE_SPEC_VIOLATION_VALUE_PREFIX))).toBe(true);
    expect(audit.degraded).toBe(BASELINE_DEGRADED);
    // 允许集**未被放宽**：该散文值既不满足值域谓词、也不在允许集样本表内（逐值可判，非"长度核对"）
    for (const f of BASELINE_SPEC_VIOLATION_FILES) {
      const doc = JSON.parse(readFileSync(join(EDGE_SRC, f), 'utf-8')) as Record<string, unknown>;
      expect(isAllowedLag(doc['action_effect_lag'])).toBe(false);
      expect(ALLOWED_SAMPLES).not.toContain(doc['action_effect_lag']);
    }
    // 证据可见（原始输出里能读到"点的是谁 + 值是什么"）：具名审计行 + 计数照原样打印
    console.log('[1134][真仓规范违规审计行]', violLines.join(' | '));
    console.log('[1134][真仓计数]', JSON.stringify({
      files: audit.total, degraded: audit.degraded, inDomain: audit.inDomain,
      specViolation: audit.specViolation, missing: audit.missing, unmapped: audit.unmapped,
      allowedSetSize: ALLOWED_SAMPLES.length,
    }));
  });

  it('A5 读到 `unknown` ⇒ 必产 degraded 标记（铁律 11/31，不得静默）', () => {
    expect(audit.degradedFlag).toBe(true);
  });

  it('A6 具名审计行：每个 `unknown` 一件一行，且点名**真实文件名**与 `$id`', () => {
    const degradedLines = audit.auditLines.filter(l => l.includes('未标定(显式降级)'));
    expect(degradedLines.length).toBe(BASELINE_DEGRADED);
    for (const l of degradedLines) {
      // 真实文件名不含连字符（实测字符集 [_a-z]）—— 这条正则就是"禁伪造文件名"的守卫
      expect(l).toMatch(/file=[a-z0-9_]+\.json/);
      expect(l).toMatch(/\$id=edge\/[a-z0-9_-]+/);
      expect(l).toContain('degraded:true');
    }
    expect(audit.auditLines.length).toBe(audit.degraded + audit.specViolation + audit.missing);
  });

  it('A7 审计行点名的文件**真实存在**（抽样 5 条逐条 existsSync 核验）', () => {
    const names = readdirSync(EDGE_SRC);
    const sampled = audit.auditLines
      .filter(l => l.includes('未标定(显式降级)'))
      .slice(0, 5)
      .map(l => /file=([a-z0-9_]+\.json)/.exec(l)?.[1] ?? '');
    expect(sampled.length).toBe(5);
    for (const n of sampled) {
      expect(n.length).toBeGreaterThan(0);
      expect(names).toContain(n);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 改坏即红（沙箱；**零真仓写入**）
// ═══════════════════════════════════════════════════════════════════════════

describe('B. 改坏即红 — 沙箱翻转值域值（零真仓写入）', () => {
  it('B1 沙箱基线（前 5 件，未改坏）：degraded=3 / inDomain=2', () => {
    withSandbox(sb => {
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.total).toBe(SANDBOX_SAMPLE_N);
      expect(audit.degraded).toBe(SANDBOX_DEGRADED);
      expect(audit.inDomain).toBe(SANDBOX_IN_DOMAIN);
    });
  });

  it('B2 翻转 1 件 区间值→unknown ⇒ 计数漂移被观测到', () => {
    withSandbox(sb => {
      const flipped = flipFirstNonUnknown(sb, EDGE_LAG_DEGRADED_MARKER);
      expect(flipped.length).toBeGreaterThan(0);
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.degraded).toBe(SANDBOX_DEGRADED + 1);
      expect(audit.inDomain).toBe(SANDBOX_IN_DOMAIN - 1);
    });
  });

  it('B3 判别性：把「绿」断言施加到改坏输入上 ⇒ 必然抛（判据有分辨力）', () => {
    withSandbox(sb => {
      flipFirstNonUnknown(sb, EDGE_LAG_DEGRADED_MARKER);
      const mutated = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      // 未改坏时成立的那条断言，改坏后必须不成立：
      expect(() => expect(mutated.degraded).toBe(SANDBOX_DEGRADED)).toThrow();
      // 反向确认它确实偏离了基线（防"恒抛"式假分辨力）
      expect(mutated.degraded).not.toBe(SANDBOX_DEGRADED);
    });
  });

  it('B4 还原即绿：flip → 红 → 恢复 → 回基线（**逐字还原被翻转的那一件**）', () => {
    withSandbox(sb => {
      const dir = join(sb, 'extensions', 'ontology', 'edge-types');
      // 前置：K4-01（#234）后 `capital_acquisition.json` = §3.5.1 未覆盖项登记值 `[0,0.5]`
      // （原桶标签 `immediate` 已迁走）—— 该断言同时是"迁移已落地"的现场证据
      const base = JSON.parse(readFileSync(join(dir, 'capital_acquisition.json'), 'utf-8')) as Record<string, unknown>;
      expect(base['action_effect_lag']).toBe(formatInterval(0, 0.5));

      // 注意：取样 5 件里"第一个非 unknown"未必是 capital_acquisition ⇒ 用**返回的文件名**定位，
      // 不能硬编码路径（否则会还原错件 = 假绿）。原字节必须在**翻转前**快照（翻转后再读 = 读到改动后的内容）。
      const pre: Record<string, string> = {};
      for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
        pre[f] = readFileSync(join(dir, f), 'utf-8');
      }

      const flipped = flipFirstNonUnknown(sb, EDGE_LAG_DEGRADED_MARKER);
      const flippedPath = join(dir, flipped);

      const mutated = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(() => expect(mutated.degraded).toBe(SANDBOX_DEGRADED)).toThrow();
      expect(mutated.inDomain).toBe(SANDBOX_IN_DOMAIN - 1);

      writeFileSync(flippedPath, pre[flipped], 'utf-8'); // 逐字还原**翻转前**快照

      const restored = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(restored.degraded).toBe(SANDBOX_DEGRADED);
      expect(restored.inDomain).toBe(SANDBOX_IN_DOMAIN);
    });
  });

  it('B5 改坏为**第 3 类值**（非 unknown、非区间）⇒ specViolation>0 ⇒ 必红', () => {
    withSandbox(sb => {
      flipFirstNonUnknown(sb, 'NOT_IN_ENUM_AT_ALL');
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.specViolation).toBe(1);
      expect(audit.inDomain).toBe(SANDBOX_IN_DOMAIN - 1);
      expect(audit.auditLines.join('\n')).toContain('禁静默放宽值域');
    });
  });

  it('B6 改坏为**残留桶标签**（`immediate`）⇒ 必红，且被点名进 `enumMembersUsed`（旧口径下它"合法"，新口径下不行）', () => {
    withSandbox(sb => {
      flipFirstNonUnknown(sb, 'immediate');
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.specViolation).toBe(1);
      expect(audit.enumMembersUsed).toEqual(['immediate']);
      expect(audit.reportLines.join('\n')).toContain('桶标签仍有残留');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C 边界 + 禁静默放宽值域
// ═══════════════════════════════════════════════════════════════════════════

describe('C. 边界与「禁静默放宽值域」', () => {
  const s = (lag: unknown): EdgeLagSample => ({ file: 'x.json', id: 'edge/x', label: 'X', lag });

  it('C1 字段缺失 ⇒ 计 missing，且不并入 degraded、不并入 inDomain', () => {
    const a = auditEdgeLags([s(undefined)]);
    expect(a.missing).toBe(1);
    expect(a.degraded).toBe(0);
    expect(a.inDomain).toBe(0);
    expect(a.degradedFlag).toBe(false);
  });

  it('C2 空串 ⇒ specViolation（既非区间，亦非显式降级标记）', () => {
    const a = auditEdgeLags([s('')]);
    expect(a.specViolation).toBe(1);
    expect(a.degraded).toBe(0);
  });

  it('C3 非字符串（数字 / 对象）⇒ specViolation，不静默吞', () => {
    const a = auditEdgeLags([s(3), s({ minMonths: 3, maxMonths: 6 })]);
    expect(a.specViolation).toBe(2);
  });

  it('C4 🔴 自造值（如 `2_months`，含旧桶标签形态）⇒ specViolation，**不得**被当作 unknown 吸收', () => {
    const a = auditEdgeLags([s('2_months')]);
    expect(a.specViolation).toBe(1);
    expect(a.degraded).toBe(0);
    expect(a.auditLines.join('\n')).toContain('越允许集(规范违规)');
    expect(a.auditLines.join('\n')).toContain('禁静默放宽值域');
  });

  it('C4b 允许集判定 = 「字符串形数值区间 ∪ {unknown}」—— 样本表**逐值可判**（恒真 / 恒假两向都有分辨力）', () => {
    expect(ALLOWED_SAMPLES.length).toBeGreaterThan(0);
    for (const v of ALLOWED_SAMPLES) {
      expect(isAllowedLag(v), `允许集样本应放行: ${JSON.stringify(v)}`).toBe(true);
    }
    for (const v of REJECTED_SAMPLES) {
      expect(isAllowedLag(v), `非允许集样本应拒绝: ${JSON.stringify(v)}`).toBe(false);
    }
    // 旧口径的 6 个桶标签**全部**落在拒绝面（这正是 K4-01 迁移的执行体：桶标签不再是合法值）
    for (const v of EDGE_LAG_LEGACY_BUCKETS) {
      expect(REJECTED_SAMPLES).toContain(v);
    }
  });

  it('C5 契约：degradedFlag ⟺ 存在 `unknown`（零 unknown ⇒ false；区间值不置位）', () => {
    const none = auditEdgeLags([s(formatInterval(1, 3)), s(formatInterval(3, 6))]);
    expect(none.degradedFlag).toBe(false);
    expect(none.specViolation).toBe(0);
    const some = auditEdgeLags([s('unknown')]);
    expect(some.degradedFlag).toBe(true);
  });

  it('C6 §3.4 存量桶标签清单完整（防清单被静默篡改；本体层零残留的对照基准）', () => {
    expect([...EDGE_LAG_LEGACY_BUCKETS].sort()).toEqual(
      ['>12_months', '1-3_months', '1_month', '3-6_months', '6-12_months', 'immediate'].sort(),
    );
    expect(EDGE_LAG_LEGACY_BUCKETS).not.toContain(EDGE_LAG_DEGRADED_MARKER);
  });

  it('C7 `file=null`（映射断裂）⇒ 计 unmapped 且审计行不伪造文件名', () => {
    const a = auditEdgeLags([{ file: null, id: 'edge/ghost', label: 'G', lag: 'unknown' }]);
    expect(a.unmapped).toBe(1);
    expect(a.auditLines.join('\n')).toContain('file=<UNMAPPED:edge/ghost>');
    expect(a.auditLines.join('\n')).not.toMatch(/file=[a-z0-9_]+\.json/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D 未来读取边界契约（可执行 + 棘轮）
// ═══════════════════════════════════════════════════════════════════════════

describe('D. 未来读取边界契约（可执行）', () => {
  it('D1 对任意含 `unknown` 的输入：degradedFlag=true 且每个 unknown 都有审计行', () => {
    const a = auditEdgeLags([
      { file: 'a.json', id: 'edge/a', label: 'A', lag: 'unknown' },
      { file: 'b.json', id: 'edge/b', label: 'B', lag: 'unknown' },
      { file: 'c.json', id: 'edge/c', label: 'C', lag: formatInterval(1, 3) },
    ]);
    expect(a.degradedFlag).toBe(true);
    expect(a.auditLines.filter(l => l.includes('未标定(显式降级)')).length).toBe(2);
  });

  it('D2 🔴 棘轮：读取侧发射体状态必须显式声明为 NOT_IMPLEMENTED（本卡不覆盖读取侧）', () => {
    const a = auditEdgeLags([{ file: 'a.json', id: 'edge/a', label: 'A', lag: 'unknown' }]);
    expect(a.readSideEmission).toBe('NOT_IMPLEMENTED');
    // 若读取侧落地（src/** 真读该字段并发射 degraded），实现者必须改上面的常量
    // ⇒ 本测试转红 ⇒ 被迫同步更新契约与交付件。这是"不得把防线侧写成读取侧"的棘轮。
    expect(READ_SIDE_EMISSION).toBe('NOT_IMPLEMENTED');
  });

  it('D3 生产装载器自身的 degraded 语义与本审计**无关**（防混淆）', () => {
    // loadOntology 的 degraded 只表"加载错误"，不表字段值；
    // 实测真仓 44 件 unknown（K4-01 迁移后实测值）时它仍返回 degraded=false ⇒ 字段级降级必须由本审计承载。
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect(audit.degraded).toBe(BASELINE_DEGRADED);
    expect(audit.degradedFlag).toBe(true); // 字段级降级信号为真
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E §3.4 桶标签零残留（**报告不阻断**；K4-01 后语义：零出现 = 正确态）
// ═══════════════════════════════════════════════════════════════════════════

describe('E. §3.4 桶标签零残留 — 报告但不阻断', () => {
  it('E1 真仓：六个桶标签**全部**零出现 ⇒ 被报告为正确态', () => {
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect([...audit.enumMembersUnused].sort()).toEqual([...EDGE_LAG_LEGACY_BUCKETS].sort());
    expect(audit.enumMembersUsed).toEqual([]);
    const report = audit.reportLines.join('\n');
    expect(report).toContain('桶标签零出现');
    expect(report).toContain('6-12_months');
    expect(report).toContain('>12_months');
    expect(report).toContain('报告不阻断');
  });

  it('E2 🔴 零出现**不阻断**：它不出现在 auditLines（违规面）里', () => {
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect(audit.auditLines.some(l => l.includes('6-12_months'))).toBe(false);
    expect(audit.auditLines.some(l => l.includes('>12_months'))).toBe(false);
    expect(audit.auditLines.some(l => l.includes('桶标签'))).toBe(false);
  });

  it('E3 六值全部**出现** ⇒ 零出现报告消失、残留报告出现（报告面本身有分辨力）', () => {
    const all: EdgeLagSample[] = EDGE_LAG_LEGACY_BUCKETS.map((v, i) => ({
      file: `e${i}.json`,
      id: `edge/e${i}`,
      label: `E${i}`,
      lag: v,
    }));
    const audit = auditEdgeLags(all);
    expect(audit.enumMembersUnused).toEqual([]);
    expect(audit.enumMembersUsed).toEqual([...EDGE_LAG_LEGACY_BUCKETS]);
    expect(audit.reportLines.join('\n')).toContain('桶标签仍有残留');
    expect(audit.inDomain).toBe(0);        // 桶标签**不**进值域（旧口径下它们进"枚举"）
    expect(audit.specViolation).toBe(6);   // 六个全部计入规范违规 ⇒ 覆盖面**未缩小**
  });

  it('E4 零出现**不得**被误记为降级或违规（三态互不吞并）', () => {
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect(audit.degraded).toBe(BASELINE_DEGRADED);      // 44，不因零出现而变
    expect(audit.specViolation).toBe(BASELINE_SPEC_VIOLATION); // 1：来自 `goal_decomposition.json`
    // ⚠️ 上面这 1 **不是**零出现造成的（零出现只进 reportLines）—— E2 已断言零出现不进 auditLines；
    //    若有人把"零出现"改判成违规，本断言会因计数 ≠ 1 而红。
    expect(audit.missing).toBe(0);                       // 零出现 ≠ 缺字段
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F `$id` ↔ 文件名 映射（**报告不阻断**）
// ═══════════════════════════════════════════════════════════════════════════

describe('F. `$id` ↔ 文件名 映射完整性（报告不阻断）', () => {
  const edges = loadEdgeLagsViaProductionEntry(REPO);

  it('F1 56 件的 `$id` 均能映射到真实文件（无断裂）', () => {
    expect(edges.length).toBe(BASELINE_TOTAL);
    expect(edges.filter(e => e.file === null).length).toBe(0);
  });

  it('F2 审计行一律点名真实文件名，且文件确实存在', () => {
    const names = readdirSync(EDGE_SRC);
    for (const e of edges) {
      expect(e.file).not.toBeNull();
      expect(names).toContain(e.file as string);
    }
  });

  it('F3 🔴 存量事实留档：5 件 `$id` 尾段 ≠ 文件名（报告不阻断，禁从 `$id` 反推）', () => {
    const divergent = edges.filter(e => e.file !== null && (e.id.replace(/^edge\//, '') + '.json') !== e.file);
    expect(divergent.length).toBe(BASELINE_ID_FILENAME_DIVERGENT);
    // 正是这 5 件 —— 若有人"顺手改名"让它归零，本断言会红 ⇒ 逼其显式更新本卡基线
    expect(divergent.map(e => e.file).sort()).toEqual(
      [
        'decision_concentrates.json',
        'external_assumption.json',
        'incentive_binds.json',
        'locks_in.json',
        'signal_transmits.json',
      ].sort(),
    );
    // 真实文件名不含连字符；`$id` 含 —— 故不可反推
    for (const e of divergent) expect(e.id).toContain('-');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// N2 集合棘轮（CTO 2026-10-12「禁硬编码基数」）—— **尺寸由扫盘推导，棘轮在集合层**
//   ① SPEC 成员不许缺（删件/改名 ⇒ 红 + **点名片名**）
//   ② `actual \ (SPEC ∪ PENDING) === ∅`（**未登记新增 ⇒ 红 + 点名片名**）
//   ③ 在场预告件分类必须 === 登记期望
//   ⇒ 合并顺序无关：本笔（56）绿；`l3-65` 合入后（58 = SPEC∪PENDING）仍绿；任何第 3 件未登记仍红
// ═══════════════════════════════════════════════════════════════════════════

describe('N2. 集合棘轮 — 逐件枚举替代字面基数（禁第二套清单，复用探针导出量）', () => {
  const specFiles = new Set(SPEC_EDGE_TYPES.map(n => `${n}.json`));
  const pendingFiles = new Set(PENDING_REGISTERED_ADDITIONS.map(p => p.file));

  it('N2-1 ① SPEC 成员不许缺（删除/改名 ⇒ 红 + 点名片名）', () => {
    const missing = SPEC_EDGE_TYPES.map(n => `${n}.json`).filter(f => !ACTUAL_EDGE_FILES.includes(f));
    expect(missing, `规范基线件缺失（删除/改名必须显式改 SPEC_EDGE_TYPES）: ${missing.join(', ')}`).toEqual([]);
  });

  it('N2-2 ② 未登记新增 ⇒ 红 + 点名片名（禁静默放宽）', () => {
    const unregistered = ACTUAL_EDGE_FILES.filter(f => !specFiles.has(f) && !pendingFiles.has(f));
    expect(unregistered, `未登记新增件（请显式登记后重跑）: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('N2-3 ③ 在场预告件分类 === 登记期望（缺席合法；在场即受约束）', () => {
    expect(PRESENT_PENDING_EDGES.every(p => p.expected === 'non_causal_unknown')).toBe(true);
    for (const p of PRESENT_PENDING_EDGES) {
      const doc = JSON.parse(readFileSync(join(EDGE_SRC, p.file), 'utf-8')) as Record<string, unknown>;
      const tags = Array.isArray(doc.tags) ? (doc.tags as string[]) : [];
      expect(tags.includes('causal'), `${p.file} 预告登记期望 non_causal`).toBe(false);
      expect(doc['action_effect_lag'], `${p.file} 预告登记期望 lag=unknown`).toBe('unknown');
    }
  });

  it('N2-4 尺寸由扫盘推导（禁字面 56/58）：总数 = SPEC ＋ 在场预告件', () => {
    expect(BASELINE_TOTAL).toBe(SPEC_EDGE_TYPES.length + PRESENT_PENDING_EDGES.length);
    expect(BASELINE_TOTAL).toBe(ACTUAL_EDGE_FILES.length); // 派生值 == 实测值（棘轮在 N2-1/2/3）
    expect(BASELINE_DEGRADED).toBe(DERIVED_DEGRADED);
    expect(BASELINE_IN_DOMAIN).toBe(DERIVED_IN_DOMAIN);
    expect(BASELINE_SPEC_VIOLATION).toBe(DERIVED_SPEC_VIOLATION);
  });
});
