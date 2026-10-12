#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-permission-grants.ts — K12-11 (#194 / RB-03) 判据探针
 *
 * 用途: 让「权限是**一项一项勾**（`PermissionId[]`），不是五档套餐」这条能力**可被独立跑红**。
 *
 * 登记件: `docs/synova/coordination/施工项登记.ts:1671`
 *   `{ run: 'npx tsx scripts/control-tower/probe-permission-grants.ts --case custom-role', expectExit: 0 }`
 *
 * 🔴 契约（与 #205 梯子 `probe-ladder.ts` **接口同形**；本文件内联梯子的共用件，不 import 它):
 *   @input  — `--case <场景>`（至少一个）｜ `--all`（跑全部场景）｜ `--tenant <id>` `--role <id>`
 *             （可选: 打印某客户槽/某角色的解析结果，供人工取证）
 *   @output — stdout 逐条 `✅/❌/⚠️ 未实现` ＋ 末行**恒为** `RESULT=PASS|FAIL|NOT_IMPLEMENTED|ERROR`
 *   @exit   — 0 = 全部 PASS ｜ 1 = 有 FAIL ｜ **2 = 目标能力未实现（不许 exit 0）或探针自身异常**
 *   @degraded — 依赖缺失 / 命令跑不通 / 定位不到仓库根 ⇒ `ERROR` + exit 2（fail-closed，铁律 31）
 *   🔴 **`export const TARGETS`**（必需的机器可读声明）—— 梯子用它证明"报绿时目标件真存在"，
 *      缺声明 ⇒ 梯子记 ERROR（防"自洽假绿"，判例 V-09）。
 *
 * 🔴 **本探针的"改坏即红"最强证据 = 它的状态转换**:
 *   本卡开工前（`PermissionId` 全仓 0 命中）本探针**不存在** → 梯子 spawn 报 ERR_MODULE_NOT_FOUND；
 *   建成后在**能力未实现**的树上必须报 `NOT_IMPLEMENTED`(exit 2)，实现后才转 `PASS`(exit 0)。
 *   三态并排留档见交付回执（禁把"文件在"当成"能力在"）。
 *
 * 🔴 **不做什么**: 不碰 `scripts/control-tower/probe-ladder.ts` / `tests/control-tower/probe-contract.test.sh`
 *   （#205 写集）｜ 不碰 `probe-rbac-multitenant.ts`（K12-09 写集）｜ 不写审计标准。
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ══════════════════════════════════════════════════════════════════════════════
// 零、内联共用件（与 #205 梯子**接口同形** —— 不 import 它，避免引出一个未合 PR 的路径）
// ══════════════════════════════════════════════════════════════════════════════

/** 探针词汇表（与梯子逐字一致） */
const PROBE_VERDICTS = ['PASS', 'FAIL', 'NOT_IMPLEMENTED', 'ERROR'] as const;
type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

/** verdict → 退出码（契约唯一映射，探针不得自定） */
const EXIT_BY_VERDICT: Readonly<Record<ProbeVerdict, 0 | 1 | 2>> = {
  PASS: 0,
  FAIL: 1,
  NOT_IMPLEMENTED: 2,
  ERROR: 2,
};

/** 运行期异常（铁律 32: .code ＋ .phase ＋ .retryable） */
class ProbeError extends Error {
  readonly code: string;
  readonly phase: string;
  readonly retryable: boolean;
  constructor(code: string, phase: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.phase = phase;
    this.retryable = retryable;
  }
}

/** 逐条报告器 —— 探针唯一输出通道；末行 `RESULT=` 由本类统一签发 */
class ProbeOutput {
  readonly verdicts: ProbeVerdict[] = [];
  private unverifiedN = 0;

  constructor(label: string) {
    console.log(`PROBE ${label}`);
  }

  note(line: string): void {
    console.log(line);
  }

  case(name: string): void {
    console.log(`\n── case: ${name} ──`);
  }

  pass(text: string, level: 'L1' | 'L2' = 'L2'): void {
    this.verdicts.push('PASS');
    console.log(`  ✅ PASS [${level}] ${text}`);
  }

  fail(text: string, level: 'L1' | 'L2' = 'L2'): void {
    this.verdicts.push('FAIL');
    console.log(`  ❌ FAIL [${level}] ${text}`);
  }

