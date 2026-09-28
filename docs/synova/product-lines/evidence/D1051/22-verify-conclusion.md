# D1051 独立复核 · 自验结论（成员 V）

> 任务 `task-3`（独立复核；**不由编码成员兼任**）+ `task-5`（窄复核：T4 新增判别性用例的真绿/真红）｜工作树 `/Users/wane/SynovaAgent/.synova-wt-d1051-verify`｜分支 `verify/d1051-line3-report-depth`
> 被验代码提交 = **`f47f90982b4dec10e407bd806e851aaad4f47fb4`**（核验：`git diff f47f9098..origin/feat/d1051-line3-report-depth -- src tests` → **空**；分支头 `ea72e805` 仅追加 `.claude/bypass.log` 1 行）
> 追加被验（T5）= **`dd885493`**（`test(d1051): report_view 帧 degraded/reason 判别性覆盖`，仅 `tests/routes/conversations-report-view.test.ts` **+50 行**）｜T5 对齐时分支头 = `fd0bbb2b`
> 规格 = `docs/plans/codex/implementation/SYNOVA-IMPL-DSH-D1051-line3-report-depth-20260928.md`｜Node `v24.19.0`｜vitest `4.1.8`
> 措辞纪律：本文件只给**自验结论**；通过与否归 CTO 收件闸 + K3，全文不使用「审计通过」表述。

---

## 〇 自验结论

**可提请独立审计**（退回项 0；原提示① **已闭环**（附四元组）；现存提示/留痕 2 项，见 §6）。

依据（全部可重跑，原始工件见 §5）：真实 HTTP 入口四条路径 12/12 步通过；7 套件 **67** 用例一次进程跑全绿零 skip（含 T5 新增 2 例）；7 处语义故障注入**逐个报红**且失败用例命中预期断言、复原后 sha 一致、对照组不连带红；架构棘轮 `new=0`（本地与 `SYNO_CI=1` 双口径）；红证在产品/测试/脚本面 **0 残留**、工作树除本证据目录外无改动。

---

## 一 实际执行了什么（套件名 + 用例数，禁手写——全部取自命令输出）

原始日志：`25-verify-suites.log.txt`（**一次 vitest 进程**跑 7 套件；`--reporter=verbose`；T5 后复跑）。

| 套件 | it 数 | expect 数 | 本次结果 |
|---|---|---|---|
| `tests/agent/report-depth.test.ts`（新） | 14 | 54 | 全绿 |
| `tests/agent/report-detailed.test.ts`（新） | 15 | 56 | 全绿 |
| `tests/routes/diagnosis-report-depth.test.ts`（新） | 7 | 41 | 全绿 |
| `tests/routes/conversations-report-view.test.ts`（新；T5 后 6→**8**） | 8 | 35 + T4 新增 | 全绿 |
| `tests/agent/report-assembler.test.ts`（回归） | 5 | 29 | 全绿 |
| `tests/agent/report-onepager-trace.test.ts`（回归） | 12 | 71 | 全绿 |
| `tests/agent/cycle-conclusion-service.test.ts`（回归） | 6 | 40 | 全绿 |

- 尾部摘要（原始）：`Test Files  7 passed (7)` / `Tests  67 passed (67)`；`✓` 行数 **67** == it 合计 67（A2 静默跳过判据）；单套件复跑 `Test Files 1 passed` / `Tests 8 passed (8)`、文件内 `it(` 计数 8、`grep -cE '\.(skip|todo|only)\('` = **0**。
- 新套件合计 **44 it**（42 + T4 的 2）；回归三件套 **23 it / 140 expect**（与派单口径一致）。
- 回归三件套**零改动**：`git diff --stat f47f9098^..f47f9098 -- <三文件>` → 空输出。
- T5 产品代码零改动（我自己跑）：`git diff --stat f47f9098..dd885493 -- src` → **空**；`git diff --name-only origin/main -- src tests | sort` → **仍为 9 文件**。

## 二 反向走入口（我自己从 HTTP 入口重走，不采用编码给的方式）

