#!/usr/bin/env python3
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
OUT = r"D:\novis-backup-20260526\Novis\synova-agent\docs\research\growth-diagnostics\SYNOVA_IMPLEMENTATION.html"
print(f"Generating {OUT}...", file=sys.stderr)
lines = []
def L(s): lines.append(s + "\n")
L('<!DOCTYPE html>')
L('<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Synova Implementation</title><style>')
L(':root {--bg: #0d1117; --bg2: #161b22; --fg: #c9d1d9; --fg2: #8b949e; --accent: #58a6ff; --green: #3fb950; --warn: #d2991d; --crit: #f85149; --purple: #bc8cff; --muted: #6e7681; --h1: #f0f6fc; --h2: #e6edf3; --b-env: #d2991d; --b-cap: #3fb950; --b-iface: #58a6ff; --b-tech: #bc8cff; --b-align: #f0883e; --b-inner: #f85149; --b-onto: #79c0ff;}')
L('*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.6;max-width:1200px;margin:0 auto;padding:40px 20px}h1{color:var(--h1);font-size:2em;border-bottom:2px solid var(--accent);padding-bottom:10px;margin-bottom:20px}h2{color:var(--h2);font-size:1.5em;margin:40px 0 15px;border-left:4px solid var(--accent);padding-left:12px}h3{color:var(--accent);font-size:1.2em;margin:25px 0 10px}h4{color:var(--fg2);font-size:1.05em;margin:15px 0 8px}p{margin:10px 0}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}code{background:var(--bg2);padding:2px 6px;border-radius:3px;font-family:"Consolas","Courier New",monospace;font-size:.92em}pre{background:var(--bg2);padding:16px;border-radius:6px;overflow-x:auto;margin:10px 0;font-size:.85em}pre code{background:none;padding:0}table{width:100%;border-collapse:collapse;margin:15px 0;font-size:.87em}th,td{padding:8px 10px;border:1px solid #30363d;text-align:left;vertical-align:top}th{background:var(--bg2);font-weight:600}tr:nth-child(even){background:rgba(22,27,34,.5)}')
L('.badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:.8em;font-weight:600}.b-env{background:rgba(210,153,29,.2);color:var(--b-env)}.b-cap{background:rgba(63,185,80,.2);color:var(--b-cap)}.b-iface{background:rgba(88,166,255,.2);color:var(--b-iface)}.b-tech{background:rgba(188,140,255,.2);color:var(--b-tech)}.b-align{background:rgba(240,136,62,.2);color:var(--b-align)}.b-inner{background:rgba(248,81,73,.2);color:var(--b-inner)}.b-onto{background:rgba(121,192,255,.2);color:var(--b-onto)}.b-p0{background:rgba(248,81,73,.25);color:#f85149}.b-p1{background:rgba(210,153,29,.25);color:#d2991d}.b-p2{background:rgba(88,166,255,.25);color:#58a6ff}')
L('.note{background:rgba(88,166,255,.1);border-left:3px solid var(--accent);padding:10px 15px;margin:15px 0;border-radius:0 4px 4px 0}.warn-note{background:rgba(210,153,29,.1);border-left:3px solid var(--warn);padding:10px 15px;margin:15px 0;border-radius:0 4px 4px 0}.crit-note{background:rgba(248,81,73,.1);border-left:3px solid var(--crit);padding:10px 15px;margin:15px 0;border-radius:0 4px 4px 0}.toc{background:var(--bg2);padding:20px 25px;border-radius:6px;margin:20px 0}.toc ol{padding-left:20px}.toc li{margin:5px 0}hr{border:0;border-top:1px solid #30363d;margin:30px 0}.legend{display:flex;gap:20px;flex-wrap:wrap;margin:15px 0;font-size:.85em}.arch{background:var(--bg2);padding:20px;border-radius:6px;margin:20px 0;font-family:"Consolas","Courier New",monospace;font-size:.85em;line-height:1.3;white-space:pre;overflow-x:auto}ul,ol{padding-left:25px;margin:10px 0}li{margin:5px 0}')
L('</style></head><body>')
L('<h1>Synova Implementation — 增长动力学系统 完整技术执行方案</h1>')
L('<p style="color:var(--muted)">v3.0 · 2026-07-03 · 46个哨兵 · 75个compute函数 · 8位文件化专家 · 22种节点类型 · 17种边类型 · 本体层重构方案</p>')
L('<div class="toc"><strong>目录</strong><ol>')
for label, anchor in [('第0章：项目身份','s0'),('第1章：本体层完整设计','s1'),('第2章：全景矩阵','s2'),('第3章：P0批次规格','s3'),('第4章：P1批次概要','s4'),('第5章：P2批次概要','s5'),('第6章：专家集成','s6'),('第7章：代码模板','s7'),('第8章：铁律速查','s8'),('第9章：验收标准','s9'),('第10章：执行路线图','s10'),('附录','appendix')]:
    L(f'<li><a href="#{anchor}">{label}</a></li>')
