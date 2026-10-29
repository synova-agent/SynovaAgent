#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-criterion-precheck.ts — C4 判据件存在性前置自检（#709 / 规格-1158 §4 C4）
 *
 * 【一句话】把「判据件到底在不在」变成一条命令：从**规格 doc 文本**里提取写集/判据件路径清单
 * （不硬编码条数），逐条只判两件事——**存在性**（EXISTS/MISSING）与**可解析性**（规范仓内
 * POSIX 相对路径），并给出三态退出码 0/1/2 与末行 `RESULT=`。
 *
 * 【为什么存在（红B A-V1a ＋ 裁 5 通用规）】v1 曾把 8 条 `NOT_IMPLEMENTED` 探针当作"反例必红"
 * 的证据 ⇒ **判据件缺形却被标 ✅**。本件立规成件：**判据件不存在 ⇒ 该条不得标绿**。
 *
 * 【设计哲学】一个分离 ＋ 三条承诺：
 *   · 一个分离：**判定器（本件）与被测件（其它判据件）分离** —— 本件只回答"在不在"，
 *     绝不替被测件回答"跑没跑过"。
 *   · 承诺 1「没找到 ≠ 通过」：doc 不可读／提取到 0 条 ⇒ `degraded:` ＋ exit 2，不回落默认清单。
 *   · 承诺 2「缺件逐条点名」：每条判据件一行 `<path> | EXISTS|MISSING | 可解析`，缺件必 exit 1。
 *   · 承诺 3「判别力自检」：`--case selfcheck` 正负双控（负控不存在路径 ⇒ MISSING；
 *     正控真实件 ⇒ EXISTS），双控成立才 exit 0 —— 证明"判定器改坏会红"。
 *
 * 判据来源（§4 C4 逐字，不得改）:
 *   正常  `--doc <规格>` ⇒ 逐条 `<path> | EXISTS | 可解析` ⇒ `RESULT=PASS`
 *   降级  doc 不可读／提取到 0 条 ⇒ stderr 一行 `degraded: <原因>` ＋ exit 2（"没找到" ≠ "通过"）
 *   反例  `--case selfcheck`：① 负控（内置不存在判据件路径 ⇒ MISSING ⇒ `[EXPECTED-RED]`）
 *         ∧ ② 正控（`scripts/control-tower/probe-ladder.ts` ⇒ EXISTS）⇒ exit 0；任一不成立 ⇒ exit 1
 *
 * 规则（DS①：与 `--help` 同源，逐条可核）:
 *   R1 提取两形态：① 规格 `### 2.2 写集` 的 Markdown 表格；② 附A `## Q2: … 做什么：` 列表块。
 *      两形态取并集去重；**禁硬编码条数/路径**（改一次规格不必改一次探针）。
 *   R2 每条只判两件事：存在性（且必须是**普通文件**）＋ 可解析性（规范仓内 POSIX 相对路径）。
 *   R3 缺件（MISSING）逐条点名 ⇒ exit 1；不可解析 ⇒ exit 1（与"未被实现"同义，不得标绿）。
 *   R4 doc 不可读／两形态合计提取 0 条 ⇒ stderr `degraded:` ＋ exit 2（fail-closed）。
 *   R5 `--case selfcheck` 正负双控，任一不成立 ⇒ exit 1。
 *   R6 **只做存在性＋可解析性**：不执行被测命令、不读被测文件内容、不冒充"跑过了"（DS③）。
 *   R7 参数：`--doc` 是主用例输入；`--case` 可省（省 = main），但 `--case` 未知／既无 `--doc`
 *      又无 `--case` ⇒ exit 2；`--all` **仅主用例**（DS④，不跑 selfcheck）。
 *   R8 可解析性口径：token 能归一为 `a/b/c.ts` 形态（无绝对路径／反斜杠／通配／占位／`..`／空段）。
 *      它**不代表**文件可执行，只代表"这确实是一条确定路径"。
 *
 * 契约（铁律 47 / 探针统一契约）:
 *   @input
 *     --doc <path>    规格/派单件路径（主用例输入；相对 cwd 解析，也接受绝对路径）
 *     --case <name>   `main`（需 --doc）｜`selfcheck`（正负双控）
 *     --all           ⇒ 仅主用例（DS④）
 *     --help          用法（含本规则表）
 *     环境：SYNO_REPO_ROOT（仓库根；缺省自 cwd 逐级上溯）
 *           SYNO_GATE_DEGRADED_LOG（降级事件日志；缺省 `.synova-out/m6-1158/degraded-events.log`）
 *   @output
 *     stdout：`PROBE …` 横幅 ＋ `── case: … ──` ＋ 逐条
 *       `  ✅ PASS [L2] <path> | EXISTS | 可解析 | forms=<table,q2> | op=<create|modify|unknown>`
 *       `  ❌ FAIL [L2] <path> | MISSING | 可解析 | forms=<…> | op=<…>`
 *       `  ❌ FAIL [L2] <raw>  | UNPARSEABLE | 不可解析 | form=<…> | reason=<…>`
 *     汇总：`COVERAGE: …` ＋ **末行** `RESULT=<PASS|FAIL|ERROR>`
 *   @exit  0 = 全部判据件 EXISTS 且可解析（或 selfcheck 双控成立）
 *          1 = 缺件／不可解析／双控不成立（真红——判据件缺形不得标绿）
 *          2 = 检查自身失败（仓库根定位失败／doc 不可读／提取 0 条／参数不可识别）
 *   @degraded  stderr 一行 `degraded: <原因> [code=<CODE>]` ＋ 追加 JSON 到 `SYNO_GATE_DEGRADED_LOG`
 *              （字段 `time/component/code/phase/retryable`，口径同 probe-line-signals.ts:224）＋ exit 2
 *              （铁律 11/24/31/32；"没找到" ≠ "通过"）
 *   @authority 任何会话可调（**只读**探查器）；它**不跑被测命令、不改任何文件、不判"通过"**——
 *              唯一产出＝逐条 EXISTS/MISSING ＋ 三态退出码。判定"通过"归 L1 收件闸 ＋ K3。
 *   @cross_platform Node ≥ 20（本机 v24.16.0）；仅 node: 内置模块；stdout/stderr 强制 UTF-8（D732）；
 *              路径全程 POSIX 正斜杠比较，Win 上 `join(root, 'a/b.ts')` 正常工作。
 *
 * 🔴 为什么**不用** `assertTargetsExist()`（probe-ladder.ts:254）:
 *   它的语义是 `notImplemented()` ⇒ `NOT_IMPLEMENTED` ⇒ **exit 2**；而 #709 的判据明确要求
 *   **缺件 ⇒ exit 1**（判据件缺形＝真红，不是"探针自身失败"）。直接复用会把 FAIL 变 ERROR，
 *   正好重演红B A-V1a 的"缺形被当无法判定"事故 ⇒ 本件自己实现逐条判定，但**错误类型/输出器/
 *   仓库根/参数解析**四个原语仍复用 probe-ladder 的单一实现（禁另造契约）。
 *
 * 结构（Source map）
 *   ① 头部契约（本块）        — 规则/契约/设计哲学/结构/已知限制
 *   ② 常量与环境              — KNOWN_CASES／控制件路径／UTF-8（D732）/ token 图案
 *   ③ 路径解析层              — stripAnnotations／normalizeRepoRelPath／looksLikePathCandidate
 *   ④ doc 提取层              — findSection／extractFromWriteSetTable／extractFromQ2Block／extractCriterionPaths
 *   ⑤ 判定层                  — inspectCriterion（存在性＝普通文件；纯函数，可被单测直接覆盖）
 *   ⑥ 出口层                  — ProbeError 收敛／degrade（`degraded:` ＋ SYNO_GATE_DEGRADED_LOG）／usageText
 *   ⑦ 场景层                  — runSelfcheck（正负双控）／runDoc（逐条 EXISTS/MISSING）
 *   ⑧ main 编排               — selectCases → 场景 → 三态 exit（`RESULT=` 由 ProbeOutput 签发）
 *
 * 已知限制（Known Limitations）
 *   1. **只做存在性＋可解析性**：不校验文件内容／导出符号／是否可执行；"在"≠"对"（DS③）。
 *   2. **提取依赖标题结构**：`### 2.2 …` 与 `## Q2: … 做什么：` 两种形态。规格改标题层级/换形态
 *      ⇒ 提取到 0 条 ⇒ exit 2（fail-closed，**不猜**）。本件不内置任何路径清单。
 *   3. **同形态内重复条目**按路径去重；两形态之间取并集（本规格两形态同 8 条）。操作列
 *      （改/新建）只作展示，**不参与判定**（不改判据）。
 *   4. **`--doc` 相对路径按 cwd 解析**；调用方须在仓库根或显式给绝对路径。
 *   5. 存在性口径是**普通文件**：同名目录不算 EXISTS（目录不是判据件）。
 *   6. 不递归扫描目录、不校验 §2.2 之外散落的路径（只认两形态声明的条目）。
 *   7. 降级日志默认落 `.synova-out/m6-1158/degraded-events.log`（gitignored），**不落 `.codex/`**
 *      —— 避免运行期在仓库留下未跟踪文件污染 `git status` 终局 gate。
 *   8. 本批**未接 CI**（#1158 U2）；node22 未复跑（本机 v24.16.0，见 #1158 U1）。
 *   9. `degraded:` 行必须唯一可判 ⇒ 若 `setDefaultEncoding` 不可用，其告警走 **stdout 的 `ⓘ` 行**
 *      （不走 stderr，避免把 `degraded:` 变成第 2 行）。
 *
 * 配对测试（B8 / CT-40）：tests/control-tower/probe-criterion-precheck.test.ts
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_BY_VERDICT,
  ProbeError,
  ProbeOutput,
  locateRepoRoot,
  parseProbeArgs,
} from './probe-ladder';

