/**
 * scripts/ingest-v0/lib/extract/report.mjs — 抽取报告、摘要行与**读对抽检**（纯函数 + 受控重读）。
 *
 * 为什么报告要独立：§7 验收要求「读对，不只读存在」——报告必须能给出
 * 「某条事实的原文串 + 来源指针 + 重读校验结果」，而不是只报条数。
 *
 * 脱敏口径（DEV DOC v2 §4）：原始资料不入证据；报告可保留数值与来源指针，
 * 对象名在**对外摘要**里脱敏（`maskName`），本机报告文件保留原名以便核对。
 */

import { loadDocument } from './documents.mjs';

/** 报告 schema 版本（形状变化必须递增）。 */
export const EXTRACT_REPORT_SCHEMA_VERSION = 'ingest-v0.extract.v1';

/**
 * 名称脱敏（对外回执/摘要用；本机报告仍保留原名）。
 *
 * @input  name —— 对象名（人员/团队）
 * @output 首字符 + `**`（CJK）或首字符 + `***`（拉丁）；空名 ⇒ `'**'`
 * @degraded 无
 * @authority 脱敏规则只由本函数给出（PR 回执必须用它，禁止回显全名）
 * @not_here 不脱敏数值/期间/文件路径
 * @error 无
 */
export function maskName(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (text.length === 0) return '**';
  return `${text.slice(0, 1)}${text.length > 1 ? '**' : '*'}`;
}

/** @input locator —— 来源定位串 @output `{tableIndex, rowIndex}` 或 null @degraded 无 @authority 本文件 @not_here 不做格式校验 @error 无 */
function parseTableLocator(locator) {
  if (typeof locator !== 'string') return null;
  const match = /(?:^|\/)(?:md-table|table)\[(\d+)\](?:\/row\[(\d+)\])?/.exec(locator) ??
    /table\[(\d+)\](?:\/row\[(\d+)\])?/.exec(locator);
  if (match === null) return null;
  return { tableIndex: Number(match[1]), rowIndex: match[2] === undefined ? null : Number(match[2]) };
}

/**
 * 在**重读**的资料里校验一条事实的 `sourceRef.raw` 确实存在（§7 读对抽检的机器部分）。
 *
 * @input  document —— `loadDocument` 产物（**重新加载**，不复用抽取期内存）
 *         fact —— `{sourceRef:{locator, raw}, value?}`
 * @output `{present:boolean, checkedBy:'cell'|'text', detail?}`：
 *           present=true 表示 raw 能在文档的对应表格行/文本中找到
 * @degraded 无：找不到 ⇒ present=false（报告据此判"原文没有"，不得放过）
 * @authority 判据 = "表格 locator 命中行内单元格文本严格相等" 或 "全文包含 raw"
 * @not_here 不判断语义正确性（谓词方向/单位由人工抽检 + 抽取规则测试负责）
 * @error 无
 */
export function checkFactInDocument(document, fact) {
  const raw = fact?.sourceRef?.raw;
  if (typeof raw !== 'string' || raw.length === 0) return { present: false, checkedBy: 'text', detail: '无 raw 可校验' };
  const locator = fact?.sourceRef?.locator;
  const parsed = parseTableLocator(locator);
  if (parsed !== null && Array.isArray(document.tables) && document.tables[parsed.tableIndex - 1] !== undefined) {
    const table = document.tables[parsed.tableIndex - 1];
    const rows = parsed.rowIndex === null ? table.rows : table.rows.filter(row => row.index === parsed.rowIndex);
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.raw === raw) return { present: true, checkedBy: 'cell' };
        // 关系的 raw 是「人员 | 团队」双值：逐个在同行单元格里核对
        if (raw.includes('|')) {
          const parts = raw.split('|').map(part => part.trim()).filter(part => part.length > 0);
          if (parts.length > 1 && parts.every(part => row.cells.some(item => item.raw === part))) {
            return { present: true, checkedBy: 'cell' };
          }
        }
      }
    }
  }
  return { present: document.text.includes(raw), checkedBy: 'text' };
}

