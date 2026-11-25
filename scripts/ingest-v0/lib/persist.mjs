/**
 * scripts/ingest-v0/lib/persist.mjs — **产品落库与 C4 反查**的唯一桥（V2 唯一 import 产品 TS 的模块）。
 *
 * 为什么单独一件（C3）：任务书要求"必须经 persistFacts 落库、禁止直写 scan_* / graph_* 表"；
 * 生产入口是 `src/l4/enterprise-scan-store.ts`（persistFacts）与 `src/sentinel/metric-observations-writer.ts`
 * （指标）。把这两处调用收在一个 .mjs 里，抽取规则/测试才能保持零产品依赖。
 *
 * 运行方式（**已在本机验证的入口**）：
 *   `node --experimental-transform-types --import scripts/ingest-v0/lib/ts-register.mjs scripts/ingest-v0/extract.mjs ...`
 *   —— 本文件动态 import `.ts`；`extract.mjs` 会在未满足条件时自动以该命令重启自身（见 CLI）。
 *
 * 边界：
 *   · 只调用现有产品原语（persistFacts / writeMetricObservation / handleDomainToolCall），**不改产品代码**；
 *   · `scope: 'admin'` 是**本机验证身份**（产品真实身份来自 JWT）；报告里必须写明这是验证上下文；
 *   · C4 只在有根对象/关系时执行；count=0 原样返回（由调用方判失败，**不在这里伪造成功**）。
 */

import fs from 'node:fs';
import path from 'node:path';

import { IngestError } from './errors.mjs';
import { INGEST_DEF_VERSION } from './extract/facts.mjs';

/** 产品模块路径（相对本文件；`../../..` = 仓库根）。 */
const PRODUCT = {
  engine: '../../../src/init/engine-context.ts',
  graphStore: '../../../src/adapters/sqlite-graph-store.ts',
  scanStore: '../../../src/l4/enterprise-scan-store.ts',
  metricWriter: '../../../src/sentinel/metric-observations-writer.ts',
  tools: '../../../src/runtime/dsh/tools.ts',
};

/** C4 验证用的**本机**身份（非生产 JWT；报告必须标注）。 */
export const VERIFY_IDENTITY = Object.freeze({ userId: 'ingest-v0-verify', scope: 'admin' });

/**
 * 加载产品落库面（动态 import `.ts`；只有本模块允许）。
 *
 * @input 无
 * @output `{initEngineContext, closeEngineContext, getDatabase, SqliteGraphStore, EnterpriseScanStore,
 *          writeMetricObservation, handleDomainToolCall}`
 * @degraded 无：缺任一模块 ⇒ 显式 `E_PERSIST_FAILED`（不降级成假成功）
 * @authority 产品原语路径只由本文件 `PRODUCT` 给出
 * @not_here 不初始化数据库、不写库
 * @error `IngestError(E_PERSIST_FAILED, phase='load')` —— 产品模块加载失败（含 TS 运行环境未就绪）
 */
async function loadProductSurface() {
  try {
    const [engine, graphStore, scanStore, metricWriter, tools] = await Promise.all([
      import(PRODUCT.engine),
      import(PRODUCT.graphStore),
      import(PRODUCT.scanStore),
      import(PRODUCT.metricWriter),
      import(PRODUCT.tools),
    ]);
    return {
      initEngineContext: engine.initEngineContext,
      closeEngineContext: engine.closeEngineContext,
      getDatabase: engine.getDatabase,
      SqliteGraphStore: graphStore.SqliteGraphStore,
      EnterpriseScanStore: scanStore.EnterpriseScanStore,
      writeMetricObservation: metricWriter.writeMetricObservation,
      handleDomainToolCall: tools.handleDomainToolCall,
    };
  } catch (err) {
    throw new IngestError(
      'E_PERSIST_FAILED',
      'load',
      `产品模块加载失败（需原生 TS 运行参数；见 extract.mjs 自举）：${err instanceof Error ? err.message : String(err)}`,
      { detail: { cause: err instanceof Error ? err.name : typeof err } },
    );
  }
}

/**
 * 经 `persistFacts` 落对象/关系，经指标 writer 落指标，再用 `synova_context_get` 反查根对象（C3/C4）。
 *
 * @input  input.dbPath —— 隔离库绝对路径（缺省 `%TEMP%/ingest-v0/synova.db` 由 CLI 给）
 *         input.graph —— 企业图分区（= ctx.enterpriseId）
 *         input.runId —— 本轮 id（写指标 run_id，不入唯一键）
 *         input.objects/relations/metrics —— `aggregateFacts` 产物
 *         input.rootBusinessKey —— C4 根对象 businessKey（`selectRoot` 产物；无关系时为 null）
 *         input.observedAt —— 指标观测时间（ISO；调用方注入，便于复跑）
 * @output `{persist:{facts, objectIds, metricResults, replayed}, context}`：
 *           context —— `{problemId, count, ids, insufficient?, identity:'local-verify-admin'}` 或 `null`
 * @degraded 无：任何一步失败 ⇒ 显式 `E_PERSIST_FAILED` / `E_C4_ZERO`（**不伪造成功**）
 * @authority 落库顺序与唯一入口由本函数钉死：objects+relations → metrics → context
 * @not_here 不构造指标值/期间（来自 `aggregateFacts`）；不判断业务质量
 * @error `IngestError(E_PERSIST_FAILED, phase='persist'|'metric'|'context')` —— 产品原语抛错；
 *        `IngestError(E_C4_ZERO, phase='context')` —— 根对象存在但 `count=0`（#1493 的坑）
 */