// ─── ② 常量与环境 ─────────────────────────────────────────────────────────────

/** 本探针标识（degraded log 的 component 字段）。 */
const COMPONENT = 'probe-criterion-precheck';

/** 合法场景（`--case` 只认这两个；缺省/未知 ⇒ exit 2，不回落默认场景）。 */
export const KNOWN_CASES = ['main', 'selfcheck'] as const;
/** 场景名类型。 */
export type CriterionCase = (typeof KNOWN_CASES)[number];

/**
 * 负控路径（**内置、且必须不存在**）。
 * 🔴 若有人真的创建了同名文件，负控即失效 ⇒ selfcheck 会红——这是**预期**的自我保护
 *    （控制件被污染时必须叫，而不是悄悄变绿）。
 */
export const NEGATIVE_CONTROL_PATH = 'scripts/control-tower/__criterion-precheck-negative-control__.ts';
/** 正控路径（真实存在的判据件：探针契约的单一实现）。 */
export const POSITIVE_CONTROL_PATH = 'scripts/control-tower/probe-ladder.ts';

/** 写集表标题（§2.2）；回退形态：标题含"写集"。 */
const WRITE_SET_HEADING = /^#{1,6}\s*2\.2(?:\s|$)/;
const WRITE_SET_FALLBACK = /^#{1,6}\s*.*写集/;
/** 附A Q2 块标题。 */
const Q2_HEADING = /^#{1,6}\s*Q2\b/;
/** 「做什么：」与「不做什么：」分界。 */
const DO_HEADING = /^做什么[：:]?$/;
const NOT_DO_HEADING = /^不做什么/;
/** Markdown 表格分隔行（`:---:` / `---`）。 */
const TABLE_SEPARATOR = /^:?-{3,}:?$/;
/** 路径里**绝不允许**的字符（通配/占位/引号/管道/花括号）。 */
const PATH_FORBIDDEN = /[*?[\]{}<>|"'`]/;

// D732 UTF-8 强制（口径同 probe-line-signals.ts:142-151）：Windows 控制台/子进程统一 UTF-8。
process.env.PYTHONIOENCODING = 'utf-8';
if (!process.env.LC_ALL) process.env.LC_ALL = 'C.UTF-8';
try {
  process.stdout.setDefaultEncoding('utf8');
  process.stderr.setDefaultEncoding('utf8');
} catch (streamErr) {
  // ⓘ 走 stdout：stderr 的 `degraded:` 行必须唯一可判（见已知限制 9）。
  process.stdout.write(
    `ⓘ 降级：stdout/stderr 不支持 setDefaultEncoding（${streamErr instanceof Error ? streamErr.message : String(streamErr)}）` +
      '——Node 默认 utf8 输出不受影响\n',
  );
}

// ─── ③ 路径解析层（纯函数） ───────────────────────────────────────────────────

/** 路径解析成功。 */
export interface PathParseOk {
  readonly ok: true;
  /** 规范化后的仓内 POSIX 相对路径。 */
  readonly path: string;
}
/** 路径解析失败（带人读原因）。 */
export interface PathParseErr {
  readonly ok: false;
  readonly reason: string;
}
/** 路径解析结果。 */
export type PathParse = PathParseOk | PathParseErr;

/** 操作列（只作展示，不参与判定）。 */
export type CriterionOperation = 'create' | 'modify' | 'unknown';
/** 提取形态。 */
export type CriterionForm = 'table' | 'q2';

/**
 * 去掉 doc 书写装饰，留下裸 token。
 * @param raw 表格单元格／列表项首个 token 原文
 * @returns 去装饰后的字符串（可能为空串）
 */
export function stripAnnotations(raw: string): string {
  let s = raw.trim();
  // 逐轮剥装饰直到稳定：前后装饰 → 尾随括注 → 尾随标点。
  // 必须"循环"而非一次性：`x.ts`（新建） 的尾反引号在括注**之内**，一次性剥不掉
  // （首轮先剥括注，次轮才露出尾反引号）。
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/^[`*"'《]+/, '').trim(); // 表格/列表装饰：反引号、粗体、引号、书名号
    s = s.replace(/[`*"'》]+$/, '').trim();
    s = s.replace(/[（(][^()（）]*[)）]$/, '').trim(); // 尾随括注：`x.ts（新建）` / `x.ts (new)`
    s = s.replace(/[。，；：、,;:]+$/, '').trim(); // 尾随标点（不含 `.`：避免误伤 `.ts` 后缀）
    if (s === before) break;
  }
  return s;
}

/**
 * 把 token 归一为**规范仓内 POSIX 相对路径**（R8 口号的机器实现，纯函数）。
 * @param raw 原始 token
 * @returns `{ok:true,path}` 或 `{ok:false,reason}`；reason 人读、直接进输出行
 */
export function normalizeRepoRelPath(raw: string): PathParse {
  const token = stripAnnotations(raw);
  if (token === '') return { ok: false, reason: '路径为空' };
  if (isAbsolute(token) || /^[A-Za-z]:/.test(token)) {
    return { ok: false, reason: '绝对路径（判据件必须是仓内相对路径）' };
  }
  if (token.includes('\\')) return { ok: false, reason: '含反斜杠（必须用 POSIX 正斜杠）' };
  const forbidden = PATH_FORBIDDEN.exec(token);
  if (forbidden) return { ok: false, reason: `含通配/占位/引号字符 "${forbidden[0]}"（不是确定路径）` };
  const segments = token.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return { ok: false, reason: '含空段 / `.` / `..`' };
  }
  return { ok: true, path: token };
}

