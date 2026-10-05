# AUTHORITY-DEVIATION-REGISTRY — 权威文档偏差登记册 v1.1

> 2026-08-12 | K3 红队审计产出（A线 + 权威17/控制塔 + AGENTS.md 铁律覆盖）
> 方法：双轨审计 —— 文档声称 × 当前 HEAD 代码复核，逐条判定"仍成立 / 已修复 / 口径滞后"
> 复核基线：HEAD `407ff1f`（2026-08-12）| A线原审计基线：`431e16b`（2026-08-01，证据强度 S/M/W 继承不重审）
> 范围：① A线 14 缺口 + 2 任务地图差异复核；② 权威17 V3 控制塔组件 + 门禁脚本全量代码核查；③ AGENTS.md 铁律声称 vs 门禁覆盖对照
> 分级口径：A线分级矩阵（影响面×阻塞×演示可见度）+ C线 P0-block（产品级）；按 K3 模板只列 P0/P1，P2 见第七节
> v1.1 变更：新增 P1-B1~B5（控制塔/铁律覆盖）、铁律覆盖总表（第三节）、D-G2 改判（第五节）、组 11 修正（D3）、G6 改判（第八节）

---

## 一、P0（必须修复 — 产品级断裂）

### P0-A1 N13 反馈→规则闭环断裂（A线 C-G3 + B-G2 消费侧）

- **文档声称**：权威07-16 修正方案（循环七 / GA 缺位保护）；权威13 N13 规则回流；C线 S5-1/S0-2/T-3"反馈→规则更新闭环、越用越准"
- **代码现实**：`middle-evolution-engine` 全 src 零生产调用（仅自身文件匹配）；`feedback-collector` 写入侧存在（`routes/workspace-data.ts` 消费）但无消费方 → 闭环断裂
- **证据来源**：Grep `middle-evolution|MiddleEvolution|middleEvolution` on `src/` @407ff1f → 仅 `src/loops/middle-evolution-engine.ts`；A线 B8/C7（S 证据 @431e16b）
- **建议修复**：`bootstrap.ts` 注册 middle-evolution 为进化链消费方；端到端跑通"GA 纠错→权重调整→规则更新"；接线后复跑黄金数据集确认无声退化
- **分级依据**：C线 S5-1 P0-block（产品级）——核心承诺（进化闭环）断裂，演示可不触达，但部署后第一个季度必暴露

---

## 二、P1（建议修复）

### A线条目（复核确认仍成立）

### P1-A1 direction-monitor 未接线（A线 B-G1）

- **文档声称**：权威02 核心机制"方向监测——何时该诊断"
- **代码现实**：完整实现 + 测试存在，生产零调用（"写了没接"典型）
- **证据来源**：Grep `direction-monitor|DirectionMonitor|directionMonitor` on `src/` @407ff1f → 仅 `src/loops/direction-monitor.ts`；A线 B7（S）
- **建议修复**：接入 loop 调度触发链（C线 S1-5 目标值：信号→触发 <24h）；B线终判 P1-1，演示不触达，部署期排期

### P1-A2 loop-4 系统自检无专属处理器（A线 B-G4）

- **文档声称**：AGENTS.md / 循环体系定义 loop-4 = 系统自检
- **代码现实**：`main-agent.ts:270-285` selectHandler 对 loop-1/2/3/5/6 有显式分支，loop-4 无分支、落到 `defaultDiagnosisHandler`
- **证据来源**：`src/agent/main-agent.ts:270-285` @407ff1f（与原判一致）
- **建议修复**：实现自检专属 handler（对齐"系统自检"语义），或文档降级 loop-4 定义为诊断变体

### P1-A3 GA 验证闭环弱接线（A线 C-G2）

- **文档声称**：权威13 / 权威06 L5——GA 可验证/否决诊断结论
- **代码现实**：`src/l3/ga-collaboration.ts` 仅被 `src/agent/interactive-card.ts:13` 以 `import type` 引用（纯类型，无运行时表示例化）——比 A线原判"弱引用"更弱
- **证据来源**：Grep `ga-collaboration|gaCollaboration|GaCollaboration` on `src/` @407ff1f
- **建议修复**：报告确认流程接入 GAFeedbackHandler 实例；C线 S5-2 目标值"可逆仲裁"；B线 P1-3

