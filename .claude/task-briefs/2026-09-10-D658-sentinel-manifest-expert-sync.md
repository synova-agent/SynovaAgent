# Task Brief: [2026-09-10 跨午夜镜像 of 09-09 追踪名 brief，内容一致双日期追踪（D600）] D658 哨兵 manifest expert 字段同步——专家体系末段残留收口（45 manifest expert/auxiliaryExperts 旧 8 名 → 新 5+host）

> 生成: 2026-09-10 | 分支: feat/win-d658-sentinel-manifest-expert-sync (base=origin/main 含已合并的 #463/D658 dev-doc) | as any: 0

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统，也是组织增长导航系统。
诊断是手段，增长才是目的。核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

### 三层解耦体系

**纵向解耦：五层物理隔离**
代码按 L1-L5 架构分层，每层只与相邻层通信。pre-commit 物理阻断跨层 import。

**横向解耦：11 个独立 Monorepo 包**
@synova/sog-core / @synova/sentinel-engine / @synova/expert-platform 等，接口边界明确。

**扩展解耦：文件驱动，不改代码**
新增专家 = 新建目录 + 文件 → expert-registry 自动注册；专家名以 expert/expert-registry.yaml 为唯一事实源。

流程约束: V4.5.1 — task brief 6 字段强制 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务是 extensions/sentinels/ 哨兵清单数据文件的**机械字段改名**（L3 洞察层哨兵体系 → 专家路由的声明侧）。D650 已把 registry 改为 v3.0 六位问题域专家（PR#454），D651 已同步 src/ 主路由链与桌面端（PR#458）；本卡收口末段残留：45 个 per-sentinel manifest.json 的 "expert"/"auxiliaryExperts" 字段仍用旧 8 名，sentinel-loader.ts 加载后经 registry v3.0 校验将指向失效专家名（getSentinelsByExpert 按旧名过滤恒空）。现有模块：sentinel-loader.ts（唯一消费者，加载 manifest 的 expert 字段做 init 接线验证 + getSentinelsByExpert 路由查询）。本任务 = 扩展（数据对齐），不新增模块、不改 loader、不改架构。

### b) 文件审计
grep 实证（主工作区 @5494e6f6 = origin/main，2026-09-09）：extensions/sentinels/*/manifest.json 共 45 个（不含顶层 manifest.json）均含 "expert" 字段，旧值分布 org 13 / strategy 11 / tech 8 / finance 6 / business_model 5 / marketing 2（合计 45，spec §2.2 分布计数为字段行口径差异，以实测为准）；"auxiliaryExperts" 旧值分布 strategy 21 / knowledge 13 / finance 7 / marketing 5 / org 4 / tech 2（合计 52 处）。样例 agent-deployment-maturity/manifest.json："expert": "tech" + "auxiliaryExperts": ["org"] + "layer": "technology"（layer 是信号维度非专家名，不改）。顶层 extensions/sentinels/manifest.json 的 "sentinels" 分组字段（finance/org/strategy/marketing…）是哨兵分类名、"model.tiers.expert" 是文档字符串，均不改。src/sentinel/sentinel-loader.ts:24 expert: string / :103-105 getSentinelsByExpert / :248 auxiliaryExperts 透传（唯一消费者，本卡不改）。tests/expert/manifest-consistency.test.ts 现有 7 用例只扫 expert/ 六位专家清单，未扫哨兵 manifest——按 spec §3.1 新增哨兵 manifest expert 字段一致性断言。

### c) 决策
已有覆盖→复用：改名字段消费链经 sentinel-loader → registry v3.0 校验，新名清单以 getAllExpertIds() 同源（host + 5 问题域）。无新建硬编码类型（manifest 是 json）。冲突→无（D650/D651 已合入，映射表以 spec §2.1 为准，与 D651 §2.2 一致）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = spec §6 DS1-DS8 机器可验；② 测试先行——先在 tests/expert/manifest-consistency.test.ts 新增哨兵 manifest expert/auxiliaryExperts ∈ 新 6 名断言跑红（旧名不匹配→fail），再改 45 个 manifest 跑绿；③ 实现 = 机械映射替换（strategy→competitive-strategy、finance→fundamental-efficiency、org→organizational-capability、tech→technology-foundation、marketing→customer-growth、business_model→competitive-strategy、action→host、knowledge→host），零逻辑变更；④ 接线 = 新名经 sentinel-loader 加载后不再指向 registry v3.0 失效名；⑤ 验证 = DS1-DS8 + tsc 基线对照。
引用依据：铁律 0-2（spec→test→impl→wire→merge）；铁律 7（入口可触达+链路走通+结果可见）；铁律 47（声称完成必须 grep 物理证明）；铁律 9（关键变更 grep 全仓库传播）。

### b) 本任务执行约束
  - rule: "只改 expert/auxiliaryExperts 两个字段值——禁止顺手改 layer/分类名/文档串/数组结构"
    verify: "git diff -U0 origin/main -- extensions/sentinels/ | grep -E '^[+-]' | grep -vE '^[+-]{3}' | grep -vE '\"(expert|auxiliaryExperts)\"|host|fundamental-efficiency|customer-growth|organizational-capability|technology-foundation|competitive-strategy|strategy|org|finance|tech|marketing|business_model|action|knowledge' | wc -l"
  - rule: "全局 sed 禁止——逐 manifest 按映射改，防误伤 layer=technology 等信号维度值与顶层分类名"
    verify: "git diff --name-only origin/main -- extensions/sentinels/manifest.json | wc -l"
  - rule: "src/ 零改动——本卡只改 manifest 数据文件 + 1 测试（DSH 线 sentinel-loader.ts 不碰）"
    verify: "git diff --name-only origin/main -- src/ | wc -l"

### c) 决策参考系
决策点 1（旧 8 → 新 5+host 的语义映射）: 参考系 = D651 §2.2 迁移表 + 第六章 §6.6 问题域专家 5 个 + host——采纳逐值机械映射，不重推。参考：Anthropic/第一性原理 + 结论（逐值机械映射，spec §4.5 决策点 1）。
决策点 2（auxiliaryExperts 是否保留语义）: 参考系 = 第六章 host 唯一主 agent 统筹、按需激活——采纳机械改名保留数组结构（旧 aux 名→新名，不改数组长度/顺序）。参考：Anthropic（最少机制）+ 结论（spec §4.5 决策点 2）。

### d) 相关 Note 引用
- [ ] memory/2026-09-09-d650-expert-domain-rename-delivery.md（G12 matches 路径末段规则）
- [ ] memory/2026-09-09-d651-expert-name-sync-delivery.md（映射表 + 审计漏口方法论）

### 文档引用
- docs/plans/codex/implementation/SYNOVA-IMPL-D658-sentinel-manifest-expert-sync-20260909.md（唯一契约，§2.1 映射 + §6 DS1-DS8）
- docs/synova/research/专家架构重定义与权威口径审计-20260905/第六章-专家架构权威定义与路线图-20260905.md §6.6 术语表 + §6.9
- docs/synova/research/专家架构重定义与权威口径审计-20260905/第七章-专家可组合性深度补充研究-20260906.md §7.4 英文名
- expert/expert-registry.yaml v3.0（D650 交付，权威英文名落地）

### 接口审计
src/sentinel/sentinel-loader.ts: expert 字段类型 :24（expert: string）、getSentinelsByExpert :103-105（按 expert 等值过滤）、auxiliaryExperts 透传 :248——manifest 值改名后 loader 加载逻辑零变更，getSentinelsByExpert('competitive-strategy') 等新名查询才可能命中。
tests/expert/manifest-consistency.test.ts: getAllExpertIds()（src/agent/expert-config-loader）动态读 registry，本卡新增哨兵 manifest 扫描断言复用该同源清单作合法值集合。

## Q2: 范围 — 正确的最简方案是什么？

做什么（写集 45 manifest + 1 测试 + 2 簿记，逐文件认领）：
- extensions/sentinels/agent-deployment-maturity/manifest.json
- extensions/sentinels/ai-ecosystem-fit/manifest.json
- extensions/sentinels/ai-investment-return/manifest.json
- extensions/sentinels/api-coverage/manifest.json
- extensions/sentinels/business-model-coherence/manifest.json
- extensions/sentinels/capital-health/manifest.json
- extensions/sentinels/cash-runway/manifest.json
- extensions/sentinels/channel-capacity/manifest.json
- extensions/sentinels/competitive-moat/manifest.json
- extensions/sentinels/competitive-position/manifest.json
- extensions/sentinels/customer-demand-shift/manifest.json
- extensions/sentinels/data-health/manifest.json
- extensions/sentinels/environment-rent-dependency/manifest.json
- extensions/sentinels/explore-exploit-balance/manifest.json
- extensions/sentinels/financing-constraint/manifest.json
- extensions/sentinels/growth-quality/manifest.json
- extensions/sentinels/human-agent-boundary/manifest.json
- extensions/sentinels/incentive-alignment/manifest.json
- extensions/sentinels/info-distortion/manifest.json
- extensions/sentinels/internal-transaction-cost/manifest.json
- extensions/sentinels/key-person-risk/manifest.json
- extensions/sentinels/knowledge-accessibility/manifest.json
- extensions/sentinels/make-or-buy/manifest.json
- extensions/sentinels/margin-health/manifest.json
- extensions/sentinels/moat-dependency/manifest.json
- extensions/sentinels/network-power/manifest.json
- extensions/sentinels/niche-breadth/manifest.json
- extensions/sentinels/niche-squeeze/manifest.json
- extensions/sentinels/opportunity-window/manifest.json
- extensions/sentinels/org-repairability/manifest.json
- extensions/sentinels/path-dependency/manifest.json
- extensions/sentinels/power-rigidity/manifest.json
- extensions/sentinels/process-ai-readiness/manifest.json
- extensions/sentinels/resource-misallocation/manifest.json
- extensions/sentinels/revenue-health/manifest.json
- extensions/sentinels/routine-diffusion/manifest.json
- extensions/sentinels/routine-mutation/manifest.json
- extensions/sentinels/sentinel-forecast-accuracy/manifest.json
- extensions/sentinels/sentinel-pricing-strategy/manifest.json
- extensions/sentinels/software-health/manifest.json
- extensions/sentinels/strategy-capability-fit/manifest.json
- extensions/sentinels/talent-density/manifest.json
- extensions/sentinels/time-penetration/manifest.json
- extensions/sentinels/unit-economics/manifest.json
- extensions/sentinels/value-capture/manifest.json
- tests/expert/manifest-consistency.test.ts
- tests/sentinel/sentinel-loader.test.ts
- docs/plans/codex/implementation/SYNOVA-IMPL-D658-sentinel-manifest-expert-sync-20260909.md
- .claude/task-briefs/2026-09-09-D658-sentinel-manifest-expert-sync.md
- .claude/task-briefs/2026-09-10-D658-sentinel-manifest-expert-sync.md

映射规则（spec §2.1，与 D651 §2.2 一致）：strategy→competitive-strategy、finance→fundamental-efficiency、org→organizational-capability、tech→technology-foundation、marketing→customer-growth、business_model→competitive-strategy、action→host、knowledge→host。

不做什么（排除项，路径紧跟动词）：
- 不改各 manifest 的 layer 字段（technology/capital/alignment 等是信号维度非专家名，spec §3.3）
- 不改顶层 extensions/sentinels/manifest.json（sentinels 分组是哨兵分类名 + model.tiers.expert 是文档串，spec §3.3）
- 不改 src/sentinel/sentinel-loader.ts（DSH 线；本卡只改 manifest 数据文件不改 loader，spec §3.3）
- 不改 src/ 其余任何文件（D650/D651 已收口主路由链，基线 grep 零旧名）
- 不改 expert/ 与 expert/expert-registry.yaml（D650 已交付 #454）
- 不用全局 sed 批量替换旧 8 名（会误伤 layer/分类名/文档串）
- 不引 @deepseek-ai（非借鉴卡）；不用 --no-verify

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：哨兵 Cron → Sentinel.check → sentinel-loader 加载 45 个 manifest（expert/auxiliaryExperts 字段）→ 信号聚合 → 专家路由派发。
处理（中间经过哪些步骤）：loader 按 manifest expert 字段接线验证 → getSentinelsByExpert(新名) 路由查询可命中（旧名查询恒空的问题消除）→ registry v3.0 校验新名全部合法。
结果（最终展示在哪）：哨兵 finding 派发到正确问题域专家（host + 5 问题域）；tests/expert/manifest-consistency.test.ts 新增哨兵 manifest 断言全绿 + DS1-DS8 逐条通过。

## 架构层: L3
L3 洞察层（sentinel 哨兵清单声明侧数据对齐），零代码逻辑变更、零跨层依赖变更、无五层边界变更。

#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Q4: 历史教训（memory/ 检索结果对照）
- D651 交付 → 映射表逐值对齐 + 审计 grep 漏口方法论（signal 生产者/多断言点/extensions manifest 未扫）——本卡正是 D651 指出的 extensions 45 manifest 漏口的收口。
- D650 交付 → G12 matches 只认路径末段：Q2 include 逐文件完整相对路径列全（45 条全枚举，D358 教训不吃 glob）。
- D598 → clone+junction vitest 双实例全灭：统一用 node --preserve-symlinks node_modules/vitest/vitest.mjs run。
- D590 → CRLF 第二根因：json 文件改动用 Edit 精确行替换，不整文件重写防 CRLF 漂移。
- D356/D479 → /tmp/.synova-before-brief 陈旧条目提交前检查，brief mtime 晚于证据时 rm 安全。
- D338 → 测试副作用工件提交前还原；本卡零数据写入，无此风险。

## Done 标准
- [x] DS1 旧 8 名零残留: verify: grep -E '"expert": "(strategy|org|finance|tech|marketing|business_model|action|knowledge)"' extensions/sentinels/*/manifest.json | wc -l → 0 ✅ 实测 0（2026-09-09）
- [x] DS2 新名落地: verify: grep -cE '"expert": "(fundamental-efficiency|customer-growth|organizational-capability|technology-foundation|competitive-strategy|host)"' extensions/sentinels/*/manifest.json | 总命中 ≥40（45 manifest 全覆盖）✅ 实测 45/45（JSON 级分布 competitive-strategy 16 / organizational-capability 13 / technology-foundation 8 / fundamental-efficiency 6 / customer-growth 2）
- [x] DS3 auxiliaryExperts 零旧名: verify: grep -A3 '"auxiliaryExperts"' extensions/sentinels/*/manifest.json | grep -cE '"(strategy|org|finance|tech|marketing|business_model|action|knowledge)"' → 0 ✅ 实测 0（JSON 项级 49 项全部 ∈ 新 6 名）
- [x] DS4 测试 red→green: verify: node --preserve-symlinks node_modules/vitest/vitest.mjs run tests/expert/manifest-consistency.test.ts → 全 pass（红证据留存在会话记录）✅ RED: 2 failed（expert "tech" / aux "org"）→ GREEN: 14 passed
- [x] DS5 零回归: verify: node --preserve-symlinks node_modules/vitest/vitest.mjs run tests/expert/ tests/sentinel/ 全绿 + npx tsc --noEmit 报错集 = 基线（零新增，逐条 diff）✅ FAIL 集与基线恒等（仅 analytical-lens 7 例 D650 期既有红，基线 revert→run→restore 实证）；tsc 33=33 IDENTICAL_ZERO_DELTA（clone 环境口径；spec 记 28 为主工作区口径，判据=零新增）；sentinel-loader.test.ts 'finance' 断言随映射同步为 'fundamental-efficiency'（spec §3.1 写集遗漏，§3.2 回填）
- [x] DS6 类型安全: verify: grep -nE "as any|as never|as unknown as" tests/expert/manifest-consistency.test.ts → 0 命中 ✅ 实测 0
- [x] DS7 范围一致: verify: git diff --name-only origin/main..HEAD → 恰为本 brief Q2 写集（45 manifest + 2 测试 + spec/brief 簿记），src/ 零改动 ✅ 测试 2 文件（manifest-consistency 新增哨兵断言 + sentinel-loader 旧名断言同步）
- [x] DS8 无绕过 + 推送 CI: verify: grep -c "no-verify" .claude/bypass.log → 今日 0 新增；git push 后 CI task-relevant jobs 绿（job 级）✅ 真实门禁提交，无 --no-verify；PR#468 run 34376372668 task-relevant jobs 全绿（Vitest 1/2+2/2、TypeScript+Lint+Iron Laws、Integration Contract、Golden Case F1、Checker Review、Test-Kit Architecture×2、npm audit）；Architecture Check + Control Tower Gate Tests×2 红 = main 基线既有非本卡引入（main @5494e6f6 push run 34368678861 / @0c6e52b2 run 34376561252 / @30011654 run 34377559486 同三红 job 级对照，D651 豁免先例；本地同测试 alloc-task-id 15/15 + ct-test-gate 6/6 PASS）→ 控制塔域 CI 环境问题转台账 CTO
