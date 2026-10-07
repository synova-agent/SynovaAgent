# Task Brief: D752 哨兵类型网登记硬门禁

> 生成: 2026-09-15 11:38:35 | 分支: main | as any: 0
> 派单: docs/synova/coordination/派单-哨兵欠账-D751-D752-D754-20260914.md §二（D752，P1）
> 依据: docs/synova/coordination/质询-可插件化-欠账登记-20260914.md §二 D752
> 前置: D750 已合入 main（5c4ae8a7）；D751 已推送 feat/d751-new-sentinel-e2e-assertion

## 项目身份（每次重读 — 源自 CLAUDE.md §项目身份）

SynovaAgent 是一个驻扎企业的 AI 诊断系统。诊断是手段，增长才是目的。
核心问题：这家企业的增长卡在哪里？现在该做什么？
Agent，不是 ChatBot。驻扎企业，持续观测，主动发现，自动诊断，给出行动建议，跟踪执行。
目标: 成为组织诊断的 AWS。文件驱动扩展——新增哨兵 = 加目录（loader 扫描发现）。
数据流: L5 存储 → L4 本体 → L3 洞察(哨兵定时+诊断按需) → L2 编排 → L1 交互
五层架构: L1 交互 routes/tui/mcp/ · L2 编排 agent/orchestrator/ · L3 洞察 l3/sentinel/ · L4 本体 l4/evidence/ · L5 存储 store/cron/

## Q0: 定位 — 项目拼图 + 文件审计

### a) 项目拼图
「纵向」L3 洞察层哨兵体系（- [x] 纵向）。src/sentinel/types.ts 用静态 import type 做
编译期类型登记，但**不加也能跑 = 软约束**——实测 8/45 活跃哨兵未登记
（cash-runway/revenue-health/competitive-moat 等）长期无人发现；且 types.ts 引用
38 个目录含已归档 _extinct。本任务把登记变硬门禁（check 脚本 + 双测试）+ 补登记 8 个。

### b) 文件审计
grep 复现（worktree 实测）: 活跃 45（loader 口径排除 shared/_ 前缀/非目录），
types.ts 登记 38 → comm -23 差集 = 8 个未登记（cash-runway/competitive-moat/
competitive-position/key-person-risk/path-dependency/revenue-health/
sentinel-forecast-accuracy/sentinel-pricing-strategy）；_extinct 引用 12 处。
关系: 复用（loader 豁免口径同源）+ 新建（check 脚本）+ 补齐（types.ts 仅加行）。

### c) 决策
豁免规则与 sentinel-loader.ts L71-73 加载口径**同源**（loader 跳过的一律不要求登记）——
单一事实源，不发明第二套豁免。path-dependency 的 entryPoint 特殊
（computes/detect.ts 非 aggregate.ts），故登记判定按「types.ts 引用
extensions/sentinels/<name>/ 路径前缀（带尾斜杠防前缀碰撞）」计。

## Q1: 调研 — 决策链 + 执行约束

### a) Anthropic 决策链
① SPEC = 门禁点名缺失 + 删登记必红。② 测试先行: bash 测试 9 断言 + vitest 集成 4 断言
先于提交（配对由 ct-test-gate 强制）。③ 实现 = check 脚本（契约头 + 沙箱注入缝
SYNO_TYPE_NET_ROOT）+ 补登记 8 行。④ 接线: ct-test-gate 自动配对（pre-commit 跑
配对测试）+ vitest 集成测试进 CI 全量（ci.yml 红区不可改，CI 侧拦截经 vitest 实现，
铁律 12）。⑤ 验证 = 自检 + 反向验证两次输出。

引用依据:
- 铁律 0-2: test → impl → wire（bash 测试先红后绿）
- 铁律 12: vitest 集成测试跑真实脚本（child_process 真实文件系统，非 mock）
- 铁律 24/31: 门禁自身降级显式化（目录缺失 → exit 2 fail-closed，不静默当绿）
- 铁律 35: 自动化优先——review 拦不住漏登记，check 脚本拦得住

### b) 本任务执行约束
- rule: "豁免口径与 sentinel-loader 同源（shared/_ 前缀/非目录），不发明第二套"
  verify: "grep -c '豁免' scripts/control-tower/check-sentinel-type-net.sh"
