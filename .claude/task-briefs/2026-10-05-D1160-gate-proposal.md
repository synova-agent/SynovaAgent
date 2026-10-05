# Task Brief: D1160 门禁提案：登记表追加型豁免 + D708 多命中分级

> 生成: 2026-10-05 | 任务: D1160 | 认领: govl-retract-registry | 线: 治理线（govl）
> 分支: `docs/gate-proposal`（**刻意不含 D#**：含号会与取号器自身的 `local-branch` 占用判定自撞；D# 由 commit subject 回退推断 = D1160）
> 【坐标系】执行态=待复核｜施工批次=批3 门禁治理｜服务承重件=**门禁判据提案面**（非产品面）｜总闸=#973 无关｜命名空间=`docs/synova/coordination/`｜验证级别=L2（判据可复跑 + D2 rc=0 + D708 exit 0）｜阻塞源=无

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
治理线「门禁判据」面，**不属产品五层**。本件把**已获 CTO 原则批准**的两项门禁变更（① 登记表追加型豁免 ② D708 多命中判定分级）＋判据纪律，落成**可引用正文**——此前仅存在于 `/tmp`（**非持久、非仓内 ⇒ CTO 实测找不到**），本件即为可引用载体。

### b) 文件审计（改前实测，均含 ref）
- `docs/synova/coordination/`：提案体例既有先例 = `D1147-单套门禁-必需context变更提案.md`（登记 `DOC-0143`）。
- `git show origin/main:docs/authority/DOCS-REGISTRY.yaml`（`MAIN-TEXT` @ `96c7caa5a`）：**387 行**；分节注释 **10** 处（`:11/:70/:120/:212/:227/:244/:296/:317/:337/:366`）；**追加点 = EOF**。
- 在飞 PR 已认领 `DOC-` 行键至 **`DOC-0185`**（`OPEN×FILES`，2026-10-05T14:41:18Z；`#1132/#1114/#1000/#948/#945/#794` 均含 `DOC-0144`）⇒ 本件取 **`DOC-0186`** 规避行键碰撞。
- `scripts/control-tower/merge_writeset_gate.py`：`:111-127` `AmbiguousDeclaration` / `:388` S2 多命中 / `:397` S3 多命中 / `:601-609` **exit 2 一刀切** / `:704-712` 打印候选但**不标来源**。

### c) 决策
- 已有覆盖 → **复用体例**（`coordination/` 提案正文 + registry 登记行）。
- 需新建 → `docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md`（正文）+ 本 brief + Note。
- 冲突 → **规避**：**不改任何判据代码**（提案 ≠ 落地）、不改 `ci.yml`、不改 K3 域。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **上游裁决**：CTO 2026-10-05 裁示（豁免 5 约束定稿 + 四条判据原则取代"二选一" + 跨线排序 + 分节数 10 更正）。
- **审计输入**：K3 报告 `2026-10-05-k3-审计报告-门禁治理波次-D1145-D1149.md` §一（D734 无据）/ §四（L4 防线缺口）。
- **铁律**：35（自动化优先——能写 check 的不靠 review）、49（决策必须沉淀 ⇒ 本 Note）。
- **memory 教训**：D316「声称完成须给可复跑命令」；本波次新增 **311/387 根因**（读工作树 ≠ 读 ref）。
- **决策参考**：Anthropic「证据优先」+ 第一性原理（追加型数据结构 = **可交换操作**，非冲突）+ 收敛检查（三态 `0/1/2` 必须能区分"**你的问题**"与"**检查的问题**"）。
  ⇒ 结论：豁免必须带**机器前置**（`numstat` 删除数 = 0）；多命中必须按**候选是否存在于 base** 分级。

## Q2: 范围 — 正确的最简方案

做什么：
- `docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md` — 提案正文（可引用）
- `docs/authority/DOCS-REGISTRY.yaml` — **追加 1 条登记行**（`DOC-0186`，纯追加于 EOF）
- `.claude/task-briefs/2026-10-05-D1160-gate-proposal.md` — 本 brief
- `memory/notes/proposed/2026-10-05-d1160-gate-proposal.md` — 决策 Note（铁律 49）
- `task-state/D1160.json` — 取号器生成的认领壳（**先登记后使用**）

不做什么（含文件路径）：
- 不改 `scripts/control-tower/merge_writeset_gate.py`（**提案不落地**；落地须 K3 过审 + CTO 裁后**另开卡**）
- 不改 `.github/workflows/ci.yml`（红线；且其豁免已被 CTO 驳回）
- 不改 `scripts/audit/`（K3 红线）
- 不改 `scripts/pre-commit-check.sh`、不改 `scripts/doc-system/doc-registry-gate.sh`（本件**只读**）

## Q3: 验收 — 入口 → 交互 → 结果

入口：人工阅读 `docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md`；机器入口 = `bash scripts/doc-system/doc-registry-gate.sh`。
处理：正文落库 + 登记行追加（纯追加）。
结果：CTO/K3 可凭「**文件路径 + 行号 + §1.4.a 原文**」直接裁，无需凭记忆。

### Q3.1 定稿修订轮（v2.1 → v2.2，2026-10-05 CTO 裁决后）

入口：同一路径正文（**不新开文件**）；处理：§1.4.a **定稿为路线 ㈠**、㈠ 薄弱点**升格为硬要求**（合成红例，归 `#1131`）、新增 **§五 撞号簇处置**、§1.4.b 补"计数时刻相关"复核、末尾两节重编号；结果：正文与 CTO 裁决**一致**（单一真相源，不留"现行版 + 修订说明"双源）。

## 架构层: scripts（控制塔/治理面）

## Done 标准:

- [x] 提案正文含 §1.4.a 四条判据打勾表 verify: `grep -q "A 落本项写集内" docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md`
- [x] D2 登记门禁通过 verify: `bash scripts/doc-system/doc-registry-gate.sh`
- [x] D708 声明源收敛且对账通过 verify: `python3 scripts/control-tower/merge_writeset_gate.py --base origin/main --head HEAD --branch docs/D1160-final`
- [x] 登记行为纯追加（删除数 = 0） verify: `git diff --numstat origin/main..HEAD -- docs/authority/DOCS-REGISTRY.yaml | grep -qE "^[0-9]+[[:space:]]+0[[:space:]]" || test -z "$(git diff --numstat origin/main..HEAD -- docs/authority/DOCS-REGISTRY.yaml)"`
- [x] 修订轮不动登记行（本件不触 `DOCS-REGISTRY.yaml`） verify: `test -z "$(git diff --name-only origin/main..HEAD -- docs/authority/DOCS-REGISTRY.yaml)"`
- [x] ㈠ 定稿已写入且 ㈡ 标为未采用 verify: `grep -q "CTO 已裁 = 路线 ㈠" docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md && grep -q "未采用，留档" docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md`
- [x] 合成红例硬要求 + 归属 #1131 已写明 verify: `grep -q "#1131 那一批执行" docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md`

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-05-D1160-gate-proposal.md | task |
| docs/synova/coordination/D1160-门禁提案-登记表追加型豁免与D708多命中分级.md | task |
| memory/notes/proposed/2026-10-05-d1160-gate-proposal.md | task |

