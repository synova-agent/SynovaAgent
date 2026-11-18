/**
 * tests/runtime/dsh/sidecar.test.ts — Sidecar CLI 入口与默认路径单测。
 *
 * 配对对象：src/runtime/dsh/sidecar.ts
 * 覆盖：默认 DSH_HOME/instance 路径、未运行态 status/stop 的稳定错误与退出码、
 * 非法参数拒绝。真实生命周期（start/stop/日志）见 sidecar-lifecycle.test.ts。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDshHome, defaultInstanceDir } from '../../../src/runtime/dsh/sidecar';

const repoRoot = process.cwd();
const sidecarEntry = join(repoRoot, 'src', 'runtime', 'dsh', 'sidecar.ts');
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-sidecar-unit-'));
  tempRoots.push(dir);
  return dir;
}

interface CliResult {
  code: number | null;
  json: Record<string, unknown>;
}

function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise<CliResult>(resolvePromise => {
    const child = spawn(process.execPath, ['--import', 'tsx', sidecarEntry, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.on('exit', code => {
      const line = stdout.split(/\r?\n/).filter(item => item.trim().startsWith('{')).at(-1);
      let json: Record<string, unknown> = {};
      if (line !== undefined) {
        try { json = JSON.parse(line) as Record<string, unknown>; } catch { json = {}; }
      }
      resolvePromise({ code, json });
    });
  });
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describe('sidecar: 默认路径', () => {
  it('defaultDshHome/defaultInstanceDir 跟随 LOCALAPPDATA（instance 与 home 同级）', () => {
    const previous = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
    try {
      const home = defaultDshHome();
      expect(home).toBe(join('C:\\Users\\tester\\AppData\\Local', 'Synova', 'dsh-sidecar', 'home'));
      expect(defaultInstanceDir()).toBe(join('C:\\Users\\tester\\AppData\\Local', 'Synova', 'dsh-sidecar', 'instance'));
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
    }
  });
});

describe('sidecar: CLI 稳定错误', () => {
  it('未运行态 status ⇒ exit 1 + SIDECAR_NOT_RUNNING（不空成功）', async () => {
    const dshHome = makeTempRoot();
    const result = await runCli(['--action', 'status', '--dsh-home', dshHome]);
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('SIDECAR_NOT_RUNNING');
    expect(result.json.retryable).toBe(false);
  });

  it('未运行态 stop ⇒ exit 1 + SIDECAR_NOT_RUNNING', async () => {
    const dshHome = makeTempRoot();
    const result = await runCli(['--action', 'stop', '--dsh-home', dshHome]);
    expect(result.code).toBe(1);
    expect(result.json.code).toBe('SIDECAR_NOT_RUNNING');
  });

  it('未知 action / 缺参数值 ⇒ exit 1 + VALIDATION_ERROR', async () => {
    const unknown = await runCli(['--action', 'explode']);
    expect(unknown.code).toBe(1);
    expect(unknown.json.code).toBe('VALIDATION_ERROR');

    const missingValue = await runCli(['--action', 'status', '--dsh-home']);
    expect(missingValue.code).toBe(1);
    expect(missingValue.json.code).toBe('VALIDATION_ERROR');
  });
});
