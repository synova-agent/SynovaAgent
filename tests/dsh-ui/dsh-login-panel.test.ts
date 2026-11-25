/**
 * tests/dsh-ui/dsh-login-panel.test.ts — #1429 B1 登录入口（面板渲染＋容器接线＋登录→发起运行链路）
 *
 * 三段：
 *   ① 受控面板渲染（test-support/render.ts 不执行 hook ⇒ 断言、不证交互/像素）：
 *      未登录表单、字段与提交禁用规则、服务端错误码可见、过期提示、提交中态、可返回。
 *   ② 内存身份链路：login 成功 ⇒ token 只在 auth-session 内存 ⇒ startRun 自动带 Bearer；
 *      登录失败 ⇒ 保留服务端 code 且状态留在未登录（不发未认证请求）。
 *   ③ 接线源码锁：容器在未登录/过期时挂登录面板、成功后 syncAuth、DevMode 保留登录入口；
 *      新增两件不落盘/不进日志（token 仅内存，B1 硬约束）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from '../../electron-renderer/src/test-support/render';
import { DshLoginPanel, type DshLoginPanelProps } from '../../electron-renderer/src/components/DshLoginPanel';
import { authHeader, authSnapshot, expireSession, login, logout } from '../../electron-renderer/src/lib/auth-session';
import { startRun, type DshFetch, type DshResponse } from '../../electron-renderer/src/lib/dsh-run-api';

const root = resolve(__dirname, '../..');
const renderer = (path: string): string => readFileSync(resolve(root, 'electron-renderer/src', path), 'utf8');
const codeOnly = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function props(overrides: Partial<DshLoginPanelProps> = {}): DshLoginPanelProps {
  return {
    email: '',
    password: '',
    pending: false,
    error: null,
    expired: false,
    canCancel: false,
    onEmailChange: vi.fn(),
    onPasswordChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<DshLoginPanelProps> = {}): string {
  return renderToStaticMarkup(React.createElement(DshLoginPanel, props(overrides)));
}

function buttonTag(html: string, id: string): string {
  return html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
}

function jsonResponse(payload: unknown, status = 200): DshResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    body: null,
  };
}

describe('#1429 B1 DshLoginPanel（受控、无 hook、渲染桥可渲染）', () => {
  it('渲染邮箱/密码（type=password）与提交按钮；空表单提交 disabled', () => {
    const html = render();
    expect(html).toContain('data-testid="dsh-login-panel"');
    expect(html).toContain('id="dsh-login-email"');
    expect(html).toContain('id="dsh-login-password"');
    expect(html).toContain('type="password"');
    expect(buttonTag(html, 'dsh-login-submit')).not.toBe('');
    expect(buttonTag(html, 'dsh-login-submit')).toContain('disabled');
    // 登录凭证只存本机的提示对用户可见（不是隐含承诺；B3/T4b 措辞取词典 §2.7-B＋P）
    expect(html).toContain('登录凭证只保存在本机本次运行期间');
  });

  it('邮箱与密码都有值 ⇒ 提交可用；提交中 ⇒ 按钮 disabled 且显示「登录中…」', () => {
    const filled = render({ email: 'staff@example.com', password: 'secret' });
    expect(buttonTag(filled, 'dsh-login-submit')).not.toContain('disabled');
    const pending = render({ email: 'staff@example.com', password: 'secret', pending: true });
    expect(buttonTag(pending, 'dsh-login-submit')).toContain('disabled');
    expect(pending).toContain('登录中…');
  });

  it('服务端失败：主文案是客户说法，原始码/状态码/服务端原文只进技术详情（data-error-code 仍在 DOM）', () => {
    const html = render({
      email: 'staff@example.com',
      password: 'wrong',
      error: { code: 'AUTH_FAILED', message: '账户不存在或密码错误', httpStatus: 401 },
    });
    expect(html).toContain('data-error-code="AUTH_FAILED"');
    expect(html).toContain('data-http-status="401"');
    // B3（T4b）：默认面不得再印服务端码；主文案是客户说法
    expect(html).toContain('登录失败（原因见技术详情）');
    expect(html).not.toContain('登录失败（AUTH_FAILED）');
    // 原文不丢：进「技术详情」折叠层
    expect(html).toContain('技术详情');
    expect(html).toContain('账户不存在或密码错误');
  });

  it('过期态：提示重新登录；DevMode 下可返回（取消按钮只在可返回时出现）', () => {
    const expired = render({ expired: true, email: 'staff@example.com', password: 'secret' });
    expect(expired).toContain('data-expired="true"');
    expect(expired).toContain('登录已过期，请重新登录');
    expect(expired).not.toContain('id="dsh-login-cancel"');
    expect(render({ canCancel: true })).toContain('id="dsh-login-cancel"');
  });

  it('面板源码不含任何 hook（受控纯展示；渲染桥只适用无 hook 树）', () => {
    const source = codeOnly(renderer('components/DshLoginPanel.tsx'));
    expect(source).not.toMatch(/\buseState\b|\buseEffect\b|\buseRef\b|\buseMemo\b|\buseCallback\b/);
    expect(source).toContain('value={email}');
    expect(source).toContain('value={password}');
    expect(source).toContain('onClick={onSubmit}');
  });
});

describe('#1429 B1 内存身份链路（token 仅内存 ⇒ startRun 自动带 Bearer）', () => {
  beforeEach(() => { logout(); });
  afterEach(() => { logout(); });

  it('login 成功后直接 startRun：Authorization 精确 Bearer，body 恰为 {input}', async () => {
    const loginFetch = vi.fn(async () => jsonResponse({ ok: true, token: 'jwt-memory-only' }));
    const result = await login('staff@example.com', 'secret', { base: 'http://svc.local', fetchImpl: loginFetch as never });
    expect(result.kind).toBe('ok');
    expect(loginFetch).toHaveBeenCalledTimes(1);
    expect(loginFetch.mock.calls[0][0]).toBe('http://svc.local/api/auth/login');
    expect(authSnapshot()).toEqual({ mode: 'token', token: 'jwt-memory-only', state: 'authenticated' });
    expect(authHeader()).toEqual({ Authorization: 'Bearer jwt-memory-only' });

    const runFetch = vi.fn<Parameters<DshFetch>, Promise<DshResponse>>(async () => jsonResponse({ ok: true, runId: 'run_abc12345', sessionId: null }, 202));
    const started = await startRun('跑一次可见会话', { base: 'http://svc.local', fetchImpl: runFetch });
    expect(started.kind).toBe('ok');
    expect(runFetch).toHaveBeenCalledTimes(1);
    const [url, init] = runFetch.mock.calls[0];
    expect(url).toBe('http://svc.local/api/dsh/runs');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer jwt-memory-only' });
    expect(init.body).toBe(JSON.stringify({ input: '跑一次可见会话' }));
  });

  it('登录失败（401）：保留服务端 code，状态留在未登录，authHeader 为空（不发未认证请求）', async () => {
    const loginFetch = vi.fn(async () => jsonResponse({ ok: false, code: 'AUTH_FAILED', message: '账户不存在或密码错误' }, 401));
    const result = await login('staff@example.com', 'wrong', { base: 'http://svc.local', fetchImpl: loginFetch as never });
    expect(result).toEqual({
      kind: 'error', httpStatus: 401, code: 'AUTH_FAILED', phase: 'auth', retryable: false, message: '账户不存在或密码错误',
    });
    expect(authSnapshot().state).toBe('unauthenticated');
    expect(authHeader()).toEqual({});

    const runFetch = vi.fn<Parameters<DshFetch>, Promise<DshResponse>>(async () => jsonResponse({ ok: true, runId: 'run_abc12345' }, 202));
    await startRun('不该发出去的输入', { base: 'http://svc.local', fetchImpl: runFetch });
    expect((runFetch.mock.calls[0][1].headers as Record<string, string>)).not.toHaveProperty('Authorization');
  });

  it('401 失效后回到登录态：expired 快照 + 面板显示「登录已过期」', async () => {
    // 真实时序：先以 token 模式登录成功，随后任一会话调用 401 才触发 expireSession
    const loginFetch = vi.fn(async () => jsonResponse({ ok: true, token: 'jwt-memory-only' }));
    await login('staff@example.com', 'secret', { base: 'http://svc.local', fetchImpl: loginFetch as never });
    expireSession();
    expect(authSnapshot()).toEqual({ mode: 'token', token: null, state: 'expired' });
    expect(authHeader()).toEqual({});
    expect(render({ expired: true })).toContain('登录已过期，请重新登录');
  });
});

describe('#1429 B1 容器接线锁（未登录显示表单 ⇒ 成功写内存 ⇒ 运行面板可用）', () => {
  const container = (): string => renderer('components/DshRunContainer.tsx');

  it('未登录/过期时挂载登录面板；DevMode 也保留一个可达的登录入口', () => {
    const source = container();
    expect(source).toContain("import DshLoginPanel from './DshLoginPanel';");
    expect(source).toContain("const needsLogin = state.auth === 'unauthenticated' || state.auth === 'expired';");
    expect(source).toContain('if (showLogin)');
    expect(source).toContain('<DshLoginPanel');
    expect(source).toContain('expired={state.auth === \'expired\'}');
    expect(source).toContain('canCancel={state.auth === \'devmode\'}');
    expect(source).toContain('id="dsh-login-entry"');
    expect(source).toMatch(/state\.auth === 'devmode' \? \(/);
  });

  it('提交调用 auth-session.login；成功后 syncAuth（认证态进 store，运行面板随即可用）', () => {
    const source = container();
    expect(source).toContain("import { login, type LoginError } from '../lib/auth-session';");
    expect(source).toMatch(/const result = await login\(email, password\);/);
    // 成功分支必须把认证态同步进 store（否则面板永远停在未登录）
    expect(source).toMatch(/result\.kind === 'ok'[\s\S]{0,400}state\.syncAuth\(\);/);
    // 失败分支保留服务端 code/message
    expect(source).toContain('setLoginError(result);');
    expect(source).toContain('error={loginError}');
    // 登录面板只拿展示态，不接受 token
    expect(source).not.toMatch(/\btoken=\{/);
  });

  it('新增两件不落盘/不进日志/不碰 DSH 内部面（B1 硬约束的静态否定）', () => {
    for (const file of ['components/DshLoginPanel.tsx', 'components/DshRunContainer.tsx']) {
      const source = codeOnly(renderer(file));
      expect(source, `${file} 不得读写浏览器存储`).not.toMatch(/localStorage|sessionStorage|indexedDB/);
      expect(source, `${file} 不得写文件`).not.toMatch(/writeFile|appendFile|node:fs|require\(['"]fs/);
      expect(source, `${file} 不得把凭据/token 写日志`).not.toMatch(/console\.\w+\([^)]*(token|password)/i);
      expect(source, `${file} 不得触碰 DSH 内部面`).not.toMatch(/sidecar|\bacp\b|pinned-version|SYNOVA_DSH/i);
    }
  });
});
