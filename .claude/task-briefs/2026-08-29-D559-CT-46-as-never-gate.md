# D559 — CT-46 pre-commit 组 1 类型安全模式扩 as never / as unknown as

> 派单: CTO 自办 | 2026-08-29 | 来源: K3 GA 线闭环批（2026-08-29-D551-D487-ga-line.md P2：as never 门禁盲区）
> 类型: FIX（控制塔门禁修复，V5.2.7 PATCH）
> #CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
L0 控制塔（门禁脚本层，非 L1-L5 产品层）。pre-commit 组 1「类型安全 + 硬编码数据」的 as any 检查（pre-commit-check.sh L471）只匹配 `as any\b` 字面量——K3 实证 `getDatabase() as never`（src/mcp/index.ts L236）与 `as unknown as` 双断言链同属类型信任崩溃（铁律 38 精神）却全部逃逸。

### b) 文件审计
- pre-commit-check.sh L467-472：AS_ANY_DIFF 收集 + M 模式匹配（`as any\b`）+ hard_check 标签
- tests/control-tower/hard-gate-convergence.test.sh：组 1 结构断言（L38 标签）+ 行为断言 A（as any 探针）
- 现有 as-any 审计器 packages/test-kit/tests/architecture/05-as-any-audit.test.ts 为全仓扫描（vitest 通道），扩展属编码线（折入 D558）

### c) 决策
无覆盖 → 本任务扩模式 + 配对测试。存量实例（mcp L236）清理归编码线 D558（与 05-as-any-audit 同步扩展耦合）。

## Q1: 调研
铁律 35（自动化优先：门禁能拦的不靠 review）；K3 P2 归因「pre-commit 组 1 模式盲区」；D501 先例（组 1 排除测试文件防误报——扩展模式须同样跳过注释行 + 排除测试/声明文件，不改变既有排除语义）；模式 4（grep 计数防 0\n0 惯例不适用——本处 M 为输出文本非计数）。

## Q2: 范围
做什么：
- 修改 scripts/pre-commit-check.sh：L471 模式 `as any\b` → `as (any|never)\b|as unknown as` + hard_check 标签同步 + 头部注释（L19/L24）
- 修改 tests/control-tower/hard-gate-convergence.test.sh：结构断言标签同步 + 行为断言 A2（as never 硬拦）/ A3（as unknown as 双断言硬拦）/ A4（裸 as unknown 合法中间态不拦，用已有跟踪文件追加行设计避开新文件配对门禁干扰）
- 修改 scripts/workflow/resolve-commit-brief.sh：认领候选日期窗口 ±1 天（DATES/DATES_C，PR #295 CI 实证：UTC+8 日期 brief 对 UTC runner 是明天 → 认领被排除 → 回退陈旧 brief 致 6 字段红）
- 修改 tests/control-tower/resolve-commit-brief.test.sh：场景 5（明日 brief 认领数胜出）/ 场景 6（today-2 窗口外排除）
- 修改 .codex/control-tower/VERSION.md：V5.2.7 条目（PATCH）
- 修改 docs/synova/coordination/审计发现台账-DSH-CTO.md：CT-46 状态翻 ✅（合并后收尾）
- memory/notes/proposed/2026-08-29-d559-resolver-date-window.md：落地删除侧
- memory/notes/implemented/2026-08-29-d559-resolver-date-window.md：四态落地（铁律 49）

不做什么：
- 不改 src/mcp/index.ts（存量 as never 清理归 D558 编码线）
- 不改 packages/test-kit/tests/architecture/05-as-any-audit.test.ts（同步扩展归 D558）
- 不改 scripts/audit/（审计红线）

## Q3: 验收
入口：bash tests/control-tower/hard-gate-convergence.test.sh
处理：26 断言（结构 10 场景 + 行为 A/A2/A3/A4/B 系列）
结果：26/26 全绿 + ct-test-gate 通过 + 全 13 组自检通过（CI 权威复核）

## 架构层:

L0 控制塔（scripts/ + tests/control-tower/，非 L1-L5 产品层）

## Done 标准
- [x] 行为断言 A2/A3/A4 全绿 verify: bash tests/control-tower/hard-gate-convergence.test.sh 2>&1 | grep "26 通过, 0 失败"
- [x] 模式扩展生效 verify: grep -c "as (any|never)\\\\b|as unknown as" scripts/pre-commit-check.sh | xargs test 1 -ge
- [x] V5.2.7 已登记 verify: grep -c "## V5.2.7" .codex/control-tower/VERSION.md | xargs test 1 -ge
