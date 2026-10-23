/**
 * tests/contract/conformance/storage-backend.contract.ts — Q-9 StorageBackend 共享 conformance 用例表
 *
 * 设计哲学：契约只有一份，实现各自适配 —— 用例即数据（`CaseResult[]`），
 * 主测试（describe）与元测试（meta）共用同一个执行体，杜绝"两个 backend 各测各的"。
 *
 * 契约真源：`.handbook/派单件/2026-10-24-规格-913-PR1-契约套件.md` §2（9 条用例，裁 331 已判）
 * 上游裁：`updatedAt`＝ISO 8601 UTC；`keyPrefix`＝字面前缀（`_`/`%` 不作通配）；
 *        **返回顺序无契约**（consumer 自排，故本套件凡涉及集合一律按多重集比较）。
 *
 * Source map：
 *   CaseResult／ContractCase／CONTRACT_CASES          → §2 九条用例的表列（id/label/assert）
 *   runBackendContract(factory)                       → 纯函数式执行器：每条用例一个新 backend，返回结果数组
 *   KnownViolation 判定（未登记违约／强制转正）        → 消费侧（storage-backend.conformance.test.ts）
 *
 * @input  BackendFactory —— 每次调用实例化一个【干净】backend（用例间禁共享状态）；可带 dispose 释放资源
 * @output CaseResult[] —— 顺序＝CONTRACT_CASES；逐条 { id, label, passed, code?, expected?, actual?, detail? }
 * @degraded 夹具创建失败（factory 抛错/未返回 backend）⇒ 全用例 passed=false 且 detail 以 `degraded: ` 开头点名
 * @exit   本模块不退出。三态由调用方（vitest）承接：绿=0｜用例红=1｜collection/环境失败=2 语义
 *
 * 已知限制（Known Limitations）：
 *   - 只覆盖规格 §2 的九条；并发、进程重启、文件库迁移、watch 订阅不在本批契约内。
 *   - `updatedAt` 只校验形状（ISO 8601 UTC 毫秒），不校验时钟单调性/时区换算。
 *   - `keyPrefix` 只验字面语义（`a_`／`p%` 两组），不穷举所有正则元字符。
 *   - 返回顺序**故意不断言**（裁 331：无契约）；`query-limit` 只断言条数与成员子集。
 *   - sqlite 两条已知违约由消费侧登记（known-divergences.yaml）标红不阻断；本模块本身不读清单。
 */
import type { StorageBackend } from '../../../src/store/storage-backend';

// ═══ 契约用例 id（唯一真源顺序；meta/主测试/登记表共用） ═══

export const CONTRACT_CASE_IDS = [
  'get-roundtrip',
  'delete',
  'overwrite',
  'namespace',
  'query-empty',
  'query-limit',
  'query-prefix',
  'updatedAt-iso',
  'health',
] as const;

export type ContractCaseId = (typeof CONTRACT_CASE_IDS)[number];

/** `KNOWN_VIOLATION:` 打印前缀（裁 331：照测标红、exit 0 不阻断；消费侧据此留痕） */
export const KNOWN_VIOLATION_PREFIX = 'KNOWN_VIOLATION:' as const;

// ═══ 结果与错误类型（typed error 带 code） ═══

export type ConformanceErrorCode =
  | 'CONFORMANCE_ASSERTION_FAILED'
  | 'CONFORMANCE_FIXTURE_CREATE_FAILED'
  | 'CONFORMANCE_CASE_THREW';

/** conformance 层错误：一律带 code（fail loud；禁裸 throw new Error 当契约） */
export class ConformanceError extends Error {
  readonly code: ConformanceErrorCode;
  readonly expected: string;
  readonly actual: string;

  /**
   * @param message - 人类可读的失败点（含期望/实际）
   * @param code - 机器可判错误码
   * @param expected - 期望值摘要（默认空串）
   * @param actual - 实际值摘要（默认空串）
   */
  constructor(message: string, code: ConformanceErrorCode, expected = '', actual = '') {
    super(message);
    this.name = 'ConformanceError';
    this.code = code;
    this.expected = expected;
    this.actual = actual;
  }
}

