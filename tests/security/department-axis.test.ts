/**
 * tests/security/department-axis.test.ts — K12-10 (#193 / RB-02) 部门轴判据测试
 *
 * 被测件: `src/services/request-context.ts`（判据探针 `probe-department-axis.ts` 的唯一候选路径）
 *
 * 覆盖（铁律 48: 正常路径 + 降级路径 + 边界条件，每例带真 expect 断言）:
 *   ① 正常 —— 复数（一人属 2 部门）⇒ **并集**生效；单数兼容入参归一到复数；多部门 profile 齐全
 *   ② 正常（**单一入口 核心**）—— 除 `resolveContext` 外，本模块其余导出对**被投递的原始身份**
 *      的部门字段读取 **0 次**（getter 仪表化实测，非 grep）
 *   ③ 正常（**文件驱动**）—— 改/加部门定义文件 ⇒ 生效；`src/` 一字未动也生效（真读文件、无缓存）
 *   ④ 降级 —— 真源缺失 / 目录不可读 / 文件解析失败 / id 与文件名不一致 ⇒ `degraded:true` + 原因入数组
 *   ⑤ 边界 —— 空身份 / 未知 id / 重复 id / 无部门 ⇒ **空集合**（不得退化为"默认给全量"）
 *   ⑥ 接线（生产触发点）—— registry 声明的 loader 面**真解析得到**且调用返回契约形状
 *
 * 🔴 反例（改坏即红，已实测）:
 *   · 把 `departments` 改成"按请求 id 覆盖"（末位胜）⇒ ① 的并集断言必红
 *   · 把空身份的 `departments` 改成"全量部门"⇒ ⑤ 必红
 *   · 让另一个导出（如 `getCurrentDepartmentIds`）自行读原始身份的部门字段 ⇒ ② 必红
 *   · 把 `resolveContext` 的入参改用 `departmentIds` 以外的字段而不读身份 ⇒ ② 的"入口真消费"断言必红
 *
 * 判据源: 卡面 `.claude/task-briefs/2026-10-11-193-*.md` §Q3（V1-V5）；判例 V-02（grep 型不得作验收依据）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import * as requestContext from '../../src/services/request-context';
import { getCurrentDepartmentIds, resolveContext, runWithContext } from '../../src/services/request-context';
import { describeContentRegistry } from '../../src/deploy/content-registry';

/** 部门定义真源目录（仓内相对路径 —— 判据探针同口径） */
const DEPARTMENTS_DIR_REL = join('extensions', 'departments');

/** 不存在的部门 id（探针 V5 同型） */
const ABSENT_DEPARTMENT = '__no_such_department__';