### P1-A4 静默升级/回滚未实现（A线 D-G1，由待查线索升级为确认）

- **文档声称**：权威09 承诺静默升级 + 回滚
- **代码现实**：`electron-updater` 仅在 `package.json:57` 声明依赖，`electron/main.cjs` 零使用；`src/services/update-checker.ts` 仅版本检查（接线 `routes/health.ts:7` + tui-v2），无自动下载/安装/回滚
- **证据来源**：Grep `autoUpdater|electron-updater|rollback` on `electron/main.cjs` @407ff1f → 零匹配
- **建议修复**：electron-updater 接线 main.cjs + 回滚策略；或文档降级为"版本提示 + 手动升级"

### P1-A5 单实例内 orgId 过滤未全量验证（A线 A-G1）

- **文档声称**：权威08 T1——tenantId 强制注入所有 SQL 查询，跨租户查询默认拒绝
- **代码现实**：路由层 orgId 存在（`enterprise.ts:41-89`）；store/growth 层抽样 8 文件有 orgId 过滤（user-store/goal-store/proposal-store 等）；逐表全覆盖未系统验证
- **证据来源**：Grep `orgId` on `src/store/` `src/growth/` @407ff1f（抽样，非全量）
- **建议修复**：专项审计逐表核对 DB 查询 orgId 过滤；补 GA 中国墙（跨文档 P1-22 同源）
- **边界说明**：跨客户物理隔离由本地部署拓扑保证（P0-7 已定案非矛盾，见跨文档报告 v3）；本项仅指单实例内部安全纵深

### 权威17 / 控制塔新增（v1.1，全部代码实证）

### P1-B1 控制塔 V5 视图硬编码已废弃的 6 专家体系

- **文档声称**：AGENTS.md:25,134 + `expert/expert-registry.yaml` v2.0 = 7 位专家（D282 迁移完成，A线 B5 确认齐全非空）；权威17 V3 声称 V5 视图为"Agent 链路健康"
- **代码现实**：`scripts/control-tower/views/agent_health.py:21-28` 硬编码**旧 6 专家体系**（strategy/organization/finance/technology/marketing/action）——全部是 D282 已废弃的 ID；且 V5 输入依赖 gate-status.json 的 Gate 5/12（当前缺失，见 P1-B2）→ **V5 视图双重失效**
- **证据来源**：Read `agent_health.py` @407ff1f（注释自承"6 位专家定义 核心层3+扩展层2+P0激活1"）
- **建议修复**：视图改为从 `expert/expert-registry.yaml` 动态读取，消灭硬编码 roster；全仓 grep 旧专家 ID 清理传播残留
- **定性**：**铁律 9（关键变更 grep 全仓传播）违规实例**——D282 改了核心定义，未传播到控制塔视图；且无任何门禁能发现（组 8 文件驱动完整性不查视图硬编码）

### P1-B2 控制塔核心数据源 gate-status.json 当前缺失

- **文档声称**：权威17 V3"gate-status.json ✅ 17 门禁（100% PASS）"；AGENTS.md 门禁"17/17"
- **代码现实**：文件**不存在**（非陈旧）——`.codex/signals/` 仅 3 个文件（context-injector/external-auditor/gatekeeper），全仓 maxdepth 3 无 gate-status.json；生成依赖 `scripts/agent-start.sh` / `scripts/audit/check-gates-v2.py` 运行；D296 自检红灯只覆盖"signals 全空"，3/19 部分缺失不触发
- **证据来源**：ls `.codex/signals/` @2026-08-12；find 全仓无；Grep `gate-status` 写入方 → `scripts/agent-start.sh`、`scripts/audit/check-gates-v2.py` 等
- **建议修复**：① agent-start/审计脚本纳入演示前 checklist 回填信号；② 自检升级为"关键信号文件缺失→黄/红"（不只全空）；③ **若演示含控制塔面板，本项升 P0**（对齐 B线 P0-B4 口径）

