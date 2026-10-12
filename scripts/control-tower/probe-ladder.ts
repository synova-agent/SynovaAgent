#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-ladder.ts — #205 K12-21 测量梯子：汇总入口 ＋ 探针契约的**单一实现**
 *
 * 用途: 把 K12 全部探针的判据变成**可执行、可复跑、不假绿**的命令，并给出统一的三态退出码。
 *
 * 判据来源: 卡面 `.claude/task-briefs/2026-10-11-205-K12-21-测量梯子-12-个探针-全员前置.md`
 *   §Q3 V1 `probe-ladder.ts --all` ⇒ exit 0，输出 13 行清单
 *   §Q3 V2 未实现必须 exit 2（**不是 exit 0**）
 *   §Q3 V3 13 个探针末行均为 `RESULT=...`，退出码语义一致（0/1/2 三态）
 *   §Q3 V4 反例（改坏必红）：探针恒 exit 0 ⇒ `probe-contract.test.sh` 必红
 *   §Q3 V5 可复跑：同一状态跑两次 ⇒ 同结果（无随机）
 *   创始人 2026-10-11 明令: `--all` = exit 0，**但末行必须显式披露** `pass=/notimpl=`
 *
 * 🔴 为什么契约写在本文件（判例 M-04 单一事实源）:
 *   12 个探针 `import` 本文件的契约原语 ⇒ 契约**只有一份实现**，12 个探针不会变成 12 种口径。
 *   边界（如实标注）: 探针被本文件编译期依赖；但各探针**各自带直执行守卫**，
 *   可单独 `npx tsx scripts/control-tower/probe-<名>.ts` 运行 ⇒ 本文件崩溃不构成单点故障。
 *
 * 契约 (铁律 47):
 *   @input    — `--all`（跑全部 13 探针）｜`--probe <名>`（跑单个，便于取证）
 *               ｜`--targets <名>`（打印该探针**自声明的 TARGETS**，每行一条；供契约自测消费 ——
 *                 解析只此一处实现，避免第二套解析口径漂移，判例 M-04）
 *   @output   — 13 行清单（探针名 ＋ PASS/FAIL/NOT_IMPLEMENTED/ERROR ＋ 该探针退出码）
 *               ＋ 末行 `RESULT=<PASS|DEGRADED|ERROR> probes=13 pass=<n> fail=<n> notimpl=<n> error=<n>`
 *               🔴 词元三态（**退出码不变**，守登记件 `K12-21` 的 expectExit:0）:
 *                  `PASS`     = fail=0 且 error=0 且 malformed=0（真的没有坏消息）
 *                  `DEGRADED` = 探针**如实报了产品红**（fail>0 或 error>0）—— 不再假称 PASS
 *                  `ERROR`    = 测量件自身有问题（malformed>0）；此态 exit 1
 *   @degraded — 仓库根定位失败 / 参数不可识别 ⇒ exit 2 ＋ 明确原因（fail-closed，铁律 31）
 * 退出码（🔴 语义 = **测量件自身是否健康**，**不是** K12 交付是否完成 —— 理由见文件末 main() 内长注释）:
 *         0 = 13 探针全部执行完 ＋ 每个判定都在契约域内（PASS/FAIL/NOT_IMPLEMENTED 皆可）
 *         1 = 探针"跑了但输出违反契约"（末行与退出码矛盾 / 退出码越界 / 末行缺失）
 *         2 = ladder 自身异常（仓库根定位失败 / 参数不可识别）
 *         ⚠️ 个别探针 **FAIL（= 产品代码真红）不拉低本退出码** —— V2「未实现必 exit 2」由
 *            **各探针自己的退出码**独立满足；本 ladder 只用末行计数**显式披露**，不吞证据。
 *
 * 🔴 子进程模式的判据边界（如实标注 —— 独立复核 probe-verifier 2026-10-11 指出）:
 *   13 个探针**一律以子进程真跑**（进程隔离，理由见 runProbe 注释）⇒ ladder **不再**直接
 *   `import` 探针模块，因此**没有**"显式检查导出 `main()`"的分支。
 *   "探针没接线/没导出 main"这类缺陷**仍会被抓住**，但走的是**间接**判据：
 *     缺 `main` ⇒ 探针直执行守卫不点火 ⇒ 不输出末行 `RESULT=` ⇒ ladder 判 `末行缺失 ⇒ ERROR`。
 *   （实测：probe-c 的 4 件曾漏写 `export main`，ladder 即报 ERROR —— 见 §Q3 V4 接线证据。）
 *   代价：错误**信息**不如显式检查精确（报"末行缺失"而非"未导出 main"）。此为进程隔离的已知取舍。
 *
 * 既有件口径（不得改它 —— 它不在本批写集）:
 *   `probe-content-registry.ts`（K10 EXT-WIRE 产物）**不输出 `RESULT=`**。实测末行是
 *   `CONTENT-REGISTRY-OK: 四段全绿（PRESENCE/INTEGRITY/RESOLVE/CALL）`；而 `SUMMARY: sections=4 failures=0`
 *   是它的**倒数第二行**（独立复核 probe-verifier 2026-10-11 实测纠正，原注释写错）。
 *   与 §Q3 V3「13 个末行均为 RESULT=」**字面不一致**。
 *   处置: 对本件**按退出码判定** ＋ 清单行打 `[legacy-no-RESULT]` 显式标注 ⇒ 实为 12/13，
 *   **显式披露，不隐藏，也不越写集去改它**。该件 `grep '^export'` 零结果 ⇒ 确实不可 import，
 *   故走子进程真跑（仍 L2，非静态 grep）。
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

