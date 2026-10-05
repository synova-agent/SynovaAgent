/**
 * fixed-cost-rigidity.ts — I10 哨兵 compute 函数
 *
 * 评估固定成本的可削减程度。
 * 规则:
 *   工厂/场地租金 → 0% (除非关闭)
 *   区域仓库 → 30-50% (关闭该区域)
 *   管理人员薪酬 → 20-40% (裁员补偿)
 *   IT订阅/云服务 → 50-80% (按用量缩减)
 *   生产设备折旧 → 0% (短期不可缩减)
 *
 * 客户A验证: 工厂28人+运营30人的固定成本无法随会所数减少而缩减
 * 来源: 管理经济学(托马斯) Ch6 — 成本结构分析
 *
 * 本体映射: COST_DRIVEN_BY::costType=fixed → CostItem
 *
 * 契约:
 *   @input — fixedCost(number), totalCost(number), period(string)
 *   @output — FixedCostRigidityResult { fixedCostRatio, rigidityLevel, trend }
 *   @degraded — totalCost<=0 -> degraded:true + warnings
 */
export interface RigidityItem {
  name: string;
  amount: number;
  reducible: boolean;
  reductionPercent: number;
  reason: string;
}

export interface FixedCostRigidityResult {
  costItems: RigidityItem[];
  totalFixed: number;
  totalReducible: number;
  rigidityRatio: number; // 1 - totalReducible/totalFixed, 越接近1越刚性
  signal: 'rigid' | 'moderate' | 'flexible';
  degraded: boolean;
  warnings: string[];
}

// 分类关键词 → (缩减比例, 原因)
const REDUCTION_RULES: Array<{ keywords: string[]; reductionPercent: number; reason: string }> = [
  { keywords: ['工厂', '厂房', 'factory', 'warehouse', 'rent', '租金', '场地'], reductionPercent: 0, reason: 'Factory/warehouse rent — 0% unless closed' },
  { keywords: ['仓库', '区域', 'regional', 'distribution'], reductionPercent: 40, reason: 'Regional warehouse — 30-50% if region closed' },
  { keywords: ['管理人员', '管理层', 'manager', 'management', '薪酬', 'salary', '工资'], reductionPercent: 30, reason: 'Management salary — 20-40% via layoffs' },
  { keywords: ['IT', '云', 'cloud', 'saas', 'subscription', '订阅', '软件'], reductionPercent: 60, reason: 'IT subscriptions — 50-80% usage-based' },
  { keywords: ['设备', '折旧', 'depreciation', 'equipment', 'machine'], reductionPercent: 0, reason: 'Equipment depreciation — 0% short-term' },
  { keywords: ['研发', 'R&D', 'research', '开发'], reductionPercent: 20, reason: 'R&D — limited reduction without stopping projects' },
  { keywords: ['市场', 'marketing', '广告', '广告投放', '推广'], reductionPercent: 50, reason: 'Marketing — 50-80% can be paused' },
];

export function computeFixedCostRigidity(
  costItems: Array<{ name: string; amount: number; category?: string }>,
): FixedCostRigidityResult {
  const warnings: string[] = [];

  if (costItems.length === 0) {
    return {
      costItems: [],
      totalFixed: 0,
      totalReducible: 0,
      rigidityRatio: 1,
      signal: 'rigid',
      degraded: true,
      warnings: ['No fixed cost data available'],
    };
  }

  const items: RigidityItem[] = [];
  let totalReducible = 0;
  let totalFixed = 0;

  for (const item of costItems) {
    const name = (item.name || '').toLowerCase();
    let matched = false;

    for (const rule of REDUCTION_RULES) {
      if (rule.keywords.some(k => name.includes(k))) {
        const reducible = rule.reductionPercent > 0;
        const reductionAmount = item.amount * (rule.reductionPercent / 100);
        items.push({
          name: item.name,
          amount: Math.max(0, item.amount),
          reducible,
          reductionPercent: rule.reductionPercent,
          reason: rule.reason,
        });
        totalFixed += Math.max(0, item.amount);
        if (reducible) totalReducible += reductionAmount;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // 默认: 未知类别视为刚性
      items.push({
        name: item.name,
        amount: Math.max(0, item.amount),
        reducible: false,
        reductionPercent: 0,
        reason: 'Unknown category — default rigid',
      });
      totalFixed += Math.max(0, item.amount);
    }
  }

  const rigidityRatio = totalFixed > 0 ? 1 - (totalReducible / totalFixed) : 1;

  let signal: 'rigid' | 'moderate' | 'flexible';
  if (rigidityRatio > 0.8) {
    signal = 'rigid';
  } else if (rigidityRatio > 0.5) {
    signal = 'moderate';
  } else {
    signal = 'flexible';
  }

  if (signal === 'rigid') {
    warnings.push('Fixed cost structure is highly rigid — limited short-term flexibility');
  }

  return {
    costItems: items,
    totalFixed: Math.round(totalFixed * 100) / 100,
    totalReducible: Math.round(totalReducible * 100) / 100,
    rigidityRatio: Math.round(rigidityRatio * 100) / 100,
    signal,
    degraded: false,
    warnings,
  };
}
