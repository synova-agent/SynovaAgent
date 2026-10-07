# Task Brief: D421: U5a 门禁三态化 — marker 三判（CT-29 并发/amend 误报根治）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制塔脚本领地) | 上游 spec: UPGRADE-SPEC-控制塔与审计流程-20260817.md §U5a

## Q0: 定位
控制塔 post-commit.sh 的 --no-verify 绕过判定用单一"marker_head == HEAD^"对账。
CT-29 实证：全局单例 marker 被并发 session 的 pre-commit 覆盖后，另一 session 的正常提交被误判 detected-bypass；amend 提交同样误判。误报经 GATEKEEPER 组 0（今日≥1 即硬阻断）放大为全线死锁（D362）。本任务把判定改为分场景三判 + 新鲜度兜底，并把 GATEKEEPER 熔断改为可人工确认放行，根治误报锁死。文件：scripts/hooks/post-commit.sh（判定）、scripts/pre-commit-check.sh（熔断）。

## Q1: 调研
- 上游 spec U5a 已给出三判设计（①HEAD^ ②amend 同父 ③并发祖先）+ freshness>300s 收紧。
- 铁律 0-2 契约先行：先写测试（post-commit-marker.test.sh 扩展 S7 amend / S8 并发③ / S9 真绕过 stale marker）再改实现。
- ctrl-tower-change 模式 1（三态退出码）/ 模式 5（真实 git 沙箱测试，不 mock 判定）。
- 跨平台：post-commit.sh:65 `grep -oP` 在 macOS BSD grep 无 -P → TASK_ID 恒 unknown，一并改 portable。

## Q2: 范围
做什么：
- scripts/hooks/post-commit.sh
- scripts/pre-commit-check.sh
- tests/control-tower/post-commit-marker.test.sh
- .claude/task-briefs/2026-08-17-D421-u5a-marker-tristate.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：git commit 触发 post-commit hook（或直接 bash scripts/hooks/post-commit.sh）。
处理：读 marker → 三判（常规/amend/并发祖先）→ 任一命中做新鲜度校验 → 全不命中记 detected-bypass。
结果：并发/amend 不再误报 detected-bypass；真 --no-verify（stale marker）仍被 freshness 抓 possible-bypass；GATEKEEPER 单次 detected-bypass 不再无条件锁死全线（SYNO_GATEKEEPER_ACK=1 可确认放行）。

## 架构层: 控制塔/钩子（L0 工程防线，非五层业务架构）
#CRITERIA: D

## Done 标准
- [x] 三判生效：常规/amend/并发三场景 pass，不误报 — verify: bash tests/control-tower/post-commit-marker.test.sh
- [x] 真绕过仍被抓：stale marker（>300s）→ possible-bypass — verify: bash tests/control-tower/post-commit-marker.test.sh
- [x] GATEKEEPER 熔断去锁死：SYNO_GATEKEEPER_ACK=1 放行、缺省仍阻断 — verify: bash -n scripts/pre-commit-check.sh && grep -n "SYNO_GATEKEEPER_ACK" scripts/pre-commit-check.sh
- [x] 语法 + 跨平台：post-commit.sh 无 grep -oP 用法，bash -n 通过 — verify: bash -n scripts/hooks/post-commit.sh