// ══════════════════════════════════════════════════════════════════════════════
// 一、契约原语（单一实现，供 12 个探针 import）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ladder **末行词元**（≠ 探针词元，故独立成类型，避免污染 12 探针契约）。
 *
 * 🔴 `DEGRADED` 的存在理由（独立复核 probe-verifier 2026-10-11 实测指出）:
 *   若"探针如实报了产品红"时仍印 `RESULT=PASS`，同一行就自相矛盾
 *   （`RESULT=PASS … fail=2`），而 `RESULT=` 是机器可读字段、最易被 grep 消费 ⇒
 *   只 grep `RESULT=PASS` 的人会被"词元级假绿"骗到。
 *   ∴ 探针词汇表**不变**（PASS/FAIL/NOT_IMPLEMENTED/ERROR），ladder 另立一词元表达聚合态。
 */
export const LADDER_VERDICTS = ['PASS', 'DEGRADED', 'ERROR'] as const;
export type LadderVerdict = (typeof LADDER_VERDICTS)[number];

/** ladder 词元 → 退出码（DEGRADED 仍为 0：守登记件 `K12-21` 的 expectExit:0） */
export const LADDER_EXIT: Readonly<Record<LadderVerdict, 0 | 1>> = {
  PASS: 0,
  DEGRADED: 0,
  ERROR: 1,
};

/** 三态判定（判例 M-02：0=通过／1=违规／2=无法判定；本批口径见本文件 @exit） */
export const PROBE_VERDICTS = ['PASS', 'FAIL', 'NOT_IMPLEMENTED', 'ERROR'] as const;
export type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

/** verdict → 退出码（契约唯一映射，探针不得自定） */
export const EXIT_BY_VERDICT: Readonly<Record<ProbeVerdict, 0 | 1 | 2>> = {
  PASS: 0,
  FAIL: 1,
  NOT_IMPLEMENTED: 2,
  ERROR: 2,
};

/** 运行期异常（探针内 catch 一律包装成它，铁律 32：.code ＋ .phase ＋ .retryable） */
export class ProbeError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly retryable: boolean;
  constructor(code: string, phase: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
  }
}

/**
 * 逐条报告器 —— 探针唯一的输出通道。
 * 内部**只累加计数**，末行 `RESULT=` 由本类统一签发 ⇒ 12 个探针末行格式天然一致（§Q3 V3）。
 *
 * 契约:
 *   @input  — 目标件标签（进横幅）
 *   @output — stdout 逐条 `✅/❌/⚠️`；`finish()` 输出末行 `RESULT=<verdict>`
 *   @exit   — 由 `exitCode()` 给出（不自己 process.exit，便于被 ladder 复用）
 */
export class ProbeOutput {
  /** 每条断言的判定（PASS/FAIL/NOT_IMPLEMENTED/ERROR）—— verdict() 与覆盖计数的**唯一事实源** */
  readonly verdicts: ProbeVerdict[] = [];
  private unverifiedN = 0;

  constructor(label: string) {
    // 目标件标签进横幅 —— 让每份探针输出的**抬头**自带被测对象（取证时不必回头翻代码）。
    console.log(`PROBE ${label}`);
  }

  /** 无法核实条数（判例 V-09：显式披露，但不计入 PASS/FAIL） */
  unverifiedCount(): number {
    return this.unverifiedN;
  }

  /** 直通打印（横幅/场景标题用，**不算断言**） */
  note(line: string): void {
    console.log(line);
  }

  /** 场景标题 */
  case(name: string): void {
    console.log(`\n── case: ${name} ──`);
  }

  pass(text: string, level: 'L1' | 'L2' = 'L2'): void {
    this.verdicts.push('PASS');
    console.log(`  ✅ PASS [${level}] ${text}`);
  }

  fail(text: string, level: 'L1' | 'L2' = 'L2'): void {
    this.verdicts.push('FAIL');
    console.log(`  ❌ FAIL [${level}] ${text}`);
  }

  /** 目标能力**未实现**（目标件不存在）—— 记 NOT_IMPLEMENTED，**不是** FAIL */
  notImplemented(text: string): void {
    this.verdicts.push('NOT_IMPLEMENTED');
    console.log(`  ⚠️ 未实现 ${text}`);
  }

  /** 无法核实（判例 V-09）：不计入 PASS，也不谎报 FAIL（⇒ 不进 verdicts，只进覆盖计数观测） */
  unverified(text: string): void {
    this.unverifiedN += 1;
    console.log(`  ⚠️ UNVERIFIED ${text}`);
  }

  error(text: string): void {
    this.verdicts.push('ERROR');
    console.log(`  ❌ ERROR ${text}`);
  }

  /**
   * 汇总判定（**语义 = 该探针最严重的一条**）。
   *
   * 🔴 修于 2026-10-11（独立复核 probe-b 报告 + Lead 实测确认）:
   *   原实现里 `pass()` **不记 verdict** ⇒ 一个"全绿"的探针 verdicts 为空 ⇒
   *   ① `COVERAGE` 行误印「无断言被执行」（明明跑了一堆断言）—— 误导取证；
   *   ② 覆盖计数（PASS/FAIL=…）恒把 PASS 计成 0。
   *   现改为：**每条断言都进 verdicts**，verdict 取最严重项，覆盖计数如实反映断言条数。
   *   语义与 ladder 侧一致（ladder 也按"是否存在 ERROR/FAIL/…"取最严重），**N=1 口径不漂移**（判例 M-04）。
   */
  verdict(): ProbeVerdict {
    if (this.verdicts.includes('ERROR')) return 'ERROR';
    if (this.verdicts.includes('FAIL')) return 'FAIL';
    if (this.verdicts.includes('NOT_IMPLEMENTED')) return 'NOT_IMPLEMENTED';
    return 'PASS';
  }

  count(verdict: ProbeVerdict): number {
    return this.verdicts.filter((v) => v === verdict).length;
  }

