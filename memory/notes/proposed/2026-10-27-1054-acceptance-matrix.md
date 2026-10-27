# #1054 验收矩阵机制 v1 · P0→P0.7（acceptance-matrix/v1 ＋ 三态校验器 ＋ 主线锚样例 1048／回溯样例 1053）

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
3. **M4-T1 回溯样例** `docs/synova/acceptance/1053.matrix.yaml`（anchor `5553bb95c`；**A1b 回溯演练，不得作默认**）：证明校验器能点出 T-1 partial（`src/routes/sentinel.ts` 缺 `@exit`）、T-7 partial（无 committed 测试入变更集）、Q-11 partial（#943 ①e 未武装）。
4. **配对自测** `tests/control-tower/check-acceptance-matrix.test.sh`：绿基线 ＋ M1–M5 改坏必红 ＋ D1/D2 降级 exit 2（mktemp 沙箱、零网络）。
5. 登记：`.claude/claims/1054.yaml`（writeset **10 条**）＋ 本 note ＋ `docs/authority/DOCS-REGISTRY.yaml` 追加 **4 条**（本批：`README.md`=**DOC-0309**／`1053.matrix.yaml`=**DOC-0310**／`1048.matrix.yaml`=**DOC-0311**／`gate-exemptions/2026-10-27-1054-gate-exempt.md`=**DOC-0312**；P0.7 合基线后顺延重登）＋ `docs/authority/WIRING-REGISTRY.yaml` 追加 1 行（`declared-only`）（两项均 **L1 批准（Gitea #1054 评论 · 2026-10-27）** 的**最小扩写集**：D782 D2 登记门禁要求新增 .md/.yaml 必须登记）。🔴 **本批 DOC-0309–0312 与 M4 线 DOC-0306–0308 不重号**。
6. **主线锚样例** `docs/synova/acceptance/1048.matrix.yaml`（anchor `1ca0d4dfc`，= 已并入 `gitea/local-main` 的提交）：**A1 默认被测对象**。变更集取**真实 15 件**（= `git diff --name-status 9b0b1f935 1ca0d4dfc` 全量，零过滤，`.claude/claims/1048.yaml` 与 `.claude/claims/1049.yaml` 如实入集）。`T-8` 作用域已收窄为**仅代码目录**（父目录匹配 `^(src|electron-renderer|extensions|scripts|expert|knowledge|theory|tests)(/|$)`，尾部 `(/|$)` 使**顶层目录本层直挂件同样受判**）：`.claude/**`、`memory/**`、`docs/**` 属记录面 ⇒ 跳过并向 stderr 打印 `T-8 scope: skip record-only dir <dir>`；故 `T-8` 判定对象只剩 `scripts/control-tower`（5 件）与 `tests/control-tower`（4 件），两者 `AGENTS.md` 在 anchor 各 5 个 `^## ` 小节（达标）。
7. **受保护路径豁免件** `gate-exemptions/2026-10-27-1054-gate-exempt.md`（**裁 423**，2026-10-27）：恰 4 行——校验器／配对测试／本批登记追加（DOCS-REGISTRY）／自覆盖（`gate-exemptions/**` 自我保护）。
8. **P0.6 修订（2026-10-27）**：① `T-8` **作用域收窄**——只对代码目录（`^(src|electron-renderer|extensions|scripts|expert|knowledge|theory|tests)(/|$)`；P0.7 补齐尾部 `(/|$)`，使**顶层目录本层直挂件同样受判**）要求 `AGENTS.md` 存在且 `^## ` ≥5；记录面／域外目录一律跳过并向 stderr 打印 `T-8 scope: skip record-only dir <dir>`（记录面）／`T-8 scope: skip out-of-scope dir <dir>`（其它域外），`detail` 增 `skipped=<n>`（`dirs` 只计作用域内）；② `1048.matrix.yaml` 的 `changed_files` **还原真实 15 件**（删掉 8 处 `grep -v -e .claude/claims/` 过滤，claims×2 如实入集）；③ 配对自测 **37 → 39**（新增两例：`.claude/claims` 不触发 `T-8`／`scripts/x` 触发 `T-8`；**P0.7 起例数按实测刷新，见「证据」段**）；④ **不改既有门禁、不接 CI**（P0 非目标不变）。

