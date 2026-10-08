# Task Brief: #1419 —— 第 5 形态「告警分支吞指标」修复（value-capture）

> 卡: **#1419**（K3 · W1-时序 · p1）｜CTO 2026-10-08 裁：第 5 形态升格 + 修复 + **两态判据**
> 声明载体: `.claude/claims/1419.yaml`（S0）+ 本 brief

#CRITERIA: A

## Q0: 定位 — 项目拼图 + 文件审计
### a) 项目拼图
产出面（W1 的上游）：告警发了、**指标行丢了** ⇒ 标定最需要的"异常/低值"样本**恰好不落盘**。

### b) 文件审计（实跑，ref=origin/main@02701bec2）
- `extensions/sentinels/value-capture/aggregate.ts:38-40`：
  · `<0.2` ⇒ **裸数组返回**（metrics 丢）
  · `<0.4` ⇒ **裸数组返回**（metrics 丢）**← 本次命中（0.29）**
  · 其它 ⇒ `{ findings: [], metrics: metricsHolder }`（**唯一带 metrics 的分支**）
- loader `src/sentinel/sentinel-loader.ts:306-309`：`Array.isArray(raw) ? [] : raw?.metrics` ⇒ **裸数组 ⇒ metrics 恒空**
- 两态横扫：**1/13**（仅本哨兵两态 0 行；其余 12 个告警态仍有行 ⇒ 正面核查）

### c) 决策
两分支（含 catch）统一为**对象形态并带 `metricsHolder`**；判据立 **两态判据**（含**同数**断言）。

## Q1: 调研 — 业界最佳实践 / Anthropic 决策链 / memory 历史教训
- **扫"形态" ≠ 扫"分支"**（B3b 的盲区）｜**特殊/异常样本对标定更值钱**（产出面方向）
- **普遍性要给分母**（CTO 新规）：我从 1 个观测推广 ⇒ 已更正为 **1/13**
- **改完要能区分"我改坏的"与"本来就坏的"**（R143）：三条独立证据排除 #1408 落库侧闸

## Q2: 范围 — 正确的最简方案
做什么（逐文件一行）：
- extensions/sentinels/value-capture/aggregate.ts — `<0.2`/`<0.4`/catch 三分支统一为对象 + `metrics: metricsHolder`
- tests/sentinels/value-capture.test.ts — **两态判据**（正常态 ≥1｜告警态 ≥1 且 finding 在｜**两态同数**）
- .claude/claims/1419.yaml + .claude/task-briefs/2026-10-08-1419-alert-branch-metrics.md

不做什么（逐条含具体文件名）：
- 不改 extensions/sentinels/capital-health/aggregate.ts（其"缺字段组 ⇒ 拒绝"守卫**正确**，属夹具不全）
- 不改 extensions/sentinels/margin-health/aggregate.ts（两态横扫 5/5 ✓）
- 不改 extensions/sentinels/growth-quality/aggregate.ts（两态横扫 2/2 ✓）
- 不改 src/sentinel/sentinel-loader.ts（loader 语义正确：裸数组 ⇒ 无 metrics 是**约定**）
- 不改 src/sentinel/metric-readings-writer.ts（落库侧闸已合；本缺陷与它无关，已实测排除）
- 不改 tests/sentinels/make-or-buy.test.ts（#1408 C2b 已补）

范围外约束（非文件级）：(a) capital-health 的夹具不全｜(b) `skills.split`（另立 #1421）。

## Q3: 验收 — 入口 → 交互 → 结果
入口：`sentinel-value-capture.check(...)`（正常态 / 告警态两种输入）。
处理：告警分支也返回 `metrics` ⇒ loader 落盘。
结果：**两态都有指标行**（且行数相同），告警态 finding 仍在。

## Q4 契约与测试:
- 契约：哨兵 return **对象形态**（`{findings, metrics}`）⇒ 裸数组 = 无指标（loader 约定）
- 测试：两态判据 ×3（正常态 ≥1｜告警态 ≥1 + finding｜**两态同数**）
- 反例：只把 `<0.4` 改回裸数组 ⇒ **告警态红 + 同数红**（正常态绿）= 干净判别
- 零 `as any` / `as never` / `as unknown as`

## 架构层: 扩展哨兵 aggregate + 其夹具

## Done 标准
- [ ] verify: npx vitest run tests/sentinels/value-capture.test.ts
- [ ] verify: npx vitest run tests/sentinels/ tests/sentinel/ tests/l4/ tests/agent/ tests/adapters/
- [ ] verify: bash -c 'grep -c "metrics: metricsHolder" extensions/sentinels/value-capture/aggregate.ts'
- [ ] verify: npx tsc --noEmit
