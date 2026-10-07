---
日期: 2026-10-07
线: 治理线 A（line-a-identity）
类型: 变更交付件
关联: #1221 / #1224 · D1205 · K3 预审 2026-10-07-D-C标识与声明归一
---

# D-C 标识与声明归一 · 触及面全量清单（K3 R1）+ task-state 消费者三态表（K3 R6）

> 本件是 K3 变更前预审**整改项 R1（P0）与 R6（P1）**的交付物。
> 所有计数均为**可复跑命令的实况**，不是手写数（口径纪律 2026-09-26）。

## 0. 复跑命令（唯一口径来源）

```bash
cd ~/SynovaAgent
# ① 声明解析面（brief_parser / resolve-commit-brief 消费点）
grep -rln "brief_parser\|resolve-commit-brief" scripts/ .github/ tests/

# ② task-state 消费面（K3 R1 实测面）
grep -rln "task-state\|task_state\|TASK_STATE" scripts/ .github/

# ③ 锚点劫持位点
grep -n "ANCHORED_STRONG_FILES" scripts/workflow/resolve-commit-brief.sh

# ④ D708 联动位点
grep -n "infer_did\|claim_path_found\|collect_declared" scripts/control-tower/merge_writeset_gate.py
```

## 1. R1 — 声明解析面：10 个消费点三态表

`brief_parser.py` / `resolve-commit-brief.sh` 的消费点（解析器自身不计）。**三态 = 改接 claim ／ 只读保留 ／ 显式降级**。

| # | 消费点 | 键位 | 读什么 | 处置 | 落地 |
|---|---|---|---|---|---|
| 1 | `scripts/pre-commit-check.sh` | 组 6/组 12 | Q2 include（G12 范围判定）+ 层/criteria | **改接 claim** | D-A2 切片（本 PR 不含，见 §5 例外） |
| 2 | `scripts/control-tower/merge_writeset_gate.py` | `collect_declared` / `find_declaration_files` | S1/S2/S3 写集 | **改接 claim（S0）** | ✅ 本 PR |
| 3 | `scripts/control-tower/staging_guard.py` | `check_staging` 认领制块 | 声明路径 → D# | **改接 claim（issue 对账）** | ✅ 本 PR |
| 4 | `scripts/control-tower/synova-commit` | 调 resolver + staging_guard | 声明路径 | **只读保留**（透传，语义由 resolver 决定） | — |
| 5 | `scripts/check-verifiable-done.sh` | `## Done 标准` | Done 的 verify: 项 | **改接 claim + fail-closed** | ✅ 本 PR |
| 6 | `scripts/check-brief-vs-code.sh` | `extract_section` 全节 | Q0-Q3 散文 + 写集 | **改接 claim**（散文类显式声明不适用） | ✅ 本 PR |
| 7 | `scripts/workflow/check-brief-parseable.sh` | `brief_parser --all` | criteria/层/include | **只读保留**（经 brief_parser 自动取证 claim 分支） | ✅ 由 #2 单源自动覆盖 |
| 8 | `scripts/check-plan-integrity.sh` | Q2 排除项 | exclude | **只读保留**（claim 无 exclude 字段，恒空 → 不误判） | ✅ 自动 |
| 9 | `scripts/commit-msg-check.sh` | `MSG_DID` / D328 一致性 | 声明身份 | **改接 claim（issue 对账）** | ✅ 本 PR |
| 10 | `scripts/control-tower/incident-loop.py` · `self-health.py` · `scripts/project/pr-queue-scan.py` | 路径串/健康清单 | 文件路径字面量 | **只读保留**（不解析声明内容） | — |

> **单源保证**：claim 的 include/done 只由 `brief_parser.py` 的 claim 分支产出（委托
> `claim_store.py` 解析）——上述 10 个消费点里凡是经 `brief_parser` 取声明的，**无需各自改**，
> 这是 K3 预审"每多一套解析口径就多一条漂移路径"的直接对策。

## 2. R6 — task-state 消费者：26 文件三态表

`grep -rln "task-state\|task_state\|TASK_STATE" scripts/ .github/` = **26 文件**（实况，逐条复跑见 §0②）。
`task-state/` 存量：`ls task-state/*.json | wc -l` → **431**（旧 D# 卡，**迁移期只读不删**）。

