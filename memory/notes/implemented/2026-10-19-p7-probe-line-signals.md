---
状态: implemented
日期: 2026-10-19（第 2 轮 · v4.2 口径（H 子例／--line 退出码／exceptions.lines 三口径入册））
决策: 「回执三信号」由人算改为按 handbook《常设授权条例》§五 的 5 条**报告线**（路径切 R1–R5）机器算；**② 只装「没做到」（NOT-DONE，跨线按所涉每线各计 1，与 ③ 同口径）**，逐项降级（不可判）进 `gaps` 不可判栏且**不计 ②**；**① 分母＝该线全部已归属在飞 PR（含降级，fail-closed）**；`--line` 末尾 `gaps(global)=<n>`；`--selfcheck` 8 子例（A–H，新增 H）。
理由: 包写集天然重叠（规格 §〇pre ⑤ 实测：`docs/**`∈P6/P7/P9/P10、`scripts/control-tower/**`∈P4/P7/P9）⇒ 按包归线会把多数 open PR 打成 ambiguous；且第 2 轮收件闸实测出旧口径漏掉「没做到」（治理线 ①=0/20 而 ②=0）＋把降级当例外 ⇒ v4.1 把「没做到」（②）与「看不见」（gaps）分栏、末行计数 == 明细条数，使隐藏失败必须现形。
---

# #602 P7-2 交付：回执三信号探针（`probe-line-signals.ts` · 第 2 轮 v4.1）

## 现状（改之前）

- **无按线三信号件**：`git grep -l "回执三信号" <base> -- scripts/` ⇒ `0`（规格 §3 F1）；四条件机器判定已有 `scripts/control-tower/check-merge-conditions.sh`（只读复用），缺「按报告线聚合三信号」的编排层。
- **旧线口径（v3.2 / 规格 v1）为何错**：线＝包 P1–P10，而包写集互相重叠（`docs/**`∈P6/P7/P9/P10、`memory/notes/**`∈P6/P7、`.gitea/**`∈P4/P10、`scripts/control-tower/**`∈P4/P7/P9）⇒ 同一 PR 天然挂多包，归线结果大量 ambiguous，不可核。
- **第 2 轮退回根因（L1 收件闸；T1 卡面退回根因原文，R1 件真实数据实测）**：`治理线 ①(merge-conditions)=0/20 ②=0` —— 20 个在飞 PR **全部未通过**却报 **0 例外** ⇒「没做到」被藏；同时旧口径把**逐项降级（不可判）当例外**混进 `exceptions`（把「看不见」算成「没做到」）。v4.1 据此改语义：**② 只装未通过，降级改入 gaps**。
- **B 口径不重做**：健康三信号（绕过/拒绝/M 复发）已由 `scripts/control-tower/gen-cto-health.py` 在算 ⇒ 本批只做 A 口径（回执三信号）。

## 决定

- **W1 `scripts/control-tower/probe-line-signals.ts`**（只读探针）：`--all` 每线一行三信号 ＋ 末行 `LINE-SIGNALS: lines=<L> exceptions=<n> gaps=<n>`；`--line <报告线>` 单线视图 ＋ 末行 `gaps(global)=<n>`；`--json` 固定 DS-8 七键（`tool/lines/exceptions/gaps/mapping/summary/exit`）；`--selfcheck` **8 子例 A–H**；三态 `0/1/2`，根级失败 `degraded:` ＋ `SYNO_GATE_DEGRADED_LOG`。
- **v4.1 三信号语义（本轮修正，冻结契约＝task-1）**：
  - **①** 分母＝该线**全部已归属在飞 PR（含不可判/降级）**，分子＝四条件全 ok 的 PR 数；0 已归属 PR ⇒ `n/a(0)`（基座线仍 `n/a(未映射)`）；该线 PR 全不可判 ⇒ `0/<n>`（n≥1，fail-closed）。
  - **②** ＝该线 `exception: PR#<n> <线> NOT-DONE NO: <ci|overlap|review|serial 逗号分隔>` 明细条数（**只装「没做到」**；跨线 PR 在所涉每条线各 1 条，与 ③ 同口径）。
  - **逐项降级/不可判**（四条件含 degraded/skip、conditions 缺失、文件取不到）⇒ `gaps[]` 的 `kind:'unjudgeable'`（文本 `gap: PR#<n> 不可判 <code>`），**不计 ②**；文件已归线者**仍进 ③ 与 ① 分母**，文件取不到者只进 gaps、不进任何线计数。
  - **判据守卫**：`E_GUARD_S2_DEGRADED`（`kind:'unjudgeable'` 的 PR 不得出现在 exceptions）／`E_GUARD_S2_COUNT`（s2 == NOT-DONE 明细数）；① 复算沿用 `E_GUARD_S1`（分母改「已归属 PR」）。