/** 仓内部门定义 id（口径与探针 `idsFromFile` 对齐：文件名去扩展名，`manifest.json` 不计） */
function departmentIdsOnDisk(): string[] {
  const dir = join(process.cwd(), DEPARTMENTS_DIR_REL);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ya?ml|json)$/i.test(e.name) && !/^manifest\.json$/i.test(e.name))
    .map((e) => e.name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

/**
 * 身份探针（tripwire）—— ② 的**行为**判定件。
 * 部门字段是**记数的 getter** ⇒ 谁读了原始身份，读数就长在谁身上。
 */
function makeIdentityTripwire(departmentIds: readonly string[]): {
  identity: Record<string, unknown>;
  reads: () => number;
} {
  let count = 0;
  const identity: Record<string, unknown> = {};
  for (const field of ['departmentIds', 'departmentId', 'departments']) {
    Object.defineProperty(identity, field, {
      enumerable: true,
      configurable: true,
      get(): unknown {
        count += 1;
        return field === 'departmentId' ? departmentIds[0] : [...departmentIds];
      },
    });
  }
  Object.defineProperty(identity, 'userId', { enumerable: true, value: 'test-user' });
  return { identity, reads: () => count };
}

/** 临时内容根（含 `extensions/departments/`）—— 文件驱动/降级路径用夹具，不污染真交付面 */
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'dept-axis-'));
  mkdirSync(join(tmpRoot, 'extensions', 'departments'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeDept(id: string, body: string): void {
  writeFileSync(join(tmpRoot, DEPARTMENTS_DIR_REL, `${id}.yaml`), body, 'utf8');
}

// ════════════════════════════════════════════════════════════════
// ① 正常路径：复数（并集，非覆盖）
// ════════════════════════════════════════════════════════════════

describe('K12-10 部门轴 — 正常路径（复数 / 并集）', () => {
  it('一人属 2 部门 ⇒ 两部门**都生效**（并集，非覆盖）', async () => {
    const ids = departmentIdsOnDisk();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const [a, b] = ids;

    const both = await resolveContext({ departmentIds: [a, b] });
    const onlyA = await resolveContext({ departmentIds: [a] });
    const onlyB = await resolveContext({ departmentIds: [b] });

    // 并集：两单部门可见面之和 ⊆ 多部门可见面（覆盖型实现必红）
    expect(new Set(both.departments)).toEqual(new Set([...onlyA.departments, ...onlyB.departments]));
    expect(both.departments).toContain(a);
    expect(both.departments).toContain(b);
    // 顺序稳定（按请求顺序去重）⇒ 可复跑
    expect(both.departments).toEqual([a, b]);
  });

  it('叶子字段逐字来自定义文件（数据面，非 src/ 硬编码）', async () => {
    const ids = departmentIdsOnDisk();
    const [a] = ids;
    const text = readFileSync(join(process.cwd(), DEPARTMENTS_DIR_REL, `${a}.yaml`), 'utf8');
    const displayName = /^displayName:\s*(.+)$/m.exec(text)?.[1]?.trim();

    const resolved = await resolveContext({ departmentIds: [a], userId: 'u-1' });
    expect(resolved.profiles).toHaveLength(1);
    expect(resolved.profiles[0].id).toBe(a);
    expect(resolved.profiles[0].displayName).toBe(displayName);
    expect(resolved.identityKey).toBe('u-1');
    expect(resolved.degraded).toBe(false);
    expect(resolved.degradedReasons).toEqual([]);
  });

  it('单数兼容入参与别名归一进复数集合（归一后不残留单数语义）', async () => {
    const ids = departmentIdsOnDisk();
    const [a, b] = ids;
    const singular = await resolveContext({ departmentId: a });
    const alias = await resolveContext({ departments: [a, b] });
    const plural = await resolveContext({ departmentIds: [a, b] });

    expect(singular.departments).toEqual([a]);
    expect(alias.departments).toEqual(plural.departments);
    // requestedDepartments 含未知 id 的对照面（`departments` 只含生效的）
    expect((await resolveContext({ departmentIds: [a, ABSENT_DEPARTMENT] })).requestedDepartments).toEqual([
      a,
      ABSENT_DEPARTMENT,
    ]);
  });
});

// ════════════════════════════════════════════════════════════════
// ② 正常路径（核心）：单一入口 —— 行为观测，不是 grep
// ════════════════════════════════════════════════════════════════

describe('K12-10 部门轴 — 单一入口（行为观测）', () => {
  it('除 resolveContext 外，其余导出对原始身份的部门字段读取 0 次', async () => {
    const others = Object.entries(requestContext)
      .filter(([name, value]) => name !== 'resolveContext' && typeof value === 'function')
      .filter(([name]) => !/^__/.test(name));

    let totalReads = 0;
    const offenders: string[] = [];
    for (const [name, fn] of others) {
      const probe = makeIdentityTripwire(['tripwire-a', 'tripwire-b']);
      try {
        await (fn as (arg: unknown) => unknown)(probe.identity);
      } catch {
        // 抛异常不影响读数（读计数在抛之前已入账）—— 本用例只判"有没有读"
      }
      if (probe.reads() > 0) {
        totalReads += probe.reads();
        offenders.push(name);
      }
    }

    expect(others.length).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
    expect(totalReads).toBe(0);
  });

  it('resolveContext **真消费**投递的身份对象（否则上面的 0 次是空谈）', async () => {
    const probe = makeIdentityTripwire(['tripwire-a']);
    const resolved = await resolveContext(probe.identity);
    expect(probe.reads()).toBeGreaterThanOrEqual(1);
    expect(resolved.requestedDepartments).toEqual(['tripwire-a']);
  });

  it('解析结果经 runWithContext 装进请求级存储 ⇒ getCurrentDepartmentIds 读回同一集合', async () => {
    const ids = departmentIdsOnDisk();
    const [a, b] = ids;
    const resolved = await resolveContext({ departmentIds: [a, b] });

    const inside = await runWithContext({ resolved }, async () => getCurrentDepartmentIds());
    expect(inside).toEqual(resolved.departments);

    // 无上下文 ⇒ 空（fail-closed：无身份 ⇒ 无部门，不是"全部门"）
    expect(getCurrentDepartmentIds()).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════
// ③ 正常路径（文件驱动）：改文件即生效，src/ 一字未动
// ════════════════════════════════════════════════════════════════

describe('K12-10 部门轴 — 文件驱动（加/改文件 ⇒ 生效）', () => {
  it('新增部门定义文件 ⇒ 立刻生效（真读文件，无进程级缓存）', async () => {
    expect((await resolveContext({ departmentIds: ['ops'], rootDir: tmpRoot })).departments).toEqual([]);

    writeDept('ops', 'id: ops\ndisplayName: 运营部\n');
    const after = await resolveContext({ departmentIds: ['ops'], rootDir: tmpRoot });

    expect(after.departments).toEqual(['ops']);
    expect(after.profiles[0].displayName).toBe('运营部');
    expect(after.degraded).toBe(false);
  });

  it('改同一份定义文件 ⇒ 下次解析即读到新值（同名覆盖，不需要改代码）', async () => {
    writeDept('ops', 'id: ops\ndisplayName: 运营部\n');
    const first = await resolveContext({ departmentIds: ['ops'], rootDir: tmpRoot });

    writeDept('ops', 'id: ops\ndisplayName: 增长运营部\ndescription: 改过\n');
    const second = await resolveContext({ departmentIds: ['ops'], rootDir: tmpRoot });

    expect(first.profiles[0].displayName).toBe('运营部');
    expect(second.profiles[0].displayName).toBe('增长运营部');
    expect(second.profiles[0].description).toBe('改过');
  });

  it('部门定义载体的源码面 = 0：解析逻辑不持部门清单（清空目录 ⇒ 部门全消失）', async () => {
    const ids = departmentIdsOnDisk();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const all = await resolveContext({ departmentIds: ids });
    expect(all.departments.length).toBe(ids.length);

    // 临时根下不建任何部门文件 ⇒ 一律解析不出（证明清单来自文件，不来自 src/）
    const empty = await resolveContext({ departmentIds: ids, rootDir: tmpRoot });
    expect(empty.departments).toEqual([]);
    expect(empty.profiles).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════
// ④ 降级路径（铁律 24/31：log + degraded:true + 错误进数组）
// ════════════════════════════════════════════════════════════════

describe('K12-10 部门轴 — 降级路径', () => {
  it('真源目录不存在 ⇒ degraded:true + DEPT_SOURCE_MISSING 进数组（不是静默空结果）', async () => {
    const absent = join(tmpRoot, 'no-such-root');
    const resolved = await resolveContext({ departmentIds: ['ops'], rootDir: absent });

    expect(resolved.degraded).toBe(true);
    expect(resolved.degradedReasons.length).toBeGreaterThanOrEqual(1);
    expect(resolved.degradedReasons.some((r) => r.startsWith('DEPT_SOURCE_MISSING'))).toBe(true);
    // 降级不等于抛错：能力面仍在（返回契约形状）
    expect(resolved.departments).toEqual([]);
  });

  it('定义文件 YAML 解析失败 ⇒ 跳过该文件 + degraded:true + 原因含文件路径', async () => {
    writeDept('good', 'id: good\ndisplayName: 好的\n');
    writeDept('broken', 'id: broken\n  : [unclosed\n');
    const resolved = await resolveContext({ departmentIds: ['good', 'broken'], rootDir: tmpRoot });

    expect(resolved.degraded).toBe(true);
    expect(resolved.degradedReasons.some((r) => r.includes('broken'))).toBe(true);
    // 坏文件只跳过它自己 —— 好文件仍生效（失败隔离）
    expect(resolved.departments).toEqual(['good']);
    expect(resolved.profiles[0].displayName).toBe('好的');
  });

  it('id 字段与文件名不一致 ⇒ 拒绝该定义（两个真值不许并存）+ degraded:true', async () => {
    writeDept('alpha', 'id: beta\ndisplayName: 自称 beta\n');
    const resolved = await resolveContext({ departmentIds: ['alpha', 'beta'], rootDir: tmpRoot });

    expect(resolved.degraded).toBe(true);
    expect(resolved.degradedReasons.some((r) => r.includes('不一致'))).toBe(true);
    expect(resolved.departments).toEqual([]);
  });

  it('定义文件非对象（如顶层数组）⇒ 显式降级，不静默当空定义', async () => {
    writeFileSync(join(tmpRoot, DEPARTMENTS_DIR_REL, 'weird.json'), JSON.stringify(['not', 'an', 'object']), 'utf8');
    const resolved = await resolveContext({ departmentIds: ['weird'], rootDir: tmpRoot });

    expect(resolved.degraded).toBe(true);
    expect(resolved.degradedReasons.some((r) => r.includes('非对象'))).toBe(true);
    expect(resolved.departments).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════
// ⑤ 边界条件
// ════════════════════════════════════════════════════════════════

describe('K12-10 部门轴 — 边界条件', () => {
  it('空身份（缺省/空对象/空数组）⇒ 空集合，**不退化为"默认给全量"**', async () => {
    const ids = departmentIdsOnDisk();
    expect(ids.length).toBeGreaterThanOrEqual(2);

    for (const input of [undefined, {}, { departmentIds: [] }, { departments: [] }] as const) {
      const resolved = input === undefined ? await resolveContext() : await resolveContext(input);
      expect(resolved.departments).toEqual([]);
      expect(resolved.profiles).toEqual([]);
      // 空身份是**预期路径**，不是故障 ⇒ 不记降级（否则差异回追会看到假差异）
      expect(resolved.degraded).toBe(false);
    }
  });

  it('未知部门 id ⇒ 跳过（预期回落）但不记降级；requested 保留事实', async () => {
    const resolved = await resolveContext({ departmentIds: [ABSENT_DEPARTMENT] });
    expect(resolved.departments).toEqual([]);
    expect(resolved.requestedDepartments).toEqual([ABSENT_DEPARTMENT]);
    expect(resolved.degraded).toBe(false);
    expect(resolved.degradedReasons).toEqual([]);
  });

  it('重复 id / 空白项 ⇒ 去重 + 丢空值（幂等）', async () => {
    const ids = departmentIdsOnDisk();
    const [a, b] = ids;
    const dup = await resolveContext({ departmentIds: [a, a, '  ', b, a] });
    expect(dup.departments).toEqual([a, b]);
    expect((await resolveContext({ departmentIds: [a, b] })).departments).toEqual(dup.departments);
  });

  it('可选字段缺失（如 parent）不阻断加载；未声明 ⇒ null', async () => {
    const ids = departmentIdsOnDisk();
    const withParent = ids.filter((id) => /^parent:\s*null\s*$/m.test(readFileSync(join(process.cwd(), DEPARTMENTS_DIR_REL, `${id}.yaml`), 'utf8')));
    const withoutParent = ids.filter((id) => !withParent.includes(id));
    expect(withoutParent.length).toBeGreaterThanOrEqual(1);

    const explicitNull = await resolveContext({ departmentIds: withParent.slice(0, 1) });
    const omitted = await resolveContext({ departmentIds: withoutParent.slice(0, 1) });
    expect(explicitNull.profiles[0].parent).toBeNull();
    expect(omitted.profiles[0].parent).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// ⑥ 接线（生产触发点）：registry 声明的 loader 面**真解析得到**
// ════════════════════════════════════════════════════════════════

describe('K12-10 部门轴 — 生产触发点（接线，非仅 import）', () => {
  it('registry 声明的 loader 面解析得到且调用返回契约形状（boot 装配面会真调它）', async () => {
    const snap = describeContentRegistry();
    const entry = snap.entries.find((e) => e.dir === 'departments');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('reachable');
    expect(entry?.loader?.init).toBe('resolveContext');
    expect(entry?.loader?.module).toBe('../services/request-context');

    // 按名解析：模块路径 + 导出名都要真存在（否则 boot 装配会硬失败）
    const rel = (entry?.loader?.module ?? '').replace('../', 'src/');
    expect(existsSync(join(process.cwd(), `${rel}.ts`))).toBe(true);
    const mod: Record<string, unknown> = (await import(pathToFileURL(join(process.cwd(), `${rel}.ts`)).href)) as Record<
      string,
      unknown
    >;
    const init = mod[entry?.loader?.init ?? ''];
    expect(typeof init).toBe('function');

    // 真调一次（用声明形态的 initArgs）⇒ 返回带 degraded/degradedReasons 的契约形状
    const out = await (init as (arg: unknown) => Promise<Record<string, unknown>>)({});
    expect(typeof out.degraded).toBe('boolean');
    expect(Array.isArray(out.degradedReasons)).toBe(true);
    expect(Array.isArray(out.departments)).toBe(true);
  });
});