L('</ol></div><hr>')
with open(OUT, 'w', encoding='utf-8') as f: f.writelines(lines)
print(f"Phase 1 done: {len(lines)} lines", file=sys.stderr)
#!/usr/bin/env python3
import sys
sys.stdout.reconfigure(encoding='utf-8')
OUT = r"D:\novis-backup-20260526\Novis\synova-agent\docs\research\growth-diagnostics\SYNOVA_IMPLEMENTATION.html"
lines = []
def L(s): lines.append(s + "\n")

# Chapter 0
L('<h2 id="s0">第0章：项目身份（Claude Code 每次任务最先读到的内容）</h2>')
L('<h3>0.1 SynovaAgent 是什么</h3>')
L('<p><strong>SynovaAgent</strong> 是一个驻扎企业的 AI 诊断系统。它不是问答机器人，而是一个持续在线的组织数字孪生 Agent。核心问题：<em>这家企业的增长卡在哪里？现在该做什么？</em></p>')
L('<p>诊断是手段，增长才是目的。SynovaAgent 驻扎在企业数据之上，持续观测，主动发现异常，自动运行诊断流水线，给出行动建议，并跟踪执行结果。独立 API 进程，HTTP + MCP 对外服务。</p>')
L('<div class="note"><strong>定位</strong>：成为组织诊断的 "AWS"。每个新客户、新行业、新数据源——加文件即可上线，不改代码。能文件化的必须文件化，不能文件化的必须有明确的扩展点。</div>')

L('<h3>0.2 三层解耦体系</h3>')
L('<h4>纵向解耦：五层物理隔离</h4>')
L('<p>代码按 L1-L5 架构分层，每层只与相邻层通信。L1 交互层不知道 L4 用什么数据库，L3 洞察层不知道 L5 数据存在哪。换底层存储，上层零改动。</p>')
L('<div class="arch">L1 交互 (routes/, tui/, mcp/) → L2 编排 (agent/, orchestrator/)\n    → L3 洞察 (l3/, sentinel/, expert-platform/, expert/)\n    → L4 本体 (l4/, evidence/)\n    → L5 存储 (store/, cron/)</div>')

L('<h4>横向解耦：11 个独立 Monorepo 包</h4>')
L('<p>五层内部拆为独立包：<code>@synova/sog-core</code>（本体图类型）、<code>@synova/sentinel-engine</code>（哨兵调度）、<code>@synova/expert-platform</code>（专家加载）、<code>@synova/connector-registry</code>（数据连接器）等。每个包接口边界明确，拆掉一个不影响其余。</p>')

L('<h4>扩展解耦：文件驱动，不改代码</h4>')
L('<ul>')
L('<li>新 AI 专家 = 新建目录 + 5 个 Markdown 文件 → 自动注册到 ExpertDispatcher</li>')
L('<li>新诊断哨兵 = 加 manifest.json + aggregate.ts → SentinelLoader 自动扫描加载</li>')
L('<li>新行业 = 加行业目录（基准数据 + 阈值 + 案例库）→ 1-2 天上线，零 TypeScript 改动</li>')
L('<li>新本体实体类型 = 加 JSON Schema 文件</li>')
L('</ul>')