/**
 * 候选 token 是否"看起来像路径"（用于跳过表格里的非路径行／Q2 里的说明性 bullet）。
 * @param raw 原始单元格／token
 * @returns 含 `/` 或以常见扩展名结尾 ⇒ true
 */
function looksLikePathCandidate(raw: string): boolean {
  const token = stripAnnotations(raw);
  if (token === '') return false;
  return token.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(token);
}

// ─── ④ doc 提取层（纯函数；禁硬编码条数） ─────────────────────────────────────

/** 一条提取候选（可能不可解析）。 */
interface RawCandidate {
  readonly form: CriterionForm;
  readonly raw: string;
  readonly parsed: PathParse;
  readonly operation: CriterionOperation;
}

/** 一条判据件条目（已解析；两形态合并后）。 */
export interface CriterionEntry {
  /** 仓内 POSIX 相对路径。 */
  readonly path: string;
  /** 操作列（展示用）。 */
  readonly operation: CriterionOperation;
  /** 出现在哪些形态里（`table`／`q2`）。 */
  readonly forms: readonly CriterionForm[];
}

/** 不可解析的候选（进 FAIL 行）。 */
export interface UnparseableCandidate {
  readonly form: CriterionForm;
  readonly raw: string;
  readonly reason: string;
}

/** 提取结果（纯数据；无 I/O）。 */
export interface ExtractionResult {
  /** 合并去重后的判据件条目（保持首次出现顺序）。 */
  readonly entries: readonly CriterionEntry[];
  /** 不可解析候选（逐条点名）。 */
  readonly unparseable: readonly UnparseableCandidate[];
  /** 逐形态的**唯一路径**条数（诊断用；不是判据）。 */
  readonly formCounts: Readonly<Record<CriterionForm, number>>;
}

