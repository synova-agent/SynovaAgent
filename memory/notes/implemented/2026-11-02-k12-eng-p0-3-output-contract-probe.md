# K12-ENG P0-3：输出契约探针改靶（#506 修法）

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #189（K12-06）／#506
- **决策**: 探针 `probe-output-contract.ts` 的 V2/V6 **改为穿真生产入口并读它自己写的失败落账**；
  V3（KPI 口径）改为**契约声明核验**（产品无公开 by-id 入口，`validateOutputContract` 硬编码 one-pager）。
- **理由**:
  1. 旧实现只认数组形态 `required`，4 份契约全用布尔 `required: true` ⇒ `requiredKeys` 恒空 ⇒ 假红（不是产品缺陷）。
  2. 旧实现驱动 `validateOutputContract`（`@output void`、永不抛）并以"返回值/抛出"判"被拒" ⇒ 与 14 项批准的
     **记录不阻断**语义冲突；真判别证据在失败落账（`ValidateOptions.sinkPath` 可注入临时落点）。
  3. DSH rc.5 纪律："每条验收路径能拒绝非法输入"、"机器可判的不变式接进已执行门禁"。
- **证据**（`.synova-wt-k12-1101`/`/tmp/w-k12-p03` 实跑）:
  - `npx tsx scripts/control-tower/probe-output-contract.ts --all` ⇒ 退出码=0（COVERAGE PASS=11）
  - 反例：注入 `PROBE_SHORTCIRCUIT=1` 让 `validateOutputContract` 直接 return ⇒ V2/V6 FAIL、退出码=1
  - `probe-ladder --all` ⇒ `pass=9 fail=2 notimpl=2`（本探针由 FAIL 转 PASS）
- **回滚**: 还原 `scripts/control-tower/probe-output-contract.ts` 单文件（无产品改动、无 schema 变更）。
- **边界**: V3 为 L1 声明核验（弱于驱校验器）；若 CTO 要求 L2，需产品导出 by-id 入口（另裁）。
