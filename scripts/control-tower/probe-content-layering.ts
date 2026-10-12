#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-content-layering.ts — K12-20 #203（RB-06）岗位内容分层判据探针
 *
 * 判据来源: 卡面 `.claude/task-briefs/2026-10-11-203-K12-20-岗位内容分层-提示词-工具-知识按部门变.md` §Q3 逐条:
 *   V1 `--case dept-diff` ⇒ exit 0
 *   V2 **穿生产入口**：同一问题，财务身份 vs 销售身份 ⇒ **内容不同**（提示词/工具/知识至少一项不同），
 *      且差异**只由内容层文件决定**
 *   V3 **数据面**：改部门层文件 ⇒ 生效；`git diff --name-only` 不含 `src/**`
 *   V4 **与权限层分工**：本卡**不改可见性**（不能看的数据仍然看不到）—— 与 K12-05 交叉验证
 *   V5 反例（改坏即红）：把部门层删掉 ⇒ **回落企业层**（不变更危险）
 *   V6 **概念区分**：判据输出里**显式标注**「内部作业预设 ≠ 客户岗位预设」
 * 场景名逐字取自 ladder brief §场景取值表: `dept-diff`（卡面原文）｜`dept-layer-removed`
 *
 * 🟢 判据级别（判例 V-01 / V-02）：**判定不吃 grep**。
 *   V2 / V3 / V5 全部是 [L2-真跑通]：真 `import` 解析服务、真按身份解析两次、真比对返回内容、
 *   真把差异逐字回追到内容层文件文本（**数据面证据，不是 grep 证据**）。
 *   [L1] 只用于「载体是否都在 extensions/ 下、有没有 src/ 载体」这类**路径事实**，且显式标级别。
 *
 * 🔴 「改部门层文件 ⇒ 生效」的**非破坏式**等价判据（本探针的核心设计）:
 *   探针**不改任何文件**（写集红线），改为**逐字回追**：解析结果里 A 有 B 无的每个叶子值，
 *   必须能在内容层文件文本里找到 ⇒ 内容是**文件的内容**，不是硬编码 ⇒ 硬编码型实现必判红。
 *   「删部门层」同样非破坏式：用一个**没有对应文件的部门 id** 解析 ⇒ 必须回落企业层。
 *
 * 契约（铁律 47）:
 *   @input    — `--case dept-diff|dept-layer-removed` ｜ `--all`
 *   @output   — stdout 逐条 `✅ PASS / ❌ FAIL / ⚠️ 未实现 / ⚠️ UNVERIFIED / ❌ ERROR`，每条标 [L1] / [L2]；
 *               末行恒由 `ProbeOutput.finish()` 签发 `RESULT=PASS|FAIL|NOT_IMPLEMENTED|ERROR`
 *   @degraded — 目标件（解析服务 / 内容层载体）不存在 ⇒ `⚠️ 未实现` ＋ exit 2；
 *               解析入口不可调用 / 返回形态读不出 / 内容层文件读不到 ⇒ `❌ ERROR` ＋ exit 2（fail-closed）
 * 退出码: 0 = 全部断言成立 ｜ 1 = 目标件在但断言不成立（**真红**）｜ 2 = 目标未实现 或 探针无法判定
 *
 * 🔴 上线闸声明（卡面 Done 标准要求交付件显式声明）:
 *   **本章（K12-20）完成前不得开第一个客户上线** —— 本探针在 exit 0 之前，该闸**未解除**。
 *
 * 🔴 边界与披露（如实标注）:
 *   ① 探针要求的契约面（解析入口导出名 / 入参形态 / 内容层目录布局）**由本探针显式声明** ——
 *      卡面 §Q2 给了目录（`extensions/content-layers/{manifest.json,departments/*.yaml}`）但未固定导出名与签名。
 *      未命中 ⇒ `NOT_IMPLEMENTED`（exit 2，ladder brief §4.2-2：符号缺失 = 能力未实现）。
 *   ② 目标件 `src/services/content-layering.ts` ＋ `extensions/content-layers/` 实测**均不存在**
 *      （as_of `local-b940b101d`）⇒ 初始态 = exit 2（预期态，不是失败）。
 *   ③ V4 交叉验证依赖 K12-05 载体 `extensions/knowledge-scope/` —— 实测**不存在** ⇒ 该条只能
 *      记 `[UNVERIFIED]`，**不计入 PASS**（判例 V-09）。
 *   ④ 本件被 `probe-ladder.ts` 编译期 import；但自带直执行守卫 ⇒ 可单独 `npx tsx` 直跑。
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  ProbeOutput,
  ProbeError,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  type ProbeModule,
} from './probe-ladder';

