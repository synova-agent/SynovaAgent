/**
 * tests/contract/storage-backend.conformance.test.ts — Q-9 共享 conformance 主测试（Memory × Sqlite 同一套）
 *
 * 设计哲学：**同一套契约用例 × 每个实现各跑一遍** —— 实现之间只允许差异在"已登记违约"里，
 * 差异必须逐条挂在 known-divergences.yaml 上（标红不阻断），禁止悄悄红、也禁止悄悄绿。
 *
 * 契约真源：`.handbook/派单件/2026-10-24-规格-913-PR1-契约套件.md` §2／§3.2（裁 331）
 * 判据：
 *   - 未登记违约 ⇒ 红（新增违约必须先登记/修复）
 *   - 登记未删而实测已绿 ⇒ 红（**强制转正、只减不增**）
 *   - 已登记违约 ⇒ 照测、stdout 打印 `KNOWN_VIOLATION: <id> × <impl>`、exit 0 不阻断
 *   - Memory 与 Sqlite 用例数相同且 ≡ CONTRACT_CASE_IDS
 *
 * Source map：
 *   factories                  → 两实现的 BackendFactory（Sqlite 用 :memory:，dispose 关连接）
 *   每个实现一个 describe       → 跑 runBackendContract，把结果对账 known-divergences.yaml
 *   最后一个 it                → 跨实现一致性（用例数相同 ≡ 登记表）
 *
 * @input  tests/contract/conformance/storage-backend.contract.ts（用例真源）
 *         tests/contract/known-divergences.yaml（KNOWN_VIOLATION 登记）
 * @output vitest 结果 ＋ stdout 的 `KNOWN_VIOLATION:` 行（step summary 留痕）
 * @degraded 清单缺失/解析失败 ⇒ RegistryError（message 以 `degraded: ` 开头）⇒ 本用例红（不静默 pass）
 * @exit    vitest：全绿 0｜用例红 1｜collection/环境失败 2 语义（KNOWN_VIOLATION 不改变 exit=0）
 *
 * 已知限制（Known Limitations）：
 *   - Sqlite 用 `:memory:`（每用例新建）⇒ 不覆盖文件库、重启持久化与迁移。
 *   - 只登记"契约已判、上游未修"的差异（本批 2 条 sqlite）；不把行为差异当契约。
 *   - 返回顺序不校验（裁 331：无契约）；集合类断言一律多重集比较。
 *   - 本文件不碰 src/** 与门禁；修 sqlite 违约另立卡（P2）。
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryStorageBackend, SqliteStorageBackend } from '../../src/store/storage-backend';
import {
  CONTRACT_CASE_IDS,
  KNOWN_VIOLATION_PREFIX,
  runBackendContract,
} from './conformance/storage-backend.contract';
import type { BackendFactory } from './conformance/storage-backend.contract';
import { CONFORMANCE_REGISTRY, loadKnownDivergences } from './conformance/registry';

/** 实现类名 → 干净 backend 工厂（用例隔离；Sqlite 必须关连接） */
const factories: Record<string, BackendFactory> = {
  MemoryStorageBackend: () => ({ backend: new MemoryStorageBackend() }),
  SqliteStorageBackend: () => {
    const db = new Database(':memory:');
    return {
      backend: new SqliteStorageBackend(db),
      dispose: () => {
        db.close();
      },
    };
  },
};

/** 跨实现一致性用例的观测值：实现名 → results.length（由各实现用例写入） */
const observedCaseCounts: Record<string, number> = {};

