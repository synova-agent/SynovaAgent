/**
 * tests/runtime/dsh/acp-client.test.ts — ACP ndjson 客户端与子进程传输单测（真实 node 子进程 fake ACP）。
 *
 * 配对对象：src/runtime/dsh/acp-client.ts
 * 覆盖：initialize/new/list/resume/close、prompt 通知、审批自动拒绝（fail-closed）、
 * JSON-RPC 错误映射、initialize 超时、进程退出 ⇒ 会话丢失。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawnAcpProcess } from '../../../src/runtime/dsh/acp-client';

const tempRoots: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-acp-unit-'));
  tempRoots.push(dir);
  return dir;
}

/** 最小 ACP 服务端（ndjson）：审批请求由 env 文件回传客户端决策。 */
function writeFakeAcp(dir: string): string {
  const script = join(dir, 'fake-acp.cjs');
  writeFileSync(script, `'use strict';
const readline = require('node:readline');
const fs = require('node:fs');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
let pendingPromptId = null;
const hangInit = process.env.FAKE_HANG_INIT === '1';
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === undefined && msg.id === 900) {
    const outcome = msg.result && msg.result.outcome;
    fs.writeFileSync(process.env.FAKE_DECISION_FILE, JSON.stringify(outcome));
    send({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'end_turn' } });
    return;
  }
  if (msg.method === 'initialize') {
    if (hangInit) return;
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' }, agentCapabilities: { mcpCapabilities: { http: true } } } });
    return;
  }
  if (msg.method === 'session/new') { send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'fake-session', configOptions: [] } }); return; }
  if (msg.method === 'session/list') { send({ jsonrpc: '2.0', id: msg.id, result: { sessions: [{ sessionId: 'fake-session', cwd: process.cwd() }] } }); return; }
  if (msg.method === 'session/resume') { send({ jsonrpc: '2.0', id: msg.id, result: { configOptions: [] } }); return; }
  if (msg.method === 'session/close') { send({ jsonrpc: '2.0', id: msg.id, result: {} }); return; }
  if (msg.method === 'session/prompt') {
    pendingPromptId = msg.id;
    if (msg.params.prompt[0].text === 'FAIL') { send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'fake failure' } }); return; }
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'delta-1' } } } });
    send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: msg.params.sessionId, toolCall: { toolCallId: 'c1' }, options: [{ optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' }] } });
    return;
  }
});
`, 'utf8');
  return script;
}

type AcpHandle = ReturnType<typeof spawnAcpProcess>['client'];

function startClient(dir: string, extraEnv: NodeJS.ProcessEnv = {}): { client: AcpHandle; child: ChildProcessWithoutNullStreams } {
  const spawned = spawnAcpProcess({
    command: process.execPath,
    args: [writeFakeAcp(dir)],
    cwd: dir,
    env: { ...process.env, FAKE_DECISION_FILE: join(dir, 'decision.json'), ...extraEnv },
    clientOptions: { initializeTimeoutMs: 5_000, requestTimeoutMs: 5_000 },
  });
  children.push(spawned.child);
  return spawned;
}

afterAll(() => {
  for (const child of children) {
    try { child.kill(); } catch { /* 已退出 */ }
  }
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describe('acp-client: 协议方法映射', () => {
  it('initialize/new/list/resume/close 均按 NDJSON 协议往返', async () => {
    const dir = makeTempRoot();
    const { client } = startClient(dir);

    const initialized = await client.initialize();
    expect(initialized.protocolVersion).toBe(1);
    expect(initialized.agentInfo.name).toBe('deepseek-harness-acp');

    const created = await client.newSession({ cwd: dir });
    expect(created.sessionId).toBe('fake-session');

    const listed = await client.listSessions({ cwd: dir });
    expect(listed.sessions[0]?.sessionId).toBe('fake-session');

    const resumed = await client.resumeSession({ sessionId: 'fake-session', cwd: dir });
    expect(resumed.configOptions).toEqual([]);

    await client.closeSession('fake-session');
    client.dispose();
  });

  it('prompt：收到 session/update 通知；服务端审批请求默认按 reject-once 应答（fail-closed）', async () => {
    const dir = makeTempRoot();
    const decisionFile = join(dir, 'decision.json');
    const { client } = startClient(dir);
    await client.initialize();

    const updates: string[] = [];
    client.onSessionUpdate(update => updates.push(update.update.sessionUpdate));
    const result = await client.prompt({ sessionId: 'fake-session', text: 'hello' });

    expect(result.stopReason).toBe('end_turn');
    expect(updates).toContain('agent_message_chunk');
    const decision = JSON.parse(readFileSync(decisionFile, 'utf8')) as { outcome: string; optionId: string };
    expect(decision).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    client.dispose();
  });
});

describe('acp-client: 失败与边界', () => {
  it('JSON-RPC error ⇒ SIDECAR_PROTOCOL_ERROR（message 保留 rpc code）', async () => {
    const dir = makeTempRoot();
    const { client } = startClient(dir);
    await client.initialize();
    let caught: unknown = null;
    try { await client.prompt({ sessionId: 'fake-session', text: 'FAIL' }); } catch (err: unknown) { caught = err; }
    expect(caught).toMatchObject({ code: 'SIDECAR_PROTOCOL_ERROR', retryable: false });
    expect((caught as Error).message).toContain('-32603');
    client.dispose();
  });

  it('initialize 不应答 ⇒ SIDECAR_START_TIMEOUT（不空成功）', async () => {
    const dir = makeTempRoot();
    const spawned = spawnAcpProcess({
      command: process.execPath,
      args: [writeFakeAcp(dir)],
      cwd: dir,
      env: { ...process.env, FAKE_HANG_INIT: '1', FAKE_DECISION_FILE: join(dir, 'decision.json') },
      clientOptions: { initializeTimeoutMs: 300, requestTimeoutMs: 300 },
    });
    children.push(spawned.child);
    let caught: unknown = null;
    try { await spawned.client.initialize(); } catch (err: unknown) { caught = err; }
    expect(caught).toMatchObject({ code: 'SIDECAR_START_TIMEOUT', retryable: true });
  });

  it('进程退出 ⇒ 后续请求以 SIDECAR_SESSION_LOST 失败', async () => {
    const dir = makeTempRoot();
    const { client, child } = startClient(dir);
    await client.initialize();
    child.kill();
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150));
    let caught: unknown = null;
    try { await client.newSession({ cwd: dir }); } catch (err: unknown) { caught = err; }
    expect(caught).toMatchObject({ code: 'SIDECAR_SESSION_LOST', retryable: true });
    client.dispose();
  });
});