// ══════════════════════════════════════════════════════════════════════════════
// 一、判据常量
// ══════════════════════════════════════════════════════════════════════════════

/** 场景清单（逐字取自 ladder brief §场景取值表） */
export const KNOWN_CASES: readonly string[] = ['dept-diff', 'dept-layer-removed'];

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 🔴 牙齿来源（2026-10-11 复核反证后修正）: 前两条是卡面 §Q2 写集逐字的真交付面，**实测当前都不存在** ⇒
 * 本探针今日报 NOT_IMPLEMENTED(exit 2)。第三条 = 卡面原文的部门层目录（`departments/*.yaml`）。
 *   不变式**只在报 PASS 时**做 existsSync ⇒ 声明缺失路径**不改变**当前退出码/判定；
 *   它只挡住"哪天有人把它们改成报绿"这一路 —— 改绿者必须先让内容分层载体真的存在。
 */
export const TARGETS: readonly string[] = ['src/services/content-layering.ts', 'extensions/content-layers/manifest.json', 'extensions/content-layers/departments'];


/** 卡面 §Q2 写集声明的目标件（缺失 ⇒ exit 2） */
const DECLARED_TARGETS: readonly string[] = ['src/services/content-layering.ts', 'extensions/content-layers'];

/** 内容层载体根（卡面 §Q2 原文） */
const LAYER_ROOT = 'extensions/content-layers';

/** 解析入口候选导出名（🔴 探针声明面） */
const ENTRY_NAMES: readonly string[] = [
  'resolveContent',
  'resolveLayerContent',
  'resolveContentForIdentity',
  'getContentForDepartment',
  'resolveContentLayers',
  'buildLayeredContent',
];

/**
 * 解析服务候选路径（**卡面 §Q2 写集逐字**）。
 *
 * 🔴 为什么不扫目录（实测教训，2026-10-11）: 按文件名正则扫目录并逐个 `import()` 试探，
 *   在 ladder 全量进程里会拉起无关生产模块 ⇒ 触发 SIGABRT（exit 134）。
 *   探针无权拉起与判据无关的生产模块 ⇒ 候选面收敛到卡面声明路径。
 */
const CANDIDATE_PATHS: readonly string[] = [DECLARED_TARGETS[0]];

/** 企业层文件候选（按序取首个存在者） */
const ENTERPRISE_CANDIDATES: readonly string[] = [
  'enterprise.yaml',
  'enterprise.yml',
  'enterprise.json',
  'base.yaml',
  'manifest.json',
  'enterprise/manifest.json',
];

/** 部门层子目录候选 */
const DEPARTMENT_DIRS: readonly string[] = ['departments', 'department'];

/** 内容三面（卡面 V2：「提示词/工具/知识至少一项不同」） */
const CONTENT_FACETS: readonly string[] = ['prompt', 'tool', 'knowledge'];

/** 探针使用的"同一问题"（V2 要求同一问题、不同身份） */
const PROBE_QUESTION = '本次企业增长的头号瓶颈是什么？';

/** 无对应文件的部门 id（V5：非破坏式模拟「部门层被删」） */
const ABSENT_DEPARTMENT = '__probe_no_such_department__';

/** 差异回追上限（确定性取样，防超长输出） */
const DELTA_LIMIT = 20;

/** V6 概念区分锚（内部作业预设路径，实测存在：synova-cto / synova-k3-audit / synova-squad-lead） */
const INTERNAL_PRESET_ROOT = 'docs/synova/presets';

// ══════════════════════════════════════════════════════════════════════════════
// 二、通用小工具（类型守卫优先 —— 铁律 38：禁 any 型断言）
// ══════════════════════════════════════════════════════════════════════════════

type ProbeCallable = (...args: readonly unknown[]) => unknown;

function isCallable(value: unknown): value is ProbeCallable {
  return typeof value === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toProbeError(err: unknown, phase: string): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError('UNEXPECTED', phase, err instanceof Error ? err.message : String(err), false);
}

