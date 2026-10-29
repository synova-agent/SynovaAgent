#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-m6-determinism.ts — C3 同资料两次一致 ＋ 改坏必红（#708 / 规格-1158 §4 C3）
 *
 * 【一句话】把「同一份内容跑两次，结果逐字相同」「把内容改坏一处，结果必不同，还原后回到原值」
 * 变成一条命令：**两个独立子进程**真跑哨兵 → canonical 投影 → sha256；父进程只做三件事：
 * 比 RUN-1/RUN-2、比 mutate 与**改坏前 golden sha**、比 restore 回 golden。三态退出码 0/1/2。
 *
 * 【为什么存在（红B A-M6 C3 口径）】M6 三条不可妥协之一＝「同资料两次一致 ＋ 改坏必红」。
 * 没有本件时，"可复现"只能靠人肉两次跑再肉眼比 —— 且**改坏必红**从未被机器证明过。
 *
 * 【设计哲学】一个分离 ＋ 两条承诺：
 *   · 一个分离：**取数 与 判定 分离** —— 子进程只负责"真跑一次并给出 canonical sha"（不问对错），
 *     父进程只负责"比 sha"（不重算业务值）；两侧都不写仓库。
 *   · 承诺 1「变更是改代码」：mutate 是**改副本源码 1 处语义常量**，所以必须与**改坏前 golden sha（h1）**
 *     比；拿"两次跑同一份改坏代码"互比永远不会红（v2 修正的关键，v1 缺陷）。
 *   · 承诺 2「剔除要说得出理由」：逐次变化的字段一律**白名单投影**剔除，且逐条写清出处与理由；
 *     剔除清单变了 = 判据语义变了 ⇒ 必须改本文件头（禁悄悄扩大剔除面）。
 *
 * 判据来源（§4 C3 逐字，不得改）:
 *   正常  `--case main` ⇒ 四相位行齐全 ⇒ exit 0 ／ `RESULT=PASS`
 *         `[RUN-1] sha256=<h1>` ＋ `[RUN-2] sha256=<h1>`
 *         `[MUTATE] 副本 computes/compute-agent-deployment-maturity.ts 改 1 处权重常量 ⇒ sha256=<h2>；h2≠h1`
 *         `[RESTORE] 副本还原 ⇒ sha256=<h1>` ＋ `[COMPARE] twice=EQUAL mutate=DIFF restore=EQUAL`
 *   反例（**内含于 main**，不单列 case） `h2 === h1` ⇒ exit 1（改坏没被抓到 = 判据无牙齿）
 *   降级  夹具根建不起来／子进程非 0／超时 ⇒ stderr 一行 `degraded: <原因>` ＋ exit 2
 *   参数  `--case` 缺省/未知 ⇒ exit 2；`--all` 仅主用例
 *
 * canonical 投影（**唯一比较口径**，键排序后 JSON）:
 *   { findings: [{id, severity, polarity, title, description, evidence, suggestion}],
 *     metrics:  [{metricId, value, unit, sourceId}],
 *     degraded: boolean }
 *
 * 剔除清单（逐条出处 ＋ 理由；**白名单投影**天然剔除其余字段）:
 *   | 字段         | 出处                                  | 为什么必须剔 |
 *   | detectedAt   | src/sentinel/types.ts:61（SentinelFinding） | 每次 aggregate 内 `new Date()` ⇒ 逐跑不同 |
 *   | checkedAt    | src/sentinel/types.ts:83（SentinelCheckResult） | loader wrapper 每跑 `new Date()` ⇒ 逐跑不同 |
 *   | durationMs   | src/sentinel/types.ts:81              | 实测耗时，随机器负载抖动 |
 *   | runId        | src/sentinel/sentinel-loader.ts:315   | `Date.now()+Math.random()` ⇒ 每次不同 |
 *   | computedAt   | 29 个 compute 内（P16 实测）           | 部分 compute 输出带计算时刻 ⇒ 逐跑不同 |
 *   | 其余未知字段 | 如 status/relatedNodeId/inputDigest/evidenceRef/observedAt | 非判据字段；白名单外 ⇒ 不参与比较 |
 *
 * 夹具（**只读仓库 extensions/**；L1 批准偏离后只复制 1 个哨兵）:
 *   根 = `os.tmpdir()/m6-c3-<pid>/`，布局：
 *     <root>/extensions/sentinels/agent-deployment-maturity/{manifest.json,aggregate.ts,computes/…}
 *     <root>/src  ⇒ junction 指向仓库 `src`（Win `'junction'`／POSIX `'dir'`）
 *     SENTINELS_FIXTURE_DIR = <root>/extensions/sentinels（缝：src/sentinel/sentinel-loader.ts:51/:56）
 *   ⚠️ **布局比规格字面多一层 `extensions/`**（实现细节，不动判据）：aggregate.ts 里
 *      `../../../src/sentinel/types`（3 层）与 compute 里 `../../../../src/...`（4 层）只有在
 *      "<root>/extensions/sentinels/<name>/…" 这个深度才解析到 <root>/src；若把 `sentinels/` 直接放
 *      根下，导入会落到 `os.tmpdir()/src`（全局污染，且与其它进程打架）。
 *   夹具图与 ctx **写死**（不写 ⇒ aggregate 走 empty-read 分支 ⇒ compute 根本不跑 ⇒ mutate 假红）：
 *     store.queryNodes(type) ⇒ `Agent`×1 `{id:'a1',props:{monitored:true}}` ＋ `Tool`×1 `{id:'t1',props:{error:false}}`
 *     ctx = `{ db: store, graphStore: store, metricSink, now: new Date(), teamId: 'probe-c3-<pid>' }`
 *     DB   = `better-sqlite3(':memory:')` ＋ `reconcileSchema`（src/store/schema-migration.ts:137）
 *     ⇒ 确定性分值 0.66（`0.3*0.5 + 0.3*1 + 0.2*1 + 0.2*(1/20)`）；改权重 0.3→0.35 ⇒ 0.69
 *
 * 超时策略（写进文件头，禁"无界等"）: 每个子进程 `spawnSync` 硬超时 **120s**
 *   （含 tsx 冷启动 + 动态 import + :memory: 建表；实测单次 ~2–4s）。超时 ⇒ `CHILD_TIMEOUT` ⇒ degraded/exit 2。
 *   父进程不做重试：**重试会掩盖不确定性**（本件判的就是确定性）。
 *
 * 契约（铁律 47 / 探针统一契约）:
 *   @input
 *     --case main      四相位（RUN-1/RUN-2/MUTATE/RESTORE）一次跑完（缺省 ⇒ exit 2）
 *     --all            仅主用例（C3 反例内含于 MUTATE 相位，不单列 case）
 *     --child-run      **子协议**：子进程模式；需环境 `SENTINELS_FIXTURE_DIR`（父传入）
 *     --help           用法（含本规则与剔除清单）
 *     环境：SYNO_REPO_ROOT（仓库根；缺省自 cwd 上溯）
 *           SENTINELS_FIXTURE_DIR（子进程夹具扫描根；父进程设置，子进程只读）
 *           SYNO_GATE_DEGRADED_LOG（降级事件日志；缺省 `.synova-out/m6-1158/degraded-events.log`）
 *   @output
 *     父（主用例）：`PROBE …` ＋ `[FIXTURE] …` ＋ `[RUN-1] sha256=<h1>` ＋ `[RUN-2] sha256=<h1>`
 *       ＋ `[MUTATE] … ⇒ sha256=<h2>；h2≠h1（[EXPECTED-RED]）` ＋ `[RESTORE] … ⇒ sha256=<h1>`
 *       ＋ `[COMPARE] twice=EQUAL mutate=DIFF restore=EQUAL` ＋ `[CLEANUP] …`
 *       ＋ `COVERAGE: …` ＋ **末行** `RESULT=<PASS|FAIL|ERROR>`
 *     子（`--child-run`）：stdout **只一行** `{"sha256":"<hex64>"}`（canonical 投影），exit 0；
 *       失败 ⇒ stderr `child-failed: <CODE> <原因>` ＋ exit 2（不吐半行 JSON）
 *   @exit  0 = 三比全绿（twice=EQUAL ∧ mutate=DIFF ∧ restore=EQUAL）
 *          1 = 比较红（两次不一致 / 改坏没被抓到 / 还原未回 golden）——判据真红
 *          2 = 检查自身失败（夹具根建不起来 / 子进程非 0 或超时或协议违规 / 参数 / 仓库根）
 *   @degraded  stderr 一行 `degraded: <原因> [code=<CODE>]` ＋ 追加 JSON 到 `SYNO_GATE_DEGRADED_LOG`
 *              （字段 time/component/code/phase/retryable，口径同 probe-line-signals.ts:224）＋ exit 2
 *   @authority 任何会话可调（**只读仓库**）；它**不改仓库 extensions/**、不做 git 操作、不判"通过"**——
 *              唯一产出＝三比结论 ＋ 三态退出码。判定"通过"归 L1 收件闸 ＋ K3。
 *   @cross_platform Node ≥ 20（本机 v24.16.0）；junction 用 `'junction'`（Win）／`'dir'`（POSIX）；
 *              stdout/stderr 强制 UTF-8（D732）；只写 `os.tmpdir()` 与 gitignored 的 `.synova-out/`。
 *
 * 错误码（ProbeError：code/phase/retryable）:
 *   ARG_CASE_REQUIRED／UNKNOWN_CASE／MISSING_CASE_VALUE（args）｜REPO_ROOT_NOT_FOUND（bootstrap）
 *   FIXTURE_SOURCE_MISSING／FIXTURE_COPY_INCOMPLETE／FIXTURE_SYMLINK_FAILED／FIXTURE_MUTATION_ANCHOR（fixture）
 *   CHILD_ENV_MISSING／CHILD_FIXTURE_SCAN／CHILD_REGISTER_FAILED／CHILD_SPAWN_FAILED／CHILD_TIMEOUT
 *   ／CHILD_EXIT_NONZERO／CHILD_PROTOCOL_VIOLATION／CHILD_JSON_PARSE（child）｜UNEXPECTED（unknown）
 *
 * 结构（Source map）
 *   ① 头部契约（本块）        — 判据/投影/剔除清单/夹具/超时/错误码/已知限制
 *   ② 常量与环境              — 场景／哨兵与 metric ID／变异锚点／超时／UTF-8（D732）
 *   ③ canonical 投影（纯函数）— projectCanonical／stableStringify／sha256Hex／canonicalDigest
 *   ④ 变异（纯函数）          — mutateComputeSource（恰好 1 处；0/≥2 处 ⇒ 锚点漂移 ⇒ fail loud）
 *   ⑤ 夹具                    — createFixture（复制单哨兵 ＋ src junction）／cleanupFixture／夹具图
 *   ⑥ 出口层                  — 收敛 ProbeError／degrade（`degraded:`＋SYNO_GATE_DEGRADED_LOG）／usageText
 *   ⑦ 子进程                  — runChildMode（--child-run：扫描→注册→真跑→投影→一行 JSON）
 *                             ／runChildOnce（父侧：spawn＋超时＋协议校验）
 *   ⑧ main 编排               — 子协议短路 → repoRoot → --help → selectCases → 四相位 → 三态 exit
 *
 * 已知限制（Known Limitations）
 *   1. **只复制 1 个哨兵**（L1 批准偏离 2026-10-30）：夹具只含 `agent-deployment-maturity`，其余 45 项
 *      不参与；本件判的是"同一资料两次一致"这一**机制**，不是 46 项全量复现（全量另批）。
 *   2. **canonical 投影是白名单**：只比 findings(7 字段)/metrics(4 字段)/degraded。哨兵若新增**语义字段**
 *      （如 severity 变体、confidence），本件**不会**发现 ⇒ 新增字段时须同步改投影与本清单（判据变更走 L1）。
 *   3. **mutate 锚点 = `0.3 * autonomy`**（权重常量；规格指定改权重、禁改 cap 20→21——四舍五入后可能同值
 *      ⇒ 假红）。若哨兵源码改了该表达式，mutate 会 **fail loud（FIXTURE_MUTATION_ANCHOR / exit 2）**，
 *      而不是静默跳过或改成必然不同。
 *   4. **两次是"两个子进程"，不是两台机器/两个 node 版本**：本机 v24.16.0；node22 未复跑（#1158 U1）。
 *   5. 子进程内 `LOG_LEVEL=silent`（日志走 stderr 且静音，保证 stdout 只有一行 JSON）；
 *      这不是 mock —— 被测代码、夹具、注入缝全部为生产实现。
 *   6. 仓库 `extensions/**` 全程**只读**（cpSync 读源副本）；夹具根与 junction 全在 `os.tmpdir()`，
 *      `finally` 清理并核对"仓库 src 完好 / 仓库 manifest 仍在"（清理失败 ⇒ ERROR/exit 2，不静默）。
 *   7. 未接 CI（#1158 U2）；单次主用例含 4 个子进程（~10–20s），不进 `<1s` 门禁档。
 *   8. 与 C1（T2）／C2（T3）**并发不安全**：那两件运行期会增删/移走 `extensions/sentinels/`，
 *      本件复制夹具时可能读到半态 ⇒ 必须串行（锁口径同批 `.synova-out/m6-1158/.lock`）。
 *
 * 配对测试（B8 / CT-40）：tests/control-tower/probe-m6-determinism.test.ts
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SentinelCheckResult, SentinelContext } from '../../src/sentinel/types';
import {
  EXIT_BY_VERDICT,
  ProbeError,
  ProbeOutput,
  locateRepoRoot,
  parseProbeArgs,
} from './probe-ladder';

// ─── ② 常量与环境 ─────────────────────────────────────────────────────────────

/** 本探针标识（degraded log 的 component 字段）。 */
const COMPONENT = 'probe-m6-determinism';
/** 合法场景（`--case` 只认它；缺省/未知 ⇒ exit 2，不回落默认场景）。 */
export const KNOWN_CASES = ['main'] as const;
/** 场景名类型。 */
export type DeterminismCase = (typeof KNOWN_CASES)[number];
/** 被测哨兵（目录名 = manifest.name）。 */
export const SENTINEL_NAME = 'agent-deployment-maturity';
/** 被测哨兵在 registry 里的 id（`sentinel-<manifest.name>`，见 sentinel-loader.ts:250）。 */
export const SENTINEL_ID = `sentinel-${SENTINEL_NAME}`;
/** 被测指标（aggregate.ts 硬编码产出的 metricId）。 */
export const METRIC_ID = 'AGENT-DEPLOYMENT-MATURITY-SCORE';
/** 变异目标文件（相对哨兵目录）。 */
export const COMPUTE_REL = 'computes/compute-agent-deployment-maturity.ts';
/** 变异锚点：权重常量 `0.3 * autonomy` ⇒ `0.35 * autonomy`（规格指定改权重；**禁改 cap**）。 */
export const MUTATION_FROM = '0.3 * autonomy';
export const MUTATION_TO = '0.35 * autonomy';
/** 子进程硬超时（毫秒；见文件头「超时策略」）。 */
export const CHILD_TIMEOUT_MS = 120_000;