方法（与 C 的测试无共享代码）：真实 `express` 路由 + 真实 `better-sqlite3 ':memory:'` + 真实 `http.listen(0)` + `fetch`；固定诊断产物由**本脚本直写** `diagnosis_checkpoints`(phase=5)，**不经引擎、不经 C 的 helper**；LLM 用本地 OpenAI 兼容替身（D592 范式，不 mock 管线）；真实 `jwtAuthMiddleware` 挂载（`DEV_MODE=false` 无 Authorization）。
脚本：`23-reverse-entry-walk.ts`｜工件：`21-verify-entry-reverse.json`（每步 `status + headers + bodyBytes + bodySha256 + 原始片段`）。

| 步 | 动作 | 结果（原始） |
|---|---|---|
| S0 | 非白名单对照探针 | `401`（证中间件真在链上） |
| S1 | `GET .../report?format=markdown`（**无 depth**） | `200` · `X-Report-View-Depth: one_pager` · 860B · sha `8a4f8a56…` |
| S2 | `&depth=one_pager` | `200` · 与 S1 **字节相等**（同 sha） |
| S3 | `&depth=detailed` | `200` · `X-Report-View-Depth: detailed` · 五章齐备（结论/根因/专家完整推理/行动建议/数据时点）+ 尾行报告 ID + **sha 相异** `597ca119…` |
| S4 | `&depth=expert`（非法） | `200` · `X-Report-Depth-Degraded: UNKNOWN_DEPTH` · 落回一页纸（同 S1 sha） |
| S5 | `&format=json&depth=detailed` | `200` · **无**深度头 · JSON 分支零变化 |
| S6a/S6b | `POST /api/conversations`（建会话/第 2 轮无深度词） | `200` · 无 `report_view` 帧 |
| S6 | `POST /api/conversations/:id/messages`「**讲细一点**」 | `200` · 帧序列 `[…, agent_message, report_view, end]` · `depth=detailed` · markdown 含五章 · **无 error 帧** |
| S7 | 同端点「**说人话**」 | `200` · `report_view` `depth=one_pager` · markdown 860B 且 ≠ 详版 |
| S8 | 同端点不含深度词 | `200` · 帧序列无 `report_view`（零行为变化） |
| S9 | 未知 reportId | `404` `{code:'NOT_FOUND'}` |

**负控 N1（断言判别力自证）**：把固定产物字段名故意写错（`rootCauses[].description→title`、`expertReports[].findings→notes`）后重跑 → **S1/S3 报红**（10 PASS / 2 FAIL，退出码 1），其余步骤不受影响 ⇒ 我的断言对**内容**敏感，不是只看章节骨架或状态码。工件：`21b-verify-entry-reverse-N1.json`。

## 三 改坏即红实测（四元组，驱动可重跑）

驱动：`24-break-red-driver.py`｜工件：`20-verify-break-red.json` + `logs-break-red/`（每例 pre-green / 注入后 / 复原后 三段原始日志）。

| 例 | 注入（file 锚点） | verify 命令 | pre → 注入后 → 复原 | 失败用例（原始行） |
|---|---|---|---|---|
| R1 | `src/routes/diagnosis.ts` 深度解析强制回浅层 | `vitest run tests/routes/diagnosis-report-depth.test.ts` | 7/7 → **1 failed, 6 passed** → 7/7 | `③ 3-2 详细报告：?depth=detailed → 200 + 五章齐备 + 头回执 detailed` |
| R2 | 同锚点：缺省改 `'detailed'`（默认反转） | 同上 | 7/7 → **4 failed, 3 passed** → 7/7 | `② 零回归判别（J2）`、`① 归档产物可读`、`③`、`④` |
| R3 | `src/agent/report-assembler.ts` 删「行动建议章」产出 | `vitest run tests/agent/report-detailed.test.ts` | 15/15 → **5 failed, 10 passed** → 15/15 | `① 五章标题字面齐备`、`④`、`⑤`、`⑥`、`⑮` |
| R4 | `src/agent/report-depth.ts` 词表命中短路（深度词恒不命中） | `vitest run tests/routes/conversations-report-view.test.ts tests/agent/report-depth.test.ts` | 20/20 → **10 failed, 10 passed** → 20/20 | `① 「讲细一点」→ report_view…`、`④ 词表两方向…`、`⑩ 最长匹配优先` 等 |
| R5 | `src/agent/report-assembler.ts` fallback 的「（降级：」标记静默化 | `vitest run tests/agent/report-detailed.test.ts` | 15/15 → **2 failed, 13 passed** → 15/15 | `⑧ 注册表缺 detailed_report → 落 fallback 并含降级标记`、`⑨ registry.render 抛错…` |

