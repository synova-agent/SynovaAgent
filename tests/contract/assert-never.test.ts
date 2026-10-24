/**
 * tests/contract/assert-never.test.ts — 914-Q4 assertNever 不可达分支 fail-loud 契约测试
 *
 * 判据来源：914-Q4 规格 §4.2–§4.6（#914 · 裁 366）——四组机器判据：
 *   A 运行时逃逸：类型外取值传入 isRetryable ⇒ 抛 UnreachableVariantError（typed error，禁静默 return false）
 *   B 编译期证据存档：见下方「B 编译期（证据存档）」——不在测试里改源码造变异（避免自指）
 *   C 存量 switch 只减不增：39 文件/39 债基线棘轮（fs 扫描 + 钉死清单 + 自证注入，复用 Q-3 棘轮形状）
 *   D 行为不变：24 个 ErrorCode 的 isRetryable 真值表与改前逐条一致
 *
 * 铁律 48: 每块都有断言；铁律 38: 零 `as any` / `as never` / `as unknown as`
 *   —— A 组模拟反序列化逃逸仅用 `as ErrorCodeType`（规格 R3 显式允许）。
 * ⚠️ 本文件只读产品代码；判别力自证（C3/C4）只写 `os.tmpdir()` 临时 copy，结束即删。
 *
 * @known-limitations
 *   - C 扫描是**代码形状**判别（`switch (` 行 → 花括号配对 → 块内含 `assertNever(`），
 *     不是 AST 数据流分析：字符串字面量里的花括号可能干扰配对（当前基线 39 文件无此形状）。
 *   - C 基线按**文件粒度**钉死债务数（非行号）：文件内行号位移不红，只认"债数增减"。
 *   - B 是**注释存档**（证据来自 L1 临时树实测），机器红绿只有 A/C/D + `npx tsc --noEmit` 复跑。
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DiagnosticAgentError, UnreachableVariantError, assertNever } from '@synova/error-types';
import { ErrorCode, ErrorCodeType, isRetryable } from '../../src/errors/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

// ═══ A 运行时逃逸（规格 §4.2 / C2 边界值清单） ═══

/** 断言"传入即抛 UnreachableVariantError 且四字段齐全"的最小谓词（A 组共用） */
function expectEscapeToThrow(input: unknown, context = 'isRetryable'): void {
  let caught: unknown = undefined;
  try {
    isRetryable(input as ErrorCodeType); // 规格唯一允许的强制转型（R3）
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(UnreachableVariantError);
  if (!(caught instanceof UnreachableVariantError)) {
    throw new Error('收窄失败：catch 到的不是 UnreachableVariantError');
  }
  expect(caught).toBeInstanceOf(DiagnosticAgentError);
  expect(caught.code).toBe('UNREACHABLE_VARIANT');
  expect(caught.phase).toBe(0);
  expect(caught.retryable).toBe(false);
  expect(caught.message).toContain(context);
}

describe('A 运行时逃逸：isRetryable 对类型外取值 fail-loud', () => {
  it('A1 反序列化逃逸：JSON.parse 伪码 ⇒ 抛 UnreachableVariantError（不静默 return false）', () => {
    const raw: unknown = JSON.parse('"NOT_A_REAL_CODE"');
    expectEscapeToThrow(raw);
    // 消息里能看到逃逸值本身（安全渲染，人读可定位）
    let msg = '';
    try {
      isRetryable(raw as ErrorCodeType);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain('NOT_A_REAL_CODE');
  });

  it('A2 边界：空串 / null / 数字逃逸 ⇒ 一律抛（C2 清单）', () => {
    expectEscapeToThrow('');
    expectEscapeToThrow(null);
    expectEscapeToThrow(42);
  });

  it('A3 直接构造：new UnreachableVariantError(context, value) 字段断言（不依赖强制转型）', () => {
    const err = new UnreachableVariantError('probe', 'X');
    expect(err).toBeInstanceOf(DiagnosticAgentError);
    expect(err.name).toBe('UnreachableVariantError');
    expect(err.code).toBe('UNREACHABLE_VARIANT');
    expect(err.phase).toBe(0);
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('probe');
    expect(err.message).toContain('X');
  });

  it('A4 context 缺省：message 含 "switch"（默认值）；自定义 context 进 message', () => {
    let caught: unknown = undefined;
    try {
      // @ts-expect-error —— 故意传非 never 值以验运行时 fail-loud（规格 R3 禁 `as never`）
      assertNever('ESCAPED', undefined);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnreachableVariantError);
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof UnreachableVariantError) {
      expect(caught.message).toContain('switch');
    }
    // 自定义 context（isRetryable 同源口径）
    expectEscapeToThrow('OTHER', 'isRetryable');
  });

  it('A5 值渲染：对象走 JSON.stringify；循环引用（JSON.stringify 失败）回退 String，不抛渲染错误', () => {
    const plain = { code: 'X' };
    const errPlain = new UnreachableVariantError('probe', plain);
    expect(errPlain.message).toContain('{"code":"X"}');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const errCirc = new UnreachableVariantError('probe', circular);
    // 不抛（构造成功即证明回退生效），且 message 仍是可读字符串
    expect(typeof errCirc.message).toBe('string');
    expect(errCirc.message).toContain('probe');
  });
});

// ═══ B 编译期（证据存档，规格 §4.3） ═══
/**
 * B1（证据存档，不改码）——L1 在临时树（非主干）实测：
 *   给 `ErrorCode` 加成员 `PROBE_NEW_CODE: 'PROBE_NEW_CODE'` 后
 *   `npx tsc --noEmit` ⇒ rc=2，输出原文：
 *     src/errors/types.ts(579,26): error TS2345: Argument of type '"PROBE_NEW_CODE"' is not assignable to parameter of type 'never'.
 *   （dev doc §3-E3；exhaustive switch + `default: return assertNever(code, ...)` 使新成员被收窄为 never ⇒ 编译期红）
 *
 * B2（可复跑，不进 CI 硬门）：`npx tsc --noEmit` 应 rc=0。
 * 本批不在测试里改源码造编译期变异（避免测试自指）；改坏两态归独立自验（M3）。
 */
describe('B 编译期证据存档', () => {
  it('B0 基线：assertNever/UnreachableVariantError 自包内导出且签名恒抛（never 返回型）', () => {
    // 存档锚：包真实导出（B 判据的编译期证据靠 tsc 复跑；此处只钉"导出面存在"）
    expect(typeof assertNever).toBe('function');
    expect(typeof UnreachableVariantError).toBe('function');
    // @ts-expect-error —— 同上：运行时逃逸必须炸（类型层用 @ts-expect-error 表达"故意非法"）
    expect(() => assertNever('X')).toThrow(UnreachableVariantError);
  });
});

// ═══ C 存量 switch 只减不增（基线棘轮，规格 §4.4） ═══

/** 钉死基线：39 文件 / 39 债（dev doc §3 附录；src/errors/types.ts 转换 isRetryable 后 = 1） */
const SWITCH_DEBT_BASELINE: Readonly<Record<string, number>> = {
  'src/agent/conversation-engine.ts': 1,
  'src/agent/expert-interaction-protocol.ts': 1,
  'src/agent/interactive-card.ts': 1,
  'src/agent/prompt-assembler.ts': 1,
  'src/agent/report-assembler.ts': 1,
  'src/agent/tool-profiles.ts': 1,
  'src/agent/tools.ts': 1,
  'src/cli.ts': 1,
  'src/cli/commands/config-cmd.ts': 1,
  'src/cli/commands/expert.ts': 1,
  'src/cli/commands/knowledge.ts': 1,
  'src/cli/commands/measurer.ts': 1,
  'src/contract/contract-gate.ts': 1,
  'src/errors/types.ts': 1,
  'src/evidence/index.ts': 1,
  'src/expert-platform/validator.ts': 1,
  'src/growth/knowledge-feedback.ts': 1,
  'src/l2/proposal-manager.ts': 1,
  'src/l3/expert-autonomy.ts': 1,
  'src/l3/ga-collaboration.ts': 1,
  'src/l3/knowledge-agent.ts': 1,
  'src/l5/alert-rules.ts': 1,
  'src/l5/ontology-event-bus.ts': 1,
  'src/loops/middle-evolution-engine.ts': 1,
  'src/mcp/tool-definitions.ts': 1,
  'src/mcp/tool-registration.ts': 1,
  'src/orchestrator/context-compressor.ts': 1,
  'src/orchestrator/phase0-engine.ts': 1,
  'src/output/contract-validator.ts': 1,
  'src/providers/index.ts': 1,
  'src/routes/chat.ts': 1,
  'src/routes/llm-config.ts': 1,
  'src/routes/sentinel.ts': 1,
  'src/sentinel/flywheel-aggregator.ts': 1,
  'src/sentinel/runner.ts': 1,
  'src/sentinel/sentinel-accuracy.ts': 1,
  'src/services/fault-recovery.ts': 1,
  'src/services/update-checker.ts': 1,
  'src/tui-v2/lib/sidebar-aggregator.ts': 1,
};

/** 扫描根（探针钩子：判别力自证在临时 copy 上跑同一扫描器；只会更严，不放宽断言） */
const SCAN_ROOT = process.env.SYNO_SWITCH_RATCHET_ROOT ?? REPO_ROOT;

/** 递归列 `.ts`（排除 node_modules / 测试件） */
function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      listTsFiles(full, acc);
      continue;
    }
    if (/\.ts$/.test(entry.name) === false) continue;
    if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * 单文件计债：每个 `switch (`（trim 后非 `*`/`//`/`/*` 注释行）取其后第一个 `{` 起
 * 花括号配对成块；块内含 `assertNever(` ⇒ 已转换（0 债），否则 1 债。
 * @param lines - 源文件按行拆分
 * @returns 该文件未转换的 switch 数
 */
