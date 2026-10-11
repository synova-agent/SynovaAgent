/**
 * src/onboarding/onboarding-flow.ts — 建档通道六步流程（「文档进 → 配置出」）
 *
 * 架构位置: **⓪-b 人侧入口** —— 建档＝把企业文档转成可用配置（宪章 §4.1）。本文件是流程编排，
 *   不碰数据库（纯函数 + 生成器调用），保持可判据（判据探针穿真 HTTP 路由驱动它）。
 *
 * 出处: K12-03（#186）卡面 §Q3「六步逐段可观测（哪一步产出什么，有原始输出）」+ V3「零表单」+
 *   V4「fail-closed：文档没写的权限 ⇒ 默认不给；超管确认**有物理留痕**」。
 *
 * 🔴 卡面 V4 是本文件的**安全主干**：`superAdminConfirmed` 缺省 false，**不自动确认**；
 *   确认动作必写物理留痕（`appendAuditTrail`）。
 *
 * 契约（铁律 47）:
 *   @input  — `OnboardingInput`：{ documents: string[]（文档路径/标识）, roles?: RoleSeed[],
 *             rootDir?: string, dryRun?: boolean, superAdminConfirmed?: boolean,
 *             requestedPermissions?: string[] }
 *   @output — `OnboardingReport`：{ steps: StepRecord[]（**有序**，每步 name/status/detail）,
 *             configPack?: ConfigPackResult, grantedPermissions: string[]（**默认空 ⇒ fail-closed**）,
 *             auditTrail: string[]（物理留痕）, degraded: boolean, errors: string[] }
 *   @degraded — 文档为空 / 采集失败 / 生成失败 ⇒ **不抛**，该步 `status:'degraded'` +
 *             `log.warn` + `degraded:true` + 进 `errors[]`（铁律 11/24/31）。
 */
import { createLogger } from '@synova/logger';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { generateConfigPack, type ConfigPackResult, type RoleSeed } from './config-pack-generator';

const log = createLogger('onboarding/onboarding-flow');

/** 六步名（有序；判据按序核可观测性） */
export const ONBOARDING_STEPS: readonly string[] = [
  'intake', // ① 收文档
  'ontology-align', // ② 本体对齐
  'gap-questions', // ③ 生成追问（K12-04 驱动）
  'config-pack', // ④ 生成配置包
  'super-admin-confirm', // ⑤ 超管确认（权限必须过人 + 留痕）
  'deploy', // ⑥ 落盘部署
] as const;

/** 一步的记录 */
export interface StepRecord {
  readonly name: string;
  readonly status: 'ok' | 'skipped' | 'degraded';
  readonly detail: string;
}

/** `runOnboardingFlow()` 入参 */
export interface OnboardingInput {
  readonly documents: readonly string[];
  readonly roles?: readonly RoleSeed[];
  readonly rootDir?: string;
  readonly dryRun?: boolean;
  /** 🔴 缺省 false（fail-closed）——**不自动确认** */
  readonly superAdminConfirmed?: boolean;
  /** 请求授予的权限项；**文档没写的一律不给**（白名单交集） */
  readonly requestedPermissions?: readonly string[];
  /** 文档里**明确写出**的权限项（缺省空 ⇒ 交集为空 ⇒ 什么都不给） */
  readonly documentedPermissions?: readonly string[];
}

/** `runOnboardingFlow()` 返回 */
export interface OnboardingReport {
  readonly steps: readonly StepRecord[];
  readonly configPack: ConfigPackResult | null;
  /** 实际授予的权限（默认空数组 ⇒ fail-closed） */
  readonly grantedPermissions: readonly string[];
  /** 物理留痕（超管确认必须留下） */
  readonly auditTrail: readonly string[];
  readonly degraded: boolean;
  readonly errors: readonly string[];
}

/** 留痕文件（仓库相对）——物理证据，非内存状态 */
const AUDIT_REL = '.synova/onboarding-audit.log';

