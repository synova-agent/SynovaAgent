/**
 * tests/l1/im-webhook-signature.test.ts — 飞书回调签名**纯函数**三路径（铁律 48）
 *
 * 覆盖：正常（KAT 定值向量）/ 降级（空 encryptKey、缺 rawBody、非数字 timestamp、非法 UTF-8 body）
 *      / 边界（窗口 ±1ms、长度不等不抛、hex 大小写等价而数值改动即拒）。
 *
 * ⚠️ 口径（不许把 L1 报成 L2）：本文件只证**纯函数**语义，
 *   **不证**路由接线、**不证**生产可达。路由面 = `tests/routes/im-webhook-signature.test.ts`（L2）。
 *
 * KAT（known-answer test）向量由 `node:crypto` 独立算得（非本模块代码产出），
 * 防止「实现与测试同源」的自证循环：
 *   ts=1730000000 nonce=nonce-abc-123 key=test-encrypt-key body={"hello":"世界"} →
 *   4d63403d9d10c2c5587315f2e9eb139da332e0f5df31a1420cc68f9bbf1eaeb5
 */
import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  computeFeishuSignature,
  verifyFeishuSignature,
  isWithinTimeWindow,
  DEFAULT_SIGNATURE_WINDOW_MS,
} from '../../src/l1/im-webhook-signature';

const TS = '1730000000';
const NONCE = 'nonce-abc-123';
const KEY = 'test-encrypt-key';
const BODY = Buffer.from('{"hello":"世界"}', 'utf8');
const KAT_HEX = '4d63403d9d10c2c5587315f2e9eb139da332e0f5df31a1420cc68f9bbf1eaeb5';
const BAD_UTF8_BODY = Buffer.from([0xff, 0xfe, 0x80, 0x01]);
const BAD_UTF8_KAT = 'be3d83d25d8308451d5261ea6f0043ba2b40d35cdfe6e57fb5d3362ff4f12e37';

/** 固定注入时钟（与 TS 同刻），使时间窗在正常路径恒为「窗内」 */
const NOW_MS = Number(TS) * 1000;

/** 故意传错类型（运行时非 Buffer）—— 只用普通断言，避免铁律 38 禁用的三种 `as` 形式 */
const asBuffer = (v: unknown): Buffer => v as Buffer;

describe('computeFeishuSignature — 正常路径（规格逐字：sha256(ts+nonce+key+rawBody)）', () => {
  it('KAT 定值向量：与独立算得的摘要逐字相等', () => {
    expect(computeFeishuSignature(TS, NONCE, KEY, BODY)).toBe(KAT_HEX);
    expect(KAT_HEX).toHaveLength(64);
  });

  it('是 SHA-256(拼接串) 而非 HMAC-SHA256(密钥)：与 createHmac(\'sha256\', KEY) 的结果**不**相等', () => {
    // 🔴 判别力说明（原用例名「而非 HMAC」是**同名不副实**，被独立自验员 D4 抓出）：
    //   原对照值用 `createHash('sha256')`（**无密钥**）算 ⇒ 它与本模块的差异只证明
    //   「KEY 参与了哈希输入」，**区分不了** SHA-256 与 HMAC 两种构造。
    //   真对照 = `createHmac('sha256', KEY)`（KEY 当 HMAC 密钥，而非拼接串的一段）
    //   —— 同一 KEY、同一 ts/nonce/body，两条构造路径必产出不同摘要。
    const realHmac = createHmac('sha256', KEY)
      .update(Buffer.concat([Buffer.from(TS + NONCE, 'utf8'), BODY]))
      .digest('hex');
    const computed = computeFeishuSignature(TS, NONCE, KEY, BODY);
    expect(computed).toBe(KAT_HEX);        // 与官方规格（拼接串）逐字一致
    expect(computed).not.toBe(realHmac);   // 且**不是** HMAC 构造的产物
    expect(realHmac).toHaveLength(64);     // 对照值本身非空（防「两边都空」假绿）
  });

  it('拼接段按 UTF-8 字节：ts/nonce/key 各自非 ASCII 时仍与独立算式一致', () => {
    const ts = '1730000001';
    const nonce = '随机数-✓';
    const key = '密钥-🔑';
    const expected = createHash('sha256')
      .update(Buffer.concat([Buffer.from(`${ts}${nonce}${key}`, 'utf8'), BODY]))
      .digest('hex');
    expect(computeFeishuSignature(ts, nonce, key, BODY)).toBe(expected);
  });
});

