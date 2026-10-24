/**
 * tests/contract/conformance/meta.test.ts — Q-9 conformance 元测试（判别力自证 ＋ 清单结构 ＋ 三态）
 *
 * 设计哲学：**先证明"套件能红"，再谈"套件全绿"** —— 一个恒绿的 conformance 等于没有 conformance；
 * 本文件用故意违约的 broken-backend 夹具、空扫描根、坏 YAML 三类"坏输入"校验套件自身有判别力。
 *
 * 契约真源：`.handbook/派单件/2026-10-24-规格-913-PR1-契约套件.md` §1 件 4／§3.3 E2/E3/E6／§3.4（裁 331）
 * 元判据：
 *   - 枚举集合 ≡ 登记表（未纳管 ⇒ `未纳管: X` 红；枚举 0 ⇒ 红，禁把看不见当通过）
 *   - broken-backend 夹具 ⇒ 至少 1 条契约用例红，且精确弄红 delete/namespace（断言非空壳）
 *   - known-divergences／known-red 两清单结构齐（owner/expiry/ruling/evidence／路径存在）
 *   - 清单缺失/解析失败/夹具创建失败 ⇒ `degraded:` 前缀点名（不静默 pass）
 *
 * Source map：
 *   expectRegistryError()        → 断言 RegistryError 的 code + `degraded:` 前缀 + 点名
 *   「登记表结构」               → interface/definedAt/implementations/suites/planned 逐项可核
 *   「枚举集合 ≡ 登记表」         → E2 判别力（加 Stub ⇒ 未纳管: Stub）
 *   「枚举 0 即红」              → E6 判别力（空扫描根 ⇒ REGISTRY_ENUMERATION_EMPTY）
 *   「判别力自证」               → E3 判别力（broken-backend ⇒ delete/namespace 红）
 *   「两清单结构」               → known-divergences／known-red 字段与路径
 *   「三态」                     → 清单缺失/解析失败/schema 非法 ＋ 夹具工厂抛错
 *
 * @input  tests/contract/conformance/*（登记表/枚举/契约）、两份清单、broken-backend 夹具
 * @output vitest 结果 ＋ stdout 的 ENUMERATION / DISCRIMINATION 行
 * @degraded 任一坏输入路径 ⇒ RegistryError（message 以 `degraded: ` 开头点名）或被断言为红
 * @exit    vitest：全绿 0｜用例红 1｜collection/环境失败 2 语义
 *
 * 已知限制（Known Limitations）：
 *   - broken-backend 只覆盖 2 条违约；其余 7 条用它跑应绿（若变红会精确集合断言逼复核）。
 *   - 枚举只用行级文本匹配；动态/反射实现漏检（与 G1 `T1` 同型盲区），本文件不能补这个盲区。
 *   - 清单 expiry 在**加载时**校验：非法日期 ⇒ SCHEMA_INVALID；已过期 ⇒ LEDGER_EXPIRED（本文件有两态用例证明）。
 *   - 三态用例写 /tmp 临时文件并自清理；若进程被强杀可能残留（不影响仓库写集）。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  CONFORMANCE_REGISTRY,
  RegistryError,
  enumerateStorageBackendImplementations,
  loadKnownDivergences,
  loadKnownRed,
} from './registry';
import type { RegistryErrorCode } from './registry';
import { CONTRACT_CASE_IDS, runBackendContract } from './storage-backend.contract';
import {
  BROKEN_BACKEND_EXPECTED_VIOLATIONS,
  BROKEN_BACKEND_FIXTURE_ID,
  createBrokenBackendFixture,
} from './fixtures/broken-backend';

const REPO_ROOT = process.cwd();

/**
 * 断言 fn 抛 RegistryError（code 符合 ＋ message 以 `degraded: ` 开头 ＋ 点名 needle）。
 *
 * @param fn - 预期抛错的调用
 * @param expectedCode - 期望错误码
 * @param needle - message 必须包含的点名片段（路径/字段）
 * @returns 已确认的 RegistryError（供追加断言）
 */
function expectRegistryError(
  fn: () => unknown,
  expectedCode: RegistryErrorCode,
  needle: string,
): RegistryError {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  if (!(caught instanceof RegistryError)) {
    throw new Error(`期望抛 RegistryError(${expectedCode})，实际: ${String(caught)}`);
  }
  expect(caught.code).toBe(expectedCode);
  expect(caught.message, '降级信息必须以 `degraded: ` 开头（三态：检查自身失败不得当通过）').toMatch(
    /^degraded: /,
  );
  expect(caught.message).toContain(needle);
  return caught;
}

