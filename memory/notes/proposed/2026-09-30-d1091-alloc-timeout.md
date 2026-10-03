---
status: proposed
date: 2026-09-30
name: 取号器「无超时腿」修复（两腿有界 + fail-closed）
class: ALLOC_UNBOUNDED_LEG
constraint: "任何外部命令腿（网络/git 查询/全表扫描）必须有硬超时；本机无 timeout/gtimeout 二进制 ⇒ 用便携实现（后台 pid + 0.1s 轮询）；超时一律 fail-closed（exit 2 + degraded 明示），不静默漏号"
expected: "真仓取号端到端 ≤30s（改后实测 13s，改前 >7 分钟无输出）；超时路径有确定性夹具（注入缝）覆盖"
severity: block
occurrences: 3
first_seen: 2026-09-24
description: CTO 台账第七批① 记「取号器第 3 次挂死」（全参数运行 >7min 无输出、仅关分支族 >8min、同关 worktree 全扫+分支族秒级出号）；根因两条腿都无上限
---

# 取号器「无超时腿」（第 3 次挂死）

- **现象**: `alloc-task-id.sh` 全参数运行 >7 分钟无输出（job_kill）；本线独立复现：前台 300s、后台 210s 未完，`bash -x` 追踪涨到 **5,300 万行**后被杀。
- **根因（两条腿，都无上限）**:
  ① **远端腿**: `_LSR_TO="$(command -v timeout || command -v gtimeout || true)"` —— **macOS 两个都没有** ⇒ 落空后走 `else` 分支的**无界** `git ls-remote`。
  ② **扫描腿**: 纯 bash 双循环遍历 456 个 worktree × 每树 ~400 张卡 ≈ **18 万次** `[ -e ]`+`case` 迭代。
- **本卡修法（D1091）**:
  · 新增便携 `_run_bounded`（超时返回 124，与 GNU timeout 同码；零依赖，支持 shell 函数）。
  · 两腿各加硬超时：`SYNO_ALLOC_LSREMOTE_TIMEOUT`（默认 20s）／`SYNO_ALLOC_SCAN_TIMEOUT`（默认 30s）；**0 = 显式关超时**（回到旧行为）。
  · 超时 → **exit 2 fail-closed** + `degraded:` 明示。**与"不可达"区分**：不可达＝快而确定（降级继续，维持原契约），超时＝环境有病（拒绝发号，否则等于在无法校验占用的前提下撞号）。
  · 扫描腿改 `_wt_scan`（`xargs -P8` 分片 + 每片一个 `ls`）：**>4min → 1s**，号集与旧法**逐值一致**（唯一号 495）。
- **实测（2026-09-30）**: 端到端真仓取号 **13s**（改前 >7min 挂死）；新测试 9/9；`alloc-task-id.test.sh` 53/53 无回归；锁测试 7/7。
- **固化**: ★ 可机械化 —— 新测试 `alloc-task-id-timeout.test.sh` 已接进 `ci.yml` 密封清单（防"建了不接线"复发型）。
- **遗留（不在本卡）**: 扫描仍遍历全部 worktree 的 task-state；CTO 建议的「worktree 占用改索引文件」是**设计变更**（需定索引维护方与失效判据），另立卡。
