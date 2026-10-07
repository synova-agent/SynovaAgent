# Task Brief: D366 门禁今日判断 mtime+marker 并发修复

> 生成: 2026-08-14 23:52:34 | 分支: main | as any: 0

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。
诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。

目标: 成为组织诊断的 AWS。每个新客户、新行业、新数据源 → 加文件即可，不改代码。
能文件化的必须文件化。不能文件化的必须有明确的扩展点。

### 三层解耦体系

**纵向解耦：五层物理隔离**
代码按 L1-L5 架构分层，每层只与相邻层通信。L1 交互层不知道 L4 用什么数据库，L3 洞察层不知道 L5 数据存在哪。换底层存储，上层零改动。pre-commit 物理阻断跨层 import——L2→L4 的代码提交不进去。

**横向解耦：11 个独立 Monorepo 包**
五层内部拆为独立包：@synova/sog-core（本体图类型）、@synova/sentinel-engine（哨兵调度）、@synova/expert-platform（专家加载）、@synova/connector-registry（数据连接器）。每个包接口边界明确，拆卸一个不影响其余 19 个。核心包已落地运行；已存在的功能规划从 src/ 迁移到独立包；未来新增须遵循此结构。

**扩展解耦：文件驱动，不改代码**
新增能力靠文件，不靠改代码：
- 新 AI 专家 = 新建目录 + 10 个 Markdown 文件 → 自动注册到 ExpertDispatcher
- 新诊断哨兵 = 加 xxx-sentinel.ts → builtins 自动扫描加载
- 新行业 = 加行业目录（基准数据+阈值+案例库）→ 1-2 天上线，零 TypeScript 改动
- 新本体实体类型 = 加 JSON Schema 文件

流程约束: V4.5.0 — task brief 6 字段强制 + 免疫系统 + plan.json + 8 组物理阻断 + Plan-Actual 闭合 + engine-core 清零 + 时间戳顺序检查。

数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
        反馈闭环: GA评审/客户反馈 → 记忆层 → 数据层
        Sentinel Finding[] → 诊断引擎 Phase 2 → 8 位文件驱动专家解读

L1 入口: POST /api/diagnosis/consult (GA诊断) / Cron→Sentinel.check() (哨兵) / GET /chat (Web) / MCP
五层架构 (只能向下依赖相邻层):
  L1 交互: routes/ tui/ mcp/
  L2 编排: agent/ orchestrator/
  L3 洞察: l3/ sentinel/ expert-platform/ expert/ (8位文件驱动专家: strategy org finance tech marketing action business_model knowledge)
  L4 本体: l4/ evidence/ 企业事实层: AgentMemoryStore (enterprise_fact, 版本化+superseded_by链)
  L5 存储: store/ cron/
三层粒度: 专家→哨兵→计算。哨兵=可独立告警的最小子领域。compute=纯数学函数。
L0 进化: evolution/ 两路反馈→候选池→确认/执行验证→写入知识库
文件化扩展: expert/ knowledge/shared/ theory/ skills/ — 新增=加文件,不改代码
数据安全: L0公开摘要→L1聚合信号→L2脱敏证据→L3原始数据(仅客户内Agent可见,GA不可见)
引擎: packages/engine-core/ (Novis遗产,逐步迁移)。禁止src/新增engine-core引用(铁律46)。
安全: security/ (PIIScrubber, DataBoundary)
LLM: providers/ (DeepSeek, OpenAI, Gateway)

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
本任务属于三层解耦的哪一层？
- [x] 纵向（改 L1-L5 代码/架构）
- [ ] 横向（迁移到独立包 / 新建包）
- [ ] 扩展（文件驱动，不改 TypeScript）

本任务属于**基础设施（控制塔门禁）**。触及控制塔判定机制层：G12 认领制的"今日 brief"判定、verify-parallel 的"今日 dev doc"判定、post-commit 的 --no-verify 绕过检测。全部为**替换**（mtime → 文件名日期；时间戳 marker → head hash 对账），不新增门禁组。

### b) 文件审计
grep 实测（2026-08-14，非凭记忆）：
- `rg -n "newermt" scripts/` = 4 处：scripts/pre-commit-check.sh:813、scripts/workflow/hook-check-task-scope.sh:74、scripts/workflow/resolve-commit-brief.sh:69、scripts/control-tower/verify-parallel.sh:143
- `rg -n "last-precommit-success" scripts/` = 3 处：scripts/install-hooks.sh:23,51、scripts/hooks/post-commit.sh:9
- 已存在可复用机制：D296 current-brief 认领制（.claude/current-brief + per-session current-brief.$SESSION_ID）、D331 check-bypass-log.sh commit-hash 对账（pre-push 门禁 7）
- 关系：**替换** 4 处 mtime 判定（复用 current-brief 机制）+ **改造** marker 为 head|ts（复用 D331 hash 对账思想）；**无冲突**

