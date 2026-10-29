# Task Brief — #1122 Step 1 · 总闸最小可跑版（G2 遥测 / G6 归一 / G10 同形字）

#CRITERIA: D

> 任务唯一编号 = Issue 号。#1122 ｜ 分支 `feat/s1-verify-governance` ｜ 基线 `gitea/main` = b8edf9860
> 声明载体 = `.claude/claims/1122.yaml`（writeset ＋ done 两字段制）；本件是 Q1–Q3 的可读说明（同批提交）。
> 架构层: 不属五层业务（治理脚本）
> 规格来源：docs/founder/DEVDOC-门禁治理实施规格-v1-20261028.md §4（:171-186 G2/G6/G10）＋ §5（:196-205 M-6/M-11/M-12）
> 范围来源：Issue 卡面 #1122（唯一范围：只做 G2/G6/G10，不得扩到 G1-G10 其余项）

## Q1: 调研 — 业界最佳实践 / 决策链 / memory 历史教训

- **第一性原理**：一键验收脚本的价值不在"能打印 PASS"，而在**"看不见"时绝不打印 PASS**。
  遥测日志缺失、清单缺 classification 段、required 集合为空、子判据脚本缺失、参数错
  —— 这五种都是"没数据/没对象"，必须走 SKIP 或 exit 2，**不能走 0**。
- **仓内既有范式（禁重复建设）**：
  - 三态退出码 0/1/2 与"信号量==0 ⇒ exit 2"：scripts/control-tower/AGENTS.md。
  - 归一唯一真源：scripts/control-tower/gate-assert.sh 的 `ga_run`（#1096 W6）——
    本件 G6 **只 source 它并读返回值**，禁在 verify-governance 里写第二份 `case 128)`。
  - 遥测写入单点：scripts/control-tower/gate-telemetry.sh（唯一写入器，result ∈ hit/miss/warn/degraded）；
    读取侧口径与 scripts/control-tower/gate-stats.sh 同源（坏行跳过计数、窗口按 UTC 截断）。
  - 清单解析口径：scripts/control-tower/check-gate-inventory.sh 的 classification 段解析（正则子集，禁 YAML 全量）。
  - 同形字两态：scripts/control-tower/check-unicode-confusable.py（#1108 W10，`--root`/`--staged`、三态、末行汇总）。
