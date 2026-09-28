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
 *
 * 降级: resolveCustomerConfig 契约内不抛（degraded 传播）；此处 catch 兜底 log.warn +
 *   degraded JSON——运营者永远拿到可读响应，检查表面本身不成为故障面（铁律 31）。
 */
import { Router, type Request, type Response } from 'express';
import { join } from 'node:path';
import { createLogger } from '@synova/logger';
import { resolveCustomerConfig, DEFAULT_ROOT_NAME } from '../config/customer-config-package';
import { getSettingsRuntime } from '../config/settings-applies';

const log = createLogger('routes/config');
const router = Router();

/** D1053 第二消费者：与 /api/settings/effective 共用同一 boot 生效边界（每请求现读，零缓存 —— M3 判别点）。 */
function settingsBlock(): { keys: unknown[]; undeclared: string[]; degraded: boolean; scope: string } {
  const runtime = getSettingsRuntime();
  return {
    keys: runtime.rows({ includeUndeclared: true, limit: 100 }),
    undeclared: runtime.undeclared,
    degraded: runtime.degraded,
    scope: 'process',
  };
}

router.get('/api/config/dump', async (req: Request, res: Response) => {
  const orgId = typeof req.query.orgId === 'string' ? req.query.orgId.trim() : '';
  if (orgId === '') {
    res.status(400).json({ ok: false, error: 'orgId 必填（?orgId=）', code: 'VALIDATION_ERROR' });
    return;
  }
  try {
    // 与 diagnosis.ts consult 同根（cwd/customer-config，D599 消费点先例，spec §5 接线）
    const roots = [{ path: join(process.cwd(), DEFAULT_ROOT_NAME), trust: 'customer' as const }];
    const mounted = await resolveCustomerConfig(orgId, { roots });
    res.json({
      ok: true,
      orgId: mounted.orgId,
      config: mounted.config,
      provenance: mounted.provenance,
      degraded: mounted.degraded,
      ...(mounted.reason === undefined ? {} : { reason: mounted.reason }),
      audit: mounted.audit,
      settings: settingsBlock(), // D1053 — 第二消费者：与 /api/settings/effective 同值（零 org 维度，scope:'process'）
    });
  } catch (error: unknown) {
    // 防御兜底：resolveCustomerConfig 契约内不抛，此路收敛为 degraded 响应（铁律 24: log + degraded）
    const detail = error instanceof Error ? error.message : String(error);
    log.warn({ err: error, orgId }, 'config/dump 解析异常 — degraded 响应（不抛，铁律 24/31）');
    res.json({
      ok: true,
      orgId,
      config: {},
      provenance: [],
      degraded: true,
      reason: `客户配置解析异常: ${detail}`,
      audit: [],
      settings: { keys: [], undeclared: [], degraded: true, scope: 'process' }, // D1053 — 降级分支同样增列（形状一致，R7）
    });
  }
});

export default router;