/** 场景常量（错误消息用）。 */
const CASES_TEXT = KNOWN_CASES.join('|');

// D732 UTF-8 强制（口径同 probe-line-signals.ts:142-151）：Windows 控制台/子进程统一 UTF-8。
process.env.PYTHONIOENCODING = 'utf-8';
if (!process.env.LC_ALL) process.env.LC_ALL = 'C.UTF-8';
try {
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
} catch (streamErr) {
  // ⓘ 走 stdout：stderr 的 `degraded:` 行必须唯一可判（同 C4 口径）。
  process.stdout.write(
    `ⓘ 降级：stdout/stderr 不支持 setDefaultEncoding（${streamErr instanceof Error ? streamErr.message : String(streamErr)}）` +
      '——Node 默认 utf8 输出不受影响\n',
  );
}

// ─── ③ canonical 投影（纯函数；唯一比较口径） ─────────────────────────────────

/** canonical finding（7 字段白名单）。 */
export interface CanonicalFinding {
  readonly id: string;
  readonly severity: string;
  readonly polarity: 'positive' | 'negative';
  readonly title: string;
  readonly description: string;
  readonly evidence: readonly string[];
  readonly suggestion: string;
}
/** canonical metric（4 字段白名单）。 */
export interface CanonicalMetric {
  readonly metricId: string;
  readonly value: number | null;
  readonly unit: string | null;
  readonly sourceId: string | null;
}
/** canonical 投影（比较口径；剔除清单见文件头）。 */
export interface CanonicalProjection {
  readonly findings: readonly CanonicalFinding[];
  readonly metrics: readonly CanonicalMetric[];
  readonly degraded: boolean;
}

