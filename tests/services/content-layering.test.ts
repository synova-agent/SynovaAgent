/**
 * tests/services/content-layering.test.ts — K12-20 (#203 / RB-06) 岗位内容分层判据测试
 *
 * 被测件: `src/services/content-layering.ts`（判据探针 probe-content-layering.ts 的唯一候选路径）
 *
 * 覆盖（铁律 48: 正常路径 + 降级路径 + 边界条件，每例带真 expect 断言）:
 *   ① 正常 —— 两个部门身份 ⇒ 解析结果不同；差异叶子**逐字**来自内容层文件（数据面，非硬编码）
 *   ② 正常 —— 企业层 → 部门层并集（prompt 覆盖 / tools·knowledge 并集）—— 「同一份企业状态，不是副本」
 *   ③ 正常 —— question 命中部门层 questionOverrides ⇒ 采用文件内覆盖值（question 是真参数，非装饰）
 *   ④ 降级 —— 未知部门 id ⇒ **逐字**回落企业层（不是返回空、不改判据）
 *   ⑤ 降级 —— 部门层文件解析失败 ⇒ 跳过该层 + degraded=true（铁律 24/31，不静默吞）
 *   ⑥ 边界 —— 空 departmentIds ⇒ 企业层基线非空
 *   ⑦ 边界 —— 内容层根目录缺失 ⇒ 不崩 + degraded=true
 *   ⑧ 边界 —— 多部门 / departments 别名形态（探针第二、三形态）
 *
 * 🔴 为什么用真实仓内 `extensions/content-layers/**`（而非全用夹具）:
 *   本卡判据是「内容层文件决定内容」（探针 V2/V3）—— 只有对**真交付的数据面**断言，
 *   才能证明"改部门层文件即生效"。夹具只用于**降级/边界**路径（需要构造损坏文件）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { resolveContent, type LayeredContent } from '../../src/services/content-layering';

/** 探针使用的"同一问题"（与 probe-content-layering.ts 对齐） */
const PROBE_QUESTION = '本次企业增长的头号瓶颈是什么？';

/** 无对应文件的部门 id（探针 V5 同型） */
const ABSENT_DEPARTMENT = '__probe_no_such_department__';

const LAYER_ROOT_REL = 'extensions/content-layers';

function layerRoot(): string {
  return join(process.cwd(), LAYER_ROOT_REL);
}

/** 部门层目录下的部门 id（口径与探针 readLayerCarrier 对齐：文件名去扩展名） */
function departmentIdsOnDisk(): string[] {
  const dir = join(layerRoot(), 'departments');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ya?ml|json)$/i.test(e.name))
    .map((e) => e.name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

/** 内容层载体文件文本（企业层 + 全部部门层）——V3「逐字回追」的判据面 */
function layerFileTexts(): string[] {
  const texts: string[] = [];
  for (const candidate of ['enterprise.yaml', 'enterprise.yml', 'enterprise.json', 'base.yaml']) {
    const abs = join(layerRoot(), candidate);
    if (existsSync(abs)) texts.push(readFileSync(abs, 'utf8'));
  }
  const dir = join(layerRoot(), 'departments');
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (/\.(ya?ml|json)$/i.test(entry)) texts.push(readFileSync(join(dir, entry), 'utf8'));
    }
  }
  return texts;
}

/** 深度收集字符串叶子（口径与探针 collectStringLeaves 对齐） */
function collectStringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim().length > 0) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, out);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value).sort()) {
      collectStringLeaves((value as Record<string, unknown>)[key], out);
    }
  }
  return out;
}

function uniqueLeaves(content: LayeredContent): string[] {
  const out: string[] = [];
  for (const v of collectStringLeaves(content)) if (!out.includes(v)) out.push(v);
  return out;
}

let tmpRoots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'content-layering-'));
  tmpRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return root;
}

beforeEach(() => {
  tmpRoots = [];
});

afterEach(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
  tmpRoots = [];
});

