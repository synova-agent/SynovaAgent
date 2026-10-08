/**
 * tests/agent/write-side-axis-alignment.test.ts — #1395 判据（写入侧类型对齐本体轴）
 *
 * CTO 2026-10-08 裁：**改动面 8×3**（mapping 目标 + 读侧字典 + `loadNodeTypeSchema` 支持限定名）
 *   裁 (a)：写入侧写【主目标】＝读侧字典 `targets[0]`；多目标由读侧承担（**不写两份 = 不复制数据**）
 * 判据口径（R192）：
 *   · **行为断言**（V2、M4）＝真路径产出结果，**默认手段**
 *   · **形态扫描**（V1/V3/M3）＝只证明【形态】（"类型名对得上"），**不证明生效** —— 已在用例名标注
 * 短路声明（R178）：本卡 `M3`（Tool 无上游）为**登记**性质，非"未测"。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import Database from 'better-sqlite3';
import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
import { ingestBatch, loadFieldMapping, loadNodeTypeSchema } from '../../src/agent/data-ingest-service';
import { withOrgScope } from '../../src/sentinel/org-scope';

const MAP_DIR = 'extensions/ontology/field-mappings';
// 🔴 **批次作用域（B2 = 收尾批）**：本批 = 后 4 个；B1 的 4 个**已合入 main**（ee4b2b60f）
//   （D734 预算 ⇒ 机械拆 4+4；**判据作用域必须与批次一致** —— 见 B1 的 CI 红教训"判据作用域泄漏"）
const MAPPINGS = ['erp-standard', 'hr-standard', 'innovation-pipeline', 'risk-register'];
const B1_MERGED = ['competitive-intel', 'crm-standard', 'erp-operational', 'external-intel'];
/** 本体轴类型全集（40）—— 真源：packages/ontology/src/node-types.ts */
const ONTOLOGY = new Set((readFileSync('packages/ontology/src/node-types.ts', 'utf-8').match(/'[a-z]+\/[a-z_]+'/g) ?? []).map(s => s.replace(/'/g, '')));

function mappingTarget(name: string): string {
  const cfg = JSON.parse(readFileSync(`${MAP_DIR}/${name}.json`, 'utf-8')) as { targetNodeType: string };
  return cfg.targetNodeType;
}

describe('#1395 写入侧类型对齐本体轴', () => {
  it('V1【形态扫描·只证明形态】覆盖 8/8（B2 4 个 + B1 已合 4 个）∈ 本体轴（40）', () => {
    for (const m of MAPPINGS) {
      const t = mappingTarget(m);
      expect(t.includes('/'), `${m}: ${t} 应为限定名`).toBe(true);
      expect(ONTOLOGY.has(t), `${m}: ${t} 不在本体轴 40 类型内`).toBe(true);
    }
    expect(ONTOLOGY.size).toBe(40);
    // 覆盖面声明：8/8（B2 本批 4 + B1 已合 4）；逐个点名（禁"8 个已改"式模糊口径）
    expect(MAPPINGS.length).toBe(4);
    expect(B1_MERGED.length).toBe(4);
    for (const n of B1_MERGED) {
      const t = (JSON.parse(readFileSync(`${MAP_DIR}/${n}.json`, 'utf-8')) as { targetNodeType: string }).targetNodeType;
      expect(t.includes('/'), `${n}（B1 已合）应为本体轴`).toBe(true);
      expect(ONTOLOGY.has(t), `${n}: ${t} 不在本体轴`).toBe(true);
    }
  });

  it('V3【形态扫描·只证明形态】**两侧同步**：每个 mapping 的目标 ∈ 读侧字典某条目的 targets', () => {
    const dict = JSON.parse(readFileSync('extensions/ontology/node-type-mapping.json', 'utf-8')) as { entries: Record<string, { targets: string[] | null }> };
    const allTargets = new Set(Object.values(dict.entries).flatMap(e => e.targets ?? []));
    for (const m of MAPPINGS) {
      const t = mappingTarget(m);
      expect(allTargets.has(t), `${m}: 写入目标 ${t} 在读侧字典中【无对应条目】⇒ 读侧会走 null 分支 ⇒ 数据读不到`).toBe(true);
    }
  });

  it('🔴 V2【行为断言】端到端：走真实 ingest ⇒ 节点类型 = 本体轴 ⇒ **经收口点的读者能读到**', async () => {
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db, { standardKeyGuard: false })   // #1412 (C)：本用例需"裸语义"（记录不经守卫的行为）;
    const res = await ingestBatch(
      { createNode: (t: string, p: Record<string, unknown>, g: string) => store.createNode(t, p, g) },
      loadFieldMapping('hr-standard')!,
      [{ 姓名: '张三', 知识领域: 'ai', 期间: '2026-Q2' }],
      'default',
    );
    expect(res.nodesCreated, '应写入 1 个节点').toBe(1);
    const rows = db.prepare('SELECT type FROM graph_nodes').all() as Array<{ type: string }>;
    expect(rows[0].type, '节点类型应为本体轴限定名').toBe('resource/person');
    // 🔴 行为：读侧（收口点并集读）读遗留名 `Person` ⇒ 应命中写入的本体轴节点 `resource/person`
    const scoped = withOrgScope(store, undefined);
    const seen = scoped.queryNodes('Person', {}) as unknown[];
    expect(seen.length, '本体轴消费者（读 Person）应读到新写入的 resource/person 节点').toBeGreaterThan(0);
  });

  it('🔴 V2-b【行为断言】键段不变：目标=本体轴，standardKey 段仍为遗留形态（字节不变）', async () => {
    // 口径：选**声明了 `period` 的 schema**（本批 `erp-standard → outcome/financial`）；
    //   `resource/client` / `resource/person` 未声明 period ⇒ 白名单丢弃 ⇒ 无 standardKey（**预存在**，另登记）
    const db = new Database(':memory:');
    const store = new SqliteGraphStore(db, { standardKeyGuard: false })   // #1412 (C)：本用例需"裸语义"（记录不经守卫的行为）;
    const mk = () => ({ createNode: (t: string, p: Record<string, unknown>, g: string) => store.createNode(t, p, g) });
    const row = [{ 市场份额: 25, 期间: '2026-Q2' }];
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, row, 'default');
    const first = db.prepare('SELECT type, props FROM graph_nodes LIMIT 1').get() as { type: string; props: string };
    expect(first.type, '节点类型 = 本体轴').toBe('outcome/financial');
    expect(JSON.parse(first.props).standardKey ?? '', 'standardKey 段须为遗留形态（键字节不变）').toContain(':Financial:');
    // ⚠️ **预存在缺陷（本卡暴露，不属本卡范围）**：`ingestRow` **直接 `store.createNode`**，
    //   而 standardKey 冲突检测在 `src/l4/graph-bridge.ts:77-94`（另一条写入路径）⇒ 本路径**绕过检测** ⇒ 重复导入产生重复行。
    //   本卡的义务：**键字节不变**（下断言）⇒ 幂等语义与改前**完全一致**（缺陷不因本卡变好或变坏）。
    await ingestBatch(mk(), loadFieldMapping('erp-standard')!, row, 'default');
    const n = (db.prepare('SELECT COUNT(*) AS n FROM graph_nodes').get() as { n: number }).n;
    expect(n, '（登记）本路径无冲突检测 ⇒ 2 行；本卡只保证键不变').toBe(2);
  });

  it('🔴 M4【行为+形态组合】schema 查不到 ⇒ 返回 null（行为）+ 告警含**候选路径**（形态，只证明形态）', () => {
    // 行为面：查不到的限定名 ⇒ null（调用方据此 fail-open 并记 warnings）
    expect(loadNodeTypeSchema('resource/definitely-not-a-type')).toBeNull();
    expect(loadNodeTypeSchema('outcome/competitive')).not.toBeNull();   // 对照：存在的限定名应能载入
    // 形态面（R192：**只证明形态，不证明生效**）：告警必须列出候选路径，便于区分
    //   "改了限定名却没建 schema" vs "文件缺失"
    const src = readFileSync('src/agent/data-ingest-service.ts', 'utf-8');
    expect(src, 'schema 缺失须告警且含 candidates').toMatch(/log\.warn\(\{[^}]*candidates[^}]*\}/);
  });

  it('M3【形态扫描·登记性质】`resource/tool` **无上游**（0 个 mapping 目标）⇒ 不建写入者', () => {
    const targets = readdirSync(MAP_DIR).map(f => mappingTarget(f.replace(/\.json$/, '')));
    expect(targets.includes('resource/tool'), '不得硬造 tool 写入者（无上游 ⇒ 登记"结构性不可写"）').toBe(false);
    expect(loadFieldMapping('nonexistent-mapping')).toBeNull();
  });
});
