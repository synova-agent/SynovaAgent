#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-content-reload.ts — K12-15（#198 · 登记件 `1-10`）reload 探针
 *
 * 用途: 把「**改了内容不用重启**」变成一条能跑的命令 —— 运行中新增内容目录，
 *   reload 能不能**在同一个进程里**发现它，坏内容会不会**被拒但把服务打挂**。
 *
 * 判据来源（卡面 = 唯一判据源）:
 *   `.claude/task-briefs/2026-10-11-198-K12-15-reload-重扫-extensions.md`
 *   🔴 **期望值派生自 K12-15 Q3 V2/V3/V6；该卡未给探针判据**
 *      （该卡 §判据源 的 V1 是 `npx vitest run tests/deploy/content-reload.test.ts`，
 *        **卡面没有给探针判据** ⇒ 本文件按创始人 2026-10-11 批准的形态，
 *        从该卡 §Q3 的**可判项**逐条派生期望值，**不新增判据、不超出该卡 Q3 表述范围**）:
 *   · §Q3 V2 **生效**: 运行中新增目录 ⇒ 触发 reload ⇒ **无需重启**被发现   ⇒ 场景 `reload-new-dir`
 *   · §Q3 V3 **失败隔离**: 非法 manifest ⇒ 拒新绑定 ＋ 留清单 ＋ **不阻断** ⇒ 场景 `bad-manifest`
 *   · §Q3 V6 反例: reload **不清旧绑定** ⇒ V2 必红（重复注册）              ⇒ 场景 `no-clean`
 *   （该卡 §Q1 的"早激活 / 标识持久化"**不在**本次派生范围 —— 卡面没有对应的 Q3 可判项）
 *
 * 契约（铁律 47；统一探针契约的单一实现在 ./probe-ladder.ts）:
 *   @input    — `--case <场景>`｜`--all`
 *               场景 = `reload-new-dir`｜`bad-manifest`｜`no-clean`
 *   @output   — stdout 逐条 `✅/❌/⚠️` ＋ 末行由 `out.finish()` 签发 `RESULT=<verdict>`
 *   @degraded — 目标件缺失（`src/deploy/content-reload.ts`）⇒ **exit 2**（fail-closed，铁律 31）
 * 退出码: 0 = 断言全部成立｜1 = 目标件在但断言不成立｜2 = 目标件不存在 / 探针无法判定
 *
 * 断言级别（禁把静态命中当唯一断言，判例 V-02）:
 *   [L1-静态可达] 目标件存在
 *   [L2-真跑通]   动态 import `src/deploy/content-reload.ts` 并**真调用**，两次调用之间真加目录，
 *                 拿**真实返回**判定"新内容是否被发现 / 坏内容是否被拒且未阻断 / 旧绑定是否被清"
 *
 * 驱动的声明约定（非判据本身，仅为"够到"判据的驱动形状; 见文件末边界②）:
 *   · 入口发现: 优先匹配 `/^(reload|rescan|refresh)/i` 的导出；无匹配则退化为全部具参导出
 *   · 调用形状: ① `(扫描根)` ② `({root})` ③ `({roots:[根]})` ④ `({dir:根})` ⑤ `()`（自扫，仅幂等性用）
 *   · 夹具布局: `<扫描根>/<内容项 id>/manifest.json`（卡面 §Q1「加＝建目录＋manifest＋内容」）
 *   · 观测面: 递归扫返回对象里**数组型**字段，按键名分桶 ——
 *             绑定桶 `/^(bound|boundIds|loaded|registered|active|items|accepted|绑定|生效)/i`
 *             拒绝桶 `/^(rejected|errors|failed|invalid|degraded|skipped|problems|拒绝|清单|失败)/i`
 *   · 任一次调用都**未能**观测到任何绑定桶（形状不可观测）⇒ 报「无法判定」＋ exit 2，**不谎报 PASS/FAIL**
 *
 * 边界（如实标注，不夸大）:
 *   ① 本探针**不在** `extensions/**` 里建临时内容（红线: 不改 `extensions/**`）——
 *      只在 `os.tmpdir()` 建夹具并经**注入扫描根**驱动。若实现不支持注入扫描根
 *      （只能自扫仓库根）⇒ 本探针报「无法判定」exit 2，**不谎报绿色**。
 *   ② 夹具 manifest 用 `type=probe-fixture`。若实现按注册表校验 type 而拒收未知 type
 *      ⇒ 同样走「无法判定」exit 2（诚实失败，不产生假绿）。
 *   ③ "无需重启"的探针形态 = **同一个进程内**两次调用之间新增内容目录，第二次即被发现
 *      （进程未重启、模块未重新 import）。这是该判据在单进程探针里能做到的最强形态。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ProbeOutput,
  assertTargetsExist,
  locateRepoRoot,
  parseProbeArgs,
  ProbeError,
  type ProbeModule,
} from './probe-ladder';

