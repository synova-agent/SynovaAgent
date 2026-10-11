/**
 * routes/reload.ts — 热加载端点 (Phase 0 文件优先范式)
 *
 * POST /api/reload — 重新扫描文件目录, 重新加载专家定义。
 * 不需要重启进程。GA 改完 SOUL.md 后调用此端点即可生效。
 *
 * 🔴 #198（K12-15）追加：本端点同时重扫**内容面**（`src/deploy/content-reload.ts`
 *    → `content-registry` 全量 type）。此前装配只在 boot 发生 ⇒ 改 `extensions/` 必须重启。
 *    失败隔离：坏内容**拒绝新绑定**＋留清单＋`degraded=true`，**不影响已运行的引擎**（铁律 31）。
 *
 * 铁律 31: reload 失败返回 degraded 标记, 不影响已运行的引擎。
 */
import { Router, type Request, type Response } from 'express';
import { createLogger } from '@synova/logger';
import type { FileScanner } from '../agent/file-scanner';
import type { ExpertFileLoader } from '../agent/expert-file-loader';
import { reloadContentTypes } from '../deploy/content-reload';
// 铁律 39: L1 不直接引用 L3。ExpertRegistry 由 app.locals DI 注入，运行时由 L2 调用。
// 此处仅需 existence check，不需要具体类型。

const log = createLogger('routes/reload');
const router = Router();

// v3.3 F3: DEFAULT_EXPERT_PROMPTS 已删除。文件优先——无fallback。

router.post('/api/reload', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const report: string[] = [];

  try {
    // 从 app.locals 获取注入的组件
    const scanner = req.app.locals?.fileScanner as FileScanner | undefined;
    const loader = req.app.locals?.expertFileLoader as ExpertFileLoader | undefined;
    const registry = req.app.locals?.container?.expertRegistry as { getPrompt?: (type: string) => string | null } | undefined;

    if (!scanner) {
      res.status(500).json({ ok: false, error: 'FileScanner 未初始化', code: 'SCANNER_NOT_READY', degraded: true });
      return;
    }

    // 1. 重新扫描文件
    const index = scanner.scan();
    report.push(`扫描完成: ${index.experts.length} 个专家, ${index.measurers.length} 个测量器, ${index.knowledge.length} 个知识库`);
    if (index.errors.length > 0) {
      report.push(`⚠️ ${index.errors.length} 个文件读取失败`);
    }

    // 2. v3.3: 清除 yaml 配置缓存
    const { clearExpertConfigCache, loadExpertConfig } = await import('../agent/expert-config-loader');
    clearExpertConfigCache();
    loadExpertConfig(); // 重新加载

    // 3. 重新加载专家文件
    if (loader && registry) {
      const result = loader.loadFromIndex(index, {}); // v3.3: 无fallback
      report.push(`专家加载: ${result.fromFiles} 从文件, ${result.fromDefaults} 默认, ${result.errors.length} 失败`);
    }

    const durationMs = Date.now() - startedAt;

    // 4. #198: 重扫内容面（`extensions/` 全量 type）——改内容**无需重启**
    //    失败隔离：坏内容拒绝新绑定 + 留清单 + degraded 外传；本步**永不抛**（契约见 content-reload.ts）
    const content = await reloadContentTypes();
    report.push(
      `内容面重扫: ${content.reloaded.length} 项已绑定, ${content.retained.length} 项拒绝新绑定` +
        (content.persisted ? `（绑定标识已持久化 → ${content.statePath}）` : '（⚠️ 绑定标识持久化失败 — degraded）'),
    );

    log.info({ durationMs, experts: index.experts.length, contentReloaded: content.reloaded.length }, '/api/reload 完成');

    res.json({
      ok: true,
      durationMs,
      scannedAt: index.scannedAt,
      summary: {
        experts: index.experts.length,
        measurers: index.measurers.length,
        knowledgeIndustries: index.knowledge.length,
        fileErrors: index.errors.length,
      },
      content: {
        reloaded: content.reloaded.map((c) => c.identity),
        retained: content.retained,
        statePath: content.statePath,
        persisted: content.persisted,
        degraded: content.degraded,
      },
      report,
      errors: index.errors.slice(0, 10), // 最多返回前 10 个错误
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, code: 'RELOAD_FAILED', phase: 'runtime', retryable: true }, '/api/reload 失败');
    res.status(500).json({
      ok: false,
      error: msg,
      code: 'RELOAD_FAILED',
      degraded: true,
      durationMs: Date.now() - startedAt,
    });
  }
});

export default router;
