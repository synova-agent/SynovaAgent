# Task Brief — M9 控制塔门禁三件套（模式哨兵 + CI 登记 gate + 既有红基线棘轮）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
L0 控制塔治理层（门禁质量），不动 src/**。问题族：M3「机制建成未接线/未自测」第 N 次复发——组 7a 非法 ERE 恒过 31 天（D937）、D922 夹具未登记 CI（B3）、D925 检查器零调用面（B4）、CI 权威叙事下既有红无人登记（B2）。
K3 批次2 §五 #1/#2/#7 要求：控制塔脚本要**模式自检** + **判别夹具** + **CI 清单登记**，且不得新增超过一个脚本。
### b) 文件审计（实测，base=origin/fix/d938-alloc-task-id 416b4667）
- `.github/workflows/ci.yml`：密封清单 43 条（D938 已 +1）；新测试不登记即无人执行
- `scripts/pre-commit-check.sh`：`grep -E` 家族 37 处；`:991` 既有非法 ERE（D937 范围）
- 存量未登记测试（sh|py 面）：122 文件 / 登记 43 / **未登记 79**
- CI 既有红：main tip f25e61eb check-runs 20 条，failure=2
### c) 决策
按 K3 建议三件套：**A 模式哨兵** + **B 登记 gate** + **C 既有红基线对账**，收敛为**一个**新脚本（防臃肿），夹具落在 tests/，接线走 CI 新 job（不动 pre-commit-check.sh，Q-M9-1）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- Anthropic 工程基线：门禁必须可自证（检查器要能证明自己执行了，而不是"没报错=通过"）+ fail-closed 三态退出码（D328）。
- 第一性原理：一条门禁的失效模式有三种——**判据坏**（非法正则恒过）、**没接线**（脚本零调用）、**没人登记**（测试不在 CI 里跑）；三者各需一道防线。
- memory 历史：M3（建成未接线）、M1（日志里找不到失败组）、D922 日期炸弹堵队列（门禁自阻断）、D593 起 task-state 登记缺失同源三次。
- 参考：Anthropic/第一性原理 + 结论=「既有违规登记为基线棘轮（owner+expires），新增即拦，到期强制清理」。

## Q2: 范围 — 正确的最简方案
做什么（逐条精确路径）：
- scripts/control-tower/check-gate-integrity.sh — 新：本卡唯一新脚本，A/B/C 三面 + 三态退出码 + 五个注入缝
- tests/control-tower/check-gate-integrity.test.sh — 新：夹具，正常/降级/边界 + M1/M2/M4/M5 判别性
- scripts/control-tower/gate-integrity-baseline.txt — 新：双段棘轮基线，REGISTRY 79 条 + PATTERN 1 条
- tests/control-tower/precommit-groups-injection.test.sh — 新：夹具，12 组违规注入必红，含 FULL 开关
- scripts/control-tower/ci-red-baseline.txt — 新：既有红登记 2 条
- .github/workflows/ci.yml — 改：canary 清单追加 1 行 + 新增 gate-integrity job
- .claude/task-briefs/2026-09-24-M9-gate-integrity.md — 本 brief
- memory/notes/proposed/2026-09-24-m9-gate-integrity.md — 本卡决策 Note（D395-a/D534 门禁要求）

不做什么（含文件路径）：
- 不改 `scripts/pre-commit-check.sh`（Q-M9-1：既有 :991 由 D937 修）
- 不改 `scripts/control-tower/check-canary-drift.sh`（Q-M9-2：语义不同，告警类不合并）
- 不改 `scripts/control-tower/alloc-task-id.sh`（D938 写集）
- 不碰 `scripts/audit/**`（K3 红线）
- 不改 `src/**`、`packages/**`（非本卡域）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash scripts/control-tower/check-gate-integrity.sh`（CI job `gate-integrity` 三步之一）
处理：A 模式哨兵（grep 方言分判 + 语法 rc）+ B 登记 gate（密封面 sh|py + ratchet 基线）+ C 既有红基线对账（check-runs JSON）
结果：末行 `GATE-INTEGRITY: OK` 且退出码 0；新增坏模式 / 新增未登记测试 / 未登记红 → 退出码 1 并点名原因

## 架构层: 基础设施

## Done 标准
- [ ] verify: `bash scripts/control-tower/check-gate-integrity.sh; echo $?` → 0 且末行 `GATE-INTEGRITY: OK`
- [ ] verify: `bash tests/control-tower/check-gate-integrity.test.sh; echo $?` → 0（PASS≥32 FAIL=0）
- [ ] verify: `bash tests/control-tower/precommit-groups-injection.test.sh; echo $?` → 0
- [ ] verify: 解析到 0 个模式 → exit 2（`SYNO_GATE_SCAN_SCRIPTS` 指向空目录实测）
- [ ] verify: `git diff --name-only` 无 `scripts/pre-commit-check.sh` 与 `check-canary-drift.sh`
