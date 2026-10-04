# Task Brief: D1148 声明类门禁 15 → 3（降噪，改坏即红）

> 生成: 2026-10-05 | 任务: D1148 | 认领: gate-decl-consolidate（治理线）| 来源: task-3 / 批 3 单套门禁
> 分支: chore/D1148-decl-consolidate ｜ 工作树: `.synova-wt-decl`（D539 隔离）
> 坐标：执行态=施工中 ｜ 施工批次=批3 ｜ 服务承重件=提交端门禁 ｜ 总闸=#973 ｜ 命名空间=scripts/ ｜ 验证级别=夹具注入 ｜ 阻塞源=无

#CRITERIA: A

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
**增长导航**：Agent 不是 ChatBot——驻扎企业、持续观测、主动发现、自动诊断、给出行动建议、跟踪执行。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属**控制塔治理面**（`scripts/pre-commit-check.sh` 提交端门禁 + `tests/control-tower/` 夹具），**不触产品五层 L1–L5 业务代码**。
它服务的是批 3「声明类门禁 15 → 3」：门禁命中实测声明类占 `gate-hits` 命中约 35%，榜首 `opt_check "PRD 对照…"` 261 次命中且**永不阻断** —— 噪音把真信号淹掉（V3.9 教训：软机制 0% 有效；噪音 ⇒ 绕过）。
该层现有机制：`scripts/pre-commit-check.sh`（13 组 + 附加块 D782/D734/D520/D943）、`scripts/check-plan-integrity.sh`、`scripts/check-verifiable-done.sh`、`scripts/check-q0c-tracking.sh`、`scripts/check-acceptance-ci.sh`、`scripts/control-tower/check-pr-budget.sh`、`scripts/doc-system/check-doc-truth.sh`、`scripts/doc-system/doc-registry-gate.sh`。本任务是**收敛**（15 个声明类执行点 → 3 条硬闸；其余转旁路/退役），不是新建机制。

### b) 文件审计
实测（2026-10-05，worktree `.synova-wt-decl` @ origin/main 1630a5014）：
- `scripts/pre-commit-check.sh`（1603 行）：声明类执行点 15 个 —— 组 6（brief 存在 / 6 字段 / 骨架 / 时间戳 / Notes 迁移 / plan-integrity / verifiable-done / q0c / PRD 对照）、组 8（acceptance-ci）、组 12（G12 范围 / G12b 可解析 / G12c dev doc 写集 / G12d 声称↔证据表）、D782（D1 真相 / D2 登记）、D734（PR 预算）。
- 同源解析器 `scripts/control-tower/brief_parser.py`（294 行，组 6 架构层 + 组 12 Q2 均调它）→ **已单源，无需改**。
- 夹具：`tests/control-tower/hard-gate-convergence.test.sh`（118 行，实测 6 红）、`tests/control-tower/precommit-groups-injection.test.sh`（666 行，已登记 ci.yml:792）。
- **接线约束（grep 实证，改前必读）**：`gate-failopen-net.test.sh` 依赖组 7a 的 ✅ 行；`hard-gate-convergence.test.sh` 依赖 hard/soft 源串；`check-pr-budget.test.sh` 依赖 `跳过 12 组` + `全部 13 组通过` 横幅；`doc-registry-gate.test.sh` W1/W2 依赖 D1/D2 调用点在 pre-commit；`doc-commit-exempt.test.sh` T11 依赖 G12c 调用点在 pre-commit；`check-notes-lifecycle.test.sh` 依赖 Notes 迁移调用点。
- 关系判定：**收敛**（执行点合并 + 成功静默，判定语义与点名保持），不新建第二实现。

### c) 决策
无冲突（本卡为 Lead 派单，写集唯一）。三条边界按最保守解释落地并在 PR 正文标注代价（见 Q1c）。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC/Done → ② 测试（先红：注入夹具先证明三条会红）→ ③ 实现 → ④ 接线（夹具注册/被 CI 真跑）→ ⑤ 自检。
引用依据：铁律 0-2（spec→test→impl→wire→review→merge）、铁律 7（入口可触达/链路走通/结果可见）、铁律 11+24（禁静默降级）、铁律 35（能脚本化的不靠 review）、铁律 38（三态退出码）。
历史教训：memory/notes D515/D516（软提示 + CI 权威）、D542（CI strict 失败必须点名）、D1028（假绿专题：注入即验证）、V3.9（硬阻断 100% 有效，软机制 0% 有效）。

### b) 本任务执行约束
- rule: "三条硬闸必须可被注入即红（不得 fail-open）"
  verify: `bash tests/control-tower/precommit-groups-injection.test.sh`
- rule: "成功路径静默 ≠ 失败路径静默：违规必须点名且进 CI annotation"
  verify: `bash tests/control-tower/ci-strict-visible.test.sh`
