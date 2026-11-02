#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-output-contract.ts — K12-06（#189）输出契约探针
 *
 * 用途: 把院方《02》§三机制 3「**给格式 ≠ 保障一致 —— 要给可校验的格式**」变成一条能跑的命令:
 *   产出提交时到底**有没有被体检**、缺字段**有没有被点名**。
 *
 * 判据来源（卡面 = 唯一判据源）:
 *   `.claude/task-briefs/2026-10-11-189-K12-06-标准一致-输出契约-可机器校验.md`
 *   🔴 **期望值派生自 K12-06 Q3 V2/V5；该卡未给探针判据**
 *      （该卡 §判据源 的 V1 是 `npx vitest run tests/output/contract-validator.test.ts`，
 *        **卡面没有给探针判据** ⇒ 本文件按创始人 2026-10-11 批准的形态，
 *        从该卡 §Q3 的**可判项**逐条派生期望值，**不新增判据、不超出该卡 Q3 表述范围**）:
 *   · §Q3 V2 穿生产入口：提交缺字段的一页纸 ⇒ **被拒 ＋ 点名缺哪个字段**  ⇒ 场景 `missing-field`
 *   · §Q3 V3 口径：KPI 表口径与定义不符 ⇒ **报错**                          ⇒ 场景 `kpi-口径`
 *   · §Q3 V5 反例：校验器短路（恒 true）⇒ V2 **必红**                        ⇒ 见文件末「V5 敏感性」
 *   · §Q3 V6 契约带版本；产物**记录所用契约版本**                            ⇒ [L1]＋[L2] 版本断言
 *
 * 契约（铁律 47；统一探针契约的单一实现在 ./probe-ladder.ts）:
 *   @input    — `--case <场景>`｜`--all`；场景 = `missing-field`（缺字段一页纸）｜`kpi-口径`（口径不符）
 *   @output   — stdout 逐条 `✅/❌/⚠️` ＋ 末行由 `out.finish()` 签发 `RESULT=<verdict>`
 *   @degraded — 目标件缺失（校验器 / 契约目录）⇒ **exit 2**（fail-closed，铁律 31）
 * 退出码: 0 = 断言全部成立｜1 = 目标件在但断言不成立｜2 = 目标件不存在 / 探针无法判定
 *
 * 断言级别（禁把静态命中当唯一断言，判例 V-02）:
 *   [L1-静态可达] 契约文件存在 / 非空 / 可解析 / 带版本
 *   [L2-真跑通]   动态 import `src/output/contract-validator.ts` 并**真调用**其导出面，
 *                 拿**真实返回/真实抛出**判定"被拒 ＋ 点名缺哪个字段"
 *
 * 驱动的声明约定（非判据本身，仅为"够到"判据的驱动形状; 见文件末边界②）:
 *   · 入口发现: 优先匹配 `/^(validate|verify|check|assert|inspect|lint)/i` 的导出；
 *              无匹配则退化为该模块**全部**具参导出（≥1 形参）
 *   · 调用形状: ① `(doc)` ② `(doc, 类型)` ③ `(类型, doc)` ④ `(doc, {type: 类型})`
 *   · "被拒": 调用抛出（且非形状类 TypeError）**或** 返回文本命中否定词
 *     （false/invalid/reject/missing/fail/err/缺/不符/不一致/violat/field/字段/issue/problem）
 *   · "点名缺哪个字段": 抛出消息或返回文本里出现**契约里真实存在的**字段名
 *   · 全部尝试都是形状类错误（TypeError/参数不匹配）⇒ 报「无法判定」＋ exit 2，**不谎报 FAIL**
 *   · 判定的真实判别器是"**有没有点名那个字段**"（必填项/口径项名字取自契约文件本身）——
 *     否定词表只是辅助；残余盲区（"成功返回里恰好也点名了缺失字段"）如实披露，
 *     且该盲区要求自相矛盾的返回形态，优先保证不产生**假绿**（恒绿 = 交付失败）。
 *
 * V5 敏感性（该卡 Q3 V5「短路 ⇒ 必红」的探针形态）:
 *   "缺字段的一页纸 ⇒ 被拒"这一条断言即 V5 的探测器 —— 校验器若**恒 true**，
 *   则该调用**不会**产生任何否定证据 ⇒ 本探针 [L2]「被拒」必红 ⇒ RESULT=FAIL。
 *   （本探针不改被测件: 短路反例由实现卡按其 §Done 反例项自行留原始输出。）
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { load as parseYaml } from 'js-yaml';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量（逐字取自卡面 §Q2 写集）
// ══════════════════════════════════════════════════════════════════════════════