9. **P0.7 收口修订（2026-10-27，合基线 `gitea/local-main`@`0fda487e2` 后对账；逐条关闭 K3 六项）**：① **B-10 DOC 撞号**——M4 线占 **DOC-0306–0308**（原样保留、一条不动），本批 4 条顺延 **0309–0312**（映射见「决定」5／「边界」43；`doc-registry-gate` 实测 166 条 DOC id、重号 0 个、0 个未登记）；② **B-2 F3**——`T8_SCOPE_RE` 尾部 `"/"` → `"(/|$)"`，使**顶层目录本层直挂件同样受判**（旧写法把父目录恰为 `src`／`scripts`／`tests` 的变更当域外跳过 ⇒ 假绿），配对自测 **39 → 41**（S3 顶层 `src`／`scripts` ⇒ exit 1＋`T-8 n/a fail dirs=2 bad=2`；S4 `docs/x`×2 ⇒ exit 0＋record-only skip）；③ **B-4 F4**——`README:279` **删掉** `absent=<n>` 对全部机械项的通用承诺，改为**六规则限定**（`Q-2`／`Q-13`（共用同一实现）／`Q-4`／`Q-6`／`Q-8`／`T-1`／`T-5`），未实现的不写；④ **B-6 交叉背书**——`1048.matrix.yaml` 的 `Q-9`／`T-7` `reason` 删掉外批测试数字 `27/14/99/34`，改标 **attested-by-other**（测试通过结论属 #1048 批自身复核回执，非本批机械验证）；⑤ **B-5 数字失实**——豁免件与 claim 的例数／条数按实测刷新（**41 例**／**4 条登记**），claim 标题改 **P0.7 收口**；⑥ 本 note 证据段全部数字按 P0.7 实跑刷新（登记门禁 166／130／4 文档、`gate-protection --changed-base gitea/local-main` → 10 通过 0 失败、配对自测 → **41 通过 0 失败**）。**判据语义零改动**（F1–F12 未动）。

## 依据（为什么这样做）

- **判据真空**：MVP v1.2 三条硬判据要求"判据件存在 ＋ 反例必红"；把验收结论落成机器可判载体后才可复现（`docs/specs/mvp/MVP阶段权威文件-v1.2.md:31-38`）。
- **不重复建设**：三态退出码／`@降级`＋`SYNO_GATE_DEGRADED_LOG`／UTF-8 强制（D732）／判别力自检四条既有约定**复用**（`scripts/control-tower/check-quality-delta.py`、`check-gate-integrity.sh`）；子集 YAML **不引 PyYAML**（CI runner 无 PyYAML ⇒ import 失败会退化成"读不到声明"的静默路径，同 `check-quality-delta.py:93` 先例）。
- **规格内部冲突的取舍（本批已裁决）**：规格 §5.1 示例给 `n/a` 项写 `evidence.out: "0"`，与 §6 边界表「`out` = 仓内路径／含 anchor sha 的 URL，不存在即 `E_EVIDENCE_UNRESOLVED`」互相冲突 ⇒ **取 §6（判据表）**：`out` 一律强校验、`n/a` 只写 `cmd`。取舍已写进 README「Known Limitations 14」，**不是**改 F1–F12。
- **品味序与实现标准分类不同**：`T-1..T-8` 按 handbook §5 的 DSH 品味列举序（T-1 头部契约／T-2 typed error／T-3 fail loud／T-4 explicit authority／T-5 已知限制／T-6 设计哲学／T-7 测试配对／T-8 长期件 README），**不是** `.dsh/skills/dsh-code-standards` 的 B1–B8 实现标准序号（B5=explicit authority 对应 T-4）。引用时按 T 序，勿按 B 表套号。

