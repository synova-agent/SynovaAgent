/**
 * src/runtime/dsh/profile.ts — `synova-sidecar` 这一步 dsh profile 的**装载与断言**。
 *
 * 责任边界：
 *   · 只读地解析仓库内的 profile 四件（package.json / cordis.yml / cordis.patch.yml /
 *     pnpm-workspace.yaml），把它们装到 per-instance `DSH_HOME/profiles/synova-sidecar`；
 *   · 对**安全姿态**做机器可判断言（read-only 沙箱、approval ask、禁用清单、不继承 desktop）；
 *   · 生成固定版本 dsh 的启动命令与环境（不传任何模型凭据）。
 *   · 不解析 dsh 全量配置、不修改 dsh 内核；`--dump-config` 的运行期核对由
 *     `scripts/dsh-sidecar/start.ps1` 的探针承担（见证据文件）。
 *
 * 契约（铁律 47）:
 *   @input   profileDir（仓库内四件所在目录）｜ dshHome ｜ instanceDir ｜ installDir（含版本目录）
 *   @output  SidecarProfile（解析结果）｜ SidecarProfileViolation[]（逐条可读）｜
 *            启动 invocation {command,args,env}
 *   @degraded 无：profile 是安全边界，任何不合规都必须抛 PROFILE_INVALID，不得静默放行
 *   @error   PROFILE_NOT_FOUND（文件缺失）/ PROFILE_INVALID（不合规）/ SIDECAR_SPAWN_FAILED
 *            （固定安装目录缺失，`retryable=false`）
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DshError } from './errors';

/** 本 profile 的固定名字（同时是 DSH_HOME/profiles 下的目录名）。 */
export const SIDECAR_PROFILE_NAME = 'synova-sidecar';

/** profile 四件（缺一不可）。 */
const SIDECAR_PROFILE_FILES = [
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
] as const;

/** 允许的 bundle 组合：官方 dsh-base + 官方 acp 应用，且只有这两个。 */
const REQUIRED_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] as const;

/** 任何出现即判违规的 bundle 片段（desktop 继承、第三方插件、Synova 开发预设）。 */
const FORBIDDEN_BUNDLE_FRAGMENTS = [
  'desktop',
  'dshmarket',
  'sidebar',
  'synova',
  'dsh-web',
  'dsh-headless',
] as const;

/**
 * 必须显式 `disabled: true` 的 entry id（17 条）。
 * 来源：DEV DOC §5.2 的 15 条 + 过渡 Mandate 12306 明确要求显式禁用的
 * `web-deepseek-api` / `web-fetch-http`（不接受 pending 警告作为正常态）。
 */
const REQUIRED_DISABLED_IDS = [
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
  'tool-jobs',
  'tool-skill',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-control',
  'tool-agent-team',
  'tool-workflow',
  'web',
  'web-search-deepseek',
  'web-deepseek-api',
  'web-fetch-http',
  'tool-web',
  'mcp-resources',
] as const;

/** 任何出现即判违规的字面量（安全姿态不得被改写）。 */
const FORBIDDEN_PATCH_TOKENS = ['danger-full-access', 'policy: never', 'mode: workspace-write'] as const;

/** 子进程不得继承的模型凭据/权限 env（dsH 只做通用运行时，凭据不注入 Sidecar）。 */
const STRIPPED_CHILD_ENV_KEYS = [
  'DEEPSEEK_API_KEY',
  'LLM_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DSH_PERMISSION_MODE',
] as const;

/** 解析后的单个 patch entry（只保留本 profile 用到的键）。 */
export interface PatchEntry {
  id: string;
  disabled: boolean;
  config: { mode?: string; policy?: string; workspaceRoot?: string };
  /** 文件内 1-based 行号（错误定位用）。 */
  line: number;
}

/** 解析后的 profile。 */
export interface SidecarProfile {
  profileDir: string;
  name: string;
  bundles: string[];
  patchEntries: PatchEntry[];
  patchText: string;
  cordisText: string;
}

/** 一条可读违规（code 机器可判，detail 给人看）。 */
export interface SidecarProfileViolation {
  code:
    | 'BUNDLES_MISMATCH'
    | 'CORDIS_ROOT_NOT_EMPTY'
    | 'SANDBOX_MODE_NOT_READ_ONLY'
    | 'WORKSPACE_ROOT_NOT_CWD'
    | 'APPROVAL_POLICY_NOT_ASK'
    | 'REQUIRED_DISABLE_MISSING'
    | 'FORBIDDEN_TOKEN_PRESENT'
    | 'PATCH_PARSE_ERROR';
  detail: string;
}

/** 仓库内默认 profile 目录（本文件位于 src/runtime/dsh/）。 */
export function defaultProfileDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'deploy', 'dsh', 'profiles', SIDECAR_PROFILE_NAME);
}

