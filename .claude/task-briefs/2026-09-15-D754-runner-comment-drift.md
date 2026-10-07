# Task Brief: D754 Mac runner 注释去漂移

> 生成: 2026-09-15 | 分支: main | as any: 0
> 派单: docs/synova/coordination/派单-哨兵欠账-D751-D752-D754-20260914.md §三（D754 Mac 半，P2）
> 依据: 质询欠账登记 §二 D754（M7 文档-实现漂移家族）
> 范围: 仅 Mac 半（runner.ts 注释）；Win 半（manifest 声明 route 是否启用）已记台账待派

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
「纵向」L3（- [x] 纵向）。src/sentinel/runner.ts 的路由注释与实现漂移（M7 家族）:
注释宣称「无限扩展: 加新哨兵时在 config 中声明路由」——实测 0/45 声明且 loader 不透传 route；
注释宣称「下游 VALID_EXPERTS 过滤成空路由」——实际是 continue 静默跳过无日志。
本任务 = 注释对齐事实（不改实现——改实现另有其单，派单明示）。

### b) 文件审计
复现三证（worktree 实测 2026-09-15）:
- runner.ts:65 旧注释「无限扩展…声明路由」存在;
- grep -l '"route"' extensions/sentinels/*/manifest.json → 0 个（0/45）;
- sentinel-loader.ts registerLoadedSentinels 的 config 组装无 route 透传（grep "route" 零命中）;
- runner.ts:714 真实行为 = VALID_EXPERTS.has(rec) ? rec : null; if (!expertType) continue;（静默跳过）。
关系: 仅注释修订，无机制新建。

### c) 决策
复用现状（注释写事实 + file:line 可指）。不实现「显式声明 route」正解——派单 §三明示
「若执行方判断显式声明 route 才是正解，不要在本单实现——上报 CTO，另单」→ 本单不改实现。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 旧表述消失 + 新注释每条机制可指代码。② 无新测试（纯注释，现有 runner 测试守护
不回归）。③ 实现 = 三处注释重写（findSignalRoute JSDoc / config route 行注释 / D567 块注释）。
④ 接线 = 注释即文档（读者=后续维护者）。⑤ 验证 = grep 双零 + diff 纯注释证明 + 测试绿。

引用依据:
- 铁律 9 关键变更 grep 全仓库传播（旧表述 grep 归零）
- 铁律 0-2 验收可证伪（grep -c 命令即验收）
- M7 家族（文档-实现漂移）治理: 注释必须与实现一致，不确定就写「另有其单」

### b) 本任务执行约束
- rule: "旧表述物理消失"
  verify: "grep -c '声明路由' src/sentinel/runner.ts → 0"
- rule: "零实现改动（diff 增删行全为注释）"
  verify: "git diff src/sentinel/runner.ts | grep -E '^[+-]' | grep -vE '^[+-]{3}' | grep -vE '^[+-]\s*(//|/\*\*|\*|\*/)' → 空"
- rule: "注释描述的机制可指代码（VALID_EXPERTS continue 在 runner.ts:714 一带; loader 不透传在 sentinel-loader.ts）"
  verify: "grep -n 'if (!expertType) continue' src/sentinel/runner.ts"

### c) 决策参考系
参考：Anthropic（文档与实现一致性是工程基线）+ 第一性原理（注释=给未来读者的契约，漂移=负资产）+ 结论收敛 → 直接执行。

### d) 相关 Note 引用
- M7 漂移家族已有台账（质询欠账登记 §四）；本单不新增 Note（纯注释对齐，无新决策）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- src/sentinel/runner.ts （仅注释三处: findSignalRoute JSDoc 重写为真实优先级链 + 失效模式; config route 行注释改事实; D567 块注释的「过滤成空路由」改「continue 静默跳过无日志」）

不做什么：
- 不改 src/sentinel/runner.ts 任何非注释行（路由实现——D750 已定，改实现另有其单）
- 不改 src/sentinel/sentinel-loader.ts（route 透传接线属「显式声明 route」正解，派单明示另单）
- 不改 extensions/sentinels/cash-runway/manifest.json（extensions/sentinels/** 属 Win 数据侧，派单红区）
- 不改 tests/sentinel/d750-expert-routing.test.ts（D750 已交付，本单无新测试——纯注释由现有 runner 测试守护）

## Q3: 验收 — 入口 → 交互 → 结果

入口: grep src/sentinel/runner.ts
处理: 三处注释重写（真实优先级链: config.route 恒未命中 → layer 默认映射生效 → host 兜底；
失效模式: VALID_EXPERTS continue 静默跳过无日志）。
结果: 旧表述 grep 归零; 新注释机制均可指 file:line; runner 相关测试 12/12 绿。

## 架构层: L3（洞察层哨兵路由注释——零代码变更）
#CRITERIA: A

## Done 标准
- [ ] 旧表述消失: verify: grep -c '声明路由' src/sentinel/runner.ts → 0（改前 1 已贴，改后 0 已贴）
- [ ] 零实现改动: verify: git diff 增删行全注释（空输出已验证）
- [ ] 注释可指代码: verify: grep -n 'if (!expertType) continue' src/sentinel/runner.ts → 命中（VALID_EXPERTS 静默跳过实文）
- [ ] 无回归: verify: npx vitest run tests/sentinel/sentinel-runner.test.ts tests/sentinel/sentinel-runner-auto-ticket.test.ts → 12 passed

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-15-D754-runner-comment-drift.md | task |
| src/sentinel/runner.ts | task |
| task-state/D754.json | task |
