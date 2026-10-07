# Task Brief — D914 ownership 补齐（CTO 治理文档三目录）

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
控制塔治理层。`docs/synova/coordination/ownership.yaml` 是模块归属的**机器可读唯一源**（消费者 `scripts/control-tower/check-ownership.py`，产物 `.github/CODEOWNERS`）。
### b) 文件审计
实测三类目录落 `**` 兜底 = win：`docs/synova/dispatch/**`（2026-09-21 新建的派单件规范路径）、`docs/authority/**`、`docs/synova/research/**`。兄弟路径 `docs/synova/coordination/**`、`docs/synova/product-lines/**` 已明列 mac。
### c) 决策
**只补登记，不改任何既有归属**（规则按顺序求值、最后匹配者胜出 → 新增行放在 `.github/workflows/**` 之前，不与后续规则冲突）。机制治本交 D911 切片 B。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- 同族第 5 次（D782 `tests/doc-system`、D793/D795 `tests/project`、D861 `tests/agent`+`e2e`）—— 每次都是「新目录没登记 → 落兜底 win → 混装 PR 跨域红灯」。
- 铁律 9「关键变更 grep 全仓库传播」：新增目录必须回头补登记。
- 参考：CODEOWNERS 官方语义 = 最后匹配者胜出 → 与 `ownership.yaml` 同序，故新增规则位置须显式说明。

## 写集

| 文件 | 类别 |
|---|---|
| `docs/synova/coordination/ownership.yaml` | task |
| `.github/CODEOWNERS` | task |
| `task-state/D914.json` | task |
| `.claude/task-briefs/2026-09-22-D914-ownership-CTO文档三目录.md` | task |
| `.claude/bypass.log` | builtin（post-commit hook 运行期账本） |

## Q2: 范围 — 正确的最简方案
做什么：
- `ownership.yaml` 补三条 mac 规则：`docs/synova/dispatch/**`、`docs/authority/**`、`docs/synova/research/**`（附 source 与「为什么落兜底」注释）
- 重跑 `python3 scripts/control-tower/check-ownership.py --emit-codeowners > .github/CODEOWNERS`
不做什么（含文件路径）：
- 不改 `scripts/control-tower/check-ownership.py`、`scripts/control-tower/check-pr-budget.sh`（治本在 **D911 切片 B**，本卡零机制）
- 不改 `scripts/**, src/**, .github/workflows/**`
- 不碰 `scripts/audit/**`

## Q3: 验收 — 入口 → 交互 → 结果
入口：`python3 scripts/control-tower/check-ownership.py <三类路径各一>`
处理：按 ownership.yaml 规则求值
结果：三类路径判 **mac**；`tests/control-tower/check-ownership.test.sh` 51/51 通过

## 架构层
治理层（ownership 台账 + CODEOWNERS 产物；不触五层依赖图）

## Done 标准

- `check-ownership.py` 对 dispatch/authority/research 三类路径判 mac（贴原始输出）
- `bash tests/control-tower/check-ownership.test.sh` → 51/51 通过（CODEOWNERS drift 逐字节断言不破）
- `git diff` 只新增行、不改既有归属