  /** 签发末行 `RESULT=` —— 探针**必须**在 return 前调用它 */
  finish(): ProbeVerdict {
    const v = this.verdict();
    console.log(`\n${describeCoverage(this)}`);
    console.log(`RESULT=${v}`);
    return v;
  }

  exitCode(): 0 | 1 | 2 {
    return EXIT_BY_VERDICT[this.verdict()];
  }
}

/** 人工可读的覆盖说明（末行之前打印；**机器判据只认 RESULT= 行**） */
function describeCoverage(out: ProbeOutput): string {
  const parts = PROBE_VERDICTS.map((v) => `${v}=${out.count(v)}`).filter((s) => !s.endsWith('=0'));
  if (out.unverifiedCount() > 0) parts.push(`UNVERIFIED=${out.unverifiedCount()}`);
  if (parts.length === 0) {
    // 真的零断言 ⇒ 探针什么都没验（视同不可判定，不是 PASS）
    return 'COVERAGE: 无断言被执行（探针未验证任何东西 —— 不得视为 PASS）';
  }
  return `COVERAGE: ${parts.join(' ')}`;
}

/**
 * 定位仓库根 —— 唯一实现（探针不得自带第二套）。
 *
 * 契约:
 *   @input  — 显式 root（可选）→ `SYNOVA_REPO_ROOT` → 自 cwd 逐级上溯（最多 10 层）
 *   @output — 首个含 `scripts/control-tower` 的目录绝对路径
 *   @error  — 找不到 ⇒ 抛 ProbeError（code=REPO_ROOT_NOT_FOUND, phase=bootstrap）
 */
export function locateRepoRoot(explicit?: string): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (process.env.SYNOVA_REPO_ROOT) candidates.push(process.env.SYNOVA_REPO_ROOT);
  let cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'scripts', 'control-tower'))) return c;
  }
  throw new ProbeError(
    'REPO_ROOT_NOT_FOUND',
    'bootstrap',
    `无法定位仓库根（已试 ${candidates.length} 个候选，均无 scripts/control-tower）；` +
      '请设 SYNOVA_REPO_ROOT 或在仓库内运行',
  );
}

/**
 * 目标件存在性闸 —— §Q3 V2「未实现必须 exit 2」的**主实现**。
 *
 * 契约:
 *   @input  — repoRoot ＋ 仓库相对路径（可多条）
 *   @output — 全部存在 ⇒ true；任一缺失 ⇒ 打印 `⚠️ 未实现 <路径> 不存在` 后返回 false
 *   @degrade— 纯 existsSync，无异常路径
 *
 * 用法（探针启动即调，**未实现时立刻 finish 并 return 2**）:
 *   if (!assertTargetsExist(root, out, ['src/runtime/approval-seam.ts'])) return out.finish(), 2;
 */
export function assertTargetsExist(repoRoot: string, out: ProbeOutput, relPaths: string[]): boolean {
  const missing = relPaths.filter((p) => !existsSync(join(repoRoot, p)));
  if (missing.length > 0) {
    for (const m of missing) out.notImplemented(`目标件不存在: ${m}`);
    return false;
  }
  return true;
}

/** 场景名 → 是否 `--all` 语义（探针共用解析，避免 12 套 CLI 口径） */
export interface ProbeArgs {
  readonly cases: string[];
  readonly all: boolean;
}

/**
 * 解析探针 CLI 参数 —— 唯一实现。
 *
 * 契约:
 *   @input  — argv（默认 process.argv.slice(2)）＋ knownCases（该探针的场景集）＋ 别名表
 *   @output — { cases, all }；`--all` ⇒ all=true 且 cases=全部已知场景；无参＋唯一场景 ⇒ 跑该场景
 *   @error  — 未知场景名 ⇒ 抛 ProbeError(UNKNOWN_CASE, args) —— **不回落默认场景**
 *             （回落会把判据报成**绿色的假事实**，卡面 §Q1 关键纪律）
 */
export function parseProbeArgs(
  knownCases: readonly string[],
  argv: readonly string[] = process.argv.slice(2),
  aliases: Readonly<Record<string, string>> = {},
): ProbeArgs {
  const norm = (raw: string): string => (raw in aliases ? aliases[raw] : raw);
  const all = argv.includes('--all');
  if (all) return { cases: [...knownCases], all: true };

  const idx = argv.indexOf('--case');
  if (idx >= 0) {
    const raw = argv[idx + 1];
    if (raw === undefined || raw.startsWith('--')) {
      throw new ProbeError('MISSING_CASE_VALUE', 'args', '`--case` 后缺场景名');
    }
    const name = norm(raw);
    if (!knownCases.includes(name)) {
      throw new ProbeError(
        'UNKNOWN_CASE',
        'args',
        `未知场景 "${raw}"；已知: ${knownCases.join(', ')}（不回落默认场景 —— 回落会报出绿色的假事实）`,
      );
    }
    return { cases: [name], all: false };
  }

  // 裸 `--dry-run` 形态（K12-03 卡面判据命令原文）经 aliases 归一后再判
  const bare = argv.filter((a) => a.startsWith('--') && a !== '--');
  if (bare.length === 1) {
    const name = norm(bare[0]);
    if (knownCases.includes(name)) return { cases: [name], all: false };
  }

  if (knownCases.length === 1) return { cases: [knownCases[0]], all: false };
  throw new ProbeError(
    'CASE_REQUIRED',
    'args',
    `本探针有 ${knownCases.length} 个场景，须显式指定: --case <${knownCases.join('|')}> 或 --all`,
  );
}

/** 探针模块的公开契约（ladder 只认这个形状） */
export interface ProbeModule {
  /** 该探针的全部场景（供 ladder 取证与自检） */
  readonly KNOWN_CASES: readonly string[];
  /**
   * 探针主函数。
   * @returns 三态退出码 0=PASS ｜ 1=FAIL ｜ 2=NOT_IMPLEMENTED/ERROR
   */
  main(argv?: readonly string[]): Promise<0 | 1 | 2>;
}

