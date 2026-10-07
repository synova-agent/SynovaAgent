# Task Brief: D650 专家 registry 改名（cycle → 问题域）——专家架构 P1 第一件

> 生成: 2026-09-09 | 分支: feat/win-d650-expert-domain-rename（基于 origin/main e8db4647） | as any: 0
> spec（唯一契约）: docs/plans/codex/implementation/SYNOVA-IMPL-D650-expert-registry-domain-rename-20260909.md
> Session: D650 | 隔离 clone: .sessions/D650/repo

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行——这就是增长导航。
目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
本任务把专家 registry 从「循环命名（cycle）」对齐到「问题域命名」：资金效率/客户增长/组织能力/技术底座/竞争战略五问题域 + host——权威口径落地的代码侧第一件。

### 三层解耦体系

**纵向解耦：五层物理隔离** — 本任务改 L2（src/agent/ 路由与分解）+ L3（src/l3/ 诊断引擎映射）+ 文件驱动层 expert/；不触 L4/L5。
**横向解耦：Monorepo 包** — 不触及。
**扩展解耦：文件驱动** — 专家增减 = expert/expert-registry.yaml 条目 + 目录，零代码改动（本任务正是把 registry 名字对齐问题域，文件驱动机制不变）。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
- [x] 纵向（改 L2/L3 代码 + 文件驱动层 expert/）
现状（spec §2.2 grep 实证）：expert-registry.yaml v2.0 七专家含 4 个 cycle 名 + finance-structure；src/agent/expert-router.ts:167-178 selectExpert 六处 return 旧名；src/agent/task-decomposer.ts:82-92 DIMENSION_EXPERT_MAP 十值旧名；src/l3/synova-diagnosis-engine-impl.ts:536-554 D1-D7+dept+恒等映射旧名。权威第六章 §6.6（问题域专家=资金效率/客户增长/组织能力/技术底座/竞争战略，专家名禁含 cycle）+ §6.9.1 迁移映射 + 第七章 §7.4 英文名。新增：改名对齐，无新机制。

### b) 文件审计
grep capital-cycle|customer-cycle|talent-cycle|finance-structure 全仓 19 文件命中（实测）：expert/ 目录 5 manifest.json + registry.yaml + host/CROSS_EXPERT.md:23（1 处 finance-structure 专家引用）；src/agent/ 2 文件 + src/l3/ 1 文件（专家语境，改名）；src/tui-v2/chat.tsx:43-51 EXPERT_DISPLAY_NAMES 展示键旧名（spec §2.2 未列，专家语境 broken 键，§3.2 回填）；src/cycles/cross-scale-validator.ts:53-56 + tests/cycles/ 2 文件（资源循环 cycleId，保留）；src/sentinel/runner.ts:77-97（DSH 线跨线引用，不碰，登记台账）。extensions/ 无既有覆盖。

### c) 决策
既有覆盖：ExpertRegistry/ExpertRouter/expert-dispatcher 均目录名驱动 name-agnostic → 只改 yaml+目录+硬编码映射，不新建机制。无覆盖：无。冲突：customer-cycle/talent-cycle 同串双语境（专家名改/资源循环保留）→ 逐处判语境禁全局 sed。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC：spec §6 DS1-DS8 为 Done 机器可验契约；§3.1 写集 + §5 接线表。
② 测试：先改 6 个测试断言跑红（旧名断言 vs 新 registry → fail），再改代码+yaml+目录跑绿。
③ 实现：git mv 4 目录 + finance-structure 归档 _deprecated + manifest name/displayName 同步 + registry v3.0（7→6，tools 并入）+ 3 处硬编码映射。
④ 接线：新名经 registry 目录名驱动自动被 expert-dispatcher/expert-registry 消费；grep 新名 ≥6 命中 + 旧名零残留（DS1/DS2）。
⑤ 验证：自检 6 问 + DS1-DS8 逐条跑。

引用依据：铁律 0-2（spec→test→impl→wire）、铁律 9（关键变更 grep 全仓库传播——chat.tsx/CROSS_EXPERT.md 传播即由此发现）、铁律 33/38/47/48、铁律 46（禁止桥接）、memory D586（CRLF 须 split(/\r?\n/)，brief 架构层两行式）、D492（接口审计 const 注解正则盲区）、D479/D588（跨午夜 brief 镜像）、D598（clone vitest 须 node --preserve-symlinks）、D470（CI UTC 日期）。

