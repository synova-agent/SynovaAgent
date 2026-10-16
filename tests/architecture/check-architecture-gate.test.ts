/**
 * tests/architecture/check-architecture-gate.test.ts — CT-64 门禁行为测试
 *
 * 契约（铁律 47）—— scripts/check-architecture.sh L1 段修补后的行为契约：
 *   @input  真实仓库 src/（默认）或 SYNO_ARCH_SRC 注入的沙箱源目录；
 *           存量基线 tests/architecture/l1-cross-layer-baseline.txt（默认）或 SYNO_ARCH_BASELINE 注入；
 *           SYNO_CI=1 时进入 CI strict 模式（D515/D516 先例）。
 *   @output 按方向（L1→L3 / L1→L4 / L1→L5）逐行打印违规 file:line:内容；
 *           exit 0 = 通过（含基线内存量）；exit 1 = 基线外新增违规且 SYNO_CI=1；
 *           exit 2 = 检查自身失败（扫描目标缺失等，fail-closed，禁止吞）。
 *   @degraded 无（本门禁不允许降级放行——环境失败必须 exit 2 可见）。
 *
 * 覆盖矩阵（铁律 48）：
 *   [正常]   真实仓库存量命中与基线 file=count 双向一致（D603 静态清零 68→42 + D595 哨兵簇 42→36）
 *   [正常]   存量在本地与 SYNO_CI=1 下均不阻断（棘轮——台账 CT-64：先修脚本→分批修 src/）
 *   [正常]   沙箱新增违规：本地 exit 0 软提示；SYNO_CI=1 exit 1 硬阻断
 *   [边界]   干净文件零误报：类型位置四形态 / URL 字符串 / 注释 / L2 合法引用
 *   [回归]   修补2：agent-observer / ga-annotations 文件内违规必须命中（名字豁免已删）
 *   [回归]   修补1：动态形态 await import( / import( / require( 必须命中
 *   [边界]   // arch-allow(reason) 行内豁免生效
 *   [边界]   基线棘轮：超基线=新增；低于基线=提示收紧（不阻断）
 *   [降级]   扫描目标缺失 → exit 2（fail-closed，M1 fail-open 根除回归）
 *
 * D603（2026-09-09）: 26 处静态 import 全部清零（基线 68→42）。D603-R2（CI 打回修复）:
 * 「逐行命中」断言升级为 file=count 双向比对——基线粒度本就是 file=count（行号漂移免疫，
 * 基线文件头自述）；file:line 断言已在 main 被行号漂移两次打破（diagnosis/server.ts
 * 合并漂移 7 行实证），升级后任何基线外新增/基线内计数不符都会被具名点出。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-architecture.sh');
const BASELINE = path.join(REPO_ROOT, 'tests', 'architecture', 'l1-cross-layer-baseline.txt');

/** 基线解析: [方向段] file=count → { '方向|file': count }（与基线文件同一权威粒度） */
function parseBaselineCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  let sec = '';
  for (const line of readFileSync(BASELINE, 'utf-8').split('\n')) {
    if (line.startsWith('[L1→L3]')) { sec = 'L1→L3'; continue; }
    if (line.startsWith('[L1→L4]')) { sec = 'L1→L4'; continue; }
    if (line.startsWith('[L1→L5]')) { sec = 'L1→L5'; continue; }
    const m = line.match(/^(.+?)=(\d+)\s*$/);
    if (m && sec) counts[`${sec}|${m[1]}`] = Number(m[2]);
  }
  return counts;
}