describe('conformance meta（Q-9 · 裁 331）', () => {
  it('登记表结构：interface/definedAt/implementations/suites/planned 可核（路径存在）', () => {
    expect(CONFORMANCE_REGISTRY.schemaVersion).toBe(1);

    const iface = CONFORMANCE_REGISTRY.interface;
    const ifacePath = path.resolve(REPO_ROOT, iface.definedAt.file);
    expect(existsSync(ifacePath), `interface.definedAt 文件不存在: ${iface.definedAt.file}`).toBe(true);
    const ifaceLine = readFileSync(ifacePath, 'utf8').split(/\r?\n/)[iface.definedAt.line - 1] ?? '';
    expect(
      ifaceLine,
      `interface.definedAt 行号已漂移: ${iface.definedAt.file}:${iface.definedAt.line}`,
    ).toContain(`interface ${iface.name}`);

    for (const implementation of CONFORMANCE_REGISTRY.implementations) {
      const implPath = path.resolve(REPO_ROOT, implementation.file);
      expect(existsSync(implPath), `实现文件不存在: ${implementation.file}`).toBe(true);
      expect(
        readFileSync(implPath, 'utf8'),
        `实现声明未命中: ${implementation.name} @ ${implementation.file}`,
      ).toContain(`class ${implementation.name} implements ${iface.name}`);
    }

    expect(CONFORMANCE_REGISTRY.suites.length, '至少登记 1 个 suite').toBeGreaterThanOrEqual(1);
    for (const suite of CONFORMANCE_REGISTRY.suites) {
      expect(suite.interface).toBe(iface.name);
      expect(suite.caseCount, `suite ${suite.id} 的 caseCount 必须等于契约真源条数`).toBe(
        CONTRACT_CASE_IDS.length,
      );
      expect(existsSync(path.resolve(REPO_ROOT, suite.contractFile)), `suite 契约文件不存在: ${suite.contractFile}`).toBe(true);
      expect(existsSync(path.resolve(REPO_ROOT, suite.testFile)), `suite 测试文件不存在: ${suite.testFile}`).toBe(true);
    }

    const plannedNames = CONFORMANCE_REGISTRY.planned.map((entry) => entry.interface);
    expect(plannedNames, 'planned 必须显式登记 DataConnector（PR-1 不实施）').toContain('DataConnector');
    for (const planned of CONFORMANCE_REGISTRY.planned) {
      expect(planned.note.length, `planned ${planned.interface} 的 note 过短`).toBeGreaterThan(10);
      const plannedPath = path.resolve(REPO_ROOT, planned.definedAt.file);
      expect(existsSync(plannedPath), `planned 定义文件不存在: ${planned.definedAt.file}`).toBe(true);
      const plannedLine = readFileSync(plannedPath, 'utf8').split(/\r?\n/)[planned.definedAt.line - 1] ?? '';
      expect(
        plannedLine,
        `planned.definedAt 行号已漂移: ${planned.definedAt.file}:${planned.definedAt.line}`,
      ).toContain(`interface ${planned.interface}`);
    }
  });

  it('枚举集合 ≡ 登记表（未纳管 ⇒ 红「未纳管: X」；枚举 0 ⇒ 红）', () => {
    const hits = enumerateStorageBackendImplementations();
    console.log(
      `ENUMERATION: ${hits.length} 条 — ${hits.map((hit) => `${hit.className}@${hit.file}:${hit.line}`).join(', ')}`,
    );
    expect(hits.length, '枚举 0 ⇒ 禁把看不见当通过').toBeGreaterThan(0);

    const enumerated = hits.map((hit) => hit.className).sort();
    const registered = CONFORMANCE_REGISTRY.implementations.map((entry) => entry.name).sort();
    const unmanaged = enumerated.filter((name) => !registered.includes(name));
    const missing = registered.filter((name) => !enumerated.includes(name));

    expect(
      unmanaged,
      `未纳管: ${unmanaged.join(', ')}（源码实现了 StorageBackend 但 CONFORMANCE_REGISTRY 未登记）`,
    ).toEqual([]);
    expect(
      missing,
      `登记但源码未命中: ${missing.join(', ')}（登记表与源码不一致）`,
    ).toEqual([]);
    expect(enumerated, '枚举集合必须 ≡ 登记表').toEqual(registered);
  });

  it('枚举 0 即红（E6）：扫描根为空/不可读 ⇒ RegistryError(degraded:) 点名', () => {
    const emptyDir = mkdtempSync(path.join(os.tmpdir(), '913-empty-scan-'));
    try {
      const emptyError = expectRegistryError(
        () => enumerateStorageBackendImplementations(emptyDir),
        'REGISTRY_ENUMERATION_EMPTY',
        emptyDir,
      );
      expect(emptyError.message, '空扫描根必须点名"禁把看不见当通过"').toContain('禁把看不见当通过');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }

    const ghostRoot = path.join(os.tmpdir(), `913-no-such-scan-root-${Date.now()}`);
    expectRegistryError(
      () => enumerateStorageBackendImplementations(ghostRoot),
      'REGISTRY_ENUMERATION_UNREADABLE',
      ghostRoot,
    );
  });

  it('判别力自证（E3）：broken-backend 夹具 ⇒ 至少 1 条契约用例红，且精确弄红 delete/namespace', async () => {
    const results = await runBackendContract(createBrokenBackendFixture);
    const failures = results.filter((result) => !result.passed);
    const failingIds = failures.map((result) => result.id).sort();
    console.log(
      `DISCRIMINATION: ${BROKEN_BACKEND_FIXTURE_ID} ⇒ red ${failures.length}/${results.length}: ${failingIds.join(', ')}`,
    );

    expect(
      failures.length,
      '判别力丢失: broken-backend 竟然 0 条用例红（契约断言可能是空壳）',
    ).toBeGreaterThanOrEqual(1);
    expect(failingIds, 'broken-backend 应精确弄红 delete/namespace（证明具体断言有判别力）').toEqual(
      [...BROKEN_BACKEND_EXPECTED_VIOLATIONS].sort(),
    );
    for (const failure of failures) {
      expect(failure.detail, `失败必须点名用例 id（实际 detail 为空）: ${failure.id}`).toBeTruthy();
      expect(failure.detail ?? '', `失败详情必须带 [${failure.id}] 前缀`).toContain(`[${failure.id}]`);
    }
  });

  it('清单结构：known-divergences（schema_version/meta/恰 2 条/owner·expiry·ruling·evidence/路径存在）', () => {
    const ledger = loadKnownDivergences();
    expect(ledger.schema_version).toBe(1);
    expect(ledger.meta.as_of, 'meta.as_of 必须钉 gitea/local-main@<sha>').toMatch(
      /^gitea\/local-main@[0-9a-f]{9,40}$/,
    );
    expect(ledger.meta.ruling, 'meta.ruling 必须引裁 331').toContain('331');
    expect(ledger.meta.interface).toBe(CONFORMANCE_REGISTRY.interface.name);

    const ids = ledger.divergences.map((entry) => entry.id).sort();
    expect(ids, 'known-divergences 必须恰为 2 条：updatedAt-iso／keyPrefix-literal').toEqual([
      'keyPrefix-literal',
      'updatedAt-iso',
    ]);
    expect(new Set(ids).size, '登记行 id 不得重复').toBe(ids.length);
    const cases = ledger.divergences.map((entry) => entry.case);
    expect(new Set(cases).size, '登记行 case 不得重复（同一用例不得登记两次）').toBe(cases.length);

    const caseIds = new Set<string>(CONTRACT_CASE_IDS);
    const implementations = new Map(
      CONFORMANCE_REGISTRY.implementations.map((entry) => [entry.name, entry.file]),
    );
    for (const entry of ledger.divergences) {
      expect(entry.owner, `owner 缺失/非法: ${entry.id}`).toMatch(/^P\d{1,2}$/);
      expect(entry.expiry, `expiry 缺失/非法: ${entry.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.ruling, `ruling 缺失: ${entry.id}`).toContain('331');
      expect(entry.evidence.length, `evidence 过短: ${entry.id}`).toBeGreaterThan(10);
      expect(
        caseIds.has(entry.case),
        `登记指向不存在的契约用例: ${entry.id}→${entry.case}`,
      ).toBe(true);
      expect(
        implementations.has(entry.implementation),
        `登记了未登记实现: ${entry.implementation}`,
      ).toBe(true);
      const implFile = implementations.get(entry.implementation) ?? '';
      expect(existsSync(path.resolve(REPO_ROOT, implFile)), `实现文件不存在: ${implFile}`).toBe(true);
      expect(entry.evidence, `evidence 未点名实现文件: ${entry.id}`).toContain(implFile);
    }
  });

  it('清单结构：known-red（schema_version/meta/恰 2 条/reason·owner·expiry·ruling/测试路径存在）', () => {
    const ledger = loadKnownRed();
    expect(ledger.schema_version).toBe(1);
    expect(ledger.meta.as_of, 'meta.as_of 必须钉 gitea/local-main@<sha>').toMatch(
      /^gitea\/local-main@[0-9a-f]{9,40}$/,
    );
    expect(ledger.meta.ruling, 'meta.ruling 必须引裁 331').toContain('331');
    expect(ledger.meta.policy, 'known-red 必须写明只减不增').toContain('只减不增');

    const tests = ledger.entries.map((entry) => entry.test).sort();
    expect(tests, 'known-red 必须恰为 2 条既有红').toEqual([
      'tests/golden-scenarios/gss-common.test.ts',
      'tests/l3/graphbridge-wiring.test.ts',
    ]);
    for (const entry of ledger.entries) {
      expect(entry.reason.length, `reason 过短: ${entry.test}`).toBeGreaterThan(10);
      expect(entry.owner, `owner 缺失/非法: ${entry.test}`).toMatch(/^P\d{1,2}$/);
      expect(entry.expiry, `expiry 缺失/非法: ${entry.test}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.ruling, `ruling 缺失: ${entry.test}`).toContain('331');
      const abs = path.resolve(REPO_ROOT, entry.test);
      expect(existsSync(abs), `known-red 测试路径不存在: ${entry.test}`).toBe(true);
      expect(statSync(abs).isFile(), `known-red 路径不是文件: ${entry.test}`).toBe(true);
    }
  });

  it('三态：清单缺失/解析失败/schema 非法 ⇒ 失败信息含 degraded: 前缀并点名（不静默 pass）', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), '913-ledger-bad-'));
    try {
      const missing = path.join(dir, 'missing.yaml');
      const missingError = expectRegistryError(
        () => loadKnownDivergences(missing),
        'REGISTRY_LEDGER_MISSING',
        'known-divergences.yaml',
      );
      expect(missingError.message).toContain('missing.yaml');

      const brokenYaml = path.join(dir, 'broken.yaml');
      writeFileSync(brokenYaml, 'schema_version: 1\ndivergences: [\n', 'utf8');
      expectRegistryError(
        () => loadKnownDivergences(brokenYaml),
        'REGISTRY_LEDGER_PARSE_FAILED',
        'broken.yaml',
      );

      const wrongSchema = path.join(dir, 'wrong-schema.yaml');
      writeFileSync(wrongSchema, 'schema_version: 2\nmeta: {}\ndivergences: []\n', 'utf8');
      expectRegistryError(
        () => loadKnownDivergences(wrongSchema),
        'REGISTRY_LEDGER_SCHEMA_INVALID',
        'schema_version',
      );

      const missingField = path.join(dir, 'missing-field.yaml');
      writeFileSync(
        missingField,
        'schema_version: 1\nmeta:\n  as_of: x\n  ruling: "裁331"\n  interface: StorageBackend\n' +
          'divergences:\n  - id: updatedAt-iso\n    implementation: SqliteStorageBackend\n',
        'utf8',
      );
      expectRegistryError(
        () => loadKnownDivergences(missingField),
        'REGISTRY_LEDGER_SCHEMA_INVALID',
        'divergences[0].owner',
      );

      expectRegistryError(
        () => loadKnownRed(path.join(dir, 'no-known-red.yaml')),
        'REGISTRY_LEDGER_MISSING',
        'known-red.yaml',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('expiry 两态：不存在的日期 ⇒ SCHEMA_INVALID；已过期 ⇒ LEDGER_EXPIRED（"到期"不再形同虚设）', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), '913-expiry-'));
    try {
      const mk = (name: string, expiry: string): string => {
        const file = path.join(dir, name);
        writeFileSync(
          file,
          'schema_version: 1\n' +
            'meta:\n  as_of: gitea/local-main@138b8f2dc\n  ruling: "裁331"\n  interface: StorageBackend\n' +
            'divergences:\n  - id: updatedAt-iso\n    implementation: SqliteStorageBackend\n' +
            '    owner: P2\n' +
            `    expiry: "${expiry}"\n` +
            '    ruling: "裁331"\n    evidence: "probe evidence text"\n',
          'utf8',
        );
        return file;
      };
      // ① 日历非法（形状对但日期不存在）
      expectRegistryError(
        () => loadKnownDivergences(mk('bad-date.yaml', '2026-13-99')),
        'REGISTRY_LEDGER_SCHEMA_INVALID',
        'expiry',
      );
      expectRegistryError(
        () => loadKnownDivergences(mk('bad-date2.yaml', '2026-02-30')),
        'REGISTRY_LEDGER_SCHEMA_INVALID',
        'expiry',
      );
      // ② 已过期 ⇒ 到期即红（只减不增的可执行面）
      const expired = expectRegistryError(
        () => loadKnownDivergences(mk('expired.yaml', '2020-01-01')),
        'REGISTRY_LEDGER_EXPIRED',
        '2020-01-01',
      );
      expect(expired.message).toMatch(/^degraded: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('三态：夹具创建失败 ⇒ 全用例 degraded 标红（不静默 pass）', async () => {
    const results = await runBackendContract(() => {
      throw new Error('fixture boom');
    });
    expect(results, '夹具失败也必须返回完整用例表（便于计数）').toHaveLength(CONTRACT_CASE_IDS.length);
    expect(results.every((result) => !result.passed)).toBe(true);
    for (const result of results) {
      expect(result.code).toBe('CONFORMANCE_FIXTURE_CREATE_FAILED');
      expect(result.detail ?? '', '夹具级失败必须以 degraded: 开头').toMatch(/^degraded: /);
    }
  });
});
