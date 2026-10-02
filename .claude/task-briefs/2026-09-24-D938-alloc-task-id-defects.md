# Task Brief: D938 alloc-task-id 两缺陷 + mac 域全角紧贴变量清扫

> 生成: 2026-09-24 | 任务: D938 | 认领: d937 小队（c1/c2）
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔工具层（非 L1-L5 产品运行时）。对象 = `scripts/control-tower/alloc-task-id.sh`（卡号分配器，
所有卡的入口）+ mac 域 3 个脚本的「全角标点紧贴变量」形态。
分配器两缺陷：① `:242` 全角 `（` 紧贴 `$BRIEF_FILE` → 变量名被污染 → `unbound variable`；
② `:201` title 含 `/` 未消毒 → 骨架路径裂成子目录 → 生成失败却**已烧掉号**。
另**新发现（并入本卡）**：`:74` 的 `trap _lock_release EXIT` **吞退出码** → 分配器报错却 rc=0（fail-open）。

### b) 文件审计
- `scripts/control-tower/alloc-task-id.sh` — `:19 set -euo pipefail`｜`:74 trap _lock_release EXIT`（`_lock_release` 末句 `rmdir … || true`）｜`:160/:199/:244` 三个合法 `exit 0`｜`:201 BRIEF_FILE=`｜`:242` 全角 `（`
- `scripts/control-tower/check-sentinel-type-net.sh` — `:49`、`:53`
- `scripts/doc-system/check-doc-truth.sh` — `:111`
- `scripts/doc-system/doc-truth-probe.sh` — `:110`、`:136`
- `tests/control-tower/alloc-task-id.test.sh`、`alloc-task-id-lock.test.sh` — 均已建且在 `ci.yml:252/:253` 密封清单
- 扫描基线（**6 全角标点口径** `（）：，。；、`，`git grep f25e61eb -- scripts/`）：40 处 / 22 文件；
  **代码违规 36 处 / 20 文件 = 10 mac + 10 win**；注释 4 处（无害）。
  ⚠️ 口径订正：初稿只测 `（` 得 23 处/14 文件、12 文件为**低估**（c2 纠偏 + 队长复核：bash 3.2.57 下 6 个全角标点全 rc=127）
- **本卡写集内** mac 域源文件 = 4 个（`alloc-task-id.sh` + `check-sentinel-type-net.sh` + `check-doc-truth.sh` + `doc-truth-probe.sh`）
- **CTO 裁定 A1**：mac 域另有 6 文件残余（`check-ci-stale-red.sh`、`pre-dispatch-check.sh`、`generate-chronicle-monthly.sh`、`install-hooks.sh`、`workflow/task-start.sh`、`workflow/verify-incremental.sh`）→ **本卡不动**，由 CTO 另立第二张 mac 卡（因 12 文件上限而拆）；win 域 10 文件 → Win 侧卡
- `docs/synova/coordination/ownership.yaml` — 上述 9 文件**全部 mac 域**（实测 `check-ownership.py` PASS）

### c) 决策
复用既有落点（配对测试已存在且已接线），不新增门禁组；扫描器为**新建参数化工具**（CTO 硬要求：
给 Win 域留 CLI 接口，Win 侧自行立卡消费）。域边界按 CTO 裁定 A 切分，**本卡只做 mac 域**。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 铁律 11（静默降级禁止）+ `ctrl-tower-change` 模式 2：bash 在 UTF-8 locale 下把**全角标点当变量名字符**
  → `$VAR（` 解析成变量名 `VAR（`。写法必须是 `${VAR}（`。
- 铁律 0-2（接线验收）/ 铁律 48（三路径）：夹具必须跑生产脚本本体，禁测副本。
- 铁律 35/37：恒过的门禁 = 死检查；加害型 fail-open 比死检查更坏（对外宣称成功）。
- memory/ 同族教训：D312（禁 stash）/D382（取号必走分配器）/D547-D550（撞号与漏号）/
  D718（alloc-task-id 骨架污染真实仓库 —— 同文件已有一次机制级防线先例）。
- 决策参考：第一性原理（工具的成功信号必须与真实结果一致；报错却 rc=0 = 信号与真相背离）
  + Anthropic 基线（fail-closed：异常路径不得表现为成功）
  + 开源实证（实测 bash 语义：**EXIT trap 的"最后一条命令"决定退出码**；`set -e`+`set -u` 中止时
  trap 内 `$?` 读到 0、ERR trap 不触发 → 无法靠 `$?` 救回，须用**成功哨兵**）
  → 结论：`${VAR}（` 写法 + title 消毒 + 登记前先算文件名 + 成功哨兵 fail-closed；
  扫描器**参数化路径集**（可按域过滤）以复用给 Win 域。
  参考：Anthropic/DeepSeek/第一性原理 + 结论=写法+消毒+先算名+哨兵+参数化扫描器

## Q2: 范围 — 正确的最简方案
做什么：
- `scripts/control-tower/alloc-task-id.sh` — ① `:242` → `${BRIEF_FILE}（` ② `:74` trap 改**成功哨兵**
  fail-closed（3 处合法 `exit 0` 打哨兵；异常路径 rc≠0）③ `:201` title 消毒（`/` 等 → `-`）且
  **登记前先算好文件名**（防空烧号）