L('<h3>0.3 本体层（L4）的核心定位</h3>')
L('<div class="crit-note"><strong>这不是 KV 数据库，这是企业知识图谱。</strong>本体层（L4）是整个系统的认知核心。它有 22 个节点类型和 17 个边类型，表达的不仅仅是"企业有哪些数据"而是"企业各元素之间的语义关系"。</div>')
L('<p><strong>设计哲学：边承载语义，节点承载状态。</strong>在传统 KV 模式下，计算"客户集中度"需要读取一个 Financial 节点，从中取出一个大 JSON blob，然后解析出客户营收列表。在本体层中，计算"客户集中度"是沿图遍历：从 Financial 节点出发，沿 <code>REVENUE_FROM</code> 边走到所有 Client 节点，读取每条边上的 <code>share</code> 属性，聚合得到 HHI 指数。</p>')
L('<p><strong>哨兵的计算逻辑是"沿着边做图遍历"，不是"读节点的 props 做算术"。</strong>这是一个根本性的架构差异——新加一个客户不需要改动 Financial 节点的 schema，增加一条 <code>REVENUE_FROM</code> 边即可。</p>')

L('<h3>0.4 数据流全景</h3>')
L('<div class="arch">原始数据 → 本体层(企业知识图谱) → 7维度×25测量器(compute)\n    按需(GA触发)          定时(Cron触发)\n    runModules()          Sentinel.check()\n              ↓                      ↓\n         Evidence池           SentinelFinding[]\n              ↓                      ↓\n         信号聚合引擎 ←←←←←←←←←←←←←\n              ↓\n         交叉关联 + 严重度升级 + 专家路由\n              ↓\n   8位专家(strategy/org/finance/tech/marketing/action/business_model/knowledge)\n              ↓\n         ReAct推理 + 交叉验证\n              ↓\n         综合诊断报告 → GA 收到警报\n         GET /api/sentinel/reports\n         GET /api/sentinel/tickets</div>')

L('<h3>0.5 三层颗粒度</h3>')
L('<table>')
L('<tr><th>层级</th><th>是什么</th><th>存储位置</th><th>格式</th><th>谁管理</th></tr>')
L('<tr><td><strong>专家（Expert）</strong></td><td>领域诊断师，拥有审核权和裁决权</td><td><code>expert/{name}/</code></td><td>文件化（Markdown）</td><td>expert-registry.yaml</td></tr>')
L('<tr><td><strong>哨兵（Sentinel）</strong></td><td>诊断信号的观测单元</td><td><code>extensions/sentinels/{name}/</code></td><td>文件化（JSON+TS）</td><td>SentinelLoader 自动扫描</td></tr>')
L('<tr><td><strong>计算模块（Compute）</strong></td><td>纯函数，数学公式实现</td><td><code>extensions/sentinels/{name}/computes/{fn}.ts</code></td><td>代码化（TypeScript）</td><td>aggregate.ts 静态 import</td></tr>')
L('</table>')

L('<h3>0.6 两大核心系统</h3>')
L('<ol>')
L('<li><strong>GA 按需诊断</strong> — 用户触发，6阶段管道，全部测量器+专家 → 综合诊断报告</li>')
L('<li><strong>Sentinel 定时哨兵</strong> — Cron 自动，基线对比+异常检测 → 信号聚合 → 专家 → 工单</li>')
L('</ol>')

L('<h3>0.7 市场定位</h3>')
L('<p>5-300 人团队的组织诊断与增长导航。独立 API 进程，HTTP + MCP 对外服务，不依赖任何前端或桌面端。</p>')

L('<hr>')

