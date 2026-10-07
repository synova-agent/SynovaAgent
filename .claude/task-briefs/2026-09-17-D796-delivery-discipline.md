# Task Brief: D796 交付纪律三闸（物理固化）

> 生成: 2026-09-17 | 任务: D796 | 认领: synova-cto
> 触发: 创始人 2026-09-17 三次点名同类问题复发（交付未进 git / 执行方弄脏别人分支 / 派单未写 brief 前置），要求「固化，不能自律解决」
#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
- 层级：`scripts/control-tower/`（控制塔门禁域）+ `scripts/pre-commit-check.sh`（附加块，不并 13 组编号）
- 现有：G12 只查 brief Q2 与暂存集一致性；G6 查 brief 存在性——**都不检查「完工是否落库」与「改动是否发生在任务自己的分支」**
- 决策：新增三态门禁脚本 + 接入 pre-commit（本地软提示 / CI 硬阻断），不新建门禁组编号

### b) 文件审计
```
scripts/control-tower/check-delivery-discipline.sh        — 新建（三闸引擎 + --scan）
tests/control-tower/check-delivery-discipline.test.sh     — 新建（14 断言含反向验证）
scripts/pre-commit-check.sh                               — 改（D796 附加块，插在 D520 块之前）
```

### c) 决策
复用 D782/D734 的附加检查块接入模式（不进 13 组编号）；三态退出码对齐 D328。

## Q1: 调研 — 本仓证据 + 技能模式

- 本仓 V3.9 教训原文：「信息注入型检查对 agent 不可见；硬阻断 100% 有效，软机制 0% 有效」→ 三条纪律必须落成检查而非文档。
- ctrl-tower-change 技能模式 1–6（三态退出码 / 全角变量边界 / 条件跳过 / grep 计数 / 测试注入 / 改完验收链）逐条对齐。
- 事实依据：D794 交付以未提交状态躺在他人分支工作区（5 改 + 3 未跟踪，无分支无 PR），缺 brief 被 G12 硬阻断 → 「文件写好了」被当完工。

参考：第一性原理（可判定才是约束）＋ 本仓硬阻断先例（G12/G13）＋ 反向验证方法 → 结论：新增门禁脚本 + pre-commit 接线。

## Q2: 范围 — 正确的最简方案

做什么：
- `scripts/control-tower/check-delivery-discipline.sh` — C1 工作区归属 / C2 完工落库 / C3 派单四件套 + `--scan`
- `tests/control-tower/check-delivery-discipline.test.sh` — 14 断言（正常 / 反向红 / 降级 / 边界 / 接线）
- `scripts/pre-commit-check.sh` — 附加块接线（传 `GIT_CACHED_ALL_NAMES`，CI 下 honor SYNO_DIFF_BASE）

不做什么：
- 不改 `scripts/audit/`（K3 红线）
- 不改 `src/**`（产品代码）
- 不动 13 组编号（避免打破「全部 13 组通过」自声明链）
- 不引入网络调用、不新增三方依赖

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash scripts/control-tower/check-delivery-discipline.sh [--files ...] [--scan]`（pre-commit 自动调用）
处理：C1 比对 brief 任务号与分支任务号（大小写不敏感）；C2 校验完工卡 impl 与写集落库；C3 校验派单四件套
结果：逐项 ✅/❌ 点名 + 尾行 `DISCIPLINE-OK/FAIL/DEGRADED`；违规在 CI（SYNO_CI=1）为硬阻断

## 架构层
scripts（控制塔门禁域）

## Done 标准
- [ ] verify: `bash tests/control-tower/check-delivery-discipline.test.sh` → 14 通过 / 0 失败
- [ ] verify: 实弹 `--scan --repo /Users/wane/SynovaAgent` → 抓出游离代码改动（rc=1）
- [ ] verify: 复现 D794 情形（brief D794 + 分支 feat/d782-*）→ C1 红、rc=1
- [ ] verify: `grep -c check-delivery-discipline scripts/pre-commit-check.sh` ≥ 1（接线在场）

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/task-briefs/2026-09-17-D796-delivery-discipline.md | task |
| memory/notes/proposed/2026-09-17-delivery-discipline-gates.md | task |
| scripts/control-tower/check-delivery-discipline.sh | task |
| scripts/pre-commit-check.sh | task |
| task-state/D796.json | task |
| tests/control-tower/check-delivery-discipline.test.sh | task |
