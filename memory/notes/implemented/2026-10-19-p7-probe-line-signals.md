---
状态: implemented
日期: 2026-10-19
决策: 「回执三信号」由人算改为按 handbook《常设授权条例》§五 的 5 条**报告线**（路径切 R1–R5）机器算；① 用四条件通过率作机器代理（标签 `①(merge-conditions)`）、③ 卡数 v1 不出；跨线 PR 计入所涉每条线 ③ 并逐项进 gaps。
理由: **包写集天然重叠**（规格 §〇pre ⑤ 实测：`docs/**` 同属 P6/P7/P9/P10、`scripts/control-tower/**` 同属 P4/P7/P9）⇒ 按包归线会把多数 open PR 打成 ambiguous（规格 v1 的致命错）；报告线按「最长前缀优先＋显式排除」保证同一文件只归一条线，且「看不见」（全 unknown／混合未归属／跨线）逐项点名 ⇒ CTO 问「某线进度/在飞/例外」时一条命令出，不再靠人报。
---

# #602 P7-2 交付：回执三信号探针（`probe-line-signals.ts`）

## 现状（改之前）

- **无按线三信号件**：`git grep -l "回执三信号" <base> -- scripts/` ⇒ `0`（规格 §3 F1）；四条件机器判定已有 `scripts/control-tower/check-merge-conditions.sh`（只读复用），但缺「按报告线聚合三信号」的编排层。
- **旧线口径（v3.2 / 规格 v1）为何错**：线＝包 P1–P10，而包写集互相重叠（`docs/**`∈P6/P7/P9/P10、`memory/notes/**`∈P6/P7、`.gitea/**`∈P4/P10、`scripts/control-tower/**`∈P4/P7/P9，规格 §F5）⇒ 同一 PR 天然挂多包，归线结果大量 ambiguous，不可核。
- **B 口径不重做**：健康三信号（绕过/拒绝/M 复发）已由 `scripts/control-tower/gen-cto-health.py` 在算 ⇒ 本批只做 A 口径（回执三信号）。

## 决定

- **W1 新建 `scripts/control-tower/probe-line-signals.ts`**（只读探针）：`--all` 每线一行三信号 ＋ 末行 `LINE-SIGNALS: lines=<L> exceptions=<n> gaps=<n>`；`--line <报告线>` 单线＋例外明细；`--json` 固定 DS-8 七键（`tool/lines/exceptions/gaps/mapping/summary/exit`）；`--selfcheck` 7 子例 A–G；三态退出码 `0/1/2`，根级失败 `degraded:` ＋ `SYNO_GATE_DEGRADED_LOG`。
- **线映射＝规格 §4bis R1–R5 逐字**（最长前缀优先＋显式排除，同一文件只归一条线）；PR 跨 ≥2 线 ⇒ 计入所涉每条线 ③ 并标 `(跨线 c)`，同时进 gaps 点名；全 unknown／混合未归属逐项进 gaps（`gap: ` 三类可计数形态，DS-2 计数==明细）。
- **三信号定义**：①＝四条件通过率（机器代理，非 handbook 字面 Done 判据）；②＝逐项降级例外（按线，`exception: PR#<n> <线> <code>`）；③＝在飞 PR 数（某线 0 且全局有 PR ⇒ `0(跨线 0)`，禁「无在飞 PR」）。v1 不出未收口卡数。
- **W2 新建 `tests/control-tower/probe-line-signals.test.sh`**（CT-40 配对）：7 判定点 A–G ＋ 三态 ＋ DS-8 键集/s1,s2,s3 与文本同口径 ＋ 只读证明 ＋ 改坏必红（`SYNO_LINE_SIGNALS_TOOL` 外部覆盖缝 ＋ 件内突变自证）；零网络（`SYNO_LINE_SIGNALS_FIXTURE` 夹具 ＋ degraded log 落 mktemp）。
- **不做什么**：不改 `check-merge-conditions.sh`／`gen-cto-health.py`／`probe-ladder.ts`／`emit-signal.py`／`.gitea/**`／`scripts/audit/**`；不接 CI；不写人读进度文档。

