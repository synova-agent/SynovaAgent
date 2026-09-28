/**
 * tests/agent/report-depth.test.ts — D1051 W1 呈现粒度轴单测（铁律 33: *.test.ts = 单元）
 *
 * 覆盖（spec §5.1 T1 三路径 + §7.3 判别性夹具 J3/J4）:
 *   正常路径 —— 两值全映射；词表两方向全部命中正确方向
 *   降级路径 —— 非法值 → undefined（调用方据此回退 + 记降级，不静默）；非字符串/空串 → matched:false
 *   边界条件 —— 最长匹配优先（`讲细一点` 不得被 `细一点` 截断）；同长词码点字典序稳定；
 *               同输入同输出（确定性）；章节标题五章单源
 *
 * 断言约定：词表**在测试内独立重述**（spec §4.5 Q3 / §5.2 原文），不从被测模块导入
 * ——避免"用被测代码验证被测代码"。降级标记一律 ASCII `[degraded]`（D480 先例）。
 */
import { describe, it, expect } from 'vitest';
import {
  REPORT_VIEW_DEPTHS,
  DEFAULT_REPORT_VIEW_DEPTH,
  VIEW_TO_ONEPAGER_DEPTH,
  DETAILED_REPORT_CHAPTER_TITLES,
  normalizeReportViewDepth,
  resolveViewDepthFromUtterance,
} from '../../src/agent/report-depth';

// ═══ 词表独立重述（spec §4.5 Q3 收敛检查原文）═══

const DETAILED_WORDS = [
  '讲细一点', '再详细一点', '详细', '细一点', '展开', '深一点', '再深', '完整报告', '全量',
] as const;

const ONE_PAGER_WORDS = [
  '说人话', '一句话', '概览', '简单说', '太长了', '看不懂', '简短', '总结一下',
] as const;

// ═══ 正常路径 ═══

describe('D1051 W1: 呈现粒度轴——正常路径', () => {
  it('① 取值域恰 2 值 {one_pager, detailed}，默认 = one_pager', () => {
    expect([...REPORT_VIEW_DEPTHS]).toEqual(['one_pager', 'detailed']);
    expect(REPORT_VIEW_DEPTHS).toHaveLength(2);
    expect(DEFAULT_REPORT_VIEW_DEPTH).toBe('one_pager');
  });

  it('② 呈现轴 → 一页纸深度映射两值全备（one_pager→ceo，detailed→flywheel）', () => {
    expect(VIEW_TO_ONEPAGER_DEPTH.one_pager).toBe('ceo');
    expect(VIEW_TO_ONEPAGER_DEPTH.detailed).toBe('flywheel');
    // 两值全备（无遗漏键 → 不会出现 undefined 落到渲染器）
    expect(Object.keys(VIEW_TO_ONEPAGER_DEPTH).sort()).toEqual(['detailed', 'one_pager']);
  });

  it('③ normalizeReportViewDepth：两合法值各自原样返回（不误报非法）', () => {
    expect(normalizeReportViewDepth('one_pager')).toBe('one_pager');
    expect(normalizeReportViewDepth('detailed')).toBe('detailed');
  });

  it('④ 词表两方向全部命中正确方向（detailed 9 词 / one_pager 8 词，逐词断言）', () => {
    for (const word of DETAILED_WORDS) {
      const r = resolveViewDepthFromUtterance(word);
      expect(r.matched).toBe(true);
      expect(r.depth).toBe('detailed');
      if (r.matched) expect(r.keyword).toBe(word);
    }
    for (const word of ONE_PAGER_WORDS) {
      const r = resolveViewDepthFromUtterance(word);
      expect(r.matched).toBe(true);
      expect(r.depth).toBe('one_pager');
      if (r.matched) expect(r.keyword).toBe(word);
    }
  });

  it('⑤ 句子内嵌词也命中（includes 语义，非全等匹配）', () => {
    const r = resolveViewDepthFromUtterance('这个报告我看不太懂，能不能讲细一点？');
    expect(r.matched).toBe(true);
    expect(r.depth).toBe('detailed');
    if (r.matched) expect(r.keyword).toBe('讲细一点');
  });
});

// ═══ 降级路径 ═══

