# #1054 验收矩阵机制 v1 · P0（acceptance-matrix/v1 ＋ 三态校验器 ＋ M4-T1 回溯样例）

> 四态：**proposed**（未过独立复核／未合并；禁读成 implemented）
> 规格源：handbook `派单件/2026-10-27-规格-1054-验收矩阵机制-P0.md` @ `b086a0a`（§5 契约／§6 边界／§7 验收）
> 归属：P4 门禁包（B6＝CTO 的眼睛）；批次 #1054；P0 为 B 类（不触合并语义、不接 CI）

## 现状（问题是什么，证据）

M4-T1 的验收实证（规格 §2.2）：声明核实 9/9 属实，但**没有**逐条给「15 条工程纪律 × 8 项 DSH 品味」结论，漏**品味 4**（explicit authority），**品味 7**（测试配对）未闭环，**Q-11**（覆盖率）因 CI ①e 未武装而"未判"。
⇒ 结论是**载体缺失**，不是态度问题：没有一处机器可判的地方存放"每项声明 + 可核证据"。

## 决定（本批做什么）

建 `acceptance-matrix/v1` 三件套（旁路机制，不改任何现行门禁）：

1. **格式权威** `docs/synova/acceptance/README.md`：23 行固定槽位（Q-1…Q-15、T-1…T-8）＋ `status ∈ {pass,n/a,deferred,partial}` ＋ `evidence{cmd,out}` ＋ 子集 YAML 语法 ＋ F1–F12 冻结契约 ＋ 边界值表 ＋ 已知限制。
2. **三态校验器** `scripts/control-tower/check-acceptance-matrix.py`：0 通过／1 真红／2 判不了；机械 11 项在 anchor 上复算，语义 12 项只判齐全性（`attested`）；`--verify`（与 plain 同一实现）＋ `--json`；exit 2 写 `SYNO_GATE_DEGRADED_LOG`（D2）。
3. **M4-T1 回溯样例** `docs/synova/acceptance/1053.matrix.yaml`（anchor `5553bb95c`）：证明校验器能点出 T-1 partial（`src/routes/sentinel.ts` 缺 `@exit`）、T-7 partial（无 committed 测试入变更集）、Q-11 partial（#943 ①e 未武装）。
4. **配对自测** `tests/control-tower/check-acceptance-matrix.test.sh`：绿基线 ＋ M1–M5 改坏必红 ＋ D1/D2 降级 exit 2（mktemp 沙箱、零网络）。
5. 登记：`.claude/claims/1054.yaml`（writeset 8 条）＋ 本 note ＋ `docs/authority/DOCS-REGISTRY.yaml` 追加 2 条 ＋ `docs/authority/WIRING-REGISTRY.yaml` 追加 1 行（`declared-only`）（两项均创始人批准的**最小扩写集**：D782 D2 登记门禁要求新增 .md/.yaml 必须登记）。

## 依据（为什么这样做）

- **判据真空**：MVP v1.2 三条硬判据要求"判据件存在 ＋ 反例必红"；把验收结论落成机器可判载体后才可复现（`docs/specs/mvp/MVP阶段权威文件-v1.2.md:31-38`）。
- **不重复建设**：三态退出码／`@降级`＋`SYNO_GATE_DEGRADED_LOG`／UTF-8 强制（D732）／判别力自检四条既有约定**复用**（`scripts/control-tower/check-quality-delta.py`、`check-gate-integrity.sh`）；子集 YAML **不引 PyYAML**（CI runner 无 PyYAML ⇒ import 失败会退化成"读不到声明"的静默路径，同 `check-quality-delta.py:93` 先例）。
- **规格内部冲突的取舍（本批已裁决）**：规格 §5.1 示例给 `n/a` 项写 `evidence.out: "0"`，与 §6 边界表「`out` = 仓内路径／含 anchor sha 的 URL，不存在即 `E_EVIDENCE_UNRESOLVED`」互相冲突 ⇒ **取 §6（判据表）**：`out` 一律强校验、`n/a` 只写 `cmd`。取舍已写进 README「Known Limitations 14」，**不是**改 F1–F12。
- **品味序与实现标准分类不同**：`T-1..T-8` 按 handbook §5 的 DSH 品味列举序（T-1 头部契约／T-2 typed error／T-3 fail loud／T-4 explicit authority／T-5 已知限制／T-6 设计哲学／T-7 测试配对／T-8 长期件 README），**不是** `.dsh/skills/dsh-code-standards` 的 B1–B8 实现标准序号（B5=explicit authority 对应 T-4）。引用时按 T 序，勿按 B 表套号。