- rule: "组 7a 的 ✅ 行与 13 组横幅是既有夹具的判据输入，不得被静默"
  verify: `bash tests/control-tower/gate-failopen-net.test.sh`
- rule: "禁 `|| true` 吞崩溃；三态 0/1/2"
  verify: `grep -c '检查降级' scripts/pre-commit-check.sh`

### c) 决策参考系
① 第一性原理：门禁的价值 = **判别力**（抓得到 + 不误拦），不是执行点数量；一个被绕过的门禁 = 没有门禁。
② Anthropic 工程基线：fail-closed、成功静默/失败点名、夹具先红后绿。
③ 开源实证：CI 日志信噪比决定绕过率（V4.5.1 实证 122s pre-commit → `--no-verify` 泛滥）。
④ 收敛：三者同向 ⇒ **声明类收敛为三条硬闸，其余转旁路（只打印不判红不记 hit），成功路径静默**。
参考：Anthropic/DeepSeek/第一性原理 + 结论＝三闸 + 旁路 + 成功静默。

**三条边界的最保守解释（B 档，代价随附）**：
- 「Q0 系列」＝ Q0 字段填写 + Q0c 取消跟踪（`check-q0c-tracking.sh`）并入闸①；**不新增 Q0a/Q0b/Q0c 子节强制**。代价：Q0 小节粒度不拦（只拦整段空）。
- 「D1/D2 转旁路」＝ 保留调用点（`doc-registry-gate.test.sh` W1/W2 依赖）但降为只打印不判红、不进 `gate-hits.log`。代价：D2 登记门禁不再阻断 CI（原 soft→CI strict 转硬）。
- 「plan-integrity 转旁路」＝ 其 **Q2 排除项**判定并入闸②（去重：G12 已按认领者判排除项；plan.json 侧 principles/approach/memory_refs 降为旁路观测）。代价：plan.json 三项不再阻断。

### d) 相关 Note 引用
- [x] memory/notes/proposed/2026-10-05-d1148-decl-consolidate.md（本任务新建 proposed）

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- scripts/pre-commit-check.sh
- tests/control-tower/hard-gate-convergence.test.sh
- tests/control-tower/precommit-groups-injection.test.sh
- .claude/task-briefs/2026-10-05-D1148-decl-consolidate.md
- memory/notes/proposed/2026-10-05-d1148-decl-consolidate.md

不做什么（含文件路径）：
- 不改 .github/workflows/ci.yml
- 不改 scripts/control-tower/brief_parser.py
- 不改 scripts/check-plan-integrity.sh
- 不改 scripts/check-verifiable-done.sh
- 不改 tests/control-tower/gate-failopen-net.test.sh
- 不改 tests/control-tower/ci-strict-visible.test.sh
- 不改 tests/control-tower/check-pr-budget.test.sh
- 不改 scripts/ci/verify-doc.sh

## Q3: 验收 — 入口 → 交互 → 结果

入口（从哪触发）：`bash scripts/pre-commit-check.sh`（提交端）/ `SYNO_CI=1`（CI Iron Laws 口径）。
处理（中间步骤）：声明类 15 个执行点收敛为闸①brief schema / 闸②brief↔代码一致性 / 闸③可证伪 Done；其余转旁路（只打印不判红、不进 gate-hits）或退役（删检查点 + 注释指向 D1148）；成功路径静默、失败路径点名。
结果（最终展示）：干净树输出行数 ≤40 且 exit 0；注入三条违规 → 三条各自点名并 exit 1；12 个 `── 组 N/13` 标签与 `全部 13 组通过` 横幅不变。

## 架构层: 基础设施

控制塔提交端（`scripts/`）——不触产品五层 L1–L5 依赖方向。

## Done 标准
- [x] verify: bash scripts/pre-commit-check.sh | wc -l 输出行数 ≤40
- [x] verify: SYNO_CI=1 bash scripts/pre-commit-check.sh; echo $? 对干净树 exit 0
- [x] verify: bash tests/control-tower/precommit-groups-injection.test.sh rc=0（含三条硬闸注入即红断言）
- [x] verify: bash tests/control-tower/hard-gate-convergence.test.sh rc=0（改前 6 红 → 0）
- [x] verify: bash scripts/control-tower/check-gate-integrity.sh 输出 GATE-INTEGRITY: OK
- [x] verify: bash tests/control-tower/gate-failopen-net.test.sh rc=0（组 7a 判别力不回退）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-05-D1148-decl-consolidate.md | task |
| memory/notes/proposed/2026-10-05-d1148-decl-consolidate.md | task |
| scripts/pre-commit-check.sh | task |
| tests/control-tower/hard-gate-convergence.test.sh | task |
| tests/control-tower/precommit-groups-injection.test.sh | task |
