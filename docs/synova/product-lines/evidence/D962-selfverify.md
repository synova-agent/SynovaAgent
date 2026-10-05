# D962 自验记录（task-3 / d962-verifier）

> 独立自验员产出。只读源码核对 `.synova-wt-d962a/docs/synova/coordination/D962-disposition-table.md`（分支 docs/d962-disposition @ 04f79d7c，基于 main @ 6a714483）。唯一可写 = 本文件。
> 结论口径：仅"自验结论"，不构成"审计通过"判定。

## 〇、核对方法

- 独立基线：开工前先于 A 表完成 `grep -nE '^\s*(hard_check|soft_check) "'`（38 处，含 L99/L101 函数包装 2 处 → 实际调用点 36）。
- 表口径补齐后重放：`decl_check "`(含 def 97) / `warn_check "`(171) / `opt_check "`(159) / `v5_soft "`(127) 共 13 处 + 内联 SOG 块 + GATEKEEPER 前置 + par_collect 纯报告。
- 62 个被引行号逐一 `sed -n 'Np'` 回放比对（证据见下）。

## 一、逐条核对项 → 结论

| # | 核对项 | 方法/证据 | 结论 |
|---|---|---|---|
| 1 | 脚本基线 1529 行、main@6a714483 | `wc -l` = 1529；`git rev-parse` = 6a714483 | 一致 |
| 2 | 表行数 50 | `grep -cE '^\| [0-9]+ \|'` = 50 | 一致 |
| 3 | 行号回溯（抽查 62 处，超 10 项要求） | L493=hard as any / L499=hard from损伤 / L514=soft 硬编码 / L517=par_collect deprecated / L551、L556=组2 catch / L583、L610、L611、L617-625=组2-CT三态 / L640=secrets / L677、L697=接线 / L728=架构边界 / L767=桥接 / L779=warn_check 铁律47 / L843=主树占用 / L894-895=decl_check brief / L906、L916=组6 / L921-933=Notes / L936、L939、L942=v5_soft / L945-961=SOG内联×3 / L972=opt_check PRD / L992、L995-1000=组7 / L1016-1023=失败审计 / L1029-1055=绕过7c / L1070=数据流 / L1088-1089=v5_soft×2 / L1117=契约 / L1156、L1179=warn G10/G11 / L1323、L1345、L1353、L1362、L1371-1379=组12 / L1394-1396=组13 / L239-257=GATEKEEPER / L1416-1446=D1/D2 / L1462-1474=D734 / L1479-1492=V5平台 | 62/62 全部命中，行号与描述一致 |
| 4 | 去向 7 枚举约束 | 表实际使用 6 个值：保留-CI / 保留-脚本 / 合并 / 降为旁路看板指标 / 退役 / 暂不动 | **问题（轻）**：卡口径为 7 枚举，表用 6 个。若第 7 枚举（如"lint 化"）确在卡内，未出现属合理（阶段 2 决策）；需 CTO 确认枚举清单口径 |
| 5 | 退役项必有防护去向 | #2（CI quality tsc 承接）、#26/#27/#28（实测零引用 + #15 类别承接）4 项均有 | 一致 |
| 6 | 合并项必有新名+全类别 | #14 合并到 check-architecture.sh，给全类别（L1→L4/L5、L2→L5、L3→engine-core） | 一致 |
| 7 | 无"很久没触发"类退役理由 | `grep 很久没触发\|长期未触发\|没再触发` = 0 命中；退役理由均为实测恒空转（附命令） | 一致 |
| 8 | 退役前提实测复现 | `grep -rn "SOGNodeType\.\|SOGEdgeType\.\|@synova/sog-core" src/ --include="*.ts"` → 恰 1 处 `src/mvp-server.ts:13`（注释），与表声称逐字一致 | 一致 |
| 9 | P0 三件保留 | ci.yml:102 `merge_writeset_gate.py`、测试 ci.yml:256 / 267 `check-dsh-anchor.test.sh` / 268 `check-k3-report.test.sh` 均实测存在，表§保留边界声明全部保留 | 一致（注：三件不在 50 行表内——表已声明它们是 CI/pre-push 侧门禁非 pre-commit 项，口径成立） |
| 10 | 事故回归集在保留/合并列 | #1(铁律38)、#15/#16(engine-core)、#7/#12(接线)、#11(Secrets)、#41(生成物)、#17(M8)、#40(D296/D749) 全部保留列 | 一致 |
| 11 | 统计与表逐行一致 | 机器重算：保留-CI 33、保留-脚本 3、合并 1、旁路 4、退役 4、暂不动 5，合计 50；与表§三逐项相等 | 一致 |
| 12 | ci.yml 9 job | 我实测 `grep -E '^  [a-zA-Z0-9_-]+:'` = 11 行，但含 `push:`/`pull_request:` 触发键 2 行 → job 实为 9（quality/test/architecture/test-kit-architecture/control-tower-tests/integration-check/checker-review/audit/golden-case） | 一致 |
| 13 | tests/control-tower 124 文件 | `ls \| wc -l` = 124 | 一致 |
| 14 | 表内引用的测试文件真实存在 | 逐一 ls：ct-test-gate / check-secrets / secrets-env-exempt / parallel-main-tree-occupancy / skeleton-brief-gate / check-notes-lifecycle / notes-four-state / g12-day-window / g12-taskstate-exempt / write-set-check / generated-gate / brief_parse(r)(able)(-strip) / check-dev-doc-write-set / verify-claims-table / sync-dsh-skills / tag-bypass-wiring / check-bypass-log / bypass-ledger / bypass-union-merge / platform-checklist / check-pr-budget / task-start / doc-commit-exempt / founder-truth 全部存在；"无/无专项"标注 32 行 + 有测试 18 组 = 50 | 一致 |
| 15 | 8 列齐全 | 第 5 列（DSH 做法）50 行全部为"待B合入"占位 | **问题（已声明）**：B 的映射未合入，表头与 §五待办已如实声明；阶段 1 口径下不算隐瞒，但合入前不满足"8 列齐全"终态 |