/**
 * 抽样 5 条事实做读对抽检（对象名/关系/指标各取一条，再用其余对象补足）。
 *
 * @input  facts —— `aggregateFacts` 产物；fileIndex —— `Map<displayPath, localPath>`；
 *         alreadyLoaded —— 可选：`Map<displayPath, document>`（避免重复解析；测试可注入）
 * @output `{samples:[{kind, sourceRef:{file,locator,rawMasked}, present, checkedBy, value?}], checked}`
 * @degraded 无：样本不足 5 条就少给（**不编样本**）；重读失败 ⇒ present=false 并保留原因
 * @authority 抽样顺序 = 对象 → 关系 → 指标 → 其余对象（确定性）
 * @not_here 不做人工语义判断（谓词方向/单位正确性在回执里逐条声明）
 * @error 无
 */
export function verifyRead(facts, fileIndex, alreadyLoaded) {
  const samples = [];
  const picked = new Set();
  const addSample = (kind, fact, raw) => {
    const sourceRef = fact.props?.sourceRef ?? fact.sourceRef ?? {};
    const key = `${kind}:${sourceRef.file}:${sourceRef.locator}:${raw}`;
    if (picked.has(key) || samples.length >= 5) return;
    picked.add(key);
    const displayPath = sourceRef.file ?? '';
    let document = alreadyLoaded?.get(displayPath);
    if (document === undefined) {
      const localPath = fileIndex.get(displayPath);
      if (localPath === undefined) {
        samples.push({ kind, sourceRef: { file: displayPath, locator: sourceRef.locator ?? '', rawMasked: maskRaw(raw) }, present: false, checkedBy: 'none', detail: '文件未在本 run 清单内' });
        return;
      }
      try {
        document = loadDocument({ localPath, displayPath, type: inferTypeFromPath(displayPath) });
      } catch (err) {
        samples.push({ kind, sourceRef: { file: displayPath, locator: sourceRef.locator ?? '', rawMasked: maskRaw(raw) }, present: false, checkedBy: 'none', detail: err instanceof Error ? err.message : String(err) });
        return;
      }
      alreadyLoaded?.set(displayPath, document);
    }
    const checked = checkFactInDocument(document, { sourceRef: { locator: sourceRef.locator, raw } });
    const sample = {
      kind,
      sourceRef: { file: displayPath, locator: sourceRef.locator ?? '', rawMasked: maskRaw(raw) },
      present: checked.present,
      checkedBy: checked.checkedBy,
    };
    if (fact.value !== undefined) sample.value = fact.value;
    if (fact.unit !== undefined) sample.unit = fact.unit;
    samples.push(sample);
  };

  const firstObject = facts.objects[0];
  if (firstObject !== undefined) addSample('object', firstObject, firstObject.props.sourceRef.raw);
  const firstRelation = facts.relations[0];
  if (firstRelation !== undefined) addSample('relation', firstRelation, firstRelation.props.sourceRef.raw);
  const firstMetric = facts.metrics[0];
  if (firstMetric !== undefined) addSample('metric', firstMetric, firstMetric.sourceRef.raw);
  for (const object of facts.objects.slice(1)) addSample('object', object, object.props.sourceRef.raw);

  return { samples, checked: samples.length };
}

/** @input raw —— 原文串 @output 脱敏后的展示串（长数值保留，名称类截首字） @degraded 无 @authority 本文件 @not_here 无 @error 无 */
function maskRaw(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (/^\d/.test(text) || /^[¥￥]?\d/.test(text)) return text; // 数值/金额可保留（DEV DOC §4）
  return text
    .split('|')
    .map(part => maskName(part.trim()))
    .join(' | ');
}

