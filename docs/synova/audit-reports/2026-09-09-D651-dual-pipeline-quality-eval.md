# 2026-09-09-D651 双线编码管线代码质量独立对比评估

> 评估人：独立第三方（本报告为 D651 交付物）
> 评估时点：github.com/tangbaobao520/SynovaAgent `main` @ `742a3416`（唯一事实源）
> 独立工作区：`/Users/wane/Synova-k3独立审计/.audit-clone-d651`（全新 clone，零本地状态携带）
> 环境：macOS 25.3 arm64 · node v22.22.0 · npm 10.9.4 · vitest 4.1.8 · typescript 5.9.3
> 结论纪律：本报告只报可复核的物理事实与分维度证据，不做"谁好谁坏"的笼统标签；最终判断留给创始人。

---

## §0 评估说明（方法论与独立性）

1. **零上下文**：从 `git clone --no-tags https://github.com/tangbaobao520/SynovaAgent.git` 全新建立 `.audit-clone-d651`，检出 main @ `742a3416`，未携带任何既有记忆/工作区修改。clone 内 `git status` 全程干净（运行全量测试产生的 `heartbeat.json`/`thresholds.json` 写入已在复跑前 `git reset --hard` 还原，仅按样本文件范围复跑）。
2. **不采信自述**：task-state、交付声明、过往 K3 报告（含 D551 PASS、D487 CONDITIONAL PASS 等）一律只作线索；每条结论以本评估人物理复现为准（grep/读码/复跑/退出码）。
3. **每样本五步，全部物理执行**：读 spec → 写集对账（git show 实际 diff）→ 独立复跑测试（记录退出码与用例数）→ 逐维度评分（file:line 或复现命令）→ 顺序纪律（8 样本全部评分完成后才做跨侧对比）。
4. **仓库自定标准仅作背景**：AGENTS.md/CLAUDE.md 铁律与门禁体系是被评估方自定的标准，不作为评分主轴；评分主轴为业界通用工程质量标准（见 §1）。
5. **公平性处置（两侧同规则）**：材料完整性（W1 历史文档缺口、M2 evidence/D575/ 12 件未入 git、M4 dev doc 未入库）作为「管线过程数据」单独记录于 §5.4，不混入代码质量评分；代码分只基于评估人实际拿得到的材料，两侧同规则。
6. **环境注记先行**：Windows GUI、桌面端冷启动渲染、真实 DeepSeek 上游连通性、CI job 结果（需 GitHub API/权限）为环境受限项，与本地独立复跑证据严格区分标注；全量套件基线中的失败按桶归类于 §2.3。

---

## §1 评估维度表（评估人自行制定）与制定理由

**制定理由**：本评估不采用仓库自带的铁律/门禁清单（被评估方自定标准，直接采用会丧失独立性）。维度取自业界通用工程质量的公共交集——Google Code Review 指南（正确性/可维护性/测试）、IEEE 9126/25010 质量模型（可靠性/可维护性）、Pragmatic Programmer（正交性/DRY/诚实代码）以及一线大厂代码评审实践（spec 忠实度、类型卫生、返工可追溯性）。每维度 0–10 分，权重合计 100%。

| # | 维度 | 权重 | 内容 | 10 分锚点 | 0 分锚点 |
|---|------|------|------|-----------|----------|
| C1 | 正确性与边界 | 20% | 实现与 spec 语义一致；边界条件（空/单元素/重复/并发/未初始化）处理正确；状态一致性 | 所有声明行为可物理复现，边界全部处理且测试证明 | 主路径与声明不符，或存在可复现错误行为 |
| C2 | 健壮性与错误处理 | 15% | 失败路径完整性；无静默吞错（空 catch/吞异常继续）；降级诚实（明确 degraded 信号，不假装成功） | 所有失败路径有记录、有可观测降级信号 | 存在静默吞错或降级不诚实 |
| C3 | 测试质量 | 20% | 断言强度（真断言 vs 仅调用）；覆盖真实性（正常+降级+边界，非空壳）；mock 语义保真；失败可诊断性；独立复跑结果 | 断言强、三路径覆盖、mock 保真、独立复跑全绿 | 空壳测试/仅快照存在性/断言无法失败 |
| C4 | 可维护性 | 15% | 命名/结构/复杂度/重复/死代码/注释诚实（注释与行为一致） | 命名准确、结构清晰、无死代码、复杂度受控 | 命名误导、重复膨胀、死代码成片 |
| C5 | spec↔实现一致性 | 15% | 写集对账：多做/少做/偏离的比率与性质（管线传递损耗） | 写集 0 漂移，声称条目逐条可查可复现 | 写集大面积漂移或核心声称落空 |
| C6 | 类型安全与卫生 | 10% | tsc/静态检查干净；无 as any/断言滥用；无调试残留/格式漂移 | 受影响文件集 tsc 干净、无断言滥用 | 新代码引入类型错误或 any 扩散 |
| C7 | 管线过程质量 | 5% | dev doc 本身质量；自检诚实度；返工迭代（git log 迭代次数与原因）；材料完整性（单独记录于 §5.4，本维度只评文档质量与迭代诚实） | 一次到位，文档准确、自检如实 | 文档空洞、自检失实、返工反复 |

**加权总分** = Σ(维度分 × 权重) × 10，满分为 100。总分为评估人算术汇总，仅表示"同一把尺子下的相对位置"，不构成胜负标签。

---

## §2 全局基线（独立 clone 物理实测）

### 2.1 评估点与工作区状态

```
$ git rev-parse HEAD           # 742a34160bd9e4a1c11fcc3665390e22e4ce4d24（= github main）
$ git status --short           # 干净（复跑前后均核验）
$ npx tsc --noEmit ; echo $?   # exit 2，28 errors（基线）
```

tsc 28 errors 分布（`grep 'error TS' | cut -d'(' -f1 | sort | uniq -c`）：
- `extensions/sentinels/_extinct/` 8 个文件 26 条（模块解析 + 隐式 any，存量）
- `src/server.ts:439,440` 2 条（`git blame` 证实为 2026-07-24/07-26 存量，非任何样本引入）

### 2.2 全量测试基线（`npx vitest run`，exit 1）

```
Test Files  10 failed | 582 passed | 3 skipped (595)
Tests  29 failed | 4245 passed | 24 skipped (4298)
```

### 2.3 基线失败三桶归类（与 8 样本写集均无交集，逐一核对）

