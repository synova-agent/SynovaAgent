/**
 * tests/control-tower/probe-criterion-precheck.test.ts — C4 判据件存在性自检的**配对测试**（CT-40 / B8）
 *
 * 三层（缺一不可）:
 *   ① **纯函数**：路径归一（`normalizeRepoRelPath`）／两形态提取（`extractCriterionPaths`）／
 *      判定（`inspectCriterion`）—— 不进子进程，失败点直接定位到函数。
 *   ② **spawn 级 smoke**：跑探针**真身**（`node tsx <probe>`），断言三态退出语义
 *      （selfcheck ⇒ 0；缺件 ⇒ 1；参数/doc 不可读/提取 0 条 ⇒ 2）与末行 `RESULT=`。
 *   ③ **三态映射**：`EXIT_BY_VERDICT`（PASS=0 / FAIL=1 / ERROR=2）与探针出口同源。
 *
 * 🔴 最要紧的两条（实测踩坑换来的，禁删）:
 *   - **负控必须指向真的不存在的路径**：负控是"判定器还咬得动"的唯一证据；控制件被污染
 *     （有人创建了同名文件）⇒ 本测试必红，这是预期行为。
 *   - **fixture doc 的两形态与真规格同构**：表格形态若被写成"首列不是路径"，提取会静默 0 条
 *     ⇒ 探针会 exit 2（"没找到" ≠ "通过"），测试必须能把这条语义钉住。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_BY_VERDICT } from '../../scripts/control-tower/probe-ladder';
import {
  KNOWN_CASES,
  NEGATIVE_CONTROL_PATH,
  POSITIVE_CONTROL_PATH,
  extractCriterionPaths,
  inspectCriterion,
  normalizeRepoRelPath,
  usageText,
  ANNOTATION_MARKER,
} from '../../scripts/control-tower/probe-criterion-precheck';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const PROBE = join(REPO_ROOT, 'scripts', 'control-tower', 'probe-criterion-precheck.ts');
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SPEC_DOC = join(REPO_ROOT, '.handbook', '派单件', '2026-10-30-规格-1158-M6-三条不可妥协.md');

/** 夹具里"必然不存在"的判据件路径（与探针负控不同名，避免互相污染）。 */
const FIXTURE_MISSING = 'scripts/control-tower/__m6-c4-fixture-missing__.ts';

/** §2.2 表格形态（首列＝路径，次列＝操作）。 */
const TABLE_DOC = [
  '## §2 在哪做',
  '',
  '### 2.2 写集（2 个）',
  '',
  '| 文件 | 操作 | 说明 |',
  '|---|---|---|',
  `| ${POSITIVE_CONTROL_PATH} | 改 | 真实存在 |`,
  `| ${FIXTURE_MISSING} | 新建 | 必然缺失 |`,
  '',
  '## §3 别的节',
].join('\n');

/** 附A Q2 块形态（只收「做什么」，不收「不做什么」）。 */
const Q2_DOC = [
  '## 附A',
  '',
  '## Q2: 范围 — 做什么 / 不做什么',
  '',
  '做什么：',
  `- ${POSITIVE_CONTROL_PATH} — 改（C1）`,
  `- \`${FIXTURE_MISSING}\` — <新建>（C2）`,
  '',
  '不做什么：',
  '- 不改 src/**',
  '- 不改 extensions/sentinels/**',
  '',
  '## 架构层',
].join('\n');

/** 两形态同构（同两条路径 ⇒ 并集应为 2 条，forms=table,q2）。 */
const BOTH_FORMS_DOC = `${TABLE_DOC}\n\n${Q2_DOC}`;

/** 空 doc（两形态都提取不到 ⇒ 探针必须 degraded/exit 2）。 */
const EMPTY_DOC = ['# 空文档', '', '既没有 §2.2 写集表，也没有 Q2 做什么块。', ''].join('\n');

/** v2.4 注解行夹具：1 条真实件 ＋ 1 条伪路径 ＋ 1 条显式标注「不入机器写集表」的追认行。 */
const ANNOTATION_DOC = [
  '### 2.2 写集（3 个）',
  '',
  '| 文件 | 操作 | 说明 |',
  '|---|---|---|',
  `| ${POSITIVE_CONTROL_PATH} | 改 | 真实件 |`,
  `| ${FIXTURE_MISSING} | 新建 | 伪路径（必然缺失） |`,
  `| **（追认，${ANNOTATION_MARKER}）** memory/notes/proposed/2026-10-30-m6-1158-four-cards.md | 新建 | 追认行 |`,
  '',
].join('\n');

