---
name: contract-template
description: 契约优先模板（铁律 47/48）——写新 compute 函数、bash 脚本或任何新模块前，先用本模板定义输入/输出/降级契约，再写实现。测试 red→green 三路径覆盖。
---

# contract-template — 契约优先（铁律 47/48）

## 使用时机
新增 compute 函数（`(store: GraphStoreReader, teamId: string) => ComputeResult`）、bash 脚本、模块接口。**先写契约，再写代码**（pre-commit 组 2 对新增 compute 无 JSDoc 硬阻断）。

## TypeScript compute 函数契约模板

```typescript
/**
 * computeCashFlowMetrics — 现金流哨兵指标
 * 契约:
 *   @input  — store: GraphStoreReader（L4 本体图读取器）, teamId: string
 *            沿 OWES 边找债务结构、沿 GENERATES 边找现金流入（图遍历思维，非 KV 读取）
 *   @output — { metrics: { operatingCashFlow, kzScore, ... }, computedAt: ISO }
 *   @degraded — 数据不完整（如缺 Financial 节点）→ degraded: true + 缺失字段清单
 *               （调用方据此降级展示，铁律 31 信号传播）
 *   @error  — CASH_FLOW_ERROR: .code + .phase='compute' + .retryable 布尔（铁律 32）
 *             抛错分类：数据缺失(retryable) vs 类型非法(不可重试)
 */
export function computeCashFlowMetrics(store: GraphStoreReader, teamId: string): ComputeResult {
  // 实现
}
```

## bash 脚本契约模板

```bash
# 契约:
#   @input  — [--check] 环境注入 SYNO_XXX_SRC/DST（测试用）
#   @output — 同步报告 + SYNC-OK 标记
#   @exit   — 0 = 成功/一致；1 = 业务阻断（漂移）；2 = 检查执行失败/降级（D328 三态）
#   @degraded — exit 2 + stderr "degraded: <原因>"（铁律 11 显式降级, 不静默）
#   @error  — .code + .phase + .retryable
```

## 测试契约（铁律 48，red→green）

每个契约至少三路径断言，测试先写：
1. **正常路径** — 合法输入 → 契约输出形状正确（有 expect() 断言，非空壳）
2. **降级路径** — 数据缺失/不可写 → degraded: true + 显式 log（铁律 24）
3. **边界条件** — 空输入/空源目录/漂移/多余项/幂等重跑

命名：`*.test.ts` 单元 / `*.integration.test.ts` 集成（cover 真实路由，不 mock 管线，铁律 12）/ `*.e2e.test.ts` E2E。bash 测试 `*.test.sh` 放 tests/control-tower/。

## 降级契约规则（铁律 11/24/31）

- catch 必有 log.warn/error（不能空吞）；返回 `degraded: true` 或错误 UI
- 区分 ENOENT（正常默认，不告警）与 JSON.parse 失败（告警 + degraded）
- 调用方必须检查 degraded 标记并传播/展示（降级信号传播链完整）

## 验证
```bash
grep -n "@input\|@output\|@degraded" <新文件>   # 契约三要素存在
bash scripts/check-silent-swallow.sh --diff      # 吞错门禁
vitest run --changed                              # 三路径测试全绿
```
