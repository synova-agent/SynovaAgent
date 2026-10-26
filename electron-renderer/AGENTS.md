# AGENTS.md · electron-renderer/（L1 呈现层）

> 归属：产品线 P1 ｜ as_of `8b62b400e`

## 是什么
右栏「测量值＋趋势」出口面：`src/lib/measurement-trends.ts`（真 fetch loader）｜`MeasurementTrendSection`（纯展示）｜`MeasurementTrendContainer`（取数容器）｜`RightPanel`（唯一装配点）｜`src/test-support/render.ts`（渲染桥）。

## 谁改
产品线 P1。验收件在 `tests/acceptance/**`；**产品代码不得 import `tests/acceptance/**`（含 expected 模块）**。

## 怎么算完成（机器可判）
- `npx vitest run tests/acceptance/mvp1-m4-output-face.test.ts` → 35 passed
- `npx vitest run tests/acceptance/mvp1-m3-domain-chain.test.ts` → 7 passed
- `npx tsc -p electron-renderer/tsconfig.json` → exit 0
- `git grep -c "Date.now()" HEAD -- tests/acceptance/mvp1-m4-output-face.test.ts` → 0；注入缝 `tests/acceptance/support/clock.ts` 代码落点 1 处 ＋ 1 行注释提及（实测 `git grep -c` 计 2 行）

## 红线
- UI 只呈现不判断（宪章 §4.4/§4.5）；**不得宣称「流式/链路追踪」**（T2-3 归 #867；electron-renderer 内 trace-context import = 0）
- 未选客户**零请求**，不展示跨客户聚合数
- cost≡0 语义版本 `cost0-v1`（#1050 落地后重钉 0.5/0.6）

## 已知限制
- A8 生产侧落点 **deferred**：`shouldLoadTrends` 仅 `tests/acceptance/m4-output-face.expected.ts` 的参照实现；生产守卫＝Container 早退＋源码断言，**不得表述为「已抽成生产纯函数」**
- **不用整树快照的理由**：render 桥自产 HTML、DOM 顺序属装配细节，快照会把重构噪声当回归 ⇒ 用 `EXP_*` 具名常量
- tabs 条位于 `RightPanel` body 的 `ws_ga` 分支（不在 `GAWorkspaceTabs` 内）
- `selectedCap` 能力详情态不显示测量值
- 渲染桥不执行 hook ⇒ 容器/面板只做源码断言，不证像素/交互

## 改本域涉及的包（双向清单）
P1｜👁 只读知会：#867（T2-3）、#1050（gross_margin）
