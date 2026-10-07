# Part A：插件契约 DSH 源码核 入库

- **状态**: proposed
- **日期**: 2026-09-30
- **内容**: 研究院按 `0.2.0-rc.1`（`-020` @ `4878cdabd8`）实读源码，核完两个 gap
  （⑤ cordis 接口：三形状 + Base 元数据 + `apply(ctx,config)`，无 definePlugin；
   ⑧ fiber 生命周期：**epoch 依赖指纹** + inject 是持续契约 + 失败只落本地 `_error`），
  并发现 ⑥ **base patch 无"硬不可卸载"行**，真强制力在 `requiredStartupEntryIds`（`index.ts:746-754`）。
- **CTO 抽验**：版本/行数（fiber.ts 754）/文件（vendor/cordis 4.0.4）/行号（:746）**全部坐实**。
