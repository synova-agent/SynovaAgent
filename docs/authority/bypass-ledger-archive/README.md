# bypass-ledger-archive — 冻结归档（D970 / D735 Stage 2）

## 这是什么

`.claude/bypass.log` 在**出库前**的逐字节副本（**冻结**，不再追加）。

## 为什么冻结

D735 **Stage 2**（执行卡 D970）把 bypass 证据账本移出 git 跟踪：

- 根因：每次提交都向**同一个被跟踪文件**追加证据 ⇒ 每个分支必带该文件变更；而 GitHub 服务端**不认**
  `.gitattributes` 的 `merge=union`（本地 git 认）。实测：5 条 dirty PR 在 union 在场时
  `git merge-tree --write-tree origin/main <head>` 全 `rc=0`，移除该属性行后全 `rc=1`，冲突文件**全部且仅**
  `.claude/bypass.log`。
- 出库后：新证据只落 `.sessions/<sid>/bypass.log`（`.gitignore` 已忽略 → 零 git status 变更）。

## 证据链

本目录是「其他 clone 仍能读到此前的历史证据」的载体：`scripts/control-tower/bypass-ledger.sh sources`
已把本目录 `*.txt` 纳入对账读面（`check-bypass-log.sh` 经它取来源）。

| 项 | 值 |
|---|---|
| 源文件 | `.claude/bypass.log`（出库前工作区，与 `057d8ca0` 的 HEAD 版本逐字节一致） |
| 冻结时点 | 2026-09-25 |
| 行数 | 1802 |
| 字节数 | 231530 |
| cksum | `833849360 231530`（源与归档实测一致） |
| 归档文件 | `bypass-ledger-frozen-2026-09-25.txt` |

## 纪律

1. **不得追加或编辑**本目录已有文件 —— 冻结即不可变（要读新证据请读 `.sessions/`）。
   - 实测注记（2026-09-25）：把 main 合入 D970 分支时，main 对旧账本的**后续新增行**会被 git 当作「rename + modify」自动并入本文件（合并实测：归档一度变成 1803 行 / cksum `106207670`）。已按本条纪律**还原为冻结快照**（1802 行 / cksum `833849360 231530`）——那 1 行属**冻结之后**的证据，不属于本快照；它仍可从 `.claude/bypass.log`（若本机保留）与 `.sessions/` 读到。
2. 需要新的快照时用**新的日期文件名**：`bypass-ledger-frozen-YYYY-MM-DD.txt`（`sources` 按 `*.txt` 全收）。
3. **已知缺口（显式登记，不美化）**：冻结之后，他机/他工作区产生的登记只落在其**本机** `.sessions/`（git 忽略、不随仓走）
   ⇒ 合并他机分支后再推送时 D331 仍可能判「缺记录」并拒推，需沿用既有的一次性补记（D451）。
   该缺口在出库**之前就存在**（台账 2026-09-23 ② / 2026-09-25 ②）；本方案**不使其恶化**，但**也不解决它**。
