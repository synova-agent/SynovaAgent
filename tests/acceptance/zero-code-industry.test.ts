/**
 * zero-code-industry.test.ts — pizza-chain 零代码验收测试
 * V4.1 T4: 验证"不修改任何.ts文件即可新增行业"的承诺。
 *
 * 🔴 #840 语义修正（例外，PR 正文登记）: 原断言「行业 node-types 被 ontology 加载」与产品**设计**不符 ——
 *   `src/l4/ontology-loader.ts:88-115` 明确只读 `extensions/ontology/{resource,activity,outcome}` 与
 *   行业 `edge-types/`，**不读** `extensions/industries/<name>/node-types/`（源码注释：「行业模板使用新实体
 *   ID 空间，不读旧 node-types/ 目录」）。故本件改为：
 *     · 主断言 = 行业 **edge-types** 被加载 ＋ `getTypesByTags(['food_service'])` 命中；
 *     · node-types 用例保留，改为**反向断言**「按设计不加载」（防有人误加回去而不被发现）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = process.cwd();
// #840 E-4 隔离：本件会在「行业目录」里写临时行业包。若直接写仓内工作树，会与**并行**跑的
//   参数桥棘轮（tests/l4/ontology-loader-param-bridge-1031.test.ts 数「真实 56 件 edge-types」）
//   相互污染（实测：全量首跑 3 例红）。故改为 **temp cwd 隔离**：把 extensions/ontology 软链进临时目录，
//   只在临时目录里造行业包，测完 chdir 回来 —— 不写仓库工作树、不影响并行用例。
const TMP_CWD = mkdtempSync(join(tmpdir(), 'pizza-chain-acceptance-'));
const PIZZA_DIR = join(TMP_CWD, 'extensions', 'industries', 'pizza-chain');
const TEST_FILES: string[] = [];

describe('零代码接入验收 (pizza-chain)', () => {
  beforeAll(() => {
    // temp cwd 结构：真实本体目录软链 + 临时行业目录
    mkdirSync(join(TMP_CWD, 'extensions', 'industries'), { recursive: true });
    symlinkSync(join(REPO_ROOT, 'extensions', 'ontology'), join(TMP_CWD, 'extensions', 'ontology'), 'dir');
    process.chdir(TMP_CWD);
    // 创建测试用的 pizza-chain 行业
    mkdirSync(join(PIZZA_DIR, 'node-types'), { recursive: true });
    mkdirSync(join(PIZZA_DIR, 'edge-types'), { recursive: true });

    // manifest.json
    writeFileSync(join(PIZZA_DIR, 'manifest.json'), JSON.stringify({
      name: 'pizza-chain', version: '1.0.0', type: 'industry-template',
      displayName: '连锁餐饮', extends: 'general-enterprise',
    }));
    TEST_FILES.push(join(PIZZA_DIR, 'manifest.json'));

    // node-type: oven
    writeFileSync(join(PIZZA_DIR, 'node-types', 'oven.json'), JSON.stringify({
      $id: 'node-type/oven', label: '厨房设备', tags: ['operational', 'machine', 'food_service'],
      requiredProps: ['equipmentType', 'status'],
      props: { equipmentType: { enum: ['oven', 'fryer', 'mixer'] }, status: { enum: ['operational', 'maintenance', 'offline'] } },
    }));
    TEST_FILES.push(join(PIZZA_DIR, 'node-types', 'oven.json'));

    // edge-type: delivery
    writeFileSync(join(PIZZA_DIR, 'edge-types', 'delivery.json'), JSON.stringify({
      $id: 'edge-type/delivery', label: 'DELIVERY_ZONE', tags: ['operational', 'food_service'],
      allowedFrom: ['Location'], allowedTo: ['Client'],
    }));
    TEST_FILES.push(join(PIZZA_DIR, 'edge-types', 'delivery.json'));
  });

  afterAll(() => {
    // 清理测试文件
    for (const f of TEST_FILES) { try { rmSync(f, { force: true }); } catch { /* ok */ } }
    try { rmSync(join(PIZZA_DIR, 'node-types'), { recursive: true, force: true }); } catch { /* ok */ }
    try { rmSync(join(PIZZA_DIR, 'edge-types'), { recursive: true, force: true }); } catch { /* ok */ }
    try { process.chdir(REPO_ROOT); } catch { /* ok */ }
    try { rmSync(TMP_CWD, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('pizza-chain 行业模板被自动发现', async () => {
    const { loadIndustries } = await import('../../src/l4/industry-loader');
    const { industries } = loadIndustries();
    const pizza = industries.find(i => i.name === 'pizza-chain');
    expect(pizza).toBeDefined();
    expect(pizza!.extends).toBe('general-enterprise');
  });

  it('pizza-chain 行业 edge-types 被 ontology 加载（产品承诺面）', async () => {
    const { loadOntology, clearOntologyCache } = await import('../../src/l4/ontology-loader');
    clearOntologyCache();  // 防同进程先前加载的缓存掩盖本用例写入的行业文件
    const { ontology } = loadOntology();
    const delivery = ontology.edgeTypes.find(e => e.label === 'DELIVERY_ZONE');
    expect(delivery).toBeDefined();
    expect(delivery!.tags).toContain('food_service');
  });

  it('按设计：行业 node-types **不被** ontology 加载（反向断言，防误加）', async () => {
    // 依据 src/l4/ontology-loader.ts:88-115：行业模板只贡献 edge-types；node-types 只来自
    // extensions/ontology/{resource,activity,outcome}。若哪天有人读回行业 node-types，
    // 本断言会红 —— 提醒同步验收语义，而不是悄悄改变产品承诺。
    const { loadOntology } = await import('../../src/l4/ontology-loader');
    const { ontology } = loadOntology();
    expect(ontology.nodeTypes.find(n => n.label === '厨房设备')).toBeUndefined();
  });

  it('queryByTags 可查询 food_service 标签的类型（行业 edge）', async () => {
    const { getTypesByTags } = await import('../../src/l4/ontology-loader');
    const { edges } = getTypesByTags(['food_service']);
    expect(edges.length).toBeGreaterThanOrEqual(1);  // delivery edge（tags 含 food_service）
    expect(edges.map(e => e.label)).toContain('DELIVERY_ZONE');
  });

  it('新增行业零 .ts 文件修改', () => {
    const diff = execSync('git diff --name-only', { encoding: 'utf-8', cwd: REPO_ROOT });
    const tsChanges = diff.split('\n').filter(f => f.endsWith('.ts') && !f.includes('.test.'));
    expect(tsChanges.length).toBe(0);
  });

  it('基础 ontology 仍正常加载 (17 node + 14 edge)', async () => {
    const { loadOntology } = await import('../../src/l4/ontology-loader');
    const { ontology } = loadOntology();
    expect(ontology.nodeTypes.length).toBeGreaterThanOrEqual(18);
    expect(ontology.edgeTypes.length).toBeGreaterThanOrEqual(15);
  });
});
