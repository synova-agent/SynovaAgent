---
name: synova-audit
description: 独立审计任务交付——Kimi K2.6 零上下文会话审查 Codex/Claude Code 产出。按 AUDIT-PROTOCOL.md 执行 L1-L4 四层审计，输出 git 跟踪的审计报告。
---

# synova-audit — 独立审计任务交付

> 审计员: Kimi K2.6（独立会话，零上下文）  
> 协议: `docs/synova/coordination/AUDIT-PROTOCOL.md`  
> 版本: v1.0（基于 D328 首次审计 + AUDIT-PROTOCOL v1.0）

## 使用时机

每次 Codex 写 dev doc → Claude Code 编码 → git push 后，由 Kimi K2.6 独立会话执行审计。

**不是**以下时机的替代：
- ❌ 替代 Codex 自审计（Codex 自审计仍须做，本审计在之上加独立层）
- ❌ 替代 pre-commit / CI（物理门禁仍运行，本审计补语义盲区）
- ❌ 替代 claim-verifier（claim-verifier 核单项声明，本审计做全量任务审计）

## 审计前准备（由 Codex 提供 7 项材料）

| # | 材料 | 来源 | 注记 |
|---|------|------|------|
| 1 | **任务提交集** | `git log --all -- <文件>` 映射 | D320 教训：单提交必漏审 |
| 2 | Git diff | `git show <hash> --stat` + `git diff <hash>^..<hash>` | 物理事实 |
| 3 | Dev doc | `docs/plans/codex/implementation/SYNOVA-IMPL-DXXX-*.md` | 规划承诺 |
| 4 | Task brief | `.claude/task-briefs/` 对应文件 | 范围约束 |
| 5 | AGENTS.md | 项目根 | 铁律判案依据 |
| 6 | **审计基线** | `python scripts/audit/audit-check.py --full`（或降级：手动 grep as any / 空 catch） | 区分新增 vs 预存 |
| 7 | **执行证据包** | CI job 级结论、bypass 记录、pre-commit 通过记录 | L3 依据 |

## 输入隔离（白名单）

**只读**：上述 7 项 + 审计脚本输出 + **grep/只读检索全仓库**（验证接线/接口必须）

**绝不读**：`.claude/` 下记忆/讨论/临时文件（task-briefs/ 除外）、`node_modules/`、`dist/`、未在材料中声明的文件。

> 零上下文 ≠ 禁止检索。检索是验证手段，7 项材料是结论依据。

## 审计流程（7 步）

```
步骤 1: Codex 提供 7 项材料（含提交集映射 + 基线 + 执行证据包）
步骤 2: 跑 D202 外部审计 --dispatch → 定位为基线扫描（已知对 Python/shell 有盲区）
步骤 3: 逐项执行 14 项语义审计（见 §清单）
步骤 4: 输出报告 → docs/synova/audit-reports/YYYY-MM-DD-DXXX.md（git 跟踪）
步骤 5: 分级确认：P0 阻断 / P1 建议 / P2 可选
步骤 6: 修复后复审（只审变更部分）
步骤 7: 归档 + 防线缺口收割（§L4）入控制塔待办
```

## 语义审计清单（14 项）

### 原 11 项（Kimi 原始方案保留）

| # | 项 | 判定方法 |
|---|-----|---------|
| 1 | **接口真实性** | dev doc 声明的每个函数/类，grep 确认存在于代码中 |
| 2 | **文件路径存在性** | dev doc 引用的每个 `src/` / `extensions/` 路径，`[ -f "$path" ]` 确认 |
| 3 | **Edge ID 有效性** | 文档中的 `E-XX` 模式，`grep -r` 确认在 `extensions/` 中有定义 |
| 4 | **架构边界** | diff 中 `grep -n "from '../l3/\|from '../store/"` 等跨层引用 |
| 5 | **数据流完整性** | dev doc 中每个 `→` 箭头，grep 确认有对应函数调用 |
| 6 | **接线深度** | 新 export 被 import 后**真的被调用**（不只是 import） |
| 7 | **降级诚实性** | 每个 catch 有 `log.warn/error` + `degraded: true` |
| 8 | **测试契约** | JSDoc 声明的输入/输出/降级与实际代码一致（铁律 47） |
| 9 | **测试覆盖** | 正常路径 + 降级路径 + 边界条件，非空壳（铁律 48） |
| 10 | **文件驱动** | 新增硬编码类型？manifest？tags？ |
| 11 | **自我报告交叉对比** | Agent 声称的 vs 物理事实（D202 增强） |

### 新增 3 项（AUDIT-PROTOCOL v1.0）

| # | 项 | 判定 |
|---|-----|------|
| 12 | **dev doc 偏离审计** | 写集表 vs 实际提交文件；§3.2 方案 vs 最终实现；每条 DS 必须 file:line 证据 |
| 13 | **控制塔执行审计** | CI 各 job 结论（**job 级，禁整体 run 结论**——D320 生成器假红教训）；bypass 记录；pre-commit 通过记录 |
| 14 | **版本编排合规** | VERSION.md / version.log / git tag 三处同步；批次归属正确 |

## L4 防线缺口收割（每任务必答）

报告末尾固定一节：

> **"本次发现的问题（若有），控制塔哪一道防线本该拦住？为什么没拦住？缺什么？"**

产出填入控制塔"待补"区，凑够 5-8 次触发**控制塔健康审计**（见 AUDIT-PROTOCOL §7）。

## 报告规范

- **位置**: `docs/synova/audit-reports/YYYY-MM-DD-DXXX.md`（**git 跟踪**——非 .codex/audit）
- **必含**:
  - 结论（PASS / CONDITIONAL PASS / FAIL）
  - 14 项逐项表
  - 证据 file:line
  - **运行环境注记**（Windows/Mac/CI/Git Bash——D316"6/7 vs 7/7"、D317"python3 有无"均为环境依赖误判）
  - L4 防线缺口节
- **分级**:
  - P0: 阻断交付 / 安全事故 / 门禁形同虚设 → **必须修**
  - P1: 建议修复 / 数据不实 → 记录跟进
  - P2: 可选改进 → 采纳/忽略

## 与 claim-verifier 的分工

| | synova-audit | claim-verifier |
|---|-------------|----------------|
| **粒度** | 任务级（全量 14 项 + L1-L4） | 声明级（单项核实） |
| **触发** | 任务交付后 | 任何"声称"出现时 |
| **模型** | Kimi K2.6 独立会话 | 任何 agent 自检时 |
| **输出** | 审计报告（git 跟踪） | 结论：属实/不实/环境依赖 |

## 历史案例索引

- **D328**: 首次审计。P0 发现——测试 2/6 失败（劫持场景未拦截），根因 = D317 自包含定位副作用（BASH_SOURCE 真实仓库路径 vs 临时 repo brief）。L4 收割：铁律 0-2 red→green、PostToolUse verify、Agent 自检 6 问、pre-commit 组 2 四道防线均未拦住"测试存在但未全绿"。

## 版本迭代

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-08-11 | 首版：D328 首次审计经验固化 + AUDIT-PROTOCOL v1.0 对齐 + 14 项清单 + L1-L4 模型 |
