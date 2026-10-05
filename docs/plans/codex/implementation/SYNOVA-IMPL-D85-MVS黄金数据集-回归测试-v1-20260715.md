# SynovaAgent — D85 MVS黄金数据集+回归测试 实施方案 v1.0

> 2026-07-15 | 第14份权威文档（系统集成与实施路线图）第四章
> 执行标准: Anthropic 工程纪律 · 铁律 0-2 (spec→test→impl→wire) · 五层架构 · 垂直切片
> **此文档为 claude code 的唯一执行依据。不依赖任何其他文档或口头记忆。**

---

## 执行约束（每次提交前必须回答的 5 问）

```
1. 接线检查: 新 export 谁调用？（grep 确认调用方存在）
2. 异常处理: 每个 catch 有 log + degraded？（铁律 24+31）
3. 类型安全: as any = 0？（铁律 38）
4. 测试覆盖: 测试有 expect() 断言？（铁律 48）
5. 残留清理: 有死代码吗？旧文件删了？旧函数还有引用？
```

---

## 当前状态（2026-07-15 审计确认）

- D51: CI/CD黄金案例F1门禁 ✅（5个fixture + checker）
- 黄金数据集: **零存在** — `data/golden/` 目录不存在
- 回归测试脚本: **零存在**
- 权威文档14第四章完整定义了MVS能力清单（17边/16哨兵/3专家/20compute/10Skill/3Playbook/5链）+ 6项功能验收 + 黄金数据集版本锁定

---

## 做了什么

### 1. data/golden/client-a-v1.json — 客户A黄金数据集（新建）

权威文档14 §4.3.1 完整定义。冻结静态快照:
```json
{
  "datasetVersion": "client-a-v1",
  "enterprise": {
    "name": "客户A",
    "industry": "母婴零售",
    "scale": "营收800万/年，25人团队"
  },
  "financial": {
    "revenue": [/* 12个月月度数据 */],
    "cost": [/* 12个月月度数据 */],
    "fixedCostRatio": 0.72,
    "profitMargin": 0.05,
    "cashRunwayMonths": 18
  },
  "client": {
    "churnRate": 0.15,
    "storeTrafficDecline": 0.40,
    "brandSearchVolumeDecline": 0.60
  },
  "personnel": {
    "coreEngineersLost": 3
  }
}
```

### 2. scripts/workflow/check-golden-regression.sh — 黄金回归测试脚本（新建）

权威文档14 §4.3.4 完整定义。5步流程:
```bash
# Step 1: 加载黄金数据 → POST /api/data/load
# Step 2: 哨兵扫描 → POST /api/sentinel/scan-all
# Step 3: 采集输出 → sentinelFindings/causalChainTraces/diagnosisReport/coreAggregates
# Step 4: SHA-256 checksum对比 → 与 data/golden/checksums/client-a-v1-checksums.json
# Step 5: 生成回归报告 → 标注变化是预期内修复还是非预期退化
```

### 3. data/golden/checksums/client-a-v1-checksums.json — Checksum基准（新建）

首次MVS运行后记录4项checksum:
- sentinelFindings SHA-256
- causalChainTraces SHA-256
- enterpriseDiagnosisReport SHA-256
- coreAggregates SHA-256

### 4. 6项MVS功能验收

权威文档14 §4.2.1:
1. 数据加载完成 — Phase 0-5全部通过，/api/health返回200
2. 哨兵扫描完成 — 16个P0哨兵全部产生Finding
3. 因果链追溯 — cc-capital-03完整4步Trace
4. 因果链模拟 — E-23 fixed_cost_ratio扰动→profit_margin变化
5. 因果链反查 — "利润下降"→归因分析→贡献度排序
6. 增长导航 — Goal注册→方案哨兵→偏离检测

---

## 不做什么

- 不修改现有哨兵compute（MVS只是验证现有能力）
- 不创建新的数据采集管线（使用静态JSON快照）
- 不实现自动化MVS CI job（D85只做基础数据集+手动回归脚本）

---

## 架构层

L5（存储层: `data/golden/`）+ CI基础设施（`scripts/workflow/check-golden-regression.sh`）

---

## 实施优先级

| 顺序 | 步骤 | 工时 | 文件 |
|:---:|-------|:---:|------|
| 1 | client-a-v1.json | 2h | data/golden/client-a-v1.json |
| 2 | checksum基准记录 | 0.5h | checksums/client-a-v1-checksums.json |
| 3 | check-golden-regression.sh | 2h | scripts/workflow/check-golden-regression.sh |

**总工时: 4.5h（半天）**

---

## 完成标准

```
[ ] data/golden/client-a-v1.json: 完整JSON快照，含Financial/CLIENT/PERSONNEL/ExternalBaseline数据
[ ] data/golden/client-a-v1.json: 文件头含"DO NOT MODIFY — frozen snapshot"注释
[ ] 6项MVS功能验收全部可通过（基于此数据集）
[ ] check-golden-regression.sh: 5步流程全部可独立执行
[ ] check-golden-regression.sh: SHA-256 checksum对比+预期内/非预期退化标注
[ ] checksums/client-a-v1-checksums.json: 4项checksum全部记录
[ ] zero as any（bash脚本+JSON数据，不适用）
```

---

## 权威文档引用

- 第14份权威文档: 系统集成与实施路线图 第四章（MVS与黄金数据集）
  - §4.1: MVS能力清单（17边/16哨兵/3专家/20compute/10Skill/3Playbook/5链）
  - §4.2: 6项功能验收
  - §4.3: 黄金数据集版本锁定 + 变更溯源机制
  - §4.3.4: 回归测试脚本 check-golden-regression.sh