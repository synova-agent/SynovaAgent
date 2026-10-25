# #1000 四处假绿/静默放行修复（复核 P1 批）

1. `check-quality-delta.py`：G5 未武装 ⇒ 不打 `✅ G5`、末行 `rules` 不含 G5（裁 415-③ 执行侧）。
2. `triviality-manifest.yaml`：legacy_baseline 469 → 470（执行器实测 470 ⇒ 原 baseline live red）。
3. `pre-dispatch-check.sh`：PR 查询失败（网络/401/非法 JSON）⇒ 记 FIND，不再"✅ 机械项全通过"。
4. `pre-dispatch-check.test.sh`：`D[0-9]{3}` → `{3,4}`；PH 取不到时回退 AGENTS.md（原依赖已不存在的计划文件）。

## 两态
- G5 未武装：`ℹ️ G5 未武装` + `rules=G1,G3,G4`，无 `✅ G5`（测试 94/0）。
- G5 武装：照常 `rules=…G5`。
- pre-dispatch：假 token ⇒ FIND=1、exit 1；正常 ⇒ 原行为。
