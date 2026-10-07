# Task Brief: D422: U5c 门禁三态化 — verify-parallel 判定语义（CT-28）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制塔脚本领地) | 上游 spec: UPGRADE-SPEC-控制塔与审计流程-20260817.md §U5c

## Q0: 定位
verify-parallel.sh（D311 并行声明物理验证）的 block 判定靠 `grep '"status": "block"'` 文本匹配（格式漂移即静默放行 M1）；用法错误 exit 0（当通过）；调用方 pre-push 对 exit 1/2 不分流。本任务三态化：block 判定直传 devdoc_writeset.py 内核 exit code、用法错误 exit 2、pre-push 按 0/1/2 分流（0 过/1 阻断/2 降级告警不阻断）。

## Q1: 调研
- 上游 spec U5c 已裁决最小修复：①用法错误 exit 0→2 ②block 判定弃 grep 直传内核 exit（devdoc_writeset.py 本有三态 return 1 if hits else 0 / return 2）③调用方 pre-push 分流。
- 铁律 0-2：先扩测试（场景 6 用法错误 exit 2 / 场景 7 内核异常 degraded exit 2）再改实现。
- ctrl-tower-change 模式 1（三态退出码）/ 模式 5（fake python3 注入沙箱测试内核异常）。
- 接力/依赖识别是较大改造，spec 明示第二阶段单独立项——本任务不做（避免过度工程）。

## Q2: 范围
做什么：
- scripts/control-tower/verify-parallel.sh
- scripts/pre-push-check.sh
- tests/control-tower/verify-parallel.test.sh
- .claude/task-briefs/2026-08-17-D422-u5c-verify-parallel-tristate.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：bash scripts/control-tower/verify-parallel.sh --scan-today（或 pre-push 触发）。
处理：compare_docs 直传 devdoc_writeset.py exit code（0 pass/skip / 1 block / 其他 degraded），用法错误 exit 2。
结果：共享写集仍 exit 1 阻断；用法错误 exit 2；内核异常 exit 2 不静默；pre-push 对 exit 2 只告警不阻断。

## 架构层: 控制塔/工程基建（非 L1-L5 产品层）
#CRITERIA: D

## Done 标准
- [x] 三态生效：block/usage/degraded 三路径 exit 1/2/2 — verify: bash tests/control-tower/verify-parallel.test.sh
- [x] pre-push 三态分流：exit 2 只告警不阻断 — verify: grep -n "VP_EXIT" scripts/pre-push-check.sh
- [x] 语法通过 — verify: bash -n scripts/control-tower/verify-parallel.sh
