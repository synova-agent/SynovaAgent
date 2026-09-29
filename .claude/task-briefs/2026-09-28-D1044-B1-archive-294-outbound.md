# Task Brief: D1044 B1 — `.claude/task-briefs/archive/` 294 件出库

> 生成: 2026-09-28 | 任务: D1044 | 认领: 🧭 synova-squad-lead（DSH 小队 B1）
> 分支: `chore/b1-archive-outbound` ｜ 工作树: `.synova-wt-b1-d1044` ｜ 基线: `origin/main @ ff467712`
> 源卡: CTO 派单「B1 · .claude/task-briefs/archive/ 294 件出库（agent team 模式）」
> 参考: D333 决策四步（第一性原理→Anthropic→开源实证→收敛）

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
文档治理线（非 L1–L5 产品层）。对象 = `.claude/task-briefs/archive/` 存量任务卡 294 件。
契约依据：`docs/synova/DOC-CONTRACT.md` §7:256「`.claude/task-briefs/` 停产出；存量分流：含决策⇒抽决策文件；不含⇒出库」
＋ §9:295「移出必与接手同批」。本批 = 出库动作本身，不改任何产品代码。

### b) 文件审计（实测，file:line / 命令原始输出）

**前提冻结实测表**（队长开工前逐条亲测；原始输出落 `docs/synova/product-lines/evidence/D1044-B1/`）：

