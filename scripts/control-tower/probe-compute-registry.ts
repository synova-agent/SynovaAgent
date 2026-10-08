#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-compute-registry.ts — W4 compute 契约注册表 判据探针（#1048 / 施工单 2-6）
 *
 * 用途: 让「契约 ID → 实现文件」这条解析链**可被独立跑红**。三段全部断言，任一失败 exit 1。
 *
 * 判据来源与强形态修正:
 *   登记件 `docs/synova/coordination/施工项登记.ts:1697`
 *     { run: 'npx tsx scripts/control-tower/probe-compute-registry.ts', expectStdoutContains: 'COMPUTE-HHI-v1' }
 *   同文件 `:1071` 自陈该判据原为**弱形态**（"只验 stdout 子串，可被无关输出满足"）
 *   ⇒ 本探针给**强形态**：① 注册表存在性断言 ② RESOLVE 段断言（文件 + 导出符号 + 契约ID 注释行）
 *     ③ CALL 段断言（真调用 + 返回值字段 + degraded 类型）。只打印 ID 不足以通过。
 *
 * 契约:
 *   @input    — 无入参。仓库根 = `SYNOVA_REPO_ROOT` 或 cwd（须含 `src/contract/compute-registry.ts`；
 *               否则自 cwd 逐级上溯定位）
 *   @output   — stdout 三段报告（PRESENCE / RESOLVE / CALL）+ 末行 SUMMARY
 *   @degraded — **无降级分支**：任一段失败 ⇒ `[FAIL]` 明细 + exit 1（fail-closed，禁静默放行）；
 *               探针自身异常（定位不到仓库根 / 依赖缺失）⇒ exit 2
 * 退出码: 0 = 三段全绿；1 = 断言失败；2 = 探针自身异常
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import {
  COMPUTE_CONTRACTS,
  REQUIRED_COMPUTE_CONTRACT_IDS,
  ComputeContractError,
  assertImplementationExists,
  invokeComputeContract,
  resolveComputeContract,
} from '../../src/contract/compute-registry';

/** 探针运行上下文（供后续被 import 复用） */
export interface ComputeRegistryProbeContext {
  repoRoot: string;
  registeredIds: string[];
}

function locateRepoRoot(): string {
  const candidates: string[] = [];
  if (process.env.SYNOVA_REPO_ROOT) candidates.push(process.env.SYNOVA_REPO_ROOT);
  let cur = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'src', 'contract', 'compute-registry.ts'))) return c;
  }
  throw new Error(
    `无法定位仓库根（已试 ${candidates.length} 个候选：${candidates.join(' | ')}）；` +
      '请设 SYNOVA_REPO_ROOT 或在仓库内运行',
  );
}

async function main(): Promise<number> {
  let repoRoot: string;
  try {
    repoRoot = locateRepoRoot();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] probe-bootstrap: ${msg}`);
    return 2;
  }

  const registeredIds = COMPUTE_CONTRACTS.map((c) => c.contractId);
  console.log(`PROBE_REPO_ROOT: ${repoRoot}`);
  console.log(`PROBE_REGISTERED_CONTRACTS: ${registeredIds.length} (${registeredIds.join(', ')})`);

  // ═══ 段 1/3: 注册表存在性（卡面指名契约必须已注册） ═══
  console.log('');
  console.log('[SECTION 1/3] 注册表存在性');
  const missing = REQUIRED_COMPUTE_CONTRACT_IDS.filter((id) => !registeredIds.includes(id));
  for (const id of REQUIRED_COMPUTE_CONTRACT_IDS) {
    if (missing.includes(id)) continue;
    console.log(`PRESENCE_OK ${id}`);
  }
  if (missing.length > 0) {
    for (const id of missing) console.log(`[FAIL] phase=resolve contractId=${id} — 必需契约未注册`);
    console.log(`SUMMARY: FAIL (presence) — 缺 ${missing.length}/${REQUIRED_COMPUTE_CONTRACT_IDS.length}`);
    return 1;
  }

  // ═══ 段 2/3: RESOLVE（ID → 实现文件 + 导出符号） ═══
  console.log('');
  console.log('[SECTION 2/3] RESOLVE');
  for (const entry of COMPUTE_CONTRACTS) {
    try {
      const resolved = resolveComputeContract(entry.contractId);
      const hit = assertImplementationExists(resolved, repoRoot);
      console.log(
        `RESOLVE_OK ${entry.contractId} → ${hit.relPath}:${hit.sourceLine} :: ${hit.exportName}` +
          ` (契约ID 注释行 ${hit.declaredAtLine > 0 ? hit.declaredAtLine : '缺失'})`,
      );
    } catch (err: unknown) {
      if (err instanceof ComputeContractError) {
        console.log(`[FAIL] phase=${err.phase} code=${err.code} contractId=${err.contractId} — ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[FAIL] phase=resolve contractId=${entry.contractId} — 非预期异常: ${msg}`);
      }
      console.log('SUMMARY: FAIL (resolve)');
      return 1;
    }
  }

  // ═══ 段 3/3: CALL（真调用 + 返回值断言） ═══
  console.log('');
  console.log('[SECTION 3/3] CALL');
  for (const entry of COMPUTE_CONTRACTS) {
    try {
      const res = await invokeComputeContract(entry.contractId, repoRoot);
      const digest = Object.entries(res.value)
        .slice(0, 6)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v)}`)
        .join(' ');
      console.log(`CALL_OK ${entry.contractId} fixture=${JSON.stringify(entry.fixture)} → ${digest}`);
      console.log(`  CALL_RESULT_JSON ${JSON.stringify(res.value)}`);
    } catch (err: unknown) {
      if (err instanceof ComputeContractError) {
        console.log(`[FAIL] phase=${err.phase} code=${err.code} contractId=${err.contractId} — ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[FAIL] phase=invoke contractId=${entry.contractId} — 非预期异常: ${msg}`);
      }
      console.log('SUMMARY: FAIL (call)');
      return 1;
    }
  }

  console.log('');
  console.log(
    `SUMMARY: PASS — presence ${REQUIRED_COMPUTE_CONTRACT_IDS.length}/${REQUIRED_COMPUTE_CONTRACT_IDS.length}` +
      ` | resolve ${COMPUTE_CONTRACTS.length}/${COMPUTE_CONTRACTS.length}` +
      ` | call ${COMPUTE_CONTRACTS.length}/${COMPUTE_CONTRACTS.length}`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    console.error(`[FAIL] probe-internal: ${msg}`);
    process.exit(2);
  });