## 生效时点

**未生效**（proposed）。生效条件＝独立复核（另一会话）＋ K3 抽验 ＋ 合并到 `gitea/local-main`；本 note 与文档在合并后才可被引为"在库口径"。
**P0.5 的由来（闭环）**：独立复核对本批给出 **BLOCK** ⇒ **裁 423**（Gitea #1054 评论 · 2026-10-27）批本补单（受保护路径豁免件 ＋ 主线锚样例 1048）⇒ 本轮即按 BLOCK 项逐条闭环（见「决定」6／7）。
**P0 明确不接 CI／pre-commit**（规格 §3 非目标）：本批**不新增任何调用点**，"绿"只代表手动跑过。P2 的 CI report-only 属 A 类提案，需另行获准。

## 边界（零交集）

- 不碰 `electron-renderer/**`、`src/**`、`tests/acceptance/**`（M4 写集，**零改动**）。
- 不碰 `.gitea/**`、`.github/**`、`scripts/audit/**`、`.dsh/skills/**`、`.claude/skills/**`、任何现行门禁/pre-commit/hook。
- 写集扩条共**两条**（均 **L1 批准（Gitea #1054 评论 · 2026-10-27）**，各为最小追加、不改其它条目）：
  1. `docs/authority/DOCS-REGISTRY.yaml`：仅追加最小登记（P0：**DOC-0309**／**DOC-0310**；P0.5：**DOC-0311**／**DOC-0312**；P0.7 合基线后按 `gitea/local-main` 已占的 M4 线 **DOC-0306–0308** 顺延重登 ⇒ **本批 DOC-0309–0312 与 M4 线 DOC-0306–0308 不重号**）——D782 D2 登记门禁要求新增 .md/.yaml 必须登记。
  2. `docs/authority/WIRING-REGISTRY.yaml`：仅追加 1 行条目 `control-tower.acceptanceMatrix`（`status: declared-only` ＋ `consumer: null`）——G1 质量增量闸 R1.1 要求新增能力件登记、R1.2 要求生产调用点；P0 明确不接 CI/pre-commit（规格 §3 非目标）⇒ 无生产消费者，按同型先例（`check-test-obligations.py`／`ledger-sync.sh`／`auto-merge.sh`）记 declared-only。
- **裁 423（2026-10-27）另批两项**：① 受保护路径豁免件 `gate-exemptions/2026-10-27-1054-gate-exempt.md`（4 行）；② A1 默认样例改主线锚 `docs/synova/acceptance/1048.matrix.yaml`@`1ca0d4dfc`（1053 降为 A1b 回溯演练）。⇒ 写集 **8 → 10 条**（见 `.claude/claims/1054.yaml`）；受保护路径仍逐条有合规豁免行。

## 未决项（待验证，逐条标明）

1. **独立复核**：首轮已做且给出 **BLOCK**（Gitea #1054 评论 · 2026-10-27 ⇒ 裁 423）；本轮 P0.5 即按 BLOCK 项整改，**闭环复验（0 上下文会话）待做**——队内自验只有"可提请独立复核"级别，不作通过判决。
2. **K3 审计未做**。
3. **P2 CI report-only**：属 A 类，未提案；需连续两周观察误红率后再议。
4. **回溯样例 anchor `5553bb95c` 未并入 `local-main`**（在未合并分支 `feat/m4-1051-closeout` 与 `cto/t1-c4`；`feat/1053-metric-readings-schema` 不含该提交）：校验器只要求"anchor 在本仓可解析"，不判是否已并入主线；该事实由样例如实记录 ⇒ **A1 默认改用主线锚 `1048.matrix.yaml`@`1ca0d4dfc`**，1053 仅作 **A1b 回溯演练（不得作默认）**。
5. **`--verify` 抓不到实现 bug**：与 plain 共用同一实现（有意），它抓"声明 vs 机械事实"不一致，不抓"校验器算错"。
6. **`changed_files` 自报不与 git 对账**、**`n/a` 负证据命令只记录不执行**、**URL 类证据不联网**：三条都是已知信任边界，写在 README「Known Limitations」。