| 桶 | 文件 | 失败数 | 归因（物理核实） |
|----|------|--------|------------------|
| ① 专家测试债 | tests/expert/analytical-lens.test.ts | 7 | 测试期待已删专家（strategy/org/finance/marketing/action/business_model/knowledge 的 IDENTITY.md）；D282 迁移 9→7 未同步测试，D583(Win 侧) 曾对齐后经 `aac96116` 部分回退 |
| ① 专家测试债 | tests/agent/expert-file-loader.integration.test.ts | 5 | 断言 `names.length >= 8` 且含 `strategy`/`business_model`，fresh clone 实测 fromFiles=7 |
| ① 专家测试债 | tests/orchestrator/phase1-diagnosis-wiring.test.ts | 1 | `expect(results.length).toBe(7)` 期待旧 7 专家名（action/business_model/...），实测 6 |
| ① 专家测试债 | tests/orchestrator/l3-wiring.test.ts、tests/l3/e2e-autonomy.integration.test.ts、tests/l3/graphbridge-wiring.test.ts | 4 | 同源（7 专家派发断言，实测 6） |
| ② D593 自身测试 | tests/routes/diagnosis-report-persistence.test.ts | 10 | D593（DSH/Mac 线，dev doc `SYNOVA-IMPL-DSH-D593-report-persistence-20260908.md`）自身测试在 main 全红（checkpoint 落盘 0 行）；与 8 样本无关，为 Mac 线在评估时点的"自家套件不绿" |
| ③ 环境依赖 | tests/e2e/p0-client-a.test.ts、tests/electron/use-streaming-conversation.test.ts、tests/acceptance/zero-code-industry.test.ts | 2 | LLM API / Electron GUI / acceptance（vitest.config.ts 注明 CI 排除项） |

> 结论：main@742a3416 的测试套件**不是绿的**；但与 8 个被评估样本相关的测试文件全部独立复跑通过（见 §3 逐样本）。基线失败属于仓库级技术债，按管线归属记录于 §5.3。

---

## §3 八样本五步评估

> 每样本格式：**①spec 摘录 → ②写集对账 → ③独立复跑（命令+退出码）→ ④维度评分（证据 file:line）→ ⑤五步小结**。所有代码行号以评估时点 main 工作树为准。

### W1 | D485 | register 认证闭环·切片 C——双轨账号关联（Win）

**① Spec 摘录**（`docs/plans/codex/implementation/SYNOVA-IMPL-D485-account-link-slice-c-20260825.md`）
- 写集 3 文件：`src/growth/user-store.ts`（updateUser props + orgId）、`src/routes/enterprise.ts`（accept 查重绑定）、`tests/routes/enterprise.test.ts`（+3 用例，20 总）
- 验收：绑定 userId 不变/orgId 更新/linked=true、密码不重置、新 email linked=false、个人账号调企业端点 403 不削弱
- §3.2 同 commit 回填两项偏离：bcrypt 密码验证（失败 401 + token 不消耗）+ 非 active 账号 403 拒绝

**② 写集对账**（`git show a69fd5b1`，PR #194 squash）
- 实际 12 文件 = 3 写集 + 7 簿记（bypass.log/reference-map/task-brief/devdoc/memory/台账）+ task-state/D485.json + `scripts/control-tower/verify-parallel.sh`（+1 行 CRLF 剥离）
- verify-parallel.sh 不在 spec §3.1 写集表；task-state `carried_fix` 字段 + commit message 双处披露（V5.1.2 修复借道合入）——披露诚实，但 spec DS5「与写集一致」字面不成立

**③ 独立复跑**（exit 码=实际 `$?`）
```
npx vitest run tests/routes/enterprise.test.ts                                  → exit 0，20/20 pass
npx vitest run tests/middleware/auth.test.ts tests/middleware/auth.integration.test.ts tests/routes/auth.test.ts → exit 0，40/40 pass
tsc：user-store.ts / enterprise.ts 在 28-error 基线中零 error（grep 实证）
```

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.0 | 绑定链路 userId 不变/密码延续/错误密码 401+token 不消耗：enterprise.ts:229-253 + 测试 ⑦（enterprise.test.ts:385-505）；跨组织绑定无 `orgId==='default'` 限制（enterprise.ts:229-241）——任何 active 账号被邀请即可重定向组织归属（密码=所有权证明可缓解，但个人轨语义超范围） |
| C2 | 7.5 | token/password 缺失 400（enterprise.ts:216）；500 带 degraded:true（:258-260）；但 updateUser 内部 catch 吞错（user-store.ts:218-224，仅 log.warn 返 void）→ accept 绑定成功信号无法反映持久化失败（enterprise.ts:241）——seam 处降级不诚实风险 |
| C3 | 8.5 | 20/20 独立复跑；断言强度高（GraphStore 实证 orgId/default 组织移除/原密码重登录身份变化/错误密码 token 不消耗）；真实 express+native fetch 无 mock。缺口：ACCOUNT_DISABLED 分支（enterprise.ts:230-232）全仓零测试（`grep -rn ACCOUNT_DISABLED tests/` 零命中） |
| C4 | 8.5 | 命名/注释准确（威胁模型注释 enterprise.ts:226-229）；linked 显式区分；最小 diff |
| C5 | 8.0 | §3.2 两项偏离同 commit 回填含威胁模型与参考系（诚实）；verify-parallel.sh 越界写入经 carried_fix 披露；RED 声明（2 failed|18 passed）无法物理重放，GREEN 复现成立 |
| C6 | 9.0 | 写集文件 tsc 零 error；无新增 as any（Pick 类型精确扩展 user-store.ts:218） |
| C7 | 7.5 | PR 分支 9 commits（2 次 merge main、1 次 carried-fix merge、bypass.log 记录 1 次 pre-commit BLOCKED 2026-08-25T21:39）；DS7 CI 10/10 声明环境受限无法复核；任务说明披露的历史文档缺口评估时点已闭合（dev doc/task-state/brief 均入库） |

**⑤ 小结**：加权总分 **81.75**。实现质量扎实、测试真实，主要扣分点=吞错 seam 与未测分支。

---

### W2 | D487 | D394 片2-A——GA 诊断会话事件化装配（Win）

**① Spec 摘录**（`SYNOVA-IMPL-D487-ga-session-events-slice2a-20260828.md`）
- 目标：D500 事件溯源地基接生产链路；SessionEventType 扩 diagnosis_phase/module/report + CHECK 迁移；5 实例化点传 sessionManager；diagnosis-launcher 落流；测试 5 用例（red=现状仅 checkpoint）

**② 写集对账**（`git diff 6f2b69a8^1 6f2b69a8`，merge=PR #241 feat a8ee995f；后续 fix D558=41227cc1）
- 实际 15 文件：doc-header 写集 5 文件（含 server.ts 声明"不改"后纠正）；新增 cli.ts/im-inbound.ts/mcp/index.ts/tui-v2/index.ts/tui-v2/lib/bootstrap.ts 5 个未列入 header 写集——§3.2 全数同 commit 回填披露（含 sessionId 归属复核补强 c796da55）

