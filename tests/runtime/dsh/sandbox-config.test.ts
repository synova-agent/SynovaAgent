/**
 * tests/runtime/dsh/sandbox-config.test.ts — New-DshSandboxConfig / Start-DshSandbox 静态反例。
 *
 * 真实入口：直接以 PowerShell 调 `scripts/dsh-sidecar/sandbox/New-DshSandboxConfig.ps1` 与
 * `Start-DshSandbox.ps1`（与 T2/T3 宿主调用同一脚本），只生成/校验配置，不启动 Windows Sandbox。
 *
 * 覆盖：两条映射的 .wsb 姿态、input-manifest 非空与逐文件哈希、模式白名单、reparse point、
 * 硬链接拒绝路径、入口哈希/缺失、空文件集、Start 对第三映射与 Networking 的拒绝，以及
 * Start 的静态接线（只调 SandboxLifecycle + Real adapter，不直接调用 npm/node/探针/备份）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WINDOWS = process.platform === 'win32';
const describeWindows = WINDOWS ? describe : describe.skip;
const REPO_ROOT = process.cwd();
const PS = process.env.SYNO_TEST_POWERSHELL ?? 'powershell';
const NEW_CONFIG = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox', 'New-DshSandboxConfig.ps1');
const START_SANDBOX = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox', 'Start-DshSandbox.ps1');

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-1411-config-'));
  tempRoots.push(dir);
  return dir;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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

interface BuildFixture {
  taskRoot: string;
  buildId: string;
  buildDir: string;
  incoming: string;
  outgoing: string;
  codeSha: string;
  manifestPath: string;
  manifest: Record<string, unknown>;
}

function writeBuildFixture(options: { entry?: boolean } = {}): BuildFixture {
  const taskRoot = makeTempRoot();
  const buildId = randomUUID();
  const buildDir = join(taskRoot, 'build', buildId);
  const incoming = join(buildDir, 'incoming');
  const outgoing = join(buildDir, 'outgoing');
  mkdirSync(join(incoming, 'scripts'), { recursive: true });
  mkdirSync(outgoing, { recursive: true });
  const codeSha = 'a'.repeat(40);
  const entrySource = join(REPO_ROOT, 'scripts', 'dsh-sidecar', 'sandbox', 'Invoke-DshSandboxBuild.ps1');
  const entryTarget = join(incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1');
  if (options.entry !== false) cpSync(entrySource, entryTarget);
  writeFileSync(join(incoming, `synova-${codeSha}.zip`), 'code-archive');
  writeFileSync(join(incoming, 'dsh-0.2.2-rc.2.tgz'), 'rc2-tarball');
  writeFileSync(join(incoming, 'dsh-0.2.2-rc.1.tgz'), 'rc1-tarball');
  writeFileSync(join(incoming, 'node-v24.21.0-win-x64.zip'), 'node-zip');
  const entryPath = 'scripts/Invoke-DshSandboxBuild.ps1';
  const relativeFiles = options.entry === false
    ? [`synova-${codeSha}.zip`, 'dsh-0.2.2-rc.2.tgz', 'dsh-0.2.2-rc.1.tgz', 'node-v24.21.0-win-x64.zip']
    : [entryPath, `synova-${codeSha}.zip`, 'dsh-0.2.2-rc.2.tgz', 'dsh-0.2.2-rc.1.tgz', 'node-v24.21.0-win-x64.zip'];
  const files = relativeFiles.map(relative => {
    const path = join(incoming, relative.replaceAll('/', '\\'));
    return { path: relative, bytes: readFileSync(path).length, sha256: sha256(path) };
  });
  const manifest = {
    schemaVersion: 1,
    issue: 1411,
    mode: 'build',
    sandboxId: buildId,
    nonce: '',
    baseSha: 'b'.repeat(40),
    codeSha,
    codeArchivePath: `synova-${codeSha}.zip`,
    codeArchiveSha256: sha256(join(incoming, `synova-${codeSha}.zip`)),
    dshIntegrity: {
      '0.2.2-rc.2': 'sha512-J727r2C471x2cYXGjqZ0D9T1zYaYQDFH/Ynx8iq+85oslM4nky5YTBnbAuTtxMhW7nhY8wuAEfjjFCQ+K6Swgw==',
      '0.2.2-rc.1': 'sha512-ijR9UEVYkG15Q/Q79JzvzLBzQOQfc63VLr9n6flpwHPhr5IKn2UxthnSoto/P9l7qGd7pPvI1Ra6TW7LH3oKpg==',
    },
    createdAt: new Date().toISOString(),
    entryScript: { path: entryPath, sha256: options.entry === false ? '0'.repeat(64) : sha256(entryTarget) },
    entryScripts: {
      build: { path: entryPath, sha256: options.entry === false ? '0'.repeat(64) : sha256(entryTarget) },
      probe: { path: 'scripts/Invoke-DshSandboxProbe.ps1', sha256: 'c'.repeat(64) },
    },
    files,
  };
  const manifestPath = join(incoming, 'input-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { taskRoot, buildId, buildDir, incoming, outgoing, codeSha, manifestPath, manifest };
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describeWindows('T2 沙箱配置生成（New-DshSandboxConfig）', () => {
  it('正常路径：两条映射、安全开关、manifest 回写 nonce/config、orchestration PREPARED', async () => {
    const f = writeBuildFixture();
    const result = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(result.code).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.sandboxId).toBe(f.buildId);
    const wsbPath = join(f.buildDir, 'build.wsb');
    expect(existsSync(wsbPath)).toBe(true);
    const wsb = readFileSync(wsbPath, 'utf8');
    expect((wsb.match(/<MappedFolder>/g) ?? []).length).toBe(2);
    expect(wsb).toContain('<Networking>Enable</Networking>');
    expect(wsb).toContain('<ProtectedClient>Enable</ProtectedClient>');
    for (const flag of ['ClipboardRedirection', 'AudioInput', 'VideoInput', 'PrinterRedirection', 'vGPU']) {
      expect(wsb).toContain(`<${flag}>Disable</${flag}>`);
    }
    expect(existsSync(join(f.incoming, 'config', 'build.wsb'))).toBe(true);
    const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8')) as { nonce: string; files: Array<{ path: string }> };
    expect(manifest.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(manifest.files.some(entry => entry.path === 'config/build.wsb')).toBe(true);
    const orchestration = JSON.parse(readFileSync(join(f.buildDir, 'orchestration.json'), 'utf8')) as Record<string, unknown>;
    expect(orchestration.state).toBe('PREPARED');
    expect(orchestration.nonce).toBe(manifest.nonce);
    expect(orchestration.configSha256).toBe(sha256(wsbPath));
    expect(orchestration.inputManifestSha256).toBe(sha256(f.manifestPath));
    expect(orchestration.runtimeBundleSha256).toBeNull();
    expect(existsSync(join(f.taskRoot, 'probe', 'incoming'))).toBe(false);
  }, 120_000);

  it('incoming 出现未登记文件 ⇒ EXTRA_FILE_PRESENT（退出 2）', async () => {
    const f = writeBuildFixture();
    writeFileSync(join(f.incoming, 'notes.txt'), 'hello');
    const result = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('EXTRA_FILE_PRESENT');
    expect(existsSync(join(f.buildDir, 'build.wsb'))).toBe(false);
  }, 120_000);

  it('清单文件哈希被改 ⇒ MANIFEST_FILE_HASH_MISMATCH', async () => {
    const f = writeBuildFixture();
    writeFileSync(join(f.incoming, 'dsh-0.2.2-rc.2.tgz'), 'tampered');
    const result = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('MANIFEST_FILE_HASH_MISMATCH');
  }, 120_000);

  it('清单列入 token 文件 ⇒ FORBIDDEN_FILE', async () => {
    const f = writeBuildFixture();
    const tokenPath = join(f.incoming, 'token.txt');
    writeFileSync(tokenPath, 'not-a-real-token');
    const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8')) as { files: Array<Record<string, unknown>> };
    manifest.files.push({ path: 'token.txt', bytes: readFileSync(tokenPath).length, sha256: sha256(tokenPath) });
    writeFileSync(f.manifestPath, JSON.stringify(manifest, null, 2));
    const result = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('FORBIDDEN_FILE');
  }, 120_000);

  it('build 模式列入 runtime-bundle.zip（跨模式）⇒ FILE_NOT_ALLOWED', async () => {
    const f = writeBuildFixture();
    const bundlePath = join(f.incoming, 'runtime-bundle.zip');
    writeFileSync(bundlePath, 'bundle');
    const manifest = JSON.parse(readFileSync(f.manifestPath, 'utf8')) as { files: Array<Record<string, unknown>> };
    manifest.files.push({ path: 'runtime-bundle.zip', bytes: 6, sha256: sha256(bundlePath) });
    writeFileSync(f.manifestPath, JSON.stringify(manifest, null, 2));
    const result = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('FILE_NOT_ALLOWED');
  }, 120_000);

  it('incoming 出现 junction/reparse point ⇒ REPARSE_POINT 且不生成配置', async () => {
    const f = writeBuildFixture();
    const outside = join(f.taskRoot, 'outside-target');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'escape.txt'), 'escape');
    symlinkSync(outside, join(f.incoming, 'escape-link'), 'junction');
    const result = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('REPARSE_POINT');
    expect(existsSync(join(f.buildDir, 'build.wsb'))).toBe(false);
  }, 120_000);

  it('入口脚本缺失 ⇒ MANIFEST_FILE_MISSING；空文件集 ⇒ EMPTY_FILE_SET', async () => {
    const missing = writeBuildFixture();
    rmSync(join(missing.incoming, 'scripts', 'Invoke-DshSandboxBuild.ps1'));
    const missingResult = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', missing.taskRoot]);
    expect(missingResult.code).toBe(2);
    expect(missingResult.json.code).toBe('MANIFEST_FILE_MISSING');

    const empty = writeBuildFixture();
    const manifest = JSON.parse(readFileSync(empty.manifestPath, 'utf8')) as { files: unknown[] };
    manifest.files = [];
    writeFileSync(empty.manifestPath, JSON.stringify(manifest, null, 2));
    const emptyResult = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', empty.taskRoot]);
    expect(emptyResult.code).toBe(2);
    expect(emptyResult.json.code).toBe('EMPTY_FILE_SET');
  }, 180_000);
});

describeWindows('T2 沙箱启动门的静态拒绝（Start-DshSandbox）', () => {
  it('配置被加第三映射 ⇒ CONFIG_MAPPING_COUNT（未启动任何沙箱）', async () => {
    const f = writeBuildFixture();
    const created = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(created.code).toBe(0);
    const wsbPath = join(f.buildDir, 'build.wsb');
    const third = '  <MappedFolder>\n    <HostFolder>C:\\Users\\someone</HostFolder>\n    <SandboxFolder>C:\\evil</SandboxFolder>\n    <ReadOnly>true</ReadOnly>\n  </MappedFolder>\n';
    const tampered = readFileSync(wsbPath, 'utf8').replace('</MappedFolders>', `${third}</MappedFolders>`);
    writeFileSync(wsbPath, tampered);
    const orchestrationPath = join(f.buildDir, 'orchestration.json');
    const orchestration = JSON.parse(readFileSync(orchestrationPath, 'utf8')) as Record<string, unknown>;
    orchestration.configSha256 = sha256(wsbPath);
    writeFileSync(orchestrationPath, JSON.stringify(orchestration, null, 2));
    const result = await runPs(START_SANDBOX, ['-Mode', 'Build', '-ConfigPath', wsbPath]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('CONFIG_MAPPING_COUNT');
  }, 120_000);

  it('build 配置把 Networking 关掉 ⇒ CONFIG_NETWORKING', async () => {
    const f = writeBuildFixture();
    const created = await runPs(NEW_CONFIG, ['-Mode', 'Build', '-TaskRoot', f.taskRoot]);
    expect(created.code).toBe(0);
    const wsbPath = join(f.buildDir, 'build.wsb');
    writeFileSync(wsbPath, readFileSync(wsbPath, 'utf8').replace('<Networking>Enable</Networking>', '<Networking>Disable</Networking>'));
    const orchestrationPath = join(f.buildDir, 'orchestration.json');
    const orchestration = JSON.parse(readFileSync(orchestrationPath, 'utf8')) as Record<string, unknown>;
    orchestration.configSha256 = sha256(wsbPath);
    writeFileSync(orchestrationPath, JSON.stringify(orchestration, null, 2));
    const result = await runPs(START_SANDBOX, ['-Mode', 'Build', '-ConfigPath', wsbPath]);
    expect(result.code).toBe(2);
    expect(result.json.code).toBe('CONFIG_NETWORKING');
  }, 120_000);

  it('Start 静态接线：只调 SandboxLifecycle + Real adapter，不直接调用 node/npm/探针/备份', () => {
    const text = readFileSync(START_SANDBOX, 'utf8');
    expect(text).toContain('Invoke-SandboxLifecycle');
    expect(text).toContain('RealSandboxProcessAdapter.ps1');
    expect(text).not.toMatch(/npm\b|node\.exe|probe-dsh-runtime|install-dsh-runtime|backup\.ps1|restore\.ps1/);
  });
});
