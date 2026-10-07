# Task Brief: D372 产品进度链幂等修复（bot PR 噪音根因）+ 认领收尾

> 生成: 2026-08-16 | 分支: main（基于 D371 PR #19 已合并）| 角色: DeepSeek Harness (Mac)
> 背景: D371 合并后 CI 首跑成功（双机产物一致 ✅），但发现 generated_at 时间戳使三脚本每次运行
>       都产生 3 行噪音 diff → 每次合并都开一个无意义 bot PR（auto/product-progress 已出现 1 个）。

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
基础设施（产品真值层）。修复 D371 交付的 scripts/product-lines/ 三脚本的幂等缺陷。
现状: CI workflow（product-progress.yml）在 push main / 周五 cron 触发 refresh-all.sh；
三脚本无条件重写产物 → generated_at 永远变 → git diff 永远非空 → bot PR 噪音。

### b) 文件审计
- scripts/product-lines/calc-progress.py:283 — json.dump 无条件写
- scripts/product-lines/aggregate-todos.py:382 — 精确比较含 generated_at → 永不等
- scripts/product-lines/gen-progress-page.py:329 — 无条件写
- 复用 gen-task-board.py 的幂等契约（"自动区无变化 → 不写文件"）——同库已有先例。

### c) 决策
参考：第一性原理（页面即真相要求"无变化不产生噪音"）+ Anthropic（机器可验契约：mtime 断言固化）
+ DeepSeek（最少机制：比较时归一化时间戳行，不引入新状态文件）。
结论：收敛——三脚本各加"内容无变化（仅时间戳）不重写"。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC（Done 标准见下）→ ② 测试（mtime 幂等断言，先写测试再改）→ ③ 实现（3 处最小修改）→
④ 接线（refresh-all 串联不变，CI 行为自动受益）→ ⑤ 验证（全量测试 + 13 组门禁）。
引用依据：铁律 0-2、铁律 7、铁律 11（bot 噪音 = 静默漂移的同类问题）、铁律 35（自动化优先，机器可验）。

### b) 本任务执行约束
- rule: "幂等 = 内容无变化（仅时间戳）不重写，用 mtime 断言物理验证"
  verify: "python3 tests/control-tower/product-lines.test.py TestCalcStateMachine.test_idempotent_no_rewrite TestGenPage.test_idempotent_no_rewrite"
- rule: "产物生成时间只随内容变化而更新（bot PR 只在真变化时出现）"
  verify: "bash scripts/product-lines/refresh-all.sh 连跑 2 次 → git status 无 product-lines 产物变更"

### c) 决策参考系
参考：Anthropic/DeepSeek/第一性原理 + 结论（见 Q0c）。

## Q2: 范围 — 正确的最简方案

做什么：
- scripts/product-lines/calc-progress.py
- scripts/product-lines/aggregate-todos.py
- scripts/product-lines/gen-progress-page.py
- tests/control-tower/product-lines.test.py
- docs/synova/coordination/TASK-ROUTING.md
- .claude/task-briefs/D372-product-progress-idempotency.md

不做什么：
- 不改 .github/workflows/product-progress.yml（触发逻辑无需变，幂等后自动无噪音）
- 不改 scripts/pre-commit-check.sh（门禁不动）
- 不改 scripts/audit/audit-check.py（K3 红线）
- 不改 src/server.ts（业务代码领地）
- 不删远端 auto/product-progress 分支（D372 合并后由 Harness 收尾删除，避免 CI 竞态）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：CI push main / 周五 cron / 本地 bash scripts/product-lines/refresh-all.sh
处理（中间经过哪些步骤）：三脚本幂等比较 → 内容无变化跳过写文件
结果（最终展示在哪）：refresh-all 连跑 2 次后 git status 零产物变更；CI 不再产生仅时间戳的 bot PR

## 架构层: 基础设施
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: bash scripts/product-lines/refresh-all.sh 连续 2 次 → git diff --stat docs/synova/product-lines/ 为空
- [ ] 链路走通: python3 tests/control-tower/product-lines.test.py 全绿（28 用例含 2 个新幂等断言）
- [ ] 结果可见: 远端 bot 分支的噪音 diff 根因消除（修复合并后删除 bot 分支即彻底清理）
- [ ] 门禁: bash scripts/pre-commit-check.sh 13 组全绿