describe('verifyFeishuSignature — 正常路径 + 长度前置', () => {
  it('签名正确且时间戳在窗内 ⇒ ok:true（无 reason）', () => {
    const r = verifyFeishuSignature(TS, NONCE, KEY, BODY, KAT_HEX, NOW_MS);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('length_mismatch：短头 / 长头 / 非 hex 头 —— 均返回不等且**不抛**', () => {
    for (const bad of ['deadbeef', 'z'.repeat(64), `${KAT_HEX}00`]) {
      let r: ReturnType<typeof verifyFeishuSignature> | undefined;
      expect(() => { r = verifyFeishuSignature(TS, NONCE, KEY, BODY, bad, NOW_MS); }).not.toThrow();
      expect(r?.ok).toBe(false);
      expect(r?.reason).toBe('length_mismatch');
    }
  });

  it('mismatch：等长但**数值**不同 ⇒ 拒；hex 大小写是同一摘要的等价表示 ⇒ 通过', () => {
    const flipped = `${KAT_HEX.slice(0, -1)}${KAT_HEX.endsWith('5') ? '6' : '5'}`;
    expect(verifyFeishuSignature(TS, NONCE, KEY, BODY, flipped, NOW_MS))
      .toEqual({ ok: false, reason: 'mismatch' });
    // 实测口径（原写成「大小写敏感」是错的）：比较在**解码后的字节**上做
    // ⇒ 同一摘要的大写写法判通过（不是漏洞：值未变），改 1 个 hex 字符的**值**才判不等
    expect(Buffer.from(KAT_HEX.toUpperCase(), 'hex').equals(Buffer.from(KAT_HEX, 'hex'))).toBe(true);
    expect(verifyFeishuSignature(TS, NONCE, KEY, BODY, KAT_HEX.toUpperCase(), NOW_MS)).toEqual({ ok: true });
  });

  it('rawBody 改 1 字节 ⇒ 签名不等（规格要求「未反序列化的原始字节」的判别点）', () => {
    const tampered = Buffer.from(BODY);
    tampered[tampered.length - 1] = 0x7d + 1; // '}' → '~'
    expect(verifyFeishuSignature(TS, NONCE, KEY, tampered, KAT_HEX, NOW_MS))
      .toEqual({ ok: false, reason: 'mismatch' });
  });

  it('timestamp_out_of_window：签名正确但时间戳窗外（超出重放视界）⇒ 拒', () => {
    expect(verifyFeishuSignature(TS, NONCE, KEY, BODY, KAT_HEX, NOW_MS + 7_200_000))
      .toEqual({ ok: false, reason: 'timestamp_out_of_window' });
    expect(verifyFeishuSignature(TS, NONCE, KEY, BODY, KAT_HEX, NOW_MS + DEFAULT_SIGNATURE_WINDOW_MS))
      .toEqual({ ok: true });
  });
});

describe('verifyFeishuSignature — 降级路径（fail-closed，无放行分支）', () => {
  it('空 encryptKey ⇒ missing_params（不是「按空密钥放行」）', () => {
    expect(verifyFeishuSignature(TS, NONCE, '', BODY, KAT_HEX, NOW_MS))
      .toEqual({ ok: false, reason: 'missing_params' });
    // 纯函数仍能按「空段」算出摘要（规格允许 encrypt_key 段为空），但校验面一律拒
    expect(computeFeishuSignature(TS, NONCE, '', BODY)).toHaveLength(64);
  });

  it('缺 timestamp / nonce / expectedSignature ⇒ missing_params 且不抛', () => {
    expect(verifyFeishuSignature('', NONCE, KEY, BODY, KAT_HEX, NOW_MS))
      .toEqual({ ok: false, reason: 'missing_params' });
    expect(verifyFeishuSignature(TS, '', KEY, BODY, KAT_HEX, NOW_MS))
      .toEqual({ ok: false, reason: 'missing_params' });
    expect(verifyFeishuSignature(TS, NONCE, KEY, BODY, '', NOW_MS))
      .toEqual({ ok: false, reason: 'missing_params' });
  });

  it('rawBody 非 Buffer（undefined = 段2 早挂载缺席 / 字符串）⇒ missing_params，禁放行', () => {
    for (const wrong of [undefined, null, '{"hello":"世界"}', 12345]) {
      let r: ReturnType<typeof verifyFeishuSignature> | undefined;
      expect(() => { r = verifyFeishuSignature(TS, NONCE, KEY, asBuffer(wrong), KAT_HEX, NOW_MS); }).not.toThrow();
      expect(r?.ok, `rawBody=${String(wrong)} 必须 fail-closed`).toBe(false);
      expect(r?.reason).toBe('missing_params');
    }
    expect(computeFeishuSignature(TS, NONCE, KEY, asBuffer(undefined))).toBe('');
  });

  it('非法 UTF-8 body：按**原始字节**验签成功；而经 utf8 字符串往返（有损）后必不相等', () => {
    // 这正是官方警告的判别点：反序列化/字符串化后再算 ⇒ 摘要变
    expect(computeFeishuSignature(TS, NONCE, KEY, BAD_UTF8_BODY)).toBe(BAD_UTF8_KAT);
    expect(verifyFeishuSignature(TS, NONCE, KEY, BAD_UTF8_BODY, BAD_UTF8_KAT, NOW_MS).ok).toBe(true);

    const lossy = Buffer.from(BAD_UTF8_BODY.toString('utf8'), 'utf8');
    expect(lossy.equals(BAD_UTF8_BODY)).toBe(false);                               // 往返确有损
    expect(computeFeishuSignature(TS, NONCE, KEY, lossy)).not.toBe(BAD_UTF8_KAT);  // ⇒ 摘要不同
  });
});

describe('isWithinTimeWindow — 边界（±1h 默认；±1ms 相邻）', () => {
  const HOUR = DEFAULT_SIGNATURE_WINDOW_MS;

  it('默认窗宽恰为 1 小时（3_600_000ms）', () => {
    expect(HOUR).toBe(3_600_000);
    expect(isWithinTimeWindow(TS, NOW_MS)).toBe(true);
  });

  it('边界含端：±1h 整 ⇒ true；±1h+1ms ⇒ false（过去与未来两个方向）', () => {
    expect(isWithinTimeWindow(TS, NOW_MS + HOUR)).toBe(true);
    expect(isWithinTimeWindow(TS, NOW_MS + HOUR + 1)).toBe(false);
    expect(isWithinTimeWindow(TS, NOW_MS - HOUR)).toBe(true);
    expect(isWithinTimeWindow(TS, NOW_MS - HOUR - 1)).toBe(false);
  });

  it('±1ms 相邻（窗口收窄到 1000ms 时逐毫秒判定）', () => {
    expect(isWithinTimeWindow(TS, NOW_MS + 1000, 1000)).toBe(true);
    expect(isWithinTimeWindow(TS, NOW_MS + 1001, 1000)).toBe(false);
    expect(isWithinTimeWindow(TS, NOW_MS - 1000, 1000)).toBe(true);
    expect(isWithinTimeWindow(TS, NOW_MS - 1001, 1000)).toBe(false);
  });

  it('超出重放视界形态（now − 7200s）⇒ false', () => {
    expect(isWithinTimeWindow(TS, NOW_MS + 7_200_000)).toBe(false);
  });

  it('降级：非十进制 / 空串 / 带空白 / 超长 / nowMs 非有限 ⇒ 一律 false 且不抛', () => {
    const dirty = ['', ' ', 'abc', '12.5', '-1', '1e3', ' 1730000000', '1730000000 ', '9'.repeat(16), '+1730000000'];
    for (const d of dirty) {
      let v: boolean | undefined;
      expect(() => { v = isWithinTimeWindow(d, NOW_MS); }).not.toThrow();
      expect(v, `timestamp=${JSON.stringify(d)} 必须 fail-closed`).toBe(false);
    }
    expect(isWithinTimeWindow(TS, Number.NaN)).toBe(false);
    expect(isWithinTimeWindow(TS, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isWithinTimeWindow(TS, NOW_MS, Number.NaN)).toBe(false);
    expect(isWithinTimeWindow(TS, NOW_MS, -1)).toBe(false);
  });
});