/** 仅加粗、**无**「不入机器写集表」显式标注 ⇒ 仍须判 unparseable（不放宽）。 */
const BOLD_ONLY_DOC = [
  '### 2.2 写集（2 个）',
  '',
  '| 文件 | 操作 | 说明 |',
  '|---|---|---|',
  `| ${POSITIVE_CONTROL_PATH} | 改 | 真实件 |`,
  '| **（追认）** memory/notes/proposed/2026-10-30-m6-1158-four-cards.md | 新建 | 无显式标注 |',
  '',
].join('\n');

/** 只有"仅加粗无标注"的行 ⇒ 提取 0 条 ⇒ 必须 degraded/exit 2。 */
const BOLD_ONLY_EMPTY_DOC = [
  '### 2.2 写集（1 个）',
  '',
  '| 文件 | 操作 | 说明 |',
  '|---|---|---|',
  '| **（追认）** memory/notes/proposed/2026-10-30-m6-1158-four-cards.md | 新建 | 无显式标注 |',
  '',
].join('\n');

interface ProbeRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** 跑探针真身（绝不用 `npx`：探针 P14 实测 `spawnSync npx ENOENT`）。 */
function runProbe(argv: readonly string[]): ProbeRun {
  const res = spawnSync(process.execPath, [TSX_CLI, PROBE, ...argv], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, SYNOVA_REPO_ROOT: REPO_ROOT },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** 末行断言（探针契约：末行必须 `RESULT=<verdict>`）。 */
function lastLine(stdout: string): string {
  const lines = stdout.trimEnd().split(/\r?\n/);
  return lines[lines.length - 1] ?? '';
}

let fixtureDir = '';
let bothFormsDoc = '';
let emptyDoc = '';
let annotationDoc = '';
let boldOnlyDoc = '';
let boldOnlyEmptyDoc = '';

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'm6-c4-test-'));
  bothFormsDoc = join(fixtureDir, 'two-forms.md');
  emptyDoc = join(fixtureDir, 'empty.md');
  annotationDoc = join(fixtureDir, 'annotation.md');
  boldOnlyDoc = join(fixtureDir, 'bold-only.md');
  boldOnlyEmptyDoc = join(fixtureDir, 'bold-only-empty.md');
  writeFileSync(bothFormsDoc, BOTH_FORMS_DOC, 'utf8');
  writeFileSync(emptyDoc, EMPTY_DOC, 'utf8');
  writeFileSync(annotationDoc, ANNOTATION_DOC, 'utf8');
  writeFileSync(boldOnlyDoc, BOLD_ONLY_DOC, 'utf8');
  writeFileSync(boldOnlyEmptyDoc, BOLD_ONLY_EMPTY_DOC, 'utf8');
});

afterAll(() => {
  if (fixtureDir !== '') rmSync(fixtureDir, { recursive: true, force: true });
});

describe('normalizeRepoRelPath — 可解析性口径（R8）', () => {
  it('接受规范仓内 POSIX 相对路径', () => {
    expect(normalizeRepoRelPath('scripts/control-tower/probe-ladder.ts')).toEqual({
      ok: true,
      path: 'scripts/control-tower/probe-ladder.ts',
    });
  });

  it('去装饰：反引号 / 尾随括注 / 尾随冒号都能归一', () => {
    const quoted = normalizeRepoRelPath('`scripts/control-tower/x.ts`（新建）');
    expect(quoted.ok).toBe(true);
    if (quoted.ok) expect(quoted.path).toBe('scripts/control-tower/x.ts');
    const colon = normalizeRepoRelPath('scripts/control-tower/x.ts：');
    expect(colon.ok).toBe(true);
    if (colon.ok) expect(colon.path).toBe('scripts/control-tower/x.ts');
  });

  it('拒绝绝对路径 / 反斜杠 / 通配 / `..` / 空段', () => {
    expect(normalizeRepoRelPath('D:/x/y.ts').ok).toBe(false);
    expect(normalizeRepoRelPath('/abs/x.ts').ok).toBe(false);
    expect(normalizeRepoRelPath('a\\b.ts').ok).toBe(false);
    expect(normalizeRepoRelPath('src/**').ok).toBe(false);
    expect(normalizeRepoRelPath('a/../b.ts').ok).toBe(false);
    expect(normalizeRepoRelPath('a//b.ts').ok).toBe(false);
    expect(normalizeRepoRelPath('').ok).toBe(false);
  });
});

