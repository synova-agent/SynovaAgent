# Task Brief — #1118（#1115 后续）· resolve-ci-base legacy 别名安全阀 ＋ 配对测试修正

#CRITERIA: D

> 任务唯一编号 = Issue 号。#1118 ｜ 分支 `fix/1118-resolver-valve` ｜ 基线 `gitea/main` = 94ed76b2d
> （#1119「trunk 切 main」已合入 main；`local-main` = b8edf9860 冻结，符合迁移期预期）
> 声明载体 = `.claude/claims/1118.yaml`（writeset ＋ done 两字段制）；本件是 Q1–Q3 的可读说明（同批提交）。
> 架构层: 不属五层业务（治理脚本）
> 本卡定位：**补 #1115 缺口，非重复**（#1119 已完成 trunk 切换；本卡只补「legacy 别名不许静默指向不同树」与配对测试）。

## Q1: 调研 — 为什么这一批不能省

- **#1119 覆盖了什么（实测）**：`case` 已把 `main|local-main` 统一映射到 `gitea/main`，默认 base＝`gitea/main`，
  fetch `+refs/heads/main:refs/remotes/gitea/main`；CI 双绿（PR #1119：`pull_request success 1m36s`／`push success 2m0s`）
  ⇒ **P0 原症（base=main 不可解析）已解**，本卡不重做这部分。
- **#1119 缺什么（实测）**：resolver 全文 `grep --base|安全阀|非同干|ALIAS|merge-base` **零命中**——
  `local-main` 到 `gitea/main` 是**无条件**映射。沙箱实测（origin/main 与 origin/local-main 已分叉）：
  `GITHUB_BASE_REF=local-main SYNO_CI=1` ⇒ `rc=0 out=gitea/main`，stderr **0 行**提及 local-main
  ⇒ **静默别名到不同树 = 用错 base 算 diff = 新一代假绿**。
- **#1119 还留下一处红（实测）**：未改 `tests/control-tower/resolve-ci-base.test.sh`；现有 8 例在其 resolver 上
  **7 通过 / 3 失败**（用例 3/4/5 仍断言 `gitea/local-main`）；且 `.gitea/workflows/**` 与 `scripts/pre-commit-check.sh`
  都不跑该测试（grep 零命中）⇒ 「零失败才合并」在这里断链，红着没人管。
- **决策参考系（Q1c）**：第一性原理（别名只在**同一棵树**上等价；跨树必须 fail-closed）＋ 仓内既有约定
  （三态 0/1/2、`::warning` 可见化、「改判据 ≠ 修 bug」）⇒ 只加一条一致性阀 ＋ 修测试，不动 trunk 方向、
  不动 workflow、不碰 #1115 其它写集。

## Q2: 范围

做什么：

- scripts/control-tower/resolve-ci-base.sh
- tests/control-tower/resolve-ci-base.test.sh
- gate-exemptions/2026-10-28-1118-resolver-valve.md
- .claude/task-briefs/2026-10-28-1118-resolver-valve.md
- .claude/claims/1118.yaml
- memory/notes/proposed/2026-10-28-1118-resolver-valve.md
- docs/authority/DOCS-REGISTRY.yaml

判据要点（canonical 保持 `gitea/main`，**方向不反**）：

- `case "$BASE" in` 拆两臂：`main) BASE="gitea/main"`（无阀）｜`local-main) BASE="gitea/main"; LEGACY_ALIAS=1`。
- **④b 安全阀**（仅 `LEGACY_ALIAS=1` 生效）：候选 = 本仓 `refs/heads/local-main` ＋ 所有 `refs/remotes/*/local-main`，
  逐个与 canonical `gitea/main` 比 SHA —— 相等 ⇒ 放行；候选是 canonical 的**祖先** ⇒ `::warning` 容忍（同干陈旧）；
  **分叉 / 候选领先 ⇒ `die`（exit 2）**。
- 头注 `@exit` 补「legacy 别名非同干 ⇒ 2」；并修正 #1115 留下的头注错字（新鲜度断言的跟踪引用名写作 local-main）。
- 不变项：默认 `gitea/main`、fetch refspec、CI 新鲜度断言、stdout 单行契约、既有 exit 语义。

