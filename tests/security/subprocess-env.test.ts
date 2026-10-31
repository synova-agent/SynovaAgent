/**
 * tests/security/subprocess-env.test.ts — #1209 / R-S0-2a「子进程 env 白名单」
 *
 * 判据来源：`.handbook/派单件/2026-10-31-规格-1209-S0-2a-子进程env白名单.md`（v1.1）§3 U-1…U-5。
 * 锚：`9842b5163`（= `gitea/main`；锚不符 ⇒ 本文件不得作为判据使用）。
 *
 * 本文件证明什么（防误读）:
 *   ① `buildSubprocessEnv` 的**纯函数语义**（U-1…U-4）：父 env 只透传非敏感字符串键，
 *      敏感名按**单一后缀规则**剔除，`declared` 显式放行**优先**（后合并），返回**新对象**。
 *   ② 三处接线里**风险最高的那一处**（`src/mcp/bridge.ts:110`：子进程是 `vendor/mcp-servers/`
 *      第三方代码）**真的**把白名单 env 交给了子进程（U-5：真 spawn，子进程把自身 `process.env`
 *      写文件，父进程读文件断言）。判定依据是**子进程自己看到的 env**，不是源码 grep。
 *   它**不**证明：`providers/python-bridge.ts` / `routes/cockpit.ts` 两处的运行期行为
 *   （那两处只改 env 构造方式，由类型检查＋写集对账覆盖；三处的**共同**判据是本模块纯函数语义）。
 *
 * 手法（铁律 12：不 mock 被测管线）:
 *   U-5 走**真** `MCPBridge` → 真 `spawn` → 真子进程（`process.execPath`）→ 子进程写文件 → 父进程读文件。
 *   🔴 **禁**改为"绕过 bridge 直接 spawn"——那会让 U-6-1（把 `src/mcp/bridge.ts:110` 改回全量继承
 *      ⇒ 本用例必红）**失去判别力**（绕过 bridge，bridge 改坏也不会红）。这两条必须同时成立。
 *   🔴 **禁**用 stdout 取 env：`bridge.ts:125-141` 的 stdout 走 `readline` + `JSON.parse`
 *      （非 JSON 行被 `log.debug` 吞、无匹配 `pendingRequests.id` 的 JSON 被静默丢弃）。
 *
 * 契约（铁律 47）:
 *   @input  — U-1…U-4：内存构造的 `{ parent, declared }`。
 *             U-5：父进程 env 注入 4 个机密（`JWT_SECRET` / `CREDENTIAL_MASTER_KEY` /
 *             `ENGINE_TOKENS` / `EMAIL_PASS`）＋ 一个**父值会被 `declared` 覆盖**的键；
 *             `new MCPBridge({ envprobe: {...} })` 注入假 server 配置（可选形参 = U-5 的唯一动机）。
 *   @output — U-1…U-4：`Record<string, string>` 的键/值断言（含引用不等断言）。
 *             U-5：子进程 env 文件 JSON ⇒ 4 个机密**不在**、`PATH` **在且等于父值**、
 *             `declared` 键**在且为声明值**（父值不得胜出）。
 *   @degraded — **无**。夹具不可用一律 `throw`（不 `skip`、不静默当成通过）：
 *             假 server 的 env 文件 5s 内读不到 ⇒ `throw`（判据不可判定 ≠ 通过）。
 *   @exit   — **不适用**：本件是 vitest 测试件，不是可执行脚本，没有独立进程退出码；
 *             三态落在 runner 上（`npx vitest run <file>`：0＝全绿／1＝有用例红／
 *             2＝runner 自身失败），故不实现 `@exit 0/1/2`（那是脚本件约定，见
 *             dsh-code-standards D1；本件不重复实现）。改坏必红由 U-6 在 `/tmp` 副本上做。
 *   @authority — 谁能跑：判据执行者（自验员／独立复核员／K3）与编码者自测。不对外暴露。
 *
 * 已知限制（本文件**不**覆盖，防把"绿"读成"已闭合"）:
 *   1. 只证明 `buildSubprocessEnv` 语义 ＋ `mcp/bridge.ts` 一处的真 spawn 行为；
 *      另两处（`providers/python-bridge.ts` / `routes/cockpit.ts`）不跑真实 Python 子进程
 *      （需要本地 Python 运行时；属代价/收益权衡，判据仍靠共用纯函数的语义）。
 *   2. **名单法不是白名单**：无敏感后缀的机密名（如 `MYCRED`）拦不住；`JIRA_PROJECT_KEY`
 *      一类 `*_KEY` 非机密配置会**被误删**（规格 §4-5/§4-6，已知且接受，可用 `declared` 放行）。
 *   3. `declared` 内容不受审（server 声明什么就放行什么）——属 MCP 配置面（规格 §4-3）。
 *   4. `tsconfig.json:29` 排除 `tests` ⇒ 本件**没有编译期类型检查**，只有运行期判据（规格 §3 U-7 已知缺口）。
 *
 * 设计哲学：一处构造 env，三处只声明它需要什么。
 * 铁律 48: 每格均有真断言（`expect` 带参数）；无空壳用例。
 * 铁律 38: 零 `as` 强转家族（any／never／unknown-as）
 *   （"非字符串 env 值" / "自有 `__proto__` 属性"用 `Object.defineProperty` 构造，不用断言穿透）。
 * 铁律 33: 命名 `*.test.ts`。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubprocessEnv } from '../../src/security/subprocess-env';
import { MCPBridge } from '../../src/mcp/bridge';

// ════════════════════════════════════════════════════════════════
// 小工具
// ════════════════════════════════════════════════════════════════

/** 在普通对象上**绕过原型 setter** 建自有可枚举属性（用于构造"对类型说谎"的入参，不用 `as`）。 */
function defineOwn(target: Record<string, string | undefined>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 运行期"违规调用"夹具：负例（U-4-⑦）需要传静态类型不允许的值。
 * 用 `Reflect.apply` 的宽松参数列表**绕过**类型检查，而**不用 `as` 强转家族**（铁律 38）。
 */
function invokeWithRuntimeInput(args: unknown[]): unknown {
  return Reflect.apply(buildSubprocessEnv, undefined, args);
}

/** 带超时的等待；超时返回 `fallback`（**清掉计时器**，不给 runner 留悬挂 handle） */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => { timer = setTimeout(() => { resolve(fallback); }, ms); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 运行期读错误对象字段（`code`/`phase`/`retryable`）。
 * 🔴 被测错误类**刻意不导出**（接线门禁：新 export 须被 src 引用；范式同 master-secret.ts），
 *    故按字段判而不用 `instanceof`；`Reflect.get` 免去 `as` 断言穿透（铁律 38）。
 */
function errorField(err: unknown, field: string): unknown {
  if (typeof err !== 'object' || err === null) return undefined;
  return Reflect.get(err, field);
}

/** 运行时收窄：未知 JSON → `Record<string, string>`（非字符串值丢弃） */
function toStringEnv(parsed: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  if (typeof parsed !== 'object' || parsed === null) return env;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

// ════════════════════════════════════════════════════════════════
// U-1 · 纯函数 · 正常路径
// ════════════════════════════════════════════════════════════════

describe('#1209 U-1 纯函数·正常路径 — 非敏感键原样保留', () => {
  it('U-1 parent={PATH,HOME,LANG}、declared={} ⇒ 三键原样保留', () => {
    const env = buildSubprocessEnv({
      parent: { PATH: '/bin', HOME: '/h', LANG: 'C' },
      declared: {},
    });
    expect(env['PATH']).toBe('/bin');
    expect(env['HOME']).toBe('/h');
    expect(env['LANG']).toBe('C');
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH']);
  });

  it('U-1b declared 缺省（不传）⇒ 与传空对象等价，非敏感键仍原样保留', () => {
    const env = buildSubprocessEnv({ parent: { PATH: '/bin', HOME: '/h', LANG: 'C' } });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', LANG: 'C' });
  });
});

// ════════════════════════════════════════════════════════════════
// U-2 · 纯函数 · 反例①敏感名被剥
// ════════════════════════════════════════════════════════════════

describe('#1209 U-2 反例① — 敏感名全部剔除（单一后缀规则）', () => {
  it('U-2 五个敏感名（JWT_SECRET/CREDENTIAL_MASTER_KEY/DEEPSEEK_API_KEY/MY_TOKEN/DB_PASSWORD）全部不在输出', () => {
    const env = buildSubprocessEnv({
      parent: {
        JWT_SECRET: 'x',
        CREDENTIAL_MASTER_KEY: 'y',
        DEEPSEEK_API_KEY: 'z',
        MY_TOKEN: 't',
        DB_PASSWORD: 'p',
      },
      declared: {},
    });
    const names = ['JWT_SECRET', 'CREDENTIAL_MASTER_KEY', 'DEEPSEEK_API_KEY', 'MY_TOKEN', 'DB_PASSWORD'];
    for (const name of names) {
      expect(env[name], `${name} 必须被剔除`).toBeUndefined();
    }
    expect(Object.keys(env)).toEqual([]);
  });

  it('U-2b 定点：ENGINE_TOKENS(_TOKENS?)/EMAIL_PASS(_PASS)/FEISHU_WEBHOOK_URL(_WEBHOOK_URL) 必删；非敏感同名保留', () => {
    const env = buildSubprocessEnv({
      parent: {
        ENGINE_TOKENS: 'engine-secret',
        EMAIL_PASS: 'mail-pass',
        FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/hook/TOKEN',
        EMAIL_USER: 'synova@localhost',
        LANG: 'C',
      },
      declared: {},
    });
    expect(env['ENGINE_TOKENS']).toBeUndefined();
    expect(env['EMAIL_PASS']).toBeUndefined();
    expect(env['FEISHU_WEBHOOK_URL']).toBeUndefined();
    // 非敏感的同前缀键不受牵连（证明是"按后缀判"，不是"按前缀黑名单"）
    expect(env['EMAIL_USER']).toBe('synova@localhost');
    expect(env['LANG']).toBe('C');
  });
});

// ════════════════════════════════════════════════════════════════
// U-3 · 纯函数 · 反例②`declared` 显式放行优先
// ════════════════════════════════════════════════════════════════

describe('#1209 U-3 反例② — declared 显式放行优先', () => {
  it('U-3 parent={BRAVE_API_KEY:secret}、declared={BRAVE_API_KEY:declared-value} ⇒ === declared-value', () => {
    const env = buildSubprocessEnv({
      parent: { BRAVE_API_KEY: 'secret' },
      declared: { BRAVE_API_KEY: 'declared-value' },
    });
    expect(env['BRAVE_API_KEY']).toBe('declared-value');
    expect(Object.keys(env)).toEqual(['BRAVE_API_KEY']);
  });

  it('U-3b declared 里未声明的同类敏感名仍被剔除（放行是逐键的，不是整表放开）', () => {
    const env = buildSubprocessEnv({
      parent: { BRAVE_API_KEY: 's1', GITHUB_TOKEN: 's2' },
      declared: { BRAVE_API_KEY: 'declared-value' },
    });
    expect(env['BRAVE_API_KEY']).toBe('declared-value');
    expect(env['GITHUB_TOKEN']).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════
// U-4 · 边界值（六格，逐个断言）＋ 定点用例
// ════════════════════════════════════════════════════════════════

describe('#1209 U-4 边界值 — 六格逐个断言', () => {
  it('U-4-① 空 parent ⇒ 空对象（不抛、不回落全量继承）', () => {
    const env = buildSubprocessEnv({ parent: {}, declared: {} });
    expect(env).toEqual({});
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('U-4-② 空 declared ⇒ 只按 parent 判定（敏感名照剔）', () => {
    const env = buildSubprocessEnv({ parent: { PATH: '/bin', JWT_SECRET: 'x' } });
    expect(env['PATH']).toBe('/bin');
    expect(env['JWT_SECRET']).toBeUndefined();
  });

  it('U-4-③ 恰临界：键名正好以 _KEY 结尾但被 declared 声明 ⇒ 放行（declared 后合并）', () => {
    const env = buildSubprocessEnv({
      parent: { JIRA_PROJECT_KEY: 'PROJ' },
      declared: { JIRA_PROJECT_KEY: 'PROJ' },
    });
    expect(env['JIRA_PROJECT_KEY']).toBe('PROJ');
  });

  it('U-4-③b 同一键未声明 ⇒ 被后缀规则误删（已知限制 §4-6：允许，且可用 declared 救回）', () => {
    const env = buildSubprocessEnv({ parent: { JIRA_PROJECT_KEY: 'PROJ' } });
    expect(env['JIRA_PROJECT_KEY']).toBeUndefined();
  });

  it('U-4-④ 非字符串值（{N: 5}）⇒ 丢弃（env 只能字符串）', () => {
    const parent: Record<string, string | undefined> = { PATH: '/bin' };
    defineOwn(parent, 'N', 5);
    defineOwn(parent, 'OBJ', { nested: true });
    const env = buildSubprocessEnv({ parent });
    expect(env['N']).toBeUndefined();
    expect(env['OBJ']).toBeUndefined();
    expect(env['PATH']).toBe('/bin');
  });

  it('U-4-⑤ parent 含自有 __proto__ 一类原型键 ⇒ 不污染原型', () => {
    const parent: Record<string, string | undefined> = { PATH: '/bin' };
    // 自有可枚举 `__proto__`（普通赋值会改原型，故必须用 defineProperty 才能造出"入参带 __proto__"）
    defineOwn(parent, '__proto__', 'proto-string');
    defineOwn(parent, 'polluted', { polluted: 'yes' });
    const env = buildSubprocessEnv({ parent });

    expect(Object.keys(env)).not.toContain('__proto__');
    // 🔴 不能用 `env['__proto__']` 判（普通对象上它读到的是原型，不是键）；必须判"自有属性"：
    expect(Object.prototype.hasOwnProperty.call(env, '__proto__')).toBe(false);
    // 原型未被污染（三点）：结果对象的原型仍是 Object.prototype、全局 Object.prototype 无新键、
    // 普通对象上取不到 'polluted' 这个"污染痕迹"
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
    const fresh: Record<string, unknown> = {};
    expect(fresh['polluted']).toBeUndefined();
  });

  it('U-4-⑥ 返回对象 !== 入参（新对象语义）且不修改入参', () => {
    const parent: Record<string, string | undefined> = { PATH: '/bin', JWT_SECRET: 'x' };
    const declared: Record<string, string | undefined> = { LANG: 'C' };
    const env = buildSubprocessEnv({ parent, declared });

    expect(env).not.toBe(parent);
    expect(env).not.toBe(declared);
    // 入参未被修改：敏感键仍在入参里（剔除只影响输出）
    expect(parent['JWT_SECRET']).toBe('x');
    expect(parent).toEqual({ PATH: '/bin', JWT_SECRET: 'x' });
    expect(declared).toEqual({ LANG: 'C' });
    // 改输出不回流到入参
    env['PATH'] = '/mutated';
    expect(parent['PATH']).toBe('/bin');
  });

  it('U-4-⑦ 劣输入 ⇒ 抛 typed error（name/code/phase/retryable），不回落到全量继承', () => {
    // 负例需要"绕过静态类型"传非法值：用 Reflect.apply（参数列表类型宽松）而**不用 `as` 断言穿透**（铁律 38）
    expect(() => invokeWithRuntimeInput([null])).toThrow(/SUBPROCESS_ENV_INVALID/);
    let caught: unknown;
    try {
      invokeWithRuntimeInput([{ parent: undefined }]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(errorField(caught, 'name')).toBe('SubprocessEnvInvalidError');
    expect(errorField(caught, 'code')).toBe('SUBPROCESS_ENV_INVALID');
    expect(errorField(caught, 'phase')).toBe('subprocess-spawn');
    expect(errorField(caught, 'retryable')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════
// U-5 · 真 spawn：假 MCP server 把自身 env 写文件
// ════════════════════════════════════════════════════════════════

/**
 * 假 MCP server（`.cjs`，不是合规 MCP server）：
 *   ① 启动即把自身 `process.env` 写进 `<outPath>`（**这是判据的唯一信号源**）；
 *   ② 顺带应答 JSON-RPC（initialize / tools/list），让 `bridge.connect()` 正常返回、
 *      不触发 `sendRequest` 的 30s 超时（否则用例要等 30s，且 pending 计时器留到测试结束）；
 *   ③ 存活 ~500ms 后自行退出（规格 §3 U-5 步骤 1：避免 stdin EPIPE）。
 */
const PROBE_SERVER_CODE = `
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], JSON.stringify(process.env), 'utf-8');

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); } catch { continue; } // 非 JSON 行忽略（假 server 容错，不是生产静默降级）
    const result = request.method === 'tools/list'
      ? { tools: [] }
      : { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'envprobe', version: '0.0.0' } };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
  }
});

setTimeout(() => { process.exit(0); }, 500);
`;

/** 5s 内轮询读 env 文件（100ms 一次）；读不到 ⇒ throw（判据不可判定 ≠ 通过） */
async function waitForEnvFile(filePath: string, timeoutMs: number, pollMs: number): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      try {
        return toStringEnv(JSON.parse(readFileSync(filePath, 'utf-8')));
      } catch {
        // 文件可能正在写：继续轮询
      }
    }
    await sleep(pollMs);
  }
  throw new Error(
    `夹具失败：${String(timeoutMs)}ms 内没读到假 MCP server 的 env 文件 ${filePath}`
      + '（子进程未 spawn 或未写文件 ⇒ U-5 不可判定，不得当成通过）',
  );
}

describe('#1209 U-5 真 spawn — 子进程 env 只有白名单', () => {
  /** 父进程注入的 4 个机密（若子进程全量继承，它们必然出现在子进程 env ⇒ U-6-1 才有判别力） */
  const SECRET_KEYS = ['JWT_SECRET', 'CREDENTIAL_MASTER_KEY', 'ENGINE_TOKENS', 'EMAIL_PASS'] as const;
  const PARENT_SECRET_VALUE = 's0-2a-parent-secret-value';
  /** declared 键：`_TOKEN` 结尾 ⇒ 只有 declared 放行才能透传；父进程同名值必须被声明值覆盖 */
  const DECLARED_KEY = 'SUBPROCESS_ENV_PROBE_TOKEN';
  const DECLARED_VALUE = 'declared-value-must-win';
  const PARENT_VALUE_FOR_DECLARED = 'parent-value-must-not-leak';
  /** 非敏感透传键（父值应原样到达子进程） */
  const PASSTHROUGH_KEY = 'SUBPROCESS_ENV_PROBE_PLAIN';
  const PASSTHROUGH_VALUE = 'plain-value-passthrough';

  const ORIGINAL_ENV: Record<string, string | undefined> = {};
  let probeDir = '';
  let bridge: MCPBridge | null = null;

  afterAll(async () => {
    if (bridge) await bridge.shutdown();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
  });

  it('U-5 子进程里：4 个机密不在、PATH 在且等于父值、declared 键在且为声明值、非敏感键透传', async () => {
    probeDir = mkdtempSync(join(tmpdir(), 'synova-1209-envprobe-'));
    const probeFile = join(probeDir, 'env.json');
    const scriptPath = join(probeDir, 'env-probe-server.cjs');
    writeFileSync(scriptPath, PROBE_SERVER_CODE, 'utf-8');

    // ① 父进程注入机密（快照 → 注入；afterAll 还原）
    for (const key of [...SECRET_KEYS, DECLARED_KEY, PASSTHROUGH_KEY]) {
      ORIGINAL_ENV[key] = process.env[key];
    }
    for (const key of SECRET_KEYS) process.env[key] = PARENT_SECRET_VALUE;
    process.env[DECLARED_KEY] = PARENT_VALUE_FOR_DECLARED;
    process.env[PASSTHROUGH_KEY] = PASSTHROUGH_VALUE;
    // 前置事实自证：注入真的生效（否则"机密不在子进程"可能只是父进程本来就没有 ⇒ 假绿）
    expect(process.env[SECRET_KEYS[0]]).toBe(PARENT_SECRET_VALUE);

    // ② 真 MCPBridge（注入假 server 配置 = U-5 的唯一动机；不绕过 bridge 直接 spawn）
    bridge = new MCPBridge({
      envprobe: {
        name: 'envprobe',
        command: process.execPath,
        args: [scriptPath, probeFile],
        env: { [DECLARED_KEY]: DECLARED_VALUE },
      },
    });

    // ③ 判据只读**文件**（不依赖 connect 返回值 / stdout）
    const connectOutcome = bridge.connect('envprobe')
      .then((tools) => ({ status: 'resolved' as const, tools }))
      .catch(() => ({ status: 'rejected' as const, tools: [] }));
    const childEnv = await waitForEnvFile(probeFile, 5_000, 100);

    // ④ 断言：4 个机密**不在**子进程 env（U-6-1 的判别点就是这四条）
    for (const key of SECRET_KEYS) {
      expect(childEnv[key], `${key} 不得出现在子进程 env`).toBeUndefined();
    }
    // ⑤ PATH 在且与父值一致（避免"spawn 失败但用例仍绿"）
    expect(childEnv['PATH']).toBeDefined();
    expect(childEnv['PATH']).toBe(process.env['PATH']);
    // ⑥ declared 键在，且值 = 声明值（不是父进程值 ⇒ 证明 declared 后合并、优先）
    expect(childEnv[DECLARED_KEY]).toBe(DECLARED_VALUE);
    expect(childEnv[DECLARED_KEY]).not.toBe(PARENT_VALUE_FOR_DECLARED);
    // ⑦ 非敏感键照常透传（证明"不是把 env 清空"）
    expect(childEnv[PASSTHROUGH_KEY]).toBe(PASSTHROUGH_VALUE);

    // ⑧ 真 spawn 链路走完（initialize + tools/list 都被应答）⇒ 证明确实经过 MCPBridge
    const outcome = await withTimeout(connectOutcome, 3_000, { status: 'timeout' as const, tools: [] });
    expect(outcome.status).toBe('resolved');
    expect(outcome.tools).toEqual([]);
  });

  it('U-5b 注入配置是"替换不是合并"：未声明的 server 名 ⇒ 抛未知（不误用 MCP_SERVERS）', async () => {
    const local = new MCPBridge({ envprobe: { name: 'envprobe', command: process.execPath, args: ['-e', ''] } });
    await expect(local.connect('brave-search')).rejects.toThrow('未知 MCP Server: brave-search');
    await local.shutdown();
  });
});
