/**
 * src/cron/cron-config.ts — 循环 cron 口径配置化（#1454 B8）
 *
 * 背景（#1454 B8，CTO 2026-10-09 裁定）：
 *   `loop-3-ga-evolution` 的 cron 被硬编码为 `0 9 1 * / 3 *`（季度）⇒
 *   `MIN_TRIGGER_COUNT = 3`（`src/loops/middle-evolution-engine.ts`）的
 *   「累计 3 次同 key 纠错即触发」语义被季度窗口废掉 —— 最坏情况要 9 个月才凑够 3 次。
 *   本模块把 cron 口径**抽成配置**，默认日频 ⇒ 恢复设计语义；想配季度仍然可以配。
 *
 * 配置源（按优先级，后者不覆盖前者）：
 *   ① 环境变量 `SYNOVA_CRON_<UPPER_JOB_NAME>`（`-`/`.`/空格 → `_`）
 *      例：`SYNOVA_CRON_LOOP_3_GA_EVOLUTION='0 9 1 * / 3 *'`
 *   ② 配置文件 `${SYNOVA_CRON_CONFIG:-<dataDir>/cron-loops.json}`，形状：
 *      `{ "loop-3-ga-evolution": "0 9 * * *", ... }`
 *   ③ `DEFAULT_LOOP_CRON`（本文件）—— 唯一默认事实源，默认**日频**
 *
 * 契约:
 *   @input  无（自读 env / 配置文件）；`resolveLoopCron(jobName)` 入参为 job 名
 *   @output 合法的 5 字段 cron 表达式（字符串）
 *   @degraded 配置文件缺失 / 非法 JSON / 值不是 5 字段串 / 写集外 key ⇒
 *             `log.warn` 并回落到默认值（**不抛**；单个 key 坏不影响其他 key）
 *   @invariant 返回值恒为 5 字段；调用方拿到的表达式一定可被 nextCronTime 解析
 */
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '@synova/logger';

const log = createLogger('cron/cron-config');

/**
 * 循环 job 名的默认 cron 口径（唯一事实源）。
 *
 * 🔴 口径纪律（卡面 §③「不改变任何循环的业务语义」）：下表**逐行对齐
 * `origin/main@5a6591c4a:src/loops/loop-scheduler.ts:95-120`的原值**，
 * **唯一**例外是 `loop-3-ga-evolution` —— 卡面 B8 点名其默认改为**日频**
 * （季度窗口废掉 `MIN_TRIGGER_COUNT = 3` 的「累计 3 次即触发」语义）。
 * 其余 5 个循环的节律一律保持原样：**本卡没有授权改它们的触发频率**
 * （loop-1 企业诊断原为季度，日频会把它变成每天一次全量诊断 —— 成本量级变化，不属本卡）。
 */
export const DEFAULT_LOOP_CRON: Readonly<Record<string, string>> = Object.freeze({
  'loop-1-diagnosis': '0 9 1 */3 *', // 原值（季度）— 未获批变更，保持
  'loop-2-navigation': '0 9 * * 1', // 原值（周一）
  'loop-3-ga-evolution': '0 9 * * *', // 🔴 本卡 B8 唯一显式变更：季度 → 日频
  'loop-4-self-check': '0 0 * * *', // 原值（每日）
  'loop-5-knowledge': '0 0 * * 0', // 原值（周日）
  'loop-6-overflow': '0 9 1 * *', // 原值（每月 1 日）
});

/** 5 字段校验（与 nextCronTime 同口径：空白分隔、非空） */
function isValidCron(expr: unknown): expr is string {
  if (typeof expr !== 'string') return false;
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => p.length > 0);
}

/** job 名 → 环境变量键：大写 + 非字母数字转 `_` */
function envKeyFor(jobName: string): string {
  return `SYNOVA_CRON_${jobName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/**
 * 读取配置文件（缺失/坏 JSON ⇒ 空对象 + log.warn）。
 *
 * @input  filePath — 配置文件绝对路径
 * @output 解析后的键值对（仅保留值形态合法的项）
 * @degraded 文件不存在 ⇒ log.debug（未配置是正常态）；JSON 坏 ⇒ log.warn
 */
function readConfigFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    log.debug({ filePath }, 'cron 配置文件不存在 — 使用默认口径');
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn({ filePath }, 'cron 配置根不是对象 — 忽略配置文件');
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (err: unknown) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), filePath },
      'cron 配置 JSON 解析失败 — 忽略配置文件并回落默认',
    );
    return {};
  }
}

/**
 * 解析某个循环 job 的 cron 表达式。
 *
 * @input  jobName — 循环 job 名（如 `loop-3-ga-evolution`）
 *         opts.dataDir — 数据目录（缺省取 `SYNOVA_DATA_DIR`；再缺省不读文件）
 * @output 5 字段 cron 表达式
 * @degraded 配置值非法 ⇒ log.warn + 回落默认
 */
export function resolveLoopCron(jobName: string, opts?: { dataDir?: string }): string {
  const fallback = DEFAULT_LOOP_CRON[jobName] ?? '0 9 * * *';

  const envRaw = process.env[envKeyFor(jobName)];
  if (envRaw !== undefined && envRaw !== '') {
    if (isValidCron(envRaw)) return envRaw.trim();
    log.warn({ jobName, envKey: envKeyFor(jobName), value: envRaw }, 'cron 环境变量非法（非 5 字段）— 回落默认');
  }

  const dataDir = opts?.dataDir ?? process.env.SYNOVA_DATA_DIR;
  const filePath = process.env.SYNOVA_CRON_CONFIG
    || (dataDir ? path.join(dataDir, 'cron-loops.json') : '');
  if (!filePath) return fallback;

  const cfg = readConfigFile(filePath);
  if (!(jobName in cfg)) return fallback;

  const value = cfg[jobName];
  if (isValidCron(value)) return value.trim();

  log.warn({ jobName, filePath, value }, 'cron 配置项非法（非 5 字段）— 回落默认');
  return fallback;
}
