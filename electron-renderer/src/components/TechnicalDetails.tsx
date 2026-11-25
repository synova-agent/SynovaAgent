/**
 * components/TechnicalDetails.tsx — 「技术详情」折叠层（客户面唯一的原始值出口）
 *
 * 判据源：`docs/synova/ui-redo/客户语言词典-v1.0.md` v1.1 §0.3（默认收起、标题固定「技术详情」、
 * 展开后内容不加修饰）＋ `UI-CONTRACT.md` v1.1 §4.2（仅明确授权的模式可见、默认收起）。
 *
 * @input  items — 原始值条目 `{label, value}`；`value` 为空串的条目自动略去；空数组 ⇒ 整个折叠层不渲染。
 *         调用方负责只把「默认界面不该出现」的原值（编号/错误码/原始枚举/协议原文）放进这里。
 * @output 一个原生 `<details>` 元素：`<summary>技术详情</summary>` ＋ 条目列表。
 *         **不带 `open` 属性** ⇒ 浏览器默认收起；展开/收起由原生元素负责，不需要 hook。
 * @degraded 不抛：空条目略去、空数组返回 null（不渲染空壳）。
 * @error   不抛。
 * @not-here 不判断业务真值、不生成文案；不做受控展开状态（不引入 UI 状态，R11）。
 */
import React from 'react';
import { TECHNICAL_DETAILS_TITLE } from '../lib/words';

/** 一条原值：label 是客户可读的字段名，value 是原值（已在调用方做 String 化） */
export interface TechnicalDetailsItem {
  label: string;
  value: string;
}

export interface TechnicalDetailsProps {
  items: TechnicalDetailsItem[];
}

export const TechnicalDetails: React.FC<TechnicalDetailsProps> = ({ items }) => {
  const visible = items.filter((item) => item.value !== '');
  if (visible.length === 0) return null;
  return (
    <details
      className="technical-details"
      data-testid="technical-details"
      style={{ marginTop: 6, fontSize: 11, color: 'var(--text, #e0e0e0)' }}
    >
      <summary style={{ cursor: 'pointer' }}>{TECHNICAL_DETAILS_TITLE}</summary>
      <dl style={{ margin: '6px 0 0 12px' }}>
        {visible.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            <dt style={{ display: 'inline', fontWeight: 600 }}>{item.label}：</dt>
            <dd style={{ display: 'inline', margin: 0, whiteSpace: 'pre-wrap' }}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
};

export default React.memo(TechnicalDetails);