/** 脚本 stdout 解析: 方向段标记（1b/1c/1d）+ 违规行（5 空格缩进 file:line:）→ { '方向|file': count } */
function parseActualCounts(stdout: string): Record<string, number> {
  const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const counts: Record<string, number> = {};
  let sec = '';
  for (const line of clean.split('\n')) {
    if (line.includes('1b.')) { sec = 'L1→L3'; continue; }
    if (line.includes('1c.')) { sec = 'L1→L4'; continue; }
    if (line.includes('1d.')) { sec = 'L1→L5'; continue; }
    const vm = line.match(/^\s{5}(src\/[^:\s]+):\d+:/);
    if (vm && sec && !line.includes('arch-allow')) {
      const key = `${sec}|${vm[1]}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

interface RunResult {
  status: number;
  stdout: string;
}

function runScript(env: Record<string, string>, cwd = REPO_ROOT): RunResult {
  // D663 密封化: 剥除继承的 SYNO_CI——CI job 级 env 会经 process.env 泄漏进 local 子运行
  // （PLAN-ci-syno-leak 泄漏路径实证: vitest spawnSync 继承 → 沙箱 local 场景被误判 CI strict
  //  → exit 1 ≠ 0）。local 语义 = 未设 SYNO_CI；CI 场景由调用方显式传 SYNO_CI:'1'，不受影响。
  const { SYNO_CI: _strippedSynoCi, ...hostEnv } = process.env;
  const res = spawnSync('bash', [SCRIPT], {
    cwd,
    env: { ...hostEnv, ...env },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: res.status ?? -1, stdout: res.stdout ?? '' };
}

/** D603+D595 后剩余 36 处动态 runtime 违规的权威计数 = tests/architecture/l1-cross-layer-baseline.txt（file=count，唯一事实源） */

function makeSandbox(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct64-arch-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const EMPTY_BASELINE = path.join(tmpdir(), 'ct64-empty-baseline.txt');
writeFileSync(EMPTY_BASELINE, '# empty baseline\n');

describe('CT-64: check-architecture.sh 四类漏网修补 — 存量 36 处全命中（D603 静态清零 + D595 哨兵簇下调后）', () => {
  it('真实仓库：脚本命中按 file=count 聚合后与基线双向一致（行号漂移免疫）', () => {
    const { status, stdout } = runScript({ SYNO_CI: '0' });
    const expected = parseBaselineCounts();
    const actual = parseActualCounts(stdout);
    const mismatched = Object.keys(expected).filter((k) => (actual[k] || 0) !== expected[k]);
    const extra = Object.keys(actual).filter((k) => !(k in expected));
    expect(
      mismatched,
      `基线内计数不符（脚本漏检或存量已变——请先修 src/ 再同步基线）: ${mismatched.map((k) => `${k} 基线=${expected[k]} 实际=${actual[k] || 0}`).join(', ')}`,
    ).toEqual([]);
    expect(extra, `基线外新增违规（不在棘轮基线内——先修复或走 // arch-allow 正当豁免并同步基线）: ${extra.join(', ')}`).toEqual([]);
    expect(status).toBe(0); // 棘轮：存量不阻断
  });

  it('真实仓库：SYNO_CI=1 下存量仍 exit 0（基线棘轮——避免一次性全红压垮编码线）', () => {
    const { status, stdout } = runScript({ SYNO_CI: '1' });
    expect(stdout).toContain('存量');
    expect(status).toBe(0);
  });

  it('基线文件总数 = 24（#4 段B未决项收紧 38→24；棘轮只减不增——上调须头部有例外记录：理由+收紧任务，缺一即红）', () => {
    const content = spawnSync('cat', [BASELINE], { encoding: 'utf-8' });
    const text = content.stdout ?? '';
    const total = text
      .split('\n')
      .filter((l) => /=\d+\s*$/.test(l))
      .reduce((sum, l) => sum + Number(l.split('=')[1]), 0);
    // K3 D593FIX2 附记补强：棘轮只许减少；逆向上调必须携带例外记账（理由 + 收紧任务 owner/期限）
    // 🔴 #4 门槛随总量等价移植（**不改判据语义**）：原 `> 36` = "无例外水平"（38 = 36 + D593-FIX2 例外 2）。
    //    现总量 24 = 22 + 同一笔例外 2 ⇒ "无例外水平" = 22；若仍用 36，本闸在 24 下**恒不触发 = 死闸**，
    //    "上调须记例外"的强制力会静默消失（独立复核 C-bonus 抓到）。故移植为 `> 22`，语义与原文逐字等价。
    if (total > 22) {
      expect(text).toMatch(/逆向例外/);
      expect(text).toMatch(/收紧路径|收紧任务/);
      expect(text).toMatch(/PLAN-diagnosis-l5-di/);
    }
    expect(total).toBe(24);
  });
});

describe('CT-64: 新增违规 — soft→SYNO_CI 转硬（D515/D516 语义）', () => {
  it('沙箱新增违规：本地 exit 0 + 逐行点名；SYNO_CI=1 exit 1', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/new-violation.ts': [
        "import { SessionStore } from '../store/session-store';",
        "const { getSentinelRegistry } = await import('../sentinel/registry');",
        'export const X = 1;',
      ].join('\n'),
    });
    try {
      const local = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE });
      expect(local.status).toBe(0); // 本地软提示不阻断
      expect(local.stdout).toContain('routes/new-violation.ts:1');
      expect(local.stdout).toContain('routes/new-violation.ts:2');
      expect(local.stdout).toContain('新增');

      const ci = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE, SYNO_CI: '1' });
      expect(ci.status).toBe(1); // CI strict 硬阻断
      expect(ci.stdout).toContain('routes/new-violation.ts:1');
    } finally {
      cleanup();
    }
  });

  it('基线棘轮：同文件同方向超基线计数 = 新增（按 file=count 粒度，行号漂移免疫）', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/partial.ts': [
        "import { SessionStore } from '../store/session-store';",
        "import Database from 'better-sqlite3';",
      ].join('\n'),
    });
    const baselinePath = path.join(dir, 'baseline.txt');
    writeFileSync(baselinePath, '[L1→L5]\nroutes/partial.ts=1\n');
    try {
      const ci = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: baselinePath, SYNO_CI: '1' });
      expect(ci.status).toBe(1); // 实际 2 > 基线 1 → 新增 1 → CI 阻断
    } finally {
      cleanup();
    }
  });

  it('基线棘轮：低于基线 = 已修复，提示收紧但不阻断', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/fixed-one.ts': "import { SessionStore } from '../store/session-store';",
    });
    const baselinePath = path.join(dir, 'baseline.txt');
    writeFileSync(baselinePath, '[L1→L5]\nroutes/fixed-one.ts=3\n');
    try {
      const local = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: baselinePath });
      expect(local.status).toBe(0);
      expect(local.stdout).toContain('收紧');
    } finally {
      cleanup();
    }
  });
});

