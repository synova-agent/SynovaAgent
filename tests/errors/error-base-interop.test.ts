/**
 * tests/errors/error-base-interop.test.ts — 914-Q3 单基类 / cause 链 / 禁解析 message 棘轮
 *
 * 判据来源：914-Q3 规格 §4（#914 · 裁 366）——四条判据变成"可红"的机器判据：
 *   A 单一基类：`class DiagnosticAgentError` 全仓**恰好 1 处**（包内），且双向 instanceof 只有单向成立
 *   B cause 链：`cause` 经包基类 `super(message, options)` **原生**透传（可链、不伪造）
 *   C 禁解析 message：路由只认稳定 `code`，`message` 只给人读 ⇒ 路由型命中集合**严格等于 2 条**钉死
 *   （D 两态在 tests/services/runtime-global-handlers.test.ts —— 真类非致命 / lookalike 致命）
 *
 * 铁律 0-2: spec → test → impl；铁律 48: 每块都有 `expect()`（无空壳测试）
 * 铁律 38: 零 `as any` / `as never` / `as unknown as` —— 收窄一律用 `instanceof` 类型守卫
 *
 * ⚠️ 本文件**只读**产品代码：不修改 `src/**`（变异 M1/M2/M3 归 impl-errors 与独立自验员）。
 *    判别力自证（C4/C5）只写 `os.tmpdir()` 下的临时 copy，结束时删除。
 *
 * @known-limitations
 *   - C 棘轮是**行号钉死**的：被白名单文件一旦行号位移（哪怕语义不变）⇒ 红，须人工同步 `PINNED_*`
 *     （有意为之：棘轮宁严不松，避免"顺手放宽"）。
 *   - C 的判别是**代码形状**判别（谓词方法 vs split 截取），不是完整 AST 数据流分析；
 *     只 split 不截取（形状不明）按**路由型严判**（fail loud，不默认放过）。
 *   - A1 依赖 `git`（`git grep`）：非 git checkout（如纯解包目录）下该用例 exit 1 判红，不做静默降级。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 包基类（全仓唯一 `class DiagnosticAgentError` 声明处；src/errors/types.ts 的同名导出只是别名）
import { DiagnosticAgentError, LLMRateLimitError } from '@synova/error-types';
// LLM 专用子类（914-Q3 起继承包基类，不再自定义基类）
import { ClassifiedLlmError } from '../../src/errors/types';

// ═══ 仓库根（tests/errors → ../..） ═══
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * C 棘轮的扫描根。默认 = 产品仓根（与 CI 完全一致）。
 *
 * 探针钩子（判别力自证专用，默认关闭）：
 *   `SYNO_RATCHET_REPO_ROOT=/tmp/<copy> npx vitest run tests/errors/error-base-interop.test.ts -t "C1"`
 *   ⇒ 在**临时 copy** 上跑同一判别逻辑，注入第 3 条路由型时应**红**。
 * 🔴 该钩子只会让判定更严（换扫描对象），**不参与任何断言的放宽**。
 */
const RATCHET_ROOT = process.env.SYNO_RATCHET_REPO_ROOT ?? REPO_ROOT;

// ═══ 通用：git grep（A1 / C3 两处用） ═══

/** `execFileSync` 抛错的最小结构守卫（禁 `as any`，铁律 38） */
function isExecFailure(e: unknown): e is { status?: number; stderr?: string } {
  return typeof e === 'object' && e !== null && 'status' in e;
}

/**
 * 跑 `git grep <args>`，返回 stdout。
 * git grep 的退出码约定：`0` 有命中 / `1` 无命中 —— `1` 是**正常语义**（空结果），
 * 其余失败（非 git 仓、git 缺失）一律 fail loud，禁静默降级（铁律 11）。
 */