### b) Q1c 决策参考系
- 决策点 1（英文目录名）：参考：权威第七章 §7.4 已定英文名 + 结论 = fundamental-efficiency/customer-growth/organizational-capability/technology-foundation/competitive-strategy，采纳不自造（spec §4.5 决策点 1）。
- 决策点 2（cycle 歧义）：参考：权威第六章 §6.6「capital/customer/talent 只作资源维度/资源循环」+ 结论 = 专家名改名、src/cycles/ cycleId 保留，逐处判语境禁全局 sed（spec §4.5 决策点 2）。
- 决策点 3（finance-structure 合并）：参考：权威第六章 §6.9.1「并入资金效率」+ 结论 = tools 并入 fundamental-efficiency（8 tools），目录归档 expert/_deprecated/，registry 条目删除（spec §4.5 决策点 3）。
- 决策点 4（fundamental-efficiency 的 background 标志）：参考：第一性原理（身份继承——它是 capital-cycle 的改名继承者而非 finance-structure 复活）+ 结论 = background: true 沿袭 capital-cycle；finance-structure 只贡献 tools。诊断面（background:false）= host + competitive-strategy。
- 决策点 5（写集外 broken 引用 chat.tsx/CROSS_EXPERT.md）：参考：铁律 9 全仓库传播 + 结论 = 同 commit 修复（旧键指向已不存在专家），spec §3.2 同 commit 回填登记。

### c) 本任务执行约束（组 6 可验证）
- rule: "新问题域名必须在 expert/ + src/agent/ + src/l3/ 落地"
  verify: "grep -rn 'fundamental-efficiency' expert/ src/agent/ src/l3/"
- rule: "旧专家名在 src/agent/ src/l3/ expert/expert-registry.yaml 零残留"
  verify: "grep -rn 'capital-cycle' src/agent/expert-router.ts src/agent/task-decomposer.ts"
- rule: "资源循环 cycleId 未被误改"
  verify: "grep -n 'customer-cycle' src/cycles/cross-scale-validator.ts"

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- expert/expert-registry.yaml（修改，v3.0：7→6 专家；finance-structure 条目删除其 3 tools 并入 fundamental-efficiency；注释同步；避免旧名字面量残留）
- expert/fundamental-efficiency/manifest.json（capital-cycle/ 整目录 git mv 改名 fundamental-efficiency/，manifest name/displayName「资金效率专家」/description 同步）
- expert/customer-growth/manifest.json（customer-cycle/ 整目录 git mv 改名 customer-growth/，manifest 同步「客户增长专家」）
- expert/organizational-capability/manifest.json（talent-cycle/ 整目录 git mv 改名 organizational-capability/，manifest 同步「组织能力专家」）
- expert/technology-foundation/manifest.json（tech/ 整目录 git mv 改名 technology-foundation/，manifest name/displayName「技术底座专家」同步）
- expert/_deprecated/finance-structure/manifest.json（finance-structure/ 整目录 git mv 归档 _deprecated/，内容不动）
- src/agent/expert-router.ts（修改，selectExpert 六处 return 值改名 + 注释 D491→D650 对齐说明）
- src/agent/task-decomposer.ts（修改，DIMENSION_EXPERT_MAP 十值改名）
- src/l3/synova-diagnosis-engine-impl.ts（修改，mapDimensionToExpert 映射值 + 恒等映射 + 注释 7 位→6 位）
- expert/host/CROSS_EXPERT.md（修改，1 行 finance-structure 专家引用改 fundamental-efficiency——spec §3.2 回填偏离项）
- src/tui-v2/chat.tsx（修改，EXPERT_DISPLAY_NAMES 旧键改新键 + 中文标签对齐 manifest displayName——spec §3.2 回填偏离项）
- tests/agent/expert-router.test.ts（修改，断言旧名→新名 + 补 tech→technology-foundation 用例）
- tests/agent/task-decomposer.test.ts（修改，断言旧名→新名 + 补 market→customer-growth 用例）
- tests/expert/manifest-consistency.test.ts（修改，注释 7 位→6 位 + 新增禁 cycle 残留断言）
- tests/expert/expert-enum-propagation.test.ts（修改，REGISTRY_SEVEN→REGISTRY_SIX 新清单）
- tests/agent/expert-config-loader.test.ts（修改，新 6 专家清单 + version 3 + finance-structure 不存在断言）
- tests/electron/right-panel-report-sentinel.test.ts（修改，fixture expert 字段旧名→新名）
- tests/expert/tech-theory-injection.test.ts（修改，读 expert/tech/THEORY.md 路径→technology-foundation——短名 tech 波及，§3.2 回填）
- tests/expert/analytical-lens.test.ts（修改，EXPERTS 清单 tech→technology-foundation——短名 tech 波及，§3.2 回填）
- docs/plans/codex/implementation/SYNOVA-IMPL-D650-expert-registry-domain-rename-20260909.md（修改，§3.2 同 commit 回填最终形态）

写集（G12c 对照表）：