function preview(value: unknown, cap = 160): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (err: unknown) {
    return `<不可序列化: ${err instanceof Error ? err.message : String(err)}>`;
  }
  if (text === undefined) return String(value);
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * 深度收集**字符串叶子**（含路径），带环检测与深度上限。
 * 用途: 不假设解析结果的具体形状（探针不猜实现的对象结构），只对"内容"本身做断言。
 *
 * 契约: @input 任意值 ＋ 上限 ｜ @output `路径=值` 列表 ｜ @degraded 环/超深 ⇒ 停止该分支并记录
 */
function collectStringLeaves(
  value: unknown,
  path = '$',
  leaves: { path: string; value: string }[] = [],
  seen: Set<object> = new Set(),
  depth = 0,
): { path: string; value: string }[] {
  if (depth > 12) return leaves;
  if (typeof value === 'string') {
    leaves.push({ path, value });
    return leaves;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return leaves;
    seen.add(value);
    value.forEach((item, index) => collectStringLeaves(item, `${path}[${index}]`, leaves, seen, depth + 1));
    return leaves;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return leaves;
    seen.add(value);
    for (const key of Object.keys(value).sort()) {
      collectStringLeaves(value[key], `${path}.${key}`, leaves, seen, depth + 1);
    }
  }
  return leaves;
}

