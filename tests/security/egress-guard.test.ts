/**
 * tests/security/egress-guard.test.ts — I-3 外发硬禁止拦截（单元）
 *
 * 覆盖 DEV DOC v3 §5 的键分类 / 递归 / 值形态 / 正例 / 端点 / 只读 / 日志，
 * 判据来源：Gitea #1441 评论 13694（DEV DOC v3 §1/§4/§5）。
 *
 * 铁律 48：每个用例至少 1 条 expect；禁 skip。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logMock } = vi.hoisted(() => ({
  logMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('@synova/logger', () => ({
  logger: logMock,
  createLogger: vi.fn(() => logMock),
}));

import { guardEgress, EgressGuardError } from '../../src/providers/egress-guard';

const ALLOWED = 'https://api.deepseek.com/v1';

function guard(body: Record<string, unknown>, baseUrl = ALLOWED, allowedBaseUrl = ALLOWED) {
  return guardEgress({ body, baseUrl, allowedBaseUrl });
}

beforeEach(() => {
  logMock.warn.mockClear();
});

// ═══ 正例：防全拦 + 防误伤（DEV DOC v3 §5.1–§5.4）═══

describe('guardEgress — 正例（合法业务内容必须放行）', () => {
  it('Given 合法中文业务正文（指标/本体/问题）, When guard, Then ok:true', () => {
    const body = {
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: '你是企业诊断专家，只基于事实回答。' },
        { role: 'user', content: '本月营收 1200 万元，环比增长 8%，毛利率 42%。增长瓶颈在哪？' },
        { role: 'assistant', content: '本体：企业→部门→指标；关系：归属/观测。' },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    };
    const verdict = guard(body);
    expect(verdict).toEqual({ ok: true });
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it('Given {token:128000}（数字配额）, When guard, Then ok:true', () => {
    expect(guard({ token: 128000 })).toEqual({ ok: true });
  });

  it('Given {token:0} / {token:true} / {token:null}, When guard, Then 全部放行', () => {
    expect(guard({ token: 0 })).toEqual({ ok: true });
    expect(guard({ token: true })).toEqual({ ok: true });
    expect(guard({ token: null })).toEqual({ ok: true });
  });

  it('Given {token_count:32768}（完整键名不匹配）, When guard, Then ok:true', () => {
    expect(guard({ token_count: 32768 })).toEqual({ ok: true });
  });

  it('Given 19 位订单号 {orderId:"6222021234567890123"}, When guard, Then 不误伤（ok:true）', () => {
    expect(guard({ orderId: '6222021234567890123' })).toEqual({ ok: true });
  });
});

// ═══ 反例：键名分类（DEV DOC v3 §5.5–§5.6, §5.10–§5.11）═══

describe('guardEgress — 无条件拒绝键', () => {
  const secretKeys = ['password', 'passwd', 'api_key', 'apikey', 'apiKey', 'secret', 'private_key'];

  for (const key of secretKeys) {
    it(`Given {"${key}":"x"}, When guard, Then EGRESS_SECRET + 字段名 ${key}`, () => {
      const verdict = guard({ [key]: 'x' });
      expect(verdict).toEqual({ ok: false, code: 'EGRESS_SECRET', field: key });
    });
  }

  const highSensitiveKeys = ['card_number', 'bank_card', 'id_number', 'idCard'];

  for (const key of highSensitiveKeys) {
    it(`Given {"${key}":"6222…"}, When guard, Then EGRESS_HIGH_SENSITIVE + 字段名 ${key}`, () => {
      const verdict = guard({ [key]: '6222021234567890123' });
      expect(verdict).toEqual({ ok: false, code: 'EGRESS_HIGH_SENSITIVE', field: key });
    });
  }

  it('Given 嵌套 {"meta":{"password":"x"}}, When guard, Then 字段路径 meta.password', () => {
    const verdict = guard({ meta: { password: 'x' } });
    expect(verdict).toEqual({ ok: false, code: 'EGRESS_SECRET', field: 'meta.password' });
  });

  it('Given 数组项内含敏感键, When guard, Then 递归命中数组项', () => {
    const verdict = guard({ items: [{ name: 'ok' }, { secret: 'x' }] });
    expect(verdict).toEqual({ ok: false, code: 'EGRESS_SECRET', field: 'items[1].secret' });
  });

  it('Given token 值为字符串（普通串或 sk- 串）, When guard, Then 一律 EGRESS_SECRET', () => {
    expect(guard({ token: 'plain-token-value' })).toEqual({
      ok: false, code: 'EGRESS_SECRET', field: 'token',
    });
    expect(guard({ token: 'sk-abcdefghijklmnop123' })).toEqual({
      ok: false, code: 'EGRESS_SECRET', field: 'token',
    });
  });

  it('Given token 值为对象容器, When guard, Then 继续递归（容器内 password 命中）', () => {
    const verdict = guard({ token: { password: 'x' } });
    expect(verdict).toEqual({ ok: false, code: 'EGRESS_SECRET', field: 'token.password' });
  });
});

// ═══ 反例：值形态（DEV DOC v3 §5.7–§5.9, §5.11）═══

describe('guardEgress — 值形态拒（四种，仅这四种）', () => {
  it('Given messages[0].content 含 sk-…, When guard, Then EGRESS_SECRET + 内容字段路径', () => {
    const body = { messages: [{ role: 'user', content: '帮我看看 sk-abcdefghijklmnop123 能不能用' }] };
    const verdict = guard(body);
    expect(verdict).toEqual({
      ok: false, code: 'EGRESS_SECRET', field: 'messages[0].content',
    });
  });

  it('Given messages[0].content 含 AKIA…, When guard, Then EGRESS_SECRET', () => {
    const body = { messages: [{ role: 'user', content: 'AKIAIOSFODNN7EXAMPLE' }] };
    expect(guard(body)).toEqual({
      ok: false, code: 'EGRESS_SECRET', field: 'messages[0].content',
    });
  });

  it('Given messages[0].content 含 PEM 私钥头, When guard, Then EGRESS_SECRET', () => {
    const body = { messages: [{ role: 'user', content: '-----BEGIN RSA PRIVATE KEY-----' }] };
    expect(guard(body)).toEqual({
      ok: false, code: 'EGRESS_SECRET', field: 'messages[0].content',
    });
  });

  it('Given content 为分段数组（各段 text）, When 段内含 sk-…, Then 递归命中该段', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '正常说明' },
          { type: 'text', text: 'sk-abcdefghijklmnop123' },
        ],
      }],
    };
    expect(guard(body)).toEqual({
      ok: false, code: 'EGRESS_SECRET', field: 'messages[0].content[1].text',
    });
  });

  it('Given 任意键的字符串值形如 18 位身份证, When guard, Then EGRESS_HIGH_SENSITIVE', () => {
    expect(guard({ memo: '110101199003070011' })).toEqual({
      ok: false, code: 'EGRESS_HIGH_SENSITIVE', field: 'memo',
    });
  });

  it('Given 18 位身份证以 JSON number 出现, When guard, Then 仍按高敏拒绝', () => {
    expect(guard({ id: 110101199003070011 })).toEqual({
      ok: false, code: 'EGRESS_HIGH_SENSITIVE', field: 'id',
    });
  });
});

// ═══ 反例：端点（DEV DOC v3 §5.13）═══

describe('guardEgress — 端点守卫', () => {
  it('Given baseUrl !== allowedBaseUrl, When guard, Then EGRESS_ENDPOINT（无 field）', () => {
    const verdict = guard({ messages: [{ role: 'user', content: '合法内容' }] },
      'https://evil.example.com/v1', ALLOWED);
    expect(verdict).toEqual({ ok: false, code: 'EGRESS_ENDPOINT' });
  });
});

// ═══ 只读 / 日志（DEV DOC v3 §5.15 + §4「不修改 body」）═══

describe('guardEgress — 不修改 body + 日志不含值', () => {
  it('Given 含敏感值的 body, When guard, Then body 逐字节不变（不修改、不半脱敏）', () => {
    const body = { messages: [{ role: 'user', content: '正文' }], meta: { password: 'P@ssw0rd-value' } };
    const before = JSON.stringify(body);
    const verdict = guard(body);
    expect(verdict).toEqual({ ok: false, code: 'EGRESS_SECRET', field: 'meta.password' });
    expect(JSON.stringify(body)).toBe(before);
  });

  it('Given 拦截命中, When guard, Then log.warn 仅 code+字段路径，不含被拦值', () => {
    const secretValue = 'S3cr3t-Should-Never-Be-Logged';
    const verdict = guard({ meta: { password: secretValue } });
    expect(verdict.ok).toBe(false);
    expect(logMock.warn).toHaveBeenCalledTimes(1);
    const call = logMock.warn.mock.calls[0];
    expect(call[0]).toEqual({ code: 'EGRESS_SECRET', field: 'meta.password' });
    expect(String(call[1])).toContain('硬禁止拦截');
    expect(JSON.stringify(call)).not.toContain(secretValue);
  });

  it('Given 放行, When guard, Then 不产生 warn（不刷噪声）', () => {
    expect(guard({ messages: [{ role: 'user', content: '正常业务问句' }] }).ok).toBe(true);
    expect(logMock.warn).not.toHaveBeenCalled();
  });
});

// ═══ EgressGuardError（base.ts 抛错载体）═══

describe('EgressGuardError', () => {
  it('Given code/field, When 构造, Then code/field 可见且 message 不含值', () => {
    const err = new EgressGuardError('EGRESS_HIGH_SENSITIVE', 'card_number');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EgressGuardError');
    expect(err.code).toBe('EGRESS_HIGH_SENSITIVE');
    expect(err.field).toBe('card_number');
    expect(err.message).toContain('EGRESS_HIGH_SENSITIVE');
    expect(err.message).toContain('card_number');
  });
});