| 文件 | 操作 |
|---|---|
| expert/expert-registry.yaml | 修改 |
| expert/fundamental-efficiency/（原 capital-cycle/） | git mv + manifest 同步 |
| expert/customer-growth/（原 customer-cycle/） | git mv + manifest 同步 |
| expert/organizational-capability/（原 talent-cycle/） | git mv + manifest 同步 |
| expert/technology-foundation/（原 tech/） | git mv + manifest 同步 |
| expert/_deprecated/finance-structure/（原 finance-structure/） | git mv 归档 |
| src/agent/expert-router.ts | 修改 |
| src/agent/task-decomposer.ts | 修改 |
| src/l3/synova-diagnosis-engine-impl.ts | 修改 |
| expert/host/CROSS_EXPERT.md | 修改（§3.2 回填偏离） |
| src/tui-v2/chat.tsx | 修改（§3.2 回填偏离） |
| tests/agent/expert-router.test.ts | 修改 |
| tests/agent/task-decomposer.test.ts | 修改 |
| tests/expert/manifest-consistency.test.ts | 修改 |
| tests/expert/expert-enum-propagation.test.ts | 修改 |
| tests/agent/expert-config-loader.test.ts | 修改 |
| tests/electron/right-panel-report-sentinel.test.ts | 修改 |
| tests/expert/tech-theory-injection.test.ts | 修改（§3.2 回填偏离） |
| tests/expert/analytical-lens.test.ts | 修改（§3.2 回填偏离） |
| docs/plans/codex/implementation/SYNOVA-IMPL-D650-expert-registry-domain-rename-20260909.md | 修改（§3.2 回填） |
| .claude/task-briefs/2026-09-09-D650-expert-registry-domain-rename.md | 新建（本 brief） |

不做什么（含文件路径，路径紧跟动词）：
不改 src/cycles/cross-scale-validator.ts、tests/cycles/（customer-cycle/talent-cycle 此处是资源循环 cycleId，改名破坏 42 边因果骨架，spec §3.3）
不改 src/sentinel/runner.ts（DSH 线地盘；signal→expert 旧名映射属跨线引用，登记台账交 DSH 同步）
不改 expert/_deprecated/finance-structure/ 内部文件（归档语义，保留原内容）
不做 tools 对齐 compute seam、不做声明式可配置（P1 第二/三件，spec §3.3）
不引 DSH 包依赖、不 copy DSH 代码

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：GA 发起诊断（POST /api/diagnosis/consult）或 Sentinel 定时检查 → TaskDecomposer.decompose / ExpertRouter.selectExpert / mapDimensionToExpert 路由
处理（中间步骤）：维度/关键词按 DIMENSION_EXPERT_MAP、selectExpert 关键词表、mapDimensionToExpert 映射到新问题域名 → expert-dispatcher 从 registry 动态读名 → expert/{问题域}/ 目录加载 PROMPT/manifest
结果（最终展示在哪）：专家分析、TUI 专家标签（chat.tsx EXPERT_DISPLAY_NAMES）、sentinel 报告面板 expert 字段均显示新问题域专家；无 cycle 命名残留

## 架构层: L2+L3+文件驱动（src/agent/ 路由分解 + src/l3/ 诊断映射 + expert/ registry）
L2 expert-router/task-decomposer 与 L3 engine-impl 只改映射值不改层间依赖；expert/ 为文件驱动声明层，registry 驱动注册机制不变

#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] 旧专家名零残留: verify: grep -rn "capital-cycle\|customer-cycle\|talent-cycle\|finance-structure" src/agent/ src/l3/ expert/expert-registry.yaml（0 命中，DS1）
- [ ] 新名落地: verify: grep -rn "fundamental-efficiency\|customer-growth\|organizational-capability\|technology-foundation" expert/ src/agent/ src/l3/（≥6 命中，DS2）
- [ ] 资源循环未误改: verify: grep -n "cash-cycle\|customer-cycle\|talent-cycle\|product-cycle" src/cycles/cross-scale-validator.ts（仍命中，DS3）
- [ ] 测试 red→green: verify: npx vitest run tests/agent/expert-router.test.ts tests/agent/task-decomposer.test.ts tests/expert/manifest-consistency.test.ts tests/agent/expert-config-loader.test.ts（全 pass，DS4）
- [ ] 零回归: verify: npx tsc --noEmit（28 = 基线零新增，DS5）+ tests/agent/ tests/expert/ tests/l3/ 全绿
- [ ] 类型安全: verify: grep -rn "as any\|as never\|as unknown as" src/agent/expert-router.ts src/agent/task-decomposer.ts src/l3/synova-diagnosis-engine-impl.ts（新增行 0 命中，DS6）
- [ ] 范围一致: verify: git diff --name-only HEAD^（与写集一致，DS7；src/sentinel/ src/cycles/ 零改动）
- [ ] 无绕过: verify: grep -n "no-verify" .claude/bypass.log（0 命中，DS8）+ push + CI 绿