/**
 * 解析 cordis.patch.yml 的**受控子集**。
 *
 * 为什么手写：本 profile 是仓库自有、由我们主编排的受控文件；引入第三方 YAML 解析器
 * 会把「解析成功」当成「姿态正确」。这里只接受已知形状，遇到未知行就抛错
 * （`PATCH_PARSE_ERROR`）——宁可拒绝启动，也不静默忽略一条 disable。
 *
 * 支持的形状（缩进两个空格起）：
 *   - id: <name>
 *     disabled: true|false
 *     config:
 *       mode: <scalar>
 *       policy: <scalar>
 *       workspaceRoot: <scalar|!!js expr>
 */
function parsePatchEntries(text: string): PatchEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: PatchEntry[] = [];
  let current: PatchEntry | null = null;
  let inConfig = false;

  const parseError = (line: number, message: string): DshError => new DshError(
    'PROFILE_INVALID',
    'profile',
    `cordis.patch.yml:${line}: ${message}`,
    { retryable: false },
  );

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const idMatch = /^-\s+id:\s*(\S+)\s*$/.exec(trimmed);
    if (idMatch) {
      if (current !== null) entries.push(current);
      current = { id: idMatch[1], disabled: false, config: {}, line: lineNo };
      inConfig = false;
      continue;
    }
    if (current === null) throw parseError(lineNo, `顶层条目必须以 "- id:" 开头，实际: ${trimmed}`);
    if (/^-\s+/.test(trimmed)) {
      const insert = /^-\s+(insert|disabled|config|name|inject):/.exec(trimmed);
      if (insert) throw parseError(lineNo, `synova-sidecar 不允许顶层键 ${insert[1]}:（profile 必须保持最小插入面）`);
      throw parseError(lineNo, `不支持的顶层数组元素: ${trimmed}`);
    }
    if (/^\s+insert:|^\s+name:|^\s+inject:/.test(raw)) {
      throw parseError(lineNo, `不支持的 entry 键: ${trimmed}`);
    }

    const enabledMatch = /^disabled:\s*(true|false)\s*$/.exec(trimmed);
    if (enabledMatch) {
      current.disabled = enabledMatch[1] === 'true';
      inConfig = false;
      continue;
    }
    if (/^config:\s*$/.test(trimmed)) {
      inConfig = true;
      continue;
    }
    if (inConfig) {
      const kv = /^(mode|policy|workspaceRoot):\s*(.+)$/.exec(trimmed);
      if (!kv) throw parseError(lineNo, `config 内不支持的键: ${trimmed}`);
      if (kv[1] === 'mode') current.config.mode = kv[2];
      if (kv[1] === 'policy') current.config.policy = kv[2];
      if (kv[1] === 'workspaceRoot') current.config.workspaceRoot = kv[2];
      continue;
    }
    throw parseError(lineNo, `不支持的 entry 键: ${trimmed}`);
  }
  if (current !== null) entries.push(current);
  return entries;
}

/**
 * 装载并解析 profile 四件。
 * @error PROFILE_NOT_FOUND（目录或文件缺失）/ PROFILE_INVALID（package.json 非法/无 bundles）
 */
export function loadSidecarProfile(profileDir: string = defaultProfileDir()): SidecarProfile {
  if (!existsSync(profileDir)) {
    throw new DshError('PROFILE_NOT_FOUND', 'profile', `profile 目录不存在: ${profileDir}`, { retryable: false });
  }
  for (const file of SIDECAR_PROFILE_FILES) {
    const path = join(profileDir, file);
    if (!existsSync(path)) {
      throw new DshError('PROFILE_NOT_FOUND', 'profile', `profile 缺少文件: ${path}`, { retryable: false });
    }
  }
  const packageText = readFileSync(join(profileDir, 'package.json'), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageText);
  } catch (err: unknown) {
    throw new DshError('PROFILE_INVALID', 'profile', `package.json 不是合法 JSON: ${String(err)}`, {
      retryable: false,
      cause: err,
    });
  }
  const bundles = readBundles(parsed);
  const patchText = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
  return {
    profileDir,
    name: SIDECAR_PROFILE_NAME,
    bundles,
    patchEntries: parsePatchEntries(patchText),
    patchText,
    cordisText: readFileSync(join(profileDir, 'cordis.yml'), 'utf8'),
  };
}

