#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-role-config.ts — K12-12（#195）客户自定义权限矩阵探针
 *
 * 🔴 #505 判 A（2026-11-02 创始人 14 项批准）：**探针靶归一** —— 矩阵的真实落点不是
 *   旧 `presets/grants` 目录（从未存在），而是**角色包实物**：
 *   `extensions/presets/roles/<roleId>/{tenant/<tenantId>/}capabilities.yaml` 的 `permissionGrants` 段
 *   （#468 决策 Note 第 4 条；引擎侧 `packages/engine-auth/src/permission-grants.ts` 真消费）。
 *   ⇒ 本探针靶改角色包；断言仍覆盖卡面 #195 §Q3 的 V1–V6（语义随落点归一，逐条标注 L1/L2）。
 *
 * 契约（铁律 47）:
 *   @input    — `--case customer-defined|fail-closed`｜`--all`
 *   @output   — 逐条 `✅ PASS` / `❌ FAIL` / `⚠️ UNVERIFIED`＋末行 `RESULT=<verdict>`（探针契约单一实现见 probe-ladder）
 *   @degraded — 角色包/permissionGrants/引擎缺失 ⇒ cannotJudge（UNVERIFIED＋NOT_IMPLEMENTED ⇒ exit 2，不许假绿）
 * 退出码: 0 = 全部 PASS ｜ 1 = 有 FAIL ｜ 2 = 目标能力未实现/无法判定
 *
 * 边界: 只读仓库；V4/V5 的"客户可改"只在 `mkdtemp` 临时副本上改写，仓库零写痕。
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

/** 场景集（卡面判据命令 `--case customer-defined`） */
export const KNOWN_CASES: readonly string[] = ['customer-defined', 'fail-closed'] as const;

const ROLES: readonly string[] = ['finance', 'hr', 'sales'];
const PRESETS_REL = 'extensions/presets';
const ENGINE_FILE = 'src/middleware/auth.ts';
const ONBOARDING_GEN = 'src/onboarding/config-pack-generator.ts';
const ONBOARDING_ROUTE = 'src/routes/onboarding.ts';
const roleCap = (role: string): string => `${PRESETS_REL}/roles/${role}/capabilities.yaml`;

/** 本探针报 PASS 时必然存在的目标件（ladder 不变式据此判"报绿时目标真存在"） */
// 🔴 ladder 以**源文本正则**解析本数组 ⇒ 必须是字面量引号数组（禁 map/常量拼接，见 probe-content-exile 同注）。
export const TARGETS: readonly string[] = [
  'extensions/presets/roles/finance/capabilities.yaml',
  'extensions/presets/roles/hr/capabilities.yaml',
  'extensions/presets/roles/sales/capabilities.yaml',
  'src/middleware/auth.ts',
  'src/onboarding/config-pack-generator.ts',
  'src/routes/onboarding.ts',
];

/** 存在性闸：矩阵落点（角色包 capabilities.yaml × 3） */
const GATE_TARGETS: readonly string[] = ROLES.map(roleCap);

const V_ITEMS: ReadonlyArray<{ id: string; text: string }> = [
  { id: 'V1', text: '矩阵真加载：三个角色包的 permissionGrants 段在场且 grants 非空' },
  { id: 'V2', text: 'fail-closed：矩阵没写的权限 ⇒ 默认拒绝（未知项不入权限集）' },
  { id: 'V3', text: '超管确认留痕（谁/何时/确认哪几条；出厂=代码锚，记录可覆盖客户角色）' },
  { id: 'V4', text: '客户可改：改临时副本的角色包 ⇒ 引擎权限随之变；仓库 src 零改动' },
  { id: 'V5', text: '反例：去掉 permissionGrants ⇒ 权限集变（若不变=配置未被消费=fail-open）' },
  { id: 'V6', text: '与建档联通：K12-03 生成器写角色包 capabilities.yaml 且保留 permissionGrants' },
];

function contractShapeOk(mod: ProbeModule): boolean {
  return Array.isArray(mod.KNOWN_CASES) && mod.KNOWN_CASES.length > 0 && typeof mod.main === 'function';
}

