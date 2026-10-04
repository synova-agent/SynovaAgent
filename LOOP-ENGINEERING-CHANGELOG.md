# Loop Engineering 版本更新日志

> 从"每犯一错加一脚本"到"免疫系统 — 一次错误、一条约束、永久防止"。

---

## V4.1.2 (2026-06-24)

### 新增
- **SessionStart 流程锁前置** — hook-session-start.sh：会话启动时检查 workflow-state，未完成则写入 `.claude/session-locked`，hook-block-write 阻断所有非 task-start 的写操作
- **免疫细胞 #8: stub-implementation-pattern** — 检测 `listForTeam(teamId){return this.list()}` 式空实现，参数未使用即阻断

### 修复
- V4.1.1 PreToolUse 只拦截 Write/Edit，Bash/Git 操作完全绕过 → SessionStart 从源头锁流程

### 文件
- `scripts/hooks/hook-session-start.sh` ✅ 新增
- `memory/stub-implementation-pattern.md` ✅ 新增

---

## V4.1.1 (2026-06-24)

### 变更
- **pre-commit extensions/ 覆盖** — NEW_IMPL 从 `^src/` 扩展为 `^src/|^extensions/`
- **测试路径映射扩展** — 支持 `extensions/sentinels/{name}/(aggregate|computes/{fn}).ts` → `tests/sentinels/`
- 15 个 compute+aggregate 测试（45 tests 全部通过）

### 修复
- 16 个函数零测试的问题 → 补全测试 + CI 结果文件
- `check-file-driven.sh` SOGNodeType 检查排除白名单文件

### 文件
- `scripts/pre-commit-check.sh` 🔧 改造
- `tests/sentinels/*` 15 个测试文件 ✅ 新增

---

## V4.1 (2026-06-24)

### 新增
- **免疫系统** — hook-check-memory 升级为免疫执行引擎
  - 匹配 memory/ → 读 constraint 字段 → 执行 bash → 比较 expected → `severity=block` 阻断 / `severity=warn` 写入 STATE.md
- **7 个免疫细胞**：
  - `dual-source-fraud` (block) — 双数据源，15 次
  - `q0-skipped` (block) — Q0 跳过，3 次
  - `grep-semantic-overreach` (block) — bash 语义误判，1 次
  - `plan-actual-mismatch` (warn) — 计划与实际不符，5 次
  - `q0c-cancelled-without-followup` (warn) — Q0c 取消无跟踪，12 次
  - `info-injection-ignored` (warn) — 软机制被无视，∞次
  - `lessons-file-lost` (warn) — 踩坑录丢失，1 次
- **STATE.md** — 运行状态 + 免疫警告累计
- **check-lessons-learned.sh** — 错误沉淀 → memory/ 条目 + class 去重
- **plan-integrity 验证** — plan-schema +principles/approach/memory_refs，pre-commit 组6物理验证
- **Q1/Q2 问法重写** — Anthropic-only 决策链路 + 重写/复用二选一

### 修复
- Q0 只在 PreToolUse（V3.8）强制执行 → 改为 task-start 三问 + Q0b grep-output 强制
- 信息注入型检查 100% 无效 → 改为硬阻断（constraint 自动执行）

### 文件
- `scripts/hooks/hook-check-memory.sh` 🔧 改造
- `scripts/check-lessons-learned.sh` ✅ 新增
- `scripts/check-plan-integrity.sh` ✅ 新增
- `STATE.md` ✅ 新增
- `memory/*.md` 7 个免疫细胞 ✅ 新增

---

## V3.9 (2026-06-23)

### 变更
- **Done 可证伪性** — 每个 `- [x]` 必须包含 `verify:` 命令
- **能力验收 CI** — acceptance 测试必须 CI 通过
- **Q0c 跟踪** — cancel 任务必须有 `follow_up` 字段
- **双日志分离** — `pre-commit-failures.log`（门禁故障）vs `bypass.log`（人为绕过）

### 修复
- as any 跳过注释行（不再误报注释中的 `as any = 0`）
- empty catch 接收 `degraded`/`throw`/`log` 三种信号
- 接线只查"被引用"这个物理事实（搜索全 src/）

---

## V3.8 (2026-06-23)

### 新增
- **Q0 PreToolUse 强制执行** — 写代码前必须填 Q0a 项目拼图 + Q0b 文件审计 + Q0c 决策
- **反向 Q0c 审计** — 15 个双数据源发现 + 消除（取消新模块，保留旧系统）
- **CLAUDE.md 完整重构** — L0 进化/反馈闭环/企业事实层/三层粒度/数据安全/V3.8 流程

