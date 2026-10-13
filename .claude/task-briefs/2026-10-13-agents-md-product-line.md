#CRITERIA: D
# Task Brief: 12 份域级守则件落库 —— PR1 产品线 6/7（extensions/AGENTS.md 待裁）

> 生成: 2026-10-13 | 分支 feat/agents-md-product-line | base local-main @ d2e43b3fb（开工实测重锚）
> 派单件（为准）: handbook 派单件/2026-10-13-派单-12份域级件落库.md（CTO 授权"跨域代笔"，范围 = §二 的 11 份 + 3 PR 划分）
> 上游: 草稿 12/12 齐（handbook 域级件草稿/12份-2026-10-13/，936–1,348 B，合计 13,575 B）；承载包行已对齐根件 §0（37876ab）
> 🔴 权威源: 根件 AGENTS.md §0 的"归属"列（不引 路径所有权.md —— 它缺 5 份：extensions/ 顶层｜src/agent｜tests/control-tower｜docs｜memory/notes）
> 判据源: CTO 裁定 079 / 081 / 085 / 089
> 🔴 **本 PR 只落 6 份** —— 第 7 份 `extensions/AGENTS.md` 被 **DOC-CONTRACT 闸 3** 拦下（见 Q4），按派单件停止条件 ④ **停、报**，不硬落。
> 🔴 **本 PR 含 3 处"落库受控改动"**（逐条附原始门禁输出，见 Q4）：① 裁定 089 性质标注；② `src/routes` 红线句改写以避组 1 字面误报；③ 新增 6 份登记进 `DOCS-REGISTRY.yaml`（D782 D2 硬要求）。

---

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图涉及的路径面

根件 AGENTS.md §0 已立"域级守则索引"（12 行，状态 = ⚠️ 待建）。本 PR 落其中**产品线 7 份里的 6 份**：
哨兵面 / 本体面 / 路由面 / 编排面 / 洞察层 / 专家面。
守则件是 DSH「路径链注入」的载体（根到会话工作目录 broad-to-specific）——
根件一定注入，域级件只在工作目录经过它时注入 ⇒ **改某块前先显式打开该块守则**。
本批**不实现任何产品能力**，只把已过独立复核的草稿逐字落进各自目录。

### b) 文件审计（实测，本 worktree，as_of local-main@d2e43b3fb）

目标路径逐件 `git cat-file -e` 实测 **ABSENT**（本批全为新增，不改既有件）：

    ABSENT extensions/sentinels/AGENTS.md
    ABSENT src/l4/AGENTS.md
    ABSENT src/routes/AGENTS.md
    ABSENT src/agent/AGENTS.md
    ABSENT src/l3/AGENTS.md
    ABSENT expert/AGENTS.md
    （第 7 份 extensions/AGENTS.md 同样 ABSENT —— 但被 DOC-CONTRACT 闸 3 拦，见 Q4）

既有 `AGENTS.md` 全仓仅根件 1 份（另有 memory/notes 历史 note 文件名含该串），与本批目标零重名。

### c) 决策

**逐字落库**，受控改动只有三处（①见上"落库受控改动"；③为门禁强制，不是改草稿语义）。
其余（三问标题 / 红线 / "与根件零重复"）原样。

## Q1: 调研 — 业界最佳实践 / 决策链 / 历史教训

- **Anthropic 基线**：指令分层（root-level + 就近目录），就近者更具体；
  与 DSH 的 broad-to-specific 注入链同型 ⇒ 域级件只写本域，通用规则一律引用根件（零重复）。
- **第一性原理**：守则件唯一价值 = **被注入**。注入预算是硬约束（根件 65,536 B 上限）
  ⇒ 单份 ≤3.5KB 是"最坏账不挤掉根件"的算术结果（18.3KB + 12×3.5KB = 61,873 ≤ 65,536），不是风格偏好。
- **本仓判例**：DOC-CONTRACT §3 入库闸决定本批能否落库 —— 逐条实测（Q4），**不猜、不绕**。

## Q2: 范围 — 正确的最简方案

