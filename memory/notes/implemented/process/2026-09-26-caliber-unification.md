# 口径统一（铁律 47 错号 + 7×25 过时口径 + 引用纪律）

状态: implemented
日期: 2026-09-26

## 一句话

统一了五份入口文档里互相冲突的口径，并禁止再把数量手写进文档。

## 问题

CTO 系统扫描五份入口文档（README / AGENTS / CLAUDE / STATE / architecture），
实测出四类冲突：铁律 47 指两件不同的事；pre-commit 组数 12/13/8/5 四说；
pre-push 门禁 0-5/0-2/0-1/1项 四说；哨兵数写成已废弃的「7 维度 × 25 测量器」。

## 决定

见 `decisions/process/2026-09-26-doc-contract.md`（文档契约）与《口径统一通告 v1》。

本 note 为**指针**：因「铁律 49 / M7 门禁」要求 commit 引用 `memory/notes/**`，
而《文档契约》的方向是把 `memory/notes/` 迁往 `decisions/` ——
本 note 是**过渡期的兼容指针**，契约落地（commit-msg 门禁改认 `decisions/**`）后删除。

## 考虑过的其他方案

① 直接改 commit-msg 门禁认 `decisions/**` —— 否决：那是门禁语义变更，须与契约同批，不能顺手改。
② 不写 note、放弃提交 —— 否决：口径修复要配套通告落地，悬着更糟。

## 后果

- 短期：口径冲突已消除（AGENTS.md / CLAUDE.md 已改）
- 长期：**契约落地时必须同批改 commit-msg 门禁**（「移出」必与「接手」同批）

## 取代

无。（本 note 自身是过渡指针，契约落地后归档）
