/**
 * probe-line-signals.ts — #602 P7-2 三信号探针（回执三信号口径 A · 报告线 v4）
 *
 * 【一句话】按 handbook《常设授权条例》§五 的 5 条**报告线**，一条命令算出「回执三信号」：
 *   ① 判据通过率（机器代理＝四条件通过率，标签 `①(merge-conditions)`；分母＝该线全部已归属 PR）
 *   ② 未通过 PR 明细（NOT-DONE，按线；**只装「没做到」**）  ③ 在飞 PR 数（按线，跨线计入所涉每条线）
 *   并把「看不见」（全 unknown / 混合未归属 / 跨线 / **不可判**）**逐项点名**进 gaps。三态退出码 0/1/2。
 *
 * 【设计哲学】一个分离 ＋ 四条承诺
 *   · 一个分离：**取真值 与 归线聚合 分离** —— 取数只认 API／git／夹具三类真值源，
 *     聚合只做「文件路径 → 报告线」的纯函数映射（最长前缀优先＋显式排除）；两者都不写仓库。
 *   · 承诺 1「看不见 ≠ 没问题」：open PR 列表取不到 ⇒ exit 2；open PR=0 ⇒ exit 2
 *     （除夹具显式声明合法零）；gaps 明细条数必须与末行计数自洽（DS-2）。
 *   · 承诺 2「跨线不硬归」：跨 ≥2 线的 PR **计入所涉每条线 ③** 并标 `(跨线 c)`，
 *     同时在 gaps 里点名所涉线（§4bis 硬约束 2）；全 unknown／混合未归属同样逐项点名、不许丢。
 *   · 承诺 3「只出 A 口径」：输出键集固定 DS-8 七键；出现 B 口径键（绕过/拒绝/M 复发）
 *     ⇒ 口径守卫必红（子例 E）。**② 只装「没做到」（NOT-DONE）**；逐项降级（不可判）
 *     进 `gaps` 的不可判栏、**不计 ②**，但**计入 ① 分母与 ③**（fail-closed：看不见 ≠ 已做到）。
 *   · 承诺 4「只读」：只 GET；不 `git fetch refs/pull/*`；不改任何仓库文件；
 *     `--selfcheck` 只写系统临时目录并在退出时清理。
 *
 * 契约（铁律 47 / P7 守则 §八之三②）:
 *   @input
 *     --all | --line <产品线|治理线|CTO|K3|基座线> | --selfcheck | --json | --repo-root <path>
 *       --all                5 条线三信号 + 末行 `LINE-SIGNALS: lines=<L> exceptions=<n> gaps=<n>`
 *       --line <线>          单线视图（该线一行 ＋ 该线 `exception: ` 明细逐条 ＋ 末行 `gaps(global)=<n>`）
 *       --json               stdout 仅 JSON（DS-8 七键；与 --selfcheck 互斥 ⇒ exit 2）
 *       --selfcheck          判别力自检（夹具 8 子例 A–H，零网络）
 *       --repo-root <path>   仓库根（缺省＝本脚本上两级）
 *     环境：SYNO_GITEA_API（缺省 http://127.0.0.1:3000/api/v1）｜SYNO_GITEA_REPO
 *            token 三级：GITEA_TOKEN → SYNO_GITEA_TOKEN → $HOME/gitea/.win-push-token
 *            SYNO_LINE_SIGNALS_FIXTURE（夹具：[{open_prs,...}] JSON 文件路径或内联 JSON，零网络）
 *            SYNO_GATE_DEGRADED_LOG（降级事件日志；缺省 .codex/control-tower/logs/degraded-events.log）
 *   @output
 *     逐线行：`<线> ①(merge-conditions)=<p>/<n>|n/a(0)|n/a(未映射) ②=<n> ③=<n>(跨线 <c>)`
 *       · 基座线恒 `①=n/a(未映射) ②=0 ③=0(跨线 0)`（R5 v1 不映射 ⇒ 仍必须出行，不得少一行）
 *       · 某线 0 在飞 PR（全局有 PR）⇒ `①=n/a(0)`、`③=0(跨线 0)`（禁"无在飞 PR"式假事实）
 *       · ① 分母 = 该线**全部已归属在飞 PR（含不可判/降级）**；分子 = 四条件全 ok 的 PR 数；
 *         该线 PR 全不可判 ⇒ `0/<n>`（n≥1，fail-closed）
 *     明细行（行首无缩进，可计数契约）：
 *       `exception: PR#<n> <线> NOT-DONE NO: <逗号分隔失败条件>`（**只装「未通过」**；跨线 PR 在所涉
 *         每条线各 1 条；条件名固定顺序 ci,overlap,review,serial；末行 exceptions= 必须等于本类行数）
 *       `gap: PR#<n> cross <线1>,<线2>`（跨线 PR）
 *       `gap: PR#<n> unknown <k> files`（文件全部未映射）
 *       `gap: PR#<n> mixed-unassigned <k> files`（混合 PR 的未归属文件数）
 *       `gap: PR#<n> 不可判 <code>`（逐项降级/不可判；**不计 ②**；文件归不到线者只进 gaps、不进线计数）
 *       末行 `LINE-SIGNALS: lines=<L> exceptions=<n> gaps=<n>`（L 由 LINES.length 派生，禁写死）
 *       `--line` 文本末行 `gaps(global)=<n>`（n = 全局 gaps 条数；单线视图不展开 gap 明细）
 *     --json：{tool, lines[{line,s1,s2,s3}], exceptions[], gaps[], mapping{rule_hits}, summary{}, exit}
 *       s1/s2/s3 与文本行完全同源（同一行对象渲染，防两套口径漂移）；`--line --json` 时
 *       `summary.gaps_global=<全局 gaps 数>`（只加在 summary 内），`summary.gaps` 仍 = 本次输出 gaps 明细数
 *   @exit  0 = 无例外无缺口（仅夹具可构造）
 *          1 = 有例外或缺口（NOT-DONE / gaps 的 cross/unknown/混合/不可判都算；--line 按全局缺口判）
 *          2 = 根级失败（API/git/JSON/夹具/参数/信号量==0/open PR=0 且夹具未声明合法零）
 *   @degraded  stderr 一行 `degraded: <原因> [code=<CODE>]` ＋ 追加 JSON 到
 *              SYNO_GATE_DEGRADED_LOG（字段 time/component/code/phase/retryable）；exit 2（铁律 11/32）
 *   @authority 任何会话可调（只读探查器）；它**不合并、不派单、不改状态、不判"通过"**。
 *              唯一产出 = 三信号 + 缺口清单 + 三态退出码。
 *   @cross_platform  Node ≥ 20（本仓 node v24.19.0 / tsx v4.23.13）；无第三方依赖；
 *              stdout/stderr 强制 UTF-8（D732）；路径全程引号安全，中文/空格安全。
 *
 * 结构（Source map · 规格 §2 W1 五段 → 本件分节）
 *   ① 头部契约（本块）      — 契约 / 设计哲学 / 结构 / 已知限制
 *   ② 常量与环境            — LINES、规则表 R1–R5、分页、DS-8 键集、UTF-8（D732）、config 校验
 *   ③ 错误与出口            — ProbeError（typed：code/phase/retryable）/ degrade / usage
 *   ④ 映射层                — mapFile（最长前缀优先＋显式排除，同一文件只归一条线）
 *   ⑤ 取数层                — loadFixture / fetchOpenPrs / fetchPrFiles / fetchConditions
 *   ⑥ 聚合层                — aggregate（三信号 / NOT-DONE exceptions / gaps（含不可判）/ rule_hits）
 *   ⑦ 不变式（判据守卫）    — validateInvariants（DS-2/DS-3/① 分母/②=NOT-DONE 明细/不可判不进 exceptions/跨线硬归与漏计/B 口径/形态/exit 自洽）
 *   ⑧ 输出层                — buildEnvelope / renderText / emit
 *   ⑨ --selfcheck           — 8 子例 A–H（夹具零网络；F/G/H 含「改坏必红」正控）
 *   ⑩ main 编排             — parseArgs → loadConfig → 取数 → 聚合 → 守卫 → 输出 → 三态 exit
 *
 * 已知限制（Known Limitations · C1 四条 ＋ 实录补充）
 *   1. **v1 不出「未收口卡数」**：Issue/task-state 无 line 字段（实测 139 open issue 仅 9 个带 ^P<N>）。
 *      规格 §1.2 要求"写进 Known Limitations 与 gaps"；但子例 A 硬要求全绿夹具 gaps=0，
 *      且 gap 明细被 L1 裁定为可计数形态（cross/unknown/mixed-unassigned/不可判）⇒ 本件只在
 *      **本 Known Limitations ＋ --json summary.limitations** 承载该限制，**不计入 gaps=**。
 *   2. **基座线无路径定义**（handbook §五写"具体面由 CTO 在开线时给"）⇒ R5 v1 恒不映射，
 *      线级 `①=n/a(未映射)`；按 §4bis R5 明示**不作为 gaps 条目**。
 *   3. `docs/plans/**`、`memory/notes/**`、`task-state/**`、`.codex/**`、`AGENTS.md`(根)、
 *      `gate-exemptions/**`、`agents/**` 等不属任何报告线 ⇒ 进 gaps（unknown / mixed-unassigned）。
 *   4. **① 是机器代理**（四条件通过率），非 handbook 原文的"Done 判据逐条"；且 ③ 的"独立复核"
 *      沿用 check-merge-conditions.sh 的 T1 attested 口径（改码不重做复核必红）。
 *   5. **① 取数成本 O(n²)**：逐 PR 调 check-merge-conditions.sh，其内部 ② 对每个 open PR 做
 *      ref/merge-base 文件比对（17 PR 实测单次 ≈7s）；本件串行调用（避免并发 fetch/update-ref 竞态），
 *      真实仓 `--all` 约 2 分钟。取数只读、可复跑。
 *   6. **逐项降级（不可判）的归属**：PR 文件清单取不到 ⇒ 无法归线 ⇒ 只进 `gaps`（不可判栏），
 *      **不进任何线计数**；PR 文件已归线但四条件含 degraded/skip/缺失 ⇒ 仍进该线 ③ 与 ① 分母，
 *      同时进 `gaps` 不可判栏，**不计 ②**（② 只装「没做到」）。跨线未通过 PR 在所涉每条线各 1 条
 *      NOT-DONE（与 ③ 同口径）⇒ Σ② 可 ≥ 末行 exceptions=（末行 = 明细条数）。
 *   7. `--line` 是**单线视图**：只输出该线行 + 该线 `exception:` 明细 + 末行 `gaps(global)=<n>`
 *      （gaps 明细是全局口径，单线不展开；查缺口用 `--all` 或 `--json`）。单线模式 exit 按
 *      **该线例外 ＋ 全局缺口**判（fail-closed：屏幕上印着缺口就不许 exit 0）。
 *   8. `--selfcheck` 的 inner 运行优先 `node <script>`（Node ≥23.6 原生剥类型）；脚本不在
 *      `"type":"module"` 包内（如 /tmp 下的改坏副本）时回退 `npx tsx <script>`。
 *   9. **线集是常量 LINES**（来源 handbook §五，as_of 2026-10-19），**不运行期解析 handbook/镜像**
 *      （否则引入假真值）；线集变更 = 改本件常量（C3 前提变更）。禁写死"4 条线"。
 *  10. `--repo-root` 只用于定位 check-merge-conditions.sh、默认 degraded log 与真值模式 git 预检；
 *      线映射本身按仓内相对路径字符串判定（不读工作树、不做 diff）。
 *  11. `--json` 时 stdout 仅 JSON；人读行（逐线行/明细行）走 stderr（同 check-merge-conditions.sh 口径）。
 *
 * 配对测试（B8 / CT-40）：tests/control-tower/probe-line-signals.test.sh（W2，另一成员同批交付）
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// ─── ② 常量与环境 ──────────────────────────────────────────────────────────────

/** 探针标识（--json 的 tool 字段；也是口径守卫的固定值）。 */
const TOOL = 'probe-line-signals@v1';
/** degraded log 的 component 字段。 */
const COMPONENT = 'probe-line-signals';
/** 报告线集（来源：handbook《常设授权条例》§五，as_of 2026-10-19）。条数一律由此派生，禁写死。 */
const LINES = ['产品线', '治理线', 'CTO', 'K3', '基座线'] as const;
/** 报告线名（字面量联合）。 */
type LineName = (typeof LINES)[number];
/** 基座线：v1 无路径定义（R5），恒未映射。 */
const BASE_LINE: LineName = '基座线';
/** Gitea 分页大小（禁 limit 静默饱和：按页数上限内拉全）。 */
const PAGE_SIZE = 50;
/** 分页上限（超过 ⇒ exit 2，禁静默截断）。 */
const MAX_PAGES = 20;
/** Gitea API 单次请求超时（毫秒）。 */
const API_TIMEOUT_MS = 20000;
/** 单 PR 四条件检查器超时（毫秒；其内部 ② 为 O(n) 比对，给足）。 */
const CONDITION_TIMEOUT_MS = 180000;
/** DS-8 固定键集（多一个键即口径守卫失败，子例 E）。 */
const DS8_KEYS: readonly string[] = ['tool', 'lines', 'exceptions', 'gaps', 'mapping', 'summary', 'exit'];

