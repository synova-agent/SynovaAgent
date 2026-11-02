/**
 * tests/expert-quality/layer2-judge.eval.ts — L2 LLM 法官评分（跨行业对比｜**eval，不是 test**）
 *
 * 对 5 个行业 × 7 位专家 = 35 组诊断输出进行六维加权评分。
 *
 * 运行: LLM_API_KEY=... npx vitest run tests/expert-quality/layer2-judge.eval.ts（**不参与 CI 收集**）
 * 耗时: ~15-20 分钟（35 次专家调用 + 35 次法官调用）
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildJudgeSystemPrompt,
  computeOverallScore,
  getGrade,
  validateJudgeOutput,
  type DimensionName,
  type JudgeVerdict,
  DIMENSION_WEIGHTS,
} from './judge-prompt';
import { ENTERPRISES, getEnterpriseContext, type EnterpriseFixture } from './fixtures/sample-data';

// ═══ Config ═══

/**
 * 只从环境变量取密钥。**禁止读取仓库内任何文件**（含 .env）：
 * 那等于邀请把 API key 落到工作树，一旦误提交即密钥入仓。
 */
function loadConfig() {
  const apiKey = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) {
    console.error(
      'layer2-judge.eval: 缺少 LLM_API_KEY / DEEPSEEK_API_KEY。\n' +
      '本文件是 **eval**（需真实模型，15–20 分钟），不参与 CI 收集；\n' +
      '请用环境变量提供密钥——**不得写入仓库任何文件（含 .env）**。',
    );
    process.exit(2); // 2 = 检查自身失败（缺前置），不是判据红
  }
  return {
    apiKey,
    apiBase: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-chat',
  };
}

const EXPERT_TYPES = [
  'strategy', 'org', 'finance', 'tech', 'marketing', 'action', 'business_model',
] as const;
type ExpertType = (typeof EXPERT_TYPES)[number];

// ═══ LLM Client ═══

async function llmCall(
  apiKey: string, apiBase: string, model: string,
  prompt: string, systemPrompt: string,
  maxTokens: number = 1500,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`${apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1 }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content || '';
}

// ═══ Generate Expert Output ═══

function loadExpertPrompt(expertType: ExpertType): string {
  const expertDir = path.resolve('expert', expertType);
  const fileOrder = ['IDENTITY.md', 'SOUL.md', 'RULES.md', 'TOOLS.md', 'KNOWLEDGE.md'] as const;
  const headers = ['角色定义', '诊断风格与方法论', '诊断规则与评分指南', '可用工具', '领域知识'];
  const sections: string[] = [];
  for (let i = 0; i < fileOrder.length; i++) {
    const fp = path.join(expertDir, fileOrder[i]);
    if (fs.existsSync(fp)) {
      const content = fs.readFileSync(fp, 'utf-8').trim();
      if (content) sections.push(`## ${headers[i]}\n\n${content}`);
    }
  }
  return sections.join('\n\n---\n\n');
}

async function runExpert(
  config: ReturnType<typeof loadConfig>,
  expertType: ExpertType,
  enterprise: EnterpriseFixture,
): Promise<{ raw: string; json: any; degraded: boolean }> {
  const systemPrompt = loadExpertPrompt(expertType);
  const userMessage = `请基于以下企业数据，按你的方法论进行诊断分析。

${enterprise.dataSummary}

请输出 JSON 格式（不要 Markdown 代码块包裹）:
{
  "conclusion": "一句话核心诊断结论",
  "findings": [
    {
      "severity": "critical|warning|info",
      "title": "发现标题",
      "description": "用企业负责人能听懂的话解释",
      "evidence": ["证据1"],
      "suggestion": "具体可执行的建议"
    }
  ],
  "score": 0-10,
  "confidence": "high|medium|low"
}`;

  // business_model 三框架 prompt 更长，需要更多输出 token 避免 JSON 截断
  const maxTokens = expertType === 'business_model' ? 3000 : 2000;
  const raw = await llmCall(config.apiKey, config.apiBase, config.model, userMessage, systemPrompt, maxTokens);
  let json: any = null;
  let degraded = false;
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    json = JSON.parse(cleaned);
  } catch { /* expected: JSON parse may fail */ 
    degraded = true;
    json = { conclusion: raw.slice(0, 150), findings: [], score: 0, confidence: 'low' };
  }
  return { raw, json, degraded };
}

