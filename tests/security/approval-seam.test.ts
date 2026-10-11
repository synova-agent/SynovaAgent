/**
 * tests/security/approval-seam.test.ts — K12-19 / Issue #202（原 RB-05）**生产入口**安全判据
 *
 * 判据对象: `src/routes/self-ops.ts` —— 人在环审批缝在生产路径上的**唯一触发点**
 *   `src/server.ts:482 app.use(selfOpsRoutes)` ⇒ `POST /api/self-ops/execute`
 *
 * 为什么单列一个文件（两个文件各司其职，不重复）:
 *   · `tests/runtime/approval-seam.test.ts` = **缝本体**契约（四变体 / 不变量 / 策略解析）
 *     —— 该路径同时是 pre-commit 组 2b「src/x.ts → tests/x.test.ts」**严格镜像**的落点；
 *   · 本文件 = **端到端安全语义**（真 express app ＋ 真 router ＋ 真 HTTP）:
 *     高风险动作在**无人类应答通道**的生产姿态下必须 403 拒、必须在**执行前**拦截、
 *     且安全动作不得被误伤（判据不能靠"一律拒"换来绿）。
 *
 * 本文件**不吃 grep**: 每一条都真起服务、真发请求、真读 HTTP 状态码与响应体。
 */
import express from 'express';
import { createServer, type Server } from 'http';
import { describe, it, expect } from 'vitest';
import { HIGH_RISK_ACTIONS } from '../../src/runtime/approval-seam';
import selfOpsRoutes from '../../src/routes/self-ops';

/** 被测的高风险动作（取自实现自己导出的清单） */
const HIGH_RISK = HIGH_RISK_ACTIONS[0];
/** 一个明确不在高风险清单内的安全动作 */
const SAFE_OP = 'clear-cache';

/** 从 express 服务器取回环端口（类型守卫: 不用 any 型断言，铁律 38） */
function portOf(server: Server): number {
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('无法读取监听端口');
  return addr.port;
}

/** 起一个挂载**真实** self-ops router 的 express app，跑完回调后必定关闭 */
async function withProductionApp<T>(
  fn: (post: (body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(selfOpsRoutes);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${portOf(server)}`;
    return await fn(async (body: unknown) => {
      const res = await fetch(`${base}/api/self-ops/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await res.json();
      const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      return { status: res.status, body: record };
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('⑧ 生产接线: POST /api/self-ops/execute（真 app / 真路由 / 真 HTTP）', () => {
  it('高风险动作在无人类应答通道 ⇒ 403 拒（不是 200/202）', async () => {
    await withProductionApp(async (post) => {
      const res = await post({ op: HIGH_RISK, params: {}, requestedBy: 'e2e-caller' });
      expect(res.status).toBe(403);
      expect(res.body['ok']).toBe(false);
      expect(res.body['code']).toBe('APPROVAL_DENIED');
      const approval = res.body['approval'];
      expect(typeof approval).toBe('object');
      const trail: Record<string, unknown> =
        typeof approval === 'object' && approval !== null ? { ...(approval as Record<string, unknown>) } : {};
      expect(trail['action']).toBe(HIGH_RISK);
      expect(trail['actor']).toBe('e2e-caller');
      expect(String(trail['reason'])).not.toBe('');
      expect(String(trail['timestamp'])).not.toBe('');
      expect(res.body['degraded']).toBe(false);
    });
  });

  it('危险动作**没有**执行（拒绝是执行前拦截，不是执行后道歉）', async () => {
    await withProductionApp(async (post) => {
      const res = await post({ op: 'db-repair', requestedBy: 'e2e-caller' });
      expect(res.status).toBe(403);
      // 若被放行，回包会带 executeSelfOp 的 success/severity/approvalTicketId —— 断言它们不存在
      expect(res.body['success']).toBeUndefined();
      expect(res.body['approvalTicketId']).toBeUndefined();
    });
  });

  it('安全动作原语义不变（不得误伤）', async () => {
    await withProductionApp(async (post) => {
      const res = await post({ op: SAFE_OP, requestedBy: 'e2e-caller' });
      expect(res.status).toBe(200);
      expect(res.body['ok']).toBe(true);
      expect(res.body['success']).toBe(true);
    });
  });

  it('缺必填字段仍走原 400（接线不改变入参校验语义）', async () => {
    await withProductionApp(async (post) => {
      const res = await post({ op: HIGH_RISK });
      expect(res.status).toBe(400);
    });
  });

  it('三个危险操作逐个都过审批缝（清单全覆盖，不留后门动作）', async () => {
    await withProductionApp(async (post) => {
      for (const op of HIGH_RISK_ACTIONS) {
        const res = await post({ op, requestedBy: 'e2e-caller' });
        expect(res.status, `动作 ${op} 未过审批缝`).toBe(403);
        expect(res.body['code']).toBe('APPROVAL_DENIED');
      }
    });
  });

  it('拒绝是**确定的拒**（degraded=false: 无人类通道 ≠ 判不了）', async () => {
    await withProductionApp(async (post) => {
      const res = await post({ op: HIGH_RISK, requestedBy: 'e2e-caller' });
      expect(res.status).toBe(403);
      expect(res.body['degraded']).toBe(false);
      const approval = res.body['approval'];
      expect(typeof approval === 'object' && approval !== null ? (approval as Record<string, unknown>)['answered'] : undefined).toBe(false);
      expect(typeof approval === 'object' && approval !== null ? (approval as Record<string, unknown>)['code'] : undefined).toBe('APPROVAL_NO_ANSWER');
    });
  });
});