# ============ CHAPTER 1 ============
L('<h2 id="s1">第1章：本体层完整设计（本方案的核心壁垒）</h2>')
L('<div class="note"><strong>为什么本体层是核心壁垒？</strong>一个系统可以被复制代码，但不能被复制数据模型——因为数据模型承载了所有诊断知识的编码方式。22个节点类型 + 17个边类型 + 图遍历计算模式 = 这里面体现了对"企业诊断"这个领域问题的全部理解。</div>')

# 1.1
L('<h3>1.1 节点类型完整定义（22个）</h3>')
nodes = [
    ('Financial', '<span class="badge b-onto">核心</span>', '企业财务主节点。2026-07 重构后拆分为5个子节点。', 'entityName, teamId', 'revenue, cogs, ebit, ebitda, netIncome, operatingCashFlow, totalAssets, totalDebt, equity, cash, taxRate, grossMargin, operatingExpense, shortTermDebt, interestExpense, netPPE, goodwill, capitalizedRD, operatingWorkingCapital, inventory, accountsReceivable, accountsPayable, totalCapital'),
    ('CashFlowStatement', '<span class="badge b-onto">新拆分</span>', '现金流量表子节点。承载所有现金流相关字段。', 'entityName, teamId, period', 'operatingCashFlow, investingCashFlow, financingCashFlow, freeCashFlow'),
    ('BalanceSheet', '<span class="badge b-onto">新拆分</span>', '资产负债表子节点。资产、负债、权益的时点快照。', 'entityName, teamId, asOfDate', 'totalAssets, currentAssets, totalLiabilities, currentLiabilities, totalDebt, shortTermDebt, equity, netPPE, inventory, accountsReceivable, accountsPayable, goodwill'),
    ('IncomeStatement', '<span class="badge b-onto">新拆分</span>', '利润表子节点。时间段内的收入、成本、利润。', 'entityName, teamId, period', 'revenue, cogs, grossProfit, operatingExpense, ebit, ebitda, netIncome, interestExpense'),
    ('CapitalStructure', '<span class="badge b-onto">新拆分</span>', '资本结构子节点。融资、股权、债务结构。', 'entityName, teamId', 'totalCapital, debtToEquity, weightedAvgInterestRate, retainedEarnings'),
    ('CostCenter', '<span class="badge b-onto">新拆分</span>', '成本中心子节点。按维度归集的成本。', 'entityName, teamId, dimension', 'fixedCosts, variableCosts, budget, actualSpend, variance'),
    ('Team', '', '组织中的团队单元。', 'entityName, teamId', 'headcount, functionType, budget, avgTenure'),
    ('Person', '', '个体人员。关键人物和普通员工。', 'entityName, teamId', 'role, skills, tenure, decisionAuthority'),
    ('Client', '', '客户组织或个体客户。', 'entityName, teamId', 'churnRisk, lifetimeValue, tenure, segment'),
    ('Market', '', '市场环境数据。TAM/SAM/SOM、增长和竞争。', 'entityName, teamId', 'tam, sam, growthRate, hhi, avgPrice, competitorCount'),
    ('Product', '', '产品或服务。', 'entityName, teamId', 'price, unitCost, launchDate, lifecycleStage, margin'),
    ('Process', '', '业务流程。生产、销售、交付等。', 'entityName, teamId', 'efficiency, cycleTime, errorRate, automationLevel'),
    ('Capability', '', '组织能力。抽象的，区别于具象的 Process。', 'entityName, teamId', 'proficiencyLevel, rarityScore, imitabilityScore'),
    ('Tool', '', '软件工具 / SaaS 系统。', 'entityName, teamId', 'status, authorization, url, endpoint, protocol, category, monthlyCost'),
    ('Goal', '', '组织目标 / OKR。', 'entityName, teamId', 'goalType, targetValue, currentValue, deadline, ownerId, weight'),
    ('Event', '', '时间序列事件。问题、决策、行动。', 'entityName, teamId', 'eventType, timestamp, description, severity, problemCategory'),
    ('Document', '', '知识文档。会议纪要、战略文件。', 'entityName, teamId', 'content, docType, authorId, createdAt'),
    ('Risk', '', '风险登记项。', 'entityName, teamId', 'riskCategory, likelihood, impact, mitigationPlan, status'),
    ('Supplier', '', '供应商。', 'entityName, teamId', 'category, importance, contractValue, concentration'),
    ('Channel', '', '销售 / 分发渠道。', 'entityName, teamId', 'channelType, revenueShare, costPerAcquisition, conversionRate'),
    ('Compliance', '', '合规记录。', 'entityName, teamId', 'regulationType, status, lastAuditDate, findings'),
    ('Location', '', '地理节点。地理维度的资源分布。', 'entityName, teamId', 'address, region, facilityType, capacity'),
]
L('<table><tr><th>节点类型</th><th>标记</th><th>描述</th><th>requiredProps</th><th>optionalProps</th></tr>')
for nt, badge, desc, req, opt in nodes:
    L(f'<tr><td><code>{nt}</code></td><td>{badge}</td><td>{desc}</td><td><code>{req}</code></td><td><code>{opt}</code></td></tr>')
