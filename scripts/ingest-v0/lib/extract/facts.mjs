/**
 * scripts/ingest-v0/lib/extract/facts.mjs — **规则抽取**：把一份已解析资料变成候选事实（纯函数，零 I/O、零模型）。
 *
 * 这是 V2 的核心判据层（C1：不用大模型）。规则只认两类**资料里明写的结构**：
 *   ① 实体表：表头含「销售/姓名/负责人」＋数值列（目标/业绩/达成率/…）⇒ 人、队、关系、指标；
 *   ② 明写句式：`<团队>负责人：<人名>` / `负责人：<人名>` / `部门：<团队>` ⇒ 人/队/关系。
 * 资料没明写的**一律不造**（C6）；期间取 `detectPeriod`（C2；拿不到 ⇒ period=null，由聚合层丢弃并计数）。
 *
 * 已知限制（登记，不在本票修）：
 *   · 关系谓词用 V0 约定 `edge/member_of_team`（方向 person→team；语义与资料「队」列一致；
 *     该谓词尚未登记进本体 edge-types，属本体侧后续登记项，不是本票写集）；
 *   · 只处理"一行一个实体"的表；合并单元格/多级表头不猜列位；
 *   · 表头必须是本文件 `PERSON_HEADERS`/`TEAM_HEADERS`/`METRIC_COLUMNS` 中的写法（同义词可追加）。
 */

import { detectPeriod } from './period.mjs';
import { squeezeWhitespace } from './html.mjs';

/** V2 固定本体定义版本（C2：系统语义，可由系统给默认值）。 */
export const INGEST_DEF_VERSION = 'ingest-v0';

/** 关系谓词（V0 约定；person → team）。 */
export const MEMBER_OF_TEAM_EDGE = 'edge/member_of_team';

/** 人员列的表头写法（去空白后精确匹配）。 */
const PERSON_HEADERS = Object.freeze(['销售', '姓名', '负责人', '员工', '人员', '销售员']);
/** 团队列的表头写法。 */
const TEAM_HEADERS = Object.freeze(['队', '团队', '部门', '战队', '小组', '所属团队']);

/**
 * 指标列白名单：表头 → `{metricId, unit, kind}`（未登记的列**不抽取**，避免把诊断文本当指标）。
 * `kind` 只用于报告归类（金额/比率/计数/分数）。
 */
const METRIC_COLUMNS = Object.freeze({
  目标: { metricId: 'sales.target', unit: 'CNY', kind: 'money' },
  业绩: { metricId: 'sales.performance', unit: 'CNY', kind: 'money' },
  达成率: { metricId: 'sales.attainment', unit: '%', kind: 'ratio' },
  名单: { metricId: 'sales.lead_count', unit: 'count', kind: 'count' },
  取模: { metricId: 'sales.cast_count', unit: 'count', kind: 'count' },
  套餐: { metricId: 'sales.package_count', unit: 'count', kind: 'count' },
  非套餐: { metricId: 'sales.non_package_count', unit: 'count', kind: 'count' },
  成交转换率: { metricId: 'sales.conversion_rate', unit: '%', kind: 'ratio' },
  成交客单价: { metricId: 'sales.avg_deal_amount', unit: 'CNY', kind: 'money' },
  免单率: { metricId: 'sales.free_rate', unit: '%', kind: 'ratio' },
  健康度: { metricId: 'sales.health_score', unit: 'score', kind: 'score' },
  剩余日均需追: { metricId: 'sales.daily_gap', unit: 'CNY', kind: 'money' },
});

/** 表头/单元格里不能当实体名的通用词（防止把汇总行抽成对象）。 */
const NON_ENTITY_WORDS = new Set(['合计', '总计', '平均', '小计', '全员', '团队', '销售', '姓名', '排名', '周', '月', '本周', '上周', '全部', '老板', '每月', '所有人', '本人', '其他', '无', '未归队', '待定', '暂无']);

