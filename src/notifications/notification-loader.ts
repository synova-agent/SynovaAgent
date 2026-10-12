/**
 * notification-loader.ts — 通知适配器文件驱动加载器 (V3.8)
 *
 * 扫描 extensions/notifications/* /manifest.json, 动态 import 适配器并注册。
 * 替代 file-driven-loaders.ts 中的硬编码 import。
 *
 * Iron law #24: catch + log + degraded.
 *
 * 🔴 K12-17（#200）引擎码归位后的**双位置解析**（宪章约束 4：内核/扩展边界物理可见）:
 *   内容面 `extensions/notifications/<channel>/` = 客户的（**可改可删**）⇒ 只承载**声明**
 *     （manifest.json: channel / config.credentialSchema / displayName）。
 *   宿主面 `src/notifications/<channel>-adapter.ts` = 我们的（**客户不可见**）⇒ 承载**实现**。
 *   ⇒ 解析顺序：① 宿主实现（首选）② 内容侧 entryPoint（客户自带实现的兼容通道）。
 *   ⇒ 为什么实现位置不写进 manifest.entryPoint：manifest 是客户可改文件，而门禁
 *     （CC1）只扫 extensions 下全部 .ts 的 import、**不扫 json 里的路径串** ⇒ 把 `src/…` 写进
 *     json 等于造一条门禁零覆盖的引擎注入通道（#200 方案裁决 X/Y 依据，见卡面与 PR 正文）。
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { createLogger } from '@synova/logger';
import { registerNotificationAdapter, listNotificationChannels } from './registry';
import type { NotificationAdapter } from './types';

const log = createLogger('notifications/loader');

const NOTIFICATIONS_DIR = join(process.cwd(), 'extensions', 'notifications');
/**
 * 宿主实现根（我们的，`src/` 侧）。与 NOTIFICATIONS_DIR 同按 cwd 定位（既有约定）——
 * 🔴 故**调用方 cwd 必须是仓根**，否则两者同时失配（探针/测试必须先断 cwd，见 #200 §Q3）。
 */
const HOST_IMPL_DIR = join(process.cwd(), 'src', 'notifications');

interface ResolvedImplementation {
  /** 实现文件的绝对路径 */
  path: string;
  /** host = 宿主 src/ 侧内置实现；content = 内容侧 manifest 声明的客户自带实现 */
  origin: 'host' | 'content';
}

/**
 * 解析某通知渠道的**实现**位置（模块私有 —— 不新增导出，避免"未接线新 export"）。
 *
 * 契约（铁律 47）:
 *   @input  channel     渠道目录名（= extensions/notifications/ 下的子目录名）
 *           contentDir  该渠道的内容侧目录（承载 manifest.json）
 *           entryPoint  manifest 声明的内容侧实现（可为空）
 *   @output 命中 ⇒ { path, origin }；两侧皆缺 ⇒ null（**由调用方 push error，fail-visible**）
 *           顺序: ① `src/notifications/<channel>-adapter.ts`（宿主内置，首选）
 *                 ② `<contentDir>/<entryPoint || './adapter.ts'>`（内容侧，兼容）
 *   @degraded 无 —— 本函数纯路径判定，不吞错、不猜测
 */
function resolveNotificationImplementation(
  channel: string,
  contentDir: string,
  entryPoint?: string,
): ResolvedImplementation | null {
  const hostPath = join(HOST_IMPL_DIR, `${channel}-adapter.ts`);
  if (existsSync(hostPath)) return { path: hostPath, origin: 'host' };

  const contentPath = join(contentDir, entryPoint || './adapter.ts');
  if (existsSync(contentPath)) return { path: contentPath, origin: 'content' };

  return null;
}

export async function loadAndRegisterNotificationAdapters(): Promise<{ registered: number; errors: string[] }> {
  const errors: string[] = [];
  let registered = 0;

  try {
    if (!existsSync(NOTIFICATIONS_DIR)) {
      errors.push(`通知目录不存在: ${NOTIFICATIONS_DIR}`);
      return { registered: 0, errors };
    }

    const entries = readdirSync(NOTIFICATIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;

      const manifestPath = join(NOTIFICATIONS_DIR, entry.name, 'manifest.json');
      if (!existsSync(manifestPath)) {
        errors.push(`通知 ${entry.name} 缺少 manifest.json`);
        continue;
      }

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        const impl = resolveNotificationImplementation(
          entry.name,
          join(NOTIFICATIONS_DIR, entry.name),
          manifest.entryPoint,
        );
        if (!impl) {
          // fail-visible：两侧皆缺 ⇒ 显式报错（禁静默降级成"配好了"）
          errors.push(
            `通知 ${entry.name} 无可用实现（宿主 src/notifications/${entry.name}-adapter.ts 与内容侧声明皆缺失）`,
          );
          continue;
        }
        if (impl.origin === 'content') {
          log.warn(
            { channel: entry.name, path: impl.path },
            '通知实现取自内容侧声明（宿主侧无内置实现）— 兼容通道',
          );
        }

        const mod = await import(pathToFileURL(impl.path).href);
        const adapter = mod[manifest.exportKey || 'default'] as NotificationAdapter;
        if (!adapter || typeof adapter.send !== 'function') {
          errors.push(`通知 ${entry.name} 缺少 send() 方法`);
          continue;
        }

        registerNotificationAdapter(adapter);
        registered++;
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "JSON 解析失败");
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`通知 ${entry.name} 注册失败: ${msg}`);
      }
    }

    if (registered > 0) log.info({ registered }, '通知适配器已从文件加载');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, '通知加载失败 — degraded');
    errors.push(msg);
  }

  return { registered, errors };
}