describe('extractCriterionPaths — 两形态（禁硬编码条数）', () => {
  it('形态 ①：§2.2 表格 ⇒ 首列路径 ＋ 操作列（改/新建）', () => {
    const r = extractCriterionPaths(TABLE_DOC);
    expect(r.entries.map((e) => e.path)).toEqual([POSITIVE_CONTROL_PATH, FIXTURE_MISSING]);
    expect(r.entries.map((e) => e.operation)).toEqual(['modify', 'create']);
    expect(r.entries.every((e) => e.forms.length === 1 && e.forms[0] === 'table')).toBe(true);
    expect(r.formCounts.table).toBe(2);
    expect(r.formCounts.q2).toBe(0);
  });

  it('形态 ②：Q2「做什么」块 ⇒ 收 2 条；「不做什么」块的 `src/**` 不进清单', () => {
    const r = extractCriterionPaths(Q2_DOC);
    expect(r.entries.map((e) => e.path)).toEqual([POSITIVE_CONTROL_PATH, FIXTURE_MISSING]);
    expect(r.formCounts.q2).toBe(2);
    expect(r.formCounts.table).toBe(0);
    expect(r.entries.map((e) => e.path)).not.toContain('src/**');
    expect(r.unparseable).toHaveLength(0);
  });

  it('两形态取并集去重：同路径只 1 条，forms 记录两形态', () => {
    const r = extractCriterionPaths(BOTH_FORMS_DOC);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].forms).toEqual(['table', 'q2']);
    expect(r.formCounts).toEqual({ table: 2, q2: 2 });
  });

  it('两形态都没有 ⇒ 0 条（调用方必须降级，不得当"通过"）', () => {
    const r = extractCriterionPaths(EMPTY_DOC);
    expect(r.entries).toHaveLength(0);
    expect(r.unparseable).toHaveLength(0);
  });

  it('表首列是占位形态（`<新建> x.ts`）⇒ 进 unparseable，不被静默丢弃', () => {
    const doc = [
      '### 2.2 写集（1 个）',
      '',
      '| 文件 | 操作 | 说明 |',
      '|---|---|---|',
      '| <新建> scripts/control-tower/x.ts | 新建 | 占位形态 |',
      '',
    ].join('\n');
    const r = extractCriterionPaths(doc);
    expect(r.entries).toHaveLength(0);
    expect(r.unparseable).toHaveLength(1);
    expect(r.unparseable[0].form).toBe('table');
  });

  it('v2.4 注解行：首列显式标注「不入机器写集表」⇒ 跳过（不计 entries/unparseable），留 annotationSkipped', () => {
    const r = extractCriterionPaths(ANNOTATION_DOC);
    expect(r.entries.map((e) => e.path)).toEqual([POSITIVE_CONTROL_PATH, FIXTURE_MISSING]);
    expect(r.unparseable).toHaveLength(0);
    expect(r.annotationSkipped).toHaveLength(1);
    expect(r.annotationSkipped[0].raw).toContain('memory/notes/proposed/2026-10-30-m6-1158-four-cards.md');
    expect(r.annotationSkipped[0].form).toBe('table');
    expect(r.formCounts.table).toBe(2);
  });

  it('v2.4 反向：仅加粗、无「不入机器写集表」标注 ⇒ 仍判 unparseable（不放宽）', () => {
    const r = extractCriterionPaths(BOLD_ONLY_DOC);
    expect(r.entries.map((e) => e.path)).toEqual([POSITIVE_CONTROL_PATH]);
    expect(r.unparseable).toHaveLength(1);
    expect(r.unparseable[0].reason).toContain('不放宽');
    expect(r.annotationSkipped).toHaveLength(0);
  });

  it('从**真规格**提取 8 条写集（两形态各 8，条数由 doc 派生而非写死）', () => {
    // 规格未 provision 时（如部分 CI）跳过：此时 C4 本来就 exit 2（见规格 §5）。
    if (!readable(SPEC_DOC)) {
      console.warn(`ⓘ 跳过真规格提取：未找到 ${SPEC_DOC}`);
      return;
    }
    const text = readFileSync(SPEC_DOC, 'utf8');
    const r = extractCriterionPaths(text);
    expect(r.formCounts.table).toBe(8);
    expect(r.formCounts.q2).toBe(8);
    expect(r.entries).toHaveLength(8);
    expect(r.unparseable).toHaveLength(0);
    // v2.4（handbook caf418c）起 §2.2 含 1 行「不入机器写集表」追认行 ⇒ 跳过而非 unparseable；
    // v2.3 无该行 ⇒ annotationSkipped=0。两个版本下 entries 都必须仍是 8（判据不变）。
    if (text.includes(ANNOTATION_MARKER)) {
      expect(r.annotationSkipped).toHaveLength(1);
      expect(r.annotationSkipped[0].raw).toContain('memory/notes/proposed/2026-10-30-m6-1158-four-cards.md');
    } else {
      expect(r.annotationSkipped).toHaveLength(0);
    }
    expect(r.entries.map((e) => e.path)).toContain('scripts/control-tower/probe-criterion-precheck.ts');
    expect(r.entries.map((e) => e.path)).toContain('tests/control-tower/probe-criterion-precheck.test.ts');
  });
});