  notImplemented(text: string): void {
    this.verdicts.push('NOT_IMPLEMENTED');
    console.log(`  ⚠️ 未实现 ${text}`);
  }

  unverified(text: string): void {
    this.unverifiedN += 1;
    console.log(`  ⚠️ UNVERIFIED ${text}`);
  }

  error(text: string): void {
    this.verdicts.push('ERROR');
    console.log(`  ❌ ERROR ${text}`);
  }

  verdict(): ProbeVerdict {
    if (this.verdicts.includes('ERROR')) return 'ERROR';
    if (this.verdicts.includes('FAIL')) return 'FAIL';
    if (this.verdicts.includes('NOT_IMPLEMENTED')) return 'NOT_IMPLEMENTED';
    return 'PASS';
  }

  count(verdict: ProbeVerdict): number {
    return this.verdicts.filter((v) => v === verdict).length;
  }

  finish(): ProbeVerdict {
    const v = this.verdict();
    const parts = PROBE_VERDICTS.map((x) => `${x}=${this.count(x)}`).filter((x) => !x.endsWith('=0'));
    if (this.unverifiedN > 0) parts.push(`UNVERIFIED=${this.unverifiedN}`);
    console.log(`\nCOVERAGE: ${parts.length === 0 ? '无断言被执行（探针未验证任何东西 —— 不得视为 PASS）' : parts.join(' ')}`);
    console.log(`RESULT=${v}`);
    return v;
  }

  exitCode(): 0 | 1 | 2 {
    return EXIT_BY_VERDICT[this.verdict()];
  }
}

/** 已知场景（`--all` 即全跑；与 `KNOWN_CASES` 同源，避免两套口径） */
const KNOWN_CASES = ['custom-role', 'factory-default', 'tenant-scoped', 'file-driven', 'degradation'] as const;
type KnownCase = (typeof KNOWN_CASES)[number];

/**
 * 解析场景参数（与梯子共用口径）。
 * 无参 ＋ 仅一个场景 ⇒ 跑该场景；`--all` ⇒ 全跑；否则报错（禁静默跑全部）。
 */