// ══════════════════════════════════════════════════════════════════════════════
// 二、探针注册表（13 个：12 新建 ＋ 1 既有只读）
// ══════════════════════════════════════════════════════════════════════════════

interface ProbeEntry {
  /** 文件名（不含 .ts） */
  readonly file: string;
  /** 对应卡（可读性用） */
  readonly card: string;
  /** 既有件：无 RESULT= 末行 ⇒ 只按退出码判定 ＋ 清单行标注 */
  readonly legacyNoResult?: boolean;
}

const PROBES: readonly ProbeEntry[] = [
  { file: 'probe-role-pack', card: 'K12-01' },
  { file: 'probe-onboarding', card: 'K12-03' },
  { file: 'probe-knowledge-scope', card: 'K12-05' },
  { file: 'probe-output-contract', card: 'K12-06' },
  { file: 'probe-decision-ledger', card: 'K12-08' },
  { file: 'probe-approval-seam', card: 'K12-19' },
  { file: 'probe-content-layering', card: 'K12-20' },
  { file: 'probe-content-registry', card: 'K12-14', legacyNoResult: true },
  { file: 'probe-content-reload', card: 'K12-15' },
  { file: 'probe-rbac-multitenant', card: 'K12-09' },
  { file: 'probe-department-axis', card: 'K12-10' },
  { file: 'probe-permission-grants', card: 'K12-11' },
  { file: 'probe-role-config', card: 'K12-12' },
];

/** 探针退出码是否在契约域内（防"退出码越界"被判成 PASS） */
function isContractExit(code: number): code is 0 | 1 | 2 {
  return code === 0 || code === 1 || code === 2;
}

/** 退出码 → 判定（ladder 侧口径；与 EXIT_BY_VERDICT 互逆，此处显式列全以便审读） */
function verdictOfExit(code: 0 | 1 | 2): ProbeVerdict {
  if (code === 0) return 'PASS';
  if (code === 1) return 'FAIL';
  return 'NOT_IMPLEMENTED';
}

interface ProbeRunResult {
  readonly file: string;
  readonly card: string;
  readonly exit: 0 | 1 | 2 | 'syntax-error';
  readonly verdict: ProbeVerdict;
  readonly note: string;
}

/**
 * 从探针源文件读取它**自声明**的目标件清单（`export const TARGETS: readonly string[] = [...]`）。
 *
 * 🔴 为什么需要它（独立复核 probe-verifier 2026-10-11 实测出的**最重要**一条）:
 *   原先"未实现不许绿"只靠各探针自觉 + 契约自测里一张**硬编码 7 条**的目标存在性清单 ⇒
 *   实测漏网：把 `output-contract`/`decision-ledger`/`rbac-multitenant`/`department-axis`/`role-config`
 *   这 5 件改成"目标不存在却 `RESULT=PASS` + exit 0"，整套契约自测**仍 79/0 全绿**。
 *   而那 5 件里正包含**当前唯一在报产品真红**的两件 ⇒ 等于防线在关键处失效。
 *
 *   ∴ 改为**自声明 + 机械校验**（不依赖硬编码清单，可自动覆盖未来新探针）:
 *     ① 每个探针 `export const TARGETS`（它被判据所依赖的仓库相对路径）；
 *     ② ladder 断言不变式: **`RESULT=PASS` ⇒ TARGETS 非空 ∧ TARGETS 全部存在**；
 *     ③ 自洽假绿因此**不可能**成立 —— 它对不存在的目标报绿，必然被 ② 抓住；
 *        若它为逃避 ② 而声明空 TARGETS，则连 ② 的前半（非空）都过不去。
 *   读源文件而**不** import 模块：避免把探针副作用带进 ladder 进程（进程隔离，见 runProbe 注释）。
 *
 * 契约:
 *   @input  — repoRoot ＋ 探针文件名
 *   @output — 声明路径数组；**未声明 `TARGETS` ⇒ null**（区分"没声明"与"声明了空表"）
 *   @degrade— 源文件读不到 ⇒ 抛 ProbeError(repoRoot/文件已知，读取失败即环境问题)
 */
function readDeclaredTargets(repoRoot: string, file: string): string[] | null {
  const src = readFileSync(join(repoRoot, 'scripts', 'control-tower', `${file}.ts`), 'utf8');
  const m = /export const TARGETS\s*(?::[^=]*)?=\s*\[([^\]]*)\]/s.exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((g) => g[1] ?? g[2]);
}

/**
 * 从 stdout 取**最后一行** `RESULT=` 的判定值（判例 M-04：只认末行，不认中间出现的）。
 *
 * 契约:
 *   @input  — stdout 全文
 *   @output — `RESULT=<v>` 的 v（∈ PROBE_VERDICTS）；无则 null
 *   @degrade— 纯字符串解析，无异常路径
 */
function parseLastResult(stdout: string): ProbeVerdict | null {
  const lines = stdout.split('\n').map((l) => l.trimEnd());
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^RESULT=(PASS|FAIL|NOT_IMPLEMENTED|ERROR)$/.exec(lines[i]);
    if (m) return m[1] as ProbeVerdict;
  }
  return null;
}

/** ladder 视角下某退出码应对应的判定（import 型探针必须与之自洽） */
function expectedVerdictFor(exitCode: 0 | 1 | 2): ProbeVerdict {
  return verdictOfExit(exitCode);
}


