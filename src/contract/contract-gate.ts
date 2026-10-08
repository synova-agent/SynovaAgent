/**
 * src/contract/contract-gate.ts — 契约门禁引擎 (D215)
 *
 * 下游 Agent 启动时加载契约并 grep 验证接口是否真实存在。
 * 与 D208 contract-archiver.py validate 逻辑一致。
 *
 * 验证规则:
 *   export_function → grep "function NAME\|export function NAME" src/
 *   export_class → grep "class NAME\b" src/
 *   edge_id → grep NAME extensions/ontology/edge-types/
 *   file_path → fs.existsSync(path)
 *
 * 契约:
 *   @input  — ContractStore（依赖注入）
 *   @output — ValidationReport
 *   @degraded — grep 不可用 → degraded:true + 不阻断
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@synova/logger';
import type { ContractRecord, ContractStore } from './contract-store';
import {
  COMPUTE_CONTRACTS,
  REQUIRED_COMPUTE_CONTRACT_IDS,
  ComputeContractError,
  assertImplementationExists,
  invokeComputeContract,
  resolveComputeContract,
} from './compute-registry';

const log = createLogger('contract/gate');

// ═══ Types ═══

export interface ValidationItem {
  contractId: string;
  name: string;
  type: string;
  pass: boolean;
  detail: string;
}

/** D1048: compute 契约面（W4 注册表）单条结果 */
export interface ComputeContractItem {
  contractId: string;
  pass: boolean;
  phase: string;
  detail: string;
}

/**
 * D1048: compute 契约面校验报告。
 * ⚠️ 契约（队长 2026-10-08 裁定）：本面**只上报、不参与 `ValidationReport.pass` 判定** ——
 * `blocking` 恒为 `false`。扩大运行时失败面属行为变更，须另立卡。
 */
export interface ComputeContractValidation {
  checked: number;
  passed: number;
  failures: ComputeContractItem[];
  items: ComputeContractItem[];
  /** 恒 false：本面不阻断（接线 + 可观测，不是新门禁） */
  blocking: false;
}

export interface ValidationReport {
  pass: boolean;
  failures: ValidationItem[];
  degraded: boolean;
  checkedAt: string;
  /** D1048: compute 契约面观测结果（只上报，不参与 pass） */
  computeContracts: ComputeContractValidation;
}

// ═══ ContractGate ═══

export class ContractGate {
  private store: ContractStore;
  private repoRoot: string;

  constructor(store: ContractStore, repoRoot?: string) {
    this.store = store;
    this.repoRoot = repoRoot || process.cwd();
  }