function cannotJudge(out: ProbeOutput, id: string, reason: string): void {
  out.unverified(`${id} 无法核实: ${reason}`);
  out.notImplemented(`${id} 判据不可判定（fail-closed ⇒ exit 2，不许假绿）`);
}

interface GrantModel {
  permissionsForRole(roleId: string, opts?: { tenantId?: string | null; root?: string }): string[];
}

async function loadEngine(): Promise<GrantModel | null> {
  try {
    const mod = (await import('@synova/engine-auth')) as Record<string, unknown>;
    const fn = mod['permissionsForRole'];
    if (typeof fn !== 'function') return null;
    return { permissionsForRole: fn as GrantModel['permissionsForRole'] };
  } catch { // 引擎包不可用 ⇒ 返回 null，由调用方 cannotJudge（显式降级，非静默）
    return null;
  }
}

/** 解析 `permissionGrants:` 块 → { grants, denies }（只认顶层键；其余键忽略） */
function parseGrants(text: string): { grants: string[]; denies: string[] } {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^permissionGrants\s*:/.test(line));
  if (start < 0) return { grants: [], denies: [] };
  const out = { grants: [] as string[], denies: [] as string[] };
  let section: 'grants' | 'denies' | null = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.length > 0 && !/^\s/.test(line) && !line.startsWith('#')) break;
    const sec = /^\s+(grants|denies)\s*:\s*$/.exec(line);
    if (sec !== null) {
      section = sec[1] as 'grants' | 'denies';
      continue;
    }
    const item = /^\s+-\s+([A-Za-z0-9._-]+)\s*$/.exec(line);
    if (item !== null && section !== null) out[section].push(item[1] as string);
  }
  return out;
}

/** 临时副本（presets 全量拷贝；V4/V5 只改副本） */
function copyPresets(root: string): { tmp: string; presets: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'probe-role-config-'));
  cpSync(join(root, PRESETS_REL), join(tmp, 'presets'), { recursive: true });
  return { tmp, presets: join(tmp, 'presets') };
}

/** V1：落点矩阵真加载（文件驱动） */
function checkLanding(root: string, out: ProbeOutput): void {
  const missing: string[] = [];
  const empty: string[] = [];
  for (const role of ROLES) {
    const rel = roleCap(role);
    if (!existsSync(join(root, rel))) {
      missing.push(rel);
      continue;
    }
    const parsed = parseGrants(readFileSync(join(root, rel), 'utf-8'));
    if (parsed.grants.length === 0) empty.push(rel);
  }
  if (missing.length > 0) {
    cannotJudge(out, 'V1', `角色包缺失: ${missing.join(', ')}`);
    return;
  }
  if (empty.length > 0) {
    out.fail(`V1 矩阵落点在但 grants 为空: ${empty.join(', ')}`, 'L1');
    return;
  }
  out.pass(`V1 矩阵真加载：${ROLES.length} 个角色包 permissionGrants.grants 非空（文件驱动）`, 'L1');
}

