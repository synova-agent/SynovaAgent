#CRITERIA: D
# Task Brief: 12 份域级守则件落库 —— PR2 治理线 3/4（.gitea/AGENTS.md 待裁）

> 生成: 2026-10-13 | 分支 feat/agents-md-governance | base local-main @ d2e43b3fb（开工实测重锚）
> 派单件（为准）: handbook 派单件/2026-10-13-派单-12份域级件落库.md（CTO 授权"跨域代笔"，范围 = §二 的 11 份 + 3 PR 划分）
> 上游: 草稿 12/12 齐（handbook 域级件草稿/12份-2026-10-13/）；承载包行已对齐根件 §0（37876ab）
> 🔴 权威源: 根件 AGENTS.md §0 的"归属"列（不引 路径所有权.md —— 它缺 5 份）
> 判据源: CTO 裁定 079 / 081 / 085 / 089
> 🔴 **本 PR 只落 3 份** —— 第 4 份 `.gitea/AGENTS.md` 被 **DOC-CONTRACT 闸 3** 拦下（见 Q4），按派单件停止条件 ④ **停、报**，不硬落。
> 🔴 **本 PR 含 2 处"落库受控改动"**（逐条附原始门禁输出，见 Q4）：① 新增 3 份登记进 `DOCS-REGISTRY.yaml`（D782 D2 硬要求）；② 追加决策 Note（D395-a/D534 Note 引用门禁硬要求 —— 本 PR 命中 `scripts/control-tower/` 治理脚本区）。

---

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图涉及的路径面

根件 AGENTS.md §0 已立"域级守则索引"（12 行，状态 = ⚠️ 待建）。本 PR 落其中**治理线 4 份里的 3 份**：
门禁/控制塔脚本面、控制塔测试面、文档体系面。
本批**不实现任何产品能力**，只把已过独立复核的草稿逐字落进各自目录。

### b) 文件审计（实测，本 worktree，as_of local-main@d2e43b3fb）

    ABSENT scripts/control-tower/AGENTS.md
    ABSENT tests/control-tower/AGENTS.md
    ABSENT docs/AGENTS.md
    （第 4 份 .gitea/AGENTS.md 同样 ABSENT —— 但被 DOC-CONTRACT 闸 3 拦，见 Q4）

逐件 `git cat-file -e` 实测全为新增；本批不改任何既有守则件。

### c) 决策

**逐字落库**，承载包行一字不动（3 份均声明"（与根件 §0 表逐字一致）"，已实测与 §0 一致）。
本 PR 3 份**均不含**"包编号小者优先"字样 ⇒ 裁定 089 的性质标注落在 PR1 的 4 处，不在本 PR。

## Q1: 调研 — 业界最佳实践 / 决策链 / 历史教训

- **Anthropic 基线**：指令分层（root-level + 就近目录），就近者更具体 ⇒ 域级件只写本域。
- **第一性原理**：单份 ≤3.5KB 是注入预算的算术结果（根件 65,536 B 硬上限），不是风格偏好。
- **本仓判例**：DOC-CONTRACT §3 入库闸决定本批能否落库 —— 逐条实测（Q4），**不猜、不绕**。

## Q2: 范围 — 正确的最简方案

做什么
- scripts/control-tower/AGENTS.md
- tests/control-tower/AGENTS.md
- docs/AGENTS.md
- docs/authority/DOCS-REGISTRY.yaml
- memory/notes/proposed/2026-10-13-agents-md-governance-luoku.md
- .claude/task-briefs/2026-10-13-agents-md-governance.md

不做什么
- 不改 .gitea/AGENTS.md
- 不改 memory/notes/AGENTS.md
- 不改 extensions/sentinels/AGENTS.md
- 不改 src/l4/AGENTS.md
- 不改 src/routes/AGENTS.md
- 不改 src/agent/AGENTS.md
- 不改 src/l3/AGENTS.md
- 不改 expert/AGENTS.md
- 不改 scripts/audit/
- 不改 docs/synova/coordination/施工项登记.ts
🔴 根件 AGENTS.md（仓库根）属 CTO 域，本批写集不含它（§0 的"待建→在库"由 CTO 改）。
- 不改 .gitea/workflows/local-gates.yml
- 不改 scripts/pre-commit-check.sh
- 不改 docs/synova/DOC-CONTRACT.md

## Q3: 验收 — 入口 → 交互 → 结果

**入口**：`git ls-tree -r <head-sha> --name-only | grep AGENTS.md`（量真值用 ref，不用工作树）
**交互**：逐份跑判据（尺寸/行数/三问/承载包节/与根件重复/与 §0 承载包行一致）
**结果**：3 份在库 + 判据 6/6 全绿 + 回执逐份给"路径 × 字节 × 行数 × 所属 PR"

### 验收项（逐字来自派单件 §四）

| # | 判据 | 兑现 |
|---|---|---|
| V1 | `test "$(wc -c < <件>)" -le 3584` | 逐份跑，留输出 |
| V2 | `test "$(wc -l < <件>)" -le 60` | 逐份跑，留输出 |
| V3 | 三问齐（是什么／谁改／怎么算完成，各 ≥1） | `grep -c` 三类标题 |
| V4 | `grep -q '承载包' <件>` | 逐份跑 |
| V5 | 与根件零重复（不得有连续 2 行与根件相同） | 连续行比对 + 抽 3 行 |
| V6 | 承载包行与根件 §0 表一致（不一致 ⇒ 停，别自行改） | 逐份 ✅/❌ |

