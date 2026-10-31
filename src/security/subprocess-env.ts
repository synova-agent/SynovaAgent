/**
 * src/security/subprocess-env.ts — 子进程 env 白名单构造（#1209 · R-S0-2a 进程边界）
 *
 * 背景：本仓有 3 处把父进程环境**全量继承**给子进程（`providers/python-bridge.ts:23-27`、
 * `mcp/bridge.ts:110`、`routes/cockpit.ts:52`）——即**子进程全量继承父进程环境**。
 * 其中 `mcp/bridge.ts:110` 的子进程是 `vendor/mcp-servers/` 的**第三方代码**，
 * 它因此可以直接读到 `JWT_SECRET` / `CREDENTIAL_MASTER_KEY`。本模块把"传下去什么"收口到一处。
 *
 * 契约（铁律 47）:
 *   @input  parent   —— 父进程环境（通常 `process.env`；只取字符串值）
 *           declared —— 子进程**显式声明**需要的键（如 MCP `config.env` 的 `BRAVE_API_KEY`、
 *                       `python-bridge` 的 `PYTHONUNBUFFERED`/`PYTHONPATH`）。可选，缺省 `{}`。
 *   @output `Record<string, string>` —— **新对象**（既不是 `parent` 也不是 `declared` 的引用，
 *           也不修改二者）。内容 = `parent` 中的字符串键 **剔除敏感名/原型键** 后，
 *           再**用 `declared` 覆盖**（`declared` 后合并 ⇒ 显式放行优先）。
 *   @exit   **不直接退出进程**。劣输入（`input`/`parent` 非对象）抛 typed error
 *           `SubprocessEnvInvalidError`（`code=SUBPROCESS_ENV_INVALID`、
 *           `phase=subprocess-spawn`、`retryable=false`），由调用方决定"拒绝 spawn"。
 *   @degraded **无降级**：剔除是**确定性**的，不做"要不要剔"的运行时开关；
 *           被剔除的键名一律 `log.warn`（**只列键名，绝不列值**）。
 *   @authority 允许调用者：任何**在本进程内构造子进程 env 的生产代码**（当前 3 处：
 *           `providers/python-bridge.ts`、`mcp/bridge.ts`、`routes/cockpit.ts`）与判据测试。
 *           **不对外暴露为 HTTP/MCP 能力**；不接受用户输入直接驱动 `parent`。
 *   @error  `SubprocessEnvInvalidError`（唯一错误类型，见 `@exit`）。
 *   @not-here 不看"父进程里有没有不该有的键"（只决定"传下去什么"）；不校验 `declared` 内容
 *           是否恰当（那是 MCP 配置面）；不做能力白名单（见「已知限制」4/5）。
 *
 * 已知限制（**显式写清做不到什么**）:
 *   1. 只覆盖本仓 3 处全量继承点；其余 spawn/exec 调用点各自手写 `env:`，本模块不扫、不校验。
 *   2. 不清理父进程环境（只影响子进程拿到什么）。
 *   3. `declared` 内容不受审：MCP server 自己声明的键一律放行
 *      （如 `GITHUB_PERSONAL_ACCESS_TOKEN` 的值取自 `process.env.GITHUB_TOKEN`）⇒
 *      若某 server 声明了不该给的键，本模块**拦不住**（属 MCP 配置面）。
 *   4. **名单法不是白名单**：未来若把密钥命名成 `MYCRED`（无敏感后缀）会漏；能力白名单列 T1-10 议题。
 *   5. **伪阳性（已知，接受）**：`JIRA_PROJECT_KEY` 等以 `_KEY` 结尾的**非机密**配置会被误删；
 *      影响面＝某个非敏感配置读不到；如需保留，把它写进 `declared` 即可。
 *   6. 不覆盖 Windows 特有键（`SystemRoot`/`PATHEXT` 等按"非敏感透传"保守保留，避免 spawn 失败）。
 *   7. 原型键（`__proto__`/`prototype`/`constructor`）**一律丢弃**：env 里没有它们的合法用途，
 *      而普通对象上的 `__proto__` 赋值会改对象自身语义。
 *
 * README 骨架：**N/A** —— 本件是**单函数模块**（一个导出函数 ＋ 一个错误类），
 *   `## Summary / ## Use this package / ## Design philosophy / ## Source map` 那套骨架
 *   是 DSH **多文件包**的结构要求（dsh-code-standards A 节，证据 `dsh-tool-bash/` 目录形态）；
 *   本件没有需要用 Source map 表导航的多文件结构。可维护性信息（契约/限制/哲学）
 *   全部写在本头部，不再另建 README（避免第二份真源漂移）。
 *
 * 设计哲学：**一处构造 env，三处只声明它需要什么**（要什么就写进 `declared`，别指望全量继承）。
 */
import { createLogger } from '@synova/logger';

const log = createLogger('security/subprocess-env');