- rule: "删任一已有登记 → 门禁必红（反向验证）"
  verify: "bash scripts/control-tower/check-sentinel-type-net.sh（删行后 exit 1，恢复后 exit 0）"
- rule: "补登记的 import 必须真实可解析（tsc 零新错）"
  verify: "npx tsc --noEmit | grep -c 'types.ts' → 0"

### c) 决策参考系
参考：Anthropic/DeepSeek/第一性原理 + 结论——机器可验契约（check 脚本 +
exit code）+ 最少机制（豁免复用 loader 口径；macOS bash 3.2 兼容用括号 case 模式，
实测 `in _*)` 在 bash 3.2 报语法错）。收敛 → 直接执行。

### d) 相关 Note 引用
- 派单 + 欠账登记已在本单链路；bash 3.2 兼容坑记入本 brief（windows-compat 同族：
  平台差异必须实测，不假设 POSIX 一致）。

## Q2: 范围 — 正确的最简方案是什么？

做什么：
- scripts/control-tower/check-sentinel-type-net.sh （新增硬门禁: 活跃哨兵逐一比对 types.ts 登记，缺失 exit 1 点名；豁免显式化；降级 exit 2）
- tests/control-tower/check-sentinel-type-net.test.sh （配对测试: 正常/红/豁免/降级 9 断言）
- tests/sentinel/d752-type-net-gate.integration.test.ts （vitest 集成 4 断言——CI 接线，真实子进程+沙箱）
- src/sentinel/types.ts （仅补登记 8 行 import type + 1 行 D752 注释；保留 _extinct 存量不动）

不做什么：
- 不改 scripts/pre-commit-check.sh（接线属控制塔另单；ct-test-gate 已自动配对新脚本测试）
- 不改 .github/workflows/ci.yml（CI 红区；CI 侧拦截经 vitest 集成测试实现）
- 不改 src/sentinel/sentinel-loader.ts（loader 逻辑无缺陷，D751 已动其注入缝）
- 不改 extensions/sentinels/cash-runway/manifest.json（extensions/sentinels/** 属 Win 数据侧，派单红区）
- 不改 src/sentinel/types.ts 的 _extinct 存量引用（不删不整理——写集限定「仅补登记」；清理另单）

## Q3: 验收 — 入口 → 交互 → 结果

入口: bash scripts/control-tower/check-sentinel-type-net.sh（本地/pre-commit 配对测试触发；
CI 经 vitest 集成测试触发）
处理: 扫 extensions/sentinels/（loader 同口径豁免 shared/_ 前缀/非目录）→ 逐哨兵
grep types.ts 路径前缀引用 → 缺失收集点名。
结果: 全登记 exit 0 + 计数；缺失 exit 1 + 逐个点名 + 修法提示；环境缺失 exit 2 fail-closed。
补登记后 45/45 全绿；删任一登记必红（反向验证）。

## 架构层: L3（洞察层哨兵类型网）+ 控制塔门禁（scripts/control-tower）
#CRITERIA: A

## Done 标准
- [x] 门禁点名: verify: bash scripts/control-tower/check-sentinel-type-net.sh → 补登记前 exit 1 点名 8 个（已贴输出）
- [x] 补登记后全绿: verify: bash scripts/control-tower/check-sentinel-type-net.sh → exit 0 + 45 全登记
- [x] 反向验证: verify: 删 cash-runway 登记行 → exit 1 仅点名 cash-runway；恢复 → exit 0（两次输出）
- [x] 双测试绿: verify: bash tests/control-tower/check-sentinel-type-net.test.sh → 9 ✅；npx vitest run tests/sentinel/d752-type-net-gate.integration.test.ts → 4 passed
- [x] 零回归: verify: npx vitest run tests/sentinel → 918 passed | 1 skipped

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |
| .claude/task-briefs/2026-09-15-D752-type-net-gate.md | task |
| memory/notes/implemented/2026-09-15-d752-type-net-hard-gate.md | task |
| scripts/control-tower/check-sentinel-type-net.sh | task |
| src/sentinel/types.ts | task |
| task-state/D752.json | task |
| tests/control-tower/check-sentinel-type-net.test.sh | task |
| tests/sentinel/d752-type-net-gate.integration.test.ts | task |

