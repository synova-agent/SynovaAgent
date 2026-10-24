/**
 * tests/contract/conformance/fixtures/broken-backend.ts — 故意违约的假 backend（判别力夹具）
 *
 * 设计哲学：**套件必须能被"坏实现"弄红** —— 一个恒绿的测试套件等于没有套件；
 * 本夹具只在 meta.test.ts 里跑，用来证明契约断言有判别力（E3），从不进主测试、也不登记进 CONFORMANCE_REGISTRY。
 *
 * 故意违约（与规格 §1 件 5 一致）：
 *   1) `delete` 恒 false（存在键也删不掉 ⇒ `delete` 用例必红）
 *   2) 无 namespace 隔离（同一个键跨 namespace 互相覆盖 ⇒ `namespace` 用例必红）
 *
 * 契约真源：`.handbook/派单件/2026-10-24-规格-913-PR1-契约套件.md` §1 件 5（裁 331 · E3）
 *
 * Source map：
 *   BrokenStorageBackend          → 假实现（内存 Map，按 key 存储；忽略 namespace）
 *   createBrokenBackendFixture()  → BackendFactory（meta 直接喂给 runBackendContract）
 *   BROKEN_BACKEND_EXPECTED_VIOLATIONS → 期望被弄红的契约用例 id（meta 断言"至少 1 条"并点名）
 *
 * @input  无（无构造参数；每个用例由 factory 新建实例）
 * @output BrokenStorageBackend / BackendFactory / 期望违约 id 清单
 * @degraded 无（纯内存；不读文件、不连库）
 * @exit   本模块不退出（由 vitest 承接）
 *
 * 已知限制（Known Limitations）：
 *   - 只制造 2 条可判违约（delete／namespace）；其余 7 条在本夹具下应绿 —— 若哪天它们也红，
 *     说明合同断言对"坏实现"的边界变了，meta 的精确集合断言会红并逼人复核。
 *   - 本文件是**夹具**，不是实现：禁止被主测试/storage-backend.conformance.test.ts 引用。
 */
import type {
  StorageBackend,
  StorageEntry,
  StorageQuery,
  StorageResult,
} from '../../../../src/store/storage-backend';
import type { BackendContractFixture, ContractCaseId } from '../storage-backend.contract';

/** 期望被 broken 夹具弄红的契约用例 id（meta 断言既有 ≥1 条，又精确等于此集合） */
export const BROKEN_BACKEND_EXPECTED_VIOLATIONS: readonly ContractCaseId[] = ['delete', 'namespace'];

/** 判别力夹具标识（打印用，避免与真实实现混淆） */
export const BROKEN_BACKEND_FIXTURE_ID = 'broken-backend' as const;

/**
 * 故意违约的 StorageBackend 假实现。
 *
 * 违反：
 *   - delete：无论键是否存在都返回 false（存在键也"删不掉"）。
 *   - namespace：按 key 单键存储、忽略 namespace（跨 namespace 互相覆盖）。
 */
export class BrokenStorageBackend implements StorageBackend {
  private readonly store = new Map<string, StorageEntry>();

  async get(key: string): Promise<StorageResult<string | null>> {
    const entry = this.store.get(key);
    return { value: entry?.value ?? null, degraded: false };
  }

  async set(key: string, value: string): Promise<StorageResult<void>> {
    this.store.set(key, {
      key,
      value,
      namespace: 'default',
      updatedAt: new Date().toISOString(),
    });
    return { value: undefined, degraded: false };
  }

  async delete(): Promise<StorageResult<boolean>> {
    // 故意违约：恒 false（存在键也报告"没删到"）
    return { value: false, degraded: false };
  }

  async query(filter: StorageQuery): Promise<StorageResult<StorageEntry[]>> {
    // 故意违约：忽略 filter.namespace（无隔离）；字面前缀/limit 保持正确，避免误红其它用例
    let entries = [...this.store.values()];
    if (filter.keyPrefix !== undefined && filter.keyPrefix.length > 0) {
      const prefix = filter.keyPrefix;
      entries = entries.filter((entry) => entry.key.startsWith(prefix));
    }
    if (filter.limit !== undefined && filter.limit > 0) {
      entries = entries.slice(0, filter.limit);
    }
    return { value: entries, degraded: false };
  }

  async healthCheck(): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }
}

/**
 * BackendFactory：给 runBackendContract 用的判别力夹具工厂。
 *
 * @returns 每次新建一个 BrokenStorageBackend 夹具（用例隔离）
 */
export function createBrokenBackendFixture(): BackendContractFixture {
  return { backend: new BrokenStorageBackend() };
}
