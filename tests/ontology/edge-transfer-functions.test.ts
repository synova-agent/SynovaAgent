/**
 * tests/ontology/edge-transfer-functions.test.ts — #235 / K4-02「`transfer_function` 落值」判据件
 *
 * 卡面（Done 真源）: 52 条 `transfer_function` **逐条给公式 或 显式 `unknown`**（**禁 `TBD` 残留**）；
 *   探针末行含 **`TBD=0`**；反例 = 任一条改回 `TBD` ⇒ 探针必 exit 1。
 *
 * 探针（判据载体）: `scripts/control-tower/probe-ontology-values.ts`（#234/#235 共写）
 *   · 本件 import 其**纯函数 + 判定函数**，沙箱由 `loadEdgeFiles(dir)` 的 `dir` 入参给定（探针无模块级路径常量）。
 *
 * ═══ 口径（**必须带口径名**，两个口径不同源、不可互推）═══════════════════════════
 *   · #235（本件）= **E 号名精确命中**口径：`label` 精确串 === 权威01 第二章 `### E-NN: NAME` 的 NAME ⇒ **13 条**落公式
 *   · #234（值域迁移）= **E 号覆盖**口径（含 §3.5.1 八条 + 未覆盖三条）⇒ 与 13 条**不是同一集合**
 *   · 🔴 **禁语义近邻放宽**：`talent_deployment`←E-15 之类**不进** #235（它们无同标签命中 ⇒ 落 `unknown`）
 *
 * ═══ 覆盖（铁律 48：正常 / 降级 / 边界 三路径，非空壳）═══════════════════════════
 *   正常 — ① 真仓 56 件：`TBD=0`、公式 13 / unknown 39 / 登记非权威 4、violations 为空
 *          ② 13 条**逐条逐字**与权威01 第二章运行时**真读**的公式比对（不是比对冻结副本）
 *   降级 — ③ 权威文档解析不到该 E 号 ⇒ `权威公式缺失`（fail-closed，不静默放行）
 *   边界 — ④ 归一化口径（按行 trim/丢空/` ; ` 连接）逐例可判
 *          ⑤ 越允许集（非公式/非 unknown/非登记）必点名
 *
 * 判别性夹具（改坏即红，**非恒真断言**）—— 全部在 `os.tmpdir()` 沙箱内做，**零真仓写入**：
 *   · 任一条改回 `TBD`        ⇒ `TBD 残留` 必现（**卡面反例原文**）
 *   · 公式改一个字符          ⇒ `公式与权威不一致` 必现
 *   · 非公式件写成散文        ⇒ `transfer_function 越允许集` 必现
 *   · 删掉公式登记件          ⇒ `公式登记件缺失` 必现
 *   · 每条改坏后**还原**      ⇒ 回绿（证明偏离来自改动本身，非恒抛）
 *
 * 🔴 本件**证不了**什么：公式「与权威文档逐字一致」**不等于**「生产可执行」；
 *   实测 `src/` + `packages/` 对 `transfer_function` 无 compute 消费方 ⇒ 执行面属另案。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  EDGE_DIR_REL,
  ProbeEnvError,
  TFR_DOC_REL,
  TFR_E_TO_FILE,
  TFR_REGISTERED_OTHER,
  auditTransferFunctions,
  extractAuthoritativeFormulas,
  loadEdgeFiles,
  normalizeFormula,
} from '../../scripts/control-tower/probe-ontology-values';

const REPO_ROOT = process.cwd();
const REAL_EDGE_DIR = join(REPO_ROOT, EDGE_DIR_REL);
const REAL_DOC = join(REPO_ROOT, TFR_DOC_REL);

const REAL_FORMULAS = extractAuthoritativeFormulas(readFileSync(REAL_DOC, 'utf-8'));

const SANDBOX_BASE = mkdtempSync(join(tmpdir(), 'synova-235-k4-02-'));
afterAll(() => {
  rmSync(SANDBOX_BASE, { recursive: true, force: true });
});

let sandboxSeq = 0;
function withSandbox<T>(fn: (dir: string) => T): T {
  sandboxSeq += 1;
  const dir = join(SANDBOX_BASE, `sb-${sandboxSeq}`);
  mkdirSync(dir, { recursive: true });
  cpSync(REAL_EDGE_DIR, dir, { recursive: true });
  return fn(dir);
}

function readJson(dir: string, file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>;
}
function writeJson(dir: string, file: string, doc: Record<string, unknown>): void {
  writeFileSync(join(dir, file), JSON.stringify(doc, null, 2) + '\n', 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════
// A 正常路径 — 真仓
// ═══════════════════════════════════════════════════════════════════════════

describe('A. 真仓基线 — 52 条 TBD 已落值（L1 真读盘 + 运行时真读权威文档）', () => {
  const samples = loadEdgeFiles(REAL_EDGE_DIR);
  const audit = auditTransferFunctions(samples, REAL_FORMULAS);

  it('A1 件数与分类：件数**扫盘推导** ＋ **闭合等式**（禁写死任何一数）；违规为空', () => {
    // 🔴 N2 续做（#234，base `aa085e1f1`）：原为字面 `56 = 13 + 39 + 4`，撞上 #1350（`l3-65`）落地后的 **58 件**。
    //    实测口径：两件新边带 `transfer_function="unknown"` ⇒ 落在 `unknown` 桶内、**不**在"登记非权威"内
    //    ⇒ 闭合等式**不另加**"在场预告件"项（加了会**重复计数**）；项值一律由**具名登记面**推出。
    const scanFiles = readdirSync(REAL_EDGE_DIR).filter((f) => f.endsWith('.json')).sort();

    // ① 总数 = 扫盘件数（派生，不写死）
    expect(audit.total, `总数须 == 扫盘实况（${scanFiles.length} 件）`).toBe(scanFiles.length);
    // ② 具名登记面 ↔ 实测分类（**交叉**断言：两侧来源不同 ⇒ 非"扫盘当期望"）
    expect(audit.formula, '公式件数须 == TFR_E_TO_FILE 具名条数').toBe(TFR_E_TO_FILE.length);
    expect(audit.registeredOther, '登记非权威件数须 == TFR_REGISTERED_OTHER 具名条数').toBe(TFR_REGISTERED_OTHER.length);
    // ③ **闭合等式**（比原版更强）：三分类必须恰好铺满总数（缺一类 / 多一类 ⇒ 红）
    expect(
      audit.formula + audit.unknown + audit.registeredOther,
      `闭合等式不成立：formula(${audit.formula}) + unknown(${audit.unknown}) + registeredOther(${audit.registeredOther}) ≠ total(${audit.total})`,
    ).toBe(audit.total);
    // ④ 真棘轮：违规为空
    expect(audit.violations).toEqual([]);
  });

  it('A2 🔴 `TBD` 零残留（卡面 Done 原文；探针末行 `TBD=0` 的口径源）', () => {
    expect(audit.tbd).toBe(0);
    expect(samples.filter(s => typeof s.tfr === 'string' && s.tfr.startsWith('TBD'))).toEqual([]);
  });

  it('A3 13 条**逐条逐字**与权威01 第二章公式一致（运行时真读文档，非冻结副本）', () => {
    expect(TFR_E_TO_FILE).toHaveLength(13);
    expect(Object.keys(REAL_FORMULAS).length).toBe(42); // 权威文档恰 42 个 E 号
    for (const x of TFR_E_TO_FILE) {
      const doc = readJson(REAL_EDGE_DIR, x.file);
      const got = normalizeFormula(String(doc['transfer_function']));
      expect(got, `${x.file} (${x.e} ${x.authName}) 必须逐字 === 权威01 第二章公式`).toBe(REAL_FORMULAS[x.e]);
      expect(got.length).toBeGreaterThan(0);
    }
  });

  it('A4 其余 39 条**显式 `unknown`**（禁自填；含语义近邻件 `talent_deployment` 等）', () => {
    const registeredFiles = new Set([
      ...TFR_E_TO_FILE.map(x => x.file),
      ...TFR_REGISTERED_OTHER.map(x => x.file),
    ]);
    const rest = samples.filter(s => !registeredFiles.has(s.file));
    // 🔴 N2 续做（#234，base `aa085e1f1`）：原为字面 `39`；现由 **扫盘 − 具名登记** 推出（不写死）
    const scanTotal = readdirSync(REAL_EDGE_DIR).filter(f => f.endsWith('.json')).length;
    expect(
      rest.length,
      `余项件数须 == 扫盘(${scanTotal}) − 具名登记(${registeredFiles.size})`,
    ).toBe(scanTotal - registeredFiles.size);
    // 逐件断言（保留并**点名**）：未被 13 / 4 认领的其余件**必须全为** `unknown`
    const notUnknown = rest.filter(s => s.tfr !== 'unknown').map(s => `${s.file}(${JSON.stringify(s.tfr)})`);
    expect(notUnknown, `余项件必须全为 unknown；非 unknown 者: ${notUnknown.join(', ')}`).toEqual([]);
    for (const s of rest) {
      expect(s.tfr, `${s.file} 无 E 号名精确命中 ⇒ 必须显式 unknown`).toBe('unknown');
    }
    // 🔴 禁语义近邻放宽：`talent_deployment`（E-15 的语义近邻）**不得**落公式
    const td = samples.find(s => s.file === 'talent_deployment.json')!;
    expect(td.tfr).toBe('unknown');
    expect(TFR_E_TO_FILE.some(x => x.file === 'talent_deployment.json')).toBe(false);
  });

  it('A5 登记非权威值 4 件原样保留（3 真公式 + 1 结构性 N/A），且**不在** 13 条内', () => {
    expect(TFR_REGISTERED_OTHER).toHaveLength(4);
    for (const x of TFR_REGISTERED_OTHER) {
      const doc = readJson(REAL_EDGE_DIR, x.file);
      expect(typeof doc['transfer_function']).toBe('string');
      expect(String(doc['transfer_function'])).not.toContain('TBD');
      expect(TFR_E_TO_FILE.some(y => y.file === x.file)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 判别性夹具 — 改坏即红（沙箱；零真仓写入）
// ═══════════════════════════════════════════════════════════════════════════

describe('B. 改坏即红 — 沙箱翻转 transfer_function（零真仓写入）', () => {
  it('B1 沙箱基线：未改动 ⇒ 与真仓同判（violations 为空）', () => {
    withSandbox(dir => {
      const a = auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS);
      expect(a.violations).toEqual([]);
      expect(a.tbd).toBe(0);
    });
  });

  it('B2 🔴 任一条改回 `TBD` ⇒ `TBD 残留` 必现（**卡面反例原文**）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'capital_acquisition.json');
      doc['transfer_function'] = 'TBD — to be defined in compute phase';
      writeJson(dir, 'capital_acquisition.json', doc);

      const a = auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS);
      expect(a.tbd).toBe(1);
      expect(a.violations).toHaveLength(1);
      expect(a.violations[0]).toContain('TBD 残留');
      expect(a.violations[0]).toContain('file=capital_acquisition.json');
      expect(() => expect(a.violations).toEqual([])).toThrow(); // 判别性：绿断言施加到改坏输入必抛
    });
  });

  it('B3 公式改一个字符 ⇒ `公式与权威不一致` 必现（逐字比对有分辨力）', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'rule_constraint.json');
      const before = String(doc['transfer_function']);
      doc['transfer_function'] = before.replace('rule_rigidity', 'rule_rigidity_typo');
      expect(String(doc['transfer_function'])).not.toBe(before);
      writeJson(dir, 'rule_constraint.json', doc);

      const a = auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS);
      expect(a.violations).toHaveLength(1);
      expect(a.violations[0]).toContain('公式与权威不一致');
      expect(a.violations[0]).toContain('E-18');
    });
  });

  it('B4 非公式件（应 unknown）写成散文 ⇒ `越允许集` 必现', () => {
    withSandbox(dir => {
      const doc = readJson(dir, 'deploys.json');
      doc['transfer_function'] = 'deploys = make_it_work';
      writeJson(dir, 'deploys.json', doc);

      const a = auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS);
      expect(a.violations).toHaveLength(1);
      expect(a.violations[0]).toContain('transfer_function 越允许集');
      expect(a.violations[0]).toContain('file=deploys.json');
    });
  });

  it('B5 删掉公式登记件 ⇒ `公式登记件缺失` 必现（防"删掉即通过"）', () => {
    withSandbox(dir => {
      rmSync(join(dir, 'talent_retention.json'));
      const a = auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS);
      expect(a.violations.some(v => v.includes('公式登记件缺失') && v.includes('talent_retention.json'))).toBe(true);
    });
  });

  it('B6 还原即绿：B2 的同一改动还原后 ⇒ 回基线（偏离来自改动本身，非恒抛）', () => {
    withSandbox(dir => {
      const path = 'capital_acquisition.json';
      const original = readFileSync(join(dir, path), 'utf-8');
      const broken = readJson(dir, path);
      broken['transfer_function'] = 'TBD';
      writeJson(dir, path, broken);
      expect(auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS).violations).toHaveLength(1);

      writeFileSync(join(dir, path), original, 'utf-8'); // 逐字还原
      expect(auditTransferFunctions(loadEdgeFiles(dir), REAL_FORMULAS).violations).toEqual([]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C 降级路径 + 边界（纯函数）
// ═══════════════════════════════════════════════════════════════════════════

describe('C. 降级与边界', () => {
  it('C1 权威文档解析不到该 E 号 ⇒ `权威公式缺失`（fail-closed，不静默放行）', () => {
    // 取一件**是** 13 条的样件 + 空公式表 ⇒ 必报「权威公式缺失」并点名 E 号
    const one = loadEdgeFiles(REAL_EDGE_DIR).filter(s => s.file === 'rule_constraint.json');
    expect(one).toHaveLength(1);
    const b = auditTransferFunctions(one, {});
    expect(b.violations.some(v => v.includes('权威公式缺失') && v.includes('E-18'))).toBe(true);
    // 该件**未**被计入 `formula`（不许把解析失败当通过）
    expect(b.formula).toBe(0);
  });

  it('C2 `extractAuthoritativeFormulas`：空文本 ⇒ 空表（不抛）；真文档 ⇒ 恰 42 条且含 E-05', () => {
    expect(extractAuthoritativeFormulas('')).toEqual({});
    expect(Object.keys(REAL_FORMULAS)).toHaveLength(42);
    expect(REAL_FORMULAS['E-05']).toContain('C_available = equity_raised + debt_raised + retained_earnings');
    expect(REAL_FORMULAS['E-23']).toContain('operational_output = efficiency_rate');
  });

  it('C3 归一化口径逐例可判：多行 → ` ; ` 连接；空行/缩进被归一；单行原样', () => {
    expect(normalizeFormula('a = 1\nb = 2')).toBe('a = 1 ; b = 2');
    expect(normalizeFormula('  a = 1  \n\n   b = 2\n')).toBe('a = 1 ; b = 2');
    expect(normalizeFormula('a = 1 ; b = 2')).toBe('a = 1 ; b = 2');
    expect(normalizeFormula('\n\n')).toBe('');
    // 分辨力：两行变一行会改变结果（非恒真）
    expect(normalizeFormula('a = 1\nb = 2')).not.toBe(normalizeFormula('a = 1 ; b = 2 ; c = 3'));
  });

  it('C4 目录缺失 ⇒ 抛 `ProbeEnvError`（fail-closed，禁与"通过"混同）', () => {
    expect(() => loadEdgeFiles(join(SANDBOX_BASE, 'no-such-dir'))).toThrow(ProbeEnvError);
  });
});