/** V2：fail-closed（未知权限项不入权限集） */
function checkFailClosed(root: string, out: ProbeOutput, engine: GrantModel): void {
  const { tmp, presets } = copyPresets(root);
  try {
    const tenantDir = join(presets, 'roles/finance/tenant/probe-tenant');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(
      join(tenantDir, 'capabilities.yaml'),
      'roleId: finance\nversion: 2.0.0\ncapabilities:\n  - id: capability.probe\n    label: probe\n    enabled: true\n' +
        'permissionGrants:\n  grants:\n    - knowledge.finance.read\n    - knowledge.does.not.exist\n  denies: []\n',
      'utf-8',
    );
    const perms = engine.permissionsForRole('finance', { root: presets, tenantId: 'probe-tenant' });
    const hasKnown = perms.includes('knowledge.finance.read');
    const hasUnknown = perms.includes('knowledge.does.not.exist');
    if (hasKnown && !hasUnknown) {
      out.pass('V2 fail-closed：未知权限项 knowledge.does.not.exist 未被授予（目录白名单生效）', 'L2');
    } else {
      out.fail(`V2 fail-closed 破：hasKnown=${String(hasKnown)} hasUnknown=${String(hasUnknown)}（未知项被授予=fail-open）`, 'L2');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** V3：审批留痕（出厂=代码锚；role-pack-approval 真实现） */
async function checkApprovalTrace(root: string, out: ProbeOutput): Promise<void> {
  try {
    const abs = join(root, 'src/init/preset-loader.ts');
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    const load = mod['loadRolePacks'];
    if (typeof load !== 'function') {
      cannotJudge(out, 'V3', 'preset-loader 未导出 loadRolePacks');
      return;
    }
    const saved = process.env['SYNOVA_PRESETS_ROOT'];
    process.env['SYNOVA_PRESETS_ROOT'] = join(root, PRESETS_REL);
    try {
      const report = (load as () => { roles: Array<{ roleId: string; approval: { status: string; approvalId?: string; scope?: string } }> })();
      const approved = report.roles.filter((r) => r.approval.status === 'approved' && (r.approval.approvalId ?? '').startsWith('factory:'));
      const approvalSrc = readFileSync(join(root, 'src/init/role-pack-approval.ts'), 'utf-8');
      const hasWhen = /approvedAt/.test(approvalSrc);
      if (approved.length === ROLES.length && hasWhen) {
        out.pass(`V3 审批留痕：${String(approved.length)} 个出厂角色 approvalId=factory:*／scope 可读；approvedAt 常量在场`, 'L1');
      } else {
        out.fail(`V3 审批留痕不足：approved=${String(approved.length)}/${String(ROLES.length)} hasWhen=${String(hasWhen)}`, 'L1');
      }
    } finally {
      if (saved === undefined) delete process.env['SYNOVA_PRESETS_ROOT'];
      else process.env['SYNOVA_PRESETS_ROOT'] = saved;
    }
  } catch (err: unknown) {
    cannotJudge(out, 'V3', `装载器/审批件读取失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 在临时副本的 finance 包 grants 末尾插入一项（V4 用） */
function addGrant(capPath: string, item: string): void {
  const text = readFileSync(capPath, 'utf-8');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^permissionGrants\s*:/.test(line));
  const grantsAt = lines.findIndex((line, i) => i > start && /^\s+grants\s*:\s*$/.test(line));
  if (start < 0 || grantsAt < 0) throw new ProbeError('GRANTS_SECTION_MISSING', 'v4', capPath);
  lines.splice(grantsAt + 1, 0, `    - ${item}`);
  writeFileSync(capPath, lines.join('\n'), 'utf-8');
}

/** V4：客户可改（临时副本改写 ⇒ 引擎权限变；仓库零写痕） */
function checkCustomerEditable(root: string, out: ProbeOutput, engine: GrantModel): void {
  const { tmp, presets } = copyPresets(root);
  try {
    const capPath = join(presets, 'roles/finance/capabilities.yaml');
    const before = engine.permissionsForRole('finance', { root: presets });
    addGrant(capPath, 'knowledge.people.read');
    const after = engine.permissionsForRole('finance', { root: presets });
    const changed = after.includes('knowledge.people.read') && !before.includes('knowledge.people.read');
    if (changed) {
      out.pass('V4 客户可改：临时副本加 knowledge.people.read ⇒ 引擎权限集随之变化', 'L2');
    } else {
      out.fail('V4 客户可改破：改角色包后引擎权限集未变（配置未被消费）', 'L2');
    }
    const dirty = readFileSync(join(root, roleCap('finance')), 'utf-8');
    if (dirty.includes('knowledge.people.read')) out.fail('V4 仓库角色包被改写（探针写痕残留）', 'L1');
    else out.pass('V4 仓库零写痕（改动只在 mkdtemp 副本）', 'L1');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** V5：反例（去掉 permissionGrants ⇒ 权限集变；不变=fail-open） */
function checkFailOpenCounterexample(root: string, out: ProbeOutput, engine: GrantModel): void {
  const { tmp, presets } = copyPresets(root);
  try {
    const capPath = join(presets, 'roles/finance/capabilities.yaml');
    const before = engine.permissionsForRole('finance', { root: presets });
    const text = readFileSync(capPath, 'utf-8');
    const idx = text.search(/^permissionGrants\s*:/m);
    const stripped = idx < 0 ? text : text.slice(0, idx).replace(/\s+$/, '') + '\n';
    writeFileSync(capPath, stripped, 'utf-8');
    const after = engine.permissionsForRole('finance', { root: presets });
    const lost = before.filter((p) => !after.includes(p));
    if (lost.length > 0) {
      out.pass(`V5 反例可判：去掉 permissionGrants ⇒ 权限集少 ${String(lost.length)} 项（配置真被消费；若不变即 fail-open）`, 'L2');
    } else {
      out.fail('V5 反例不可判：去掉 permissionGrants 后权限集不变 ⇒ 配置未被消费（fail-open 方向）', 'L2');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** V6：与建档联通（K12-03 生成器写角色包 capabilities.yaml 且保留 permissionGrants） */
function checkOnboardingLink(root: string, out: ProbeOutput): void {
  const genAbs = join(root, ONBOARDING_GEN);
  if (!existsSync(genAbs)) {
    cannotJudge(out, 'V6', `${ONBOARDING_GEN} 不存在（K12-03 未落地）`);
    return;
  }
  const src = readFileSync(genAbs, 'utf-8');
  const writesCapabilities = /capabilities\.yaml/.test(src);
  const writesUnderRoles = /PRESETS_DIR[\s\S]{0,200}?ROLES_SUBDIR|roles\//.test(src);
  if (writesCapabilities && writesUnderRoles) {
    out.pass(
      'V6 与建档联通：生成器写角色包 capabilities.yaml（落点=矩阵同一处，不另建通道）；' +
        'permissionGrants 保留由生成器配对测试覆盖（K12-ENG P2-2a）',
      'L1',
    );
  } else {
    out.fail(
      `V6 与建档联通破：writesCapabilities=${String(writesCapabilities)} writesUnderRoles=${String(writesUnderRoles)}`,
      'L1',
    );
  }
}

async function runCase(root: string, out: ProbeOutput): Promise<void> {
  const engine = await loadEngine();
  checkLanding(root, out);
  if (engine === null) {
    cannotJudge(out, 'V2', `引擎不可用（@synova/engine-auth 未导出 permissionsForRole）`);
    cannotJudge(out, 'V4', '同上（引擎不可用）');
    cannotJudge(out, 'V5', '同上（引擎不可用）');
  } else {
    checkFailClosed(root, out, engine);
    checkCustomerEditable(root, out, engine);
    checkFailOpenCounterexample(root, out, engine);
  }
  await checkApprovalTrace(root, out);
  checkOnboardingLink(root, out);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-role-config（K12-12 / #195 · 客户自定义权限矩阵）');
  try {
    if (!contractShapeOk({ KNOWN_CASES, main })) {
      out.error('探针契约形状自检失败（KNOWN_CASES 或 main 形状不符）');
      out.finish();
      return 2;
    }
    const root = locateRepoRoot();
    const args = parseProbeArgs(KNOWN_CASES, argv);
    out.note('判据来源: #195 → K12-12 §Q3（V1–V6）；#505 判 A（落点=角色包 permissionGrants）');
    out.note(`仓库根: ${root}`);
    out.note(`场景: ${args.all ? '--all' : args.cases.join(', ')}`);

    if (!assertTargetsExist(root, out, [...GATE_TARGETS])) {
      for (const item of V_ITEMS) out.notImplemented(`${item.id} ${item.text}`);
      out.finish();
      return out.exitCode();
    }
    for (const name of args.cases) {
      out.case(name);
      await runCase(root, out);
    }
    out.finish();
    return out.exitCode();
  } catch (err: unknown) {
    const pe =
      err instanceof ProbeError
        ? err
        : new ProbeError('PROBE_ROLE_CONFIG_UNEXPECTED', 'run', err instanceof Error ? err.message : String(err), true);
    console.error(`[ERROR] ${pe.code}@${pe.phase} retryable=${String(pe.retryable)}: ${pe.message}`);
    out.error(`${pe.code}@${pe.phase}: ${pe.message}`);
    out.finish();
    return 2;
  }
}

if (process.argv[1] && /probe-role-config\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
