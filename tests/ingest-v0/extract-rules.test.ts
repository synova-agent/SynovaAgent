/**
 * tests/ingest-v0/extract-rules.test.ts — V2 规则抽取/判据（#1500）的**纯函数**验收。
 *
 * 覆盖（每条都能被判据号追）：
 *   · C2 期间：`数据周期 2026-08-01` ⇒ 2026-08；无期间 ⇒ period=null 且聚合层丢弃并计 missingPeriod；
 *   · C5 来源指针：每个对象都带 `sourceRef{file,locator,raw}`；
 *   · C8 去重：同一批资料重复出现 ⇒ 同 businessKey 合并为一条（duplicates 计数）；
 *   · C2 固定 defVersion：对象 props.defVersion === 'ingest-v0'；
 *   · C1 规则边界：非人名词（「销售经理」「全部」「确认•」）不得被抽成人员对象。
 *
 * 变异判据（人工执行，见 PR 回执）：
 *   ① 去掉期间提取 ⇒ 本文件「period 为 2026-08」断言红；
 *   ③ 去掉去重 ⇒ 本文件「唯一对象 4 / duplicates 4」断言红。
 */
import { describe, expect, it } from 'vitest';

import { parseCellNumber, normalizePersonName, normalizeTeamName, extractFactsFromDocument } from '../../scripts/ingest-v0/lib/extract/facts.mjs';
import { aggregateFacts, hasSourceRef, listMissing } from '../../scripts/ingest-v0/lib/extract/aggregate.mjs';
import { detectPeriod } from '../../scripts/ingest-v0/lib/extract/period.mjs';
import { htmlToText, parseTables, squeezeWhitespace } from '../../scripts/ingest-v0/lib/extract/html.mjs';

const SALES_TABLE_HTML = `
<h1>测试看板</h1>
<div>数据周期 2026-08-01 ~ 08-31</div>
<h2>销售员业绩排名</h2>
<table>
<tr><th>排名</th><th>销售</th><th>队</th><th>目标</th><th>业绩</th><th>达成率</th><th>名单</th></tr>
<tr><td>1</td><td>张测试</td><td>测试队</td><td>¥10,000</td><td>¥8,000</td><td>80.0%</td><td>100</td></tr>
<tr><td>2</td><td>李样例</td><td>样例队</td><td>¥20,000</td><td>¥10,000</td><td>50.0%</td><td>200</td></tr>
</table>`;

/** @input html —— 内联夹具 @output 与 `loadDocument` 同形的文档对象（无 I/O） @degraded 无 @authority 文档形状 = documents.mjs @not-here 不读文件 @error 无 */
function htmlDocument(html: string, displayPath = 'fixture.html') {
  const tables = parseTables(html);
  const text = htmlToText(html);
  const paragraphs = text
    .split('\n')
    .map((line, index) => ({ index: index + 1, text: squeezeWhitespace(line), locator: `text[${String(index + 1)}]` }))
    .filter(item => item.text.length > 0);
  return { kind: 'html', displayPath, localPath: '', text, paragraphs, tables, truncated: false, corrupt: false };
}

describe('V2 规则层 — 期间识别（C2）', () => {
  it('「数据周期 2026-08-01」⇒ 2026-08，且带命中位置', () => {
    const found = detectPeriod('数据周期 2026-08-01 ~ 08-26');
    expect(found).not.toBeNull();
    expect(found.period).toBe('2026-08');
    expect(found.pattern).toBe('cycle-label');
    expect(found.line).toBe(1);
  });

  it('「2026年8月起」⇒ 2026-08；无年月 ⇒ null（不猜当前月）', () => {
    expect(detectPeriod('经营周期 2026年8月起（周更）').period).toBe('2026-08');
    expect(detectPeriod('没有任何日期的制度文档')).toBeNull();
    expect(detectPeriod('2026-13-01')).toBeNull();
  });
});

describe('V2 规则层 — 数值/名称判据', () => {
  it('金额/百分比/万 可解析；带解释文字不解析', () => {
    expect(parseCellNumber('¥90,000')).toEqual({ value: 90000, scale: 1, percent: false });
    expect(parseCellNumber('68.0%')).toEqual({ value: 68, scale: 1, percent: true });
    expect(parseCellNumber('70.0万')).toEqual({ value: 700000, scale: 1e4, percent: false });
    expect(parseCellNumber('70.0万（达成率59.3%）')).toBeNull();
    expect(parseCellNumber('—')).toBeNull();
  });

  it('角色词/汇总词不当人名；团队名必须有组织后缀', () => {
    expect(normalizePersonName('销售经理')).toBeNull();
    expect(normalizePersonName('全部')).toBeNull();
    expect(normalizePersonName('确认•')).toBeNull();
    expect(normalizePersonName('张测试')).toBe('张测试');
    expect(normalizeTeamName('奖励团建活动经费')).toBeNull();
    expect(normalizeTeamName('管理层述职整改')).toBeNull();
    expect(normalizeTeamName('测试队')).toBe('测试队');
    expect(normalizeTeamName('客服组')).toBe('客服组');
  });
});