- `scripts/control-tower/check-sentinel-type-net.sh` — `:49`、`:53` → `${VAR}（`
- `scripts/doc-system/check-doc-truth.sh` — `:111` → `${VAR}（`
- `scripts/doc-system/doc-truth-probe.sh` — `:110`、`:136`、**`:203`、`:207`** → `${VAR}（`
- `scripts/control-tower/scan-fullwidth-vars.sh` — **新建**：参数化路径集扫描器（`--paths` / `--domain mac|win` / `--json`）
- `tests/control-tower/scan-fullwidth-vars.test.sh` — **新建**：配对测试 + mac 残留=0 + 反向金丝雀 + `--domain win` 冒烟
- `tests/control-tower/alloc-task-id.test.sh` — 扩判别性夹具（`/` title、中文 title、A′ rc 断言）
- `tests/control-tower/alloc-task-id-lock.test.sh` — 仅当 A′ 影响锁语义时改；**不改须附"为何不动"实测证据**
- `.github/workflows/ci.yml` — 新测试入 control-tower-tests 密封清单

不做什么：
- 不改 `scripts/audit/**`（K3 红线）
- 不改 `scripts/ci/verify-doc.sh`、`scripts/ci/verify-d703.sh`、`scripts/deploy/batch-upgrade.sh`、
  `scripts/desktop/mac-install-verify.sh`、`scripts/desktop/first-diagnosis-timing.sh`、
  `scripts/desktop/verify-package-signature.sh`、`scripts/desktop/upgrade-data-verify.sh`、
  `scripts/desktop/win-install-verify.ps1`、`scripts/check-fde-terms.sh`、`scripts/setup/verify-hooks-installed.sh`
  —— 以上 **win 域 10 文件**（6 标点口径订正，原报 8 为低估）→ CTO 裁定：Win 侧（Codex）立卡
- 不改 `scripts/control-tower/check-ci-stale-red.sh`、`scripts/control-tower/pre-dispatch-check.sh`、
  `scripts/doc-system/generate-chronicle-monthly.sh`、`scripts/install-hooks.sh`、
  `scripts/workflow/task-start.sh`、`scripts/workflow/verify-incremental.sh`
  —— 以上 **mac 域残余 6 文件 / 8 处** → CTO 裁定 A1：本卡保持 9 文件，另立第二张 mac 卡
  （注：`scripts/install-hooks.sh` 在 `（`-only 口径下曾被误判为"仅注释无害"，6 标点口径下 `:54/:77` 为**代码违规**，归新卡）
- 不改 `scripts/control-tower/check-ownership.py`、`docs/synova/coordination/ownership.yaml`（卡 3/卡 5 写集）
- 不改 `scripts/pre-commit-check.sh`（D937 写集，已交付/审中）
- 不改 `src/**`、`packages/**`（非本卡域）
- 不给 win 域起卡号（Win 侧发号，避 D940 撞号）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/alloc-task-id.sh "<中文|含斜杠 title>"`；
扫描器 `bash scripts/control-tower/scan-fullwidth-vars.sh --domain mac`
处理：消毒 title → 先算文件名 → 登记 task-state → 生成骨架 → 哨兵标记成功 → EXIT trap 按真实状态退出
结果：中文/含 `/` 的 title 均正常取号 + 骨架生成、**stderr 空、rc=0**；异常路径 rc≠0（不再 fail-open）；
**本卡写集内 mac 域 `$VAR`紧贴全角标点 残留 = 0**（裁定 A1 口径；非"全 mac 域"——后者 15 文件超 12 上限）

## 写集

| 文件 | 类别 |
|---|---|
| `scripts/control-tower/alloc-task-id.sh` | task（写者 c1） |
| `scripts/control-tower/check-sentinel-type-net.sh` | task（写者 c1） |
| `scripts/doc-system/check-doc-truth.sh` | task（写者 c1） |
| `scripts/doc-system/doc-truth-probe.sh` | task（写者 c1） |
| `scripts/control-tower/scan-fullwidth-vars.sh` | task（写者 c2，新建） |
| `tests/control-tower/scan-fullwidth-vars.test.sh` | task（写者 c2，新建） |
| `tests/control-tower/alloc-task-id.test.sh` | task（写者 c2） |
| `tests/control-tower/alloc-task-id-lock.test.sh` | task（写者 c2，不动须附证据） |
| `.github/workflows/ci.yml` | task（写者 c2，仅密封清单） |
| `docs/synova/product-lines/evidence/D938-改动清单.md` | task（证据，写者 c1） |
| `docs/synova/product-lines/evidence/D938-夹具原始输出.md` | task（证据，写者 c2） |
| `docs/synova/product-lines/evidence/D938-自验.md` | task（证据，写者 v，独立自验） |
| `docs/synova/product-lines/evidence/D938-收尾与回执-20260924.md` | task（M6 收尾三件，写者 lead，治理产物） |
| `.claude/task-briefs/2026-09-24-D938-alloc-task-id-defects.md` | builtin（本 brief，队长治理产物） |

## 架构层: scripts（控制塔门禁/工具域，非 L1-L5）

## Done 标准
- [ ] verify: `bash scripts/control-tower/alloc-task-id.sh "M1/ownership 域修正"` → stderr 空、rc=0、骨架生成 1 个、无孤儿号
- [ ] verify: A′ 反吞 — 注入未定义变量场景 → **rc≠0**（修复前实测 rc=0 = fail-open）
- [ ] verify: `bash scripts/control-tower/scan-fullwidth-vars.sh --domain mac` → **本卡写集内残留 0**；证据三段标签：`本卡写集内 mac 残留 0` / `全 mac 域残余 6 文件 → 待新卡 <号>` / `全 win 域残余 10 文件 → 待 Win 侧卡`；接口冒烟 `--domain win` → **10 文件**
- [ ] verify: `bash tests/control-tower/scan-fullwidth-vars.test.sh` + `bash tests/control-tower/alloc-task-id.test.sh` → 全绿
- [ ] verify: 变异体 M1–M5 逐条「改坏→夹具红」+ 复原→绿
- [ ] verify: `bash scripts/pre-commit-check.sh` + `check-pr-budget.sh`（9 文件 / 单域 mac）→ PASS