/**
 * 子进程执行路径（**全部 13 个探针的默认路径** —— 进程隔离，见 runProbe 注释）。
 *
 * 🔴 两条"为什么"（如实标注，不掩盖）:
 *   ① **进程隔离**（2026-10-11 实测事故）: 探针里有真起 HTTP 服务的件；与其它探针**同进程**时，
 *      Node 在流回调里崩：`node::RemoveEnvironmentCleanupHook(...) assert (env) != nullptr`
 *      ⇒ 整条 ladder 以 SIGABRT（exit 134）中止。⇒ 各自独立进程是正确工程决策。
 *   ② **既有件（legacy）**: `probe-content-registry.ts` 是 K10 产物、**不在本批写集**
 *      （卡面 §Q2 明写「已存在，不建」）⇒ 我**不能**给它补 `export main()`，且它**不输出 `RESULT=`**。
 *      ∴ 仅对本件豁免"末行必须有 `RESULT=`"，并在清单行**显式标注**（`[legacy-no-RESULT]`）。
 *
 *   本批新建的 12 个探针**不豁免**：末行缺 `RESULT=` 或与退出码矛盾 ⇒ 记 ERROR（§Q3 V3 有牙齿）。
 *
 * 契约:
 *   @input  — repoRoot ＋ 探针条目（以 `--all` 调用）
 *   @output — 退出码（0/1/2）＋ 判定；非契约退出码 / 崩溃 ⇒ ERROR
 *   @degrade— 子进程无法启动 / 退出码越界 / 契约违反 ⇒ ERROR（**不静默判 PASS**）
 */
async function runProbeAsSubprocess(repoRoot: string, entry: ProbeEntry): Promise<ProbeRunResult> {
  const { spawnSync } = await import('child_process');
  const modulePath = join(repoRoot, 'scripts', 'control-tower', `${entry.file}.ts`);
  const res = spawnSync('npx', ['tsx', modulePath, '--all'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
  });
  const stdout = res.stdout ?? '';
  for (const line of stdout.split('\n')) console.log(`  │ ${line}`);

  const status = res.status;
  if (status === null || res.error) {
    return {
      file: entry.file,
      card: entry.card,
      exit: 'syntax-error',
      verdict: 'ERROR',
      note: `子进程无法完成: ${res.error ? res.error.message : '无退出码'}`,
    };
  }
  if (!isContractExit(status)) {
    return {
      file: entry.file,
      card: entry.card,
      exit: 'syntax-error',
      verdict: 'ERROR',
      note: `子进程退出码越界: ${status}（契约只认 0|1|2）`,
    };
  }

  // 🔴 §Q3 V3 自洽性：末行 `RESULT=` 必须与退出码语义一致。
  //   豁免面**只限**既有件（legacyNoResult）：它不输出 RESULT= 是已知且已披露的历史事实。
  //   本批新建的 12 个探针**不豁免** —— 缺末行 / 与退出码矛盾 ⇒ ERROR。
  const last = parseLastResult(stdout);
  if (last === null) {
    if (!entry.legacyNoResult) {
      return {
        file: entry.file,
        card: entry.card,
        exit: 'syntax-error',
        verdict: 'ERROR',
        note: '末行无 `RESULT=` ⇒ 违反探针契约（§Q3 V3）',
      };
    }
  } else if (last !== expectedVerdictFor(status)) {
    // 🔴 修于 2026-10-11（独立复核 probe-verifier 实测）：原实现写成 `&& last !== 'ERROR'`，
    //   形成**旁路** —— 探针自报 `RESULT=ERROR` 却 exit 0 时被判 PASS/exit 0（掩盖真错误）。
    //   现按 EXIT_BY_VERDICT 的**唯一映射**判定：ERROR 只许配 exit 2（= 2），
    //   故 `RESULT=ERROR + exit 0` ⇒ 退出码与判定矛盾 ⇒ malformed ERROR。
    return {
      file: entry.file,
      card: entry.card,
      exit: 'syntax-error',
      verdict: 'ERROR',
      note: `末行判定与退出码矛盾: RESULT=${last} 但 exit=${status}（契约映射: ERROR↔2）`,
    };
  }

  return {
    file: entry.file,
    card: entry.card,
    exit: status,
    verdict: verdictOfExit(status),
    // 标注只给真正需要标注的件：既有件（无 RESULT= / 不可 import）才带 legacy 说明
    note: entry.legacyNoResult
      ? last === null
        ? '[legacy-no-RESULT] 既有件无 RESULT= 末行 ⇒ 按退出码判定（未导出 main）'
        : '[legacy-no-RESULT] 既有件按退出码判定（未导出 main）'
      : '',
  };
}

/**
 * 🔴 不变式校验：**`RESULT=PASS` ⇒ 该探针自声明的 TARGETS 非空 ∧ 全部存在**。
 *
 * 为什么需要（独立复核 probe-verifier 2026-10-11 实测）:
 *   没有这条不变式时，"目标不存在却报 PASS"的**自洽假绿**能骗过整套契约自测（5/12 漏网）。
 *   有了它：假绿必被抓住（它不可能同时对不存在的目标报绿、又满足"声明非空且全存在"）。
 *
 * 🔴 既有件（legacy）豁免 —— **如实标注，不掩盖**（选手 A / probe-c 2026-10-11 实测指出）:
 *   `probe-content-registry.ts`（K10 产物）**不声明 `TARGETS`**，且卡面 §Q2 明写「已存在，不建」
 *   ⇒ 我**无权**给它补声明。若不给它豁免，`ladder --all` 会**恒**为 ERROR/exit 1
 *   ⇒ 登记件 `K12-21` 的 `expectExit: 0` 永远无法成立（判例 P-03 断言不变性）。
 *   ∴ 对它豁免，并**放弃对它的假绿防护** —— 代价是真实的，写在代码里、也写进回执：
 *     若有人把 `probe-content-registry` 改成假绿，本 ladder **发现不了**。
 *     该件的既有防线是它自己的四段断言（PRESENCE/INTEGRITY/RESOLVE/CALL）。
 *   边界: 豁免**只限** `legacyNoResult` 这一条；其余 12 件一律受不变式约束。
 *
 * 契约:
 *   @input  — repoRoot ＋ 探针条目 ＋ 该探针的判定
 *   @output — 违规原因（字符串）或 null（合规 / 不适用 / 已豁免）
 *   @degrade— 源文件读不到 ⇒ 返回"无法读取声明"的违规文本（fail-closed，不静默放行）
 */