/** 校验器（卡面 §Q2 写集） */
const VALIDATOR_REL = 'src/output/contract-validator.ts';
/** 四类产出契约所在（卡面 §Q2 写集: `extensions/reports/contracts/*.yaml`） */
const CONTRACTS_REL = 'extensions/reports/contracts';
/** 四类产出（卡面 §Q1: 一页纸 / KPI 表 / 周报 / 诊断报告） */
const CONTRACTS: readonly { readonly type: string; readonly file: string }[] = [
  { type: 'one-pager', file: 'one-pager.yaml' },
  { type: 'kpi-table', file: 'kpi-table.yaml' },
  { type: 'weekly', file: 'weekly.yaml' },
  { type: 'diagnosis-report', file: 'diagnosis-report.yaml' },
];
/** 断言里"点名"用的哨兵值（口径不符场景） */
const FIELD_SENTINEL = 'PROBE-VALUE';

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 取值 = **K12-06 的真交付面**（卡面 §Q2 写集逐字：校验器 ＋ `extensions/reports/contracts/` 下四件契约）。
 * 🔴 这些件**当前尚不存在**是**故意的**：不变式只在探针报 `RESULT=PASS` 时触发
 *   （ladder `checkTargetsInvariant` 首行 `if (verdict !== 'PASS') return null`），
 *   故声明 MISSING 件**不会**让本探针变红；而 K12-06 一旦落地，只有这 5 件**真存在**才可能报绿
 *   ⇒ 假绿被物理挡住。反过来说，若换成"现存旁证件"，不变式将**永不咬**（复核者实测的漏网形态）。
 * 四件契约均为 PASS 的**必要**件：本探针 [L1] 逐件断言存在且可解析，缺任一即 FAIL，不会报绿。
 *
 * ⚠️ 本表被 ladder 以**源文本正则**解析（`/'([^']+)'|"([^"]+)"/g`）⇒ 必须是**字面量引号数组**，
 *   不得写成模板串 / `.map()` / 变量拼接（那会被解析成空表 ⇒ 一旦报绿即判"TARGETS 空表"）。
 */
export const TARGETS: readonly string[] = [
  'src/output/contract-validator.ts',
  'extensions/reports/contracts/one-pager.yaml',
  'extensions/reports/contracts/kpi-table.yaml',
  'extensions/reports/contracts/weekly.yaml',
  'extensions/reports/contracts/diagnosis-report.yaml',
];

export const KNOWN_CASES: readonly string[] = ['missing-field', 'kpi-口径'];

// ══════════════════════════════════════════════════════════════════════════════
// 二、小工具
// ══════════════════════════════════════════════════════════════════════════════

/** `unknown` 收窄为记录（铁律 38 替代式：内联类型 ＋ 类型守卫） */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function toProbeError(err: unknown, code: string, phase: string, retryable = false): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError(code, phase, err instanceof Error ? err.message : String(err), retryable);
}

function readText(abs: string, phase: string): string {
  try {
    return readFileSync(abs, 'utf8');
  } catch (err: unknown) {
    throw toProbeError(err, 'FILE_READ_FAILED', phase, true);
  }
}

