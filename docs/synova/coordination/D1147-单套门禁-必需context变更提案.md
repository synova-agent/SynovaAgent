# D1147 · 单套门禁（批2）：CI 收敛 + 必需 context 变更提案

> 执行: 治理线（`gate-single-set`，worktree `.synova-wt-single-set`，分支 `chore/D1147-single-gate-set`）
> 日期: 2026-10-05 | 卡: task-2（T3/批2） | 写集外文件见 §7「例外清单」
> 结论一句话: **windows 腿从"必需阻塞"降级为"路径触发的顾问信号"，必需集 12 → 9（步骤 1 已 PATCH）→ 10（步骤 2 待 #948）**。

---

## 1. 判据冲突与定案（先说清口径，否则数字对不上）

task-2 正文里三个数字互相矛盾：subject「12→7」、正文「改前 12 → 改后 12」、步骤 1「windows 腿改路径触发 + **非必需**」。
三个不可能同时成立，**以步骤 1 的机器判据为准**（lead 2026-10-05 裁决回执：认错并接受本线定案）：

- 步骤 1 判据原文 = 「`gh pr checks` 里 windows 两腿在非 scripts PR 上**不出现**」
  ⇒ 该 job 必须有 **job 级 `if:`**（否则 check-run 照样产出、只是跳过步骤）；
- job 级 `if:` + 该 context 仍在必需集 ⇒ 非 scripts PR 不产 check-run ⇒ **永久 blocked**
  （D971 型：`405 "N of N required status checks are expected."`，原文
  `docs/synova/coordination/周报-20260922.md:58`；同族断言已固化在
  `tests/control-tower/ci-signal-classify.test.sh:229-238`「必需 context 恒上报」）。
- ⇒ 两条 windows context **必须同时**离开矩阵与必需集；「改后 12 条」在这条判据下不成立。
- ⇒ 目标态 = **12 −3 +1 = 10**（移出 `npm audit` + 两条 windows；加入 `Gate Integrity (…)`），
  而 lead 因 #948 的 head 早于 gate-integrity job（10-02 建）而拆成两步执行（见 §3）。

## 2. 改前 → 改后（逐字清单，12 → 9 → 10）

改前 12 条（`gh api …/protection/required_status_checks --jq '.contexts[]'`，2026-10-01T18:41:11Z 取数）：

```
Architecture Check
Checker Review (maker/checker)
Control Tower Gate Tests (ubuntu-latest)
Control Tower Gate Tests (windows-latest)      ← 移出（降级顾问腿，见 §4）
Golden Case F1 Gate
Integration Contract Check
Test-Kit Architecture Tests (ubuntu-latest)
Test-Kit Architecture Tests (windows-latest)   ← 移出（降级顾问腿，见 §4）
TypeScript + Lint + Iron Laws
Vitest (1/2)
Vitest (2/2)
npm audit                                      ← 移出（恒绿 + 双层豁免 = 纸老虎；job 保留、黄灯语义不变）
```

改后（步骤 1 **已落地**）= 9 条（2026-10-04T18:27:38Z 实测 live）：

```
Architecture Check
Checker Review (maker/checker)
Control Tower Gate Tests (ubuntu-latest)
Golden Case F1 Gate
Integration Contract Check
Test-Kit Architecture Tests (ubuntu-latest)
TypeScript + Lint + Iron Laws
Vitest (1/2)
Vitest (2/2)
```

改后（步骤 2 **待触发**）= 10 条 = 上面 9 条 + `Gate Integrity (pattern sentinel + injection fixture + ci-reds)`。

## 3. 谁执行、什么顺序（branch protection 不在本线权限内）

本线**只出提案与命令**（红线：不碰 branch protection）。lead 已执行步骤 1（回执：返回 9）。

**步骤 2 触发条件** = PR #948 重新 push 或关闭之后（#948 的 head 早于 gate-integrity job ⇒
此刻把它写进必需会让 #948 永久 blocked）。命令（lead 执行）：

```bash
cat > /tmp/d1147-req-step2.json <<'JSON'
{
  "strict": false,
  "contexts": [
    "Architecture Check",
    "Checker Review (maker/checker)",
    "Control Tower Gate Tests (ubuntu-latest)",
    "Gate Integrity (pattern sentinel + injection fixture + ci-reds)",
    "Golden Case F1 Gate",
    "Integration Contract Check",
    "Test-Kit Architecture Tests (ubuntu-latest)",
    "TypeScript + Lint + Iron Laws",
    "Vitest (1/2)",
    "Vitest (2/2)"
  ]
}
JSON
gh api -X PATCH repos/synova-agent/SynovaAgent/branches/main/protection/required_status_checks \
  --input /tmp/d1147-req-step2.json
gh api repos/synova-agent/SynovaAgent/branches/main/protection/required_status_checks --jq '.contexts | length'   # → 10
```