做什么
- extensions/sentinels/AGENTS.md
- src/l4/AGENTS.md
- src/routes/AGENTS.md
- src/agent/AGENTS.md
- src/l3/AGENTS.md
- expert/AGENTS.md
- docs/authority/DOCS-REGISTRY.yaml
- .claude/task-briefs/2026-10-13-agents-md-product-line.md

不做什么
- 不改 extensions/AGENTS.md
- 不改 scripts/control-tower/AGENTS.md
- 不改 tests/control-tower/AGENTS.md
- 不改 docs/AGENTS.md
- 不改 .gitea/AGENTS.md
- 不改 memory/notes/AGENTS.md
- 不改 scripts/audit/
- 不改 docs/synova/coordination/施工项登记.ts
🔴 根件 AGENTS.md（仓库根）属 CTO 域，本批写集不含它（§0 的"待建→在库"由 CTO 改）。
- 不改 .gitea/workflows/local-gates.yml
- 不改 scripts/pre-commit-check.sh
- 不改 docs/synova/DOC-CONTRACT.md

## Q3: 验收 — 入口 → 交互 → 结果

**入口**：`git ls-tree -r <head-sha> --name-only | grep AGENTS.md`（量真值用 ref，不用工作树）
**交互**：逐份跑判据（尺寸/行数/三问/承载包节/与根件重复/与 §0 承载包行一致）
**结果**：6 份在库 + 判据 6/6 全绿 + 回执逐份给"路径 × 字节 × 行数 × 所属 PR"

### 验收项（逐字来自派单件 §四）

| # | 判据 | 兑现 |
|---|---|---|
| V1 | `test "$(wc -c < <件>)" -le 3584` | 逐份跑，留输出 |
| V2 | `test "$(wc -l < <件>)" -le 60` | 逐份跑，留输出 |
| V3 | 三问齐（是什么／谁改／怎么算完成，各 ≥1） | `grep -c` 三类标题 |
| V4 | `grep -q '承载包' <件>` | 逐份跑 |
| V5 | 与根件零重复（不得有连续 2 行与根件相同） | 连续行比对 + 抽 3 行 |
| V6 | 承载包行与根件 §0 表一致（不一致 ⇒ 停，别自行改） | 逐份 ✅/❌ |

## Q4 契约与测试 — 落库前置门禁实测（本 PR 缩围与受控改动的全部原因）

### 4.1 DOC-CONTRACT 闸 3 拦下 `extensions/AGENTS.md`（⇒ 停止条件 ④）

    $ bash scripts/control-tower/check-doc-contract.sh --files extensions/AGENTS.md extensions/sentinels/AGENTS.md \
        src/l4/AGENTS.md src/routes/AGENTS.md src/agent/AGENTS.md src/l3/AGENTS.md expert/AGENTS.md
    [FAIL] 闸 3 · 入库闸（md+html）  (核 7 件)
           - extensions/AGENTS.md -- 不在契约 §3 白名单内
    RC=1

**根因（可核）**：DOC-CONTRACT §3 白名单的 `**/AGENTS.md` 是"同址代码文档豁免"，**须同址有代码**；
`validate_doc_contract.py:229 colocated_with_code()` 判据 = 父目录内 **≥1 个直接子"非文档文件"**。
`find extensions -maxdepth 1 -type f` = **0 命中**（该目录只有 24 个子目录、无直接文件）⇒ 判不放行。
另 6 份同址均有直接非文档文件 ⇒ 闸 3 放行。

**处置**：**不改门禁**（红线）。按 §五-④「要改门禁 ⇒ 停，报」⇒ 本 PR 只落 6 份，第 7 份转"待裁"。

### 4.2 组 1 字面误报（⇒ 受控改动 ②）

    ❌ as any / as never / as unknown as 零容忍（新增，铁律 38）: 1 处  [硬阻断]
       +后端能力≠用户可用功能（追调用链）｜ 静默降级禁止｜ `as any` 零容忍｜ 与根件零重复。

