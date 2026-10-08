/**
 * tests/l4/edge-lag-unknown-degraded-1134.test.ts
 *
 * 卡 #1134 — W3 时滞：`action_effect_lag` 越权威枚举（定时雷）—— **乙路线**落地
 *   「`unknown` 是显式降级标记 ⇒ **不纳入枚举**；标 `degraded` + 落审计」
 *
 * ═══ 判据锚定（卡面 §五 判据分叉表「乙」）═══════════════════════════════════
 *   读到 `unknown` ⇒ **必产 degraded 标记或审计行**，且 **改坏即红**。
 *   实现形态（队长收窄口径）=「**显式豁免面 + 禁静默放宽**」：
 *     · 允许集 = 权威 6 值枚举 **∪ {`unknown`}**
 *     · 出现**第 3 类值** ⇒ `specViolation > 0` ⇒ **必红**（禁静默放宽枚举）
 *     · `unknown` 计数**钉死 50**（棘轮）⇒ 真值漂移（如真值→`unknown` 50→51）**必红**
 *
 * ═══ 🔴 诚实边界（本件**不**覆盖什么 —— 禁把"防线侧"写成"读取侧"）═══════════
 * 实测 as_of `origin/main = 5a6591c4a`：`src/` + `packages/` 对 `action_effect_lag`
 * 命中 **0**（`extensions/` 55 件为纯数据面）⇒ **今天不存在可插桩的"读取侧"**。
 * 因此本件交付的是【**审计 / 防线侧的可执行实现**】：
 *   具名审计行 + 派生 `degraded` 计数 + 漂移即红。
 * **不是**「读取侧已产 degraded」。真正的"读取侧发射体"（有人读该字段时必须 degraded）
 * 需要 `src/**`，**不在本卡写集** ⇒ 列为未决项，本件**不宣称覆盖**（见 §D 的
 * `READ_SIDE_EMISSION` 棘轮：读取侧落地者必须显式改这个常量，从而被迫更新契约）。
 * 已知在同一批：`施工项登记.ts:788` 条目 `1-8` 的消费方验收件
 * `tests/sentinel/edge-lag-consumed.test.ts` —— 实测**在 origin/main 上不存在**。
 *
 * ═══ 与既有控制塔防线的分工（不在本件写集，勿混淆）═════════════════════════
 * `scripts/control-tower/check-ontology-fields.sh` 判据为**字段存在 + 值非空串**，
 * 自述「判据冻结…新增必查字段 = 判据变更 ⇒ 提案 → K3 → CTO」（:15-16）；
 * `memory/notes/proposed/2026-10-07-d1174-ontology-field-guard.md:9` 明文
 * 「**值内容（"unknown"/"TBD"）是数据质量，归产品线，不在本防线**」。
 * ⇒ 该防线**零枚举感知**（连 `NOT_IN_ENUM_AT_ALL` 都判通过，`exit 0`），
 *   其「枚举化」= 冻结判据变更 ⇒ **另立卡走 提案→K3→CTO，本卡不碰**。
 *   本件即 D1174 让渡给产品线的那半边（**值内容侧**），且**不修改**该防线。
 *
 * ═══ 权威源（逐条可核）═══════════════════════════════════════════════════════
 *  · 枚举（6 值，**不含 `unknown`**）：
 *      docs/synova/research/权威文档15-企业循环溢出导航系统-20260714/
 *        SYNOVA-RESEARCH-第一章-循环配置规范与动态加载机制-v1-0-20260714.md §3.4（:184-193 取值规范表）
 *  · `unknown` 的**性质**（显式降级标记，不是第七个档位）：
 *      docs/synova/product-lines/evidence/issue987-988-本体边时滞与因果强度-20261004.md:63
 *      「其余 **50 条** = `"unknown"`（**显式未知，不留空、不猜数 —— 铁律 11/31**）。」
 *      同件 :41 —— 采纳值域 = §3.4 六值「**外加 `unknown`**」（有意置于枚举**之外**）
 *  · 降级处置语义**早已写在权威文档**（缺的只是实现）：
 *      …/SYNOVA-RESEARCH-第三章-投入建议引擎-v1-0-20260714.md:526
 *      「`action_effect_lag` **未定义** ⇒ 使用默认值（min=3, max=6）+ **标注 `degraded: true`**」
 *
 * ═══ 设计要点 1：为什么用**子进程**做沙箱 ═══════════════════════════════════
 * `src/l4/ontology-loader.ts:43` 的 `ONTOLOGY_DIR = join(process.cwd(), …)` 是
 * **模块级 const**（import 时求值），且模块内有 `cache`（:46）⇒ 同进程二次 import
 * 不重算路径、直接吃缓存。
 * 🔴 实测教训（本卡探针 v1）：**静态 import + 事后 `process.chdir` ⇒ 沙箱被无视**，
 *    仍加载真仓 55 件（`nodes:29, edges:55`）而沙箱只有 5 件 —— **静默失效**。
 * ⇒ 唯一安全形态 = 「**独立进程 + `chdir` 后动态 `import`**」。本件即如此：
 *    每沙箱一子进程，**零真仓写入**，改坏即红不污染工作区。
 *
 * ═══ 设计要点 2：为什么不能从 `$id` 反推文件名 ═══════════════════════════════
 * 🔴 实测（本件发现）：**55 件中有 5 件 `$id` 尾段 ≠ 文件名** ——
 *    `decision_concentrates.json` / `external_assumption.json` / `incentive_binds.json` /
 *    `locks_in.json` / `signal_transmits.json` 的 `$id` 用**连字符**（`edge/decision-concentrates`），
 *    而真实文件名用**下划线**；真实文件名**不含连字符**（字符集 `[_a-z]`）。
 * ⇒ 若用 `$id.replace('edge/','') + '.json'` 反推，审计行会**点一个不存在的文件**（= 假证据）。
 * ⇒ 故：文件名一律**取自目录实况**（子进程内 `readdirSync` + 解析各文件 `$id` 建映射），
 *    并把「`$id` 尾段 ≠ 文件名」作为**只报告不阻断**项（§F）—— 它是**存量事实**，
 *    非本卡引入，且判其是否应统一超出本卡范围（登记，不擅改）。
 *
 * ═══ 覆盖矩阵（铁律 48：正常 / 降级 / 边界）═════════════════════════════════
 *  A 正常：真仓 55 件经生产入口 → 派生 degraded=50 / inEnum=5 / 具名审计行 50 条（**真文件名**）
 *  B 改坏即红：沙箱 5 件，翻转 1 件 ⇒ 计数漂移 ⇒ 同一绿断言必抛（正反两向 + 还原即绿）
 *  C 边界 + **禁静默放宽枚举**：缺字段 / 空串 / 非字符串 / **自造第 7 值**必须显形
 *  D 未来读取边界契约（可执行 + 棘轮）
 *  E 枚举成员零出现（**报告不阻断**）
 *  F `$id` ↔ 文件名 映射完整性（**报告不阻断**）
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════

const REPO = resolve(__dirname, '..', '..');
const EDGE_SRC = join(REPO, 'extensions', 'ontology', 'edge-types');
const LOADER_TS = join(REPO, 'src', 'l4', 'ontology-loader.ts');

/** 权威枚举（doc15 第一章 §3.4 取值规范表，6 值）。**不含 `unknown`** —— 本卡不扩它。 */
const EDGE_LAG_ENUM: readonly string[] = [
  'immediate',
  '1_month',
  '1-3_months',
  '3-6_months',
  '6-12_months',
  '>12_months',
];

