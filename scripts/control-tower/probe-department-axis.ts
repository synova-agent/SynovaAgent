#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-department-axis.ts — K12-10 #193（RB-02）部门轴判据探针
 *
 * 判据来源: 卡面 `.claude/task-briefs/2026-10-11-193-*.md` §Q3 逐条:
 *   V1 `--case multi-dept` ⇒ exit 0
 *   V2 **复数**：一人属 2 部门 ⇒ 两部门可见范围**都生效**（**并集，非覆盖**）
 *   V3 **单一入口（核心）**：全仓解析路径只有一条
 *   V4 文件驱动：改部门定义文件 ⇒ 生效；`git diff` 不含 `src/`
 *   V5 反例（改坏必红）：绕开单一入口直接读身份 ⇒ V3 必红
 * 场景名逐字取自 ladder brief §场景取值表: `multi-dept`（卡面原文）｜`single-entry`
 *
 * 🔴 V3 的 grep → 行为断言改造（判例 V-02：**grep 型不得作验收依据**）:
 *   卡面原文写法是「grep 反证其它入口 = 0」。本探针**不这么做**，改为**两条行为断言**：
 *
 *   ① **身份探针（tripwire）行为观测** [L2]：探针构造一个**属性被仪表化**的身份对象
 *      （`departmentIds` / `departmentId` / `departments` 的 getter 记读取次数），
 *      然后 (a) 真调用**单一入口** `resolveContext(tripwire)`； (b) 把**同一个 tripwire** 交给
 *      该模块的**其余导出**（消费者面）真调用。
 *      不变式：**除单一入口外，没有任何导出在拿到原始身份时自行读部门字段**。
 *      有第二个读者 ⇒ 就是"绕开单一入口直接读身份" ⇒ FAIL（V5 必红）。
 *      探针先做**夹具自检**（拿一个本地读者证明 tripwire 真能计数）—— 夹具无效 ⇒ 报"无法判定"（V-08）。
 *
 *   ② **差分不变量** [L2]：真按 1 个/2 个/0 个部门解析，观测可见范围：
 *      并集（⊇ 各自单部门之并）、非覆盖、空部门 ⇒ 空部门范围。
 *      覆盖型实现（后者盖前者）与"默认给全量"型实现必判红。
 *
 *   grep 只保留为 **辅证**：显式标 `[L1-辅证，不参与判定]`，只用来说明"还有哪些文件碰了部门字段"，
 *   **不进入任何 verdict**（判例 V-02 逐字）。
 *
 * 🔴 自包含声明（2026-10-11，本件独立于 K12-21 探针梯子交付）:
 *   本件**不 import** `probe-ladder.ts` —— 该文件实测**不在 `local-main`**
 *   （它是 K12-21 #205 的交付物，见 PR #224）。为令本件可单独 `npx tsx` 直跑并入库，
 *   把梯子的共用件（`ProbeOutput` / `ProbeError` / `locateRepoRoot` / `parseProbeArgs`
 *   ／三态退出码映射）**逐字内联**在下方「零、内联共用件」段。
 *   内联面与梯子**接口同形**（`KNOWN_CASES` ＋ `main()` ＋ 末行 `RESULT=` ＋ 退出码 0/1/2）
 *   ⇒ K12-21 落地后既可切换回 `import`，也可继续用本自包含形态（子进程调用 = 进程隔离）。
 *   ⚠️ 梯子的其它件**不属本卡写集**，不入库（写集纪律：`probe-content-layering` 误入的前例见
 *   `b582f430d`）。
 *
 * 契约（铁律 47）:
 *   @input    — `--case multi-dept|single-entry` ｜ `--all`
 *   @output   — stdout 逐条 `✅ PASS / ❌ FAIL / ⚠️ 未实现 / ⚠️ UNVERIFIED / ❌ ERROR`，每条标 [L1] / [L2]；
 *               末行恒由 `ProbeOutput.finish()` 签发 `RESULT=PASS|FAIL|NOT_IMPLEMENTED|ERROR`
 *   @degraded — 目标件/符号缺失 ⇒ `⚠️ 未实现` ＋ exit 2；入口不可调用 / 部门定义取不到 /
 *               tripwire 未被消费（夹具不成立）⇒ `❌ ERROR` ＋ exit 2（fail-closed，铁律 31）
 * 退出码: 0 = 全部断言成立 ｜ 1 = 目标件在但断言不成立（**真红**）｜ 2 = 目标未实现 或 探针无法判定
 *
 * 🔴 边界与披露（如实标注）:
 *   ① 探针要求的契约面（入口导出名 / 入参形态 / 部门定义目录）**由本探针显式声明** ——
 *      卡面 §Q2 只给了载体路径 `src/services/request-context.ts` 与"extensions/ 同族"。
 *      未命中 ⇒ `NOT_IMPLEMENTED`（exit 2：符号缺失 = 能力未实现）。
 *   ② 行为断言 ① 有**前置条件**：单一入口须接受"身份对象"入参。若实现改成 (userId) 之类、
 *      tripwire 读不到 ⇒ 本探针**报 ERROR（exit 2）并说明原因**，**不以 grep 顶替**（判例 V-02）。
 *   ③ 自带直执行守卫 ⇒ 可单独 `npx tsx` 直跑（进程隔离）。
 */
