/**
 * tests/sentinel/probes/977-loader-registration.ts — #977（0-3 装载器）L2 原始证据探针（非 vitest 用例）
 *
 * 判据来源: issue #977 §⑥（CTO 裁定 R2 的行为判据）——
 *   V1: 启动后注册表含 4 个内置适配器（注册 id `sentinel-cash-flow` / `sentinel-cpc` /
 *       `sentinel-goal-alignment` / `sentinel-integration-health`；其**推导键**分别为
 *       `cashFlow` / `cpc` / `goalAlignment` / `integrationHealth`）
 *   V2: 启动日志 `[builtins] 哨兵自动注册完成` 行含 `scanned=4` 且 `registered=4`；
 *       4 个文件各有注册行（`已注册` 或 `文件名推导键未命中 — 已按哨兵结构兜底命中`）
 *
 * 形态: stdout = JSON 摘要（机器可判）；stderr = 真实 pino 日志原样（人工/门禁可读）。
 * 说明: 本探针零产品代码改动；`destroySentinelRegistry()` 先清空单例，保证计数语义干净。
 *
 * 运行: node_modules/.bin/tsx tests/sentinel/probes/977-loader-registration.ts > out.json 2> err.log
 */
import { readdirSync } from 'fs';
import { getSentinelRegistry, destroySentinelRegistry } from '../../../src/sentinel/registry';
import { registerBuiltinSentinels } from '../../../src/sentinel/builtins';

/** 与 §⑥ V1 逐字对齐的期望表：文件名 → 推导键（builtins.ts:filenameToExportKey 同口径，探针内复算） */
const EXPECTED: Array<{ file: string; derivedKey: string; id: string }> = [
  { file: 'cash-flow-sentinel.ts', derivedKey: 'cashFlow', id: 'sentinel-cash-flow' },
  { file: 'cpc-sentinel.ts', derivedKey: 'cpc', id: 'sentinel-cpc' },
  { file: 'goal-alignment-sentinel.ts', derivedKey: 'goalAlignment', id: 'sentinel-goal-alignment' },
  { file: 'integration-health-sentinel.ts', derivedKey: 'integrationHealth', id: 'sentinel-integration-health' },
];

/** 与 builtins.ts 的扫描 filter 逐字一致（同一目录、同一后缀） */
function adapterFileCount(): number {
  const dir = new URL('../../../src/sentinel/adapters/', import.meta.url);
  return readdirSync(dir).filter(f => f.endsWith('-sentinel.ts') || f.endsWith('-sentinel.js')).length;
}

/** builtins.ts:filenameToExportKey 的同口径复算（探针只读，不改产品代码） */
function deriveKey(filename: string): string {
  const base = filename.replace(/-sentinel\.ts$/, '').replace(/\.ts$/, '');
  return base.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

async function main(): Promise<void> {
  destroySentinelRegistry();
  const scanned = adapterFileCount();

  await registerBuiltinSentinels();

  const list = getSentinelRegistry().list().map(s => ({
    id: s.config.id, category: s.config.category, mode: s.config.mode,
  }));
  const ids = list.map(x => x.id);

  const perAdapter = EXPECTED.map(e => ({
    file: e.file,
    derivedKey: e.derivedKey,
    derivedKeyMatchesProbe: deriveKey(e.file) === e.derivedKey,
    registeredId: e.id,
    presentInRegistry: ids.includes(e.id),
  }));

  console.log(JSON.stringify({
    probe: '#977',
    scannedAdapterFiles: scanned,
    registryCount: getSentinelRegistry().count(),
    registryIds: ids,
    perAdapter,
    allFourPresent: perAdapter.every(a => a.presentInRegistry),
  }, null, 2));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ probeError: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