- **线映射＝规格 §4bis R1–R5**（最长前缀优先＋显式排除，同一文件只归一条线）；跨线计入所涉每线 ③ 并标 `(跨线 c)`，同时 `gap: PR#<n> cross <线1>,<线2>` 点名；全 unknown／混合未归属逐项进 gaps（DS-2 计数==明细）。
- **W2 `tests/control-tower/probe-line-signals.test.sh`**（CT-40 配对）：8 判定点 A–H（H 新增：2 未通过 ＋ 1 不可判 ⇒ ①=0/3 ②=2 ③=3、`gap: PR#623 不可判 E_COND_DEGRADED`、末行 exceptions=2 gaps=1、exit 1）＋三态＋DS-8 键集＋文本/JSON 同口径＋只读证明＋改坏必红（外部覆盖缝 `SYNO_LINE_SIGNALS_TOOL` ＋件内突变自证）；零网络（`SYNO_LINE_SIGNALS_FIXTURE` ＋ degraded log 落 mktemp）。
- **不做什么**：不改 `check-merge-conditions.sh`／`gen-cto-health.py`／`probe-ladder.ts`／`emit-signal.py`／`.gitea/**`／`scripts/audit/**`；不接 CI；不写人读进度文档。

## 依据

- 创始人 2026-10-19「回执 A」口径裁定；**B-7-a**（线＝报告线；`tests/control-tower/**`·`tests/architecture/**`·`.gitea/**`→治理线）／**B-7-b**（W2 写集扩 1 行）／**B-7-c**（①＝四条件通过率、③ 卡数 v1 不出）三条裁定（记于 Issue #602）；**L1 收件闸第 2 轮退回裁决**（② 只装没做到／降级进 gaps／① 分母含降级），冻结契约为 task-1 正文。
- 规格真源（唯一）：handbook `派单件/2026-10-19-P7-602-三信号探针-规格.md` **@ `94133bfa7`（v4.1）**；卡面 `.claude/task-briefs/2026-10-19-p7-probe-line-signals.md`。
- 域守则：W3 本次显式 read `memory/notes/AGENTS.md`；W1/W2 域守则按 task-1/task-2 卡面分别 read（`scripts/control-tower/AGENTS.md`／`tests/control-tower/AGENTS.md`）。
- 复用四既有约定（重复实现即不合格）：三态退出码／`@degraded` ＋ `SYNO_GATE_DEGRADED_LOG`／UTF-8 强制（D732）／判别力自检（改坏必红）。

## 生效时点（第 2 轮 2026-10-19 实测原始输出；命令均 `source ~/.nvm/nvm.sh` 后跑）

- `npx tsx scripts/control-tower/probe-line-signals.ts --selfcheck` ⇒ 退出码 `0`，8 行 `[selfcheck] A…H ok`，末行 `SELFCHECK-OK: 8/8`（H 含 `E_GUARD_S2_DEGRADED`／`E_GUARD_S2_COUNT` 改坏必红正控）。
- `bash tests/control-tower/probe-line-signals.test.sh` ⇒ 退出码 `0`，末行 `结果: 8 通过, 0 失败`。
- 绿跑基准（实测）：被测件 `scripts/control-tower/probe-line-signals.ts` md5 `c60b34a681f33ee8bc085453b937b7d3`、`wc -l` = `1831`；测试件 `tests/control-tower/probe-line-signals.test.sh` md5 `788576074eba8fb1fad1f1ce83399e52`、`wc -l` = `786`。
- **真实数据 `--all`**（约 3min，只读）⇒ 退出码 `1`；逐线行 5 行齐：
  - `产品线 ①(merge-conditions)=0/8 ②=8 ③=8(跨线 8)`
  - `治理线 ①(merge-conditions)=0/22 ②=22 ③=22(跨线 8)`
  - `CTO ①(merge-conditions)=n/a(0) ②=0 ③=0(跨线 0)`／`K3 ①(merge-conditions)=n/a(0) ②=0 ③=0(跨线 0)`／`基座线 ①=n/a(未映射) ②=0 ③=0(跨线 0)`
  - 末行 `LINE-SIGNALS: lines=5 exceptions=30 gaps=19`；30 条 `exception:`（如 `exception: PR#625 产品线 NOT-DONE NO: overlap,review`、`exception: PR#622 治理线 NOT-DONE NO: ci,overlap,review`）与 19 条 `gap:`（`cross` 8 条 ＋ `mixed-unassigned` 11 条）逐条可数，与末行计数一致。
  - **不可判项实测随合并窗口变化**：Lead 复跑 as_of `17:01:26Z` 为 0 条（末行 `LINE-SIGNALS: lines=5 exceptions=21 gaps=14`）；verifier 快照 as_of `16:46:04Z` 实测 2 条（原文 `gap: PR#553 不可判 E_MERGE_BASE`、`gap: PR#547 不可判 E_MERGE_BASE`，该次末行 `LINE-SIGNALS: lines=5 exceptions=27 gaps=21`，证据文件 `/tmp/verifier-602-r2-evidence.txt` §1）⇒ 稳定窗口可能为 0，口径由**子例 H 夹具**钉死（H 同构夹具原始输出：`SYNO_LINE_SIGNALS_FIXTURE=<H 同构夹具> --all` ⇒ `产品线 ①(merge-conditions)=0/3 ②=2 ③=3(跨线 0)`、`exception: PR#21 产品线 NOT-DONE NO: ci,overlap,review`、`gap: PR#23 不可判 E_COND_DEGRADED`、末行 `LINE-SIGNALS: lines=5 exceptions=2 gaps=1`、exit `1`）。
