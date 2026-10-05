/**
 * tests/sentinel/d752-type-net-gate.integration.test.ts — D752 哨兵类型网硬门禁（CI 接线）
 *
 * 派单 §二: types.ts 静态 import type 是软约束（8/45 未登记无人发现）→ 改硬门禁。
 * 本测试在 CI 的 vitest 全量步骤中执行真实门禁脚本（child_process，真实文件系统）——
 * .github/workflows/ci.yml 属红区不可改，故 CI 侧拦截经本测试实现（铁律 12: 真实路由）。
 *
 * 覆盖（铁律 48: 正常/红/豁免边界/降级）:
 *   1. 正常 — 真实仓库（补登记后）门禁 exit 0
 *   2. 红 — 沙箱缺登记 → exit 1 + 点名（反向验证的自动化形态）
 *   3. 豁免 — _ 前缀归档（_extinct 等）+ shared 不要求登记（与 sentinel-loader 同口径）
 *   4. 降级 — 哨兵目录缺失 → exit 2 fail-closed
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(REPO_ROOT, 'scripts', 'check-architecture.sh'); // D962-B2: 判定合并入 check-architecture.sh §5（SYNO_TYPE_NET_ROOT 注入缝保留）

/** 运行门禁（继承环境 + 可选沙箱根），返回 { code, stdout, stderr } */
function runGate(root?: string): { code: number; out: string } {
  // 剥 GIT_* env（pre-commit/ct-test-gate 上下文导出 GIT_DIR 会污染脚本内
  // git rev-parse --show-toplevel 解析——D521/M13 同族坑，CI 与本地行为一致）
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') && k !== 'GIT_EXEC_PATH') continue;
    env[k] = v as string | undefined;
  }
  if (root) env.SYNO_TYPE_NET_ROOT = root;
  else delete env.SYNO_TYPE_NET_ROOT;
  try {
    const out = execFileSync('bash', [GATE], { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** 构造沙箱仓库根: types.ts 内容 + 哨兵目录列表（每个建 manifest.json 占位） */
function mkSandbox(typesTs: string, sentinelDirs: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'd752-gate-'));
  mkdirSync(join(root, 'src', 'sentinel'), { recursive: true });
  writeFileSync(join(root, 'src', 'sentinel', 'types.ts'), typesTs);
  for (const d of sentinelDirs) {
    mkdirSync(join(root, 'extensions', 'sentinels', d), { recursive: true });
    writeFileSync(join(root, 'extensions', 'sentinels', d, 'manifest.json'), '{}');
  }
  return root;
}

describe('D752 哨兵类型网硬门禁（check-sentinel-type-net.sh）', () => {
  it('正常路径: 真实仓库 45 个活跃哨兵全部登记 → exit 0', () => {
    const { code, out } = runGate();
    expect(code).toBe(0);
    expect(out).toContain('45 个活跃哨兵全部已登记');
  });

  it('红分支: 沙箱缺登记 → exit 1 + 点名缺失哨兵（自动化反向验证）', () => {
    const root = mkSandbox(
      'import type { alphaSentinel as _a } from "../../extensions/sentinels/alpha-ok/aggregate";\n',
      ['alpha-ok', 'beta-missing'],
    );
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(1);
      expect(out).toContain('beta-missing');
      expect(out).not.toContain('alpha-ok');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('豁免边界: _ 前缀归档目录（_extinct 等）与 shared 不要求登记（loader 同口径）', () => {
    const root = mkSandbox(
      'import type { alphaSentinel as _a } from "../../extensions/sentinels/alpha-ok/aggregate";\n',
      ['alpha-ok', '_extinct-gone', 'shared'],
    );
    // 非目录条目（顶层 manifest.json 文件）也不参与
    writeFileSync(join(root, 'extensions', 'sentinels', 'manifest.json'), '{}');
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(0);
      expect(out).not.toContain('_extinct-gone');
      expect(out).not.toContain('shared');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('降级路径: 哨兵目录缺失 → exit 2 fail-closed（不静默当绿）', () => {
    const root = mkdtempSync(join(tmpdir(), 'd752-gate-empty-'));
    mkdirSync(join(root, 'src', 'sentinel'), { recursive: true });
    writeFileSync(join(root, 'src', 'sentinel', 'types.ts'), 'export {};\n');
    try {
      const { code, out } = runGate(root);
      expect(code).toBe(2);
      expect(out).toContain('degraded');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
