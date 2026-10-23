/**
 * storage-backend.test.ts — StorageBackend 测试（#913-PR-1 收缩后只留 healthCheck）
 *
 * 收缩依据：`.handbook/派单件/2026-10-24-规格-913-PR1-契约套件.md` §1 件 8（裁 331）
 *   - 原 8 例中 7 例能力面（get/delete/overwrite/namespace/query-empty/query-limit/query-prefix/updatedAt）
 *     已迁入 `tests/contract/storage-backend.conformance.test.ts`（同一套契约 × Memory/Sqlite 双实现）。
 *   - 本件只保留 healthCheck 单例（原 :108），禁在原位重复断言（防两处口径漂移）。
 * 铁律 0-2：每个 public 函数 >= 2 用例（原 happy/sad）—— 能力面用例迁走后由共享契约承接三路径。
 */
import { describe, it, expect } from 'vitest';
import { MemoryStorageBackend } from '../src/store/storage-backend';

describe('MemoryStorageBackend', () => {
  // ── health check（#913-PR-1 收缩：本件仅此 1 例） ──

  it('Given MemoryStorageBackend, When healthCheck, Then returns healthy', async () => {
    // Given: memory backend
    const backend = new MemoryStorageBackend();

    // When: health check
    const health = await backend.healthCheck();

    // Then: healthy
    expect(health.healthy).toBe(true);
  });
});