describe('StorageBackend conformance（裁 331 契约 · 同一套用例 × 双实现）', () => {
  for (const implementation of CONFORMANCE_REGISTRY.implementations) {
    describe(`实现: ${implementation.name}`, () => {
      it('九条契约用例：全绿，或失败项均为已登记 KNOWN_VIOLATION', async () => {
        const factory = factories[implementation.name];
        expect(factory, `测试工厂缺失：${implementation.name} 已登记但本文件没有对应 factory`).toBeTypeOf('function');

        // 清单缺失/解析失败 ⇒ RegistryError(`degraded: …`) ⇒ 本用例红（三态：不静默 pass）
        const ledger = loadKnownDivergences();
        const results = await runBackendContract(factory);
        observedCaseCounts[implementation.name] = results.length;

        // 1) 同一套：结果 id 序列必须严格等于契约真源（也防"少跑一条"
        expect(results.map((result) => result.id), '结果 id 序列必须等于 CONTRACT_CASE_IDS').toEqual([
          ...CONTRACT_CASE_IDS,
        ]);

        const caseIdSet = new Set<string>(CONTRACT_CASE_IDS);
        const registered = ledger.divergences.filter(
          (entry) => entry.implementation === implementation.name,
        );
        // 登记表的 `case` 是契约用例 id（`id` 是登记身份名；两者可不同，见 known-divergences.yaml 头注）
        const registeredCases = new Set(registered.map((entry) => entry.case));
        const failing = results.filter((result) => !result.passed);
        const failingIds = failing.map((result) => result.id);
        const failingIdSet = new Set<string>(failingIds);

        // 2) 已登记违约：照测标红（stdout 留痕，登记身份名在左），不阻断（裁 331）
        const knownFailing = failing.filter((result) => registeredCases.has(result.id));
        for (const entry of registered) {
          const failure = failing.find((result) => result.id === entry.case);
          if (failure === undefined) continue;
          const caseSuffix = entry.case === entry.id ? '' : ` [case=${entry.case}]`;
          console.log(
            `${KNOWN_VIOLATION_PREFIX} ${entry.id} × ${implementation.name}${caseSuffix} — ${failure.detail ?? '(no detail)'}`,
          );
        }

        // 3) 未登记违约 ⇒ 红（E1／E4）
        const unregistered = failing
          .filter((result) => !registeredCases.has(result.id))
          .map((result) => `${result.id}（${result.code ?? 'UNKNOWN'}：${result.detail ?? ''}）`);
        expect(
          unregistered,
          `未登记违约 × ${implementation.name}: 照测标红但 known-divergences.yaml 未登记 —— ${unregistered.join(' | ')}`,
        ).toEqual([]);

        // 4) 登记未删而实测已绿 ⇒ 红（**强制转正、只减不增**；E5）
        const staleRegistered = registered
          .filter((entry) => !failingIdSet.has(entry.case))
          .map((entry) => entry.id);
        expect(
          staleRegistered,
          `强制转正: ${implementation.name} 的登记违约项实测已绿但登记未删（只减不增）—— ${staleRegistered.join(' | ')}`,
        ).toEqual([]);

        // 5) 登记了不存在的契约用例 id ⇒ 红（登记表自身造假）
        const ghostRegistered = registered
          .filter((entry) => !caseIdSet.has(entry.case))
          .map((entry) => `${entry.id}→${entry.case}`);
        expect(
          ghostRegistered,
          `ghost 登记: ${implementation.name} 登记了不存在的契约用例 id —— ${ghostRegistered.join(' | ')}`,
        ).toEqual([]);

        console.log(
          `CONFORMANCE_SUITE: ${implementation.name} cases=${results.length} failing=${failing.length} ` +
            `knownViolations=${knownFailing.length} registered=${registered.length}`,
        );
      });
    });
  }

  it('Memory 与 Sqlite 各跑同一套（用例数相同且 ≡ 登记表）', () => {
    const expectedNames = CONFORMANCE_REGISTRY.implementations.map((entry) => entry.name).sort();
    expect(Object.keys(observedCaseCounts).sort(), '两个实现都必须跑过套件').toEqual(expectedNames);
    const counts = Object.values(observedCaseCounts);
    expect(new Set(counts).size, `两实现用例数必须相同（实际: ${JSON.stringify(observedCaseCounts)}）`).toBe(1);
    expect(counts[0], '用例数必须等于契约真源条数').toBe(CONTRACT_CASE_IDS.length);
  });
});