function gitGrep(args: readonly string[], cwd: string): string {
  try {
    return execFileSync('git', ['grep', ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    if (isExecFailure(e) && e.status === 1) return '';
    const detail = isExecFailure(e) ? e.stderr ?? '(no stderr)' : String(e);
    throw new Error(`git grep ${args.join(' ')} 执行失败（环境/检查自身问题，非判据通过）: ${detail}`);
  }
}

// ═══ A 单一基类 / 双向 instanceof ═══

describe('A 单一基类：class DiagnosticAgentError 全仓恰好 1 处 + 双向 instanceof', () => {
  it('A1 全仓 `class DiagnosticAgentError` 声明恰好 1 处，且只在包内', () => {
    // 判据三问 ②环境：确认扫描对象就是本仓（cwd 漂移 ⇒ 空扫描 = 假绿）
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    }).trim();
    expect(toplevel).toBe(REPO_ROOT);

    const out = gitGrep(['-c', 'class DiagnosticAgentError', '--', 'src', 'packages'], REPO_ROOT);
    const rows = out
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const sep = line.lastIndexOf(':');
        return { file: line.slice(0, sep), count: Number(line.slice(sep + 1)) };
      });
    const total = rows.reduce((sum, row) => sum + row.count, 0);

    // 严格 ==1：0（基类被删/改名）与 2（又长出第二个类）都判红 —— 禁只断言"≥1"
    expect(rows.map((row) => row.file)).toEqual(['packages/error-types/src/index.ts']);
    expect(total).toBe(1);
  });

  it('A2 正向：ClassifiedLlmError 实例 instanceof 包基类 === true', () => {
    const err = new ClassifiedLlmError({
      code: 'RATE_LIMITED',
      message: '请求过于频繁',
      phase: 0,
      retryable: true,
    });

    expect(err).toBeInstanceOf(DiagnosticAgentError);
    expect(err).toBeInstanceOf(Error);
  });

  it('A3 反向不成立：包基类实例不是 ClassifiedLlmError（继承只有单向）', () => {
    const base = new DiagnosticAgentError('RATE_LIMITED', '包基类实例', 0, true);

    expect(base).toBeInstanceOf(DiagnosticAgentError);
    // 若此处变 true，说明"双向 instanceof"假成立（同类互相 instanceof）⇒ 单基类改造失真
    expect(base instanceof ClassifiedLlmError).toBe(false);
  });

  it('A4 options 构造：name/code/phase/retryable/message 与入参一致', () => {
    const err = new ClassifiedLlmError({
      code: 'TIMEOUT',
      message: '上游超时',
      phase: 2,
      retryable: true,
    });

    expect(err.name).toBe('ClassifiedLlmError');
    expect(err.code).toBe('TIMEOUT');
    expect(err.phase).toBe(2);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('上游超时');
  });

  it('A5 positional 4 参兼容：同一个类、同一 name、字段一致', () => {
    const err = new ClassifiedLlmError('NETWORK', '连接被重置', 1, true);

    expect(err).toBeInstanceOf(ClassifiedLlmError);
    expect(err).toBeInstanceOf(DiagnosticAgentError);
    expect(err.name).toBe('ClassifiedLlmError');
    expect(err.code).toBe('NETWORK');
    expect(err.phase).toBe(1);
    expect(err.retryable).toBe(true);
  });

  it('A6 包内既有子类仍归同一基类，且不被误认为 LLM 分类错误', () => {
    const rl = new LLMRateLimitError('LLM 速率限制', 60000, 0);

    expect(rl).toBeInstanceOf(DiagnosticAgentError);
    expect(rl instanceof ClassifiedLlmError).toBe(false);
    expect(rl.code).toBe('LLM_RATE_LIMIT');
  });
});

// ═══ B cause 链（原生 ErrorOptions.cause 透传） ═══