## 证据（命令名；原始输出见 PR 正文与自验消息，此处只留末行／关键行）

- A1（默认，主线锚 1048）`python3 scripts/control-tower/check-acceptance-matrix.py docs/synova/acceptance/1048.matrix.yaml --repo . --anchor 1ca0d4dfc` → exit 0，末行 `MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)`（逐项点名 `Q-11 n/a`／`T-8 pass`）。
- A1b（回溯演练 1053）同命令换 `docs/synova/acceptance/1053.matrix.yaml` ＋ `--anchor 5553bb95c` → exit 0，末行 `MATRIX: PASS 23/23 (mach 11/11, sem 12 attested)`，且点名 `Q-11 partial` / `T-1 partial` / `T-7 partial`。
- A2 1048 版同一命令 `--verify` → exit 0，末行 `VERIFY: mach 11/11 consistent`。
- A3 1048 版同一命令 `--json` → exit 0，单份 JSON：keys `[anchor, errors, issue, items, schema, summary]`、`items` 23、`summary` = `{total:23, mach_total:11, mach_ok:11, sem_total:12, sem_attested:12, pass:True}`、`errors` 空。
- A4 抽样反证 `git show 5553bb95c:src/routes/sentinel.ts | grep -c '@exit'` → `0`（与 1053 回溯样例的 T-1 partial 口径一致）。
- D1（1048 矩阵）`--anchor deadbeef0` → exit 2 ＋ stdout `UNJUDGED E_ANCHOR_MISMATCH phase=anchor — --anchor 不可解析（deadbeef0）：rev-parse 非零退出` ＋ 末行 `MATRIX: UNJUDGED E_ANCHOR_MISMATCH`；`SYNO_GATE_DEGRADED_LOG` 恰 1 行 JSON（time/component/code/phase/retryable 五字段）。
- D2（1048 矩阵）`--repo /nonexistent/synova-1054` → exit 2 ＋ `degraded: E_ANCHOR_MISMATCH phase=repo — 仓不可读` ＋ 降级日志恰 1 行（phase=repo、retryable=true）。
- 登记门禁 `bash scripts/doc-system/doc-registry-gate.sh` → exit 0：`166 条 DOC id，重号 0 个`／`130 条 status=active，path 失配 0 个（status 字段 172 条）`／`检查 4 个文档，0 个未登记`／`✅ 登记门禁通过`。
- 配对自测 `bash tests/control-tower/check-acceptance-matrix.test.sh` → exit 0，`结果: 41 通过, 0 失败`（P0.6 起 37 → 39：新增「`.claude/claims` 不触发 T-8」与「`scripts/x` 触发 T-8」两例；**P0.7 起 39 → 41：新增 S3 顶层 `src`／`scripts` 各 2 件触发 T-8 fail、S4 `docs/x`×2 记 record-only 并 skip 两例** ⇒ 39＋2＝41，每例 1 条合并式断言；P0.7 实跑原始末行 = `结果: 41 通过, 0 失败`、RC=0，输出含 `✅ S3 …`／`✅ S4 …`，全输出 `✅` 计数 41）。
- 受保护路径门禁 `bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/local-main` → exit 0，`结果: 10 通过, 0 失败`（diff 变更路径 10 条／受保护路径变更 4 条逐条「有合规豁免」；base=gitea/local-main → merge-base 0fda487e）。
- M1–M5 变异各 exit 1 并点名 `E_MATRIX_ITEM_MISSING` / `E_N/A_NO_EVIDENCE` / `E_EVIDENCE_UNRESOLVED` / `E_ANCHOR_MISMATCH` / `E_COV_UNJUDGED`（详见上述自测与自验消息）。