// D732 UTF-8 强制（TS 侧）：Windows 控制台/子进程统一 UTF-8；本件输出全为 UTF-8 字符串。
process.env.PYTHONIOENCODING = 'utf-8';
if (!process.env.LC_ALL) process.env.LC_ALL = 'C.UTF-8';
try {
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
} catch (streamErr) {
  // swallow-ok: 非 TTY 流不支持 setDefaultEncoding 时 Node 仍按 utf8 写字符串，输出不受影响
  process.stderr.write(`warn: stdout/stderr 不支持 setDefaultEncoding（${streamErr instanceof Error ? streamErr.message : String(streamErr)}），Node 默认 utf8 输出不受影响\n`);
}

// ─── ③ 错误与出口（typed error：带 code / phase / retryable） ─────────────────

/** 本件唯一错误类型：typed error（DSH B1）——禁裸 Error 冒泡到出口。 */
export class ProbeError extends Error {
  /** 机器可判错误码（E_…；degraded 行与 JSON 都带）。 */
  readonly code: string;
  /** 出错阶段（args/fixture/fetch/parse/cond/mapping/invariant/unknown）。 */
  readonly phase: string;
  /** 是否可重试（超时/网络抖动 = true；参数/形状/口径 = false）。 */
  readonly retryable: boolean;

  /**
   * @param code 机器可判错误码（大写下划线，例 E_API_UNREACHABLE）
   * @param phase 出错阶段
   * @param message 人读原因（进 degraded 行与 log 的 reason）
   * @param retryable 是否可重试
   */
  constructor(code: string, phase: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
  }
}

/** 把任意异常收敛成 ProbeError（fail loud：不留裸异常）。 */
function toProbeError(err: unknown, fallbackCode: string, phase: string): ProbeError {
  if (err instanceof ProbeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProbeError(fallbackCode, phase, message, false);
}

/** 类型守卫：JSON 对象（非数组、非 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 用法文本（--help；exit 0）。 */
function usageText(): string {
  return [
    'probe-line-signals.ts — #602 P7-2 三信号探针（回执三信号口径 A · 报告线 v4）',
    '',
    '用法:',
    '  npx tsx scripts/control-tower/probe-line-signals.ts --all',
    '  npx tsx scripts/control-tower/probe-line-signals.ts --line <产品线|治理线|CTO|K3|基座线>',
    '  npx tsx scripts/control-tower/probe-line-signals.ts --all --json',
    '  npx tsx scripts/control-tower/probe-line-signals.ts --selfcheck',
    '',
    '选项:',
    '  --all                 5 条报告线三信号 + 末行 LINE-SIGNALS 汇总',
    '  --line <线>           单线视图（该线行 + exception 明细 + 末行 gaps(global)=<n>）',
    '  --json                stdout 仅 JSON（DS-8 七键；与 --selfcheck 互斥 ⇒ exit 2）',
    '  --selfcheck           判别力自检（夹具 8 子例 A–H，零网络）',
    '  --repo-root <path>    仓库根（缺省＝本脚本上两级）',
    '  --help                本帮助',
    '',
    '环境:',
    '  SYNO_GITEA_API（缺省 http://127.0.0.1:3000/api/v1）｜SYNO_GITEA_REPO',
    '  token 三级：GITEA_TOKEN → SYNO_GITEA_TOKEN → $HOME/gitea/.win-push-token',
    '  SYNO_LINE_SIGNALS_FIXTURE（夹具 JSON：文件路径或内联 JSON，零网络）',
    '  SYNO_GATE_DEGRADED_LOG（降级事件日志）',
    '',
    '退出码（三态）:',
    '  0 无例外无缺口（仅夹具可构造）',
    '  1 有例外或缺口（NOT-DONE / cross / unknown / 混合 / 不可判）',
    '  2 根级失败（API/git/JSON/夹具/参数）或信号量==0（open PR=0 且夹具未声明合法零）',
  ].join('\n');
}

/** 追加降级事件到 SYNO_GATE_DEGRADED_LOG（字段 time/component/code/phase/retryable）。 */
function appendDegradedLog(err: ProbeError, logPath: string): void {
  const entry = {
    time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    component: COMPONENT,
    code: err.code,
    phase: err.phase,
    retryable: err.retryable,
    reason: err.message,
  };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (logErr) {
    // 日志不可写不改变退出码，但必须显式告警（不静默）
    process.stderr.write(`warn: degraded log 不可写（${logPath}）：${logErr instanceof Error ? logErr.message : String(logErr)}\n`);
  }
}

/**
 * 根级失败统一出口（fail-closed）：stderr `degraded: <原因> [code=<CODE>]` + 追加 log + exit 2。
 * @param err 任意异常（收敛为 ProbeError）
 * @param jsonMode 是否 --json（stdout 只允许 JSON）
 * @param logPath degraded log 路径
 * @returns 进程退出码（恒 2）
 */
function degrade(err: unknown, jsonMode: boolean, logPath: string): number {
  const probe = toProbeError(err, 'E_UNEXPECTED', 'unknown');
  const firstLine = probe.message.split('\n')[0] ?? probe.message;
  process.stderr.write(`degraded: ${firstLine} [code=${probe.code}]\n`);
  appendDegradedLog(probe, logPath);
  if (jsonMode) {
    const env: JsonEnvelope = {
      tool: TOOL,
      lines: [],
      exceptions: [],
      gaps: [],
      mapping: { rule_hits: emptyRuleHits() },
      summary: {
        degraded: { code: probe.code, phase: probe.phase, retryable: probe.retryable, reason: firstLine },
        limitations: LIMITATIONS,
      },
      exit: 2,
    };
    process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
  } else {
    process.stdout.write('LINE-SIGNALS: degraded\n');
  }
  return 2;
}

/** 已知限制（进 --json 的 summary.limitations，与头部 Known Limitations 同源）。 */
const LIMITATIONS: readonly string[] = [
  '卡数（未收口）v1 不提供：Issue/task-state 无线字段（Known Limitations 1；不计入 gaps=）',
  '基座线无路径定义（R5 v1 不映射）：①=n/a(未映射)，不作为 gaps 条目',
  '① 是机器代理（四条件通过率），非凡 handbook 字面 Done 判据逐条',
  '逐项降级（不可判）进 gaps 不计 ②，但计入 ① 分母与 ③（fail-closed）',
  '文件清单取不到（files=null）的 PR 归不到线：只进 gaps，不进任何线计数',
];

// ─── ④ 映射层（§4bis R1–R5：最长前缀优先 ＋ 显式排除） ───────────────────────

/** 一条线映射规则。同一文件只归一条线；命中多规则时取**最长前缀**。 */
interface LineRule {
  /** 规则码（R1–R5；进 mapping.rule_hits）。 */
  id: string;
  /** 命中后的报告线（null = v1 不映射，如 R5）。 */
  line: LineName | null;
  /** 目录前缀（命中 = 等值或 startsWith）。 */
  includes: readonly string[];
  /** 显式排除前缀（比 includes 更具体者让给更具体规则）。 */
  excludes: readonly string[];
  /** 精确文件名命中（.gitattributes / .gitignore）。 */
  exact: readonly string[];
  /** 规则说明（证据用）。 */
  note: string;
}

/** R1–R5（§4bis 逐字；R5 v1 不映射 ⇒ 恒 unknown）。 */
const RULES: readonly LineRule[] = [
  { id: 'R1', line: 'K3', includes: ['scripts/audit/'], excludes: [], exact: [], note: 'R1 K3：scripts/audit/**' },
  { id: 'R2', line: 'CTO', includes: ['docs/synova/coordination/tools/'], excludes: [], exact: [], note: 'R2 CTO：docs/synova/coordination/tools/**' },
  {
    id: 'R3',
    line: '产品线',
    includes: ['src/', 'extensions/', 'tests/'],
    excludes: ['tests/control-tower/', 'tests/architecture/'],
    exact: [],
    note: 'R3 产品线：src/** · extensions/** · tests/**（除 tests/control-tower/**、tests/architecture/**）',
  },
  {
    id: 'R4',
    line: '治理线',
    includes: ['scripts/', '.github/', '.gitea/', 'docs/synova/', '.claude/', 'tests/control-tower/', 'tests/architecture/'],
    excludes: ['docs/synova/coordination/tools/'],
    exact: ['.gitattributes', '.gitignore'],
    note: 'R4 治理线：scripts/** · .github/** · .gitea/** · docs/synova/**（除 coordination/tools/）· .claude/** · tests/control-tower/** · tests/architecture/** · .gitattributes · .gitignore',
  },
  { id: 'R5', line: null, includes: [], excludes: [], exact: [], note: 'R5 基座线：v1 不映射（handbook §五无路径定义）⇒ 显式 unknown' },
];

/** 映射结果：命中线（null = unknown）与命中规则码。 */
interface MappingHit {
  line: LineName | null;
  rule: string;
}

/**
 * 文件路径 → 报告线（纯函数；§4bis：最长前缀优先 ＋ 显式排除，不是并集/顺序两读法）。
 * @param file 仓内相对路径（例 src/a.ts / scripts/control-tower/x.sh）
 * @returns 命中线（unknown ⇒ line=null）与规则码（R1–R5 / unknown）
 */
function mapFile(file: string): MappingHit {
  const norm = file.replace(/^\.\//, '');
  let bestLine: LineName | null = null;
  let bestRule = 'unknown';
  let bestLen = -1;
  for (const rule of RULES) {
    let hitLen = -1;
    for (const exact of rule.exact) {
      if (norm === exact) hitLen = Math.max(hitLen, exact.length);
    }
    for (const inc of rule.includes) {
      if (norm === inc || norm.startsWith(inc)) hitLen = Math.max(hitLen, inc.length);
    }
    if (hitLen < 0) continue;
    let excluded = false;
    for (const ex of rule.excludes) {
      if (norm === ex || norm.startsWith(ex)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;
    if (hitLen > bestLen) {
      bestLen = hitLen;
      bestLine = rule.line;
      bestRule = rule.line === null ? 'unknown' : rule.id;
    }
  }
  return { line: bestLine, rule: bestRule };
}

/** 初始化 rule_hits（R1–R5 + unknown；R5 恒 0）。 */
function emptyRuleHits(): Record<string, number> {
  return { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, unknown: 0 };
}

// ─── ③bis 配置与参数 ──────────────────────────────────────────────────────────

/** 运行模式：全量 / 单线 / 自检。 */
type ProbeMode = 'all' | 'line' | 'selfcheck';

/** 运行配置（全部经 loadConfig 校验后才可用）。 */
interface Config {
  mode: ProbeMode;
  line: LineName | null;
  json: boolean;
  repoRoot: string;
  api: string;
  repo: string;
  token: string;
  degradedLog: string;
  fixture: string | null;
}

/** 默认仓库根：本脚本所在目录的上两级。 */
function defaultRepoRoot(): string {
  const entry = process.argv[1] ?? '.';
  return resolve(dirname(resolve(entry)), '..', '..');
}

/** 默认 degraded log：<repo-root>/.codex/control-tower/logs/degraded-events.log（.gitignore 已覆盖 *.log）。 */
function defaultDegradedLog(): string {
  const fromEnv = (process.env.SYNO_GATE_DEGRADED_LOG ?? '').trim();
  if (fromEnv) return fromEnv;
  return join(defaultRepoRoot(), '.codex', 'control-tower', 'logs', 'degraded-events.log');
}

/** token 三级解析：GITEA_TOKEN → SYNO_GITEA_TOKEN → $HOME/gitea/.win-push-token（同 P7-1 口径）。 */
function resolveToken(): string {
  const direct = (process.env.GITEA_TOKEN ?? '').trim() || (process.env.SYNO_GITEA_TOKEN ?? '').trim();
  if (direct) return direct;
  const home = process.env.HOME ?? homedir();
  const tokenPath = join(home, 'gitea', '.win-push-token');
  if (!existsSync(tokenPath)) return '';
  try {
    return readFileSync(tokenPath, 'utf8').replace(/[\r\n]+/g, '').trim();
  } catch (readErr) {
    // 读不到 token ≠ 致命（API 可能仍可匿名读），但必须显式告警
    process.stderr.write(`warn: token 文件不可读（${tokenPath}）：${readErr instanceof Error ? readErr.message : String(readErr)}\n`);
    return '';
  }
}

/** 取一个 flag 的取值（支持 `--flag value` 与 `--flag=value`；缺值 ⇒ E_ARGS）。 */
function takeValue(argv: string[], index: number, flag: string): { value: string; next: number } {
  const arg = argv[index] ?? '';
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) throw new ProbeError('E_ARGS', 'args', `${flag} 缺少取值`, false);
    return { value, next: index + 1 };
  }
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProbeError('E_ARGS', 'args', `${flag} 缺少取值`, false);
  }
  return { value, next: index + 2 };
}

/**
 * 解析参数 + 环境 → 校验后的 Config（非法 ⇒ ProbeError，由调用方 degrade exit 2）。
 * @param argv process.argv.slice(2)
 * @returns 校验后的 Config
 */
function loadConfig(argv: string[]): Config {
  let json = false;
  let selfcheck = false;
  let all = false;
  let help = false;
  let line: LineName | null = null;
  let repoRootRaw: string | null = null;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] ?? '';
    if (arg === '--json') {
      json = true;
      i += 1;
    } else if (arg === '--selfcheck') {
      selfcheck = true;
      i += 1;
    } else if (arg === '--all') {
      all = true;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
      i += 1;
    } else if (arg === '--line' || arg.startsWith('--line=')) {
      const taken = takeValue(argv, i, '--line');
      const matched = LINES.find((candidate) => candidate === taken.value);
      if (!matched) {
        throw new ProbeError('E_LINE_UNKNOWN', 'args', `--line 只接受报告线：${LINES.join('、')}（实际 ${taken.value}）`, false);
      }
      line = matched;
      i = taken.next;
    } else if (arg === '--repo-root' || arg.startsWith('--repo-root=')) {
      const taken = takeValue(argv, i, '--repo-root');
      repoRootRaw = taken.value;
      i = taken.next;
    } else {
      throw new ProbeError('E_ARGS', 'args', `非法参数 ${arg}（--help 看用法）`, false);
    }
  }
  if (json && selfcheck) {
    throw new ProbeError('E_ARGS_MUTEX', 'args', '--json 与 --selfcheck 互斥', false);
  }
  if (all && line !== null) {
    throw new ProbeError('E_ARGS_MUTEX', 'args', '--all 与 --line 互斥', false);
  }
  if (!help && !selfcheck && !all && line === null) {
    throw new ProbeError('E_ARGS', 'args', '缺少 --all | --line <线> | --selfcheck（--help 看用法）', false);
  }
  const apiRaw = ((process.env.SYNO_GITEA_API ?? '').trim() || 'http://127.0.0.1:3000/api/v1').replace(/\/+$/, '');
  try {
    const parsedUrl = new URL(apiRaw);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`协议必须是 http/https（实际 ${parsedUrl.protocol}）`);
    }
  } catch (urlErr) {
    throw new ProbeError('E_CONFIG', 'args', `SYNO_GITEA_API 非法：${apiRaw}（${urlErr instanceof Error ? urlErr.message : String(urlErr)}）`, false);
  }
  const repo = (process.env.SYNO_GITEA_REPO ?? '').trim() || 'synova-agent/SynovaAgent';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new ProbeError('E_CONFIG', 'args', `SYNO_GITEA_REPO 非法（期望 owner/repo）：${repo}`, false);
  }
  const repoRoot = repoRootRaw === null ? defaultRepoRoot() : resolve(repoRootRaw);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    throw new ProbeError('E_REPO_ROOT', 'args', `仓库根不存在或不是目录：${repoRoot}`, false);
  }
  const fixture = (process.env.SYNO_LINE_SIGNALS_FIXTURE ?? '').trim();
  const mode: ProbeMode = selfcheck ? 'selfcheck' : line !== null ? 'line' : 'all';
  return {
    mode,
    line,
    json,
    repoRoot,
    api: apiRaw,
    repo,
    token: resolveToken(),
    degradedLog: defaultDegradedLog(),
    fixture: fixture.length > 0 ? fixture : null,
  };
}

