/**
 * src/security/master-secret.ts —— 主密钥解析（#838 E-2 · fail-closed）
 *
 * 背景（院方 593 §0.1 ③）: 原四处调用点写成
 *   `process.env.CREDENTIAL_MASTER_KEY || config.engineTokens || (config.devMode ? 'synova-dev-secret' : '')`
 * —— 非 devMode 且两处都没配时得到**空串**（加密层会把它当"有密钥"继续跑 ⇒ 静默降级），
 * devMode 时用**可预测常量**。两者都是 fail-open：缺配置不是拒绝，而是"看起来在工作"。
 *
 * 契约（铁律 47）:
 *   @input  config: { devMode?: boolean; engineTokens?: string }（bootstrap/server 的已加载配置）
 *           ＋ 环境变量 `CREDENTIAL_MASTER_KEY`
 *   @output 非空主密钥字符串
 *   @exit   不直接退出进程；**抛 typed error**（`MasterSecretMissingError`，带 code/phase/retryable），
 *           由启动路径的既有 try/catch 转成"启动失败 + 可读 code"（铁律 32）
 *   @degraded **无降级**：缺配置一律拒绝启动；只有**显式** `devMode === true` 才允许可预测的开发密钥
 *           （且调用方会打 AUTH_DEV_MODE 同类警告——见 server/bootstrap 既有 devMode 日志）
 *
 * 已知限制: 本模块只负责"取哪个值"，不校验密钥强度/轮换（那是 KMS/凭据域的事，另卡）。
 */

class MasterSecretMissingError extends Error {
  readonly code = 'MASTER_SECRET_MISSING';
  readonly phase = 'startup';
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'MasterSecretMissingError';
  }
}

export interface MasterSecretSource {
  devMode?: boolean;
  engineTokens?: string;
}

/** devMode 下的开发密钥（**仅**显式 devMode=true 时使用；与历史值逐字一致，避免 dev 数据打不开）。 */
const DEV_MASTER_SECRET = 'synova-dev-secret';

/**
 * 解析主密钥。优先级: 环境变量 > config.engineTokens > 显式 devMode 常量。
 *
 * @throws MasterSecretMissingError 三段全空且非 devMode（fail-closed，**绝不返回空串**）
 */
export function resolveMasterSecret(config: MasterSecretSource): string {
  const fromEnv = (process.env['CREDENTIAL_MASTER_KEY'] ?? '').trim();
  if (fromEnv) return fromEnv;

  const fromConfig = (config.engineTokens ?? '').trim();
  if (fromConfig) return fromConfig;

  if (config.devMode === true) return DEV_MASTER_SECRET;

  throw new MasterSecretMissingError(
    '主密钥缺失：CREDENTIAL_MASTER_KEY 与 config.engineTokens 均为空，且未显式开启 devMode —— '
      + '拒绝启动（fail-closed）。生产须配置 CREDENTIAL_MASTER_KEY；开发请显式 DEV_MODE=true。'
      + ' [code=MASTER_SECRET_MISSING phase=startup retryable=false]',
  );
}