### P1-B3 铁律 36"vitest 全量零失败才合并"无全量执行点

- **文档声称**：AGENTS.md 铁律 36"vitest 必须全量通过，零失败才合并"
- **代码现实**：pre-push 只跑 `vitest --changed`（origin..HEAD 增量）；脚本头注释自承"全量靠 PostToolUse 已跑"——而 PostToolUse 只在装了 hooks 的本机生效且跑的是 --related；merge/push 物理门禁链上**无全量 vitest 强制点**
- **证据来源**：`scripts/pre-push-check.sh:3-19` 头注释 @407ff1f
- **建议修复**：CI/pre-push 增加全量 vitest；或文档降级为"增量强制 + 全量靠开发机 PostToolUse"

### P1-B4 铁律 37"Dead code 入仓库即违规"无扫描

- **文档声称**：铁律 37"Dead code 入仓库即违规。删除旧文件 + grep 零引用确认"
- **代码现实**：编号组 1-10+12 中无 dead code / 存量接线扫描；实证存活样本：direction-monitor、middle-evolution 有测试无调用方，08-01 审计发现 → 08-12 复核仍在仓
- **证据来源**：`pre-commit-check.sh` 组目录（:194-933）无对应组；本登记册 P1-A1、P0-A1
- **建议修复**：增加存量接线/dead-code 周期扫描（cron 或月度审计脚本，复用 A线 audit-grep.sh 模式）；或铁律 37 补"增量"限定词

### P1-B5 铁律 9"关键变更 grep 全仓传播"无脚本

- **文档声称**：铁律 9"改完核心定义后检查所有引用"
- **代码现实**：12 组无传播检查；后果实例即 P1-B1（D282 专家迁移未传播到控制塔视图）
- **证据来源**：`pre-commit-check.sh` 组目录无对应组；`agent_health.py:21-28`
- **建议修复**：核心定义变更（专家/循环/门禁数/目录数）在 task brief 增加"传播清单"必填字段，组 6 联动检查；或文档承认该项为自律定位

---

## 三、铁律覆盖核查总表（AGENTS.md 声称 vs 脚本实证 @407ff1f）

| 铁律 | 文档声称 | 代码证据 | 覆盖判定 |
|------|---------|---------|---------|
| 38 as any 零容忍 | "代码中零存在"，pre-commit 硬阻断 | 组 1 `grep -rn 'as any\b' src/`（`pre-commit-check.sh:211-215`）——**全仓扫描**，非增量 | ✅ 全覆盖 |
| 39 五层架构边界 | check-architecture.sh 检测跨层 | 组 5/7 存在 | ✅ 有门禁 |
| Secrets | 扫描 + pre-push 终扫 | 组 3 + pre-push-check.sh | ✅ 有门禁 |
| Task Brief | 6 字段硬阻断 | 组 6 | ✅ 有门禁 |
| 0-2/4/5 接线验收 | "接线审计是硬门禁" | 组 4 含接线深度检测（"import 了但从未调用"，原组 11 并入，`:347-361` 注释），但仅作用于 **staged/新 export** | ⚠️ 增量覆盖 |
| 47/48 契约/测试非空壳 | pre-commit 硬阻断 | 组 9（`.codex/contracts/*.json` vs staged 比对，`:21`）/ 组 2（staged 范围，`:111-115`）——存量 543 引擎文件无门禁 | ⚠️ 增量覆盖 |
| 11/24/31 静默降级禁止 | "禁止" | 组 2 空 catch 增量硬阻断（`:245-267`）+ D313 吞错扫描新增行硬阻断（`:275-280`）；存量仅警告（AGENTS.md 自承） | ⚠️ 增量阻断 + 存量提醒 |
| 36 vitest 全量零失败 | "零失败才合并" | pre-push 仅 --changed（见 P1-B3） | ❌ 无全量强制点 |
| 37 Dead code | "入仓库即违规" | 无对应组（见 P1-B4） | ❌ 无覆盖 |
| 9 变更全仓传播 | grep 检查所有引用 | 无对应组（见 P1-B5） | ❌ 无覆盖（纯自律） |
| 34 Feature Branch 强制 | "禁止直接在 main 上 commit" | `commit-msg-check.sh` 只查 Conventional 格式 + issue 引用；全 hook 链无分支检查 | ❌ 无覆盖（P2） |

