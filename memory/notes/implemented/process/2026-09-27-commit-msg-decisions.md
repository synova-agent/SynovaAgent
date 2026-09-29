# commit-msg 门禁扩 `decisions/**`（契约 §9 的同批接手）

状态: implemented
日期: 2026-09-27

## 一句话

把「决策必须沉淀」的 commit-msg 门禁，从 `memory/notes/**` 扩到同时接受 `decisions/**`。

## 问题

《文档契约》§7 要把 `memory/notes/` 迁往 `decisions/`，而铁律 49/M7 的 commit-msg 门禁
只认 `memory/notes/**` ⇒ **按契约做事反而被拦**。§9 定的过渡规则要求"契约生效时同批扩展"。

## 决定

`scripts/commit-msg-check.sh`：引用检查从 `memory/notes/` 扩到 `memory/notes/|decisions/`，
Note 路径正则同步扩到 `(memory/notes|decisions)/…`。**两者皆可**（过渡期）。

## 考虑过的其他方案

① 直接改成只认 `decisions/**` —— 否决：会立刻拦掉所有存量 `memory/notes` 提交。
② 不加此条、只靠指针式 note —— 否决：契约 §7 的迁移就永远启动不了。

## 后果

- 契约 §9「移出必与接手同批」的**第一次真实落地**
- 本 PR 是 K3 R4 的**合并条件 P1-A**（它实测该改动未落地）

## 取代

无。（本 note 是 `memory/notes` 侧的兼容引用，迁移完成后归档）