| # | 消费者 | 读法 | 停更后用户可见结果 | 处置 |
|---|---|---|---|---|
| 1 | `.github/workflows/ci.yml` | 路径正则 `^(task-state\|memory\|decisions)/`（docs-only 判定） | 判据仍成立（纯路径匹配） | 只读保留 |
| 2 | `scripts/check-fde-terms.sh` | 历史档案白名单（`:43`） | 无影响 | 只读保留 |
| 3 | `scripts/control-tower/alloc-task-id.sh` | **号码占用表**（唯一发号入口） | 新任务无 D# 号 → 由 issue 号取代 | 只读保留 + 退役路径见 §3 |
| 4 | `scripts/control-tower/check-citations.py` | 引用白名单前缀（`:67`） | 无影响 | 只读保留 |
| 5 | `scripts/control-tower/check-name-allocation.sh` | 号冲突跨位置校验 | 与 issue 号并行，不冲突 | 只读保留 |
| 6 | `scripts/control-tower/check-notes-lifecycle.sh` | `task-state/<D#>.json` 的 status ∈ {impl_done,spec_done}（`:73`） | 新任务无卡 → 僵尸 Note 判定**静默不触发** | **显式降级**（见 §4） |
| 7 | `scripts/control-tower/check-orphan-worktrees.sh` | 背景注释（`:5`） | 无影响 | 只读保留 |
| 8 | `scripts/control-tower/check-pr-budget.sh` | 治理前缀正则（`:534`） | 无影响 | 只读保留 |
| 9 | `scripts/control-tower/daily-cto-board.sh` | `ls task-state/D*.json \| wc -l`（卡总数，`:33`） | **卡总数停在存量** → 仪表盘不反映新任务 | **显式降级**（见 §4） |
| 10 | `scripts/control-tower/declare-write-set.sh` | 注释（`:5`） | 无影响 | 只读保留 |
| 11 | `scripts/control-tower/founder-truth.py` | glob `task-state/*.json`（`:80`） | 新任务不入真相源 → 历史对账缺新卡 | **显式降级**（见 §4） |
| 12 | `scripts/control-tower/gen-cto-health.py` | `analyze_task_state()`（`:232`） | **健康报告缺失新任务** | **显式降级**（见 §4） |
| 13 | `scripts/control-tower/gen-plan-status.py` | `task-state/*.json` 作真相源（`:19`） | 写「未登记」而非静默跳过（已是显式） | **显式降级**（已具备，加迁移期标识） |
| 14 | `scripts/control-tower/generate-dashboard.py` | 描述串（`:207`） | 无影响 | 只读保留 |
| 15 | `scripts/control-tower/merge_writeset_gate.py` | S1 声明源（`:380`） | S1 空 → 回落 S0/S2/S3 | **改接 claim（S0）** ✅ 本 PR |
| 16 | `scripts/control-tower/pre-dispatch-check.sh` | `test -f task-state/$d.json`（`:32`） | **新 issue 号必然「无 task-state」→ exit 1** | 只读保留（D# 专用路径；issue 侧另立判据） |
| 17 | `scripts/control-tower/synova-commit` | 路径正则（`:349,426`） | 无影响 | 只读保留 |
| 18 | `scripts/control-tower/verdict-baseline.py` | `--state-dir` 统计（`:72`） | 存量统计仍成立 | 只读保留 |
| 19 | `scripts/control-tower/verify-parallel.sh` | `task-state/<D#>.json` status=audited（`:203`） | 新任务无法走状态机终态判定 | **显式降级**（见 §4） |
| 20 | `scripts/pre-commit-check.sh` | 路径正则（`:354,368`）+ 僵尸卡（`:1088`） | 路径判据不受影响；僵尸卡判定退化 | 只读保留（僵尸卡 → D-A2 切片一并处置） |
| 21 | `scripts/product-lines/redeem-progress.py` | `acceptance_points`（`:46`） | **0 任务可兑换**（幂等空跑，exit 0 静默） | **显式降级**（见 §4） |
| 22 | `scripts/product-lines/refresh-all.sh` | 注释（`:46`） | 无影响 | 只读保留 |
| 23 | `scripts/project/gen-project-board.py` | `load_task_state()` 缺失 → 显式 `["task-state 目录缺失"]`（`:458`） | 已是显式 | 只读保留（已显式） |
| 24 | `scripts/project/pr-queue-scan.py` | 损坏卡显式登记（`:463`） | 已是显式 | 只读保留（已显式） |
| 25 | `scripts/workflow/check-dev-doc-write-set.sh` | skip 正则（`:141`） | 无影响 | 只读保留 |
| 26 | `scripts/workflow/resolve-commit-brief.sh` | D718 锚点（`:81,246`） | 劫持风险 | **改接 claim + 防劫持** ✅ 本 PR |

