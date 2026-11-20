/**
 * tests/runtime/dsh/sandbox-lifecycle.test.ts — 同一生命周期核心的合成进程测试 + 生产接线断言。
 *
 * 真实入口：`SandboxLifecycle.psm1` 的 `Invoke-SandboxLifecycle`。测试只把进程适配器换成
 * 合成适配器（不启动 WindowsSandbox、不操作系统进程），并静态断言 Start-DshSandbox.ps1
 * 确实调用同一核心 + Real adapter、且自身不实现关闭逻辑。
 *
 * 覆盖：正常完成、脚本失败、超时、进程先退出、陈旧 nonce、PID/StartTime 漂移、拒绝销毁；
 * runtime bundle 哈希由 host 侧生产者脚本提供（存在 ⇒ 64 位 hex，缺失 ⇒ 保持 null，
 * 生产者给非法值 ⇒ FAILED 且不写伪造值）；另断言不存在按进程名全局终止。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';
const describeWindows = WINDOWS ? describe : describe.skip;
const REPO_ROOT = process.cwd();
const PS = process.env.SYNO_TEST_POWERSHELL ?? 'powershell';
const SANDBOX_DIR = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox');
const MODULE = join(SANDBOX_DIR, 'SandboxLifecycle.psm1');
const START = join(SANDBOX_DIR, 'Start-DshSandbox.ps1');
const REAL_ADAPTER = join(SANDBOX_DIR, 'RealSandboxProcessAdapter.ps1');
const PRODUCER = join(SANDBOX_DIR, 'Get-DshRuntimeBundleSha256.ps1');

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-1411-lifecycle-'));
  tempRoots.push(dir);
  return dir;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

interface PsResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runPsFile(script: string, args: string[], env: NodeJS.ProcessEnv = {}, timeoutMs = 120_000): Promise<PsResult> {
  return new Promise<PsResult>(resolvePromise => {
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, timeoutMs);
    child.on('exit', code => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
  });
}

const SYNTHETIC_ADAPTER = `$script:SynthScenario = if ($env:SYNTH_SCENARIO) { $env:SYNTH_SCENARIO } else { 'complete' }
$script:SynthStarted = $false
$script:SynthStart = $null
$script:SynthExited = $false
function Start-SandboxProcess {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)
  $script:SynthStarted = $true
  $script:SynthStart = Get-Date
  return [pscustomobject]@{ Pid = 424242; StartTime = $script:SynthStart }
}
function Get-SandboxProcess {
  param([Parameter(Mandatory = $true)][int]$Pid)
  if ($script:SynthScenario -eq 'exit') { return $null }
  if ($script:SynthScenario -ne 'close-refuse' -and $script:SynthExited) { return $null }
  $start = $script:SynthStart
  if ($null -eq $start) { $start = Get-Date }
  if ($script:SynthScenario -eq 'identity-drift') { $start = $start.AddSeconds(5) }
  return [pscustomobject]@{ Pid = $Pid; StartTime = $start }
}
function Wait-SandboxProcessExit {
  param([Parameter(Mandatory = $true)][int]$Pid, [int]$TimeoutMs = 30000)
  if ($script:SynthScenario -eq 'close-refuse') { return $false }
  $script:SynthExited = $true
  return $true
}
function Close-SandboxMainWindow {
  param([Parameter(Mandatory = $true)][int]$Pid)
  return $true
}
function Stop-SandboxProcess {
  param([Parameter(Mandatory = $true)][int]$Pid)
  if ($script:SynthScenario -eq 'close-refuse') { return $false }
  $script:SynthExited = $true
  return $true
}
`;

interface LifecycleFixture {
  taskRoot: string;
  buildId: string;
  buildDir: string;
  incoming: string;
  outgoing: string;
  nonce: string;
  configPath: string;
  orchestrationPath: string;
  adapterPath: string;
  runnerPath: string;
  startedPath: string;
  finishedPath: string;
  bundlePath: string;
  sandboxId: string;
}

function writeSentinel(path: string, extra: Record<string, unknown>, binding: { sandboxId: string; nonce: string; configSha256: string; manifestSha256: string }): void {
  writeFileSync(path, JSON.stringify({
    issue: 1411,
    mode: 'build',
    sandboxId: binding.sandboxId,
    nonce: binding.nonce,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    configSha256: binding.configSha256,
    inputManifestSha256: binding.manifestSha256,
    ...extra,
  }, null, 2));
}

function createFixture(options: {
  sentinels: 'none' | 'started-only' | 'finished' | 'finished-failed' | 'stale-nonce';
  scenario: string;
  bundle?: Buffer;
  providerScript?: string;
}): LifecycleFixture {
  const taskRoot = makeTempRoot();
  const buildId = randomUUID();
  const buildDir = join(taskRoot, 'build', buildId);
  const incoming = join(buildDir, 'incoming');
  const outgoing = join(buildDir, 'outgoing');
  mkdirSync(incoming, { recursive: true });
  mkdirSync(outgoing, { recursive: true });
  const nonce = 'd'.repeat(32);
  const manifest = {
    schemaVersion: 1,
    issue: 1411,
    mode: 'build',
    sandboxId: buildId,
    nonce,
    baseSha: 'b'.repeat(40),
    codeSha: 'a'.repeat(40),
    codeArchivePath: `synova-${'a'.repeat(40)}.zip`,
    codeArchiveSha256: 'c'.repeat(64),
    createdAt: new Date().toISOString(),
    entryScript: { path: 'scripts/Invoke-DshSandboxBuild.ps1', sha256: '0'.repeat(64) },
    files: [],
  };
  const manifestPath = join(incoming, 'input-manifest.json');
  writeJson(manifestPath, manifest);
  const configPath = join(buildDir, 'build.wsb');
  writeFileSync(configPath, '<Configuration><Networking>Enable</Networking></Configuration>');
  const configSha256 = sha256(configPath);
  const manifestSha256 = sha256(manifestPath);
  const orchestrationPath = join(buildDir, 'orchestration.json');
  writeJson(orchestrationPath, {
    schemaVersion: 1,
    issue: 1411,
    mode: 'build',
    baseSha: 'b'.repeat(40),
    codeSha: 'a'.repeat(40),
    codeArchivePath: `synova-${'a'.repeat(40)}.zip`,
    codeArchiveSha256: 'c'.repeat(64),
    sandboxId: buildId,
    nonce,
    configSha256,
    inputManifestSha256: manifestSha256,
    runtimeBundleSha256: null,
    state: 'PREPARED',
    hostPid: null,
    hostProcessStartTime: null,
    startedAt: null,
    finishedAt: null,
    destroyedAt: null,
    scriptExitCode: null,
    hostExitCode: null,
    startedSentinel: null,
    finishedSentinel: null,
    handoff: null,
  });

  const binding = { sandboxId: buildId, nonce, configSha256, manifestSha256 };
  const startedPath = join(outgoing, 'RUN_STARTED.json');
  const finishedPath = join(outgoing, 'RUN_FINISHED.json');
  if (options.sentinels !== 'none') {
    writeSentinel(startedPath, {}, binding);
  }
  if (options.sentinels === 'finished') {
    writeSentinel(finishedPath, {
      finishedAt: new Date().toISOString(),
      scriptExitCode: 0,
      artifactManifestSha256: 'e'.repeat(64),
    }, binding);
  }
  if (options.sentinels === 'finished-failed') {
    writeSentinel(finishedPath, {
      finishedAt: new Date().toISOString(),
      scriptExitCode: 1,
      artifactManifestSha256: 'e'.repeat(64),
    }, binding);
  }
  if (options.sentinels === 'stale-nonce') {
    writeSentinel(finishedPath, {
      finishedAt: new Date().toISOString(),
      scriptExitCode: 0,
      artifactManifestSha256: 'e'.repeat(64),
    }, { ...binding, nonce: 'f'.repeat(32) });
  }

  const adapterPath = join(taskRoot, 'synthetic-adapter.ps1');
  writeFileSync(adapterPath, SYNTHETIC_ADAPTER);
  const bundlePath = join(outgoing, 'runtime-bundle.zip');
  if (options.bundle !== undefined) { writeFileSync(bundlePath, options.bundle); }
  let providerPath = PRODUCER;
  if (options.providerScript !== undefined) {
    providerPath = join(taskRoot, 'synthetic-producer.ps1');
    writeFileSync(providerPath, options.providerScript);
  }
  const runnerPath = join(taskRoot, 'run-lifecycle.ps1');
  writeFileSync(runnerPath, [
    "$ErrorActionPreference = 'Stop'",
    `$env:SYNTH_SCENARIO = '${options.scenario}'`,
    `Import-Module -Name '${MODULE}' -Force`,
    `$code = Invoke-SandboxLifecycle -Mode Build -ConfigPath '${configPath}' -OrchestrationPath '${orchestrationPath}' ` +
      `-IncomingDir '${incoming}' -OutgoingDir '${outgoing}' -AdapterPath '${adapterPath}' ` +
      `-RuntimeBundleSha256ProviderPath '${providerPath}' ` +
      '-FinishTimeoutSec 2 -CloseGraceSec 1 -PollMilliseconds 100',
    'exit $code',
    '',
  ].join('\n'));

  return { taskRoot, buildId, buildDir, incoming, outgoing, nonce, configPath, orchestrationPath, adapterPath, runnerPath, startedPath, finishedPath, bundlePath, sandboxId: buildId };
}

function readOrchestration(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describeWindows('T2 沙箱生命周期核心（合成适配器）', () => {
  it('正常完成 ⇒ FINISHED→DESTROYED，exit 0，哨兵与 runtime bundle 哈希入账', async () => {
    const bundleBytes = Buffer.from('runtime-bundle-fixture-bytes');
    const f = createFixture({ sentinels: 'finished', scenario: 'complete', bundle: bundleBytes });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(0);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('DESTROYED');
    expect(state.hostPid).toBe(424242);
    expect(state.destroyedAt).not.toBeNull();
    expect(state.scriptExitCode).toBe(0);
    expect(state.hostExitCode).toBe(0);
    expect(state.runtimeBundleSha256).toBe(sha256(f.bundlePath));
    expect(String(state.runtimeBundleSha256)).toMatch(/^[0-9a-f]{64}$/);
    const started = state.startedSentinel as { path: string; sha256: string };
    const finished = state.finishedSentinel as { path: string; sha256: string };
    expect(started.path).toBe(`build/${f.buildId}/outgoing/RUN_STARTED.json`);
    expect(started.sha256).toBe(sha256(f.startedPath));
    expect(finished.sha256).toBe(sha256(f.finishedPath));
  }, 120_000);

  it('bundle 不存在 ⇒ FINISHED→DESTROYED，runtimeBundleSha256 保持 null（不写空串/占位）', async () => {
    const f = createFixture({ sentinels: 'finished', scenario: 'complete' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(0);
    expect(existsSync(f.bundlePath)).toBe(false);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('DESTROYED');
    expect(state.runtimeBundleSha256).toBeNull();
    const raw = readFileSync(f.orchestrationPath, 'utf8');
    expect(raw).toMatch(/"runtimeBundleSha256":\s+null/);
    expect(raw).not.toMatch(/"runtimeBundleSha256":\s+""/);
  }, 120_000);

  it('生产者返回非 sha256 值 ⇒ FAILED + RUNTIME_BUNDLE_HASH_INVALID，不写伪造哈希', async () => {
    const f = createFixture({
      sentinels: 'finished',
      scenario: 'complete',
      bundle: Buffer.from('runtime-bundle-fixture-bytes'),
      providerScript: "param([Parameter(Mandatory = $true)][string]$OutgoingDir)\nreturn 'placeholder-hash'\n",
    });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(1);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('FAILED');
    expect(state.runtimeBundleSha256).toBeNull();
    const failure = JSON.parse(readFileSync(join(f.buildDir, 'failure.json'), 'utf8')) as { code: string };
    expect(failure.code).toBe('RUNTIME_BUNDLE_HASH_INVALID');
  }, 120_000);

  it('脚本失败（RUN_FINISHED.scriptExitCode=1）⇒ 状态 FAILED，exit 1，仍销毁', async () => {
    const f = createFixture({ sentinels: 'finished-failed', scenario: 'complete' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(1);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('FAILED');
    expect(state.scriptExitCode).toBe(1);
    expect(state.destroyedAt).not.toBeNull();
  }, 120_000);

  it('无完成哨兵 ⇒ TIMED_OUT，exit 1', async () => {
    const f = createFixture({ sentinels: 'started-only', scenario: 'complete' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(1);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('TIMED_OUT');
    expect(existsSync(join(f.buildDir, 'failure.json'))).toBe(true);
  }, 120_000);

  it('进程先退出且无哨兵 ⇒ FAILED，exit 1', async () => {
    const f = createFixture({ sentinels: 'none', scenario: 'exit' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(1);
    expect(readOrchestration(f.orchestrationPath).state).toBe('FAILED');
  }, 120_000);

  it('陈旧 nonce ⇒ 拒绝该哨兵（FAILED，exit 1）', async () => {
    const f = createFixture({ sentinels: 'stale-nonce', scenario: 'complete' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(1);
    expect(readOrchestration(f.orchestrationPath).state).toBe('FAILED');
  }, 120_000);

  it('PID/StartTime 漂移 ⇒ 拒绝销毁，exit 2，不写 DESTROYED', async () => {
    const f = createFixture({ sentinels: 'finished', scenario: 'identity-drift' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(2);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('FAILED');
    expect(state.destroyedAt).toBeNull();
    const failure = JSON.parse(readFileSync(join(f.buildDir, 'failure.json'), 'utf8')) as { code: string };
    expect(failure.code).toBe('DESTROY_FAILED');
  }, 120_000);

  it('拒绝销毁（窗口不关、Stop 失败）⇒ exit 2 且不冒充 DESTROYED', async () => {
    const f = createFixture({ sentinels: 'finished', scenario: 'close-refuse' });
    const result = await runPsFile(f.runnerPath, []);
    expect(result.code).toBe(2);
    const state = readOrchestration(f.orchestrationPath);
    expect(state.state).toBe('FAILED');
    expect(state.destroyedAt).toBeNull();
  }, 120_000);
});

describeWindows('T2 生产接线与全局终止禁令', () => {
  it('Start 只做薄 CLI：调用同一核心 + Real adapter，不自带关闭逻辑', () => {
    const startText = readFileSync(START, 'utf8');
    expect(startText).toContain('Invoke-SandboxLifecycle');
    expect(startText).toContain('RealSandboxProcessAdapter.ps1');
    expect(startText).not.toContain('CloseMainWindow');
    expect(startText).not.toContain('Stop-Process');
  });

  it('模块与真实适配器都不含按名称全局终止（禁止 Stop-Process -Name）', () => {
    const moduleText = readFileSync(MODULE, 'utf8');
    const adapterText = readFileSync(REAL_ADAPTER, 'utf8');
    expect(moduleText).not.toMatch(/^\s*Stop-Process\s+-Name/m);
    expect(adapterText).not.toMatch(/^\s*Stop-Process\s+-Name/m);
    expect(adapterText).toContain('CloseMainWindow');
    expect(adapterText).toContain('Stop-Process -Id');
    expect(moduleText).toContain('function Invoke-SandboxLifecycle');
    expect(moduleText).toContain('Close-SandboxMainWindow');
  });
});

// 只读仓库文本、不 spawn 进程 ⇒ 与平台无关，放在平台闸外，Linux CI 也真实执行
// （#1427 §2.4 同型：静态接线用例被文件级 Windows 闸误拦）。
describe('T2 生产接线与静态契约（跨平台）', () => {
  it('bundle 哈希生产者只在 host 侧：Start 注入、lifecycle 不碰 bundle 路径、沙箱入口脚本不写字段', () => {
    const startText = readFileSync(START, 'utf8');
    expect(startText).toContain('Get-DshRuntimeBundleSha256.ps1');
    expect(startText).toContain('-RuntimeBundleSha256ProviderPath');
    const moduleText = readFileSync(MODULE, 'utf8');
    expect(moduleText).toContain('RuntimeBundleSha256ProviderPath');
    expect(moduleText).not.toMatch(/runtime-bundle\.zip/);
    const buildText = readFileSync(join(SANDBOX_DIR, 'Invoke-DshSandboxBuild.ps1'), 'utf8');
    expect(buildText).not.toContain('runtimeBundleSha256');
    expect(buildText).not.toContain('Get-DshRuntimeBundleSha256');
  });
});