**基线表刷新（步骤 2 之后必做，禁手抄）** —— 重放
`scripts/control-tower/required-checks-baseline.txt` 文件头里的生成命令（本卡步骤 1 已按同一命令重放）：

```bash
AS_OF=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SHA=$(gh api repos/synova-agent/SynovaAgent/branches/main --jq .commit.sha)
gh api repos/synova-agent/SynovaAgent/branches/main/protection \
  --jq '.required_status_checks.contexts[]' \
| while IFS= read -r c; do
    printf '%s | owner=UNASSIGNED | source=branch-protection API | as_of=%s | evidence=synova-agent/SynovaAgent@%s GET /repos/synova-agent/SynovaAgent/branches/main/protection#required_status_checks.contexts\n' \
      "$c" "$AS_OF" "$SHA"
  done
```

**复核（两步各跑一次，0 = OK）**：

```bash
python3 scripts/control-tower/check-required-contexts.py              # 必需集 ⊆ 产出集（本地，零网络）
python3 scripts/control-tower/check-required-contexts.py --api-check  # live ⇄ 基线 双向零差集（只读）
```

**回滚（完整恢复改前 12 条，逐字）**：

```bash
cat > /tmp/d1147-rollback.json <<'JSON'
{
  "strict": false,
  "contexts": [
    "Architecture Check",
    "Checker Review (maker/checker)",
    "Control Tower Gate Tests (ubuntu-latest)",
    "Control Tower Gate Tests (windows-latest)",
    "Golden Case F1 Gate",
    "Integration Contract Check",
    "Test-Kit Architecture Tests (ubuntu-latest)",
    "Test-Kit Architecture Tests (windows-latest)",
    "TypeScript + Lint + Iron Laws",
    "Vitest (1/2)",
    "Vitest (2/2)",
    "npm audit"
  ]
}
JSON
gh api -X PATCH repos/synova-agent/SynovaAgent/branches/main/protection/required_status_checks \
  --input /tmp/d1147-rollback.json
python3 scripts/control-tower/check-required-contexts.py --api-check   # 会报漂移（基线=9/10、live=12）⇒ 需同步重放基线
```

⚠️ **合并顺序硬约束**：本 PR **不得早于步骤 1 的 PATCH 合并**（已满足）——若两条 windows context 仍必需而
本 PR 已把它们的 job 改成条件创建，则**非 scripts PR 永久 blocked**。步骤 2 与合并的顺序**无约束**
（加必需不会卡死任何"已含 gate-integrity job"的分支；实测现开 20 个 PR 的 head 均含该 job）。

## 4. windows 腿改造：三条约束 + 一条跨机制发现

**改造**：两条 windows 腿从"必需 job 的矩阵第二腿"变成**独立顾问 job**
（`test-kit-windows-advisory` / `control-tower-windows-advisory`，context 名**逐字保留**旧名以便看板续读），
触发判据 = 新增 job `windows-leg-trigger`（只产结论、不跑测试）：

| 约束 | 内容 | 为什么 |
|---|---|---|
| ① 路径触发 | 仅 `scripts/**`\|`tests/**` 变更时**创建** job；`origin/main` 不可解析 / schedule / workflow_dispatch ⇒ fail-safe `run=true` | 平台差异只在控制塔域有信息量；非命中 PR 连 check-run 都不产（省 runner、不上必需面） |
| ② 非必需 | 两个 context 名**不得**再进必需集 | 见 §1：job 级 `if:` + 必需 = 永久 blocked |
| ③ 恒 success | 重活 step `continue-on-error: true`；失败经 `steps.*.outcome` 检查 + `::error` 注解 + `::warning` 摘要上看板 | 见下「跨机制发现」 |

🔴 **跨机制发现（本卡实测，非推测）**：**"非必需但会红"是陷阱**。
C 段棘轮 `scripts/control-tower/check-gate-integrity.sh` 的 `run_ci_reds`（L676+）对账时统计 base commit 上
**全部** `conclusion == failure` 的 check-run（**不问是否必需**，代码层 `if r.get('conclusion') == 'failure'`），
未在 `ci-red-baseline.txt` 登记 ⇒ `VIOLATION: 未登记 CI 失败`。
⇒ 一条"非必需但会红"的顾问腿，经 `merge_group` / 周期 run 落在 main tip 上 ⇒ 下一个 PR 的 C 段判红
⇒ 把**已入必需的 Gate Integrity** 拖红 ⇒ 顾问红变相成为全局阻断。
⇒ 故顾问腿必须**绝不产 failure 结论**（③）；根治（C 段对账排除非必需 context）属**判据变更**，
须 K3，已请 lead 另立卡，本线不自裁。

