# D1161 · 密封清单登记 `loop-context.test.sh`（main 存量红 · Gate Integrity 恒红）

- **状态**: proposed（Lead 已裁 (a)：立即开极小独立支，优先合）
- **日期**: 2026-10-06
- **背景**: PR #1131 CI run `37343075668` 的 `Gate Integrity` 红，经三步取证证明**与本 PR 改动无关**，是 **main 存量红**：
  `tests/control-tower/loop-context.test.sh` 存在于 `origin/main`（谱系 = `#818 fix/fix007-loop-context-breaker`，
  随今日一批合并进入 main），但**未登记进 `ci.yml` 密封清单** ⇒ `check-gate-integrity.sh` 的密封面 ratchet 判
  `基线外新增 1` ⇒ `GATE-INTEGRITY: VIOLATION(1)` ⇒ **每个 PR 的 Gate Integrity（必需 context）恒红 ⇒ 谁都不能合**。
- **决定**:
  1. 在 `ci.yml` **两处逐字同源密封清单**各追加 1 行 `tests/control-tower/loop-context.test.sh \`（**纯 append**，`numstat = 2 0`）。
     **不动任何 job `name:` / job 结构 / 判据**。
  2. **不进 `gate-integrity-baseline.txt`**：基线是**存量豁免台账**；新件进来的正解是**登记**（棘轮的语义就是"新增必须登记"），
     进基线 = 把新问题伪装成历史债。
  3. 不改 `tests/control-tower/loop-context.test.sh` 本体（FIX-007 线产物；本卡只登记）。
- **考虑过的其他方案**:
  - **进基线文件**：不选，理由见 2（且 Lead/CTO 口径：驳回的是"写集豁免"，不是"不许登记"）。
  - **不动它、等 FIX-007 线自己修**：不选 —— 该红**阻塞所有人**（必需 context），属"必须马上治"类，不是常规排队项。
  - **并入 #1132**：不选 —— 会把"顺序检查新件"变成混合件，K3 复核面变大；独立极小支边界最清。
- **影响**: 解除 main 级阻塞（所有 PR 的 Gate Integrity 由恒红转可绿）；被登记测试自身实跑 `11 通过 / 0 失败`，
  进 canary 后不会把 canary 拖红。
- **回滚**: 单 `git revert`（2 行删除；退回 main 存量红态）。
- **例外（自开卡条件④不满足，已知并标注）**: `ci.yml` 有在飞写集（#1079 / #919 / #900 / #899）⇒ 「不与在飞 PR 写集重叠」不满足；
  Lead 裁"必须马上治 + 修法纯 append 且区域不同 + CTO 已裁 `ci.yml` 按正常 merge 解"⇒ 按最保守解释执行，Lead 上报 CTO。
- **相关**: D1093/D526（密封清单必须在 ci.yml 全文内）；D1039（占位登记）；D1147（同棘轮判红时处置 = 登记）；
  `check-gate-integrity.sh` [R] 段（密封面棘轮）；PR #1131（发现该红的现场）。