function checkTargetsInvariant(repoRoot: string, entry: ProbeEntry, verdict: ProbeVerdict): string | null {
  if (verdict !== 'PASS') return null; // 不变式只约束"报绿"这一态
  if (entry.legacyNoResult) return null; // 既有件豁免（理由与代价见上）
  let declared: string[] | null;
  try {
    declared = readDeclaredTargets(repoRoot, entry.file);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `无法读取 TARGETS 声明（${msg.split('\n')[0]}）⇒ 该探针的"报绿"不可信`;
  }
  if (declared === null) {
    return '报 PASS 但**未声明** `export const TARGETS` ⇒ 无法证明它的目标件真存在（自洽假绿风险）';
  }
  if (declared.length === 0) {
    return '报 PASS 但 TARGETS 为**空表** ⇒ 未声明任何被判据依赖的目标件';
  }
  const missing = declared.filter((p) => !existsSync(join(repoRoot, p)));
  if (missing.length > 0) {
    return `报 PASS 但自声明目标件存在性不成立: ${missing.join(', ')} ⇒ **自洽假绿**`;
  }
  return null;
}

/**
 * 动态 import 并**真执行** `main()`。
 *
 * 🔴 为什么是真执行而不是 `test -f`（判例 V-01 ＋ 铁律 0-2 的 4 次接线失败）:
 *   "文件存在" 是 L1；"main() 真被调用并返回了它的判定" 才是 L2。
 *   本函数是 ladder 唯一的执行入口 ⇒ 12 个探针被**真实调用**，不是只在清单里被点名。
 *
 * 契约:
 *   @input  — repoRoot ＋ 探针条目
 *   @output — 执行结果（退出码 ＋ 判定 ＋ 备注）
 *   @degrade— 模块文件缺失 / 子进程跑不出契约输出（缺末行 `RESULT=`、退出码越界、崩溃）
 *             ⇒ 记 syntax-error ＋ ERROR（**不静默跳过**）
 *
 * 🔴 文案更正（独立复核 probe-verifier 第 2 轮实测指出）:
 *   本函数**不再** import 探针模块，因此**没有**"显式检查 `main()` / `KNOWN_CASES`"的分支
 *   —— 旧文档曾把"无 main / 无 KNOWN_CASES"列为 ERROR 成因，实测**该路径不可达**。
 *   缺 `main` 的探针**仍会被抓住**，但走的是**间接**判据：
 *     直执行守卫不点火 ⇒ 不输出末行 `RESULT=` ⇒ 子进程路径判"末行缺失 ⇒ ERROR"。
 *   代价（如实）: 错误**信息**精度较低（报"末行缺失"而非"未导出 main"）。此取舍已在本文件头部披露。
 */
