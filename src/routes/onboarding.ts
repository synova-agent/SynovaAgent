/**
 * src/routes/onboarding.ts — 建档通道 HTTP 入口（L1 交互）
 *
 * 架构位置: **L1 交互**（`routes/`）→ 调 **⓪-b 人侧入口**的建档流程（`src/onboarding/**`）。
 *   本文件是判据探针的生产入口：`probe-onboarding.ts` 加载本模块 → 取**第一条 POST** →
 *   真起 HTTP server（挂 `jwtAuthMiddleware`）→ POST `{dryRun:true, documents:[]}`。
 *
 * 出处: K12-03（#186）卡面 §Q2 写集 / §Q3 判据 V1（dry-run ⇒ 2xx 且**不落盘**）+ V3（**零表单**）。
 *
 * 🔴 判据 V3「零表单」：本模块**不注册任何 GET 表单页**（无 `GET /api/onboarding/form` 之类）。
 *   `probe-onboarding.ts` 的 `checkZeroForm` 按注册路由表核。
 *
 * 契约（铁律 47）:
 *   @input  — `POST /api/onboarding/start`（**pre-auth**，白名单）与
 *             `POST /api/onboarding/apply`（非 pre-auth，需凭据），body 同形:
 *             `{ documents: string[], roles?: RoleSeed[], dryRun?: boolean,
 *                superAdminConfirmed?: boolean, requestedPermissions?: string[],
 *                documentedPermissions?: string[] }`
 *   @output — 2xx `{ ok: true, data: OnboardingReport & { gapQuestions?: GapQuestionReport } }`；
 *             🔴 **409** `{ ok:false, code:'SUPER_ADMIN_CONFIRMATION_REQUIRED', message, data, degraded:true }`
 *             —— 命中「有落盘意图 ∧ 未超管确认」时**两条入口都拒绝**（裁 425 / C1）；
 *             入参非法 ⇒ 400 `{ok:false,code,message}`；
 *             🔴 **#1075 P1-b seed 缺项（两端点语义不同，钉死）**：
 *               · `/start`（预览）⇒ **不 400**：200 ＋ `data.configPack.rejected[]`（`code`／`missingParams`）
 *                 ＋ `data.degraded:true` —— 预览的职责就是「告诉你缺什么」；
 *               · `/apply`（真落盘）⇒ **400** `{ok:false, error:{code:'ROLE_SEED_INCOMPLETE', missingParams}, degraded:true}`，
 *                 **磁盘零写入**（门序在前 ⇒ 先 409 门、后 seed 校验；本层**不调用** flow）。
 *             内部异常 ⇒ 500 `{ok:false,code:'INTERNAL_ERROR',degraded:true}`（铁律 31）
 *   @degraded — 流程内失败已由 `runOnboardingFlow` 收成 `report.degraded` + `errors[]`，
 *             本层**原样透出**（不吞）；写响应失败才走 500 catch。
 *             拒绝路径（409）必记一条 `log.warn`（code / phase / retryable / degraded:true，禁静默）。
 *
 * 🔴 裁 425 / C1（#1061）—— **真落盘点在 `onboarding-flow.ts:130` 的 `generateConfigPack(...)`**
 *   （`dryRun !== true` 即真写 `extensions/presets/roles/<id>/` 实物 6 件），它在 flow 的 ④ 步；
 *   而 ⑤ 超管确认（`:151` 的 `confirmed`）与 ⑥ `deploy`（`:170`，**只写状态行**）都在它**之后**
 *   ⇒ 旧实现"先 `runOnboardingFlow(input)` 再判 `!superAdminConfirmed`"是**失实的 fail-closed**:
 *   409 发出时文件**已经落盘**。现门控**前移**到调用 flow 之前（`superAdminGateBlocks()`），
 *   拒绝时把落盘意图降级为 dry-run ⇒ **磁盘零写入是事实**，响应仍带完整 report。

 *
 * 🔴 K12-04（#187）接线点: 建档第 ③ 步「追问」的**追问表**由 `buildQuestionTable()` 产出，
 *   随本响应 `data.gapQuestions` 透出（**只加字段，不改既有字段与路由表** ——
 *   本路由不新增任何端点，K12-03 的零表单判据与 `tests/routes/onboarding.test.ts` 不受影响）。
 *   建档阶段企业图**尚未有实例** ⇒ `observed` 取空 ⇒ 全量追问（这是「空图 ⇒ 有序追问表」的生产路径）。
 * @authority — 由 `src/server.ts` 挂载（`/api/onboarding/*`）；`/start` pre-auth 白名单、`/apply` 须凭据；
 *   超管确认门 `superAdminGateBlocks()` 在 flow 之前（裁 425-C1）。
 * @not-here  — 不做建档流程编排（`src/onboarding/onboarding-flow.ts`）；不做配置包生成
 *   （`config-pack-generator.ts`）；不做权限判定（`jwtAuthMiddleware` 负责）。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { runOnboardingFlow, ONBOARDING_STEPS, type OnboardingInput } from '../onboarding/onboarding-flow';
import {
  missingSeedParams,
  type RoleContextSeed,
  type RoleOutputSectionSeed,
  type RoleSeed,
} from '../onboarding/config-pack-generator';
import { buildQuestionTable } from '../onboarding/gap-questioner';

const log = createLogger('routes/onboarding');

/** 从 body 取字符串数组（安全收窄；非法 ⇒ 空数组，由流程判 degraded） */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** 从 body 取非空字符串（非法/空 ⇒ undefined，由缺项判定点名） */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 从 body 取布尔（非 boolean ⇒ undefined，由缺项判定点名） */
function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * 从 body 取上下文清单（形态守卫；逐项要求 `id`/`label`/`source` 非空字符串）。
 *
 * 🔴 非法项**丢弃并 log.warn**（不静默）：丢弃后该角色的 `contexts` 可能变空 ⇒ 由缺项判定点名
 *   `contexts`；**不在此处臆造默认值**（防"缺项被填成空壳"）。
 */