| # | 卡面前提 | 命令 | 实测输出 | 结论 |
|---|---|---|---|---|
| P1 | archive 存 294 件 | `git ls-files .claude/task-briefs/archive/ \| wc -l` | `294`（tracked / on-disk / `*.md` 三者均 294） | ✅ |
| P2 | 294/294 零引用 | `git grep -F -f <294 全路径>` + `-f <294 词干>`（`--untracked`，排除 archive 目录） | 两遍均 **0 行**（`wc -l`→0） | ✅ |
| P3 | doc-registry 需同步 0 项 | `scripts/doc-system/doc-registry-gate.sh:21` | EXCLUDE 含 `\.claude/`，另 `/archive/` 亦排除 | ✅ |
| P4 | `.claude/bypass.log` 声明 `merge=union` | `grep -n bypass.log .gitattributes` | `.gitattributes:14:.claude/bypass.log merge=union` | ✅ |
| P5 | A2（D1028/#864）已落地 | `git merge-base --is-ancestor 50f52f44 origin/main` | 成立；`50f52f44 feat(D1028): D734 PR 预算门禁「纯归档/出库」路径级豁免` | ✅ |
| P6 | 隐藏前置：G10 会报红 ⇒ 需等 A3(#862) | 注入缝实测 `SYNO_TEST_ARM=1 SYNO_GIT_CACHED_ALL_NAMES='src/probe.ts\n.claude/task-briefs/…' bash scripts/pre-commit-check.sh` | `✅ G10: 无 task brief 变更(跳过)`；且 `grep -n "STAGED_FILES\|CHANGED_FILES" scripts/pre-commit-check.sh` → **仅 4 处使用、0 处赋值**（幽灵变量） | ❌ **前提不成立**：G10 恒不触发，A3 非本批前置（已上报 CTO） |
| P7 | 前/后计数 2172 → 1878 | `git ls-tree -r --name-only <ref> \| grep -c '\.md$'` | `4afd4ce1` → **2172** ✅（与卡面一致）；`origin/main @ ff467712` → **2193** | ⚠️ 基线已漂移 +21；判据改为「同一命令 Δ = −294」 |
| P8 | 分母 ts = 509 | `git ls-files 'src/*.ts' 'packages/*.ts' \| wc -l` | `509` | ✅ |
| P9 | 预算靠「出库豁免」(#864) 生效 | `bash scripts/control-tower/check-pr-budget.sh --diff-status <301 行真实变更集>` | `ℹ️ 出库豁免不适用（ⓐ 不满足：变更含 7 件增/改）` → 实靠 **D860 治理产物豁免 300 件** → `✅ ① 变更文件数 1 ≤ 上限 12` → exit 0 | ⚠️ **机制归因错误**（结果 PASS）；`#864` 非本批必需 |
| P10 | 应走 docs-only 早退 | `.github/workflows/ci.yml:51` 白名单正则 vs 变更集 | `.md/.json/.claude//task-state/` → `docs_only=true`；**`.txt` → false（跑全量）** | ✅ 据此定证据扩展名（见下「偏离登记 D-1」） |
| P11 | 承接落点可达 | `touch ~/Synova-过程档案/.b1-write-probe` | 工作区外 → 首次 `Operation not permitted` → 提权后 `WRITE OK` | ⚠️ 承接步骤须提权执行 |

### c) 决策
复用：D1028 已确立的「声明段落 + 路径级豁免」范式（`merge_writeset_gate.py:291`）；D968/D1028 的「先承接后移出」顺序。
新建：无新门禁、无新脚本、无产品代码。
取消：无。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

- **第一性原理**：删除是**不可逆动作**（对读者而言），唯一可接受的对价是「同一 sha 的副本已在另一个独立 git 仓可读取」。故顺序必须是**先承接、后移出**，且承接以 **sha256 逐件对账**为物理证据，不以「cp 返回 0」为证据。
- **Anthropic 基线**：不可逆操作的验证必须**独立于执行者**，且回退路径要**实际演练**而非声称可用（等价于「改坏即红」的判别性夹具思想）。
- **开源实证 / 本仓既有范式**：本仓 `D1028-交付与遗留.md` L7 + `D1028-假绿专题-并卡材料.md` 已登记「门禁输入在 commit 后归零 ⇒ 检查未执行 == 检查通过」的假绿模式。本批据此**在同一工作区状态下**取门禁回执，并如实标注哪条门禁在该状态下的可见范围。
- **memory 历史教训**：铁律 37（dead code 零引用确认后才删）／铁律 49（决策 Note 四态）／M3（自验不得由编码兼任）／D312（禁 `git stash`）／D1028 §D2（`check-silent-swallow.sh --diff` 取数源是 `git diff --cached`，改工作区后须显式 `git add` 刷新索引）。
- 参考：第一性原理（不可逆动作须有等价副本 + 独立复核）+ Anthropic（判别性演练）+ 开源实证（先承接后移出）+ 收敛（复用 D1028 既有范式，不发明新机制）

## Q2: 范围 — 正确的最简方案

做什么：
- `.claude/task-briefs/archive/` 下 **N 件** `.md` 出库（删除侧逐条列于下方 `## 写集` 机器块）
- `.claude/task-briefs/2026-09-28-D1044-B1-archive-294-outbound.md` — 本 brief
- `task-state/D1044.json` — 任务登记（含删除侧 `write_set`）
- `memory/notes/proposed/2026-09-28-D1044-b1-archive-outbound.md` — 铁律 49 四态 Note
- `docs/synova/product-lines/evidence/D1044-B1/` — 证据（`.json`，见「偏离登记 D-1」）
- 仓外：`~/Synova-过程档案/出库-主仓/.claude/task-briefs/archive/**` — 承接副本（**不入主仓写集**）
不做什么：
- 不改 `scripts/audit/**`（K3 专属红线，违反=事故）
- 不改 `docs/synova/audit-reports/**`（K3 审计报告区）
- 不改 `src/**`（本批零产品代码变更）
- 不改 `scripts/pre-commit-check.sh`（G10 幽灵变量属控制塔域，本批只登记不改）
- 不改 `scripts/control-tower/check-pr-budget.sh`（D734 门禁本体）
- 不改 `.github/workflows/ci.yml`（A4 的活）
- 不改 `docs/authority/DOCS-REGISTRY.yaml`（登记台账，非本批写集；动它会跳出库白名单并破坏 docs-only 早退）
- 不改 `.claude/task-briefs/` 下**除 archive/ 之外**的任何存量 brief
- 不做「二次删除」：只删 `.claude/task-briefs/archive/`，不顺手删其他目录
- 不用 `--no-verify` / `git stash` / force push
- 不跑 vitest 全量、不跑黄金门禁（本批零 TS 变更）

## 写集

> D749 机器块 = 写集**单一事实源**（解析器 `scripts/control-tower/brief_parser.py:63` `parse_write_set`；消费方 `scripts/pre-commit-check.sh` G12）。散文 §Q2 仅作说明。
> 类：`task` = 本卡交付物；`builtin` = 运行期产物（各门禁另有豁免，不计入 include）。

| 文件 | 类 |
|---|---|
| `.claude/task-briefs/2026-09-28-D1044-B1-archive-294-outbound.md` | task |
| `task-state/D1044.json` | task |
| `memory/notes/proposed/2026-09-28-D1044-b1-archive-outbound.md` | task |
| `docs/synova/product-lines/evidence/D1044-B1/` | task |
| `.claude/bypass.log` | builtin（synova-commit D414 设计：证据链随提交入库，非人工写入） |
| `.claude/task-briefs/archive/2026-06-05-1600----getX.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-1618-P3---Provider--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-1646-DI--serverts-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-1713-M1-Slice1-AuthProvider--RBAC--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-1727-M1-Slice2-IM-Webhook--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-1745-M1-Slice3-L4---Knowledge.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-1824-M2-KnowledgeAgent7--6.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-2018-PKB-Slice-1-Schema--queryknowle.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-05-2042-PKB-----.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-0422-KnowledgeAgent---QA-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-1746-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-1749-as-any.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-1857-Phase-4-AlertRuleEngine-SQLite.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-1910-Phase-4c-knowledgechunksorgid.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-1915-Phase-5-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-06-1919-Phase-6-LLM--reasoni.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-11-1430-P0-1-HTTP--P0-3.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-11-1552-P0-2-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-12-2312--SentinelRunner--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-13-0758--10-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-0231-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-0233--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-0326-L1L2.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-1126--DocExtractor.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-1452-4real.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-1613-engine-core-deprecation.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-1907-P1-1---Quality-Firewall-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-p0-1-slice0-tuiv2-tsc.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-14-p0-1-slice1-sentinel-tsc.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-15-0135-Path-A-Express-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-15-2247-Phase-1---6-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-17-0000-提交未提交改动.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-17-2152-Agent--735.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-0012--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-0107-Day1---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-0205-PKB--GitHub-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1113-OUTPUTSPEC.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1130-Day3---AgentUI.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1130-e.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1148-Day4---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1148-HTML.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1201-D.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1257-pm-skills.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1314-Day5---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1327-Day6---LLM.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1338-SkillExpertPKB.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1403-Skill.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-19-1637-chatJSsend.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-0016--5118.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-1543-Loop-Engineering-v32v33.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-1549-Slice-9-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-1605-Slice-8-AgentMemor.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-1758-Slice-4-GA.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-2254-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-2330-Phase2-AgentMemoryStoreconversati.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-2338-Slice-F1-ExpertTyperunti.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-2349-Slice-F2-expert-registryyaml-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-20-2353-EXPERTREP.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0012-205-SOG-schema--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0028-API-workspaces-api.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0106-v33v34.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0115-v34v354.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0120-Batch1-192.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0124-Batch2-63-workspace-context-bridge.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0152-Batch3-7CRUD93.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-0207--BridgetagsSchema.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-2129-Slice-3-Agent--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-21-2348--Synova--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-0004-Synova-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-0014-Step-2--SynovaDiagnosisEngineImpl.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-0446-Step-3-Feature-flag---SY.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-0848-Step-4---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-1931--post-processing--Synova-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-2212-Step-1-SynovaGraphStore--L4-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-2251-Batch-1-i18n--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-22-2313---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-0005-Batch-1-i18n--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-0007--KeyPersonRisk-L5-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-0213-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-0222-Batch-3-----.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-0337-Batch-4--JSON-Schema--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-1410-Batch-5---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-1433-Q0c4.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-1744-Batch-5---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-23-1937---extensionssen.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0036-V41-hook-check-mem.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0321-T1-Batch1-CPCPathDependencyTokenEcono.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0334-T1-Batch2-SevenPowersFinancialSnapshot.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0357-T1-Batch3-HTMHACDSelfAwareness-comput.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0413-T1-Batch4-HONAEOB-computeKeyPer.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0416-T2--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0445-T3-3-revenuecashpro.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-0935-V41-16computeaggregate.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-1221-E1--listForTeam--E2-Ph.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-1350--knowledgea.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-1500-V42--Plan-Actual.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-1536-PRD--6--P0P1-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-1733-PRD--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-24-1911-V423-PRD--5P1.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-25-0103-Task-00-11deprecated.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-25-0108-Task-02---grep.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-25-0226-Task-03-5manifest.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-25-2124-Task-050--SentinelManifest-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-25-2158-Task-052--risk-aggregator-senti.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-25-2220-Task-11--api-accessibility--pro.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-0010-Task-12-data-readiness--data-silos-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-0133-Task-13-saas-utilization--shadow-it-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-0301-Task-14-customer-dynamics--E4-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-0404-Task-15-revenue-decomposition--F3-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-1146-Task-21-E1-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-1700-Task-22-E2-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-1919-Task-23-E3-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-26-2239-Task-24-E5-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1214-Task-25-E6-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1336-Task-26-F1-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1430-Task-27-F2-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1507-Task-28-F4-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1524-Task-29-F5-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1542-Task-210-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1601-Task-31-I1-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1623-Task-32-I2-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1635-Task-33-I3-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1712-Task-34-I4-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1732-Task-35-I7-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-1751-Task-36-I10-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2052-Task-37-I11-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2109-Task-41-I5-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2123-Task-42-I6-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2140-Task-43-I8-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2141-Task-44-I9-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2141-Task-45-I12-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2144-Task-46-T4--T5-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2145-Task-47-T6-AI-T7-Agent.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2145-Task-48-T8-AI-T9-Age.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2147-Task-51-S1--S2-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2148-Task-52-O1--O2-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2148-Task-53-O3--O4-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2148-Task-54-O5--O6-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2148-Task-55-O7--O8-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2149-Task-56-O9--O10-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2153-Task-61--strategy-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2153-Task-62--finance-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2226-Task-71-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2238-Task-72---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-27-2238-Task-73---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0010-fix-S2---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0025-fix-S3---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0034-fix-O1----st.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0051-fix-O2---stub.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0100-fix-O3---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0118-fix-O4---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0131-fix-O5---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0217-fix-O6---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0224-fix-O7---stub.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0246-fix-O8---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0304-fix-O9---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0330-fix-O10---stub.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0349-fix-T4---stu.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0907-fix-layer.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-0929-fix-SentinelConfig--layerauxilia.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-1431-Batch-0-theoryCOREmd--DESIGNPRINCIP.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-28-1946-Batch-cleanup-37auxiliaryEx.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-0038--5--technoEconomi.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-0126-Batch-sentinel--TOOLSmd.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-1043-Phase-1-Logger--packages.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-1422-Slice-1-Cron-GraphStore.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-1652-check-brief-vs-code-CI--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-1723-6----.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-1856-5-manifestjson-dependsOn-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-2030-fix-ci.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-2134-CI--npm-ci--.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-2241-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-2241-Phase-0-evolution-scaffold.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-29-2242-1-dependsOn---sent.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-0102-E2E---6-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-2211-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-E2E-sentinel-ID-compat.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-Phase-P0-1-migrate-feedback-collector.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-Phase-P0-2-org-adapter.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-Phase-P0-3-session-learner.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-Phase-P1-1-L3WriteAPI.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-06-30-Phase-P1-2-industry-thresholds.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-1020-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-1313-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-1420-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-2005-Phase-01-JWTGA.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-2251-Phase-02-GraphStore-deleteNodedeleteEd.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-E2E-sentinel-ID-compat.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Fix-3-CI-excludes.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Fix-7-unit-test-bugs.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Fix-CI-51-Failures.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-P1-cron-wiring.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-P1-file-driven-thresholds.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-P1-snapshot-checksum.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-P2-file-driven-expert-map.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Phase-P0-evolution-hardening.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Phase-P1-3-rule-version-manager.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Phase-P1-integration-tests.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Phase-P2-evolution-proposals.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-Phase-P3-expert-evolution.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-RUNTIME-Phase0-global-error-WAL.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-expert-files-merge.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-01-fix-evolution-type-constraint.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-0018-Phase-03--AuditStore-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-0547-Phase-04-GA-BehaviorMonitor.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-0921-Phase-05-Electron.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-1444-Phase-06--Light-Theme-for-D.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-2110-Phase-11--Welcome.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-2144-Phase-12-ComposerExpertAttributionuse.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-Fix-6-CI-excludes.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-HOST-config-setup.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-P2-ga-dashboard.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-P2-snapshot-ttl.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-RUNTIME-Phase1-restart-shutdown.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-RUNTIME-Phase1b-drain-wiring.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-RUNTIME-Phase2-delivery-stuck.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-Runtime-P0-behavior-monitor-wiring.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-02-fix-codex-review.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-0000-Phase-21--R.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-0038-Phase-22-CommandPalette--NotificationC.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-0224-Phase-31-GA.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-0306-Phase-32-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-1709-Phase-41-.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-RUNTIME-Phase3-rate-schema-compress.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-RUNTIME-Phase4-lanes-config.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-RUNTIME-Phase5-memory-forensics-fts5.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-03-upgrade-v4.3.0.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-04-0000-Step3-4.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-04-Phase-G1-context-pluggable-engine.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-04-RUNTIME-Phase5-1-auto-update.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-04-TaskA-Complete.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-04-TaskA-Step1-entity-schemas.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-04-TaskA-Step2-edges-loader.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-0201-Phase-4-tool-guard-fts5-jsonl.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-0259-Phase-0-Inject-GraphTraversal-into-Sent.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-1226-Phase-1-Pilot-cash-runway-aggregate-mig.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-1530-Phase-1-SoftwareHealth.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-1608-Phase-1-UnitEconomics.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-2106-Phase-2-Batch-1.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-2138-Phase-2-Batch-2.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-2158-Phase-2-Batch-3.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-Phase-G3-escalation-engine.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-05-codex-audit-fix.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-06-0012-Phase-3-Batch-1.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-06-0223-P0P1---.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-06-evolution-v3.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-08-0017-ontology-unification.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-08-0043-T3-GA-annotations.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-08-T2-哨兵核心修复.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-08-T6-计算模块缺口补充.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-09-T11-无数据诊断.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-09-T12-dormant-docs.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-09-T7-growth-edges.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-09-T7a-BRAND_BUILDS.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-09-T7b-边接线到GraphBridge.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-09-T9-sentinel-accuracy-management-economics.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-10-I2-3a-compute边引用迁移.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-10-I2-3b-new-compute-stage0-1.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-10-I2-3c-new-compute-stage2-3.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-10-I2-3d-new-compute-stage4-5-X.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-10-I2-Phase1-42边JSON.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-10-I2-Phase2-枚举同步.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-11-D24-I2-3b-3c-contract补全.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-11-D35-数据管道可观测性.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-13-D47-双进程架构-首次启动检查.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-13-D49-watchdog-monitoring.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-13-D49-独立看门狗-三层监控.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-13-D57-tone-fusion.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-13-D69-expert-prompts降级-文件驱动.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D50-一键恢复包-备份验证.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D51-CI-CD黄金案例F1门禁.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D58-manifest-loader.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D69-expert-prompts-decommission.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D73-goal-sentinel.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D74-workspace-data-aggregation.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-14-D79-context-loader.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-15-D51-ci-golden-case.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-15-D59-me-compute-enhance.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-15-D75-lightweight-rediagnosis.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-15-D76-pkb-feedback.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-15-D77-system-integration.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-15-D80-playbook-execution-record.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-16-D61-me-compute-new.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-21-D8c-expert-routing.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-21-D8d-cross-validation.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-21-D8e-conflict-arbitration.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-21-D8f-convergence-mechanism.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-22-D200-context-injector.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-22-D201-gatekeeper-synova-commit.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-22-D202-external-auditor.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-22-D206-dev-doc-gatekeeper.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-28-auto.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-29-auto.md` | task（出库·删除侧） |
| `.claude/task-briefs/archive/2026-07-30-auto.md` | task（出库·删除侧） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash <本 brief §Done 的 verify 命令>`；PR 级：`chore/b1-archive-outbound` → `origin/main`。
处理：① 引用复核（0 命中，未过不得进 ②）→ ② 承接就位（先落 `~/Synova-过程档案/出库-主仓/`，逐件 sha256 对账）→ ③ 主仓 `git rm -r` + 三闸回执 + 回退演练。
结果：294 件从主仓消失、在档案仓按原路径可读且 sha256 全等；`git ls-tree origin/main \| grep -c '\.md$'` 净减 294；三条门禁原始输出齐备。

## 架构层
文档治理域（`.claude/**`，非 L1–L5 产品层；本批零产品代码变更）

## Done 标准
- [ ] verify: `git ls-files '.claude/task-briefs/archive/*.md' | wc -l` == `0`
- [ ] verify: `git ls-tree -r --name-only origin/main | grep -c '\.md$'` 减 `git ls-files '*.md' | grep -v '^\.sessions/' | wc -l` == `294`
- [ ] verify: `git ls-files 'src/*.ts' 'packages/*.ts' | wc -l` == `509`（分母不变）
- [ ] verify: 档案仓 `~/Synova-过程档案/出库-主仓/` 逐件 `sha256sum` 与出库前主仓一致 == `294/294`
- [ ] verify: 回退演练 `git checkout <出库前 sha> -- .claude/task-briefs/archive/` 恢复 `294` 件，且「再删一次」可重复
- [ ] verify: `DOC_TRUTH_ROOT=. bash scripts/doc-system/doc-registry-gate.sh` → `0 个未登记`
- [ ] verify: `SYNO_CI=1 bash scripts/pre-commit-check.sh` → 无硬阻断（13 组）
- [ ] verify: `bash scripts/control-tower/check-pr-budget.sh` → `✅ PASS PR 预算内（1 文件）`

## 红线复核（写集边界）
- `scripts/audit/**` 改动 **0**；`docs/synova/audit-reports/**` 改动 **0**；`src/**` 改动 **0**；新增脚本 **0**
- 禁 `--no-verify` / `git stash` / force push
- 不做二次删除：删除侧**仅** `.claude/task-briefs/archive/`

---

## 偏离登记（执行前已定，逐条给依据；供 CTO/K3 复核）

| # | 偏离 | 依据 | 代价 |
|---|---|---|---|
| D-1 | 证据文件用 **`.json`** 而非 `.txt`/`.md` | `.txt` 不在 `ci.yml:51` docs-only 白名单 ⇒ 触发全量 CI（≈35 min，本卡红线）；`.md` 落 `docs/synova/product-lines/evidence/` 会被 `doc-registry-gate.sh` 判「未登记」（实测 ❌）。`.json` 同时满足「docs-only=true」与「登记门禁不扫」（该闸只扫 `\.(md\|yaml)$`） | 人读性下降；故报告与 PR 正文承担叙述，`.json` 只存命令 + 原始输出 + 结论 |
| D-2 | 判据从「2172→1878」改为「同一命令 Δ = −294」 | 卡面数字基于 `4afd4ce1`（实测 2172 ✅），但 `origin/main` 已前进 3 个 commit ⇒ 现值 2193。绝对数字会随他人提交漂移（M7 型） | 需同时给 before/after 两次原始输出 |
| D-3 | 预算门禁归因改写 | 实测 `出库豁免不适用`，实际生效的是 D860 治理产物豁免（300/301 件） | 报告须贴原始输出，不得写「出库豁免生效」 |
| D-4 | G10/A3 依赖**删除** | 前提 P6 实测不成立（G10 恒不触发） | 已上报 CTO；A3 仍需独立推进（它修的是 G10/G11 假绿根因） |
| D-5 | 承接步骤需沙箱提权 | P11：`~/Synova-过程档案/` 在会话工作区外，`touch` 实测 `Operation not permitted` | 承接命令合并为单次提权调用 |
| D-6 | **判据① 精化**（原判据不可达） | 卡面 §三② 要求 brief 写集 + task-state `write_set` **逐条含 294 条删除侧路径**，而 §五① 又要求引用检查 0 命中且带 `--untracked` ⇒ **检查自身产物被计入**（实测 588 = 294×2）。两条要求互斥，属卡内不一致（pre-dispatch-check ⑨ 型） | 精化口径见下；精化后残留 **1 处**，性质裁定为非活引用并逐条点名 |
| D-7 | 承接由**队长**执行（非成员A） | 执行方为受限子代理，**会话内无法提权**（实测 `Operation not permitted` 且审批提示不可用）；队长提权可行 | 执行方改为**独立复核**该承接结果（写者≠验者，反而更强） |

---

## 判据精化与例外登记（队长裁定 2026-09-28，逐条留痕，供 CTO/K3 复核）

### 1. 原判据不可达（实测，非推断）
```
$ git grep -n -I --untracked -F -f <294 全路径> -- . ':!.claude/task-briefs/archive/' | wc -l
589
# 逐文件直方图：task-state/D1044.json 294 + 本 brief 写集块 294 + D1028 模板 1
```
⇒ 「0 命中」与 §三②「写集必须含 294 条删除侧路径」**互斥**，本批**不可能**在字面口径下达标。

### 2. 精化判据（可复跑，排除本批自身声明产物）
```
$ git grep -n -I --untracked -F -f <294 全路径> -- . \
    ':!.claude/task-briefs/archive/' \
    ':!.claude/task-briefs/2026-09-28-D1044-B1-archive-294-outbound.md' \
    ':!task-state/D1044.json' | wc -l
1
```
唯一命中（原文，未截断）：
```
docs/synova/coordination/出库声明与批次模板-D1028-20260927.md:651:.claude/task-briefs/archive/2026-07-22-D200-context-injector.md:3:## Q2: 范围 — inject-context.py + doc-registry.json + context-injector.sh
```
性质裁定：该行位于同文件 **645–663 行的围栏代码块（```text）** 内，是 §A.3「`doc-registry.json` 全部引用（全仓库，14 处）」中 `git grep -n 'doc-registry\.json'` 输出的**原样转写**（清单第 5 条）。
**非 import、非调用、非门禁读取**。成员B 独立复跑：`src/`、`packages/`、`scripts/`、`tests/`、`.github/`、`docs/authority/`、`memory/`、`decisions/` 内 **0 命中**；`DOCS-REGISTRY.yaml` 与 `control-tower/doc-registry.json` 各 **0**（`grep -c` → exit 1）。
⇒ **裁定：非活引用（引文 / citation）**，出库不破坏任何消费者。
⇒ **本批判据① 的结论口径 = 活引用 0 件（294/294 在依赖语义上零引用）；1 处围栏引文为例外并逐条点名。**

### 3. 具名遗留（本批不改，逐条写明理由 —— 卡面 §五⑥）
| # | 项 | 为什么不在本批做 |
|---|---|---|
| L-1 | `docs/synova/coordination/出库声明与批次模板-D1028-20260927.md:651` 出库后留一句指向已删文件的**陈旧引文** | 该文件不在本批冻结写集内；扩写集须 CTO 批复（本卡红线「不擅自扩写集」） |
| L-2 | `docs/synova/STATE.md:83` 活体状态陈述「`.claude/task-briefs/archive` = 294」出库后变陈旧 | 同上（不在写集内）。**实测不影响门禁**：`check-doc-truth.sh` C4 只校验 7 条权威层路径（CHRONICLE/INDEX/START-HERE/docs-authority），**不含** `.claude/**`，实跑 D1 全绿 |
| L-3 | G10/G11 幽灵变量（`CHANGED_FILES`/`STAGED_FILES` 零赋值）⇒ 假绿 | 属控制塔域（`scripts/pre-commit-check.sh`），本卡只登记不改；A3(#862) 正在修，仍未合 |
| L-4 | `doc-registry-gate.sh` 只扫 untracked + staged-新增 ⇒ commit 后输入归零（假绿） | 同上；与 D1028 交付遗留 L7 同源 |
| L-5 | 卡面前提 P6/P9 不成立、P7 基线漂移 +21 | 已在本 brief §Q0.b 与 Note 逐条订正；A3/#864 均非本批前置 |

### 4. 被排除的候选（成员B 独立反向扫，防漏检 —— 均非消费者）
- 目录级 `git grep '.claude/task-briefs/archive'`（排除本目录）= 6 处，全部为文档/台账文字：`.claude/task-briefs/2026-09-25-D964-phase4-archive-batch1.md:9,:18`、`docs/synova/STATE.md:83`、`docs/synova/coordination/K3审计请求-D964-门禁语义变更-20260925.md:13`、`docs/synova/coordination/出库声明与批次模板-D1028-20260927.md:651`、`docs/synova/coordination/审计发现台账-DSH-CTO.md:326`
- 递归枚举者：`.claude/task-briefs/` 递归 `.md` = 716（其中 archive = 294）。`decide-next.sh:32` 伪 `find -mtime +7` 仅 post-commit **建议**输出（非门禁）；`gen-task-board.py:446` / `founder-truth.py:163` / `self-diagnosis.py:105` / `generate-dashboard.py:97` 均为**非递归** glob，看不到 archive
- 注册表：`DOCS-REGISTRY.yaml` / `control-tower/doc-registry.json` 各 0 命中；G11 `head -1` 绑定风险实测排除（首位为 `2026-06-14-…`，排在 `archive/` 之前）