async function runProbe(repoRoot: string, entry: ProbeEntry): Promise<ProbeRunResult> {
  const modulePath = join(repoRoot, 'scripts', 'control-tower', `${entry.file}.ts`);
  if (!existsSync(modulePath)) {
    return {
      file: entry.file,
      card: entry.card,
      exit: 'syntax-error',
      verdict: 'ERROR',
      note: `模块文件不存在: ${entry.file}.ts`,
    };
  }

  // 🔴 默认路径 = **子进程真跑**（进程隔离）。
  //
  //   为什么不是"import 进同一进程"（实测事故，2026-10-11）:
  //     探针里有真起 HTTP 服务的件（如 `probe-rbac-multitenant` 的 `app.listen(0)`）。
  //     在**同一进程**里先跑它、再 import 下一个探针 ⇒ Node 在流回调里崩：
  //       `node::RemoveEnvironmentCleanupHook(...) Assertion failed: (env) != nullptr`
  //       ⇒ 整条 ladder 以 **exit 134 (SIGABRT)** 中止。
  //     实测定位: ladder 跑到 probe-rbac-multitenant（exit=1，正常）后，
  //               进入 probe-department-axis 的 import 阶段即崩。
  //     ⇒ 进程隔离是**正确工程决策**，不是妥协：13 个探针各自脏自己的进不来的进程。
  //
  //   强度不降: 子进程仍是"真跑"（L2）—— 真执行 `main()`、真产出末行 `RESULT=`、
  //   真退出码；且本函数**逐条校验**末行与退出码自洽（§Q3 V3），不是只看"跑没跑"。
  //   取舍（如实标注）: 每个探针多一次 `npx tsx` 启动开销（换取不崩与真隔离）。
  return runProbeAsSubprocess(repoRoot, entry);
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、CLI
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ladder CLI 主函数。
 *
 * 返回码（**ladder 自身**，不是探针契约）:
 *   0 = 正常（`--all` 见末行词元；或 `--targets` 成功）
 *   1 = 测量件自身有问题（末行 `RESULT=ERROR`）
 *   2 = ladder 自身异常（仓库根 / 参数不可识别）
 *   3 = **仅 `--targets` 子命令**：该探针未声明 `TARGETS`
 *       （专供契约自测区分"未声明"与"声明了空表"这两个不同缺陷）
 */
async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2 | 3> {
  let repoRoot: string;
  try {
    repoRoot = locateRepoRoot();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ ladder ERROR: ${msg}`);
    console.log('RESULT=ERROR');
    return 2;
  }

  let targets: readonly ProbeEntry[];
  const probeIdx = argv.indexOf('--probe');
  const targetsIdx = argv.indexOf('--targets');
  if (targetsIdx >= 0) {
    // `--targets <探针名>`：把该探针**自声明的 TARGETS** 打到 stdout（每行一条）。
    // 🔴 为什么由 ladder 提供这个子命令（而不是让契约自测自己解析）:
    //   契约自测若自行用 shell 正则解析 TARGETS，就产生**第二套解析口径** ⇒ 与 ladder 漂移。
    //   实测代价：我在契约自测里手写解析器连踩 4 版（单行/多行/类型注解 `string[]` 自带 `]`/
    //   结束符缩进）—— 每版都修出新洞。∴ 收成**单一实现**（判例 M-04），契约自测只消费它的输出。
    const name = argv[targetsIdx + 1];
    // 宽松接受两种写法：`probe-role-pack`（注册表原名）或 `role-pack`（裸名）—— 调用方少踩坑
    const normalized = typeof name === 'string' && !name.startsWith('probe-') ? `probe-${name}` : name;
    const found = PROBES.find((p) => p.file === normalized);
    if (!found) {
      console.error(
        `❌ ladder ERROR: --targets 需要已知探针名；已知: ${PROBES.map((p) => p.file).join(', ')}`,
      );
      return 2;
    }
    try {
      const declared = readDeclaredTargets(repoRoot, found.file);
      if (declared === null) {
        console.error(`（${found.file} 未声明 TARGETS）`);
        return 3; // 3 = "未声明"（专供契约自测区分"未声明"与"声明了空表"）
      }
      for (const q of declared) console.log(q);
      return 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ ladder ERROR: 读取 ${found.file} 的 TARGETS 失败: ${msg}`);
      return 2;
    }
  }
  if (probeIdx >= 0) {
    const name = argv[probeIdx + 1];
    const found = PROBES.find((p) => p.file === name);
    if (!found) {
      console.error(
        `❌ ladder ERROR: 未知探针 "${String(name)}"；已知: ${PROBES.map((p) => p.file).join(', ')}`,
      );
      console.log('RESULT=ERROR');
      return 2;
    }
    targets = [found];
  } else if (argv.includes('--all')) {
    targets = PROBES;
  } else {
    console.error('❌ ladder ERROR: 须指定 --all 或 --probe <名>（无默认全跑，防误报绿灯）');
    console.log('RESULT=ERROR');
    return 2;
  }

  console.log(`PROBE_LADDER repoRoot=${repoRoot}`);
  console.log(`探针数: ${targets.length}（含既有只读件 ${PROBES.filter((p) => p.legacyNoResult).length} 个）`);

  const results: ProbeRunResult[] = [];
  for (const entry of targets) {
    console.log(`\n══════ ${entry.file}.ts  (${entry.card}) ══════`);
    const r = await runProbe(repoRoot, entry);
    // 🔴 PASS 不变式：报绿就必须能证明目标件存在（堵自洽假绿 —— 独立复核实测的 5/12 漏网）
    const violation = checkTargetsInvariant(repoRoot, entry, r.verdict);
    const final: ProbeRunResult = violation
      ? { ...r, exit: 'syntax-error', verdict: 'ERROR', note: `TARGETS 不变式破: ${violation}` }
      : r;
    if (final.note) console.log(`  ↳ ${final.note}`);
    results.push(final);
    console.log(`  → ${final.file}: ${final.verdict} (exit=${String(final.exit)})`);
  }

  const pass = results.filter((r) => r.verdict === 'PASS').length;
  const fail = results.filter((r) => r.verdict === 'FAIL').length;
  const notimpl = results.filter((r) => r.verdict === 'NOT_IMPLEMENTED').length;
  const error = results.filter((r) => r.verdict === 'ERROR').length;
  const malformed = results.filter((r) => r.exit === 'syntax-error').length;

  console.log('\n══════ 清单 ══════');
  for (const r of results) {
    // 🔴 可见性：打印**自声明 TARGETS 的存在比**（判例 V-09 显式披露）。
    //   为什么必须打印（独立复核 probe-verifier 第 2 轮实测）:
    //     不变式只在**报 PASS**时校验"TARGETS 全存在"。对"目标本来就全存在"的探针（如 K12-08/K12-09），
    //     不变式**天然空转** ⇒ 把它掏空成恒绿桩，契约自测仍 85/0 全绿、红信号静默消失。
    //     清单不打印 TARGETS 时，人（含 K3）**看不出**哪些探针处在这个"空转"状态。
    //     ⇒ 本行把 `[targets=存在/总]` 打出来：`N/N` = 不变式对该件当前空转，须人工/K3 抽检相关性。
    const tgtTag = ((): string => {
      const isLegacy = PROBES.find((p) => p.file === r.file)?.legacyNoResult === true;
      try {
        const d = readDeclaredTargets(repoRoot, r.file);
        if (d === null) return isLegacy ? '[targets=legacy 豁免]' : '[targets=未声明]';
        const exist = d.filter((p) => existsSync(join(repoRoot, p))).length;
        const flag = exist === d.length && d.length > 0 ? ' ⚠️不变式空转(须抽检)' : '';
        return `[targets=${exist}/${d.length}${flag}]`;
      } catch {
        return '[targets=读取失败]';
      }
    })();
    const suffix = r.note ? `  ${r.note}` : '';
    console.log(
      `  ${r.file.padEnd(26)} ${r.verdict.padEnd(16)} exit=${String(r.exit).padEnd(12)} ${r.card}  ${tgtTag}${suffix}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 ladder 退出码语义 —— 表达【测量件自身是否健康】，**不是** K12 交付是否完成
  //
  //   创始人 2026-10-11 明令: `--all` = **exit 0**，但末行必须**显式披露** `pass=/notimpl=`
  //      （不许只报 PASS —— 那就是假绿，本卡存在的全部理由就是防它）。
  //
  //   为什么"个别探针 FAIL"**不**拉低 ladder 退出码（本批判据澄清，如实记录）:
  //     · 探针 exit 1 是**产品代码的真红**（如 K12-09 的跨租户读未被拒）——那是**被测对象**的状态，
  //       不是**测量件**的状态。ladder 的职责是"把状态照下来并如实报"，不是"代替 K12 各卡收口"。
  //     · 若 FAIL 也拉低 ladder ⇒ 在 21 张卡全部做完前 ladder 恒非 0 ⇒
  //       登记件 `K12-21` 的 `expectExit: 0` **永远无法满足** ⇒ 本卡自己无法收口（判例 P-03 断言不变性）。
  //     · 真实判据落在**各探针自己的退出码**上（这是硬的、逐卡的、可独立复跑的）——
  //       ladder 只是聚合与计数，末行 `fail=<n>` / `notimpl=<n>` 是**机器可读的显式披露**。
  //
  //   🔴 词元（token）修正 —— 修于 2026-10-11（独立复核 probe-verifier 实测指出）:
  //     原实现只要 malformed=0 就印 `RESULT=PASS`，于是出现**同行自相矛盾**:
  //       `RESULT=PASS probes=13 pass=1 fail=2 notimpl=10 error=0`  ← PASS 与 fail=2 打架。
  //     `RESULT=` 是**机器可读字段**，而它恰是最易被 `grep` 消费的词元 ⇒
  //     只 grep `RESULT=PASS` 的消费者会被"词元级假绿"骗到。
  //     ∴ 现改为三态词元（**退出码不变，仍守 expectExit:0**）:
  //       · `RESULT=PASS`     — 且 fail=0 且 error=0 且 malformed=0（**真的没有坏消息**）
  //       · `RESULT=DEGRADED` — 探针**如实报了产品红**（fail>0 或 error>0）；exit 仍 0
  //       · `RESULT=ERROR`    — 测量件自身有问题（malformed>0：契约违反/崩溃）；exit 1
  //     代价（如实标注）: `DEGRADED` 是本 ladder 的**新增词元**，只出现在 ladder 末行；
  //       12 个探针的 `RESULT=` 词汇表**未变**（PASS/FAIL/NOT_IMPLEMENTED/ERROR），无契约漂移。
  //
  //   三态（本批口径）:
  //     0 = 13 探针全部执行完 ＋ 每个判定都在契约域内（PASS/FAIL/NOT_IMPLEMENTED 皆可）
  //     1 = 探针"跑了但输出违反契约"（探针数据问题：末行与退出码矛盾 / 退出码越界 / **末行缺失**）
  //         —— 注：不导出 `main` 的探针经"守卫不点火 ⇒ 无末行"**间接**归入本类（非显式检查，见 runProbe 注释）
  //     2 = ladder 自身异常（仓库根定位失败 / 参数不可识别）
  //
  //   ⚠️ 边界（如实标注，供 K3/CTO 复核）: 上列口径与卡面 §Q3 V2 冲突时，
  //     本 ladder **不**用自己的退出码覆盖它 —— V2 由**各探针的退出码**独立满足（实测：未实现件均 exit 2）。
  // ══════════════════════════════════════════════════════════════════════════
  const verdict: LadderVerdict = malformed > 0 ? 'ERROR' : fail > 0 || error > 0 ? 'DEGRADED' : 'PASS';
  console.log(
    `\nRESULT=${verdict} probes=${results.length} pass=${pass} fail=${fail} notimpl=${notimpl} error=${error}` +
      (malformed > 0 ? ` malformed=${malformed}` : ''),
  );
  return LADDER_EXIT[verdict];
}

/**
 * 安全退出：**先把 stdout 冲干净再退出**。
 *
 * 🔴 实测事故（2026-10-11，花了 5 轮才对）: 原实现直接 `process.exit(code)`。
 *   Node 的 stdout 在**管道/重定向**下是异步的 ⇒ exit 会丢弃缓冲区 ⇒ 输出被**静默截断**：
 *   同一命令在**终端 TTY** 下正常、在 `$( )` / `|` 下时有时无（实测同一命令一次出 8 行、一次出 0 行）。
 *   这类"只在下游消费者处才出现"的假信号最难查 —— 还差点被误读成"TARGETS 空表"。
 *
 *   ∴ 正确做法（不是 sleep / 不是 drain 竞速）:
 *     ① 置 `process.exitCode`（让 Node 正常退出时用它）；
 *     ② **不**调 `process.exit()` —— 由 Node 在事件循环排空后自行退出。
 *        （本 ladder 不启动长驻 handle：探针走 `spawnSync` 同步等完，故事件循环必然排空，不会挂死。）
 *   这是 Node 官方推荐写法：`process.exit()` 是"立即砍"，`exitCode` 是"干完活再走"。
 *
 * 契约:
 *   @input  — 退出码
 *   @output — 无（写 `process.exitCode`；进程由 Node 正常终止）
 *   @degrade— 无异常路径（仅赋值）
 */
function setExitCode(code: number): void {
  process.exitCode = code;
}

// 仅在**直接把本文件当脚本跑**时执行 CLI（被 import 时不产生副作用 —— 12 个探针 import 本文件的契约原语）
// 🔴 判据必须扫**整个 argv**，不能只看 `process.argv[1]`:
//   原实现 `/probe-ladder\.ts$/.test(process.argv[1])` 只在"本文件是唯一参数"时成立；
//   一旦带子命令参数（如 `--targets probe-role-pack`），process.argv[1] 是探针名 ⇒ 守卫不点火
//   ⇒ 静默什么都不做、退出码 0（实测踩坑：`--targets` 全 12 件都输出 0 条）。
if (process.argv.some((a) => /probe-ladder\.ts$/.test(a))) {
  main().then(
    (code) => setExitCode(code),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ ladder 未捕获异常: ${msg}`);
      console.log('RESULT=ERROR');
      setExitCode(2);
    },
  );
}