// ═══ Run Judge ═══

async function runJudge(
  config: ReturnType<typeof loadConfig>,
  expertType: ExpertType,
  expertOutput: string,
  enterprise: EnterpriseFixture,
): Promise<JudgeVerdict> {
  const enterpriseContext = getEnterpriseContext(enterprise);
  const systemPrompt = buildJudgeSystemPrompt(expertType, enterpriseContext);
  const userPrompt = `请评估以下 ${expertType} 专家的诊断输出质量。

## 企业: ${enterprise.name} (${enterprise.industry})

## 专家输出 (JSON)

\`\`\`json
${expertOutput}
\`\`\`

请严格按照评分标准逐维评估。`;

  const raw = await llmCall(config.apiKey, config.apiBase, config.model, userPrompt, systemPrompt, 1500);
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed: JudgeVerdict;
  try {
    parsed = JSON.parse(cleaned) as JudgeVerdict;
  } catch { /* expected: JSON parse may fail */ 
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]) as JudgeVerdict;
    } else {
      throw new Error(`Judge output unparseable: ${raw.slice(0, 100)}`);
    }
  }
  return parsed;
}

// ═══ Result Types ═══

interface ExpertResult {
  expert: ExpertType;
  conclusion: string;
  score: number;
  confidence: string;
  degraded: boolean;
  findings: number;
  verdict: JudgeVerdict;
}

interface IndustryResult {
  enterprise: EnterpriseFixture;
  experts: ExpertResult[];
  avgScore: number;
  topExpert: string;
  bottomExpert: string;
}

// ═══ Test Suite ═══

const config = loadConfig();
const SKIP = !config.apiKey;
const RESULTS: IndustryResult[] = [];

for (const enterprise of ENTERPRISES) {
  describe(`${enterprise.name} — ${enterprise.industry}`, () => {
    const expertResults: ExpertResult[] = [];

    for (const expertType of EXPERT_TYPES) {
      it(`${expertType}: 诊断 + 评分`, async () => {
        if (SKIP) { console.warn(`  ⚠️ 跳过: 未设置 LLM_API_KEY`); return; }

        // Step 1: Run expert
        const expert = await runExpert(config, expertType, enterprise);
        expect(expert.json).toBeDefined();

        // Step 2: Run judge
        const expertOutputStr = expert.degraded ? JSON.stringify(expert.json) : JSON.stringify(expert.json);
        const verdict = await runJudge(config, expertType, expertOutputStr, enterprise);

        // Step 3: Validate
        const validation = validateJudgeOutput(verdict as unknown as Record<string, unknown>);
        const computed = computeOverallScore(verdict.perDimensionScores);
        const { grade } = getGrade(verdict.overallScore);

        // Store
        expertResults.push({
          expert: expertType,
          conclusion: (expert.json.conclusion || '').slice(0, 100),
          score: expert.json.score || 0,
          confidence: expert.json.confidence || 'low',
          degraded: expert.degraded,
          findings: expert.json.findings?.length || 0,
          verdict,
        });

        // Log
        const icon = verdict.overallScore >= 4.0 ? '✅' : verdict.overallScore >= 3.0 ? '⚠️' : '❌';
        console.log(`  ${icon} ${expertType.padEnd(18)} | 诊断:${String(expert.json.score).padStart(2)}/10 | 法官:${String(verdict.overallScore).padStart(3)}/5 (${grade}) | ${verdict.keyWeaknesses?.[0]?.slice(0, 60) || ''}`);

        // Assertions
        expect(verdict.overallScore).toBeGreaterThanOrEqual(0);
        expect(verdict.overallScore).toBeLessThanOrEqual(5);
        if (!validation.valid) {
          console.warn(`    ⚠️ 法官输出结构不完整: ${validation.errors.join(', ')}`);
        }
        expect(verdict.overallScore).toBeGreaterThanOrEqual(3.0);
      }, 90000);
    }

    // Per-industry summary
    it(`📊 ${enterprise.name} 汇总`, () => {
      if (SKIP) return;

      const avgVerdict = expertResults.reduce((s, r) => s + r.verdict.overallScore, 0) / expertResults.length;
      const avgDiagnosis = expertResults.reduce((s, r) => s + r.score, 0) / expertResults.length;
      const sorted = [...expertResults].sort((a, b) => b.verdict.overallScore - a.verdict.overallScore);

      RESULTS.push({
        enterprise,
        experts: expertResults,
        avgScore: Math.round(avgVerdict * 10) / 10,
        topExpert: sorted[0]?.expert || '',
        bottomExpert: sorted[sorted.length - 1]?.expert || '',
      });

      console.log(`\n  ${'─'.repeat(65)}`);
      console.log(`  ${enterprise.name} | 法官均分: ${avgVerdict.toFixed(1)}/5 | 诊断均分: ${avgDiagnosis.toFixed(1)}/10`);
      console.log(`  最优: ${sorted[0]?.expert} (${sorted[0]?.verdict.overallScore}) | 最弱: ${sorted[sorted.length - 1]?.expert} (${sorted[sorted.length - 1]?.verdict.overallScore})`);
      console.log(`  ${'─'.repeat(65)}`);
    });
  });
}