- 五例 `revert` 后文件 sha **均复原**（`shaRestored: true`），复原后同命令**全部复绿**。
- **无一例「注入后仍绿」** ⇒ 被验的这 5 组断言**不属** grep 型静态判据，无需退回。
- 附加留痕探针 **R6**（T3 期，`src/routes/conversations.ts` 的 `isDegradedRender` 恒 `false`）：pre 6/6 → 注入后 **6/6 仍绿** → 复原 6/6 ⇒ 当时该路径零断言覆盖（**提示①**）。

### 三.5 T5 窄复核：T4 新增判别性用例的真绿 + 真红（四元组，我自己跑）

被验提交 `dd885493`（`tests/routes/conversations-report-view.test.ts` **+50 行**，产品代码零改动）。
驱动：`24-break-red-driver.py --only R6,R6c --out 20b-verify-break-red-R6.json`｜工件：`20b-verify-break-red-R6.json` + `logs-break-red/R6*-*.log.txt`。

| 例 | 注入（file 锚点） | pre → 注入后 → 复原 | 失败用例 + 原始断言 |
|---|---|---|---|
| **R6** | `src/routes/conversations.ts` `isDegradedRender` 恒 `false`（C 指定的 R6 型故障） | 8/8 → **1 failed, 7 passed** → 8/8 | `⑦ 渲染降级路径…`；`AssertionError: expected false to be true` @ `tests/routes/conversations-report-view.test.ts:288:35`（`expect(view?.data.degraded).toBe(true)`） |
| **R6c** | `src/agent/report-assembler.ts` `detailedReportFallback` 的「（降级：」抹掉（**第二独立注入源**） | 8/8 → **1 failed, 7 passed** → 8/8 | 同上（⑦ 红，同一断言点） |

- 对照组 **⑧「防恒真」未连带红**（`expectGreenStillGreen: ['⑧ 对照']`、`expectGreenCollateralFailures: []`）⇒ ⑦ 是**方向性**判别（只在该降级路径红），⑧ 是有效反证。
- 两例 `shaRestored: true`、复原后同命令复绿；**无「注入后仍绿」** ⇒ ⑦ **是判别性夹具**（提示① 闭环，见 §6）。
- 补充核验 C 的三条关键信息（不采信转述）：
  1. **可达性**：成立——⑦ 自身通过即证 `getReportTemplateRegistry(new ThrowingRegistry())` 面可达；另我的探针（`23b`/`28`）给出**第二个**可达面（注册「会抛的模板」），见 §6 提示③。
  2. **「易踩空」说法**：**机制成立、后果表述不成立**——`src/l3/report-templates.ts:333-338` 确把模板异常吞成 `模板渲染失败: …` 字符串；但 `src/agent/report-assembler.ts:740` 有 `startsWith('模板渲染失败')` 判定 ⇒ 注册「会抛的模板」**仍会触发 fallback**（探针实测 `degraded:true, reason:'RENDER_DEGRADED'`）。覆写 `registry.render` 的真正价值是覆盖**异常路径**（`report-assembler.ts:755` 的 catch），不是「唯一可达面」。
  3. **C 自测四元组**：我复现出同形态结果（`1 failed | 7 passed`，⑦ 红 / ⑧ 绿）——见上表，且**由我自己注入、自己跑**。

## 四 控制塔门禁独立复核（原始输出：`27-verify-gates.txt`）