**计数口径说明（修正 v1 表述）**：脚本 echo "组 x/12"，编号组实际为 1-10 + 12 共 11 个——**组 11 并非缺失，而是并入了组 4**（组 4 注释明写"原 5, 11 合并"）；脚本头另有"免疫 + plan-integrity"附加检查未编号（`:194`）。"12 组"声称属计数口径滞后，非检查缺失 → 文档任务 D3。

---

## 四、文档修复任务（口径滞后，代码无缺陷）

| # | 文档 | 声称 | 代码现实 @407ff1f | 修复方式 |
|---|------|------|------------------|---------|
| D1 | `AGENTS.md:128` | "20哨兵适配器" | 45 扩展哨兵（`extensions/sentinels/` 含 manifest，共 47 目录）+ 4 内置适配器（`src/sentinel/adapters/`） | 改为"45 扩展哨兵 + 4 内置"；全仓 grep"50 哨兵/20 适配器"同步口径 |
| D2 | 任务地图 v2 N14 验收标准 | 去重窗口 30 分钟 | `src/agent/proactive-push.ts:114` `DEDUP_WINDOW_MS = 300_000`（5 分钟） | 创始人确认目标值：改文档为 5 分钟，或改代码为 30 分钟 |
| D3 | AGENTS.md + `pre-commit-check.sh` echo | "12 组硬阻断" | 编号组 11 个（组 11 已并入组 4），另有未编号附加检查 | 统一口径为"11 编号组 + 附加检查"，或重排编号 |
| D4 | 权威17 V3-控制塔当前状态.md（2026-07-30） | "19 个信号文件"、"V5 6 专家表格"、缺失清单（依赖图/checkpoints 空） | 信号文件现 3 个；V5 硬编码旧 6 专家（P1-B1）；依赖图已构建、checkpoints cp1-cp3 已生成（cp4 仍无） | 演示前产出 V4 状态文档刷新；V3 标注"已被 V4 取代" |

---

## 五、已闭环与改判

### 已闭环（修复确认，防重复定案）

| 项 | A线原判 | 修复证据 @407ff1f | 修复载体 |
|----|--------|------------------|---------|
| C-G1 黄金数据集未接入门禁 | ⚠️ | `scripts/pre-push-check.sh:126-130` 跑 F1 门禁（注释明写"A线 C-G1 修复"）；`.git/hooks/pre-push` 已安装并调用 | D300 |
| N9 缺 dependency-graph.json | ⚠️ | `.codex/dependency-graph.json` 存在，`generate-dashboard.py:235` 消费 | — |
| A-G3 定位人数 5-300 | 📄 | `AGENTS.md:116` 现为 5-1000 | — |

### ⚠️ D-G2 自诊断失真 —— v1.1 改判："引擎已修复，数据链路未担保"

- ✅ **完成度测量引擎已修复**：差异化 schema（快照 `20260801T063408Z`：systemScore 0.585，分维度 98.3/57.6/40.7%…），不再是 63 任务全 0.167；dashboard 新增测量自检红灯 + 新鲜度门禁（D296）
- ❌ **残留（v1.1 代码核查发现）**：① gate-status.json 当前缺失（→ P1-B2）；② 完成度快照停在 08-01，已 11 天未刷新；③ D296 自检只覆盖"signals 全空"，部分缺失不触发
- **演示前动作**：跑 agent-start/审计脚本回填信号 → 刷新完成度快照 → 验证新鲜度门禁如期标红

---

## 六、反向偏差（文档滞后于代码 — 话术应升级）

