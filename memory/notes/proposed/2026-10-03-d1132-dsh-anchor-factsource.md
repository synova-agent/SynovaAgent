# D1132 · DSH 断面事实源：照实记录树实况 + 失败自证候选（**未移树**）

- **状态**: proposed
- **日期**: 2026-10-03
- **决策**: 把 `DSH-断面.json` 的 `current`（含绝对路径）**照实**改为实际在用树 `0.2.0-rc.1 @ 4878cdabd8 @ /Users/wane/src/deepseek-harness-020`，并在树解析失败时增打「已探测候选」清单（**纯诊断**）；**不移动 DSH 树**。
- **理由**: `check-dsh-anchor.py:79` 的树路径取自该事实源（`:7`），而原值 `…-017` 本机**已不存在** ⇒ `:80-82` 判 `DEGRADED` ⇒ **收件闸 §〇 变得不可判**（不是哪条 CI 变红，是该人工判据失效）。修法不是"再改对一次路径"，而是让失败**自证找过哪些候选**，把"人肉发现"降为"读输出即可定位"。
- 相关 D#: D1132

## 三项登记（队长 2026-10-03 授权 +1 文件；**均登记不修**）

1. **rc.1 / rc.2 分歧（未决，已上报 CTO）**：工作树 HEAD = `4878cdabd8` = **`dsh-v0.2.0-rc.1`**（package.json `0.2.0-rc.1`）；而 tag `dsh-v0.2.0-rc.2` = `639ed01539`，是 HEAD 的**后代**（HEAD 是其祖先），即"已打 tag 但工作树未 checkout 到它"。派单前提"现行 = rc.2"与树实况不符 ⇒ **本卡只记录树实况，未移动树**（移动全公司运行时那棵树不是治理卡能做的，归 CTO/创始人）。
   附带证伪：派单件所称"实际 checkout 在 `/Applications/…/app.asar/dsh/`"**不成立** —— `app.asar` 是 121MB **归档文件**；`app.asar.unpacked/dsh` 只有 `node_modules`、**非 git 仓库**。
2. **候选探测是纯诊断**：读事实源 `discovery.path_candidates` / `glob_candidates`，逐个报 存在性/是否 git/short HEAD/与声明 head 是否一致；**不参与判定、不新增任何 OK 路径**。反例已固化为夹具 T14：`--tree` 指向不存在目录 ⇒ **仍 `DEGRADED` rc=2**（不假绿）；`--no-tree-check` 回归 T10 仍 OK。
3. **`:116` 硬编码豁免 = 下一处漂移点**：`sh_ not in ("46a7f68b",)` 原为"当时 current 的 head"写死；`46a7f68b` 现已被 superseded，**靠这条硬编码**才没让 232 份文档里对 `0.1.7-rc.1@46a7f68b` 的引用变成 `VIOLATION`（实测 `--no-tree-check` 仍 OK）。登记不修。

## 后果（长期承担）

- `current.path` 是**本机私有绝对路径** ⇒ 换机/移树必 `DEGRADED`（已在事实源 `policy.path_is_machine_local` 写明"设计如此"，非假红）；CI 与 pre-commit 一律 `--no-tree-check`（只查文档面），带树校验只在本机由 §〇 / 派单模板 / `daily-cto-board.sh` 承担。
- 候选探测**只帮定位、不自动采纳**：是否"命中即自动更新事实源"属**判据变更**，需另裁。
- 本卡**新增夹具文件 0 个**（T13–T15 加在已登记的 `check-dsh-anchor.test.sh` 内）⇒ 未触碰密封面棘轮；净新增门禁条目 0，仅登记。

## 相关

- 事实源：`docs/synova/coordination/DSH-断面.json`｜门禁：`scripts/control-tower/check-dsh-anchor.py`
- 上游决策件：`memory/notes/proposed/2026-09-24-dsh-anchor-gate.md`（D943 建立本事实源 + 三态语义）
- **取代**: 无（本件是其维护/修复，不改三态判定语义）
