# Task Brief: D1223 staging_guard.py 退役（D-C 标识归一余项 ①）

> 生成: 2026-10-07 | 任务: D1223 | 认领: line-f-dc（治理线施工队 D-C 接力位）
> 父：D-C 标识与声明归一（核心已合 main：#1267/#1275/#1278；本件 = K3 R1「认领制退役」项）
> 纪律: 判据变更 ⇒ PR 正文单列「判据变更点 / 旧口径 vs 新口径 / 回滚方式」

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
本任务在**控制塔（基础设施层）**，不触 L1-L5 产品层。目标：把 D311 M1b 的本地
暂存区隔离件 `staging_guard.py` **真退役**（删除文件 + 逐消费点处置），因为它的两条判据
都已有真承重件承担 —— 本地留存副本 = 第三套解析口径（K3 R1 定罪形态）。
新增/替换/扩展判定：**删除** staging_guard.py（不新建替代脚本）；**扩展** 既有
`claim_store.py` 为唯一 claim 单一入口（只读消费，不改其契约）。

### b) 文件审计（grep 实况，非记忆）
- 全量消费点（`grep -rn "staging_guard" scripts/ .github/ tests/`）→ **生产 3 + 测试 11**
  · 生产：`scripts/control-tower/synova-commit:365,599-657`（唯一真实调用点）／
    `scripts/control-tower/self-health.py:43`（CORE_COMPONENTS 存在性清单）／
    `scripts/control-tower/incident-loop.py:25,149`（R1 工具表 + 头注释）
  · 测试（密封面内 2）：`tests/control-tower/staging_guard.test.sh`（**CI 执行集内**）／
    `tests/control-tower/synova-commit.test.sh`（**CI 执行集内**，①②④ 三项断言钉死接线字面量）
  · 测试（隔离台账内，不在执行集）：`staging-guard-session.test.py`／`tag-bypass-wiring.test.sh`
    （`:320 from staging_guard import check_staging` 真实 import）／`commit-msg-note-mandatory.test.sh`
    （仅把路径当夹具名）／`check-dev-doc-write-set.test.sh`（`:37` 当"真实存在"夹具路径）／
    `resolve-commit-brief.test.sh`（仅注释）
  · 测试（不在密封面）：`test-staging-guard.py`
- `ci.yml` 直引：`grep -n staging .github/workflows/ci.yml` → **零命中**（无重建需求）
- 只读保留/注释位点：`session_registry.py:285`／`brief_parser.py:56`／
  `resolve-commit-brief.sh:251`（三条纯注释，**本 PR 不改**，见 Q2 不做什么）

### c) 决策
- 复用：`claim_store.py` 作**唯一** claim 入口（只读 `--resolve`）；CI 权威承担者 =
  `merge_writeset_gate.py`（D708，ci.yml 已有真实 step）。
- 删除：`staging_guard.py`（铁律 37 死代码入仓即违规）。
- 取消：本地**阻断**改为**只读呈报 + 显式降级**——代价逐条登记（见 Q2 与 PR 正文例外清单）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 业界：门禁的"单一判据源"原则——同一判据多实现必然漂移（GitHub required checks 单点产出）；
  本地预判只做**快速反馈**，权威判定收敛到 CI（本仓 D515/D516「本地软提示 + CI 权威」）。
- Anthropic 决策链：spec（逐消费点处置表 + 替身存在的物理证据）→ 夹具先行（改坏即红 + 变异体）
  → 实现 → 接线（`grep -rn staging_guard scripts/ .github/` 零命中）→ 验证（CI 同语境复跑）。
- memory/ 教训：铁律 11（禁静默降级——退役必须打印结论，不得"无声消失"）、铁律 24/31
  （降级显式 + 传播）、铁律 37（死代码须删 + grep 零引用）、铁律 49（决策沉淀四态 Note）、
  铁律 0-2（WIRE CHECK：替代物必须在 CI 真实存在，非纸面声称）、ctrl-tower-change 模式 1
  （三态退出码）、模式 3（条件跳过保 <1s）、模式 6（改完的验收链）。
- 参考：Anthropic 工程基线（契约优先 + 夹具先行）+ 判例三档 B（最保守解释 + 代价显式登记）。
  结论：退役后**不新增本地阻断**（不加第三套判据），只保留只读呈报；替换真实由 CI D708 承担，
  并以「替身在 ci.yml 真实可执行」为夹具断言。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/staging_guard.py