/** 岗位/角色词后缀：出现在"负责人"后面的常是角色而不是人名（如「销售经理」）——不把人名规则用错。 */
const ROLE_SUFFIXES = Object.freeze(['经理', '主管', '负责人', '专员', '助理', '总监', '主任', '组长', '队长', '会计', '出纳', '文员', '顾问', '总裁', '老师', '教练']);
/** 人名里不应出现的虚词片段（「唯一负责」这类截断不是人名）。 */
const BAD_NAME_FRAGMENTS = Object.freeze(['负责', '唯一', '主要', '相关', '全体', '所有', '上述', '以下', '确认', '裁定', '统计', '每月', '全部']);
/** 团队名必须以组织单位后缀结尾（否则「奖励团建活动经费」「管理层述职整改」会被当团队）。 */
const TEAM_SUFFIXES = Object.freeze(['组', '部', '队', '团队', '战队', '中心', '池']);

/**
 * 人员名合法性（**不猜**：只认 2–20 个 CJK/字母/间隔号，且不是汇总词）。
 *
 * @input  raw —— 单元格原文
 * @output 归一后的名字或 `null`
 * @degraded 无：不合法 ⇒ null（调用方跳过该行，不修补）
 * @authority 判据只由本函数给出（C8 去重键复用其输出）
 * @not_here 不做繁简/全半角转换（保留原文，便于与资料逐字核对）
 * @error 无
 */
export function normalizePersonName(raw) {
  const text = squeezeWhitespace(raw).replace(/[\u200b-\u200d\ufeff]/g, '');
  if (text.length < 2 || text.length > 20) return null;
  if (!/^[\u3400-\u9fff·•A-Za-z][\u3400-\u9fff·•A-Za-z\s]*$/.test(text)) return null;
  if (NON_ENTITY_WORDS.has(text)) return null;
  if (ROLE_SUFFIXES.some(suffix => text.endsWith(suffix))) return null;
  if (BAD_NAME_FRAGMENTS.some(fragment => text.includes(fragment))) return null;
  if (/[·•]$/.test(text)) return null;
  return text;
}

/**
 * 团队名合法性（允许数字，如「一队/3组」；拒绝汇总词与纯数字）。
 *
 * @input  raw —— 单元格原文
 * @output 归一后的团队名或 `null`
 * @degraded 无：不合法 ⇒ null
 * @authority 判据只由本函数给出
 * @not_here 不做同义合并（「甲队」≠「甲战队」）
 * @error 无
 */
export function normalizeTeamName(raw) {
  const text = squeezeWhitespace(raw).replace(/[\u200b-\u200d\ufeff]/g, '');
  if (text.length < 2 || text.length > 30) return null;
  if (!/[\u3400-\u9fffA-Za-z]/.test(text)) return null;
  if (!/^[\u3400-\u9fff·•A-Za-z0-9()（）\-\s]+$/.test(text)) return null;
  if (NON_ENTITY_WORDS.has(text)) return null;
  if (!TEAM_SUFFIXES.some(suffix => text.endsWith(suffix))) return null;
  return text;
}

/**
 * 解析单元格里的数值与单位（只认"纯数值 + 可选 ¥/万/%"形态；带解释文字的列不抽）。
 *
 * @input  raw —— 单元格原文（如 `¥90,000`、`68.0%`、`70.0万`）
 * @output 合法 ⇒ `{value, scale}`（value 已按 万/亿 放大、百分号不放大）；否则 `null`
 * @degraded 无：解析不了 ⇒ null（**不取子串、不猜数字**）
 * @authority 数值语法只由本函数给出
 * @not_here 不做四舍五入（保留资料原精度）；不判断指标单位是否合理
 * @error 无
 */