## 生效时点

**未生效**（proposed）。生效条件＝独立复核（另一会话）＋ K3 抽验 ＋ 合并到 `gitea/local-main`；本 note 与文档在合并后才可被引为"在库口径"。
**P0 明确不接 CI／pre-commit**（规格 §3 非目标）：本批**不新增任何调用点**，"绿"只代表手动跑过。P2 的 CI report-only 属 A 类提案，需另行获准。

## 边界（零交集）

- 不碰 `electron-renderer/**`、`src/**`、`tests/acceptance/**`（M4 写集，**零改动**）。
- 不碰 `.gitea/**`、`.github/**`、`scripts/audit/**`、`.dsh/skills/**`、`.claude/skills/**`、任何现行门禁/pre-commit/hook。
- 写集扩条共**两条**（均创始人 2026-10-27 批，各为最小追加、不改其它条目）：
  1. `docs/authority/DOCS-REGISTRY.yaml`：仅追加本批 2 条登记（DOC-0306／DOC-0307）——D782 D2 登记门禁要求新增 .md/.yaml 必须登记。
  2. `docs/authority/WIRING-REGISTRY.yaml`：仅追加 1 行条目 `control-tower.acceptanceMatrix`（`status: declared-only` ＋ `consumer: null`）——G1 质量增量闸 R1.1 要求新增能力件登记、R1.2 要求生产调用点；P0 明确不接 CI/pre-commit（规格 §3 非目标）⇒ 无生产消费者，按同型先例（`check-test-obligations.py`／`ledger-sync.sh`／`auto-merge.sh`）记 declared-only。

## 未决项（待验证，逐条标明）

1. **独立复核未做**：需另一会话按 dsh-code-standards 8 项＋四约定逐条核（自验只有队内"可提请独立复核"级别，不作通过判决）。
2. **K3 审计未做**。
3. **P2 CI report-only**：属 A 类，未提案；需连续两周观察误红率后再议。
4. **样例 anchor `5553bb95c` 未并入 `local-main`**（在未合并分支 `feat/1053-metric-readings-schema`）：校验器只要求"anchor 在本仓可解析"，不判是否已并入主线；该事实由样例如实记录。
5. **`--verify` 抓不到实现 bug**：与 plain 共用同一实现（有意），它抓"声明 vs 机械事实"不一致，不抓"校验器算错"。
6. **`changed_files` 自报不与 git 对账**、**`n/a` 负证据命令只记录不执行**、**URL 类证据不联网**：三条都是已知信任边界，写在 README「Known Limitations」。

## 证据（命令名；原始输出见 PR 正文与 T6 自验消息，此处不抄全量）

- A1 `python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1053.matrix.yaml --repo . --anchor 5553bb95c` → 末行 `MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)`，且点名 `Q-11 partial` / `T-1 partial` / `T-7 partial`。
- A2 同一命令 `--verify` → 末行 `VERIFY: mach 11/11 consistent`。
- A3 同一命令 `--json` → 一份 JSON（items 23、summary 六字段、errors 空）。
- A4 抽样反证 `git show 5553bb95c:src/routes/sentinel.ts | grep -c '@exit'` → `0`（与 T-1 partial 口径一致）。
- D1 `--anchor deadbeef0` → exit 2 ＋ `degraded: E_ANCHOR_MISMATCH phase=anchor — …` ＋ `SYNO_GATE_DEGRADED_LOG` 恰 1 行 JSON（time/component/code/phase/retryable）。
- D2 `--repo <不存在的路径>` → exit 2 ＋ 降级日志非空。
- M1–M5 变异各 exit 1 并点名 `E_MATRIX_ITEM_MISSING` / `E_N/A_NO_EVIDENCE` / `E_EVIDENCE_UNRESOLVED` / `E_ANCHOR_MISMATCH` / `E_COV_UNJUDGED`（详见 `bash tests/control-tower/check-acceptance-matrix.test.sh` 与 T6 自验）。
