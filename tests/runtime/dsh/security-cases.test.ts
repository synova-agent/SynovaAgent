/**
 * T4 验收：权限拒绝矩阵（伪造身份/路径、未授权工具、未登记 MCP、写决定）+ profile 安全姿态。
 *
 * 每条拒绝都断言**稳定 code**，不看具体文案；拒绝必须在到达领域查询/执行之前发生。
 */
import { describe, expect, it } from 'vitest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  SIDECAR_TOOLS,
  assertSidecarToolAllowed,
} from '../../../src/mcp/tool-definitions';
import {
  assertSidecarProfile,
  buildChildEnv,
  defaultProfileDir,
  loadSidecarProfile,
  resolveWorkspaceRoot,
} from '../../../src/runtime/dsh/profile';
import { DshError } from '../../../src/runtime/dsh/errors';
import { handleDomainToolCall } from '../../../src/runtime/dsh/tools';

/** 捕获同步错误并返回（避免 expect().toThrow 丢失 code）。 */
function catchError(fn: () => void): unknown {
  try {
    fn();
    return null;
  } catch (err: unknown) {
    return err;
  }
}

describe('T4 权限拒绝矩阵', () => {
  it('伪造身份参数（enterpriseId/userId/orgId/scope/evidenceId）⇒ FORGED_IDENTITY', () => {
    for (const key of ['enterpriseId', 'userId', 'orgId', 'scope', 'evidenceId']) {
      const error = catchError(() => handleDomainToolCall('synova_context_get', { problemId: 'p-1', [key]: 'forged' }));
      expect(error, `${key} 必须被拒绝`).toBeInstanceOf(DshError);
      expect((error as DshError).code).toBe('FORGED_IDENTITY');
      expect((error as DshError).retryable).toBe(false);
    }
  });

  it('伪造/逃逸路径参数（path/cwd/../）⇒ FORGED_PATH（不到达文件系统）', () => {
    for (const key of ['path', 'cwd', 'dir']) {
      const error = catchError(() => handleDomainToolCall('synova_context_get', { problemId: 'p-1', [key]: '../../etc' }));
      expect(error).toBeInstanceOf(DshError);
      expect((error as DshError).code).toBe('FORGED_PATH');
    }
    expect(catchError(() => resolveWorkspaceRoot('../relative-escape'))).toBeInstanceOf(DshError);
    expect(catchError(() => resolveWorkspaceRoot('relative/dir'))).toBeInstanceOf(DshError);
  });

  it('未授权工具（4 个写工具）⇒ -32000；写决定工具/未登记 MCP 工具 ⇒ -32601', () => {
    for (const name of ['sentinel_run', 'sentinel_run_all', 'diagnose_organization', 'ingest_document']) {
      const error = catchError(() => assertSidecarToolAllowed(name, 'read-only'));
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(-32000);
    }
    for (const name of ['decision_write', 'fact_write', 'task_execute', 'third_party_mcp__search']) {
      const error = catchError(() => assertSidecarToolAllowed(name, 'read-only'));
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(-32601);
    }
    // 唯一放行面 = 1 个合成只读工具
    expect(SIDECAR_TOOLS.map(tool => tool.name)).toEqual(['synova_context_get']);
    expect(catchError(() => assertSidecarToolAllowed('synova_context_get', 'read-only'))).toBeNull();
  });

  it('Sidecar env 不继承模型凭据/权限 env（身份由服务端注入）', () => {
    const env = buildChildEnv('/tmp/dsh-home', {
      PATH: 'C:\\Windows',
      DEEPSEEK_API_KEY: 'sk-should-not-leak',
      LLM_API_KEY: 'sk-should-not-leak',
      OPENAI_API_KEY: 'sk-should-not-leak',
      ANTHROPIC_API_KEY: 'sk-should-not-leak',
      DSH_PERMISSION_MODE: 'danger-full-access',
    });
    expect(env.DSH_HOME).toBe('/tmp/dsh-home');
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1');
    for (const key of ['DEEPSEEK_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DSH_PERMISSION_MODE']) {
      expect(env[key], `${key} 不得传给 Sidecar`).toBeUndefined();
    }
    expect(env.PATH).toBe('C:\\Windows');
  });

  it('profile 安全姿态：只读沙箱 + approval ask + 17 条禁用 + 不继承 desktop', () => {
    const profile = loadSidecarProfile(defaultProfileDir());
    expect(() => { assertSidecarProfile(profile); }).not.toThrow();
    expect(profile.patchText).not.toContain('danger-full-access');
    expect(profile.patchText).not.toContain('policy: never');
    expect(profile.bundles).not.toContain('@deepseek-ai/dsh-web');
    expect(profile.bundles).not.toContain('@deepseek-ai/dsh-headless');
    expect(profile.patchEntries.filter(entry => entry.disabled).map(entry => entry.id))
      .toEqual(expect.arrayContaining(['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'web', 'mcp-resources']));
  });

  it('未登记 MCP 一律不注册：profile 不插入任何插件，工具面固定为 1', () => {
    const profile = loadSidecarProfile(defaultProfileDir());
    const insertLines = profile.patchText.split(/\r?\n/).filter(line => line.trim().startsWith('insert:'));
    expect(insertLines).toEqual([]);
    expect(profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']);
  });
});