**③ 独立复跑**
```
npx vitest run tests/agent/diagnosis-session-events.test.ts   → exit 0，5/5 pass
npx vitest run tests/store/session-event-log.test.ts          → exit 0，17/17 pass（含 D558 迁移 4 断言）
npx vitest run tests/conversation-engine.test.ts              → exit 0，11/11 pass（真实回归）
tsc：W2 触及文件零 error
```
- spec DS4 命令 `vitest run tests/agent/diagnosis-launcher.test.ts tests/agent/conversation-engine.test.ts` **引用的两个文件不存在**（实测 "No test files found, exiting with code 1"；真实回归文件是 `tests/conversation-engine.test.ts`）——DS4 声明字面不可复现（spec 缺陷）

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.0 | 5 实例化点接线逐一核实（cli.ts:96-102/124-131、im-inbound.ts:180-187、mcp/index.ts:225-249、tui-v2/index.ts:47、bootstrap.ts:685-692/703）；空 sessionId 跳过防护（diagnosis-launcher.ts:86-87）；迁移幂等（session-store.ts:227-262 读 sqlite_master 判定 + BEGIN/COMMIT/ROLLBACK） |
| C2 | 8.0 | 双写失败 log.warn+诊断继续（persistEvent 契约注释 diagnosis-launcher.ts:74-93）；迁移失败 warn 保留旧 CHECK（后续插入失败走 degraded）；deriveMessages 解析失败截断检测（session-store.ts:455-462） |
| C3 | 8.5 | 5/5+17/17+11/11 独立复跑；断言强（seq 严格单调/payload 可解析/阶段→模块→报告顺序/投影隔离/物理 DROP TABLE 双写失败）；D558 迁移测试 4 断言（旧 CHECK red 自证/行保留/seq 连续/幂等）。扣分=DS4 证据命令不可复现（spec 缺陷，归 C5/C7 更重） |
| C4 | 8.5 | persistEvent/persistingOnEvent 命名清晰；注释与行为一致；im-inbound.ts:183 `as never` 新引入一处弱类型（C6 扣） |
| C5 | 7.5 | header 写集 5 vs 实际 15（5 文件漂移），虽 §3.2 全披露，但并行安全声明（doc-header）与 verify-parallel 判据失准；DS4 文件路径错误；迁移落点（D558 补写）如实标注 |
| C6 | 8.5 | 触及文件 tsc 零 error；im-inbound `store['db' as keyof typeof store] as never`（im-inbound.ts:183）为新增断言弱化点 |
| C7 | 7.0 | feature 分支 1 次 merge main + docs 回填；K3 初审 CONDITIONAL PASS → P1（迁移测试缺失）→ D558 补测试+mcp as-any 清零（一次审计返修闭环）；verify-parallel 缺陷如实登记台账未擅自改门禁 |

**⑤ 小结**：加权总分 **81.00**。装配工程正确、迁移扎实；扣分集中在 spec 证据命令精度与写集声明漂移。

---

### W3 | D489 | D394 片2-B——consult 路由接线（Win）

**① Spec 摘录**（`SYNOVA-IMPL-D489-ga-consult-events-slice2b-20260829.md`）
- consult 路由不再直建引擎，改经 DiagnosisLauncher（D487 落流复用）；sessionStore 从 orchestration.db 构造 + createSession；写集 1 修改+2 新建；测试 4 用例；DS4 回归 D487 5/5 + tsc 零新增

**② 写集对账**（`git diff f55a6dbf^1 f55a6dbf`，squash ← 82d0463a；验收返修 D563=fc4424d5）
- 实际 6 文件 = spec 写集 3 + brief/bypass/devdoc 簿记，一致
- D563 返修：diagnosis.ts 双处 `as never` → `isSqliteDatabase` 类型谓词（当前态 diagnosis.ts:295-304）

**③ 独立复跑**
```
npx vitest run tests/routes/diagnosis-consult-events.test.ts   → exit 0，4/4 pass
npx vitest run tests/agent/diagnosis-session-events.test.ts    → exit 0，5/5 pass（D487 回归）
grep -n 'as any\|as never' src/routes/diagnosis.ts             → 零命中（D563 返修生效）
tsc：diagnosis.ts 零 error
```

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.5 | 会话装配链核实（diagnosis.ts:287-304：db 谓词窄化→SessionStore→createSession 非空 sessionId）；launcher 替换点（:332）；null 结果显式 sseError 收尾（:340-345）；wrapper runConsultation 参数序正确（:282-284） |
| C2 | 8.0 | 装配失败 log.warn+降级继续（:306-309，sessionId='' 走 launcher 空桶防护）；谓词失败抛 TypeError 同走降级通道；无 db 场景由测试 ③ 实证（4/4 中） |
| C3 | 9.0 | 4/4+5/5 独立复跑；真实 express+fetch，仅 mock 引擎工厂/provider/config（保真度好）；断言含空桶防线（每事件 sessionId=真实会话）、SSE 载荷无损透传、report 缓存零回归；RED 设计（现状零事件）内建于用例① |
| C4 | 8.5 | 注释与实现一致（行为差异逐条注释 :320-331）；无死代码；D563 后类型谓词替代断言 |
| C5 | 8.0 | §3.2 四项行为差异（concerns slice(0,200)/首条 phase_started 额外/background-review fire-and-forget/report 只落库）同 commit 披露；写集零漂移 |
| C6 | 8.5 | as any/as never 零命中；`as EngineContext`（diagnosis.ts:325，sessionStore excess property 断言）为剩余弱化点，非 any |
| C7 | 7.5 | K3 初审 CONDITIONAL PASS → D563 立项返修（断言→谓词，棘轮收紧）一次闭环；返修 commit 证据自述与实测一致 |

**⑤ 小结**：加权总分 **84.00**。Win 侧最高分样本；端到端接线干净、测试保真度高。

---

### W4 | D492 | task-decomposer DIMENSION_EXPERT_MAP 对齐 7 专家（Win）

**① Spec 摘录**（`SYNOVA-IMPL-D492-task-decomposer-expert-map-20260902.md`）
- 10 映射值对齐 registry v2.0 七专家；fallback org→host ×2；写集 2 文件；测试 red=executeSubTask 2 存量失败（旧专家名 degraded）

**② 写集对账**（`git show c2762846` + docs c4b3b2b6 + ledger a352f678）
- 实际 = spec 写集 2 + brief/bypass.log 簿记，一致；映射表与 spec §4.5 10/10 逐项一致

