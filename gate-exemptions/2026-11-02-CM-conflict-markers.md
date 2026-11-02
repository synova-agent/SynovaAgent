# review: #1287
<!-- 任务: "#1287" -->
# 豁免说明：冲突标记机检（把「严格冲突标记 0」从人规变成机检）。
# 依据：2026-11-02 实证——两个带 `<<<<<<<` 的 forward-merge 提交（2d70f7e2b / b0edc5c92）
# 进 main 后 CI 两条腿均判 success ⇒ 全仓无一处判据在看它。创始人 2026-11-02 批准新增门禁（A 类）。
- scripts/control-tower/check-conflict-markers.sh — 新增冲突标记机检（四形态＋扩展名白名单＋三态＋降级） — #1287
- tests/control-tower/check-conflict-markers.test.sh — 配对测试 20 例，含改坏必红 — #1287
- scripts/pre-commit-check.sh — 组 1 追加硬阻断调用（判据：命中即拒提交） — #1287
- docs/authority/GATE-INVENTORY.yaml — 三处入册（classification P1／run_by pre-commit quota／gate_meta --regen） — #1287
- docs/authority/DOCS-REGISTRY.yaml — 补 DOC 登记行 — #1287
- docs/authority/WIRING-REGISTRY.yaml — 补 capability 接线登记（consumer=pre-commit 组 1） — #1287
- gate-exemptions/2026-11-02-CM-conflict-markers.md — 本豁免件自身属受保护目录变更故随批自覆盖 — #1287
