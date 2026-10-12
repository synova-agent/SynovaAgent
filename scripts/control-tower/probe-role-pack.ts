#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-role-pack.ts — K12-01（#184 · 登记件 `3-1`）角色预设包探针
 *
 * 用途: 把「这个岗位该给 agent 带什么」从"文档里的一句话"变成**一条能跑的命令** ——
 *   回答「加了吗 / 接上了吗 / 生效了吗」三问（内容面规范 §1.1 五连实测的共同形状:
 *   **能注册，但没接线；没接线，但不报错**）。
 *
 * 判据来源（卡面 = 唯一判据源，逐字取）:
 *   `.claude/task-briefs/2026-10-11-184-K12-01-预设包载体与装配-角色预设包五件套.md`
 *   · §Q3 V1 探针 exit 0 且清单含**客户自定义角色**（证明非硬编码）
 *   · §Q3 V2 生产入口能读到该角色 ⇒ **端到端输出里出现该角色**
 *   · §Q3 V3 **加一个角色目录不改宿主代码** ⇒ 生效
 *   · §Q3 V5 反例：`context-manifest.yaml` 改空 ⇒ V2 用例**必红**
 *   · §Done `npx tsx scripts/control-tower/probe-role-pack.ts --role finance`（expectExit 0）
 *   出厂角色 = `finance`（卡面 §Q2 写集里**唯一**列入的角色目录 = L0 出厂包）
 *
 * 契约（铁律 47；统一探针契约的单一实现在 ./probe-ladder.ts）:
 *   @input    — `--role <角色id>`（卡面 Done 判据命令原文，本探针归一为 `--case`）
 *               ｜`--case <场景>`｜`--all`
 *               场景: `finance`（出厂角色包）｜`custom-role`（客户自定义角色，证明非硬编码）
 *   @output   — stdout 逐条 `✅/❌/⚠️` ＋ 末行由 `out.finish()` 签发 `RESULT=<verdict>`
 *   @degraded — 目标件缺失 ⇒ 逐条 `⚠️ 未实现 …` ＋ **exit 2**（fail-closed，铁律 31；
 *               "未实现"绝不许绿 —— 这是 #205 本卡存在的全部理由）
 * 退出码: 0 = 断言全部成立｜1 = 目标件在但断言不成立｜2 = 目标件不存在 / 探针无法判定
 *
 * 断言级别（禁把静态命中当唯一断言，判例 V-02）:
 *   [L1-静态可达] 文件存在 / 非空
 *   [L2-真跑通]   穿**生产入口**真执行: `describeContentRegistry()`（运行时注册表值）
 *                 ＋ `initContentTypes({types:['presets']})`（真 import loader 并调 init/verify）
 *                 ＋ 动态 import 该 loader 模块并驱动其**零参查询导出**，观察真实返回
 *
 * 边界（如实标注，不夸大）:
 *   ① V3 的 `git diff --name-only 不含 src/**` 是**实现卡的过程取证**，探针不代跑
 *      （探针在仓库内建临时角色目录 = 越写集 = 红线）⇒ 本探针以等价行为判据替代:
 *      **磁盘上每个角色目录都出现在生产入口的真实返回里** —— 硬编码角色表 ⇒ 新目录不出现 ⇒ 红。
 *   ② `initContentTypes({types:['presets']})` 在 type **未登记**时实测 silent no-op
 *      （attempted=0 / loaded=0 / 无 error，本机实测）⇒ 断言必须查 `attempted>=1`，
 *      只查"无 error"就会得到绿色的假事实。
 *   ③ loader 若未暴露任何零参查询导出（角色清单不可观测）⇒ 报「无法判定」＋ exit 2，**不谎报 PASS**。
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量（逐字取自卡面 §Q2 写集 / §Q0-c 决策）
// ══════════════════════════════════════════════════════════════════════════════

/** 内容根（卡面 §Q0-c: 落点 `extensions/presets/`） */
const CONTENT_ROOT_REL = 'extensions/presets';
/** 角色目录所在（卡面 §Q2 写集: `extensions/presets/roles/{role-id}/`） */
const ROLES_REL = 'extensions/presets/roles';
/** 出厂角色 id —— 卡面 §Q2 写集里唯一列入的角色目录（L0 出厂包） */
const FACTORY_ROLE = 'finance';
/**
 * 角色包内容件（卡面 §Q2 写集**逐文件**列出；俗称"五件套" = 5 件内容 ＋ manifest）。
 * 顺序 / 文件名与卡面 §Q2 逐字一致，不得改写。
 */