/** 安全取 object（不抛）——纯函数。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

/** 安全取 string（非 string ⇒ ''）。 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 安全取 finite number（非有限 ⇒ null，不编假值）。 */
function asFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 安全取 string|null（非 string ⇒ null，保留"缺席"语义）。 */
function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 把 `SentinelCheckResult`（或任意 aggregate 返回）投影成 canonical 结构。
 * @param raw 子进程真跑返回的原对象（unknown：可能是 findings[] 或 {findings,metrics,degraded}）
 * @returns 只含白名单字段的 canonical 投影（**剔除检测时刻/耗时/runId 等逐次变化字段**）
 */
export function projectCanonical(raw: unknown): CanonicalProjection {
  const obj = asRecord(raw);
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const rawMetrics = Array.isArray(obj.metrics) ? obj.metrics : [];
  const findings: CanonicalFinding[] = [];
  for (const item of rawFindings) {
    const f = asRecord(item);
    findings.push({
      id: asString(f.id),
      severity: asString(f.severity),
      // types.ts:50-53：polarity 缺省按 'negative' 处理 ⇒ 归一为显式值（否则"缺字段"与"negative"不可比）
      polarity: f.polarity === 'positive' ? 'positive' : 'negative',
      title: asString(f.title),
      description: asString(f.description),
      evidence: Array.isArray(f.evidence) ? f.evidence.map((e) => asString(e)) : [],
      suggestion: asString(f.suggestion),
    });
  }
  const metrics: CanonicalMetric[] = [];
  for (const item of rawMetrics) {
    const m = asRecord(item);
    metrics.push({
      metricId: asString(m.metricId),
      value: asFiniteOrNull(m.value),
      unit: asStringOrNull(m.unit),
      sourceId: asStringOrNull(m.sourceId),
    });
  }
  return { findings, metrics, degraded: obj.degraded === true };
}