function uniqueValues(leaves: readonly { path: string; value: string }[]): string[] {
  const out: string[] = [];
  for (const leaf of leaves) {
    if (leaf.value.trim().length === 0) continue;
    if (!out.includes(leaf.value)) out.push(leaf.value);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、目标发现（真 import ＋ 真读文件）
// ══════════════════════════════════════════════════════════════════════════════

interface LoadedTarget {
  readonly path: string;
  readonly mod: Record<string, unknown>;
}

function candidatePaths(root: string): string[] {
  return CANDIDATE_PATHS.filter((rel) => existsSync(join(root, rel)));
}

async function importIfPresent(root: string, rel: string, out: ProbeOutput): Promise<LoadedTarget | undefined> {
  const abs = join(root, rel);
  if (!existsSync(abs)) return undefined;
  try {
    const mod: Record<string, unknown> = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    return { path: rel, mod };
  } catch (err: unknown) {
    out.note(`  ↳ 候选 ${rel} import 失败（跳过该候选，**不算通过**）: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    return undefined;
  }
}

function pickCallable(mod: Record<string, unknown>, names: readonly string[]): ProbeCallable | undefined {
  for (const name of names) {
    const value = mod[name];
    if (isCallable(value)) return value;
  }
  return undefined;
}

interface ContentEntry {
  readonly modulePath: string;
  readonly resolveContent: ProbeCallable;
}

async function discoverEntry(root: string, out: ProbeOutput): Promise<ContentEntry | undefined> {
  const candidates = candidatePaths(root);
  out.note(`候选路径（卡面 §Q2 写集逐字，**不扫目录**）: ${candidates.length > 0 ? candidates.join(', ') : '（无）'}`);
  for (const rel of candidates) {
    const loaded = await importIfPresent(root, rel, out);
    if (!loaded) continue;
    const resolveContent = pickCallable(loaded.mod, ENTRY_NAMES);
    if (!resolveContent) continue;
    return { modulePath: loaded.path, resolveContent };
  }
  return undefined;
}

interface LayerFile {
  /** 仓库相对路径 */
  readonly path: string;
  readonly text: string;
}

interface LayerCarrier {
  /** 企业层（可能是 manifest/base，也可能不存在） */
  readonly enterprise: LayerFile | undefined;
  /** 部门层：部门 id → 文件 */
  readonly departments: readonly { readonly id: string; readonly file: LayerFile }[];
}

/** 收集内容层载体文件（真读文件；读不到 ⇒ 抛 ProbeError，不静默跳过） */
function readLayerCarrier(root: string): LayerCarrier {
  const layerRoot = join(root, LAYER_ROOT);
  let enterprise: LayerFile | undefined;
  for (const candidate of ENTERPRISE_CANDIDATES) {
    const abs = join(layerRoot, candidate);
    if (!existsSync(abs)) continue;
    enterprise = { path: `${LAYER_ROOT}/${candidate}`, text: readFileSync(abs, 'utf8') };
    break;
  }

  const departments: { id: string; file: LayerFile }[] = [];
  for (const dirName of DEPARTMENT_DIRS) {
    const abs = join(layerRoot, dirName);
    if (!existsSync(abs)) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (err: unknown) {
      throw new ProbeError(
        'LAYER_DIR_UNREADABLE',
        'data-plane',
        `部门层目录不可读 ${LAYER_ROOT}/${dirName}: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      if (!/\.(ya?ml|json)$/i.test(entry.name)) continue;
      const rel = `${LAYER_ROOT}/${dirName}/${entry.name}`;
      const file: LayerFile = { path: rel, text: readFileSync(join(abs, entry.name), 'utf8') };
      departments.push({ id: entry.name.replace(/\.(ya?ml|json)$/i, ''), file });
    }
    if (departments.length > 0) break;
  }
  return { enterprise, departments };
}

/** 解析调用（[L2]）：按声明形态依次真调用；全部失败 ⇒ 抛 ProbeError（⇒ exit 2） */
async function callResolve(
  entry: ContentEntry,
  departmentIds: readonly string[],
  phase: string,
): Promise<unknown> {
  const shapes: readonly unknown[] = [
    { departmentIds: [...departmentIds], question: PROBE_QUESTION },
    { departmentIds: [...departmentIds] },
    { departments: [...departmentIds], question: PROBE_QUESTION },
  ];
  const failures: string[] = [];
  for (const shape of shapes) {
    try {
      const raw: unknown = await entry.resolveContent(shape);
      if (raw !== undefined && raw !== null) return raw;
      failures.push(`${preview(shape, 60)} ⇒ 返回空`);
    } catch (err: unknown) {
      failures.push(`${preview(shape, 60)} ⇒ ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  throw new ProbeError(
    'RESOLVE_CALL_FAILED',
    phase,
    `解析入口 ${entry.modulePath} 按声明形态均调用不成功: ${failures.join(' | ')}`,
    false,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、两个场景
// ══════════════════════════════════════════════════════════════════════════════

/** V2 ＋ V3 ＋ V6：同一问题、财务身份 vs 销售身份 ⇒ 内容不同，且差异只由内容层文件决定 */
async function caseDeptDiff(entry: ContentEntry, root: string, out: ProbeOutput): Promise<void> {
  const carrier = readLayerCarrier(root);
  if (carrier.departments.length < 2) {
    out.error(
      `无法构造「两个部门」场景：${LAYER_ROOT}/departments/ 下实测部门层文件 ${carrier.departments.length} 个（需 ≥ 2）⇒ 无法判定`,
    );
    return;
  }

  // V6 —— 概念区分（卡面要求判据输出里**显式标注**）
  out.note(
    `V6 概念区分：本探针测的是【客户岗位预设内容面】= ${LAYER_ROOT}/**（部门层覆盖企业层）；` +
      `**≠** 仓内【内部作业预设】= ${INTERNAL_PRESET_ROOT}/**（synova-cto / synova-k3-audit / synova-squad-lead，` +
      `与客户岗位无关）。两者混为一谈 ⇒ 会把"我们自己怎么干活"当成"客户岗位分层已完成"。`,
  );

  const deptA = carrier.departments[0];
  const deptB = carrier.departments[1];
  const resolvedA = await callResolve(entry, [deptA.id], 'dept-diff');
  const resolvedB = await callResolve(entry, [deptB.id], 'dept-diff');
  const leavesA = collectStringLeaves(resolvedA);
  const leavesB = collectStringLeaves(resolvedB);
  const valuesA = uniqueValues(leavesA);
  const valuesB = uniqueValues(leavesB);

  // V2 前半：同一问题、两个身份 ⇒ 内容必须不同
  const onlyA = valuesA.filter((v) => !valuesB.includes(v));
  const onlyB = valuesB.filter((v) => !valuesA.includes(v));
  if (onlyA.length + onlyB.length > 0) {
    out.pass(
      `V2 内容不同：身份 ${deptA.id} vs ${deptB.id} ⇒ 差异叶子 ${onlyA.length + onlyB.length} 个` +
        `（${deptA.id} 独有 ${onlyA.length} / ${deptB.id} 独有 ${onlyB.length}）`,
      'L2',
    );
  } else {
    out.fail(
      `V2 破：两个部门身份的解析结果**逐字相同** ⇒ 部门层未生效（提示词/工具/知识至少一项应不同）`,
      'L2',
    );
  }

  // V2 后半（数据面证据）：差异必须能**逐字回追**到内容层文件文本 ⇒ 差异只由内容层文件决定
  const layerFiles: readonly LayerFile[] = [
    ...(carrier.enterprise ? [carrier.enterprise] : []),
    ...carrier.departments.map((d) => d.file),
  ];
  const knownIds = carrier.departments.map((d) => d.id);
  const delta: { side: string; value: string }[] = [
    ...onlyA.map((value) => ({ side: deptA.id, value })),
    ...onlyB.map((value) => ({ side: deptB.id, value })),
  ].slice(0, DELTA_LIMIT);

  if (delta.length === 0) {
    out.note('  ↳ 无差异叶子 ⇒ 跳过回追（见上一条 FAIL）');
  } else {
    const untraceable = delta.filter(
      (item) =>
        !knownIds.includes(item.value) && !layerFiles.some((file) => file.text.includes(item.value)),
    );
    if (untraceable.length === 0) {
      out.pass(
        `V3 数据面：${delta.length} 个差异叶子**逐字命中内容层文件文本** ⇒ 内容来自文件（非硬编码）` +
          `；证据文件: ${layerFiles.map((f) => f.path).join(', ')}`,
        'L2',
      );
    } else {
      out.fail(
        `V3 破：${untraceable.length}/${delta.length} 个差异叶子在内容层文件里**找不到** ⇒ 差异不由内容层文件决定` +
          `（疑似硬编码）。未回追到的值: ${untraceable.map((i) => `${i.side}:${preview(i.value, 40)}`).join(' ; ')}`,
        'L2',
      );
    }
  }

  // 内容三面（卡面 V2 的"提示词/工具/知识"）—— 键路径级核对，如实标注能否核实
  const facetPaths = CONTENT_FACETS.filter((facet) =>
    leavesA.some((leaf) => leaf.path.toLowerCase().includes(facet)),
  );
  if (facetPaths.length > 0) {
    out.note(`  [L1-辅证] 解析结果含内容面键路径: ${facetPaths.join(' / ')}`);
  } else {
    out.unverified(
      `解析结果未出现 ${CONTENT_FACETS.join('/')} 面名键路径 ⇒ 无法核实"具体哪一面不同"（内容整体层面的差异断言仍成立，不计入 PASS）`,
    );
  }

  // [L1] 载体路径事实：内容层载体必须都在 extensions/ 下（"加文件不改代码"的物理前提）
  const outsideRoot = layerFiles.filter((file) => !file.path.startsWith('extensions/')).map((f) => f.path);
  if (outsideRoot.length === 0) {
    out.pass(`[L1] 内容层载体全部位于 extensions/ 下（${layerFiles.length} 个文件）⇒ 加文件即可生效`, 'L1');
  } else {
    out.fail(`[L1] 有内容层载体不在 extensions/ 下: ${outsideRoot.join(', ')}`, 'L1');
  }

  const inInternalPresets = layerFiles.filter((file) => file.path.startsWith(INTERNAL_PRESET_ROOT)).map((f) => f.path);
  if (inInternalPresets.length === 0) {
    out.pass(`[L1] V6 概念区分（机器核）：被测载体无一来自 ${INTERNAL_PRESET_ROOT}/**（内部作业预设）`, 'L1');
  } else {
    out.fail(`[L1] V6 破：被测载体落在内部作业预设目录 ${INTERNAL_PRESET_ROOT}/** ⇒ 测错了对象`, 'L1');
  }

  // V4 交叉验证（依赖 K12-05 载体）—— 不存在 ⇒ 如实标 UNVERIFIED，不计入 PASS
  if (existsSync(join(root, 'extensions/knowledge-scope'))) {
    out.note('[L1-辅证] K12-05 载体 extensions/knowledge-scope/ 存在 ⇒ 可见性交叉验证可另卡复核');
  } else {
    out.unverified(
      'V4 可见性交叉验证不可核：K12-05 载体 extensions/knowledge-scope/ 实测不存在 ⇒ 「不能看的数据仍然看不到」无法与本卡交叉验证（不计入 PASS）',
    );
  }
}

/** V5：部门层缺失 ⇒ 回落企业层（不变更危险，**不报错、不返空**） */
async function caseDeptLayerRemoved(entry: ContentEntry, root: string, out: ProbeOutput): Promise<void> {
  const carrier = readLayerCarrier(root);
  out.note(
    `V5 非破坏式模拟「部门层被删」：用无对应文件的部门 id 「${ABSENT_DEPARTMENT}」解析` +
      `（探针**不删文件** —— 写集红线；实测部门层文件 ${carrier.departments.length} 个）`,
  );

  const baseline = await callResolve(entry, [], 'dept-layer-removed');
  const fallback = await callResolve(entry, [ABSENT_DEPARTMENT], 'dept-layer-removed');
  const baseValues = uniqueValues(collectStringLeaves(baseline));
  const fallbackValues = uniqueValues(collectStringLeaves(fallback));

  if (fallbackValues.length === 0) {
    out.fail('V5 破：部门层缺失时返回**空内容**（应回落企业层）—— 空 ≠ 回落', 'L2');
  } else if (baseValues.length === 0) {
    out.fail('V5 无法判定：无身份（空部门）解析结果也为空 ⇒ 企业层基线取不到', 'L2');
  } else {
    const extra = fallbackValues.filter((v) => !baseValues.includes(v));
    const missing = baseValues.filter((v) => !fallbackValues.includes(v));
    if (extra.length === 0 && missing.length === 0) {
      out.pass(
        `V5 回落企业层：未知部门 id 的解析结果与"空部门身份"**逐字一致**（${baseValues.length} 个内容叶子）` +
          `⇒ 部门层缺失 = 回落，不变更危险`,
        'L2',
      );
    } else {
      out.fail(
        `V5 破：未知部门 id 的结果与企业层不一致（多出 ${extra.length} / 少了 ${missing.length} 个叶子）` +
          `；多出样例 ${extra.slice(0, 3).map((v) => preview(v, 40)).join(' ; ')}`,
        'L2',
      );
    }
  }

  if (carrier.enterprise) {
    out.pass(`V5 企业层载体在场: ${carrier.enterprise.path}（回落目标存在）`, 'L1');
  } else {
    out.unverified(
      `V5 企业层载体未找到（${LAYER_ROOT} 下试过 ${ENTERPRISE_CANDIDATES.join(' / ')}）⇒ 无法核实回落内容确为企业层（不计入 PASS）`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('K12-20 content-layering（#203 / RB-06 · 🔴上线闸）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const pe = toProbeError(err, 'bootstrap');
    out.error(`仓库根定位失败 [${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}]: ${pe.message}`);
    out.finish();
    return 2;
  }

  out.note(`PROBE=probe-content-layering card=K12-20(#203/RB-06) repoRoot=${root}`);
  out.note('🔴 上线闸：本探针 exit 0 之前，K12-20 未完成 ⇒ 第一个客户上线不得开启');

  // ① 目标件存在性闸（解析服务 ＋ 内容层载体）
  if (!assertTargetsExist(root, out, [...DECLARED_TARGETS])) {
    out.note('说明: 目标件未建 ⇒ 本探针按契约报 NOT_IMPLEMENTED（exit 2），**不是** PASS（未实现不许绿）');
    out.finish();
    return 2;
  }

  // ② 场景解析
  let cases: readonly string[];
  try {
    cases = parseProbeArgs(PROBE_CONTRACT.KNOWN_CASES, argv).cases;
  } catch (err: unknown) {
    const pe = toProbeError(err, 'args');
    out.error(`参数无法识别 [${pe.code}/${pe.phase}]: ${pe.message}`);
    out.finish();
    return 2;
  }

  // ③ 契约面发现（真 import）—— 符号缺失 ⇒ NOT_IMPLEMENTED / exit 2
  const entry = await discoverEntry(root, out);
  if (!entry) {
    out.notImplemented(
      `内容分层解析入口未命中：候选模块均未导出解析入口（候选名 ${ENTRY_NAMES.join(' / ')}）⇒ 能力未实现`,
    );
    out.finish();
    return 2;
  }
  out.note(`命中解析入口 ${entry.modulePath}（真 import 成功）`);

  // ④ 逐场景真跑
  for (const name of cases) {
    out.case(name);
    try {
      if (name === 'dept-diff') await caseDeptDiff(entry, root, out);
      else if (name === 'dept-layer-removed') await caseDeptLayerRemoved(entry, root, out);
      else out.error(`场景分派未覆盖: ${name}`);
    } catch (err: unknown) {
      const pe = toProbeError(err, name);
      out.error(`[${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}] ${pe.message} ⇒ 该场景无法判定`);
    }
  }

  out.finish();
  return out.exitCode();
}

/** 契约自证（编译期）：本模块的形状必须满足 ladder 的 ProbeModule */
const PROBE_CONTRACT: ProbeModule = { KNOWN_CASES, main };

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）
if (process.argv[1] && /probe-content-layering\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