const ROLE_PIECES: readonly string[] = [
  'manifest.json',
  'knowledge-scope.yaml',
  'context-manifest.yaml',
  'output-template.ref',
  'capabilities.yaml',
  'acceptance-criteria.yaml',
];
/** 生产入口（内容面装配）—— 非本卡写集，只读调用 */
const REGISTRY_MODULE_REL = 'src/deploy/content-registry.ts';
/** 期望的 registry type —— 内容根目录名（卡面 §Q0-c: 照 `file-driven-loaders.ts` 加第 10 路） */
const PRESETS_TYPE = 'presets';
/** V5 反例命中的那个文件（卡面 §Q3 V5 原文: `context-manifest.yaml` 改空 ⇒ V2 必红） */
const V5_RED_TRIGGER = 'context-manifest.yaml';

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 取值 = **K12-01 的真交付面**（前 7 条与探针内 `assertTargetsExist` 的闸门清单**同源同序**：
 * 内容根 manifest ＋ 出厂角色包六件，逐字取自卡面 §Q2 写集）＋ [L2] 驱动的生产入口（末条）。
 * 🔴 前 7 条**当前尚不存在**是**故意的**：不变式只在探针报 `RESULT=PASS` 时触发
 *   （ladder `checkTargetsInvariant` 首行 `if (verdict !== 'PASS') return null`），
 *   故声明 MISSING 件**不会**让本探针变红；而 K12-01 一旦落地，只有这些件**真存在**才可能报绿
 *   ⇒ 假绿被物理挡住。反过来说，若把它们换成"现存旁证件"，不变式将**永不咬**（复核者实测的漏网形态）。
 * 末条 `src/deploy/content-registry.ts` 同为真依赖：报绿前它必被真 import 并真驱动。
 *
 * ⚠️ 本表被 ladder 以**源文本正则**解析（`/'([^']+)'|"([^"]+)"/g`）⇒ 必须是**字面量引号数组**，
 *   不得写成模板串 / `.map()` / 变量拼接（那会被解析成空表 ⇒ 一旦报绿即判"TARGETS 空表"）。
 */
export const TARGETS: readonly string[] = [
  'extensions/presets/manifest.json',
  'extensions/presets/roles/finance/manifest.json',
  'extensions/presets/roles/finance/knowledge-scope.yaml',
  'extensions/presets/roles/finance/context-manifest.yaml',
  'extensions/presets/roles/finance/output-template.ref',
  'extensions/presets/roles/finance/capabilities.yaml',
  'extensions/presets/roles/finance/acceptance-criteria.yaml',
  'src/deploy/content-registry.ts',
];

export const KNOWN_CASES: readonly string[] = ['finance', 'custom-role'];

// ══════════════════════════════════════════════════════════════════════════════
// 二、小工具（本文件自足；不引第二套契约实现）
// ══════════════════════════════════════════════════════════════════════════════

/** `unknown` 收窄为记录（铁律 38 替代式：内联类型 ＋ 类型守卫，不用 any 断言） */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const rec: Record<string, unknown> = value as Record<string, unknown>;
  return rec;
}

/** `unknown` 收窄为非空数组 */
function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** 错误归一（铁律 32: 一切内部异常带 code / phase / retryable） */
function toProbeError(err: unknown, code: string, phase: string, retryable = false): ProbeError {
  if (err instanceof ProbeError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  return new ProbeError(code, phase, msg, retryable);
}

/** 动态 import 成模块记录；失败即抛（不空吞） */
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

/** 可安全 JSON 化的观测文本（不可序列化的形状显式暴露，不静默成空串） */
function observe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `[unserializable: ${msg}]`;
  }
}

/** 磁盘上的角色目录 id（不存在 ⇒ 空数组；其它读盘错误 ⇒ 抛，不静默） */
function listRoleIds(root: string): string[] {
  const dir = join(root, ROLES_REL);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') return [];
    throw toProbeError(err, 'ROLES_DIR_UNREADABLE', 'scan', true);
  }
}