### c) 决策
无覆盖→新建走文件驱动：today_files_by_prefix/suffix 为纯 bash 函数（非新组件），按 dev doc §3.2 第一选项"新增到各脚本"内联——DS8 写集 7+2 契约下不抽公共脚本。
冲突取舍/多选项/架构选择 → 走 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md），结论写入 Q1c 决策参考系。



## 注入上下文
### DECISION-REFERENCE

> D333 决策参考框架全文（创始人 2026-08-13 定）:

# 决策参考框架（双参考系）

> 2026-08-13 创始人定 | 用途：遇到难决策/多选项/最佳实践选择时，强制走四步参考，并记录所用参考系
> 触发条件：①多选项需取舍 ②设计/架构方案选择 ③优先级排序 ④"最佳实践是什么"类问题 ⑤实现与文档声称冲突时

## 四步框架

```
① 第一性原理（DeepSeek/梁文峰）：这个问题的最简本质是什么？最少机制能解决吗？
② Anthropic 工程基线：隔离/失败即关闭/脚本验证/机器可验契约——哪条适用？
③ 开源实证（DeepSeek）：有可克隆的代码/架构参考吗？clone 下来看实际做法（成本/效率/结构）
④ 收敛检查：两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖
```

## 双参考系边界

| 参考系 | 适用 | 不适用 |
|--------|------|--------|
| **Anthropic 工程实践** | agent 隔离、门禁/fail-closed、脚本化验证、机器可验契约、并行协作 | 成本/产品定位/模型选择 |
| **DeepSeek 第一性原理 + 开源实证** | 产品哲学、成本/效率/架构取舍、反内卷、开源参考（clone 仓库） | 工程流程细节（其仓库是模型/推理代码，非 agent 协作） |

## 梁文峰原则摘要（DeepSeek 参考时使用）

- **第一性原理**：不做无意义的炫技，回到问题本质
- **极致成本**：能用最少机制解决就不用多的（这正好支持"worktree 隔离 = 最少机制"而非 N 个门禁）
- **开源开放**：能参考开源实证就不闭门造车
- **反内卷**：机制是为了减少摩擦，不是为了增加流程

## 记录要求（可验证，不靠记忆）

- Codex 决策：在 dev doc / 本会话回复中**明确写"参考：Anthropic/DeepSeek/第一性原理 + 结论"**
- Claude Code 决策：dev doc 要求完成报告含**决策记录**（决策点 + 参考系 + 理由），K3 审计可核

## 已用案例

| 日期 | 决策 | 参考系 | 结论 |
|------|------|--------|------|
| 2026-08-13 | 并行 agent 冲突（串行 vs 并行） | Anthropic（隔离基线）+ DeepSeek（最少机制） | 收敛：worktree 隔离（D307）优先解锁并行 |


## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
本任务按以下顺序执行，每一步完成后才能进入下一步：
  ① SPEC / Done 标准 — 定义「怎么算做完」
  ② 测试 — 先写测试，测试 = 产品的一部分
  ③ 实现 — 刚好满足以下全部条件：
     - Done 标准中列出的所有完成项
     - 测试全部通过
     - 接线完整（新 export 有引用）
     - 错误路径有 log + degraded
     - tsc + vitest 零失败
  ④ 接线 — 端到端走通（入口可触达 + 链路完整 + 结果可见）
  ⑤ 验证 — 自检 6 问（接线/异常/类型/测试/残留/文件驱动）

引用依据（至少引用两项）：
  - 铁律 0-2: spec → test → impl → wire → review → merge（本任务严格按 dev doc §4 先测试 RED 后实现 GREEN）
  - 铁律 7: 入口可触达 + 完整链路走通 + 结果可见（Done 标准三环节）
  - 铁律 24+31: post-commit 判定失败路径须 log + 不静默
  - 铁律 33: 测试命名约定 *.test.sh（tests/control-tower/ 下）
  - memory/grep-semantic-overreach.md: DS1 是字面字符串门禁——grep 只回答物理事实，注释里的 newermt 也算（首轮 DS1=4 全是我自己的注释行）
  - memory/dual-source-fraud.md: dev doc 头部"5 修改"与 9 文件表冲突 → 以写集表为准（实证优先）
  - memory/bash32-compat.md: 函数体零 bash4 特性（while-read 循环，不用 mapfile/readarray）