- scripts/control-tower/synova-commit
- scripts/control-tower/self-health.py
- scripts/control-tower/incident-loop.py
- scripts/control-tower/gate-integrity-baseline.txt
- tests/control-tower/self-health.test.sh
- tests/control-tower/staging_guard.test.sh
- tests/control-tower/staging-guard-retirement.test.sh
- tests/control-tower/synova-commit.test.sh
- tests/control-tower/staging-guard-session.test.py
- tests/control-tower/test-staging-guard.py
- tests/control-tower/tag-bypass-wiring.test.sh
不做什么：
- 不改 .github/workflows/ci.yml（线 B 所有；D708 step 已存在，本件只断言其真实）
- 不改 scripts/pre-commit-check.sh（接力位 line-e-da2 所有）
- 不改 scripts/control-tower/alloc-task-id.sh（线 D 所有）
- 不改 scripts/audit/**（K3 红线）
- 不改 scripts/control-tower/claim_store.py（只读消费，其契约属 D-C 核心已合部分）
- 不改 scripts/control-tower/merge_writeset_gate.py（D708 本体，归 D-D 切片）
- 不改 scripts/control-tower/session_registry.py（三条纯注释引用之一；U7/CT-40 要求配对件 tests/control-tower/session_registry.test.sh，本卡预算 ≤12 件已满 ⇒ 另卡）
- 不改 scripts/control-tower/brief_parser.py（纯注释引用，同上另卡）
- 不改 scripts/workflow/resolve-commit-brief.sh（纯注释引用，同上另卡）
- 不改 scripts/commit-msg-check.sh（issue 号形态切换属本批 ② 件，另 PR）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/synova-commit --task-id … --agent … --message …`（提交端）。
处理：暂存 → 退役呈报段（只读 `claim_store --resolve`，取不到即显式降级）→ schema 静态断言
（旧调用段/字面量零残留）→ 替身真实性（ci.yml 内 D708 step 可执行）。
结果：① 本地不再有第三套认领判据；② 每次提交**可见**一行退役结论（禁静默空白）；
③ `grep -n staging_guard scripts/ .github/` 零命中；④ 替身（D708）在 ci.yml 真实存在且可执行；
⑤ 变异体（删掉替身调用 / 删掉 claim 读取）⇒ 夹具必红（判别性）。

## 架构层: 基础设施

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-07-D1223-staging-guard-退役.md | task |
| memory/notes/proposed/2026-10-07-d1223-staging-guard-retire.md | task |
| scripts/control-tower/staging_guard.py | task |
| scripts/control-tower/synova-commit | task |
| scripts/control-tower/self-health.py | task |
| scripts/control-tower/incident-loop.py | task |
| scripts/control-tower/gate-integrity-baseline.txt | task |
| tests/control-tower/staging_guard.test.sh | task |
| tests/control-tower/staging-guard-retirement.test.sh | task |
| tests/control-tower/self-health.test.sh | task |
| tests/control-tower/synova-commit.test.sh | task |
| tests/control-tower/staging-guard-session.test.py | task |
| tests/control-tower/test-staging-guard.py | task |
| tests/control-tower/tag-bypass-wiring.test.sh | task |
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |

## 死代码清理声明（D1028-A2v2 · 铁律 37）
- scripts/control-tower/staging_guard.py — 铁律 37：模块退役，`grep -rn "staging_guard" scripts/ .github/` 零命中
- tests/control-tower/staging_guard.test.sh — 铁律 37：其被测模块已退役；判据面由 staging-guard-retirement.test.sh 承接
- tests/control-tower/staging-guard-session.test.py — 铁律 37：`import staging_guard` 对象已删；main 上已存量 6 红、隔离台账内
- tests/control-tower/test-staging-guard.py — 铁律 37：`import staging_guard` 对象已删；不在密封面执行集

## Done 标准
- [x] verify: bash tests/control-tower/staging-guard-retirement.test.sh → 「15 通过, 0 失败」（7 结构断言 + 6 变异体 + 对照组）
- [x] verify: bash tests/control-tower/self-health.test.sh → 「11 通过, 0 失败」（U7/CT-40 配对件）
- [x] verify: bash tests/control-tower/synova-commit.test.sh → 「pass=19 fail=0」（基线 17，无回归）
- [x] verify: bash tests/control-tower/tag-bypass-wiring.test.sh → 「27 通过, 0 失败」（基线 26，无回归）
- [x] verify: bash scripts/control-tower/sealed-tests.sh --list 退出码 0；bash scripts/control-tower/check-gate-integrity.sh → GATE-INTEGRITY: OK
- [x] verify: 生产面代码行零引用（脚本断言 R2；`--` 注释保留沿革）
- [x] verify: bash scripts/control-tower/scan-fullwidth-vars.sh（全 scripts 域）→ 本卡改动件 0 处违规（D370 加固）