describe('D1051 W1: 呈现粒度轴——降级路径', () => {
  it('⑥ 非法值 → undefined（装配轴词 expert/raw/ceo/flywheel 一律不通用——DS1）', () => {
    // 装配轴四词：属 ReportDepth，不得被呈现轴接受（两轴正交的判别性断言）
    expect(normalizeReportViewDepth('expert')).toBeUndefined();
    expect(normalizeReportViewDepth('raw')).toBeUndefined();
    expect(normalizeReportViewDepth('ceo')).toBeUndefined();
    expect(normalizeReportViewDepth('flywheel')).toBeUndefined();
    // 边界值/畸形值
    expect(normalizeReportViewDepth('')).toBeUndefined();
    expect(normalizeReportViewDepth('0')).toBeUndefined();
    expect(normalizeReportViewDepth('-1')).toBeUndefined();
    expect(normalizeReportViewDepth('ONE_PAGER')).toBeUndefined(); // 大小写敏感
    expect(normalizeReportViewDepth('one-pager')).toBeUndefined(); // 连字符不等价
    expect(normalizeReportViewDepth(' detailed ')).toBeUndefined(); // 不 trim（不猜测用户意图）
  });

  it('⑦ 非字符串值 → undefined（不抛、不静默强转）', () => {
    expect(normalizeReportViewDepth(undefined)).toBeUndefined();
    expect(normalizeReportViewDepth(null)).toBeUndefined();
    expect(normalizeReportViewDepth(123)).toBeUndefined();
    expect(normalizeReportViewDepth(true)).toBeUndefined();
    expect(normalizeReportViewDepth({})).toBeUndefined();
    expect(normalizeReportViewDepth(['detailed'])).toBeUndefined();
  });

  it('⑧ 判别降级：非字符串 / 空串 → matched:false + 默认值（调用方零行为变化）', () => {
    for (const bad of [undefined, null, 123, true, {}, []]) {
      const r = resolveViewDepthFromUtterance(bad);
      expect(r.matched).toBe(false);
      expect(r.depth).toBe(DEFAULT_REPORT_VIEW_DEPTH);
    }
    const empty = resolveViewDepthFromUtterance('');
    expect(empty.matched).toBe(false);
    expect(empty.depth).toBe('one_pager');
  });

  it('⑨ 不含任何词的长句 → matched:false（不猜、不切换）', () => {
    const r = resolveViewDepthFromUtterance('我们下周一开个会讨论一下第三季度的招聘计划吧');
    expect(r.matched).toBe(false);
    expect(r.depth).toBe('one_pager');
  });
});

// ═══ 边界条件 ═══

describe('D1051 W1: 呈现粒度轴——边界条件', () => {
  it('⑩ 最长匹配优先：`讲细一点` 命中 detailed 且 keyword 恰为 `讲细一点`（J4）', () => {
    const r = resolveViewDepthFromUtterance('讲细一点');
    expect(r.matched).toBe(true);
    expect(r.depth).toBe('detailed');
    // 若词表未按长度降序排，`细一点` 会先命中 → keyword 变成 `细一点` ⇒ 本断言报红
    if (r.matched) expect(r.keyword).toBe('讲细一点');
  });

  it('⑪ 最长匹配优先：`再详细一点`（5 字，全表最长）不被 `详细`（2 字）截断', () => {
    const r = resolveViewDepthFromUtterance('再详细一点');
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.keyword).toBe('再详细一点');
  });

  it('⑫ 同长词码点字典序稳定：跨方向同长命中时判定唯一且可预期', () => {
    // 2 字组跨方向：码点 全(U+5168) < 概(U+6982) ⇒ `全量` 先命中 → detailed
    const a = resolveViewDepthFromUtterance('全量 概览');
    expect(a.matched).toBe(true);
    expect(a.depth).toBe('detailed');
    if (a.matched) expect(a.keyword).toBe('全量');

    // 4 字组同方向：码点 完(U+5B8C) < 讲(U+8BB2) ⇒ `完整报告` 先命中
    const b = resolveViewDepthFromUtterance('讲细一点，完整报告');
    expect(b.matched).toBe(true);
    if (b.matched) expect(b.keyword).toBe('完整报告');
  });

  it('⑬ 确定性：同输入两次调用结果深等（无时刻/无随机——DS8）', () => {
    const input = '这个数据我看不懂，说人话，顺便把全量的人也细一点';
    const first = resolveViewDepthFromUtterance(input);
    const second = resolveViewDepthFromUtterance(input);
    expect(second).toEqual(first);
    // 规范化同为纯函数
    expect(normalizeReportViewDepth('detailed')).toBe(normalizeReportViewDepth('detailed'));
  });

  it('⑭ 章节标题单源恰五章且顺序固定（W3 装配 + L3 数据双面共用）', () => {
    expect([...DETAILED_REPORT_CHAPTER_TITLES]).toEqual([
      '### 结论', '### 根因', '### 专家完整推理', '### 行动建议', '### 数据时点',
    ]);
    expect(DETAILED_REPORT_CHAPTER_TITLES).toHaveLength(5);
    // 全为 markdown 三级标题（模板按行输出，须自带 `### ` 前缀）
    for (const title of DETAILED_REPORT_CHAPTER_TITLES) {
      expect(title.startsWith('### ')).toBe(true);
    }
  });
});
