# CI 恢复派单（DSH）— main CI 转绿 + 全量 vitest 覆盖（2026-08-23）

> 认领角色：🛠 Mac DSH（控制塔/门禁/CI 地盘，scripts/ + .github/workflows/）
> 来源：Codex 四任务终审（D470/D471/D475/D338）CI 核验 + main 基线对照（run 32576538066 实证）
> 优先级：**P0** — V4.9.0 设计以 CI 为权威；main 长期红 = 权威失效；Vitest matrix 缺陷 = 测试权威空白

---

## 背景（物理证据，非推断）

`gh run view 32576538066`（main 最新全量 CI，2026-08-22 13:42Z）：

| Job | 结论 | 说明 |
|---|---|---|
| Architecture Check | success | ✅ |
| TypeScript + Lint + Iron Laws | **failure** | D500 会话 detected-bypass 记录触发 gatekeeper 硬阻断 |
| Integration Contract Check | success | ✅ |
| Control Tower Gate Tests (U7c) | **failure** | ct-test-gate「有配对且绿应 exit 0」实际 1；配对测试 alloc-task-id.test.sh 基线 FAIL=5 |
| npm audit | success | ✅ |
| Vitest (${{ matrix.shard }}) | **skipped** | job 名含字面 `${{ matrix.shard }}`，matrix 未定义 → 全量 vitest 从未在 CI 执行 |

四任务 PR（#94/#104/#105/#95）的 CI 失败与此逐 job 同因（D471 报告附 PR comment 铁证）。D338 在 UTC 次日清零后重跑全绿——证明①号问题是"历史记录阻塞新 CI"的判定缺陷。

---

## 子任务 1：Iron laws 假红（detected-bypass stale marker）

**现象**：bypass.log 含 D500 会话今日（UTC）`detected-bypass head-mismatch marker=eff66bf8` 记录 → gatekeeper 硬阻断 Iron laws，main 与 PR 同红。

**修复方向**（DSH 定夺）：head-mismatch 记录应核对 marker 对应 commit 是否已合入（stale marker 自动忽略），或确认"UTC 次日清零"语义下历史记录不阻塞新 CI；必要时给 gatekeeper 加"记录时效/来源分支"维度。

**验收**：无今日 detected-bypass 记录时 Iron laws 绿；有 stale 历史记录时不误拦新提交。

---

## 子任务 2：ct-test-gate 基线破缺

**现象**：`ct-test-gate.test.sh`「有配对且绿应 exit 0」实际 exit 1；其配对测试 `alloc-task-id.test.sh` 基线 FAIL=5（main 与 PR 实测同失败）。

**修复方向**：修 alloc-task-id.test.sh 的 5 个基线失败，或修正 ct-test-gate 的配对判定（配对测试自身基线红时不应按"绿"判定）。

**验收**：`tests/control-tower/` 全绿；ct-test-gate 在配对测试全绿时 exit 0、有失败时 exit 1（三态可追溯）。

---

## 子任务 3：Vitest matrix 缺陷（最严重 — 测试权威空白）

**现象**：`ci.yml` 的 Vitest job 名含字面 `${{ matrix.shard }}`，matrix 未定义 → job 永远 skipped；**全量 vitest 从未在 CI 执行**。本地实测：62 个失败文件集合与 69be07c8 基线 diff 空（存量，非 PR 引入）——但 CI 层面无人能自动发现新增测试失败。

**修复方向**：定义 `matrix: { shard: [1/2, 2/2] }` 并让 job 名正确插值；或改单 job 全量跑（CI 时长可接受则更简单）。

**验收**：CI 的 Vitest job **真实执行**且对 PR 增量可判定（PR 引入失败 → 红；存量失败 → 白名单标注，可审计）。

---

## 完成标准（DS）

* **DS1** main 最新全量 CI run：Iron laws + CT Gate + Vitest 三 job 全部 success（Vitest 非 skipped）。
* **DS2** 回归验证：重跑 D471/D475 任一 PR 的 CI，原两个失败消失且无新增。
* **DS3** Vitest matrix 修复后，跑一次全量对照：失败集合与基线一致（存量）或可归因（新增），附 run 链接。
* **DS4** 无 --no-verify、bypass.log 记录完整；改动限于 scripts/ + .github/workflows/ + 相关测试（DSH 地盘）。

## 关联

* D471 报告 PR comment：https://github.com/tangbaobao520/SynovaAgent/pull/95（CI 对照铁证）
* 本卡验收后，Codex 四任务（D470/D471/D475/D338）的 K3 最终审计可闭环。