**③ 独立复跑**
```
npx vitest run tests/agent/task-decomposer.test.ts             → exit 0，12/12 pass
npx vitest run tests/agent/expert-router.test.ts tests/agent/expert-config-loader.test.ts → exit 0，18/18 pass
tsc：task-decomposer.ts 零 error
```
- DS1 证据命令精度问题：spec §8 声称 `grep -n "return 'finance'\|'marketing'\|'org'\|'strategy'\|'operations'" → 0 命中`，实测 **2 命中**（task-decomposer.ts:100/102，'org'/'strategy' 子串落在维度推断键上——意图正确、命令与声称不符）

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.5 | 映射 10/10 与 spec 一致（task-decomposer.ts:82-93）；executeSubTask 按 dimension 走 map（:251）与 subTask.expertType 双路径一致；测试无 mock——executeSubTask success 用例真实走 ExpertRouter + 真实专家文件（finance-structure/customer-cycle 可用性实证）。观察项：capital-cycle 专家在 decompose 映射中不可达（10 维度无一路由到它） |
| C2 | 7.5 | 改动为数据表修复，未新增错误路径；既有 executeSubTask catch → failed+降级保留（task-decomposer.ts:178-186） |
| C3 | 8.0 | 12/12+18/18 独立复跑；映射测试覆盖 3/10 条目（financial/talent/operational→host，L110-140），其余 7 个映射值无单独断言（回归盲区）；executeSubTask 真实派发断言强 |
| C4 | 8.5 | 最小精确改动；注释与行为一致 |
| C5 | 8.5 | 写集零漂移；§4.5 映射表与实现逐项一致；扣分=DS1 grep 命令与声称不符（§8 交付声明） |
| C6 | 9.0 | tsc 零 error；纯数据改动无断言滥用 |
| C7 | 8.0 | 单 fix commit + docs + ledger，无返工；dev doc 质量高（生产调用链 grep 实证 + S-14 无重复审计） |

**⑤ 小结**：加权总分 **82.75**。小任务完成度高；主要扣分=证据命令精度与映射测试覆盖盲区。

---

### M1 | D551 | GA 校准后端（Mac/DSH）

**① Spec 摘录**（`SYNOVA-IMPL-DSH-D551-ga-calibration-backend-20260828.md`，368 行）
- 4 端点（POST/GET calibration + POST signals + GET stats）；requireGa 提取共享；supersedes 版本链；回流双写 feedback_log（target_type 扩 diagnosis_conclusion）+ 迁移 d551_target_type；注入走 sentinel-service→runner（I2 零旁路）；stats note 诚实降级（回流计数≠采纳率）；测试 40（26+8+6）

**② 写集对账**（`git diff 6e9626f9^1 6e9626f9`，merge；feat 35ccd574）
- 实际 14 文件 vs spec §3.3.1 写集 11 文件：**agent-memory-store.ts 为写集偏差**（MemoryType +2 + CHECK 迁移 d551_memory_type + FTS 重索引）——commit message「三处声明」+ spec 最终版 §3.3.1 已回填该文件并注明偏差

**③ 独立复跑**
```
npx vitest run tests/routes/ga-calibration.test.ts tests/routes/ga-auth.test.ts tests/sentinel/ga-manual-injection.test.ts → exit 0，40/40 pass
npx vitest run tests/routes/ tests/sentinel/                  → exit 1，64 files：472 pass / 10 fail（10 条全部为 D593 预存失败，见 §2.3 桶②；M1 域全绿）
tsc：M1 全部触及文件零 error（server.ts:439-440 为 blame 证实的 2026-07 存量）
as any：ga-calibration.ts/ga-auth.ts/feedback-collector.ts/sentinel-service.ts 零命中
```

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.5 | 四端点契约与 spec §8.2 逐项一致；版本链校验（supersedes 须同 targetType+targetId，ga-calibration.ts:160-170）+ 反向索引 supersededBy（:254-257）；回流映射 add_context 不回流（:212-226）；扣分：GET 列表 store.list 固定 limit:200（:262）后客户端分页——超 200 条时 total/分页失真且无截断提示；stats 计数同受 200 cap 隐性封顶（:421-443） |
| C2 | 8.5 | 注入失败 503+SENTINEL_RUNNER_UNAVAILABLE+审计条目仍落库（:364-378）；回流失败 refluxDegraded 传播（:220-224）；迁移失败 log.warn 保旧表（feedback-collector.ts:230-233、agent-memory-store.ts:487-489）；runner 持久化失败→内存投影+重启即丢明示（runner.ts injectManualFinding） |
| C3 | 9.0 | 40/40 独立复跑（26+8+6）；断言强：认证三态/四动作回流映射逐条断言/CHAIN_ERROR 跨 target/枚举外 400/迁移重建（数据零丢失+新值可写+版本标记）/注入事件行+投影+I1 重建重放/severity 映射契约/runner 未初始化双层级降级 |
| C4 | 8.5 | 模块划分清晰（routes/service/runner/store）；契约 JSDoc 与实现同文；无死代码 |
| C5 | 8.0 | 写集偏差 1 文件三处声明 + spec 回填；决策六项带参考系；DS 与派单锚点一一对应 |
| C6 | 8.5 | tsc 零 error；as any=0；联合类型多行格式化 |
| C7 | 7.5 | spec 为 8 样本中最高工程规格（契约先行/file:line 基线锚定/red 设计/自复核修正记录 5 条）；但过程有文档滞后：编码 session 未提交 spec+task-state（05268502 CTO 补交）+ 编码指令补交（950c4eae CT-40）+ commit 自检引用的 evidence/D551/wiring-greps.txt **不在 git**（`git ls-files evidence` = 0，§5.4） |

**⑤ 小结**：加权总分 **84.75**。代码与迁移工程质量高；扣分=200-cap 分页语义与材料未入库。

---

### M2 | D575 | LLM 配置首启向导（Mac/DSH）

**① Spec 摘录**（`SYNOVA-IMPL-DSH-D575-llm-first-run-config-20260904.md`，322 行）
- credential seam（0600 原子写+分层解析+onChanged）；GET/POST /api/llm/config + POST /api/llm/test 稳定错误码；热重载=按请求解析；前端首启向导（LlmSetupCard 五态+黄条）；64 测试；synova.json 零 key（DS9）

**② 写集对账**（`git show c124f8c8`，PR #354 squash，父 436e216d）
- 13 写集（6 修改+7 新建）+ spec 同批提交（消解预登记漂移——按 spec 声明策略执行）；两处编码修正（挂载位前移至 jwtAuthMiddleware 之前、测试路径配对 ×2）在 spec 内回填

