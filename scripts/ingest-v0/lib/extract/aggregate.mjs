/**
 * scripts/ingest-v0/lib/extract/aggregate.mjs — 候选事实的**合并/去重/校验**与根对象选择（纯函数，零 I/O）。
 *
 * 为什么独立一层：C8 要求「同 businessKey 合并为一条」、C2 要求「无 period 不落库」、
 * C5 要求「无 sourceRef 不落库」；这三条都是**跨文件**判据，放在单文件规则层会被重复实现。
 *
 * 判据（硬性，逐条可测）：
 *   · 对象键 = `businessKey`（类型+名称归一后）；关系键 = `businessKey`；指标键 = `(对象键, metricId, period)`；
 *   · 重复出现 ⇒ 只保留**首个**来源指针，`duplicates` 计数（可解释：同一份看板的多个副本）；
 *   · 同指标键但数值不同 ⇒ `conflicts` 计数，保留首个（**不合并成平均值** —— 那是造数）；
 *   · period 缺失/形态非法 ⇒ 该条**不进结果**（`missingPeriod` 计数）；
 *   · sourceRef.file/locator 缺失 ⇒ 该条**不进结果**（`missingSourceRef` 计数）；
 *   · `defVersion` 缺失**不**丢弃：C4 反查就是抓这个坑（#1493）；此处只计数 `missingDefVersion` 供报告可见。
 */

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_EXAMPLES = 10;

/** @input period —— 任意值 @output 是否合法 YYYY-MM @degraded 无 @authority 本文件 @not_here 无 @error 无 */
function isValidPeriod(period) {
  return typeof period === 'string' && PERIOD_PATTERN.test(period);
}

/**
 * 校验来源指针（C5）。
 *
 * @input  sourceRef —— `{file, locator}`（可含 raw）
 * @output 合法 ⇒ true；否则 false
 * @degraded 无
 * @authority 判据 = "file/locator 均为非空字符串"
 * @not_here 不校验 locator 是否能回读（由 `verifyRead` 另行抽检）
 * @error 无
 */
export function hasSourceRef(sourceRef) {
  return (
    typeof sourceRef === 'object' &&
    sourceRef !== null &&
    typeof sourceRef.file === 'string' &&
    sourceRef.file.length > 0 &&
    typeof sourceRef.locator === 'string' &&
    sourceRef.locator.length > 0
  );
}

/**
 * 合并单文件抽取结果（对象/关系/指标去重 + 丢弃判据）。
 *
 * @input  results —— `[{doc, facts}]`：doc 形如 `{kind, displayPath, truncated, corrupt}`，
 *         facts 为 `extractFactsFromDocument` 产物
 * @output `{objects, relations, metrics, stats}`：
 *           objects/relations/metrics —— 已去重、已过滤的**可落库候选**；
 *           stats 见文件头字段（files/raw/objects/relations/metrics/examples）
 * @degraded 无：每条丢弃都有 `stats` 计数 + `examples`（最多 10 条，不含敏感原文，只有 key/文件/原因）
 * @authority 去重键 = 本文件定义（对象/关系按 businessKey；指标按四键）
 * @not_here 不落库、不调用产品代码
 * @error 无（纯合并）
 */
