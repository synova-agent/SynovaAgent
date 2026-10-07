# #980 回归与门禁复核 · 独立自验 γ 结论摘要（PR #1367 addendum）

> 由来：`VERIFY-980-regress-verifier-980-regress.md`（678 行）结论太长不便逐行读；本件是**结论摘要 + 咬合证据索引**。
> ⚠️ 本件是**摘要**，不是替代品：逐条原始输出以 678 行报告 + `%TEMP%\synova-980-regress\` 归档为准。
> 自验结论 = `退回（附理由）`，**退回项不含产品证据链**（退回的是"版本前提被超越" + 需写权者闭合的门禁/残留项）。

## 0. 版本前提（γ 的 U2，本轮已由队长闭合）

- γ 验证的版本：`d7a30755f`，当时相对 `origin/main`(`441c3004b`) 落后 **9** 条。
- 队长收尾动作：并入最新 `origin/main`（`behind=0`）→ HEAD `8800203f4`。
- **产品承重件未变**：`src/l4/sog-schema-validator.ts` sha256 = `741f671b…5167`（γ 实测**跑前跑后一致**；队长 merge 后复核仍一致）。
- 因此 γ 的 A/B/C2/D 结论**仍适用**；C1 组 6/组 12 由队长在真实提交路径闭合（见 §4）。

## 1. A. tsc —— 判据「零新增」

| 项 | 值 |
|---|---|
| 命令 | `npx tsc --noEmit --pretty false` |
| `error TS` 总数 | **28** |
| 归类 | `extensions/sentinels/_extinct/**` = 25 ｜ `src/connectors/ima.ts` = 1 ｜ `src/server.ts` = 2 |
| 指向 `src/l4/sog-schema-validator.ts` 或其测试 | **0 条** |
| ⇒ **新增错误 = 0** | 与 CI 的白名单过滤族（`ima.ts`/`server.ts`/`_extinct/`）一致 |

## 2. B. 爆炸半径（串行，`tasklist` 快照存档证明无并发）

| 段 | 命令 | 结果 | exit |
|---|---|---|---|
| B1 直连面 | `vitest run tests/l4/` | **221 passed / 221**（28 文件） | 0 |
| B2 调用方面 | `vitest run tests/contract/l4-contract.test.ts` | **13 passed / 13** | 0 |
| B3 消费面 | `vitest run tests/l4/graph-bridge.test.ts` | **31 passed / 31** | 0 |
| **B4a CI 权威面** | `packages/test-kit` → `vitest run tests/architecture/05-as-any-audit.test.ts` | **6 passed / 6** | **0** |
| B4b 卡面点名 | `packages/test-kit` → `vitest run tests/wire/` | **9 passed / 9** | 0 |
| B4c 卡面点名 | `packages/test-kit` → `vitest run tests/architecture/`（整目录） | **4 failed / 114 passed** | 1 |
| B5a 全量 1/2 | `vitest run --shard=1/2` | **13 failed / 2479 passed** | 1 |
| B5b 全量 2/2 | `vitest run --shard=2/2` | **11 failed / 2315 passed** | 1 |

### 2.1 卡面前提订正（B4）——**CI 权威面 ≠ 整目录**
实测 `ci.yml:548`：`Test-Kit Architecture Tests` 这个**必需检查**只跑 `tests/architecture/05-as-any-audit.test.ts` **一个文件**（⇒ B4a = **6/6 绿**）。
`ci.yml:549` 明文登记：「D565 登记: architecture 套件余 4 文件（01/02/04）**存量红**（wiring-audit 引用已拆接线、>1000 行文件、l4 import）——从未入 CI 故腐化未察。修复归编码线（CT-51 队列）」⇒ **B4c 的 4 条红是仓库已登记的存量红**，与 #980 无关。

## 3. 失败归类（24 例 / 8 个测试文件）

**① 与 #980 写集相关 = 0 条。** 判别依据：`git diff --name-only ce5507826 HEAD -- src/ tests/` **只有 3 个文件**（`src/l4/sog-schema-validator.ts` + 2 个新测试件），8 个失败件**无一在内**。

**② 存量（多重独立证据）6 件 / 22 例**：

| 失败件 | 存量证据（非本 PR 引入） |
|---|---|
| `graphbridge-wiring`(1) | 5 处登记：`board-backlog.json:240`（`PLAN-graphbridge-wiring-red`，逐字同一失败）、`FIX-014-Vitest既有红-处置卡:30`（逐字 `:79 expected 1 got 0`）、`D1039-A4d…:470`（"改前即红（基线自带）"）、`SYNOVA-AUDIT-REPORT-20260722.md:194` |
| `check-architecture-gate`(8) | `D947-verifier-pr1.md:433/461` 记为 **8 failed / 4 passed**，与本 PR 实测**失败数/通过数完全一致** |
| `zero-code-industry`(2) / `gss-common`(8) / `ga-calibration-evolution`(2) | K3 独立背书 `docs/synova/audit-reports/2026-09-21-K3-D862.md:301`「失败集逐条（**两树逐字相同**）：zero-code-industry(2)、…、graphbridge-wiring(1)… 共 17 例，全部为既存环境依赖失败」 |
| `mac-install-verify`(1) | macOS 专属执行位断言跑在 Windows |

**结构性证据（最强一格）**：8 个失败测试件 `git show HEAD:<f>` vs `git show origin/main:<f>` **全部 SAME**；`src/l4/graph-bridge.ts`、`src/orchestrator/module-runner.ts`、`src/agent/context-compaction.ts` 亦 **SAME**；`packages/test-kit/` 相对 main 的 diff = **0 文件**。

**③ 环境（Windows）2 件**：`workspace-goal-creation.integration.test.ts` 文件级 `EPERM` @ `rmSync`（其 15 个用例本身全 ✓，且属 #1322 卡）；`ga-calibration-evolution` 另 1 例 `EPERM … .db`。

**④ 未登记存疑 1 件（如实存疑，不洗成"存量"）**：`tests/agent/context-compaction.test.ts`（1 例为测试自身漏 `await`）——该件与被测源件均与 `origin/main` **逐字相同**、本分支未碰，但**在存量红登记/基线/CI 排除清单里都没找到它**。⇒ 留作独立存疑项。

**`better-sqlite3` 跨版本借用（指定先怀疑）**：24 例中**无一条**呈该型症状；本卡真库路径（integration 4/4、探针两次 exit 0、写 40 读回 40）**全部通过** ⇒ 结论限于"本卡路径未受其影响"（**≠** "已验证该变通无害"）。

## 4. C. 门禁

| 项 | 结果 |
|---|---|
| C2 `bash scripts/check-architecture.sh` | **exit 0**「架构检查: 全部通过」；3 处 ⚠ 均为基线棘轮内存量，**无新增跨层 import** |
| C1 γ 只读态 `pre-commit-check.sh` | exit 1（组 6 + 组 12）——**根因 = brief 认领**：只读态无暂存 ⇒ 空集 ⇒ `resolve-commit-brief.sh` 走日期回退 ⇒ 落到**他卡**（组 6 报出的 Done 讲 GOAL/`props.orgId` = #1322 卡）。γ 用三段解析器实验定位（空集→他卡；给 #980 文件集→#980 brief ✅） |
| **C1′ 队长真实提交路径** | `synova-commit` 全量提交（含 brief 身份 + 暂存集 4 文件）⇒ **`✅ 提交完成`，exit 0**（组 1–13 全通过） |

⇒ **U1 闭合**：门禁在**正确 brief 身份下不红**；γ 记录的红色属"只读态无法表达认领身份"的工具性产物，非本 PR 缺陷（机制留痕：`pre-commit-check.sh:949` 的 `${DECL_SCOPE:-$STAGED_ALL}` + 空集日期回退）。

## 5. D. 证据与复跑

- `git ls-files docs/synova/product-lines/evidence/980/` ⇒ **12/12 件在库**；`origin/main` 同名件 **0**。
- 探针**独立复跑**（现行脚本）：`写入 40 个类型节点…可读回 = 40 OK`、**`未覆盖类型 40 个`**、`--json {"written":40,"readBackOk":40,"count":40}`、R28「`git status` 前后 0 差异 / 6 个 thresholds.json 6/6 一致」、仓库前后零污染 ⇒ 与入库 `evidence-980-probe-run.txt` **一致**。
- **D3 哈希漂移（已补记，不影响结论）**：入库 run 记 `capture sha256 = 6181e7c9…`（run 时刻真值），该脚本后被追加一行 `# swallow-ok:` 注释（commit `27099ae9a`，`+1/-1`）⇒ 现行为 `759d0709…`。`probe-diagnosis.ts`（`759a115a…`）与 validator（`741f671b…`）**至今匹配**。已在 `evidence-980-probe-run.txt` 内**追加**（不改逐字节原文）说明。

## 6. 收尾残留（γ 发现，队长已清）

`--shard=2/2` 留下 4 个**已跟踪文件**被改写（`D817-capture-20260918.json`、`D819-capture-20260919.json`、2 个 `.pyc`）⇒ 队长已 `git checkout --` 复位；**未进任何提交**（γ 的告警"任何 `git add .` 会扫进提交"已生效拦截）。
