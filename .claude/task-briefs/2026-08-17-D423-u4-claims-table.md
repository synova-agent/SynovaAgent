# Task Brief: D423: U4 交付方"声称↔证据"自证表（格式版，不预跑命令）

> 生成: 2026-08-17 | 认领: 🧭 DSH (控制塔脚本领地) | 上游 spec: UPGRADE-SPEC-控制塔与审计流程-20260817.md §U4

## Q0: 定位
K3 审计成本大头 = 交付方"声称"没绑定可执行证据，K3 只能当侦探重新逐项复测。U4 把"声称↔证据对照表"固化为门禁：dev doc「交付声明」节强制三列（声称|证据命令|预期），机器校验格式 + 白名单 + 拒危险字符。本任务按 spec 降级方案做**格式版**（只查表存在 + 格式 + 命令形态，**不预跑命令**），预跑留第二版（需严格沙箱+超时）。

## Q1: 调研
- 上游 spec U4 已裁决：高风险在"执行交付方命令的注入面"→ 第一版只查格式不预跑（最高风险点规避）。
- 铁律 0-2 契约先行：先写测试（完整表 exit 0 / 缺证据 exit 1 / 非白名单 exit 1 / 危险字符 exit 1 / 无节跳过 exit 0 / doc 缺失 exit 2）再实现。
- ctrl-tower-change 模式 1（三态退出码）/ 模式 3（条件跳过：仅 SYNOVA-IMPL-*.md 暂存时触发）。
- 白名单只读命令：grep/git/vitest/ls/wc/cat/head/tail/find/test/diff/stat/file/du/sed/awk/sort/uniq/python3/node；拒绝 ; & $ < > `（管道 | 允许，\| 反斜杠不算危险）。

## Q2: 范围
做什么：
- scripts/control-tower/verify-claims-table.sh
- scripts/pre-commit-check.sh
- tests/control-tower/verify-claims-table.test.sh
- .claude/task-briefs/2026-08-17-D423-u4-claims-table.md
不做什么：
- 不改 scripts/audit/

## Q3: 验收
入口：pre-commit 组 12 附挂 G12d（暂存含 SYNOVA-IMPL-*.md 时触发）。
处理：verify-claims-table.sh 找「交付声明」节 → 校验表头(声称/证据) + 三列非空 + 命令白名单 + 拒危险字符（不执行）。
结果：缺证据/非白名单/危险字符 → exit 1 点名；无交付声明节 → exit 0 跳过；doc 缺失 → exit 2。

## 架构层: 控制塔/工程基建（非 L1-L5 产品层）
#CRITERIA: D

## Done 标准
- [x] 六路径全绿（完整/缺证据/非白名单/危险字符/跳过/降级） — verify: bash tests/control-tower/verify-claims-table.test.sh
- [x] G12d 接线：pre-commit 组 12 调用 verify-claims-table — verify: grep -n "verify-claims-table" scripts/pre-commit-check.sh
- [x] 不预跑命令（格式版安全边界） — verify: ! grep -nE "eval|bash -c|subprocess|os\.system" scripts/control-tower/verify-claims-table.sh
