/**
 * tests/notifications/notification-loader.test.ts
 *
 * 🔴 K12-17（#200）**修强**：原文 `expect(registered).toBeGreaterThanOrEqual(0)` —— **0 也绿**
 *   （空壳断言，铁律 48）。而它正是 `notification-loader` 解析顺序的**唯一守护者**：
 *   把引擎码搬回 `extensions/` 或改错解析顺序，原文 `33 passed` 会**一模一样通过** ⇒ 修复零守护。
 *   ⇒ 本次改为**有牙齿**：注册数必须 == 渠道目录数（锚上 4），且 errors 不含"实现缺失"。
 *
 * 两个已实测的坑（写死在断言里，别改回去）:
 *   坑1 `NOTIFICATIONS_DIR` 是 **cwd 相对**（notification-loader.ts:18 = `join(process.cwd(), …)`）
 *       ⇒ cwd 不是仓根时 registered **恒 0**。若不先断 cwd，本文件自己就变成新的"恒 0 假绿"。
 *   坑2 期望值**不是**"含 manifest.json 的总数"——`extensions/notifications/manifest.json`（根 manifest）
 *       会多算 1（实测：错口径 ⇒ 5，正确 ⇒ 4）；且 loader 还跳过 `_` 开头目录（notification-loader.ts:33）。
 *       ⇒ 正确定义 = 「非 `_` 开头、且**子目录**内含 manifest.json」的目录数。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadAndRegisterNotificationAdapters } from '../../src/notifications/notification-loader';

const NOTIFICATIONS_DIR = join(process.cwd(), 'extensions', 'notifications');

/**
 * 期望注册数 = extensions/notifications/ 下「非 `_` 开头、且含 manifest.json」的**子目录**数。
 * 口径与 loader 的扫描循环（notification-loader.ts:30-39）逐字对齐。
 */
function expectedRegisteredCount(): number {
  return readdirSync(NOTIFICATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .filter((e) => existsSync(join(NOTIFICATIONS_DIR, e.name, 'manifest.json')))
    .length;
}

describe('notification-loader', () => {
  it('cwd 必须是仓根（否则本文件全部断言恒 0 假绿）', () => {
    expect(
      existsSync(NOTIFICATIONS_DIR),
      `NOTIFICATIONS_DIR 不存在: ${NOTIFICATIONS_DIR}（cwd=${process.cwd()}）`,
    ).toBe(true);
    // 宿主实现面同按 cwd 定位（notification-loader.ts:31）——一并挡 cwd 失配
    expect(existsSync(join(process.cwd(), 'src', 'notifications'))).toBe(true);
  });

  it('渠道声明 + 宿主实现装配：注册数 == 渠道目录数，且无"实现缺失"错误', async () => {
    const expected = expectedRegisteredCount();
    // 挡"算出来是 0 也绿"（期望值自身非退化）
    expect(expected, '渠道目录数不得为 0（否则本判据退化）').toBeGreaterThan(0);

    const { registered, errors } = await loadAndRegisterNotificationAdapters();

    // 🔴 核心断言：原文的 `toBeGreaterThanOrEqual(0)` 在此被替换
    expect(registered).toBe(expected);
    // 实现缺失必须显式报错（fail-visible），不得静默降级成"配好了"
    expect(errors.filter((e) => e.includes('无可用实现') || e.includes('entryPoint 不存在'))).toEqual([]);
  });

  it('多次加载不崩溃且注册数稳定', async () => {
    const r1 = await loadAndRegisterNotificationAdapters();
    const r2 = await loadAndRegisterNotificationAdapters();
    expect(r1.registered).toBe(r2.registered);
    expect(r2.registered).toBe(expectedRegisteredCount());
  });
});
