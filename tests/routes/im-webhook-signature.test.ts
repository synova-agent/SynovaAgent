/**
 * tests/routes/im-webhook-signature.test.ts — K1-WH **段1a** L2 判据（卡 P2-段1 / 父卡 #1126）
 *
 * ## 断面（卡 F2，禁误读）
 * 判据断面 = `express()` + **真 `imRouter`（无 jwt 层）** + `listen(0)` + **真 `fetch`**。
 *
 * 🔴 本断面 **≠** `createServer()` 全栈：真入口 `src/server.ts:329` 有 `express.json(10mb)`、
 *   `:344` 有全局 `jwtAuthMiddleware`，而 `/api/im` **不在白名单**（`isWhitelisted()` 27 条）
 *   ⇒ 生产姿态飞书回调必 401（独立 Issue **#1126**；放行属**段2**，不是本卡）。
 *   ⇒ 本文件「带签请求 200」的结论**只表述为该断面成立**，
 *   **不得**读成「生产可达 / 客户可见 / 给 bot 发消息能通」。
 * 先例：`tests/routes/im-authprovider.test.ts`（同为「无 jwt 层实例」范式）。
 *
 * ## 诚实边界（卡 F4 尾注）
 * ⑦ 的 64KB 闸在本断面是**判定级**（按 `content-length` 判决），**不是内存级预闸**：
 *   真入口全局 `express.json({limit:'10mb'})` 已**先缓冲**请求体 ⇒ 路由层看到的是已缓冲体。
 *   内存级前置闸门须段2 在全局 parser **之前**早挂载（段1b，与在飞 #1009 串行）。
 *
 * ## 夹具要点
 * - `rawBody` 由夹具自行装配（`express.json({ verify })`）—— 生产侧该字段由段2 提供；
 *   `serverNoRaw` 实例**不装** capture，用于判据⑤（缺 rawBody ⇒ 401，禁「拿不到就放行」）。
 * - 隔离：临时库（`SYNOVA_DB_PATH` 指向 mkdtemp），**不触碰仓库 `data/synova.db`**。
 * - 不调 `createServer()`（vitest worker 内 node v24.19.0 会 abort，见 #984 证据件 §9.5）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Request } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'node:crypto';
import type { Server } from 'http';

// 🔴 必须在 initEngineContext() 之前把 DB 指向临时文件（同上先例）
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'synova-p2s1-'));
process.env.SYNOVA_DB_PATH = path.join(TMP_DIR, 'test.db');

/** 透明包装 logger：保留 `@synova/logger` 真实现，只记录 `warn` 调用（判据：拒绝必须落 warn，禁静默） */
const LOG = vi.hoisted(() => ({ warns: [] as Array<{ name: string; fields: unknown; msg: unknown }> }));
vi.mock('@synova/logger', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@synova/logger')>();
  return {
    ...mod,
    createLogger: (name: string) => {
      const real = mod.createLogger(name) as Record<string, unknown>;
      return new Proxy(real, {
        get(target, prop, receiver) {
          const orig = Reflect.get(target, prop, receiver);
          if (typeof orig !== 'function') return orig;
          if (prop === 'warn') {
            return (fields: unknown, msg?: unknown) => {
              LOG.warns.push({ name, fields, msg });
              return (orig as (...a: unknown[]) => unknown).apply(target, [fields, msg]);
            };
          }
          return (orig as (...a: unknown[]) => unknown).bind(target);
        },
      });
    },
  };
});

import imRouter from '../../src/routes/im';
import { PIIScrubber } from '../../src/security/pii-scrubber';
import { getDatabase, initEngineContext } from '../../src/init/engine-context';

const ENCRYPT_KEY = 'p2s1-fixture-encrypt-key';
const WEBHOOK_PATH = '/api/im/feishu/webhook';
const SENDER_OPEN_ID = 'ou_p2s1_sender';

const savedEnv = {
  key: process.env.FEISHU_ENCRYPT_KEY,
  skip: process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE,
};

let serverRaw: Server;   // 装 rawBody capture（判据①②③④⑥⑦）
let serverNoRaw: Server; // **不装** capture（判据⑤）
let urlRaw = '';
let urlNoRaw = '';