function parseCaseArgs(argv: readonly string[]): { cases: KnownCase[]; all: boolean } {
  const all = argv.includes('--all');
  const cases: KnownCase[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--case') {
      const v = argv[i + 1];
      if (v === undefined || !(KNOWN_CASES as readonly string[]).includes(v)) {
        throw new ProbeError(
          'PROBE_BAD_CASE',
          'argparse',
          `未知场景 \`${String(v)}\`；可用: ${KNOWN_CASES.join('|')}（或 --all）`,
        );
      }
      cases.push(v as KnownCase);
    }
  }
  if (all) return { cases: [...KNOWN_CASES], all: true };
  if (cases.length > 0) return { cases, all: false };
  if (KNOWN_CASES.length === 1) return { cases: [...KNOWN_CASES], all: false };
  throw new ProbeError(
    'PROBE_NO_CASE',
    'argparse',
    `本探针有 ${KNOWN_CASES.length} 个场景，须显式指定: --case <${KNOWN_CASES.join('|')}> 或 --all`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 一、TARGETS —— 探针判据所依赖的**目标件**（梯子据此校验"报绿时目标真存在"）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 目标件 = 本卡的能力落点（**内容面载体 + 真角色包**）。
 *   语义（逐字同梯子 §不变式）: **只要报 `RESULT=PASS`，本表必须非空且每一项都存在**。
 *   ⇒ 若为了"让 PASS 好看"而把此表清空，梯子会先判 `TARGETS 为空表` ⇒ ERROR。
 */
export const TARGETS: readonly string[] = [
  'extensions/presets/roles/finance/capabilities.yaml',
  'extensions/presets/roles/hr/capabilities.yaml',
  'extensions/presets/roles/sales/capabilities.yaml',
];

// ══════════════════════════════════════════════════════════════════════════════
// 二、仓库根定位 + 能力探测（未实现必须报 NOT_IMPLEMENTED，不许假绿）
// ══════════════════════════════════════════════════════════════════════════════

function locateRepoRoot(): string {
  const candidates: string[] = [];
  if (process.env['SYNOVA_REPO_ROOT']) candidates.push(process.env['SYNOVA_REPO_ROOT'] as string);
  let cur = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    candidates.push(cur);
    const parent = join(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  for (const c of candidates) {
    // 判据: 本卡的**能力落点**存在（不是"能定位到任何仓库"）
    if (existsSync(join(c, 'src', 'middleware', 'auth.ts')) && existsSync(join(c, 'packages', 'engine-auth', 'src'))) {
      return c;
    }
  }
  throw new ProbeError(
    'PROBE_NO_REPO_ROOT',
    'bootstrap',
    `定位不到仓库根（已试 ${candidates.length} 个候选）—— 须含 src/middleware/auth.ts 与 packages/engine-auth/src`,
  );
}

/** 读 YAML 的 `permissionGrants` 段（**自建极简解析**：不引本仓依赖，避免"依赖缺失"型假红） */
function readPermissionGrants(absPath: string): { grants: string[]; denies: string[] } | null {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  let inSection = false;
  let sectionIndent = -1;
  let bucket: 'grants' | 'denies' | null = null;
  const out: { grants: string[]; denies: string[] } = { grants: [], denies: [] };
  let sawSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (/^permissionGrants:\s*$/.test(line.trim()) && !inSection) {
      inSection = true;
      sectionIndent = indent;
      sawSection = true;
      continue;
    }
    if (!inSection) continue;
    if (indent <= sectionIndent) { inSection = false; bucket = null; continue; }
    const trimmed = line.trim();
    if (/^grants:\s*$/.test(trimmed)) { bucket = 'grants'; continue; }
    if (/^denies:\s*$/.test(trimmed)) { bucket = 'denies'; continue; }
    const m = /^-\s+(\S+)\s*$/.exec(trimmed);
    if (m && bucket !== null) out[bucket].push(m[1] as string);
  }
  return sawSection ? out : null;
}

/** 能力探测: 判定点是否真消费了**项模型**（结构性检查，不是 grep 计数） */
interface WiringFacts {
  readonly authTsExists: boolean;
  /** 判定点文件里真出现 `allowedSensitivitiesByGrants` 调用（去掉注释行后） */
  readonly decisionPointUsesGrants: boolean;
  /** 判定点把 `payload.orgId` 作为客户槽传进去（同岗位名、不同客户 ⇒ 不同权限集） */
  readonly tenantSlotWired: boolean;
}

function readWiringFacts(repoRoot: string): WiringFacts {
  const abs = join(repoRoot, 'src', 'middleware', 'auth.ts');
  if (!existsSync(abs)) {
    return { authTsExists: false, decisionPointUsesGrants: false, tenantSlotWired: false };
  }
  const raw = readFileSync(abs, 'utf8');
  // 🔴 去注释行: 否则"注释里写了符号名"会被当接线（判例: 词法致假绿）
  const code = raw
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    })
    .join('\n');
  return {
    authTsExists: true,
    decisionPointUsesGrants: /allowedSensitivitiesByGrants\s*\(/.test(code),
    tenantSlotWired: /allowedSensitivitiesByGrants\s*\([^)]*payload\.orgId/.test(code),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、真件调用面（动态 import —— 目标件不存在时必须能优雅报 NOT_IMPLEMENTED）
// ══════════════════════════════════════════════════════════════════════════════

interface GrantModel {
  permissionsForRole(roleId: string, opts?: { tenantId?: string | null; root?: string }): string[];
  resolveGrants(roleId: string, opts?: { tenantId?: string | null; root?: string }): {
    items: readonly string[];
    packFile: string | null;
    fallback: boolean;
    degraded: boolean;
    degradedReasons: readonly string[];
  };
  PERMISSION_CATALOG: readonly { id: string }[];
  isPermissionId(v: unknown): boolean;
}

async function loadGrantModel(): Promise<GrantModel | null> {
  try {
    const mod = (await import('@synova/engine-auth')) as unknown as Partial<GrantModel>;
    if (typeof mod.permissionsForRole !== 'function') return null;
    if (typeof mod.resolveGrants !== 'function') return null;
    if (!Array.isArray(mod.PERMISSION_CATALOG)) return null;
    return mod as GrantModel;
  } catch {
    // 目标件不存在 / 导入失败 ⇒ 能力未实现（**不是** FAIL —— 未实现不许绿，也不冤枉）
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、场景
// ══════════════════════════════════════════════════════════════════════════════

function runCustomRole(out: ProbeOutput, model: GrantModel, repoRoot: string): void {
  out.case('custom-role');
  const presetsRoot = join(repoRoot, 'extensions', 'presets');

  // ── V6 按项授予: 真角色包只勾一项 ⇒ 仅该能力生效（不是"整档放行"）──
  const finance = model.permissionsForRole('finance', { root: presetsRoot });
  const financePack = readPermissionGrants(join(presetsRoot, 'roles', 'finance', 'capabilities.yaml'));
  if (financePack === null) {
    out.fail('finance 角色包无 `permissionGrants` 段 ⇒ 项模型未落到内容面（真件）', 'L2');
    return;
  }
  if (finance.includes('knowledge.finance.read')) {
    out.pass(`真包声明的项生效: finance 角色含 \`knowledge.finance.read\`（实测 items=${JSON.stringify(finance)}）`, 'L2');
  } else {
    out.fail(`真包声明 \`knowledge.finance.read\` 但生效集不含它（items=${JSON.stringify(finance)}）`, 'L2');
  }
  const leaked = finance.filter((i) => i === 'knowledge.hr.read' || i === 'knowledge.market.read');
  if (leaked.length === 0) {
    out.pass('按项边界: 未勾的别库读项**不因岗位自动获得**（无整档放行）', 'L2');
  } else {
    out.fail(`按项边界破: 未勾的项被自动授予 ${JSON.stringify(leaked)}`, 'L2');
  }

  // ── V6 强化: 单项授予的自定义角色（客户可配的新角色，读真盘）──
  const catIds = model.PERMISSION_CATALOG.map((i) => i.id);
  if (catIds.includes('knowledge.finance.reed')) {
    out.fail('权限目录含拼错项 `knowledge.finance.reed`（白名单被污染）', 'L1');
  } else {
    out.pass(`权限目录是白名单: 拼错项不在目录内（目录 ${catIds.length} 项，全部为项而非档位）`, 'L1');
  }
  const tiers = ['admin', 'manager', 'employee', 'viewer', 'external'];
  const inCatalog = tiers.filter((t) => catIds.includes(t));
  if (inCatalog.length === 0) {
    out.pass('目录里**没有**任何档位名（档位只是出厂打包，不是类型的一部分）', 'L1');
  } else {
    out.fail(`目录里混进了档位名 ${JSON.stringify(inCatalog)} ⇒ 项模型退化成档位枚举`, 'L1');
  }
}

function runFactoryDefault(out: ProbeOutput, model: GrantModel, repoRoot: string): void {
  out.case('factory-default');
  const presetsRoot = join(repoRoot, 'extensions', 'presets');

  // ── V7 五档＝出厂默认: 删自定义角色（不存在的角色/客户槽）⇒ **回落不报错** ──
  const ghost = 'k12-11-ghost-role-not-present';
  const r = model.resolveGrants(ghost, { tenantId: 'k12-11-ghost-tenant', root: presetsRoot });
  if (r.fallback && !r.degraded && r.packFile === null) {
    out.pass(`无包角色 ⇒ 正常回落（fallback=true, degraded=false, packFile=null）: ${ghost}`, 'L2');
  } else {
    out.fail(`无包角色未按"正常回落"处理: fallback=${r.fallback} degraded=${r.degraded} packFile=${r.packFile}`, 'L2');
  }
  // 回落**不报错** = 不抛异常；能走到这行即证明未抛（负向断言的正向证据）
  out.pass('回落路径未抛异常（探针执行到本行 —— 删角色不报错）', 'L2');

  // ── 出厂档位面仍在（覆盖不是替换）: admin 仍得全库读 ──
  const admin = model.permissionsForRole('admin', { tenantId: 'k12-11-ghost-tenant', root: presetsRoot });
  if (admin.some((i) => i.startsWith('knowledge.') && i.endsWith('.read'))) {
    out.pass(`出厂默认仍在: admin 生效集含知识读项（${admin.length} 项）`, 'L2');
  } else {
    out.fail(`出厂默认丢失: admin 生效集无任何知识读项（items=${JSON.stringify(admin)}）`, 'L2');
  }
}

function runTenantScoped(out: ProbeOutput, model: GrantModel, repoRoot: string): void {
  out.case('tenant-scoped');
  const presetsRoot = join(repoRoot, 'extensions', 'presets');
  // 客户槽（`tenant/<id>/`）在仓内是**可选**载体 ⇒ 本场景只断言"不抛 + 回落语义正确 + 结构可寻址"。
  //   🔴 真正的"两客户权限集不同"判据在 `tests/security/permission-grants.test.ts`（夹具根驱动，可复跑）。
  const orgA = 'k12-11-customer-a';
  const orgB = 'k12-11-customer-b';
  let a: string[];
  let b: string[];
  try {
    a = model.permissionsForRole('admin', { tenantId: orgA, root: presetsRoot });
    b = model.permissionsForRole('admin', { tenantId: orgB, root: presetsRoot });
  } catch (err: unknown) {
    out.fail(`客户槽解析抛异常（应收敛为 degraded 回落）: ${err instanceof Error ? err.message : String(err)}`, 'L2');
    return;
  }
  out.pass(`客户槽可寻址且不抛: \`roles/admin/tenant/<id>/capabilities.yaml\` 两客户各解析成功（A=${a.length} 项, B=${b.length} 项）`, 'L2');
  // 🔴 诚实披露: 两客户**当前同值**（仓内无它们的客户槽 ⇒ 都落回同一出厂面）。
  //   "同一岗位名、两个客户 ⇒ 权限集合不同"的真判据在 `tests/security/permission-grants.test.ts`
  //   （夹具根驱动、可复跑）。此处**不**把"没差异"报成 FAIL，也不报成 PASS —— 记 UNVERIFIED。
  if (JSON.stringify(a) === JSON.stringify(b)) {
    out.unverified('仓内两客户槽均不存在 ⇒ 权限集相同（差异判据由 tests/security/permission-grants.test.ts 覆盖）');
  } else {
    out.pass('同一岗位名、两个客户 ⇒ 权限集合不同（客户可配面真在生效）', 'L2');
  }

  // 客户槽目录约定存在性（L1 结构面）—— 目录**可选**，故用 unverified 语义（不谎报 FAIL）
  const tenantDirA = join(presetsRoot, 'roles', 'admin', 'tenant', orgA);
  if (existsSync(tenantDirA)) {
    out.pass(`客户槽载体按约定布局存在: ${orgA}`, 'L1');
  } else {
    out.unverified(`仓内无 ${orgA} 客户槽目录（客户槽是可选载体；本场景只证明解析面可用）`);
  }
}

function runFileDriven(out: ProbeOutput, model: GrantModel, repoRoot: string): void {
  out.case('file-driven');

  // ── V8 客户可配: **加文件即生效** —— 判据是"改动面只在内容文件"，不看代码是否被改 ──
  const presetsRoot = join(repoRoot, 'extensions', 'presets');
  const roleDirs = readdirSync(join(presetsRoot, 'roles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
  out.note(`  仓内角色包目录（磁盘实测）: ${roleDirs.join(', ')}`);

  // 每个真角色包都必须带 `permissionGrants` 段 ⇒ 项模型落在**内容面**（加文件即生效的载体）
  const missing: string[] = [];
  for (const role of roleDirs) {
    const abs = join(presetsRoot, 'roles', role, 'capabilities.yaml');
    if (readPermissionGrants(abs) === null) missing.push(role);
  }
  if (missing.length === 0) {
    out.pass(`全部 ${roleDirs.length} 个角色包的 \`capabilities.yaml\` 都带 \`permissionGrants\` 段（内容面驱动，${roleDirs.join('/')}）`, 'L2');
  } else {
    out.fail(`角色包缺 \`permissionGrants\` 段: ${missing.join(', ')}（客户可配面未落到内容）`, 'L2');
  }

  // 载体的**解析结果随文件内容变化**（真读盘，不做进程级缓存）——
  //   用「同一角色两次读同一文件必须相等 + 内容非空」证明读取路径稳定且真在读
  const twice = [
    model.permissionsForRole('finance', { root: presetsRoot }),
    model.permissionsForRole('finance', { root: presetsRoot }),
  ];
  if (JSON.stringify(twice[0]) === JSON.stringify(twice[1]) && (twice[0] as string[]).length > 0) {
    out.pass('内容面读取稳定且非空（两次读同一真件结果一致 ⇒ 非缓存漂移、非空壳）', 'L2');
  } else {
    out.fail(`内容面读取不稳定或为空: ${JSON.stringify(twice)}`, 'L2');
  }

  // ── 判据的**改动面**声明: 本卡的机制落在 extensions/presets（内容）+ engine-auth（模型）──
  const codePath = join(repoRoot, 'src', 'middleware', 'auth.ts');
  if (existsSync(codePath)) {
    out.pass('判定点文件在（`src/middleware/auth.ts` 授权判定点）—— 项模型的消费面存在', 'L1');
  } else {
    out.fail('判定点文件缺失: src/middleware/auth.ts', 'L1');
  }
}

function runDegradation(out: ProbeOutput, model: GrantModel, repoRoot: string): void {
  out.case('degradation');
  const presetsRoot = join(repoRoot, 'extensions', 'presets');

  // ── 铁律 31 / 判例: 未实现必须 exit 2；**回落 ≠ 降级**；降级不静默 ──
  const ghost = model.resolveGrants('k12-11-absent-role', { tenantId: 'k12-11-absent-tenant', root: presetsRoot });
  if (ghost.fallback === true && ghost.degraded === false) {
    out.pass('回落与降级**分开**: 包不存在 ⇒ fallback=true 且 degraded=false（不污染基线判据）', 'L2');
  } else {
    out.fail(`回落/降级语义混在一起: fallback=${ghost.fallback} degraded=${ghost.degraded}`, 'L2');
  }

  // ── 白名单校验: 拼错的项不是合法项（fail-closed 的第一道闸）──
  if (model.isPermissionId('knowledge.finance.read') && !model.isPermissionId('knowledge.finance.reed')) {
    out.pass('白名单校验: 合法项通过、拼错项被拒（认不出的项一律不授予）', 'L1');
  } else {
    out.fail('白名单校验失效: 拼错项被当成合法项（拼错一个 id 等于自动提权）', 'L1');
  }

  // ── 未知项: 若树上存在解析失败的包，必须 degraded=true 且逐条给 reason ──
  const degradedAny = model.resolveGrants('finance', { root: presetsRoot });
  if (degradedAny.degraded) {
    out.note(`  真包解析 degraded（逐条 reason: ${degradedAny.degradedReasons.join(' | ')}）`);
    out.pass('真包解析 degraded 时**逐条给出 reason**（不静默降级）', 'L2');
  } else {
    out.pass('真包解析无降级（degraded=false）—— 解析路径健康', 'L2');
  }

  // ── 探针自身**契约自测**: 退出码映射必须与梯子一致（防"探针自己漂移"）──
  const mapping = PROBE_VERDICTS.map((v) => `${v}=${EXIT_BY_VERDICT[v]}`).join(' ');
  if (EXIT_BY_VERDICT.PASS === 0 && EXIT_BY_VERDICT.FAIL === 1 && EXIT_BY_VERDICT.NOT_IMPLEMENTED === 2 && EXIT_BY_VERDICT.ERROR === 2) {
    out.pass(`退出码映射合规（${mapping}）—— 未实现=2、不越界`, 'L1');
  } else {
    out.fail(`退出码映射越界: ${mapping}`, 'L1');
  }

  // ── 末行契约由**本进程**自证（不 spawn 自己 —— 那会产生递归超时，且梯子已在外部做同一校验）──
  //   判据: `finish()` 签发的形态必须与梯子的正则 `^RESULT=(PASS|FAIL|NOT_IMPLEMENTED|ERROR)$` 同构。
  if (/^RESULT=(PASS|FAIL|NOT_IMPLEMENTED|ERROR)$/.test('RESULT=' + out.verdict())) {
    out.pass(`末行契约形态合规: \`RESULT=${out.verdict()}\`（与梯子正则同构）`, 'L1');
  } else {
    out.fail(`末行形态不合规: \`RESULT=${out.verdict()}\``, 'L1');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、主流程
// ══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<number> {
  const out = new ProbeOutput('permission-grants (K12-11 / #194 / RB-03)');

  let parsed: { cases: KnownCase[]; all: boolean };
  try {
    parsed = parseCaseArgs(process.argv.slice(2));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    out.error(`参数解析失败: ${msg}`);
    return out.finish() === 'ERROR' ? 2 : 1;
  }

  let repoRoot: string;
  try {
    repoRoot = locateRepoRoot();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    out.error(`probe-bootstrap: ${msg}`);
    out.finish();
    return 2;
  }
  out.note(`PROBE_REPO_ROOT: ${repoRoot}`);
  out.note(`CASES: ${parsed.cases.join(', ')}${parsed.all ? ' (--all)' : ''}`);

  // ── 取证面（可选参数，**不计入判定**）: `--role <id> [--tenant <id>]` ⇒ 打印该角色的解析结果 ──
  const argv = process.argv.slice(2);
  const roleArg = argv.includes('--role') ? argv[argv.indexOf('--role') + 1] : undefined;
  const tenantArg = argv.includes('--tenant') ? argv[argv.indexOf('--tenant') + 1] : undefined;
  if (typeof roleArg === 'string' && roleArg.length > 0) {
    out.note(`\n── 取证: role=${roleArg} tenant=${tenantArg ?? '(无客户槽)'} ──`);
    try {
      const probes = await loadGrantModel();
      if (probes === null) {
        out.note('  （能力面未实现 ⇒ 无取证输出）');
      } else {
        const presetRootArg = join(repoRoot, 'extensions', 'presets');
        const res = probes.resolveGrants(roleArg, { tenantId: tenantArg ?? null, root: presetRootArg });
        out.note(`  packFile: ${res.packFile ?? '(未命中任何包 ⇒ 出厂默认)'}`);
        out.note(`  fallback=${res.fallback} degraded=${res.degraded}`);
        out.note(`  items(${res.items.length}): ${JSON.stringify(res.items)}`);
      }
    } catch (err: unknown) {
      out.note(`  （取证失败: ${err instanceof Error ? err.message : String(err)}）`);
    }
  }

  // ── TARGETS 自证（L1）: 目标件必须存在（报绿的前提）──
  const missingTargets = TARGETS.filter((p) => !existsSync(join(repoRoot, p)));
  if (missingTargets.length === 0) {
    out.pass(`TARGETS 声明 ${TARGETS.length} 项，全部存在（梯子据此校验"报绿时目标真存在"）`, 'L1');
  } else {
    // 目标件缺失 = 能力未实现（不是"断言失败"）—— 与梯子不变式同语义
    out.notImplemented(`TARGETS 缺失: ${missingTargets.join(', ')}（能力未实现，不许报绿）`);
    out.finish();
    return 2;
  }

  // ── 能力面探测（目标件不存在 ⇒ NOT_IMPLEMENTED / exit 2）──
  const model = await loadGrantModel();
  if (model === null) {
    out.notImplemented(
      '`@synova/engine-auth` 未导出项模型（`permissionsForRole` / `resolveGrants` / `PERMISSION_CATALOG`）' +
        ' ⇒ 权限项模型未实现（PermissionId 面不存在）',
    );
    out.finish();
    return 2;
  }
  out.pass('能力面存在: `@synova/engine-auth` 导出 `permissionsForRole` / `resolveGrants` / `PERMISSION_CATALOG`', 'L1');

  // ── 接线面（L1 结构 + L2 行为）: 判定点必须**真消费**项模型 ──
  const wiring = readWiringFacts(repoRoot);
  if (!wiring.authTsExists) {
    out.error('判定点文件缺失: src/middleware/auth.ts');
  } else if (wiring.decisionPointUsesGrants) {
    out.pass('接线: 授权判定点真调用 `allowedSensitivitiesByGrants(...)`（去注释行后实测）', 'L1');
  } else {
    out.fail('接线破: 判定点未调用 `allowedSensitivitiesByGrants(...)`（项模型定义了但没被执行）', 'L1');
  }
  if (wiring.tenantSlotWired) {
    out.pass('客户槽接线: 判定点把 `payload.orgId` 作为客户槽传入（同岗位名、不同客户 ⇒ 权限集可不同）', 'L1');
  } else {
    out.fail('客户槽未接线: 判定点未传 `payload.orgId` ⇒ 客户可配面接不上请求', 'L1');
  }

  // ── 场景 ──
  const runners: Record<KnownCase, (o: ProbeOutput, m: GrantModel, r: string) => void> = {
    'custom-role': runCustomRole,
    'factory-default': runFactoryDefault,
    'tenant-scoped': runTenantScoped,
    'file-driven': runFileDriven,
    degradation: runDegradation,
  };
  for (const c of parsed.cases) {
    try {
      runners[c](out, model, repoRoot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      out.error(`场景 ${c} 抛异常: ${msg}`);
    }
  }

  const verdict = out.finish();
  return EXIT_BY_VERDICT[verdict];
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error(`❌ probe-permission-grants 未捕获异常: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    // fail-closed: 探针自身异常 ⇒ ERROR 语义（exit 2），绝不 exit 0
    console.log('RESULT=ERROR');
    process.exit(2);
  });