export function aggregateFacts(results) {
  const objectsByKey = new Map();
  const relationsByKey = new Map();
  const metricsByKey = new Map();
  const stats = {
    files: { total: results.length, withFacts: 0, withoutPeriod: 0, truncated: 0, corrupt: 0 },
    raw: { objects: 0, relations: 0, metrics: 0 },
    objects: { total: 0, byType: {}, duplicates: 0, missingPeriod: 0, missingSourceRef: 0, missingDefVersion: 0 },
    relations: { total: 0, duplicates: 0, orphanEndpoints: 0 },
    metrics: { total: 0, duplicates: 0, conflicts: 0, missingPeriod: 0, missingSourceRef: 0, invalidValue: 0, orphanObject: 0 },
    skippedRows: 0,
    examples: [],
  };
  const addExample = example => {
    if (stats.examples.length < MAX_EXAMPLES) stats.examples.push(example);
  };

  for (const result of results) {
    const doc = result.doc;
    const facts = result.facts;
    if (doc?.truncated) stats.files.truncated += 1;
    if (doc?.corrupt) stats.files.corrupt += 1;
    if (facts?.periodInfo === null || facts?.periodInfo === undefined) stats.files.withoutPeriod += 1;
    if (facts === undefined) continue;
    stats.skippedRows += facts.skippedRows?.length ?? 0;
    stats.raw.objects += facts.objects.length;
    stats.raw.relations += facts.relations.length;
    stats.raw.metrics += facts.metrics.length;
    if (facts.objects.length > 0 || facts.relations.length > 0 || facts.metrics.length > 0) {
      stats.files.withFacts += 1;
    }

    for (const object of facts.objects) {
      if (!isValidPeriod(object.props?.period)) {
        stats.objects.missingPeriod += 1;
        addExample({ kind: 'object', file: doc?.displayPath ?? '', businessKey: object.businessKey, reason: 'missing_period' });
        continue;
      }
      if (!hasSourceRef(object.props?.sourceRef)) {
        stats.objects.missingSourceRef += 1;
        addExample({ kind: 'object', file: doc?.displayPath ?? '', businessKey: object.businessKey, reason: 'missing_source_ref' });
        continue;
      }
      if (typeof object.props?.defVersion !== 'string' || object.props.defVersion.length === 0) {
        stats.objects.missingDefVersion += 1;
      }
      const existing = objectsByKey.get(object.businessKey);
      if (existing !== undefined) {
        stats.objects.duplicates += 1;
        continue; // 保留首个来源指针（C8：不重复落库、不覆盖首见证据）
      }
      objectsByKey.set(object.businessKey, object);
    }

    for (const relation of facts.relations) {
      const existing = relationsByKey.get(relation.businessKey);
      if (existing !== undefined) {
        stats.relations.duplicates += 1;
        continue;
      }
      relationsByKey.set(relation.businessKey, relation);
    }

    for (const metric of facts.metrics) {
      if (!isValidPeriod(metric.period)) {
        stats.metrics.missingPeriod += 1;
        addExample({ kind: 'metric', file: doc?.displayPath ?? '', businessKey: `${metric.objectBusinessKey}/${metric.metricId}`, reason: 'missing_period' });
        continue;
      }
      if (!hasSourceRef(metric.sourceRef)) {
        stats.metrics.missingSourceRef += 1;
        addExample({ kind: 'metric', file: doc?.displayPath ?? '', businessKey: `${metric.objectBusinessKey}/${metric.metricId}`, reason: 'missing_source_ref' });
        continue;
      }
      if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
        stats.metrics.invalidValue += 1;
        addExample({ kind: 'metric', file: doc?.displayPath ?? '', businessKey: `${metric.objectBusinessKey}/${metric.metricId}`, reason: 'invalid_value' });
        continue;
      }
      const key = `${metric.objectBusinessKey}\u0000${metric.metricId}\u0000${metric.period}`;
      const existing = metricsByKey.get(key);
      if (existing !== undefined) {
        if (existing.value === metric.value) stats.metrics.duplicates += 1;
        else {
          stats.metrics.conflicts += 1;
          addExample({ kind: 'metric', file: doc?.displayPath ?? '', businessKey: `${metric.objectBusinessKey}/${metric.metricId}`, reason: 'value_conflict_kept_first' });
        }
        continue;
      }
      metricsByKey.set(key, metric);
    }
  }

  // 关系端点必须落在已接受对象集合内（period/sourceRef 被丢弃的对象不能留下悬空边）
  const acceptedObjectKeys = new Set(objectsByKey.keys());
  for (const [key, relation] of relationsByKey) {
    if (!acceptedObjectKeys.has(relation.fromBusinessKey) || !acceptedObjectKeys.has(relation.toBusinessKey)) {
      relationsByKey.delete(key);
      stats.relations.orphanEndpoints += 1;
      addExample({ kind: 'relation', file: relation.props?.sourceRef?.file ?? '', businessKey: relation.businessKey, reason: 'endpoint_not_accepted' });
    }
  }

  // 指标必须挂在已接受对象上（无对象锚点的指标不落库）
  for (const [key, metric] of metricsByKey) {
    if (!acceptedObjectKeys.has(metric.objectBusinessKey)) {
      metricsByKey.delete(key);
      stats.metrics.orphanObject += 1;
      addExample({ kind: 'metric', file: metric.sourceRef?.file ?? '', businessKey: `${metric.objectBusinessKey}/${metric.metricId}`, reason: 'object_not_accepted' });
    }
  }

  const objects = [...objectsByKey.values()];
  const relations = [...relationsByKey.values()];
  const metrics = [...metricsByKey.values()];
  stats.objects.total = objects.length;
  stats.relations.total = relations.length;
  stats.metrics.total = metrics.length;
  for (const object of objects) {
    stats.objects.byType[object.type] = (stats.objects.byType[object.type] ?? 0) + 1;
  }
  return { objects, relations, metrics, stats };
}

/**
 * 选 C4 反查根对象（**确定性**：有关系的对象里，按关系键字典序第一条的 from 端）。
 *
 * @input  facts —— `aggregateFacts` 产物
 * @output 命中 ⇒ `{rootBusinessKey, relationBusinessKey}`；无可用根 ⇒ `null`
 * @degraded 无：没有关系就是 null（调用方按 `INSUFFICIENT_INGEST{missing:['relations']}` 处理，**不编根**）
 * @authority 排序规则只由本函数给出（同输入 ⇒ 同根，便于复跑）
 * @not_here 不检查对象是否真有 1 跳邻居（由产品 `synova_context_get` 判定）
 * @error 无
 */
export function selectRoot(facts) {
  const objectKeys = new Set(facts.objects.map(object => object.businessKey));
  const sortedRelations = [...facts.relations].sort((left, right) =>
    left.businessKey < right.businessKey ? -1 : left.businessKey > right.businessKey ? 1 : 0,
  );
  for (const relation of sortedRelations) {
    if (objectKeys.has(relation.fromBusinessKey) && objectKeys.has(relation.toBusinessKey)) {
      return { rootBusinessKey: relation.fromBusinessKey, relationBusinessKey: relation.businessKey };
    }
  }
  return null;
}

/**
 * 计算 `INSUFFICIENT_INGEST.missing`（C6：抽不到就明说缺什么，不硬凑）。
 *
 * @input  facts —— `aggregateFacts` 产物；results —— 单文件结果（用于判断"有没有任何期间"）
 * @output `missing[]`：`objects`/`relations`/`metrics`/`period`（按固定顺序去重）
 * @degraded 无
 * @authority 缺项判据只由本函数给出
 * @not_here 不判断内容质量（只判断"有没有"）
 * @error 无
 */
export function listMissing(facts, results) {
  const missing = [];
  if (facts.objects.length === 0) missing.push('objects');
  if (facts.relations.length === 0) missing.push('relations');
  if (facts.metrics.length === 0) missing.push('metrics');
  const anyPeriod = results.some(result => result.facts?.periodInfo != null);
  if (!anyPeriod) missing.push('period');
  return missing;
}
