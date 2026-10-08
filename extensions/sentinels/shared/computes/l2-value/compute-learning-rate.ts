/**
 * compute-learning-rate.ts — 累积学习率计算（Wright's Law）
 *
 * 契约ID: COMPUTE-LEARNING-RATE-v1
 * 模块: l2-value
 * 消费边: CUMULATIVE_LEARNING
 * 输入: unitCostT0(number), unitCostT(number), cumulativeOutput(number), routine_rigidity?(number 0-1)
 * 输出(正常): { learningRate, experienceElasticity, routine_rigidity, confidence, evidence, economicInterpretation, degraded:false }
 * 输出(降级): { learningRate:0, ... economicInterpretation, degraded:true, warnings:['...'] }
 *
 * D59 ME Enhance: 追加 economic_interpretation 字段
 *   learningRateInterpretation: 'rapid' | 'moderate' | 'slow' | 'negative'
 *   costReductionForecast: string
 *   organizationalImplication: string
 *
 * 计算公式:
 *   Wright's Law（线性化）:
 *   unit_cost_t = unit_cost_t0 * cumulative_output^(-learning_rate)
 *   => learning_rate = log(unit_cost_t0 / unit_cost_t) / log(cumulative_output)
 *   => experience_elasticity = 2^(-learning_rate) — 累计产出翻倍时的成本下降比例
 *
 * 降级条件:
 *   - cumulative_output < 2 → 无法取log → degraded:true + "累计产出<2"
 *   - unitCostT0 <= 0 或 unitCostT <= 0 → degraded:true + "成本数据无效"
 *   - learning_rate < 0 → 成本上升（非学习，可能是遗忘或通胀）→ degraded:true + 警告
 */

export interface LearningRateInput {
  unitCostT0: number;
  unitCostT: number;
  cumulativeOutput: number;
  routine_rigidity?: number;
}

/** 管理经济学语义解读 */
export interface LearningRateInterpretation {
  /** 学习率解读: rapid / moderate / slow / negative */
  learningRateInterpretation: string;
  /** 成本降低预测 */
  costReductionForecast: string;
  /** 组织层面的启示 */
  organizationalImplication: string;
}

export interface LearningRateResult {
  learningRate: number;
  experienceElasticity: number;
  routine_rigidity: number;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  /** D59: 管理经济学语义解读 */
  economicInterpretation: LearningRateInterpretation;
  degraded: boolean;
  warnings: string[];
}

export function computeLearningRate(input: LearningRateInput): LearningRateResult {
  const warnings: string[] = [];
  const { unitCostT0, unitCostT, cumulativeOutput } = input;
  const routine_rigidity = input.routine_rigidity ?? 0.5;

  // 降级：无效输入
  if (cumulativeOutput < 2) {
    return {
      learningRate: 0, experienceElasticity: 0, routine_rigidity,
      confidence: 'low', evidence: [],
      economicInterpretation: {
        learningRateInterpretation: 'negative',
        costReductionForecast: '无法计算——输入数据无效',
        organizationalImplication: '建议检查数据质量，确保累计产出和成本数据准确',
      },
      degraded: true,
      warnings: [`累计产出${cumulativeOutput}<2，无法计算学习率`],
    };
  }
  if (unitCostT0 <= 0 || unitCostT <= 0) {
    return {
      learningRate: 0, experienceElasticity: 0, routine_rigidity,
      confidence: 'low', evidence: [],
      economicInterpretation: {
        learningRateInterpretation: 'negative',
        costReductionForecast: '无法计算——输入数据无效',
        organizationalImplication: '建议检查数据质量，确保累计产出和成本数据准确',
      },
      degraded: true,
      warnings: [`成本数据无效: unitCostT0=${unitCostT0}, unitCostT=${unitCostT}`],
    };
  }

  // Wright's Law: learning_rate = log(unitCostT0/unitCostT) / log(cumulativeOutput)
  const learningRate = Math.log(unitCostT0 / unitCostT) / Math.log(cumulativeOutput);

  // experience_elasticity: 累计产出翻倍时的成本下降比例
  // 如果 cumulative_output 翻倍：unit_cost_doubled = unit_cost_t0 * (2*cumulative_output)^(-lr)
  // => 下降比例 = 1 - 2^(-lr)
  const experienceElasticity = 1 - Math.pow(2, -learningRate);

  const evidence: string[] = [
    `unitCostT0=${unitCostT0}, unitCostT=${unitCostT}`,
    `cumulativeOutput=${cumulativeOutput}`,
    `learningRate=${learningRate.toFixed(4)}`,
    `experienceElasticity=${experienceElasticity.toFixed(4)}`,
  ];

  // 检测惯例刚性阻碍学习
  if (routine_rigidity > 0.8 && learningRate < 0.05) {
    warnings.push('惯例刚性高(>0.8)且学习率低(<0.05)——惯例刚性可能阻碍了学习');
  }

  // 负学习率 = 成本上升
  const degraded = learningRate < 0;
  if (degraded) {
    warnings.push(`学习率为负(${learningRate.toFixed(4)})——成本在上升，非学习效应`);
  }

  // D59: 管理经济学语义解读
  const lrInterpretation = learningRate > 0.1 ? 'rapid' :
    learningRate > 0.05 ? 'moderate' :
    learningRate > 0 ? 'slow' : 'negative';
  const economicInterpretation: LearningRateInterpretation = {
    learningRateInterpretation: lrInterpretation,
    costReductionForecast: experienceElasticity > 0
      ? `累计产出翻倍时成本预计下降${(experienceElasticity * 100).toFixed(1)}%`
      : '成本未呈现下降趋势',
    organizationalImplication: routine_rigidity > 0.8
      ? '惯例刚性较高可能阻碍学习效应，建议引入外部知识或流程再造'
      : '学习效应正常发挥，可继续当前生产组织方式',
  };

  const confidence = cumulativeOutput >= 10000 ? 'high' : cumulativeOutput >= 100 ? 'medium' : 'low';

  return {
    learningRate: Math.round(learningRate * 10000) / 10000,
    experienceElasticity: Math.round(experienceElasticity * 10000) / 10000,
    routine_rigidity,
    confidence,
    evidence,
    economicInterpretation,
    degraded,
    warnings,
  };
}