import { existsSync, readdirSync, readFileSync, type Dirent } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

// ══════════════════════════════════════════════════════════════════════════════
// 零、内联共用件（与 K12-21 梯子 `probe-ladder.ts` **接口同形** —— 见文件头「自包含声明」）
// ══════════════════════════════════════════════════════════════════════════════

/** 三态判定（判例 M-02：0=通过／1=违规／2=无法判定） */
const PROBE_VERDICTS = ['PASS', 'FAIL', 'NOT_IMPLEMENTED', 'ERROR'] as const;
type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

/** verdict → 退出码（契约唯一映射，探针不得自定） */
const EXIT_BY_VERDICT: Readonly<Record<ProbeVerdict, 0 | 1 | 2>> = {
  PASS: 0,
  FAIL: 1,
  NOT_IMPLEMENTED: 2,
  ERROR: 2,
};

/** 运行期异常（探针内 catch 一律包装成它，铁律 32：.code ＋ .phase ＋ .retryable） */
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

/**
 * 逐条报告器 —— 探针唯一的输出通道（内联自梯子，语义逐字一致）。
 * 内部**只累加计数**，末行 `RESULT=` 由本类统一签发 ⇒ 各探针末行格式天然一致。
 */
class ProbeOutput {
  /** 每条断言的判定 —— `verdict()` 与覆盖计数的**唯一事实源** */
  readonly verdicts: ProbeVerdict[] = [];
  private unverifiedN = 0;

  constructor(label: string) {
    console.log(`PROBE ${label}`);
  }

  /** 无法核实条数（判例 V-09：显式披露，但不计入 PASS/FAIL） */
  unverifiedCount(): number {
    return this.unverifiedN;
  }

  /** 直通打印（横幅/场景标题用，**不算断言**） */
  note(line: string): void {
    console.log(line);
  }

  /** 场景标题 */
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

  /** 目标能力**未实现**（目标件不存在）—— 记 NOT_IMPLEMENTED，**不是** FAIL */
  notImplemented(text: string): void {
    this.verdicts.push('NOT_IMPLEMENTED');
    console.log(`  ⚠️ 未实现 ${text}`);
  }

  /** 无法核实（判例 V-09）：不计入 PASS，也不谎报 FAIL */
  unverified(text: string): void {
    this.unverifiedN += 1;
    console.log(`  ⚠️ UNVERIFIED ${text}`);
  }

  error(text: string): void {
    this.verdicts.push('ERROR');
    console.log(`  ❌ ERROR ${text}`);
  }

  /** 汇总判定（语义 = 该探针最严重的一条） */
  verdict(): ProbeVerdict {
    if (this.verdicts.includes('ERROR')) return 'ERROR';
    if (this.verdicts.includes('FAIL')) return 'FAIL';
    if (this.verdicts.includes('NOT_IMPLEMENTED')) return 'NOT_IMPLEMENTED';
    return 'PASS';
  }

  count(verdict: ProbeVerdict): number {
    return this.verdicts.filter((v) => v === verdict).length;
  }

  /** 签发末行 `RESULT=` —— 探针**必须**在 return 前调用它 */
  finish(): ProbeVerdict {
    const v = this.verdict();
    console.log(`\n${describeCoverage(this)}`);
    console.log(`RESULT=${v}`);
    return v;
  }

  exitCode(): 0 | 1 | 2 {
    return EXIT_BY_VERDICT[this.verdict()];
  }
}

/** 人工可读的覆盖说明（末行之前打印；**机器判据只认 RESULT= 行**） */
function describeCoverage(out: ProbeOutput): string {
  const parts = PROBE_VERDICTS.map((v) => `${v}=${out.count(v)}`).filter((s) => !s.endsWith('=0'));
  if (out.unverifiedCount() > 0) parts.push(`UNVERIFIED=${out.unverifiedCount()}`);
  if (parts.length === 0) {
    return 'COVERAGE: 无断言被执行（探针未验证任何东西 —— 不得视为 PASS）';
  }
  return `COVERAGE: ${parts.join(' ')}`;
}

/**
 * 定位仓库根。
 * @input  — 显式 root（可选）→ `SYNOVA_REPO_ROOT` → 自 cwd 逐级上溯（最多 10 层）
 * @output — 首个含 `scripts/control-tower` 的目录绝对路径
 * @error  — 找不到 ⇒ 抛 ProbeError（code=REPO_ROOT_NOT_FOUND, phase=bootstrap）
 */
function locateRepoRoot(explicit?: string): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (process.env.SYNOVA_REPO_ROOT) candidates.push(process.env.SYNOVA_REPO_ROOT);
  let cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'scripts', 'control-tower'))) return c;
  }
  throw new ProbeError(
    'REPO_ROOT_NOT_FOUND',
    'bootstrap',
    `无法定位仓库根（已试 ${candidates.length} 个候选，均无 scripts/control-tower）；` +
      '请设 SYNOVA_REPO_ROOT 或在仓库内运行',
  );
}