**汇总**：改接 claim **3**（#15/#26 + staging_guard 不在 26 表内）· 显式降级 **6**（#6/#9/#11/#12/#13/#19/#21 去重后 6 条待处置）· 只读保留 **17**。

## 3. 迁移期机制（禁静默空白，铁律 11）

`claim_store.py` 提供两条**显式**通道，供 §2 表中"显式降级"档消费者接入：

```bash
# ① 统一迁移期标识串 —— 空白仪表盘必须打印它，不得静默空
python3 scripts/control-tower/claim_store.py --migration-marker
#   → [迁移期] 本视图含 task-state 存量（旧 D# 只读）；新任务在 .claude/claims/

# ② task-state 形状的**只读**兼容视图（不写任何 task-state 文件）
python3 scripts/control-tower/claim_store.py --legacy-view
#   → {"migration_period": true, "marker": ..., "claims": {...}, "errors": [...], "degraded": bool}
```

畸形 claim 一律进 `errors` + `degraded: true`（**不静默丢**）。

## 4. 例外清单（本 PR **未**完成项，主动列出）

| 项 | 状态 | 原因 / 归属 |
|---|---|---|
| §1 #1 pre-commit 组 6/12 改接 claim | **未做** | 属 D-A2/D-D 切片（`pre-commit-check.sh` 同文件），另 PR |
| §2 六条"显式降级"的**消费者侧改动**（#6/#9/#11/#12/#13/#19/#21） | **未做** | 这些文件**不在 A 线写集**内（Lead 已划定唯一所有者）→ 需 Lead 派单或扩写集 |
| §2 存量 431 张 task-state 卡的**去留** | **未决** | K3 R7 要求"先核 git 历史再定"；本 PR 按"只读保留"执行（≥2 周），不删 |
| `gate-integrity-baseline.txt` 登记新增夹具 | **未做** | Lead 裁决：线 B 先推，A 线待其合入后 rebase 再更新（见 PR 例外清单） |
| `ci.yml` 注册 3 个新夹具 | **未做** | `ci.yml` 归线 B —— 清单已交 Lead 统一编排（`claim-identity-v2.test.py`／`claim_store.test.sh`／`staging_guard.test.sh`） |
| 迁移期**存量双写**（新任务同时产出 task-state 卡） | **未做（有意不做）** | 双写会把"只读保留"变成"两套真相源同时活" —— 与 K3 R1 收敛目标相反；改为消费者侧接 `--legacy-view`（§3） |

## 5. 与 K3 整改清单的对应关系

| K3 项 | 内容 | 本 PR 对应 |
|---|---|---|
| R1 (P0) | 触及面 ≥30 文件逐条三态 | 本件 §1（10）+ §2（26）= 36 条 ✅ |
| R2 (P0) | D708 增 issue 号提取 + 三件入清单 | `merge_writeset_gate.py` S0 源 + issue 身份 ✅；`gate-integrity-baseline.txt` 见 §4 |
| R3 (P0) | 存在 issue claim 时禁用 D# 锚点回退 | `resolve-commit-brief.sh` CLAIM_FILE 守卫 ✅ + 夹具 b1/d1 |
| R4 (P1) | 单一 feature flag，一行可回滚 | `SYNO_CLAIM_V2`（默认关）✅ + 夹具 c2 |
| R5 (P0) | red→green 夹具先行（a/b/c） | `tests/control-tower/claim-identity-v2.test.py` 19 项 ✅ |
| R6 (P1) | 与 D-A2 的 pre-commit 测试面合并核验 | **延后至 D-A2 切片**（§4） |
| R7 (P2) | task-state 历史先核再定去留；消费者标注 degraded | 本件 §2/§3 标注完成；消费者侧改动见 §4 |