/** `unknown` = **显式降级标记**（非枚举值）。它是"未标定"，不是第七个档位。 */
const EDGE_LAG_DEGRADED_MARKER = 'unknown';

/** 显式豁免面 = 权威 6 值枚举 ∪ {`unknown`}。**不含**任何第三类值。 */
const EDGE_LAG_ALLOWED_SET: readonly string[] = [...EDGE_LAG_ENUM, EDGE_LAG_DEGRADED_MARKER];

/**
 * 真仓基线（as_of `origin/main = 5a6591c4a`）。
 * 🔴 这是**棘轮**：任何真仓值漂移都会让 A 组转红 —— 这是"防漂移"判据的分辨力来源。
 */
const BASELINE_TOTAL = 55;
const BASELINE_DEGRADED = 50;
const BASELINE_IN_ENUM = 5;
/** `$id` 尾段 ≠ 文件名 的件数（存量事实，报告不阻断）。 */
const BASELINE_ID_FILENAME_DIVERGENT = 5;

/** 沙箱取样：真仓**前 5 件**（字典序）—— 含 `capital_acquisition.json`（唯一的 `immediate`）。 */
const SANDBOX_SAMPLE_N = 5;
const SANDBOX_DEGRADED = 4;
const SANDBOX_IN_ENUM = 1;

