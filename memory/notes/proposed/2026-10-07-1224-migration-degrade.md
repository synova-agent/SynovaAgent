# 状态: proposed
# 日期: 2026-10-07
# 决策: D-C 迁移期消费者侧「显式降级」——task-state 停更后，26 个消费者逐个三选一，禁静默空白
# 理由: K3 变更前预审 R6/R7 要求「空白仪表盘须显式『迁移期』标识，非静默」

## 决策内容

D-C 把声明载体从 `task-state/<D#>.json` 迁到 `.claude/claims/<issue>.yaml`。
`task-state/` 存量按「只读保留 ≥2 周」处置（**不删**）。但**消费者若不改**，
新任务在它们眼里**根本不存在** —— 表现为「卡总数停在存量」「0 任务可兑换」
「僵尸判定未生效」，全都长得像"正常绿"，属静默空白（铁律 11）。

本批六条按**显式降级**处置（打印迁移期标识 + 明说"不是通过，是无判据对象"）：

| 消费者 | 处置 |
|---|---|
| `scripts/control-tower/daily-cto-board.sh` | 卡总数**并列** claim 计数 + 迁移期标识；计数不可用打「?（计数降级）」**不静默当 0** |
| `scripts/control-tower/check-notes-lifecycle.sh` | 无卡分支由**静默 continue** 改为登记 + 末尾统一打印迁移期标识与条目清单 |
| `scripts/control-tower/founder-truth.py` | claim 并列计入任务全集 + stderr 迁移期标识 |
| `scripts/control-tower/gen-cto-health.py` | task-state 缺席时返回 `degraded` + `migration_period` 字段与文案（裸 return 会让报告"看着干净"） |
| `scripts/control-tower/verify-parallel.sh` | 无卡且已启用 claim 库 → 打「关闭判定退化，按未关闭处理」到 stderr |
| `scripts/product-lines/redeem-progress.py` | 迁移期打印「本次**未纳入兑换**」+ 条数（否则"0 任务可兑换"= 静默空白） |

## 为什么不是「改读 claim」（本轮）

六条里有五条的语义是**历史/统计**（status 状态机、验收点、兑换闭环），其数据模型绑定
`task-state` 的状态字段。claim 是**两字段制**（writeset+done），**没有** status/audit/impl 字段
——强行"改读 claim"会造出第二种半套语义。故本轮取**显式降级**（可见、可审计、无假绿），
真正改读留待 status 语义迁到 issue 号之后。

## 代价与已知边界

- 迁移期这些消费者**仍不产出新任务的完整信息** —— 只是**不再静默**。这是有意的：宁可可见地缺，
  不可静默地绿。
- `daily-cto-board.sh` 的 claim 计数依赖 `claim_store.py --count`；本 PR 从 main 起、尚不含该库
  ⇒ 走「计数降级」分支（已夹具断言）。核心 PR 合入后自动走真值分支。

## 关联

- 卡 #1224（D-C）／父卡 #1221；K3 预审 R6/R7
- 配套：#1259（核心 claim 库 + 防劫持）· #1264（R1/R6 触及面清单）
- 夹具：`tests/control-tower/daily-cto-board.test.sh`（8 项）· `tests/control-tower/redeem-progress.test.sh`（6 项）
