---
状态: proposed
日期: 2026-09-17
决策: 交付纪律三条（交付必须 commit+PR / 代码只在任务自己的工作区分支改 / 派单必须写 brief 前置与写集机器生成）从「文档规范」升级为**物理门禁** `scripts/control-tower/check-delivery-discipline.sh`（C1 归属 / C2 完工落库 / C3 派单四件套），接入 pre-commit（本地软提示 + CI 硬阻断 SYNO_CI=1），并提供 `--scan` 模式扫工作区游离改动。
理由: 创始人 2026-09-17 三次点名同类问题复发，并明确「不能自律解决」。本仓 V3.9 教训原文：「信息注入型检查对 agent 不可见；硬阻断 100% 有效，软机制 0% 有效」。事实依据：D794 的插件交付以未提交状态躺在他人分支工作区（5 改 + 3 未跟踪，无分支无 PR），且因缺 task brief 被 G12 硬阻断——「文件写好了」被当完工，K3 无法审计、有丢失风险、有 D320 劫持风险。
---

## 三闸判据

- **C1 工作区归属**：变更集含代码路径时，brief 任务号必须与分支任务号一致（**大小写不敏感**：真实分支是小写 `feat/d782-*`）；禁止在 main/master 上改代码 → 红。
- **C2 完工落库**：`task-state/D*.json` 标 `impl_done/audited/done/closed` 时，① `impl` 必须含 PR(#N)/branch 引用 ② brief 必须存在且含机器写集块 ③ 写集路径必须全部被 git 跟踪（写集块解析范围 = 标题到下一个 `## `，不能停在空行）。
- **C3 派单四件套**：staged 派单文档必须含 worktree/分支要求 + brief 前置 + `declare-write-set` + 完工判据=PR。

## 参考

- 反向测试抓出我自己的两个真 bug（分支号提取大小写敏感、写集解析空行截断 → 检查永不生效）——反向验证是「断言是否对目标缺陷敏感」的唯一手段，已固化进测试矩阵。
- 实弹：`--scan --repo /Users/wane/SynovaAgent` 实测报出 26 个游离代码改动（含 D794 那批）；C1 对 D794 的情形精确报警（rc=1）。

## 落点

- `scripts/control-tower/check-delivery-discipline.sh`、`tests/control-tower/check-delivery-discipline.test.sh`、`scripts/pre-commit-check.sh`（附加块）
- 待办：`--scan` 接入每日体检（本地定时），报告游离改动归属与龄期
