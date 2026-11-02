# K12-ENG P2-2a：config-pack-generator 保留 permissionGrants（#195 P0）

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #195（K12-12）／14 项批准 item 3
- **决策**: 生成器重写 `capabilities.yaml` 时，从既有文件**逐字**摘出顶层 `permissionGrants:` 块并保留，
  其余仍按 seed 重生成；读取既有文件失败（非 ENOENT）⇒ `log.warn` 且本次不保留（degraded，不静默）。
- **理由**: 生成器只渲染 seed 的 `capabilities[]`，会把客户已配的 `permissionGrants`（K12-11 项模型）
  整块抹掉（卡面实测 1384B→136B）⇒ K12-12 V6「与建档联通」不可达。
- **证据**:
  - 先红后绿：加用例 `P0-2-2 重生成同一角色 ⇒ 保留既有 permissionGrants` ⇒ 修前 `1 failed | 27 passed`；
    修后 **28 passed**。
  - 反例 = 同一用例（修前必红）。
- **回滚**: 还原 `src/onboarding/config-pack-generator.ts`＋测试（单文件级）。
- **边界**: 只保留客户矩阵段；不改 seed schema、不改六件渲染形状、不解析/改写 grants 内部结构。