function countSwitchDebtInLines(lines: readonly string[]): number {
  let debt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    if (/\bswitch\s*\(/.test(lines[i]) === false) continue;

    // 从本行起找第一个 `{`，花括号配对取整个 switch 块
    let depth = 0;
    let started = false;
    let block = '';
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth += 1;
          started = true;
        } else if (ch === '}') {
          depth -= 1;
        }
      }
      block += lines[j];
      if (started && depth <= 0) break; // 块闭合
    }
    if (!started) continue; // 无块（语法异常形状）：不计（扫描器形状判别，见 known-limitations）
    if (block.includes('assertNever(') === false) debt += 1;
  }
  return debt;
}

/**
 * 扫描 `<root>/src` 与 `<root>/packages/<pkg>/src` 下全部产品 `.ts`，返回 文件→债 映射（只含债>0 的文件）。
 * @param root - 仓库根
 */
/** 真目录守卫（排除悬空符号链接，如 packages/_archived；fail loud 于真目录缺失） */
function isRealDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}

function scanSwitchDebt(root: string): Record<string, number> {
  const debt: Record<string, number> = {};
  const targets: string[] = [];
  const srcRoot = path.join(root, 'src');
  if (isRealDir(srcRoot)) targets.push(srcRoot);
  const pkgSrcRoot = path.join(root, 'packages');
  if (isRealDir(pkgSrcRoot)) {
    for (const pkg of readdirSync(pkgSrcRoot, { withFileTypes: true })) {
      if (pkg.isDirectory() === false) continue;
      const pkgSrc = path.join(pkgSrcRoot, pkg.name, 'src');
      if (isRealDir(pkgSrc)) targets.push(pkgSrc);
    }
  }
  for (const dir of targets) {
    for (const file of listTsFiles(dir)) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const lines = readFileSync(file, 'utf-8').split('\n');
      const n = countSwitchDebtInLines(lines);
      if (n > 0) debt[rel] = n;
    }
  }
  return debt;
}