### 修复
- hook-block-write.sh V3.5 → V3.8（Q0 第 0 号检查）

---

## V3.7 (2026-06-23)

### 核心变化
- **bash 退位** — 不再做语义判断（as any 注释误报、接线深度检查）
- **agent 进位** — 语义判断交给 agent 自检
- **plan.json** — 分阶段任务的结构化支持（deferred wiring/test_pairing）
- **双日志** — 门禁故障 ≠ 人为绕过

### 修复
- plan.json 感知的 plan_aware_check — 架构步骤不是偷懒

---

## V3.6 (2026-06-22)

### 变更
- 20 项独立检查 → 8 组合并（按根因归类，共享 grep）
- 新增第 8 组：文件驱动架构完整性（manifest/tags/回归/目录/pizza-chain）
- Task Brief 11 字段 → 5 核心字段
- check-file-driven.sh — 文件驱动架构门禁

---

## V3.5 (2026-06-21)

### 变更
- 8 组 pre-commit 物理阻断
- 桥接文件欺诈检测（铁律 46/47）
- 接线深度检查（import 但未调用）
- 桩测试检测（≥3 expect）
- 硬编码业务数据扫描

---

## V3.1 (2026-06-19)

### 变更
- +产品对齐检查 Q1-Q4
- 答案设计信度 > 纯输出

---

## V3.0 (2026-06-17)

### 核心重构
- 38 项 → 5 项 pre-commit（全 <5s）
- 12 脚本 → 8 脚本
- 提交耗时 90s → <5s
- Agent 自检 5 问（接线/异常/类型/测试/残留）
- task-start 3 问（Q1 调研 / Q2 范围 / Q3 验收）

### 原则
"越少越会被执行。" — V3.0 核心哲学

---

## V2.5 (2026-06-16)

### 初始版本
- 38 项 pre-commit 硬阻断
- 6 个执法脚本（check-empty-modules/check-manual-drift/check-test-quality/check-wire-full/check-vertical-slice/hook-check-memory）
- 3 层阻断（PreToolUse → PostToolUse → pre-commit）
- 提交耗时 40-90 秒
- 1,862 行 bash 脚本

---

## V4.2.2 (2026-06-24) — engine-core 桥接清零

### 变更
- **免疫细胞 #11: engine-core-bridge-files** (block) — src/ 中 engine-core 引用数必须=0（白名单除外）。声称完成前自动 grep，非零则阻断。
- **删除 8 个 pipeline 桥接文件** — `src/pipeline/` 下 8 个纯桥接全部删除（铁律 46 清理）。collaboration-collector/doc-extractor/expert-pipeline/federal-reporter/gap-recorder/measurement-pipeline/real-measurers/report-builder
- **engine-core 存量引用**: 289 文件 → 0 违规引用（仅剩 4 个白名单文件）

---

## V4.2.1 (2026-06-24) — 免疫系统增强

### 新增
- **免疫细胞 #9: plan-actual-closure** (warn) — 声明完成但从未对比文档与代码的 gap
- **免疫细胞 #2: q0c-cancelled-without-followup 升级** (block) — 取消任务必须补完
- **修复提示字段** — 所有免疫细胞现在带 `remediation:` 字段，告诉 agent 怎么做才对

### 已知缺口（当前文件驱动覆盖率 45%）
| 维度 | 缺口 | 计划 |
|------|------|------|
| 行业模板 | 4 个行业 0 子目录 | C1 |
| 报告格式 | 0 .hbs 文件 | A2 |
| 数据策略 | policies/ 不存在 | D2 |
| 引擎配置 | engine/ 不存在 | D1 |
| 专家工具 | tools/ 不存在 | E1 |
| 国际化 | en-US 缺 expert-prompts | A1 |
| 通知 | 缺 email/feishu-approval | A3 |
| 哨兵 | 11 缺 manifest+aggregate | B1-B4 |

## V4.2.3 (2026-06-24) — 旧适配器映射标记

### 新增
- **check-deprecated-mapping.sh** — 检查旧 `src/sentinel/adapters/*-sentinel.ts` 是否标注 `@deprecated` 对应 `extensions/sentinels/{name}/`
- **11 个旧适配器已标注 @deprecated** — 新开发方向指向 extensions/sentinels/