describe('B cause 链：原生 super(message, options) 透传', () => {
  it('B1 options.cause 引用相等（同一引用，不是副本）', () => {
    const root = new Error('socket hang up');
    const err = new ClassifiedLlmError({
      code: 'NETWORK',
      message: '网络中断',
      phase: 0,
      retryable: true,
      cause: root,
    });

    expect(err.cause).toBe(root);
  });

  it('B2 两层包装：outer.cause.cause === root（cause 可链）', () => {
    const root = new Error('root cause');
    const inner = new ClassifiedLlmError({
      code: 'NETWORK',
      message: '内层：连接失败',
      phase: 0,
      retryable: true,
      cause: root,
    });
    const outer = new ClassifiedLlmError({
      code: 'TIMEOUT',
      message: '外层：整体超时',
      phase: 1,
      retryable: false,
      cause: inner,
    });

    expect(outer.cause).toBe(inner);
    // `Error.cause` 类型为 unknown ⇒ 用 instanceof 收窄后等价断言 outer.cause.cause === root（禁 as any）
    const wrapped: unknown = outer.cause;
    expect(wrapped).toBeInstanceOf(ClassifiedLlmError);
    if (wrapped instanceof ClassifiedLlmError) {
      expect(wrapped.cause).toBe(root);
    } else {
      // 类型收窄兜底：上面 toBeInstanceOf 已红，这里只是让分支显式 fail loud
      throw new Error('收窄失败：outer.cause 不是 ClassifiedLlmError');
    }
  });

  it('B3 抛出的错误四字段齐全：code/phase/retryable/cause', () => {
    const root = new Error('insufficient_quota');
    let caught: unknown = undefined;

    try {
      throw new ClassifiedLlmError({
        code: 'BILLING_EXCEEDED',
        message: '额度用尽',
        phase: 3,
        retryable: false,
        cause: root,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ClassifiedLlmError);
    if (!(caught instanceof ClassifiedLlmError)) {
      throw new Error('收窄失败：catch 到的不是 ClassifiedLlmError');
    }
    expect(caught.code).toBe('BILLING_EXCEEDED');
    expect(caught.phase).toBe(3);
    expect(caught.retryable).toBe(false);
    expect(caught.cause).toBe(root);
  });

  it('B4 边界：无 cause ⇒ err.cause === undefined（不伪造 cause）', () => {
    const classified = new ClassifiedLlmError('INTERNAL', '无 cause', 0, false);
    expect(classified.cause).toBeUndefined();

    // 包基类 4 参直构：原生 Error 语义 = 不传 options 时**没有** cause 属性（而不是 cause: undefined）
    const base = new DiagnosticAgentError('X', '包基类 4 参', 0, false);
    expect(base.cause).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(base, 'cause')).toBe(false);
  });

  it('B5 边界：显式 {cause: undefined} 与缺省同语义 ⇒ undefined', () => {
    const err = new ClassifiedLlmError({
      code: 'INTERNAL',
      message: '显式 undefined',
      phase: 0,
      retryable: false,
      cause: undefined,
    });

    expect(err.cause).toBeUndefined();
  });

  it('B6 边界：cause 为字符串 / 普通对象也走原生透传（引用相等）', () => {
    const strCause = 'quota-exceeded';
    const objCause = { provider: 'deepseek', status: 429 };

    expect(
      new ClassifiedLlmError({ code: 'INTERNAL', message: 'm1', phase: 0, retryable: false, cause: strCause })
        .cause,
    ).toBe(strCause);
    expect(
      new ClassifiedLlmError({ code: 'INTERNAL', message: 'm2', phase: 0, retryable: false, cause: objCause })
        .cause,
    ).toBe(objCause);
  });
});

// ═══ C 禁解析 message（棘轮：只减不增） ═══
/**
 * 判据：`message` 只给人读，**路由只认稳定 `code`**（DSH `HarnessError` 锚：
 * "route on this, never by parsing message"）。
 *
 * 机器口径 = `git grep -nE "\.message\.(includes|match|startsWith|indexOf|split)" -- src` 的**命中集合**。
 *
 * 🔴 关键：命中**不是同一类**，必须显式区分（禁把 4 条一律当白名单 —— 那是自我放宽，复核会退）：
 *   路由型（禁）：谓词方法 `includes` / `match` / `startsWith` / `indexOf`
 *                 —— 返回值（布尔/下标）本身就是判定输入 ⇒ 拿 message 做了控制流
 *   取样型（容忍）：`split(<sep>)[N]` 等**截取**子串，且截取后不再参与比较/分支
 *                 —— 只把 message 的首行塞进日志 detail，不决定路由
 *
 * 判别 = **代码形状**（谓词方法 ⇒ 路由；`split` 后紧跟 `[N]`/`.at()`/`.slice()` 且语句内无比较/分支 ⇒ 取样），
 * 与"文件+行号白名单"**分开**：先分类，再断言路由型集合严格等于下述钉死条目。
 * ⇒ 任意文件新增第 3 条路由型（如 `err.message.includes(...)`）⇒ C1 红。
 * 判别力自证：C4（多喂一条路由型 ⇒ 判红）/ C5（纯 split 取样不被误判 ⇒ 判别力不是"全红"）。
 */

/** 与 `git grep -E` 同源的模式（C3 用来互证两条独立扫描路径） */
const MESSAGE_PARSE_GREP = String.raw`\.message\.(includes|match|startsWith|indexOf|split)`;
const MESSAGE_PARSE_RE = /\.message\.(includes|match|startsWith|indexOf|split)\s*\(/;

/** 路由型（谓词方法）：返回值本身是判定输入 */
const PREDICATE_METHODS = new Set(['includes', 'match', 'startsWith', 'indexOf']);

/** 白名单：**路由型只许这 2 条**（文件 + 行号钉死；新增第 3 条 ⇒ 红） */
const PINNED_ROUTING: readonly string[] = ['src/llm/types.ts:79', 'src/providers/deepseek.ts:33'];

/**
 * 取样型棘轮记录（只减不增）：`.message.split('\n')[0]` 取首行做日志 detail。
 * 允许新增，但必须**人工同步本清单**（= 一次有意识的决定）；不自动放宽。
 */
const PINNED_SAMPLING: readonly string[] = [
  'src/services/content-layering.ts:212',
  'src/services/request-context.ts:253',
];

type ParseShape = '路由型' | '取样型';

interface MessageParseHit {
  /** 相对扫描根的 `文件:行号`（钉死用） */
  readonly where: string;
  readonly method: string;
  readonly shape: ParseShape;
}

/**
 * 形状判别（纯函数，可单测 / 可参数化）。
 * 只 `split` 且**未截取**子串 ⇒ 形状不明，按**路由型严判**（宁可误报，不默认放过）。
 * @param line - 含命中的整行源码
 * @param method - 命中的方法名（`includes` / `match` / ... / `split`）
 */
function classifyParseShape(line: string, method: string): ParseShape {
  if (PREDICATE_METHODS.has(method)) return '路由型';

  // 仅 split 走到这里
  const hitAt = line.search(MESSAGE_PARSE_RE);
  const afterHit = hitAt === -1 ? line : line.slice(hitAt);
  const semi = afterHit.indexOf(';');
  const statement = semi === -1 ? afterHit : afterHit.slice(0, semi);

  const isExtraction = /\)\s*(\[\s*\d+\s*\]|\.at\s*\(|\.slice\s*\()/.test(statement);
  if (!isExtraction) return '路由型'; // 只 split 不截取 ⇒ 形状不明 ⇒ 严判

  const isDecided = /===|!==|\?\s|&&|\|\||\bif\s*\(/.test(statement);
  return isDecided ? '路由型' : '取样型';
}

/** 递归列 `.ts` / `.tsx`（排除 node_modules 与测试件本身：棘轮只扫产品代码） */
function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      listSourceFiles(full, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * 扫描 `<root>/src` 下所有 message 解析命中并分类。
 * @param root - 仓库根（其下有 `src/`）；参数化是为了在临时 copy 上复核判别力（T4）
 * @returns 按 `文件:行号` 排序的命中列表
 */
function scanMessageParsing(root: string): MessageParseHit[] {
  const srcRoot = path.join(root, 'src');
  const hits: MessageParseHit[] = [];
  for (const file of listSourceFiles(srcRoot)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const lines = readFileSync(file, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const matched = MESSAGE_PARSE_RE.exec(lines[i]);
      if (matched === null) continue;
      hits.push({
        where: `${rel}:${i + 1}`,
        method: matched[1],
        shape: classifyParseShape(lines[i], matched[1]),
      });
    }
  }
  return hits.sort((a, b) => (a.where < b.where ? -1 : a.where > b.where ? 1 : 0));
}

/**
 * 棘轮违规（空数组 = 本根未破坏棘轮）。**同一函数**既跑真树（C1）也跑临时 copy（C4）。
 * @param root - 仓库根
 */
function ratchetViolations(root: string): string[] {
  const hits = scanMessageParsing(root);
  const routing = hits.filter((hit) => hit.shape === '路由型').map((hit) => hit.where);
  const violations: string[] = [];

  const unexpected = routing.filter((where) => !PINNED_ROUTING.includes(where));
  if (unexpected.length > 0) {
    violations.push(`新增路由型（禁解析 message 棘轮被放宽）：${unexpected.join(', ')}`);
  }
  const missing = PINNED_ROUTING.filter((pinned) => !routing.includes(pinned));
  if (missing.length > 0) {
    violations.push(`钉死条目已消失（须同步收紧 PINNED_ROUTING，禁留陈旧白名单）：${missing.join(', ')}`);
  }
  return violations;
}

/** 造临时探针根：4 条真实命中文件按相对路径复制 ＋ 注入一条路由型（不碰产品 src） */
function makeRoutingProbeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'synova-914q3-ratchet-'));
  for (const rel of [
    'src/llm/types.ts',
    'src/providers/deepseek.ts',
    'src/services/content-layering.ts',
    'src/services/request-context.ts',
  ]) {
    const dest = path.join(root, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  writeFileSync(
    path.join(root, 'src/llm/probe-extra-routing.ts'),
    [
      'export function probeRoute(err: Error, code: string): boolean {',
      '  // 判别力自证注入：路由型（谓词）解析 message',
      '  if (err.message.includes(`${code}`)) return true;',
      '  return false;',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  );
  return root;
}

describe('C 禁解析 message 棘轮（路由型只许 2 条钉死）', () => {
  it('C1 路由型命中集合严格等于 2 条钉死（新增第 3 条 ⇒ 红）', () => {
    const hits = scanMessageParsing(RATCHET_ROOT);
    const routing = hits.filter((hit) => hit.shape === '路由型').map((hit) => hit.where);
    const sampling = hits.filter((hit) => hit.shape === '取样型').map((hit) => hit.where);

    expect(routing).toEqual([...PINNED_ROUTING]);
    // 显式编码"4 条里只有 2 条是路由型"，防止把 4 条一律当白名单
    expect(hits).toHaveLength(4);
    expect(sampling).toEqual([...PINNED_SAMPLING]);
    expect(ratchetViolations(RATCHET_ROOT)).toEqual([]);
  });

  it('C2 取样型只许现有 2 条（只减不增，新增须人工同步清单）', () => {
    const hits = scanMessageParsing(RATCHET_ROOT);
    const sampling = hits
      .filter((hit) => hit.shape === '取样型')
      .map((hit) => hit.where)
      .sort();

    expect(sampling).toEqual([...PINNED_SAMPLING].sort());
    // 取样型不得同时出现在路由型白名单里（否则分类自相矛盾）
    expect(sampling.filter((where) => PINNED_ROUTING.includes(where))).toEqual([]);
  });

  it('C3 文件系统扫描与 git grep 逐条一致（两条独立路径互证，防扫描漂移）', () => {
    const viaGit = gitGrep(['-nE', MESSAGE_PARSE_GREP, '--', 'src'], REPO_ROOT)
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [file, lineNo] = line.split(':');
        return `${file}:${lineNo}`;
      })
      .sort();
    const viaFs = scanMessageParsing(REPO_ROOT)
      .map((hit) => hit.where)
      .sort();

    expect(viaFs).toEqual(viaGit);
  });

  it('C4 判别力自证：多喂一条路由型 ⇒ 同一棘轮判红（临时 copy，不碰 src）', () => {
    const probeRoot = makeRoutingProbeRoot();
    try {
      const violations = ratchetViolations(probeRoot);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join(' | ')).toContain('src/llm/probe-extra-routing.ts:3');
      // 真树仍无违规（证明红只由注入引起，不是判定函数恒红）
      expect(ratchetViolations(REPO_ROOT)).toEqual([]);
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  });

  it('C5 判别力反向：纯 split 取首行的取样形状不被误判为路由型', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-914q3-sampling-'));
    try {
      mkdirSync(path.join(root, 'src/services'), { recursive: true });
      writeFileSync(
        path.join(root, 'src/services/probe-sampling.ts'),
        [
          'export function detail(err: unknown): string {',
          "  return err instanceof Error ? err.message.split('\\n')[0] : String(err);",
          '}',
          '',
        ].join('\n'),
        'utf-8',
      );

      const hits = scanMessageParsing(root);
      expect(hits).toHaveLength(1);
      expect(hits[0].shape).toBe('取样型');
      // 取样不触发"新增路由型"违规（否则棘轮退化为全红 = 无判别力）
      expect(ratchetViolations(root).some((v) => v.includes('新增路由型'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
