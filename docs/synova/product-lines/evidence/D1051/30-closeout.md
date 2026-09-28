# D1051 收尾三件 · 线3 报告体系首切片（3-1 一页纸 / 3-2 详细报告 / 3-3 对话调深度）

> 队长收口件（synova-squad-lead）｜2026-09-28｜依据计划 `整体推进计划-主线-20260913.md` **v1.2 @ sha256=4e46603f…**（前缀实测命中）
> 分支 `feat/d1051-line3-report-depth`｜base `origin/main @ 20b55eba`｜**承重实现件 `f47f9098`**（成员 V 独立复核对象）
> 措辞纪律：本件只给**自验结论**；通过与否归 **CTO 收件闸 + K3**，全文不使用「审计通过」表述。

---

## 一、diff（原始输出，禁手写）

### 1.1 写集（`--diff-filter` 全量，逐文件）

```
$ git diff --stat origin/main -- src tests
 src/agent/report-assembler.ts                  | 289 ++++++++++++++++++++++
 src/agent/report-depth.ts                      | 161 +++++++++++++
 src/l3/report-templates.ts                     |  66 ++++-
 src/routes/conversations.ts                    | 214 ++++++++++++++++-
 src/routes/diagnosis.ts                        | 101 ++++----
 tests/agent/report-depth.test.ts               | 171 +++++++++++++
 tests/agent/report-detailed.test.ts            | 244 +++++++++++++++++++
 tests/routes/conversations-report-view.test.ts | 320 +++++++++++++++++++++++++
 tests/routes/diagnosis-report-depth.test.ts    | 248 +++++++++++++++++++
 9 files changed, 1769 insertions(+), 45 deletions(-)
```

```
$ git diff --name-only origin/main -- src tests | sort
src/agent/report-assembler.ts
src/agent/report-depth.ts
src/l3/report-templates.ts
src/routes/conversations.ts
src/routes/diagnosis.ts
tests/agent/report-depth.test.ts
tests/agent/report-detailed.test.ts
tests/routes/conversations-report-view.test.ts
tests/routes/diagnosis-report-depth.test.ts
```

### 1.2 提交链（`origin/main..HEAD`）

| SHA | 类型 | 内容 | 说明 |
|---|---|---|---|
| `b55be234` | docs | spec + brief（含 DR-1 修正：呈现轴落 L2） | 经 `git synova-commit` 真通道产生（见 §三 遗留 3） |
| `f47f9098` | **feat** | **实现 9 文件** | **承重件；V 复核对象** |
| `3e113504` | docs | 并入 spec 口径回填（指纹可行性） | 纯 docs（`-- src tests` 空） |
| `dd885493` | test | `report_view` 帧 degraded/reason 判别性补测（+2 例） | 纯 tests（`-- src` 空） |
| `4af5f1c2` | test | 更正 RENDER_DEGRADED 注入面注释（V 提示③） | 注释-only（非注释行改动 = 0） |
| 其余 | chore | `.claude/bypass.log` hook 自动登记 | D521 副作用，不含源码 |

**承重件不变的物理判据**：
```
$ git diff --stat f47f9098..HEAD -- src
（空）      ⇒ 其后全部提交对产品代码零改动
```

### 1.3 域与预算（门禁原始输出）

```
$ bash scripts/control-tower/check-pr-budget.sh --base origin/main --max-files 12
  ℹ️  D860 治理产物豁免: 2 件不计预算（brief/卡/Note/规格/自验证据，代码文件仍计入）
  ✅ ① 变更文件数 10 ≤ 上限 12
  ✅ ② 变更单域: ✅ PASS 9 个文件同域: win（无归属 0，域判定豁免 1）
  ✅ ③ 落后 origin/main 0 个提交 ≤ 20
✅ PASS PR 预算内（10 文件）
```
（并入证据工件后按注入缝预演为 **12 ≤ 12**，仍 PASS：9 代码 + 3 harness（`.ts`×2/`.py`×1 计入）+ 其余证据为 D860 豁免。）

```
$ bash scripts/check-architecture.sh          → exit=0
  ✅ 架构检查: 全部通过 ✅        （1b/1c/1d 三段 new=0，未抬基线）
$ bash scripts/control-tower/check-bypass-log.sh origin/main
  ✅ bypass.log 对账通过: 20b55eba…HEAD 全部提交有记录        exit=0
```

---

## 二、自验结论

### 2.1 成员 V 的独立复核结论（原文引用）