### 修复
- B4 收尾：旧适配器文件标记废弃映射，避免双数据源死灰复燃

## V4.2.4 (2026-06-25) — engine-core 全面清零

### 变更
- **删除了全部 4 个铁律46白名单桥接文件：**
  - `src/types/engine-core-types.ts` — DiagnosisErrorCode 内联到 sentinel/types.ts
  - `src/l4/engine-graph-store.ts` — 替换为 synova-graph-store.ts 的 createSynovaGraphStore()
  - `src/l4/entity-resolver-l2.ts` — 删除（仅旧 Novis 演示路径使用）
  - `src/l4/diagnosis-graph-query.ts` — 删除（community-reports.ts 已有独立 detectCommunities）
- **6 个消费者文件修复**：conversation-engine、knowledge-bridge-service、l4/index、mcp/tool-registration、diagnosis-upload-v2、sentinel/types
- **engine-core: 289文件 → 0引用** — src/ 中彻底清零。packages/engine-core/ 保留为历史参考，不引用。

### 文件
- `src/sentinel/types.ts` 🔧 内联 DiagnosisErrorCode
- 4 个白名单桥接文件 ❌ 删除
- 6 个消费者文件 🔧 修复

---

## V4.2.5 (2026-06-25) — 时间戳顺序检查 + 项目身份重构

### 新增
- **免疫细胞 #18: 时间戳顺序检查** — PreToolUse hook 在 brief 未填而写代码时，记录证据到 `/tmp/.synova-before-brief`（git 外不可抹除）。pre-commit 组 6 检查此文件，存在则硬阻断。
- **项目身份重构** — 新增三层解耦体系（纵向五层物理隔离 / 横向 Monorepo 包 / 扩展文件驱动）。Q0 增加三层解耦勾选项。Q1 重构为 Anthropic 决策链（5 步序）+ 执行约束。

### 变更
- 模板 `generate-task-brief.py` 更新为 V4.2.5 新格式

---

## V4.2.6 (2026-06-26) — Q2 验证 + Verify 自动生成

### 新增
- **免疫细胞 #19: Q2排除项物理验证** — pre-commit 自动解析 Q2 排除项中的文件路径，检查 git diff 是否包含。
- **免疫细胞 #20: verify命令自动生成与执行** — Q2排除项、Q3验收项可验证内容自动生成 bash verify 命令。

### 修复
- **check-verifiable-done.sh 解析bug修复** — awk 范围模式修复

---

## V4.2.7 (2026-06-27) — 日期边界修复 + 模板残留检查

### 修复
- 日期边界bug、层字段检查修复、current-brief 绑定、模板残留检查、Q2排除项必须含文件路径、trivial verify阻断

---

## V4.2.9 (2026-06-28) — Maker/Checker 分离 + Stub Compute 清零

### 新增
- **maker/checker 分离** — checker-review.sh 独立验证器，GitHub Actions PR触发。
- **19个stub compute全部修复** — S1-S3, O1-O10, T4-T9 替换为真实算法。
- **专家路由改为layer基** — 从 category 改为 layer 路由。
- **SentinelConfig 补全4字段** — layer/auxiliaryExperts/computeKind/technoEconomicPhaseCalibration。

---

## V4.3.0 (2026-07-03) — L4 本体层设计哲学

### 变更
- **L4 本体层设计哲学明确化** — 本体层是企业知识图谱（22 节点类型 + 17 边类型），compute 函数必须使用图遍历思维。
- **compute 函数签名标准化** — `(store: GraphStoreReader, teamId: string) => ComputeResult`
- **已知问题** — Financial 节点 17 个 optionalProps 需拆分；5 条缺失边类型需补充。

---

## V4.4.0 (2026-07-05) — 路径匹配修复 + 版本号统一

### 修复
- check-brief-vs-code 路径匹配修复、层检查排除 scripts/、全部版本号同步到 V4.4.0

---

## V4.4.5 (2026-07-10) — grep 物理门禁 + 侧翼修复自动化

> 背景：发现时间黑洞在"侧翼修复"——删改符号前不知道哪些文件会断裂，tsc 报了才逐处修。

### 修复
- **改前先 grep — 物理阻断**：新增 `scripts/workflow/grep-refs.sh`，写代码前 grep 全仓库引用写入 `.claude/reference-map.md`
- **Q0 格式统一**：CLAUDE.md 示例 `Q0 定位:` 改为 `## Q0:` 格式 + 醒目警告；hook/pre-commit awk 同时兼容两种写法