describe('V2 规则层 — 表抽取（对象/关系/指标 + sourceRef）', () => {
  const document = htmlDocument(SALES_TABLE_HTML);
  const facts = extractFactsFromDocument(document);
  const aggregated = aggregateFacts([{ doc: document, facts }]);

  it('期间来自资料：2026-08', () => {
    expect(facts.periodInfo.period).toBe('2026-08');
  });

  it('对象：2 人 + 2 队；每条带 period/defVersion/sourceRef', () => {
    expect(aggregated.objects).toHaveLength(4);
    expect(aggregated.objects.filter(object => object.type === 'resource/person')).toHaveLength(2);
    expect(aggregated.objects.filter(object => object.type === 'resource/team')).toHaveLength(2);
    for (const object of aggregated.objects) {
      expect(object.props.period).toBe('2026-08');
      expect(object.props.defVersion).toBe('ingest-v0');
      expect(hasSourceRef(object.props.sourceRef)).toBe(true);
    }
    const person = aggregated.objects.find(object => object.props.name === '张测试');
    expect(person.props.sourceRef).toEqual({
      file: 'fixture.html',
      locator: 'table[1]/row[1]/col[销售]',
      raw: '张测试',
    });
  });

  it('关系：person → team，谓词与方向正确', () => {
    expect(aggregated.relations).toHaveLength(2);
    const relation = aggregated.relations.find(item => item.businessKey === 'member_of_team/张测试@测试队');
    expect(relation.type).toBe('edge/member_of_team');
    expect(relation.fromBusinessKey).toBe('person/张测试');
    expect(relation.toBusinessKey).toBe('team/测试队');
    expect(relation.props.sourceRef.locator).toBe('table[1]/row[1]');
  });

  it('指标：数值/单位/期间与单元格一致', () => {
    expect(aggregated.metrics).toHaveLength(8);
    const target = aggregated.metrics.find(metric => metric.objectBusinessKey === 'person/张测试' && metric.metricId === 'sales.target');
    expect(target).toMatchObject({ value: 10000, unit: 'CNY', period: '2026-08' });
    expect(target.sourceRef).toEqual({ file: 'fixture.html', locator: 'table[1]/row[1]/col[目标]', raw: '¥10,000' });
    const attainment = aggregated.metrics.find(metric => metric.metricId === 'sales.attainment' && metric.objectBusinessKey === 'person/李样例');
    expect(attainment.value).toBe(50);
    expect(attainment.unit).toBe('%');
  });
});

describe('V2 规则层 — 缺期间/缺来源/去重（C2/C5/C8）', () => {
  const noPeriodHtml = SALES_TABLE_HTML.replace('数据周期 2026-08-01 ~ 08-31', '');

  it('无期间 ⇒ 对象不落库并计 missingPeriod（不编期间）', () => {
    const document = htmlDocument(noPeriodHtml);
    const facts = extractFactsFromDocument(document);
    expect(facts.periodInfo).toBeNull();
    for (const object of facts.objects) expect(object.props.period).toBeNull();
    const aggregated = aggregateFacts([{ doc: document, facts }]);
    expect(aggregated.objects).toHaveLength(0);
    expect(aggregated.relations).toHaveLength(0);
    expect(aggregated.metrics).toHaveLength(0);
    expect(aggregated.stats.objects.missingPeriod).toBe(4);
    expect(aggregated.stats.metrics.missingPeriod).toBe(8);
    expect(listMissing(aggregated, [{ doc: document, facts }])).toContain('period');
  });

  it('同 businessKey 重复出现 ⇒ 合并一条，duplicates 可解释', () => {
    const first = htmlDocument(SALES_TABLE_HTML, 'copy-1.html');
    const second = htmlDocument(SALES_TABLE_HTML, 'copy-2.html');
    const results = [
      { doc: first, facts: extractFactsFromDocument(first) },
      { doc: second, facts: extractFactsFromDocument(second) },
    ];
    const aggregated = aggregateFacts(results);
    expect(aggregated.stats.raw.objects).toBe(8);
    expect(aggregated.objects).toHaveLength(4); // 4 个唯一对象（不重复落库）
    expect(aggregated.stats.objects.duplicates).toBe(4);
    expect(aggregated.relations).toHaveLength(2);
    expect(aggregated.stats.relations.duplicates).toBe(2);
    expect(aggregated.metrics).toHaveLength(8);
    expect(aggregated.stats.metrics.duplicates).toBe(8);
    // 保留首个来源指针（copy-1），不覆盖首见证据
    expect(aggregated.objects.every(object => object.props.sourceRef.file === 'copy-1.html')).toBe(true);
  });

  it('同指标键不同数值 ⇒ 计 conflict 并保留首个（不取平均）', () => {
    const first = htmlDocument(SALES_TABLE_HTML, 'copy-1.html');
    const second = htmlDocument(SALES_TABLE_HTML.replace('¥10,000', '¥11,000'), 'copy-2.html');
    const aggregated = aggregateFacts([
      { doc: first, facts: extractFactsFromDocument(first) },
      { doc: second, facts: extractFactsFromDocument(second) },
    ]);
    expect(aggregated.stats.metrics.conflicts).toBe(1);
    const target = aggregated.metrics.find(metric => metric.objectBusinessKey === 'person/张测试' && metric.metricId === 'sales.target');
    expect(target.value).toBe(10000);
  });

  it('缺 sourceRef 的事实被丢弃并计数（C5）', () => {
    const document = htmlDocument(SALES_TABLE_HTML);
    const facts = extractFactsFromDocument(document);
    facts.objects.push({ type: 'resource/person', businessKey: 'person/无来源', props: { name: '无来源', period: '2026-08', defVersion: 'ingest-v0' } });
    const aggregated = aggregateFacts([{ doc: document, facts }]);
    expect(aggregated.stats.objects.missingSourceRef).toBe(1);
    expect(aggregated.objects.find(object => object.props.name === '无来源')).toBeUndefined();
  });
});

describe('V2 规则层 — C1 无模型证据（静态）', () => {
  it('抽取库源码不含网络/模型调用（零外发）', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, '../../scripts/ingest-v0');
    const files = fs
      .readdirSync(root, { recursive: true })
      .filter(name => typeof name === 'string' && name.endsWith('.mjs'))
      .map(name => path.join(root, name));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/node:https?/);
      expect(source).not.toMatch(/\bllm\b|openai|anthropic|deepseek/i);
    }
  });
});