/** 文件非空判定（0 字节 = 内容缺失 ⇒ V5「改空」形态） */
function isNonEmptyFile(abs: string): boolean {
  if (!existsSync(abs)) return false;
  try {
    return statSync(abs).size > 0;
  } catch (err: unknown) {
    throw toProbeError(err, 'STAT_FAILED', 'scan', true);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、生产入口驱动（L2 的唯一来源）
// ══════════════════════════════════════════════════════════════════════════════

interface PresetsDrive {
  /** 运行时注册表里是否有 `type === 'presets'` 的项 */
  readonly registryHasType: boolean;
  /** `initContentTypes({types:['presets']})` 的 attempted（防 silent no-op） */
  readonly attempted: number;
  /** 该 type 的行是否存在且 ok */
  readonly rowOk: boolean;
  /** 真被调用的 loader 函数名（init ＋ verify 步） */
  readonly rowVerified: readonly string[];
  readonly rowError?: string;
  /** loader 模块动态 import 后的可观测真实返回（角色清单来源） */
  readonly observed: string;
  /** 参与观测的零参导出函数名（可审读，防"观测面"成黑箱） */
  readonly observedFrom: readonly string[];
}

/** 从注册表项解析 loader 模块绝对路径（`loader.module` 相对 `src/deploy`） */
function resolveLoaderModule(root: string, spec: string): string {
  const base = join(root, 'src', 'deploy');
  const withExt = /\.[cm]?[jt]s$/.test(spec) ? spec : `${spec}.ts`;
  return isAbsolute(withExt) ? withExt : resolve(base, withExt);
}

/**
 * 驱动生产入口 —— 本探针 L2 断言的**唯一来源**。
 *
 * @input  root（仓库根）
 * @output 见 PresetsDrive
 * @degrade 生产入口模块/API 缺失 ⇒ 抛 ProbeError（⇒ 探针报「无法判定」exit 2，不谎报 PASS）
 */
async function drivePresetsProduction(root: string): Promise<PresetsDrive> {
  const phase = 'production-drive';
  const registryAbs = join(root, REGISTRY_MODULE_REL);
  if (!existsSync(registryAbs)) {
    throw new ProbeError('REGISTRY_MODULE_MISSING', phase, `生产入口不存在: ${REGISTRY_MODULE_REL}`);
  }
  const reg = await importModule(registryAbs, phase);
  const describeFn = reg['describeContentRegistry'];
  const initFn = reg['initContentTypes'];
  if (typeof describeFn !== 'function' || typeof initFn !== 'function') {
    throw new ProbeError(
      'REGISTRY_API_DRIFT',
      phase,
      'content-registry 未暴露 describeContentRegistry / initContentTypes（契约漂移）',
    );
  }

  const snapshot: unknown = (describeFn as () => unknown)();
  const entries = asArray(asRecord(snapshot)?.['entries']) ?? [];
  const presetsRaw = entries.find((e) => asRecord(e)?.['type'] === PRESETS_TYPE);
  const presetsEntry = asRecord(presetsRaw);

  const report: unknown = await (initFn as (o: Record<string, unknown>) => Promise<unknown>)({
    types: [PRESETS_TYPE],
  });
  const reportRec = asRecord(report);
  const results = asArray(reportRec?.['results']) ?? [];
  const rowRaw = results.find((r) => asRecord(r)?.['type'] === PRESETS_TYPE);
  const row = asRecord(rowRaw);
  const attempted = typeof reportRec?.['attempted'] === 'number' ? reportRec['attempted'] : -1;

  // 观测面: 真 import loader 模块 → 调 init → 调**零参**查询导出（有参者形状未知，不强猜）
  const loaderSpec = asRecord(presetsEntry?.['loader'])?.['module'];
  const initName = asRecord(presetsEntry?.['loader'])?.['init'];
  const cleanupName = asRecord(presetsEntry?.['loader'])?.['cleanup'];
  const observedFrom: string[] = [];
  let observed = '';

  if (typeof loaderSpec === 'string') {
    const loaderAbs = resolveLoaderModule(root, loaderSpec);
    if (!existsSync(loaderAbs)) {
      throw new ProbeError(
        'LOADER_MODULE_MISSING',
        phase,
        `注册表声明的 loader 模块不存在: ${loaderSpec} ⇒ ${loaderAbs}`,
      );
    }
    const loader = await importModule(loaderAbs, phase);
    const chunks: string[] = [];

    const callNamed = (name: string, args: unknown[]): unknown => {
      const fn = loader[name];
      if (typeof fn !== 'function') {
        throw new ProbeError('LOADER_EXPORT_MISSING', phase, `loader 未导出 ${name}`);
      }
      return (fn as (...a: unknown[]) => unknown)(...args);
    };

    if (typeof initName === 'string') {
      chunks.push(`${initName}=${observe(callNamed(initName, []))}`);
      observedFrom.push(initName);
    }
    const exclude = new Set<string>(
      [typeof initName === 'string' ? initName : '', typeof cleanupName === 'string' ? cleanupName : ''].filter(
        (s) => s.length > 0,
      ),
    );
    for (const [name, value] of Object.entries(loader)) {
      if (typeof value !== 'function') continue;
      if (exclude.has(name)) continue;
      // 只驱动零参查询；跳过名称即状态清理的导出（避免探针把生产缓存清掉）
      if (value.length !== 0) continue;
      if (/^clear|^reset|^cleanup|^dispose/i.test(name)) continue;
      const fn = value as (...a: unknown[]) => unknown;
      try {
        chunks.push(`${name}=${observe(fn())}`);
        observedFrom.push(name);
      } catch (err: unknown) {
        // 铁律 24/32: 观测面里单个导出抛错必须可见（不静默丢弃，也不当成"角色不存在"）
        const e = toProbeError(err, 'LOADER_EXPORT_THREW', `observe:${name}`);
        chunks.push(`${name}=[threw ${e.code}/${e.phase}: ${e.message}]`);
        observedFrom.push(name);
      }
    }
    observed = chunks.join(' | ');
  }

  return {
    registryHasType: presetsEntry !== undefined,
    attempted: typeof attempted === 'number' ? attempted : -1,
    rowOk: row?.['ok'] === true,
    rowVerified: (asArray(row?.['verified']) ?? []).map((v) => String(v)),
    rowError: typeof row?.['error'] === 'string' ? row['error'] : undefined,
    observed,
    observedFrom,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、场景
// ══════════════════════════════════════════════════════════════════════════════

/** 角色包内容件齐备性（[L1]） */
function assertRolePieces(root: string, out: ProbeOutput, roleId: string): void {
  for (const piece of ROLE_PIECES) {
    const rel = `${ROLES_REL}/${roleId}/${piece}`;
    if (isNonEmptyFile(join(root, rel))) {
      out.pass(`角色包内容件存在且非空: ${rel}`, 'L1');
    } else {
      out.fail(`角色包内容件缺失或为空: ${rel}（卡面 §Q2 写集逐字要求）`, 'L1');
    }
  }
}

/** V5 锚点（[L1] 文件层 ⇒ 改空必红） */
function assertV5Anchor(root: string, out: ProbeOutput, roleIds: readonly string[]): void {
  for (const roleId of roleIds) {
    const rel = `${ROLES_REL}/${roleId}/${V5_RED_TRIGGER}`;
    if (isNonEmptyFile(join(root, rel))) {
      out.pass(`V5 锚点非空（改空此处 ⇒ 本探针必红）: ${rel}`, 'L1');
    } else {
      out.fail(`V5 锚点为空/缺失 —— 上下文清单为空 ⇒ 该角色"带什么上下文"不可解: ${rel}`, 'L1');
    }
  }
}

async function runFinanceCase(root: string, out: ProbeOutput): Promise<void> {
  out.case('finance');
  out.note(`口径: 出厂角色 = ${FACTORY_ROLE}（卡面 §Q2 写集唯一列入的角色目录）`);

  assertRolePieces(root, out, FACTORY_ROLE);
  assertV5Anchor(root, out, [FACTORY_ROLE]);

  // [L2] 生产入口: 注册表登记 ＋ 真装配
  const drive = await drivePresetsProduction(root);
  if (drive.registryHasType) {
    out.pass(`生产入口注册表含 type="${PRESETS_TYPE}"（运行时 describeContentRegistry 取数）`, 'L2');
  } else {
    out.fail(`生产入口注册表**无** type="${PRESETS_TYPE}" 项 ⇒ 内容面未接线（"加了吗"只到文件层）`, 'L2');
  }
  if (drive.attempted >= 1) {
    out.pass(`initContentTypes({types:['${PRESETS_TYPE}']}) attempted=${drive.attempted}（防 silent no-op）`, 'L2');
  } else {
    out.fail(
      `initContentTypes({types:['${PRESETS_TYPE}']}) attempted=${drive.attempted} ⇒ 装配被静默跳过（silent no-op）`,
      'L2',
    );
  }
  if (drive.rowOk) {
    out.pass(
      `装配行 ok=true，真被调用的 loader 函数: ${drive.rowVerified.join(' → ') || '(无 verify 步)'}`,
      'L2',
    );
  } else {
    out.fail(`装配行 ok≠true${drive.rowError === undefined ? '' : `（error: ${drive.rowError}）`}`, 'L2');
  }

  // [L2] V2 端到端输出里出现该角色
  if (drive.observedFrom.length === 0) {
    out.notImplemented('无法判定: 生产口径未暴露任何可驱动的 loader 导出（角色清单不可观测）');
    return;
  }
  out.note(`观测面 = ${drive.observedFrom.join(', ')}（loader 真实返回）`);
  if (drive.observed.includes(FACTORY_ROLE)) {
    out.pass(`V2 端到端输出里出现出厂角色 "${FACTORY_ROLE}"（穿生产入口，非 grep）`, 'L2');
  } else {
    out.fail(`V2 端到端输出里**未**出现出厂角色 "${FACTORY_ROLE}"`, 'L2');
  }
}

async function runCustomRoleCase(root: string, out: ProbeOutput): Promise<void> {
  out.case('custom-role');
  const roleIds = listRoleIds(root);
  const customIds = roleIds.filter((id) => id !== FACTORY_ROLE);
  out.note(`磁盘角色目录: ${roleIds.length === 0 ? '(无)' : roleIds.join(', ')}｜非出厂: ${customIds.length}`);

  if (customIds.length === 0) {
    out.fail(
      `V1 清单里**没有客户自定义角色**（磁盘上除 ${FACTORY_ROLE} 外无角色目录）⇒ 无法证明"非硬编码"`,
      'L1',
    );
    return;
  }
  out.pass(`V1 存在客户自定义角色目录: ${customIds.join(', ')}`, 'L1');

  for (const roleId of roleIds) {
    assertRolePieces(root, out, roleId);
  }
  assertV5Anchor(root, out, roleIds);

  const drive = await drivePresetsProduction(root);
  if (drive.observedFrom.length === 0) {
    out.notImplemented('无法判定: 生产口径未暴露任何可驱动的 loader 导出（角色清单不可观测）');
    return;
  }
  out.note(`观测面 = ${drive.observedFrom.join(', ')}（loader 真实返回）`);

  // [L2] V3 加一个角色目录即生效（等价判据）: 磁盘每个角色目录都出现在生产入口真实返回里
  for (const roleId of roleIds) {
    if (drive.observed.includes(roleId)) {
      out.pass(`V3 目录驱动生效: 磁盘角色 "${roleId}" 出现在生产入口真实返回里（非硬编码）`, 'L2');
    } else {
      out.fail(`V3 磁盘角色 "${roleId}" **未**出现在生产入口真实返回里 ⇒ 角色表被硬编码 / 未被扫描`, 'L2');
    }
  }
  // [L2] V2 端到端输出里出现**自定义**角色（V1 的行为面）
  for (const roleId of customIds) {
    if (drive.observed.includes(roleId)) {
      out.pass(`V2 端到端输出里出现客户自定义角色 "${roleId}"`, 'L2');
    } else {
      out.fail(`V2 端到端输出里**未**出现客户自定义角色 "${roleId}"`, 'L2');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、CLI
// ══════════════════════════════════════════════════════════════════════════════

/** 卡面 Done 判据命令是 `--role finance` ⇒ 归一为契约的 `--case` 形态（不新增第二套 CLI 口径） */
function normalizeArgv(argv: readonly string[]): readonly string[] {
  const idx = argv.indexOf('--role');
  if (idx < 0) return argv;
  const value = argv[idx + 1];
  if (value === undefined || value.startsWith('--')) return argv; // 缺值时交给 parseProbeArgs 报错
  const copy = [...argv];
  copy[idx] = '--case';
  return copy;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-role-pack（K12-01 / #184）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const e = toProbeError(err, 'REPO_ROOT_NOT_FOUND', 'bootstrap');
    out.error(`无法定位仓库根: ${e.message}`);
    out.finish();
    return 2;
  }
  out.note(`PROBE=probe-role-pack card=K12-01(#184) repoRoot=${root}`);

  let cases: readonly string[];
  try {
    cases = parseProbeArgs(KNOWN_CASES, normalizeArgv(argv)).cases;
  } catch (err: unknown) {
    const e = toProbeError(err, 'ARGS_INVALID', 'args');
    out.error(`参数不可识别: ${e.message}`);
    out.finish();
    return 2;
  }

  // 目标件闸（卡面 §Q3 V2 主实现: 未实现 ⇒ exit 2，不许绿）
  const gateTargets = [
    `${CONTENT_ROOT_REL}/manifest.json`,
    ...ROLE_PIECES.map((p) => `${ROLES_REL}/${FACTORY_ROLE}/${p}`),
  ];
  if (!assertTargetsExist(root, out, gateTargets)) {
    out.note(`卡面判据命令: npx tsx scripts/control-tower/probe-role-pack.ts --role ${FACTORY_ROLE}`);
    out.finish();
    return 2;
  }

  for (const name of cases) {
    try {
      if (name === 'finance') await runFinanceCase(root, out);
      else if (name === 'custom-role') await runCustomRoleCase(root, out);
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
// `ProbeModule` 标注 = 编译期契约自检: 签名漂移（KNOWN_CASES / main 形状）会当场 tsc 报错。
if (process.argv[1] && /probe-role-pack\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(
        `probe-role-pack 未捕获异常: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    },
  );
}
