# D1028 前提冻结实测结论（队长产出，逐条指证据文件）

> 生成: 2026-09-27 | 任务: D1028 | as_of commit: 4afd4ce1（本轮开工时 origin/main == HEAD）
> 产出者: 队长 synova-squad-lead（**未下场写码**）｜证据文件原始输出见同目录 00/01/02

## 一、结论表

| # | 卡面前提 | 结论 | 证据 |
|---|---|---|---|
| P1 | `scripts/control-tower/check-pr-budget.sh` 是 D734 门禁 | ✅ 成立 | `00-…txt` §P1：179 行；`pre-commit-check.sh:1515,1516,1521,1526` |
| P2 | 文档出库集 **1,288** 份 | ❌ **不可复现** | `00-…txt` §P2：六前缀 `.md` = **1433**；全 tracked `.md` = **2172**；全 tracked 文件 = **5569**；63 组合全枚举**无一命中 1288** |
| P3 | 只有 **12** 份需 doc-registry 同步 | ❌ **数字错** | `00-…txt` §P3：真源 `docs/authority/DOCS-REGISTRY.yaml` 39 条，落出库白名单前缀 = **7 条** |
| P3b | registry = `scripts/control-tower/doc-registry.json`（契约 §9 表原文） | ⚠️ **契约自身写错** | `00-…txt` §P3：门禁实读 `docs/authority/DOCS-REGISTRY.yaml`（`doc-registry-gate.sh:18`）；JSON 仅被 `context-injector.sh` / `inject-context.py:34` 读，**零门禁消费者** |
| P4 | `## 写集豁免` 已被 CI 解析 | ✅ 成立 | `00-…txt` §P4：`merge_writeset_gate.py:291,295,299` + `ci.yml:119` |
| P5 | A1(#861) 与本卡配套 | ⚠️ **未落地** | `00-…txt` §P5：`git merge-base --is-ancestor a1201ceb HEAD` → **NOT IN MAIN**；仅存在于 `chore/ci-docsonly-whitelist-20260927` |
| 🔴 P6 | 判据①「纯删 `src/**` **必须仍被拦**」 | ❌ **前提不成立** | `01-P6-修正版…txt`：纯删 `src/**` 14 件 → ACMR=**0**、AM=**0**、门禁 **exit 0 / 「变更文件数 0」** |

## 二、P6 展开（本卡承重事实）

`check-pr-budget.sh:92` 用 `--diff-filter=ACMR` 取变更集 ⇒ **D（删除）路径从不进入计数**。

真 git 沙箱 + main 上真门禁（179 行原版）实测三形态：

| 形态 | `--diff-filter=ACMR` 行数 | `--diff-filter=AM` 行数 | 真门禁 exit | 说明 |
|---|---|---|---|---|
| 纯删 `src/**` 14 件 | **0** | 0 | **0（PASS）** | 今天**根本不拦** ⟵ 判据①按字面做不到 |
| 纯 `git mv docs/plans/*.md docs/synova/archive/` ×3 | **3** | 0 | 0（3 ≤ 12） | **R 才计数** ⟵ 卡面「118 批」只在 R 口径下成立 |
| 删 `src` 13 件 + 改 1 件 | **1** | 1 | 0（1 ≤ 12） | 判据②今天也不拦 |

**撤回记录（队长自查）**：本目录第一版 P6 证据的沙箱 `HEAD` 停在 `main` 分支，跑 `--base main` 使 `main...HEAD` **恒空** ⇒ 输出 0 文件假绿（「检查未执行 == 检查通过」形态）。已撤回重做，`00-…txt` 末尾留撤回说明，正确版见 `01-P6-修正版…txt`（每个沙箱均 `git checkout -b feat` 后再改）。

## 三、CTO 裁定（2026-09-27 本轮会话，计入交付）

| 议题 | 裁定 |
|---|---|
| Q1 判据①语义 | **方案A**：D/R 默认计入预算；仅 ⓐ∧ⓑ 全满足才豁免（授权收紧，超出「只加豁免分支」字面） |
| Q2 白名单漏洞 | **加入** `docs/synova/coordination/ownership.yaml`、`docs/synova/coordination/AUDIT-PROTOCOL.md` 到 ❌ 绝不豁免（精确路径） |
| Q3 registry 计数 | 按真源 **7 条**做；契约 §9 缺陷**只登记不代改** |

## 四、冲突扫描摘要（全文 `02-冲突扫描-完整输出.txt`，203 行）

- `git grep -n "check-pr-budget"` → **共 180 处**
- 生产调用点 3 处：`scripts/pre-commit-check.sh:1515 / :1516 / :1526`
- 🔴 **热点文件双写风险**：`task-state/D911.json` status=`claimed`，其切片 B3（`docs/synova/dispatch/D911-门禁三缺陷根治-20260922.md:108`）也计划改同文件。main 上 `grep -c '代行声明' check-pr-budget.sh` = **0**（D911 无分支、无在飞改动）⇒ 本卡是当前唯一写者；已上报 CTO 排期。
- 同族坑 **CT-69**（`AUDIT-FINDINGS-LEDGER.md:107`）：`--files` 注入对非 ASCII 路径误判跨域 ⇒ 夹具禁用中文路径喂 `--files`。

## 五、写集（逐文件，两两互斥）

| 写者 | 文件 |
|---|---|
| 成员A `impl-gate` | `scripts/control-tower/check-pr-budget.sh`、`tests/control-tower/check-pr-budget.test.sh` |
| 成员B `docs-mech` | `docs/synova/coordination/出库声明与批次模板-D1028-20260927.md`、`memory/notes/proposed/2026-09-27-D1028-outbound-exemption.md`（原名含 CJK → 撞 `commit-msg-check.sh:153` ASCII-only 正则，2026-09-27 改 ASCII 名） |
| 队长 | `.claude/task-briefs/2026-09-27-D1028-*.md`、`docs/synova/product-lines/evidence/D1028-A2/**`、仓外报告 |
| 成员C `verifier`（只读） | `/tmp/a2-verify/**` |