### b) 本任务执行约束（写入 plan.json principles，pre-commit 组 6 验证）
根据决策链和本任务特点，提炼 2-3 条必须遵守的规则。每条 rule 必须包含 verify 命令。
  - rule: "mtime 判定清零 — newermt 在 scripts/ 零存在（缺陷 A 根治，DS1）"
    verify: "rg -n 'newermt' scripts/ | wc -l → 0"
  - rule: "新函数物理接线 — today_files_by 至少 4 处调用（4 脚本各 1 处，DS2）"
    verify: "rg -n 'today_files_by' scripts/ | wc -l → ≥4"
  - rule: "marker 只覆盖不删除 — post-commit.sh 中 rm 不得触碰 last-precommit-success（缺陷 B 根治，DS3）"
    verify: "grep -n 'rm -f.*last-precommit-success' scripts/hooks/post-commit.sh | wc -l → 0"

### c) 决策参考系（遇到难决策/多选项/架构取舍/最佳实践/实现与文档冲突时）
按 DECISION-REFERENCE 四步框架（docs/synova/coordination/DECISION-REFERENCE.md）执行，并将结论记录在本字段：
  ① 第一性原理 — 问题的最简本质是什么？最少机制能解决吗？
  ② Anthropic 工程基线 — 隔离/失败即关闭/脚本验证/机器可验契约，哪条适用？
  ③ 开源实证 — 有可克隆的代码/架构参考吗？clone 下来看实际做法
  ④ 收敛检查 — 两参考系是否指向同一答案？收敛 = 大概率正确；分歧 = 值得深挖
决策记录格式（K3 审计可核）: 参考：Anthropic/DeepSeek/第一性原理 + 结论
简单决策（无冲突、单一路径）只需记录参考系名。

本任务决策记录（K3 审计可核）：
- 决策点 1（marker 方案）: dev doc §4.5 已决策 — "只覆盖不删除 + head hash 校验" 胜出 per-session marker。
  参考：第一性原理（marker 语义 = "本次 commit 是否跑过 pre-commit"，hash 对齐不依赖 session 身份）+ Anthropic 工程基线（D331 已证明 hash 对账 > timestamp singleton）。结论：head|ts 双字段 + 只覆盖不删除，legacy 时间戳格式保留过渡分支。
- 决策点 2（函数放置）: Option A（内联到各脚本）胜 Option B（抽 common-today.sh）。
  参考：第一性原理（最少机制——不新增文件、不改公共加载路径）+ DS8 写集 7+2 契约（抽公共文件须同 commit 更新 dev doc §3.2 文字，违反 S-6 最小漂移）。结论：Option A，函数名统一 today_files_by_prefix / today_files_by_suffix。
- 决策点 3（brief 文件名）: 采用日期前缀 2026-08-15-D366-*.md（原生成名为 2026-08-14 前缀，会话跨日后重命名）。
  参考：第一性原理。结论：文件名日期必须 == 实际提交日 —— 旧 mtime 过滤器（rename 刷新 mtime）与新文件名过滤器（前缀匹配 TODAY）双兼容，避免午夜跨界导致本 brief 从"今日集合"掉出、提交被他人 brief 误判（G12 认领制）。
- 决策点 4（函数实现）: dev doc §3.2 草图的 `find|while + basename|grep|head` 管道改为纯 bash for+case 零子进程。
  参考：第一性原理（性能本质 —— Windows 子进程创建 ~100ms/个，349 brief × 每文件 3 spawn ≈ 分钟级；门禁脚本每次 commit 运行，实测 resolve-commit-brief 挂死 >30s 复现）+ Anthropic 工程基线（机器可验契约 —— 性能断言入测试：346 文件 ≤10s）。
  结论：for+case 零子进程 + 字面 glob 硬编码在函数内（实测发现变量展开中的 * 不被路径名展开，glob 参数必须移除）+ `${dir%/}` 去尾斜杠。另修正 verify-parallel.sh 函数块误置 elif 分支内（MODE=today 时函数未定义）——定义必须在模式分发之前。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- scripts/control-tower/verify-parallel.sh — 今日 dev doc 判定改 today_files_by_suffix（文件名 -YYYYMMDD.md 后缀）
