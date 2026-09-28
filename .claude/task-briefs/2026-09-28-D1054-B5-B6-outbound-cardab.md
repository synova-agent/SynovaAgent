# Task Brief: D1054 B5-B6-outbound-cardab

> 生成: 2026-09-28 | 任务: D1054 | 认领: squad-a-b2
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理域 · 文档存量分流线（DOC-CONTRACT §7:256 / §9）：把 `docs/archive/` 中的 md 存量承接
（保形复制）到过程档案仓后从主仓移出；同时对两条**已被物理阻断**的卡（B6 跨域、CARD-A 跨域）
只出取证、不改动。不触 L1–L5 任何运行时代码。
### b) 文件审计
- `docs/archive/` 实测 **all-files 30 = md 18 + ts 12**（`git ls-files 'docs/archive/**'` 分类计数）。
- `scripts/archive/` 实测 1 件：`scripts/archive/gen-survey.py`（= B6 对象，已阻断，本批不动）。
- 引用双法：法1 `git grep -F -f` 命中 **9 行/8 文件**（逐条分类后出库集活引用 0）；法2 目录级消费者
  28 行（`check-pr-budget.sh:407` OUTBOUND_ALLOW_RE 含 `docs/archive/`；其余落 mktemp 沙箱或历史件）。
- doc-registry：`doc-registry-gate.sh` 的 EXCLUDE 含 `/archive/`，且只检 `\.(md|yaml)$` 新增
  ⇒ 删除 `docs/archive/**` 门禁中性；证据用 `.json` 亦不入检。
### c) 决策
复用 B1/B2「承接后移出」范式；口径拣 **md-only 18**（C1 CI 成本 2min vs 35min；C2 12 件 `.ts` 的
删除会在 `extensions/**` 留悬空注释 = 越出本卡写集）。**形态拣拆两 PR（OPT-1）**：PR-1 纯删 18 件，
PR-2 证据/brief/卡/Note —— 因 D1028 出库豁免要求「纯删除」，与「证据同 PR」互斥（实测 exit 1）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **铁律 0-5 / 审计红线**：不改 `scripts/audit/**`、不写审计标准、禁自我审计。
- **memory D1047-R**：目录级消费者对精确路径 grep 不可见 ⇒ 引用复核**必须双法并用**（照做）。
- **memory D1044-B1 / D1050-B2**：承接先行 + 逐件 sha256；证据用 `.json`；回退用 `git rm -r -f`。
- **D733 ② 单域硬规则**：B6 与 CARD-A 的原子性要求与其直接冲突 ⇒ 不是执行方能绕的，交 CTO 裁决。
- 参考：第一性原理（不可逆动作须有等价副本）+ Anthropic（判别性演练）+ 开源实证（先承接后移出）
  + 收敛（复用 B1/B2 范式）→ 结论：md-only 18 出库、拆两 PR；两条阻断项只出证据。

## Q2: 范围 — 正确的最简方案
做什么：
- 按排除后清单（N=18）逐件 `git rm` `docs/archive/*.md`（**逐个文件，禁 `-r` 整目录**）
- 落 6 个证据 `.json` 到 `docs/synova/product-lines/evidence/D1054/`

不做什么：
- 不改 scripts/audit/（K3 红线）
- 不改 scripts/control-tower/check-ownership.py（域校验器本体，红线）
- 不改 scripts/control-tower/check-pr-budget.sh（门禁脚本，红线）
- 不改 scripts/pre-commit-check.sh（门禁脚本，红线）
- 不改 .github/workflows/ci.yml（CI 配置，红线）
- 不改 scripts/archive/gen-survey.py（B6 对象，🔴 跨域阻断，只取证）
- 不改 tests/control-tower/grep-oP-regression.test.sh（B6 棘轮清单所在，🔴 跨域阻断，只取证）
- 不改 docs/plans/2026-09-19-D819-自验记录.md（CARD-A 对象，🔴 跨域阻断，不 mv）
- 不改 docs/plans/2026-09-19-D819-改动清单.md（CARD-A 对象，🔴 跨域阻断，不 mv）
- 不改 docs/synova/coordination/小队模式-固化件-v1-20260919.md（CARD-A 对象，不改 :4）
- 不改 docs/synova/coordination/ownership.yaml（归属规则，须 CTO+K3）
- 不改 task-state/D488.json（CARD-B 对象，只给判据）
- 不改 task-state/D491.json（CARD-B 对象，只给判据）
- 不改 task-state/D492.json（CARD-B 对象，只给判据）
- 不改 docs/archive/sentinels/**（12 件 .ts 留仓，另批）
- 不 push（队长统一一次推）

## Q3: 验收 — 入口 → 交互 → 结果
入口：队长执行 `bash /tmp/d1054-archive.sh` 承接 18 件 → 本卡逐件 `git rm` → 三闸回执 → commit。
处理：① 双法引用复核 → ② 口径判定（md-only 18）→ ③ 保形承接 + 逐件 sha256 对账
→ ④ 逐件移出 + 门禁；§B/§C/§D 三条只读取证。
结果：主仓 `docs/archive/` 剩 12 件 `.ts`（18 件 md 已移出）；6 个证据 `.json` 落
`docs/synova/product-lines/evidence/D1054/`；三闸回执原文入 A-03。

## 架构层:
scripts（控制塔）

## Done 标准
- [ ] verify: `shasum -a 256` 逐件对账承接件 → 18/18 全等
- [ ] verify: `grep -nF -f /tmp/d1054-archive-md.txt -r scripts tests .github` → 0 行（出库集零活引用）
- [ ] verify: `DOC_TRUTH_ROOT=. bash scripts/doc-system/doc-registry-gate.sh` → exit 0 / 0 未登记
- [ ] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh` → exit 0（13 组）
- [ ] verify: `bash scripts/control-tower/check-pr-budget.sh` → exit 0
- [ ] verify: `git ls-files 'docs/archive/**' | wc -l` → 30 − 18 = 12 精确闭合