function observe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (err: unknown) {
    return `[unserializable: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function importModule(abs: string, phase: string): Promise<Record<string, unknown>> {
  let mod: unknown;
  try {
    mod = await import(abs);
  } catch (err: unknown) {
    throw toProbeError(err, 'IMPORT_FAILED', phase, true);
  }
  const rec = asRecord(mod);
  if (rec === undefined) {
    throw new ProbeError('IMPORT_SHAPE_DRIFT', phase, `动态 import 未返回模块对象: ${abs}`);
  }
  return rec;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、契约视图（L1: 内容面真值；L2 的输入构造也源于它，避免手写字段名）
// ══════════════════════════════════════════════════════════════════════════════

interface ContractView {
  readonly type: string;
  readonly rel: string;
  readonly version?: string;
  /** 契约里出现过的全部字段名（去重） */
  readonly allKeys: readonly string[];
  /** `required` / `必填` 形态声明的必填字段 */
  readonly requiredKeys: readonly string[];
  /** 口径类字段（`口径` / caliber / definition / unit / formula / semantic） */
  readonly caliberKeys: readonly string[];
}

/** 递归收集字段名 / 必填项 / 口径项（键名口径来自卡面 Q1 与 Q3 V3 的用词） */
function walkContract(
  node: unknown,
  acc: { keys: Set<string>; required: Set<string>; caliber: Set<string> },
): void {
  if (Array.isArray(node)) {
    for (const item of node) walkContract(item, acc);
    return;
  }
  const rec = asRecord(node);
  if (rec === undefined) return;
  // #506：布尔形态必填（`{name: 'x', required: true}`）—— 4 契约均用此形态；
  //   取同对象的 name/title/id/path 作字段名（entries → name；sections → title；pointers → id）。
  if (rec['required'] === true) {
    for (const k of ['name', 'title', 'id', 'path']) {
      const v = rec[k];
      if (typeof v === 'string' && v.length > 0) { acc.required.add(v); break; }
    }
  }
  for (const [key, value] of Object.entries(rec)) {
    acc.keys.add(key);
    if (/^(required|必填|必填项)$/i.test(key)) {
      if (Array.isArray(value)) {
        for (const v of value) if (typeof v === 'string') acc.required.add(v);
      }
    }
    if (/口径|caliber|definition|unit|formula|semantic/i.test(key)) acc.caliber.add(key);
    walkContract(value, acc);
  }
}

function findVersion(node: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  const rec = asRecord(node);
  if (rec === undefined) return undefined;
  for (const [key, value] of Object.entries(rec)) {
    if (/^(version|contractVersion|contract_version|版本)$/i.test(key)) {
      if (typeof value === 'string' || typeof value === 'number') return String(value);
    }
  }
  for (const value of Object.values(rec)) {
    const nested = findVersion(value, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function loadContract(root: string, meta: { type: string; file: string }): ContractView {
  const rel = `${CONTRACTS_REL}/${meta.file}`;
  const raw = readText(join(root, rel), `contract:${meta.type}`);
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err: unknown) {
    throw new ProbeError(
      'CONTRACT_UNPARSEABLE',
      `contract:${meta.type}`,
      `契约不可解析（YAML 语法错误）: ${rel} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const acc = { keys: new Set<string>(), required: new Set<string>(), caliber: new Set<string>() };
  walkContract(parsed, acc);
  return {
    type: meta.type,
    rel,
    version: findVersion(parsed),
    allKeys: [...acc.keys].sort(),
    requiredKeys: [...acc.required].sort(),
    caliberKeys: [...acc.caliber].sort(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、校验器驱动（L2 的唯一来源）
// ══════════════════════════════════════════════════════════════════════════════

interface LedgerObservation {
  readonly recorded: boolean;
  readonly fieldPaths: readonly string[];
  readonly codes: readonly string[];
  readonly contractVersion: number | null;
}

/**
 * 穿**真生产入口**校验一次，并从失败落账读回"被拒＋点名"（#506 修法）。
 *
 * 为什么读落账而不是读返回值：`validateOutputContract` 按 14 项批准口径 = **记录不阻断**
 * （`@output void`、永不抛）；其判别证据由内部 `validateOutput` 写入失败台账
 * （可经 `ValidateOptions.sinkPath` 注入临时落点）。本函数只驱动生产入口、读它自己写的
 * 证据 —— 不复制校验逻辑、不造第二套口径。
 *
 * @input  root（仓库根）；subject（一页纸三要素 text/orgId/generatedAt）
 * @output LedgerObservation（recorded=false ⇒ 未落账 = 未被拒）
 * @degrade 校验器缺失/无 `validateOutputContract` 导出 ⇒ ProbeError（exit 2）
 */
async function validateViaLedger(root: string, subject: Record<string, unknown>): Promise<LedgerObservation> {
  const phase = 'validator-ledger:one-pager';
  const abs = join(root, VALIDATOR_REL);
  if (!existsSync(abs)) {
    throw new ProbeError('VALIDATOR_MISSING', phase, `校验器不存在: ${VALIDATOR_REL}`);
  }
  const mod = await importModule(abs, phase);
  const fn = mod['validateOutputContract'];
  if (typeof fn !== 'function') {
    throw new ProbeError('VALIDATOR_NO_ENTRY', phase, `${VALIDATOR_REL} 未导出 validateOutputContract`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'probe-oc-'));
  const sink = join(dir, 'failures.jsonl');
  const opts = { sinkPath: sink, now: '2026-11-01T00:00:00+08:00' };
  (fn as (s: Record<string, unknown>, o: typeof opts) => void)(subject, opts);
  let observation: LedgerObservation = { recorded: false, fieldPaths: [], codes: [], contractVersion: null };
  const lines = existsSync(sink)
    ? readFileSync(sink, 'utf-8').trim().split('\n').filter((l) => l !== '')
    : [];
  const first = lines[0];
  if (first !== undefined) {
    const row = JSON.parse(first) as Record<string, unknown>;
    observation = {
      recorded: true,
      fieldPaths: Array.isArray(row['fieldPaths']) ? (row['fieldPaths'] as string[]) : [],
      codes: Array.isArray(row['codes']) ? (row['codes'] as string[]) : [],
      contractVersion: typeof row['contractVersion'] === 'number' ? row['contractVersion'] : null,
    };
  }
  rmSync(dir, { recursive: true, force: true });
  return observation;
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、场景
// ══════════════════════════════════════════════════════════════════════════════

/** L1: 四类契约的存在 / 非空 / 版本（卡面 §Q2 ＋ §Q3 V6 前半） */
function assertContractFiles(root: string, out: ProbeOutput): ContractView[] {
  const views: ContractView[] = [];
  for (const meta of CONTRACTS) {
    const abs = join(root, CONTRACTS_REL, meta.file);
    if (!existsSync(abs)) {
      out.fail(`契约缺失: ${CONTRACTS_REL}/${meta.file}（卡面 §Q2 写集逐字要求）`, 'L1');
      continue;
    }
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch (err: unknown) {
      out.error(`无法读取契约大小: ${meta.file} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (size === 0) {
      out.fail(`契约为空: ${CONTRACTS_REL}/${meta.file}`, 'L1');
      continue;
    }
    try {
      const view = loadContract(root, meta);
      views.push(view);
      out.pass(`契约可解析: ${view.rel}（字段 ${view.allKeys.length} / 必填 ${view.requiredKeys.length}）`, 'L1');
      if (view.version === undefined) {
        out.fail(`契约未带版本（卡面 §Q3 V6「契约带版本」）: ${view.rel}`, 'L1');
      } else {
        out.pass(`契约带版本: ${view.rel} version=${view.version}`, 'L1');
      }
    } catch (err: unknown) {
      const e = toProbeError(err, 'CONTRACT_LOAD_FAILED', 'contracts');
      out.fail(`${e.message}`, 'L1');
    }
  }
  return views;
}

/** 断开字段构造: 必填项齐备但**缺第一个**（缺字段场景的输入） */
function buildMissingFieldDoc(view: ContractView): { doc: Record<string, unknown>; names: readonly string[] } {
  if (view.requiredKeys.length > 0) {
    // 优先挑"普通字段"（非 `###` 章节 / 非 pointer）：缺字段场景要点名的是数据字段，
    //   章节缺失由 text 的哨兵值连带触发，会让"点名"失去判别力（#506 修法）。
    const preferred = view.requiredKeys.filter((k) => !k.startsWith('###') && !/pointer$/.test(k));
    const missing = preferred[0] ?? view.requiredKeys[0];
    const doc: Record<string, unknown> = {};
    for (const key of view.requiredKeys) {
      if (key !== missing) doc[key] = FIELD_SENTINEL;
    }
    return { doc, names: [missing] };
  }
  // 契约未显式声明 required ⇒ 退化: 交空文档，点名字段取契约全部字段名
  return { doc: {}, names: view.allKeys };
}

async function runMissingFieldCase(root: string, out: ProbeOutput, views: readonly ContractView[]): Promise<void> {
  out.case('missing-field');
  const view = views.find((v) => v.type === 'one-pager');
  if (view === undefined) {
    out.fail('一页纸契约不可用（`one-pager.yaml` 缺失/不可解析）⇒ V2 无法判定', 'L1');
    return;
  }
  const { doc, names } = buildMissingFieldDoc(view);
  out.note(
    `输入构造: 契约 ${view.rel}；缺失字段 = ${names.join(', ') || '(契约未声明字段名)'}` +
      `；必填口径 = ${view.requiredKeys.length > 0 ? 'required/必填 列表（含布尔形态）' : '退化: 全部字段名'}`,
  );

  const observation = await validateViaLedger(root, doc);
  out.note(
    `落账观测: recorded=${String(observation.recorded)}｜fieldPaths=${observation.fieldPaths.join(',') || '(空)'}` +
      `｜contractVersion=${String(observation.contractVersion)}`,
  );

  const named = names.filter(
    (n) => observation.fieldPaths.includes(n) || observation.codes.some((c) => c.includes(n)),
  );
  if (named.length > 0) {
    out.pass(
      `V2 穿生产入口: 缺字段的一页纸**被拒 ＋ 点名缺哪个字段** ⇒ ${named[0]}` +
        `（fieldPaths ${String(observation.fieldPaths.length)} 条）`,
      'L2',
    );
  } else {
    out.fail(
      'V2 **未**被拒或**未**点名缺失字段 —— 校验器短路（恒 true）即在此处变红（卡面 §Q3 V5）',
      'L2',
    );
  }

  if (view.version !== undefined) {
    const expected = Number(view.version);
    if (observation.contractVersion === expected) {
      out.pass(`V6 校验结果里记录了所用契约版本 version=${view.version}`, 'L2');
    } else {
      out.fail(
        `V6 校验结果里**未**出现所用契约版本（期望 ${view.version}，实测 ${String(observation.contractVersion)}）`,
        'L2',
      );
    }
  }
}

async function runCaliberCase(root: string, out: ProbeOutput, views: readonly ContractView[]): Promise<void> {
  out.case('kpi-口径');
  const view = views.find((v) => v.type === 'kpi-table');
  if (view === undefined) {
    out.fail('KPI 表契约不可用（`kpi-table.yaml` 缺失/不可解析）⇒ V3 无法判定', 'L1');
    return;
  }
  // V3 口径判据的**契约声明核验**（L1）：KPI 口径由契约声明表达（与 vitest ⑥⑦⑧ 同口径）；
  //   产品侧无公开 by-id 入口（validateOutputContract 硬编码 one-pager）⇒ 不驱动产品、只核声明。
  const raw = readText(join(root, CONTRACTS_REL, 'kpi-table.yaml'), 'contract:kpi-table');
  const checks: readonly { readonly label: string; readonly ok: boolean }[] = [
    {
      label: 'unitConsistency(groupBy=metricId, unitField=unit)',
      ok: /unitConsistency[\s\S]{0,240}?groupBy:\s*metricId[\s\S]{0,240}?unitField:\s*unit/.test(raw),
    },
    {
      label: 'valueUnique(rows[].period)',
      ok: /valueUnique[\s\S]{0,160}?path:\s*rows\[\]\.period/.test(raw),
    },
    {
      label: 'minItems(rows, min>=1)',
      ok: /minItems[\s\S]{0,160}?path:\s*rows[\s\S]{0,160}?min:\s*[1-9]/.test(raw),
    },
  ];
  const missing = checks.filter((c) => !c.ok);
  if (missing.length === 0) {
    out.pass(
      `V3 KPI 口径声明核验: 3/3 在场（${checks.map((c) => c.label).join('｜')}）`,
      'L1',
    );
  } else {
    out.fail(`V3 KPI 口径声明缺失: ${missing.map((c) => c.label).join('；')}`, 'L1');
  }
}
// ══════════════════════════════════════════════════════════════════════════════
// 六、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-output-contract（K12-06 / #189 · 期望值派生）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const e = toProbeError(err, 'REPO_ROOT_NOT_FOUND', 'bootstrap');
    out.error(`无法定位仓库根: ${e.message}`);
    out.finish();
    return 2;
  }
  out.note(`PROBE=probe-output-contract card=K12-06(#189) repoRoot=${root}`);
  out.note('期望值派生自 K12-06 Q3 V2/V5；该卡未给探针判据');

  let cases: readonly string[];
  try {
    cases = parseProbeArgs(KNOWN_CASES, argv).cases;
  } catch (err: unknown) {
    const e = toProbeError(err, 'ARGS_INVALID', 'args');
    out.error(`参数不可识别: ${e.message}`);
    out.finish();
    return 2;
  }

  if (!assertTargetsExist(root, out, [VALIDATOR_REL, CONTRACTS_REL])) {
    out.finish();
    return 2;
  }

  const views = assertContractFiles(root, out);

  for (const name of cases) {
    try {
      if (name === 'missing-field') await runMissingFieldCase(root, out, views);
      else if (name === 'kpi-口径') await runCaliberCase(root, out, views);
      else out.error(`场景未实现: ${name}`);
    } catch (err: unknown) {
      const e = toProbeError(err, 'CASE_FAILED', `case:${name}`, true);
      out.error(`场景 ${name} 执行失败 [${e.code}/${e.phase}/retryable=${String(e.retryable)}]: ${e.message}`);
    }
  }

  out.finish();
  return out.exitCode();
}

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）。
// `ProbeModule` 标注 = 编译期契约自检: 签名漂移会当场 tsc 报错。
if (process.argv[1] && /probe-output-contract\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(
        `probe-output-contract 未捕获异常: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    },
  );
}
