# Task Brief: D1218 gen-cto-health 迁移期显式降级（E4 第 6 条）

> 生成: 2026-10-07 | 任务: D1218 | 认领: line-a-identity | 卡 #1267（E4）/ #1224 | 前置 #1268 已解

#CRITERIA: D

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔（基础设施层）。E4 六条消费者的第 6 条，前置 `#1268`（其配对测试存量红曾把该文件的一切改动锁死）
已由 line-d-own 修复（PR #1274 已合，配对测试实测 rc=0）。
### b) 文件审计
- `scripts/control-tower/gen-cto-health.py:232-244`：`analyze_task_state()` 在 task-state 缺席时裸 return。
- 其余 5 条消费者（#1267 已合）已采用同构做法：显式降级 + 迁移期标识 + 反假标记。
### c) 决策
复用 #1267 的既定模式（不新增机制）；夹具直调分析函数 + 注入 `REPO`/`TASK_STATE_DIR`，
避免触碰真实产物（`docs/synova/CTO-HEALTH.md` 是移动靶）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 业界：可观测性实现里「缺数据」与「零数据」必须可区分（否则仪表盘说谎）。
- Anthropic 决策链：spec（字段契约 + 降级语义）→ 夹具（含反假标记 + 改坏即红）→ 实现 → 验证。
- memory/：铁律 11（禁静默降级）、24/31（降级显式且传播）、32（错误分类）、ctrl-tower-change 模式 1。
- 参考：Anthropic 基线 + 判例三档 B。结论：显式字段 + stderr 行 + 反假标记断言。

## Q2: 范围 — 正确的最简方案
做什么：
- scripts/control-tower/gen-cto-health.py
- tests/control-tower/gen-cto-health-migration.test.sh
不做什么：
- 不改 tests/control-tower/gen-cto-health.test.sh（line-d-own 的 PR #1277 冲突面）
- 不改 scripts/control-tower/claim_store.py（已落地，本件只探测目录）
- 不改 scripts/audit/（K3 红线）
- 不改 .github/workflows/ci.yml（线 B 所有）
- 不改 scripts/pre-commit-check.sh（写集已让出给 line-e-da2）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`analyze_task_state()`（健康报告生成时被调用）。
处理：探测 claim 库 → 组装 migration 三字段 + degraded → stderr 显式行。
结果：有 claim ⇒ 报告显式标迁移期；无 claim ⇒ 无迁移期标记（防假标记）。

## 架构层: 基础设施

## 写集（机器生成，禁手改）

| 文件 | 类型 |
|---|---|
| scripts/control-tower/gen-cto-health.py | task |
| tests/control-tower/gen-cto-health-migration.test.sh | task |
| .claude/task-briefs/2026-10-07-D1218-gen-cto-health-degrade.md | task |
| memory/notes/proposed/2026-10-07-d1218-gen-cto-health-migration.md | task |
| .claude/bypass.log | builtin（hook 运行期产物，自动豁免） |

## Done 标准
- [x] verify: bash tests/control-tower/gen-cto-health-migration.test.sh 输出「12 通过, 0 失败」
- [x] verify: bash tests/control-tower/gen-cto-health.test.sh 输出 rc=0（既有配对测试零回归）
- [x] verify: python3 -c "import ast;ast.parse(open('scripts/control-tower/gen-cto-health.py',encoding='utf-8').read())" 通过
- [x] verify: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh 输出「全部 13 组通过」
