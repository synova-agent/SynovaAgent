# D1219 — 门禁判定位置立法（落点已裁）+ 旁路第三态清场

- 状态: proposed（2026-10-07，治理线 line-e-da2）
- 任务: D1219 ｜ 卡: #1225（D-D · 判定位置立法 + 旁路清场）｜ 父卡: #1221（创始人 2026-10-07 批准 v2.0 六方案 §1）
- 载体: `docs/synova/coordination/版本管理规范-控制塔.md` §七（**条文单一真源**）
  ⚠️ 本 Note **不复制条文原文** —— 只记裁决链、代价、处置表与执行体状态（见 §7.2 防双源）。

## 一、载体裁决链（Lead 2026-10-07 裁）

- 卡 #1225 原文要求「写进 CTO-ROLE 治理段」，但 main 上**无此载体**：
  `git ls-tree -r --name-only origin/main | grep -i CTO-ROLE` ⇒ 零命中；
  `docs/synova/CTO-ROLE.md` 仅存在于未合分支 `docs/D1122-cto-deliverables-contract`（已 push origin，无 PR）。
- 裁决 = **Option 1**：落 `docs/synova/coordination/版本管理规范-控制塔.md`（main 已有；pre-commit 自身修复指引
  即引用它；控制塔唯一规范件）。
- **否决 Option 2**（等 D1122 合入再写 CTO-ROLE 治理段）：理由 = 「立法的搬家属 K3 过审」——
  **选错载体的代价 > 选一个存在载体的代价**；不为未合分支的文档把 D-D 文档半延期。
- **代价（已登记进条文 §7.2）**：将来 CTO-ROLE 治理段合入后，**只许引用本文件 §7，禁复制条文**（防双源）。
- 防双源判据 = sentinel `POSITION-LEGISLATION:BEGIN` 在 `docs/` 下**恰 1 次**；
  **判据上界（如实登记）**：只防整块复制，不防逐句改写复制——后者靠 K3/CTO 复核。

## 二、旁路第三态清场（6 处，逐条处置）

**定位口径承接 D1171（PR #1206，已合）**「旁路家族 11 处逐条处置表（3 转 + 8 留）」——
本表 = 其中**剩余未清的 6 行**（11 行中的 #4/#6/#7/#8/#9/#10），**非新增项**。
全量盘点命令（逐条点名，非验收判据）：

```bash
grep -n 'note_check "' scripts/pre-commit-check.sh
# 期望恰好 6 行（:1120 / :1663 / :1675 / :1731 / :1742 / :1781）
```

| # | 位置 | 项 | 处置 | 理由 |
|---|------|----|------|------|
| 1 | `:1120` | plan-integrity non-Q2 项 | **删**（退役） | D1171 自认「plan.json 契约明文 deferred = **设计行为非违规**」⇒ 零判据价值（同 D1148 退役 `opt_check`：0 次阻断 = 纯噪音）。§7.1-2 禁第三态 ⇒ 不能留 `note_check`；改 `v5_soft` 亦无意义（永不判红的项转软仍永不判红）。plan.json 的 Q2 半边已由闸② 消费（`PI_Q2`），无信息损失。 |
| 2 | `:1663` | G12c dev doc 写集验证 (D313 M3b) | **删本地**（CI 已覆盖） | 卡 #1225 明令。同判据在 CI 有**更强**执行点：`Merge write-set reconciliation (D708)`（`.github/workflows/ci.yml:197`，独立 step）。双计数只制造重复阻断，且 D708 口径更准。 |
| 3 | `:1675` | G12d 声称↔证据对照表 (U4/D423) | **归档**（移出提交路径） | 卡 #1225 明令。该产物供 **K3 审计消费**、**无机器可判阈值** ⇒ 本质是报告生成器而非门禁；留提交路径 = 每次提交付生成成本换零阻断力。改为独立归档脚本按需产出。 |
| 4 | `:1731` | D782 D1 文档真相（脚本缺失 fallback） | **改自身失败态**（同样阻断） | 三态纪律：0=通过／1=违规／2=检查自身失败。原 fallback 把「D1 脚本不存在」降级为不阻断 ⇒ **检查消失被判作通过**（假绿）。D1171 留它的理由「CI 完整 checkout 不命中」对**本地**不成立。 |
| 5 | `:1742` | D782 D2 登记门禁（脚本缺失 fallback） | **改自身失败态** | 同上；后果更重：D2 是「新增 .md/.yaml 必须登记」的提交端唯一执行点，缺失即未登记件全放行。 |
| 6 | `:1781` | D734 PR 预算（脚本缺失 fallback） | **改自身失败态** | 同上（存在性另有 `check-pr-budget.test.sh`，但那不能替代运行期 fail-closed）。 |