**③ 独立复跑**
```
npx vitest run tests/services/llm-credential-store.test.ts tests/routes/llm-config.test.ts tests/llm-config-frontend.test.ts → exit 0，64/64 pass
grep -c "apiKey" synova.json                                     → 0（DS9 可复现）
tsc：config.ts / llm-credential-store.ts / llm-config.ts 零 error
```

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.5 | 解析链（stored→LLM_API_KEY→14 级 env→''）与契约 A 一致（config.ts:77-82）；校验链白名单/provider 枚举/baseUrl http(s)/key 字符集（llm-config.ts:96-133）；热重载代理断言（同进程 POST 后 loadConfig 变化）在测试内 |
| C2 | 8.0 | 凭证损坏 warn+env 链降级（llm-credential-store.ts:128-143）；test 端点失败=200 数据语义+稳定码（:214-240）；订阅者异常隔离（:219-225）。**安全观察**：llmConfigRoutes 无认证挂载于 jwtAuthMiddleware 之前（server.ts:312-316，首启可用性权衡，spec 决策 5 明示）→ GET 暴露 provider/model/maskedKey + POST /api/llm/test 接受用户可控 baseUrl（可构造任意 URL 的 POST+Authorization 头，SSRF 面）——已收敛（响应零上游 body 透传/零 key 回显/10s Abort），但"本地单用户"假设在 server 部署形态下不成立（风险评估项） |
| C3 | 9.0 | 64/64 独立复跑；183 条 expect/64 用例；0600 物理断言（mode & 0o777 === 0o600，test:79）；stub 上游 401/429/500/拒连→错误码分类；热重载同进程断言；前端五态渲染+七码人话全断言 |
| C4 | 8.5 | store/routes/前端纯逻辑层/展示组件四层清晰；WELCOME_COPY.firstLaunch 死键删除+类型收窄（WelcomeScreen.tsx:72-73）；契约 JSDoc 与 spec 同文 |
| C5 | 8.0 | 写集 13 条+spec 同批提交（预登记策略执行）；两处编码修正 + CI 接线审计发现的 export 修正（getLlmCredentialFilePath 去 export）如实记录；DS9 可复现 |
| C6 | 8.5 | tsc 零 error；零 as any（类型收窄替代）；补 zustand 根 devDeps（CI 修复 ×2） |
| C7 | 7.5 | spec 极详（DSH 锚点抽验记录、G1-G5 硬守卫、六决策收敛）；3 轮 CI 驱动 fix（export 修正+zustand×2）均为环境/审计类低信号返工；**evidence/D575/ 12 件未入 git**（`git ls-files evidence` = 0；任务说明已披露，§5.4 记录不混入代码分） |

**⑤ 小结**：加权总分 **84.00**。垂直切片完整、测试三层扎实；扣分=无认证挂载的安全面与证据未入库。

---

### M3 | D577 | 哨兵阈值配置真实挂载（Mac/DSH）

**① Spec 摘录**（`SYNOVA-IMPL-DSH-D577-sentinel-threshold-wiring-20260905.md`，414 行）
- resolveThresholds 单一解析点（manifest 基线+memStore 覆写）；14 个 aggregate 换判定源（§4.2 三方对照表 30+9=39 判定点）；4 个 manifest 补 key/回填现值；DEPLOYS 静默返修；loader degraded 传播修复；DS8 flip 物理验证；DS9 裸阈值零残留

**② 写集对账**（`git show ece4e268`，PR #355 squash，父=c124f8c8）
- 实际 34 文件 = spec 写集 23 + docs/evidence 4 + task-state/briefs/bypass 等簿记，一致
- 派单说"34 判定点"、spec/commit 实测"39 判定点"——数字漂移（spec 自检注明派单粗筛 26 亦不准，§5.3 记录）

**③ 独立复跑**
```
npx vitest run tests/sentinel/threshold-injection.test.ts         → exit 0，10/10 pass（T1-T10）
D577_FLIP_TEST=1 npx vitest run tests/sentinel/threshold-manifest-flip.test.ts → exit 0，1/1 pass（DS8 物理 flip）
npx vitest run tests/sentinel/                                    → exit 0，214 pass / 1 skip（29 files）
tsc：sentinel-loader.ts / runner.ts / types.ts 零 error
DS9 独立复核：14 个 aggregate 逐文件 grep 裸阈值比较 → 13 文件零命中；opportunity-window 1 处为 ALLOWLIST 豁免（aggregate.ts:69 `> 0.7` 正向 info，注释明示 spec §6）
resolveThresholds 生产调用点 2 处（sentinel-loader.ts:259 wrapper + runner.ts:1208 getThreshold）——§8 接线判据达成
```

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 9.0 | 蓝绿基准（DEFAULT_THRESHOLDS=现值，T2 逐项同旧行为）；注入优先/缺 key warn/未注入 debug 三级 fallback 契约（customer-demand-shift/aggregate.ts:38-45）；getThreshold 委托行为等价且校验更严（runner.ts:1203-1222）；flip 测试物理证明"改配置即改行为"（DS8） |
| C2 | 8.5 | DEPLOYS 静默空返→log.warn+{findings:[],degraded:true}（customer-demand-shift/aggregate.ts:52-58）；loader degraded 传播修复（sentinel-loader.ts:271-288）；resolveThresholds 全路径降级不抛（:130-172）；memStore 非法值忽略+基线可用 |
| C3 | 9.0 | 10/10+1/1+214/214 独立复跑；T8 阈值卫生扫描为常驻断言；flip 测试 env 门控+try/finally 恢复 manifest；red 设计（T1 参数被忽略必红）内建于用例 |
| C4 | 8.5 | 14 文件统一 th() 范式；ALLOWLIST 豁免逐条注释；getThreshold 重复逻辑删除（消重） |
| C5 | 8.5 | 写集 23 文件零漂移；B3/B4 manifest 值回填为显式决策偏离（决策 D-2，蓝绿可证优先于字面禁改）；DS1-11 全覆盖；对照表 39 判定点逐文件可核（评估人实测 th() 消费点 45=39 新+6 存量） |
| C6 | 8.5 | tsc 零 error；类型契约三件套（types.ts）；无 as any 新增 |
| C7 | 8.5 | spec 为 8 样本最高质量（三方对照表逐文件核对、决策五带参考系、写集漂移预登记、缺陷 C 为 spec 自行补全）；evidence 4 件**入库**（docs/synova/audit-reports/D577-sentinel-threshold-wiring-evidence-20260905/）；3 轮 CI-format fix 低信号 |

