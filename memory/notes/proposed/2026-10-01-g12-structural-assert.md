# g12 夹具场景补结构性断言（存量红根治）

- **状态**: proposed
- **日期**: 2026-10-01
- **背景**: `tests/control-tower/precommit-groups-injection.test.sh` 的 g12 场景长期 `NOT_RED`
  （`GATE_INJECTION_SUMMARY: not_red=1`），导致 **`Gate Integrity` job 在 main 原状即红** ⇒
  **阻断多个 PR**（#884 / #901 / #910 实测同源）。
- **根因**: 组 12（Task Scope 一致性）在 **`ALL_TODAY_BRIEFS` 为空时整段跳过 soft_pass（fail-open）**
  —— 见 `scripts/pre-commit-check.sh` 组 12 注释（D506 修正自述）。夹具 g12 场景**只注入
  `scripts/m9-fixture-g12.sh`、未注入"今日 brief"** ⇒ 触发 fail-open ⇒ 不产生 ❌。
- **决定**: 补 `assert_g12_structural()`（夹具**既有机制**，g7/g9/g10 已用），
  以**物理探针**证明结构性理由：① 组 12 标签在源码 ② fail-open 分支在源码 ③ clone 内今日 brief 数 = 0。
  ⇒ 判定由 `NOT_RED` 升为 **`STRUCTURAL_NOT_RED`**（夹具通过，且如实标注"属门禁自身缺陷"）。
- **考虑过的其他方案**:
  1. **修组 12 消除 fail-open**（无 brief 也报红）⇒ 否决：D506 明确这是**避免误报**的有意设计
     （跨午夜/并发 session 场景），改它会把正常提交拦死。
  2. **把 g12 从夹具场景移除** ⇒ 否决：**掩盖**问题，且失去"组 12 存在但不可达"这一事实的记录。
  3. **在 KNOWN_STALE 里豁免整个夹具** ⇒ 否决：会连带豁免 g1/g2/g7 等**真实有效**的场景。
- **后果**: `Gate Integrity` 转绿；**组 12 的 fail-open 缺陷仍需修**（夹具 detail 自述"需 CTO 另行派工"）
  ⇒ 已记入待办，与本修复分离。
- **取代**: 无（新增断言）
