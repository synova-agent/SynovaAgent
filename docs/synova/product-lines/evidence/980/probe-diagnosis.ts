/**
 * probe-diagnosis.ts — #980 / 施工项 0-6 判据 V1 的实体
 *
 * ⚠️ 落点说明（治理线窗，CTO 2026-10-08「治理/门禁区只报不动」）
 *   最终落点 = scripts/control-tower/probe-diagnosis.ts（单写者治理区）。
 *   本轮先落证据路径 docs/synova/product-lines/evidence/980/probe-diagnosis.ts，
 *   **按「可直接搬移」形态写**：搬到 scripts/control-tower/ 后，只需把下面 4 条 import
 *   的层级前缀由 `../../../../../` 改成 `../../`，其余代码零改动：
 *     import { SqliteGraphStore } from '../../src/adapters/sqlite-graph-store';
 *     import { createGraphBridge } from '../../src/l4/graph-bridge';
 *     import { getUncoveredTypeStats, resetUncoveredTypeStats } from '../../src/l4/sog-schema-validator';
 *     import { ALL_NODE_TYPES } from '../../packages/ontology/src/index';
 *
 * 契约（铁律 47）
 *   @input    — 可选命令行参数 `--json`；无参数 = 人读报告
 *   @output   — stdout：行1 写入/读回计数（真实计数变量插值，非硬编码）；
 *               行2+ 仅当 `getUncoveredTypeStats().count > 0` 打印 `未覆盖类型 N 个` + 类型清单；
 *               `--json` 时改为单行 JSON {"written","readBackOk","count","uncoveredTypes","nodeIds"}
 *   @degraded — better-sqlite3 不可用 → stderr `DEGRADED: better-sqlite3 不可用` + exit 2（不静默）
 *               读回失败 / nodeId 形态异常 → stderr 原文 + exit 3
 *   @error    — 无（本探针不抛；所有失败路径均显式打印 + 非 0 退出）
 *
 * ⚠️ 措辞偏离（**已上报队长，不自行改判据**）
 *   卡面写：行1 = `写入 M 个未覆盖类型节点，成功返回 nodeId 且可读回 = K`，
 *          count===0 时 = `未发现未覆盖类型（count=0）`。
 *   卡面同一段又硬约束：**count===0 时不得出现 `未覆盖类型` 子串**（称其为「V1 判别力的来源」）。
 *   两者物理冲突 —— 实测（grep -q '未覆盖类型'）：
 *     命中   | 写入 40 个未覆盖类型节点，成功返回 nodeId 且可读回 = 40
 *     命中   | 未发现未覆盖类型（count=0）
 *   即照卡面逐字落字，V1 登记原文 `grep -q '未覆盖类型'` 在**实现被还原的变异态下仍绿**
 *   ⇒ PLAN §6 的 V5「反例必红」失效。故本文件按**判据意图**落字：count===0 时 stdout 零命中该子串。
 *   若要逐字照卡面，须同时改 V1/V5 判据（不能只改探针），属 CTO 裁决范围。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { SqliteGraphStore } from '../../../../../src/adapters/sqlite-graph-store';
import { createGraphBridge } from '../../../../../src/l4/graph-bridge';
import {
  getUncoveredTypeStats,
  resetUncoveredTypeStats,
} from '../../../../../src/l4/sog-schema-validator';
import { ALL_NODE_TYPES } from '../../../../../packages/ontology/src/index';

const GRAPH = 'org-980';
const jsonMode = process.argv.includes('--json');

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function warn(line: string): void {
  console.error(`WARN: ${line}`);
}

// ═══ 临时库落点：必须在 %TEMP% // /tmp，禁止在仓库内建库 ═══

const runDir = join(tmpdir(), `synova-980-probe-${process.pid}-${randomUUID().slice(0, 8)}`);
const dbPath = join(runDir, 'probe.db');
const forbiddenRoot = resolve(process.cwd()) + sep;
if (resolve(runDir).startsWith(forbiddenRoot)) {
  console.error(`DEGRADED: 临时库落点落在仓库内 — 拒绝执行（禁在仓库内建库）: ${runDir}`);
  process.exit(2);
}

let closed = false;
function cleanup(): void {
  if (closed) return;
  closed = true;
  try {
    db?.close();
  } catch (err: unknown) {
    warn(`临时库 close 失败 — ${describe(err)}`);
  }
  try {
    rmSync(runDir, { recursive: true, force: true });
  } catch (err: unknown) {
    warn(`临时库删除失败 — ${describe(err)}`);
  }
}
process.on('exit', cleanup);

// ═══ 真库（better-sqlite3）——不可用则显式降级 + 非 0（铁律 24/31） ═══

let db: InstanceType<typeof import('better-sqlite3')> | undefined;
try {
  mkdirSync(runDir, { recursive: true });
  const sqliteMod = await import('better-sqlite3');
  db = new sqliteMod.default(dbPath);
} catch (err: unknown) {
  console.error('DEGRADED: better-sqlite3 不可用');
  console.error(`  落点: ${dbPath}`);
  console.error(`  cause: ${describe(err)}`);
  process.exit(2);
}

if (!db) {
  console.error('DEGRADED: better-sqlite3 不可用');
  process.exit(2);
}

// SqliteGraphStore 构造（真 SQLite 文件库）
const sqliteStore = new SqliteGraphStore(db);

// ═══ 桥接接线：createGraphBridge 就地包装 store.createNode（graph-bridge.ts:81）
//     → 只有走**包装后**的 store.createNode，validateAndLog/未覆盖类型聚合才会被执行。
//     绕过桥接直连底层 = 计数恒 0 ⇒ 探针在变异态下与正常态不可区分（「接线了 ≠ 被执行」）。
//     注：createGraphBridge 的返回对象**不含** createNode（只有 6 个 upsert 方法），
//        被包装的 createNode 挂在 store 实例上 —— 卡面「bridge.createNode(...)」与实体不符，
//        按可用形态落为 store.createNode(...)（已上报）。
//
// ⚠️ 类型层已知偏离（不阻断运行，**不静默**）：SqliteGraphStore 未实现 GraphStore 全量成员
//    （缺 createNodes/createEdges/traverse/findPaths/getNodeAtTime/queryByTags），
//    故此处直传在 tsc 语义下是 TS2345；本文件不在 tsconfig `include`（src/**）内，
//    tsx/vitest 只剥类型不做检查，运行时只用 createNode/queryNodes/updateNode 子集。
//    生产同形缺口见 src/agent/post-diagnosis-processor.ts:78-108。已上报队长，不在本席写集内修。
createGraphBridge(sqliteStore, GRAPH);

// ═══ 计数入口：先归零（确定性；测试/诊断隔离） ═══

resetUncoveredTypeStats();

// ═══ 逐类型写节点（ALL_NODE_TYPES 去重后 40 distinct；实测 45 原始 / pool/activity ×6） ═══

const distinctTypes = [...new Set<string>(ALL_NODE_TYPES)];
const written: Array<{ type: string; nodeId: string }> = [];

for (const type of distinctTypes) {
  // 必须用 createNode 的**返回值**作节点 id（R25 断裂形态 = 拿 props/类型串当节点 id）
  const nodeId = sqliteStore.createNode(type, {}, GRAPH);
  written.push({ type, nodeId });
}

// ═══ 读回校验：store.getNode(返回id, graph) ═══

let readBackOk = 0;
const readBackFailures: string[] = [];
for (const { type, nodeId } of written) {
  const back = sqliteStore.getNode(nodeId, GRAPH);
  if (back !== null && back.id === nodeId && back.type === type) {
    readBackOk++;
  } else {
    readBackFailures.push(
      `- ${type}: 传入 nodeId=${nodeId} → 读回 ${back === null ? 'null' : `id=${back.id} type=${back.type}`}`,
    );
  }
}

const stats = getUncoveredTypeStats();
const M = distinctTypes.length;
const K = readBackOk;

// nodeId 形态（R25 判别）：必须由 store 生成，不得是类型串/实体 id，且两两不同
const idFormOk = written.every(w => w.nodeId.length > 0 && w.nodeId !== w.type);
const idUniqueOk = new Set(written.map(w => w.nodeId)).size === written.length;

// ═══ 报告 ═══

if (jsonMode) {
  console.log(JSON.stringify({
    written: M,
    readBackOk: K,
    count: stats.count,
    uncoveredTypes: stats.uncoveredTypes,
    nodeIds: written.map(w => w.nodeId),
  }));
} else {
  const okSuffix = M === K && idFormOk && idUniqueOk ? ' OK' : '';
  console.log(`写入 ${M} 个类型节点（ALL_NODE_TYPES 去重），成功返回 nodeId 且可读回 = ${K}${okSuffix}`);
  if (stats.count > 0) {
    console.log(`未覆盖类型 ${stats.count} 个`);
    for (const t of stats.uncoveredTypes) {
      console.log(`- ${t}`);
    }
  } else {
    // count === 0：本行**不得**出现「未覆盖类型」子串（V1/V5 判别力来源，见文件头说明）
    console.log('未发现未覆盖的类型（count=0）');
  }
}

// ═══ 失败路径：原文贴出 + 非 0（不改数） ═══

let failed = false;

if (readBackFailures.length > 0) {
  failed = true;
  console.error(`读回失败 ${readBackFailures.length}/${M} 处（原样贴出，未修改计数）：`);
  for (const line of readBackFailures) console.error(line);
}
if (!idFormOk) {
  failed = true;
  console.error('nodeId 形态异常：存在空 id 或用类型串当节点 id 的条目（R25 断裂形态）');
}
if (!idUniqueOk) {
  failed = true;
  console.error(`nodeId 不唯一：${written.length} 次写入只有 ${new Set(written.map(w => w.nodeId)).size} 个不同 id`);
}
if (stats.count !== M) {
  // 判据 V2 要读这个数：只报，不改，不让它决定退出码。
  // ⚠️ 措辞硬约束：本行**不得**含「未覆盖类型」子串 —— 否则 count=0 的场景下由本行重新引入该子串，
  //    判别力归零（实测踩过：原措辞「未覆盖类型计数 0 ≠ …」使 V1-登记原文在去接线变异体上仍命中）。
  warn(`未覆盖的类型计数 ${stats.count} ≠ 写入类型数 ${M} — 原样上报，未修改任何计数`);
}
if (stats.uncoveredTypes.length !== stats.count) {
  warn(`uncoveredTypes 长度 ${stats.uncoveredTypes.length} ≠ count ${stats.count} — 原样上报`);
}

cleanup();
process.exit(failed ? 3 : 0);