不做什么（含文件路径）：

- 不改 `.gitea/workflows/**`、`scripts/control-tower/check-merge-conditions.sh`、
  `scripts/control-tower/check-mirror-freshness.sh`、`scripts/pre-commit-check.sh`（#1115 写集）。
- 不碰 `scripts/audit/**`（K3 专属）、不改 `probe-*.ts`（M6 独占）；不合并任何 PR。
- 不把 `local-main` 重新设为 canonical（方向不反）；不新增 `--base` 入参（#1119 无该入口，本卡验收走
  `SYNO_BASE_REF` / `GITHUB_BASE_REF` 同一条解析链）。

## Q3: 验收（入口 → 交互 → 结果）

- **入口**：`bash scripts/control-tower/resolve-ci-base.sh`（CI 由 `GITHUB_BASE_REF=main` 驱动；别名路径由
  `SYNO_BASE_REF=local-main` / `GITHUB_BASE_REF=local-main` 驱动）。
- **交互**：stdout 单行 `gitea/main`；stderr 打「legacy 别名（#1118）：local-main ⇒ gitea/main」与同干陈旧容忍告警；
  非同干打 `::error title=resolve-ci-base::legacy 别名安全阀 …` 并 exit 2。
- **结果**（本机实测，原始输出见 PR body）：
  - `GITHUB_BASE_REF=main` / `SYNO_BASE_REF=main` ⇒ `gitea/main`，rc=0；`SYNO_BASE_REF=nope` ⇒ rc=2。
  - 阀三态（mktemp 沙箱）：同 SHA ⇒ 0 ｜ 祖先 ⇒ 0 ＋「容忍」告警 ｜ 分叉 ⇒ 2 ＋「非同干」 ｜ 领先 ⇒ 2 ｜
    非别名 `main` 不受阀影响 ⇒ 0。
  - `bash tests/control-tower/resolve-ci-base.test.sh` ⇒ **0 失败**（含两条改坏即红：删 `local-main)` 臂 / 删阀 `die`）。
  - `bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/main --root .` ⇒ **0 失败**。
  - 本地门禁 `SYNO_CI=1 bash scripts/pre-commit-check.sh` ⇒ 唯一允许红＝内容面耦合 CC1–CC4（存量棘轮）。
  - **CI 两条腿必须绿**（push ＋ pull_request，pending=0）—— 本卡自证。

## 架构层: 不属五层业务（治理脚本）

## Done 标准

- [x] `GITHUB_BASE_REF=main` / `SYNO_BASE_REF=main` ⇒ 输出 `gitea/main` 且 exit 0 verify: bash scripts/control-tower/resolve-ci-base.sh
- [x] `SYNO_BASE_REF=nope` ⇒ exit 2 verify: bash tests/control-tower/resolve-ci-base.test.sh
- [x] 阀三态：同 SHA ⇒ 0 ｜祖先 ⇒ 0＋含「容忍」告警 ｜分叉/领先 ⇒ 2 verify: bash tests/control-tower/resolve-ci-base.test.sh
- [x] 配对测试 0 失败，含两条改坏即红（删 local-main 臂 / 删阀 die） verify: bash tests/control-tower/resolve-ci-base.test.sh
- [x] 受保护路径豁免合规（三段式＋自覆盖行＋首行复核件＋DOCS-REGISTRY 自登记） verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/main --root .
- [x] 本地门禁唯一允许红＝内容面耦合 CC1–CC4 verify: bash scripts/pre-commit-check.sh
- [x] CI 两腿绿（push ＋ pull_request，pending=0） verify: curl -s http://MacBook-Pro-2.local:3000/api/v1/repos/synova-agent/SynovaAgent/commits/fix/1118-resolver-valve/status
- [x] 改动文件纯 LF（CR 字节数 = 0） verify: bash -c 'tr -dc "\r" < scripts/control-tower/resolve-ci-base.sh | wc -c'
