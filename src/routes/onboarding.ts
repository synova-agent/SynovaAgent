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
 *   @input  — `POST /api/onboarding/start`，body `{ documents: string[], roles?: RoleSeed[],
 *             dryRun?: boolean, superAdminConfirmed?: boolean, requestedPermissions?: string[] }`
 *   @output — `{ ok: true, data: OnboardingReport & { gapQuestions: GapQuestionReport } }`（2xx）；
 *             入参非法 ⇒ 400 `{ok:false,code,message}`；
 *             内部异常 ⇒ 500 `{ok:false,code:'INTERNAL_ERROR',degraded:true}`（铁律 31）
 *   @degraded — 流程内失败已由 `runOnboardingFlow` 收成 `report.degraded` + `errors[]`，
 *             本层**原样透出**（不吞）；写响应失败才走 500 catch。
 *
 * 🔴 K12-04（#187）接线点: 建档第 ③ 步「追问」的**追问表**由 `buildQuestionTable()` 产出，
 *   随本响应 `data.gapQuestions` 透出（**只加字段，不改既有字段与路由表** ——
 *   本路由不新增任何端点，K12-03 的零表单判据与 `tests/routes/onboarding.test.ts` 不受影响）。
 *   建档阶段企业图**尚未有实例** ⇒ `observed` 取空 ⇒ 全量追问（这是「空图 ⇒ 有序追问表」的生产路径）。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import { runOnboardingFlow, ONBOARDING_STEPS, type OnboardingInput } from '../onboarding/onboarding-flow';
import type { RoleSeed } from '../onboarding/config-pack-generator';
import { buildQuestionTable } from '../onboarding/gap-questioner';

const log = createLogger('routes/onboarding');

/** 从 body 取字符串数组（安全收窄；非法 ⇒ 空数组，由流程判 degraded） */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** 从 body 取角色种子（形态守卫；非法项丢弃并记 log） */
function roleSeeds(value: unknown): RoleSeed[] {
  if (!Array.isArray(value)) return [];
  const out: RoleSeed[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as { roleId?: unknown; knowledgeScope?: unknown; capabilities?: unknown; acceptanceCriteria?: unknown };
    if (typeof rec.roleId !== 'string' || rec.roleId.length === 0) continue;
    out.push({
      roleId: rec.roleId,
      knowledgeScope: stringList(rec.knowledgeScope),
      capabilities: stringList(rec.capabilities),
      acceptanceCriteria: stringList(rec.acceptanceCriteria),
    });
  }
  return out;
}

const router = Router();

/**
 * `POST /api/onboarding/start` — 建档入口（**pre-auth**，见 `auth.ts` isWhitelisted 的 K12-03 条目）。
 * 首条 POST = 判据探针实际驱动的端点，故本路由**先注册**。
 */
router.post('/api/onboarding/start', (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: OnboardingInput = {
      documents: stringList(body['documents']),
      roles: roleSeeds(body['roles']),
      // 🔴 rootDir 一律取进程 cwd —— **不接受请求体指定路径**（否则 = 任意路径写入面）
      rootDir: process.cwd(),
      dryRun: body['dryRun'] === true,
      superAdminConfirmed: body['superAdminConfirmed'] === true,
      requestedPermissions: stringList(body['requestedPermissions']),
      documentedPermissions: stringList(body['documentedPermissions']),
    };
    const report = runOnboardingFlow(input);
    // 建档第 ③ 步：追问表（本体缺口驱动；建档期图未实例化 ⇒ 空图 ⇒ 全量追问）
    //   自足失败面：本体缺/坏 ⇒ gapQuestions.degraded=true + errors[]（不抛，不拖垮建档主流程）
    const gapQuestions = buildQuestionTable({ observed: { nodes: [], edges: [] }, rootDir: process.cwd() });
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
    const input: OnboardingInput = {
      documents: stringList(body['documents']),
      roles: roleSeeds(body['roles']),
      rootDir: process.cwd(),
      dryRun: false,
      superAdminConfirmed: body['superAdminConfirmed'] === true,
      requestedPermissions: stringList(body['requestedPermissions']),
      documentedPermissions: stringList(body['documentedPermissions']),
    };
    const report = runOnboardingFlow(input);
    if (!input.superAdminConfirmed) {
      // fail-closed：未确认不落盘（流程内部已 skip deploy；此处给出显式业务码）
      res.status(409).json({ ok: false, code: 'SUPER_ADMIN_CONFIRMATION_REQUIRED', message: '超管确认后方可部署', data: report });
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
