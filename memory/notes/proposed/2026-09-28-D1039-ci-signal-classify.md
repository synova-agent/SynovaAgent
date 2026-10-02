# D1039 — control-tower-tests 按需跑：job 恒调度 + 内层 `if` 门控（禁用 job 级 `paths:`）

- 状态: proposed
- 日期: 2026-09-28
- 任务: D1039（父卡；子件 D1040 / D1041 / D1042 / D1043）
- 分支: `team/a4-ci-cost` ｜ 工作树: `.synova-wt-a4`
- 类别: 治理 / CI 语义

## 决定

`.github/workflows/ci.yml` 的 `control-tower-tests` job **不使用 job 级 `paths:` 过滤**；
改为「**job 恒被调度 + job 内 `if:` 门控重活**」。判据抽成可独立复跑、可被红测的脚本
`scripts/control-tower/ci-signal-classify.sh`。

## 理由（第一性原理 + 实测）

1. **必需 context 的存在性是硬约束，先保存在再谈省。**
   `Control Tower Gate Tests (ubuntu-latest)` 与 `(windows-latest)` 都在 main 分支保护的
   **12 个必需检查**之列（`scripts/control-tower/ci-red-baseline.txt:65-66`；
   `docs/synova/coordination/CI-诊断通道.md:115-116`，
   `memory/notes/implemented/2026-09-16-d786-dashboard-channel-watchdog.md:5`）。
   job 级 `paths:` 不匹配时 **不创建 check-run** ⇒ 必需 context 永不报告 ⇒ **PR 永久 blocked**。
   本仓已有同型事故记载（`CI-诊断通道.md:109-118`，#403/#404）。
2. **`if:` 跳过仍上报 `success`**，`paths:` 跳过不上报 —— 这是两者唯一的实质差别，也是选型的全部依据。
3. **最大浪费点已量化**（实测，非估算）：`Control Tower Gate Tests (windows-latest)` 单腿
   `22:57:01Z → 23:34:03Z` = **2222 s**，而该 run 的 run 级墙钟
   （`run_started_at → updated_at`）= `22:55:54Z → 23:34:04Z` = **2290 s** ⇒ 该腿占 run 墙钟 **97.0%**；
   且 37 分钟里 **2204 s 集中在单个 step**「Run hermetic control-tower gate tests」（占 job 99.19%）。
   同 run 排除该腿后其余 12 个 job 跨度仅 **326 s**。run id `36356959940`（PR）。
   ⇒ 收益 99% 在这一个 job 上，给其余 9 个 job 加过滤收益 <1%，本卡不做。

## 三个安全网（漏判的代价 = 静默少跑，必须显式设计）

1. **路径集取 super-set**：`.github/workflows/**`（全体，不止 `ci.yml`）+ `.gitattributes` +
   `.gitmodules` + `scripts/**`（全树）+ `tests/control-tower/**` + `tests/doc-system/**` +
   `package.json` + `tsconfig*.json`。
   - `.gitattributes` 单独列：内含 `*.sh text eol=lf`，其注释记「Windows runner autocrlf=true
     会把 .sh 检出成 CRLF 导致 bash 全线 `: command not found`」。改动它**今天本来就触发全量**
     ⇒ 不覆盖即从「跑」变「静默跳过」= **净回归**。
   - `.github/workflows/**` 取全体：`tests/control-tower/check-progress-freshness.test.sh:42-43`
     直接 grep `progress-freshness-watchdog.yml`，而该测试在 `ci.yml:384` 的 for 清单内。
2. **手动强制**：新增 `workflow_dispatch` + 布尔输入 `force_control_tower_tests`。
3. **周期安全网**：新增 `schedule`（每 7 天）触发一次，该 run 只跑控制塔 job；
   路径判据漏项**最多 7 天可见**。
4. **`origin/main` 不可解析 ⇒ 判 `run=true`（全量跑，绝不误跳）** —— 与既有
   `Detect docs-only change (D515)` 的 fail-safe 同族（`ci.yml:319-321`）。

## 已考虑并否决的替代方案

- **job 级 `paths:`**：被否 —— 见理由 1（必需 context 永不报告 ⇒ PR 永久 blocked）。
- **把 job 拆成 `*-probe` + `*-run` 两个 job**：被否 —— 会把必需 context 的名字/数量改掉，
  同样打断 12 必需检查；且在 `ubuntu` 上白付一份 runner 调度。
- **给其余 9 个 job 也加 `paths:`**：被否 —— 实测收益 <1%（timeout 仅 1–8 min），
  却把「必需 context 风险面」从 2 个扩到 12 个。

## 验收（可复跑）

- `bash tests/control-tower/ci-signal-classify.test.sh` → exit 0
- 反向验证：路径集收窄 ⇒ 配对测试**必须转红**（判别性夹具，非「存在性」断言）
- `.gitattributes` / `.github/workflows/progress-freshness-watchdog.yml` 单文件输入 ⇒ `run=true`；
  从集合拿掉 ⇒ 必须转红
- 真实 run 实测：碰控制塔路径 ⇒ windows 腿真执行；不碰 ⇒ 秒级 `success` 且必需 context 仍在
- `python3 scripts/control-tower/check-ownership.py .github/workflows/ci.yml
  scripts/control-tower/ci-signal-classify.sh tests/control-tower/ci-signal-classify.test.sh --owner mac` → 无越域

## 已知边界 / 未覆盖（诚实登记）

- 判据只覆盖**控制塔域**；`src/**` 改动导致控制塔测试红的情形不在覆盖内（**这与 `main` 现状同为不覆盖**，
  非本卡引入的回归；由安全网 3 兜底）。
- `scripts/control-tower/alloc-task-id.sh` 只查 `task-state/` + 分支，**不查 brief 文件名** ⇒
  本次曾发出与 main 已占号 `D1034` 撞号的号（`D1034` 已被
  `.claude/task-briefs/2026-09-27-D1034-dispatch-template-v2.md` 占用）。
  已改号 D1039–D1043。**该分配器缺口应另立卡**（本卡未修，属 `scripts/control-tower/**` 但超出本批写集与风险面）。