describe('K12-20 content-layering — 正常路径', () => {
  it('两个部门身份 ⇒ 解析结果不同，且差异叶子逐字来自内容层文件（数据面）', () => {
    const ids = departmentIdsOnDisk();
    expect(ids.length).toBeGreaterThanOrEqual(2);

    const a = resolveContent({ departmentIds: [ids[0]], question: PROBE_QUESTION });
    const b = resolveContent({ departmentIds: [ids[1]], question: PROBE_QUESTION });

    expect(a.degraded).toBe(false);
    expect(b.degraded).toBe(false);

    const leavesA = uniqueLeaves(a);
    const leavesB = uniqueLeaves(b);
    const onlyA = leavesA.filter((v) => !leavesB.includes(v));
    const onlyB = leavesB.filter((v) => !leavesA.includes(v));

    // V2 同型：同一问题、两个身份 ⇒ 内容必须不同
    expect(onlyA.length + onlyB.length).toBeGreaterThan(0);

    // V3 同型：差异叶子必须能在内容层文件文本里逐字找到（硬编码型实现必红）
    const texts = layerFileTexts();
    const knownIds = ids;
    for (const value of [...onlyA, ...onlyB]) {
      const traceable = knownIds.includes(value) || texts.some((t) => t.includes(value));
      expect(traceable, `差异叶子未回追到内容层文件: ${value}`).toBe(true);
    }
  });

  it('部门层与企业层并集：prompt 覆盖 / tools·knowledge 并集（不是副本）', () => {
    const ids = departmentIdsOnDisk();
    const base = resolveContent({ departmentIds: [] });
    const dept = resolveContent({ departmentIds: [ids[0]] });

    for (const tool of base.tools) expect(dept.tools).toContain(tool);
    for (const item of base.knowledge) expect(dept.knowledge).toContain(item);

    // 部门层确实带来了新增（否则「按部门变」不成立）
    expect(dept.tools.length).toBeGreaterThan(base.tools.length);
    expect(dept.knowledge.length).toBeGreaterThan(base.knowledge.length);

    // prompt 是覆盖语义（单值），且与基线不同
    expect(dept.prompt).not.toBe(base.prompt);
    expect(dept.appliedLayers).toEqual(['enterprise', ids[0]]);
  });

  it('question 是真参数：命中部门层 questionOverrides ⇒ 采用文件内覆盖值', () => {
    const ids = departmentIdsOnDisk();
    const fin = ids.find((id) => id === 'finance') ?? ids[0];
    const hit = resolveContent({ departmentIds: [fin], question: '现金流是否健康？' });
    const miss = resolveContent({ departmentIds: [fin], question: '本轮完全无关的问法' });

    expect(hit.prompt).not.toBe(miss.prompt);
    // 覆盖值必须来自文件（非代码常量）
    expect(layerFileTexts().some((t) => t.includes(hit.prompt))).toBe(true);
  });
});

describe('K12-20 content-layering — 降级路径', () => {
  it('未知部门 id ⇒ 逐字回落企业层（不是返回空）', () => {
    const base = resolveContent({ departmentIds: [] });
    const fallback = resolveContent({ departmentIds: [ABSENT_DEPARTMENT] });

    expect(fallback).toEqual(base);
    expect(fallback.prompt.length).toBeGreaterThan(0);
    expect(fallback.tools.length).toBeGreaterThan(0);
    expect(fallback.knowledge.length).toBeGreaterThan(0);
  });

  it('部门层文件解析失败 ⇒ 跳过该层、回落企业层、degraded=true（铁律 24/31）', () => {
    const root = fixture({
      'extensions/content-layers/enterprise.yaml': 'layer: enterprise\nprompt: 基线口径\ntools:\n  - base-tool\nknowledge:\n  - base-know\n',
      'extensions/content-layers/departments/broken.json': '{ 这不是合法 JSON',
    });

    const base = resolveContent({ departmentIds: [], rootDir: root });
    const broken = resolveContent({ departmentIds: ['broken'], rootDir: root });

    expect(broken.degraded).toBe(true);
    expect(broken.degradedReasons.length).toBeGreaterThan(0);
    // 回落：内容与基线一致（坏层被跳过，不是崩掉、也不是返回空）
    expect(broken.prompt).toBe(base.prompt);
    expect(broken.tools).toEqual(base.tools);
    expect(broken.knowledge).toEqual(base.knowledge);
  });
});

describe('K12-20 content-layering — 边界条件', () => {
  it('空 departmentIds ⇒ 企业层基线非空', () => {
    const base = resolveContent({ departmentIds: [] });
    expect(base.prompt.length).toBeGreaterThan(0);
    expect(base.tools.length).toBeGreaterThan(0);
    expect(base.knowledge.length).toBeGreaterThan(0);
    expect(base.appliedLayers).toEqual(['enterprise']);
    expect(base.degraded).toBe(false);
  });

  it('内容层根目录缺失 ⇒ 不崩 + degraded=true', () => {
    const root = fixture({ 'placeholder.txt': 'empty root' });
    const out = resolveContent({ departmentIds: [ABSENT_DEPARTMENT], rootDir: root });

    expect(out.degraded).toBe(true);
    expect(out.degradedReasons.length).toBeGreaterThan(0);
    expect(out.prompt).toBe('');
    expect(out.tools).toEqual([]);
    expect(out.knowledge).toEqual([]);
  });

  it('多部门 + departments 别名形态：等价且顺序稳定', () => {
    const ids = departmentIdsOnDisk();
    const two = ids.slice(0, 2);

    const both = resolveContent({ departmentIds: two });
    const single = resolveContent({ departmentIds: [two[0]] });
    for (const tool of single.tools) expect(both.tools).toContain(tool);
    expect(both.appliedLayers).toEqual(['enterprise', ...two]);

    // 探针第三入参形态 { departments } 与第一形态等价
    expect(resolveContent({ departments: two })).toEqual(both);
  });
});