- `bash scripts/check-architecture.sh` → `EXIT=0`，`架构检查: 全部通过 ✅`；1b/1c/1d 三段均**无 NEW 行**。
  棘轮基线（`tests/architecture/l1-cross-layer-baseline.txt`）：`[L1→L3] conversations.ts=1 / diagnosis.ts=1`、`[L1→L5] conversations.ts=1 / diagnosis.ts=4` —— 实测命中与基线**相等**（本卡把 L5 动态引入收敛为单点 `loadSessionStoreModule`，未抬升计数）。
  `SYNO_CI=1 bash scripts/check-architecture.sh` → `EXIT=0`（CI strict 口径同样通过）。
- `bash scripts/control-tower/check-bypass-log.sh origin/main` → `EXIT=1`（报 f47f9098 缺 COMMITTED 记录）——**经核为分支位置产物，非缺陷**：该记录由 hook 的后续自动提交 `ea72e805` 登记；对**真实交付头**跑同一脚本 `check-bypass-log.sh origin/feat/d1051-line3-report-depth` → `EXIT=0` `✅ bypass.log 对账通过`，且 `bypass.log:1876` 可见 `HASH=f47f90982b4dec…`。
- `npx tsc --noEmit` → `EXIT=2`，**31 行错**，与基线 `d8590040` **逐行相同**（剔除 npm notice 噪声后 `diff` 0 行）⇒ 存量、非本卡引入；其中 `src/` 仅 3 处（`src/connectors/ima.ts:143`、`src/server.ts:464/465`），**本卡 9 个改动文件零错误**。工件：`26a/26b/26c`。

## 五 证据工件 + 复现命令

| 工件 | 内容 |
|---|---|
| `20-verify-break-red.json` + `logs-break-red/` | T3 改坏即红 R1–R5 + R6 留痕探针四元组 + 三段原始日志（**已剔除 `^{"level":` 应用日志行，测试行/摘要/失败断言逐行保留**） |
| `20b-verify-break-red-R6.json` | T5 窄复核四元组（R6 / R6c：⑦ 注入即红、⑧ 对照保持绿、revert 复绿） |
| `21-verify-entry-reverse.json` | 反向走入口 12 步（status/headers/bytes/sha256/原始片段） |
| `21b-verify-entry-reverse-N1.json` | 负控（字段名写错 → S1/S3 报红） |
| `22-verify-conclusion.md` | 本文件 |
| `23-reverse-entry-walk.ts` / `23b-probe-throwing-template.ts` | 可重跑 harness / throwing-template 探针 |
| `24-break-red-driver.py` | 改坏即红驱动（支持 `--only/--out`） |
| `25-verify-suites.log.txt` | 7 套件 verbose 原始输出（`✓` **67** 行 + 摘要） |
| `26a/26b-tsc-*.log.txt` + `26c-tsc-*.txt` | tsc HEAD / 基线 / 干净对比 |
| `27-verify-gates.txt` | 架构 + 绕过台账 + 棘轮基线原始输出 |
| `28-verify-probe-throwing-template.txt` | 「会抛的模板」探针原始输出 + 相关产品代码 grep（核验 C 关键信息②） |

复现：
```bash
cd /Users/wane/SynovaAgent/.synova-wt-d1051-verify
npx vitest run tests/agent/report-depth.test.ts tests/agent/report-detailed.test.ts \
  tests/routes/diagnosis-report-depth.test.ts tests/routes/conversations-report-view.test.ts \
  tests/agent/report-assembler.test.ts tests/agent/report-onepager-trace.test.ts tests/agent/cycle-conclusion-service.test.ts
D1051_HEAD=$(git rev-parse HEAD) npx tsx docs/synova/product-lines/evidence/D1051/23-reverse-entry-walk.ts
python3 docs/synova/product-lines/evidence/D1051/24-break-red-driver.py                                  # T3 全量六例
python3 docs/synova/product-lines/evidence/D1051/24-break-red-driver.py --only R6,R6c \
  --out docs/synova/product-lines/evidence/D1051/20b-verify-break-red-R6.json                            # T5 窄复核
NODE_PATH=/Users/wane/SynovaAgent/node_modules npx tsx --tsconfig tsconfig.json \
  docs/synova/product-lines/evidence/D1051/23b-probe-throwing-template.ts                                # T5 探针
bash scripts/check-architecture.sh ; SYNO_CI=1 bash scripts/check-architecture.sh
```

## 六 提示与局限（**不构成退回理由**，供 CTO/K3 裁决）