L('</table>')

# 1.2 Financial拆分
L('<h3>1.2 Financial 节点的 5 个拆分子节点设计</h3>')
L('<div class="crit-note">这是 2026-07 本体层重构的核心变更。原单一 <code>Financial</code> 节点承载了 30+ 个 props，每次图遍历都返回巨型对象。拆分为 5 个子节点后，每个 compute 函数只需查询自己需要的子节点类型，图遍历的精确度和性能都大幅提升。</div>')
L('<table><tr><th>子节点</th><th>对应报表</th><th>核心字段</th><th>典型场景</th></tr>')
L('<tr><td><strong>CashFlowStatement</strong></td><td>现金流量表</td><td>operatingCashFlow, freeCashFlow</td><td>KZ 指数、现金跑道</td></tr>')
L('<tr><td><strong>BalanceSheet</strong></td><td>资产负债表</td><td>totalAssets, totalDebt, equity, netPPE</td><td>杠杆率、资产周转率</td></tr>')
L('<tr><td><strong>IncomeStatement</strong></td><td>利润表</td><td>revenue, cogs, ebit, ebitda, netIncome</td><td>利息覆盖率、CCC</td></tr>')
L('<tr><td><strong>CapitalStructure</strong></td><td>融资结构</td><td>totalCapital, debtToEquity</td><td>WACC 计算</td></tr>')
L('<tr><td><strong>CostCenter</strong></td><td>成本归集</td><td>fixedCosts, variableCosts, budget</td><td>成本分类、刚性评估</td></tr>')
L('</table>')
L('<p><strong>拆分后的边关系</strong>：Financial（父节点）→ <code>HAS_SUBNODE</code> → 各子节点；CostCenter → <code>ALLOCATES_TO</code> → Team/Process/Product；CapitalStructure → <code>FINANCED_BY</code> → Supplier/Person。</p>')