/** 按行切分（去 BOM；CRLF/LF 均安全）。 */
function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/);
}

/** Markdown 标题层级（非标题 ⇒ 0）。 */
function headingLevel(line: string): number {
  const m = /^(#{1,6})\s/.exec(line);
  return m ? m[1].length : 0;
}

/**
 * 定位一个标题区段（含起止索引；end 不含）。
 * @param lines 全文行
 * @param matcher 标题匹配
 * @returns `{start,end}` 或 null（未命中 ⇒ 该形态 0 条）
 */
function findSection(lines: readonly string[], matcher: RegExp): { start: number; end: number } | null {
  const start = lines.findIndex((line) => matcher.test(line));
  if (start < 0) return null;
  const level = headingLevel(lines[start]) || 1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const lv = headingLevel(lines[i]);
    if (lv > 0 && lv <= level) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 解析操作列（`新建` / `改` / 其它；只作展示）。 */
function parseOperation(cell: string): CriterionOperation {
  if (/新建|create|\bnew\b/i.test(cell)) return 'create';
  if (/(^|\s)(改|修改|modify|update)/.test(cell)) return 'modify';
  return 'unknown';
}

/** 形态 ①：`### 2.2 写集` 的 Markdown 表格（首列＝路径，次列＝操作）。 */
function extractFromWriteSetTable(lines: readonly string[]): RawCandidate[] {
  const section = findSection(lines, WRITE_SET_HEADING) ?? findSection(lines, WRITE_SET_FALLBACK);
  if (!section) return [];
  const out: RawCandidate[] = [];
  for (let i = section.start + 1; i < section.end; i++) {
    const row = lines[i].trim();
    if (!row.startsWith('|')) continue;
    const cells = row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells.every((cell) => TABLE_SEPARATOR.test(cell))) continue;
    if (/^(文件|路径|path)$/i.test(stripAnnotations(cells[0]))) continue;
    if (!looksLikePathCandidate(cells[0])) continue;
    out.push({
      form: 'table',
      raw: cells[0],
      parsed: normalizeRepoRelPath(cells[0]),
      operation: parseOperation(cells[1]),
    });
  }
  return out;
}

/** 形态 ②：附A `## Q2: … 做什么：` 列表块（只收「做什么」，不收「不做什么」）。 */
function extractFromQ2Block(lines: readonly string[]): RawCandidate[] {
  const section = findSection(lines, Q2_HEADING);
  if (!section) return [];
  const out: RawCandidate[] = [];
  let inDo = false;
  for (let i = section.start + 1; i < section.end; i++) {
    const line = lines[i].trim();
    if (headingLevel(line) > 0) break;
    if (DO_HEADING.test(line)) {
      inDo = true;
      continue;
    }
    if (NOT_DO_HEADING.test(line)) {
      inDo = false;
      continue;
    }
    if (!inDo || !line.startsWith('- ')) continue;
    const body = line.slice(2).trim();
    const firstToken = body.split(/\s+/)[0] ?? '';
    if (!looksLikePathCandidate(firstToken)) continue;
    out.push({
      form: 'q2',
      raw: firstToken,
      parsed: normalizeRepoRelPath(firstToken),
      operation: parseOperation(body.slice(firstToken.length).trim()),
    });
  }
  return out;
}

/** 逐形态唯一路径条数（诊断用）。 */
function uniquePathCount(cands: readonly RawCandidate[]): number {
  const seen = new Set<string>();
  for (const cand of cands) if (cand.parsed.ok) seen.add(cand.parsed.path);
  return seen.size;
}

/**
 * 从 doc 文本提取判据件清单（两形态取并集去重）。
 *
 * @param docText 规格全文（UTF-8 文本）
 * @returns `{entries, unparseable, formCounts}`；两形态合计 0 条时 entries 为空 ⇒ 调用方必须降级
 */
export function extractCriterionPaths(docText: string): ExtractionResult {
  const lines = splitLines(docText);
  const tableCandidates = extractFromWriteSetTable(lines);
  const q2Candidates = extractFromQ2Block(lines);

  const order: string[] = [];
  const acc = new Map<string, { operation: CriterionOperation; forms: Set<CriterionForm> }>();
  const unparseable: UnparseableCandidate[] = [];

  for (const cand of [...tableCandidates, ...q2Candidates]) {
    if (!cand.parsed.ok) {
      unparseable.push({ form: cand.form, raw: cand.raw, reason: cand.parsed.reason });
      continue;
    }
    const path = cand.parsed.path;
    const prev = acc.get(path);
    if (!prev) {
      order.push(path);
      acc.set(path, { operation: cand.operation, forms: new Set<CriterionForm>([cand.form]) });
      continue;
    }
    prev.forms.add(cand.form);
    if (prev.operation === 'unknown' && cand.operation !== 'unknown') prev.operation = cand.operation;
  }

  const entries: CriterionEntry[] = [];
  for (const path of order) {
    const hit = acc.get(path);
    if (!hit) continue; // 不可达（order 与 acc 同源），防御性跳过而非 `!`
    entries.push({ path, operation: hit.operation, forms: [...hit.forms] });
  }

  return {
    entries,
    unparseable,
    formCounts: { table: uniquePathCount(tableCandidates), q2: uniquePathCount(q2Candidates) },
  };
}

// ─── ⑤ 判定层（存在性＋可解析性；纯函数） ─────────────────────────────────────

/** 单条判据件的判定结果。 */
export interface CriterionInspection {
  /** 原始 token。 */
  readonly raw: string;
  /** 规范化路径（不可解析 ⇒ null）。 */
  readonly path: string | null;
  /** 是否可解析为规范仓内相对路径。 */
  readonly parseable: boolean;
  /** 是否存在且为**普通文件**。 */
  readonly exists: boolean;
  /** 非 ENOENT 的异常原因（ENOENT 是常态：目标件缺失正是本件要判的事）。 */
  readonly reason: string | null;
}

/**
 * 判定一条判据件（纯函数：只读文件系统元数据，不读内容、不执行）。
 * @param repoRoot 仓库根
 * @param raw 原始路径 token
 * @returns 判定结果（`exists=false` 即 MISSING）
 */
export function inspectCriterion(repoRoot: string, raw: string): CriterionInspection {
  const parsed = normalizeRepoRelPath(raw);
  if (!parsed.ok) {
    return { raw, path: null, parseable: false, exists: false, reason: parsed.reason };
  }
  const abs = join(repoRoot, ...parsed.path.split('/'));
  try {
    const exists = statSync(abs).isFile();
    return {
      raw,
      path: parsed.path,
      parseable: true,
      exists,
      reason: exists ? null : '该路径存在但不是普通文件（目录不是判据件）',
    };
  } catch (err) {
    // swallow-ok: ENOENT = 目标件缺失（正是本件要判定的状态）；其它 stat 错误同样按
    // "存在性无法证实"处理，但把原因点名进输出，不静默（铁律 24）。
    const code = err instanceof Error && 'code' in err ? String(err.code) : '';
    return {
      raw,
      path: parsed.path,
      parseable: true,
      exists: false,
      reason: code === 'ENOENT' ? null : `无法 stat：${err instanceof Error ? err.message : String(err)}`,
    };
  }
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
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (logErr) {
    // 日志不可写不改变退出码，但必须显式告警（ⓘ 走 stdout，理由同已知限制 9）。
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

/** 读 `--flag value`（缺值 ⇒ exit 2，不猜）。 */
function readFlag(argv: readonly string[], flag: string): string {
  const idx = argv.indexOf(flag);
  if (idx < 0) return '';
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ProbeError('ARG_MISSING_VALUE', 'args', `\`${flag}\` 后缺值`, false);
  }
  return value;
}

/** 用法文本（DS①：规则与文件头同源，逐条可核）。 */
export function usageText(): string {
  return [
    'probe-criterion-precheck.ts — C4 判据件存在性前置自检（#709 / 规格-1158 §4 C4）',
    '',
    '用法:',
    '  node node_modules/tsx/dist/cli.mjs scripts/control-tower/probe-criterion-precheck.ts --doc <规格.md>',
    '  … --case selfcheck',
    '  … --all --doc <规格.md>',
    '',
    '选项:',
    '  --doc <path>   规格/派单件路径（主用例输入：从 doc 文本提取判据件路径清单）',
    '  --case <name>  main（需 --doc）｜selfcheck（正负双控）',
    '  --all          仅主用例（DS④；不跑 selfcheck）',
    '  --help         本帮助',
    '',
    '规则（与文件头同源）:',
    '  R1 两形态提取：§2.2「写集」表 ＋ 附A「Q2: … 做什么：」块；不硬编码条数/路径',
    '  R2 每条只判两件事：存在性（EXISTS/MISSING，且必须是普通文件）＋ 可解析性（规范仓内 POSIX 路径）',
    '  R3 缺件逐条点名 ⇒ exit 1；不可解析 ⇒ exit 1（判据件缺形不得标绿）',
    '  R4 doc 不可读 / 两形态合计提取 0 条 ⇒ stderr `degraded:` ＋ exit 2（“没找到” ≠ “通过”）',
    '  R5 selfcheck：负控（内置不存在路径 ⇒ MISSING ⇒ [EXPECTED-RED]）∧ 正控（probe-ladder.ts ⇒ EXISTS）',
    '     ⇒ exit 0；任一不成立 ⇒ exit 1',
    '  R6 只做存在性＋可解析性：不跑被测命令、不读被测文件内容、不冒充“跑过了”（DS③）',
    '  R7 参数缺省/未知 ⇒ exit 2（不回落默认场景）；--all 仅主用例',
    '',
    '输出:',
    '  逐条 `<path> | EXISTS|MISSING | 可解析`（附 forms/op）＋ 末行 RESULT=<PASS|FAIL|ERROR>',
    '',
    '退出码（三态）:',
    '  0 全部判据件 EXISTS 且可解析（或 selfcheck 双控成立）',
    '  1 缺件 / 不可解析 / 双控不成立（真红）',
    '  2 检查自身失败（仓库根 / doc 不可读 / 提取 0 条 / 参数）；stderr 一行 degraded:',
    '',
    '环境:',
    '  SYNO_REPO_ROOT          仓库根（缺省自 cwd 上溯定位）',
    '  SYNO_GATE_DEGRADED_LOG  降级事件日志（字段 time/component/code/phase/retryable；',
    '                          缺省 .synova-out/m6-1158/degraded-events.log）',
  ].join('\n');
}

// ─── ⑦ 场景层 ────────────────────────────────────────────────────────────────

/** 场景一：正负双控（证明判定器"改坏会红"）。 */
function runSelfcheck(repoRoot: string): 0 | 1 | 2 {
  const out = new ProbeOutput('probe-criterion-precheck (C4 · #709)');
  out.case('selfcheck · 正负双控');
  out.note(`[SELFCHECK] repoRoot=${repoRoot}`);

  const negative = inspectCriterion(repoRoot, NEGATIVE_CONTROL_PATH);
  const positive = inspectCriterion(repoRoot, POSITIVE_CONTROL_PATH);
  const negativeOk = negative.parseable && !negative.exists;
  const positiveOk = positive.parseable && positive.exists;

  out.note(
    `[NEGATIVE] ${NEGATIVE_CONTROL_PATH} | ${negative.exists ? 'EXISTS' : 'MISSING'} | ` +
      `${negative.parseable ? '可解析' : '不可解析'}`,
  );
  out.note(
    `[POSITIVE] ${POSITIVE_CONTROL_PATH} | ${positive.exists ? 'EXISTS' : 'MISSING'} | ` +
      `${positive.parseable ? '可解析' : '不可解析'}`,
  );

  if (negativeOk) {
    out.note(`[EXPECTED-RED] ${NEGATIVE_CONTROL_PATH} | MISSING ⇒ 负控成立（不存在的判据件被判 MISSING）`);
  } else {
    out.fail(
      `负控不成立：期望 ${NEGATIVE_CONTROL_PATH} ⇒ MISSING，实际 parseable=${negative.parseable} exists=${negative.exists}` +
        (negative.reason ? `（${negative.reason}）` : ''),
    );
  }
  if (positiveOk) {
    out.note(`[EXPECTED-GREEN] ${POSITIVE_CONTROL_PATH} | EXISTS ⇒ 正控成立（真实判据件被判 EXISTS）`);
  } else {
    out.fail(
      `正控不成立：期望 ${POSITIVE_CONTROL_PATH} ⇒ EXISTS，实际 parseable=${positive.parseable} exists=${positive.exists}` +
        (positive.reason ? `（${positive.reason}）` : ''),
    );
  }

  if (negativeOk && positiveOk) {
    out.pass('正负双控成立（① 负控 MISSING ∧ ② 正控 EXISTS）⇒ 判定器具备判别力');
  }
  out.note('[RULE] 只做存在性＋可解析性；不跑被测命令、不冒充“跑过了”（DS③）');
  return EXIT_BY_VERDICT[out.finish()];
}

/** 场景二（主用例）：`--doc` ⇒ 逐条 EXISTS/MISSING。 */
function runDoc(repoRoot: string, docArg: string): 0 | 1 | 2 {
  if (docArg.trim() === '') {
    throw new ProbeError(
      'ARG_DOC_REQUIRED',
      'args',
      '主用例需 --doc <规格/派单件路径>（判据件清单从 doc 文本提取；本件不内置路径清单）',
      false,
    );
  }
  const absDoc = resolve(docArg);
  if (!existsSync(absDoc)) {
    throw new ProbeError('DOC_UNREADABLE', 'doc', `doc 不存在：${absDoc}`, false);
  }
  let text: string;
  try {
    text = readFileSync(absDoc, 'utf8');
  } catch (err) {
    throw new ProbeError(
      'DOC_UNREADABLE',
      'doc',
      `doc 不可读：${absDoc}（${err instanceof Error ? err.message : String(err)}）`,
      true,
    );
  }

  const extraction = extractCriterionPaths(text);
  if (extraction.entries.length === 0) {
    throw new ProbeError(
      'CRITERION_NONE_EXTRACTED',
      'extract',
      `从 doc 提取到 0 条判据件路径（table=${extraction.formCounts.table} q2=${extraction.formCounts.q2}` +
        ` unparseable=${extraction.unparseable.length}）——“没找到” ≠ “通过”`,
      false,
    );
  }

  const out = new ProbeOutput('probe-criterion-precheck (C4 · #709)');
  out.case(`doc · ${absDoc}`);
  out.note(`[DOC] ${absDoc}`);
  out.note(
    `[FORMS] table=${extraction.formCounts.table} q2=${extraction.formCounts.q2} ` +
      `entries=${extraction.entries.length} unparseable=${extraction.unparseable.length}`,
  );

  for (const bad of extraction.unparseable) {
    out.fail(`${bad.raw} | UNPARSEABLE | 不可解析 | form=${bad.form} | reason=${bad.reason}`);
  }

  let missing = 0;
  for (const entry of extraction.entries) {
    const inspection = inspectCriterion(repoRoot, entry.path);
    const meta = `forms=${entry.forms.join(',')} | op=${entry.operation}`;
    if (inspection.exists) {
      out.pass(`${entry.path} | EXISTS | 可解析 | ${meta}`);
      continue;
    }
    missing += 1;
    out.fail(`${entry.path} | MISSING | 可解析 | ${meta}${inspection.reason ? ` | reason=${inspection.reason}` : ''}`);
  }

  if (missing > 0) {
    out.note(
      `[MISSING] ${missing}/${extraction.entries.length} 条判据件不存在 ⇒ 缺件 ⇒ exit 1` +
        '（不为变绿放宽存在性规则；最终全绿由独立自验验收）',
    );
  } else {
    out.note(`[ALL-EXISTS] ${extraction.entries.length}/${extraction.entries.length} 条判据件存在且可解析`);
  }
  return EXIT_BY_VERDICT[out.finish()];
}

// ─── ⑧ main 编排 ─────────────────────────────────────────────────────────────

/**
 * 场景选择（R7：不回落默认场景）。
 * @param argv 参数（不含 node/脚本名）
 * @returns 要跑的场景序列（C4 每个场景独立跑，`--all` 只跑 main）
 */
function selectCases(argv: readonly string[]): readonly CriterionCase[] {
  if (argv.includes('--case')) {
    const { cases } = parseProbeArgs(KNOWN_CASES, argv);
    return cases.filter((name): name is CriterionCase => (KNOWN_CASES as readonly string[]).includes(name));
  }
  if (argv.includes('--all')) {
    process.stdout.write('ⓘ --all 仅主用例（C4 DS④：反例 selfcheck 不随 --all 跑）\n');
    return ['main'];
  }
  if (argv.includes('--doc')) return ['main'];
  throw new ProbeError(
    'ARG_CASE_REQUIRED',
    'args',
    `缺 --case <${KNOWN_CASES.join('|')}>（或 --doc <规格> 直接跑主用例）—— 缺省不回落默认场景`,
    false,
  );
}

/**
 * 探针主函数（供 ladder／测试复用；不自行 process.exit）。
 * @param argv 参数（不含 node/脚本名）
 * @returns 三态退出码 0=PASS ｜ 1=FAIL ｜ 2=检查自身失败（degraded）
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
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
    const docArg = readFlag(argv, '--doc');
    if (selected.includes('selfcheck')) {
      if (docArg !== '') process.stdout.write('ⓘ selfcheck 模式：忽略 --doc（反例不读 doc）\n');
      return runSelfcheck(repoRoot);
    }
    return runDoc(repoRoot, docArg);
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