> **可提请独立审计**（退回项 0；提示 2 项）。
> 依据：真实 HTTP 入口四条路径 **12/12 步通过**；7 套件 **67 用例**一次进程全绿零 skip；**6 处语义故障注入逐个报红**且失败用例命中预期断言、复原后 sha 一致；架构棘轮 `new=0`（本地与 `SYNO_CI=1` 双口径）；红证在产品/测试/脚本面 **0 残留**、工作树除证据目录外无改动。
> —— `docs/synova/product-lines/evidence/D1051/22-verify-conclusion.md`

**V 的实证要点**（原始工件可核）：
| 维度 | 结果 | 工件 |
|---|---|---|
| 改坏即红 | R1 显式深度短路 / R2 默认深度反转 / R3 删章节 / R4 对话意图短路 / R5 降级静默 / **R6 帧 degraded 静默** / **R6c 第二独立注入源** —— 7 例全部「注入→红→revert→绿」四元组齐 | `20-verify-break-red.json`、`20b-verify-break-red-R6.json`、`logs-break-red/`（21 份原始日志） |
| 反向走入口 | 默认一页纸 200 → `depth=one_pager` **字节相等** → `detailed` 五章齐备 → 非法值 `UNKNOWN_DEPTH` 落回 → 对话「讲细一点」`report_view:detailed` → 「说人话」`one_pager` → 无词不发帧 —— **12/12 PASS** | `21-verify-entry-reverse.json` |
| 负控 | fixture 字段名故意写错 → 断言报红（**10 PASS / 2 FAIL**）⇒ 断言对内容敏感，非骨架空转 | `21b-verify-entry-reverse-N1.json` |
| 套件实跑 | 7 套件 / **67 passed** / `✓` 行数 67 == `it(` 计数 67 / 0 skip / 0 only | `25-verify-suites.log.txt` |
| tsc | 31 行错与基线 `d8590040` **逐行相同**（存量；本卡 9 文件零错误）⇒ **不得以「lint 全绿」当验收判据** | `26a/26b/26c` |

### 2.2 队长的独立核验（不采信自述）

```
$ git diff c3d0508d^{tree} b55be234^{tree} --stat                      → 空（改写前后逐字节等价）
$ git diff ad15826d^{tree} f47f9098^{tree} --stat -- src tests          → 空（同上）
$ bash scripts/control-tower/check-bypass-log.sh origin/main            → exit 0
$ bash scripts/check-architecture.sh                                    → exit 0（1b/1c/1d new=0）
$ git ls-remote --heads origin | grep feat/d1051-line3-report-depth
38080dbea4087731a13966351e330bb5558eb9bc	refs/heads/feat/d1051-line3-report-depth
```

### 2.3 三验收点的四件套对账（派单 §五）

| 点 | ① verify 命令（可重跑） | ② 机器证据 .json | ③ 真实入口走通 | ④ 改坏即红（V 独立） |
|---|---|---|---|---|
| **3-1** | `npx vitest run tests/routes/diagnosis-report-depth.test.ts`（默认深度 = 一页纸，与 `depth=one_pager` **字节相等**；`J2 零回归判别`） | 待补（见 §三 遗留 1，CT-62 跨天） | `GET /api/diagnosis/consult/:id/report?format=markdown` 真实 HTTP 200 | R2 默认深度反转 → 红 |
| **3-2** | `npx vitest run tests/routes/diagnosis-report-depth.test.ts tests/agent/report-detailed.test.ts` | 同上 | `…&depth=detailed` 真实 HTTP 200，五章齐备 | R1 显式深度短路 / R3 删章节 → 红 |
| **3-3** | `npx vitest run tests/routes/conversations-report-view.test.ts` | 同上 | `POST /api/conversations/:id/messages` 真 SSE：`report_view` 帧 | R4 意图短路 / R6 帧降级静默 / R6c → 红 |

> 说明：**③ 采用真实路由 + 真实 SQLite + 真实 HTTP（in-process app + `app.locals` 注入），不调 `createServer()`**（其 bootstrap 失败路径 `process.exit(1)` 会杀测试进程）；等价性由 4 条断言保证（规格 Q5 裁定）。既有 `tests/e2e/full-pipeline.integration.test.ts` 是模块级直调（`listen|createApp|supertest` 零命中），**不满足** ③，故另行新写真实 HTTP 路径。

---

## 三、遗留清单（逐条带处置建议；无一条被静默忽略）

