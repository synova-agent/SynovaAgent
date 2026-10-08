/**
 * talent-density/computes/compute-talent-density.ts — 人才密度
 *
 * 评估组织中高技能人才的比例。
 * 基于 Person 节点的技能(skills)、专业水平(proficiencyLevel)和 Capability 节点。
 * 人才密度越高 = 组织越有竞争力。
 */
import { checkFiniteInputs } from '../../../../src/sentinel/assert-finite-inputs';   // #1408 批 C2b：标量参数型 ⇒ 入口显式命名成对象
export interface DensityResult {
  /** #1408：输入有效性等告警 */
  warnings?: string[];
  density: number;               // 0-1, 人才密度评分
  highSkillRatio: number;        // 高技能人才比例
  totalPeople: number;
  highSkillCount: number;
  assessment: 'high' | 'moderate' | 'low' | 'insufficient';
  degraded: boolean;
}

export function computeTalentDensity(
  personCount: number,
  highSkillCount: number
): DensityResult {
  // #1408 批 C2b：**标量参数型** ⇒ 入口**显式命名成对象**（需求声明必须手写：只有本人知道那几个标量叫什么）
  const _inputIssues = checkFiniteInputs({ personCount, highSkillCount }, ['personCount', 'highSkillCount']);
  if (_inputIssues.length > 0) return { density: 0.5, highSkillRatio: 0, totalPeople: 0, highSkillCount: 0, assessment: 'insufficient', degraded: true, warnings: _inputIssues };
  if (personCount === 0) {
    return { density: 0.5, highSkillRatio: 0, totalPeople: 0, highSkillCount: 0, assessment: 'insufficient', degraded: true };
  }

  const highSkillRatio = highSkillCount / personCount;

  // 高技能 > 40% = 高密度
  // 高技能 20-40% = 中等
  // 高技能 < 20% = 低密度
  let assessment: 'high' | 'moderate' | 'low' | 'insufficient';
  if (highSkillRatio > 0.4) {
    assessment = 'high';
  } else if (highSkillRatio > 0.2) {
    assessment = 'moderate';
  } else {
    assessment = 'low';
  }

  const density = Math.round(highSkillRatio * 100) / 100;

  return { density, highSkillRatio: Math.round(highSkillRatio * 100) / 100, totalPeople: personCount, highSkillCount, assessment, degraded: false };
}