export function parseCellNumber(raw) {
  const text = squeezeWhitespace(raw)
    .replace(/^[¥￥$]\s*/, '')
    .replace(/\s+/g, '');
  if (text.length === 0) return null;
  const match = /^(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)(万|亿|%|％)?$/.exec(text);
  if (match === null) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const suffix = match[2];
  const scale = suffix === '万' ? 1e4 : suffix === '亿' ? 1e8 : 1;
  return { value: value * scale, scale, percent: suffix === '%' || suffix === '％' };
}

/** @input text —— 任意文本 @output 去空白后的去重键片段（`/` 换成全角，避免键歧义） @degraded 无 @authority 本文件 @not_here 不做拼音化 @error 无 */
function keySlug(text) {
  return squeezeWhitespace(text).replace(/\s+/g, '').replace(/\//g, '／');
}

/**
 * 建对象事实（**唯一**注入 `defVersion` 的位置；C2 的固定值 + C5 的来源指针都在这里）。
 *
 * @input  kind —— `'person'|'team'`；name —— 归一名称；context —— `{file, period}`；sourceRef —— `{locator, raw}`
 * @output 对象事实：`{type, businessKey, props:{name, period, defVersion, sourceRef}}`
 * @degraded 无：调用方必须先保证 name/period 合法
 * @authority `defVersion` 值 = `INGEST_DEF_VERSION`；businessKey 规则 = `<kind>/<nameSlug>`
 * @not_here 不写库（由 persist 层负责）
 * @error 无
 */
function buildObject(kind, name, context, sourceRef) {
  const type = kind === 'person' ? 'resource/person' : 'resource/team';
  return {
    type,
    businessKey: `${kind}/${keySlug(name)}`,
    props: {
      name,
      period: context.period,
      defVersion: INGEST_DEF_VERSION,
      sourceRef: { file: context.file, locator: sourceRef.locator, raw: sourceRef.raw },
    },
  };
}

/**
 * 建关系事实（person → team；端点 businessKey 必须同批存在）。
 *
 * @input  personName/teamName —— 归一名称；context —— `{file}`；sourceRef —— `{locator, raw}`
 * @output 关系事实：`{type, businessKey, fromBusinessKey, toBusinessKey, props:{sourceRef}}`
 * @degraded 无
 * @authority 谓词 = `MEMBER_OF_TEAM_EDGE`；键 = `member_of_team/<person>@<team>`
 * @not_here 不建端点对象（调用方必须同时产出）
 * @error 无
 */
function buildMemberRelation(personName, teamName, context, sourceRef) {
  const personSlug = keySlug(personName);
  const teamSlug = keySlug(teamName);
  return {
    type: MEMBER_OF_TEAM_EDGE,
    businessKey: `member_of_team/${personSlug}@${teamSlug}`,
    fromBusinessKey: `person/${personSlug}`,
    toBusinessKey: `team/${teamSlug}`,
    props: { sourceRef: { file: context.file, locator: sourceRef.locator, raw: sourceRef.raw } },
  };
}

/**
 * 建指标事实（**挂到已抽出的人员对象**；无对象锚点不产指标）。
 *
 * @input  objectBusinessKey —— 人员对象键；metric —— `{metricId, unit}`；value —— 有限数值；
 *         period —— `YYYY-MM`；context —— `{file}`；sourceRef —— `{locator, raw}`
 * @output 指标事实：`{objectBusinessKey, metricId, value, unit, period, sourceRef}`
 * @degraded 无
 * @authority 指标名列 = `METRIC_COLUMNS`
 * @not_here 不做跨期聚合/同比
 * @error 无
 */
function buildMetric(objectBusinessKey, metric, value, period, context, sourceRef) {
  return {
    objectBusinessKey,
    metricId: metric.metricId,
    value,
    unit: metric.unit,
    period,
    sourceRef: { file: context.file, locator: sourceRef.locator, raw: sourceRef.raw },
  };
}

/** @input headers —— 表头数组；candidates —— 候选写法数组 @output 首个命中的列下标或 -1 @degraded 无 @authority 本文件 @not_here 无 @error 无 */
function findHeaderIndex(headers, candidates) {
  for (let index = 0; index < headers.length; index += 1) {
    if (candidates.includes(squeezeWhitespace(headers[index]))) return index;
  }
  return -1;
}

/**
 * 从一张实体表抽事实（人员/团队/关系/指标）。
 *
 * @input  table —— `{index, headers, rows, locator}`（HTML/docx/pptx/md 同形）；context —— `{file, period}`
 * @output `{objects, relations, metrics, skippedRows}`：
 *           skippedRows —— `[{locator, reason}]`（名称/团队列缺失等，**不静默**）
 * @degraded 无：不合格行逐条记 skippedRows
 * @authority 表头识别 = `PERSON_HEADERS`/`TEAM_HEADERS`/`METRIC_COLUMNS`
 * @not_here 不区分"表是诊断表还是业绩表"（靠表头白名单兜底）
 * @error 无
 */
function extractEntityTable(table, context) {
  const objects = [];
  const relations = [];
  const metrics = [];
  const skippedRows = [];
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const personCol = findHeaderIndex(headers, PERSON_HEADERS);
  if (personCol === -1) return { objects, relations, metrics, skippedRows };
  const teamCol = findHeaderIndex(headers, TEAM_HEADERS);

  for (const row of table.rows) {
    const cells = row.cells;
    const nameRaw = cells[personCol]?.raw ?? '';
    const name = normalizePersonName(nameRaw);
    if (name === null) {
      skippedRows.push({ locator: row.locator, reason: 'invalid_person_name' });
      continue;
    }
    const personLocator = `${row.locator}/col[${headers[personCol] ?? String(personCol + 1)}]`;
    objects.push(buildObject('person', name, context, { locator: personLocator, raw: nameRaw }));
    const personKey = `person/${keySlug(name)}`;

    let team = null;
    if (teamCol !== -1) {
      const teamRaw = cells[teamCol]?.raw ?? '';
      team = normalizeTeamName(teamRaw);
      if (team !== null) {
        const teamLocator = `${row.locator}/col[${headers[teamCol] ?? String(teamCol + 1)}]`;
        objects.push(buildObject('team', team, context, { locator: teamLocator, raw: teamRaw }));
        relations.push(
          buildMemberRelation(name, team, context, {
            locator: `${row.locator}`,
            raw: `${nameRaw} | ${teamRaw}`,
          }),
        );
      } else if (teamRaw.length > 0) {
        skippedRows.push({ locator: row.locator, reason: 'invalid_team_name' });
      }
    }

    for (let colIndex = 0; colIndex < cells.length; colIndex += 1) {
      const header = squeezeWhitespace(headers[colIndex] ?? '');
      const metric = METRIC_COLUMNS[header];
      if (metric === undefined) continue;
      const raw = cells[colIndex]?.raw ?? '';
      const parsed = parseCellNumber(raw);
      if (parsed === null) continue;
      metrics.push(
        buildMetric(personKey, metric, parsed.value, context.period, context, {
          locator: `${row.locator}/col[${header}]`,
          raw,
        }),
      );
    }
  }
  return { objects, relations, metrics, skippedRows };
}

/**
 * 从资料段落/行里抽"明写句式"事实（表之外的补充证据；只认 `负责人/部门` 两类）。
 *
 * @input  paragraphs —— `[{index, text, locator}]`；context —— `{file, period}`
 * @output `{objects, relations, metrics:[]}`（无表时不产指标 —— 指标必须能落到具体对象且数值可核）
 * @degraded 无：句式不匹配 ⇒ 零产出（不猜）
 * @authority 句式与命名判据 = 本函数 + `normalizePersonName`/`normalizeTeamName`
 * @not_here 不做 NER/实体链接；跨段落配对不做
 * @error 无
 */
function extractParagraphFacts(paragraphs, context) {
  const objects = [];
  const relations = [];
  for (const paragraph of paragraphs) {
    const text = paragraph.text;
    // ① 「<团队>负责人：<人名>」——团队负责人是资料明写的归属关系
    const teamHead = /(?:^|[^\u3400-\u9fffA-Za-z0-9])([\u3400-\u9fffA-Za-z0-9]{2,10}(?:组|部|团队|战队|中心|队))\s*负责人\s*[:：]?\s*([\u3400-\u9fff·•]{2,4})(?=[\s，。；、|｜,;:：]|$)/.exec(text);
    if (teamHead !== null) {
      const team = normalizeTeamName(teamHead[1]);
      const person = normalizePersonName(teamHead[2]);
      if (team !== null && person !== null) {
        const locator = paragraph.locator;
        objects.push(buildObject('team', team, context, { locator, raw: teamHead[1] }));
        objects.push(buildObject('person', person, context, { locator, raw: teamHead[2] }));
        relations.push(buildMemberRelation(person, team, context, { locator, raw: squeezeWhitespace(teamHead[0]) }));
        continue;
      }
    }
    // ② 「负责人：<人名>」——只建人员对象（没有团队上下文时不猜归属）
    const personOnly = /负责人\s*[:：]\s*([\u3400-\u9fff·•]{2,4})(?=[\s，。；、|｜,;:：]|$)/.exec(text);
    if (personOnly !== null) {
      const person = normalizePersonName(personOnly[1]);
      if (person !== null) {
        objects.push(buildObject('person', person, context, { locator: paragraph.locator, raw: personOnly[1] }));
      }
    }
    // ③ 「部门/团队：<团队名>」——只建团队对象
    const teamOnly = /(?:部门|团队|战队|所属团队)\s*[:：]\s*([^\s，。；、]{2,30})/.exec(text);
    if (teamOnly !== null) {
      const team = normalizeTeamName(teamOnly[1]);
      if (team !== null) {
        objects.push(buildObject('team', team, context, { locator: paragraph.locator, raw: teamOnly[1] }));
      }
    }
  }
  return { objects, relations, metrics: [] };
}

/**
 * 对一份已解析资料做规则抽取（**总入口**；纯函数）。
 *
 * @input  document —— `{kind, displayPath, localPath, text, paragraphs, tables, truncated}`；
 *         options.periodOverride —— 可选：调用方已按文件级证据确定的期间（缺省用 `detectPeriod(text)`）
 * @output `{periodInfo, objects, relations, metrics, skippedRows}`：
 *           periodInfo —— `detectPeriod` 结果或 `null`（null ⇒ 该文件全部事实 period=null，聚合层丢弃并计 missingPeriod）
 * @degraded 无：抽不到 ⇒ 空数组（**不填默认值**）
 * @authority 期间 = `detectPeriod`；事实规则 = 本文件的表/句式规则
 * @not_here 不做文件 I/O、不去重、不落库
 * @error 无（纯函数，不抛）
 */
export function extractFactsFromDocument(document, options = {}) {
  const periodInfo = options.periodOverride ?? detectPeriod(document.text ?? '');
  const period = periodInfo === null ? null : periodInfo.period;
  const context = { file: document.displayPath, period };
  const objects = [];
  const relations = [];
  const metrics = [];
  const skippedRows = [];

  for (const table of document.tables ?? []) {
    const tableFacts = extractEntityTable(table, context);
    objects.push(...tableFacts.objects);
    relations.push(...tableFacts.relations);
    metrics.push(...tableFacts.metrics);
    skippedRows.push(...tableFacts.skippedRows);
  }
  const paragraphFacts = extractParagraphFacts(document.paragraphs ?? [], context);
  objects.push(...paragraphFacts.objects);
  relations.push(...paragraphFacts.relations);
  metrics.push(...paragraphFacts.metrics);

  return { periodInfo, objects, relations, metrics, skippedRows };
}
