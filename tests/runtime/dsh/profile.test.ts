/**
 * tests/runtime/dsh/profile.test.ts — synova-sidecar profile 装载/断言/安装契约单测。
 *
 * 配对对象：src/runtime/dsh/profile.ts
 * 覆盖：四件装载、安全姿态断言（含改坏检出）、安装复制、workspaceRoot 归一化、
 * 子进程 env 剥离、固定版本启动命令构造。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SIDECAR_PROFILE_NAME,
  assertSidecarProfile,
  buildChildEnv,
  buildDshInvocation,
  defaultProfileDir,
  installSidecarProfile,
  loadSidecarProfile,
  resolveWorkspaceRoot,
} from '../../../src/runtime/dsh/profile';

const tempRoots: string[] = [];
function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'synova-profile-unit-'));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响断言 */ }
  }
});

describe('profile: 装载与安全断言', () => {
  it('仓库 profile 四件齐全、bundles 恰为 base+acp-app、断言通过', () => {
    const profile = loadSidecarProfile(defaultProfileDir());
    expect(profile.name).toBe(SIDECAR_PROFILE_NAME);
    expect(profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']);
    expect(profile.patchEntries.find(entry => entry.id === 'sandbox-policy')?.config.mode).toBe('read-only');
    expect(profile.patchEntries.find(entry => entry.id === 'approval')?.config.policy).toBe('ask');
    expect(profile.patchEntries.filter(entry => entry.disabled)).toHaveLength(17);
    expect(() => { assertSidecarProfile(profile); }).not.toThrow();
  });

  it('改坏检出：danger-full-access / 删 disable / approval never 各自命中稳定断言码', () => {
    const cases = [
      { name: 'danger-full-access', mutate: (text: string) => text.replace('mode: read-only', 'mode: danger-full-access'), code: /FORBIDDEN_TOKEN_PRESENT/ },
      { name: 'remove-disable', mutate: (text: string) => text.replace('- id: tool-pwsh\n  disabled: true\n', ''), code: /REQUIRED_DISABLE_MISSING/ },
      { name: 'approval-never', mutate: (text: string) => text.replace('policy: ask', 'policy: never'), code: /APPROVAL_POLICY_NOT_ASK/ },
    ];
    for (const testCase of cases) {
      const copy = join(makeTempRoot(), 'profile');
      mkdirSync(copy, { recursive: true });
      for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
        writeFileSync(join(copy, file), readFileSync(join(defaultProfileDir(), file)));
      }
      const patchPath = join(copy, 'cordis.patch.yml');
      const original = readFileSync(patchPath, 'utf8');
      const mutated = testCase.mutate(original);
      expect(mutated, `${testCase.name} 未命中替换`).not.toBe(original);
      writeFileSync(patchPath, mutated, 'utf8');
      expect(() => { assertSidecarProfile(loadSidecarProfile(copy)); }, testCase.name).toThrow(testCase.code);
    }
  });

  it('installSidecarProfile：四件复制到 <dshHome>/profiles/synova-sidecar 且字节一致', () => {
    const dshHome = makeTempRoot();
    const target = installSidecarProfile({ profileDir: defaultProfileDir(), dshHome });
    expect(target).toBe(join(dshHome, 'profiles', SIDECAR_PROFILE_NAME));
    for (const file of ['package.json', 'cordis.yml', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
      expect(existsSync(join(target, file)), `缺 ${file}`).toBe(true);
      expect(readFileSync(join(target, file), 'utf8')).toBe(readFileSync(join(defaultProfileDir(), file), 'utf8'));
    }
  });
});

describe('profile: 路径与启动环境契约', () => {
  it('resolveWorkspaceRoot：绝对路径归一化；相对/不存在一律 typed error', () => {
    const instance = makeTempRoot();
    expect(resolveWorkspaceRoot(instance)).toBe(instance);
    expect(resolveWorkspaceRoot(instance)).toContain('synova-profile-unit-');
    expect(() => resolveWorkspaceRoot('relative/instance')).toThrow(/绝对路径/);
    expect(() => resolveWorkspaceRoot(join(instance, 'missing'))).toThrow(/不存在/);
  });

  it('buildChildEnv：剥离模型凭据/权限 env，只注入 DSH_HOME 与 ELECTRON_RUN_AS_NODE', () => {
    const env = buildChildEnv('/tmp/dsh-home', {
      PATH: 'C:\\Windows',
      DEEPSEEK_API_KEY: 'sk-leak',
      LLM_API_KEY: 'sk-leak',
      OPENAI_API_KEY: 'sk-leak',
      ANTHROPIC_API_KEY: 'sk-leak',
      DSH_PERMISSION_MODE: 'danger-full-access',
    });
    expect(env.DSH_HOME).toBe('/tmp/dsh-home');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(env.PATH).toBe('C:\\Windows');
    for (const key of ['DEEPSEEK_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_PERMISSION_MODE']) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('buildDshInvocation：固定安装目录缺 exe/asar ⇒ SIDECAR_SPAWN_FAILED；齐全 ⇒ profile 参数正确', () => {
    const empty = makeTempRoot();
    let missing: unknown = null;
    try { buildDshInvocation({ installDir: empty, dshHome: empty }); } catch (err: unknown) { missing = err; }
    expect(missing).toMatchObject({ code: 'SIDECAR_SPAWN_FAILED', retryable: false });

    const install = makeTempRoot();
    writeFileSync(join(install, 'DeepSeek Harness.exe'), 'stub');
    mkdirSync(join(install, 'resources'), { recursive: true });
    writeFileSync(join(install, 'resources', 'app.asar'), 'stub');
    const invocation = buildDshInvocation({ installDir: install, dshHome: '/tmp/home' });
    expect(invocation.command).toBe(join(install, 'DeepSeek Harness.exe'));
    expect(invocation.args).toContain('--profile');
    expect(invocation.args[invocation.args.indexOf('--profile') + 1]).toBe(SIDECAR_PROFILE_NAME);
    expect(invocation.args[0]).toBe('--expose-internals');
    expect(invocation.env.DSH_HOME).toBe('/tmp/home');
  });
});
