# Task Brief: D758 证据目录域判定豁免（D734 假阳性修复）

> 生成: 2026-09-15 | 分支: fix/d758-evidence-domain-neutral | as any: 0
> 触发: 清 25 个 open PR 积压时，PR #538（line-1 的 1-5 双引导，Win）同步 main 后被 D734 单域判定卡死
> 域: mac（ownership.yaml + 控制塔测试 = Mac 控制塔域）
> 主线贡献: line-1（1-5）——本次豁免直接解锁 1-5 的合入路径；同族解锁 #511/#534
> 依据: docs/synova/coordination/整体推进计划-主线-20260913.md §三（阶段 1 退出条件：零 PR 积压）

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属控制塔（scripts/ 之外的数据层）：`docs/synova/coordination/ownership.yaml` 是模块所有权的**单一事实源**，
被 `scripts/control-tower/check-ownership.py`（单域/断言两模式）与 `scripts/control-tower/check-pr-budget.sh`（D734 PR 预算门禁）消费。
本任务只改**数据**（domain_neutral 一列 + 注释依据），不改任何脚本逻辑。

### b) 文件审计（实测，非推测）
- CI 实测（PR #538 run 34937314664 / job 104277946397）: ① 文件数 9 ≤ 12 通过；② 跨域 ❌，唯一 mac 项 =
  `docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt`（Win 自己的验收证据）。
- `ownership.yaml:151` 既有 `domain_neutral` 已含 `.claude/task-briefs/**`、`task-state/**`、`memory/notes/**` 等同族「各线都写自己那份」的路径 → 本次是同一条理由的延续，不是新机制。
- 测试落点: `tests/control-tower/check-ownership.test.sh`（§4b 域判定豁免）、`tests/control-tower/check-pr-budget.test.sh`（§3 跨域）。
关系：**复用**既有豁免机制 + **扩展**一条路径，零新增脚本、零新增抽象。

### c) 决策
不拆 PR（拆 = 把证据与实现割开，违反「②报告可溯源」），不放宽文件数上限（D734 禁调高上限），
不动 rules（该路径仍归 mac 供 CODEOWNERS 用）→ 只把它移入 `domain_neutral`（单域判定不判域，两种模式一致）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = #538 形态文件集在门禁下由红转绿，且「Win 代码 + Mac 脚本」仍红。
② 测试先行：先加 3 条断言（含反向必红一条）→ 跑出红（改 yaml 前）→ 改 yaml → 绿。
③ 实现 = ownership.yaml 一条路径 + 注释依据（可核到 CI run id）。
④ 接线 = 无新接线（既有消费方 check-ownership.py / check-pr-budget.sh 已读该字段）。
⑤ 验证 = 两套测试 + `--files` 注入三态（绿/反向红/恢复绿）。

引用依据：
- 铁律 35（自动化优先）：把「证据不掺域」写进门禁数据 + 测试，不靠人记
- D734 本意（冲突概率 ∝ 改动大小 × 分支存活时间）：本改不减文件数上限，只修域信号误判
- M2（声称 vs 事实）：本条改动的每句依据都带 CI run id / 文件:行
- 铁律 49（决策沉淀）：本决策落 `memory/notes/implemented/2026-09-15-evidence-domain-neutral.md`

### b) 本任务执行约束
- rule: "豁免不掩盖真跨域"
  verify: "bash tests/control-tower/check-pr-budget.test.sh → 「D758 豁免不掩盖真跨域」项通过"
- rule: "两条豁免路径在 --owner 模式下不参与断言"
  verify: "bash tests/control-tower/check-ownership.test.sh → 「豁免路径不参与 --owner 断言」项通过"
- rule: "文件数上限未被动过"
  verify: "grep -n 'MAX_FILES=12' scripts/control-tower/check-pr-budget.sh → 命中"

### c) 决策参考系
参考：第一性原理 + Anthropic 工程基线 + 结论——域信号的语义是「这条 PR 属于哪条线」，
证据文件的归属跟随干活的那条线（目录名自带域），故不构成域信号；与既有 4 条豁免同源。
收敛 → 只加一条路径，不新建机制。

### d) 相关 Note 引用
- memory/notes/implemented/2026-09-15-evidence-domain-neutral.md

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- docs/synova/coordination/ownership.yaml — `domain_neutral` 增加 `docs/synova/product-lines/evidence/**` + 实测依据注释
- tests/control-tower/check-ownership.test.sh — 新增 4 条断言（豁免生效 / 明示 domain-neutral / 不掺域 / 豁免不掩盖真跨域 / 不参与 --owner）
- tests/control-tower/check-pr-budget.test.sh — 新增 2 条断言（#538 形态转绿 / 真跨域仍红）
- memory/notes/implemented/2026-09-15-evidence-domain-neutral.md — 决策 Note

不做什么：
- 不改 scripts/control-tower/check-pr-budget.sh（文件数上限与逻辑一律不动）
- 不改 scripts/control-tower/check-ownership.py（豁免读取逻辑已存在，本次只用数据）
- 不改 src/sentinel/types.ts（与 D752 无关，避免撞车）
- 不改 scripts/audit/（K3 红线）
- 不改 .github/workflows/ci.yml（控制塔红区，本单无必要）

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：`bash scripts/control-tower/check-pr-budget.sh --base origin/main`（pre-commit 组 + CI strict 同一入口）
处理（中间步骤）：取 base...HEAD 变更集 → ① 文件数 ≤12 → ② 调 check-ownership.py 单域判定（domain_neutral 路径不计域）→ ③ 落后基线数
结果（最终展示在哪）：#538 形态文件集输出「✅ ② 变更单域: win（域判定豁免 1）」；PR #538 CI 由红转绿

## 架构层: scripts（控制塔：ownership 数据层 + 门禁测试）；不触 L1-L5
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: verify: bash scripts/control-tower/check-pr-budget.sh --files "docs/synova/product-lines/evidence/D716-win-20260913/1-5-dual-guide-win-evidence.txt src/server.ts tests/routes/setup-guide-retired.test.ts docs/synova/runbooks/desktop-dev-prod.md" → exit 0（② 变更单域 win）
- [ ] 链路走通: verify: bash tests/control-tower/check-pr-budget.test.sh → 24 项全过；bash tests/control-tower/check-ownership.test.sh → 51 项全过
- [ ] 反向验证: verify: 临时从 domain_neutral 移除证据路径 → 同 --files 命令 exit 1（❌ 变更跨域）；恢复后 exit 0
- [ ] 结果可见: grep -c "product-lines/evidence" docs/synova/coordination/ownership.yaml → ≥2（豁免项 + 依据注释）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-15-D758-evidence-domain-neutral.md | task |
| docs/synova/coordination/ownership.yaml | task |
| memory/notes/implemented/2026-09-15-evidence-domain-neutral.md | task |
| task-state/D758.json | task |
| tests/control-tower/check-ownership.test.sh | task |
| tests/control-tower/check-pr-budget.test.sh | task |