- **C线第五章叙事红线 3 + 弹药 5 诚实脚注**："不宣称黄金数据集自动回归"写于 C-G1 未修时（08-02）。D300 后 pre-push 确实自动执行 F1 回归 → 话术可升级为"每次推送自动回归 10 用例 F1"。建议 B线/C线联调确认措辞后修订。

---

## 七、不列入项（P2 / 观察项，按 K3 模板规则）

| 项 | 判定 | 说明 |
|----|------|------|
| B-G3 NCI 零代码 | P2 | 仍成立（src 零匹配）。建议：要么排期实现，要么权威02§三明确标注"未实现"边界，消除隐含声称 |
| C-G4 行业模板覆盖少 | P2 | 仍成立（5 真实行业 + test-write 无 manifest） |
| A-G2 双引导入口并存 | P2 | 仍成立（setup.html/setup.js 与 admin.js onboarding 共存） |
| 铁律 34 分支检查缺失 | P2 | 全 hook 链无分支检查，纯自律；建议补脚本或文档降级（v1.1 新增） |
| checkpoints cp4 缺失 | 观察 | cp1-cp3 已生成（V3 文档"空"已部分修复），cp4 无；跟踪（v1.1 新增） |
| D-G3 heartbeat.json 为空 | 观察 | 机制在（`loop-scheduler.ts:71-72` 写 `.codex/heartbeat.json`），文件不存在=本机 agent 未运行。非偏差，部署后验证 |
| C-G5 结论效果未外部验证 | 观察 | 代码不可证伪，待客户A部署数据 |

---

## 八、G1–G6 假设更新（供总计划回填）

| 假设 | 原判 | 本复核（v1.1） |
|------|------|--------|
| G1 结论真实性未外部验证 | ✅ 验证 | 维持，待客户数据 |
| G2 Agent 自主性未接线 | ✅ 验证 | **维持**（B-G1/G2/G3 全部复核确认 @407ff1f） |
| G3 无数据诊断未产品化 | 部分 | 本次未复核 |
| G4 老板看得懂的交付物缺失 | 部分推翻 | 本次未复核 |
| G5 进化飞轮未闭合 | ✅ 验证 | **维持**（N13 仍断裂） |
| G6 自诊断失真 | ✅ 验证 | **改判（v1.1）：引擎级已修复；数据源完整性/新鲜度未担保**（gate-status.json 缺失 + 快照 11 天前 + 自检只覆盖全空）——演示前需回填验证，见第五节 |

---

## 九、待续（v2 范围）

1. 跨文档审计 v3 未决项复核：P0-1（AGENTS.md 35 目录）、P0-2/P0-6（专家数——A线 B5 已确认 7 位齐全，需核对是否已闭环）、P0-8（ENT 缺 boss 角色，待创始人决策）、28 项 P1 抽查
2. C线 33 项中"未验证/未测量"项的演示前实测：T-1（部署→首诊时长）、S3-1（零命令行 30 分钟）
3. A-G1 orgId 逐表全覆盖专项
4. D-G2 收尾：信号回填后验证新鲜度门禁标红生效；自检升级为"部分缺失→黄"

---

## 附：可复现性

- 全部复核 grep 模式已记录于各条目"证据来源"；同 commit（`407ff1f`）重跑结果应一致
- A线原始证据：`_tools/audit-grep.sh` + `_tools/evidence-log.txt`（基线 `431e16b`）
- v1.1 控制塔/铁律核查关键命令：sed/grep on `scripts/pre-commit-check.sh`（组 1 全仓 as any=`:211-215`、staged 缓存=`:111-115`、空 catch=`:245-267`、D313 吞错=`:275-280`、组目录=`:194-933`）、`scripts/pre-push-check.sh:3-19,126-130`、`scripts/commit-msg-check.sh` 全文、`scripts/control-tower/views/agent_health.py:1-28`、ls `.codex/signals/` `.codex/checkpoints/`
- 本登记册遵循铁律 0-2 接线验收精神：每条"仍成立"均以当前 HEAD 零调用/零匹配的 grep 证据为准，不转述历史结论；每条"已修复"均以当前 HEAD 的修复载体证据为准