function contextSeeds(value: unknown): RoleContextSeed[] {
  if (!Array.isArray(value)) return [];
  const out: RoleContextSeed[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as { id?: unknown; label?: unknown; source?: unknown; why?: unknown; required?: unknown };
    const id = optionalString(rec.id);
    const label = optionalString(rec.label);
    const source = optionalString(rec.source);
    if (id === undefined || label === undefined || source === undefined) {
      log.warn({ id, label, source }, 'contexts 条目形态非法 — 丢弃该条（缺项由 rejected[] 点名）');
      continue;
    }
    const why = optionalString(rec.why);
    const required = optionalBoolean(rec.required);
    out.push({
      id,
      label,
      source,
      ...(why !== undefined ? { why } : {}),
      ...(required !== undefined ? { required } : {}),
    });
  }
  return out;
}

/**
 * 从 body 取输出模板（形态守卫；`templateId` 缺失 ⇒ undefined＝整体缺项；
 * `sections` 内非法/空 `must` 的节被丢弃 ⇒ sections 变空 ⇒ 缺项判定点名 `outputTemplate.sections`）。
 */
function outputTemplateSeed(value: unknown): RoleSeed['outputTemplate'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const rec = value as { templateId?: unknown; sections?: unknown; emptyState?: unknown };
  const templateId = optionalString(rec.templateId);
  if (templateId === undefined) return undefined;
  const sections: RoleOutputSectionSeed[] = [];
  if (Array.isArray(rec.sections)) {
    for (const raw of rec.sections) {
      if (typeof raw !== 'object' || raw === null) continue;
      const section = raw as { id?: unknown; title?: unknown; must?: unknown };
      const id = optionalString(section.id);
      const title = optionalString(section.title);
      const must = stringList(section.must);
      if (id === undefined || title === undefined || must.length === 0) {
        log.warn({ id, title, mustItems: must.length }, 'outputTemplate.sections 节形态非法 — 丢弃该节');
        continue;
      }
      sections.push({ id, title, must });
    }
  }
  const emptyState = optionalString(rec.emptyState);
  return { templateId, sections, ...(emptyState !== undefined ? { emptyState } : {}) };
}

/** 从 body 取角色种子（形态守卫；非法项丢弃并记 log） */
function roleSeeds(value: unknown): RoleSeed[] {
  if (!Array.isArray(value)) return [];
  const out: RoleSeed[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as {
      roleId?: unknown;
      knowledgeScope?: unknown;
      capabilities?: unknown;
      acceptanceCriteria?: unknown;
      contexts?: unknown;
      systemAddendum?: unknown;
      outputTemplate?: unknown;
    };
    if (typeof rec.roleId !== 'string' || rec.roleId.length === 0) continue;
    const systemAddendum = optionalString(rec.systemAddendum);
    const outputTemplate = outputTemplateSeed(rec.outputTemplate);
    out.push({
      roleId: rec.roleId,
      knowledgeScope: stringList(rec.knowledgeScope),
      capabilities: stringList(rec.capabilities),
      acceptanceCriteria: stringList(rec.acceptanceCriteria),
      contexts: contextSeeds(rec.contexts),
      ...(systemAddendum !== undefined ? { systemAddendum } : {}),
      ...(outputTemplate !== undefined ? { outputTemplate } : {}),
    });
  }
  return out;
}

