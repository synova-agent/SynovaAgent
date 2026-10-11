# Task Brief: fix/d782-gate-base — D782 D2 登记门禁两处同改（base 口径 + 扩展内容 yaml 豁免）

> 卡面来源: 创始人 2026-10-11 开工令 §第 1 步（①②③）｜ 命中本卡的：① ② ③（base 清点部分）
> 架构基准: 本卡不涉产品架构（属**控制塔/门禁**域）｜ 机器真源: 无登记件条目（创始人口头令 + 本卡）
> 纪律: 遇模糊停下上报；不改判据以外的东西

#CRITERIA: D

## 〇、为什么要做这个（通俗版 · 先读这一节）

① **一句话** —— 修一个"看错了基准日期"的门禁：它本该问"你这张 PR 新加了哪些文档没登记"，
   实际却问"从**几天前**某个旧点到现在，**所有人**新加了哪些文档没登记"，于是每张 PR 都必红。

② **解决什么问题** —— K12 批 2 三张 PR 的 CI **全部**在 step ① 硬红，合并门条件①永不满足
   （实测 run 116/121/125）。根因不是谁写错了代码，是**门禁基准过期**。

③ **做完对项目的推动** —— 解锁的不只是批 2：**任何新增 `extensions/**` 内容文件的卡都会撞**这道门
   （内容面是宪章第一优先 2.7 的载体），不修则整条内容面路线过不了 CI。

④ 🔴 **不做行不行** —— **不行**（不是"可以做但有代价"）：
   门禁基准是**全局单点**，它红 ⇒ 三张 PR 永远拿不到绿 ⇒ 合并权四条件①结构性不可满足。

⑤ **现在有什么基础** —— ✅ `doc-registry-gate.sh` 已有三源扫描 + 已有配对测试 `tests/doc-system/doc-registry-gate.test.sh`
   （18 例全绿）✅ 同病的 CI `vitest --changed` 已修（`local-gates.yml` 用 `CHANGED_BASE=origin/local-main`）
   ❌ base 链写死 `origin/main` ❌ `EXCLUDE` 不含 `extensions/`

⑥ **还需要做什么** —— 见 Q2（两处 + 配对测试 H5/H6 + 全仓基准点清单）

⑦ **DSH 借鉴方式** —— **自研**：DSH 无对应物（DSH 是单机单用户、无"集成分支 vs 镜像分支"的双分支拓扑，
   故无"基准该指哪个分支"的问题）⇒ 诚实标注，不给 DSH 证据。

⑧ **涉及代码文件** —— `scripts/doc-system/doc-registry-gate.sh`｜`tests/doc-system/doc-registry-gate.test.sh`
   ｜`memory/notes/implemented/2026-10-11-d782-gate-stale-base-and-content-exempt.md`

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本卡在**控制塔/门禁域**（非产品五层）。D782 = 「文档真相防线 D1/D2」，
本卡只动 **D2 登记门禁**（新增 `.md/.yaml` 须登记 `docs/authority/DOCS-REGISTRY.yaml`）。
该门禁在 `pre-commit-check.sh:1466` 用 `soft_check`（本地软提示）⇒ `SYNO_CI=1` 时**转硬**。

### b) 文件审计（as_of `origin/local-main=8a0fea89f`）
- `scripts/doc-system/doc-registry-gate.sh`（107 行）：源③ base 链在 `:67`；`EXCLUDE` 在 `:46`
- `tests/doc-system/doc-registry-gate.test.sh`（137 行）：H1-H4 覆盖 CI 形态/补登记/evidence 豁免/base 降级
- 台账 `docs/authority/DOCS-REGISTRY.yaml`：61 条，**`extensions/` 条目 = 0**

### c) 决策
**扩展**（两处精确改 + 补两例测试），不新建、不替换。

## Q1: 调研 — 依据

### a) 实测复现（CI 等效仓，非推断）
```
# 绿（local-main @ 22360836f1a）: base=origin/main merge-base=5a6591c4 ⇒ 检查 2 件/0 未登记 ⇒ EXIT=0
# 红（K12-20 @ d0775ab14）    : 同基线                       ⇒ 检查 4 件/3 未登记 ⇒ EXIT=1
```
### b) 两个 HEAD 的 merge-base **同为** `5a6591c4a` ⇒ 源③ range 覆盖 `5a6591c4a..HEAD` 的 **73+** 提交
⇒ 把他人已合并提交里新增的 `.md/.yaml` 一并索登记。