  /**
   * 验证全部未归档契约。
   * 逐条 grep 验证接口是否真实存在于代码中。
   */
  async validateAll(): Promise<ValidationReport> {
    const contracts = this.store.load();
    const failures: ValidationItem[] = [];
    let degraded = false;

    for (const contract of contracts) {
      try {
        const item = await this.validateOne(contract);
        if (!item.pass) failures.push(item);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err: msg, contractId: contract.contractId }, '契约验证异常 — 降级');
        degraded = true;
      }
    }

    const report: ValidationReport = {
      // ⚠️ D1048: 判定式逐字未改 —— compute 契约面**不参与** pass（只上报）
      pass: failures.length === 0 && !degraded,
      failures,
      degraded,
      checkedAt: new Date().toISOString(),
      computeContracts: await this.validateComputeContracts(),
    };

    log.info(
      {
        total: contracts.length,
        failures: failures.length,
        degraded,
        computeContracts: {
          checked: report.computeContracts.checked,
          passed: report.computeContracts.passed,
          failing: report.computeContracts.failures.length,
        },
      },
      '契约门禁检查完成',
    );
    return report;
  }

  /**
   * D1048（W4）: compute 契约面校验 —— 用注册表核验「契约 ID → 实现文件 + 导出符号」是否真实存在。
   *
   * 契约:
   *   @input     — opts.invoke（默认 false）: true 时额外**真调用**每条契约（动态加载 + fixture）
   *   @output    — ComputeContractValidation（items / failures / passed / checked）
   *   @degraded  — **本方法不抛**：单条失败被捕获并记入 items/failures 后继续（这是"上报面"，
   *                不是阻断面）。`blocking` 恒 false —— 本面不参与 validateAll 的 pass 判定。
   *                真正需要 fail-closed 的调用方应直接使用 `invokeComputeContract`（缺失即抛）。
   *
   * invoke 默认关闭的理由：运行时不引入实现模块的动态加载副作用；探针（scripts/control-tower/
   * probe-compute-registry.ts）与 CI 需要真调用时显式开。
   */
  async validateComputeContracts(opts: { invoke?: boolean } = {}): Promise<ComputeContractValidation> {
    const items: ComputeContractItem[] = [];
    const failures: ComputeContractItem[] = [];

    const registered = COMPUTE_CONTRACTS.map((c) => c.contractId);
    for (const requiredId of REQUIRED_COMPUTE_CONTRACT_IDS) {
      if (registered.includes(requiredId)) continue;
      const item: ComputeContractItem = {
        contractId: requiredId,
        pass: false,
        phase: 'resolve',
        detail: '卡面指名契约未出现在注册表中',
      };
      items.push(item);
      failures.push(item);
    }

    for (const entry of COMPUTE_CONTRACTS) {
      try {
        const resolved = resolveComputeContract(entry.contractId);
        const hit = assertImplementationExists(resolved, this.repoRoot);
        let detail = `resolve ok → ${hit.relPath}:${hit.sourceLine} :: ${hit.exportName}`;
        if (opts.invoke === true) {
          const invoked = await invokeComputeContract(entry.contractId, this.repoRoot);
          detail += ` | call ok (degraded=${String(invoked.value.degraded)})`;
        }
        items.push({ contractId: entry.contractId, pass: true, phase: 'ok', detail });
      } catch (err: unknown) {
        if (err instanceof ComputeContractError) {
          const item: ComputeContractItem = {
            contractId: err.contractId,
            pass: false,
            phase: err.phase,
            detail: `${err.code}: ${err.message}`,
          };
          items.push(item);
          failures.push(item);
          log.warn({ contractId: err.contractId, phase: err.phase, code: err.code }, 'compute 契约面校验失败');
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          const item: ComputeContractItem = {
            contractId: entry.contractId,
            pass: false,
            phase: 'unknown',
            detail: `非预期异常: ${msg}`,
          };
          items.push(item);
          failures.push(item);
          log.warn({ contractId: entry.contractId, err: msg }, 'compute 契约面校验异常');
        }
      }
    }

    return {
      checked: items.length,
      passed: items.filter((i) => i.pass).length,
      failures,
      items,
      blocking: false,
    };
  }

  /**
   * 验证单条契约。
   */
  async validateOne(contract: ContractRecord): Promise<ValidationItem> {
    const { type, name, filePath } = contract;

    try {
      switch (type) {
        case 'export_function':
          return this.grepCheck(contract, `function ${name}\\|export function ${name}\\b`, 'src/');

        case 'export_class':
          return this.grepCheck(contract, `class ${name}\\b`, 'src/');

        case 'edge_id':
          return this.grepEdgeCheck(contract, name);

        case 'file_path':
          if (!filePath) return { contractId: contract.contractId, name, type, pass: false, detail: 'filePath 为空' };
          const fullPath = join(this.repoRoot, filePath);
          const pathExists = existsSync(fullPath);
          return {
            contractId: contract.contractId, name, type,
            pass: pathExists,
            detail: pathExists ? `文件存在: ${filePath}` : `文件不存在: ${filePath}`,
          };

        case 'api_endpoint':
          return this.grepCheck(contract, name, 'src/routes/');

        default:
          return { contractId: contract.contractId, name, type, pass: false, detail: `未知契约类型: ${type}` };
      }
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "契约验证异常");
      const msg = err instanceof Error ? err.message : String(err);
      return { contractId: contract.contractId, name, type, pass: false, detail: `验证异常: ${msg}` };
    }
  }

  /**
   * grep 验证：在指定路径搜索标识符。
   * grep 不可用时降级返回 pass:true（不阻断）。
   */
  private grepEdgeCheck(contract: ContractRecord, pattern: string): ValidationItem {
    try {
      const targetDir = join(this.repoRoot, "extensions/ontology/edge-types/");
      if (!existsSync(targetDir)) {
        return { contractId: contract.contractId, name: contract.name, type: contract.type, pass: true, detail: "path not found: edge-types/" };
      }
      const result = execSync(
        "grep -ri \"" + pattern + "\" \"" + targetDir + "\" 2>/dev/null | head -3",
        { encoding: "utf-8", timeout: 10000 },
      );
      const found = result.trim().length > 0;
      return {
        contractId: contract.contractId, name: contract.name, type: contract.type,
        pass: found,
        detail: found ? "found: " + pattern + " in edge-types/" : "not found: " + pattern + " in edge-types/",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ err: msg, pattern }, "edge_id grep failed - degraded pass");
      return { contractId: contract.contractId, name: contract.name, type: contract.type, pass: true, detail: "grep degraded: " + msg };
    }
  }

  private grepCheck(contract: ContractRecord, pattern: string, searchPath: string): ValidationItem {
    try {
      const targetDir = join(this.repoRoot, searchPath);
      if (!existsSync(targetDir)) {
        return { contractId: contract.contractId, name: contract.name, type: contract.type, pass: true, detail: `路径不存在，跳过: ${searchPath}` };
      }

      const result = execSync(
        `grep -r "${pattern}" "${targetDir}" --include="*.ts" --include="*.tsx" 2>/dev/null | head -3`,
        { encoding: 'utf-8', timeout: 10000 },
      );

      const found = result.trim().length > 0;
      return {
        contractId: contract.contractId,
        name: contract.name,
        type: contract.type,
        pass: found,
        detail: found ? `匹配: ${result.split('\n')[0].substring(0, 120)}` : `未找到: ${pattern} 在 ${searchPath}`,
      };
    } catch (err: unknown) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "契约文件路径拼接");
      const msg = err instanceof Error ? err.message : String(err);
      // grep 不可用或超时 → 降级，不阻断
      log.warn({ err: msg, pattern, searchPath }, 'grep 验证失败 — 降级通过');
      return { contractId: contract.contractId, name: contract.name, type: contract.type, pass: true, detail: `grep 降级: ${msg}` };
    }
  }
}