/**
 * 汇总多角色的缺项（去重保序；`/apply` 400 body 的 `missingParams` 来源）。
 *
 * 🔴 复用 generator 的 `missingSeedParams()`（**唯一缺项口径**；本文件不自判）。
 */
function collectMissingParams(roles: readonly RoleSeed[]): string[] {
  const out: string[] = [];
  for (const role of roles) {
    for (const param of missingSeedParams(role)) {
      if (!out.includes(param)) out.push(param);
    }
  }
  return out;
}

const router = Router();

// ════════════════════════════════════════════════════════════════
// 裁 425 / C1: 超管确认门（**一处**门控，两条入口共用）
// ════════════════════════════════════════════════════════════════

/**
 * 是否必须拒绝本次请求（未超管确认 ∧ 有落盘意图）。
 *
 * 为什么必须在**调用 `runOnboardingFlow` 之前**判: 真落盘点是 flow ④ 的
 *   `generateConfigPack(...)`（`dryRun !== true` 即真写盘），早于 ⑤ 确认与 ⑥ 状态步
 *   ⇒ 在 flow 返回后判 = 文件已落盘（本卡要杀的正是这个）。
 *
 * @input  input — 已收窄的 `OnboardingInput`（`dryRun`/`superAdminConfirmed` 只认 `=== true`）
 * @output `true` = 拒绝（把落盘意图降级为 dry-run ＋ 回 409）；`false` = 放行
 * @exit   不抛（纯判定，无 IO）
 * @degraded 无。拒绝路径的留痕由调用点 `logSuperAdminConfirmationRequired()` 承担。
 */
function superAdminGateBlocks(input: OnboardingInput): boolean {
  // `dryRun !== true` = **有落盘意图**（`dryRun` 缺省即"要写"，与 flow 的判定口径逐字一致）
  return input.dryRun !== true && input.superAdminConfirmed !== true;
}

/**
 * 拒绝路径留痕（铁律 11/32 —— **禁静默**）: code ＋ phase ＋ retryable ＋ degraded:true 四件齐。
 *
 * @input  entry — 命中的入口路径（`/api/onboarding/start` ｜ `/api/onboarding/apply`），用于区分两条入口
 * @output 无（副作用仅一条 `log.warn`）
 * @exit   不抛（日志失败不改变业务拒绝的语义）
 * @degraded 本函数**就是**降级上报本身：`degraded:true` ＋ `retryable:true`（补确认后重试即可）
 */
function logSuperAdminConfirmationRequired(entry: string): void {
  log.warn(
    {
      code: 'SUPER_ADMIN_CONFIRMATION_REQUIRED',
      phase: 'onboarding:super-admin-confirmation-gate',
      retryable: true,
      degraded: true,
      entry,
    },
    '安全判据: 被拒绝 — 未超管确认且有落盘意图，已挡在 generateConfigPack 之前（磁盘零写入）',
  );
}

/**
 * `POST /api/onboarding/start` — 建档入口（**pre-auth**，见 `auth.ts` isWhitelisted 的 K12-03 条目）。
 * 首条 POST = 判据探针实际驱动的端点，故本路由**先注册**。
 */
