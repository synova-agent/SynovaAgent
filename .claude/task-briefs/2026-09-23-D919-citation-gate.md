# Task Brief — D919 引用可核验门禁（check-citations + pre-dispatch ⑥ 接线 + CI 密封）

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计

控制塔线（门禁/CI 基建面），不动 src/** 产品代码。

- 触发: 创始人 2026-09-22 质问「我写了一份不存在的权威引用」；原 CTO 会话给了结论（Anthropic 机器可验契约 + DSH 可归因 InvariantError），**未落成机制**。本次补这一环。
- 文件审计（实测）：
  - `scripts/control-tower/pre-dispatch-check.sh`:45-51 已有第⑥步「引用 file:line 抽查」→ **存在但 fail-open**（`head -25` 截断 / 扩展名缺 .md / 无仓外根 / 无错误码）。
  - `scripts/control-tower/check-citations.py` — 新建（核验器）。
  - `.claude/skills/claim-verifier/SKILL.md` — 已有「核实声称」方法论（人工侧），本次不替代它，补机器侧。
  - 同类可复用: `scripts/control-tower/merge_writeset_gate.py` 的 `## 写集豁免` 段落解析形态（本任务复用同形 `## 引用豁免`）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训

参考：Anthropic/DeepSeek/第一性原理 + 结论=**引用是声称，声称必须可被第三方无上下文复现；门禁必须 fail-closed 且可归因**。

- Anthropic 工程基线（DECISION-REFERENCE.md:19 适用域「门禁/fail-closed、脚本化验证、机器可验契约」）→ 该做什么。
- DSH 源码范式 → 怎么做：`InvariantError`（code + packageName，违规从不匿名）；`compilePatterns`（注册即校验声明，声明不被信任）。
- 第一性原理：不可复现的引用与不存在的引用等价。
- memory/ 历史同类：M1 fail-open 静默失效（检查未执行 == 通过）；M2 声称 vs 事实；D732（派单凭记忆写写集路径）。
- 决策沉淀：`memory/notes/proposed/2026-09-23-d919-citation-gate-mechanism.md`（铁律 49）。

## Q2: 范围 — 正确的最简方案

做什么（逐条精确路径）：
- scripts/control-tower/check-citations.py — 新建核验器：file:line / file:line-line / 反引号裸路径；仓内 + 仓外根（含 DSH `node_modules/@deepseek-ai/<pkg>` 布局补全）；Unicode 路径（中文名文档同核）；三态退出 0/1/2；错误码 5 种 + owner 可归因；`## 引用豁免`（无理由不生效）；`--json`
- scripts/control-tower/pre-dispatch-check.sh — 第⑥步由 `head -25` 截断实现换成调用核验器（fail-closed；核验器缺失时显式 degraded，不静默）
- tests/control-tower/check-citations.test.sh — 新建密封测试（13 断言：正常 / 4 违规 / 降级 / 4 边界 / 2 接线）
- .github/workflows/ci.yml — 本测试入 Control Tower Gate Tests 密封清单（1 行）
- memory/notes/proposed/2026-09-23-d919-citation-gate-mechanism.md — 决策 Note（铁律 49）
- task-state/D919.json — 卡
- .claude/task-briefs/2026-09-23-D919-citation-gate.md — 本文档

不做什么（含文件路径）：
- 不改 scripts/audit/**（审计红线）、不写审计标准、禁止自我审计
- 不改 src/ 下任何产品代码（本任务纯控制塔面）
- 不改 tests/control-tower/pre-dispatch-check.test.sh（既有 8 断言实测仍全绿，无需改）
- 不改 docs/synova/coordination/DECISION-REFERENCE.md（参考系文档，本次只引用不改写）

## 写集

> D749 单一事实源（机器块）。格式对齐 `scripts/control-tower/brief_parser.py`。

| 文件 | 类别 |
|---|---|
| `scripts/control-tower/check-citations.py` | task |
| `scripts/control-tower/pre-dispatch-check.sh` | task |
| `tests/control-tower/check-citations.test.sh` | task |
| `.github/workflows/ci.yml` | task |
| `memory/notes/proposed/2026-09-23-d919-citation-gate-mechanism.md` | task |
| `task-state/D919.json` | task |
| `.claude/task-briefs/2026-09-23-D919-citation-gate.md` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本，与写集无关） |

## Q3: 验收 — 入口 → 交互 → 结果

入口：`bash tests/control-tower/check-citations.test.sh`；派单时 `bash scripts/control-tower/pre-dispatch-check.sh <派单文档>`
处理：核验器抽取引用 → 逐条在仓内/仓外根解析 → 命中且行号在范围内即通过，否则带错误码 + owner 判红
结果：测试 13 通过 0 失败；真实文档（整体推进计划-主线-20260913.md）2 条引用 0 违规；既有 pre-dispatch 测试 8 通过 0 失败（无回归）

## 架构层

治理/CI（`scripts/control-tower` + `.github/workflows`；不触五层依赖图）

## Done 标准

- [ ] `bash tests/control-tower/check-citations.test.sh` 退出 0（13 通过 0 失败）——原始输出贴 PR
- [ ] `bash tests/control-tower/pre-dispatch-check.test.sh` 退出 0（8 通过 0 失败，无回归）——原始输出贴 PR
- [ ] 反例留证：40 条违规全量报出（原 head -25 截断）；`中文名文档.md:3` 不存在 → CITE_FILE_NOT_FOUND；伪造外部权威 `dsh-不存在包/lib/index.js:12` → exit 1