/**
 * 稳定序列化（**键排序后** JSON；数组保序）。
 * @param value 任意 JSON 值（只支持 JSON 域：对象/数组/字符串/数字/布尔/null）
 * @returns 与键插入顺序无关的字符串
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const obj = asRecord(value);
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

/** sha256(utf8 文本) 十六进制。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * canonical 摘要（**子进程与父进程共用的唯一摘要口径**）。
 * @param raw 真跑结果
 * @returns sha256(稳定序列化(canonical 投影))
 */
export function canonicalDigest(raw: unknown): string {
  return sha256Hex(stableStringify(projectCanonical(raw)));
}

// ─── ④ 变异（纯函数） ─────────────────────────────────────────────────────────

/**
 * 把副本里的 1 处权重常量改坏（规格指定的语义常量）。
 * @param source compute 源码原文
 * @returns `{source, occurrences}`：occurrences ≠ 1 表示锚点漂移（调用方必须 **fail loud**，不许静默）
 */
export function mutateComputeSource(source: string): { source: string; occurrences: number } {
  const occurrences = source.split(MUTATION_FROM).length - 1;
  if (occurrences !== 1) return { source, occurrences };
  return { source: source.replace(MUTATION_FROM, MUTATION_TO), occurrences };
}

// ─── ⑤ 夹具（只读仓库 extensions/**；全部落 os.tmpdir()） ────────────────────

/** 夹具句柄。 */
export interface DeterminismFixture {
  /** 夹具根 `<tmp>/m6-c3-<pid>`。 */
  readonly root: string;
  /** 子进程扫描根 `<root>/extensions/sentinels`（SENTINELS_FIXTURE_DIR 的值）。 */
  readonly sentinelsDir: string;
  /** 被测哨兵副本目录。 */
  readonly sentinelDir: string;
  /** `<root>/src` ⇒ 仓库 `src` 的 junction。 */
  readonly srcLink: string;
}

/** 夹具图节点。 */
export interface FixtureNode {
  readonly id: string;
  readonly type: string;
  readonly props: Record<string, unknown>;
}
/** 夹具图（结构上满足 SentinelContext.graphStore）。 */
export interface FixtureGraphStore {
  queryNodes(type: string, filters?: Record<string, unknown>, graph?: string): FixtureNode[];
}

/**
 * 夹具图（**写死**，见文件头：不写 ⇒ aggregate empty-read ⇒ compute 不跑 ⇒ mutate 假红）。
 * 注意：queryNodes **忽略 filters** —— loader 侧 `withOrgScope` 会把 `{tid}` 归一成 `{orgId: teamId}`，
 * 夹具只需保证"读得到"，租户过滤语义与本件判据无关（详见已知限制 2 的判据边界）。
 * @returns Agent×1（monitored=true）＋ Tool×1（error=false）
 */
export function createFixtureGraphStore(): FixtureGraphStore {
  return {
    queryNodes(type: string): FixtureNode[] {
      if (type === 'Agent') return [{ id: 'a1', type: 'Agent', props: { monitored: true } }];
      if (type === 'Tool') return [{ id: 't1', type: 'Tool', props: { error: false } }];
      return [];
    },
  };
}

/** 递归数文件（证据行用：复制完整性）。 */
function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return total;
}

/**
 * 建夹具（复制单哨兵 ＋ src junction）。**只读仓库**，不改 `extensions/**`。
 * @param repoRoot 仓库根
 * @returns 夹具句柄（失败 ⇒ 抛 ProbeError(FIXTURE_*)，由 main 统一 degrade/exit 2）
 */
