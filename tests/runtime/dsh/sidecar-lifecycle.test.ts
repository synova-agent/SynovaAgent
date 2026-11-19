/**
 * T1 验收：synova-sidecar profile 安全姿态 + Sidecar 生命周期（start/status/stop/logs）。
 *
 * 真实入口：本测试直接 spawn `src/runtime/dsh/sidecar.ts` 的 CLI（与
 * `scripts/dsh-sidecar/*.ps1` 调同一个 action），中间 ACP 子进程用临时目录里生成的
 * fake ACP（node 脚本，ndjson JSON-RPC），不读凭据、不外发、不碰真实 dsh 安装。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertSidecarProfile, defaultProfileDir, loadSidecarProfile } from '../../../src/runtime/dsh/profile';

const REPO_ROOT = process.cwd();
const SIDECAR_ENTRY = join(REPO_ROOT, 'src', 'runtime', 'dsh', 'sidecar.ts');
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-1a-t1-'));
  tempRoots.push(dir);
  return dir;
}

/** 生成一个最小 ACP 服务端（ndjson），行为由 env 控制（hang / 错误 agent 名）。 */
function writeFakeAcp(dir: string): string {
  const script = join(dir, 'fake-acp.cjs');
  writeFileSync(script, `'use strict';
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const agentName = process.env.FAKE_AGENT_NAME !== undefined ? process.env.FAKE_AGENT_NAME : 'deepseek-harness-acp';
const hang = process.env.FAKE_HANG === '1';
const sessionId = 'fake-session-1';
function send(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
rl.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') {
    if (hang) return;
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: 1,
      agentInfo: { name: agentName, version: '0.0.1' },
      agentCapabilities: { mcpCapabilities: { http: true } },
    } });
    return;
  }
  if (message.method === 'session/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { sessions: [{ sessionId, cwd: process.cwd() }] } });
    return;
  }
  if (message.method === 'session/new') {
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId, configOptions: [] } });
    return;
  }
  if (message.method === 'session/resume' || message.method === 'session/close') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    return;
  }
});
`, 'utf8');
  return script;
}