**「自身失败态」实现口径（禁 `|| true` 吞崩溃）**：① 计 `HARD_FAIL`（本地与 CI 同等阻断；
本地唯一软提示面是 `v5_soft`，自身失败态**不适用**软提示）② 打印「检查自身失败（脚本缺失）」以与
「违规」区分 ③ 按铁律 11 写 `degraded-events.log`（`component=pre-commit-<闸名>`, `reason=script-missing`）。
即：**两种红都阻断，报告里可区分**。

**清场完成判据（结构盘点，非验收）**：

```bash
grep -c 'bypass_run "' scripts/pre-commit-check.sh   # 期望 0（定义块/留痕注释保留）
# 「第三态清零」= **静态调用点**清零（不是字样清零——bypass_run 休眠函数体内含 note_check，见 §四 口径更正）
grep -vE '^[[:space:]]*#' scripts/pre-commit-check.sh | grep -c 'note_check "'   # 期望 1（仅休眠函数体）
grep -c 'self_fail_missing_script' scripts/pre-commit-check.sh                   # 期望 4（1 定义 + 3 调用）
```

## 三、序列与落地（2026-10-07 更新）

本文档半**先**交付；代码半随后**同分支第二个 commit**（stacked PR，base = 文档半分支）。

- 阻塞件历史：PR #1272（线 B GATEKEEPER 段，**13:33:20Z 已合**）；PR #1275（组 6 改接 claim）**当时仍 OPEN**。
- 代码半 6 处锚点全部位于 `scripts/pre-commit-check.sh` 的 **:1136 / :1679 / :1691 / :1747 / :1758 / :1797**（rebase 后行号），
  与 #1275 的唯一 hunk（`@@ -987,9 +987,31 @@`，组 6 块）**不重叠** ⇒ 合并序安全，无需保留双方意图的冲突处理。
- 卡 #1225 保持 OPEN，直至 K3/CTO 裁 + 合并。

## 四、执行体状态

- §7.1-2（禁第三态）：**✅ 执行体已落地**（代码半同 PR）——
  3 处第三态清场（plan-integrity non-Q2 删 / G12c 删本地 / G12d 归档）+ 三处「脚本缺失 fallback」
  改「检查自身失败态」（单一实现 `self_fail_missing_script()`，本地与 CI 同等阻断）。
- §7.2（防双源）：**未接线** —— 结构性判据为手工可复跑命令，未接入 CI。
  未接线原因（如实）：新增 CI 测试须登记于 `.github/workflows/ci.yml`（**线 B 所有，本线禁碰**）。
- §7.1-3（搬家＝判据变更）：**现行**（K3 送审 + CTO 裁决的人判流程）。

**判据口径更正（原稿写错，此处修正）**：§二 的 `grep -n 'note_check "'` **不可能到 0** ——
`bypass_run` **休眠函数体**（`:190`）内含 `note_check "${_bn} (exit=${_brc})"`，且该函数是立法 §7.1-2
明示保留的回滚路径。⇒ 正确口径为：
```bash
grep -vE '^[[:space:]]*#' scripts/pre-commit-check.sh | grep -c 'note_check "'   # 期望 1（仅休眠函数体）
```
「第三态清零」的判据是**静态调用点**清零（3 处命名调用点消失），不是**字样**清零。

**夹具（本 PR 已改用真夹具，不再是声明式偏离）**：`hard-gate-convergence.test.sh` 的 `KEEP_BYPASS`
反转为反向断言 + 自身失败态 4 断言（红 52/11 → 绿 63/0）；`doc-commit-exempt.test.sh` T11a/T11b/T11c
（T11c 把「替代真实存在」做成物理断言：grep `ci.yml` 的 D708 step）。三条变异体实测见 PR 正文。

## 五、退出条件

- 若 K3/CTO 否决任一处置（如认为 D782 D1/D2 脚本缺失应保持不阻断）⇒ 对应行回滚为 `note_check`，
  并在本表标注否决人与日期。
- 若 §7.2 防双源条文被裁为「仅软约定」⇒ 该判据失去机器可判性，须同步登记为**无执行体条文**。
- 代码半落地后：本 Note `git mv` 至 `implemented/`（铁律 49 四态），并同步 §7.4 执行体状态表。