**⑤ 小结**：加权总分 **87.00**（8 样本最高）。机制修复教科书式完成：单一解析点、蓝绿可证、降级诚实、证据入库。

---

### M4 | D567+D568 | 专家枚举传播修复 + enterprise-fact 版本链（Mac/DSH，同 PR #330）

**① Spec 摘录**：dev doc 未入库（任务说明已披露，`docs/plans/codex/implementation/` 无 D567/D568 文件，物理证实）。评估依据 = task-brief（.claude/task-briefs/2026-09-02-D567/D568）+ task-state + commit message 自述（仅作线索，逐条物理复核）。

**② 写集对账**（`git show 7b576c89`，squash，父 1f50e442）
- 实际 16 文件：D567 侧 6 src + D568 侧 scripts/control-tower/enterprise-fact-store.ts + 测试 3 + task-state ×2 + briefs ×2 + Note + bypass.log

**③ 独立复跑**
```
npx vitest run tests/control-tower/enterprise-fact-chain.test.ts tests/expert/expert-enum-propagation.test.ts tests/expert/manifest-consistency.test.ts → exit 0，21/21 pass
npx vitest run tests/control-tower/                        → exit 0，18/18 pass（signal-emitter 5 + fact-chain 4 + enterprise-facts 9）
npx vitest run tests/expert/ tests/agent/expert-router.test.ts → exit 1，48 pass / 7 fail（7 条全部为 analytical-lens 预存专家测试债，§2.3 桶①，非本样本回归）
tsc：cross-validator/expert-config-loader/cli-expert/engine-impl/runner/chat.tsx 零 error
```

**④ 维度评分**

| 维度 | 分 | 证据 |
|------|----|------|
| C1 | 8.5 | D567 四处枚举传播逐一核实：cross-validator.ts:74-80 动态+host 兜底、expert-config-loader.ts:95-107 getAllExpertIds、engine-impl.ts:526-541 映射 7 位对齐+运行时校验失效降级 host、runner.ts:73-105 LAYER_EXPERTS 对齐+旧 union cast 删除（:645-649）；D568 版本链：旧条目归档+supersededBy 回填+链头恒新（enterprise-fact-store.ts:96-110）、readFactVersion/listFactVersions 追溯（:180-227）、deleteFact 清理历史防孤儿（:163-179） |
| C2 | 7.5 | getAllExpertIds 空配置降级 []+调用方兜底契约（expert-config-loader.ts:100-104）；deleteFact 历史清理逐文件 try 隔离（:171-176）；扣分：createFact 归档成功但链头写入失败时留中间态（非事务文件写，enterprise-fact-store.ts:107-115 无回滚）；isVersionFileName 对含 ".v<数字>" 的 key 有误判面（:245-250，低概率） |
| C3 | 8.0 | 21/21+18/18 独立复跑；chain 测试覆盖归档/回填/链头读/版本列/删除级联（S-5 先红 3/4 声明无法重放，GREEN 复现成立）；enum-propagation 7 测试含 5 处现场封闭枚举回归锁；manifest-consistency 从 9 位硬编码改动态 |
| C4 | 8.5 | 注释与实现一致化（D568 主题）；唯一事实源访问器；删除旧 union 复制 |
| C5 | 7.5 | 无 dev doc 可对账（材料缺口）；基于 brief/task-state 的声称全部物理核实通过；brief 勘误（cross-validator/engine-impl 路径）如实修正 |
| C6 | 8.5 | tsc 零 error；删除类型断言（runner.ts:645-649）为正向改进 |
| C7 | 7.0 | 双任务同 PR 合并（D567+D568）；dev doc 未入库（§5.4）；观察项（sentinels manifest 旧专家 ID 数据层残留）主动披露待后续任务；S-5 先红留痕自述详实 |

**⑤ 小结**：加权总分 **80.25**（8 样本最低，主要受材料缺口与中间态影响）。修复本身方向正确、测试真实；过程材料是短板。

---

## §4 跨侧对比（8 样本全部评分后执行，同一把尺子）

### 4.1 加权总分与维度均值

| | C1 正确性 | C2 健壮性 | C3 测试 | C4 可维护 | C5 spec一致 | C6 卫生 | C7 过程 | 加权总分 |
|---|-----------|-----------|---------|-----------|-------------|---------|---------|----------|
| W1 D485 | 8.0 | 7.5 | 8.5 | 8.5 | 8.0 | 9.0 | 7.5 | 81.75 |
| W2 D487 | 8.0 | 8.0 | 8.5 | 8.5 | 7.5 | 8.5 | 7.0 | 81.00 |
| W3 D489 | 8.5 | 8.0 | 9.0 | 8.5 | 8.0 | 8.5 | 7.5 | 84.00 |
| W4 D492 | 8.5 | 7.5 | 8.0 | 8.5 | 8.5 | 9.0 | 8.0 | 82.75 |
| M1 D551 | 8.5 | 8.5 | 9.0 | 8.5 | 8.0 | 8.5 | 7.5 | 84.75 |
| M2 D575 | 8.5 | 8.0 | 9.0 | 8.5 | 8.0 | 8.5 | 7.5 | 84.00 |
| M3 D577 | 9.0 | 8.5 | 9.0 | 8.5 | 8.5 | 8.5 | 8.5 | 87.00 |
| M4 D567+D568 | 8.5 | 7.5 | 8.0 | 8.5 | 7.5 | 8.5 | 7.0 | 80.25 |
| **Win 均值** | **8.25** | **7.75** | **8.50** | **8.50** | **8.00** | **8.75** | **7.50** | **82.38** |
| **Mac 均值** | **8.63** | **8.13** | **8.75** | **8.50** | **8.00** | **8.50** | **7.63** | **84.00** |

（分差 ±0.25 以内视为同档；样本量 n=4/侧，数字仅代表本次抽样，不构成统计显著性主张。）

### 4.2 Win 侧 Top 3 优点（file:line）

1. **测试断言深度与集成保真**（W1）：绑定全链路 7 段断言（GraphStore 实证/default 组织移除/原密码重登录身份变化/错误密码 401+token 不消耗）`tests/routes/enterprise.test.ts:385-505`；真实 express+native fetch，零 mock 管线。独立复跑 20/20。
2. **幂等表重建迁移工程**（W2）：sqlite_master 建表 SQL 判定 + BEGIN/COMMIT/ROLLBACK + 失败保旧表降级 `src/store/session-store.ts:227-262`；由 D558 补 4 断言迁移测试（旧 CHECK red 自证/行保留/seq 连续/幂等）——审计返修闭环完整。
3. **端到端事件化接线干净**（W3）：consult→launcher→session_events 全链 + SSE 透传无损 + 空桶防线 `src/routes/diagnosis.ts:287-345`；D563 把断言升级为类型谓词（:295-304），as any/as never 终态零命中。