/**
 * 敏感名规则（**单一后缀规则**，规格 §1.1-3「v1.1 修正」）。
 *
 * `_TOKENS?` 覆盖 `ENGINE_TOKENS`（`src/config.ts:100`）——`_TOKEN$` 会漏掉它；
 * `_PASS` 覆盖 `EMAIL_PASS`（`src/services/email-service.ts:52`）；
 * `_WEBHOOK_URL` 覆盖 `FEISHU_WEBHOOK_URL`（webhook URL 内含机器人 token）。
 *
 * 具名清单**仅作文档化**（不改判定结果）：`JWT_SECRET`／`CREDENTIAL_MASTER_KEY`／
 * `DEEPSEEK_API_KEY`／`GITHUB_TOKEN`／`SYNOVA_ADMIN_KEY` —— 复核实测这些**全部已被本规则命中**，
 * 故**不引入第二条判定分支**（规格 §1.1-3：具名清单不得成为第二套判据）。
 */
const SENSITIVE_SUFFIX = /(_KEY|_TOKENS?|_SECRET|_PASS|_PASSWD|_PASSWORD|_CREDENTIALS?|_WEBHOOK_URL)$/i;

/** 原型链键名：写进 env 对象会改对象自身语义（普通对象上 `__proto__` 赋值改原型）⇒ 一律丢弃。 */
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * 本模块唯一的错误类型（铁律 32：`code`/`phase`/`retryable` 齐全）。
 *
 * 🔴 **不导出**（本仓范式同 `src/security/master-secret.ts:21` 的 `MasterSecretMissingError`）：
 *   接线门禁组 4「新 export 必须被 src/ 引用」把"导出但只在测试里用"判成没接线；
 *   判据侧按 `name` / `code` / `phase` / `retryable` 字段判（见 tests/security/subprocess-env.test.ts）。
 */
class SubprocessEnvInvalidError extends Error {
  readonly code = 'SUBPROCESS_ENV_INVALID';
  readonly phase = 'subprocess-spawn';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'SubprocessEnvInvalidError';
  }
}

/** `buildSubprocessEnv` 的入参（见头部 `@input`）。 */
export interface BuildSubprocessEnvInput {
  /** 父进程环境；只有 `string` 值会被收下（env 只能字符串）。 */
  parent: Record<string, string | undefined>;
  /** 子进程显式声明的键：**后合并**，因此即使命中敏感规则也放行（显式放行优先）。 */
  declared?: Record<string, string | undefined>;
}

/** 已告警过的剔除签名（键名集合排序后拼串）——`routes/cockpit.ts` 是**每请求**调用，
 *  逐次 warn 会刷屏；同一组键只 warn 一次，其余降为 debug（键名仍可见，值永不记录）。 */
const warnedSignatures = new Set<string>();

/**
 * 构造子进程环境：`parent` → 剔除敏感名/原型键 → 合并 `declared`（显式放行优先）→ 新对象。
 *
 * @param input - `{ parent, declared? }`；`parent` 必填对象，`declared` 缺省 `{}`
 * @returns 全新的 `Record<string, string>`（引用与入参不等，且入参不被修改）
 * @throws SubprocessEnvInvalidError `input` 或 `parent` 非对象（`code=SUBPROCESS_ENV_INVALID`）
 */
export function buildSubprocessEnv(input: BuildSubprocessEnvInput): Record<string, string> {
  if (typeof input !== 'object' || input === null || typeof input.parent !== 'object' || input.parent === null) {
    throw new SubprocessEnvInvalidError(
      'buildSubprocessEnv: input 必须是 { parent: object, declared?: object } —— 拒绝构造不可信 env'
        + '（fail-closed，绝不回落到全量继承）'
        + ' [code=SUBPROCESS_ENV_INVALID phase=subprocess-spawn retryable=false]',
    );
  }
  const { parent } = input;
  const declared = input.declared ?? {};

  const env: Record<string, string> = {};
  const strippedNames: string[] = [];

  // ① 底：只收字符串，剔除敏感名 ＋ 原型键
  for (const [key, value] of Object.entries(parent)) {
    if (typeof value !== 'string') continue; // env 只能字符串（U-4「非字符串丢弃」）
    if (PROTOTYPE_KEYS.has(key) || SENSITIVE_SUFFIX.test(key)) {
      strippedNames.push(key);
      continue;
    }
    env[key] = value;
  }

  // ② 覆盖：declared 显式放行**优先** —— 放在剔除之后，所以敏感名只要被声明就能透传（U-3）
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value !== 'string') continue;
    if (PROTOTYPE_KEYS.has(key)) {
      strippedNames.push(key);
      continue;
    }
    env[key] = value;
  }

  // ③ fail loud：剔除可见（**只列键名，绝不列值**；铁律 11/24/31 的"静默降级禁止"）
  if (strippedNames.length > 0) {
    const sorted = [...strippedNames].sort();
    const signature = sorted.join(',');
    if (warnedSignatures.has(signature)) {
      log.debug({ strippedKeys: sorted, count: sorted.length }, '子进程 env 剔除敏感/原型键名（同名组已告警过）');
    } else {
      warnedSignatures.add(signature);
      log.warn({ strippedKeys: sorted, count: sorted.length }, '子进程 env 已剔除敏感/原型键名（只列键名，不列值）');
    }
  }

  return env;
}