**根因（可核）**：`pre-commit-check.sh:666-673` 判据 = `git diff --cached -- src/ packages/` 的 **+ 行**匹配
`as (any|never)\b | as unknown as`（只豁免起始为 `// /* * #` 的行，**不区分 .ts/.md**）。
草稿红线句照抄铁律 38 原文（`as any` 零容忍）⇒ **放在 `src/` 下的 .md 里必然字面命中**。
同类先例：D501 曾为同型误报给该门禁加 `:(exclude)**/*.test.ts` 路径豁免（门禁变更 = CTO 域）。
**处置（不改门禁）**：该句改为 `类型断言零容忍（铁律 38：as-any 家族，原文见根件 §7）` ——
语义等价、引用根件原文，不再字面命中。**待裁**：是否给该门禁加 `:(exclude)**/*.md`（属门禁变更）。

### 4.3 D782 D2 登记门禁要求登记新增 6 份（⇒ 受控改动 ③）

    ❌ 未登记: expert/AGENTS.md / extensions/sentinels/AGENTS.md / src/agent/AGENTS.md /
              src/l3/AGENTS.md / src/l4/AGENTS.md / src/routes/AGENTS.md
    ── 汇总: 检查 6 个文档，6 个未登记 ──  ❌ 登记门禁阻断  RC=1

本 PR 因此在本件写集内追加 `docs/authority/DOCS-REGISTRY.yaml` **6 条**（DOC-0193…DOC-0198）。
依据：该门禁错误信息自身点名落点；且**本次落库的 12 份之一 `docs/AGENTS.md` 正文即写**
"新文件须登记 `docs/authority/DOCS-REGISTRY.yaml`" ⇒ 登记是落库的**必备伴随动作**，非"顺手改其它文件"。

### 4.4 其余

本批**不新增 decisions/ 件** ⇒ 闸 1/2 无对象；新增 html = 0；`.claude/task-briefs/**` 走 §9.1 过渡放行。

## 架构层: 横切（域级守则件 · 不在 ⓪①②③④⑤⑥/−1 任一块内）

## Done 标准
- [ ] verify: `for f in extensions/sentinels/AGENTS.md src/l4/AGENTS.md src/routes/AGENTS.md src/agent/AGENTS.md src/l3/AGENTS.md expert/AGENTS.md; do test "$(wc -c < "$f")" -le 3584 && test "$(wc -l < "$f")" -le 60 || echo "FAIL $f"; done`
- [ ] verify: `for f in extensions/sentinels/AGENTS.md src/l4/AGENTS.md src/routes/AGENTS.md src/agent/AGENTS.md src/l3/AGENTS.md expert/AGENTS.md; do grep -q '承载包' "$f" || echo "NO-PACK $f"; grep -c '^## \(是什么\|谁改\|怎么算完成\)' "$f"; done`
- [ ] verify: `bash scripts/control-tower/check-doc-contract.sh --staged`（本 PR 应三闸全过 RC=0）
- [ ] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh`（逐组核，除"待裁"项外无红）
- [ ] 逐份核承载包行与根件 §0 一致（属本 PR 的 6 份）
- [ ] Gitea PR 的 CI 绿（success 且 pending=0，走 Gitea API 核）
- [ ] 回执落 handbook（路径 × 字节 × 行数 × 所属 PR + 未核处 + 红线自检）

## 不确定项（列出，不猜）
- `extensions/AGENTS.md` 落点与 DOC-CONTRACT 闸 3 冲突：**本组无权改门禁**，转 CTO 裁。
- 组 1 对 `src/**.md` 的字面误报：本 PR 以改写规避；是否加路径豁免属门禁变更，转 CTO 裁。
- 本 PR 与 PR2 **均改 `docs/authority/DOCS-REGISTRY.yaml`**（各追加本域条目）⇒ 写集有 1 处重叠，
  合并第二个 PR 时需 D334 `git merge gitea/local-main`（非 --force）。**如实披露**。
- `expert/AGENTS.md` 的撤件条件由草稿自带（复测清零即撤）；复测责任线 = 工程线，**未核**。
- 派单件起草时 as_of = `a3f09467e`；开工重锚实测 = `d2e43b3fb`（远端已推进，本批按新 ref 落）。
