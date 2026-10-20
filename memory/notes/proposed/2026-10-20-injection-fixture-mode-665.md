---
状态: proposed
日期: 2026-10-20
决策: 夹具显式声明 SYNO_FIXTURE_MODE=1；D1193 fail-loud（#598）判据加 `&& [ "${SYNO_FIXTURE_MODE:-0}" != "1" ]`。真实 CI 无 base 仍必红。
理由: 注入夹具故意造出「SYNO_CI=1 ∧ GITHUB_ACTIONS=true ∧ 无 SYNO_DIFF_BASE」组合，与 #598 的 fail-loud 判据互相矛盾 ⇒ baseline 恒红 ⇒ 4 个变异场景全 not_red（判别力失效）。
---

# 决策 Note — #665 注入夹具 baseline 恒红

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：夹具的模拟环境（SYNO_CI=1 ∧ GITHUB_ACTIONS=true ∧ 无 base）被 #598 的 D1193 fail-loud 判为必红 ⇒ baseline 恒红 ⇒ 4 场景 not_red（红着的假夹具）。
2. **现状证据**：本机实测 EXIT=1 / `baseline=FAIL` / 首个 ❌ = `D1193 … CI 无 base（fail-closed，禁空跑）`；5f649cf8b 与 ca2e30005 完全一致（存量）。
3. **有没有现成**：无"夹具模式"概念；D1193 判据是 #598 新增（我写的）⇒ 加显式标记是本卡最小改法（方案 A，CTO 倾向）。
4. **最小改动**：判据加一个 `&& [ "${SYNO_FIXTURE_MODE:-0}" != "1" ]`；夹具 4 处调用加 `SYNO_FIXTURE_MODE=1`；另加判别力探针。
5. **最危险假设**：有人把 `SYNO_FIXTURE_MODE=1` 抄到真实 CI ⇒ 关掉 fail-loud。防线：夹具探针（摘标记 ⇒ not_red=4；真实 CI 无 base ⇒ 仍 exit 1）＋ Note 明写"只许夹具用"。
6. **失败路径**：摘标记 ⇒ 重现 D1193 红 ⇒ 夹具红（证明标记承重）；真实 CI 无 base（无标记）⇒ 仍 exit 1（#598 不回退）。
7. **边界**：只影响 D1193 的 fail-loud 一行；其余 12 组与 #598 其它判据零改动；三态不变。
8. **可观测**：汇总行新增 `fixture_mode=OK d1193_regression=OK no_marker_notred=4`；每个探针打印原始 rc 与命中行。
9. **拆步**：① 判据标记 ② 夹具 4 处调用 ③ 探针（② 双模式基线 / ④⑤ 摘标记 not_red=4）④ 回归（夹具 EXIT=0 red_confirmed=4）。

## 决定
- 方案 A：`SYNO_FIXTURE_MODE=1` 显式标记（不靠 GITHUB_ACTIONS 猜）。
- 夹具新增：设 SYNO_DIFF_BASE 的基线对照（判据②）；摘标记 4 场景 not_red=4（判据⑤）；有标记不再报 D1193（判据④ 反向）。
- ❌ 不放宽 D1193 本身；真实 CI 无 base 仍 fail-loud。

## 依据
- 卡 #665（根因定位到行＋判据＋改坏必红）；#598 的 fail-loud（禁空跑）。
- 实测：夹具 EXIT=0 / red_confirmed=4 / not_red=0；摘标记重现 not_red=4。

## 影响面
- 只动 `pre-commit-check.sh` 一行判据 + 夹具；CI 无需传标记（标记只属夹具）。