- **历史教训（memory/notes/**）**：
  - 规格 §5 M-8：清空遥测目录后必须报"未运行"，**不得**报"零命中可退役"——本件 G2 的 SKIP 分支即该条。
  - 规格 §5 M-6：判据 exit 128 必须归判据故障，不得 PASS —— 由 G6 的故障注入用例（T4）承重。
  - D520/PLATFORM-CHECKLIST #1：禁裸 python3（Windows 平台敏感），一律经 `PYBIN` 三级探测。
  - D312：禁 git stash；沙箱 = `mktemp -d` + 复制真件（对齐 check-unicode-confusable.test.sh）。
- **决策参考系（Q1c）**：Anthropic 工程基线（可证伪的验收标准）＋ 仓内三态约定 ＋ 改坏即红
  ⇒ 不发明新机制，只把已有三件（gate-assert / gate-telemetry / check-unicode-confusable）编排成一张总闸。

## Q2: 范围

做什么：

- scripts/control-tower/verify-governance.sh
- tests/control-tower/verify-governance.test.sh
- gate-exemptions/2026-10-28-1122-verify-governance.md
- docs/authority/DOCS-REGISTRY.yaml
- docs/authority/WIRING-REGISTRY.yaml
- docs/authority/GATE-INVENTORY.yaml
- .claude/task-briefs/2026-10-28-1122-verify-governance.md
- .claude/claims/1122.yaml
- memory/notes/proposed/2026-10-28-1122-verify-governance.md

判据要点：

- **G2 遥测**：对 classification 里 required_ci: true 的每个 entrypoint，判近 N 天（默认 7）是否
  ≥1 条 ran 记录（result ∈ hit/miss/warn/degraded）。gate 名取 entrypoint 的确定性别名集
  （完整路径／文件名／去扩展名 stem，精确相等）。日志缺失/为空/全坏行 ⇒ **SKIP 且计入未运行**；
  有数据但某些 required 零记录 ⇒ **FAIL 并逐条点名未运行**；required 集合为空 ⇒ exit 2。
- **G6 归一**：source scripts/control-tower/gate-assert.sh；用 `ga_run` 跑注入判据
  （默认 exit 0；配对测试在 `SYNO_TEST_ARM=1` 沙箱下注入 exit 128）⇒ 本项结论 = ga_run 的结论
  （0 ⇒ PASS，1/2 ⇒ FAIL）。注入 128 时必须 FAIL；若归一把 128 改成 0 ⇒ 该用例红。
- **G10 同形字**：调 check-unicode-confusable.py 两夹具（临时 git 仓 `--staged`）：
  甲 = 标识符混西里尔 U+0430 ⇒ 必须 rc=1/VIOLATION；乙 = 注释内全角标点 ⇒ 必须 rc=0/PASS。
  两态都对才 PASS；扫描器自身 rc=2 ⇒ 本件 exit 2。
- **汇总**：逐项 PASS/FAIL/SKIP ＋ 末行 `GOVERNANCE: x/y PASS`；全 PASS ⇒ 0；有 FAIL/SKIP ⇒ 1；判不了 ⇒ 2。

不做什么（含文件路径）：

- 不做 G1/G3/G4/G5/G7/G8/G9（Issue 红线：不得顺手扩）；不写"数表全绿"式空转。
- 不改 scripts/control-tower/gate-assert.sh、gate-telemetry.sh、gate-stats.sh、check-unicode-confusable.py 的任何语义。
- 不接线（不改 scripts/pre-commit-check.sh、不改 .gitea/workflows/**、不改 .github/workflows/**）——
  写集不含它们 ⇒ WIRING 如实登记 declared-only。
- 不碰 scripts/audit/**（K3 专属）；不改 scripts/control-tower/probe-*.ts（M6 独占）。
- 不写仓库任何运行期文件（只读；临时夹具落 mktemp -d 并 trap 清理）；不合并任何 PR。

## Q3: 验收（入口 → 交互 → 结果）

- **入口**：bash scripts/control-tower/verify-governance.sh [--telemetry <path>] [--days N] [--root <dir>]
- **交互**：逐项 `<G2|G6|G10> <名称>: PASS|FAIL|SKIP` ＋ 证据行（required 计数／ga_run 点名行／
  两夹具 rc 与汇总词），末行 `GOVERNANCE: x/y PASS`。
- **结果**：bash tests/control-tower/verify-governance.test.sh ⇒ **0 失败**（T0 至 T16，55 断言）；
  干净夹具 ⇒ `GOVERNANCE: 3/3 PASS` exit 0；遥测缺失 ⇒ `2/3 PASS` exit 1 且 G2 显示 SKIP；
  沙箱注入 128 ⇒ G6 FAIL 且 `判据故障: 128` 上屏；把 gate-assert 的 128 归 0 ⇒ T4 断言必红。

## 架构层: 不属五层业务（治理脚本）

## Done 标准

- [x] 三项判据逐项 PASS/FAIL/SKIP ＋ 末行 `GOVERNANCE: x/y PASS`，非全 PASS ⇒ 非 0，判不了 ⇒ 2 verify: bash tests/control-tower/verify-governance.test.sh
- [x] 干净夹具 3/3 PASS exit 0；遥测缺失 G2=SKIP 不计 PASS；注入 128 G6=FAIL 且整体非 0 verify: bash tests/control-tower/verify-governance.test.sh
- [x] 同形字两态都对才 PASS（甲 VIOLATION／乙 PASS），任一态错 ⇒ G10=FAIL verify: bash tests/control-tower/verify-governance.test.sh
- [x] 改坏即红：gate-assert 的 128 归 0 ⇒ 128 用例由 FAIL 变 PASS（断言必红） verify: bash tests/control-tower/verify-governance.test.sh
- [x] G6 复用 ga_run，本件零第二套归一（grep 无 `128)` 分支） verify: bash -n scripts/control-tower/verify-governance.sh
- [x] 受保护路径豁免合规（三段式 ＋ 自覆盖行 ＋ 首行复核件，含 DOCS-REGISTRY 自登记） verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/main --root .
- [x] 新文件纯 LF（CR 字符数 0）＋ python 走 PYBIN verify: bash tests/control-tower/verify-governance.test.sh
