#!/usr/bin/env node
/**
 * check-coordination-schema.ts —— 协调层 / 决策层 schema 门（V10 + V11 + V12）
 *
 * 契约（铁律 47：输入 / 输出 / 降级）
 * ── 输入 ────────────────────────────────────────────────────────────────
 *   argv        : 见 USAGE（--coord-root / --decisions-root / --cas-root / --since / --strict）
 *   文件系统    : <repo>/docs/synova/coordination/** 与 <repo>/decisions/**（默认根）
 *   git         : 仅当 --since <ref> 给出时（读基线快照 + 变更集）
 * ── 输出 ────────────────────────────────────────────────────────────────
 *   stdout      : 每条规则一行 —— [PASS] / [FAIL] / [NOT-EVALUATED] + 规则 id + 具名细节
 *                 FAIL 行必带 token（STALE / STATUS_LOCATION_MISMATCH / MISSING_SECTION ...）
 *   --json      : 机器可读报告（{ rules, summary, exit }）
 *   exit 0      : 全部规则 PASS（NOT-EVALUATED 且未加 --strict）
 *   exit 1      : 至少一条规则 FAIL（含 --selftest 判别性自证失败）
 *   exit 2      : 检查自身失败（参数 / git / IO / 临时目录）—— **同样阻断**
 * ── 降级 ────────────────────────────────────────────────────────────────
 *   本检查不降级：任何内部错误 ⇒ exit 2 + stderr `CHECKER-ERROR`，绝不静默跳过。
 *   NOT-EVALUATED 是**显式报告态**，不是静默跳过；--strict 把它升级为阻断。
 *   判例 M-02（三态退出码，禁 `|| true` 吞崩溃）；判例 V-02（禁 grep 型验收）。
 *
 * 判据规格来源（真源）：docs/synova/DOC-CONTRACT.md §2.2（四态 / class 闭集 / 六段 / 归档即冻结）
 *                        + §3 闸 1（头三行 + 六段 + 状态与目录交叉校验）
 * 三个门的语义与反例见同目录证据件：
 *   docs/synova/coordination/evidence/v10v11v12/README.md
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────
// 闭集（改动此处 = 改门禁语义 ⇒ 必须同批改 README 与 SPEC；M-04 同一事实一处表达）
// ─────────────────────────────────────────────────────────────────────────

/** V11：coordination 状态位闭集。扩展它必须同批改本文件 + README（同 DOC-CONTRACT §2.2 class 闭集范式）。 */
const COORD_STATUSES: readonly string[] = ['active', 'archived'];

/** V12：决策生命周期四态（DOC-CONTRACT §2.2）。 */
const LIFECYCLES: readonly string[] = ['proposed', 'implemented', 'rejected', 'archived'];

/** V12：决策类别闭集（DOC-CONTRACT §2.2 六类）。 */
const DECISION_CLASSES: readonly string[] = [
  'product',
  'architecture',
  'process',
  'feature',
  'bug-fix',
  'simplification',
];

/** V12：六段（DOC-CONTRACT §2.2 文件格式，缺一不可）。 */
const REQUIRED_SECTIONS: readonly string[] = [
  '一句话',
  '问题',
  '决定',
  '考虑过的其他方案',
  '后果',
  '取代',
];

/**
 * V12：提议腔闭集（仅对 `状态: implemented` 生效）。
 * `拟` 用负向后顾排除「模拟 / 虚拟 / 比拟 / 类似」等非提议义复合词。
 */
const PROPOSAL_TONE_PATTERNS: readonly { re: RegExp; token: string }[] = [
  { re: /建议/, token: '建议' },
  { re: /可以考虑/, token: '可以考虑' },
  { re: /(?<![模虚比类])拟/, token: '拟' },
];

/** 机器类路径段（非「文档」，不受 V11 状态位约束）。依据 DOC-CONTRACT §2.4/§3/§10。 */
const COORD_EXEMPT_SEGMENTS: readonly string[] = ['tools', 'fixtures', 'evidence', 'task-state'];

/** V10 全树扫描时跳过的目录段。 */
const SCAN_SKIP_SEGMENTS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.next',
  '.turbo',
  'tmp',
];

/** 所有规则 id（每次运行必须全部出现在报告里；缺失 = 静默跳过 = exit 2）。 */
const RULE_IDS: readonly string[] = [
  'V10-CAS-ROOT-EXISTS',
  'V10-CAS-PARSE',
  'V10-CAS-SELF',
  'V10-CAS-STALE',
  'V10-CAS-DANGLING',
  'V10-CAS-PRESENT',
  'V11-ROOT-EXISTS',
  'V11-STATUS-ENUM',
  'V11-STATUS-SINGLE',
  'V11-STATUS-LOCATION',
  'V11-NEW-DOC-STATUS',
  'V11-MOVE-REWRITE',
  'V11-ARCHIVE-FROZEN',
  'V11-STATUS-DEBT',
  'V12-ROOT-EXISTS',
  'V12-FILE-KIND',
  'V12-STATUS-LINE',
  'V12-DATE-LINE',
  'V12-SECTIONS',
  'V12-SECTION-EMPTY',
  'V12-LIFECYCLE-DIR',
  'V12-CLASS-DIR',
  'V12-IMPLEMENTED-TONE',
  'V12-PATH-RATCHET',
  'V12-PATH-DEBT',
];

// ─────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────

type RuleStatus = 'PASS' | 'FAIL' | 'NOT-EVALUATED';

interface Finding {
  rule: string;
  status: RuleStatus;
  /** 具名 token（FAIL 时必填，供回归/CI 断言用） */
  token?: string;
  /** 涉事文件（相对 repo 根，具名） */
  file?: string;
  line?: number;
  /** 人可读细节 */
  detail: string;
  /** NOT-EVALUATED 的原因 */
  reason?: string;
}

interface Options {
  repoRoot: string;
  coordRoot: string;
  decisionsRoot: string;
  casRoot: string;
  since: string | null;
  strict: boolean;
  json: boolean;
  selftest: boolean;
  casFile: string | null;
}

class CheckerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 基础工具
// ─────────────────────────────────────────────────────────────────────────

function runGit(args: string[], cwd: string): string {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'GIT_DIR' || k === 'GIT_WORK_TREE' || k === 'GIT_INDEX_FILE') continue;
    env[k] = v;
  }
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string | Buffer; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? '');
    throw new CheckerError('GIT_FAILED', `git ${args.join(' ')} failed: ${stderr.trim() || e.message}`);
  }
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function relOf(repoRoot: string, abs: string): string {
  return toPosix(path.relative(repoRoot, abs));
}

function walkFiles(rootAbs: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootAbs)) return out;
  const stack: string[] = [rootAbs];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (err) {
      // 读不到目录 = 扫描空间静默变小（fail-open）⇒ 显式失败，禁 continue 跳过
      const e = err as { message?: string };
      throw new CheckerError('WALK_FAILED', `cannot read directory ${cur}: ${e.message}`);
    }
    for (const ent of entries) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (SCAN_SKIP_SEGMENTS.includes(ent.name)) continue;
        stack.push(abs);
      } else if (ent.isFile()) {
        out.push(abs);
      } else if (ent.isSymbolicLink()) {
        // 跳过符号链接（避免越界遍历）；不静默：由调用方的计数规则体现
        continue;
      }
    }
  }
  out.sort();
  return out;
}

/** 递归删除临时目录（仅用于 --selftest 自建目录）。 */
function rmrf(dirAbs: string): void {
  if (!dirAbs.startsWith(os.tmpdir())) {
    throw new CheckerError('UNSAFE_RM', `refused to rm outside tmpdir: ${dirAbs}`);
  }
  fs.rmSync(dirAbs, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────
// V10 · revision CAS
// ─────────────────────────────────────────────────────────────────────────

interface CasDeclaration {
  file: string; // 声明者（repo 相对路径）
  line: number; // 1-based
  target: string; // 被声明的目标（repo 相对路径）
  algo: string; // 目前仅 sha256
  digest: string; // 12..64 hex 前缀
}

/** 声明行：首个非空 token 是 `expectedRevision:`（避免散文里提到该词即触发）。 */
const CAS_LINE_RE = /^\s*expectedRevision\s*[:：]\s*(\S+)\s*$/;
const CAS_SPEC_RE = /^(\S+?)@([a-z0-9]+):([0-9a-fA-F]{12,64})$/;

interface CasParseResult {
  decls: CasDeclaration[];
  malformed: { file: string; line: number; raw: string; why: string }[];
  present: { file: string; line: number; raw: string }[];
  /** 非法 JSON 且兜底未命中 ⇒ 本件跳过该文件的扫描；**必须显式计数**（跳过 = 失败的对立面：显式报告） */
  unparseableJson: { file: string; why: string }[];
}

/** 从一段文本里抽取 CAS 声明（.md 用整行；.json 用 expectedRevision 字段）。 */
function parseCasFromText(file: string, text: string): CasParseResult {
  const decls: CasDeclaration[] = [];
  const malformed: { file: string; line: number; raw: string; why: string }[] = [];
  const present: { file: string; line: number; raw: string }[] = [];
  const unparseableJson: { file: string; why: string }[] = [];
  const lines = text.split(/\r?\n/);

  if (file.endsWith('.json')) {
    try {
      const parsed: unknown = JSON.parse(text);
      collectJsonDecls(parsed, file, decls, malformed, present);
    } catch (err) {
      // 非法 JSON 的判据不归本门（有别的门负责），但**不许因此漏掉自己的声明字段**：
      // 走正则兜底仍能扫到 expectedRevision；扫不到就是真的没有，不是静默跳过。
      const e = err as { message?: string };
      const found = /"expectedRevision"\s*:\s*"([^"]*)"/g;
      let m = found.exec(text);
      let hits = 0;
      while (m !== null) {
        hits += 1;
        pushJsonDeclFallback(m[1], file, decls, malformed, present);
        m = found.exec(text);
      }
      if (hits === 0) {
        // 非法 JSON 本身不是本门的判据（别的门负责），但**跳过必须显式**
        // ⇒ 计入 unparseableJson 并在 V10-CAS-PARSE 的 detail 里打印，绝不静默。
        unparseableJson.push({ file, why: e.message ?? 'JSON.parse failed' });
      }
    }
    return { decls, malformed, present, unparseableJson };
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = CAS_LINE_RE.exec(line);
    if (m === null) continue;
    const raw = m[1];
    present.push({ file, line: i + 1, raw });
    const spec = CAS_SPEC_RE.exec(raw);
    if (spec === null) {
      malformed.push({ file, line: i + 1, raw, why: 'expected <path>@<algo>:<12..64 hex>' });
      continue;
    }
    decls.push({ file, line: i + 1, target: spec[1], algo: spec[2].toLowerCase(), digest: spec[3] });
  }
  return { decls, malformed, present, unparseableJson };
}