**看板取数**（无需 token，M9 task-11 同款公开注解面）：

```bash
GET /repos/{owner}/{repo}/check-runs/{id}/annotations    # ::error / ::warning 都在这里
```

## 5. 本地提交端二选一 = **「明确降级为旁路」**（结论 + 代价）

- **实测现状（两条路，不是一条）**：裸 `git commit` 走 `.git/hooks/pre-commit`，该 wrapper
  **恒 `exit 0`**（失败只写 `.claude/pre-commit-failures.log` + `.claude/gate-soft-warnings.log`
  并打一行 ⚠️，然后照样写 `last-precommit-success` 标记）；官方路径 `scripts/control-tower/synova-commit`
  是**硬**的（`synova-commit:880-890`：门禁非 0 ⇒ 打 `BLOCKED` 进 `bypass.log` + `exit 1`，无 `--no-verify` 开关）。
- **结论**：**明确降级为旁路** —— 保留裸 `git commit` 恒 0 的现状，但把"它是旁路、CI 才是唯一阻断面"
  写成显式口径（本文件 + AGENTS.md 表已是「本地软提示 + CI 权威」，与本结论一致），
  不再假装"本地门禁是门禁"。
- **代价（诚实列）**：① 裸路径上，缺陷最早在下一次 push 后的 CI 才被拦（+1 个 push/CI 轮，分钟级）；
  ② `.claude/gate-soft-warnings.log` 会累积软告警，存在"看习惯了就不看"的腐化风险。
- **为什么不选「本地全硬」**：V4.5.1 的根因就是"本地门禁太慢/太挡 ⇒ `--no-verify` 泛滥"（一个被绕过的门禁
  = 没有门禁）；且当前 wrapper 的 marker 语义（成败都写 `last-precommit-success`）正是
  post-commit 绕过检测（D366）的输入——改成失败即拒会污染该判据（真失败 ≠ 绕过）。
- **收口责任**：本地硬面已由 `synova-commit` 承担 ⇒ 纪律是"提交走 synova-commit"，本线不新增机制。

## 6. 判据与原始输出（可复跑）

| # | 判据 | 命令 | 结果 |
|---|---|---|---|
| 1 | 必需 context 本地一致性（0/1/2） | `python3 scripts/control-tower/check-required-contexts.py` | `── 必需集 ⊆ 本仓可产出集: 9/9 命中 ──` / `REQUIRED-CONTEXTS: OK` |
| 2 | live ⇄ 基线 双向零差集 | `python3 scripts/control-tower/check-required-contexts.py --api-check` | `live contexts = 9 条` / `OK: live 9 条与基线逐字一致（双向零差集）` / `REQUIRED-CONTEXTS: OK；live=9` |
| 3 | 门禁完整性棘轮 | `bash scripts/control-tower/check-gate-integrity.sh` | `PATTERN-BASELINE: registered 0；STALE(1)` / `CI-REGISTRY: … 基线外新增 0；基线过期 0` / `GATE-INTEGRITY: OK`（rc=0） |
| 4 | ci.yml 结构/身份/登记棘轮 | `bash tests/control-tower/ci-signal-classify.test.sh` | `结果: 79 通过, 0 失败, 0 显式跳过`（rc=0） |
| 5 | 必需 context 门禁夹具 | `bash tests/control-tower/check-required-contexts.test.sh` | `结果: 47 通过, 0 失败`（rc=0） |
| 6 | docs-only 白名单 + fail-safe 结构 | `SYNO_CI=1 bash docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` | `RESULT: 20 PASS / 0 FAIL`（rc=0） |
| 7 | D956 注解段零回归 | `bash tests/control-tower/d956-failmsg.test.sh` | `PASS=13 FAIL=0`（rc=0） |
| 8 | canary 清单漂移（恒 0） | `bash scripts/control-tower/check-canary-drift.sh` | 仅存量幽灵项 `tests/win/vitest-log-level.test.sh`（ci.yml 注释里已登记的占位项，非本次引入） |
| 9 | 清单计数未被改小 | `bash tests/control-tower/simulate-ci.test.sh` | `结果: 10 通过, 0 失败`（rc=0） |
| 10 | windows 腿只在条件 job 中（静态） | `grep -n "matrix" .github/workflows/ci.yml` + `grep -nE "^  [a-z0-9_-]+:$" -A2` | 两个必需 job 矩阵单元素 `os: [ubuntu-latest]`；`windows-latest` 只出现在 `windows-leg-trigger` / 两个 `*-windows-advisory`（均非必需） |

**改坏即红（判别性证据，全部在 mktemp 隔离树内做，零真实仓库改动）**：

