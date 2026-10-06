# 决策 Note — FIX-004 A（承 D964）：写集豁免从路径级 glob 收紧为「精确键 + 仅真重命名」

- 状态: proposed（**门禁语义变更 ⇒ K3 复审通过前不得合并**）
- 日期: 2026-09-26
- 卡: 台账 FIX-004 A（P0）｜承接 D964（`task-state/D964.json` k3_required 含本文件）｜分支：`fix/fix004a-writeset-exempt-abuse`（stacked，base = `chore/cto-doc-slim-phase1-writeset-exempt` @ `b8573c7a`）
- 决策: `merge_writeset_gate.py` 的两条路径级内置豁免收紧为 —— ① `docs/synova/audit-reports/INDEX.md` **精确键**；② `archive/**` **仅对 `git diff --find-renames` 的 R 条目**放行（源/目标需有一端在 `archive/` 前缀内）。

## 依据（可核）

- K3 定罪（`docs/synova/coordination/K3审计请求-D964-门禁语义变更-20260925.md` §二 A）：豁免是**路径级**（glob），不检查文件内容或来源 ⇒ 需判定可否被夹带利用。
- verifier 三项复现 + 台账复核记录 004 = ✅。
- 本卡实测（修前，沙箱原始输出见 evidence §1）：`docs/synova/audit-reports/evil.md` → **rc=0 静默豁免**；`archive/junk/new.md`（新增非重命名）→ **rc=0 静默豁免**；而真 `git mv docs/a.md archive/docs/a.md` → **rc=1 误判夹带**（源路径被点名）——即「该拦的没拦、该放的误伤」。

## 关键设计决定

1. **可枚举 > 路径级**：豁免只留**一个精确对象** `INDEX.md`（跨任务公共登记产物）；同目录其余 150 个文件不再自动豁免。
2. **「移动」与「新增/改写」的物理分界 = git R vs A/D**：归档豁免必须取 `--name-status --find-renames`（既有 `changed_files` 用 `--no-renames`，物理上取不到 R）。
3. **fail-closed**：取重命名集失败 → `degraded` exit 2（不静默当"无重命名"，否则真 `git mv` 全被打成夹带 = 大批假红）。
4. **两侧都放行**：R 的**目标**（进归档的新路径）与**源**（被移动走的旧路径）都豁免，否则真归档 PR 仍被源路径卡住（修前实测的误伤）。
5. **只改判据收紧方向**：不放宽任何既有声明源、不动 `## 写集豁免` 机制、不动分支级豁免与文档范围降级。

## 参考系

第一性原理（豁免必须可枚举，否则不是豁免而是放行口）＋ Anthropic 工程基线（变异体改坏即红 + 降级不冒充通过）＋ 仓内先例（D861：豁免必须逐条打印可粘贴精确路径；D964 K3 请求要求 K3 自造反例）→ 结论：精确键 + 仅 R + 成对反例 + 失败 fail-closed。

## 夹具（改坏即红，可复跑）

```
bash tests/control-tower/merge_writeset_gate.test.sh     # 58 通过 / 0 失败
```
关键成对反例（沙箱，零真实仓库改动）：
- ⒜ `docs/synova/audit-reports/INDEX.md` → rc=0（精确键豁免，打印理由）
- ⒝-1 `docs/synova/audit-reports/evil.md` → **rc=1**（修前 rc=0）
- ⒝-2 `docs/synova/audit-reports/secret.ts`（复制 src 进去）→ **rc=1**（源与副本双点名）
- ⒝-3 新增 `archive/junk/new.md` → **rc=1**（修前 rc=0）
- ⒝-4 `git mv` 后大幅改写（git 判 A+D 非 R）→ **rc=1**
- ⒜-2 纯 `git mv docs/legacy2.md archive/legacy2.md` → **rc=0**（修前 rc=1，误伤修复），源与目标两侧均打印豁免
- 变异体：把精确键改回 glob → 立即放行 evil.md（证明收紧确有判别力）

## blast radius（实测）

- `docs/synova/audit-reports/` tracked = **151 文件**；收紧后仅 `INDEX.md` 豁免，其余 150 个**在变更集里出现时**需声明/豁免（本仓约定「审计报告全文落 K3 独立仓，本仓只落 INDEX.md」，且该目录属禁碰域 → 预期零实际影响）。
- 顶层 `archive/` tracked = **0 文件**（D964 阶段 4 实际归档到 `.claude/task-briefs/archive/**`，属 `.claude/` 文档范围，不受本改动影响）。
- 调用方：`.github/workflows/ci.yml:99-103`（PR job 单点）；本地无其它调用方（`grep -rn merge_writeset_gate` 见 evidence）。