// ─── ⑤ 取数层（夹具 / API / 四条件） ─────────────────────────────────────────

/** 四条件（与 check-merge-conditions.sh --json 的 conditions 同形）。 */
interface Conditions {
  ci: string;
  overlap: string;
  review: string;
  serial: string;
}

/** 一个 open PR 的原始事实（files/conditions 取不到时置 null + problem）。 */
interface ProbedPr {
  number: number;
  files: string[] | null;
  filesProblem: ProbeError | null;
  conditions: Conditions | null;
  condProblem: ProbeError | null;
}

/** 夹具里的一个 PR 条目。 */
interface FixturePr {
  number: number;
  branch: string;
  files: string[];
  conditions: Conditions | null;
}

/** 夹具（§4.3 schema + C2 合法零）。 */
interface FixtureSpec {
  openPrs: FixturePr[];
  allowZero: boolean;
  forceRootFail: boolean;
  dropGapsDetail: boolean;
  forceS1: string | null;
  injectBMetric: boolean;
}

/** 从任意 JSON 值解析四条件（形状不合 ⇒ null，交给调用方判「不可判」）。 */
function conditionsFromJson(raw: unknown): Conditions | null {
  if (!isRecord(raw)) return null;
  const ci = raw.ci;
  const overlap = raw.overlap;
  const review = raw.review;
  const serial = raw.serial;
  if (typeof ci !== 'string' || typeof overlap !== 'string' || typeof review !== 'string' || typeof serial !== 'string') return null;
  if (!ci || !overlap || !review || !serial) return null;
  return { ci, overlap, review, serial };
}

/** 四条件是否「可判」（四值齐且无 degraded/skip 这类未取到真值）。 */
function isJudgeable(cond: Conditions): boolean {
  const values = [cond.ci, cond.overlap, cond.review, cond.serial];
  return values.every((value) => value !== 'degraded' && value !== 'skip');
}

/** 单个条件是否 ok（review 的绿带级别 `ok(attested)`）。 */
function isOkMark(value: string): boolean {
  return value === 'ok' || value.startsWith('ok(');
}

/** 四条件是否全绿。 */
function isAllOk(cond: Conditions): boolean {
  return isOkMark(cond.ci) && isOkMark(cond.overlap) && isOkMark(cond.review) && isOkMark(cond.serial);
}

/** 解析夹具里的 PR 条目（形状不合 ⇒ E_FIXTURE_SHAPE）。 */
function parseFixturePr(item: unknown, where: string): FixturePr {
  if (!isRecord(item)) throw new ProbeError('E_FIXTURE_SHAPE', 'fixture', `${where} 条目必须是 JSON 对象`, false);
  const num = item.number;
  if (typeof num !== 'number' || !Number.isInteger(num) || num <= 0) {
    throw new ProbeError('E_FIXTURE_SHAPE', 'fixture', `${where} 条目 number 必须是正整数`, false);
  }
  const rawFiles = item.files;
  if (!Array.isArray(rawFiles)) throw new ProbeError('E_FIXTURE_SHAPE', 'fixture', `${where} 条目 files 必须是数组`, false);
  const files: string[] = [];
  for (const rawFile of rawFiles) {
    if (typeof rawFile !== 'string' || rawFile.length === 0) {
      throw new ProbeError('E_FIXTURE_SHAPE', 'fixture', `${where} 条目 files 只允许非空字符串`, false);
    }
    files.push(rawFile);
  }
  const branch = typeof item.branch === 'string' ? item.branch : '';
  return { number: num, branch, files, conditions: conditionsFromJson(item.conditions) };
}

/** 把任意 JSON 值解析为夹具（文件路径或内联 JSON 都走这里）。 */
function parseFixture(parsed: unknown): FixtureSpec {
  if (!isRecord(parsed)) throw new ProbeError('E_FIXTURE_SHAPE', 'fixture', '夹具顶层必须是 JSON 对象', false);
  const openPrs: FixturePr[] = [];
  const rawOpen = parsed.open_prs;
  if (rawOpen !== undefined) {
    if (!Array.isArray(rawOpen)) throw new ProbeError('E_FIXTURE_SHAPE', 'fixture', 'open_prs 必须是数组', false);
    for (const item of rawOpen) openPrs.push(parseFixturePr(item, 'open_prs'));
  }
  const rawCross = parsed.cross_pr;
  if (rawCross !== undefined) {
    const crossPr = parseFixturePr(rawCross, 'cross_pr');
    if (!openPrs.some((existing) => existing.number === crossPr.number)) openPrs.push(crossPr);
  }
  const forceS1Raw = parsed.force_s1;
  const forceS1 = typeof forceS1Raw === 'string' && forceS1Raw.length > 0 ? forceS1Raw : null;
  return {
    openPrs,
    allowZero: parsed.allow_zero === true,
    forceRootFail: parsed.force_root_fail === true,
    dropGapsDetail: parsed.drop_gaps_detail === true,
    forceS1,
    injectBMetric: parsed.inject_b_metric === true,
  };
}

/** 读夹具：`{...}` 开头视为内联 JSON，否则当文件路径读（零网络）。 */
function loadFixture(raw: string): FixtureSpec {
  let text: string;
  if (raw.trimStart().startsWith('{')) {
    text = raw;
  } else {
    try {
      text = readFileSync(raw, 'utf8');
    } catch (readErr) {
      throw new ProbeError('E_FIXTURE_READ', 'fixture', `夹具文件不可读：${raw}（${readErr instanceof Error ? readErr.message : String(readErr)}）`, false);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (parseErr) {
    throw new ProbeError('E_FIXTURE_JSON', 'fixture', `夹具 JSON 解析失败：${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, false);
  }
  return parseFixture(parsed);
}

/** 夹具 → ProbedPr 列表（conditions 缺字段 ⇒ 该 PR 不可判，走 exception）。 */
function gatherFromFixture(fixture: FixtureSpec): ProbedPr[] {
  return fixture.openPrs.map((pr) => ({
    number: pr.number,
    files: pr.files,
    filesProblem: null,
    conditions: pr.conditions,
    condProblem:
      pr.conditions === null
        ? new ProbeError('E_COND_DEGRADED', 'cond', `夹具 PR#${pr.number} 未给全四条件（conditions 缺字段）`, false)
        : null,
  }));
}

/** Gitea open PR 列表条目。 */
interface OpenPrRef {
  number: number;
  branch: string;
}

/**
 * 调 Gitea API 并解析 JSON（根级/逐项由调用方选择错误码集合）。
 * @param cfg 运行配置
 * @param apiPath 相对 /repos/<repo> 的路径（例 /pulls?state=open&limit=50&page=1）
 * @param codes 错误码集合（net=不可达 / http=非 200 / json=解析失败）
 * @returns 解析后的 JSON 值（形状由调用方校验）
 */
async function apiGetJson(cfg: Config, apiPath: string, codes: { net: string; http: string; json: string }): Promise<unknown> {
  const url = `${cfg.api}/repos/${cfg.repo}${apiPath}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cfg.token) headers.Authorization = `token ${cfg.token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let text = '';
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new ProbeError(codes.http, 'fetch', `HTTP ${res.status} on ${new URL(url).pathname}（fail-closed）`, res.status >= 500);
    }
    text = await res.text();
  } catch (fetchErr) {
    if (fetchErr instanceof ProbeError) throw fetchErr;
    const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    throw new ProbeError(codes.net, 'fetch', `Gitea API 不可达（${url}）：${message}`, true);
  } finally {
    clearTimeout(timer);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (parseErr) {
    const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new ProbeError(codes.json, 'parse', `JSON 解析失败（${apiPath}）：${message}`, false);
  }
}

/** 解析 open PR 列表（条目形状非法 ⇒ E_OPENPRS_JSON，fail loud）。 */
function parseOpenPrs(raw: unknown): OpenPrRef[] {
  if (!Array.isArray(raw)) throw new ProbeError('E_OPENPRS_JSON', 'parse', 'open PR 列表不是数组（fail-closed）', false);
  const out: OpenPrRef[] = [];
  for (const item of raw) {
    if (!isRecord(item)) throw new ProbeError('E_OPENPRS_JSON', 'parse', 'open PR 条目不是 JSON 对象', false);
    const num = item.number;
    if (typeof num !== 'number' || !Number.isInteger(num) || num <= 0) {
      throw new ProbeError('E_OPENPRS_JSON', 'parse', 'open PR 条目缺 number', false);
    }
    let branch = '';
    const head = item.head;
    if (isRecord(head) && typeof head.ref === 'string') branch = head.ref;
    out.push({ number: num, branch });
  }
  return out;
}

/** open PR 编号去重（分页拼接可能重叠；保序）。 */
function dedupePrs(refs: OpenPrRef[]): OpenPrRef[] {
  const seen = new Set<number>();
  const out: OpenPrRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.number)) continue;
    seen.add(ref.number);
    out.push(ref);
  }
  return out;
}