function pushJsonDeclFallback(
  raw: string,
  file: string,
  decls: CasDeclaration[],
  malformed: { file: string; line: number; raw: string; why: string }[],
  present: { file: string; line: number; raw: string }[],
): void {
  present.push({ file, line: 0, raw });
  const spec = CAS_SPEC_RE.exec(raw);
  if (spec === null) {
    malformed.push({ file, line: 0, raw, why: 'expected <path>@<algo>:<12..64 hex>' });
    return;
  }
  decls.push({ file, line: 0, target: spec[1], algo: spec[2].toLowerCase(), digest: spec[3] });
}

function collectJsonDecls(
  node: unknown,
  file: string,
  decls: CasDeclaration[],
  malformed: { file: string; line: number; raw: string; why: string }[],
  present: { file: string; line: number; raw: string }[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectJsonDecls(item, file, decls, malformed, present);
    return;
  }
  if (!isPlainObject(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'expectedRevision' && typeof v === 'string') {
      present.push({ file, line: 0, raw: v });
      const spec = CAS_SPEC_RE.exec(v);
      if (spec === null) {
        malformed.push({ file, line: 0, raw: v, why: 'expected <path>@<algo>:<12..64 hex>' });
      } else {
        decls.push({ file, line: 0, target: spec[1], algo: spec[2].toLowerCase(), digest: spec[3] });
      }
    } else {
      collectJsonDecls(v, file, decls, malformed, present);
    }
  }
}

function collectCasFromTree(repoRoot: string, casRootAbs: string, casFile: string | null): CasParseResult {
  const files: string[] = [];
  if (casFile !== null) {
    const abs = path.resolve(repoRoot, casFile);
    if (!fs.existsSync(abs)) {
      throw new CheckerError('CAS_FILE_MISSING', `--cas-file not found: ${casFile}`);
    }
    files.push(abs);
  } else {
    for (const abs of walkFiles(casRootAbs)) {
      if (abs.endsWith('.md') || abs.endsWith('.json')) files.push(abs);
    }
  }
  const decls: CasDeclaration[] = [];
  const malformed: { file: string; line: number; raw: string; why: string }[] = [];
  const present: { file: string; line: number; raw: string }[] = [];
  const unparseableJson: { file: string; why: string }[] = [];
  for (const abs of files) {
    const rel = relOf(repoRoot, abs);
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      const e = err as { message?: string };
      throw new CheckerError('READ_FAILED', `cannot read ${rel}: ${e.message}`);
    }
    const r = parseCasFromText(rel, text);
    decls.push(...r.decls);
    malformed.push(...r.malformed);
    present.push(...r.present);
    unparseableJson.push(...r.unparseableJson);
  }
  return { decls, malformed, present, unparseableJson };
}

// ─────────────────────────────────────────────────────────────────────────
// 变更集（--since）：git diff --name-status -M -z <ref>
// ─────────────────────────────────────────────────────────────────────────

type ChangeKind = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

interface Change {
  kind: ChangeKind;
  path: string; // 新路径（D 时为被删除路径）
  from?: string; // R/C 时的旧路径
  score?: string;
}

function readChangeSet(repoRoot: string, since: string): Change[] {
  const changes: Change[] = [];
  const seen = new Set<string>();

  const raw = runGit(['diff', '--name-status', '-M', '-z', since], repoRoot);
  const parts = raw.split('\0');
  let i = 0;
  while (i < parts.length) {
    const status = parts[i];
    if (status === '') {
      i += 1;
      continue;
    }
    const kind = status[0] as ChangeKind;
    if (kind === 'R' || kind === 'C') {
      const from = parts[i + 1];
      const to = parts[i + 2];
      if (to === undefined) break;
      changes.push({ kind, path: to, from, score: status.slice(1) });
      seen.add(to);
      if (from !== undefined) seen.add(from);
      i += 3;
    } else {
      const p = parts[i + 1];
      if (p === undefined) break;
      changes.push({ kind, path: p });
      seen.add(p);
      i += 2;
    }
  }

  // 未跟踪文件不出现在 `git diff <ref>` 里 —— 但新增件恰恰是最需要拦的（增量棘轮）。
  // 用 ls-files --others --exclude-standard 补齐；少了这一步会让「提交前拦截」静默失效。
  const untrackedRaw = runGit(['ls-files', '--others', '--exclude-standard', '-z'], repoRoot);
  for (const p of untrackedRaw.split('\0')) {
    if (p === '' || seen.has(p)) continue;
    changes.push({ kind: 'A', path: p });
    seen.add(p);
  }

  return changes;
}

function changeSetFailure(reason: string): Finding {
  return { rule: 'CHANGE-SET', status: 'FAIL', token: 'CHANGE_SET_UNAVAILABLE', detail: reason };
}

/** 基线快照读文件（真相源：git show <ref>:<path>，不做工作树代理 —— 判例 S-01②）。 */
function readAtRef(repoRoot: string, ref: string, rel: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${rel}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env },
    });
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// V10 检查
// ─────────────────────────────────────────────────────────────────────────