/**
 * 目标件存在性闸 —— 「未实现必须 exit 2」的**主实现**。
 * @input repoRoot ＋ 仓库相对路径 ｜ @output 全在 ⇒ true；任一缺失 ⇒ 打印后 false
 */
function assertTargetsExist(repoRoot: string, out: ProbeOutput, relPaths: string[]): boolean {
  const missing = relPaths.filter((p) => !existsSync(join(repoRoot, p)));
  if (missing.length > 0) {
    for (const m of missing) out.notImplemented(`目标件不存在: ${m}`);
    return false;
  }
  return true;
}

/** 场景名 → 是否 `--all` 语义 */
interface ProbeArgs {
  readonly cases: string[];
  readonly all: boolean;
}

/**
 * 解析探针 CLI 参数。
 * @error — 未知场景名 / 缺场景值 / 多场景未指定 ⇒ 抛 ProbeError（**不回落默认场景**）
 */
function parseProbeArgs(
  knownCases: readonly string[],
  argv: readonly string[] = process.argv.slice(2),
): ProbeArgs {
  const all = argv.includes('--all');
  if (all) return { cases: [...knownCases], all: true };

  const idx = argv.indexOf('--case');
  if (idx >= 0) {
    const raw = argv[idx + 1];
    if (raw === undefined || raw.startsWith('--')) {
      throw new ProbeError('MISSING_CASE_VALUE', 'args', '`--case` 后缺场景名');
    }
    if (!knownCases.includes(raw)) {
      throw new ProbeError(
        'UNKNOWN_CASE',
        'args',
        `未知场景 "${raw}"；已知: ${knownCases.join(', ')}（不回落默认场景 —— 回落会报出绿色的假事实）`,
      );
    }
    return { cases: [raw], all: false };
  }

  if (knownCases.length === 1) return { cases: [knownCases[0]], all: false };
  throw new ProbeError(
    'CASE_REQUIRED',
    'args',
    `本探针有 ${knownCases.length} 个场景，须显式指定: --case <${knownCases.join('|')}> 或 --all`,
  );
}

/** 探针模块的公开契约（与梯子 `ProbeModule` 接口同形 —— 供 ladder 编译期/运行期消费） */
interface ProbeModule {
  readonly KNOWN_CASES: readonly string[];
  main(argv?: readonly string[]): Promise<0 | 1 | 2>;
}

// ══════════════════════════════════════════════════════════════════════════════
// 一、判据常量
// ══════════════════════════════════════════════════════════════════════════════

/** 场景清单（逐字取自 ladder brief §场景取值表） */
export const KNOWN_CASES: readonly string[] = ['multi-dept', 'single-entry'];

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 🔴 牙齿来源: 本表**必须含当前不存在的真交付面**，否则"报绿"这条路无人挡。
 *   · `src/services/request-context.ts` = 卡面 §Q2 写集的收敛落点，**现存**（本探针真 import 它）；
 *   · `tests/security/department-axis.test.ts` = 卡面 §Q2 写集**逐字列出**的交付面 ——
 *     **本卡交付前它不存在** ⇒ 探针报 NOT_IMPLEMENTED(exit 2) = 预期态（未实现不许绿）。
 *   ✅ 为什么不用"部门定义真源目录"当牙齿: 卡面只写「`extensions/` 同族，新建」**未定名**，
 *     锚在某个约定目录名上 ⇒ 实现者换个同族名就会把**合法的绿误判成 ERROR**；本路径零命名约定风险。
 */
export const TARGETS: readonly string[] = ['src/services/request-context.ts', 'tests/security/department-axis.test.ts'];

/** 卡面 §Q2 写集声明的载体（"解析收敛单一入口"的落点） */
const DECLARED_TARGET = 'src/services/request-context.ts';

/**
 * 单一入口候选路径（**卡面 §Q2 写集逐字**：`src/services/request-context.ts`（收敛单入口））。
 *
 * 🔴 为什么不扫目录（实测教训，2026-10-11）: 早期版本按 `context|identity|department|scope|access`
 *   正则扫 `src/services/**` 并逐个 `import()` 试探 —— 实测在 ladder 全量进程里把
 *   `context-budget-tracker.ts` / `memory-access-service.ts` 等**与判据无关**的生产模块拉了起来，
 *   触发 **SIGABRT（exit 134）**（单独 import 各自正常 ⇒ 是"探针不许乱拉模块"这件事本身错了）。
 *   ⇒ 候选面收敛到卡面声明路径；实现若落在别处 ⇒ 报 `NOT_IMPLEMENTED` 并点明期望路径（不假绿）。
 */
const CANDIDATE_PATHS: readonly string[] = [DECLARED_TARGET];

/** 单一入口候选导出名（🔴 探针声明面） */
const ENTRY_NAMES: readonly string[] = [
  'resolveContext',
  'resolveIdentityContext',
  'resolveRequestContext',
  'resolveAccessContext',
];