export async function persistAndVerify(input) {
  const dbPath = path.resolve(input.dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  process.env.SYNOVA_DB_PATH = dbPath;
  process.env.SYNOVA_SKIP_MCP = '1';

  const product = await loadProductSurface();
  try {
    product.initEngineContext();
  } catch (err) {
    throw new IngestError('E_PERSIST_FAILED', 'persist', `隔离库初始化失败: ${dbPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const db = product.getDatabase();
  const graphStore = new product.SqliteGraphStore(db);
  const store = new product.EnterpriseScanStore(db, graphStore);

  try {
  let persisted;
  try {
    persisted = store.persistFacts({
      graph: input.graph,
      objects: input.objects.map(object => ({ type: object.type, businessKey: object.businessKey, props: object.props })),
      relations: input.relations.map(relation => ({
        type: relation.type,
        businessKey: relation.businessKey,
        fromBusinessKey: relation.fromBusinessKey,
        toBusinessKey: relation.toBusinessKey,
        props: relation.props,
      })),
    });
  } catch (err) {
    throw new IngestError('E_PERSIST_FAILED', 'persist', `persistFacts 失败: ${err instanceof Error ? err.message : String(err)}`, {
      detail: { code: err !== null && typeof err === 'object' && 'code' in err ? String(err.code) : null },
    });
  }

  const objectIds = {};
  let replayed = 0;
  for (const fact of persisted.facts) {
    objectIds[fact.businessKey] = fact.objectId;
    if (fact.replayed) replayed += 1;
  }

  const metricResults = {};
  for (const metric of input.metrics) {
    const objectId = objectIds[metric.objectBusinessKey];
    if (typeof objectId !== 'string' || objectId.length === 0) {
      metricResults[`${metric.objectBusinessKey}|${metric.metricId}|${metric.period}`] = { written: false, reason: 'object_not_persisted' };
      continue;
    }
    try {
      const result = product.writeMetricObservation(db, {
        orgId: input.graph,
        objectId,
        metricId: metric.metricId,
        period: metric.period,
        value: metric.value,
        unit: metric.unit,
        defVersion: INGEST_DEF_VERSION,
        runId: input.runId,
        sourceType: 'connector',
        sourceId: metric.sourceRef.file,
        evidenceRef: `${metric.sourceRef.file}#${metric.sourceRef.locator}`,
        observedAt: input.observedAt,
      });
      metricResults[`${metric.objectBusinessKey}|${metric.metricId}|${metric.period}`] = result;
    } catch (err) {
      throw new IngestError('E_PERSIST_FAILED', 'metric', `指标写入失败: ${metric.metricId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let context = null;
  if (typeof input.rootBusinessKey === 'string' && input.rootBusinessKey.length > 0) {
    let snapshot;
    try {
      const raw = product.handleDomainToolCall(
        'synova_context_get',
        { problemId: input.rootBusinessKey },
        { enterpriseId: input.graph, userId: VERIFY_IDENTITY.userId, scope: VERIFY_IDENTITY.scope, runId: input.runId },
      );
      snapshot = JSON.parse(raw);
    } catch (err) {
      throw new IngestError('E_PERSIST_FAILED', 'context', `synova_context_get 调用失败: ${err instanceof Error ? err.message : String(err)}`, {
        detail: { code: err !== null && typeof err === 'object' && 'code' in err ? String(err.code) : null },
      });
    }
    context = {
      problemId: input.rootBusinessKey,
      count: typeof snapshot.count === 'number' ? snapshot.count : 0,
      ids: Array.isArray(snapshot.items) ? snapshot.items.map(item => item.$id) : [],
      insufficient: snapshot.insufficient ?? null,
      identity: 'local-verify-admin',
    };
    if (context.count === 0) {
      throw new IngestError('E_C4_ZERO', 'context', `C4 反查 count=0（写入成功但域上下文读不到；见 #1493 的坑）: ${input.rootBusinessKey}`, {
        detail: { context },
      });
    }
  }

  return { persist: { facts: persisted.facts, objectIds, metricResults, replayed }, context };
  } finally {
    // 任何路径（成功/失败/停点）都必须释放数据库句柄；closeEngineContext 幂等（db 为 null 时 no-op）
    product.closeEngineContext();
  }
}