/**
 * 棘轮违规（空数组 = 未破坏）。增 ⇒ 红点名；减 ⇒ 红"基线未同步"。
 * @param root - 仓库根
 */
function debtViolations(root: string): string[] {
  const scanned = scanSwitchDebt(root);
  const violations: string[] = [];
  const baseline = SWITCH_DEBT_BASELINE;

  const added = Object.keys(scanned).filter((f) => baseline[f] === undefined);
  for (const f of added.sort()) {
    violations.push(`switch 债基线被抬高：${f} 扫描 ${scanned[f]} > 基线 0（新增 switch 必须用 assertNever，或由 CTO 裁增基线）`);
  }
  const increased = Object.entries(baseline).filter(([f, n]) => (scanned[f] ?? 0) > n);
  for (const [f, n] of increased) {
    violations.push(`switch 债基线被抬高：${f} 扫描 ${scanned[f]} > 基线 ${n}（新增 switch 必须用 assertNever，或由 CTO 裁增基线）`);
  }
  const decreased = Object.entries(baseline).filter(([f, n]) => (scanned[f] ?? 0) < n);
  for (const [f, n] of decreased) {
    violations.push(`基线未同步：${f} 扫描 ${scanned[f] ?? 0} < 基线 ${n}（存量已转换 ⇒ 须同步收紧 SWITCH_DEBT_BASELINE）`);
  }
  return violations;
}