# 1.3
L('<h3>1.3 边类型完整定义（17个）</h3>')
edges = [
    ('REVENUE_FROM', 'Financial → Client', 'share, revenueType, period', '客户营收占比、集中度'),
    ('COST_DRIVEN_BY', 'Financial/CostCenter → Process/Capability/Tool', 'share, costType', '成本构成、变动/固定分类'),
    ('SELLS_TO', 'Product → Client', 'annualContractValue, penetration', '合同价值、渗透率'),
    ('OWNS', 'Person → Process/Team/Capability', 'ownershipType, sharePercentage', '权力结构、决策链'),
    ('PROVIDES', 'Tool/Capability → Capability/Process', 'proficiencyLevel', '能力供给、SaaS利用率'),
    ('DEPENDS_ON', 'Product/Process → Tool/Capability/Supplier', 'dependencyStrength, criticality', '供应链风险、技术依赖'),
    ('INTERACTS_WITH', 'Person/Team ↔ Person/Team/Client', 'channel, weight, frequency', '网络效应、合作密度'),
    ('BELONGS_TO', 'Person → Team / Team → Team', 'role, startDate', '组织架构、BusFactor'),
    ('COMPETES_WITH', 'Product/Market ↔ Product/Market', 'intensity, overlapPercent', '竞争格局、SLM'),
    ('TRIGGERS', 'Event → Event', 'delayDays, causalityStrength', '问题-行动周期、修复能力'),
    ('ALIGNS_WITH', 'Goal ↔ Goal/Team/Process', 'alignmentScore', '目标对齐度'),
    ('SOURCES_FROM', 'Product/Process → Supplier', 'shareOfSupply, contractEndDate', '供应链集中度'),
    ('HAS_ACCESS_TO', 'Person/Team → Tool/Document', 'accessLevel', '信息访问、数据孤岛'),
    ('AFFECTS', 'Event/Risk → Financial/Team/Client', 'magnitude, direction', '事件影响分析'),
    ('CONSUMES', 'Process → Tool', 'usageFrequency, licenseCost', 'SaaS 使用审计'),
    ('CORRESPONDS_TO', 'Document → Goal/Event/Risk', 'relevanceScore', '文档-目标链接'),
    ('VALUE_PROPOSITION', 'Product → Client', 'valueScore, differentiationFactor', '价值主张强度'),
]
L('<table><tr><th>边类型</th><th>方向</th><th>关键 props</th><th>典型用途</th></tr>')
for et, direction, props, usage in edges:
    L(f'<tr><td><strong><code>{et}</code></strong></td><td>{direction}</td><td><code>{props}</code></td><td>{usage}</td></tr>')
L('</table>')

# 1.4 缺失的5条边
L('<h3>1.4 5 条缺失的关键边（本体层重构阶段1）</h3>')
L('<p>当前 17 条边不足以完全表达图遍历语义。以下 5 条新边是阶段1必须补齐的，每条配有客户A（新生儿纪念品企业）的具体例子。</p>')
L('<table><tr><th>新边</th><th>方向</th><th>语义</th><th>客户A例子</th></tr>')
L('<tr><td><strong><code>COMPENSATES</code></strong></td><td>Financial → Person</td><td>薪酬关系：哪些钱付给了哪些人（工资、奖金、提成）。将"人力成本"从 Financial.props 的一个数字变成沿边遍历的关系。</td><td>设计师（提成制 5%）、包装工（固定月薪）、老板（无薪靠分红）。砍掉一个客户群后，可通过 COMPENSATES 边精确计算哪些提成消失。</td></tr>')
L('<tr><td><strong><code>ALLOCATES_TO</code></strong></td><td>CostCenter → Team/Process/Product</td><td>成本分配：成本中心把资源花在哪些团队/流程/产品上。替代"管理费用""销售费用"的扁平分类。</td><td>"包装材料成本" ALLOCATES_TO Product（高端礼盒装）和 Product（简约装），计算两种 SKU 单位成本。"设计打样费" ALLOCATES_TO Process（新品开发流程）。</td></tr>')
L('<tr><td><strong><code>BUDGETS</code></strong></td><td>Financial → Team/Process/Goal</td><td>预算关系：钱预算给了哪些团队/流程/目标。建立"计划中"的资源分配图。</td><td>年度预算中 3 万元通过 BUDGETS 边连接 Goal（线上渠道拓展）。实际花费 vs 预算偏差大于50%触发性信号。</td></tr>')
L('<tr><td><strong><code>PARTICIPATES_IN</code></strong></td><td>Person → Process/Event/Team</td><td>参与关系：人在哪些流程/事件/团队中实际参与。比 BELONGS_TO（组织汇报线）更细粒度。</td><td>老板既参与"新品设计"流程（关键决策者），又参与"客户投诉处理"流程，还参与"包装发货"（旺季帮忙）。把包装委托出去→每天释放 3 小时→多设计 2 款新品。</td></tr>')
L('<tr><td><strong><code>GENERATES</code></strong></td><td>Product/Client/Market → Financial</td><td>生成关系：哪些产品/客户/市场生成了哪部分收入/成本。建立收入可追溯性。</td><td>2025 年营收 120 万。GENERATES 边追溯：Product（纪念币系列）→ 45 万；Product（手足印）→ 30 万；Client（月子中心）→ 25 万；Client（电商直销）→ 20 万。</td></tr>')
L('</table>')