① **原覆盖盲区 —— 已闭环（T5 实测）**：`report_view` 帧的 `degraded` / `reason='RENDER_DEGRADED'` 分支（`src/routes/conversations.ts:333-340`）在 T3 期为**零断言覆盖**（当时 R6 注入后 6/6 仍绿）；T4 补测 `dd885493`（新增 ⑦ 降级路径 + ⑧ 防恒真对照）后，我用**自己那份注入**实测：⑦ **注入即红**（`AssertionError: expected false to be true` @ `conversations-report-view.test.ts:288:35`）、⑧ 保持绿、revert 复绿（四元组见 §3.5 / `20b-verify-break-red-R6.json`）⇒ **该判别性夹具成立、覆盖盲区闭合**。
② **tsc 存量**：31 行错与基线逐行相同（3 处 src + 28 处 `extensions/sentinels/_extinct/**`）；不是本卡引入，但意味着「`npm run lint` 全绿」在当前 main 上**不成立**，不能用它当验收判据。
③ **对 C 关键信息②的更正（实测，非阻塞）**：C 称「注册一个会抛的模板**不会**触发 fallback（被吞成 `模板渲染失败: …`）」——**机制对、后果不对**。实测探针（`23b`/`28`）：注册会抛的 `detailed_report` 模板后，帧仍为 `degraded:true, reason:'RENDER_DEGRADED'`、markdown 为 fallback 文面；因为 `src/agent/report-assembler.ts:740` 有 `startsWith('模板渲染失败')` 判定 ⇒ 字符串路径同样落 fallback。**该更正不影响 ⑦ 的有效性**（⑦ 走 registry 覆写面，且已被两次独立注入证明判别力）；建议 C 修正测试内注释里「否则会踩空」的表述，避免后续读者被误导（是否修由 CTO 定，属注释级）。
④ **方法局限（自报）**：报告端点的**引擎未参与**（固定产物直写 checkpoint，只验呈现层——这正是切片范围）；对话路径的 LLM 为本地替身而非真实模型（替身模式下不得冒充真实 LLM 断言，D592 先例）。
⑤ **字面量 grep 误报**：全树 `INJECTED-RED` 命中含**既有散文/历史证据引用**（D922/D935/D1028 已记录同型误报）+ 本卡证据工件自身的记载。**活夹具判据**取产品面：`grep -rn "INJECTED-RED" src/ tests/ scripts/` → **0**；`git status --porcelain` 除本证据目录外无改动。

## 七 归属与边界

- 只读产品代码：全部注入均在注入后 `git checkout --` 复原（每例 sha 比对 `shaRestored: true`），`src/` 最终状态 == `f47f9098`。
- 未触碰 `scripts/**`（控制塔/K3 面）、未触碰 `scripts/audit/**`、未改 `.github/**`。
- 本文件不含「审计通过」措辞；**是否通过归 CTO 收件闸 + K3 终审**。

## 八 交付回执（M6 收尾三件 + ls-remote 回执）

### 8.1 被验代码（物理核验）
```
$ git diff f47f9098..origin/feat/d1051-line3-report-depth -- src tests   → （空输出：代码面一致）
$ git merge-base --is-ancestor f47f9098 origin/feat/d1051-line3-report-depth   → YES（实现提交仍在发布分支历史中）
$ git log --oneline -1 origin/feat/d1051-line3-report-depth
1d340c62 chore: bypass COMMITTED 登记 (auto hook, D521)
```
说明：发布分支头在本轮复核期间由 `ea72e805` 前进到 `1d340c62`（新增纯 docs 提交 `3e113504` spec 口径回填 + hook 自动登记），`git diff ea72e805..3e113504 -- src tests` 为**空**、`git diff f47f9098..origin/feat -- src tests` 亦为**空** ⇒ 被验代码面未变。

### 8.2 复核分支与提交
```
分支: verify/d1051-line3-report-depth
证据提交（含本目录全部工件 + 本文件）: cc518daa3c60c8d327687d809e069ec25ae69535
  - 内容: 90a57ebd（证据提交）→ 7a6192ff（hook 自动登记）→ cc518daa（合并发布头 ea72e805/后续 docs）
$ git diff --stat f47f9098..cc518daa -- src tests   → （空输出：本分支未改产品代码）
```

