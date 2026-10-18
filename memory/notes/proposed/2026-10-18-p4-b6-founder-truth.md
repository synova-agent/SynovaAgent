---
状态: proposed
日期: 2026-10-18
决策: `founder-truth.py` 的迁移期 claim 行补齐 `id`/`title`/`phys` 三键（`phys` 取字面「未核验（claim 无 D# 锚点）」诚实降级）、配对测试收紧假绿断言并新增 3 条断言、新增自证脚本覆盖 6 项机械判据，再按裁 210「先收紧后解除」解除 baseline 隔离；`judge()` 与退出码三态语义不动。
理由: `.claude/claims/` 有数据时 `collect()` 产出的 claim 行只有 6 键，而文本面板 `:430` 直读 `r["phys"]` ⇒ 只缺一个键就把「检查自身失败」混进了三态里的 exit 1（真红位），下游 `generate-dashboard` 六维随之全 `unknown`。补三键是治因（消费方只用 `id/title/claimed/phys` 四键），而收紧假绿断言 ＋ 解除隔离才让这条回归此后有人拦 —— 只修不拦，下一次缺键仍无人发现。
---

# P4 交付 1：修 B6 —— `founder-truth.py` 迁移期 claim 行缺键致崩溃

## 现状（改之前）

实测于本 worktree（HEAD `616162548`）：

- claim 行构造 `scripts/control-tower/founder-truth.py:90-93` 只写 6 键（`task_id`/`num`/`claimed`/`hist`/`source`/`migration`）；`:430` 为 `green = sum(1 for r in active if judge(r["claimed"], r["phys"])[0] == "🟢")`，直读 `phys`。
- `SYNO_FOUNDER_OUT_DIR=$(mktemp -d) python3 scripts/control-tower/founder-truth.py --offline` ⇒ 末段 `File ".../founder-truth.py", line 430, in <genexpr>` ＋ `KeyError: 'phys'`，`exit=1`；输出共 **9** 行（第 1 行 `[迁移期] … 并列计入 claim 30 条`，其余为 Traceback）。三态契约里 `1` = 真红（业务阻断）⇒ 检查自身失败伪成业务阻断。
- 数据面仍在：`.claude/claims/*.yaml` **30** 个、`task-state/*.json` **468** 个 ⇒ 崩溃可复现，非空仓假象。
- 配对测试 `bash tests/control-tower/founder-truth.test.sh` ⇒ 末行 `结果: 5 通过, 6 失败`、`exit=1`；且被隔离：`sealed-tests.sh --quarantine | grep -c founder-truth` ⇒ **1**、`SYNO_BASE_REF=origin/local-main … --list | grep -c` ⇒ **0** ⇒ 当前不在 CI 执行集内。台账行为 `scripts/control-tower/gate-integrity-baseline.txt:120`（`tests/control-tower/founder-truth.test.sh`）。
- `tests/control-tower/founder-truth.test.sh:62` 旧断言为 `grep -qE "🟢|🟡|🔴|⚪"` ⇒ 在 Traceback 文本上恒真（假绿）。
- 爆炸半径：`generate-dashboard.read_physical_facts()` 实测 `dims=6`、`unknown_count=6`，六维（任务真相／代码提交／合并 main／诚信账本／北星对齐／CI 状态）reason 全为 `物理核验降级: 'phys'` ⇒ 面板六维全瞎。

## 决定

- **治因**：`collect()` 的 claim 行补 `id`、`title`、`phys` 三键（+3 行）；`phys` 写「未核验（claim 无 D# 锚点）」—— 诚实降级标注，不得写成「无提交记录」（那是假陈述）。
- **测试加固**：`:62` 假绿断言收紧为 `grep -q "小结：🟢"`；新增 3 条断言（① 无 `Traceback` 且 `--offline` 的 `exit ∈ {0,1}`；② claim 行标注 `未核验` 且不硬编码 issue 号；③ 契约成对反例：真行 `missing=0` ∧ 合成缺三键行 `missing=3`，两者同时成立才有判别力）。
- **测试 hermeticity 加固（T7/T8；超出 dev doc §2 W2 三处清单，由队长裁定、提请独立复核）**：`诚信账本` 断言改三态感知 —— 有 AGENT 计分 / 无文件显式降级 / 空账本显式真绕过计数 / 其余判红。理由：`.claude/bypass.log` 是 gitignored 运行时数据，且 `post-commit.sh` 每次提交只写 COMMITTED（无 `AGENT=`）⇒ 提交后不得假红。
- **自证脚本**（本 PR 内新建，dev doc §8 建议路径；不进 PR 即视为未自证）：`tests/control-tower/founder-truth-acceptance.test.sh` 覆盖 6 项机械判据 —— 三键齐／`:62` 已改／baseline 只删 1 行（diff --stat 判）／`--offline` exit 0|1 且无 `Traceback`／测试末行 `0 失败` 且 N ≥ 14／`judge()` 零改动。
- **解除隔离**：删 `gate-integrity-baseline.txt:120` 一行；按 **裁 210** 顺序 **先收紧后解除**（先解先红一片，先修后解才有意义）。
- **不做什么**：不动 `judge()`、不动 `main()` 的任何 `return`（退出码三态语义不变）—— 「⚪ 判据落地」归 **2.11**；不动 `generate-dashboard.py`（其 `except` 已显式降级，本卡只让它因上游修好而恢复）；不上调棘轮注释。

## 依据

- 规格源（唯一，冻结）：`docs/plans/codex/implementation/SYNOVA-IMPL-2.1-B6-founder-truth-20261018.md`，`sha256` 前 16 位 = **`be89850095e5fea7`**（实测 `shasum -a 256` = `be89850095e5fea714f72d45eeb8f86bde4aba0fcd595b181dc365de45d34e3b`）；§1 非目标、§2 W1–W3、§3 F1–F10、§4 三路径＋三条反例、§8 自证 6 项、C3 失效条件。
- **裁 210**（CTO 批 W3 解除隔离）：「🔴 顺序不可反：先收紧 `:62` 假绿断言（改坏必红）⇒ 再解除隔离」。
- **门禁 G 的继承态 slack 属 2.3**（`FACE-TOTAL`／`QUARANTINE-TOTAL` 存量基线）：本卡不修、不上调棘轮，归 CTO。
- 本 Note 即该非平凡变更的决策沉淀（铁律 49）；头字段 `状态: proposed` 与目录一致（`memory/notes/README.md` 四态：目录名即状态）。

## 生效时点

- **随本 PR 合并生效**：`--offline` 无 `Traceback`、claim 行显式标注；测试末行 `0 失败` 并重新进入 CI 发现制（`--list | grep -c founder-truth` 由 `0` → `1`）；六维由 `unknown` 恢复为物理事实（dev doc §1 可观测结果 ②）。
- **失效判据（dev doc C3）**：迁移期结束（`.claude/claims/` 退役、`task-state` 恢复唯一真源）⇒ 删 claim 行处理 ＋ W2 对应断言 ＋ W3 台账行，并在 `agents/P4-门禁/AGENTS.md` §十一 记一次审查记录。
- **前提变更不得带病续跑**：若 2.11 落地显式 ⚪ 判据（`judge` 新增分支），本卡的 `phys` 文案与「未核验（claim 无 D# 锚点）」断言**必须同批更新**，否则文案与判据分叉；届时由 L1 出新规格，L2 不得自行改判据。