# 1.5 图遍历 vs KV 对比
L('<h3>1.5 图遍历 vs KV 读取——设计哲学对比</h3>')
L('<p>同一个计算"客户营收集中度（HHI）"的两种实现方式：</p>')
L('<h4>KV 模式（当前/待淘汰）</h4>')
L('<pre><code>// bad: 从 Financial 节点的巨型 props 中取数据\nconst fin = store.queryNodes(\"Financial\", { teamId })[0];\nconst revenues = JSON.parse(fin.props.clientRevenues); // props 里有 JSON blob\nconst hhi = revenues.reduce((s, r) => s + (r.share * 100) ** 2, 0) / 10000;</code></pre>')
L('<h4>图遍历模式（目标）</h4>')
L('<pre><code>// good: 沿 REVENUE_FROM 边遍历到 Client 节点\nconst edges = store.queryEdges(\"REVENUE_FROM\", { fromNodeType: \"Financial\", teamId });\nconst hhi = edges.reduce((s, e) => s + (e.props.share * 100) ** 2, 0) / 10000;</code></pre>')
L('<p><strong>差异：</strong>KV 模式要求 Financial 节点知道所有客户的信息（耦合）。图遍历模式新增一个客户只需加一条 REVENUE_FROM 边（解耦）。前者是"读一个大对象"，后者是"沿着边做图遍历"。</p>')

# 1.6 本体层与哨兵关系
L('<h3>1.6 本体层与哨兵的关系</h3>')
L('<p>哨兵不直接访问数据库。哨兵通过 <strong>三个图遍历原语</strong>与本体层交互：</p>')
L('<ol>')
L('<li><code>store.queryNodes(nodeType, filter, groupBy?)</code> — 查询特定类型的节点</li>')
L('<li><code>store.queryEdges(edgeType, filter)</code> — 查询特定类型的边及其属性</li>')
L('<li><code>store.traverse(startNodeId, edgeTypes[], maxDepth)</code> — 从起点沿指定边类型做 BFS 图遍历</li>')
L('</ol>')
L('<div class="arch">哨兵 → compute(store, teamId) → store.queryNodes / queryEdges / traverse\n       → 沿边遍历获取数据 → 公式计算 → ComputeResult\n       → aggregate.ts 根据阈值生成 SentinelFinding[]</div>')

# 1.7 迁移路径
L('<h3>1.7 本体层重构迁移路径</h3>')
L('<table><tr><th>阶段</th><th>时间</th><th>任务</th><th>产出</th></tr>')
L('<tr><td><span class="badge b-p0">阶段1</span></td><td>Day 1-3</td><td>补 5 条新边类型 + 拆分 Financial 为 5 个子节点</td><td>5 个新边 JSON Schema + 5 个子节点类型定义 + 迁移脚本</td></tr>')
L('<tr><td><span class="badge b-p1">阶段2</span></td><td>Day 4-10</td><td>逐个 compute 函数从 KV 模式迁移到图遍历模式</td><td>75 个 compute 函数审查 + 重写 + 测试</td></tr>')
L('<tr><td><span class="badge b-p2">阶段3</span></td><td>Day 11-14</td><td>所有 46 个哨兵验收</td><td>端到端测试 + 客户A验证案例全量通过</td></tr>')
L('</table>')

L('<hr>')

with open(OUT, 'a', encoding='utf-8') as f:
    f.writelines(lines)
print(f"Ch0-1 appended: {len(lines)} lines", file=sys.stderr)