router.post('/api/onboarding/start', (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requested: OnboardingInput = {
      documents: stringList(body['documents']),
      roles: roleSeeds(body['roles']),
      // 🔴 rootDir 一律取进程 cwd —— **不接受请求体指定路径**（否则 = 任意路径写入面）
      rootDir: process.cwd(),
      dryRun: body['dryRun'] === true,
      superAdminConfirmed: body['superAdminConfirmed'] === true,
      requestedPermissions: stringList(body['requestedPermissions']),
      documentedPermissions: stringList(body['documentedPermissions']),
    };
    // 🔴 裁 425/C1 门控（**在 flow 之前**）: 拒绝时把落盘意图降级为 dry-run
    //   ⇒ flow ④ `generateConfigPack` 只算 planned、不写盘（磁盘零写入是事实，不是承诺）。
    const blocked = superAdminGateBlocks(requested);
    const input: OnboardingInput = blocked ? { ...requested, dryRun: true } : requested;
    const report = runOnboardingFlow(input);
    // 建档第 ③ 步：追问表（本体缺口驱动；建档期图未实例化 ⇒ 空图 ⇒ 全量追问）
    //   自足失败面：本体缺/坏 ⇒ gapQuestions.degraded=true + errors[]（不抛，不拖垮建档主流程）
    const gapQuestions = buildQuestionTable({ observed: { nodes: [], edges: [] }, rootDir: process.cwd() });
    if (blocked) {
      logSuperAdminConfirmationRequired('/api/onboarding/start');
      res.status(409).json({
        ok: false,
        code: 'SUPER_ADMIN_CONFIRMATION_REQUIRED',
        message: '超管确认后方可落盘',
        data: { ...report, gapQuestions },
        degraded: true,
      });
      return;
    }
    log.info({ dryRun: input.dryRun === true, degraded: report.degraded }, '建档请求已处理');
    res.json({ ok: true, data: { ...report, gapQuestions } });
  } catch (err: unknown) {
    // 铁律 24/31: 不空吞 —— log.error + degraded 标记 + 500
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, '建档请求处理失败');
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: msg, degraded: true });
  }
});

/** `POST /api/onboarding/apply` — 正式落盘（**须超管确认**；非 pre-auth）。 */
router.post('/api/onboarding/apply', (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requested: OnboardingInput = {
      documents: stringList(body['documents']),
      roles: roleSeeds(body['roles']),
      rootDir: process.cwd(),
      dryRun: false,
      superAdminConfirmed: body['superAdminConfirmed'] === true,
      requestedPermissions: stringList(body['requestedPermissions']),
      documentedPermissions: stringList(body['documentedPermissions']),
    };
    // 🔴 裁 425/C1 门控前移（**改写的失实注释**）: 旧注释声称「流程内部已 skip deploy ⇒ 未确认不落盘」——
    //   不成立。真落盘点是 flow ④ `generateConfigPack`（`dryRun!==true` 即真写盘），而 ⑤ 确认
    //   在其后、⑥ `deploy` 只写状态行 ⇒ 在 flow 返回后才判，文件**已经**落盘。
    //   现在门在 flow 之前：拒绝 = 落盘意图降级为 dry-run（磁盘零写入）＋ 409 ＋ log.warn。
    const blocked = superAdminGateBlocks(requested);
    const input: OnboardingInput = blocked ? { ...requested, dryRun: true } : requested;
    // 🔴 #1075 P1-b（**门序不回退**：先门后 seed 校验）—— 已确认请求若 seed 缺项 ⇒ 400 且
    //   **不调用 flow**（磁盘零写入：既不写 6 件、也不写 `.synova/onboarding-audit.log`）。
    //   `missingParams` 复用 generator 的 `missingSeedParams()`（唯一缺项口径）。
    if (!blocked) {
      const missing = collectMissingParams(requested.roles ?? []);
      if (missing.length > 0) {
        log.warn(
          { code: 'ROLE_SEED_INCOMPLETE', missingParams: missing, degraded: true, entry: '/api/onboarding/apply' },
          '建档 apply 被拒 — seed 缺项（磁盘零写入；机器判据读 error.missingParams）',
        );
        res.status(400).json({
          ok: false,
          error: { code: 'ROLE_SEED_INCOMPLETE', missingParams: missing },
          degraded: true,
        });
        return;
      }
    }
    const report = runOnboardingFlow(input);
    if (blocked) {
      logSuperAdminConfirmationRequired('/api/onboarding/apply');
      res.status(409).json({
        ok: false,
        code: 'SUPER_ADMIN_CONFIRMATION_REQUIRED',
        message: '超管确认后方可部署',
        data: report,
        degraded: true,
      });
      return;
    }
    res.json({ ok: true, data: report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, '建档 apply 处理失败');
    res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: msg, degraded: true });
  }
});

/** `GET /api/onboarding/steps` — 只读步名清单（**非表单页**；判据 V3 允许只读 GET）。 */
router.get('/api/onboarding/steps', (_req: Request, res: Response) => {
  res.json({ ok: true, data: { steps: ONBOARDING_STEPS } });
});

export default router;