export function createFixture(repoRoot: string): DeterminismFixture {
  const sourceDir = join(repoRoot, 'extensions', 'sentinels', SENTINEL_NAME);
  if (!existsSync(join(sourceDir, 'manifest.json'))) {
    throw new ProbeError('FIXTURE_SOURCE_MISSING', 'fixture', `源哨兵不存在：${sourceDir}`, false);
  }
  const root = join(tmpdir(), `m6-c3-${process.pid}`);
  // 幂等：清掉同 pid 的崩溃残留（父进程不并发跑 main ⇒ 不会互踩）
  rmSync(root, { recursive: true, force: true });

  const sentinelsDir = join(root, 'extensions', 'sentinels');
  const sentinelDir = join(sentinelsDir, SENTINEL_NAME);
  mkdirSync(sentinelsDir, { recursive: true });
  try {
    // L1 批准偏离：只复制 1 个哨兵（不复制 extensions/sentinels 全量）
    cpSync(sourceDir, sentinelDir, { recursive: true });
  } catch (err) {
    throw new ProbeError(
      'FIXTURE_COPY_INCOMPLETE',
      'fixture',
      `复制夹具失败：${sourceDir} → ${sentinelDir}（${err instanceof Error ? err.message : String(err)}）`,
      true,
    );
  }
  for (const rel of ['manifest.json', 'aggregate.ts', COMPUTE_REL]) {
    if (!existsSync(join(sentinelDir, rel))) {
      throw new ProbeError('FIXTURE_COPY_INCOMPLETE', 'fixture', `夹具缺件：${join(sentinelDir, rel)}`, false);
    }
  }

  const srcLink = join(root, 'src');
  try {
    // Win 用 'junction'（无需管理员）；POSIX 用 'dir'
    symlinkSync(join(repoRoot, 'src'), srcLink, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    throw new ProbeError(
      'FIXTURE_SYMLINK_FAILED',
      'fixture',
      `建 src junction 失败（${srcLink} → ${join(repoRoot, 'src')}）：${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }

  return { root, sentinelsDir, sentinelDir, srcLink };
}

/**
 * 清理夹具（删 tmp 根；并核对仓库 src / 源哨兵 manifest 仍完好）。
 * @param fixture 夹具句柄
 * @param repoRoot 仓库根
 * @returns 清理结果（removed / srcIntact / sourceIntact / reason）
 */
export function cleanupFixture(fixture: DeterminismFixture, repoRoot: string): {
  removed: boolean;
  srcIntact: boolean;
  sourceIntact: boolean;
  reason: string;
} {
  let removed = false;
  let reason = '';
  try {
    // 🔴 已实测：rmSync(recursive) 对目录内 junction 只删链接、**不跟进目标**（不会删仓库 src）
    if (existsSync(fixture.srcLink)) unlinkSync(fixture.srcLink);
    rmSync(fixture.root, { recursive: true, force: true });
    removed = !existsSync(fixture.root);
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
  return {
    removed,
    srcIntact: existsSync(join(repoRoot, 'src', 'sentinel', 'types.ts')),
    sourceIntact: existsSync(join(repoRoot, 'extensions', 'sentinels', SENTINEL_NAME, 'manifest.json')),
    reason,
  };
}

// ─── ⑥ 出口层（typed error ＋ `degraded:` ＋ 帮助） ───────────────────────────

/** 收集未知异常为 typed error（禁裸 Error 冒泡到出口）。 */
function toProbeError(err: unknown): ProbeError {
  if (err instanceof ProbeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProbeError('UNEXPECTED', 'unknown', message, false);
}

/** 降级日志默认路径：环境变量优先；缺省落 gitignored 的证据目录（不污染 git status）。 */
export function defaultDegradedLogPath(repoRoot: string): string {
  const fromEnv = (process.env.SYNO_GATE_DEGRADED_LOG ?? '').trim();
  if (fromEnv !== '') return fromEnv;
  return join(repoRoot, '.synova-out', 'm6-1158', 'degraded-events.log');
}

/** 追加降级事件（字段口径同 probe-line-signals.ts:224：time/component/code/phase/retryable）。 */
function appendDegradedLog(err: ProbeError, logPath: string): void {
  const entry = {
    time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    component: COMPONENT,
    code: err.code,
    phase: err.phase,
    retryable: err.retryable,
    reason: err.message.split('\n')[0] ?? err.message,
  };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flag: 'a' });
  } catch (logErr) {
    // 日志不可写不改变退出码，但必须显式告警（ⓘ 走 stdout，理由同 C4）。
    process.stdout.write(
      `ⓘ 降级日志不可写（${logPath}）：${logErr instanceof Error ? logErr.message : String(logErr)}\n`,
    );
  }
}

/**
 * 根级失败统一出口（fail-closed）：stderr 一行 `degraded:` ＋ 追加日志 ＋ stdout `RESULT=ERROR` ＋ exit 2。
 * @param err 任意异常（收敛为 ProbeError）
 * @param logPath 降级日志路径
 * @returns 恒 2
 */
function degrade(err: unknown, logPath: string): 2 {
  const probe = toProbeError(err);
  const firstLine = (probe.message.split('\n')[0] ?? probe.message).trim();
  process.stderr.write(`degraded: ${firstLine} [code=${probe.code}]\n`);
  appendDegradedLog(probe, logPath);
  process.stdout.write('RESULT=ERROR\n');
  return 2;
}

/** 用法文本（DS：规则与文件头同源）。 */
export function usageText(): string {
  return [
    'probe-m6-determinism.ts — C3 同资料两次一致 ＋ 改坏必红（#708 / 规格-1158 §4 C3）',
    '',
    '用法:',
    '  node node_modules/tsx/dist/cli.mjs scripts/control-tower/probe-m6-determinism.ts --case main',
    '  … --all（仅主用例）',
    '  … --child-run（子协议；需 SENTINELS_FIXTURE_DIR，父进程内部调用）',
    '',
    '选项:',
    '  --case main   四相位（RUN-1/RUN-2/MUTATE/RESTORE）一次跑完（缺省 ⇒ exit 2）',
    '  --all         仅主用例（反例内含于 MUTATE 相位，不单列 case）',
    '  --child-run   子进程模式：扫描夹具 → 注册 → 真跑 → canonical 投影 → 一行 JSON {"sha256":…}',
    '  --help        本帮助',
    '',
    '规则（与文件头同源）:',
    '  R1 两次＝**两个独立子进程**（非进程内重复）⇒ canonical 投影 sha256 必须逐字同',
    '  R2 MUTATE＝改副本 computes/compute-agent-deployment-maturity.ts **1 处权重常量** 0.3→0.35（禁改 cap）',
    '     ⇒ sha256 必须 ≠ **改坏前 golden sha（h1）**（不是"两次之间比"）',
    '  R3 RESTORE＝副本还原 ⇒ sha256 必须回 h1',
    '  R4 剔除（白名单投影）：detectedAt/checkedAt/durationMs/runId/computedAt 等逐次变化字段',
    '  R5 夹具只复制 agent-deployment-maturity（L1 批准偏离）；仓库 extensions/** 只读',
    '  R6 参数缺省/未知 ⇒ exit 2；--all 仅主用例',
    '',
    '比较口径（canonical）:',
    '  { findings:[{id,severity,polarity,title,description,evidence,suggestion}],',
    '    metrics:[{metricId,value,unit,sourceId}], degraded }  ← 键排序后 JSON',
    '',
    '退出码（三态）:',
    '  0 三比全绿（twice=EQUAL ∧ mutate=DIFF ∧ restore=EQUAL）',
    '  1 比较红（两次不一致 / 改坏没被抓到 / 还原未回 golden）',
    '  2 检查自身失败（夹具/子进程/超时/协议/参数/仓库根）；stderr 一行 degraded:',
    '',
    '环境:',
    '  SYNO_REPO_ROOT          仓库根（缺省自 cwd 上溯定位）',
    '  SENTINELS_FIXTURE_DIR   子进程夹具扫描根（父进程设置给子进程）',
    '  SYNO_GATE_DEGRADED_LOG  降级事件日志（缺省 .synova-out/m6-1158/degraded-events.log）',
    '',
    '超时: 每个子进程 120s 硬超时（超时 ⇒ CHILD_TIMEOUT ⇒ exit 2；父进程不重试——重试会掩盖不确定性）',
  ].join('\n');
}

// ─── ⑦ 子进程（子协议 ＋ 父侧 spawn/协议校验） ───────────────────────────────

/** 子进程失败统一出口（stderr 一行 `child-failed:` ＋ exit 2；不吐半行 JSON）。 */
function childFail(code: string, message: string): 2 {
  process.stderr.write(`child-failed: ${code} ${message.split('\n')[0]}\n`);
  return 2;
}

/**
 * 子进程模式（`--child-run`）：真跑一次被测哨兵，stdout 只吐一行 canonical sha JSON。
 * 设计：取数（真跑）与判定分离 —— 本函数**不做任何比较/判定**。
 * @returns 0 = 成功吐出一行 JSON；2 = 自身失败（父进程据此 degrade）
 */
async function runChildMode(): Promise<0 | 1 | 2> {
  const fixtureDir = (process.env.SENTINELS_FIXTURE_DIR ?? '').trim();
  if (fixtureDir === '') {
    return childFail('CHILD_ENV_MISSING', 'SENTINELS_FIXTURE_DIR 未设置（本模式只能由父进程带夹具启动）');
  }
  try {
    // 生产扫描管线（缝：sentinel-loader.ts:51/:56 读 SENTINELS_FIXTURE_DIR）
    const { loadSentinels, registerLoadedSentinels } = await import('../../src/sentinel/sentinel-loader');
    const loaded = loadSentinels();
    if (loaded.sentinels.length !== 1) {
      return childFail(
        'CHILD_FIXTURE_SCAN',
        `夹具扫描应恰好 1 个哨兵，实际 ${loaded.sentinels.length}（errors=${loaded.errors.join('; ') || '无'}）`,
      );
    }
    if (loaded.sentinels[0].manifest.name !== SENTINEL_NAME) {
      return childFail('CHILD_FIXTURE_SCAN', `夹具哨兵名不符：${loaded.sentinels[0].manifest.name} ≠ ${SENTINEL_NAME}`);
    }
    const registered = await registerLoadedSentinels();
    if (registered.registered !== 1) {
      return childFail(
        'CHILD_REGISTER_FAILED',
        `注册数 ${registered.registered} ≠ 1（errors=${registered.errors.join('; ') || '无'}）`,
      );
    }
    const { getSentinelRegistry } = await import('../../src/sentinel/registry');
    const sentinel = getSentinelRegistry().get(SENTINEL_ID);
    if (!sentinel) return childFail('CHILD_REGISTER_FAILED', `registry 无 ${SENTINEL_ID}`);

    const require = createRequire(import.meta.url);
    const DatabaseCtor: typeof import('better-sqlite3') = require('better-sqlite3');
    const { reconcileSchema } = await import('../../src/store/schema-migration');
    const { createMetricSink } = await import('../../src/sentinel/metric-readings-writer');
    const db = new DatabaseCtor(':memory:');
    try {
      reconcileSchema(db);
      const store = createFixtureGraphStore();
      const ctx: SentinelContext = {
        db: store,
        graphStore: store,
        metricSink: createMetricSink(db),
        now: new Date(),
        teamId: `probe-c3-${process.pid}`,
      };
      const result: SentinelCheckResult = await sentinel.check(ctx);
      process.stdout.write(`${JSON.stringify({ sha256: canonicalDigest(result) })}\n`);
      return 0;
    } finally {
      db.close();
    }
  } catch (err) {
    return childFail(
      err instanceof ProbeError ? err.code : 'CHILD_UNEXPECTED',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * 父侧跑一次子进程并解析一行 JSON（超时/协议/解析失败都 fail loud）。
 * @param repoRoot 仓库根（子进程 cwd）
 * @param fixture 夹具句柄
 * @param phase 相位名（错误消息用）
 * @returns canonical sha256（64 hex）
 */
function runChildOnce(repoRoot: string, fixture: DeterminismFixture, phase: string): string {
  const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxCli)) {
    throw new ProbeError('CHILD_SPAWN_FAILED', 'child', `tsx CLI 不存在：${tsxCli}`, false);
  }
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [tsxCli, fileURLToPath(import.meta.url), '--child-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    // LOG_LEVEL=silent：日志走 stderr 且静音 ⇒ stdout 只允许一行 JSON（不是 mock，见已知限制 5）
    env: { ...process.env, SENTINELS_FIXTURE_DIR: fixture.sentinelsDir, LOG_LEVEL: 'silent' },
  });
  const elapsedMs = Date.now() - startedAt;

  if (child.error) {
    const e = child.error as NodeJS.ErrnoException;
    const code = e.code === 'ETIMEDOUT' ? 'CHILD_TIMEOUT' : 'CHILD_SPAWN_FAILED';
    throw new ProbeError(code, 'child', `${phase} 子进程启动/运行失败（${String(e.code ?? '')} ${e.message}）`, true);
  }
  const stdout = (child.stdout ?? '').replace(/\r\n/g, '\n').trimEnd();
  const stderrTail = (child.stderr ?? '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(-2).join(' | ');
  if (child.status !== 0) {
    throw new ProbeError(
      'CHILD_EXIT_NONZERO',
      'child',
      `${phase} 子进程 exit=${String(child.status)}（elapsed=${elapsedMs}ms）stderr=${stderrTail || '空'}`,
      true,
    );
  }
  const lines = stdout.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) {
    throw new ProbeError(
      'CHILD_PROTOCOL_VIOLATION',
      'child',
      `${phase} 子进程 stdout 应恰好 1 行 JSON，实际 ${lines.length} 行：${stdout.slice(0, 240)}`,
      false,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]);
  } catch (err) {
    throw new ProbeError(
      'CHILD_JSON_PARSE',
      'child',
      `${phase} 子进程 stdout 不是合法 JSON：${lines[0].slice(0, 200)}（${err instanceof Error ? err.message : String(err)}）`,
      false,
    );
  }
  const digest = asRecord(parsed).sha256;
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new ProbeError('CHILD_PROTOCOL_VIOLATION', 'child', `${phase} 子进程 JSON 缺合法 sha256：${lines[0].slice(0, 200)}`, false);
  }
  return digest;
}

// ─── ⑧ main 编排（四相位 ＋ 三比） ────────────────────────────────────────────

/** 场景选择（R6：不回落默认场景；`--all` 仅主用例）。 */
function selectCases(argv: readonly string[]): readonly DeterminismCase[] {
  if (argv.includes('--all')) {
    process.stdout.write('ⓘ --all 仅主用例（C3 反例内含于 MUTATE 相位，不单列 case）\n');
    return ['main'];
  }
  if (!argv.includes('--case')) {
    throw new ProbeError(
      'ARG_CASE_REQUIRED',
      'args',
      `缺 --case <${CASES_TEXT}>（缺省不回落默认场景 —— 回落会报出绿色的假事实）`,
      false,
    );
  }
  const { cases } = parseProbeArgs(KNOWN_CASES, argv);
  return cases.filter((name): name is DeterminismCase => (KNOWN_CASES as readonly string[]).includes(name));
}

/** 主用例：四相位 ＋ 三比。 */
function runMain(repoRoot: string): 0 | 1 | 2 {
  const out = new ProbeOutput('probe-m6-determinism (C3 · #708)');
  out.case('main · 两次独立进程一致 ＋ 改坏必红');

  const fixture = createFixture(repoRoot);
  let failed: unknown = null;
  try {
    const computePath = join(fixture.sentinelDir, COMPUTE_REL);
    const manifestPath = join(fixture.sentinelDir, 'manifest.json');
    const originalSource = readFileSync(computePath, 'utf8');
    const originalFileSha = sha256Hex(originalSource);
    const manifestSha = sha256Hex(readFileSync(manifestPath, 'utf8'));

    out.note(`[FIXTURE] root=${fixture.root}`);
    out.note(`[FIXTURE] sentinelsDir=${fixture.sentinelsDir}`);
    out.note(`[FIXTURE] srcJunction=${fixture.srcLink} → ${join(repoRoot, 'src')}`);
    out.note(
      `[FIXTURE] sentinel=${SENTINEL_NAME} files=${countFiles(fixture.sentinelDir)} ` +
        `manifestSha256=${manifestSha} computeFileSha256=${originalFileSha}`,
    );
    out.note(`[FIXTURE] ctx={db:夹具图, graphStore:夹具图, metricSink:createMetricSink(:memory:), teamId=probe-c3-<pid>, now:new Date()}`);

    // ── 相位 1/4：RUN-1（独立子进程） ──
    const h1 = runChildOnce(repoRoot, fixture, 'RUN-1');
    out.note(`[RUN-1] sha256=${h1}`);

    // ── 相位 2/4：RUN-2（另一个独立子进程） ──
    const h2 = runChildOnce(repoRoot, fixture, 'RUN-2');
    out.note(`[RUN-2] sha256=${h2}`);
    const twiceEqual = h1 === h2;

    // ── 相位 3/4：MUTATE（改副本 1 处权重常量；与改坏前 golden sha h1 比） ──
    const mutation = mutateComputeSource(originalSource);
    if (mutation.occurrences !== 1) {
      throw new ProbeError(
        'FIXTURE_MUTATION_ANCHOR',
        'fixture',
        `变异锚点 ${JSON.stringify(MUTATION_FROM)} 出现 ${mutation.occurrences} 次（期望恰好 1 次）—— 锚点漂移，拒绝静默跳过`,
        false,
      );
    }
    writeFileSync(computePath, mutation.source, 'utf8');
    const mutatedFileSha = sha256Hex(readFileSync(computePath, 'utf8'));
    const hMut = runChildOnce(repoRoot, fixture, 'MUTATE');
    const mutateDiff = hMut !== h1;
    out.note(
      `[MUTATE] ${COMPUTE_REL} 改 1 处权重常量（${MUTATION_FROM} → ${MUTATION_TO}；禁改 cap）` +
        ` fileSha256=${mutatedFileSha} ⇒ sha256=${hMut}；h2${mutateDiff ? '≠' : '==='}h1` +
        (mutateDiff ? '（[EXPECTED-RED]）' : '（[EXPECTED-RED] 缺失 ⇒ 判据无牙齿 ⇒ exit 1）'),
    );

    // ── 相位 4/4：RESTORE（副本还原 ⇒ 回 golden） ──
    writeFileSync(computePath, originalSource, 'utf8');
    const restoredFileSha = sha256Hex(readFileSync(computePath, 'utf8'));
    const hRest = runChildOnce(repoRoot, fixture, 'RESTORE');
    const restoreEqual = hRest === h1 && restoredFileSha === originalFileSha;
    out.note(
      `[RESTORE] 副本还原 ⇒ sha256=${hRest}；fileSha256=${restoredFileSha}` +
        `（原始 ${originalFileSha}，一致=${restoredFileSha === originalFileSha}）`,
    );

    // ── 三比汇总 ──
    out.note(
      `[COMPARE] twice=${twiceEqual ? 'EQUAL' : 'DIFF'} ` +
        `mutate=${mutateDiff ? 'DIFF' : 'SAME'} restore=${restoreEqual ? 'EQUAL' : 'DIFF'}`,
    );

    if (twiceEqual) out.pass(`两次独立子进程 canonical 投影逐字同：sha256=${h1}（真跑两个进程）`);
    else out.fail(`两次独立子进程不一致：RUN-1=${h1} vs RUN-2=${h2}（确定性判据不成立 ⇒ exit 1）`);

    if (mutateDiff) out.pass(`改坏必红：改 1 处权重常量 ⇒ sha256=${hMut} ≠ 改坏前 golden ${h1}`);
    else out.fail(`改坏没被抓到：MUTATE sha256=${hMut} === 改坏前 golden ${h1}（判据无牙齿 ⇒ exit 1）`);

    if (restoreEqual) out.pass(`副本还原回 golden：sha256=${hRest}`);
    else out.fail(`还原未回 golden：RESTORE=${hRest} vs golden ${h1}（fileSha 一致=${restoredFileSha === originalFileSha}）`);

    // 仓库 extensions/** 零改动核对（本 probe 只读）
    const repoManifestSha = sha256Hex(readFileSync(join(repoRoot, 'extensions', 'sentinels', SENTINEL_NAME, 'manifest.json'), 'utf8'));
    out.note(
      `[REPO] extensions/sentinels/${SENTINEL_NAME}/manifest.json sha256=${repoManifestSha}` +
        `（与夹具 ${repoManifestSha === manifestSha ? '同值 ⇒ 只读未改' : '不同 ⇒ 异常'}）`,
    );
  } catch (err) {
    failed = err;
  }

  const cleaned = cleanupFixture(fixture, repoRoot);
  if (cleaned.removed && cleaned.srcIntact && cleaned.sourceIntact) {
    out.note(
      `[CLEANUP] fixture 已删（${fixture.root}）；仓库 src 完好=EXISTS；` +
        `仓库 extensions/sentinels/${SENTINEL_NAME}/manifest.json=EXISTS（本 probe 只读）`,
    );
  } else {
    out.error(
      `[CLEANUP] 清理异常：removed=${cleaned.removed} srcIntact=${cleaned.srcIntact} ` +
        `sourceIntact=${cleaned.sourceIntact}${cleaned.reason ? ` reason=${cleaned.reason}` : ''}`,
    );
  }

  if (failed !== null) throw failed;
  return EXIT_BY_VERDICT[out.finish()];
}

/**
 * 探针主函数（供测试复用；不自行 process.exit）。
 * @param argv 参数（不含 node/脚本名）
 * @returns 三态退出码 0=PASS ｜ 1=FAIL ｜ 2=检查自身失败（degraded）
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  // 子协议短路：子进程 stdout 只允许一行 JSON（不得有横幅/日志行）
  if (argv.includes('--child-run')) return runChildMode();

  let repoRoot: string;
  try {
    repoRoot = locateRepoRoot();
  } catch (err) {
    return degrade(err, defaultDegradedLogPath(process.cwd()));
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }

  try {
    const selected = selectCases(argv);
    if (!selected.includes('main')) {
      throw new ProbeError('ARG_CASE_REQUIRED', 'args', `仅支持 --case main（收到 ${selected.join(',')}）`, false);
    }
    return runMain(repoRoot);
  } catch (err) {
    return degrade(err, defaultDegradedLogPath(repoRoot));
  }
}

/** 是否被**直接执行**（被 import 时不点火 —— 让测试可 import 纯函数）。 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  (() => {
    try {
      return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
    } catch (err) {
      // 非常规 URL 形态 ⇒ 无法断定是否直接调用 ⇒ 不自动跑 main（被 import 时的预期行为）。
      process.stderr.write(
        `ⓘ 降级：无法判定是否直接调用（${err instanceof Error ? err.message : String(err)}）⇒ 不自动执行 main\n`,
      );
      return false;
    }
  })();

if (invokedDirectly) {
  // 🔴 用 `process.exitCode` 而非 `process.exit()`：probe-ladder.ts 实测教训——管道/重定向下
  //    `process.exit()` 会丢弃 stdout 缓冲，输出被**静默截断**（证据采集会看到空输出）。
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      process.stderr.write(`❌ 探针自身异常（exit 2）：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = 2;
    },
  );
}