describe('C 存量 switch 只减不增（39 文件/39 债基线棘轮）', () => {
  it('C1 扫描结果与 SWITCH_DEBT_BASELINE 严格相等（增⇒红点名；减⇒红"基线未同步"）', () => {
    const scanned = scanSwitchDebt(SCAN_ROOT);
    expect(scanned).toEqual({ ...SWITCH_DEBT_BASELINE });
    expect(debtViolations(SCAN_ROOT)).toEqual([]);
  });

  it('C2 总债数 = 39（基线派生值，独立可读信号）', () => {
    const scanned = scanSwitchDebt(SCAN_ROOT);
    const total = Object.values(scanned).reduce((s, n) => s + n, 0);
    const baselineTotal = Object.values(SWITCH_DEBT_BASELINE).reduce((s, n) => s + n, 0);
    expect(total).toBe(baselineTotal);
    expect(total).toBe(39);
  });

  it('C3 判别力自证：注入无 assertNever 的新 switch ⇒ 同一 debtViolations 判红并点名（临时 copy，不碰 src）', () => {
    const probeRoot = mkdtempSync(path.join(tmpdir(), 'synova-914q4-switch-'));
    try {
      // 复制最小真实面：src/errors/types.ts（基线成员）+ 注入新文件
      mkdirSync(path.join(probeRoot, 'src/errors'), { recursive: true });
      writeFileSync(
        path.join(probeRoot, 'src/errors/types.ts'),
        readFileSync(path.join(REPO_ROOT, 'src/errors/types.ts'), 'utf-8'),
        'utf-8',
      );
      writeFileSync(
        path.join(probeRoot, 'src/probe-new-switch.ts'),
        [
          'export function probe(v: string): boolean {',
          '  switch (v) {',
          "    case 'a':",
          '      return true;',
          '    default:',
          '      return false;',
          '  }',
          '}',
          '',
        ].join('\n'),
        'utf-8',
      );

      const violations = debtViolations(probeRoot);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join(' | ')).toContain('src/probe-new-switch.ts');
      // 减侧判别力：基线其余 38 文件缺失 ⇒ "基线未同步"也须红（非恒红探针之外的真实信号）
      expect(violations.join(' | ')).toContain('基线未同步');
      // 真树仍无违规（证明红只由注入引起）
      expect(debtViolations(REPO_ROOT)).toEqual([]);
    } finally {
      rmSync(probeRoot, { recursive: true, force: true });
    }
  });

  it('C4 判别力反向：块内含 assertNever( 的 switch 不计债（转换后清零）', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'synova-914q4-conv-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      writeFileSync(
        path.join(root, 'src/converted.ts'),
        [
          "import { assertNever } from '@synova/error-types';",
          'export function f(v: string): boolean {',
          '  switch (v) {',
          "    case 'a':",
          '      return true;',
          '    default:',
          "      return assertNever(v, 'f');",
          '  }',
          '}',
          '',
        ].join('\n'),
        'utf-8',
      );
      const scanned = scanSwitchDebt(root);
      expect(scanned['src/converted.ts']).toBeUndefined(); // 已转换 ⇒ 不进债表
      expect(debtViolations(root).some((v) => v.includes('src/converted.ts'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══ D 行为不变：24 码真值表（规格 §4.5） ═══

describe('D 行为不变：isRetryable 真值表与改前逐条一致', () => {
  it('D1 Object.values(ErrorCode) 全 24 码真值表一致（改前钉死）', () => {
    const codes = Object.values(ErrorCode);
    expect(codes).toHaveLength(24);
    const truthy = new Set<ErrorCodeType>([
      'TIMEOUT',
      'NETWORK',
      'DNS',
      'RATE_LIMITED',
      'ENGINE_TIMEOUT',
      'DB_ERROR',
      'OVERLOADED',
      'SERVER_ERROR',
      'CONTEXT_OVERFLOW',
      'PAYLOAD_TOO_LARGE',
      'EMPTY_RESPONSE',
      'AUTH_FAILED',
    ]);
    for (const code of codes) {
      expect(isRetryable(code as ErrorCodeType)).toBe(truthy.has(code as ErrorCodeType));
    }
  });

  it('D2 每个合法码都不抛（边界：与逃逸值行为对立）', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(() => isRetryable(code as ErrorCodeType)).not.toThrow();
    }
  });
});