/** @input displayPath —— 证据路径 @output 与 `loadDocument` 兼容的类型串 @degraded 无 @authority 本文件 @not_here 无 @error 无 */
function inferTypeFromPath(displayPath) {
  const name = displayPath.toLowerCase();
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (name.endsWith('.md')) return 'md';
  return 'txt';
}

/**
 * 构造抽取报告对象（纯；不写文件）。
 *
 * @input  input —— `{source, sourceKind, graph, dbPath, status, prepared, aggregated, persist, context,
 *         verify, insufficient, error, startedAt, finishedAt, durationMs, runDir}`
 * @output 可 JSON 化的报告（字段见 `EXTRACT_REPORT_SCHEMA_VERSION`）
 * @degraded 无：失败/不足都落成显式字段（不裁剪、不伪造）
 * @authority 状态与缺项由 `runExtract` 判定，本函数只装配
 * @not_here 不写文件、不脱敏本机报告
 * @error 无
 */
export function buildExtractReport(input) {
  const report = {
    schemaVersion: EXTRACT_REPORT_SCHEMA_VERSION,
    source: input.source,
    sourceKind: input.sourceKind,
    graph: input.graph,
    dbPath: input.dbPath,
    status: input.status,
    runDir: input.runDir,
    prepared: input.prepared,
    extraction: input.aggregated?.stats ?? null,
    facts: {
      objects: (input.aggregated?.objects ?? []).map(object => ({
        type: object.type,
        businessKey: object.businessKey,
        name: object.props?.name ?? '',
        period: object.props?.period ?? null,
        defVersion: object.props?.defVersion ?? null,
        sourceRef: object.props?.sourceRef ?? null,
        objectId: input.persist?.objectIds?.[object.businessKey] ?? null,
      })),
      relations: (input.aggregated?.relations ?? []).map(relation => ({
        type: relation.type,
        businessKey: relation.businessKey,
        fromBusinessKey: relation.fromBusinessKey,
        toBusinessKey: relation.toBusinessKey,
        sourceRef: relation.props?.sourceRef ?? null,
        objectId: input.persist?.objectIds?.[relation.businessKey] ?? null,
      })),
      metrics: (input.aggregated?.metrics ?? []).map(metric => ({
        objectBusinessKey: metric.objectBusinessKey,
        metricId: metric.metricId,
        value: metric.value,
        unit: metric.unit,
        period: metric.period,
        sourceRef: metric.sourceRef,
        written: input.persist?.metricResults?.[`${metric.objectBusinessKey}|${metric.metricId}|${metric.period}`] ?? null,
      })),
    },
    c4: input.context ?? null,
    verification: input.verify ?? null,
    insufficient: input.insufficient ?? null,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
  };
  if (input.error !== null && input.error !== undefined) {
    report.error = typeof input.error.toJSON === 'function' ? input.error.toJSON() : input.error;
  }
  return report;
}

/**
 * 一行摘要（stdout 契约；**只含计数与路径，不含客户内容**）。
 *
 * @input  report —— `buildExtractReport` 产物；outputPath —— 报告落盘路径
 * @output `INGEST-EXTRACT status=<s> files=<n> objects=<n> relations=<n> metrics=<n> c4=<count|n/a> out=<path>`
 * @degraded 无
 * @authority 字段名固定（回执/CI grep 依赖）
 * @not_here 不打印对象名
 * @error 无
 */
export function summarize(report, outputPath) {
  const parts = [
    'INGEST-EXTRACT',
    `status=${report.status}`,
    `files=${String(report.prepared?.files ?? 0)}`,
    `objects=${String(report.extraction?.objects?.total ?? 0)}`,
    `relations=${String(report.extraction?.relations?.total ?? 0)}`,
    `metrics=${String(report.extraction?.metrics?.total ?? 0)}`,
    `c4=${report.c4 === null || report.c4 === undefined ? 'n/a' : String(report.c4.count)}`,
    `out=${outputPath}`,
  ];
  if (report.error !== undefined && report.error !== null) parts.push(`code=${String(report.error.code)}`);
  return parts.join(' ');
}
