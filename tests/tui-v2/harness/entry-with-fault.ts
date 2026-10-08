/**
 * tests/tui-v2/harness/entry-with-fault.ts — #1348 V3a 取证入口（受控注入 + 真实生产入口）
 *
 * 卡面 V3a 原文授权：触发手段（断 provider／不可达引擎／**受控注入**）由执行方定并写进 PR 正文。
 *
 * 本入口的全部动作：
 *   ① 按 TUI_1348_FAULT=reject|null 在**本进程内**替换 ConversationEngine.prototype.startDiagnosis
 *      —— 只注入「:418 调用点（无 event handler）失败」，让「:438 调用点（带 event handler）」保持挂起，
 *         以复刻真实的「探针已失败、界面仍停在假进度」场景；
 *   ② 可选把 TUI 的 LOG_LEVEL 恢复为 info（bootstrap.ts:55 在生产路径把日志压成 silent），
 *      使 warn/error 能落进 PTY 原始输出（证据 ①）；
 *   ③ 最后 **动态 import 真实生产入口** src/tui-v2/chat.tsx —— main()/bootstrap()/ink render 全走真身。
 *
 * 边界（V-09）：注入只存在于 tests/，**src/ 零改动**（conversation-engine / diagnosis-launcher 未被修改）；
 *              本入口不是 `npm run tui` 本身，差异仅上述 ①② 两步，已在交付正文显式列为例外。
 */
import { ConversationEngine } from '../../../src/agent/conversation-engine';

const fault = process.env.TUI_1348_FAULT ?? 'none';

if (fault === 'reject' || fault === 'null') {
  const patched = async function patchedStartDiagnosis(
    _initiatorRole: string,
    _initiatorName: string,
    onEvent?: (event: unknown) => void,
  ): Promise<unknown> {
    if (typeof onEvent === 'function') {
      // :438 主调用（带 event handler）：保持挂起 —— 模拟诊断长跑，避免它的兜底掩盖 :418 的复位效果
      return new Promise(() => undefined);
    }
    // :418 探针调用（无 event handler）：注入失败（两种失败形态）
    if (fault === 'reject') throw new Error('injected: diagnosis launch reject (:418)');
    return null;
  };
  ConversationEngine.prototype.startDiagnosis =
    patched as unknown as typeof ConversationEngine.prototype.startDiagnosis;
  process.stderr.write(`[V3-harness] fault injected into startDiagnosis: ${fault} (:418 无 handler 调用点)\n`);
} else {
  process.stderr.write('[V3-harness] no fault injected (natural run through same entry)\n');
}

if (process.env.TUI_1348_LOG_VISIBLE === '1') {
  // bootstrap 在 loadEnvFile() 末尾强制 LOG_LEVEL=silent（TUI 独占 stdout 的设计）——
  // 这里在 boot 之后恢复日志可见性，使 warn/error 进 PTY 原始输出；不改任何源码。
  setTimeout(() => {
    process.env.LOG_LEVEL = 'info';
    process.stderr.write('[V3-harness] LOG_LEVEL restored to info (bootstrap 默认 silent)\n');
  }, 4000);
}

// 真实生产入口（main() → bootstrap() → installStdinProxy() → ink render）
await import('../../../src/tui-v2/chat.tsx');
