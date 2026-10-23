/**
 * tests/security/e2-failclosed.test.ts —— #838 E-2：三处 fail-open 改 fail-closed（两态）
 *
 * 覆盖（每条都是「改坏必红」的判别力面）:
 *   ① backup 管理员备用通道: 环境变量未设 ⇒ 403 ADMIN_KEY_UNSET（旧实现 `undefined===undefined` ⇒ 放行）
 *      已配置 + 错头 ⇒ 403 FORBIDDEN；已配置 + 对头 ⇒ 过守卫（进入参数校验 400）
 *   ③ 主密钥: 三段全空且非 devMode ⇒ 抛 MasterSecretMissingError（code=MASTER_SECRET_MISSING，= 启动失败）
 *      devMode 显式 true ⇒ 开发密钥常量；env > engineTokens 优先级
 *
 * 铁律 12: 走真实 express 路由（listen(0) + fetch）；不 mock 管线的判定。
 * 隔离: 每条用例自存/恢复 `CREDENTIAL_MASTER_KEY` / `SYNOVA_ADMIN_KEY`。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { resolveMasterSecret, MasterSecretMissingError, DEV_MASTER_SECRET } from '../../src/security/master-secret';

const ORIG_MASTER = process.env['CREDENTIAL_MASTER_KEY'];
const ORIG_ADMIN = process.env['SYNOVA_ADMIN_KEY'];

describe('#838 E-2 ①: backup 管理员备用通道 fail-closed', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const router = (await import('../../src/routes/backup')).default;
    const app = express();
    app.use(express.json());
    app.use(router);
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr !== 'string') baseUrl = `http://localhost:${addr.port}`;
    });
    await new Promise<void>((resolve) => {
      const t = setInterval(() => { if (baseUrl) { clearInterval(t); resolve(); } }, 10);
    });
  });

  afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

  beforeEach(() => { delete process.env['SYNOVA_ADMIN_KEY']; });
  afterEach(() => {
    if (ORIG_ADMIN === undefined) delete process.env['SYNOVA_ADMIN_KEY'];
    else process.env['SYNOVA_ADMIN_KEY'] = ORIG_ADMIN;
  });

  const postRestore = (headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}/api/backup/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({}),
    });

  it('E2-①a 未设 SYNOVA_ADMIN_KEY + 无身份/无头 ⇒ 403 ADMIN_KEY_UNSET（改前放行）', async () => {
    const res = await postRestore();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('ADMIN_KEY_UNSET');
  });

  it('E2-①b 已配置 + 错头 ⇒ 403 FORBIDDEN', async () => {
    process.env['SYNOVA_ADMIN_KEY'] = 'k-secret';
    const res = await postRestore({ 'x-admin-key': 'wrong' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('E2-①c 已配置 + 对头 ⇒ 过守卫（进入参数校验 400，而非 403）', async () => {
    process.env['SYNOVA_ADMIN_KEY'] = 'k-secret';
    const res = await postRestore({ 'x-admin-key': 'k-secret' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('packPath');
  });

  it('E2-①d 空头 + 已配置 ⇒ 403（空串不得等于任何配置值）', async () => {
    process.env['SYNOVA_ADMIN_KEY'] = 'k-secret';
    const res = await postRestore({ 'x-admin-key': '   ' });
    expect(res.status).toBe(403);
  });
});

describe('#838 E-2 ③: 主密钥缺失 ⇒ 启动失败（typed error）', () => {
  beforeEach(() => { delete process.env['CREDENTIAL_MASTER_KEY']; });
  afterEach(() => {
    if (ORIG_MASTER === undefined) delete process.env['CREDENTIAL_MASTER_KEY'];
    else process.env['CREDENTIAL_MASTER_KEY'] = ORIG_MASTER;
  });

  it('E2-③a 三段全空且非 devMode ⇒ 抛 MasterSecretMissingError（code/phase/retryable）', () => {
    let caught: unknown;
    try {
      resolveMasterSecret({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MasterSecretMissingError);
    const err = caught as MasterSecretMissingError;
    expect(err.code).toBe('MASTER_SECRET_MISSING');
    expect(err.phase).toBe('startup');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('MASTER_SECRET_MISSING');
  });

  it('E2-③b 显式 devMode=true ⇒ 开发密钥常量（唯一允许的可预测值）', () => {
    expect(resolveMasterSecret({ devMode: true })).toBe(DEV_MASTER_SECRET);
  });

  it('E2-③c env 优先于 engineTokens；engineTokens 非空即用', () => {
    process.env['CREDENTIAL_MASTER_KEY'] = 'env-key';
    expect(resolveMasterSecret({ engineTokens: 'cfg-key' })).toBe('env-key');
    delete process.env['CREDENTIAL_MASTER_KEY'];
    expect(resolveMasterSecret({ engineTokens: 'cfg-key' })).toBe('cfg-key');
  });

  it('E2-③d 空白 env 不算配置（不得把空格当密钥）', () => {
    process.env['CREDENTIAL_MASTER_KEY'] = '   ';
    expect(() => resolveMasterSecret({ engineTokens: '' })).toThrow(MasterSecretMissingError);
  });
});
