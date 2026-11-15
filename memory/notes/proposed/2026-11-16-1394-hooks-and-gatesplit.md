---
状态: proposed
日期: 2026-11-16
决策: post-commit 外部审计默认关闭，并同步审计协议与两平台门禁分工口径
理由: 默认 hook 会把无 D 号提交写成 Dunknown.md，且活性协议仍把审计报告文件当成交付物；GATE-SPLIT 仍复制已退役的 required baseline。
---

## 现状

`post-commit.sh` 无条件执行任务审计与 dispatch；安装说明和 `AUDIT-PROTOCOL.md` 仍要求自动审计及报告文件。`.github/GATE-SPLIT.md` §四仍列旧 GitHub required 清单并引用退役 baseline。`synova-commit` 仍保留两处 `external-auditor.sh` 实调用，因此审计器并非无消费者。

## 决定

仅当 `SYNO_AUDIT_HOOK=1` 时由 post-commit 调用外部审计器，默认提交不生成报告文件；保留显式启用路径和配对回归。同步安装说明与审计协议为按需触发、结论写任务卡／Issue／PR 评论。GATE-SPLIT §四改为 Gitea core-gates 是唯一工程质量权威、GitHub 是集成测试面，GitHub required 以 #1396 执行后的平台实物为准。审计器不列入 #1379 退役候选，不物理删除。

## 依据

- Gitea Issue #1394、#1400 及用户给出的本批执行边界。
- 根 `AGENTS.md` §8 与 `.synova/skills/synova-audit/SKILL.md` 的现行审计口径。
- `scripts/control-tower/synova-commit` 两处现存调用证明退役候选条件不成立。
- 配对测试旧实现 `36 通过, 2 失败`，修改后 `38 通过, 0 失败`。

## 生效时点

本 Note 随 #1394／#1400 同 PR 留痕；PR 合并后生效，不自行合并。独立复核与 CI 结论以 PR 实物为准。