| 注入 | 期望 | 实测 |
|---|---|---|
| A `control-tower-tests` 矩阵加回 windows | `ci-signal-classify` 必红 | `❌ strategy.matrix 被改动（D1147 后期望值 = 单元素 ubuntu）` rc=1 |
| B timeout 改回条件表达式 | 必红 | `❌ job timeout-minutes 被改动（D1147 后期望值 = 14）` rc=1 |
| C 新增一个未登记的 `needs:` job | 必红（D1112 兜底棘轮） | `❌ 有 needs: 但未登记的 job…: fake-needs-job-d1147` rc=1 |
| D `control-tower-tests` 的 `name:` 改一字符 | 必红（身份钉） | `❌ job 名被改动` rc=1 |
| E 检查器桩恒 `exit 0`（停止检出） | `check-required-contexts` 夹具必红 | `❌ 未打印 9/9 命中` + `❌ 重复登记应 exit 1 + 点名，实际 rc=0` + `❌ live 少一条应 exit 1 + 点名，实际 rc=0`（10 通过 / 37 失败） |
| F 删一处 docs-only fail-safe | `D1023` 夹具必红 | `FAIL struct-failsafe-count-10 expect=10 got=9` → `19 PASS / 1 FAIL` rc=1 |
| — | 全部注入复原后 | 各夹具回到 rc=0（79/0、47/0、20/0） |

## 7. 例外清单（我改了**写集之外**的文件 —— 请 lead/K3 逐条核）

写集（task-2 原文）= `.github/workflows/ci.yml`、`scripts/control-tower/required-checks-baseline.txt`、
`docs/synova/coordination/` 一份说明件（本文件）。实际另改了 **3 个 sealed 夹具**，每一个都是**机器强制**的，
不是顺手扩写：

| 文件 | 为什么非改不可 | 改的是什么 |
|---|---|---|
| `tests/control-tower/ci-signal-classify.test.sh` | :243 逐字钉死 `os: [ubuntu-latest, windows-latest]`、:241 钉死 timeout 表达式；:279-293 要求**任何**有 `needs:` 的 job 逐个登记 ⇒ 不改则本 PR 的必需 context 直接红 | 2 处钉子期望值（并收紧为锚定 ERE）+ 登记 2 个顾问 job 到新栏 `NEEDS_NO_REQUIRED_CTX_JOBS`（**lead 已批**） |
| `tests/control-tower/check-required-contexts.test.sh` | :88 硬编码 `12/12 命中`；⑥/live-少一条 两例用 `npm audit` 当金丝雀 ⇒ 该 context 移出必需后三例全红 | ① 改为从真基线派生 N（+`N ≥ 5` 下限防 0/0 假绿）；⑥/⑤ 金丝雀改为从基线取第一条（+非空前置） |
| `docs/synova/product-lines/evidence/D1023-861-docsonly-guard.sh` | ⑥ 数 `git rev-parse --verify -q origin/main` 全文件出现次数 = 10；新增触发 job 的同类 fail-safe ⇒ 11 ⇒ 红 | **收紧口径而非放宽**：计数限定在 10 个 `Detect docs-only change (D515)` step 体内（id `struct-failsafe-count-10` 与 K3/D1112 送审引用不变），判据语义回到"10 处 detect 同款 fail-closed" |

三处**均为"改门禁语义/夹具期望值" ⇒ 随本 PR 送 K3/CTO 过审**；本线**未自判通过、未合并**。
另：task-3（`tests/control-tower` 目录写集）**尚未开工（无 owner）**，此刻零写集重叠；若 task-3 先开工请先 rebase。

## 8. 我看到但**没做**的（另立卡，越界不做）

1. **C 段棘轮应排除非必需 context**（判据变更，须 K3）—— 否则任何"顾问腿"都与它对冲；本卡只做规避（③ 恒 success）。
2. `scripts/control-tower/ci-red-baseline.txt:66` 的 `Control Tower Gate Tests (windows-latest)` 条目
   （`conclusion=null(in-progress)` 观测）在顾问腿改造后**永久成死条目**（永不会有 failure 结论）——
   按棘轮只减不增精神应清；该文件不在本卡写集（归批4/线负责人）。
3. `check-required-contexts.py` 自述边界（:53-59）指出：**它不判"job 级 if:/paths: 让必需 context 被 skip"**。
   D1147 正是踩在这条边界上（靠人守+夹具守）；建议另立卡把它变成机器判据。
4. 顾问腿清单与必需腿清单**双份显式维护**（漂移后果 = 顾问信号失真）。抽公共脚本会让 ~58 个测试
   在 ci.yml 里"失登记" ⇒ 棘轮爆红（见 ci.yml 内注），故本卡保留双份；根治需同时改 [R] 登记口径。