/** 从 package.json 的结构里取 dsh.profile.bundles（结构非法 → PROFILE_INVALID）。 */
function readBundles(parsed: unknown): string[] {
  if (parsed === null || typeof parsed !== 'object') {
    throw new DshError('PROFILE_INVALID', 'profile', 'package.json 顶层不是对象', { retryable: false });
  }
  const dsh = (parsed as { dsh?: unknown }).dsh;
  if (dsh === null || typeof dsh !== 'object') {
    throw new DshError('PROFILE_INVALID', 'profile', 'package.json 缺少 dsh.profile.bundles', { retryable: false });
  }
  const profile = (dsh as { profile?: unknown }).profile;
  if (profile === null || typeof profile !== 'object') {
    throw new DshError('PROFILE_INVALID', 'profile', 'package.json 缺少 dsh.profile', { retryable: false });
  }
  const bundles = (profile as { bundles?: unknown }).bundles;
  if (!Array.isArray(bundles) || bundles.some(b => typeof b !== 'string')) {
    throw new DshError('PROFILE_INVALID', 'profile', 'dsh.profile.bundles 必须是字符串数组', { retryable: false });
  }
  return bundles as string[];
}

/**
 * 逐条断言 profile 安全姿态，返回**全部**违规（不短路：一次给出所有问题）。
 * 判别力：把 patch 的 `read-only` 改成 `danger-full-access`、删掉任一条 disable、
 * 或把 approval 改成 `never`，本函数都会落到对应 code。
 */
function sidecarProfileViolations(profile: SidecarProfile): SidecarProfileViolation[] {
  const violations: SidecarProfileViolation[] = [];

  if (profile.bundles.length !== REQUIRED_BUNDLES.length || REQUIRED_BUNDLES.some(b => !profile.bundles.includes(b))) {
    violations.push({
      code: 'BUNDLES_MISMATCH',
      detail: `bundles 必须恰为 [${REQUIRED_BUNDLES.join(', ')}]，实际 [${profile.bundles.join(', ')}]`,
    });
  }
  for (const bundle of profile.bundles) {
    const hit = FORBIDDEN_BUNDLE_FRAGMENTS.find(fragment => bundle.includes(fragment));
    if (hit !== undefined) {
      violations.push({ code: 'BUNDLES_MISMATCH', detail: `bundle ${bundle} 命中禁止片段 ${hit}` });
    }
  }

  const rootEntries = profile.cordisText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'));
  if (!(rootEntries.length === 1 && rootEntries[0] === '[]')) {
    violations.push({ code: 'CORDIS_ROOT_NOT_EMPTY', detail: `cordis.yml 根层必须只含 []，实际: ${rootEntries.join(' | ')}` });
  }

  for (const token of FORBIDDEN_PATCH_TOKENS) {
    if (profile.patchText.includes(token)) {
      violations.push({ code: 'FORBIDDEN_TOKEN_PRESENT', detail: `cordis.patch.yml 出现禁止字面量: ${token}` });
    }
  }

  const find = (id: string): PatchEntry | undefined => profile.patchEntries.find(entry => entry.id === id);

  const sandbox = find('sandbox-policy');
  if (sandbox === undefined) {
    violations.push({ code: 'SANDBOX_MODE_NOT_READ_ONLY', detail: '缺少 sandbox-policy entry' });
  } else {
    if (sandbox.config.mode !== 'read-only') {
      violations.push({
        code: 'SANDBOX_MODE_NOT_READ_ONLY',
        detail: `sandbox-policy.mode 必须为 read-only，实际 ${sandbox.config.mode ?? '<缺失>'}`,
      });
    }
    if (sandbox.config.workspaceRoot === undefined || !sandbox.config.workspaceRoot.includes('process.cwd()')) {
      violations.push({
        code: 'WORKSPACE_ROOT_NOT_CWD',
        detail: `sandbox-policy.workspaceRoot 必须绑定 process.cwd()，实际 ${sandbox.config.workspaceRoot ?? '<缺失>'}`,
      });
    }
  }

  const approval = find('approval');
  if (approval === undefined) {
    violations.push({ code: 'APPROVAL_POLICY_NOT_ASK', detail: '缺少 approval entry' });
  } else if (approval.config.policy !== 'ask') {
    violations.push({
      code: 'APPROVAL_POLICY_NOT_ASK',
      detail: `approval.policy 必须为 ask，实际 ${approval.config.policy ?? '<缺失>'}`,
    });
  }

  for (const id of REQUIRED_DISABLED_IDS) {
    const entry = find(id);
    if (entry === undefined || !entry.disabled) {
      violations.push({ code: 'REQUIRED_DISABLE_MISSING', detail: `entry ${id} 必须显式 disabled: true` });
    }
  }

  return violations;
}

/** 断言 profile 合规；不合规一次性抛出全部违规（不静默放行）。 */
export function assertSidecarProfile(profile: SidecarProfile): void {
  const violations = sidecarProfileViolations(profile);
  if (violations.length === 0) return;
  throw new DshError(
    'PROFILE_INVALID',
    'profile',
    `synova-sidecar profile 不合规（${violations.length} 项）: ${violations.map(v => `${v.code}: ${v.detail}`).join(' ; ')}`,
    { retryable: false },
  );
}