// ═══ 签名算式（**独立**按官方规格写，不复用被测模块 ⇒ 防自证循环）═══

function sign(ts: string, nonce: string, key: string, raw: Buffer): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(`${ts}${nonce}${key}`, 'utf8'), raw]))
    .digest('hex');
}

function nowSec(): string {
  return String(Math.floor(Date.now() / 1000));
}

function signedHeaders(raw: Buffer, over: Partial<{ ts: string; nonce: string; sig: string }> = {}): Record<string, string> {
  const ts = over.ts ?? nowSec();
  const nonce = over.nonce ?? `nonce-p2s1-${Math.random().toString(36).slice(2, 10)}`;
  return {
    'content-type': 'application/json',
    'x-lark-request-timestamp': ts,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': over.sig ?? sign(ts, nonce, ENCRYPT_KEY, raw),
  };
}

function bytes(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

/** 飞书事件回调最小可达载荷（`sender.open_id` + `message.content` 与 src/routes/im.ts:33-39 对齐） */
function eventPayload(fillerChars = 0): Record<string, unknown> {
  return {
    schema: '2.0',
    header: { event_id: 'evt_p2s1', event_type: 'im.message.receive_v1' },
    event: {
      sender: { open_id: SENDER_OPEN_ID, sender_type: 'user' },
      message: {
        message_id: 'om_p2s1',
        message_type: 'text',
        content: fillerChars > 0
          ? `{"text":"${'x'.repeat(fillerChars)}"}`
          : '{"text":"这家企业的增长卡在哪里？"}',
      },
    },
  };
}

interface HttpResult { status: number; body: Record<string, unknown> }

async function post(base: string, raw: Buffer, headers: Record<string, string>): Promise<HttpResult> {
  const res = await fetch(`${base}${WEBHOOK_PATH}`, {
    method: 'POST',
    headers,
    body: new Uint8Array(raw),
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch { /* 非 JSON 响应（如中间件默认页）保持空对象，判据只认状态码 */ }
  return { status: res.status, body };
}

/** 取日志里最近一次 `code` 等于给定值的 warn（用于断言「非静默 + code 可定位」） */
function warnedWith(code: string): Array<Record<string, unknown>> {
  return LOG.warns
    .map(w => (w.fields && typeof w.fields === 'object' ? w.fields as Record<string, unknown> : {}))
    .filter(f => f.code === code);
}

beforeAll(async () => {
  process.env.FEISHU_ENCRYPT_KEY = ENCRYPT_KEY;
  delete process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE;
  initEngineContext();

  const app = express();
  app.use(express.json({
    limit: '10mb',
    verify: (req: Request, _res, buf: Buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }));
  app.locals.container = { piiScrubber: new PIIScrubber() };
  app.use(imRouter);
  await new Promise<void>((resolve) => {
    serverRaw = app.listen(0, () => {
      const addr = serverRaw.address();
      urlRaw = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });

  const appNoRaw = express();
  appNoRaw.use(express.json({ limit: '10mb' })); // 无 verify ⇒ req.rawBody 恒 undefined
  appNoRaw.locals.container = { piiScrubber: new PIIScrubber() };
  appNoRaw.use(imRouter);
  await new Promise<void>((resolve) => {
    serverNoRaw = appNoRaw.listen(0, () => {
      const addr = serverNoRaw.address();
      urlNoRaw = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => {
  serverRaw?.close();
  serverNoRaw?.close();
  // 环境复原（防污染同 worker 的其他测试文件）
  if (savedEnv.key === undefined) delete process.env.FEISHU_ENCRYPT_KEY;
  else process.env.FEISHU_ENCRYPT_KEY = savedEnv.key;
  if (savedEnv.skip === undefined) delete process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE;
  else process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE = savedEnv.skip;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* 清理失败不阻断 */ }
});

describe('P2-段1 · 飞书回调签名闸门（L2 真 HTTP；断面 = 无 jwt 层的真 express + 真 imRouter）', () => {
  it('① 正确签名 ⇒ 200，且 handler **真被调**（ok:true + sessionId 非空 + DB 真有该会话行）', async () => {
    const raw = bytes(eventPayload());
    const r = await post(urlRaw, raw, signedHeaders(raw));

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const sessionId = typeof r.body.sessionId === 'string' ? r.body.sessionId : '';
    expect(sessionId).not.toBe('');          // 接线了 ≠ 被执行 ⇒ 断言 handler 产出的会话号
    expect(r.body.degraded).toBe(false);

    // handler 副作用落到真库：agent_sessions 真有这一行，且 user_id 是本载荷的 open_id
    const row = getDatabase()
      .prepare('SELECT id, user_id FROM agent_sessions WHERE id = ?')
      .get(sessionId) as { id: string; user_id: string } | undefined;
    expect(row?.id).toBe(sessionId);
    expect(row?.user_id).toBe(`feishu:${SENDER_OPEN_ID}`);
  });

  it('② body 改 1 字节、签名头不动 ⇒ 401（签名对**原始字节**，不是反序列化后的对象）', async () => {
    const raw = bytes(eventPayload());
    const headers = signedHeaders(raw);                 // 按**原**字节签名
    const tampered = Buffer.from(raw);
    const at = tampered.indexOf(Buffer.from('这家企业'));
    expect(at).toBeGreaterThan(-1);
    tampered[at] = 0xe5;                                // 改 1 字节（内容仍为合法 JSON，仅字节不同）

    const r = await post(urlRaw, tampered, headers);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('FEISHU_SIGNATURE_mismatch');
  });

  it('③ timestamp = now − 7200s、签名**正确** ⇒ 401（±1h 时间窗，防重放）', async () => {
    const raw = bytes(eventPayload());
    const oldTs = String(Math.floor(Date.now() / 1000) - 7200);
    const r = await post(urlRaw, raw, signedHeaders(raw, { ts: oldTs }));

    expect(r.status).toBe(401);
    expect(r.body.error).toBe('FEISHU_SIGNATURE_timestamp_out_of_window');
  });

  it('④ 篡改签名头 1 个 hex 字符 ⇒ 401', async () => {
    const raw = bytes(eventPayload());
    const headers = signedHeaders(raw);
    const good = headers['x-lark-signature'];
    headers['x-lark-signature'] = `${good.slice(0, -1)}${good.endsWith('5') ? '6' : '5'}`;

    const r = await post(urlRaw, raw, headers);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('FEISHU_SIGNATURE_mismatch');
  });

  it('⑤ 无 rawBody（体已反序列化、无 raw 捕获）⇒ 401 —— fail-closed，禁「拿不到就放行」', async () => {
    const raw = bytes(eventPayload());
    // 头部完全合法、签名也按该字节算对 —— 唯一缺口是「实例没装配 rawBody capture」（=段2 早挂载缺席）
    const r = await post(urlNoRaw, raw, signedHeaders(raw));

    expect(r.status).toBe(401);
    expect(r.body.error).toBe('FEISHU_RAW_BODY_MISSING');
  });

  it('⑥-a challenge + 合法签名 ⇒ 200 且回显 challenge（不是「凡 challenge 一律回显」）', async () => {
    const raw = bytes({ challenge: 'chal-p2s1-abc', type: 'url_verification' });
    const r = await post(urlRaw, raw, signedHeaders(raw));

    expect(r.status).toBe(200);
    expect(r.body.challenge).toBe('chal-p2s1-abc');
  });

  it('⑥-b challenge **不带**签名头 ⇒ 401（= 裁定「选 X」：官方「排除 URL 验证」我方不采纳为默认豁免）', async () => {
    const raw = bytes({ challenge: 'chal-p2s1-probe', type: 'url_verification' });
    const r = await post(urlRaw, raw, { 'content-type': 'application/json' });

    expect(r.status).toBe(401);
    expect(r.body.error).toBe('FEISHU_SIGNATURE_HEADERS_MISSING');
  });

  it('⑥-c challenge 不带签名头 + FEISHU_CHALLENGE_SKIP_SIGNATURE=true ⇒ 200（= 代价 Y：临时开关，须带移除条件）', async () => {
    const raw = bytes({ challenge: 'chal-p2s1-firstsetup', type: 'url_verification' });
    process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE = 'true';
    try {
      const r = await post(urlRaw, raw, { 'content-type': 'application/json' });
      expect(r.status).toBe(200);
      expect(r.body.challenge).toBe('chal-p2s1-firstsetup');
    } finally {
      delete process.env.FEISHU_CHALLENGE_SKIP_SIGNATURE;
    }
    // 开关只豁免 challenge：同一开关下**事件消息**仍必须带签（下方用例证明）
    const rawEvent = bytes(eventPayload());
    const stillRejected = await post(urlRaw, rawEvent, { 'content-type': 'application/json' });
    expect(stillRejected.status).toBe(401);
  });

  it('⑦-a 70KB **未带签名** ⇒ 413（pre-auth 通道尺寸闸，先于验签）', async () => {
    const raw = bytes(eventPayload(70_000));
    expect(raw.length).toBeGreaterThan(64 * 1024);

    const r = await post(urlRaw, raw, { 'content-type': 'application/json' });
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('FEISHU_UNAUTHENTICATED_BODY_TOO_LARGE');
  });

  it('⑦-b **同一个** 70KB 体、带合法签名 ⇒ 200（证明分层闸门按通道放行，不是「体量一刀切」）', async () => {
    const raw = bytes(eventPayload(70_000));
    const r = await post(urlRaw, raw, signedHeaders(raw));

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('⑦-c 1.5MB **带合法签名** ⇒ 413（post-auth 通道尺寸闸）', async () => {
    const raw = bytes(eventPayload(1_500_000));
    expect(raw.length).toBeGreaterThan(1024 * 1024);

    const r = await post(urlRaw, raw, signedHeaders(raw));
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('FEISHU_AUTHENTICATED_BODY_TOO_LARGE');
  });

  it('⑦-d 1.5MB **未带签名** ⇒ 413（pre-auth 通道尺寸闸 —— 与 ⑦-c 同码不同闸）', async () => {
    const raw = bytes(eventPayload(1_500_000));
    const r = await post(urlRaw, raw, { 'content-type': 'application/json' });

    expect(r.status).toBe(413);
    expect(r.body.error).toBe('FEISHU_UNAUTHENTICATED_BODY_TOO_LARGE');
  });

  it('补 · 小体量但**未带**签名头 ⇒ 401（尺寸闸与「缺签名头」是两条判据，不互相遮蔽）', async () => {
    const raw = bytes(eventPayload());
    const r = await post(urlRaw, raw, { 'content-type': 'application/json' });

    expect(r.status).toBe(401);
    expect(r.body.error).toBe('FEISHU_SIGNATURE_HEADERS_MISSING');
  });

  it('补 · FEISHU_ENCRYPT_KEY 未配置 ⇒ 保持改造前行为 200（保护写集外既存消费者 #984 接线面）', async () => {
    const raw = bytes(eventPayload());
    const saved = process.env.FEISHU_ENCRYPT_KEY;
    delete process.env.FEISHU_ENCRYPT_KEY;
    try {
      const r = await post(urlRaw, raw, { 'content-type': 'application/json' });
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
    } finally {
      process.env.FEISHU_ENCRYPT_KEY = saved;
    }
  });

  it('补 · 每次拒绝落 log.warn（含 code + path）—— 非静默（铁律 11）', async () => {
    LOG.warns.length = 0;
    const raw = bytes(eventPayload());
    const r = await post(urlRaw, raw, { 'content-type': 'application/json' });
    expect(r.status).toBe(401);

    const hit = warnedWith('FEISHU_SIGNATURE_HEADERS_MISSING');
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0].path).toBe(WEBHOOK_PATH);
    expect(hit[0].code).toBe('FEISHU_SIGNATURE_HEADERS_MISSING');
  });

  it('补 · GET /api/im/health 报告闸门姿态（armed/roundTrip/window 三布尔，且**不含密钥材料**）', async () => {
    const res = await fetch(`${urlRaw}/api/im/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);

    const guard = body.feishuSignatureGuard as Record<string, unknown> | undefined;
    expect(guard).toBeTruthy();
    expect(guard?.armed).toBe(true);      // 密钥已配置
    expect(guard?.roundTrip).toBe(true);  // 按当前密钥「算签名 → 验签名」自洽 ⇒ 闸门真可用
    expect(guard?.window).toBe(true);
    // 只回布尔：响应里不得出现密钥原文
    expect(JSON.stringify(body)).not.toContain(ENCRYPT_KEY);
  });
});
