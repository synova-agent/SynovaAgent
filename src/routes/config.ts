/**
 * config.ts — 客户配置检查表面（D600，DSH --dump-config 三件套最后一件）
 *
 * spec: docs/plans/codex/implementation/SYNOVA-IMPL-D600-cfg-productize-first-command-20260908.md §3.1
 * 依赖: D599 resolveCustomerConfig（src/config/customer-config-package.ts，复用不重写四层解析）。
 *
 * 契约（铁律 47）:
 *   GET /api/config/dump?orgId=... — 只读检查表面：返回该 orgId 四层叠加的实际生效配置
 *   （泄漏键已剥离）+ 逐层来源 provenance + degraded 标记。
 *   - orgId 缺省/非字符串 → 400 VALIDATION_ERROR（校验错误，非降级）。
 *   - 无包/broken/可选层损坏/解析异常 → 200 + degraded:true + reason（铁律 24/31，不抛）。
 *   - 只读：本端点不写任何配置（spec 决策点 3「--dump-config 可检查实际生效配置」）。
 *   - 出站脱敏（914-Q2／裁 366）: `config` 与 `provenance[].doc` 双面结构性脱敏——秘密段名
 *     （SECRET_SEGMENTS）的槽位跨 wire 只传 `{configured}`；`secrets` 侧车只给
 *     `{path, configured, source}`（有无 ＋ 来源层），任何秘密值（含末 4 位）不出现在 body。
 *
 * 降级: resolveCustomerConfig 契约内不抛（degraded 传播）；脱敏抛 ConfigRedactError 亦落此处
 *   （fail-closed：宁可不给，不泄漏）。catch 兜底 log.warn + degraded JSON——运营者永远拿到
 *   可读响应，检查表面本身不成为故障面（铁律 31/24）。
 */
import { Router, type Request, type Response } from 'express';
import { join } from 'node:path';
import { createLogger } from '@synova/logger';
import { resolveCustomerConfig, DEFAULT_ROOT_NAME } from '../config/customer-config-package';
import { redactSecrets, resolveSecretSource, ConfigRedactError } from '../config/redact';

const log = createLogger('routes/config');
const router = Router();

router.get('/api/config/dump', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId.trim() : '';
  if (orgId === '') {
    res.status(400).json({ ok: false, error: 'orgId 必填（?orgId=）', code: 'VALIDATION_ERROR' });
    return;
  }
  // #838 E-2 ②（fail-closed）: 租户守卫 —— 原实现无任何身份比对，任意调用方可凭 `?orgId=` 读
  //   任意组织的生效配置（跨租户读）。现口径：验签身份的组织必须存在且与 orgId 一致；
  //   身份缺失 ⇒ auth_org_missing；不一致 ⇒ org_mismatch（二态与 middleware/auth.ts
  //   `evaluateCrossOrgAccess` 同义，避免两套说法）。DevMode 下 req.auth 由中间件按实例组织注入。
  const auth = (req as Request & { auth?: { orgId?: string } }).auth;
  const identity = typeof auth?.orgId === 'string' ? auth.orgId.trim() : '';
  if (!identity || identity !== orgId) {
    res.status(403).json({
      ok: false,
      error: '跨租户访问被拒绝（声明 orgId 与验签身份不一致）',
      code: 'CROSS_ORG_DENIED',
      reason: identity ? 'org_mismatch' : 'auth_org_missing',
    });
    return;
  }
  try {
    // 与 diagnosis.ts consult 同根（cwd/customer-config，D599 消费点先例，spec §5 接线）
    const roots = [{ path: join(process.cwd(), DEFAULT_ROOT_NAME), trust: 'customer' as const }];
    const mounted = await resolveCustomerConfig(orgId, { roots });
    // 914-Q2 ①: 出站结构性脱敏——合并配置的秘密槽只留 `{configured}`（DSH redact 同纪律：
    //   先移除值再跨 wire；侧车记录"有无 ＋ 来源"，不回显任何值片段）。
    const redacted = redactSecrets(mounted.config);
    // 914-Q2 ②: 第二泄漏面——provenance 的层文档原貌（剥离前快照）逐层替换为脱敏副本，
    //   layer/present/contributedKeys 等来源元数据一律不变。
    const provenance = mounted.provenance.map((row) =>
      row.doc === null ? row : { ...row, doc: redactSecrets(row.doc).value },
    );
    res.json({
      ok: true,
      orgId: mounted.orgId,
      config: redacted.value,
      secrets: redacted.secrets.map((slot) => ({
        path: slot.path,
        configured: slot.configured,
        source: resolveSecretSource(slot.path, mounted.provenance),
      })),
      provenance,
      degraded: mounted.degraded,
      ...(mounted.reason === undefined ? {} : { reason: mounted.reason }),
      audit: mounted.audit,
    });
  } catch (error: unknown) {
    // 防御兜底：resolveCustomerConfig 契约内不抛，此路收敛为 degraded 响应（铁律 24: log + degraded）
    // 914-Q2: 脱敏失败（ConfigRedactError，未知容器 fail-closed）亦落此处 —— 宁可不给，不泄漏。
    const detail = error instanceof Error ? error.message : String(error);
    const code = error instanceof ConfigRedactError ? error.code : undefined;
    log.warn({ err: error, orgId, code }, 'config/dump 解析/脱敏异常 — degraded 响应（不抛，铁律 24/31）');
    res.json({
      ok: true,
      orgId,
      config: {},
      secrets: [],
      provenance: [],
      degraded: true,
      reason: `客户配置解析异常: ${detail}`,
      audit: [],
    });
  }
});

export default router;