/**
 * 把 profile 四件装到 `<dshHome>/profiles/synova-sidecar`。
 * 仓库是唯一版本源：每次启动覆盖四件，避免"机器上改过就漂移"。
 * @output 目标目录（已就绪）
 */
export function installSidecarProfile(options: {
  profileDir: string;
  dshHome: string;
}): string {
  const target = join(options.dshHome, 'profiles', SIDECAR_PROFILE_NAME);
  mkdirSync(target, { recursive: true });
  for (const file of SIDECAR_PROFILE_FILES) {
    const source = join(options.profileDir, file);
    const content = readFileSync(source);
    writeFileSync(join(target, file), content);
  }
  return target;
}

/**
 * `workspaceRoot: !!js process.cwd()` 的契约值：Sidecar 的子进程 cwd 必须等于实例目录，
 * 因此解析后的 workspaceRoot 必须等于 `realpath(instanceDir)`。
 * @error VALIDATION_ERROR（instanceDir 非绝对路径或不存在）
 */
export function resolveWorkspaceRoot(instanceDir: string): string {
  if (!isAbsolute(instanceDir)) {
    throw new DshError('VALIDATION_ERROR', 'profile', `instanceDir 必须是绝对路径: ${instanceDir}`, {
      retryable: false,
    });
  }
  if (!existsSync(instanceDir)) {
    throw new DshError('VALIDATION_ERROR', 'profile', `instanceDir 不存在: ${instanceDir}`, { retryable: false });
  }
  // 用 path.resolve 归一化（不 realpath）：dsh 侧 `process.cwd()` 回报的是**启动时传入的
  // cwd 字符串**（Windows 不会自动展开 8.3 短名），因此契约值必须与传入值逐字符一致。
  return resolve(instanceDir);
}

/** 固定版本 dsh 启动命令（安装目录由部署侧固定，仓库不写死版本号/路径）。 */
export interface DshInvocation {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * 生成固定版本 dsh 的启动命令。
 *
 * 两种布局，**npm 安装布局优先**（本票锁版路径）：
 * 1. npm 安装布局（生产/沙箱）：
 *    `<node> <installDir>/node_modules/@deepseek-ai/dsh/lib/bin.js --profile synova-sidecar`
 *    —— `<node>` 缺省 process.execPath（沙箱里就是便携 node），不依赖 PATH。
 * 2. 桌面安装布局（历史分支，保留但非默认）：
 *    `DeepSeek Harness.exe --expose-internals <cli.js> --profile synova-sidecar`。
 *
 * @error SIDECAR_SPAWN_FAILED（两种布局都缺入口，`retryable=false`）
 */
export function buildDshInvocation(options: {
  installDir: string;
  dshHome: string;
  baseEnv?: NodeJS.ProcessEnv;
  /** npm 布局下使用的 node 可执行文件；缺省 process.execPath（便携 node / Electron-as-node）。 */
  nodeExecutable?: string;
}): DshInvocation {
  const env = buildChildEnv(options.dshHome, options.baseEnv);
  const binJs = join(options.installDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (existsSync(binJs)) {
    return {
      command: options.nodeExecutable ?? process.execPath,
      args: [binJs, '--profile', SIDECAR_PROFILE_NAME],
      env,
    };
  }

  const exe = join(options.installDir, 'DeepSeek Harness.exe');
  const cli = join(
    options.installDir,
    'resources',
    'app.asar',
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh-desktop-host',
    'lib',
    'cli.js',
  );
  if (!existsSync(exe)) {
    throw new DshError('SIDECAR_SPAWN_FAILED', 'spawn', `未找到固定版本 dsh 宿主: ${exe}（npm 布局缺 lib/bin.js，桌面布局缺 exe）`, { retryable: false });
  }
  // cli.js 位于 app.asar 内：普通 node 的 existsSync 看不见 asar 内部，只有 Electron
  // （`--expose-internals`）能加载。因此这里只核对 asar 包存在，不把 asar 内路径当普通文件断言。
  const asar = join(options.installDir, 'resources', 'app.asar');
  if (!existsSync(asar)) {
    throw new DshError('SIDECAR_SPAWN_FAILED', 'spawn', `未找到固定版本 dsh app.asar: ${asar}`, { retryable: false });
  }
  return {
    command: exe,
    args: ['--expose-internals', cli, '--profile', SIDECAR_PROFILE_NAME],
    env,
  };
}

/**
 * Sidecar 子进程环境：只带 DSH_HOME 与 ELECTRON_RUN_AS_NODE，剥离模型凭据与
 * 权限 env（不靠 env 决定权限；权限来自 profile patch 的显式配置）。
 */
export function buildChildEnv(dshHome: string, baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  for (const key of STRIPPED_CHILD_ENV_KEYS) delete env[key];
  env.DSH_HOME = dshHome;
  env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}