- **真实数据 `--line 产品线`**（约 3min，只读）⇒ 退出码 `1`；行 `产品线 ①(merge-conditions)=0/8 ②=8 ③=8(跨线 8)` ＋ 8 条 `exception:` 明细，末行 `gaps(global)=19`（== `--all` 的 `gaps=19`）。
- **真实数据 `--all --json`**（约 3min，只读）⇒ 退出码 `1`；stdout 仅 JSON 且顶层恰七键 `tool/lines/exceptions/gaps/mapping/summary/exit`；`lines=5 exceptions=30 gaps=19`；`summary.open_prs=22 attributed_prs=22 single_prs=14 cross_prs=8 unknown_prs=0 mixed_prs=11 files_total=183`；`exceptions[].code` 全 `NOT-DONE`、`gaps[].kind` ∈ {`cross`,`mixed-unassigned`}；stderr 5 行逐线行与 JSON `lines[].s1/s2/s3` 逐项相同（python3 比对 `True`）。
- 随本批合并生效：`--all`／`--line`／`--json` 成为「某线进度/在飞/例外/看不见」的机算入口（只读）；真实数据判据由独立复核（task-4）复跑留档。

## 未决 / 已知限制（与 W1 头部 Known Limitations 同源）

1. **v1 不出未收口卡数**：Issue/task-state 无 line 字段（规格 §F8 实测：139 open issue 仅 9 个带 `^P<N>`）⇒ 只在 W1 Known Limitations 与 `--json summary.limitations` 承载，**不计入 gaps=**（计入会破坏子例 A 的 gaps=0）。
2. **基座线无路径定义**（handbook §五「具体面由 CTO 在开线时给」）⇒ R5 v1 不映射，线级 `n/a(未映射)`，不作为 gaps 条目（但必须出行，不得少一行）。
3. **不属任何报告线的路径进 gaps**：`docs/plans/**`、`memory/notes/**`、`task-state/**`、`.codex/**` 等 ⇒ `unknown` / `mixed-unassigned` 逐项点名。
4. **① 是机器代理**（四条件通过率），非 handbook 字面「Done 判据逐条」；③ 的「独立复核」沿用 `check-merge-conditions.sh` 的 T1 `attested` 口径。
5. **不可判项（取数降级）v4.1 归属**：进 `gaps` 不可判栏、**不计 ②**，但**计入 ① 分母与 ③**（fail-closed：看不见 ≠ 已做到）；文件清单取不到者只进 gaps、不进任何线计数。真实仓为**动态数据**：稳定窗口实测 0 条（as_of 17:01Z）、合并窗口实测 2 条 `E_MERGE_BASE`（as_of 16:46Z，见 verifier 证据文件 §1）⇒ 引用一律带 as_of；口径由子例 H 夹具钉死。
6. **取数成本与单线视图**：① 逐 PR 串行调四条件检查器（真实仓 22 PR 单次 `--all` ≈3min，O(n²) 只读）；`--line` 不展开 gap 明细、只给 `gaps(global)=<n>`，查缺口用 `--all`／`--json`（详见 W1 Known Limitations 5–7）。
