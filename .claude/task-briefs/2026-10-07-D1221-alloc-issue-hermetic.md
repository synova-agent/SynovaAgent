# Task Brief — alloc issue 源返工：hermetic 不成立 + 故障路径自身崩（D1221）

> 卡 **#1283**（返工卡，Lead 立）· 前序 PR #1281（已合）· verifier 事后审计 2×P2 + 1×P3
> 从 `origin/main` 开新分支（前序分支已合 ⇒ **不再推回**）

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
治理面（`scripts/control-tower`）控制塔发号器 + 其两套 hermetic 测试。

### b) 文件审计（本轮实测，gh shim 插桩）
- **R1**：`check-name-allocation.test.sh` **10 次**、`alloc-task-id.test.sh` **5 次**
  真实 `gh issue list` ⇒ **每轮 CI 真打 15 次网络**（与注释「不得打真网络」矛盾）。
  **根因比"只有一处守卫"更深**：两测试的沙箱**各自 `git init`** ⇒ 我加的 `TS_TOP` 门槛**不跳过**；
  且 `gh` 按 **PWD** 解析仓库 ⇒ 沙箱 task-state 也去查 **PWD 所在真仓**的 issue（跨仓污染）。
- **R2**：`:523/:531/:545/:555` 四处 `$EXIT（期望 1）` ⇒ bash 3.2 + `set -u` 下
  `EXIT?: unbound variable` ⇒ **掩盖真实失败信息**（任一 fail 分支都中招）。
- **P3**：注释里「stdout 写了会被读成已占用」的理由**不成立**（verifier 核实唯一消费者按 rc 分支）。

### c) 决策
R1 **两层修**（逐调用点守卫 + 工具侧 cwd 对齐）；R2 修 + **全目录扫描同类**；P3 改援引接口契约。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **Hermetic 红线**：两测试都在 CI 密封清单 ⇒ 零网络是硬要求，不是优化项。
- **铁律 11**：降级要显式；本次反向也适用 —— **测试里"图省事全局关源"= 静默放宽判据**。
- **同类第 2 次**：`$VAR（` 全角吞变量名我在 `alloc-task-id.sh` 已踩过一次 ⇒ 本次按纪律
  **全目录扫描**（Lead 要求），而非只修自己那 4 处。
- **既有原则复用**：本脚本早有「占用表全源跟随 task-state 所属仓库，不得混入 CWD 所在仓」
  （D940 返工 #743 K3 P0）⇒ gh 调用应在 `$TS_TOP` 内取数，是**对齐既有原则**而非新增设计。
参考：第一性原理（测试不得触网 + 失败必须可见）+ 既有 D940 原则 ⇒ 两层修 + 契约措辞。

## Q2: 范围 — 正确的最简方案
做什么：
- `scripts/control-tower/alloc-task-id.sh` — gh 调用改在 **`$TS_TOP`** 内取数（对齐既有原则，
  堵住沙箱→真仓的跨仓污染）
- `tests/control-tower/alloc-task-id.test.sh` — ① **逐调用点**守卫 `SYNO_ALLOC_NO_ISSUES=1`（19 处）
  ② 修 4 处 `$EXIT（` → `${EXIT}（` ③ 新增 §13(g) **反直觉断言**（全局守卫破坏源 active 场景）
  ④ §13(e) **刻意不加**守卫（要测"源 active 但不可达"）并加注
- `tests/control-tower/check-name-allocation.test.sh` — 委派侧 `chk()` 加守卫（1 处）
- brief + `task-state/D1221.json` + 更新既有 Note（P3 更正 + 返工记录）

不做什么（含文件路径）：
- **不改其余 16 个含同类 `$VAR（` 的文件**（`check-citations.test.sh` / `post-commit.test.sh` /
  `parallel-main-tree-occupancy.test.sh` … 详见 Note 清单）—— 不在本卡写集，**只报不改**，交 Lead 另卡
- 不改 `scripts/control-tower/check-name-allocation.sh` 的委派结构
- 不改既有 5 源的语义与退出码（0/1/2）
- 不改 `.github/workflows/ci.yml`、`scripts/pre-commit-check.sh`、`scripts/audit/**`
- **不为了省事去掉「源 active」断言**（Lead 明令：那是把判据放宽）

## Q3: 验收 — 入口 → 交互 → 结果
入口：`PATH=<gh shim> bash tests/control-tower/{alloc-task-id,check-name-allocation}.test.sh`
处理：逐调用点守卫使沙箱不触网；工具侧 gh 在 TS_TOP 内取数。
结果：**真实 gh 调用 0 次**（改前 15）；两套件全绿；生产路径仍 `含=yes 状态=ok`。

## 架构层: 治理面（scripts/control-tower）
#CRITERIA: D

## 写集
| 文件 | 类型 |
|---|---|
| `scripts/control-tower/alloc-task-id.sh` | task（gh 在 TS_TOP 内取数） |
| `tests/control-tower/alloc-task-id.test.sh` | task（逐点守卫 + R2 + §13(g) 反直觉断言） |
| `tests/control-tower/check-name-allocation.test.sh` | task（chk() 守卫） |
| `.claude/task-briefs/2026-10-07-D1221-alloc-issue-hermetic.md` | task |
| `task-state/D1221.json` | task |
| `memory/notes/proposed/2026-10-07-alloc-issue-source.md` | task（P3 更正 + 返工记录 + 全目录扫描） |

## Done 标准
- [ ] verify: PATH=<gh shim> bash tests/control-tower/alloc-task-id.test.sh ⇒ rc=0 且 shim 记录 0 次 issue list
- [ ] verify: PATH=<gh shim> bash tests/control-tower/check-name-allocation.test.sh ⇒ rc=0 且 0 次 issue list
- [ ] verify: bash tests/control-tower/alloc-task-id.test.sh ⇒ 结果: PASS=70 FAIL=0
- [ ] verify: grep -c '\$EXIT（' tests/control-tower/alloc-task-id.test.sh ⇒ 0（R2 已清零）
- [ ] verify: 变异体（优先级翻转 FILE>NO）⇒ alloc-task-id.test.sh rc=1（反直觉断言承重）
- [ ] verify: bash scripts/pre-commit-check.sh ⇒ 13 组通过