## 二、问题清单（2 项，均不阻断阶段 1）

1. **第 5 列占位**（表已声明）：DSH 映射待 task-2 产出合入后 8 列才齐。task-2 交付物 `docs/synova/coordination/D962-dsh-mapping.md` 已在 `.synova-wt-d962b`（分支 chore/d962-dsh-mapping @ 4d8680b1）产出，**但该分支未推送远端**（`git ls-remote --heads origin | grep d962` 仅命中 `docs/d962-disposition`）——违反"交付附 ls-remote 回执"纪律，且两份交付物均未在 main 可读，自验是在编码者工作树中读取的。
2. **枚举数口径**：卡称 7 枚举、表用 6 值。请 CTO 确认枚举清单后定夺（若第 7 值为"lint 化"且阶段 2 才启用，则现状合理）。

## 三、自验结论

- 62 处行号回溯全部一致；50 行、统计、退役防护、合并要素、P0 三件、事故回归集、环境数字（ci.yml 9 job / 124 测试文件 / SOG 零引用）**全部独立复核通过**。
- **自验结论：可提请独立审计（附 2 项问题：第 5 列待 B 合入 + 枚举 7 vs 6 口径待 CTO 确认；另 chore/d962-dsh-mapping 未推送远端，需补 push 回执）。**

— d962-verifier，2026-09-25，只读源码 + 唯一写入本文件

---

# 第二轮自验（终稿 c7fdb840：第 5 列已合入 B 映射）

> 队长追加指令：重点⑥ 第 5 列与 B 表逐项一致性抽核 + §六 B↔50 编号对照链闭合性。
> 核对对象：`.synova-wt-d962a/docs/synova/coordination/D962-disposition-table.md` @ c7fdb840（`docs/d962-disposition`）；B 表 = `.synova-wt-d962b/docs/synova/coordination/D962-dsh-mapping.md` @ 4d8680b1。第一轮 15 项核对全部继续有效（行号/统计/P0/退役防护等未变，仅第 5 列由占位替换为 B 内容）。

## 四、重点⑥：第 5 列 ↔ B 表一致性

### 6.1 编号对照链（B 34 条目 → A 50 行）逐条核对