1. **点级证据 `.json` 未落（四件套 ② 缺口）—— 受 CT-62 硬约束，须跨天重跑。**
   机理（实测）：`evidence-writer.py` 无 `--at`，且 `calc-progress.py` **machine 路径**只传 `date` ⇒ 与代码同日的验证必判 `stale`。本卡代码提交在 **2026-09-28**，而线 3 `modules` 含 `src/l3/` 与 `src/agent/report-assembler.ts`（`product-lines.yaml:164`）——同日产出无效。
   **下一个自然日起可执行的命令**（把 `SRC` 换成实际运行摘要）：
   ```bash
   npx vitest run tests/agent/report-depth.test.ts tests/agent/report-detailed.test.ts \
     tests/routes/diagnosis-report-depth.test.ts tests/routes/conversations-report-view.test.ts
   python3 scripts/product-lines/evidence-writer.py --type test --verdict pass --points 3-1,3-2,3-3 \
     --source "npx vitest run <上述 4 套件> @ f47f9098" \
     --quote "7 套件 67 passed / report_view 帧 depth 切换 + 反向下沉 12/12 步；工件 docs/synova/product-lines/evidence/D1051/"
   ```
   （D791 同型先例：线 1 `test-2026-09-15.json` 同日失效 → 次日 `test-2026-09-16.json` 重验 → `pending_k3`。）
   ⚠️ 若在**同日**补齐，将得到 `stale` 而不是 `pending_k3`——**不要**用改口径的方式消解。

2. **规格 3 处指纹口径不可达 —— 已由规格作者回填（commit `c2b6c485` / 并入 `3e113504`）。**
   `DS2`（`grep -c "name:"` 实为 8）、`DS18`（写集内存在存量禁词）、`§8#8`（行数型判据随实现风格漂移）已改为可到口径；并同源清理了 §8 #1–#7/#9 + DS11/DS15 的行数型判据（改文件集合型），记录在 spec **§13 / §13.1 / §13.2**。

3. **偏差声明（须 CTO 裁定）：spec 与实现同 PR，未先落 main。**
   派单/纪律口径为「规格须先在 main 可读」。本仓 **D791 先例**是 spec 与实现同 PR（`23c262bc` docs → 后续 feat 同分支）。本卡沿用该形态：spec 在 PR 分支内可读，K3 复审时可读；**若 CTO 裁定必须先在 main 可读，本件需拆为「先合 docs PR 再合 feat PR」**。

4. **两条派单前提偏差（队长实测，已报 CTO；不废卡）**
   - `D791 PR-B`（mac 域：GS-08 生产路径改造 + 点级证据）**未落 main**（`git merge-base --is-ancestor db7252c8 HEAD` → 非祖先）⇒ main 的 GS-08 仍是 D446 模板加载级、`evidence_map` 用 `S8-1/S8-2`，与 `3-x` **无映射层** ⇒ **「scenario:GS-08」当下不是可用的记分通道**。本切片因此把验证收敛到 win 域 + 真实 HTTP（见 §2.3 ③）。
   - main **无任何固定诊断产物**（GS-08 `fixtures/` 交付态不存在；全场景无 `reportId/rootCauses/expertReports` 顶层键的 JSON）⇒ 本切片自备固定产物（形状过 `isDiagnosisReportArchive`），写入测试内。
   详见 `00-premise-freeze.json` P7/P8。

5. **控制塔面发现 4 条（登记，不自行修 `scripts/**`）** —— `31-ct-findings.json`
   `CT-D1051-01` `check-bypass-log.sh` 无参默认 base = 遗留分支（385 条假阳性 exit 1，实测复跑 382，随提交漂移）；
   `CT-D1051-02` `devdoc_writeset.py` 取表格首列 ⇒ 带 `#` ID 列的写集表（S2 源）**静默失效**，合法治理产物被判「夹带」（本卡实测：2 件）；
   `CT-D1051-03` machine 路径不消费 `at` ⇒ 同日验证必判 stale（与遗留 1 同源）；
   `CT-D1051-04` `synova-commit` 无变更可提交时 **exit 0 静默 no-op**（与成功不可区分）。

6. **V 的提示（保留在案，非退回）**：`tsc --noEmit` 存量 31 错与基线逐行相同 ⇒ 验收禁用「`npm run lint` 全绿」；本卡 9 文件零错误。

7. **未做的事（对齐派单 §一 排除项）**：3-4 导出 / 3-5 手机 / 3-6 创始人核验 / 3-7（不认领）；`scripts/golden-scenarios/**`（mac 域）未动；`.hbs` 第二轨未扩（D480 已定 markdown 主载体）；`src/agent/builtin-tools.ts` 与 `interactive-card.ts`、`intent-router.ts` 未动。