/** 单条用例结果（纯数据；describe 与 meta 共用） */
export interface CaseResult {
  readonly id: ContractCaseId;
  readonly label: string;
  readonly passed: boolean;
  /** 失败时的机器可判错误码；通过时缺省 */
  readonly code?: string;
  readonly expected?: string;
  readonly actual?: string;
  /** 失败详情（前缀 `[<id>]`；夹具级失败以 `degraded: ` 开头） */
  readonly detail?: string;
}

/** 受测 backend 夹具：每次实例化一个干净后端；dispose 用于释放 sqlite 连接等 */
export interface BackendContractFixture {
  readonly backend: StorageBackend;
  readonly dispose?: () => void | Promise<void>;
}

/** 后端工厂：用例之间必须互不影响（每个用例调用一次） */
export type BackendFactory = () => BackendContractFixture | Promise<BackendContractFixture>;

/** 一条契约用例：id ＋ label ＋ 断言（抛 ConformanceError ⇒ 判红） */
export interface ContractCase {
  readonly id: ContractCaseId;
  readonly label: string;
  readonly assert: (backend: StorageBackend) => Promise<void>;
}

// ═══ 断言原语（本地实现，保持本模块可脱离 vitest 单跑） ═══

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (err) {
    // 显式降级（不静默）：JSON.stringify 对循环引用/BigInt 等会抛 ⇒ 退回 String()，并留痕
    console.warn(`degraded: stringify 无法 JSON 序列化（${describeError(err)}），已降级为 String()`);
    return String(value);
  }
}

function assertEqual(what: string, actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) {
    throw new ConformanceError(
      `${what}: expected=${stringify(expected)} actual=${stringify(actual)}`,
      'CONFORMANCE_ASSERTION_FAILED',
      stringify(expected),
      stringify(actual),
    );
  }
}

function assertTrue(what: string, condition: boolean): void {
  assertEqual(what, condition, true);
}

function assertMatch(what: string, actual: string, pattern: RegExp): void {
  if (!pattern.test(actual)) {
    throw new ConformanceError(
      `${what}: 实际值 ${stringify(actual)} 不匹配 ${String(pattern)}`,
      'CONFORMANCE_ASSERTION_FAILED',
      String(pattern),
      stringify(actual),
    );
  }
}