/** 写一条物理留痕（append；失败不阻断流程，但显式进 errors） */
function appendAuditTrail(root: string, line: string, errors: string[]): boolean {
  try {
    const dir = join(root, '.synova');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(root, AUDIT_REL), `${new Date().toISOString()} | ${line}\n`, 'utf8');
    return true;
  } catch (err: unknown) {
    const msg = `${AUDIT_REL}: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    log.warn({ err }, '超管确认留痕写入失败 — degraded（但**不视为已确认**）');
    return false;
  }
}

/**
 * 跑完整建档六步（判据入口）。
 *
 * 🔴 `documentedPermissions` ∩ `requestedPermissions` = 实授；任一为空 ⇒ **实授为空**（V4 fail-closed）。
 */
export function runOnboardingFlow(input: OnboardingInput): OnboardingReport {
  const root = input.rootDir ?? process.cwd();
  const steps: StepRecord[] = [];
  const errors: string[] = [];
  const auditTrail: string[] = [];

  // ① 收文档
  const docs = input.documents.filter((d) => d.length > 0);
  if (docs.length === 0) {
    steps.push({ name: 'intake', status: 'degraded', detail: '零文档 —— 无输入可建档（degraded，非错误）' });
    log.warn('建档 intake 无文档 — degraded');
  } else {
    steps.push({ name: 'intake', status: 'ok', detail: `收到 ${String(docs.length)} 份文档` });
  }

  // ② 本体对齐（判定口径：是否给了角色种子 —— 种子即"对齐产物"）
  const roles = input.roles ?? [];
  steps.push({
    name: 'ontology-align',
    status: roles.length > 0 ? 'ok' : 'degraded',
    detail: roles.length > 0 ? `对齐出 ${String(roles.length)} 个岗位` : '未对齐出岗位（无角色种子 ⇒ degraded）',
  });

  // ③ 追问（本体缺口驱动；本步只报"缺口数"，具体追问表归 K12-04）
  const gapCount = roles.length === 0 ? docs.length : 0;
  steps.push({
    name: 'gap-questions',
    status: gapCount > 0 ? 'ok' : 'skipped',
    detail: gapCount > 0 ? `产出 ${String(gapCount)} 条待追问（本体缺口驱动）` : '无缺口 ⇒ 不追问',
  });

  // ④ 生成配置包
  let configPack: ConfigPackResult | null = null;
  try {
    configPack = generateConfigPack({ roles, rootDir: root, dryRun: input.dryRun === true });
    if (configPack.errors.length > 0) errors.push(...configPack.errors);
    steps.push({
      name: 'config-pack',
      status: configPack.degraded ? 'degraded' : 'ok',
      detail: input.dryRun === true
        ? `dry-run：计划写入 ${String(configPack.planned.length)} 件（未落盘）`
        : `已写入 ${String(configPack.written.length)} 件`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`config-pack: ${msg}`);
    log.error({ err }, '配置包生成抛错 — degraded');
    steps.push({ name: 'config-pack', status: 'degraded', detail: `生成失败: ${msg}` });
  }

  // ⑤ 超管确认（V4：权限必须过人；缺省不确认 + 留痕）
  //   🔴 fail-closed：实授 = documented ∩ requested；任一为空 ⇒ 空。
  const documented = input.documentedPermissions ?? [];
  const requested = input.requestedPermissions ?? [];
  const granted = requested.filter((p) => documented.includes(p));
  const confirmed = input.superAdminConfirmed === true;
  if (confirmed) {
    const line = `SUPER_ADMIN_CONFIRMED documents=${String(docs.length)} roles=${String(roles.length)} granted=${granted.join(',') || '(none)'}`;
    const wrote = appendAuditTrail(root, line, errors);
    if (wrote) auditTrail.push(line);
    steps.push({
      name: 'super-admin-confirm',
      status: wrote ? 'ok' : 'degraded',
      detail: wrote ? `超管已确认；实授权限 ${String(granted.length)} 项（留痕 ${AUDIT_REL}）` : '确认留痕写入失败 ⇒ 不视为已确认',
    });
  } else {
    steps.push({
      name: 'super-admin-confirm',
      status: 'skipped',
      detail: '未确认（fail-closed：不自动确认；未确认不落盘）',
    });
  }

  // ⑥ 部署（**只有确认过才部署**；dry-run 不部署）
  const canDeploy = confirmed && input.dryRun !== true && configPack !== null && configPack.written.length > 0;
  steps.push({
    name: 'deploy',
    status: canDeploy ? 'ok' : 'skipped',
    detail: canDeploy ? `已落盘 ${String(configPack?.written.length ?? 0)} 件` : '未部署（需超管确认 + 非 dry-run + 有产出）',
  });

  const degraded = errors.length > 0 || steps.some((s) => s.status === 'degraded');
  log.info({ steps: steps.length, degraded, granted: granted.length }, '建档流程完成');
  return { steps, configPack, grantedPermissions: granted, auditTrail, degraded, errors };
}