### 4.3 Win 侧 Top 3 问题（file:line）

1. **spec 证据命令不可复现**（W2）：DS4 引用不存在的测试文件 `tests/agent/diagnosis-launcher.test.ts`（spec §6 DS4；实测 "No test files found" exit 1）——交付声明中的"全绿"字面无法按命令重放。
2. **降级不诚实 seam**（W1）：`updateUser` 内部 catch 吞错返 void `src/growth/user-store.ts:218-224`，accept 绑定无论持久化成败都返回 linked:true `src/routes/enterprise.ts:241`——持久化失败时调用方收到假成功。
3. **分支无测试 + 证据命令不精确**（W1/W4）：ACCOUNT_DISABLED 403 分支 `src/routes/enterprise.ts:230-232` 全仓零测试；W4 DS1 grep 声称"0 命中"实测 2 命中（`src/agent/task-decomposer.ts:100,102`）。

### 4.4 Mac 侧 Top 3 优点（file:line）

1. **契约先行 spec 体系**（M1/M2/M3）：JSDoc 三要素契约先于实现（`src/sentinel/sentinel-loader.ts:116-172` resolveThresholds 契约与 spec §3-Q4 同文）；三方对照表 39 判定点逐文件 grep/read 核对（D577 spec §4.2）；red 设计内建（D577 T1/T8、D551 认证三态、D575 §5.4 red→green 表）。
2. **降级诚实度**（M3/M1）：DEPLOYS 静默空返→warn+degraded 传播（`extensions/sentinels/customer-demand-shift/aggregate.ts:52-58`）；resolveThresholds 全路径不抛（sentinel-loader.ts:130-172）；stats note 显式声明"回流计数≠采纳率"（`src/routes/ga-calibration.ts:457-460`）；注入失败 503+审计仍落库（ga-calibration.ts:364-378）。
3. **迁移工程成熟度**（M1）：双迁移（feedback_log + agent_memory）均 schema_version 幂等 + sqlite_master 判定 + 事务回滚 + FTS 全量重索引（`src/growth/feedback-collector.ts:178-236`、`src/l4/agent-memory-store.ts:426-500`），测试物理覆盖旧库重建路径。

### 4.5 Mac 侧 Top 3 问题（file:line）

1. **main 套件不绿——Mac 线自身测试红**（D593）：`tests/routes/diagnosis-report-persistence.test.ts` 10/13 红于评估时点（基线复跑 exit 1；checkpoint 落盘 0 行，用例 1 断言 `rows.length` 0 vs 1）。该任务 dev doc 为 DSH 线（SYNOVA-IMPL-DSH-D593-…），即 Mac 管线在 main 上留下红色套件。
2. **材料完整性缺口 pattern**：D551 commit 自检引用的 `evidence/D551/wiring-greps.txt` 不在 git（`git ls-files evidence` = 0）；D575 的 `evidence/D575/` 12 件未入 git（任务说明披露+物理证实）；M4 dev doc 未入库。证据链对第三方不可见（按约定仅记录为过程数据，未计入代码分）。
3. **无认证挂载的安全面**（M2）：`llmConfigRoutes` 挂于 jwtAuthMiddleware 之前（`src/server.ts:312-316`）+ `POST /api/llm/test` 接受用户可控 baseUrl 构造任意 URL 的 POST+Authorization（`src/routes/llm-config.ts:214-240`）——SSRF 面已做收敛（响应零透传/零回显/10s Abort）但"本地单用户"假设在 server 部署形态下不成立；GET /api/llm/config 同时暴露 provider/model/maskedKey。

### 4.6 可操作改进建议

| # | 建议 | 针对 | 依据 |
|---|------|------|------|
| 1 | 交付声明中的 verify 命令必须"照抄可复现"——把每一条 DS 证据命令在干净 clone 里原样执行一遍再入库（CT-53 已立此义，两侧都要落地） | 两侧 | W2 DS4 文件不存在；W4 DS1 grep 声称 0 实测 2；派单"34"vs 实测"39"判定点 |
| 2 | 更新用户等副作用方法返回结果（`{ok, error?}`），调用方据此传播 degraded | Win/W1 | user-store.ts:218-224 × enterprise.ts:241 |
| 3 | 未测分支补齐或删除：ACCOUNT_DISABLED 403、映射表 7/10 未断言条目 | Win/W1、W4 | enterprise.ts:230-232；task-decomposer.test.ts:110-140 |
| 4 | 分页/统计在存储层分页而非内存 200 cap；超窗时响应携带 truncated 信号 | Mac/M1 | ga-calibration.ts:262/286/421-443 |
| 5 | llm-config 端点至少加本机绑定/CSRF 防护或显式部署形态告警；test 端点 baseUrl 白名单化（仅 http(s)+端口限制） | Mac/M2 | server.ts:312-316；llm-config.ts:214-240 |
| 6 | evidence/ 统一入库规范：声称引用的证据文件必须 `git ls-files` 可见，否则声明降级为"不可核" | Mac/M1、M2、M4 | §5.4 材料缺口 |
| 7 | 专家测试债一次性清偿（analytical-lens/expert-file-loader/orchestrator 期待已删专家）；main 套件必须全绿才能作为后续任务的回归基线 | 两侧（债主跨线） | §2.3 桶① 19 条失败 |
| 8 | createFact 归档+链头写加补偿逻辑（写失败时恢复旧链头或明确中间态检测） | Mac/M4 | enterprise-fact-store.ts:107-115 |

---

## §5 管线级观察（过程数据，不计入代码分）

### 5.1 dev doc 质量对比

- **Win（Codex dev doc → Claude Code）**：规格形态为"计划书式"——§2 代码审计带 file:line、§3 写集表、§6 DS 清单、§8 交付声明表。质量良好（W4 生产调用链 grep 实证、W1 威胁模型同 commit 回填），但证据命令可执行性校验不足（W2 DS4、W4 DS1）。
- **Mac（CTO 派单 → dev-doc 预设 → 编码 session）**：规格形态为"工程契约式"——契约先行 JSDoc、三方对照表、red 设计、决策参考系、写集漂移预登记、自复核修正记录。D551/D575/D577 三份 spec 是 8 样本中规格密度最高的文档；但 M4 无 doc、D551 文档交付滞后（CTO 补交）。

### 5.2 返工迭代（git log 物理事实）