/** 多重集比较：不断言顺序（裁 331：返回顺序无契约） */
function sameMultiset(actual: readonly string[], expected: readonly string[]): boolean {
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

function assertMultiset(what: string, actual: readonly string[], expected: readonly string[]): void {
  if (!sameMultiset(actual, expected)) {
    throw new ConformanceError(
      `${what}: expected(多重集)=${stringify([...expected].sort())} actual=${stringify(actual)}`,
      'CONFORMANCE_ASSERTION_FAILED',
      stringify([...expected].sort()),
      stringify(actual),
    );
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

// ═══ §2 契约用例（唯一真源；顺序＝CONTRACT_CASE_IDS） ═══

export const CONTRACT_CASES: readonly ContractCase[] = [
  {
    id: 'get-roundtrip',
    label: 'set 后 get 得原值且 degraded=false；未设键 ⇒ null 且 degraded=false',
    async assert(backend) {
      const key = 'contract:get-roundtrip';
      const setResult = await backend.set(key, 'value-1');
      assertEqual('set.degraded', setResult.degraded, false);
      const hit = await backend.get(key);
      assertEqual('get.value', hit.value, 'value-1');
      assertEqual('get.degraded', hit.degraded, false);
      const miss = await backend.get(`${key}:missing`);
      assertEqual('未设键 get.value', miss.value, null);
      assertEqual('未设键 get.degraded', miss.degraded, false);
    },
  },
  {
    id: 'delete',
    label: '存在键 ⇒ true 且后续 get null；不存在键 ⇒ false',
    async assert(backend) {
      const key = 'contract:delete';
      await backend.set(key, 'to-be-deleted');
      const existed = await backend.delete(key);
      assertEqual('delete 存在键 value', existed.value, true);
      assertEqual('delete 存在键 degraded', existed.degraded, false);
      const after = await backend.get(key);
      assertEqual('delete 后 get.value', after.value, null);
      const missing = await backend.delete(key);
      assertEqual('delete 不存在键 value', missing.value, false);
    },
  },
  {
    id: 'overwrite',
    label: '同键覆盖 ⇒ 新值（且不产生重复条目）',
    async assert(backend) {
      const key = 'contract:overwrite';
      await backend.set(key, 'old-value');
      await backend.set(key, 'new-value');
      const got = await backend.get(key);
      assertEqual('覆盖后 get.value', got.value, 'new-value');
      const rows = await backend.query({ namespace: 'default' });
      assertMultiset('覆盖后同 namespace 条目键', rows.value.map((entry) => entry.key), [key]);
    },
  },
  {
    id: 'namespace',
    label: '不同 namespace 隔离；缺省 ＝ default',
    async assert(backend) {
      const key = 'contract:namespace';
      await backend.set(key, 'default-value');
      await backend.set(key, 'ns-a-value', 'ns-a');
      await backend.set(key, 'ns-b-value', 'ns-b');
      assertEqual('get 缺省 namespace', (await backend.get(key)).value, 'default-value');
      assertEqual("get namespace='default'", (await backend.get(key, 'default')).value, 'default-value');
      assertEqual("get namespace='ns-a'", (await backend.get(key, 'ns-a')).value, 'ns-a-value');
      assertEqual("get namespace='ns-b'", (await backend.get(key, 'ns-b')).value, 'ns-b-value');
      const defaultRows = await backend.query({ namespace: 'default' });
      assertMultiset('query default 键集', defaultRows.value.map((entry) => entry.key), [key]);
      assertMultiset(
        'query default 条目全属 default',
        defaultRows.value.map((entry) => entry.namespace),
        ['default'],
      );
      const nsARows = await backend.query({ namespace: 'ns-a' });
      assertMultiset('query ns-a 键集', nsARows.value.map((entry) => entry.key), [key]);
    },
  },
  {
    id: 'query-empty',
    label: '空库 ⇒ []（degraded=false）',
    async assert(backend) {
      const result = await backend.query({});
      assertEqual('空库 query 条数', result.value.length, 0);
      assertEqual('空库 query degraded', result.degraded, false);
    },
  },
  {
    id: 'query-limit',
    label: '返回条数 ≤ limit（不断言顺序；成员⊆已写入）',
    async assert(backend) {
      const written: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const key = `contract:limit:${index}`;
        await backend.set(key, `value-${index}`);
        written.push(key);
      }
      const result = await backend.query({ limit: 3 });
      // 规格 §2：只断言「返回条数 ≤ limit」（恰好 min(limit,匹配数) 是更严的隐含契约，超契约不判）
      assertTrue('返回条数 ≤ limit', result.value.length <= 3);
      const returnedKeys = result.value.map((entry) => entry.key);
      assertTrue('返回键无重复', new Set(returnedKeys).size === returnedKeys.length);
      assertMultiset('返回键 ⊆ 已写入键', returnedKeys.filter((key) => !written.includes(key)), []);
    },
  },
  {
    id: 'query-prefix',
    label: '字面前缀：a_ 只回 a_b；p% 只回 p%q（_／% 不作通配）',
    async assert(backend) {
      const seeded = ['a_b', 'axb', 'p%q', 'pxq', 'contract:prefix:plain'];
      for (const key of seeded) {
        await backend.set(key, `value:${key}`);
      }
      const underscore = await backend.query({ keyPrefix: 'a_' });
      const percent = await backend.query({ keyPrefix: 'p%' });
      const gotUnderscore = underscore.value.map((entry) => entry.key);
      const gotPercent = percent.value.map((entry) => entry.key);
      const problems: string[] = [];
      if (!sameMultiset(gotUnderscore, ['a_b'])) {
        problems.push(`prefix "a_": expected=["a_b"] actual=${stringify(gotUnderscore)}（_ 被当通配）`);
      }
      if (!sameMultiset(gotPercent, ['p%q'])) {
        problems.push(`prefix "p%": expected=["p%q"] actual=${stringify(gotPercent)}（% 被当通配）`);
      }
      if (problems.length > 0) {
        throw new ConformanceError(
          `字面前缀违约: ${problems.join('; ')}`,
          'CONFORMANCE_ASSERTION_FAILED',
          stringify(['a_→a_b', 'p%→p%q']),
          stringify(problems),
        );
      }
    },
  },
  {
    id: 'updatedAt-iso',
    label: 'updatedAt 匹配 ^YYYY-MM-DDTHH:mm:ss.sssZ$（ISO 8601 UTC）',
    async assert(backend) {
      await backend.set('contract:updated-at', 'value');
      const result = await backend.query({ namespace: 'default' });
      assertEqual('query 命中 1 条', result.value.length, 1);
      const updatedAt: unknown = result.value[0].updatedAt;
      assertTrue('updatedAt 应为字符串', typeof updatedAt === 'string');
      assertMatch(
        'updatedAt ISO 8601 UTC 毫秒形状',
        updatedAt as string,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    },
  },
  {
    id: 'health',
    label: 'healthCheck().healthy === true',
    async assert(backend) {
      const health = await backend.healthCheck();
      assertEqual('healthCheck().healthy', health.healthy, true);
    },
  },
];

// ═══ 执行器（纯函数式：不 assert、不退出，只返回可核结果） ═══

/**
 * 对给定工厂跑完整套契约用例（每条用例一个干净 backend）。
 *
 * @param factory - 每次返回一个新的受测 backend（可带 dispose）
 * @returns CaseResult[] —— 顺序＝CONTRACT_CASES；失败条目 detail 点名用例 id
 * @throws 不抛错：夹具级失败也降级为 CaseResult（detail 以 `degraded: ` 开头），由消费侧判红
 */
export async function runBackendContract(factory: BackendFactory): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  let fixtureFailure: string | undefined;

  for (const contractCase of CONTRACT_CASES) {
    if (fixtureFailure !== undefined) {
      results.push({
        id: contractCase.id,
        label: contractCase.label,
        passed: false,
        code: 'CONFORMANCE_FIXTURE_CREATE_FAILED',
        detail: fixtureFailure,
      });
      continue;
    }

    let fixture: BackendContractFixture | undefined;
    try {
      fixture = await factory();
    } catch (err) {
      // 三态：环境/夹具失败 ⇒ degraded（绝不静默 pass）
      fixtureFailure = `degraded: 夹具创建失败（首个失败用例 ${contractCase.id}）: ${describeError(err)}`;
      results.push({
        id: contractCase.id,
        label: contractCase.label,
        passed: false,
        code: 'CONFORMANCE_FIXTURE_CREATE_FAILED',
        detail: fixtureFailure,
      });
      continue;
    }

    if (fixture === undefined || fixture === null || typeof fixture.backend !== 'object' || fixture.backend === null) {
      fixtureFailure = `degraded: 夹具创建失败（首个失败用例 ${contractCase.id}）: factory 未返回 backend 实例`;
      results.push({
        id: contractCase.id,
        label: contractCase.label,
        passed: false,
        code: 'CONFORMANCE_FIXTURE_CREATE_FAILED',
        detail: fixtureFailure,
      });
      continue;
    }

    try {
      await contractCase.assert(fixture.backend);
      results.push({ id: contractCase.id, label: contractCase.label, passed: true });
    } catch (err) {
      if (err instanceof ConformanceError) {
        results.push({
          id: contractCase.id,
          label: contractCase.label,
          passed: false,
          code: err.code,
          expected: err.expected,
          actual: err.actual,
          detail: `[${contractCase.id}] ${err.message}`,
        });
      } else {
        results.push({
          id: contractCase.id,
          label: contractCase.label,
          passed: false,
          code: 'CONFORMANCE_CASE_THREW',
          detail: `[${contractCase.id}] 用例执行抛错: ${describeError(err)}`,
        });
      }
    } finally {
      if (fixture.dispose !== undefined) {
        try {
          await fixture.dispose();
        } catch (err) {
          // dispose 失败不改变用例判定，但必须可见（铁律 11：不静默）
          console.warn(`[conformance] dispose 失败（${contractCase.id}）: ${describeError(err)}`);
        }
      }
    }
  }

  return results;
}
