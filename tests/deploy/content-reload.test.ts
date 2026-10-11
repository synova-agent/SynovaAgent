/**
 * tests/deploy/content-reload.test.ts — 内容面热重扫判据（卡 198 / K12-15）
 *
 * 判据源：施工项登记件 `1-10` → `npx vitest run tests/deploy/content-reload.test.ts` expectExit 0
 * 契约（铁律 47/48）：输入/输出/降级见 `src/deploy/content-reload.ts` 文件头 JSDoc。
 *
 * ## 本文件怎么保证"不是空壳"
 * - V1 真跑（默认路径）：调**真** `initContentTypes()`（穿真 loader + 真 extensions/ 内容面），断言全量 type 均 ok。
 * - V2 失败隔离 + 降级外传：注入式 reload 返回"1 成功 + 1 失败"⇒ 断言 `retained[]` 点名 + `degraded=true` + **不抛**。
 * - V3 标识持久化：状态文件真落盘（临时目录）⇒ 读回断言 `bound[]` 的 `identity` 形状与内容。
 * - V4 写失败**不抛**且降级外传：把 dataDir 指到**一个文件**之下（mkdir 必失败）⇒ 断言 `persisted=false` + `errors[]` 有记录。
 * - 负控（在 `/tmp` 工位做，见 PR 正文）：把 `retained` 判断反转 ⇒ 本文件必红（点名具体断言）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { reloadContentTypes } from '../../src/deploy/content-reload';
import type { ContentInitReport } from '../../src/deploy/content-registry';

const tmpDirs: string[] = [];

function mkTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'content-reload-test-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响判据（临时目录由 OS 回收） */
    }
  }
});

/** 构造确定性 reload 结果（注入缝） */
function fakeReport(types: { type: string; dir: string; ok: boolean; error?: string }[]): ContentInitReport {
  const results = types.map((t) => ({
    type: t.type,
    dir: t.dir,
    ok: t.ok,
    module: `../fake/${t.type}`,
    verified: t.ok ? ['fakeInit'] : [],
    warnings: [] as string[],
    ...(t.error === undefined ? {} : { error: t.error }),
  }));
  const errors = types.filter((t) => !t.ok).map((t) => `${t.type}: ${t.error ?? '未知失败'}`);
  return {
    results,
    attempted: types.length,
    loaded: types.filter((t) => t.ok).length,
    degraded: errors.length > 0,
    errors,
    warnings: [],
  };
}

