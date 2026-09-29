# D1001 落表 — 渲染层测试归属改判 mac

- **状态**: proposed
- **日期**: 2026-09-29
- **决策**: `ownership.yaml` 加两条规则：`tests/electron/**` → mac ｜ `tests/ga-collab-*.test.ts` → mac；重生成 CODEOWNERS。
- **理由**: D1001 建议件（RV-1 已放行）实测这些测试 import `electron-renderer/src/**`（渲染层 = mac 域），
  此前落 `**` 兜底误判 win，与"测试随被测对象归属"惯例（tests/control-tower 先例）不符。
  注：域已不用于分配/阻断（创始人 2026-09-29 决策），本表仅用于 CODEOWNERS 与域信息显示。