/** 只读可读性判定（不抛：规格缺失属"跳过"而非"失败"）。 */
function readable(path: string): boolean {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch (err) {
    // swallow-ok: 仅用于决定"跳过真规格用例"，原因已写进 console.warn（不静默）。
    console.warn(`ⓘ 真规格不可读（${path}）：${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

describe('inspectCriterion — 存在性（普通文件）＋可解析性', () => {
  it('负控路径：可解析但不存在 ⇒ MISSING（判定器咬得动）', () => {
    const r = inspectCriterion(REPO_ROOT, NEGATIVE_CONTROL_PATH);
    expect(r.parseable).toBe(true);
    expect(r.exists).toBe(false);
    expect(r.path).toBe(NEGATIVE_CONTROL_PATH);
  });

  it('正控路径：真实判据件 ⇒ EXISTS', () => {
    const r = inspectCriterion(REPO_ROOT, POSITIVE_CONTROL_PATH);
    expect(r.parseable).toBe(true);
    expect(r.exists).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('目录不算判据件（存在性口径＝普通文件）', () => {
    const r = inspectCriterion(REPO_ROOT, 'scripts/control-tower');
    expect(r.parseable).toBe(true);
    expect(r.exists).toBe(false);
    expect(r.reason).toContain('不是普通文件');
  });

  it('不可解析 token ⇒ parseable=false 且 path=null', () => {
    const r = inspectCriterion(REPO_ROOT, 'src/**');
    expect(r.parseable).toBe(false);
    expect(r.path).toBeNull();
    expect(r.exists).toBe(false);
  });
});

describe('三态映射与探针契约常量', () => {
  it('EXIT_BY_VERDICT：PASS=0 / FAIL=1 / ERROR=2 / NOT_IMPLEMENTED=2', () => {
    expect(EXIT_BY_VERDICT.PASS).toBe(0);
    expect(EXIT_BY_VERDICT.FAIL).toBe(1);
    expect(EXIT_BY_VERDICT.ERROR).toBe(2);
    expect(EXIT_BY_VERDICT.NOT_IMPLEMENTED).toBe(2);
  });

  it('KNOWN_CASES 只含 main/selfcheck（未知 case 必须 exit 2）', () => {
    expect([...KNOWN_CASES]).toEqual(['main', 'selfcheck']);
  });

  it('--help 文本含"规则 R1–R7"与两形态说明（DS①：规则写进 --help）', () => {
    const help = usageText();
    expect(help).toContain('R1');
    expect(help).toContain('R5');
    expect(help).toContain('--doc');
    expect(help).toContain('selfcheck');
  });
});

describe('spawn smoke — 真跑探针（三态退出语义）', () => {
  it('--case selfcheck ⇒ exit 0，正负双控都出现，末行 RESULT=PASS', () => {
    const run = runProbe(['--case', 'selfcheck']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('[EXPECTED-RED]');
    expect(run.stdout).toContain(POSITIVE_CONTROL_PATH);
    expect(run.stdout).toContain('[EXPECTED-GREEN]');
    expect(run.stdout).toContain('| MISSING |');
    expect(run.stdout).toContain('| EXISTS |');
    expect(lastLine(run.stdout)).toBe('RESULT=PASS');
    expect(run.stderr).not.toContain('degraded:');
  });

  it('--doc <两形态夹具> ⇒ exit 1（1 EXISTS ＋ 1 MISSING），末行 RESULT=FAIL', () => {
    const run = runProbe(['--doc', bothFormsDoc]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(`${POSITIVE_CONTROL_PATH} | EXISTS | 可解析`);
    expect(run.stdout).toContain(`${FIXTURE_MISSING} | MISSING | 可解析`);
    expect(run.stdout).toContain('[MISSING] 1/2');
    expect(lastLine(run.stdout)).toBe('RESULT=FAIL');
  });

  it('--doc <注解行夹具> ⇒ exit 1（伪路径仍 MISSING），注解行被 [ANNOTATION-SKIPPED] 跳过', () => {
    const run = runProbe(['--doc', annotationDoc]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('[ANNOTATION-SKIPPED]');
    expect(run.stdout).toContain(ANNOTATION_MARKER);
    expect(run.stdout).toContain(`${POSITIVE_CONTROL_PATH} | EXISTS | 可解析`);
    expect(run.stdout).toContain(`${FIXTURE_MISSING} | MISSING | 可解析`);
    // 注解行里的追认路径**不得**被判定（跳过 ≠ EXISTS/MISSING）
    expect(run.stdout).not.toContain('memory/notes/proposed/2026-10-30-m6-1158-four-cards.md | MISSING');
    expect(run.stdout).toContain('entries=2 unparseable=0 annotationSkipped=1');
    expect(lastLine(run.stdout)).toBe('RESULT=FAIL');
  });

  it('--doc <仅加粗无标注夹具> ⇒ exit 1 且该行仍 UNPARSEABLE（不放宽）', () => {
    const run = runProbe(['--doc', boldOnlyDoc]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('| UNPARSEABLE | 不可解析');
    expect(run.stdout).toContain('不放宽');
    expect(run.stdout).toContain('annotationSkipped=0');
    expect(lastLine(run.stdout)).toBe('RESULT=FAIL');
  });

  it('--doc <只含仅加粗无标注行> ⇒ 提取 0 条 ⇒ exit 2（CRITERION_NONE_EXTRACTED）', () => {
    const run = runProbe(['--doc', boldOnlyEmptyDoc]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=CRITERION_NONE_EXTRACTED');
  });

  it('--all --doc <夹具> ⇒ 仅主用例（DS④：不跑 selfcheck）', () => {
    const run = runProbe(['--all', '--doc', bothFormsDoc]);
    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain('case: selfcheck');
    expect(run.stdout).toContain('仅主用例');
    expect(lastLine(run.stdout)).toBe('RESULT=FAIL');
  });

  it('无参数 ⇒ exit 2 ＋ stderr 一行 degraded（ARG_CASE_REQUIRED）', () => {
    const run = runProbe([]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=ARG_CASE_REQUIRED');
    expect(lastLine(run.stdout)).toBe('RESULT=ERROR');
  });

  it('--case 未知 ⇒ exit 2（UNKNOWN_CASE，不回落默认场景）', () => {
    const run = runProbe(['--case', 'no-such-case']);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=UNKNOWN_CASE');
  });

  it('--doc 指向不存在的文件 ⇒ exit 2（DOC_UNREADABLE："没找到" ≠ "通过"）', () => {
    const run = runProbe(['--doc', join(fixtureDir, 'nope.md')]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=DOC_UNREADABLE');
  });

  it('--doc 可读但提取 0 条 ⇒ exit 2（CRITERION_NONE_EXTRACTED）', () => {
    const run = runProbe(['--doc', emptyDoc]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('degraded:');
    expect(run.stderr).toContain('code=CRITERION_NONE_EXTRACTED');
  });

  it('--help ⇒ exit 0 且打印用法', () => {
    const run = runProbe(['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('probe-criterion-precheck.ts');
    expect(run.stdout).toContain('--doc <path>');
    expect(run.stdout).toContain('退出码（三态）');
  });
});
