/**
 * knowledge-accessibility/computes/compute-knowledge-accessibility.ts — 关键知识可调用性
 *
 * 基于知识粘性理论（Szulanski 1996），评估组织关键知识的文档化程度和可访问性。
 * 知识粘性越高，知识的转移成本越高，组织越脆弱。
 *
 * 输入: Document(文档), KnowledgeChunk(知识片段), Capability(能力), Person(人员)
 * 输出: 可调用性评分（0-1，越高越健康）
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408 批 C2b：标量参数型 ⇒ 入口显式命名成对象
export interface AccessibilityResult {
  /** #1408：输入有效性等告警 */
  warnings?: string[];
  score: number;                    // 0-1, 知识可调用性评分
  documentedRate: number;           // 知识被文档化的比例
  knowledgeNodes: number;           // 知识节点总数（Document+KnowledgeChunk）
  personNodes: number;              // 人员节点数
  assessment: 'high' | 'medium' | 'low' | 'insufficient';
  degraded: boolean;
}

export function computeKnowledgeAccessibility(
  docCount: number,         // Document 节点数量
  knowledgeCount: number,   // KnowledgeChunk 节点数量
  capabilityCount: number,  // Capability 节点数量
  personCount: number       // Person 节点数量
): AccessibilityResult {
  // #1408 批 C2b：**标量参数型** ⇒ 入口**显式命名成对象**（需求声明必须手写：只有本人知道那几个标量叫什么）
  const _inputIssues = checkFiniteInputs({ docCount, knowledgeCount, capabilityCount, personCount }, ['docCount', 'knowledgeCount', 'capabilityCount', 'personCount']);
  if (_inputIssues.length > 0) return { score: 0.5, documentedRate: 0, knowledgeNodes: 0, personNodes: 0, assessment: 'insufficient', degraded: true, warnings: _inputIssues };
  const knowledgeNodes = docCount + knowledgeCount + capabilityCount;

  if (knowledgeNodes === 0 && personCount === 0) {
    return { score: 0.5, documentedRate: 0, knowledgeNodes: 0, personNodes: 0, assessment: 'insufficient', degraded: true };
  }

  // 知识文档化比例：有文档的知识 / (有文档 + 无文档但有人员)
  // 人员没有对应的知识文档 = 知识粘性高
  const documentedRate = Math.min(
    knowledgeNodes / Math.max(knowledgeNodes + personCount, 1),
    1
  );

  // 知识可调用性基于:
  // 1. 文档化比例 (40%) — 知识是否被记录下来
  // 2. 人均知识节点数 (30%) — 知识是否丰富
  // 3. 能力定义 (30%) — 能力是否被明确界定
  const docScore = documentedRate;
  const densityScore = Math.min(knowledgeNodes / Math.max(personCount || 1, 1) / 5, 1);
  const capScore = Math.min(capabilityCount / Math.max(knowledgeNodes || 1, 1), 1);

  const score = Math.round((0.4 * docScore + 0.3 * densityScore + 0.3 * capScore) * 100) / 100;

  let assessment: 'high' | 'medium' | 'low' | 'insufficient';
  if (score > 0.6) {
    assessment = 'high';
  } else if (score > 0.3) {
    assessment = 'medium';
  } else {
    assessment = 'low';
  }

  return {
    score: Math.min(Math.max(score, 0), 1),
    documentedRate: Math.round(documentedRate * 100) / 100,
    knowledgeNodes,
    personNodes: personCount,
    assessment,
    degraded: false,
  };
}