interface CliResult {
  code: number | null;
  json: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

/** 调用 sidecar CLI（真实入口），解析最后一行 JSON。 */
function runSidecarCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise<CliResult>(resolvePromise => {
    const child = spawn(process.execPath, ['--import', 'tsx', SIDECAR_ENTRY, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('exit', code => {
      const lines = stdout.split(/\r?\n/).filter(line => line.trim().startsWith('{'));
      let json: Record<string, unknown> = {};
      const last = lines.at(-1);
      if (last !== undefined) {
        try { json = JSON.parse(last) as Record<string, unknown>; } catch { json = {}; }
      }
      resolvePromise({ code, json, stdout, stderr });
    });
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响断言 */ }
  }
});

describe('T1 synova-sidecar profile 安全姿态', () => {
  it('仓库内 profile 四件齐全且通过全部安全断言', () => {
    const profile = loadSidecarProfile(defaultProfileDir());
    for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      expect(existsSync(join(defaultProfileDir(), file)), `缺少 ${file}`).toBe(true);
    }
    expect(profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']);
    expect(() => { assertSidecarProfile(profile); }).not.toThrow();
    expect(profile.patchEntries.filter(entry => entry.disabled).length).toBe(17);
  });

  it('改坏必红：danger-full-access / 删除 disable / approval never 都被断言抓到', () => {
    const cases: Array<{ name: string; mutate: (text: string) => string; code: string }> = [
      { name: 'mode 改成 danger-full-access', mutate: text => text.replace('mode: read-only', 'mode: danger-full-access'), code: 'FORBIDDEN_TOKEN_PRESENT' },
      { name: '删掉 tool-pwsh 的 disable', mutate: text => text.replace('- id: tool-pwsh\n  disabled: true\n', ''), code: 'REQUIRED_DISABLE_MISSING' },
      { name: 'approval 改成 never', mutate: text => text.replace('policy: ask', 'policy: never'), code: 'APPROVAL_POLICY_NOT_ASK' },
    ];
    for (const testCase of cases) {
      const temp = makeTempRoot();
      const copy = join(temp, 'profile');
      cpSync(defaultProfileDir(), copy, { recursive: true });
      const patchPath = join(copy, 'cordis.patch.yml');
      const original = readFileSync(patchPath, 'utf8');
      const mutated = testCase.mutate(original);
      expect(mutated, `${testCase.name} 未命中替换目标`).not.toBe(original);
      writeFileSync(patchPath, mutated, 'utf8');
      expect(() => { assertSidecarProfile(loadSidecarProfile(copy)); }, testCase.name).toThrow(new RegExp(testCase.code));
    }
  });
});

describe('T1 Sidecar 生命周期（真实 CLI + fake ACP）', () => {
  it('start → ready（ACP initialize）→ status → logs → stop → 进程消失 → status exit1', async () => {
    const root = makeTempRoot();
    const dshHome = join(root, 'dsh-home');
    const instanceDir = join(root, 'instance');
    mkdirSync(instanceDir, { recursive: true });
    const fake = writeFakeAcp(root);
    const common = ['--dsh-home', dshHome, '--instance-dir', instanceDir, '--acp-command', process.execPath, '--acp-arg', fake];

    const started = await runSidecarCli(['--action', 'start', ...common, '--start-timeout-ms', '30000']);
    expect(started.code).toBe(0);
    expect(started.json.ok).toBe(true);
    expect(started.json.ready).toBe(true);
    expect(started.json.agentName).toBe('deepseek-harness-acp');
    expect(started.json.protocolVersion).toBe(1);
    expect(started.json.instanceDir).toBe(instanceDir);
    expect(started.json.workspaceRoot).toBe(resolve(instanceDir));
    const supervisorPid = Number(started.json.supervisorPid);
    expect(supervisorPid).toBeGreaterThan(0);

    const status = await runSidecarCli(['--action', 'status', ...common]);
    expect(status.code).toBe(0);
    expect(status.json.ready).toBe(true);
    expect(status.json.controlReachable).toBe(true);

    const logs = await runSidecarCli(['--action', 'logs', ...common, '--lines', '200']);
    expect(logs.code).toBe(0);
    const lines = logs.json.lines;
    expect(Array.isArray(lines)).toBe(true);
    expect((lines as string[]).join('\n')).toContain('ready');
    expect((lines as string[]).join('\n')).toContain('"component":"sidecar"');

    const stopped = await runSidecarCli(['--action', 'stop', ...common]);
    expect(stopped.code).toBe(0);
    expect(stopped.json.stopped).toBe(true);
    expect(isAlive(supervisorPid)).toBe(false);
    expect(existsSync(join(dshHome, 'run', 'synova-sidecar.json'))).toBe(false);

    const statusAfter = await runSidecarCli(['--action', 'status', ...common]);
    expect(statusAfter.code).toBe(1);
    expect(statusAfter.json.code).toBe('SIDECAR_NOT_RUNNING');
    expect(statusAfter.json.retryable).toBe(false);
  }, 90_000);

  it('ACP 不应答 initialize ⇒ SIDECAR_START_TIMEOUT（不空成功）', async () => {
    const root = makeTempRoot();
    const dshHome = join(root, 'dsh-home');
    const instanceDir = join(root, 'instance');
    const fake = writeFakeAcp(root);
    const result = await runSidecarCli(
      ['--action', 'start', '--dsh-home', dshHome, '--instance-dir', instanceDir, '--acp-command', process.execPath,
        '--acp-arg', fake, '--start-timeout-ms', '2000'],
      { FAKE_HANG: '1' },
    );
    expect(result.code).toBe(1);
    expect(['SIDECAR_START_TIMEOUT', 'SIDECAR_SPAWN_FAILED']).toContain(result.json.code);
    expect(result.json.retryable).toBe(true);
    const status = await runSidecarCli(['--action', 'status', '--dsh-home', dshHome, '--instance-dir', instanceDir]);
    expect(status.code).toBe(1);
    expect(status.json.code).toBe('SIDECAR_NOT_RUNNING');
  }, 90_000);

  it('init 返回非 dsh ACP 服务端 ⇒ SIDECAR_PROTOCOL_ERROR（不冒充就绪）', async () => {
    const root = makeTempRoot();
    const dshHome = join(root, 'dsh-home');
    const instanceDir = join(root, 'instance');
    const fake = writeFakeAcp(root);
    const result = await runSidecarCli(
      ['--action', 'start', '--dsh-home', dshHome, '--instance-dir', instanceDir, '--acp-command', process.execPath,
        '--acp-arg', fake, '--start-timeout-ms', '30000'],
      { FAKE_AGENT_NAME: 'not-an-acp-server' },
    );
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('SIDECAR_PROTOCOL_ERROR');
    expect(result.json.retryable).toBe(false);
  }, 90_000);
});
/** 造一个 npm 安装布局（node_modules/@deepseek-ai/dsh/package.json + lib/bin.js 占位）。 */
function writeInstallLayout(version: string): { installDir: string; dshHome: string; instanceDir: string } {
  const root = makeTempRoot();
  const installDir = join(root, 'install', version);
  const pkgDir = join(installDir, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(join(pkgDir, 'lib'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }), 'utf8');
  writeFileSync(join(pkgDir, 'lib', 'bin.js'), '// version-gate stub: never spawned by the rejection cases\n', 'utf8');
  const dshHome = join(root, 'dsh-home');
  const instanceDir = join(root, 'instance');
  mkdirSync(instanceDir, { recursive: true });
  return { installDir, dshHome, instanceDir };
}

describe('T1 固定版本门（生产锁 rc.5；rc.2 仅显式回退）', () => {
  it('伪造 expected-version rc.3 ⇒ exit 1 + DSH_VERSION_MISMATCH，不落状态文件（不 spawn）', async () => {
    const layout = writeInstallLayout('0.2.2-rc.2');
    const result = await runSidecarCli(['--action', 'start', '--dsh-home', layout.dshHome, '--instance-dir', layout.instanceDir,
      '--install-dir', layout.installDir, '--expected-version', '0.2.2-rc.3']);
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('DSH_VERSION_MISMATCH');
    expect(result.json.retryable).toBe(false);
    expect(existsSync(join(layout.dshHome, 'run', 'synova-sidecar.json'))).toBe(false);
  }, 30_000);

  it('空值 expected-version ⇒ 同样 DSH_VERSION_MISMATCH（不把空串当缺省）', async () => {
    const layout = writeInstallLayout('0.2.2-rc.5');
    const result = await runSidecarCli(['--action', 'start', '--dsh-home', layout.dshHome, '--instance-dir', layout.instanceDir,
      '--install-dir', layout.installDir, '--expected-version', '']);
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('DSH_VERSION_MISMATCH');
    expect(existsSync(join(layout.dshHome, 'run', 'synova-sidecar.json'))).toBe(false);
  }, 30_000);

  it('已安装 rc.2 且未显式指定 ⇒ DSH_VERSION_MISMATCH，不 spawn', async () => {
    const layout = writeInstallLayout('0.2.2-rc.2');
    const result = await runSidecarCli(['--action', 'start', '--dsh-home', layout.dshHome, '--instance-dir', layout.instanceDir,
      '--install-dir', layout.installDir, '--start-timeout-ms', '2000']);
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('DSH_VERSION_MISMATCH');
    expect(result.json.phase).toBe('spawn');
    expect(existsSync(join(layout.dshHome, 'run', 'synova-sidecar.json'))).toBe(false);
  }, 30_000);

  it('历史 rc.1 不再是可显式选择回退 ⇒ DSH_VERSION_MISMATCH，不 spawn', async () => {
    const layout = writeInstallLayout('0.2.2-rc.1');
    const result = await runSidecarCli(['--action', 'start', '--dsh-home', layout.dshHome, '--instance-dir', layout.instanceDir,
      '--install-dir', layout.installDir, '--expected-version', '0.2.2-rc.1']);
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('DSH_VERSION_MISMATCH');
    expect(result.json.retryable).toBe(false);
    expect(existsSync(join(layout.dshHome, 'run', 'synova-sidecar.json'))).toBe(false);
  }, 30_000);

  it('显式 expected-version rc.2 + 注入 ACP ⇒ 启动成功（回退只在显式路径）', async () => {
    const root = makeTempRoot();
    const layout = writeInstallLayout('0.2.2-rc.2');
    const fake = writeFakeAcp(root);
    const common = ['--dsh-home', layout.dshHome, '--instance-dir', layout.instanceDir, '--install-dir', layout.installDir,
      '--acp-command', process.execPath, '--acp-arg', fake, '--expected-version', '0.2.2-rc.2'];
    const started = await runSidecarCli(['--action', 'start', ...common, '--start-timeout-ms', '30000']);
    expect(started.code).toBe(0);
    expect(started.json.ready).toBe(true);
    expect(started.json.expectedVersion).toBeUndefined();
    const status = await runSidecarCli(['--action', 'status', ...common]);
    expect(status.code).toBe(0);
    expect(status.json.installedVersion).toBe('0.2.2-rc.2');
    const stopped = await runSidecarCli(['--action', 'stop', ...common]);
    expect(stopped.code).toBe(0);
    expect(stopped.json.stopped).toBe(true);
  }, 90_000);

  it('status 读不到安装目录 ⇒ installedVersion=null（不猜版本、不冒充已核）', async () => {
    const root = makeTempRoot();
    const dshHome = join(root, 'dsh-home');
    const instanceDir = join(root, 'instance');
    mkdirSync(instanceDir, { recursive: true });
    const fake = writeFakeAcp(root);
    const common = ['--dsh-home', dshHome, '--instance-dir', instanceDir, '--acp-command', process.execPath, '--acp-arg', fake];
    const started = await runSidecarCli(['--action', 'start', ...common, '--start-timeout-ms', '30000']);
    expect(started.code).toBe(0);
    const status = await runSidecarCli(['--action', 'status', ...common]);
    expect(status.code).toBe(0);
    expect(status.json.installedVersion).toBeNull();
    await runSidecarCli(['--action', 'stop', ...common]);
  }, 90_000);
});