/** 身份对象上的部门字段（读这些字段 = 直接读身份） */
const DEPARTMENT_FIELDS: readonly string[] = ['departmentIds', 'departmentId', 'departments'];

/** 部门定义载体目录名特征（extensions/ 下一层） */
const DEPT_DIR_NAME = /depart|org|identity|team|struct/i;

/** 部门定义模块导出候选（文件驱动缺位时的**降级取证**，并记为 V4 FAIL） */
const DEPT_LIST_NAMES: readonly string[] = ['listDepartments', 'listDepartmentIds', 'DEPARTMENTS'];

/** 只调用"读形态"的导出（避免探针触发生产写副作用）—— 跳过的名字会显式打印 */
const READSHAPE_NAME = /resolve|get|load|read|list|compute|expand|scope|context|department|permission|can|has|is|check|visible/i;
const WRITESHAPE_NAME = /^(?:set|save|write|delete|remove|update|create|run|start|stop|init|register|emit|publish|send|push|revoke|clear|reset)/i;

/** 探针代理身份标识 */
const PROBE_USER_ID = 'probe-department-axis';
const PROBE_TENANT = 'probe-tenant';
const PROBE_ORG = 'probe-org';

/** [L1] 辅证扫描上限（防超大仓拖慢） */
const REFERENCE_SCAN_LIMIT = 6000;

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
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