### c) memory / 同型事故
- 本仓**同病三处**：CI `vitest --changed`（已修）｜D331 push 对账基（在飞）｜**本项**（本次修）
- `docs/synova/product-lines/evidence/` 曾遇**同型**（逐条登记会改共享台账 = 写冲突机器）
  ⇒ 处置是**加 EXCLUDE 豁免**。本卡沿用同一判例，并按创始人令**收窄到 `.yaml|.yml`**（不含 `.md`）。
- 参考：Anthropic 决策链（把"基准"与"判据"分开）＋ 第一性原理（门禁该问"你的改动"，不该问"历史窗口"）。

## Q2: 范围

做什么（**裸路径逐条** —— 门禁字面匹配，glob 恒不中）：
```
scripts/doc-system/doc-registry-gate.sh
tests/doc-system/doc-registry-gate.test.sh
memory/notes/implemented/2026-10-11-d782-gate-stale-base-and-content-exempt.md
.claude/task-briefs/2026-10-11-d782-gate-stale-base.md
```
- scripts/doc-system/doc-registry-gate.sh — `:67` base 链前置 `origin/local-main`（回退链保留）；
  `:46` EXCLUDE 增 `^extensions/.*\.(yaml|yml)$`（不含 `.md`）；`:32` `:78` 文案同步
- tests/doc-system/doc-registry-gate.test.sh — +H5（内容 yaml 豁免 ⇒ exit 0 且不进检查面）
  +H6（同目录 `.md` 不豁免 ⇒ exit 1，守住豁免边界）
- memory/notes/implemented/2026-10-11-d782-gate-stale-base-and-content-exempt.md — 铁律49 Note

不做什么（含文件路径）：
- 不改 `scripts/pre-push-check.sh` — D331 属**判据设计**变更（D508 注释记录真实副作用），须 CTO 裁
- 不改 `scripts/control-tower/check-pr-budget.sh` — 已前置 `origin/local-main`（`:163`），仅注释陈旧
- 不改 `src/**`；不改四张 K12 卡的分支与写集
- 不改 `docs/authority/DOCS-REGISTRY.yaml`（走豁免口径，**不逐条登记**）
- 不改 `scripts/pre-commit-check.sh`（D782 调用点无语义问题）

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash scripts/doc-system/doc-registry-gate.sh`（CI 内由 `pre-commit-check.sh` 在 `SYNO_CI=1` 下调用）
处理：三源扫描 → 源③ base 解析 → 逐文件查台账 → 未登记则 exit 1
结果：
- **本地判据**：`bash tests/doc-system/doc-registry-gate.test.sh` ⇒ **exit 0（22 例）**
- **改坏即红**（自证）：旧脚本 + 新测试 ⇒ **H5 红 2 处**、H6 绿（边界守卫）
- **CI 判据（本次最终）**：三 PR 的 `job.conclusion` = success 且 **pending=0**
- **门禁仍有牙**（不得"一锅端"）：`extensions/**/*.md` 未登记 ⇒ 仍 exit 1

## 架构层

不适用（控制塔/门禁域，非产品架构块 ⓪–⑤/⑥/−1）。**代码层**：不涉 L1–L5。

## 写集

```
scripts/doc-system/doc-registry-gate.sh
tests/doc-system/doc-registry-gate.test.sh
memory/notes/implemented/2026-10-11-d782-gate-stale-base-and-content-exempt.md
.claude/task-briefs/2026-10-11-d782-gate-stale-base.md
```

## Done 标准

- [ ] verify: `bash tests/doc-system/doc-registry-gate.test.sh` ⇒ rc=0（22 例）
- [ ] verify: 改坏即红 —— 旧脚本跑新测试 ⇒ H5 报错（已实测：`18 通过 / 4 失败`，H5 两行红）
- [ ] verify: `git diff --name-only origin/local-main...HEAD` 仅含本卡写集 4 件
- [ ] CI：三 PR `job.conclusion=success` 且 pending=0（**不再红**）