// ══════════════════════════════════════════════════════════════════════════════
// 一、常量
// ══════════════════════════════════════════════════════════════════════════════

/** 目标件（卡面 §Q2 写集: `src/deploy/content-reload.ts` 新建） */
const RELOAD_MODULE_REL = 'src/deploy/content-reload.ts';
/** 夹具 manifest 的 type（声明式夹具，见边界②） */
const FIXTURE_TYPE = 'probe-fixture';

/**
 * 本探针判据所依赖的目标件（仓库相对路径）——供 ladder 的不变式「报 PASS ⇒ TARGETS 非空且全部存在」机械校验。
 *
 * 取值 = **K12-15 的真交付面**（卡面 §Q2 写集: `src/deploy/content-reload.ts` 新建）。
 * 🔴 它**当前尚不存在**是**故意的**：不变式只在探针报 `RESULT=PASS` 时触发
 *   （ladder `checkTargetsInvariant` 首行 `if (verdict !== 'PASS') return null`），
 *   故声明 MISSING 件**不会**让本探针变红；而 K12-15 一旦落地，只有它**真存在**才可能报绿
 *   ⇒ 假绿被物理挡住。反过来说，若换成"现存旁证件"（如 boot 装配入口），不变式将**永不咬**
 *   （复核者实测的漏网形态）。
 *
 * ⚠️ 本表被 ladder 以**源文本正则**解析（`/'([^']+)'|"([^"]+)"/g`）⇒ 必须是**字面量引号数组**，
 *   不得写成模板串 / `.map()` / 变量拼接（那会被解析成空表 ⇒ 一旦报绿即判"TARGETS 空表"）。
 */
export const TARGETS: readonly string[] = ['src/deploy/content-reload.ts'];

export const KNOWN_CASES: readonly string[] = ['reload-new-dir', 'bad-manifest', 'no-clean'];

// ══════════════════════════════════════════════════════════════════════════════
// 二、小工具
// ══════════════════════════════════════════════════════════════════════════════

/** `unknown` 收窄为记录（铁律 38 替代式：内联类型 ＋ 类型守卫） */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function toProbeError(err: unknown, code: string, phase: string, retryable = false): ProbeError {
  if (err instanceof ProbeError) return err;
  return new ProbeError(code, phase, err instanceof Error ? err.message : String(err), retryable);
}