B 表 34 条目与 A §六对照链**逐条一致**（31 条链全部对上）：
B#1→A#1、B#2→A#2、B#3→A#3、B#4→A#5、B#5→A#6、B#6→A#7、B#7→A#8、B#8→A#9、B#9-10→A#10、B#11→A#11、B#12→A#12、B#13→A#13、B#14→A#14、B#15→A#15、B#16→A#17、B#17→A#20、B#18→A#21、B#19→A#30、B#20→A#34、B#21→A#36、B#22→A#37、B#23→A#38、B#24→A#39、B#25→A#41、B#26→A#43、B#27→A#44、B#28→A#47、B#29→A#48、B#30-31→A#45、B#32-33→A#49、B#34→A#50。
（合并计数：B#9-10→1 行、B#30-31→1 行、B#32-33→1 行，故 34 条目覆盖 **31 个 A 行**。）

### 6.2 第 5 列内容抽核（22/34 条目抽中，依据逐字比对 B 表）

A#1/5/7/11/12/14/17/20/21/30/34/36/37/41/43/45/47/48/49/50/3/13 的第 5 列文字与依据（file:line）均与 B 表对应条目一致，无改写失真。"B 表未列" 19 行的归因（agent 治理/meta/本地网守类 → B §二"合理差异"结论）与 B §二口径一致。

### 6.3 DSH 侧 file:line 抽真（防 B 表依据虚标）

实测 /Users/wane/src/deepseek-harness-017/：ci.yml:700 `all-checks-passed` ✔、ci.yml:503 `windows-build` ✔、ci-master.yml:227 `serial-windows` ✔、package.json:89 `check:windows-wine` ✔、package.json:95-96 `doc-typecheck` ✔、.oxlintrc.json:51 `no-unused-vars` / :50 `no-unused-expressions` / :60 `no-restricted-properties` ✔、run-gates.ts:671 `coverageGates()` ✔、workflows 20 个 ✔、lefthook third-party notices 注释 ✔。**4 处轻微行号/版本漂移**（见问题 ③）。

## 五、第二轮问题清单（新增 2 项，合计 3 项待处理）

**③ §六计数口径错误（数字不自洽）**：A §六称"B 34 条目共覆盖本表 34 项、未覆盖 16 项"，实测按 A 行计为 **31 行覆盖 / 19 行未覆盖**（34 是 B 条目数不是 A 行数；且 A 自己列举的未覆盖清单实际枚举了 19 个编号：#4,16,18,19,22,23,24,25,26,27,28,29,31,32,33,35,40,42,46）。31+19=50 物理闭合、枚举本身完整正确，**仅两个声称数字（34/16）写错**，违反"数字必须来自命令原始输出"。修法：§六改为"覆盖 31 项 / 未覆盖 19 项"。
**④ B 表 DSH 依据 4 处轻微漂移**（不改变结论，均真实存在但引用偏差）：`typeAware` 实际在 .oxlintrc.json:9（A/B 均写 :11）；`dsh-package-licenses` 实际在 run-gates.ts:348（A#11/B#11 写 :350，:350 是 package-meta）；sonarjs 实际 `^4.1.0`（B §1.5 写 ^4.1.1）；A#1 引 lefthook.yml:60-62 中 :60 实为注释行（typecheck job 起始约 :61-63，±1-2 行）。建议 A/B 各修一处行号，属低危。
**（沿用）① 枚举口径**：卡 7 枚举 vs 表 6 值，待 CTO 确认（第一轮问题 2）。第一轮问题 1（第 5 列占位）**已解决**。

## 六、第二轮自验结论

- 对照链 31 条全部闭合、第 5 列内容与 B 表无失真、DSH 依据抽真全部真实存在（仅 4 处行号级漂移）、未覆盖 19 行枚举完整且归因有据。
- **自验结论：修一处 §六计数（34/16→31/19，属文字勘误，不影响任何去向裁决）后，可提请独立审计。** 遗留：枚举 7 vs 6 口径待 CTO 确认；chore/d962-dsh-mapping 仍未推送远端（第一轮已报，未见补推）。

— d962-verifier 第二轮，2026-09-25
