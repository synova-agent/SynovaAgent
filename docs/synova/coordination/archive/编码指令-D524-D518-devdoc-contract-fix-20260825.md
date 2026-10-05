# 编码指令 — D524：D518 dev doc prod 契约返修核验（K3 C2 闭环）

> 本指令随 dev doc 交付给编码 session。**认真阅读任务文档，然后执行任务。**
> 派单: docs/synova/coordination/派单-D524-devdoc-fix-20260825.md（CTO 派单，K3 C2 条件项）
> 审计: Kimi K3 会盯着你的任务——C2 复审只核两项（grep 清零 + 三处回填），本任务产出即这两项的**物理复跑证据**。

---

## 一、任务文档（必读，先读后动，读不完不动手）

| 文档 | 路径 | 作用 |
|---|---|---|
| **D524 spec（本任务）** | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D524-devdoc-contract-fix-20260825.md` | **编码唯一契约**——D524 返修规格（§5 写集 / §7 验证命令 / §10 DS） |
| D518 spec（被返修对象） | `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D518-single-entry-20260824.md` | 已回填 `dist/backend.mjs` + `ELECTRON_RUN_AS_NODE=1`（commit 532aaa41）——核验对象 |
| 派单 | `docs/synova/coordination/派单-D524-devdoc-fix-20260825.md` | 问题定义/验证命令/写集约束/完成动作 |
| K3 切片 A 审计 | `docs/synova/audit-reports/2026-08-25-D517-D519.md`（P1-1） | 前车之鉴：M7 文档-实现漂移，照 spec §7 旧断言写测试会红 |
| 北星 | `.claude/PRODUCT-BRIEF.md` §二/§六 | 产品方向锚点（FDE 零 Node 前提） |

## 二、执行要求（做到你的最高代码水平）

1. **认真阅读** D518 spec 的 §1（Authority）/ §4（Current State）/ §5.1（写集）/ §7（Test Requirements）/ §10（DS 验收）——spec 是唯一契约，声称即引用。
2. **任务简单（核验为主）→ 不强制 plan mode**，但动代码前仍须列出改动清单（若发现需改，见 §三-3 上报流程）。
3. **最高代码水平**：类型安全（`as any`=0，铁律 38）、契约优先（铁律 47）、降级诚实（铁律 24/31）、测试非空壳三路径（铁律 48）——若核验中发现需要补测试，按此标准。

## 三、D524 专属硬约束（违反 = 审计 FAIL）

1. **本任务性质 = 契约核验，不是实现**：D518 实现已在 main（buildCommand prod=backend-spawn.cjs:70、ELECTRON_RUN_AS_NODE=1 注入 :172、测试断言 :234-235）。你的核心交付是**照返修后 spec §7 跑测试并证明"不红"**——即 M7 漂移闭环的物理证据。
2. **基线核验（防 D524 M7 漂移再犯）**：开工前 `git fetch --all && git pull --ff-only`，确认 `docs/d524-devdoc-fix` 分支已合入 main（D524 提交 532aaa41 + 77bdaa8c）；合入后**重新核验 spec 引用的行号/契约**（backend-spawn.cjs:70/172、backend-spawn.test.ts:234-235 均实测过，若 main 行号再漂移以磁盘事实为准并回填 spec——这是 D524 教训：照旧行号写测试会红）。
3. **写集精确性**：D524 派单写集 = 仅 D518 dev doc + task-state/D524.json，**均已交付**。你**默认零代码改动**；仅当核验发现实现与 spec 真漂移时，上报 CTO（不擅改）——若 CTO 确认修，改动清单须先列、`git diff --name-only` 与实际改动完全一致。
4. **诚实 RED**：`npx vitest run tests/electron/backend-spawn.test.ts` 若红——如实记录是哪条断言红 + 截图/日志原文，**禁止用契约断言冒充全链路绿、禁止伪造证据**。
5. **evidence 落盘规范**：核验命令输出（grep 结果 / vitest 输出 / 时间戳）落盘（`docs/synova/product-lines/evidence/` 或 task-state evidence 段），K3 独立重跑可复现；禁止只在对话里声称。
6. **红线（违反 = 事故）**：不碰 `scripts/audit/`（K3 专属）；不碰 `electron/`、`tests/` 的**实现逻辑**（仅核验只读）；不 `git stash`（铁律 0-3）。
7. **环境坑**：DSH 宿主默认 `ELECTRON_RUN_AS_NODE=1`——跑 Electron 实测/脚本时显式 `env -u ELECTRON_RUN_AS_NODE`（K3 切片 A 审计环境注记）。

## 四、做完之后的复核清单（逐项自查，K3 会盯着你）

1. **C2 证据项 1 — grep 清零**：`grep -n "node dist/src/index.js" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D518-single-entry-20260824.md` → **零结果**（复跑确认）。
2. **C2 证据项 2 — 三处回填**：`grep -n "dist/backend.mjs" docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D518-single-entry-20260824.md` → 覆盖 **§2/§5.1/§7**。
3. **照 §7 写测试不红**：`npx vitest run tests/electron/backend-spawn.test.ts` → 全绿（backend-spawn.test.ts:234-235 断言 `prod.bin === process.execPath` + `prod.args === ['dist/backend.mjs']` 与 spec §7 一致）。
4. **契约一致性**：`git show origin/main:electron/backend-spawn.cjs` 的 buildCommand prod（:70）+ ELECTRON_RUN_AS_NODE（:172）与 spec §2/§5.1 描述逐字一致。
5. **与 dev doc 一致 / 不违反铁律 / 无 bug / 接线完整 / 测试到位**：本任务零生产代码改动，前三项退化为"核验通过"；若有补测试，按铁律 47/48 三路径 + expect 非空壳。
6. **残留清理**：核验过程不引入新文件（证据落盘除外），临时文件清理。

## 五、K3 审计提示（收尾要求）

- 本任务是 C2 闭环核验：**审计员只核两项**（grep 清零 + §2/§5.1/§7 三处回填），你的 evidence 须让这两项一次可复现。
- 审计员会**独立重跑你的验证命令**——命令必须幂等、可复现、无本机假设。
- C2 转 PASS 后，D517/D518/D519 从 CONDITIONAL PASS 转 PASS（无需复审全量）。
- 若核验中发现新漂移并上报修复，回填 `task-state/D524.json` 的 evidence 段（commit + 证据原文）。

**开始吧。**