/**
 * 分页拉全 open PR（禁 limit 饱和：直到某页不足 PAGE_SIZE；超过 MAX_PAGES ⇒ exit 2）。
 * @param cfg 运行配置
 * @returns open PR 引用列表（去重、保序）
 */
async function fetchOpenPrs(cfg: Config): Promise<OpenPrRef[]> {
  const all: OpenPrRef[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const raw = await apiGetJson(cfg, `/pulls?state=open&limit=${PAGE_SIZE}&page=${page}`, {
      net: 'E_API_UNREACHABLE',
      http: 'E_OPENPRS_HTTP',
      json: 'E_OPENPRS_JSON',
    });
    const part = parseOpenPrs(raw);
    for (const ref of part) all.push(ref);
    if (part.length < PAGE_SIZE) return dedupePrs(all);
  }
  throw new ProbeError('E_PAGE_OVERFLOW', 'fetch', `open PR 分页超过 ${MAX_PAGES} 页（${PAGE_SIZE}/页）——禁静默截断，请提高分页上限`, false);
}

/**
 * 取某 PR 的文件清单（走 API，零 git 写，保 @authority 只读）。
 * @param cfg 运行配置
 * @param pr PR 编号
 * @returns 仓内相对路径数组（分页拉全）
 */
async function fetchPrFiles(cfg: Config, pr: number): Promise<string[]> {
  const files: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const raw = await apiGetJson(cfg, `/pulls/${pr}/files?limit=${PAGE_SIZE}&page=${page}`, {
      net: 'E_PR_FILES_UNREACHABLE',
      http: 'E_PR_FILES_HTTP',
      json: 'E_PR_FILES_JSON',
    });
    if (!Array.isArray(raw)) throw new ProbeError('E_PR_FILES_JSON', 'parse', `PR#${pr} 文件列表不是数组`, false);
    for (const item of raw) {
      if (!isRecord(item)) throw new ProbeError('E_PR_FILES_JSON', 'parse', `PR#${pr} 文件条目不是 JSON 对象`, false);
      const filename = item.filename;
      if (typeof filename !== 'string' || filename.length === 0) {
        throw new ProbeError('E_PR_FILES_JSON', 'parse', `PR#${pr} 文件条目缺 filename`, false);
      }
      files.push(filename);
    }
    if (raw.length < PAGE_SIZE) return files;
  }
  throw new ProbeError('E_PR_FILES_PAGE_OVERFLOW', 'fetch', `PR#${pr} 文件分页超过 ${MAX_PAGES} 页`, false);
}

/** 四条件取数结果（逐项降级：problem 非空 ⇒ 该 PR 进 exceptions）。 */
interface CondResult {
  conditions: Conditions | null;
  problem: ProbeError | null;
}

/**
 * 调 check-merge-conditions.sh 取某 PR 四条件（只读调用，不改它）。
 * 逐项降级（exit 2 / JSON 解析失败 / 四条件含 degraded）⇒ problem 非空；根级失败由调用方处理。
 * @param cfg 运行配置
 * @param pr PR 编号
 * @returns 四条件或逐项降级原因
 */
