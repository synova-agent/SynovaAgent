/**
 * components/ExpertAttribution.tsx — 专家标识折叠组件 (Phase 1.2)
 *
 * 默认折叠，展开显示每位专家的方法论和置信度。
 * T5a/B2：原「展开完整推理链」按钮无任何 handler（死项，铁律 37）⇒ 已删除，不留空壳。
 */
import React, { useState } from 'react';
import type { ExpertAttr } from '../types/chat';

interface Props {
  experts: ExpertAttr[];
}

const ExpertAttribution: React.FC<Props> = ({ experts }) => {
  const [expanded, setExpanded] = useState(false);

  if (experts.length === 0) return null;

  return (
    <div className="expert-attribution">
      <button className="expert-attribution-toggle" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '▼' : '▶'}</span>
        <span className="expert-attribution-label">
          {experts.length} 位专家参与分析
        </span>
      </button>

      {expanded && (
        <div className="expert-attribution-body fade-in">
          {experts.map((exp, i) => (
            <div key={i} className="expert-attribution-item">
              <div className="expert-attribution-header">
                <span className="expert-attribution-name">{exp.name}</span>
                <span className="expert-attribution-confidence">
                  置信度 {Math.round(exp.confidence * 100)}%
                </span>
              </div>
              {exp.methodology && (
                <div className="expert-attribution-methodology">
                  {exp.methodology}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(ExpertAttribution);