## 依据

- 创始人 2026-10-19「回执 A」口径裁定；**B-7-a**（线＝报告线；`tests/control-tower/**`·`tests/architecture/**`·`.gitea/**`→治理线）／**B-7-b**（W2 写集扩 1 行）／**B-7-c**（①＝四条件通过率、③ 卡数 v1 不出）三条裁定（记于 Issue #602）。
- 规格真源（唯一）：handbook `派单件/2026-10-19-P7-602-三信号探针-规格.md` @ `b798946bd`（v4）；卡面 `.claude/task-briefs/2026-10-19-p7-probe-line-signals.md`。
- 域守则（本次显式 read）：`scripts/control-tower/AGENTS.md`｜`tests/control-tower/AGENTS.md`｜`docs/AGENTS.md`｜`memory/notes/AGENTS.md`｜`.gitea/AGENTS.md`；DSH 标准 `.dsh/skills/dsh-code-standards/SKILL.md`。
- 复用四既有约定（重复实现即不合格）：三态退出码／`@degraded` ＋ `SYNO_GATE_DEGRADED_LOG`／UTF-8 强制（D732）／判别力自检（改坏必红）。

## 生效时点（真实命令输出，禁估计值）

- `npx tsx scripts/control-tower/probe-line-signals.ts --selfcheck` ⇒ 退出码 `0`，末行 `SELFCHECK-OK: 7/7`
- `bash tests/control-tower/probe-line-signals.test.sh` ⇒ 退出码 `0`，末行 `结果: 7 通过, 0 失败`
- 绿跑基准（实测，`as_of` 2026-10-19）：被测件 `scripts/control-tower/probe-line-signals.ts` md5 `6589768b2cb701ff5faf2bbd1de45061`；`wc -l` ⇒ W1 `1673`、W2 `610`
- `npx tsx scripts/control-tower/probe-line-signals.ts --all`（真实数据，只读）⇒ 退出码 `1`；末行 `LINE-SIGNALS: lines=5 exceptions=0 gaps=15`；
  5 线行均出行（基座线 `①=n/a(未映射) ②=0 ③=0(跨线 0)`）；`gap:` 明细 15 条与末行 `gaps=15` 自洽（DS-2；明细含 `cross` 与 `mixed-unassigned` 两类，逐项点名）。
- 随本批合并生效：`--all` 成为「某线进度/在飞/例外」的机算入口（只读）；真实数据判据由独立复核（task-4）复跑留档。

## 未决 / 已知限制（与 W1 头部 Known Limitations 同源）

1. **v1 不出未收口卡数**：Issue/task-state 无 line 字段（规格 §F8 实测）⇒ 只写进 Known Limitations 与 `--json summary.limitations`，**不计入 gaps**（计入会破坏子例 A 的 gaps=0）。
2. **基座线无路径定义**（handbook §五「具体面由 CTO 在开线时给」）⇒ R5 v1 不映射，线级 `n/a(未映射)`，不作为 gaps 条目（但必须出行，不得少一行）。
3. **不属任何报告线的路径进 gaps**：`docs/plans/**`、`memory/notes/**`、`task-state/**`、`.codex/**` 等 ⇒ `unknown` / `mixed-unassigned` 逐项点名。
4. **① 是机器代理**（四条件通过率），非 handbook 字面「Done 判据逐条」；③ 的「独立复核」沿用 `check-merge-conditions.sh` 的 T1 `attested` 口径。
5. **取数成本与逐项粒度**：① 逐 PR 调四条件检查器（O(n²)，串行只读）；逐项降级/PR 文件取不到 ⇒ 进 `exceptions`（`<线>` 可打 `—`，不计任何线 ②）；`--line` 是单线视图，gaps 为全局口径只在 `--all`/`--json` 输出（详见 W1 Known Limitations 5–7）。