### 变更
- **写代码前三步曲**：① `bash scripts/workflow/grep-refs.sh "符号"` → ② 审查 `.claude/reference-map.md` → ③ Edit 代码
- **全部版本号同步到 V4.4.5**

---

## V4.4.4 (2026-07-08) — vitest --changed 增量回归 + 版本同步

> 背景：2026-07-08 同步扫描发现 CLAUDE.md 停留在 V4.4.2，脚本已全部更新但文档未同步。

### 修复
- **文档-代码版本漂移修复**：所有 .md 文件版本号同步到 V4.4.4，与脚本一致
- **pre-push 增加 vitest --changed**：推送前执行增量回归测试
- **verify-v444.sh 自身 bug**：check_version() 检查 `V4\.4\.2` 而非 `V4\.4\.4`，导致版本漂移永不被发现

### 变更
- **verify-incremental.sh 升级到 V4.4.4**：PostToolUse 四层验证同步
- **全部版本号同步到 V4.4.4**

---

## V4.4.2 (2026-07-07) — Engine-Core 引用全面加固 + 壳包检测

> 背景：2026-07-06 Codex 审计发现 `@synova/diagnosis-engine` 是 42 行纯 re-export shell，
> 通过 packages/ 目录绕过了铁律 46 的 `src/` 扫描。三个漏洞同时修复。

### 修复
- **漏洞 1: 扫描范围扩展到 packages/** — `STAGED_ALL_FILES` 同时覆盖 `src/` 和 `packages/`
- **漏洞 2: 匹配任意 engine-core 引用** — 字面量 + 相对路径三重匹配
- **漏洞 3: 壳包检测** — `packages/*/src/` 下仅 index.ts + export from + <50行 + 引用 engine-core → 壳包硬阻断

### 变更
- **check-bridge-files.sh 同步加固** — 独立验证器同样覆盖 packages/ + 相对路径 + 壳包检测

---

## 2026-10-02 · 铁律退役记录（首批）

> 依据创始人：**「关于铁律，有些可能过时，你需要仔细斟酌，不能写着铁律就必须这样了」**
> ＋ **「TUI 闪烁修复冻结更加过时，TUI 我们不用了」**
> 元规则已立：见 `AGENTS.md` §【元规则】铁律生命周期

### 退役 7 条

| 原编号 | 原内容 | 退役判据（实测） | 保留部分 |
|---|---|---|---|
| **40** | TUI 闪烁修复不可回退（冻结） | `src/` 内 `import tui-v2` = **0**（零消费方）；自认无自动执法；PRODUCT-BRIEF 零提桌面端 | 无 |
| **41** | 流式 Pipeline 简单直接 | 同上 | 无 |
| **42** | 逐字流必须有延迟 | 同上 | 无 |
| **43** | finishStreaming 调用顺序不可反 | 同上 | 无 |
| **44** | ChatPanel 禁止 `justifyContent="flex-end"` | 同上 | 无 |
| **45** | 注释中 `*/` 必须加空格 | **与 TUI 无关的通用编译陷阱** | ✅ **保留并改述**，已并入 §二 代码质量 |
| **46** | 禁止桥接代理文件（engine-core） | `engine-core` 真 import = **0**（使命完成）；白名单 8 文件里 5 个已不存在 | ✅ **保留通用戒律**（禁桥接代理 + "拆完了"须 grep 证明），去掉 engine-core 专属白名单 |

**全文可追溯**：退役前版本见 git 历史
（`git show <本提交前一版>:AGENTS.md | sed -n '/### 六、TUI V2 铁律/,/### 七、/p'`）

### 待修订 1 条

| 原编号 | 问题 | 处置 |
|---|---|---|
| **39** | 五层只覆盖 `src/` 49 个目录中的 **18 个（37%）**；门禁只查 3 类；`L4→L3` 未授权也不查（已 1 处） | 已在 `AGENTS.md` 加范围警示；31 目录归层 + 可机器判方向规则 ⇒ **归架构专项研究（Q1）** |

### 本条带来的门禁影响

```
· check-architecture.sh 第 5 组引用「铁律 39/46」⇒ 46 已退役，第 5 组的注释需治理线同步（另卡）
· 原 40–45 无自动执法 ⇒ 退役不减少任何门禁覆盖（净零）
· 原 46 的唯一执行点是第 5 组的 engine-core 扫描 ⇒ 因真 import=0，该扫描已成永真
```
