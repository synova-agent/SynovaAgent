/**
 * tests/runtime/dsh/sandbox-handoff.test.ts — Complete-DshBuildHandoff 的交接契约与反例。
 *
 * 真实入口：以 PowerShell 调 `scripts/dsh-sidecar/sandbox/Complete-DshBuildHandoff.ps1`
 * （唯一交接入口），全部在合成任务目录里执行，不启动 Windows Sandbox、不执行任何下载物。
 *
 * 覆盖：happy path（只复制探针入口脚本 + runtime-bundle.zip、原子改名为 incoming、写
 * handoff.json）、缺 build-result、0 tests、failed>0、日志哈希错、bundle 被改、
 * codeArchive 不一致、probe 目录非空、重复交接、staging 多文件、orchestration 未 DESTROYED；
 * 以及 #1446 的生产链：lifecycle 用 host 侧生产者写入 runtimeBundleSha256 ⇒ handoff 接受，
 * bundle 缺失 ⇒ 字段保持 null 且 handoff 以 HANDOFF_ORCHESTRATION 拒绝。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';
const describeWindows = WINDOWS ? describe : describe.skip;
const REPO_ROOT = process.cwd();
const PS = process.env.SYNO_TEST_POWERSHELL ?? 'powershell';
const SANDBOX_DIR = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox');
const HANDOFF = join(SANDBOX_DIR, 'Complete-DshBuildHandoff.ps1');
const LIFECYCLE_MODULE = join(SANDBOX_DIR, 'SandboxLifecycle.psm1');
const BUNDLE_PRODUCER = join(SANDBOX_DIR, 'Get-DshRuntimeBundleSha256.ps1');

const SYNTHETIC_ADAPTER = `$script:SynthStart = $null
$script:SynthExited = $false
function Start-SandboxProcess {
  param([Parameter(Mandatory = $true)][string]$ConfigPath)
  $script:SynthStart = Get-Date
  return [pscustomobject]@{ Pid = 424242; StartTime = $script:SynthStart }
}
function Get-SandboxProcess {
  param([Parameter(Mandatory = $true)][int]$Pid)
  if ($script:SynthExited) { return $null }
  $start = $script:SynthStart
  if ($null -eq $start) { $start = Get-Date }
  return [pscustomobject]@{ Pid = $Pid; StartTime = $start }
}
function Wait-SandboxProcessExit {
  param([Parameter(Mandatory = $true)][int]$Pid, [int]$TimeoutMs = 30000)
  $script:SynthExited = $true
  return $true
}
function Close-SandboxMainWindow {
  param([Parameter(Mandatory = $true)][int]$Pid)
  return $true
}
function Stop-SandboxProcess {
  param([Parameter(Mandatory = $true)][int]$Pid)
  $script:SynthExited = $true
  return $true
}
`;

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-1411-handoff-'));
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
  json: Record<string, unknown>;
}

function runPs(script: string, args: string[], timeoutMs = 120_000): Promise<PsResult> {
  return new Promise<PsResult>(resolvePromise => {
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
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
      let json: Record<string, unknown> = {};
      const line = stdout.split(/\r?\n/).map(item => item.trim()).filter(item => item.startsWith('{')).at(-1);
      if (line !== undefined) {
        try { json = JSON.parse(line) as Record<string, unknown>; } catch { json = {}; }
      }
      resolvePromise({ code, stdout, stderr, json });
    });
  });
}

interface HandoffFixture {
  taskRoot: string;
  buildId: string;
  buildDir: string;
  incoming: string;
  outgoing: string;
  probeId: string;
  probeDir: string;
  codeSha: string;
  codeArchiveSha256: string;
  bundleSha256: string | null;
  manifestPath: string;
  orchestrationPath: string;
  buildResultPath: string;
  configPath: string;
  adapterPath: string;
  runnerPath: string;
}

function createFixture(options: { prepare?: boolean; withBundle?: boolean } = {}): HandoffFixture {
  const taskRoot = makeTempRoot();
  const buildId = randomUUID();
  const probeId = randomUUID();
  const buildDir = join(taskRoot, 'build', buildId);
  const incoming = join(buildDir, 'incoming');
  const outgoing = join(buildDir, 'outgoing');
  const probeDir = join(taskRoot, 'probe', probeId);
  mkdirSync(join(incoming, 'scripts'), { recursive: true });
  mkdirSync(join(outgoing, 'build-evidence'), { recursive: true });
  const codeSha = 'a'.repeat(40);
  const codeArchiveName = `synova-${codeSha}.zip`;
  writeFileSync(join(incoming, codeArchiveName), 'code-archive-bytes');
  writeFileSync(join(incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1'), '# build entry (fixture)\n');
  const codeArchiveSha256 = sha256(join(incoming, codeArchiveName));
  const configPath = join(buildDir, 'build.wsb');
  writeFileSync(configPath, '<Configuration><Networking>Enable</Networking></Configuration>');
  const nonce = 'd'.repeat(32);
  const manifest = {
    schemaVersion: 1,
    issue: 1411,
    mode: 'build',
    sandboxId: buildId,
    nonce,
    baseSha: 'b'.repeat(40),
    codeSha,
    codeArchivePath: codeArchiveName,
    codeArchiveSha256,
    createdAt: new Date().toISOString(),
    entryScript: { path: 'scripts/Invoke-DshSandboxBuild.ps1', sha256: sha256(join(incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1')) },
    entryScripts: {
      build: { path: 'scripts/Invoke-DshSandboxBuild.ps1', sha256: sha256(join(incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1')) },
      probe: { path: 'scripts/Invoke-DshSandboxProbe.ps1', sha256: '0'.repeat(64) },
    },
    files: [
      { path: 'scripts/Invoke-DshSandboxBuild.ps1', bytes: readFileSync(join(incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1')).length, sha256: sha256(join(incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1')) },
      { path: codeArchiveName, bytes: readFileSync(join(incoming, codeArchiveName)).length, sha256: codeArchiveSha256 },
    ],
  };
  const manifestPath = join(incoming, 'input-manifest.json');
  writeJson(manifestPath, manifest);

  // staging: the real probe entry script, hash-bound in the build manifest
  const stagingDir = join(taskRoot, 'probe', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  const probeEntrySource = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox', 'Invoke-DshSandboxProbe.ps1');
  const stagingEntry = join(stagingDir, 'Invoke-DshSandboxProbe.ps1');
  writeFileSync(stagingEntry, readFileSync(probeEntrySource));
  const probeEntrySha256 = sha256(stagingEntry);
  manifest.entryScripts.probe.sha256 = probeEntrySha256;
  writeJson(manifestPath, manifest);

  // build artifacts in outgoing
  const withBundle = options.withBundle ?? true;
  const bundlePath = join(outgoing, 'runtime-bundle.zip');
  if (withBundle) { writeFileSync(bundlePath, Buffer.from('runtime-bundle-fixture-bytes')); }
  const bundleSha256 = withBundle ? sha256(bundlePath) : null;
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const finishedAt = new Date(Date.now() - 30_000).toISOString();
  const destroyedAt = new Date(Date.now() - 10_000).toISOString();
  writeJson(join(outgoing, 'RUN_STARTED.json'), {
    issue: 1411, mode: 'build', sandboxId: buildId, nonce, startedAt,
    configSha256: sha256(configPath), inputManifestSha256: sha256(manifestPath),
  });
  writeJson(join(outgoing, 'RUN_FINISHED.json'), {
    issue: 1411, mode: 'build', sandboxId: buildId, nonce, startedAt, finishedAt,
    configSha256: sha256(configPath), inputManifestSha256: sha256(manifestPath),
    scriptExitCode: 0, artifactManifestSha256: 'e'.repeat(64),
  });
  const testsLog = join(outgoing, 'build-evidence', 'tests.log');
  const lintLog = join(outgoing, 'build-evidence', 'lint.log');
  writeFileSync(testsLog, 'Tests 10 passed (10)\n');
  writeFileSync(lintLog, 'tsc --noEmit: 0 errors\n');
  const buildResultPath = join(outgoing, 'build-evidence', 'build-result.json');
  writeJson(buildResultPath, {
    schemaVersion: 1,
    issue: 1411,
    codeSha,
    codeArchiveSha256,
    tests: { command: 'vitest run tests/runtime/dsh', exitCode: 0, total: 10, passed: 10, failed: 0, logPath: 'build-evidence/tests.log', logSha256: sha256(testsLog) },
    lint: { command: 'tsc --noEmit', exitCode: 0, logPath: 'build-evidence/lint.log', logSha256: sha256(lintLog) },
  });

  const orchestrationPath = join(buildDir, 'orchestration.json');
  writeJson(orchestrationPath, {
    schemaVersion: 1,
    issue: 1411,
    mode: 'build',
    baseSha: 'b'.repeat(40),
    codeSha,
    codeArchivePath: codeArchiveName,
    codeArchiveSha256,
    sandboxId: buildId,
    nonce,
    configSha256: sha256(configPath),
    inputManifestSha256: sha256(manifestPath),
    runtimeBundleSha256: bundleSha256,
    state: 'DESTROYED',
    hostPid: 424242,
    hostProcessStartTime: startedAt,
    startedAt,
    finishedAt,
    destroyedAt,
    scriptExitCode: 0,
    hostExitCode: 0,
    startedSentinel: { path: `build/${buildId}/outgoing/RUN_STARTED.json`, sha256: sha256(join(outgoing, 'RUN_STARTED.json')) },
    finishedSentinel: { path: `build/${buildId}/outgoing/RUN_FINISHED.json`, sha256: sha256(join(outgoing, 'RUN_FINISHED.json')) },
    handoff: null,
  });

  // Chain fixtures start from PREPARED so the real lifecycle writes the final orchestration.
  if (options.prepare === true) {
    writeJson(orchestrationPath, {
      schemaVersion: 1,
      issue: 1411,
      mode: 'build',
      baseSha: 'b'.repeat(40),
      codeSha,
      codeArchivePath: codeArchiveName,
      codeArchiveSha256,
      sandboxId: buildId,
      nonce,
      configSha256: sha256(configPath),
      inputManifestSha256: sha256(manifestPath),
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
  }

  const adapterPath = join(taskRoot, 'synthetic-adapter.ps1');
  writeFileSync(adapterPath, SYNTHETIC_ADAPTER);
  const runnerPath = join(taskRoot, 'run-lifecycle.ps1');
  writeFileSync(runnerPath, [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module -Name '${LIFECYCLE_MODULE}' -Force`,
    `$code = Invoke-SandboxLifecycle -Mode Build -ConfigPath '${configPath}' -OrchestrationPath '${orchestrationPath}' ` +
      `-IncomingDir '${incoming}' -OutgoingDir '${outgoing}' -AdapterPath '${adapterPath}' ` +
      `-RuntimeBundleSha256ProviderPath '${BUNDLE_PRODUCER}' ` +
      '-FinishTimeoutSec 5 -CloseGraceSec 1 -PollMilliseconds 100',
    'exit $code',
    '',
  ].join('\n'));

  return { taskRoot, buildId, buildDir, incoming, outgoing, probeId, probeDir, codeSha, codeArchiveSha256, bundleSha256, manifestPath, orchestrationPath, buildResultPath, configPath, adapterPath, runnerPath };
}

function mutateJson(path: string, mutate: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  mutate(value);
  writeJson(path, value);
}

function runHandoff(f: HandoffFixture): Promise<PsResult> {
  return runPs(HANDOFF, ['-BuildDir', f.buildDir, '-ProbeDir', f.probeDir]);
}

function runLifecycle(f: HandoffFixture): Promise<PsResult> {
  return runPs(f.runnerPath, []);
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describeWindows('T2 构建→探针交接（Complete-DshBuildHandoff）', () => {
  it('正常交接：只复制入口脚本 + bundle，原子改名 incoming，handoff 双侧哈希相等', async () => {
    const f = createFixture();
    const result = await runHandoff(f);
    expect(result.code).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.probeId).toBe(f.probeId);
    const probeIncoming = join(f.probeDir, 'incoming');
    expect(existsSync(join(probeIncoming, 'scripts', 'Invoke-DshSandboxProbe.ps1'))).toBe(true);
    expect(existsSync(join(probeIncoming, 'runtime-bundle.zip'))).toBe(true);
    expect(existsSync(join(probeIncoming, 'input-manifest.json'))).toBe(true);
    expect(readdirSync(probeIncoming).sort()).toEqual(['input-manifest.json', 'runtime-bundle.zip', 'scripts']);
    const handoff = JSON.parse(readFileSync(join(f.probeDir, 'handoff.json'), 'utf8')) as Record<string, unknown>;
    expect(handoff.sourceSha256).toBe(f.bundleSha256);
    expect(handoff.destinationSha256).toBe(f.bundleSha256);
    expect(handoff.runtimeBundleSha256).toBe(f.bundleSha256);
    const probeManifest = JSON.parse(readFileSync(join(probeIncoming, 'input-manifest.json'), 'utf8')) as { mode: string; sandboxId: string; nonce: string; files: unknown[] };
    expect(probeManifest.mode).toBe('probe');
    expect(probeManifest.sandboxId).toBe(f.probeId);
    expect(probeManifest.nonce).toBe('');
    expect(probeManifest.files).toHaveLength(2);
  }, 120_000);

  it('重复交接 ⇒ 第二次拒绝（probe 目录已非空）', async () => {
    const f = createFixture();
    const first = await runHandoff(f);
    expect(first.code).toBe(0);
    const second = await runHandoff(f);
    expect(second.code).toBe(2);
    expect(['HANDOFF_PROBE_DIR_NOT_EMPTY', 'HANDOFF_PROBE_INCOMING_NOT_EMPTY', 'HANDOFF_REPEATED']).toContain(second.json.code);
  }, 180_000);

  it('probe 目录预先非空 ⇒ 拒绝且不写 incoming', async () => {
    const f = createFixture();
    mkdirSync(f.probeDir, { recursive: true });
    writeFileSync(join(f.probeDir, 'keepme.txt'), 'occupied');
    const result = await runHandoff(f);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('HANDOFF_PROBE_DIR_NOT_EMPTY');
    expect(existsSync(join(f.probeDir, 'incoming'))).toBe(false);
  }, 120_000);

  it('build-result 缺失 / 0 tests / failed>0 / 日志哈希错 ⇒ 全部拒绝', async () => {
    const missing = createFixture();
    rmSync(missing.buildResultPath);
    const missingResult = await runHandoff(missing);
    expect(missingResult.code).toBe(2);
    expect(missingResult.json.code).toBe('HANDOFF_BUILD_RESULT_MISSING');

    const zero = createFixture();
    mutateJson(zero.buildResultPath, value => {
      const tests = value.tests as Record<string, unknown>;
      tests.total = 0;
      tests.passed = 0;
    });
    const zeroResult = await runHandoff(zero);
    expect(zeroResult.code).toBe(2);
    expect(zeroResult.json.code).toBe('HANDOFF_TESTS_EMPTY');

    const failed = createFixture();
    mutateJson(failed.buildResultPath, value => {
      const tests = value.tests as Record<string, unknown>;
      tests.failed = 1;
    });
    const failedResult = await runHandoff(failed);
    expect(failedResult.code).toBe(2);
    expect(failedResult.json.code).toBe('HANDOFF_TESTS_RED');

    const logHash = createFixture();
    mutateJson(logHash.buildResultPath, value => {
      const lint = value.lint as Record<string, unknown>;
      lint.logSha256 = '0'.repeat(64);
    });
    const logResult = await runHandoff(logHash);
    expect(logResult.code).toBe(2);
    expect(logResult.json.code).toBe('HANDOFF_LOG_HASH');
  }, 240_000);

  it('bundle 被改 / codeArchive 不一致 / 未 DESTROYED ⇒ 拒绝', async () => {
    const bundle = createFixture();
    writeFileSync(join(bundle.outgoing, 'runtime-bundle.zip'), Buffer.from('tampered-bundle'));
    const bundleResult = await runHandoff(bundle);
    expect(bundleResult.code).toBe(2);
    expect(bundleResult.json.code).toBe('HANDOFF_BUNDLE_HASH');

    const archive = createFixture();
    mutateJson(archive.buildResultPath, value => {
      value.codeArchiveSha256 = '0'.repeat(64);
    });
    const archiveResult = await runHandoff(archive);
    expect(archiveResult.code).toBe(2);
    expect(archiveResult.json.code).toBe('HANDOFF_BUILD_RESULT');

    const notDestroyed = createFixture();
    mutateJson(notDestroyed.orchestrationPath, value => {
      value.state = 'FINISHED';
    });
    const stateResult = await runHandoff(notDestroyed);
    expect(stateResult.code).toBe(2);
    expect(stateResult.json.code).toBe('HANDOFF_NOT_DESTROYED');
  }, 240_000);

  it('staging 出现其他文件 ⇒ 拒绝（只允许唯一探针入口脚本）', async () => {
    const f = createFixture();
    writeFileSync(join(f.taskRoot, 'probe', 'staging', 'start.ps1'), '# should not be staged\n');
    const result = await runHandoff(f);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('HANDOFF_STAGING_EXTRA');
  }, 120_000);
});

describeWindows('T2 构建→交接生产链（lifecycle 写值 + handoff 消费，#1446）', () => {
  it('正例：host 侧生产者写入 runtimeBundleSha256 ⇒ handoff 接受且双侧哈希一致', async () => {
    const f = createFixture({ prepare: true });
    const lifecycle = await runLifecycle(f);
    expect(lifecycle.code).toBe(0);
    const bundlePath = join(f.outgoing, 'runtime-bundle.zip');
    const orchestration = JSON.parse(readFileSync(f.orchestrationPath, 'utf8')) as Record<string, unknown>;
    expect(orchestration.state).toBe('DESTROYED');
    expect(orchestration.runtimeBundleSha256).toBe(sha256(bundlePath));
    expect(String(orchestration.runtimeBundleSha256)).toMatch(/^[0-9a-f]{64}$/);
    const result = await runHandoff(f);
    expect(result.code).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.runtimeBundleSha256).toBe(orchestration.runtimeBundleSha256);
    const handoff = JSON.parse(readFileSync(join(f.probeDir, 'handoff.json'), 'utf8')) as Record<string, unknown>;
    expect(handoff.sourceSha256).toBe(orchestration.runtimeBundleSha256);
    expect(handoff.destinationSha256).toBe(orchestration.runtimeBundleSha256);
    expect(sha256(join(f.probeDir, 'incoming', 'runtime-bundle.zip'))).toBe(orchestration.runtimeBundleSha256);
  }, 240_000);

  it('反例 A：bundle 不存在 ⇒ 字段保持 null，handoff 仍以 HANDOFF_ORCHESTRATION 拒绝', async () => {
    const f = createFixture({ prepare: true, withBundle: false });
    const lifecycle = await runLifecycle(f);
    expect(lifecycle.code).toBe(0);
    expect(existsSync(join(f.outgoing, 'runtime-bundle.zip'))).toBe(false);
    const orchestration = JSON.parse(readFileSync(f.orchestrationPath, 'utf8')) as Record<string, unknown>;
    expect(orchestration.state).toBe('DESTROYED');
    expect(orchestration.runtimeBundleSha256).toBeNull();
    const result = await runHandoff(f);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('HANDOFF_ORCHESTRATION');
    expect(existsSync(join(f.probeDir, 'incoming'))).toBe(false);
  }, 240_000);

  it('反例 B：收尾后 bundle 被替换 ⇒ handoff 以 HANDOFF_BUNDLE_HASH 拒绝', async () => {
    const f = createFixture({ prepare: true });
    const lifecycle = await runLifecycle(f);
    expect(lifecycle.code).toBe(0);
    writeFileSync(join(f.outgoing, 'runtime-bundle.zip'), Buffer.from('tampered-after-finish'));
    const result = await runHandoff(f);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('HANDOFF_BUNDLE_HASH');
    expect(existsSync(join(f.probeDir, 'incoming'))).toBe(false);
  }, 240_000);
});