function fetchConditionsReal(cfg: Config, pr: number): CondResult {
  const checker = join(cfg.repoRoot, 'scripts', 'control-tower', 'check-merge-conditions.sh');
  if (!existsSync(checker)) {
    return { conditions: null, problem: new ProbeError('E_COND_MISSING', 'cond', `四条件检查器缺失：${checker}`, false) };
  }
  const result = spawnSync('bash', [checker, '--pr', String(pr), '--json', '--repo-root', cfg.repoRoot], {
    encoding: 'utf8',
    timeout: CONDITION_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const codeMatch = /\[code=([A-Z0-9_]+)\]/.exec(stderr);
  const fallbackCode = codeMatch && codeMatch[1] ? codeMatch[1] : 'E_COND_DEGRADED';
  if (result.error || result.status === null) {
    return {
      conditions: null,
      problem: new ProbeError('E_COND_TIMEOUT', 'cond', `四条件检查器未返回（PR#${pr}）：${result.error ? result.error.message : 'timeout/signal'}`, true),
    };
  }
  if (result.status === 0 || result.status === 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof result.stdout === 'string' ? result.stdout : '');
    } catch (parseErr) {
      return {
        conditions: null,
        problem: new ProbeError(fallbackCode, 'cond', `四条件 JSON 解析失败（PR#${pr}）：${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, false),
      };
    }
    if (!isRecord(parsed)) {
      return { conditions: null, problem: new ProbeError('E_COND_SHAPE', 'cond', `四条件 JSON 顶层不是对象（PR#${pr}）`, false) };
    }
    const conditions = conditionsFromJson(parsed.conditions);
    if (!conditions) {
      return { conditions: null, problem: new ProbeError('E_COND_SHAPE', 'cond', `四条件 JSON 缺 conditions{ci,overlap,review,serial}（PR#${pr}）`, false) };
    }
    if (!isJudgeable(conditions)) {
      return { conditions: null, problem: new ProbeError('E_COND_DEGRADED', 'cond', `四条件含 degraded/skip（PR#${pr}）：ci=${conditions.ci} overlap=${conditions.overlap} review=${conditions.review} serial=${conditions.serial}`, false) };
    }
    return { conditions, problem: null };
  }
  const degradedLine = stderr.split('\n').find((line) => line.startsWith('degraded: '));
  const reason = degradedLine ? degradedLine.replace(/^degraded: /, '').replace(/\s*\[code=[A-Z0-9_]+\]\s*$/, '') : `四条件检查器降级（PR#${pr}，exit ${result.status}）`;
  return { conditions: null, problem: new ProbeError(fallbackCode, 'cond', reason, false) };
}

/**
 * 真值模式取数：git 预检 → open PR 列表（根级失败 ⇒ 抛出）→ 逐 PR 文件清单 → 逐 PR 四条件。
 * 文件清单失败 ⇒ 该 PR 逐项降级（filesProblem）；四条件失败 ⇒ 该 PR 逐项降级（condProblem）。
 * @param cfg 运行配置
 * @returns ProbedPr 列表（open PR 全集，保序）
 */
async function gatherReal(cfg: Config): Promise<ProbedPr[]> {
  const gitCheck = spawnSync('git', ['-C', cfg.repoRoot, 'rev-parse', '--git-dir'], { encoding: 'utf8', timeout: 20000 });
  if (gitCheck.error || gitCheck.status !== 0) {
    const reason = gitCheck.error ? gitCheck.error.message : (typeof gitCheck.stderr === 'string' ? gitCheck.stderr.trim() : '');
    throw new ProbeError('E_GIT', 'fetch', `git 不可用或 ${cfg.repoRoot} 不是 git 仓库（fail-closed）：${reason}`, false);
  }
  const open = await fetchOpenPrs(cfg);
  if (open.length === 0) {
    throw new ProbeError('E_NO_OPEN_PRS', 'fetch', 'open PR=0（信号量==0；禁把"看不见"当没问题）', true);
  }
  const prs: ProbedPr[] = [];
  for (let index = 0; index < open.length; index += 1) {
    const ref = open[index];
    if (!ref) continue;
    let files: string[] | null = null;
    let filesProblem: ProbeError | null = null;
    try {
      files = await fetchPrFiles(cfg, ref.number);
    } catch (filesErr) {
      filesProblem = toProbeError(filesErr, 'E_PR_FILES', 'fetch');
    }
    process.stderr.write(`[probe] ① 四条件 PR#${ref.number}（${index + 1}/${open.length}）\n`);
    const cond = fetchConditionsReal(cfg, ref.number);
    prs.push({ number: ref.number, files, filesProblem, conditions: cond.conditions, condProblem: cond.problem });
  }
  return prs;
}

/** 聚合旋钮（来自夹具；默认全关）。 */
interface Knobs {
  dropGapsDetail: boolean;
  forceS1: string | null;
  injectBMetric: boolean;
}

/** 默认旋钮（真值模式 / 正控）。 */
function emptyKnobs(): Knobs {
  return { dropGapsDetail: false, forceS1: null, injectBMetric: false };
}

/** 夹具 → 旋钮。 */
function knobsOf(fixture: FixtureSpec | null): Knobs {
  if (!fixture) return emptyKnobs();
  return { dropGapsDetail: fixture.dropGapsDetail, forceS1: fixture.forceS1, injectBMetric: fixture.injectBMetric };
}

/**
 * 取数总入口：夹具优先（零网络）；否则真值模式。
 * 夹具的 force_root_fail 与「open PR=0 且未声明合法零」都在这里 fail-closed。
 * @param cfg 运行配置
 * @returns PR 事实列表 + 夹具（真值模式为 null）
 */
async function gather(cfg: Config): Promise<{ prs: ProbedPr[]; fixture: FixtureSpec | null }> {
  if (cfg.fixture) {
    const fixture = loadFixture(cfg.fixture);
    if (fixture.forceRootFail) {
      throw new ProbeError('E_ROOT_SIMULATED', 'fetch', '夹具显式要求模拟根级失败（子例 D）：根级失败必须 exit 2 + degraded，禁当 0', false);
    }
    if (fixture.openPrs.length === 0 && !fixture.allowZero) {
      throw new ProbeError('E_NO_OPEN_PRS', 'fetch', '夹具 open PR=0 且未声明 allow_zero（信号量==0；禁把"看不见"当没问题）', false);
    }
    return { prs: gatherFromFixture(fixture), fixture };
  }
  return { prs: await gatherReal(cfg), fixture: null };
}

// ─── ⑥ 聚合层（三信号 / exceptions / gaps） ──────────────────────────────────

/** 逐线行（text 与 --json 同源）。 */
interface LineRow {
  line: string;
  /** ① 标记：`p/n` | `n/a(0)` | `n/a(未映射)`。 */
  s1: string;
  /** ② 标记：该线 NOT-DONE（未通过）明细条数；不可判不计入（进 gaps）。 */
  s2: string;
  /** ③ 标记：`n(跨线 c)`。 */
  s3: string;
}

/**
 * 例外明细（② 的唯一来源；也进 --json exceptions[]）—— **只装「没做到」**。
 * 不可判（降级）不在此处，进 GapEntry(kind='unjudgeable')。
 */
interface ExceptionEntry {
  pr: number;
  /** 归属线（每条线各 1 条；本件不再有「无法归线」的 exception）。 */
  line: string;
  /** 归属线数组（内部按线计数用；NOT-DONE 恒为单元素）。 */
  lines: LineName[];
  /** 恒为 `NOT-DONE`（口径守卫据此判 ② 一致性）。 */
  code: string;
  /** 未通过的四条件名（固定顺序 ci,overlap,review,serial）。 */
  no: string[];
  /** 阶段（恒 cond）。 */
  phase: string;
  /** 是否可重试（恒 false：口径不通过不是瞬时故障）。 */
  retryable: boolean;
}

/** 映射缺口/不可判（全局；行首无缩进 `gap: ` 四种形态）。 */
interface GapEntry {
  kind: 'cross' | 'unknown' | 'mixed-unassigned' | 'unjudgeable';
  pr: number;
  /** cross 形态：所涉线（LINES 顺序）。 */
  lines?: LineName[];
  /** unknown / mixed-unassigned 形态：未归属文件数。 */
  files?: number;
  /** unjudgeable 形态：机器可判原因码（如 E_COND_DEGRADED / E_PR_FILES_HTTP）。 */
  code?: string;
  /** unjudgeable 形态：人读原因（进 --json gaps[]）。 */
  reason?: string;
}

/** 聚合结果（含判据守卫需要的内部真值）。 */
interface Aggregation {
  rows: LineRow[];
  exceptions: ExceptionEntry[];
  gaps: GapEntry[];
  ruleHits: Record<string, number>;
  /** 线 → 已归属 PR（含跨线/混合；**含条件不可判者** ⇒ ① 分母/③ 的同一口径）。 */
  linePrs: Map<LineName, number[]>;
  /** 线 → 跨线 PR。 */
  lineCross: Map<LineName, number[]>;
  /** 跨线 PR → 所涉线（守卫真值）。 */
  crossPrs: { pr: number; lines: LineName[] }[];
  /** 线 → NOT-DONE PR（② 的内部真值；与 exceptions 明细独立计数，守卫比对用）。 */
  lineNotDone: Map<LineName, number[]>;
  /** 线 → 四条件全 ok 的已归属 PR（① 分子）。 */
  lineOk: Map<LineName, number[]>;
  stats: {
    openPrs: number;
    attributedPrs: number;
    singlePrs: number;
    crossPrs: number;
    unknownPrs: number;
    mixedPrs: number;
    filesTotal: number;
  };
}


/** 归线结果。 */
interface Attribution {
  lines: LineName[];
  unknownFiles: string[];
}

/**
 * 逐文件归线并累计 rule_hits（§4bis：同一文件只归一条线）。
 * @param files 文件路径数组
 * @param ruleHits rule_hits 累加器
 * @returns 命中线（LINES 顺序）与未归属文件
 */
function classifyFiles(files: string[], ruleHits: Record<string, number>): Attribution {
  const hitLines = new Set<LineName>();
  const unknownFiles: string[] = [];
  for (const file of files) {
    const hit = mapFile(file);
    ruleHits[hit.rule] = (ruleHits[hit.rule] ?? 0) + 1;
    if (hit.line === null) unknownFiles.push(file);
    else hitLines.add(hit.line);
  }
  return { lines: LINES.filter((line) => hitLines.has(line)), unknownFiles };
}

/** 四条件名（固定顺序；`no` 列表与 ② 口径都按此顺序）。 */
const CONDITION_NAMES: readonly (keyof Conditions)[] = ['ci', 'overlap', 'review', 'serial'];

/**
 * 取未通过的条件名（固定顺序 ci,overlap,review,serial）。
 * @param cond 四条件（调用方保证可判）
 * @returns 非 ok 的条件名数组（至少 1 个；全 ok 由调用方先行判定）
 */
function failedConditions(cond: Conditions): string[] {
  return CONDITION_NAMES.filter((name) => !isOkMark(cond[name]));
}

/**
 * 构造一条 NOT-DONE 例外（② 的明细；只装「没做到」）。
 * @param pr PR 编号
 * @param line 归属线（跨线 PR 按线各生成 1 条）
 * @param cond 可判且非全 ok 的四条件
 * @returns 例外条目
 */
function makeNotDone(pr: number, line: LineName, cond: Conditions): ExceptionEntry {
  return { pr, line, lines: [line], code: 'NOT-DONE', no: failedConditions(cond), phase: 'cond', retryable: false };
}

/**
 * 追加一条「不可判」缺口（取数降级；**不计 ②**）。
 * @param gaps 缺口数组
 * @param pr PR 编号
 * @param err 降级原因（typed；code 进 gap 文本）
 */
function pushUnjudgeable(gaps: GapEntry[], pr: number, err: ProbeError): void {
  gaps.push({ kind: 'unjudgeable', pr, code: err.code, reason: err.message });
}

/** 往 Map<LineName, number[]> 去重追加。 */
function pushUnique(target: Map<LineName, number[]>, line: LineName, pr: number): void {
  const arr = target.get(line);
  if (!arr) return;
  if (!arr.includes(pr)) arr.push(pr);
}

/**
 * 三信号聚合（纯函数）：文件 → 线 → ③ 计数 / 跨线计数；四条件 → ① 分子分母；
 * 四条件可判但非全 ok → NOT-DONE（②）；取数降级/不可判 → gaps(kind='unjudgeable')。
 * @param prs 取数结果
 * @param knobs 夹具旋钮（改坏正控用；默认全关）
 * @returns 聚合结果（行 + 例外 + 缺口 + 内部真值）
 */
function aggregate(prs: ProbedPr[], knobs: Knobs): Aggregation {
  const ruleHits = emptyRuleHits();
  const exceptions: ExceptionEntry[] = [];
  const gaps: GapEntry[] = [];
  const linePrs = new Map<LineName, number[]>();
  const lineCross = new Map<LineName, number[]>();
  const lineNotDone = new Map<LineName, number[]>();
  const lineOk = new Map<LineName, number[]>();
  for (const line of LINES) {
    linePrs.set(line, []);
    lineCross.set(line, []);
    lineNotDone.set(line, []);
    lineOk.set(line, []);
  }
  const crossPrs: { pr: number; lines: LineName[] }[] = [];
  const stats = { openPrs: prs.length, attributedPrs: 0, singlePrs: 0, crossPrs: 0, unknownPrs: 0, mixedPrs: 0, filesTotal: 0 };

  for (const pr of prs) {
    if (pr.files === null) {
      // 文件清单取不到 ⇒ 归不到任何线 ⇒ 只进 gaps（不可判栏），不进任何线计数
      pushUnjudgeable(gaps, pr.number, pr.filesProblem ?? new ProbeError('E_PR_FILES', 'fetch', '取 PR 文件失败', true));
      continue;
    }
    stats.filesTotal += pr.files.length;
    const attribution = classifyFiles(pr.files, ruleHits);
    if (attribution.lines.length === 0) {
      stats.unknownPrs += 1;
      gaps.push({ kind: 'unknown', pr: pr.number, files: attribution.unknownFiles.length });
      continue;
    }
    stats.attributedPrs += 1;
    for (const line of attribution.lines) pushUnique(linePrs, line, pr.number);
    if (attribution.lines.length >= 2) {
      stats.crossPrs += 1;
      for (const line of attribution.lines) pushUnique(lineCross, line, pr.number);
      crossPrs.push({ pr: pr.number, lines: attribution.lines });
      gaps.push({ kind: 'cross', pr: pr.number, lines: attribution.lines });
    } else {
      stats.singlePrs += 1;
    }
    if (attribution.unknownFiles.length > 0) {
      stats.mixedPrs += 1;
      gaps.push({ kind: 'mixed-unassigned', pr: pr.number, files: attribution.unknownFiles.length });
    }
    if (pr.conditions === null) {
      // 四条件取不到（缺失/取数降级）⇒ 不可判：仍进 ③ 与 ① 分母，进 gaps，**不计 ②**
      pushUnjudgeable(gaps, pr.number, pr.condProblem ?? new ProbeError('E_COND_DEGRADED', 'cond', '四条件取数失败', false));
      continue;
    }
    if (!isJudgeable(pr.conditions)) {
      // 四条件含 degraded/skip ⇒ 不可判：仍进 ③ 与 ① 分母（fail-closed），进 gaps，**不计 ②**
      pushUnjudgeable(gaps, pr.number, new ProbeError(
        'E_COND_DEGRADED',
        'cond',
        `四条件含 degraded/skip（不可判）：ci=${pr.conditions.ci} overlap=${pr.conditions.overlap} review=${pr.conditions.review} serial=${pr.conditions.serial}`,
        false,
      ));
      continue;
    }
    if (isAllOk(pr.conditions)) {
      for (const line of attribution.lines) pushUnique(lineOk, line, pr.number);
      continue;
    }
    // 四条件全部可判且非全 ok ⇒ 「没做到」：所涉每条线各 1 条 NOT-DONE（与 ③ 同口径）
    for (const line of attribution.lines) {
      pushUnique(lineNotDone, line, pr.number);
      exceptions.push(makeNotDone(pr.number, line, pr.conditions));
    }
  }

  const rows: LineRow[] = LINES.map((line) => {
    const prsInLine = linePrs.get(line) ?? [];
    const crossInLine = lineCross.get(line) ?? [];
    const notDoneInLine = lineNotDone.get(line) ?? [];
    const okInLine = lineOk.get(line) ?? [];
    let s1: string;
    if (line === BASE_LINE) s1 = 'n/a(未映射)';
    else if (prsInLine.length === 0) s1 = 'n/a(0)';
    else s1 = `${okInLine.length}/${prsInLine.length}`;
    const s2 = String(notDoneInLine.length);
    const s3 = `${prsInLine.length}(跨线 ${crossInLine.length})`;
    return { line, s1, s2, s3 };
  });
  if (knobs.forceS1 !== null) {
    // 子例 C 正控：把「0 PR 线」的 ① 硬写成非 n/a 值，由 invariant 守卫抓红（禁把看不见当 100%）
    const target = rows.find((row) => row.line !== BASE_LINE && (linePrs.get(row.line as LineName) ?? []).length === 0);
    if (target) target.s1 = knobs.forceS1;
  }
  return { rows, exceptions, gaps, ruleHits, linePrs, lineCross, crossPrs, lineNotDone, lineOk, stats };
}

// ─── ⑦ 不变式（判据守卫 · invariant companion 的同文件实现） ──────────────────

/** DS-8 / 三信号的 --json 信封（索引签名只为子例 E 注入 B 键正控，勿在别处扩键）。 */
interface JsonEnvelope {
  tool: string;
  lines: LineRow[];
  exceptions: ExceptionEntry[];
  gaps: GapEntry[];
  mapping: { rule_hits: Record<string, number> };
  summary: Record<string, unknown>;
  exit: number;
  [extraKey: string]: unknown;
}

/** 取某线行（缺失 ⇒ 守卫失败）。 */
function rowOf(agg: Aggregation, line: LineName): LineRow {
  const row = agg.rows.find((candidate) => candidate.line === line);
  if (!row) throw new ProbeError('E_GUARD_ROW_COUNT', 'invariant', `聚合结果缺线行：${line}`, false);
  return row;
}

/** 渲染一条 gap 明细（行首无缩进、可计数契约；四种形态）。 */
function renderGap(gap: GapEntry): string {
  if (gap.kind === 'cross') return `gap: PR#${gap.pr} cross ${(gap.lines ?? []).join(',')}`;
  if (gap.kind === 'unknown') return `gap: PR#${gap.pr} unknown ${gap.files ?? 0} files`;
  if (gap.kind === 'unjudgeable') return `gap: PR#${gap.pr} 不可判 ${gap.code ?? 'E_UNKNOWN'}`;
  return `gap: PR#${gap.pr} mixed-unassigned ${gap.files ?? 0} files`;
}

/** 渲染一条线行（基座线无"四条件通过率"语义 ⇒ `①=`；其余线 `①(merge-conditions)=`）。 */
function renderRow(row: LineRow): string {
  const label = row.line === BASE_LINE ? '①=' : '①(merge-conditions)=';
  return `${row.line} ${label}${row.s1} ②=${row.s2} ③=${row.s3}`;
}

/**
 * 渲染人读文本（纯函数；文本与 JSON 共用行对象，防两套口径漂移）。
 * @param env --json 信封（lines/gaps/exceptions 的唯一真值源）
 * @param scope null=全量模式；否则单线模式（不展开 gap 明细，末行给 gaps(global)）
 * @returns 逐行文本
 */
function renderText(env: JsonEnvelope, scope: LineName | null): string[] {
  const out: string[] = [];
  for (const row of env.lines) out.push(renderRow(row));
  for (const entry of env.exceptions) out.push(`exception: PR#${entry.pr} ${entry.line} ${entry.code} NO: ${entry.no.join(',')}`);
  if (scope === null) {
    for (const gap of env.gaps) out.push(renderGap(gap));
    out.push(`LINE-SIGNALS: lines=${env.lines.length} exceptions=${env.exceptions.length} gaps=${env.gaps.length}`);
  } else {
    out.push(`gaps(global)=${String(env.summary.gaps_global ?? 0)}`);
  }
  return out;
}

/**
 * 判据守卫（判别力自检的运行时化）：任何口径漂移/计数不自洽/跨线硬归/漏计/B 口径键 ⇒ 抛 ProbeError（exit 2）。
 * @param env 待输出信封
 * @param agg 聚合内部真值
 * @param scope null=全量模式；否则单线模式
 */
function validateInvariants(env: JsonEnvelope, agg: Aggregation, scope: LineName | null): void {
  const extraKeys = Object.keys(env).filter((key) => !DS8_KEYS.includes(key));
  if (extraKeys.length > 0) {
    throw new ProbeError('E_GUARD_B_METRIC', 'invariant', `口径守卫失败：输出出现非 A 键 ${extraKeys.join(',')}（DS-8 只允许 tool/lines/exceptions/gaps/mapping/summary/exit；B 健康三信号不做）`, false);
  }
  if (env.tool !== TOOL) {
    throw new ProbeError('E_GUARD_TOOL', 'invariant', `tool 字段漂移：${String(env.tool)}（期望 ${TOOL}）`, false);
  }
  const expectedRows: LineRow[] = scope === null ? LINES.map((line) => rowOf(agg, line)) : [rowOf(agg, scope)];
  if (env.lines.length !== expectedRows.length) {
    throw new ProbeError('E_GUARD_ROW_COUNT', 'invariant', `线行数=${env.lines.length}（期望 ${expectedRows.length}；行数由 LINES.length 派生，禁写死）`, false);
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const want = expectedRows[index];
    const got = env.lines[index];
    if (!want || !got) throw new ProbeError('E_GUARD_ROW_COUNT', 'invariant', '线行缺失', false);
    if (got.line !== want.line || got.s1 !== want.s1 || got.s2 !== want.s2 || got.s3 !== want.s3) {
      throw new ProbeError('E_GUARD_ROW_DRIFT', 'invariant', `JSON 行与聚合真值漂移：${got.line}（json=${got.s1}/${got.s2}/${got.s3}，真值=${want.s1}/${want.s2}/${want.s3}）`, false);
    }
    if (!/^(n\/a\(未映射\)|n\/a\(0\)|\d+\/\d+)$/.test(got.s1)) {
      throw new ProbeError('E_GUARD_SHAPE', 'invariant', `${got.line} ① 形态非法：${got.s1}`, false);
    }
    if (!/^\d+$/.test(got.s2)) throw new ProbeError('E_GUARD_SHAPE', 'invariant', `${got.line} ② 形态非法：${got.s2}`, false);
    if (!/^\d+\(跨线 \d+\)$/.test(got.s3)) throw new ProbeError('E_GUARD_SHAPE', 'invariant', `${got.line} ③ 形态非法：${got.s3}`, false);
  }
  const baseRow = env.lines.find((row) => row.line === BASE_LINE);
  if (baseRow && (baseRow.s1 !== 'n/a(未映射)' || baseRow.s3 !== '0(跨线 0)')) {
    throw new ProbeError('E_GUARD_BASE_LINE', 'invariant', `基座线必须 ①=n/a(未映射) ③=0(跨线 0)（实际 ${baseRow.s1} / ${baseRow.s3}）`, false);
  }
  // F/G：跨线 PR 必须计入所涉每条线的 ③，且标 (跨线 c)；硬归一线 / 漏计 都必须红
  for (const cross of agg.crossPrs) {
    for (const line of cross.lines) {
      if (!(agg.linePrs.get(line) ?? []).includes(cross.pr)) {
        throw new ProbeError('E_GUARD_CROSS_MISSING', 'invariant', `跨线漏计：PR#${cross.pr} 未计入 ${line} ③（所涉线=${cross.lines.join(',')}）`, false);
      }
      if (!(agg.lineCross.get(line) ?? []).includes(cross.pr)) {
        throw new ProbeError('E_GUARD_CROSS_MISSING', 'invariant', `跨线漏计：PR#${cross.pr} 未计入 ${line} 跨线计数`, false);
      }
      const row = env.lines.find((candidate) => candidate.line === line);
      if (!row) continue;
      const matched = /^(\d+)\(跨线 (\d+)\)$/.exec(row.s3);
      if (!matched || !matched[2]) throw new ProbeError('E_GUARD_SHAPE', 'invariant', `${line} ③ 形态非法：${row.s3}`, false);
      const crossCount = Number(matched[2]);
      if (crossCount === 0) {
        throw new ProbeError('E_GUARD_CROSS_HARDASSIGN', 'invariant', `跨线硬归：PR#${cross.pr} 在 ${line} 标 0 条跨线（缺 (跨线) 标记；所涉线=${cross.lines.join(',')}）`, false);
      }
      if (crossCount !== (agg.lineCross.get(line) ?? []).length) {
        throw new ProbeError('E_GUARD_CROSS_COUNT', 'invariant', `跨线计数漂移：${line} 标 ${crossCount}，真值 ${(agg.lineCross.get(line) ?? []).length}`, false);
      }
    }
  }
  // DS-3：0 在飞 PR 的线必须 n/a(0) + 0(跨线 0)（禁把看不见当 100%/当无在飞）
  for (const row of env.lines) {
    if (row.line === BASE_LINE) continue;
    const lineName = row.line as LineName;
    if ((agg.linePrs.get(lineName) ?? []).length > 0) continue;
    if (row.s1 !== 'n/a(0)') {
      throw new ProbeError('E_GUARD_ZERO_LINE', 'invariant', `DS-3 违反：${row.line} 0 在飞 PR 却输出 ①=${row.s1}（必须 n/a(0)）`, false);
    }
    if (row.s3 !== '0(跨线 0)') {
      throw new ProbeError('E_GUARD_ZERO_LINE', 'invariant', `DS-3 违反：${row.line} 0 在飞 PR 却输出 ③=${row.s3}（必须 0(跨线 0)）`, false);
    }
  }
  // DS-11 / ② 口径守卫：exceptions **只装 NOT-DONE**；不可判（gaps 的 unjudgeable 项）不得混入
  const unjudgeablePrs = new Set(agg.gaps.filter((gap) => gap.kind === 'unjudgeable').map((gap) => gap.pr));
  for (const entry of env.exceptions) {
    if (entry.code !== 'NOT-DONE' || unjudgeablePrs.has(entry.pr)) {
      throw new ProbeError('E_GUARD_S2_DEGRADED', 'invariant', `② 只装「没做到」：PR#${entry.pr} code=${entry.code} 属不可判项（应在 gaps 不可判栏，降级不计 ②）`, false);
    }
  }
  // ② = 该线 NOT-DONE 明细数（真值取自条件判定，独立于 exceptions 列表 ⇒ 防「exceptions 里数降级」）
  for (const row of env.lines) {
    if (row.line === BASE_LINE) continue;
    const lineName = row.line as LineName;
    const expectedS2 = (agg.lineNotDone.get(lineName) ?? []).length;
    const detailS2 = env.exceptions.filter((entry) => entry.code === 'NOT-DONE' && entry.lines.includes(lineName)).length;
    if (Number(row.s2) !== expectedS2 || detailS2 !== expectedS2) {
      throw new ProbeError('E_GUARD_S2_COUNT', 'invariant', `${row.line} ② 应为 ${expectedS2}（NOT-DONE 明细 ${detailS2}；实际 s2=${row.s2}；不可判不计 ②）`, false);
    }
  }
  // ① 分子分母复算（分母 = 该线**全部已归属 PR**，含不可判/降级 ⇒ fail-closed）
  for (const row of env.lines) {
    if (row.line === BASE_LINE) continue;
    const lineName = row.line as LineName;
    const attributed = (agg.linePrs.get(lineName) ?? []).length;
    if (attributed === 0) continue; // DS-3 已钉 n/a(0)
    const expectedS1 = `${(agg.lineOk.get(lineName) ?? []).length}/${attributed}`;
    if (row.s1 !== expectedS1) {
      throw new ProbeError('E_GUARD_S1', 'invariant', `${row.line} ① 应为 ${expectedS1}（实际 ${row.s1}；分母=已归属 PR（含不可判））`, false);
    }
  }
  // --line：gaps 明细不展开，但必须给全局计数 gaps(global)=<n>（fail-closed：屏幕上印缺口就不许掩盖）
  if (scope !== null) {
    if (env.summary.gaps_global !== agg.gaps.length) {
      throw new ProbeError('E_GUARD_GAPS_COUNT', 'invariant', `--line 的 summary.gaps_global=${String(env.summary.gaps_global)} 与全局 gaps 明细 ${agg.gaps.length} 条不一致`, false);
    }
    const globalLines = renderText(env, scope).filter((line) => line.startsWith('gaps(global)='));
    if (globalLines.length !== 1 || globalLines[0] !== `gaps(global)=${String(agg.gaps.length)}`) {
      throw new ProbeError('E_GUARD_GAPS_COUNT', 'invariant', `--line 文本末行必须恰为 gaps(global)=${String(agg.gaps.length)}（实际 ${globalLines.length} 行：${globalLines.join('|')}）`, false);
    }
  }
  // DS-2：计数 == 明细条数（只约束 gaps）；exceptions 同口径；文本明细行数再兜一层
  if (typeof env.summary.gaps !== 'number' || env.summary.gaps !== env.gaps.length) {
    throw new ProbeError('E_GUARD_GAPS_COUNT', 'invariant', `DS-2 违反：末行 gaps=${String(env.summary.gaps)} 但 gaps 明细 ${env.gaps.length} 条（计数必须等于明细条数）`, false);
  }
  if (typeof env.summary.exceptions !== 'number' || env.summary.exceptions !== env.exceptions.length) {
    throw new ProbeError('E_GUARD_EXCEPTIONS_COUNT', 'invariant', `末行 exceptions=${String(env.summary.exceptions)} 但例外明细 ${env.exceptions.length} 条`, false);
  }
  const detailText = renderText(env, scope);
  if (detailText.filter((line) => line.startsWith('gap: ')).length !== env.gaps.length) {
    throw new ProbeError('E_GUARD_GAPS_COUNT', 'invariant', 'DS-2 违反：文本 `gap: ` 行数 ≠ gaps 明细条数', false);
  }
  if (detailText.filter((line) => line.startsWith('exception: ')).length !== env.exceptions.length) {
    throw new ProbeError('E_GUARD_EXCEPTIONS_COUNT', 'invariant', '文本 `exception: ` 行数 ≠ 例外明细条数', false);
  }
  const expectedExit = env.exceptions.length > 0 || agg.gaps.length > 0 ? 1 : 0;
  if (env.exit !== expectedExit) {
    throw new ProbeError('E_GUARD_EXIT', 'invariant', `三态自洽失败：exit=${env.exit}（例外 ${env.exceptions.length} / 全局缺口 ${agg.gaps.length} ⇒ 期望 ${expectedExit}）`, false);
  }
}

/**
 * 构造 DS-8 信封（含三态 exit）。
 * @param agg 聚合结果
 * @param scope null=全量模式；否则单线模式（lines/exceptions 收窄，gaps 明细不输出但 summary 带 gaps_global）
 * @param knobs 夹具旋钮（drop_gaps_detail / inject_b_metric 是子例 B/E 的改坏正控）
 * @returns 信封与退出码
 */
function buildEnvelope(agg: Aggregation, scope: LineName | null, knobs: Knobs): { env: JsonEnvelope; exit: number } {
  const rows = scope === null ? agg.rows : agg.rows.filter((row) => row.line === scope);
  const exceptions = scope === null ? agg.exceptions : agg.exceptions.filter((entry) => entry.lines.includes(scope));
  const gaps = scope === null && !knobs.dropGapsDetail ? agg.gaps : [];
  // 单线视图不展开 gaps 明细（全局口径）；drop_gaps_detail 是子例 B 正控：明细被丢但计数不改 ⇒ DS-2 必红
  const summaryGaps = knobs.dropGapsDetail ? agg.gaps.length : gaps.length;
  const exit = exceptions.length > 0 || agg.gaps.length > 0 ? 1 : 0;
  const env: JsonEnvelope = {
    tool: TOOL,
    lines: rows.map((row) => ({ line: row.line, s1: row.s1, s2: row.s2, s3: row.s3 })),
    exceptions,
    gaps,
    mapping: { rule_hits: agg.ruleHits },
    summary: {
      lines: rows.length,
      exceptions: exceptions.length,
      gaps: summaryGaps,
      ...(scope === null ? {} : { gaps_global: agg.gaps.length }),
      open_prs: agg.stats.openPrs,
      attributed_prs: agg.stats.attributedPrs,
      single_prs: agg.stats.singlePrs,
      cross_prs: agg.stats.crossPrs,
      unknown_prs: agg.stats.unknownPrs,
      mixed_prs: agg.stats.mixedPrs,
      files_total: agg.stats.filesTotal,
      scope: scope === null ? 'all' : `line:${scope}`,
      limitations: LIMITATIONS,
    },
    exit,
  };
  if (knobs.injectBMetric) {
    // 子例 E 正控：模拟"混入 B 口径键"，由口径守卫抓红（正确实现绝不会走到输出）
    env['bypass_rate'] = 0;
  }
  return { env, exit };
}

/** 输出：--json 时 stdout 仅 JSON（人读行转 stderr）；否则逐行 stdout。 */
function emit(env: JsonEnvelope, scope: LineName | null, jsonMode: boolean): void {
  if (jsonMode) {
    for (const row of env.lines) process.stderr.write(`${renderRow(row)}\n`);
    process.stdout.write(`${JSON.stringify(env, null, 2)}\n`);
    return;
  }
  const lines = renderText(env, scope);
  process.stdout.write(`${lines.join('\n')}\n`);
}

// ─── ⑨ --selfcheck（判别力自检 · 8 子例 A–H；夹具零网络） ────────────────────

/** 子例运行结果（inner 进程的退出码 + stdout + stderr）。 */
interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** 取非空末行（断言末行用）。 */
function lastLine(text: string): string {
  const lines = text.split('\n').filter((line) => line.length > 0);
  return lines.length > 0 ? (lines[lines.length - 1] ?? '') : '';
}

/** 断言 inner exit（只比 exit 会漏红错条件 ⇒ 必须配 token 断言）。 */
function expectExit(actual: number, want: number, label: string, bad: string[]): void {
  if (actual !== want) bad.push(`${label} inner_exit=${actual}（期望 ${want}）`);
}

/** 断言输出含 token。 */
function expectToken(haystack: string, needle: string, label: string, bad: string[]): void {
  if (!haystack.includes(needle)) bad.push(`${label} 缺 token「${needle}」`);
}

/** 断言输出不含 token。 */
function expectNoToken(haystack: string, needle: string, label: string, bad: string[]): void {
  if (haystack.includes(needle)) bad.push(`${label} 出现禁词「${needle}」`);
}

/**
 * 跑一次被测探针（子进程；夹具零网络）。
 * 优先 `node <script>`（Node ≥23.6 原生剥类型）；脚本不在 type=module 包内时回退 `npx tsx <script>`。
 * @param args CLI 参数
 * @param env 追加/覆盖的环境变量
 * @returns inner 退出码与输出
 */
function runChild(args: string[], env: Record<string, string>): RunResult {
  const script = resolve(process.argv[1] ?? '');
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') merged[key] = value;
  }
  for (const [key, value] of Object.entries(env)) merged[key] = value;
  let result = spawnSync(process.execPath, [script, ...args], {
    env: merged,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stderr1 = typeof result.stderr === 'string' ? result.stderr : '';
  const loaderBroken = /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension|Cannot use import statement/.test(stderr1) || (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ENOENT');
  if (loaderBroken) {
    result = spawnSync('npx', ['tsx', script, ...args], {
      env: merged,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  return {
    status: typeof result.status === 'number' ? result.status : 2,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

/** 把夹具写到临时目录并跑一次被测探针（零网络）。 */
function runWithFixture(workDir: string, label: string, fixture: unknown, args: string[]): RunResult {
  const fixturePath = join(workDir, `fixture-${label}.json`);
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2), 'utf8');
  const logPath = join(workDir, `degraded-${label}.log`);
  return runChild(args, { SYNO_LINE_SIGNALS_FIXTURE: fixturePath, SYNO_GATE_DEGRADED_LOG: logPath });
}

/** 全绿四条件。 */
function okConds(): Conditions {
  return { ci: 'ok', overlap: 'ok', review: 'ok', serial: 'ok' };
}

/** 子例 A 的全绿夹具（两条线各 1 个单线 PR）。 */
function greenFixture(): unknown {
  return {
    open_prs: [
      { number: 1, branch: 'ct/a-1', files: ['scripts/control-tower/a.sh'], conditions: okConds() },
      { number: 2, branch: 'ct/a-2', files: ['src/a.ts'], conditions: okConds() },
    ],
  };
}

/** 子例 F/G 的跨线夹具（PR#2 同时含 产品线 与 治理线 文件）。 */
function crossFixture(): unknown {
  return {
    open_prs: [{ number: 1, branch: 'ct/c-1', files: ['src/a.ts'], conditions: okConds() }],
    cross_pr: { number: 2, branch: 'ct/c-2', files: ['src/a.ts', 'scripts/b.sh'], conditions: okConds() },
  };
}

/**
 * 子例 H 夹具：**2 个未通过 PR（四条件全可判、非全 ok）＋ 1 个不可判 PR（条件含 degraded）**，
 * 均属产品线。期望：①=0/3（分母含不可判，fail-closed）、②=2（只装没做到）、
 * ③=3、exceptions=2、gaps=1（不可判栏单列）。
 */
function notDoneFixture(): unknown {
  return {
    open_prs: [
      { number: 21, branch: 'ct/h-1', files: ['src/h1.ts'], conditions: { ci: 'no', overlap: 'no', review: 'no', serial: 'ok' } },
      { number: 22, branch: 'ct/h-2', files: ['src/h2.ts'], conditions: { ci: 'ok', overlap: 'no', review: 'ok', serial: 'ok' } },
      { number: 23, branch: 'ct/h-3', files: ['src/h3.ts'], conditions: { ci: 'degraded', overlap: 'ok', review: 'ok', serial: 'ok' } },
    ],
  };
}

/** 夹具 → 聚合（正控用；与主流程同一条 aggregate 代码路径）。 */
function aggregateFixture(fixture: unknown): Aggregation {
  return aggregate(gatherFromFixture(parseFixture(fixture)), emptyKnobs());
}

/** 正控：把跨线 PR 的 (跨线) 计数硬写成 0（模拟"只归一线/缺标记"）。 */
function mutateCrossHardAssign(agg: Aggregation): Aggregation {
  const mutated = structuredClone(agg);
  const cross = mutated.crossPrs[0];
  if (!cross) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', '夹具无 cross_pr，无法构造 F 正控', false);
  const line = cross.lines[0];
  if (!line) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', 'cross_pr 无所涉线', false);
  const row = mutated.rows.find((candidate) => candidate.line === line);
  if (!row) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', `缺线行 ${line}`, false);
  const prsInLine = mutated.linePrs.get(line) ?? [];
  row.s3 = `${prsInLine.length}(跨线 0)`;
  return mutated;
}

/** 正控：把跨线 PR 从某涉线的 ③/跨线计数里删掉（模拟"漏计 ③ 未 +1"）。 */
function mutateCrossMissing(agg: Aggregation): Aggregation {
  const mutated = structuredClone(agg);
  const cross = mutated.crossPrs[0];
  if (!cross) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', '夹具无 cross_pr，无法构造 G 正控', false);
  const line = cross.lines[0];
  if (!line) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', 'cross_pr 无所涉线', false);
  const keepPrs = (mutated.linePrs.get(line) ?? []).filter((num) => num !== cross.pr);
  const keepCross = (mutated.lineCross.get(line) ?? []).filter((num) => num !== cross.pr);
  mutated.linePrs.set(line, keepPrs);
  mutated.lineCross.set(line, keepCross);
  const row = mutated.rows.find((candidate) => candidate.line === line);
  if (!row) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', `缺线行 ${line}`, false);
  row.s3 = `${keepPrs.length}(跨线 ${keepCross.length})`;
  return mutated;
}

/** 正控：把不可判 PR 塞进 exceptions（模拟旧口径「降级当例外」）⇒ E_GUARD_S2_DEGRADED。 */
function mutateS2Degraded(agg: Aggregation): Aggregation {
  const mutated = structuredClone(agg);
  const unjudgeable = mutated.gaps.find((gap) => gap.kind === 'unjudgeable');
  if (!unjudgeable) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', 'H 夹具无不可判项，无法构造 ② 降级正控', false);
  mutated.exceptions.push({ pr: unjudgeable.pr, line: '产品线', lines: ['产品线'], code: 'E_COND_DEGRADED', no: [], phase: 'cond', retryable: false });
  return mutated;
}

/** 正控：把某线 ② 改成比 NOT-DONE 真值多 1（模拟「按 exceptions 计数」的漂移）⇒ E_GUARD_S2_COUNT。 */
function mutateS2Count(agg: Aggregation): Aggregation {
  const mutated = structuredClone(agg);
  const row = mutated.rows.find((candidate) => candidate.line === '产品线');
  if (!row) throw new ProbeError('E_SELFCHECK_MUTATION', 'selfcheck', 'H 夹具缺产品线行，无法构造 ② 计数正控', false);
  row.s2 = String(Number(row.s2) + 1);
  return mutated;
}

/** 对给定聚合跑一遍守卫，返回它抓到的错误码（NO-ERROR = 守卫没红）。 */
function guardCodeOf(agg: Aggregation): string {
  const knobs = emptyKnobs();
  const built = buildEnvelope(agg, null, knobs);
  try {
    validateInvariants(built.env, agg, null);
    return 'NO-ERROR';
  } catch (err) {
    return err instanceof ProbeError ? err.code : 'E_NON_PROBE';
  }
}

/** 子例 A：全绿基线 ⇒ exit 0；末行 exceptions=0 gaps=0；5 行都出；--json 恰 DS-8 七键且无 B 键。 */
function selfcheckA(workDir: string): string {
  const bad: string[] = [];
  const fixture = greenFixture();
  const run = runWithFixture(workDir, 'A', fixture, ['--all']);
  expectExit(run.status, 0, 'A', bad);
  const last = lastLine(run.stdout);
  if (last !== 'LINE-SIGNALS: lines=5 exceptions=0 gaps=0') {
    bad.push(`A 末行=${JSON.stringify(last)}（期望 LINE-SIGNALS: lines=5 exceptions=0 gaps=0）`);
  }
  expectToken(run.stdout, '产品线 ①(merge-conditions)=1/1 ②=0 ③=1(跨线 0)', 'A 产品线行', bad);
  expectToken(run.stdout, '治理线 ①(merge-conditions)=1/1 ②=0 ③=1(跨线 0)', 'A 治理线行', bad);
  expectToken(run.stdout, 'CTO ①(merge-conditions)=n/a(0) ②=0 ③=0(跨线 0)', 'A CTO 行', bad);
  expectToken(run.stdout, 'K3 ①(merge-conditions)=n/a(0) ②=0 ③=0(跨线 0)', 'A K3 行', bad);
  expectToken(run.stdout, '基座线 ①=n/a(未映射) ②=0 ③=0(跨线 0)', 'A 基座线行', bad);
  const jsonRun = runWithFixture(workDir, 'A-json', fixture, ['--all', '--json']);
  expectExit(jsonRun.status, 0, 'A-json', bad);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(jsonRun.stdout);
  } catch (parseErr) {
    bad.push(`A --json 解析失败：${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
  }
  if (isRecord(parsed)) {
    const keys = Object.keys(parsed).sort().join(',');
    if (keys !== 'exceptions,exit,gaps,lines,mapping,summary,tool') {
      bad.push(`A --json 顶层键=${keys}（期望 DS-8 七键 tool,lines,exceptions,gaps,mapping,summary,exit）`);
    }
  } else if (parsed !== null) {
    bad.push('A --json 顶层不是对象');
  }
  for (const bKey of ['bypass_rate', '绕过', '拒绝', 'M_recur']) {
    expectNoToken(jsonRun.stdout, bKey, 'A B 口径', bad);
  }
  return bad.join('；');
}

/** 子例 B：gaps 明细被丢但计数不改 ⇒ DS-2 守卫必红（exit 2）。 */
function selfcheckB(workDir: string): string {
  const bad: string[] = [];
  const fixture = {
    open_prs: [{ number: 9, branch: 'ct/b-1', files: ['scripts/x.sh'], conditions: okConds() }],
    cross_pr: { number: 10, branch: 'ct/b-2', files: ['src/x.ts', 'scripts/y.sh'], conditions: okConds() },
    drop_gaps_detail: true,
  };
  const run = runWithFixture(workDir, 'B', fixture, ['--all']);
  expectExit(run.status, 2, 'B', bad);
  expectToken(run.stderr, 'degraded:', 'B stderr', bad);
  expectToken(run.stderr, 'E_GUARD_GAPS_COUNT', 'B 守卫码', bad);
  expectToken(run.stderr, 'DS-2', 'B DS-2', bad);
  return bad.join('；');
}

/** 子例 C：0 在飞 PR 的线 ⇒ ①=n/a(0) 且 ③=0(跨线 0)；改坏成 1/1 ⇒ DS-3 守卫必红。 */
function selfcheckC(workDir: string): string {
  const bad: string[] = [];
  const fixture = { open_prs: [{ number: 11, branch: 'ct/c-1', files: ['src/c.ts'], conditions: okConds() }] };
  const run = runWithFixture(workDir, 'C-ok', fixture, ['--all']);
  expectExit(run.status, 0, 'C 基线', bad);
  expectToken(run.stdout, '治理线 ①(merge-conditions)=n/a(0) ②=0 ③=0(跨线 0)', 'C 零线行', bad);
  const brokenFixture = {
    open_prs: [{ number: 11, branch: 'ct/c-1', files: ['src/c.ts'], conditions: okConds() }],
    force_s1: '1/1',
  };
  const brokenRun = runWithFixture(workDir, 'C-bad', brokenFixture, ['--all']);
  expectExit(brokenRun.status, 2, 'C 改坏', bad);
  expectToken(brokenRun.stderr, 'E_GUARD_ZERO_LINE', 'C 守卫码', bad);
  expectToken(brokenRun.stderr, 'DS-3', 'C DS-3', bad);
  return bad.join('；');
}

/** 子例 D：根级失败 ⇒ exit 2 + degraded:（禁把取不到当 0）。 */
function selfcheckD(workDir: string): string {
  const bad: string[] = [];
  const fixture = {
    open_prs: [{ number: 12, branch: 'ct/d-1', files: ['scripts/d.sh'], conditions: okConds() }],
    force_root_fail: true,
  };
  const run = runWithFixture(workDir, 'D', fixture, ['--all']);
  expectExit(run.status, 2, 'D', bad);
  expectToken(run.stderr, 'degraded:', 'D stderr', bad);
  expectToken(run.stderr, 'E_ROOT_SIMULATED', 'D code', bad);
  expectNoToken(run.stdout, 'LINE-SIGNALS: lines=', 'D stdout 不得出机器行', bad);
  return bad.join('；');
}

/** 子例 E：混入 B 口径键 ⇒ 口径守卫必红（exit 2）。 */
function selfcheckE(workDir: string): string {
  const bad: string[] = [];
  const fixture = {
    open_prs: [{ number: 13, branch: 'ct/e-1', files: ['scripts/e.sh'], conditions: okConds() }],
    inject_b_metric: true,
  };
  const run = runWithFixture(workDir, 'E', fixture, ['--all']);
  expectExit(run.status, 2, 'E', bad);
  expectToken(run.stderr, 'E_GUARD_B_METRIC', 'E 守卫码', bad);
  expectToken(run.stderr, '口径守卫', 'E 口径守卫', bad);
  return bad.join('；');
}

/** 子例 F：跨线 PR 两线各计 1 且带 (跨线；硬归一线（缺标记）⇒ 守卫必红。 */
function selfcheckF(workDir: string): string {
  const bad: string[] = [];
  const fixture = crossFixture();
  const run = runWithFixture(workDir, 'F', fixture, ['--all']);
  expectExit(run.status, 1, 'F 正常跨线', bad);
  expectToken(run.stdout, '产品线 ①(merge-conditions)=2/2 ②=0 ③=2(跨线 1)', 'F 产品线行', bad);
  expectToken(run.stdout, '治理线 ①(merge-conditions)=1/1 ②=0 ③=1(跨线 1)', 'F 治理线行', bad);
  expectToken(run.stdout, 'gap: PR#2 cross 产品线,治理线', 'F gap 点名两线', bad);
  expectToken(run.stdout, 'LINE-SIGNALS: lines=5 exceptions=0 gaps=1', 'F 末行', bad);
  const mutated = mutateCrossHardAssign(aggregateFixture(fixture));
  const code = guardCodeOf(mutated);
  if (code !== 'E_GUARD_CROSS_HARDASSIGN') {
    bad.push(`F 硬归正控 code=${code}（期望 E_GUARD_CROSS_HARDASSIGN）`);
  }
  return bad.join('；');
}

/** 子例 G：跨线漏计（某涉线 ③ 未 +1）⇒ 守卫必红；两涉线 ③ 均须含该 PR。 */
function selfcheckG(workDir: string): string {
  const bad: string[] = [];
  const fixture = crossFixture();
  const run = runWithFixture(workDir, 'G', fixture, ['--all']);
  expectExit(run.status, 1, 'G 正常跨线', bad);
  expectToken(run.stdout, '产品线 ①(merge-conditions)=2/2 ②=0 ③=2(跨线 1)', 'G 产品线行', bad);
  expectToken(run.stdout, '治理线 ①(merge-conditions)=1/1 ②=0 ③=1(跨线 1)', 'G 治理线行', bad);
  const mutated = mutateCrossMissing(aggregateFixture(fixture));
  const code = guardCodeOf(mutated);
  if (code !== 'E_GUARD_CROSS_MISSING') {
    bad.push(`G 漏计正控 code=${code}（期望 E_GUARD_CROSS_MISSING）`);
  }
  return bad.join('；');
}

/**
 * 子例 H：2 未通过 ＋ 1 不可判（均产品线）⇒ ①=0/3（分母含降级，fail-closed）、②=2（只装没做到）、
 * ③=3、gaps 含不可判栏、末行 exceptions=2 gaps=1、exit 1；并含两条改坏必红正控
 * （降级混入 exceptions ⇒ E_GUARD_S2_DEGRADED；② 计数漂移 ⇒ E_GUARD_S2_COUNT）。
 */
function selfcheckH(workDir: string): string {
  const bad: string[] = [];
  const fixture = notDoneFixture();
  const run = runWithFixture(workDir, 'H', fixture, ['--all']);
  expectExit(run.status, 1, 'H', bad);
  expectToken(run.stdout, '产品线 ①(merge-conditions)=0/3 ②=2 ③=3(跨线 0)', 'H 产品线行（① 分母含不可判）', bad);
  expectToken(run.stdout, 'gap: PR#23 不可判 E_COND_DEGRADED', 'H 不可判 gap', bad);
  expectToken(run.stdout, 'exception: PR#21 产品线 NOT-DONE NO: ci,overlap,review', 'H NOT-DONE #21', bad);
  expectToken(run.stdout, 'exception: PR#22 产品线 NOT-DONE NO: overlap', 'H NOT-DONE #22', bad);
  const last = lastLine(run.stdout);
  if (last !== 'LINE-SIGNALS: lines=5 exceptions=2 gaps=1') {
    bad.push(`H 末行=${JSON.stringify(last)}（期望 LINE-SIGNALS: lines=5 exceptions=2 gaps=1）`);
  }
  const detailLines = run.stdout.split('\n');
  const exCount = detailLines.filter((line) => line.startsWith('exception: ')).length;
  const gapCount = detailLines.filter((line) => line.startsWith('gap: ')).length;
  if (exCount !== 2) bad.push(`H exception 明细=${exCount} 条（期望 2）`);
  if (gapCount !== 1) bad.push(`H gap 明细=${gapCount} 条（期望 1）`);
  const agg = aggregateFixture(fixture);
  // 改坏必红正控（两条具体码）；构造失败也要指名（不把「抓不到」当「没问题」）
  try {
    const codeDegraded = guardCodeOf(mutateS2Degraded(agg));
    if (codeDegraded !== 'E_GUARD_S2_DEGRADED') {
      bad.push(`H 降级混入 exceptions 正控 code=${codeDegraded}（期望 E_GUARD_S2_DEGRADED）`);
    }
  } catch (mutationErr) {
    bad.push(`H 降级混入 exceptions 正控构造失败：${mutationErr instanceof Error ? mutationErr.message : String(mutationErr)}`);
  }
  try {
    const codeCount = guardCodeOf(mutateS2Count(agg));
    if (codeCount !== 'E_GUARD_S2_COUNT') {
      bad.push(`H ② 计数漂移正控 code=${codeCount}（期望 E_GUARD_S2_COUNT）`);
    }
  } catch (mutationErr) {
    bad.push(`H ② 计数漂移正控构造失败：${mutationErr instanceof Error ? mutationErr.message : String(mutationErr)}`);
  }
  return bad.join('；');
}

/**
 * 判别力自检：跑 A–H 八子例（夹具零网络；F/G/H 含"改坏必红"正控）。
 * 末行 `SELFCHECK-OK: 8/8`（exit 0）/ `SELFCHECK-FAIL: <子例>`（exit 2）。
 * @returns 进程退出码
 */
function selfcheck(): number {
  const workDir = mkdtempSync(join(tmpdir(), 'syno-ls.'));
  const cases: { name: string; run: (dir: string) => string }[] = [
    { name: 'A', run: selfcheckA },
    { name: 'B', run: selfcheckB },
    { name: 'C', run: selfcheckC },
    { name: 'D', run: selfcheckD },
    { name: 'E', run: selfcheckE },
    { name: 'F', run: selfcheckF },
    { name: 'G', run: selfcheckG },
    { name: 'H', run: selfcheckH },
  ];
  let passed = 0;
  try {
    for (const testCase of cases) {
      let reason = '';
      try {
        reason = testCase.run(workDir);
      } catch (caseErr) {
        reason = caseErr instanceof Error ? caseErr.message : String(caseErr);
      }
      if (reason.length === 0) {
        passed += 1;
        process.stdout.write(`[selfcheck] ${testCase.name} ok（inner exit ＋ 输出 token 双断言通过）\n`);
      } else {
        process.stdout.write(`[selfcheck] ${testCase.name} ✗ ${reason}\n`);
        process.stdout.write(`SELFCHECK-FAIL: ${testCase.name}（${reason}）\n`);
        return 2;
      }
    }
    process.stdout.write(`SELFCHECK-OK: ${passed}/${cases.length}\n`);
    return 0;
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      process.stderr.write(`warn: 临时目录清理失败（${workDir}）：${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}\n`);
    }
  }
}

// ─── ⑩ main 编排 ──────────────────────────────────────────────────────────────

/**
 * 主流程：参数 → 取数 → 聚合 → 判据守卫 → 输出 → 三态退出码。
 * @param argv process.argv.slice(2)
 * @returns 进程退出码（0/1/2）
 */
async function main(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${usageText()}\n`);
    return 0;
  }
  let cfg: Config;
  try {
    cfg = loadConfig(argv);
  } catch (configErr) {
    return degrade(configErr, argv.includes('--json'), defaultDegradedLog());
  }
  if (cfg.mode === 'selfcheck') return selfcheck();
  try {
    const gathered = await gather(cfg);
    const knobs = knobsOf(gathered.fixture);
    const agg = aggregate(gathered.prs, knobs);
    const built = buildEnvelope(agg, cfg.line, knobs);
    validateInvariants(built.env, agg, cfg.line);
    emit(built.env, cfg.line, cfg.json);
    return built.exit;
  } catch (err) {
    return degrade(err, cfg.json, cfg.degradedLog);
  }
}

// 无 top-level await：保证被复制到仓外（无 "type":"module" 的目录）时 tsx 的 CJS 转译也能跑（外部突变复核要求）。
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((uncaught: unknown) => {
    // 最后一道 fail-loud：main 已内部收敛，此处只兜未预期异常（绝不静默退出 0）
    process.stderr.write(`degraded: 未捕获异常：${uncaught instanceof Error ? uncaught.message : String(uncaught)} [code=E_UNEXPECTED]\n`);
    process.exitCode = 2;
  });
