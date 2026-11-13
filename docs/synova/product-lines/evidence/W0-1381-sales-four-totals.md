# W0 #1381 销售四总数对账 · Windows 证据

> 当前依据：Gitea #1381 评论 11959；Mandate/Policy `w0-synova-v3`；Assignment `asg_0c1ed176b3134426afae`（epoch 3）。
> 固定 base：`0541ddab1c99e9deb376ff3370e1e5537365d3e4`；分支／worktree：`w0/sales-four-totals`／`.synova-wt-1381-w0`。

## 1. Windows 原生 preflight

```text
timestamp=2026-11-13T19:51:12+08:00
Microsoft Windows 10.0.26200.9974
host_sha256=f7b21e36f310d884cec7a1aab948cb2d5fc3315f0df32642833f840273433e45
DSH_SESSION_ID=UNAVAILABLE_IN_THIS_KIMI_WORK_SESSION
Git=2.54.0.windows.1
Node=v24.15.0
npm/npx=11.12.1
HEAD=1d87111b6307c0f1a116ff81e4eb4e6f1c390656
```

- `npm.cmd ci`：exit 0；added 814 packages；npm 报告 36 个依赖漏洞，本票未扩大写集修复。
- 既有原生 Vitest smoke：1 file／3 tests passed；Gitea 读取成功；push dry-run 经 pre-push 通过。
- 所有命令均在本机 Windows 执行，未使用 Mac 输出。

## 2. G1–G6 交付核对

| 检查 | 结果 | 物理证据 |
|---|---|---|
| G1 生产 call point + WIRING | 通过 | `aggregate.ts` import 并真实调用 `computeSalesFourTotals`；订单字段存在才运行 |
| G2 失败／降级可见 | 通过 | 稳定 warnings；aggregate 产生 `rev_sales_totals_degraded`／`rev_sales_totals_mismatch` Finding |
| G3 真实路径＋改坏两态 | 通过 | 正常、零值、重复键、显式差额、缺基线 5 用例；公式 `+1` 分变异为 4 failed／1 passed，恢复后 5/5 |
| G4 入参／出站边界 | 通过 | 空行、缺失／重复业务键、非有限数、负数、无基线明确处理；缺失值不补零 |
| G5 状态探针 | 通过 | 金额按整数分计算；`matched` 仅四项差额全零成立；无持久化副作用 |
| G6 门禁汇总＋未登记清单 | 部分完成 | 写集限定八路径；指定 `npm run typecheck` 阻塞见 §5，未冒充通过 |

WIRING：

```text
extensions/sentinels/revenue-health/aggregate.ts: import { computeSalesFourTotals, ... }
extensions/sentinels/revenue-health/aggregate.ts: const salesResult = computeSalesFourTotals({
```

## 3. Mandate v2 原生验收

### 定向 Vitest：通过

```text
npx vitest run tests/sentinels/revenue-health/compute-sales-four-totals.test.ts
✓ tests/sentinels/revenue-health/compute-sales-four-totals.test.ts (5 tests)
Test Files  1 passed (1)
Tests  5 passed (5)
V2_VITEST_EXIT=0
```

测试期望值由源行独立推导，fixture 全部为 `SYNTHETIC-*`，无真实客户数据。

### 扩展接线回归：通过

```text
bash tests/control-tower/pre-commit-extensions-wiring.test.sh
✅ 真实 extensions import+call 通过组 4a/4b
✅ 扩展 import-only 被组 4b 判红
PASS=2
V2_WIRING_TEST_EXIT=0
```

测试抽取并执行生产脚本的原始组 4a/4b 代码块；隔离负例未写回工作树。

### 正式 typecheck：通过

评论 11919 明确本票正式 typecheck 证据为 `npm run lint`，不再使用不存在的 `npm run typecheck`，也不修改 `package.json`。最终代码复跑结果：

```text
npm run lint
> synova-agent@0.1.0 lint
> tsc --noEmit
FINAL_LINT_EXIT=0
```

## 4. 改坏必红／恢复复绿

临时将 `orderAmountCents += Math.round(row.orderAmount * 100)` 改为额外 `+ 1` 分，未修改测试：

```text
Test Files  1 failed (1)
Tests  4 failed | 1 passed (5)
MUTATION_VITEST_EXIT=1
```

随后立即恢复公式并复跑，5/5 通过、exit 0；故意改坏代码未保留。此后未再改公式、分支或测试。原始日志在主工作区 `.tmp-w0-1381-run/`，不属于提交写集。

## 5. 最终写集与未验证项

仅允许以下八路径：

1. `extensions/sentinels/revenue-health/computes/compute-sales-four-totals.ts`
2. `extensions/sentinels/revenue-health/aggregate.ts`
3. `tests/sentinels/revenue-health/compute-sales-four-totals.test.ts`
4. `tests/sentinels/revenue-health/fixtures/sales-four-totals-source.json`
5. `docs/synova/product-lines/evidence/W0-1381-sales-four-totals.md`
6. `.claude/claims/1381.yaml`
7. `scripts/pre-commit-check.sh`
8. `tests/control-tower/pre-commit-extensions-wiring.test.sh`

旧 base 的完整 pre-commit 曾因 `gitea/core-gates` 账外腿真实 exit 1；按评论 11959 通过已备份补丁、`stash --staged`、固定 reset 与 `stash pop --index` 安全迁至新 base，无冲突、无第九文件。新 base 上完整 pre-commit 自然结束：`✅ 全部 11 组通过`、`V3_PRECOMMIT_EXIT=0`；无未登记写集，claim 覆盖 8/8。存在既有 CC1–CC4 软提示、镜象 stale 与墙钟预算告警，均非本票硬失败。完整日志：当前 worktree `.tmp-w0-1381-run/v3-precommit.log`。未调整门禁阈值，未使用 `--no-verify`。

UNVERIFIED／NOT DONE：commit、push、PR、CI 与独立复核尚待执行。未使用真实客户数据，未声称客户验收、业务真实或经营效果。
