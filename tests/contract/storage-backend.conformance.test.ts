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
 *   UNDECLARED_BACKEND         → 无 capabilities 的最小假后端（判据 B 的 UNDECLARED 样本；对象字面量）
 *   每个实现一个 describe       → 跑 runBackendContract，把结果对账 known-divergences.yaml
 *   每个实现第二个 it           → 能力面（#964 Q-15 declared-only：声明可解析／缺能力 fail-loud／未声明 UNDECLARED／开关降级）
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
import {
  MemoryStorageBackend,
  SqliteStorageBackend,
  StorageCapabilityError,
  requireStorageCapability,
} from '../../src/store/storage-backend';
import type { StorageBackend, StorageCapability } from '../../src/store/storage-backend';
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

/** 两实现声明的能力（`transactions` 故意不在内 ⇒ 真实"缺能力"样本） */
const DECLARED_CAPABILITIES: readonly StorageCapability[] = [
  'kv',
  'prefix-query',
  'limit-query',
  'health',
];

/**
 * 最小假后端：对象字面量实现 5 方法、**不声明** `capabilities`（判据 B 的 UNDECLARED 样本）。
 * 故意不用 `class X implements StorageBackend` —— 不被 registry 源码枚举识别；也不放进 src/。
 */
const UNDECLARED_BACKEND: StorageBackend = {
  async get() {
    return { value: null, degraded: false };
  },
  async set() {
    return { value: undefined, degraded: false };
  },
  async delete() {
    return { value: false, degraded: false };
  },
  async query() {
    return { value: [], degraded: false };
  },
  async healthCheck() {
    return { healthy: true };
  },
};

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

      it('能力面（#964 Q-15）：已声明四能力可解析；transactions fail-loud；未声明 ⇒ UNDECLARED；开关=0 ⇒ 降级不抛', async () => {
        const factory = factories[implementation.name];
        expect(factory, `测试工厂缺失：${implementation.name} 已登记但本文件没有对应 factory`).toBeTypeOf('function');

        const handle = await factory();
        try {
          const backend = handle.backend;
          const declaredCapabilities = backend.capabilities;
          expect(declaredCapabilities, `${implementation.name} 必须显式声明能力面`).toBeInstanceOf(Set);
          expect(
            declaredCapabilities?.size,
            `${implementation.name} 必须声明 ${DECLARED_CAPABILITIES.length} 项能力`,
          ).toBe(DECLARED_CAPABILITIES.length);
          expect(
            declaredCapabilities?.has('transactions'),
            `${implementation.name} 不得声明 transactions（本批真实缺能力样本）`,
          ).toBe(false);

          // 判据 A 正例：已声明能力逐条可解析（true，不抛）
          for (const capability of DECLARED_CAPABILITIES) {
            expect(
              requireStorageCapability(backend, capability),
              `${implementation.name} 应具备能力 ${capability}`,
            ).toBe(true);
          }

          // 判据 A 反例：缺能力必须 fail-loud（typed error），且**不是** StorageResult 降级值
          let capabilityThrown: unknown = null;
          try {
            requireStorageCapability(backend, 'transactions');
          } catch (err) {
            capabilityThrown = err;
          }
          expect(
            capabilityThrown,
            `${implementation.name} 的 transactions 必须 fail-loud（不得折成 {degraded:true}）`,
          ).toBeInstanceOf(StorageCapabilityError);
          const capabilityError = capabilityThrown as StorageCapabilityError;
          expect(capabilityError.code, 'code 必须机器可判为 UNSUPPORTED').toBe(
            'STORAGE_CAPABILITY_UNSUPPORTED',
          );
          expect(capabilityError.capability).toBe('transactions');
          expect(capabilityError.phase).toBe('resolve');
          expect(capabilityError.retryable).toBe(false);
          expect(capabilityError.name).toBe('StorageCapabilityError');
          expect(
            (capabilityThrown as { value?: unknown }).value,
            '缺能力抛的必须是错误对象（value===undefined ⇒ 不是 StorageResult）',
          ).toBeUndefined();

          // 判据 B 反例：未声明能力面 ⇒ UNDECLARED（走真实 requireStorageCapability 路径）
          let undeclaredThrown: unknown = null;
          try {
            requireStorageCapability(UNDECLARED_BACKEND, 'kv');
          } catch (err) {
            undeclaredThrown = err;
          }
          expect(
            undeclaredThrown,
            '未声明 capabilities 的后端必须 fail-loud（UNDECLARED）',
          ).toBeInstanceOf(StorageCapabilityError);
          expect((undeclaredThrown as StorageCapabilityError).code).toBe(
            'STORAGE_CAPABILITY_UNDECLARED',
          );
          expect((undeclaredThrown as StorageCapabilityError).capability).toBe('kv');

          // 判据 D：开关='0' ⇒ 降级（不抛、返回 false）；只认 '0'（'00'/'false' 仍严格）
          const originalStrictFlag = process.env.SYNO_STORAGE_CAP_STRICT;
          process.env.SYNO_STORAGE_CAP_STRICT = '0';
          try {
            expect(requireStorageCapability(backend, 'transactions')).toBe(false);
            expect(requireStorageCapability(UNDECLARED_BACKEND, 'kv')).toBe(false);
            process.env.SYNO_STORAGE_CAP_STRICT = '00';
            expect(
              () => requireStorageCapability(backend, 'transactions'),
              "'00' 不得降级（只认 '0'）",
            ).toThrow(StorageCapabilityError);
            process.env.SYNO_STORAGE_CAP_STRICT = 'false';
            expect(
              () => requireStorageCapability(backend, 'transactions'),
              "'false' 不得降级（只认 '0'）",
            ).toThrow(StorageCapabilityError);
          } finally {
            if (originalStrictFlag === undefined) {
              delete process.env.SYNO_STORAGE_CAP_STRICT;
            } else {
              process.env.SYNO_STORAGE_CAP_STRICT = originalStrictFlag;
            }
          }

          console.log(
            `CAPABILITY: ${implementation.name} declared=${declaredCapabilities?.size ?? 0} unsupported=transactions`,
          );
        } finally {
          // Sqlite 必须关连接；Memory 无 dispose
          await handle.dispose?.();
        }
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
