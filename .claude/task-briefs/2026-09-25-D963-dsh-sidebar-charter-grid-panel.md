# Task Brief — D963 DSH 侧边栏面板「宪章三问 48 格」

## Q0: 定位 — 项目拼图 + 文件审计
本任务在**工具面**（DSH 插件），不改 src/** 产品代码。触发：创始人 2026-09-25 指令「发卡」。
文件审计：已有 dsh/plugins/synova-dashboards（client panel 骨架 + test/client-panel.test.js）；
机读源 docs/synova/coordination/宪章三问-48格.json（48 格，CTO 已落）；生成器 scripts/control-tower/gen-charter-grid.py（已落）。

## Q1: 调研 — 决策参考系
参考：院方《01-可扩展架构的定义与约束》约束 2（三问）+ 约束 4（内核/扩展边界物理可见）+ DSH 第一性原理。
结论：**判据必须穿生产入口**（宪章 :149）；**本项自身即三问的第一个真实用例**。

## Q2: 范围 — 做什么 / 不做什么
做什么：
- 读 dsh/plugins/synova-dashboards 现状；核/修死声明（dsh-client-runtime 注入）
- 读 packages/extensions/cordis-client-runner/src/client/slot-catalog.ts 定 slot 名（给 file:line，不猜）
- 加 client panel：读 宪章三问-48格.json → 渲染 16 行 × 3 列 + 四色 + 空格显式为待办
- 按三问交付 + 改坏即红 + 降级三态
不做什么：
- 不改 src/**（win 产品代码，另卡）；不改 scripts/audit/**；不改 docs/synova/coordination/ownership.yaml
- **不铺开填 48 格**（一次只做本项）

## Q3: 验收 — 入口 → 交互 → 结果
入口：桌面端左侧边栏新增条目
处理：点击 → 面板拉取 宪章三问-48格.json → 渲染矩阵
结果：**16 行 × 3 列、四色、每格可看判据；空格显示为待办（非绿）**

## 架构层
工具/插件层（dsh/plugins/**）；不触五层产品依赖图

## Done 标准
- [ ] ① 加了吗：panel + slot 注册项存在（给路径）
- [ ] ② 接上了吗：注册被宿主消费（给 file:line）
- [ ] ③ 生效了吗：**桌面上点开侧边栏真看到矩阵**（截图/录屏 + 时间戳）
- [ ] 改坏即红：删 slot 注册 → 面板消失（原始输出/截图）
- [ ] 降级显式：版本不足/未装/slot 不存在 → degraded，不静默
- [ ] 死声明已核/修（给证据）
