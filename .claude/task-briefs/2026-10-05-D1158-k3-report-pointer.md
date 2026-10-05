# Task Brief — D1158 K3 报告指针落库（门禁治理波次 D1145–D1149）

> 卡: 治理线 · 文书/取证（Lead 派卡 ②，CTO 一句话授权开 PR）｜线: 治理线（govl）｜日期: 2026-10-05｜执行者: govl-k3-materials（接手：govl-retract-registry）
> 分支: `docs/D1158-k3-report-pointer`（原 `docs/D1155-k3-report-pointer`，见下方编号更正）｜工作树: `.synova-wt-k3m-c2`（基线 `origin/main` @ `707dd946b`）
> 【坐标系】执行态=待复核｜施工批次=批3 门禁治理（本波次收口件）｜服务承重件=审计取证面（非产品面）｜
> 总闸=#973 无关｜命名空间=D1158｜验证级别=L2（判据可复跑 + D2 登记门禁 rc=0）｜阻塞源=无（**本件不触 `DOCS-REGISTRY.yaml`**）

> ⚠️ **编号更正留痕（2026-10-05，D1155 → D1158；原句/原编号不改删，仅逐处更正）**
> - **冲突事实**：本件原编号 D1155 与**已并入 main** 的 `.claude/task-briefs/2026-10-05-D1155-产品线-知识审计归属-0-9bis.md`（#1124，merge `65aa62dea`）**撞号**。
> - **后果**：D708 `merge_writeset_gate.py` 的 S3 声明源 glob `*D1155*.md` 命中 **2 个候选** ⇒ fail-closed `exit 2`
>   （CI「TypeScript + Lint + Iron Laws」红；本地复现同结论，见下）。
> - **处置**：**本件让号**（0-9bis 先并入 main ⇒ 先到先得），改号 **D1158** ——
>   `bash scripts/control-tower/alloc-task-id.sh --check-id D1158` = 未占（**只读校验**，不取号/不写盘）；
>   D1156 / D1157 已被在飞分支占用（`docs/D1154-D1156-exemption-and-direction` / `fix/D1157-bypass-hash-anchor`）。
> - **复现命令**：`python3 scripts/control-tower/merge_writeset_gate.py --base origin/main --head HEAD --branch docs/D1155-k3-report-pointer` → `exit 2`（改名前）；改名为 `docs/D1158-…` → `exit 0`。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
治理线「审计取证」面，**不属产品五层**。本件把 K3 对本波次（#1075/#1076/#1077/#1078/#1107）的**独立审计结论**落成**指针**，
使「该批次已审」在本仓**机器可判**（判据 = `INDEX.md` 里有一行）。

### b) 文件审计（改前实测）
- `docs/synova/audit-reports/INDEX.md`（164 行 / 150 数据行）：表头自述**维护规约** = "新增 K3 批次 ⇒ 本文件追加一行；
  **不在本仓新增报告正文文件**"；最后一批 = 2026-09-25（此后 10-03/10-04 三批未入索引）。
- 本仓 `DOCS-REGISTRY.yaml`：该文件已由 `DOC-0101` 登记**目录** `docs/synova/audit-reports/`；
  且 D2 登记门禁的 `EXCLUDE` 正则含 `docs/synova/audit-reports/` ⇒ **本件无需改台账**（= 天然避开共享登记表的零重叠困境）。
- K3 独立仓 `~/synova-k3-audit`：报告实体路径 `audit-reports/2026-10-05-k3-审计报告-门禁治理波次-D1145-D1149.md`，
  所在提交 `d17d389`（`git log -1 --format=%h -- 'audit-reports/2026-10-05-*'` 可核）。

### c) 决策
- 已有覆盖 → 复用：**只追加 `INDEX.md` 一行**（遵其规约），**不复制正文**（避免本仓第二真相源）。
- 需补充 → 加一段**溯源块**（K3 仓 commit / 报告行数 / 审计对象锚点 / 审计环境 / 复核命令）——Lead 派卡要求，且不与"一行一条"冲突。
- 冲突 → 规避：**不碰** `DOCS-REGISTRY.yaml`（本波次共享表已被多 PR 占用）；**不在 K3 仓写任何文件**（K3 只读红线）。

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

- **指针式（D964 主线 A）**：审计结论的「存在性」在受审仓、「正确性」在 K3 独立仓；本仓不得出现第二份正文（双真相源 ⇒ 漂移）。
- **判例 V-05**：锚点必须钉 commit（`k3-repo@d17d389`），不写"最新"。
- **memory 教训**：`声称"已完成/已审"须给可复跑命令`（D316）；台账类文件**逐条可核**（M-03 棘轮只减不增的同类思路）。
- **参考**：Anthropic「证据优先」+ 第一性原理（索引 = 指针集合，不是副本集合）。

## Q2: 范围 — 正确的最简方案

做什么：
1. `docs/synova/audit-reports/INDEX.md` 追加一行（2026-10-05 / 门禁治理波次-D1145-D1149 / 结论 / `k3-repo@d17d389:audit-reports/…` / 日期）；
2. 表后追加「最近批次溯源」块（6 行：commit、路径、行数、五个对象锚点、审计环境、复核命令）；
3. 本 brief 与 Note：`.claude/task-briefs/2026-10-05-D1158-k3-report-pointer.md`、`memory/notes/proposed/2026-10-05-d1158-k3-report-pointer.md`
   （编号更正 D1155 → D1158 时同步更名，见文首留痕）。

不做什么（含文件路径）：
- **不复制报告正文进本仓**（不新增 `docs/synova/audit-reports/*.md` 正文文件）——遵本目录 INDEX 规约；
- **不在 K3 独立仓做任何写操作**（`~/synova-k3-audit/**` 只读，K3 红线）；
- 不改 `docs/authority/DOCS-REGISTRY.yaml`、不改 `scripts/**`、不改 `.github/workflows/ci.yml`、不碰 `scripts/audit/**`；
- 不改任何既有数据行（只追加一行 + 一段溯源块）。

## Q3: 验收 — 入口 → 交互 → 结果

入口：`grep`/阅读 `docs/synova/audit-reports/INDEX.md`（人）＋ `doc-registry-gate.sh`（机器，本件应 rc=0）。
处理：追加一行 + 溯源块。
结果：本仓出现"该批次已审"的机器可判指针，正文仍在 K3 独立仓且锚点可核。

## 架构层: L0（治理/取证面，非产品五层 L1–L5）

## Done 标准:
- [x] INDEX.md 含本批次行且指针与 K3 仓真实路径一致 verify: `grep -c 'k3-repo@d17d389:audit-reports/2026-10-05' docs/synova/audit-reports/INDEX.md`（应 = 1）
- [x] 指针的 commit 在 K3 仓可解析 verify: `git -C ~/synova-k3-audit log -1 --format=%h -- 'audit-reports/2026-10-05-*'`（应 = d17d389）
- [x] 本仓未新增正文文件 verify: `git diff --name-only origin/main...HEAD -- docs/synova/audit-reports/`（应只有 INDEX.md）
- [x] D2 登记门禁不被触发（本件无新增 .md 于受控路径） verify: `bash scripts/doc-system/doc-registry-gate.sh`

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-10-05-D1158-k3-report-pointer.md | task |
| docs/synova/audit-reports/INDEX.md | task |
| memory/notes/proposed/2026-10-05-d1158-k3-report-pointer.md | task |

