# #980 post-merge-gate.sh —— A′ 的替代兜底（裁 397）

## 背景
K3 审计（#974 风险 1）实证：A′ 的"main CI 兜底"是假兜底。
合到 `local-main` 后 CI 的 ③ 步以 `origin/local-main` 为基线 ⇒ HEAD 即基线 ⇒ 变更集 0 文件 ⇒ `vitest --changed` 合法跳过。
未接 CI 的门禁（obligations／tool-args／doc-registry…）**永不跑**。实证：`8a910555b` 红 19m40s 而 status=success。

## 本件做什么
`post-merge-gate.sh [<sha>]`：合并后立刻跑**未接 CI 的门禁清单**（硬编码 6 项），
任一 rc=1 ⇒ exit 1 并打印 `建议 revert <sha>`；任一门禁自身失败 ⇒ exit 2；全过 ⇒ 0。

## 判据两态
- `--selfcheck`：红夹具 ⇒ `FAIL` + rc=1；绿夹具 ⇒ `PASS` + rc=0（**红/绿各一端**）；
- 真跑（main tip `27e3433f1`）：6 项全 PASS，`POST-MERGE-GATE: OK` rc=0。

## 已知限制
1. 清单**硬编码**：新增未接 CI 的门禁必须手动加，否则漏检（这是本件的最大风险）；
2. 只跑"静态/单元级"门禁，不跑全量 vitest（太慢）；
3. 它**不阻断合并**（合并后才跑）——目的是"当天能发现并 revert"，不是事前拦截。