### 8.3 ls-remote 回执（原始输出）
```
$ git ls-remote --heads origin | grep d1051
f23f18b6445e247e0b17c08e5a4a5adfee15ac05	refs/heads/docs/d1051-line3-spec
1d340c62c5b29acf27f5e8b077f356f1377998e1	refs/heads/feat/d1051-line3-report-depth
cc518daa3c60c8d327687d809e069ec25ae69535	refs/heads/verify/d1051-line3-report-depth
$ git rev-parse HEAD
cc518daa3c60c8d327687d809e069ec25ae69535
```
（本回执文件自身的提交会使分支 tip 前移一次；以 `git ls-remote` 实时输出为准。）

### 8.4 遗留清单（提示项，非退回项）
- ① `report_view` 帧 `degraded`/`reason='RENDER_DEGRADED'` 分支零断言覆盖（R6 实证 6/6 仍绿）——是否补测由 CTO/K3 定。
- ② `npx tsc --noEmit` 存量 31 行错（与基线逐行相同；本卡 9 文件零错误）——不得以「lint 全绿」当验收判据。
- ③ 我的 harness 与 C 的测试**互不依赖**；但两者共用同一 `diagnosis_checkpoints` 归档契约——若后续该契约变更，两处需同步复核。
- ④ 本分支为**复核分支出库**，未走 PR；如需归档请按 CTO 流程处置（本文件不主张合并）。

## 九 T5 窄复核交付回执（task-5）

### 9.1 三件事的实测结果
1. **产品代码未变动**（我自己跑）：`git diff --stat f47f9098..dd885493 -- src` → **空**；`git diff --name-only origin/main -- src tests | sort` → **9 文件**（与 T3 期一致）；T4 只动 `tests/routes/conversations-report-view.test.ts`（**+50 行**）。
2. **新用例真绿**：单套件 `npx vitest run tests/routes/conversations-report-view.test.ts` → `Test Files 1 passed (1)` / `Tests 8 passed (8)`，`✓` 行数 **8** == 文件内 `it(` 计数 **8**，`skip|todo|.only` 命中 **0**；7 套件合计 `Tests 67 passed (67)`、`✓` 行数 **67**（T3 期为 65）。
3. **新用例真红**（我自己注入，四元组见 §3.5 / `20b-verify-break-red-R6.json`）：R6（`isDegradedRender` 恒 false）与 R6c（fallback 降级标记抹掉）两处独立注入，均 **8/8 → 1 failed, 7 passed（⑦ 红，失败断言 `expected false to be true` @ `conversations-report-view.test.ts:288:35`）→ revert → 8/8**；对照组 ⑧ 未连带红。

### 9.2 C 的三条关键信息（独立核验结论）
- ① **可达性**：**成立**（⑦ 自身通过即证该注入面可达）；另发现**第二个**可达面（注册会抛的模板），见 §6 提示③。
- ② **「易踩空」**：**机制成立、后果表述不成立**——`report-templates.ts:333-338` 确吞异常为「模板渲染失败: …」字符串，但 `report-assembler.ts:740` 的 `startsWith('模板渲染失败')` 判定使 fallback **仍被触发**（探针实测 `degraded:true`）。
- ③ **C 自测四元组**：**与我独立复现同形态**（`1 failed | 7 passed`，⑦ 红 / ⑧ 绿）。

### 9.3 收尾三查（原始值）
```
$ git status --porcelain → 空（改坏实验已 revert 干净）
$ grep -rn "INJECTED-RED" src/ tests/ scripts/ → 0
$ bash scripts/control-tower/check-bypass-log.sh origin/main → exit 0（对账通过）
```

### 9.4 ls-remote 回执（原始输出）
```
$ git ls-remote --heads origin | grep verify/d1051
5ba9d9abf2ce54bf37ea7dc64078ed8f6708ae84	refs/heads/verify/d1051-line3-report-depth
```
（本回执提交会使分支 tip 再前移一次；以 `git ls-remote` 实时输出为准。）