| 样本 | 返工轮次 | 性质 |
|------|----------|------|
| W1 | PR 分支 9 commits；bypass.log 1 次 pre-commit BLOCKED | 门禁失败 + 2 次 merge main + carried-fix 合入 |
| W2 | 1 次 merge main；K3 P1 → D558 补迁移测试 | 审计驱动的实质性补测（正反馈） |
| W3 | K3 CONDITIONAL → D563 返修（as never→谓词） | 审计驱动的类型卫生修复（正反馈） |
| W4 | 0 返工 | 一次到位 |
| M1 | 编码 session 未提交 spec/task-state（CTO 补交）+ 编码指令补交 | 流程纪律缺口（文档滞后） |
| M2 | 3 轮 CI 驱动 fix（export 修正、zustand devDep ×2） | 环境/接线审计类低信号返工 |
| M3 | 3 轮 CI-format fix（brief 换行/排除项路径） | 纯格式门禁返工（信号量低） |
| M4 | brief 勘误（文件路径）；dev doc 未入库 | 材料纪律缺口 |

观察：Win 侧返工多来自**审计/门禁的实质反馈**（补迁移测试、类型谓词）；Mac 侧返工多来自**CI 格式门禁与流程纪律**（brief 格式、证据未入库），实质返工少但材料缺口更多。

### 5.3 仓库级技术债（两侧共担，不归因单一样本）

1. 专家测试债（§2.3 桶①，19 条失败）：D282 枚举迁移未同步测试；D583(Win) 修复后部分回退（`aac96116`）。
2. tsc 28 errors 基线（_extinct ×26 + server.ts ×2，均存量）。
3. D593（Mac 线）自身测试 10 红于 main——两侧下轮任务若以"全量套件绿"为基线将无法成立。

### 5.4 材料完整性记录（公平性披露项，两侧同规则，不计入代码分）

| 项 | 状态（物理核实） |
|----|------------------|
| W1 历史交付文档缺口 | 评估时点已闭合：dev doc/task-state/brief 均入库（a69fd5b1 同 commit） |
| M1 evidence/D551/ | 未入 git（`git ls-files evidence` = 0）；commit 自检引用不可见 |
| M2 evidence/D575/ 12 件 | 未入 git（任务说明披露；物理证实 `git ls-files evidence` = 0） |
| M3 evidence/D577/ 4 件 | 已入库 ✓（docs/synova/audit-reports/D577-sentinel-threshold-wiring-evidence-20260905/） |
| M4 dev doc | 未入库（任务说明披露；物理证实 docs/plans/codex/implementation/ 无 D567/D568） |

### 5.5 数字漂移观察

- 派单 D577 说"34 判定点"，spec/commit 实测"39 判定点"（spec 自检注明派单粗筛 26 亦不准确）——派单画像数字不精确，但 spec 阶段自我纠偏了。
- W2 DS4 文件路径错误、W4 DS1 grep 声称与实测不符——Win 侧证据命令精度是系统性弱点。
- 全量测试复跑会向仓库工作树写入 `heartbeat.json`/`thresholds.json`（fresh clone 实测）——测试套件非纯读，与"只读评估"纪律相冲突，需 `git reset --hard` 还原（本次已处理）。

---

## §6 局限与声明

1. **环境受限项**（区分「独立复跑」与「复核证据」）：Windows GUI/桌面冷启动渲染、真实 DeepSeek 上游连通、CI job 级结果（GitHub API/权限）、历史 RED 状态（只能据 commit 自述+测试设计推断，不能重放）——均已在相应条目标注，不作为评分依据。
2. **样本量**：每侧 4 样本，结论只对本次抽样负责；两侧均值差 1.62 分（82.38 vs 84.00），在 0-100 量表上属同档区间，且被样本选择影响——仅作参考，不构成胜负标签。
3. **评分主观性**：维度权重由评估人制定（§1 已给理由）；所有扣分项均挂 file:line 或复现命令，可被第三方复核对冲主观性。
4. **独立工作区只读纪律**：评估全程未修改 clone 内 src/、electron-renderer/、门禁脚本、scripts/audit/、product-lines.yaml 及任何样本文件；仅新增本报告与 task-state/D651.json（如需）。

---

## 附录 A：核心复现命令索引

```bash
# 工作区
git clone --no-tags https://github.com/tangbaobao520/SynovaAgent.git .audit-clone-d651
cd .audit-clone-d651 && git rev-parse HEAD   # 742a3416...
npm ci && npx tsc --noEmit; echo $?          # 28 errors, exit 2（基线）
npx vitest run                               # 4245 pass / 29 fail / 24 skip, exit 1（基线）

# W1
npx vitest run tests/routes/enterprise.test.ts                      # 20/20, exit 0
npx vitest run tests/middleware/auth.test.ts tests/middleware/auth.integration.test.ts tests/routes/auth.test.ts  # 40/40, exit 0

# W2
npx vitest run tests/agent/diagnosis-session-events.test.ts         # 5/5, exit 0
npx vitest run tests/store/session-event-log.test.ts                # 17/17, exit 0
npx vitest run tests/conversation-engine.test.ts                    # 11/11, exit 0

# W3
npx vitest run tests/routes/diagnosis-consult-events.test.ts        # 4/4, exit 0
npx vitest run tests/agent/diagnosis-session-events.test.ts         # 5/5, exit 0

# W4
npx vitest run tests/agent/task-decomposer.test.ts                  # 12/12, exit 0
npx vitest run tests/agent/expert-router.test.ts tests/agent/expert-config-loader.test.ts  # 18/18, exit 0

# M1
npx vitest run tests/routes/ga-calibration.test.ts tests/routes/ga-auth.test.ts tests/sentinel/ga-manual-injection.test.ts  # 40/40, exit 0

# M2
npx vitest run tests/services/llm-credential-store.test.ts tests/routes/llm-config.test.ts tests/llm-config-frontend.test.ts  # 64/64, exit 0

# M3
npx vitest run tests/sentinel/threshold-injection.test.ts           # 10/10, exit 0
D577_FLIP_TEST=1 npx vitest run tests/sentinel/threshold-manifest-flip.test.ts  # 1/1, exit 0
npx vitest run tests/sentinel/                                      # 214 pass / 1 skip, exit 0

# M4
npx vitest run tests/control-tower/enterprise-fact-chain.test.ts tests/expert/expert-enum-propagation.test.ts tests/expert/manifest-consistency.test.ts  # 21/21, exit 0
npx vitest run tests/control-tower/                                 # 18/18, exit 0
```

---

*报告完。所有结论可复核；如需任何一条证据的原始输出（完整 vitest 日志、diff 快照、grep 输出），见评估工作区 `audit-work-d651/`（samples/、logs/、notes/）。*