function checkV10(opts: Options, findings: Finding[]): void {
  const casRootAbs = path.resolve(opts.repoRoot, opts.casRoot);
  if (fs.existsSync(casRootAbs) === false) {
    findings.push({
      rule: 'V10-CAS-ROOT-EXISTS',
      status: 'FAIL',
      token: 'CAS_ROOT_MISSING',
      detail: `CAS 扫描根不存在: ${opts.casRoot}（相对 ${opts.repoRoot}）—— 缺根 = 静默扫不到任何声明`,
    });
    for (const id of ['V10-CAS-PARSE', 'V10-CAS-SELF', 'V10-CAS-PRESENT', 'V10-CAS-STALE', 'V10-CAS-DANGLING']) {
      findings.push({ rule: id, status: 'NOT-EVALUATED', reason: 'cas root missing', detail: opts.casRoot });
    }
    return;
  }
  findings.push({ rule: 'V10-CAS-ROOT-EXISTS', status: 'PASS', detail: `cas-root=${opts.casRoot}` });

  const tree = collectCasFromTree(opts.repoRoot, casRootAbs, opts.casFile);

  // ── 语法（全树，无过期问题：语法不随时间腐烂） ──
  if (tree.malformed.length > 0) {
    for (const m of tree.malformed) {
      findings.push({
        rule: 'V10-CAS-PARSE',
        status: 'FAIL',
        token: 'CAS_MALFORMED',
        file: m.file,
        line: m.line,
        detail: `expectedRevision 值不合法（${m.why}）: ${m.raw}`,
      });
    }
  } else {
    findings.push({
      rule: 'V10-CAS-PARSE',
      status: 'PASS',
      detail:
        `声明格式合法 declarations=${tree.decls.length + tree.malformed.length}` +
        ` unparseable_json_skipped=${tree.unparseableJson.length}` +
        (tree.unparseableJson.length > 0
          ? ` 示例=${tree.unparseableJson
              .slice(0, 3)
              .map((u) => u.file)
              .join(' , ')}（非法 JSON 非本门判据，但跳过已显式计数）`
          : ''),
    });
  }

  const selfRef = tree.decls.filter((d) => path.normalize(d.target) === path.normalize(d.file));
  if (selfRef.length > 0) {
    for (const d of selfRef) {
      findings.push({
        rule: 'V10-CAS-SELF',
        status: 'FAIL',
        token: 'CAS_SELF_REFERENCE',
        file: d.file,
        line: d.line,
        detail: `声明了自己的版本（自指 CAS 无意义）: ${d.target}`,
      });
    }
  } else {
    findings.push({ rule: 'V10-CAS-SELF', status: 'PASS', detail: 'no self-referencing declarations' });
  }

  // ── 显式在场要求（--cas-file 时） ──
  if (opts.casFile !== null) {
    if (tree.present.length === 0) {
      findings.push({
        rule: 'V10-CAS-PRESENT',
        status: 'FAIL',
        token: 'CAS_MISSING_DECLARATION',
        file: opts.casFile,
        detail: '指定文件没有 CAS 声明行（首 token 为 expectedRevision 的整行）',
      });
    } else {
      findings.push({
        rule: 'V10-CAS-PRESENT',
        status: 'PASS',
        file: opts.casFile,
        detail: `declarations=${tree.present.length}`,
      });
    }
  } else {
    findings.push({
      rule: 'V10-CAS-PRESENT',
      status: 'NOT-EVALUATED',
      reason: 'no --cas-file given (presence is only asserted for a named dispatch file)',
      detail: '未指定 --cas-file：不要求“某文件必须有声明”',
    });
  }

  // ── 过期比对（仅变更集：CAS 是写时前置条件，不是永久不变量） ──
  if (opts.since === null) {
    findings.push({
      rule: 'V10-CAS-STALE',
      status: 'NOT-EVALUATED',
      reason: 'no --since ref',
      detail: '未给 --since：变更集未定义，无法判断“写者基于的版本”是否已过期',
    });
    findings.push({
      rule: 'V10-CAS-DANGLING',
      status: 'NOT-EVALUATED',
      reason: 'no --since ref',
      detail: '未给 --since：无法在基线上解析被声明的目标',
    });
    return;
  }

  const changes = readChangeSet(opts.repoRoot, opts.since);
  const changed = new Set<string>();
  for (const c of changes) {
    changed.add(c.path);
    if (c.from !== undefined) changed.add(c.from);
  }
  const inFlight = tree.decls.filter((d) => changed.has(d.file));
  const staleFindings: Finding[] = [];
  const danglingFindings: Finding[] = [];

  for (const d of inFlight) {
    if (d.algo !== 'sha256') {
      staleFindings.push({
        rule: 'V10-CAS-STALE',
        status: 'FAIL',
        token: 'STALE',
        file: d.file,
        line: d.line,
        detail: `unknown algo '${d.algo}'（仅支持 sha256）`,
      });
      continue;
    }
    const baseline = readAtRef(opts.repoRoot, opts.since, d.target);
    if (baseline === null) {
      danglingFindings.push({
        rule: 'V10-CAS-DANGLING',
        status: 'FAIL',
        token: 'STALE:DANGLING_TARGET',
        file: d.file,
        line: d.line,
        detail: `目标在基线 ${opts.since} 不存在（无法作为“基于的版本”）: ${d.target}`,
      });
      continue;
    }
    const actual = sha256(baseline);
    if (actual.startsWith(d.digest.toLowerCase()) === false) {
      staleFindings.push({
        rule: 'V10-CAS-STALE',
        status: 'FAIL',
        token: 'STALE',
        file: d.file,
        line: d.line,
        detail:
          `写者声明的基线已过期 —— target=${d.target} ` +
          `declared=sha256:${d.digest} actual@${opts.since}=sha256:${actual.slice(0, d.digest.length)} ` +
          `（重新读取目标版本后再提交；禁静默覆盖）`,
      });
    }
  }

  if (staleFindings.length > 0) findings.push(...staleFindings);
  else {
    findings.push({
      rule: 'V10-CAS-STALE',
      status: 'PASS',
      detail: `declarations-in-changeset=${inFlight.length} all match baseline ${opts.since}`,
    });
  }
  if (danglingFindings.length > 0) findings.push(...danglingFindings);
  else {
    findings.push({
      rule: 'V10-CAS-DANGLING',
      status: 'PASS',
      detail: `declarations-in-changeset=${inFlight.length} all targets resolvable at ${opts.since}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// V11 · coordination 状态门
// ─────────────────────────────────────────────────────────────────────────

interface CoordDoc {
  rel: string; // repo 相对
  relToCoord: string;
  text: string;
  statuses: { line: number; value: string }[];
}

const STATUS_LINE_RE = /^\s*(?:Status|状态)\s*[:：]\s*([A-Za-z\u4e00-\u9fa5-]+)\s*$/;

function isMachineClass(relToCoord: string): boolean {
  const segs = relToCoord.split('/');
  return segs.some((s) => COORD_EXEMPT_SEGMENTS.includes(s));
}

function isArchivedPath(relToCoord: string): boolean {
  return relToCoord.split('/').includes('archive');
}

function loadCoordDocs(repoRoot: string, coordRootAbs: string): CoordDoc[] {
  const out: CoordDoc[] = [];
  for (const abs of walkFiles(coordRootAbs)) {
    const relToCoord = toPosix(path.relative(coordRootAbs, abs));
    if (!relToCoord.endsWith('.md')) continue; // 非 md = 机器数据，非文档
    if (isMachineClass(relToCoord)) continue; // tools/fixtures/evidence/task-state = 机器类
    const rel = relOf(repoRoot, abs);
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      const e = err as { message?: string };
      throw new CheckerError('READ_FAILED', `cannot read ${rel}: ${e.message}`);
    }
    const statuses: { line: number; value: string }[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const m = STATUS_LINE_RE.exec(lines[i]);
      if (m !== null) statuses.push({ line: i + 1, value: m[1].toLowerCase() });
    }
    out.push({ rel, relToCoord, text, statuses });
  }
  return out;
}

function readTextIfExists(abs: string): string | null {
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function statusesOfText(text: string): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = STATUS_LINE_RE.exec(lines[i]);
    if (m !== null) out.push({ line: i + 1, value: m[1].toLowerCase() });
  }
  return out;
}

function checkV11(opts: Options, findings: Finding[]): void {
  const coordRootAbs = path.resolve(opts.repoRoot, opts.coordRoot);
  if (!fs.existsSync(coordRootAbs)) {
    findings.push({
      rule: 'V11-ROOT-EXISTS',
      status: 'FAIL',
      token: 'COORD_ROOT_MISSING',
      detail: `coordination 根不存在: ${opts.coordRoot}`,
    });
    for (const id of [
      'V11-STATUS-ENUM',
      'V11-STATUS-SINGLE',
      'V11-STATUS-LOCATION',
      'V11-NEW-DOC-STATUS',
      'V11-MOVE-REWRITE',
      'V11-ARCHIVE-FROZEN',
      'V11-STATUS-DEBT',
    ]) {
      findings.push({ rule: id, status: 'NOT-EVALUATED', reason: 'coord root missing', detail: opts.coordRoot });
    }
    return;
  }
  findings.push({ rule: 'V11-ROOT-EXISTS', status: 'PASS', detail: `coord-root=${opts.coordRoot}` });

  const docs = loadCoordDocs(opts.repoRoot, coordRootAbs);
  const declaring = docs.filter((d) => d.statuses.length > 0);
  const enumFail: Finding[] = [];
  const dupFail: Finding[] = [];
  const locFail: Finding[] = [];

  for (const d of declaring) {
    if (d.statuses.length > 1) {
      dupFail.push({
        rule: 'V11-STATUS-SINGLE',
        status: 'FAIL',
        token: 'STATUS_DUPLICATE',
        file: d.rel,
        line: d.statuses.map((s) => s.line).join(','),
        detail:
          `一个文件出现 ${d.statuses.length} 个状态行（同一事实只许一处表达）: ` +
          d.statuses.map((s) => `L${s.line}=${s.value}`).join(' / '),
      });
      continue;
    }
    const s = d.statuses[0];
    if (COORD_STATUSES.includes(s.value) === false) {
      enumFail.push({
        rule: 'V11-STATUS-ENUM',
        status: 'FAIL',
        token: 'STATUS_ENUM',
        file: d.rel,
        line: s.line,
        detail: `状态值 '${s.value}' 不在闭集 [${COORD_STATUSES.join(' | ')}] 内`,
      });
      continue;
    }
    const expected = isArchivedPath(d.relToCoord) ? 'archived' : 'active';
    if (s.value !== expected) {
      locFail.push({
        rule: 'V11-STATUS-LOCATION',
        status: 'FAIL',
        token: 'STATUS_LOCATION_MISMATCH',
        file: d.rel,
        line: s.line,
        detail: `位置与状态不一致 —— 目录期望 '${expected}'，文件写作 '${s.value}'（移动时必须同批改写状态行）`,
      });
    }
  }

  if (enumFail.length > 0) {
    findings.push(...enumFail);
  } else {
    findings.push({
      rule: 'V11-STATUS-ENUM',
      status: 'PASS',
      detail: `declaring=${declaring.length} values in closed set`,
    });
  }
  if (dupFail.length > 0) {
    findings.push(...dupFail);
  } else {
    findings.push({
      rule: 'V11-STATUS-SINGLE',
      status: 'PASS',
      detail: `declaring=${declaring.length} each declares <=1 status`,
    });
  }
  if (locFail.length > 0) {
    findings.push(...locFail);
  } else {
    findings.push({
      rule: 'V11-STATUS-LOCATION',
      status: 'PASS',
      detail: `declaring=${declaring.length} location-consistent`,
    });
  }

  // ── 变更集规则 ──
  if (opts.since === null) {
    for (const [id, reason] of [
      ['V11-NEW-DOC-STATUS', 'no --since ref'],
      ['V11-MOVE-REWRITE', 'no --since ref'],
      ['V11-ARCHIVE-FROZEN', 'no --since ref'],
    ] as const) {
      findings.push({ rule: id, status: 'NOT-EVALUATED', reason, detail: '变更集未定义' });
    }
  } else {
    const changes = readChangeSet(opts.repoRoot, opts.since);
    const coordPrefix = `${toPosix(opts.coordRoot).replace(/\/$/, '')}/`;
    const mine = changes.filter((c) => c.path.startsWith(coordPrefix) || (c.from ?? '').startsWith(coordPrefix));

    const newDocFail: Finding[] = [];
    const moveFail: Finding[] = [];
    const frozenFail: Finding[] = [];

    for (const c of mine) {
      const newRelCoord = c.path.startsWith(coordPrefix) ? c.path.slice(coordPrefix.length) : null;
      // 基线侧路径：R/C 取来源，其余取自身（M/D 的来源就是它自己 —— 漏了这一步会让“偷改归档件”静默通过）
      const baselinePath = c.kind === 'R' || c.kind === 'C' ? (c.from ?? '') : c.path;
      const baselineRelCoord = baselinePath.startsWith(coordPrefix)
        ? baselinePath.slice(coordPrefix.length)
        : null;
      const isDestructive = c.kind === 'M' || c.kind === 'D' || c.kind === 'R';

      // 归档冻结：任何对 archive/ 既有文件的改、删、移出 ⇒ 拒（DOC-CONTRACT §2.2「归档即冻结」）
      if (baselineRelCoord !== null && isArchivedPath(baselineRelCoord) && isDestructive) {
        frozenFail.push({
          rule: 'V11-ARCHIVE-FROZEN',
          status: 'FAIL',
          token: 'ARCHIVE_FROZEN',
          file: baselinePath,
          detail:
            `归档区是 append-only 冻结区 —— 事件='${c.kind}' 作用于 ${baselinePath}` +
            (c.kind === 'R' ? ` → ${c.path}` : '') +
            '（归档件不得再编辑 / 重排 / 移动 / 删除）',
        });
        continue;
      }

      if (newRelCoord === null) continue;
      if (isMachineClass(newRelCoord) || newRelCoord.endsWith('.md') === false) continue;

      // 新增文档必须声明状态位（增量禁止；存量由 V11-STATUS-DEBT 计量）
      if (c.kind === 'A') {
        const abs = path.resolve(opts.repoRoot, c.path);
        const text = readTextIfExists(abs);
        const sts = text === null ? [] : statusesOfText(text);
        if (sts.length === 0) {
          newDocFail.push({
            rule: 'V11-NEW-DOC-STATUS',
            status: 'FAIL',
            token: 'NEW_DOC_NEEDS_STATUS',
            file: c.path,
            detail: '新增文档缺少状态行（`Status: active` 或 `Status: archived`）—— 存量容忍、增量禁止',
          });
        } else if (sts.length > 1 || COORD_STATUSES.includes(sts[0].value) === false) {
          newDocFail.push({
            rule: 'V11-NEW-DOC-STATUS',
            status: 'FAIL',
            token: 'NEW_DOC_BAD_STATUS',
            file: c.path,
            line: sts[0].line,
            detail: `新增文档状态行非法: ${sts.map((s) => s.value).join(',')}`,
          });
        }
      }

      // 移入归档必须同批改写状态行
      if (c.kind === 'R' && isArchivedPath(newRelCoord)) {
        const abs = path.resolve(opts.repoRoot, c.path);
        const text = readTextIfExists(abs);
        const sts = text === null ? [] : statusesOfText(text);
        if (sts.length === 0 || sts[0].value !== 'archived') {
          moveFail.push({
            rule: 'V11-MOVE-REWRITE',
            status: 'FAIL',
            token: 'MOVE_NEEDS_REWRITE',
            file: c.path,
            detail:
              `移入归档区未同批改写状态行 —— ${c.from} → ${c.path}，` +
              `现状态='${sts.length === 0 ? '(无状态行)' : sts[0].value}'，期望 'archived'`,
          });
        } else {
          moveFail.push({
            rule: 'V11-MOVE-REWRITE',
            status: 'PASS',
            file: c.path,
            detail: `归档移动已改写状态行: ${c.from} → ${c.path} (Status: archived)`,
          });
        }
      }
    }

    if (newDocFail.length === 0) {
      findings.push({
        rule: 'V11-NEW-DOC-STATUS',
        status: 'PASS',
        detail: `coord changes=${mine.length} 新增文档均有合法状态行`,
      });
    } else findings.push(...newDocFail);

    const movePass = moveFail.filter((f) => f.status === 'PASS');
    const moveBad = moveFail.filter((f) => f.status === 'FAIL');
    if (moveBad.length > 0) findings.push(...moveBad);
    else {
      findings.push({
        rule: 'V11-MOVE-REWRITE',
        status: 'PASS',
        detail: `archive moves=${movePass.length} all rewrote status`,
      });
    }

    if (frozenFail.length > 0) findings.push(...frozenFail);
    else {
      findings.push({
        rule: 'V11-ARCHIVE-FROZEN',
        status: 'PASS',
        detail: `changeset=${mine.length} 无对归档区既有文件的改/删/移出`,
      });
    }
  }

  // ── 存量计量（棘轮只减不增；DEBT 永不影响退出码） ──
  const debt = docs.filter((d) => d.statuses.length === 0);
  findings.push({
    rule: 'V11-STATUS-DEBT',
    status: debt.length > 0 ? 'NOT-EVALUATED' : 'PASS',
    reason: debt.length > 0 ? `unclassified legacy documents=${debt.length}` : undefined,
    detail:
      debt.length > 0
        ? `存量未标注状态位的文档 ${debt.length} 件（机制件与一次性回执同层；D8 存量，不阻断）` +
          ` 示例=${debt
            .slice(0, 5)
            .map((d) => d.rel)
            .join(' , ')}${debt.length > 5 ? ' ...' : ''}`
        : 'all coordination documents declare a status',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// V12 · 决策件 schema 门
// ─────────────────────────────────────────────────────────────────────────

interface DecisionDoc {
  rel: string;
  relToRoot: string;
  text: string;
}

const DECISION_STATUS_RE = /^\s*(?:状态|Status)\s*[:：]\s*([A-Za-z\u4e00-\u9fa5-]+)(.*)$/;
const DECISION_DATE_RE = /^\s*(?:日期|Date)\s*[:：]\s*(\d{4}-\d{2}-\d{2})\s*$/;
const FILE_DATE_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/;

function loadDecisionDocs(repoRoot: string, rootAbs: string): { docs: DecisionDoc[]; badKind: string[] } {
  const docs: DecisionDoc[] = [];
  const badKind: string[] = [];
  for (const abs of walkFiles(rootAbs)) {
    const relToRoot = toPosix(path.relative(rootAbs, abs));
    const rel = relOf(repoRoot, abs);
    if (!relToRoot.endsWith('.md')) {
      badKind.push(rel);
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      const e = err as { message?: string };
      throw new CheckerError('READ_FAILED', `cannot read ${rel}: ${e.message}`);
    }
    docs.push({ rel, relToRoot, text });
  }
  return { docs, badKind };
}

function bodyOutsideFences(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

function sectionIssues(text: string): { present: string[]; missing: string[]; empty: string[] } {
  const lines = text.split(/\r?\n/);
  const headingIdx = new Map<string, number>();
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s*(.+?)\s*$/.exec(lines[i]);
    if (m === null) continue;
    const name = m[1];
    if (REQUIRED_SECTIONS.includes(name) && headingIdx.has(name) === false) headingIdx.set(name, i);
  }
  const present: string[] = [];
  const missing: string[] = [];
  const empty: string[] = [];
  for (const sec of REQUIRED_SECTIONS) {
    const idx = headingIdx.get(sec);
    if (idx === undefined) {
      missing.push(sec);
      continue;
    }
    present.push(sec);
    let hasContent = false;
    for (let j = idx + 1; j < lines.length; j += 1) {
      if (/^##\s/.test(lines[j])) break;
      if (lines[j].trim() !== '') {
        hasContent = true;
        break;
      }
    }
    if (hasContent === false) empty.push(sec);
  }
  return { present, missing, empty };
}

function checkV12(opts: Options, findings: Finding[]): void {
  const rootAbs = path.resolve(opts.repoRoot, opts.decisionsRoot);
  if (!fs.existsSync(rootAbs)) {
    findings.push({
      rule: 'V12-ROOT-EXISTS',
      status: 'FAIL',
      token: 'DECISIONS_ROOT_MISSING',
      detail: `decisions 根不存在: ${opts.decisionsRoot}`,
    });
    for (const id of [
      'V12-FILE-KIND',
      'V12-STATUS-LINE',
      'V12-DATE-LINE',
      'V12-SECTIONS',
      'V12-SECTION-EMPTY',
      'V12-LIFECYCLE-DIR',
      'V12-CLASS-DIR',
      'V12-IMPLEMENTED-TONE',
      'V12-PATH-RATCHET',
      'V12-PATH-DEBT',
    ]) {
      findings.push({ rule: id, status: 'NOT-EVALUATED', reason: 'decisions root missing', detail: opts.decisionsRoot });
    }
    return;
  }
  findings.push({ rule: 'V12-ROOT-EXISTS', status: 'PASS', detail: `decisions-root=${opts.decisionsRoot}` });

  const { docs, badKind } = loadDecisionDocs(opts.repoRoot, rootAbs);

  if (badKind.length > 0) {
    findings.push(
      ...badKind.map((f) => ({
        rule: 'V12-FILE-KIND',
        status: 'FAIL' as RuleStatus,
        token: 'UNEXPECTED_FILE_KIND',
        file: f,
        detail: 'decisions/ 下只允许 .md 决策件（非 md 属误放）',
      })),
    );
  } else {
    findings.push({ rule: 'V12-FILE-KIND', status: 'PASS', detail: `files=${docs.length} all .md` });
  }

  const statusFail: Finding[] = [];
  const dateFail: Finding[] = [];
  const secFail: Finding[] = [];
  const emptyFail: Finding[] = [];
  const lifecycleFail: Finding[] = [];
  const classFail: Finding[] = [];
  const toneFail: Finding[] = [];
  const pathDebt: Finding[] = [];

  for (const d of docs) {
    const lines = d.text.split(/\r?\n/);
    const segs = d.relToRoot.split('/').slice(0, -1);

    // 状态行（唯一 + 闭集）
    const statusHits: { line: number; value: string; tail: string }[] = [];
    const dateHits: { line: number; value: string }[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const sm = DECISION_STATUS_RE.exec(lines[i]);
      if (sm !== null) statusHits.push({ line: i + 1, value: sm[1].toLowerCase(), tail: sm[2] });
      const dm = DECISION_DATE_RE.exec(lines[i]);
      if (dm !== null) dateHits.push({ line: i + 1, value: dm[1] });
    }

    let declaredStatus: string | null = null;
    if (statusHits.length !== 1) {
      statusFail.push({
        rule: 'V12-STATUS-LINE',
        status: 'FAIL',
        token: statusHits.length === 0 ? 'STATUS_MISSING' : 'STATUS_DUPLICATE',
        file: d.rel,
        detail:
          statusHits.length === 0
            ? `缺少状态行（期望 '状态: <${LIFECYCLES.join(' | ')}>'）`
            : `状态行出现 ${statusHits.length} 次: ` + statusHits.map((s) => `L${s.line}=${s.value}`).join(' / '),
      });
    } else {
      declaredStatus = statusHits[0].value;
      if (LIFECYCLES.includes(declaredStatus) === false) {
        statusFail.push({
          rule: 'V12-STATUS-LINE',
          status: 'FAIL',
          token: 'STATUS_ENUM',
          file: d.rel,
          line: statusHits[0].line,
          detail: `状态值 '${declaredStatus}' 不在四态闭集 [${LIFECYCLES.join(' | ')}] 内`,
        });
        declaredStatus = null;
      }
    }

    // 日期行 + 文件名日期一致
    if (dateHits.length !== 1) {
      dateFail.push({
        rule: 'V12-DATE-LINE',
        status: 'FAIL',
        token: dateHits.length === 0 ? 'DATE_MISSING' : 'DATE_DUPLICATE',
        file: d.rel,
        detail: `日期行数量=${dateHits.length}（期望恰好 1 行 '日期: YYYY-MM-DD'）`,
      });
    } else {
      const fm = FILE_DATE_RE.exec(path.basename(d.relToRoot));
      if (fm === null) {
        dateFail.push({
          rule: 'V12-DATE-LINE',
          status: 'FAIL',
          token: 'FILENAME_DATE_MISSING',
          file: d.rel,
          detail: "文件名未以 'YYYY-MM-DD-' 开头（路径即元数据）",
        });
      } else if (fm[1] !== dateHits[0].value) {
        dateFail.push({
          rule: 'V12-DATE-LINE',
          status: 'FAIL',
          token: 'DATE_MISMATCH',
          file: d.rel,
          detail: `文件名日期 ${fm[1]} ≠ 日期行 ${dateHits[0].value}`,
        });
      }
    }

    // 六段
    const sec = sectionIssues(d.text);
    if (sec.missing.length > 0) {
      secFail.push({
        rule: 'V12-SECTIONS',
        status: 'FAIL',
        token: 'MISSING_SECTION',
        file: d.rel,
        detail: `缺少必填节: ${sec.missing.join(' / ')}（缺一节即拒）`,
      });
    }
    if (sec.empty.length > 0) {
      emptyFail.push({
        rule: 'V12-SECTION-EMPTY',
        status: 'FAIL',
        token: 'EMPTY_SECTION',
        file: d.rel,
        detail: `必填节为空: ${sec.empty.join(' / ')}（有标题无内容）`,
      });
    }

    // 状态 ↔ 生命周期目录交叉校验
    const lifecycleSegs = segs.filter((s) => LIFECYCLES.includes(s));
    if (lifecycleSegs.length > 1) {
      lifecycleFail.push({
        rule: 'V12-LIFECYCLE-DIR',
        status: 'FAIL',
        token: 'LIFECYCLE_DIR_AMBIGUOUS',
        file: d.rel,
        detail: `路径含多个生命周期段: ${lifecycleSegs.join(' / ')}`,
      });
    } else if (lifecycleSegs.length === 1 && declaredStatus !== null) {
      if (lifecycleSegs[0] !== declaredStatus) {
        lifecycleFail.push({
          rule: 'V12-LIFECYCLE-DIR',
          status: 'FAIL',
          token: 'STATUS_DIR_MISMATCH',
          file: d.rel,
          detail: `状态与目录不一致 —— 目录='${lifecycleSegs[0]}'，状态行='${declaredStatus}'（移动时必须同批改写状态行）`,
        });
      }
    } else if (lifecycleSegs.length === 0) {
      pathDebt.push({
        rule: 'V12-PATH-DEBT',
        status: 'NOT-EVALUATED',
        file: d.rel,
        detail:
          `存量：路径缺少生命周期段（应为 decisions/{${LIFECYCLES.join('|')}}/{${DECISION_CLASSES.join('|')}}/YYYY-MM-DD-*.md）` +
          ` 现行=${d.relToRoot}；修法: git mv 到 decisions/${declaredStatus ?? '<state>'}/${segs[segs.length - 1] ?? 'process'}/`,
      });
    }

    // class 闭集（末级目录段）
    const classSeg = segs.filter((s) => LIFECYCLES.includes(s) === false).pop();
    if (classSeg === undefined) {
      classFail.push({
        rule: 'V12-CLASS-DIR',
        status: 'FAIL',
        token: 'CLASS_DIR_MISSING',
        file: d.rel,
        detail: `路径缺少类别段（应为 ${DECISION_CLASSES.join(' | ')} 之一）`,
      });
    } else if (DECISION_CLASSES.includes(classSeg) === false) {
      classFail.push({
        rule: 'V12-CLASS-DIR',
        status: 'FAIL',
        token: 'CLASS_NOT_IN_CLOSED_SET',
        file: d.rel,
        detail: `类别段 '${classSeg}' 不在闭集 [${DECISION_CLASSES.join(' | ')}] 内（新增类别须先改门禁与契约 §2.2）`,
      });
    }

    // implemented 禁提议腔
    if (declaredStatus === 'implemented') {
      const body = bodyOutsideFences(d.text);
      for (let i = 0; i < body.length; i += 1) {
        for (const p of PROPOSAL_TONE_PATTERNS) {
          if (p.re.test(body[i])) {
            toneFail.push({
              rule: 'V12-IMPLEMENTED-TONE',
              status: 'FAIL',
              token: 'PROPOSAL_TONE',
              file: d.rel,
              detail: `implemented 决策件出现提议腔 '${p.token}': ${body[i].trim().slice(0, 80)}`,
            });
            break;
          }
        }
      }
    }
  }

  const pushAgg = (rule: string, fails: Finding[], passDetail: string): void => {
    if (fails.length > 0) findings.push(...fails);
    else findings.push({ rule, status: 'PASS', detail: passDetail });
  };

  pushAgg('V12-STATUS-LINE', statusFail, `files=${docs.length} 状态行唯一且在四态闭集内`);
  pushAgg('V12-DATE-LINE', dateFail, `files=${docs.length} 日期行唯一且与文件名一致`);
  pushAgg('V12-SECTIONS', secFail, `files=${docs.length} 六段齐全`);
  pushAgg('V12-SECTION-EMPTY', emptyFail, `files=${docs.length} 必填节均非空`);
  pushAgg('V12-LIFECYCLE-DIR', lifecycleFail, `files=${docs.length} 状态与目录一致`);
  pushAgg('V12-CLASS-DIR', classFail, `files=${docs.length} 类别在闭集内`);
  pushAgg('V12-IMPLEMENTED-TONE', toneFail, 'implemented 决策件无提议腔');
  if (pathDebt.length > 0) {
    findings.push(...pathDebt);
  } else {
    findings.push({ rule: 'V12-PATH-DEBT', status: 'PASS', detail: 'no decision file lacks a lifecycle segment' });
  }

  // ── 增量棘轮：新增决策件必须落在 {lifecycle}/{class}/ 形状 ──
  if (opts.since === null) {
    findings.push({
      rule: 'V12-PATH-RATCHET',
      status: 'NOT-EVALUATED',
      reason: 'no --since ref',
      detail: '未给 --since：无法区分新增件与存量件',
    });
  } else {
    const changes = readChangeSet(opts.repoRoot, opts.since);
    const prefix = `${toPosix(opts.decisionsRoot).replace(/\/$/, '')}/`;
    const added = changes.filter((c) => c.kind === 'A' && c.path.startsWith(prefix) && c.path.endsWith('.md'));
    const bad: Finding[] = [];
    for (const c of added) {
      const relToRoot = c.path.slice(prefix.length);
      const segs = relToRoot.split('/').slice(0, -1);
      const lifecycleSegs = segs.filter((s) => LIFECYCLES.includes(s));
      const classSeg = segs.filter((s) => LIFECYCLES.includes(s) === false).pop();
      const problems: string[] = [];
      if (lifecycleSegs.length !== 1) problems.push(`需要恰好一个生命周期段 [${LIFECYCLES.join('|')}]`);
      if (classSeg === undefined || DECISION_CLASSES.includes(classSeg) === false) {
        problems.push(`类别段须为 [${DECISION_CLASSES.join('|')}] 之一`);
      }
      if (FILE_DATE_RE.test(path.basename(relToRoot)) === false) problems.push("文件名须为 'YYYY-MM-DD-<topic>.md'");
      if (problems.length > 0) {
        bad.push({
          rule: 'V12-PATH-RATCHET',
          status: 'FAIL',
          token: 'PATH_RATCHET',
          file: c.path,
          detail: `新增决策件路径不合契约 §2.2（${problems.join('；')}）；期望 decisions/<lifecycle>/<class>/YYYY-MM-DD-topic.md`,
        });
      }
    }
    if (bad.length > 0) findings.push(...bad);
    else findings.push({ rule: 'V12-PATH-RATCHET', status: 'PASS', detail: `added decision files=${added.length}` });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 报告
// ─────────────────────────────────────────────────────────────────────────

function formatFinding(f: Finding): string {
  const parts: string[] = [`[${f.status}] ${f.rule}`];
  if (f.file !== undefined) parts.push(`file=${f.file}`);
  if (f.line !== undefined) parts.push(`line=${f.line}`);
  if (f.token !== undefined) parts.push(`token=${f.token}`);
  if (f.reason !== undefined) parts.push(`reason=${f.reason}`);
  parts.push(`-- ${f.detail}`);
  return parts.join('  ');
}

function verifyAllRulesReported(findings: Finding[]): void {
  const seen = new Set(findings.map((f) => f.rule));
  const missing = RULE_IDS.filter((id) => seen.has(id) === false);
  if (missing.length > 0) {
    throw new CheckerError('SILENT_SKIP', `规则未出现在报告里（静默跳过 = 失败）: ${missing.join(', ')}`);
  }
}

function runChecks(opts: Options): Finding[] {
  const findings: Finding[] = [];
  const tasks: [string, (o: Options, f: Finding[]) => void][] = [
    ['V10', checkV10],
    ['V11', checkV11],
    ['V12', checkV12],
  ];
  for (const [name, fn] of tasks) {
    try {
      fn(opts, findings);
    } catch (err) {
      if (err instanceof CheckerError) throw err;
      const e = err as { message?: string };
      throw new CheckerError('RULE_THREW', `${name} threw: ${e.message}`);
    }
  }
  verifyAllRulesReported(findings);
  return findings;
}

function summarize(findings: Finding[], strict: boolean): number {
  const fail = findings.filter((f) => f.status === 'FAIL');
  const notEval = findings.filter((f) => f.status === 'NOT-EVALUATED');
  const pass = findings.filter((f) => f.status === 'PASS');
  if (fail.length > 0) return 1;
  if (strict && notEval.length > 0) return 1;
  void pass;
  return 0;
}

function report(findings: Finding[], opts: Options, exitCode: number): void {
  if (opts.json) {
    const fail = findings.filter((f) => f.status === 'FAIL');
    const notEval = findings.filter((f) => f.status === 'NOT-EVALUATED');
    const pass = findings.filter((f) => f.status === 'PASS');
    process.stdout.write(
      `${JSON.stringify(
        {
          exit: exitCode,
          summary: { rules: findings.length, pass: pass.length, fail: fail.length, notEval: notEval.length },
          findings,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  for (const f of findings) process.stdout.write(`${formatFinding(f)}\n`);
  const fail = findings.filter((f) => f.status === 'FAIL');
  const notEval = findings.filter((f) => f.status === 'NOT-EVALUATED');
  const pass = findings.filter((f) => f.status === 'PASS');
  process.stdout.write(
    `SUMMARY rules=${findings.length} pass=${pass.length} fail=${fail.length} not_evaluated=${notEval.length} ` +
      `since=${opts.since ?? '(none)'} strict=${opts.strict ? '1' : '0'}\n`,
  );
  process.stdout.write(`EXIT ${exitCode}\n`);
}

// ─────────────────────────────────────────────────────────────────────────
// --selftest · 判别性自证（判例 V-08：每条判据必须给得出来的反例）
// ─────────────────────────────────────────────────────────────────────────

interface SelfTestCase {
  id: string;
  /** 期望：绿（0）或红（1） */
  expect: 0 | 1;
  /** 期望输出里必须出现的 token / 子串 */
  expectIncludes: string[];
  /** 该用例覆盖的规则 id（用于断言「每条规则都能被改坏」） */
  covers: string[];
  setup: (repo: string) => void;
  args?: string[];
}

const SELFTEST_DISPATCH = 'docs/synova/coordination/dispatch.md';
const SELFTEST_TARGET = 'docs/synova/coordination/target.json';

function writeFileAt(repo: string, rel: string, text: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
}

function baseRepo(repo: string): void {
  fs.mkdirSync(path.join(repo, 'docs/synova/coordination'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'decisions'), { recursive: true });
  // 空 CAS 扫描根：让「不测 CAS 的用例」显式指向一个存在但为空的根（缺根 = 阻断，见 V10-CAS-ROOT-EXISTS）
  fs.mkdirSync(path.join(repo, '.cas-empty'), { recursive: true });
}

function gitSelftest(repo: string, args: string[]): void {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'GIT_DIR' || k === 'GIT_WORK_TREE' || k === 'GIT_INDEX_FILE') continue;
    env[k] = v;
  }
  execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
}

function commitAll(repo: string, msg: string): void {
  gitSelftest(repo, ['add', '-A']);
  gitSelftest(repo, [
    '-c',
    'user.email=schema-gate@local',
    '-c',
    'user.name=schema-gate',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    msg,
  ]);
}

function decisionDoc(status: string, opts?: { omit?: string; body?: string }): string {
  const omit = opts?.omit;
  const parts: string[] = [];
  parts.push('# 决策: 自测用决策件');
  parts.push('');
  parts.push(`状态: ${status}`);
  parts.push('日期: 2026-10-06');
  parts.push('');
  const secs: [string, string][] = [
    ['一句话', '自测夹具：验证决策件 schema 门的判别性。'],
    ['问题', '门禁可能恒绿。'],
    ['决定', '构造反例使其必红。'],
    ['考虑过的其他方案', '不构造反例 —— 否决：无法证明判别性。'],
    ['后果', '每条规则都有得出来的反例。'],
    ['取代', '无（自测夹具）。'],
  ];
  for (const [name, body] of secs) {
    if (omit === name) continue;
    parts.push(`## ${name}`);
    parts.push(body);
    parts.push('');
  }
  if (opts?.body !== undefined) {
    parts.push(opts.body);
    parts.push('');
  }
  return `${parts.join('\n')}\n`;
}

function selftestCases(): SelfTestCase[] {
  const cases: SelfTestCase[] = [];

  // ── V10 ──
  cases.push({
    id: 'V10-green',
    expect: 0,
    expectIncludes: ['[PASS] V10-CAS-STALE'],
    covers: ['V10-CAS-PARSE', 'V10-CAS-SELF', 'V10-CAS-PRESENT', 'V10-CAS-STALE', 'V10-CAS-DANGLING'],
    args: ['--cas-root', 'docs/synova/coordination', '--since', 'HEAD', '--cas-file', SELFTEST_DISPATCH],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, SELFTEST_TARGET, '{\n  "task_id": "D0",\n  "status": "spec_done"\n}\n');
      commitAll(repo, 'base');
      const h = sha256(fs.readFileSync(path.join(repo, SELFTEST_TARGET)));
      writeFileAt(
        repo,
        SELFTEST_DISPATCH,
        `# 派单件\n\nStatus: active\n\nexpectedRevision: ${SELFTEST_TARGET}@sha256:${h}\n`,
      );
    },
  });
  cases.push({
    id: 'V10-stale-old-revision',
    expect: 1,
    expectIncludes: ['token=STALE', 'token=STALE'],
    covers: ['V10-CAS-STALE'],
    args: ['--cas-root', 'docs/synova/coordination', '--since', 'HEAD', '--cas-file', SELFTEST_DISPATCH],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, SELFTEST_TARGET, '{\n  "task_id": "D0",\n  "status": "impl_done"\n}\n');
      commitAll(repo, 'base');
      // 写者基于的是旧版本（提交前的内容），声明一个过期 hash
      const old = '{"task_id":"D0","status":"spec_done"}';
      const wrong = sha256(old);
      writeFileAt(
        repo,
        SELFTEST_DISPATCH,
        `# 派单件\n\nStatus: active\n\nexpectedRevision: ${SELFTEST_TARGET}@sha256:${wrong}\n`,
      );
    },
  });
  cases.push({
    id: 'V10-dangling',
    expect: 1,
    expectIncludes: ['STALE:DANGLING_TARGET'],
    covers: ['V10-CAS-DANGLING'],
    args: ['--cas-root', 'docs/synova/coordination', '--since', 'HEAD', '--cas-file', SELFTEST_DISPATCH],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, SELFTEST_TARGET, '{"a":1}\n');
      commitAll(repo, 'base');
      writeFileAt(
        repo,
        SELFTEST_DISPATCH,
        `# 派单件\n\nStatus: active\n\nexpectedRevision: docs/synova/coordination/nope.json@sha256:${'a'.repeat(64)}\n`,
      );
    },
  });
  cases.push({
    id: 'V10-malformed',
    expect: 1,
    expectIncludes: ['CAS_MALFORMED'],
    covers: ['V10-CAS-PARSE'],
    args: ['--cas-root', 'docs/synova/coordination'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, SELFTEST_DISPATCH, '# 派单件\n\nexpectedRevision: not-a-valid-revision\n');
    },
  });
  cases.push({
    id: 'V10-self-reference',
    expect: 1,
    expectIncludes: ['CAS_SELF_REFERENCE'],
    covers: ['V10-CAS-SELF'],
    args: ['--cas-root', 'docs/synova/coordination'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(
        repo,
        SELFTEST_DISPATCH,
        `# 派单件\n\nexpectedRevision: ${SELFTEST_DISPATCH}@sha256:${'b'.repeat(64)}\n`,
      );
    },
  });
  cases.push({
    id: 'V10-cas-root-missing',
    expect: 1,
    expectIncludes: ['token=CAS_ROOT_MISSING'],
    covers: ['V10-CAS-ROOT-EXISTS'],
    args: ['--cas-root', 'no-such-cas-root'],
    setup: (repo) => {
      baseRepo(repo);
    },
  });
  cases.push({
    id: 'V10-declaration-inside-unparseable-json',
    expect: 0,
    expectIncludes: ['[PASS] V10-CAS-PRESENT', '[PASS] V10-CAS-STALE'],
    covers: ['V10-CAS-PARSE'],
    args: [
      '--cas-root',
      'docs/synova/coordination',
      '--since',
      'HEAD',
      '--cas-file',
      'docs/synova/coordination/dispatch.json',
    ],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, SELFTEST_TARGET, '{\n  "task_id": "D0",\n  "status": "spec_done"\n}\n');
      commitAll(repo, 'base');
      const h = sha256(fs.readFileSync(path.join(repo, SELFTEST_TARGET)));
      // 故意非法 JSON（尾逗号）—— 兜底正则仍必须扫到声明，否则就是静默跳过
      writeFileAt(
        repo,
        'docs/synova/coordination/dispatch.json',
        `{\n  "expectedRevision": "${SELFTEST_TARGET}@sha256:${h}",\n}\n`,
      );
    },
  });
  cases.push({
    id: 'V10-cas-file-without-declaration',
    expect: 1,
    expectIncludes: ['CAS_MISSING_DECLARATION'],
    covers: ['V10-CAS-PRESENT'],
    args: ['--cas-root', 'docs/synova/coordination', '--cas-file', SELFTEST_DISPATCH],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, SELFTEST_DISPATCH, '# 派单件（无 CAS 声明）\n');
    },
  });

  // ── V11 ──
  cases.push({
    id: 'V11-green',
    expect: 0,
    expectIncludes: ['[PASS] V11-STATUS-LOCATION'],
    covers: ['V11-ROOT-EXISTS', 'V11-STATUS-ENUM', 'V11-STATUS-SINGLE', 'V11-STATUS-LOCATION'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/active-doc.md', '# 机制件\n\nStatus: active\n');
      writeFileAt(repo, 'docs/synova/coordination/archive/old.md', '# 回执\n\nStatus: archived\n');
    },
  });
  cases.push({
    id: 'V11-archive-but-active',
    expect: 1,
    expectIncludes: ['token=STATUS_LOCATION_MISMATCH', 'archive/old.md'],
    covers: ['V11-STATUS-LOCATION'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/archive/old.md', '# 回执\n\nStatus: active\n');
    },
  });
  cases.push({
    id: 'V11-status-enum',
    expect: 1,
    expectIncludes: ['token=STATUS_ENUM'],
    covers: ['V11-STATUS-ENUM'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/wip.md', '# 半成品\n\nStatus: wip\n');
    },
  });
  cases.push({
    id: 'V11-status-duplicate',
    expect: 1,
    expectIncludes: ['token=STATUS_DUPLICATE'],
    covers: ['V11-STATUS-SINGLE'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/dup.md', '# 双重\n\nStatus: active\n\nStatus: archived\n');
    },
  });
  cases.push({
    id: 'V11-new-doc-needs-status',
    expect: 1,
    expectIncludes: ['token=NEW_DOC_NEEDS_STATUS'],
    covers: ['V11-NEW-DOC-STATUS'],
    args: ['--cas-root', 'nonexistent-dir', '--since', 'HEAD'],
    setup: (repo) => {
      baseRepo(repo);
      commitAll(repo, 'base');
      writeFileAt(repo, 'docs/synova/coordination/brand-new.md', '# 新过程件（无状态行）\n');
    },
  });
  cases.push({
    id: 'V11-move-without-rewrite',
    expect: 1,
    expectIncludes: ['token=MOVE_NEEDS_REWRITE'],
    covers: ['V11-MOVE-REWRITE'],
    args: ['--cas-root', 'nonexistent-dir', '--since', 'HEAD'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/movable.md', '# 待归档\n\nStatus: active\n');
      commitAll(repo, 'base');
      fs.mkdirSync(path.join(repo, 'docs/synova/coordination/archive'), { recursive: true });
      gitSelftest(repo, ['mv', 'docs/synova/coordination/movable.md', 'docs/synova/coordination/archive/movable.md']);
    },
  });
  cases.push({
    id: 'V11-archive-frozen-edit',
    expect: 1,
    expectIncludes: ['token=ARCHIVE_FROZEN'],
    covers: ['V11-ARCHIVE-FROZEN'],
    args: ['--cas-root', 'nonexistent-dir', '--since', 'HEAD'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/archive/old.md', '# 归档\n\nStatus: archived\n');
      commitAll(repo, 'base');
      writeFileAt(repo, 'docs/synova/coordination/archive/old.md', '# 归档（被偷改）\n\nStatus: archived\n');
    },
  });
  cases.push({
    id: 'V11-archive-frozen-unarchive',
    expect: 1,
    expectIncludes: ['token=ARCHIVE_FROZEN'],
    covers: ['V11-ARCHIVE-FROZEN'],
    args: ['--cas-root', 'nonexistent-dir', '--since', 'HEAD'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/archive/old.md', '# 归档\n\nStatus: archived\n');
      commitAll(repo, 'base');
      gitSelftest(repo, ['mv', 'docs/synova/coordination/archive/old.md', 'docs/synova/coordination/old.md']);
    },
  });
  cases.push({
    id: 'V11-debt-not-blocking',
    expect: 0,
    expectIncludes: ['[NOT-EVALUATED] V11-STATUS-DEBT', 'unclassified legacy documents=1'],
    covers: ['V11-STATUS-DEBT'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'docs/synova/coordination/legacy-268.md', '# 存量平铺件（无状态行）\n');
    },
  });

  // ── V12 ──
  cases.push({
    id: 'V12-green',
    expect: 0,
    expectIncludes: ['[PASS] V12-SECTIONS', '[PASS] V12-STATUS-LINE'],
    covers: [
      'V12-ROOT-EXISTS',
      'V12-FILE-KIND',
      'V12-STATUS-LINE',
      'V12-DATE-LINE',
      'V12-SECTIONS',
      'V12-SECTION-EMPTY',
      'V12-LIFECYCLE-DIR',
      'V12-CLASS-DIR',
      'V12-IMPLEMENTED-TONE',
    ],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/implemented/process/2026-10-06-self-test.md', decisionDoc('implemented'));
    },
  });
  cases.push({
    id: 'V12-missing-section',
    expect: 1,
    expectIncludes: ['token=MISSING_SECTION', '后果'],
    covers: ['V12-SECTIONS'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(
        repo,
        'decisions/implemented/process/2026-10-06-self-test.md',
        decisionDoc('implemented', { omit: '后果' }),
      );
    },
  });
  cases.push({
    id: 'V12-empty-section',
    expect: 1,
    expectIncludes: ['token=EMPTY_SECTION'],
    covers: ['V12-SECTION-EMPTY'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      const doc = decisionDoc('implemented').replace(/## 后果\n[^\n]*\n/, '## 后果\n');
      writeFileAt(repo, 'decisions/implemented/process/2026-10-06-self-test.md', doc);
    },
  });
  cases.push({
    id: 'V12-implemented-proposal-tone',
    expect: 1,
    expectIncludes: ['token=PROPOSAL_TONE'],
    covers: ['V12-IMPLEMENTED-TONE'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(
        repo,
        'decisions/implemented/process/2026-10-06-self-test.md',
        decisionDoc('implemented', { body: '补充：建议下一轮可以考虑把该门接线到 pre-commit。' }),
      );
    },
  });
  cases.push({
    id: 'V12-implemented-tone-false-positive-guard',
    expect: 0,
    expectIncludes: ['[PASS] V12-IMPLEMENTED-TONE'],
    covers: ['V12-IMPLEMENTED-TONE'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(
        repo,
        'decisions/implemented/process/2026-10-06-self-test.md',
        decisionDoc('implemented', { body: '本决定不涉及模拟环境，也不做虚拟节点比拟；无提议义复合词。' }),
      );
    },
  });
  cases.push({
    id: 'V12-status-dir-mismatch',
    expect: 1,
    expectIncludes: ['token=STATUS_DIR_MISMATCH'],
    covers: ['V12-LIFECYCLE-DIR'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/proposed/process/2026-10-06-self-test.md', decisionDoc('implemented'));
    },
  });
  cases.push({
    id: 'V12-status-enum',
    expect: 1,
    expectIncludes: ['token=STATUS_ENUM'],
    covers: ['V12-STATUS-LINE'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/implemented/process/2026-10-06-self-test.md', decisionDoc('done'));
    },
  });
  cases.push({
    id: 'V12-date-mismatch',
    expect: 1,
    expectIncludes: ['token=DATE_MISMATCH'],
    covers: ['V12-DATE-LINE'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      const doc = decisionDoc('implemented').replace('日期: 2026-10-06', '日期: 2026-01-01');
      writeFileAt(repo, 'decisions/implemented/process/2026-10-06-self-test.md', doc);
    },
  });
  cases.push({
    id: 'V12-class-not-in-set',
    expect: 1,
    expectIncludes: ['token=CLASS_NOT_IN_CLOSED_SET'],
    covers: ['V12-CLASS-DIR'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/implemented/misc/2026-10-06-self-test.md', decisionDoc('implemented'));
    },
  });
  cases.push({
    id: 'V12-unexpected-file-kind',
    expect: 1,
    expectIncludes: ['token=UNEXPECTED_FILE_KIND'],
    covers: ['V12-FILE-KIND'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/implemented/process/2026-10-06-self-test.md', decisionDoc('implemented'));
      writeFileAt(repo, 'decisions/implemented/process/notes.txt', 'not a decision doc\n');
    },
  });
  cases.push({
    id: 'V12-path-ratchet',
    expect: 1,
    expectIncludes: ['token=PATH_RATCHET'],
    covers: ['V12-PATH-RATCHET'],
    args: ['--cas-root', 'nonexistent-dir', '--since', 'HEAD'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/process/2026-10-06-base.md', decisionDoc('implemented'));
      commitAll(repo, 'base');
      // 新增件仍走 legacy 形状（无生命周期段）⇒ 棘轮拒
      writeFileAt(repo, 'decisions/process/2026-10-06-new-one.md', decisionDoc('implemented'));
    },
  });
  cases.push({
    id: 'V12-path-debt-not-blocking',
    expect: 0,
    expectIncludes: ['[NOT-EVALUATED] V12-PATH-DEBT'],
    covers: ['V12-PATH-DEBT'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      baseRepo(repo);
      writeFileAt(repo, 'decisions/process/2026-10-06-legacy.md', decisionDoc('implemented'));
    },
  });
  cases.push({
    id: 'V11-root-missing-blocks',
    expect: 1,
    expectIncludes: ['token=COORD_ROOT_MISSING'],
    covers: ['V11-ROOT-EXISTS'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      fs.mkdirSync(path.join(repo, 'decisions'), { recursive: true });
      writeFileAt(repo, 'decisions/implemented/process/2026-10-06-self-test.md', decisionDoc('implemented'));
    },
  });
  cases.push({
    id: 'V12-root-missing-blocks',
    expect: 1,
    expectIncludes: ['token=DECISIONS_ROOT_MISSING'],
    covers: ['V12-ROOT-EXISTS'],
    args: ['--cas-root', '.cas-empty'],
    setup: (repo) => {
      fs.mkdirSync(path.join(repo, 'docs/synova/coordination'), { recursive: true });
    },
  });

  return cases;
}