## Q4 契约与测试 — 落库前置门禁实测（本 PR 缩围的全部原因）

### 4.1 DOC-CONTRACT 闸 3 拦下 `.gitea/AGENTS.md`（⇒ 停止条件 ④）

    $ bash scripts/control-tower/check-doc-contract.sh --files scripts/control-tower/AGENTS.md \
        tests/control-tower/AGENTS.md docs/AGENTS.md .gitea/AGENTS.md
    [FAIL] 闸 3 · 入库闸（md+html）  (核 4 件)
           - .gitea/AGENTS.md -- 不在契约 §3 白名单内
    RC=1

**根因（可核）**：`.gitea/**` 不在白名单；`**/AGENTS.md` 是"同址代码文档豁免"，**须同址有代码**；
`validate_doc_contract.py:229 colocated_with_code()` 判据 = 父目录内 **≥1 个直接子"非文档文件"**。
`.gitea/` 只有子目录 `workflows/`（其下 `local-gates.yml`），**无任何直接子文件** ⇒ 判不放行。
另 3 份：`docs/**` 走白名单前缀；`scripts|tests/control-tower/` 同址均有直接非文档文件 ⇒ 放行。

**处置**：**不改门禁**（红线）。按 §五-④「要改门禁 ⇒ 停，报」⇒ 本 PR 只落 3 份，第 4 份转"待裁"。

### 4.2 D782 D2 登记门禁要求登记新增 3 份

    ❌ 未登记: scripts/control-tower/AGENTS.md / tests/control-tower/AGENTS.md / docs/AGENTS.md
    ❌ 登记门禁阻断  RC=1

本 PR 因此追加 `docs/authority/DOCS-REGISTRY.yaml` **3 条**（DOC-0199 / DOC-0200 / DOC-0201）。
依据：门禁错误信息自身点名落点；且本次落库的 12 份之一 `docs/AGENTS.md` 正文即写
"新文件须登记 `docs/authority/DOCS-REGISTRY.yaml`" ⇒ 登记是落库的**必备伴随动作**。
🔴 **id 段刻意跳号**（PR1 用 0193–0198）⇒ 两 PR 合并次序任意，均不撞号。

### 4.3 D395-a/D534 Note 引用门禁命中（⇒ 受控改动 ②）

    $ git commit …   （首轮，未引用 Note）
    ❌ D395-a/D534 Note 引用门禁: 非平凡变更的 commit 必须引用 Note 路径
       本次 commit 改动命中治理脚本区/规则文档区（scripts/{control-tower,workflow,hooks}/ …）:
         - scripts/control-tower/AGENTS.md

**根因（可核）**：`commit-msg-check.sh:249` 触发判据 = 暂存文件匹配
`^(scripts/(control-tower|workflow|hooks)/|src/orchestrator/|AGENTS\.md$|CLAUDE\.md$|memory/notes/README\.md$)`。
本 PR 的 `scripts/control-tower/AGENTS.md` 命中 ⇒ 必须①commit message 含 `memory/notes/` 或 `decisions/` 引用
②被引用 Note 文件真实存在（`commit-msg-check.sh:250-273`）。
**处置（不改门禁）**：追加 `memory/notes/proposed/2026-10-13-agents-md-governance-luoku.md`（四字段头：状态/日期/决策/理由），
commit message 引用其路径。该 Note 同时充当**本次落库的决策沉淀**（含 3 处受控改动 + 2 处待裁 + CI 假绿事实）。

## 架构层: 横切（域级守则件 · 不在 ⓪①②③④⑤⑥/−1 任一块内）

## Done 标准
- [ ] verify: `for f in scripts/control-tower/AGENTS.md tests/control-tower/AGENTS.md docs/AGENTS.md; do test "$(wc -c < "$f")" -le 3584 && test "$(wc -l < "$f")" -le 60 || echo "FAIL $f"; done`
- [ ] verify: `for f in scripts/control-tower/AGENTS.md tests/control-tower/AGENTS.md docs/AGENTS.md; do grep -q '承载包' "$f" || echo "NO-PACK $f"; grep -c '^## \(是什么\|谁改\|怎么算完成\)' "$f"; done`
- [ ] verify: `bash scripts/control-tower/check-doc-contract.sh --staged`（本 PR 3 份应闸 3 全过 RC=0）
- [ ] verify: `bash scripts/doc-system/doc-registry-gate.sh`（3 份应全"已登记" RC=0）
- [ ] 逐份核承载包行与根件 §0 一致（属本 PR 的 3 份）
- [ ] Gitea PR 的 CI 绿（success 且 pending=0，走 Gitea API 核）
- [ ] 回执落 handbook（路径 × 字节 × 行数 × 所属 PR + 未核处 + 红线自检）

## 不确定项（列出，不猜）
- `.gitea/AGENTS.md` 落点与 DOC-CONTRACT 闸 3 冲突：**本组无权改门禁**，转 CTO 裁。
- 本 PR 与 PR1 **均改 `docs/authority/DOCS-REGISTRY.yaml`**（各追加本域条目）⇒ 写集有 1 处重叠，
  合并第二个 PR 时需 D334 `git merge gitea/local-main`（非 --force）。**如实披露**。
- 派单件起草时 as_of = `a3f09467e`；开工重锚实测 = `d2e43b3fb`（远端已推进，本批按新 ref 落）。
