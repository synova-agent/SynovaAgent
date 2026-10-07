# Task Brief: D373 修复 bot PR 创建静默失败 + 悬挂分支自愈

> 生成: 2026-08-16 | 分支: main | 角色: DeepSeek Harness (Mac)
> 背景: D371 合并后 CI 首次运行推送了 auto/product-progress 分支（3695b722），但 PR 从未创建
>       （git ls-remote refs/pull/*/head 物理验证：20 个 PR 无一指向该提交）。
>       根因未定（gh pr create 静默失败，日志无显式输出），但暴露出两个确定缺陷:
>       ① PR 创建失败被静默（workflow 绿灯假装成功——M1/M2 模式同型）
>       ② 悬挂 bot 分支（有分支无 PR）无人清理

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
基础设施（产品真值层自动化）。D371 交付的 .github/workflows/product-progress.yml 的
PR 创建步骤存在静默失败缺陷。修复范围仅 workflow 文件，不动三脚本（幂等已修）。

### b) 文件审计
- .github/workflows/product-progress.yml:44-57 — gh pr list/create 无失败处理、无诊断输出
- 物理事实: 远端 bot 分支存在（3695b722），refs/pull 无对应 PR（已验证）
- pre-push 门禁 0-1 会拦截本地删除远端分支（正确行为，不绕过）

### c) 决策
参考：Anthropic（fail-closed：PR 创建失败 = workflow 红灯，绝不绿灯假装成功）
+ 第一性原理（页面即真相的自动化断了必须报警）+ DeepSeek（最少机制：
workflow 内自愈悬挂分支，不引入新脚本）。
结论：收敛——gh pr create 失败自然炸 step（红灯）+ 悬挂分支检测自清理。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC（Done 标准）→ ② 测试（yaml 语法 + 幂等逻辑人工走查 + 双机产物一致已有测试兜底）→
③ 实现（workflow 单文件修改）→ ④ 接线（D373 合并即触发首跑，自愈 + fail-closed 生效）→
⑤ 验证（node yaml parse + pre-commit 13 组）。
引用依据：铁律 11（静默降级禁止——PR 创建失败必须可见）、铁律 24（catch 有 log）、
铁律 35（自动化优先）、D328 M1 教训（fail-open 把"未执行"压成"通过"）。

### b) 本任务执行约束
- rule: "PR 创建失败 → workflow 红灯（fail-closed），不静默不回退"
  verify: "grep -n 'gh pr create' .github/workflows/product-progress.yml 前后无 || true 兜底"
- rule: "悬挂 bot 分支（有分支无 PR）→ workflow 自动删除（自愈）"
  verify: "grep -n '悬挂' .github/workflows/product-progress.yml"

### c) 决策参考系
参考：Anthropic/DeepSeek/第一性原理 + 结论（见 Q0c）。

## Q2: 范围 — 正确的最简方案

做什么：
- .github/workflows/product-progress.yml
- .claude/task-briefs/D373-product-progress-pr-fix.md

不做什么：
- 不改 scripts/product-lines/calc-progress.py（幂等已修，D372 已合并）
- 不改 scripts/pre-commit-check.sh（门禁不动）
- 不改 scripts/audit/audit-check.py（K3 红线）
- 不手动删除远端 bot 分支（门禁 0-1 正确拦截；D373 合并后 workflow 自愈清理）
- 不改 src/server.ts（业务代码领地）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：D373 PR 合并 → push main → workflow 自动触发
处理（中间经过哪些步骤）：悬挂分支检测删除 → 幂等检查 →（无变化则退出）
结果（最终展示在哪）：无悬挂分支报错；下次周五真变化时 PR 创建失败会红灯可见（不静默）

## 架构层: 基础设施
#CRITERIA: A

## Done 标准
- [ ] 入口可触达: node yaml parse .github/workflows/product-progress.yml 成功 + pre-commit 13 组全绿
- [ ] 链路走通: workflow 含悬挂分支自愈逻辑（grep "悬挂" 命中）+ gh pr create 无静默兜底（grep -A2 无 || true）
- [ ] 结果可见: D373 合并后 Actions 首跑日志可见自愈输出（或"无变化跳过"）；bot 分支被清理
