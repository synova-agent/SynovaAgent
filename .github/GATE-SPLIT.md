# 两平台门禁分工（裁 421 · 2026-10-26）

> 创始人定的分工：**Gitea 管开发与质量，GitHub 做集成测试。**
> 本件是**分工真值**；判"某步该在哪跑"以此为准。

## 一、分工表

| 判据 | Gitea `local-gates` | GitHub `ci.yml` | 说明 |
|---|---|---|---|
| pre-commit 12 组（含声明闸/架构/契约/文件驱动） | ✅ ① | ❌ 已删（2026-10-26） | 质量面唯一权威 |
| tsc 类型检查 | ✅ ①f | ❌ 已删（2026-10-26） | 同上 |
| 增量 vitest（`--changed`） | ✅ ③ | — | 快速反馈 |
| 全量 vitest 分片 | — | ✅ `Vitest (matrix)` | 集成面 |
| 契约测试 `tests/contract/` | ✅ ①j | — | 质量面 |
| 架构边界 `check-architecture.sh` | ✅ ② | — | 质量面 |
| Test-Kit 架构 / as-any 棘轮 | — | ✅ | 集成面 |
| Control Tower Gate Tests | — | ✅ | 仅 GitHub 有 |
| 桌面端构建 | — | ✅ | 集成面 |
| 覆盖率（G5/R5.1） | ✅ ①e | — | 质量面 |

## 二、实测更正（2026-10-26）
1. ~~GitHub 远端不可达~~ **此前判断有误**：远端名是 `mirror`（不是 `github`）；`ssh -T git@github.com` 实测通过。
2. 已推验证分支 `verify/gh-integration` 并在 GitHub 开 **PR #1479**（仅取证，不合并）⇒ **GitHub Actions 确实在跑**。
3. `mirror/main` 落后 `local-main` **89 commits**；**已于 2026-10-26 同步**：
   `27e3433f1..193c3bdf8  HEAD -> main`（GitHub 侧 required checks 提示 2/8 failing，但直推成功）。
4. **同步后 GitHub CI 实跑结果（run 40234461099）**：
   - `desktop-build` ✅ / `Product Progress` ✅ / `Dashboard Auto` ✅
   - `CI · SynovaAgent` ❌ —— 失败 job：**`Gate Integrity (pattern sentinel + injection fixture + ci-reds)`**，
     失败步骤：`Gate integrity pattern sentinel + registration gate`
   ⇒ **发现一处真实的跨平台冲突：GitHub 侧自有 Gate Integrity 与 Gitea 侧的登记表口径不一致**，需单独修（见下）。
2. 镜像修复前，GitHub 侧一切判据**不可作为合并依据**（可能判旧树）。

## 三、判定口径
- **"分工已实现"** = 上表两列**无重复项** 且 两平台各跑一次都有记录（Gitea 有 run URL，GitHub 有 run URL）。
- 当前状态：**重复项已清除（未实测）**，判定 = **未实现（待镜像修复后实测）**。

---

## 四、工程质量权威与 required checks（#1396 执行后口径）
- **工程质量唯一权威 = Gitea `core-gates / core (pull_request_target)`**；它是 Gitea main 的唯一必需 context。
- **GitHub = 集成测试面**。GitHub 检查报告集成测试结果，不作为工程质量权威；其 required checks 仅表示集成测试面的平台要求，不改变上述权威归属。
- GitHub required checks 以 **#1396 执行后的 repo ruleset 实物**为准，本件不复制可能漂移的清单。复核命令：`gh api repos/<o>/<r>/rules/branches/main`。
- 改名／增删须在同 PR 同步实际 workflow job `name:` 与平台 ruleset，避免 context 名漂移。

## 五、已知结构性风险（K3 诊断 §4）
- **P2-⑧ DeployKey 永久旁路**：ruleset `bypass_actors=[{DeployKey, always}]` ⇒ 镜像同步通道即绕过通道；
  现状**接受**（迁移期必需），但：① 泄露=main 保护失效；② 无告警面。**处置**：见 issue（限制/轮换/告警）。
- **P1 口径三处**：GATE-SPLIT（本件）／ci.yml job 名／local-gates 步骤名 —— 本节表即三者的对账锚。
