# Synova 分工章程 v4（2026-08-16 创始人定稿）

> 状态：**已定稿（2026-08-16 创始人确认）**。本文件与 TASK-ROUTING.md v4 同为定稿，一致。
> 原则：编码双轨互不重叠、审计双轨各自独立、CTO 主从、仪表盘归 Mac DSH。

## 一、编码双轨章程（互不重叠，不做同样内容）

### 1.1 核心代码切片（DSH 也写核心，垂直切片制）

**按产品两大系统垂直切**，各占一端到端，互不重叠：

| 角色 | 核心代码切片 | 路径 | 一句话 |
|---|---|---|---|
| **Mac DSH**（🛠 synova-dsh） | **哨兵体系（定时巡检线）** | `src/sentinel/`、`src/cron/`、`src/agent/sentinel-service`、相关 evidence 消费 | 数据→哨兵→信号→专家→工单，端到端 |
| **Win Claude Code** | **诊断体系（按需诊断线）+ 底座** | `src/l3/`、`src/l4/`、`src/expert/`、`src/agent/`（diagnosis-launcher/ConversationEngine）、`src/routes/`、`src/store/`、`extensions/`、`packages/`、`synova_worker/` | FDE 6阶段管道 + 本体 + 存储 + 交互 |

> 切片的理由：产品天然就是"哨兵定时 + 诊断按需"两套系统（AGENTS.md），按系统垂直切 = DSH 拥有完整可评估的一线，不是零散改文件。共享模块（如 expert-platform/evidence 边界）由认领制逐项仲裁。

### 1.2 控制体系 + 验证 + 门面（DSH 独占，与上并列）

| 路径 | 归属 |
|---|---|
| `scripts/`（control-tower/workflow/hooks/product-lines/golden-scenarios）、`.github/workflows/`、`src/mcp/`、`electron/`+`electron-renderer/`、`docs/synova/coordination/`、DSH 预设与技能 | **Mac DSH** |

**互不重叠保证（三层物理/惯例）**：
1. ~~`CODEOWNERS`（机器强制）：`src/server.ts`+门禁+coordination+VERSION.md 有 owner，越界 PR 被 GitHub 拦~~
   🔴 **W10/D1167 实测更正（2026-10-06）: 本句不成立** —— `require_code_owner_reviews=false` + 43 条规则全指向同一 owner ⇒ **越界 PR 不会被 GitHub 拦**。CODEOWNERS 现为**领地声明**（可对账），非强制。处置方向见 `TASK-ROUTING.md` §串行点 的实测注（要开须先建三团队，且属门禁语义变更 ⇒ 提案→K3→CTO 裁）。
2. 认领制 D296（组 12）：文件级认领，写错范围被 pre-commit 拒
3. 写集重叠检查（pre-push verify-parallel）：出 doc 方声明写集，两边写集重叠 → 停手问创始人

**一句话记**：DSH 修"管 AI 的 AI + 验证 + 门面"，Claude 修"产品发动机"。两者领地零交集。

## 二、审计双轨（各自独立）

| 轨 | 壳 | 脑 | 说明 |
|---|---|---|---|
| **Win** | Kimi code CLI | K3 | 已有，独立审计 |
| **Mac** | DSH（🔍 synova-k3-audit 预设） | K3 | DSH 当壳、K3 当脑，零上下文，独立工作区 |

- 两轨各自独立，产物都进 `docs/synova/audit-reports/`（git 跟踪）
- 红线不变：`scripts/audit/` + 审计标准 = K3 专属，DSH 只当壳不写标准

## 三、CTO 主从

| 角色 | 载体 | 职责 |
|---|---|---|
| **主 CTO** | Mac DSH（🧭 synova-cto） | 建体系 + 盯全局（三仪表盘）+ 打补丁 + 周报 + 管员工 session |
| **副手（影子）** | Win DSH | 只读复核主 CTO 的产出，独立判断对错，异议升级创始人——**不主动改** |

- 撞车规则：影子发现主在动某模块 → 只读不碰，把异议发创始人仲裁
- K3 独立审计照旧（审两边，红线 3 无豁免）

## 四、仪表盘归属（Codex 交还）

| 仪表盘 | 主导 | 说明 |
|---|---|---|
| 26 线产品完成度 | **Mac DSH** | `scripts/product-lines/` + 进度页 |
| 任务进展 DASHBOARD | **Mac DSH** | 主导维护 |
| 项目健康（CTO 第③面） | **Mac DSH** | 待建 |

- **Codex 不再跟仪表盘**（原"双仪表盘"职责交还 Mac DSH）
- Codex 保留：Claude 线 dev doc + D# 统一分配 + 任务登记

## 五、dev doc 双轨（确认，沿用）

- DSH 线 dev doc → DSH 自出（📋 synova-devdoc）
- Claude 线 dev doc → Codex（Win）
- 护栏不变：DSH 自出 doc 自实现的任务，交付端由 K3 全量核（防自我闭环）

## 六、终态

Mac DSH 跑顺、质量达标 → **两边统一到 DSH**（Win 的 Claude/Codex 逐步收敛到 DSH 预设）。

## 七、CTO 盯两边效率/质量/成本（创始人评估依据）

创始人要评估"DSH vs Claude"谁更适合做底座。主 CTO 负责盯三指标，产出**双轨评估看板**（CTO 第④面）：

| 维度 | 指标 | 数据源 |
|---|---|---|
| **效率** | 每任务耗时、工具往返轮次、commit 被门禁拒几次 | git log + bypass.log + pre-commit-failures.log |
| **质量** | K3 审计 P0/P1 数、跑偏次数（north-star 判偏离）、返工率（一个任务改几轮才过） | AUDIT-FINDINGS-LEDGER + git 历史 + 台账 |
| **成本** | token 消耗、模型 API 费用、时间成本 | DSH 会话 telemetry + token-meter；Claude 侧 API 用量 |

- 评估周期：每批任务结算一次，CTO 周报里给"DSH vs Claude 效率/质量/成本"对照
- 结论供创始人决定：DSH 达标 → 扩大 DSH 切片；不达标 → 收缩，继续调预设
- 红线：评估只报**物理事实**（数据），不替创始人下"谁好"的结论——决策权在你