function runCase(selfPath: string, tmpRoot: string, tc: SelfTestCase): { exit: number; out: string } {
  const repo = fs.mkdtempSync(path.join(tmpRoot, `${tc.id}-`));
  try {
    fs.mkdirSync(repo, { recursive: true });
    gitSelftest(repo, ['init', '-q']);
    tc.setup(repo);
    const args = [
      selfPath,
      '--repo-root',
      repo,
      '--decisions-root',
      'decisions',
      '--coord-root',
      'docs/synova/coordination',
      ...(tc.args ?? ['--cas-root', '.']),
    ];
    const res = execFileSync(process.execPath, args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { exit: 0, out: res };
  } catch (err) {
    const e = err as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    if (typeof e.status === 'number' && e.status !== 0) {
      const out = typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? '');
      const errOut = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? '');
      return { exit: e.status, out: `${out}${errOut}` };
    }
    return { exit: 2, out: `SPAWN-FAILED ${String(e)}` };
  } finally {
    rmrf(repo);
  }
}

function runSelftest(selfPath: string): number {
  if (fs.existsSync(selfPath) === false) {
    throw new CheckerError('SELFTEST_NO_SELF', `cannot locate self at ${selfPath}`);
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-gate-selftest-'));
  const cases = selftestCases();
  let failed = 0;
  const covered = new Set<string>();
  try {
    for (const tc of cases) {
      const { exit, out } = runCase(selfPath, tmpRoot, tc);
      const missing = tc.expectIncludes.filter((s) => out.includes(s) === false);
      const ok = exit === tc.expect && missing.length === 0;
      if (ok === false) failed += 1;
      for (const c of tc.covers) covered.add(c);
      process.stdout.write(
        `SELFTEST ${ok ? 'ok  ' : 'FAIL'} ${tc.id.padEnd(38)} expect_exit=${tc.expect} actual_exit=${exit}` +
          (missing.length > 0 ? `  missing_in_output=${JSON.stringify(missing)}` : '') +
          '\n',
      );
      if (ok === false) {
        process.stdout.write(`        ---- actual output (truncated) ----\n`);
        for (const line of out.split('\n').slice(0, 25)) process.stdout.write(`        ${line}\n`);
      }
    }
    const uncovered = RULE_IDS.filter((id) => covered.has(id) === false);
    if (uncovered.length > 0) {
      failed += 1;
      process.stdout.write(`SELFTEST FAIL uncovered-rules=${JSON.stringify(uncovered)}（该规则缺少反例 = 无效夹具）\n`);
    }
    process.stdout.write(
      `SELFTEST SUMMARY cases=${cases.length} failed=${failed} covered_rules=${covered.size}/${RULE_IDS.length}\n`,
    );
    return failed === 0 ? 0 : 1;
  } finally {
    rmrf(tmpRoot);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

const USAGE = `check-coordination-schema.ts —— 协调/决策 schema 门（V10 CAS · V11 状态位 · V12 决策件）

用法:
  node --experimental-strip-types ${'docs/synova/coordination/tools/check-coordination-schema.ts'} [选项]

选项:
  --repo-root <dir>       仓库根（默认：本文件向上找到含 .git 的目录）
  --coord-root <dir>      coordination 根（默认 docs/synova/coordination）
  --decisions-root <dir>  决策件根（默认 decisions）
  --cas-root <dir>        CAS 声明扫描根（默认 .；相对 --repo-root）
  --cas-file <path>       只对指定派单件做 CAS 检查，并要求它**必须有**声明
  --since <ref>           启用变更集规则（V10 过期 · V11 新增/移动/归档冻结 · V12 路径棘轮）
  --strict                NOT-EVALUATED 也判阻断（跳过 = 失败）
  --json                  输出机器可读 JSON
  --selftest              判别性自证：为每条规则构造反例并断言“改坏即红”
  -h, --help              本帮助

退出码（判例 M-02）:
  0 = 全部规则 PASS        1 = 至少一条 FAIL        2 = 检查自身失败（同样阻断）

规则目录（每次运行必须全部出现在报告里；缺失即 exit 2）:
${RULE_IDS.map((id) => `  ${id}`).join('\n')}
`;

function parseArgs(argv: string[]): Options | 'help' | 'selftest' {
  let repoRoot: string | null = null;
  let coordRoot = 'docs/synova/coordination';
  let decisionsRoot = 'decisions';
  let casRoot = '.';
  let since: string | null = null;
  let strict = false;
  let json = false;
  let selftest = false;
  let casFile: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new CheckerError('BAD_ARGS', `missing value for ${a}`);
      i += 1;
      return v;
    };
    if (a === '-h' || a === '--help') return 'help';
    else if (a === '--repo-root') repoRoot = next();
    else if (a === '--coord-root') coordRoot = next();
    else if (a === '--decisions-root') decisionsRoot = next();
    else if (a === '--cas-root') casRoot = next();
    else if (a === '--cas-file') casFile = next();
    else if (a === '--since') since = next();
    else if (a === '--strict') strict = true;
    else if (a === '--json') json = true;
    else if (a === '--selftest') selftest = true;
    else throw new CheckerError('BAD_ARGS', `unknown option: ${a}`);
  }

  if (selftest) return 'selftest';

  const root = repoRoot ?? findRepoRoot();
  return {
    repoRoot: path.resolve(root),
    coordRoot,
    decisionsRoot,
    casRoot,
    since,
    strict,
    json,
    selftest: false,
    casFile,
  };
}

function findRepoRoot(): string {
  let cur = path.resolve(process.cwd());
  for (let depth = 0; depth < 40; depth += 1) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new CheckerError('NO_REPO_ROOT', `cannot find .git upward from ${process.cwd()}`);
}

function validateSince(opts: Options): void {
  if (opts.since === null) return;
  try {
    runGit(['rev-parse', '--verify', `${opts.since}^{commit}`], opts.repoRoot);
  } catch {
    throw new CheckerError('BAD_SINCE', `--since ref 不可解析为提交: ${opts.since}`);
  }
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed === 'selftest') {
    const selfPath = process.argv[1];
    return runSelftest(selfPath);
  }
  validateSince(parsed);
  const findings = runChecks(parsed);
  const exitCode = summarize(findings, parsed.strict);
  report(findings, parsed, exitCode);
  return exitCode;
}

try {
  const code = main();
  process.exitCode = code;
} catch (err) {
  if (err instanceof CheckerError) {
    process.stderr.write(`CHECKER-ERROR [${err.code}] ${err.message}\n`);
    process.stderr.write('（检查自身失败 = 阻断；判例 M-02：禁 || true 吞崩溃）\n');
  } else {
    const e = err as { stack?: string; message?: string };
    process.stderr.write(`CHECKER-ERROR [UNEXPECTED] ${e.stack ?? e.message}\n`);
  }
  process.exitCode = 2;
}
