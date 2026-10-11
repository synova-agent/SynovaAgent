# Task Brief: 2026-10-11-gate-base-regression — D782 D2 base 链回归护栏（补测试）

> 卡面来源: 创始人 2026-10-11 第 3 步「『base 半支无回归护栏』→ **立卡**」
> 母项: PR #250（D782 D2 登记门禁两处同改）的**已知缺口**（由 reviewer-d782 独立复核指出，Lead 确认）
> 架构基准: 不适用（控制塔/门禁域）
> 纪律: 缺字段问 CTO，不许猜

#CRITERIA: D

## 〇、为什么要做这个（通俗版 · 先读这一节）

① **一句话** —— 给 D782 D2 门禁的「基准该指哪个分支」这半边**配一把能改坏的尺子**；
   现在这半边**没有任何测试能判它死活**。

② **解决什么问题** —— PR #250 把 `doc-registry-gate.sh` 的 base 链从 `origin/main` 前置为 `origin/local-main`，
   但**现有 22 例测试无一能区分 base 链是否前置**：夹具靠**自带的 `main` 分支**解析 base，
   改 base 链在夹具里是 **no-op**（实测：用 base 变体跑全套仍 `20 通过 / 2 失败`，与旧脚本同分）。
   ⇒ **把 base 链删掉/改回去，22 例全绿** ⇒ 回归护栏为零。

③ **做完对项目的推动** —— 「基准过期」是**本仓已四次同族事故**（D734 / CI vitest / **D782 D2** / D331，
   见 `docs/synova/coordination/基准硬编码点清单-20261011.md`）的共同病根。本卡为**已修的那一处**
   补上"改坏即红"的护栏，防止第五条。

④ 🔴 **不做行不行** —— **可以做，但代价明确**：不做不会立刻坏（现状已绿），
   代价是**任何人把 base 链改回 `origin/main` 都不会被发现**，同族第五次事故将无人拦。
   ⇒ 这是**欠账级**（不是安全底线），优先级低于新能力卡。

⑤ **现在有什么基础** —— ✅ `tests/doc-system/doc-registry-gate.test.sh` 已有 22 例（含 CI 形态 / evidence 豁免 /
   base 不可解析降级）✅ `doc-registry-gate.sh` 的 base 链已是 `origin/local-main → origin/main → main → origin/HEAD`
   ❌ **无任何用例能因 base 未前置而变红**

⑥ **还需要做什么** —— 见 Q2（在既有测试文件里加一条**专用的「分叉夹具」用例**）

⑦ **DSH 借鉴方式** —— **自研**：DSH 无「镜像分支 vs 集成分支」的双分支拓扑 ⇒ 无此问题，
   亦无对应测试范式 ⇒ 诚实标注，不给 DSH 证据。

⑧ **涉及代码文件** —— `tests/doc-system/doc-registry-gate.test.sh`（**唯一**写集）
   ＋ 判据源 `scripts/doc-system/doc-registry-gate.sh`（只读）

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
控制塔/门禁域。D782 = 「文档真相防线 D1/D2」；本卡只补 **D2 登记门禁** base 半支的**测试**，不改门禁逻辑。

### b) 文件审计（as_of `local-main=2673166b6`）
| 件 | 现状 | 处置 |
|---|---|---|
| `tests/doc-system/doc-registry-gate.test.sh` | 137+ 行；H1–H6 + W1–W2；夹具建在 `$FIX/ci-form` 等 | **扩展**（加 H7 分叉夹具用例） |
| `scripts/doc-system/doc-registry-gate.sh` | base 链 `:67` 已前置 `origin/local-main` | **只读**（不改） |
| `tests/doc-system/` 其他测试 | doc-truth / doc-categories 等 | 不改 |

### c) 决策
**扩展**既有测试文件（不新建测试文件 —— 同一门禁的护栏应同址）。

## Q1: 调研 — 依据

### a) 缺口的实证（reviewer-d782 独立复核 + Lead 复现）
```
$ SYNO_DOC_GATE_SRC=<base变体> bash tests/doc-system/doc-registry-gate.test.sh
  ⇒ 20 通过 / 2 失败（与旧脚本同分）    ← base 变体在夹具里是 no-op
```

### b) 用例设计（本卡的核心，必须机器可判）
**夹具必须让 `origin/main` 与 `origin/local-main` 出现在 `merge-base` 的**两侧****：
1. `git init` 建夹具仓，提交 `base`（内含已登记文档）
2. 建分支 `local-main`，在其上加一个**已登记的**文档、提交
3. 切回 `main`，在**其上**（`main` 之后）加一个**未登记**的 `.md`、提交
4. 建分支 `feature`（从 `main` 起），加一个**已登记**的文档、提交
5. 设 refs：`refs/remotes/origin/main` = main 头；`refs/remotes/origin/local-main` = local-main 头
6. 跑门禁（`DOC_TRUTH_ROOT=夹具`）：
   - **base 前置 `origin/local-main`** ⇒ `merge-base = local-main` ⇒ range **不含** main 上加的未登记件 ⇒ **exit 0**
   - **base 仍是 `origin/main`** ⇒ `merge-base = main` ⇒ range **含**那个未登记件 ⇒ **exit 1 且点名它**

### c) 反例自证（V-08 硬要求）
把 `SYNO_DOC_GATE_SRC` 指向**只把 base 链改回 `origin/main` 的变体** ⇒ **本条用例必须红**。
（本卡交付时必须附这次"改坏即红"的原始输出。）

## Q2: 范围
做什么：
- tests/doc-system/doc-registry-gate.test.sh
不做什么：
- 不改 scripts/doc-system/doc-registry-gate.sh — 门禁逻辑已由 PR #250 落地，本卡只补测试
- 不改 scripts/pre-commit-check.sh — 门禁语义，归 CTO
- 不改 scripts/control-tower/check-bypass-log.sh — D331 归"基准统一"治理项（创始人已明令不单独动）
- 不改 docs/authority/DOCS-REGISTRY.yaml — 无新增文档

## Q3: 验收 — 入口 → 交互 → 结果
入口：`bash tests/doc-system/doc-registry-gate.test.sh`
处理：建分叉夹具仓 → 设两个 origin refs → 跑门禁（两种 base 变体）
结果：
- 正常：`bash tests/doc-system/doc-registry-gate.test.sh` ⇒ **exit 0**（含新用例）
- 改坏即红：base 变体 ⇒ **新用例失败**（点名未登记件）

## 架构层
不适用（控制塔/门禁域）。**代码层**：不涉 L1–L5。

## 写集
- tests/doc-system/doc-registry-gate.test.sh
- .claude/task-briefs/2026-10-11-gate-base-regression.md

## Done 标准
- [ ] verify: `bash tests/doc-system/doc-registry-gate.test.sh` ⇒ rc=0（用例总数 > 22）
- [ ] verify: 改坏即红 —— `SYNO_DOC_GATE_SRC=<base-only-origin-main 变体>` 跑 ⇒ **rc=1 且新用例被点名**
- [ ] verify: 新用例**不依赖**夹具自带的 `main` 分支解析路径（即：夹具里 `origin/main` 与 `origin/local-main` **指向不同提交**）