describe('CT-64: 零误报 — 干净文件不命中', () => {
  it('类型位置四形态 + URL 字符串 + 注释 + L2 合法引用：全部零命中', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/clean.ts': [
        "import type { GraphStore } from '../l4/graph-bridge';",                    // import type
        'let s: import("../sentinel/types").SentinelFinding[] = [];',               // : import(
        'const r = report as import("../l3/synova-diagnosis-engine").DiagnosisReport;', // as import(
        'type Alias = import("../l4/knowledge-store").KnowledgeStore;',             // type X = import(
        "const url = '/api/sentinel/findings';",                                    // URL 字符串
        "router.get('/api/expert/contribute', handler);",                           // URL 路由
        ' * GET /api/sentinel/reports — 注释',                                      // 注释
        "import { sentinelService } from '../agent/sentinel-service';",             // L2 合法
        "const { loadExpertConfig } = await import('../agent/expert-config-loader');", // L2 合法（裸 expert 不得误报）
        "import { DiagnosisEngine } from '../l2-interfaces/diagnosis-engine';",     // L2 接口合法
        'export const OK = 1;',
      ].join('\n'),
    });
    try {
      const { status, stdout } = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE });
      expect(status).toBe(0);
      expect(stdout).not.toContain('clean.ts:');
    } finally {
      cleanup();
    }
  });

  it('修补1 回归：动态形态 await import( / import( / require( 必须命中（不再只认 from）', () => {
    const { dir, cleanup } = makeSandbox({
      'mcp/dynamic.ts': [
        "const { Registry } = await import('../sentinel/registry');",
        "const mod = import('../l3/expert-registry');",
        "const legacy = require('../store/session-store');",
      ].join('\n'),
    });
    try {
      const { status, stdout } = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE });
      expect(status).toBe(0); // 本地软提示
      expect(stdout).toContain('mcp/dynamic.ts:1');
      expect(stdout).toContain('mcp/dynamic.ts:2');
      expect(stdout).toContain('mcp/dynamic.ts:3');
    } finally {
      cleanup();
    }
  });

  it('修补2 回归：agent-observer / ga-annotations 文件内违规必须命中（名字豁免已删除）', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/agent-observer.ts': "import { SqliteGraphStore } from '../adapters/sqlite-graph-store';",
      'routes/ga-annotations.ts': "import { computeSentinelAccuracy } from '../sentinel/sentinel-accuracy';",
    });
    try {
      const { status, stdout } = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE });
      expect(status).toBe(0);
      expect(stdout).toContain('routes/agent-observer.ts:1');
      expect(stdout).toContain('routes/ga-annotations.ts:1');
    } finally {
      cleanup();
    }
  });

  it('行内豁免：// arch-allow(L1→L3): 理由 的行豁免且豁免本身透明可见', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/with-allow.ts': [
        "import { Registry } from '../sentinel/registry'; // arch-allow(L1→L3): 组合根 DI 装配，待 init/ 收敛",
        "import { SessionStore } from '../store/session-store';",
      ].join('\n'),
    });
    try {
      const { status, stdout } = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE });
      expect(status).toBe(0);
      expect(stdout).toContain('with-allow.ts:1'); // 豁免行仍列出（透明）
      expect(stdout).toContain('arch-allow');
      expect(stdout).toContain('with-allow.ts:2'); // 未豁免行计违规
    } finally {
      cleanup();
    }
  });

  it('修补3：修补后的路径形态（expert-platform / store / cron / l5 / engine-context / sqlite-graph-store）各自命中', () => {
    const { dir, cleanup } = makeSandbox({
      'routes/forms.ts': [
        "import { Validator } from '../expert-platform/validator';",
        "import { SessionStore } from '../store/session-store';",
        "import { getScheduler } from '../cron/scheduler';",
        "import { getBus } from './l5/ontology-event-bus';",
        "import { getDatabase } from './init/engine-context';",
        "import { SqliteGraphStore } from '../adapters/sqlite-graph-store';",
        "import { Bridge } from '../cycles/overflow-graph-bridge';",
      ].join('\n'),
    });
    try {
      const { stdout } = runScript({ SYNO_ARCH_SRC: dir, SYNO_ARCH_BASELINE: EMPTY_BASELINE });
      for (let line = 1; line <= 7; line++) {
        expect(stdout).toContain(`routes/forms.ts:${line}`);
      }
    } finally {
      cleanup();
    }
  });
});

describe('CT-64: 三态退出码 — fail-closed（M1 fail-open 根除）', () => {
  it('扫描目标缺失 → exit 2（检查自身失败，绝不与通过混同）', () => {
    const { status, stdout } = runScript({ SYNO_ARCH_SRC: path.join(tmpdir(), 'ct64-does-not-exist'), SYNO_ARCH_BASELINE: EMPTY_BASELINE });
    expect(status).toBe(2);
    expect(stdout).toContain('exit 2');
  });
});