// ═══ Cross-Industry Comparison ═══

describe('🏆 跨行业对比', () => {
  it('输出综合对比报告', () => {
    if (SKIP) {
      console.warn('  ⚠️ 跳过: 未设置 LLM_API_KEY');
      return;
    }

    expect(RESULTS.length).toBe(ENTERPRISES.length);

    // ═══ 报告 1: 行业 × 专家矩阵 ═══
    console.log('\n' + '═'.repeat(90));
    console.log('  跨行业专家评分矩阵（法官评分 0-5）');
    console.log('═'.repeat(90));

    const header = '  行业'.padEnd(22) + EXPERT_TYPES.map(e => e.padStart(12)).join('') + '  均分'.padStart(6);
    console.log(header);
    console.log('  ' + '─'.repeat(88));

    const allScores: number[] = [];
    for (const r of RESULTS) {
      const cells = EXPERT_TYPES.map(et => {
        const er = r.experts.find(e => e.expert === et);
        const score = er?.verdict.overallScore || 0;
        allScores.push(score);
        const icon = score >= 4.0 ? '✅' : score >= 3.0 ? '⚠️' : '❌';
        return `${icon}${String(score).padStart(4)} `;
      }).join('');
      console.log(`  ${r.enterprise.name.padEnd(16)} ${cells} ${String(r.avgScore).padStart(4)}`);
    }

    // 列均分
    const colAvgs = EXPERT_TYPES.map(et => {
      const scores = RESULTS.map(r => r.experts.find(e => e.expert === et)?.verdict.overallScore || 0);
      return scores.reduce((s, x) => s + x, 0) / scores.length;
    });
    const avgCells = colAvgs.map(s => `  ${s.toFixed(1)} `.padStart(11)).join('');
    console.log('  ' + '─'.repeat(88));
    console.log(`  专家均分        ${avgCells}`);

    // ═══ 报告 2: 行业排名 ═══
    const sortedIndustries = [...RESULTS].sort((a, b) => b.avgScore - a.avgScore);
    console.log('\n  ── 行业诊断质量排名 ──');
    for (let i = 0; i < sortedIndustries.length; i++) {
      const r = sortedIndustries[i];
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      console.log(`  ${medals[i]} ${r.enterprise.name.padEnd(16)} ${r.avgScore}/5 | 最优专家: ${r.topExpert} | 最弱: ${r.bottomExpert}`);
    }

    // ═══ 报告 3: 专家跨行业稳定性 ═══
    console.log('\n  ── 专家跨行业稳定性（标准差越小越稳定）──');
    const expertStability = EXPERT_TYPES.map(et => {
      const scores = RESULTS.map(r => r.experts.find(e => e.expert === et)?.verdict.overallScore || 0);
      const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
      const variance = scores.reduce((s, x) => s + (x - avg) ** 2, 0) / scores.length;
      return { expert: et, avg, stddev: Math.sqrt(variance), scores };
    }).sort((a, b) => a.stddev - b.stddev);

    for (const es of expertStability) {
      const bar = '█'.repeat(Math.round(es.stddev * 10));
      console.log(`  ${es.expert.padEnd(18)} 均分:${es.avg.toFixed(1)}  σ:${es.stddev.toFixed(2)} ${bar}`);
    }

    // ═══ 报告 4: 全局统计 ═══
    const globalAvg = allScores.reduce((s, x) => s + x, 0) / allScores.length;
    const minScore = Math.min(...allScores);
    const maxScore = Math.max(...allScores);
    const countA = allScores.filter(s => s >= 4.0).length;
    const countB = allScores.filter(s => s >= 3.0 && s < 4.0).length;
    const countCFail = allScores.filter(s => s < 3.0).length;

    console.log('\n  ── 全局统计 ──');
    console.log(`  总评估次数: ${allScores.length} (${ENTERPRISES.length}行业 × ${EXPERT_TYPES.length}专家)`);
    console.log(`  全局均分: ${globalAvg.toFixed(2)}/5`);
    console.log(`  最低: ${minScore} | 最高: ${maxScore}`);
    console.log(`  A级(≥4.0): ${countA} | B级(3.0-3.9): ${countB} | C级以下(<3.0): ${countCFail}`);
    console.log(`  通过率(≥3.0): ${((countA + countB) / allScores.length * 100).toFixed(0)}%`);
    console.log('═'.repeat(90));

    // ═══ Save Report ═══
    const report = {
      timestamp: new Date().toISOString(),
      enterprises: ENTERPRISES.length,
      experts: EXPERT_TYPES.length,
      globalAvg: Math.round(globalAvg * 100) / 100,
      minScore,
      maxScore,
      passRate: Math.round((countA + countB) / allScores.length * 100),
      aGrade: countA,
      bGrade: countB,
      cOrBelow: countCFail,
      industries: RESULTS.map(r => ({
        name: r.enterprise.name,
        industry: r.enterprise.industry,
        businessModelType: r.enterprise.businessModelType,
        avgScore: r.avgScore,
        topExpert: r.topExpert,
        bottomExpert: r.bottomExpert,
        experts: r.experts.map(e => ({
          expert: e.expert,
          diagnosisScore: e.score,
          judgeScore: e.verdict.overallScore,
          grade: getGrade(e.verdict.overallScore).grade,
          findings: e.findings,
          conclusion: e.conclusion,
          keyStrength: e.verdict.keyStrengths?.[0] || '',
          keyWeakness: e.verdict.keyWeaknesses?.[0] || '',
        })),
      })),
      expertStability: expertStability.map(es => ({
        expert: es.expert,
        avgScore: Math.round(es.avg * 100) / 100,
        stddev: Math.round(es.stddev * 100) / 100,
      })),
    };

    fs.mkdirSync('tests/output', { recursive: true });
    fs.writeFileSync('tests/output/expert-quality-cross-industry.json', JSON.stringify(report, null, 2));
    console.log('\n  完整报告: tests/output/expert-quality-cross-industry.json\n');

    // Assertions
    expect(globalAvg).toBeGreaterThanOrEqual(3.0);
    expect(countCFail).toBeLessThanOrEqual(5); // 最多允许 5 个 C 级（35 个中的 ~14%）
  }, 30000);
});