function observe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (err: unknown) {
    return `[unserializable: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

async function importModule(abs: string, phase: string): Promise<Record<string, unknown>> {
  let mod: unknown;
  try {
    mod = await import(abs);
  } catch (err: unknown) {
    throw toProbeError(err, 'IMPORT_FAILED', phase, true);
  }
  const rec = asRecord(mod);
  if (rec === undefined) {
    throw new ProbeError('IMPORT_SHAPE_DRIFT', phase, `动态 import 未返回模块对象: ${abs}`);
  }
  return rec;
}

// ══════════════════════════════════════════════════════════════════════════════
// 三、夹具（os.tmpdir() 内；不碰仓库 extensions/**）
// ══════════════════════════════════════════════════════════════════════════════

interface Fixture {
  readonly root: string;
  addItem(id: string, manifestBody: string): void;
}

function createFixture(): Fixture {
  let root: string;
  try {
    root = mkdtempSync(join(tmpdir(), 'probe-content-reload-'));
  } catch (err: unknown) {
    throw toProbeError(err, 'FIXTURE_MKDIR_FAILED', 'fixture', true);
  }
  return {
    root,
    addItem(id: string, manifestBody: string): void {
      const dir = join(root, id);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'manifest.json'), manifestBody, 'utf8');
      } catch (err: unknown) {
        throw toProbeError(err, 'FIXTURE_WRITE_FAILED', `fixture:${id}`, true);
      }
    },
  };
}

function disposeFixture(fixture: Fixture): void {
  try {
    rmSync(fixture.root, { recursive: true, force: true });
  } catch (err: unknown) {
    // 清理失败必须可见（铁律 24 不空吞），但不改判定：夹具在 os.tmpdir()，非仓库内
    console.error(
      `[warn] 夹具清理失败（${fixture.root}）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function fixtureManifest(id: string): string {
  return JSON.stringify({ type: FIXTURE_TYPE, name: id, version: '1.0.0' }, null, 2);
}

/** 非法 manifest（卡面 §Q3 V3「非法 manifest」）：JSON 语法坏 */
const BAD_MANIFEST_BODY = '{ "type": "probe-fixture", "name": "broken",  <-- 故意坏的 JSON';

// ══════════════════════════════════════════════════════════════════════════════
// 四、观测面（从真实返回里结构化取"绑定桶 / 拒绝桶"）
// ══════════════════════════════════════════════════════════════════════════════

interface Buckets {
  /** 去重后的绑定 id（判"是否被绑定"） */
  readonly bound: readonly string[];
  /** **未去重**的绑定 id（判"是否重复注册" —— 去重会把 V6 反例的信号抹掉） */
  readonly boundRaw: readonly string[];
  readonly rejected: readonly string[];
}

const BOUND_KEY_RE = /^(bound|boundIds|loaded|registered|active|items|accepted|绑定|生效)/i;
const REJECTED_KEY_RE = /^(rejected|errors|failed|invalid|degraded|skipped|problems|拒绝|清单|失败)/i;

/** 数组元素 → 可读 id（字符串 / `{id}` / `{name}` / `{dir}`） */
function elementId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  for (const key of ['id', 'name', 'dir', 'path', 'itemId']) {
    const v = rec[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function collectBuckets(node: unknown, acc: { bound: string[]; rejected: string[] }, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(node)) {
    for (const item of node) collectBuckets(item, acc, depth + 1);
    return;
  }
  const rec = asRecord(node);
  if (rec === undefined) return;
  for (const [key, value] of Object.entries(rec)) {
    if (Array.isArray(value)) {
      const ids = value.map(elementId).filter((s): s is string => s !== undefined);
      if (BOUND_KEY_RE.test(key)) acc.bound.push(...ids);
      else if (REJECTED_KEY_RE.test(key)) acc.rejected.push(...ids);
    }
    collectBuckets(value, acc, depth + 1);
  }
}

/** 有序去重（重复注册的判定需要"是否出现重复" ⇒ 这里保留重复信息在 raw 里） */
function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

// ══════════════════════════════════════════════════════════════════════════════
// 五、驱动（L2 的唯一来源）
// ══════════════════════════════════════════════════════════════════════════════

interface ReloadCall {
  readonly entry: string;
  readonly shape: string;
  readonly threw: boolean;
  readonly text: string;
  readonly buckets: Buckets;
  /** 调用成功（未抛）且观测到绑定桶 */
  readonly observable: boolean;
}

type Callable = { readonly name: string; readonly fn: (...args: unknown[]) => unknown };

function pickEntries(mod: Record<string, unknown>): Callable[] {
  const all: Callable[] = Object.entries(mod)
    .filter(([, value]) => typeof value === 'function')
    .map(([name, value]) => ({ name, fn: value as (...a: unknown[]) => unknown }));
  const named = all.filter((e) => /^(reload|rescan|refresh)/i.test(e.name));
  return named.length > 0 ? named : all.filter((e) => e.fn.length >= 1);
}

/** 入口是否 async 无关紧要 —— 统一 await（同步返回值 await 非 Promise 亦安全） */
async function callEntry(fn: (...args: unknown[]) => unknown, args: unknown[]): Promise<unknown> {
  return await Promise.resolve(fn(...args));
}

/**
 * 驱动 reload 一次 —— 拿真实返回/真实抛出判定。
 *
 * @input  reloadAbs（模块绝对路径）＋ scanRoot（注入的扫描根）
 * @output 每次调用一条 ReloadCall；**可观测**（未抛 ＋ 有绑定桶）的调用才参与判定
 * @degrade 模块缺失 / 入口不可调用 ⇒ 抛 ProbeError（⇒ 探针「无法判定」exit 2）
 */
async function driveReload(
  reloadAbs: string,
  scanRoot: string,
  phase: string,
): Promise<ReloadCall[]> {
  if (!existsSync(reloadAbs)) {
    throw new ProbeError('RELOAD_MODULE_MISSING', phase, `目标件不存在: ${RELOAD_MODULE_REL}`);
  }
  const mod = await importModule(reloadAbs, phase);
  const entries = pickEntries(mod);
  if (entries.length === 0) {
    throw new ProbeError('RELOAD_NO_CALLABLE', phase, `${RELOAD_MODULE_REL} 未导出任何可调用面`);
  }

  const shapes: readonly { readonly label: string; readonly args: () => unknown[] }[] = [
    { label: '(扫描根)', args: () => [scanRoot] },
    { label: '({root})', args: () => [{ root: scanRoot }] },
    { label: '({roots:[根]})', args: () => [{ roots: [scanRoot] }] },
    { label: '({dir:根})', args: () => [{ dir: scanRoot }] },
  ];

  const calls: ReloadCall[] = [];
  for (const entry of entries) {
    for (const shape of shapes) {
      let threw = false;
      let text = '';
      const acc = { bound: [] as string[], rejected: [] as string[] };
      try {
        const out = await callEntry(entry.fn, shape.args());
        text = observe(out);
        collectBuckets(out, acc);
      } catch (err: unknown) {
        threw = true;
        text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
      calls.push({
        entry: entry.name,
        shape: shape.label,
        threw,
        text,
        buckets: {
          bound: uniq(acc.bound),
          boundRaw: [...acc.bound],
          rejected: uniq(acc.rejected),
        },
        observable: !threw && acc.bound.length > 0,
      });
    }
  }
  return calls;
}

/** 从一组调用里选"最强可观测量"（绑定桶最大者） */
function bestObservable(calls: readonly ReloadCall[]): ReloadCall | undefined {
  const usable = calls.filter((c) => c.observable);
  if (usable.length === 0) return undefined;
  return usable.reduce((a, b) => (b.buckets.bound.length > a.buckets.bound.length ? b : a));
}

function reportNoObservation(out: ProbeOutput, label: string, calls: readonly ReloadCall[]): void {
  const thrown = calls.filter((c) => c.threw).length;
  out.notImplemented(
    `${label}: 全部 ${calls.length} 次调用均未观测到绑定桶` +
      `（抛出 ${thrown} 次；入口=${[...new Set(calls.map((c) => c.entry))].join(', ')}）` +
      ` ⇒ 无法判定（形状不可观测 / 不支持注入扫描根），不谎报 PASS`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// 六、场景
// ══════════════════════════════════════════════════════════════════════════════

async function runReloadNewDirCase(reloadAbs: string, out: ProbeOutput): Promise<void> {
  out.case('reload-new-dir');
  const fixture = createFixture();
  try {
    fixture.addItem('alpha', fixtureManifest('alpha'));
    const first = await driveReload(reloadAbs, fixture.root, 'reload-new-dir#1');
    const obs1 = bestObservable(first);
    if (obs1 === undefined) {
      reportNoObservation(out, 'reload-new-dir#1', first);
      return;
    }
    out.note(`观测面 = ${obs1.entry}${obs1.shape}｜bound=${obs1.buckets.bound.join(', ') || '(空)'}`);
    if (obs1.buckets.bound.includes('alpha')) {
      out.pass('V2 首次装配即发现夹具内容项 alpha（基线成立）', 'L2');
    } else {
      out.fail(`V2 首次装配**未**发现夹具内容项 alpha ⇒ 基线不成立（bound=${obs1.buckets.bound.join(',')}）`, 'L2');
      return;
    }

    // 同一进程内新增目录 ⇒ 再 reload（进程未重启、模块未重新 import）
    fixture.addItem('beta', fixtureManifest('beta'));
    const second = await driveReload(reloadAbs, fixture.root, 'reload-new-dir#2');
    const obs2 = bestObservable(second);
    if (obs2 === undefined) {
      reportNoObservation(out, 'reload-new-dir#2', second);
      return;
    }
    out.note(`观测面 = ${obs2.entry}${obs2.shape}｜bound=${obs2.buckets.bound.join(', ') || '(空)'}`);
    if (obs2.buckets.bound.includes('beta')) {
      out.pass('V2 运行中新增目录 beta ⇒ 同一进程内 reload 即被发现（无需重启）', 'L2');
    } else {
      out.fail(`V2 新增目录 beta **未被发现** ⇒ 仍需重启（bound=${obs2.buckets.bound.join(',')}）`, 'L2');
    }
    if (obs1.buckets.bound.includes('alpha') && obs2.buckets.bound.includes('alpha')) {
      out.pass('V2 旧内容项 alpha 在 reload 后仍绑定（未被打散）', 'L2');
    } else {
      out.fail('V2 旧内容项 alpha 在 reload 后消失 ⇒ 重扫把已有绑定打散', 'L2');
    }
  } finally {
    disposeFixture(fixture);
  }
}

async function runBadManifestCase(reloadAbs: string, out: ProbeOutput): Promise<void> {
  out.case('bad-manifest');
  const fixture = createFixture();
  try {
    fixture.addItem('alpha', fixtureManifest('alpha'));
    fixture.addItem('broken', BAD_MANIFEST_BODY);
    const calls = await driveReload(reloadAbs, fixture.root, 'bad-manifest');
    const obs = bestObservable(calls);
    if (obs === undefined) {
      reportNoObservation(out, 'bad-manifest', calls);
      return;
    }
    out.note(
      `观测面 = ${obs.entry}${obs.shape}｜bound=${obs.buckets.bound.join(', ') || '(空)'}｜rejected=${
        obs.buckets.rejected.join(', ') || '(空)'
      }`,
    );

    if (obs.buckets.bound.includes('broken')) {
      out.fail('V3 非法 manifest 的内容项**被绑定了** ⇒ 失败隔离失效', 'L2');
    } else {
      out.pass('V3 非法 manifest ⇒ 拒新绑定（broken 不在绑定桶）', 'L2');
    }
    if (obs.buckets.bound.includes('alpha')) {
      out.pass('V3 拒新绑定的同时**不阻断**：合法内容项 alpha 仍被绑定', 'L2');
    } else {
      out.fail('V3 坏内容把合法内容项也带崩（alpha 未绑定）⇒ 违反"不阻断"', 'L2');
    }
    const listed =
      obs.buckets.rejected.includes('broken') || obs.text.includes('broken');
    if (listed) {
      out.pass('V3 坏内容项**留清单**（出现在拒绝/降级桶或返回文本里）', 'L2');
    } else {
      out.fail('V3 坏内容项**未留清单**（既不绑定也不记录 ⇒ 静默丢失，铁律 24/31）', 'L2');
    }
  } finally {
    disposeFixture(fixture);
  }
}

async function runNoCleanCase(reloadAbs: string, out: ProbeOutput): Promise<void> {
  out.case('no-clean');
  const fixture = createFixture();
  try {
    fixture.addItem('alpha', fixtureManifest('alpha'));
    fixture.addItem('beta', fixtureManifest('beta'));

    const calls = await driveReload(reloadAbs, fixture.root, 'no-clean#1');
    const obs1 = bestObservable(calls);
    if (obs1 === undefined) {
      reportNoObservation(out, 'no-clean#1', calls);
      return;
    }
    // 对同一状态重复调用（V6 反例的探测: 不清旧绑定 ⇒ 第二次重复注册）
    const again = await driveReload(reloadAbs, fixture.root, 'no-clean#2');
    const obs2 = bestObservable(again);
    if (obs2 === undefined) {
      reportNoObservation(out, 'no-clean#2', again);
      return;
    }

    out.note(
      `观测面 = ${obs2.entry}${obs2.shape}｜调用①bound=${obs1.buckets.boundRaw.length} 项` +
        `（${obs1.buckets.boundRaw.join(', ')}）｜调用②bound=${obs2.buckets.boundRaw.length} 项（${obs2.buckets.boundRaw.join(', ')}）`,
    );

    // V6 反例的探测: 「不清旧绑定」⇒ 第二次出现**重复注册**（去重前计数 > 去重后 或 跨调用增长）
    const dup1 = obs1.buckets.boundRaw.length - obs1.buckets.bound.length;
    const dup2 = obs2.buckets.boundRaw.length - obs2.buckets.bound.length;
    const grew = obs2.buckets.boundRaw.length !== obs1.buckets.boundRaw.length;

    if (dup1 === 0 && dup2 === 0 && !grew) {
      out.pass(
        `V6 重复 reload 不产生重复注册（调用①/② 绑定数均为 ${obs2.buckets.boundRaw.length}，id 唯一）⇒ 旧绑定被正确清理`,
        'L2',
      );
    } else {
      out.fail(
        `V6 reload **未清旧绑定** ⇒ 重复注册（①${obs1.buckets.boundRaw.length} 项/重复 ${dup1} → ` +
          `②${obs2.buckets.boundRaw.length} 项/重复 ${dup2}）—— 卡面 §Q3 V6 反例必须红`,
        'L2',
      );
    }
  } finally {
    disposeFixture(fixture);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 七、CLI
// ══════════════════════════════════════════════════════════════════════════════

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<0 | 1 | 2> {
  const out = new ProbeOutput('probe-content-reload（K12-15 / #198 · 期望值派生）');

  let root: string;
  try {
    root = locateRepoRoot();
  } catch (err: unknown) {
    const e = toProbeError(err, 'REPO_ROOT_NOT_FOUND', 'bootstrap');
    out.error(`无法定位仓库根: ${e.message}`);
    out.finish();
    return 2;
  }
  out.note(`PROBE=probe-content-reload card=K12-15(#198) repoRoot=${root}`);
  out.note('期望值派生自 K12-15 Q3 V2/V3/V6；该卡未给探针判据');

  let cases: readonly string[];
  try {
    cases = parseProbeArgs(KNOWN_CASES, argv).cases;
  } catch (err: unknown) {
    const e = toProbeError(err, 'ARGS_INVALID', 'args');
    out.error(`参数不可识别: ${e.message}`);
    out.finish();
    return 2;
  }

  if (!assertTargetsExist(root, out, [RELOAD_MODULE_REL])) {
    out.finish();
    return 2;
  }
  const reloadAbs = join(root, RELOAD_MODULE_REL);

  for (const name of cases) {
    try {
      if (name === 'reload-new-dir') await runReloadNewDirCase(reloadAbs, out);
      else if (name === 'bad-manifest') await runBadManifestCase(reloadAbs, out);
      else if (name === 'no-clean') await runNoCleanCase(reloadAbs, out);
      else out.error(`场景未实现: ${name}`);
    } catch (err: unknown) {
      const e = toProbeError(err, 'CASE_FAILED', `case:${name}`, true);
      out.error(`场景 ${name} 执行失败 [${e.code}/${e.phase}/retryable=${String(e.retryable)}]: ${e.message}`);
    }
  }

  out.finish();
  return out.exitCode();
}

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）。
// `ProbeModule` 标注 = 编译期契约自检: 签名漂移会当场 tsc 报错。
if (process.argv[1] && /probe-content-reload\.ts$/.test(process.argv[1])) {
  const self: ProbeModule = { KNOWN_CASES, main };
  self.main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(
        `probe-content-reload 未捕获异常: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    },
  );
}