/** 深度收集字符串叶子（形状无关 —— 不假设实现的对象结构） */
function collectStringLeaves(
  value: unknown,
  leaves: string[] = [],
  seen: Set<object> = new Set(),
  depth = 0,
): string[] {
  if (depth > 12) return leaves;
  if (typeof value === 'string') {
    leaves.push(value);
    return leaves;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return leaves;
    seen.add(value);
    for (const item of value) collectStringLeaves(item, leaves, seen, depth + 1);
    return leaves;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return leaves;
    seen.add(value);
    for (const key of Object.keys(value).sort()) collectStringLeaves(value[key], leaves, seen, depth + 1);
  }
  return leaves;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、目标发现（真 import）
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

interface IdentityEntry {
  readonly modulePath: string;
  readonly mod: Record<string, unknown>;
  readonly resolveContext: ProbeCallable;
  readonly exportedNames: readonly string[];
}

async function discoverEntry(root: string, out: ProbeOutput): Promise<IdentityEntry | undefined> {
  const candidates = candidatePaths(root);
  out.note(`候选路径（卡面 §Q2 写集逐字，**不扫目录**）: ${candidates.length > 0 ? candidates.join(', ') : '（无）'}`);
  for (const rel of candidates) {
    const loaded = await importIfPresent(root, rel, out);
    if (!loaded) continue;
    const resolveContext = pickCallable(loaded.mod, ENTRY_NAMES);
    if (!resolveContext) continue;
    return {
      modulePath: loaded.path,
      mod: loaded.mod,
      resolveContext,
      exportedNames: Object.keys(loaded.mod).sort(),
    };
  }
  return undefined;
}

// ══════════════════════════════════════════════════════════════════════════════
// 四、部门定义真源发现（V4 文件驱动）
// ══════════════════════════════════════════════════════════════════════════════

interface DeptSource {
  readonly kind: 'file' | 'module' | 'none';
  /** 全部已知部门 id（**排序 + 去重**，可复跑） */
  readonly ids: readonly string[];
  /** 取证指针（文件路径 / 模块导出名） */
  readonly carriers: readonly string[];
}

/** 从文件文本里取部门 id（文件名 stem ＋ `id:` 字段值） */
function idsFromFile(relPath: string, text: string): string[] {
  const stem = relPath.split('/').pop()?.replace(/\.(ya?ml|json)$/i, '') ?? '';
  const ids: string[] = [];
  if (stem.length > 0) ids.push(stem);
  for (const match of text.matchAll(/^\s*id\s*:\s*["']?([A-Za-z0-9_.\-]+)["']?\s*$/gm)) {
    const id = match[1];
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function discoverDeptFiles(root: string, out: ProbeOutput): { ids: string[]; carriers: string[] } {
  const ids: string[] = [];
  const carriers: string[] = [];
  const extensionsRoot = join(root, 'extensions');
  if (!existsSync(extensionsRoot)) return { ids, carriers };

  let dirs: Dirent[];
  try {
    dirs = readdirSync(extensionsRoot, { withFileTypes: true });
  } catch (err: unknown) {
    // 铁律 24：不空吞 —— 读不到就显式说出来（读不到 ≠ 没有）
    out.note(`  ↳ 部门定义扫描: extensions/ 不可读（${err instanceof Error ? err.message : String(err)}）`);
    return { ids, carriers };
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    if (!DEPT_DIR_NAME.test(dir.name)) continue;
    let files: Dirent[];
    try {
      files = readdirSync(join(extensionsRoot, dir.name), { withFileTypes: true });
    } catch (err: unknown) {
      out.note(
        `  ↳ 部门定义扫描: extensions/${dir.name}/ 不可读（${err instanceof Error ? err.message : String(err)}）`,
      );
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) continue;
      if (!/\.(ya?ml|json)$/i.test(file.name)) continue;
      // `manifest.json` 是**扩展自描述件**、不是部门定义 —— 收进来会凭空多一个假部门 id
      // （`manifest`），把「部门定义实测 N 个 id」这条取证行污染成不可读。
      if (/^manifest\.json$/i.test(file.name)) continue;
      const rel = `extensions/${dir.name}/${file.name}`;
      let text: string;
      try {
        text = readFileSync(join(extensionsRoot, dir.name, file.name), 'utf8');
      } catch (err: unknown) {
        out.note(`  ↳ 部门定义文件不可读: ${rel}（${err instanceof Error ? err.message : String(err)}）`);
        continue;
      }
      carriers.push(rel);
      for (const id of idsFromFile(rel, text)) if (!ids.includes(id)) ids.push(id);
    }
  }
  return { ids: ids.sort(), carriers };
}

async function discoverDeptSource(root: string, entry: IdentityEntry, out: ProbeOutput): Promise<DeptSource> {
  const files = discoverDeptFiles(root, out);
  if (files.ids.length >= 2) {
    return { kind: 'file', ids: files.ids, carriers: files.carriers };
  }
  const fromModule = discoverDeptFromModule(entry);
  if (fromModule.ids.length >= 2) {
    out.note(
      `[L1] 部门定义**非文件驱动**：extensions/ 下实测部门定义文件 ${files.carriers.length} 个，` +
        `改用模块导出 ${fromModule.carriers.join(' / ')}`,
    );
    return { kind: 'module', ids: fromModule.ids, carriers: fromModule.carriers };
  }
  return { kind: 'none', ids: [], carriers: [] };
}

function discoverDeptFromModule(entry: IdentityEntry): { ids: string[]; carriers: string[] } {
  for (const name of DEPT_LIST_NAMES) {
    const value = entry.mod[name];
    if (isStringArray(value)) return { ids: [...value].sort(), carriers: [name] };
  }
  return { ids: [], carriers: [] };
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、身份探针（tripwire）—— V3 的**行为**判定件
// ══════════════════════════════════════════════════════════════════════════════

interface DepartmentTripwire {
  /** 交给被测代码的身份对象（部门字段是**记数的 getter**） */
  readonly identity: Record<string, unknown>;
  /** 部门字段被读总次数 */
  reads(): number;
  /** 被读过的字段名（去重、有序） */
  readFields(): readonly string[];
}

function makeDepartmentTripwire(departmentIds: readonly string[]): DepartmentTripwire {
  let count = 0;
  const fields: string[] = [];
  const identity: Record<string, unknown> = {};
  for (const field of DEPARTMENT_FIELDS) {
    Object.defineProperty(identity, field, {
      enumerable: true,
      configurable: true,
      get(): unknown {
        count += 1;
        if (!fields.includes(field)) fields.push(field);
        return field === 'departmentId' ? departmentIds[0] : [...departmentIds];
      },
    });
  }
  Object.defineProperty(identity, 'userId', { enumerable: true, value: PROBE_USER_ID });
  Object.defineProperty(identity, 'tenantId', { enumerable: true, value: PROBE_TENANT });
  Object.defineProperty(identity, 'orgId', { enumerable: true, value: PROBE_ORG });
  return { identity, reads: () => count, readFields: () => fields };
}

/** **夹具有效性自检**（判例 V-08：造不出来的夹具 = 无效夹具 ⇒ 报"无法判定"，不报红） */
function assertTripwireLive(out: ProbeOutput): boolean {
  const probe = makeDepartmentTripwire(['sentinel-a', 'sentinel-b']);
  const localReader = (identity: Record<string, unknown>): unknown => identity['departmentIds'];
  localReader(probe.identity);
  if (probe.reads() >= 1) {
    out.pass(
      `V3 夹具自检：身份探针可计数（本地读者读取触发 ${probe.reads()} 次，字段 ${probe.readFields().join(',')}）`,
      'L2',
    );
    return true;
  }
  out.fail('V3 夹具自检失败：身份探针读不出计数 ⇒ 该夹具无效（不得据此判红）', 'L2');
  return false;
}

/**
 * 真调用一个导出，并统计它对**投递给它的身份对象**部门字段的直接读取次数（[L2]）。
 * 每次调用用**独立** tripwire ⇒ 互不污染计数。
 */
async function countDirectReads(callable: ProbeCallable): Promise<{ reads: number; threw: string | undefined }> {
  const probe = makeDepartmentTripwire(['probe-a', 'probe-b']);
  let threw: string | undefined;
  try {
    await callable(probe.identity);
  } catch (err: unknown) {
    threw = err instanceof Error ? err.message.split('\n')[0] : String(err);
  }
  return { reads: probe.reads(), threw };
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、两个场景
// ══════════════════════════════════════════════════════════════════════════════

/** 解析调用（[L2]）：按声明形态真调用，返回首次可用结果 */
async function callResolve(entry: IdentityEntry, departmentIds: readonly string[], phase: string): Promise<unknown> {
  const shapes: readonly unknown[] = [
    { departmentIds: [...departmentIds] },
    { departmentIds: [...departmentIds], userId: PROBE_USER_ID, tenantId: PROBE_TENANT, orgId: PROBE_ORG },
    [...departmentIds],
    { departments: [...departmentIds] },
  ];
  const failures: string[] = [];
  for (const shape of shapes) {
    try {
      const raw: unknown = await entry.resolveContext(shape);
      if (raw !== undefined && raw !== null) return raw;
      failures.push(`${preview(shape, 60)} ⇒ 返回空`);
    } catch (err: unknown) {
      failures.push(`${preview(shape, 60)} ⇒ ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  throw new ProbeError(
    'RESOLVE_CALL_FAILED',
    phase,
    `单一入口 ${entry.modulePath}.resolve* 按声明形态均调用不成功: ${failures.join(' | ')}`,
    false,
  );
}

/**
 * 可见范围 = 解析结果里**生效的**部门 id（形状无关的观测口径）。
 *
 * 🔴 观测窗口修正（2026-10-11 实测，**探针自己没有抓住反例**）:
 *   初版实现是「收集整个结果对象里的全部字符串叶子，取其中出现过的已知部门 id」。
 *   实测反例②（把并集改成覆盖 —— 多部门只保留最后一个）：`requestedDepartments` 里仍留着
 *   被请求的全部 id ⇒ 字符串叶子照样扫到两个部门 ⇒ **假绿（RESULT=PASS）**。
 *   ⇒ 改为**优先读"生效面"**：结果对象上存在 `departments` / `departmentIds`（字符串数组）时，
 *     只以该字段为观测窗口（那正是"可见范围"的语义位）；两者都不存在时，才退回全叶子扫描
 *     （保形状无关，但**不再把"请求过的"误当"生效的"**）。
 *     字段存在但不是字符串数组（实现换了形状）⇒ 退回全叶子扫描，不静默判空。
 */
const EFFECTIVE_FIELDS: readonly string[] = ['departments', 'departmentIds'];

function scopeOf(resolved: unknown, knownIds: readonly string[]): string[] {
  if (isRecord(resolved)) {
    for (const field of EFFECTIVE_FIELDS) {
      const value = resolved[field];
      if (isStringArray(value)) return knownIds.filter((id) => value.includes(id)).sort();
    }
  }
  const seen = collectStringLeaves(resolved);
  return knownIds.filter((id) => seen.includes(id)).sort();
}

/** V2 ＋ V4：复数（并集，非覆盖）＋ 文件驱动实证 */
async function caseMultiDept(entry: IdentityEntry, root: string, out: ProbeOutput): Promise<void> {
  const source = await discoverDeptSource(root, entry, out);
  if (source.kind === 'none') {
    out.notImplemented('部门定义真源不可得：extensions/ 下无部门定义文件，且模块未导出部门清单 ⇒ 无法构造复数场景');
    return;
  }
  if (source.kind === 'module') {
    out.fail(
      'V4 破：部门定义**非文件驱动**（卡面 V4 要求"改部门定义文件 ⇒ 生效"）—— 实测 extensions/ 下无部门定义文件',
      'L1',
    );
  } else {
    out.pass(`V4 文件驱动：部门定义真源 ${source.carriers.length} 个文件（${source.carriers.join(', ')}）`, 'L1');
  }

  const ids = source.ids;
  const [deptA, deptB] = ids;
  out.note(`部门定义实测 ${ids.length} 个 id: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ' …' : ''}`);

  const onlyA = await callResolve(entry, [deptA], 'multi-dept');
  const onlyB = await callResolve(entry, [deptB], 'multi-dept');
  const both = await callResolve(entry, [deptA, deptB], 'multi-dept');
  const none = await callResolve(entry, [], 'multi-dept');

  const scopeA = scopeOf(onlyA, ids);
  const scopeB = scopeOf(onlyB, ids);
  const scopeBoth = scopeOf(both, ids);
  const scopeNone = scopeOf(none, ids);

  if (scopeA.length === 0 && scopeB.length === 0 && scopeBoth.length === 0) {
    out.error('无法判定：解析结果中未观测到任何已知部门 id ⇒ 可见范围口径取不到（探针不猜实现的对象结构）');
    return;
  }

  if (scopeA.includes(deptA)) out.pass(`V2 单部门生效: 身份[${deptA}] ⇒ 可见部门 [${scopeA.join(', ')}]`, 'L2');
  else out.fail(`V2 破: 身份[${deptA}] 的可见范围不含 ${deptA}（实测 [${scopeA.join(', ')}]）`, 'L2');

  if (scopeB.includes(deptB)) out.pass(`V2 单部门生效: 身份[${deptB}] ⇒ 可见部门 [${scopeB.join(', ')}]`, 'L2');
  else out.fail(`V2 破: 身份[${deptB}] 的可见范围不含 ${deptB}（实测 [${scopeB.join(', ')}]）`, 'L2');

  // V2 核心：复数 = 并集，非覆盖
  const union = [...new Set([...scopeA, ...scopeB])].sort();
  const missing = union.filter((id) => !scopeBoth.includes(id));
  if (missing.length === 0 && scopeBoth.includes(deptA) && scopeBoth.includes(deptB)) {
    out.pass(
      `V2 复数=并集: 身份[${deptA},${deptB}] ⇒ 可见部门 [${scopeBoth.join(', ')}] ⊇ 两单部门之并 [${union.join(', ')}]`,
      'L2',
    );
  } else {
    out.fail(
      `V2 破（覆盖而非并集）: 身份[${deptA},${deptB}] ⇒ [${scopeBoth.join(', ')}]，` +
        `而两部门各自可见 [${scopeA.join(', ')}] / [${scopeB.join(', ')}]；缺失 ${missing.join(', ') || '（并集未覆盖）'}`,
      'L2',
    );
  }

  // 差分不变量：空部门 ⇒ 空部门范围（"默认给全量"型实现必判红）
  if (scopeNone.length === 0) {
    out.pass('V2 边界：无部门身份 ⇒ 无部门可见范围（未退化为"默认给全量"）', 'L2');
  } else {
    out.fail(`V2 破：无部门身份却得到部门范围 [${scopeNone.join(', ')}]（默认给全量 = 越权）`, 'L2');
  }

  // [L1] 载体路径事实：部门定义必须在 extensions/ 下（"加文件不改代码"的物理前提）
  const outside = source.carriers.filter((carrier) => carrier.startsWith('src/'));
  if (outside.length === 0) out.pass('[L1] 部门定义载体无一位于 src/ 下 ⇒ 改文件即改数据面', 'L1');
  else out.fail(`[L1] 部门定义载体落在 src/ 下: ${outside.join(', ')} ⇒ 数据面与代码面未分离`, 'L1');
}

/** V3（核心）＋ V5：单一入口的行为断言 ＋ grep 仅辅证 */
async function caseSingleEntry(entry: IdentityEntry, root: string, out: ProbeOutput): Promise<void> {
  if (!assertTripwireLive(out)) {
    out.error('V3 无法判定：身份探针夹具无效 ⇒ 不以 grep 顶替（判例 V-02 / V-08）');
    return;
  }

  // ① 单一入口**真消费**投递的身份对象（tripwire 活跃性）
  const tripwire = makeDepartmentTripwire(['probe-dept-a', 'probe-dept-b']);
  let entryThrew: string | undefined;
  try {
    await entry.resolveContext(tripwire.identity);
  } catch (err: unknown) {
    entryThrew = err instanceof Error ? err.message.split('\n')[0] : String(err);
  }
  const entryReads = tripwire.reads();
  out.note(
    `入口调用: ${entry.modulePath} 读身份部门字段 ${entryReads} 次（字段 ${tripwire.readFields().join(',') || '无'}）` +
      `${entryThrew === undefined ? '' : `；调用抛异常: ${entryThrew}`}`,
  );

  // ② 消费者面：除单一入口外，其余读形态导出**不得**自行读部门字段（= 第二个解析入口）
  let consumerReads = 0;
  const offenders: string[] = [];
  const skipped: string[] = [];
  for (const name of entry.exportedNames) {
    const value = entry.mod[name];
    if (!isCallable(value)) continue;
    if (ENTRY_NAMES.includes(name)) continue;
    if (!READSHAPE_NAME.test(name) || WRITESHAPE_NAME.test(name)) {
      skipped.push(name);
      continue;
    }
    const { reads, threw } = await countDirectReads(value);
    if (reads > 0) {
      consumerReads += reads;
      offenders.push(`${name}(${reads} 次${threw === undefined ? '' : '，抛异常前已读'})`);
    }
  }
  out.note(`消费者面扫描: ${entry.exportedNames.length} 个导出；跳过非读形态 ${skipped.length} 个（${skipped.join(', ') || '无'}）`);

  if (consumerReads === 0) {
    out.pass(
      `V3 单一入口（行为）：除入口外 ${entry.exportedNames.length - 1 - skipped.length} 个读形态导出` +
        `对同一身份对象的部门字段读取 **0 次** ⇒ 未观测到第二个解析路径`,
      'L2',
    );
  } else {
    out.fail(
      `V3 破（V5 反例命中）：${offenders.length} 个导出**自行读取原始身份的部门字段** ⇒ 绕开单一入口` +
        `（${offenders.join(' ; ')}）`,
      'L2',
    );
  }

  if (entryReads === 0) {
    out.error(
      'V3 无法判定：单一入口**未消费**探针投递的身份对象（读部门字段 0 次）⇒ 本判据的前置条件不成立' +
        `（疑入口入参非身份对象）⇒ 不以 grep 顶替（判例 V-02），交人或后续契约对齐`,
    );
  } else {
    out.pass(`V3 入口消费身份（行为）：resolve* 真读了投递对象的部门字段 ⇒ 观测链完整`, 'L2');
  }

  if (entryThrew !== undefined) {
    out.note(`  ↳ 入口抛异常（已记录，未隐藏）：${entryThrew}`);
  }

  // [L1] 辅证：还有哪些文件碰部门字段（**不参与判定**，判例 V-02 逐字）
  const refs = countDepartmentReferences(join(root, 'src'), entry.modulePath);
  out.note(
    `[L1-辅证，不参与判定] src/** 中引用部门字段的文件 ${refs.files.length} 个 / 命中 ${refs.hits} 处` +
      `（判定由上方 [L2] 行为断言给出；本行仅作粗筛对照，命中≠第二入口）`,
  );
  if (refs.files.length > 0) {
    out.note(`  ↳ 对照清单（前 8）: ${refs.files.slice(0, 8).map((f) => `${f.path}(${f.hits})`).join(', ')}`);
  }
  if (refs.truncated) {
    out.unverified(`[L1] 辅证扫描达上限 ${REFERENCE_SCAN_LIMIT} 文件 ⇒ 对照清单不完整（不计入 PASS）`);
  }
  if (refs.unreadable.length > 0) {
    out.unverified(
      `[L1] 辅证有 ${refs.unreadable.length} 项不可读（${refs.unreadable.slice(0, 3).join(' ; ')}）⇒ 对照清单不完整（不计入 PASS）`,
    );
  }
}

interface ReferenceCount {
  readonly files: readonly { readonly path: string; readonly hits: number }[];
  readonly hits: number;
  readonly truncated: boolean;
  /** 不可读项（铁律 24：不空吞 —— 辅证不完整要显式说出来，不等于 0 命中） */
  readonly unreadable: readonly string[];
}

/** [L1] 辅证：部门字段引用清单（**不作验收依据**） */
function countDepartmentReferences(srcRoot: string, entryRelPath: string): ReferenceCount {
  const found: { path: string; hits: number }[] = [];
  const unreadable: string[] = [];
  let hits = 0;
  let scanned = 0;
  let truncated = false;
  const walk = (current: string, rel: string, depth: number): void => {
    if (depth > 8 || truncated) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (err: unknown) {
      unreadable.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const next = join(current, entry.name);
      const nextRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(next, nextRel, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      scanned += 1;
      if (scanned > REFERENCE_SCAN_LIMIT) {
        truncated = true;
        return;
      }
      if (nextRel === entryRelPath) continue;
      let text: string;
      try {
        text = readFileSync(next, 'utf8');
      } catch (err: unknown) {
        unreadable.push(`${nextRel}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      let local = 0;
      for (const field of DEPARTMENT_FIELDS) {
        let from = 0;
        for (;;) {
          const at = text.indexOf(field, from);
          if (at < 0) break;
          local += 1;
          from = at + field.length;
        }
      }
      if (local > 0) {
        found.push({ path: nextRel, hits: local });
        hits += local;
      }
    }
  };
  walk(srcRoot, 'src', 0);
  found.sort((a, b) => b.hits - a.hits);
  return { files: found, hits, truncated, unreadable };
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('K12-10 department-axis（#193 / RB-02）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const pe = toProbeError(err, 'bootstrap');
    out.error(`仓库根定位失败 [${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}]: ${pe.message}`);
    out.finish();
    return 2;
  }

  out.note(`PROBE=probe-department-axis card=K12-10(#193/RB-02) repoRoot=${root}`);
  out.note(
    'V3 口径声明: 单一入口用**身份探针行为观测**判定 [L2]；grep 只作 [L1] 辅证、不参与判定（判例 V-02）',
  );

  // ① 目标载体存在性闸（卡面 §Q2 写集）
  if (!assertTargetsExist(root, out, [DECLARED_TARGET])) {
    out.note('说明: 载体未建 ⇒ 本探针按契约报 NOT_IMPLEMENTED（exit 2），**不是** PASS（未实现不许绿）');
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

  // ③ 单一入口发现（真 import）—— `resolveContext` 全树 0 命中 ⇒ NOT_IMPLEMENTED / exit 2
  const entry = await discoverEntry(root, out);
  if (!entry) {
    out.notImplemented(
      `单一入口未命中：候选模块均未导出解析入口（候选名 ${ENTRY_NAMES.join(' / ')}）⇒ ` +
        `resolveContext 未实现（实测全树 0 命中）`,
    );
    out.finish();
    return 2;
  }
  out.note(`命中单一入口 ${entry.modulePath}（真 import 成功；导出 ${entry.exportedNames.length} 个符号）`);

  // ④ 逐场景真跑
  for (const name of cases) {
    out.case(name);
    try {
      if (name === 'multi-dept') await caseMultiDept(entry, root, out);
      else if (name === 'single-entry') await caseSingleEntry(entry, root, out);
      else out.error(`场景分派未覆盖: ${name}`);
    } catch (err: unknown) {
      const pe = toProbeError(err, name);
      out.error(`[${pe.code}/${pe.phase}/retryable=${String(pe.retryable)}] ${pe.message} ⇒ 该场景无法判定`);
    }
  }

  out.finish();
  return out.exitCode();
}

/** 契约自证（编译期）：本模块的形状必须满足 `ProbeModule`（与梯子接口同形） */
const PROBE_CONTRACT: ProbeModule = { KNOWN_CASES, main };

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）
if (process.argv[1] && /probe-department-axis\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(String(err));
      process.exit(2);
    },
  );
}