describe('内容面热重扫（#198 · K12-15）', () => {
  it('V1 真跑：默认路径穿真 initContentTypes + 真 extensions 内容面 ⇒ 全部 type 装配成功且不降级', async () => {
    const dataDir = mkTmpDir();
    const r = await reloadContentTypes({ dataDir });

    // 真跑：用了默认 reload（真 initContentTypes）⇒ reloaded 非空且覆盖全量 reachable+有 loader 的项
    expect(r.reloaded.length).toBeGreaterThan(0);
    expect(r.retained).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(r.errors).toEqual([]);
    // 每项都有可读身份（type@version），version 缺失时为 unknown
    for (const item of r.reloaded) {
      expect(item.identity).toMatch(/^[a-z0-9-]+@[^@]+$/);
      expect(item.verified.length).toBeGreaterThan(0);
    }
    // 真跑必须包含已知内容项（防"空集合也算绿"）
    const types = r.reloaded.map((x) => x.type);
    expect(types).toContain('locale');
    expect(types).toContain('sentinel');
  }, 120_000);

  it('V2 失败隔离：坏内容拒绝新绑定 + 留清单 + 降级外传 + 不抛', async () => {
    const dataDir = mkTmpDir();
    const r = await reloadContentTypes({
      dataDir,
      reload: async () =>
        fakeReport([
          { type: 'locale', dir: 'locales', ok: true },
          { type: 'sentinel', dir: 'sentinels', ok: false, error: 'manifest JSON 解析失败' },
        ]),
    });

    // 好项照绑
    expect(r.reloaded.map((x) => x.type)).toEqual(['locale']);
    // 坏项进 retained 且点名原因（不是静默丢弃）
    expect(r.retained).toEqual([{ type: 'sentinel', dir: 'sentinels', error: 'manifest JSON 解析失败' }]);
    // 降级信号必须外传（铁律 31）
    expect(r.degraded).toBe(true);
    expect(r.errors).toContain('sentinel: manifest JSON 解析失败');
  });

  it('V3 标识持久化：状态文件真落盘，且只含本次真绑定项', async () => {
    const dataDir = mkTmpDir();
    const r = await reloadContentTypes({
      dataDir,
      reload: async () =>
        fakeReport([
          { type: 'locale', dir: 'locales', ok: true },
          { type: 'rule', dir: 'rules', ok: false, error: 'entryPoint 不存在' },
        ]),
    });

    expect(r.persisted).toBe(true);
    expect(r.statePath).toBe(path.join(dataDir, 'content-binding-state.json'));
    expect(fs.existsSync(r.statePath)).toBe(true);

    const state = JSON.parse(fs.readFileSync(r.statePath, 'utf-8')) as {
      schemaVersion: number;
      updatedAt: string;
      bound: { type: string; dir: string; identity: string }[];
      rejected: { type: string }[];
      degraded: boolean;
    };
    expect(state.schemaVersion).toBe(1);
    expect(Number.isNaN(Date.parse(state.updatedAt))).toBe(false);
    // 只含真绑定项（不得把失败项写成已绑定）
    expect(state.bound.map((b) => b.type)).toEqual(['locale']);
    expect(state.bound[0]?.identity).toBe('locale@1.0.0');
    // 失败项留痕在 rejected（供 ⑥ 进化侧发现"内容在坏"）
    expect(state.rejected.map((b) => b.type)).toEqual(['rule']);
    expect(state.degraded).toBe(true);
  });

  it('V4 写失败不抛：状态文件写不进去 ⇒ persisted=false + 降级外传（已成功的重扫不回滚）', async () => {
    // 把 dataDir 指到「一个文件」之下 ⇒ mkdirSync 必失败（ENOTDIR）
    const blockerFile = path.join(mkTmpDir(), 'not-a-dir');
    fs.writeFileSync(blockerFile, 'x', 'utf-8');

    const r = await reloadContentTypes({
      dataDir: path.join(blockerFile, 'sub'),
      reload: async () => fakeReport([{ type: 'locale', dir: 'locales', ok: true }]),
    });

    expect(r.persisted).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.errors.some((e) => e.includes('状态文件写入失败'))).toBe(true);
    // 失败隔离：写入失败不回滚已成功的重扫
    expect(r.reloaded.map((x) => x.type)).toEqual(['locale']);
    expect(r.retained).toEqual([]);
  });

  it('V5 落点优先级：显式 dataDir 覆盖 SYNOVA_DATA_DIR（以 statePath 观测）', async () => {
    const prev = process.env.SYNOVA_DATA_DIR;
    process.env.SYNOVA_DATA_DIR = '/tmp/env-dir-should-be-overridden';
    try {
      const explicit = '/tmp/explicit-dir-k12-198';
      const r = await reloadContentTypes({
        dataDir: explicit,
        reload: async () => fakeReport([{ type: 'locale', dir: 'locales', ok: true }]),
      });
      // 显式 dataDir 优先 ⇒ 不得落到 SYNOVA_DATA_DIR
      expect(r.statePath).toBe(path.join(explicit, 'content-binding-state.json'));
      expect(r.statePath).not.toContain('env-dir-should-be-overridden');
    } finally {
      if (prev === undefined) delete process.env.SYNOVA_DATA_DIR;
      else process.env.SYNOVA_DATA_DIR = prev;
    }
  });
});
