/**
 * tests/runtime/dsh/sandbox-evidence.test.ts — Test-DshEvidence 的严格绑定与反例。
 *
 * 真实入口：以 PowerShell 调 `scripts/dsh-sidecar/sandbox/Test-DshEvidence.ps1`（唯一机检入口）。
 * 只解析合成 JSON/文本/哈希，不启动沙箱、不执行 outgoing 内任何内容。
 *
 * 覆盖：十项全绿 + 绑定通过；9 项、重复 id、布尔字符串、exitCode 不等、额外/缺失字段、
 * 旧 nonce、错误 codeSha、绝对/越界日志路径、空日志、空 observed、时间倒挂、
 * orchestration 非 DESTROYED、哨兵哈希不符。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';
const describeWindows = WINDOWS ? describe : describe.skip;
const REPO_ROOT = process.cwd();
const PS = process.env.SYNO_TEST_POWERSHELL ?? 'powershell';
const VALIDATOR = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox', 'Test-DshEvidence.ps1');

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-1411-evidence-'));
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

function runValidator(evidencePath: string, orchestrationPath: string): Promise<PsResult> {
  return new Promise<PsResult>(resolvePromise => {
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VALIDATOR, '-EvidencePath', evidencePath, '-OrchestrationPath', orchestrationPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, 120_000);
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

interface EvidenceFixture {
  taskRoot: string;
  probeId: string;
  runDir: string;
  incoming: string;
  outgoing: string;
  evidencePath: string;
  orchestrationPath: string;
  evidence: Record<string, unknown>;
}

function createFixture(): EvidenceFixture {
  const taskRoot = makeTempRoot();
  const probeId = randomUUID();
  const runDir = join(taskRoot, 'probe', probeId);
  const incoming = join(runDir, 'incoming');
  const outgoing = join(runDir, 'outgoing');
  const logsDir = join(outgoing, 'logs');
  mkdirSync(incoming, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  const baseSha = 'b'.repeat(40);
  const codeSha = 'a'.repeat(40);
  const nonce = 'd'.repeat(32);
  const configPath = join(runDir, 'probe.wsb');
  writeFileSync(configPath, '<Configuration><Networking>Disable</Networking></Configuration>');
  const manifestPath = join(incoming, 'input-manifest.json');
  writeJson(manifestPath, { schemaVersion: 1, issue: 1411, mode: 'probe', sandboxId: probeId, nonce, baseSha, codeSha, files: [] });
  const runtimeBundleSha256 = 'e'.repeat(64);
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  const finishedAt = new Date(Date.now() - 60_000).toISOString();
  const startedPath = join(outgoing, 'RUN_STARTED.json');
  const finishedPath = join(outgoing, 'RUN_FINISHED.json');
  const binding = {
    issue: 1411, mode: 'probe', sandboxId: probeId, nonce, startedAt,
    configSha256: sha256(configPath), inputManifestSha256: sha256(manifestPath),
  };
  writeJson(startedPath, binding);
  writeJson(finishedPath, { ...binding, finishedAt, scriptExitCode: 0, artifactManifestSha256: '0'.repeat(64) });
  const orchestrationPath = join(runDir, 'orchestration.json');
  writeJson(orchestrationPath, {
    schemaVersion: 1,
    issue: 1411,
    mode: 'probe',
    baseSha,
    codeSha,
    codeArchivePath: `synova-${codeSha}.zip`,
    codeArchiveSha256: 'c'.repeat(64),
    sandboxId: probeId,
    nonce,
    configSha256: sha256(configPath),
    inputManifestSha256: sha256(manifestPath),
    runtimeBundleSha256,
    state: 'DESTROYED',
    hostPid: 424242,
    hostProcessStartTime: startedAt,
    startedAt,
    finishedAt,
    destroyedAt: new Date(Date.now() - 30_000).toISOString(),
    scriptExitCode: 0,
    hostExitCode: 0,
    startedSentinel: { path: `probe/${probeId}/outgoing/RUN_STARTED.json`, sha256: sha256(startedPath) },
    finishedSentinel: { path: `probe/${probeId}/outgoing/RUN_FINISHED.json`, sha256: sha256(finishedPath) },
    handoff: { sourceSha256: runtimeBundleSha256, destinationSha256: runtimeBundleSha256 },
  });

  const probes: Array<Record<string, unknown>> = [];
  for (let id = 1; id <= 10; id += 1) {
    const logName = `${String(id).padStart(2, '0')}-probe.log`;
    const logPath = join(logsDir, logName);
    writeFileSync(logPath, `probe ${id} executed\n`);
    probes.push({
      id,
      name: `probe-${id}`,
      executed: true,
      ok: true,
      command: `command-${id}`,
      exitCode: 0,
      expectedExitCode: 0,
      observed: `observed-${id}`,
      logPath: `logs/${logName}`,
      logSha256: sha256(logPath),
    });
  }
  const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    issue: 1411,
    mode: 'probe',
    baseSha,
    codeSha,
    sandboxId: probeId,
    nonce,
    startedAt,
    finishedAt,
    configSha256: sha256(configPath),
    inputManifestSha256: sha256(manifestPath),
    runtimeBundleSha256,
    nodeVersion: 'v24.21.0',
    dshVersion: '0.2.2-rc.5',
    probes,
  };
  const evidencePath = join(outgoing, 'evidence.json');
  writeJson(evidencePath, evidence);
  return { taskRoot, probeId, runDir, incoming, outgoing, evidencePath, orchestrationPath, evidence };
}

function mutate(fixture: EvidenceFixture, mutateFn: (evidence: Record<string, unknown>, orchestration: Record<string, unknown>) => void): void {
  const evidence = JSON.parse(readFileSync(fixture.evidencePath, 'utf8')) as Record<string, unknown>;
  const orchestration = JSON.parse(readFileSync(fixture.orchestrationPath, 'utf8')) as Record<string, unknown>;
  mutateFn(evidence, orchestration);
  writeJson(fixture.evidencePath, evidence);
  writeJson(fixture.orchestrationPath, orchestration);
}

function probesOf(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return evidence.probes as Array<Record<string, unknown>>;
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describeWindows('T2 证据验证器（Test-DshEvidence）', () => {
  it('十项全绿且与 DESTROYED orchestration 完全绑定 ⇒ exit 0', async () => {
    const f = createFixture();
    const result = await runValidator(f.evidencePath, f.orchestrationPath);
    expect(result.code).toBe(0);
    expect(result.json.code).toBe('EVIDENCE_OK');
    expect(result.json.ok).toBe(true);
  }, 120_000);

  it('证据 dshVersion 仍指 rc.2／rc.1 ⇒ EVIDENCE_DSH_VERSION（exit 1）', async () => {
    for (const wrong of ['0.2.2-rc.2', '0.2.2-rc.1']) {
      const f = createFixture();
      mutate(f, evidence => {
        evidence.dshVersion = wrong;
      });
      const result = await runValidator(f.evidencePath, f.orchestrationPath);
      expect(result.code, wrong).toBe(1);
      expect(String(result.json.message), wrong).toContain('EVIDENCE_DSH_VERSION');
    }
  }, 120_000);

  it('9 项 / 重复 id / 布尔字符串 / exitCode 不等 ⇒ exit 1', async () => {
    const nine = createFixture();
    mutate(nine, evidence => {
      evidence.probes = probesOf(evidence).slice(0, 9);
    });
    const nineResult = await runValidator(nine.evidencePath, nine.orchestrationPath);
    expect(nineResult.code).toBe(1);
    expect(String(nineResult.json.message)).toContain('EVIDENCE_PROBE_COUNT');

    const duplicate = createFixture();
    mutate(duplicate, evidence => {
      const probes = probesOf(evidence);
      probes[9] = { ...probes[8] };
    });
    const duplicateResult = await runValidator(duplicate.evidencePath, duplicate.orchestrationPath);
    expect(duplicateResult.code).toBe(1);
    expect(String(duplicateResult.json.message)).toContain('EVIDENCE_PROBE_DUPLICATE');

    const booleanString = createFixture();
    mutate(booleanString, evidence => {
      probesOf(evidence)[0].executed = 'true';
    });
    const booleanResult = await runValidator(booleanString.evidencePath, booleanString.orchestrationPath);
    expect(booleanResult.code).toBe(1);
    expect(String(booleanResult.json.message)).toContain('EVIDENCE_PROBE_EXECUTED');

    const exitMismatch = createFixture();
    mutate(exitMismatch, evidence => {
      probesOf(evidence)[2].exitCode = 1;
    });
    const exitResult = await runValidator(exitMismatch.evidencePath, exitMismatch.orchestrationPath);
    expect(exitResult.code).toBe(1);
    expect(String(exitResult.json.message)).toContain('EVIDENCE_PROBE_EXIT');
  }, 240_000);

  it('额外字段 / 缺失字段 / 空 observed / 时间倒挂 ⇒ exit 1', async () => {
    const extra = createFixture();
    mutate(extra, evidence => {
      evidence.extraField = true;
    });
    const extraResult = await runValidator(extra.evidencePath, extra.orchestrationPath);
    expect(extraResult.code).toBe(1);
    expect(String(extraResult.json.message)).toContain('EVIDENCE_KEYS');

    const missing = createFixture();
    mutate(missing, evidence => {
      delete probesOf(evidence)[3].name;
    });
    const missingResult = await runValidator(missing.evidencePath, missing.orchestrationPath);
    expect(missingResult.code).toBe(1);
    expect(String(missingResult.json.message)).toContain('EVIDENCE_PROBE_KEYS');

    const observed = createFixture();
    mutate(observed, evidence => {
      probesOf(evidence)[4].observed = '';
    });
    const observedResult = await runValidator(observed.evidencePath, observed.orchestrationPath);
    expect(observedResult.code).toBe(1);
    expect(String(observedResult.json.message)).toContain('EVIDENCE_PROBE_OBSERVED');

    const time = createFixture();
    mutate(time, evidence => {
      evidence.finishedAt = new Date(Date.parse(String(evidence.startedAt)) - 60_000).toISOString();
    });
    const timeResult = await runValidator(time.evidencePath, time.orchestrationPath);
    expect(timeResult.code).toBe(1);
    expect(String(timeResult.json.message)).toContain('EVIDENCE_TIME');
  }, 240_000);

  it('旧 nonce / 错误 codeSha ⇒ 绑定失败（exit 1）', async () => {
    const nonce = createFixture();
    mutate(nonce, evidence => {
      evidence.nonce = 'f'.repeat(32);
    });
    const nonceResult = await runValidator(nonce.evidencePath, nonce.orchestrationPath);
    expect(nonceResult.code).toBe(1);
    expect(String(nonceResult.json.message)).toContain('EVIDENCE_BINDING');

    const codeSha = createFixture();
    mutate(codeSha, evidence => {
      evidence.codeSha = '0'.repeat(40);
    });
    const codeResult = await runValidator(codeSha.evidencePath, codeSha.orchestrationPath);
    expect(codeResult.code).toBe(1);
    expect(String(codeResult.json.message)).toContain('EVIDENCE_BINDING');
  }, 240_000);

  it('绝对日志路径 / 越界日志路径 / 空日志 ⇒ exit 1', async () => {
    const absolute = createFixture();
    mutate(absolute, evidence => {
      probesOf(evidence)[0].logPath = 'C:\\Windows\\win.ini';
    });
    const absoluteResult = await runValidator(absolute.evidencePath, absolute.orchestrationPath);
    expect(absoluteResult.code).toBe(1);
    expect(String(absoluteResult.json.message)).toContain('EVIDENCE_LOG_PATH');

    const traversal = createFixture();
    mutate(traversal, evidence => {
      probesOf(evidence)[1].logPath = '../escape.log';
    });
    const traversalResult = await runValidator(traversal.evidencePath, traversal.orchestrationPath);
    expect(traversalResult.code).toBe(1);
    expect(String(traversalResult.json.message)).toContain('EVIDENCE_LOG_PATH');

    const empty = createFixture();
    writeFileSync(join(empty.outgoing, 'logs', '03-probe.log'), '');
    const emptyResult = await runValidator(empty.evidencePath, empty.orchestrationPath);
    expect(emptyResult.code).toBe(1);
    expect(String(emptyResult.json.message)).toContain('EVIDENCE_LOG_EMPTY');
  }, 240_000);

  it('orchestration 未 DESTROYED / 哨兵哈希不符 ⇒ exit 1；文件缺失 ⇒ exit 2', async () => {
    const notDestroyed = createFixture();
    mutate(notDestroyed, (_evidence, orchestration) => {
      orchestration.state = 'FINISHED';
    });
    const stateResult = await runValidator(notDestroyed.evidencePath, notDestroyed.orchestrationPath);
    expect(stateResult.code).toBe(1);
    expect(String(stateResult.json.message)).toContain('ORCHESTRATION_STATE');

    const sentinel = createFixture();
    mutate(sentinel, (_evidence, orchestration) => {
      const record = orchestration.finishedSentinel as Record<string, unknown>;
      record.sha256 = '0'.repeat(64);
    });
    const sentinelResult = await runValidator(sentinel.evidencePath, sentinel.orchestrationPath);
    expect(sentinelResult.code).toBe(1);
    expect(String(sentinelResult.json.message)).toContain('ORCHESTRATION_SENTINEL');

    const missingFile = await runValidator(join(makeTempRoot(), 'missing-evidence.json'), join(makeTempRoot(), 'missing-orchestration.json'));
    expect(missingFile.code).toBe(2);
    expect(missingFile.json.code).toBe('EVIDENCE_INVALID');
  }, 240_000);
});