- scripts/pre-commit-check.sh — ALL_TODAY_BRIEFS 改 today_files_by_prefix（文件名 YYYY-MM-DD 前缀）+ 合并 CUR_BRIEF_PATH
- scripts/workflow/resolve-commit-brief.sh — ALL_TODAY 改 today_files_by_prefix + 合并 CUR
- scripts/workflow/hook-check-task-scope.sh — ALL_TODAY_BRIEFS 改 today_files_by_prefix + 合并 CUR_BRIEF_PATH
- scripts/hooks/post-commit.sh — marker 解析改 head|ts 双字段：head 匹配 = pass、不匹配/无 marker = detected-bypass、stale>120s = possible-bypass、legacy 纯时间戳格式 = 旧语义减 rm、root commit（无 HEAD^）= 显式降级；全程不 rm marker
- scripts/install-hooks.sh — pre-commit wrapper 写 "head|timestamp" 替代裸 epoch
- .codex/control-tower/VERSION.md — 顶部新增 V4.7.9（D366 批次）
- tests/control-tower/today-by-name.test.sh — 新建（RED→GREEN，≥6 断言）
- tests/control-tower/post-commit-marker.test.sh — 新建（RED→GREEN，≥6 断言）

不做什么：
- 不新建 scripts/control-tower/common-today.sh（Option B 弃用 — DS8 写集 7+2 契约，决策见 Q1c 决策点 2）
- 不重构 scripts/workflow/check-bypass-log.sh（D331 已 hash 对账，不在缺陷 A/B 范围）
- 不修改已安装的 .git/hooks/pre-commit 文件内容（transition 由 post-commit legacy 分支处理，install-hooks.sh 重跑后新格式生效）
- 不触碰 scripts/control-tower/worktree-*.sh（D307 范围）
- 不改 src/ 任何 TypeScript（本任务纯 bash 基础设施，DS6 要求 tsc 基线 +0）
- 不改 docs/plans/codex/implementation/SYNOVA-IMPL-D366-*.md（dev doc 是契约，不动）

## Q3: 验收 — 入口 → 交互 → 结果

入口（用户从哪触发）：
- 缺陷 A 路径：开发机 git pull 刷新全仓 mtime 后 git commit（G12 今日 brief 判定 + verify-parallel --scan-today 今日 dev doc 判定）
- 缺陷 B 路径：两个 session 并行 git commit（post-commit marker 并发读写）

处理（中间经过哪些步骤）：
- pre-commit 组 6 → resolve-commit-brief 认领制（今日 brief 并集 = 文件名日期过滤）
- hook-check-task-scope 文件范围检查（今日 brief 并集 = 文件名日期过滤）
- verify-parallel --scan-today（今日 dev doc = 文件名 -YYYYMMDD.md 后缀过滤）
- pre-commit hook 写 head|ts marker → post-commit 读 marker 判 bypass（无 rm、无跨 session 误删）

结果（最终展示在哪）：
- git commit 正常通过：346 个历史 brief 不再误判为今日（缺陷 A 修复：346→1）
- bypass.log 无误报 detected-bypass：双 session 并行提交互不干扰（缺陷 B 修复：CT-29）
- tests/control-tower/ 两个新测试文件全绿（DS4/DS5）

## 架构层: 基础设施
L1/L2/L3/L4/L5
#CRITERIA: A
<!-- #CRITERIA: A/B/C/D 条件归属（v3-FINAL），必填；pre-commit G10 + hook-block-write CP1 + pre-doc-audit CP2 消费 -->

## Done 标准
- [ ] 入口可触达: 开发机 git commit 触发 pre-commit 全链路（含 G12 认领制 + post-commit bypass 判定）
- [ ] 链路走通: mtime 判定清零 → 文件名日期判定生效 → marker head|ts 对账生效（无 rm）
- [ ] 结果可见: 两个新测试全绿 + DS1-DS7 门禁全部通过 + V4.7.9 标签可见
- verify: "rg -n 'newermt' scripts/ | wc -l" → 0（DS1）
- verify: "rg -n 'today_files_by' scripts/ | wc -l" → ≥4（DS2）
- verify: "grep -n 'rm -f.*last-precommit-success' scripts/hooks/post-commit.sh | wc -l" → 0（DS3）
- verify: "bash tests/control-tower/today-by-name.test.sh" → 全绿（DS4）
- verify: "bash tests/control-tower/post-commit-marker.test.sh" → 全绿（DS5）