/**
 * 🔴 未决项棘轮（诚实边界，禁被误读为"读取侧已完成"）。
 * 今天 `src/` + `packages/` 零消费方 ⇒ 读取侧发射体**不存在**。
 * **读取边界落地者必须显式改本常量**（从而被迫同步更新契约与交付件）。
 */
const READ_SIDE_EMISSION = 'NOT_IMPLEMENTED' as const;

// ═══════════════════════════════════════════════════════════════════════════
// 审计 / 降级信号实现（本件交付主体）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 一件边类型的时滞取样。
 * `file` = **真实文件名**（取自目录实况，**不**从 `$id` 反推）；`$id` 无对应文件时为 `null`。
 * `lag` 刻意用 `unknown`：字段缺失 / 空串 / 非字符串 / 自造值都要能被判。
 */
export interface EdgeLagSample {
  file: string | null;
  id: string;
  label: string;
  lag: unknown;
}

export interface EdgeLagAudit {
  total: number;
  /** **允许集** = 6 值枚举 ∪ {`unknown`}（显式豁免面）。出现第 3 类值 ⇒ `specViolation` */
  allowedSet: readonly string[];
  /** 值 ∈ 权威 6 值枚举 */
  inEnum: number;
  /** 值 === `unknown`（显式降级标记） */
  degraded: number;
  /** 越**允许集**（既非 6 值、亦非 `unknown`）⇒ 规范违规（**禁静默放宽枚举**的执行体） */
  specViolation: number;
  /** 字段缺失 */
  missing: number;
  /** `$id` 在目录内无对应文件（映射断裂） */
  unmapped: number;
  /** 6 值枚举中**当次实际出现**过的成员 */
  enumMembersUsed: string[];
  /** 6 值枚举中**零出现**的成员 —— **只报告、不阻断** */
  enumMembersUnused: string[];
  /** 具名审计行（每行点名**真实文件名** / `$id` / 值 / 判定） */
  auditLines: string[];
  /** 只报告不阻断的行（枚举成员零出现、`$id`↔文件名分歧等） */
  reportLines: string[];
  /** 派生降级信号（铁律 11/31：读到 `unknown` 不得静默） */
  degradedFlag: boolean;
  /** 读取侧覆盖状态 —— 本卡 = 未实现（见 `READ_SIDE_EMISSION`） */
  readSideEmission: typeof READ_SIDE_EMISSION;
}

/** 审计行里的定位串：优先真实文件名，缺失则显式标注（禁伪造文件名）。 */
function locatorOf(s: EdgeLagSample): string {
  return s.file === null ? `file=<UNMAPPED:${s.id}>` : `file=${s.file}`;
}

/**
 * 审计一批 `action_effect_lag` 取样。
 *
 * @input  samples — `{ file, id, label, lag }[]`（`lag` 运行时值，类型未知是**刻意的**）
 * @output 计数 + 具名审计行（**真文件名**）+ 枚举成员零出现报告 + 派生 `degraded` 标记
 * @degraded 读到 `unknown` ⇒ `degradedFlag = true` 且逐件产审计行；
 *           越**允许集** ⇒ `specViolation`，**不**吸收进 degraded（禁静默放宽）
 * @error  不抛；异常输入落到 `missing` / `specViolation` / `unmapped` 计数
 */
export function auditEdgeLags(samples: EdgeLagSample[]): EdgeLagAudit {
  const auditLines: string[] = [];
  const reportLines: string[] = [];
  const usedEnum = new Set<string>();
  let inEnum = 0;
  let degraded = 0;
  let specViolation = 0;
  let missing = 0;
  let unmapped = 0;

  for (const s of samples) {
    const loc = locatorOf(s);
    if (s.file === null) {
      unmapped += 1;
      reportLines.push(`REPORT edge-lag $id 无对应文件（映射断裂，报告不阻断） ${loc} label=${s.label}`);
    }
    if (s.lag === undefined || s.lag === null) {
      missing += 1;
      auditLines.push(`AUDIT edge-lag 字段缺失 ${loc} $id=${s.id} ⇒ 不可判（非 unknown，非枚举值）`);
      continue;
    }
    if (s.lag === EDGE_LAG_DEGRADED_MARKER) {
      degraded += 1;
      auditLines.push(
        `AUDIT edge-lag 未标定(显式降级) ${loc} $id=${s.id} value="unknown" ⇒ degraded:true（铁律 11/31，不静默）`,
      );
      continue;
    }
    if (typeof s.lag === 'string' && EDGE_LAG_ENUM.includes(s.lag)) {
      inEnum += 1;
      usedEnum.add(s.lag);
      continue;
    }
    specViolation += 1;
    auditLines.push(
      `AUDIT edge-lag 越允许集(规范违规) ${loc} $id=${s.id} value=${JSON.stringify(s.lag)} ` +
        `⇒ 既非 §3.4 六值、亦非显式降级标记 "unknown"（禁静默放宽枚举）`,
    );
  }

  const enumMembersUsed = EDGE_LAG_ENUM.filter(v => usedEnum.has(v));
  const enumMembersUnused = EDGE_LAG_ENUM.filter(v => !usedEnum.has(v));
  if (enumMembersUnused.length > 0) {
    reportLines.push(
      `REPORT edge-lag 枚举成员零出现（**报告不阻断**）: ${enumMembersUnused.join(', ')} ` +
        `⇒ 合法未用 或 漏标，二义未决（本防线不擅判）`,
    );
  }

  return {
    total: samples.length,
    allowedSet: EDGE_LAG_ALLOWED_SET,
    inEnum,
    degraded,
    specViolation,
    missing,
    unmapped,
    enumMembersUsed,
    enumMembersUnused,
    auditLines,
    reportLines,
    degradedFlag: degraded > 0,
    readSideEmission: READ_SIDE_EMISSION,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 生产入口装载（子进程 + 沙箱）
// ═══════════════════════════════════════════════════════════════════════════

const PROBE_PREFIX = 'SYNO_1134_PROBE_JSON:';

/**
 * 经**生产入口** `loadOntology()` 读取边类型时滞，并附**真实文件名**。
 *
 * 🔴 必须在**独立子进程**内 `chdir` 后再动态 `import`（见文件头「设计要点 1」）。
 * 🔴 文件名取自子进程内的目录实况 + 各文件 `$id` 建映射，**不**从 `$id` 反推
 *    （见文件头「设计要点 2」：5/55 件 `$id` 尾段 ≠ 文件名）。
 *    此映射读取是**辅助**动作，时滞值本身**全部**来自 `loadOntology()`。
 *
 * @param ontologyRoot 作为 `process.cwd()` 的根；须含 `extensions/ontology/edge-types/`
 * @degraded 子进程失败/超时/输出不可解析 ⇒ **抛**（fail-closed，禁与"通过"混同）
 */
function loadEdgeLagsViaProductionEntry(ontologyRoot: string): EdgeLagSample[] {
  const loaderUrl = pathToFileURL(LOADER_TS).href;
  const code = `
(async () => {
  try {
    process.chdir(${JSON.stringify(ontologyRoot)});
    const fs = await import('node:fs');
    const path = await import('node:path');

    // ① 辅助：建 $id → 真实文件名 映射（**不**从 $id 反推文件名）
    const dir = path.join(process.cwd(), 'extensions', 'ontology', 'edge-types');
    const fileOfId = new Map();
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (d && typeof d['\$id'] === 'string') fileOfId.set(d['\$id'], f);
      } catch (e) { /* 坏文件不计入映射；装载器侧另有其职责 */ }
    }

    // ② 主：生产入口装载器
    const m = await import(${JSON.stringify(loaderUrl)});
    const r = m.loadOntology();
    const edges = r.ontology.edgeTypes.map((e) => ({
      file: fileOfId.has(String(e['\$id'])) ? fileOfId.get(String(e['\$id'])) : null,
      id: String(e['\$id']),
      label: String(e.label),
      lag: Object.prototype.hasOwnProperty.call(e, 'action_effect_lag') ? e.action_effect_lag : undefined,
    }));
    edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    process.stdout.write(${JSON.stringify(PROBE_PREFIX)} + JSON.stringify({
      loaded: edges.length,
      degraded: r.degraded,
      edges,
    }) + '\\n');
  } catch (err) {
    process.stderr.write('SYNO_1134_PROBE_ERR:' + (err && err.message ? err.message : String(err)) + '\\n');
    process.exitCode = 3;
  }
})();
`;

  const res = spawnSync(process.execPath, ['--import', 'tsx', '--eval', code], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 90_000,
  });

  if (res.error) throw new Error(`生产入口子进程启动失败（fail-closed）: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(
      `生产入口子进程非零退出（fail-closed）status=${res.status}\nstdout=${res.stdout}\nstderr=${res.stderr}`,
    );
  }

  const line = String(res.stdout)
    .split(/\r?\n/)
    .find(l => l.startsWith(PROBE_PREFIX));
  if (!line) {
    throw new Error(`生产入口探针输出不可解析（fail-closed）: stdout=${res.stdout} stderr=${res.stderr}`);
  }

  const parsed = JSON.parse(line.slice(PROBE_PREFIX.length)) as { loaded: number; edges: EdgeLagSample[] };
  if (!Array.isArray(parsed.edges)) throw new Error('生产入口探针 edges 非数组（fail-closed）');
  return parsed.edges;
}

// ═══════════════════════════════════════════════════════════════════════════
// 沙箱（tmpdir，零真仓写入）
// ═══════════════════════════════════════════════════════════════════════════

function makeSandbox(): string {
  const sb = mkdtempSync(join(tmpdir(), 'syno-1134-'));
  const dir = join(sb, 'extensions', 'ontology', 'edge-types');
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(EDGE_SRC)
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(0, SANDBOX_SAMPLE_N);
  for (const f of files) cpSync(join(EDGE_SRC, f), join(dir, f));
  if (files.length !== SANDBOX_SAMPLE_N) {
    throw new Error(`沙箱取样数不符（fail-closed）: ${files.length} != ${SANDBOX_SAMPLE_N}`);
  }
  return sb;
}

/** 把沙箱内**第一个** `action_effect_lag` 非 `unknown` 的值改成 `to`；返回被改文件名。 */
function flipFirstNonUnknown(sb: string, to: string): string {
  const dir = join(sb, 'extensions', 'ontology', 'edge-types');
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const p = join(dir, f);
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
    const v = parsed['action_effect_lag'];
    if (typeof v === 'string' && v !== EDGE_LAG_DEGRADED_MARKER) {
      parsed['action_effect_lag'] = to;
      writeFileSync(p, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
      return f;
    }
  }
  throw new Error('沙箱内无可翻转的枚举值（fail-closed：取样约定被破坏）');
}

function withSandbox<T>(fn: (sb: string) => T): T {
  const sb = makeSandbox();
  try {
    return fn(sb);
  } finally {
    rmSync(sb, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A 正常：真仓基线（穿生产入口）
// ═══════════════════════════════════════════════════════════════════════════

describe('A. 真仓基线 — 穿生产入口 loadOntology()（正常路径）', () => {
  const edges = loadEdgeLagsViaProductionEntry(REPO);
  const audit = auditEdgeLags(edges);

  it('A1 生产装载器读到 55 件边类型（棘轮）', () => {
    expect(edges.length).toBe(BASELINE_TOTAL);
  });

  it('A2 派生降级计数 = 50（`unknown` = 显式降级标记，棘轮）', () => {
    expect(audit.degraded).toBe(BASELINE_DEGRADED);
  });

  it('A3 枚举内真值 = 5（棘轮）', () => {
    expect(audit.inEnum).toBe(BASELINE_IN_ENUM);
  });

  it('A4 无规范违规、无字段缺失、无映射断裂（禁静默放宽枚举的底线）', () => {
    expect(audit.specViolation).toBe(0);
    expect(audit.missing).toBe(0);
    expect(audit.unmapped).toBe(0);
  });

  it('A5 读到 `unknown` ⇒ 必产 degraded 标记（铁律 11/31，不得静默）', () => {
    expect(audit.degradedFlag).toBe(true);
  });

  it('A6 具名审计行：每个 `unknown` 一件一行，且点名**真实文件名**与 `$id`', () => {
    const degradedLines = audit.auditLines.filter(l => l.includes('未标定(显式降级)'));
    expect(degradedLines.length).toBe(BASELINE_DEGRADED);
    for (const l of degradedLines) {
      // 真实文件名不含连字符（实测字符集 [_a-z]）—— 这条正则就是"禁伪造文件名"的守卫
      expect(l).toMatch(/file=[a-z0-9_]+\.json/);
      expect(l).toMatch(/\$id=edge\/[a-z0-9_-]+/);
      expect(l).toContain('degraded:true');
    }
    expect(audit.auditLines.length).toBe(audit.degraded + audit.specViolation + audit.missing);
  });

  it('A7 审计行点名的文件**真实存在**（抽样 5 条逐条 existsSync 核验）', () => {
    const names = readdirSync(EDGE_SRC);
    const sampled = audit.auditLines
      .filter(l => l.includes('未标定(显式降级)'))
      .slice(0, 5)
      .map(l => /file=([a-z0-9_]+\.json)/.exec(l)?.[1] ?? '');
    expect(sampled.length).toBe(5);
    for (const n of sampled) {
      expect(n.length).toBeGreaterThan(0);
      expect(names).toContain(n);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B 改坏即红（沙箱；**零真仓写入**）
// ═══════════════════════════════════════════════════════════════════════════

describe('B. 改坏即红 — 沙箱翻转枚举值（零真仓写入）', () => {
  it('B1 沙箱基线（前 5 件，未改坏）：degraded=4 / inEnum=1', () => {
    withSandbox(sb => {
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.total).toBe(SANDBOX_SAMPLE_N);
      expect(audit.degraded).toBe(SANDBOX_DEGRADED);
      expect(audit.inEnum).toBe(SANDBOX_IN_ENUM);
    });
  });

  it('B2 翻转 1 件 枚举值→unknown ⇒ 计数漂移被观测到', () => {
    withSandbox(sb => {
      const flipped = flipFirstNonUnknown(sb, EDGE_LAG_DEGRADED_MARKER);
      expect(flipped.length).toBeGreaterThan(0);
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.degraded).toBe(SANDBOX_DEGRADED + 1);
      expect(audit.inEnum).toBe(SANDBOX_IN_ENUM - 1);
    });
  });

  it('B3 判别性：把「绿」断言施加到改坏输入上 ⇒ 必然抛（判据有分辨力）', () => {
    withSandbox(sb => {
      flipFirstNonUnknown(sb, EDGE_LAG_DEGRADED_MARKER);
      const mutated = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      // 未改坏时成立的那条断言，改坏后必须不成立：
      expect(() => expect(mutated.degraded).toBe(SANDBOX_DEGRADED)).toThrow();
      // 反向确认它确实偏离了基线（防"恒抛"式假分辨力）
      expect(mutated.degraded).not.toBe(SANDBOX_DEGRADED);
    });
  });

  it('B4 还原即绿：flip → 红 → 恢复 → 回基线', () => {
    withSandbox(sb => {
      const dir = join(sb, 'extensions', 'ontology', 'edge-types');
      const capPath = join(dir, 'capital_acquisition.json');
      const base = JSON.parse(readFileSync(capPath, 'utf-8')) as Record<string, unknown>;
      expect(base['action_effect_lag']).toBe('immediate');

      flipFirstNonUnknown(sb, EDGE_LAG_DEGRADED_MARKER);
      const mutated = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(() => expect(mutated.degraded).toBe(SANDBOX_DEGRADED)).toThrow();
      expect(mutated.inEnum).toBe(SANDBOX_IN_ENUM - 1);

      const parsed = JSON.parse(readFileSync(capPath, 'utf-8')) as Record<string, unknown>;
      parsed['action_effect_lag'] = 'immediate';
      writeFileSync(capPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');

      const restored = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(restored.degraded).toBe(SANDBOX_DEGRADED);
      expect(restored.inEnum).toBe(SANDBOX_IN_ENUM);
    });
  });

  it('B5 改坏为**第 3 类值**（非 unknown）⇒ specViolation>0 ⇒ 必红', () => {
    withSandbox(sb => {
      flipFirstNonUnknown(sb, 'NOT_IN_ENUM_AT_ALL');
      const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(sb));
      expect(audit.specViolation).toBe(1);
      expect(audit.inEnum).toBe(SANDBOX_IN_ENUM - 1);
      expect(audit.auditLines.join('\n')).toContain('禁静默放宽枚举');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C 边界 + 禁静默放宽枚举
// ═══════════════════════════════════════════════════════════════════════════

describe('C. 边界与「禁静默放宽枚举」', () => {
  const s = (lag: unknown): EdgeLagSample => ({ file: 'x.json', id: 'edge/x', label: 'X', lag });

  it('C1 字段缺失 ⇒ 计 missing，且不并入 degraded、不并入 inEnum', () => {
    const a = auditEdgeLags([s(undefined)]);
    expect(a.missing).toBe(1);
    expect(a.degraded).toBe(0);
    expect(a.inEnum).toBe(0);
    expect(a.degradedFlag).toBe(false);
  });

  it('C2 空串 ⇒ specViolation（既非枚举值，亦非显式降级标记）', () => {
    const a = auditEdgeLags([s('')]);
    expect(a.specViolation).toBe(1);
    expect(a.degraded).toBe(0);
  });

  it('C3 非字符串（数字 / 对象）⇒ specViolation，不静默吞', () => {
    const a = auditEdgeLags([s(3), s({ minMonths: 3, maxMonths: 6 })]);
    expect(a.specViolation).toBe(2);
  });

  it('C4 🔴 自造第 7 值（如 `2_months`）⇒ specViolation，**不得**被当作 unknown 吸收', () => {
    const a = auditEdgeLags([s('2_months')]);
    expect(a.specViolation).toBe(1);
    expect(a.degraded).toBe(0);
    expect(a.auditLines.join('\n')).toContain('越允许集(规范违规)');
    expect(a.auditLines.join('\n')).toContain('禁静默放宽枚举');
  });

  it('C4b 显式豁免面 = 6 值 ∪ {unknown}，且**恰为** 7 项（防悄悄放宽）', () => {
    expect(EDGE_LAG_ALLOWED_SET.length).toBe(7);
    expect(new Set(EDGE_LAG_ALLOWED_SET).size).toBe(7);
    for (const v of EDGE_LAG_ENUM) expect(EDGE_LAG_ALLOWED_SET).toContain(v);
    expect(EDGE_LAG_ALLOWED_SET).toContain(EDGE_LAG_DEGRADED_MARKER);
    for (const v of ['2_months', '', 'UNKNOWN', 'unknown ', 'TBD', '0', 'null']) {
      expect(EDGE_LAG_ALLOWED_SET).not.toContain(v);
    }
  });

  it('C5 契约：degradedFlag ⟺ 存在 `unknown`（零 unknown ⇒ false）', () => {
    const none = auditEdgeLags([s('immediate'), s('3-6_months')]);
    expect(none.degradedFlag).toBe(false);
    const some = auditEdgeLags([s('unknown')]);
    expect(some.degradedFlag).toBe(true);
  });

  it('C6 6 值枚举完整（防枚举被静默篡改）', () => {
    expect([...EDGE_LAG_ENUM].sort()).toEqual(
      ['>12_months', '1-3_months', '1_month', '3-6_months', '6-12_months', 'immediate'].sort(),
    );
    expect(EDGE_LAG_ENUM).not.toContain(EDGE_LAG_DEGRADED_MARKER);
  });

  it('C7 `file=null`（映射断裂）⇒ 计 unmapped 且审计行不伪造文件名', () => {
    const a = auditEdgeLags([{ file: null, id: 'edge/ghost', label: 'G', lag: 'unknown' }]);
    expect(a.unmapped).toBe(1);
    expect(a.auditLines.join('\n')).toContain('file=<UNMAPPED:edge/ghost>');
    expect(a.auditLines.join('\n')).not.toMatch(/file=[a-z0-9_]+\.json/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D 未来读取边界契约（可执行 + 棘轮）
// ═══════════════════════════════════════════════════════════════════════════

describe('D. 未来读取边界契约（可执行）', () => {
  it('D1 对任意含 `unknown` 的输入：degradedFlag=true 且每个 unknown 都有审计行', () => {
    const a = auditEdgeLags([
      { file: 'a.json', id: 'edge/a', label: 'A', lag: 'unknown' },
      { file: 'b.json', id: 'edge/b', label: 'B', lag: 'unknown' },
      { file: 'c.json', id: 'edge/c', label: 'C', lag: 'immediate' },
    ]);
    expect(a.degradedFlag).toBe(true);
    expect(a.auditLines.filter(l => l.includes('未标定(显式降级)')).length).toBe(2);
  });

  it('D2 🔴 棘轮：读取侧发射体状态必须显式声明为 NOT_IMPLEMENTED（本卡不覆盖读取侧）', () => {
    const a = auditEdgeLags([{ file: 'a.json', id: 'edge/a', label: 'A', lag: 'unknown' }]);
    expect(a.readSideEmission).toBe('NOT_IMPLEMENTED');
    // 若读取侧落地（src/** 真读该字段并发射 degraded），实现者必须改上面的常量
    // ⇒ 本测试转红 ⇒ 被迫同步更新契约与交付件。这是"不得把防线侧写成读取侧"的棘轮。
    expect(READ_SIDE_EMISSION).toBe('NOT_IMPLEMENTED');
  });

  it('D3 生产装载器自身的 degraded 语义与本审计**无关**（防混淆）', () => {
    // loadOntology 的 degraded 只表"加载错误"，不表字段值；
    // 实测真仓 50 件 unknown 时它仍返回 degraded=false ⇒ 字段级降级必须由本审计承载。
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect(audit.degraded).toBe(BASELINE_DEGRADED);
    expect(audit.degradedFlag).toBe(true); // 字段级降级信号为真
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E 枚举成员零出现（**报告不阻断**）
// ═══════════════════════════════════════════════════════════════════════════

describe('E. 枚举成员零出现 — 报告但不阻断', () => {
  it('E1 真仓：`6-12_months` 与 `>12_months` 零出现 ⇒ 被报告出来', () => {
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect([...audit.enumMembersUnused].sort()).toEqual(['6-12_months', '>12_months'].sort());
    expect([...audit.enumMembersUsed].sort()).toEqual(
      ['1-3_months', '1_month', '3-6_months', 'immediate'].sort(),
    );
    const report = audit.reportLines.join('\n');
    expect(report).toContain('枚举成员零出现');
    expect(report).toContain('6-12_months');
    expect(report).toContain('>12_months');
    expect(report).toContain('报告不阻断');
  });

  it('E2 🔴 零出现**不阻断**：它不出现在 auditLines（违规面）里', () => {
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect(audit.auditLines.some(l => l.includes('6-12_months'))).toBe(false);
    expect(audit.auditLines.some(l => l.includes('>12_months'))).toBe(false);
  });

  it('E3 六值全部出现 ⇒ 无零出现报告（报告面本身有分辨力）', () => {
    const all: EdgeLagSample[] = EDGE_LAG_ENUM.map((v, i) => ({
      file: `e${i}.json`,
      id: `edge/e${i}`,
      label: `E${i}`,
      lag: v,
    }));
    const audit = auditEdgeLags(all);
    expect(audit.enumMembersUnused).toEqual([]);
    expect(audit.reportLines).toEqual([]);
    expect(audit.inEnum).toBe(6);
  });

  it('E4 零出现**不得**被误记为降级或违规（三态互不吞并）', () => {
    const audit = auditEdgeLags(loadEdgeLagsViaProductionEntry(REPO));
    expect(audit.degraded).toBe(BASELINE_DEGRADED); // 50，不因零出现而变
    expect(audit.specViolation).toBe(0);            // 零出现 ≠ 违规
    expect(audit.missing).toBe(0);                  // 零出现 ≠ 缺字段
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F `$id` ↔ 文件名 映射（**报告不阻断**）
// ═══════════════════════════════════════════════════════════════════════════

describe('F. `$id` ↔ 文件名 映射完整性（报告不阻断）', () => {
  const edges = loadEdgeLagsViaProductionEntry(REPO);

  it('F1 55 件的 `$id` 均能映射到真实文件（无断裂）', () => {
    expect(edges.length).toBe(BASELINE_TOTAL);
    expect(edges.filter(e => e.file === null).length).toBe(0);
  });

  it('F2 审计行一律点名真实文件名，且文件确实存在', () => {
    const names = readdirSync(EDGE_SRC);
    for (const e of edges) {
      expect(e.file).not.toBeNull();
      expect(names).toContain(e.file as string);
    }
  });

  it('F3 🔴 存量事实留档：5 件 `$id` 尾段 ≠ 文件名（报告不阻断，禁从 `$id` 反推）', () => {
    const divergent = edges.filter(e => e.file !== null && (e.id.replace(/^edge\//, '') + '.json') !== e.file);
    expect(divergent.length).toBe(BASELINE_ID_FILENAME_DIVERGENT);
    // 正是这 5 件 —— 若有人"顺手改名"让它归零，本断言会红 ⇒ 逼其显式更新本卡基线
    expect(divergent.map(e => e.file).sort()).toEqual(
      [
        'decision_concentrates.json',
        'external_assumption.json',
        'incentive_binds.json',
        'locks_in.json',
        'signal_transmits.json',
      ].sort(),
    );
    // 真实文件名不含连字符；`$id` 含 —— 故不可反推
    for (const e of divergent) expect(e.id).toContain('-');
  });
});
