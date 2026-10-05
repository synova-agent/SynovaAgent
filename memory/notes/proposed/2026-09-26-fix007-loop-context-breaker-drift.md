# 决策 Note — FIX-007：熔断判据漂移修复（loop-context 只数真绕过 detected-bypass）

- 状态: proposed（待独立复核后 git mv 到 implemented/）
- 日期: 2026-09-26
- 卡: 台账 FIX-007（同类第 2 次 🔴）｜分支 `fix/fix007-loop-context-breaker`（base = `origin/main` @ `ef299746`）
- 决策: `scripts/workflow/loop-context.sh` 的 --no-verify 熔断计数**只数当日 `detected-bypass` 行**（与 `scripts/pre-commit-check.sh:242` 同口径）；陈旧/非绕过 marker（`COMMITTED`/`BLOCKED`）不参与熔断。

## 依据（可核）

- 修前代码：`loop-context.sh:88` `grep -c "$TODAY"`（数今日全部行）；基准：`pre-commit-check.sh:242` `grep -c "${TODAY}.*detected-bypass"`（V4.5.1 修正）。
- 沙箱实测（修前脚本）：3×`COMMITTED` → **EXIT=1 误熔断**；5×`COMMITTED`+2×真绕过 → **熔断 7 次**（把合法登记全算进去）。
- `bypass.log` 实测三形态：`detected-bypass …`（真绕过）/ `| COMMITTED | pre-commit PASS …` / `| BLOCKED | pre-commit FAIL …`。

## 关键设计决定

1. **以 pre-commit-check 为基准反向对齐**：漂移的是 loop-context 一侧，不动已正确的一侧（也避开 fix-coder-a 单写者文件）。
2. **陈旧 marker 显式不参与**：⒟（昨日 detected-bypass ×3）不熔断——与台账判据「陈旧 marker 判定」对应。
3. **滥用仍红**：⒝（3×真 `detected-bypass`）仍熔断；本卡不放松任何真绕过拦截。
4. **顺带修显示缺陷**：零命中时 `grep -c` exit 1 + `pipefail` ⇒ `|| echo 0` 追加第二个 0 → 输出 `00 次`；改 `|| true`（`grep -c` 自带的 0 即结果），数字行为不变。
5. **夹具可判别**：变异体把 pattern 还原为旧判据 → ⒜ 立即误熔断（证明断言非恒真）。

## 参考系

第一性原理（安全装置判据必须与被防行为一一对应）＋ Anthropic 工程基线（成对反例 + 变异体改坏即红）＋ 仓内先例（V4.5.1 同源双零修复；D524 熔断误伤）→ 结论：pattern 对齐 + 陈旧不参与 + 成对反例。

## 夹具（改坏即红，可复跑）

```
bash tests/control-tower/loop-context-breaker.test.sh     # 11 通过 / 0 失败
# 修前对照（同夹具 + git show <base>:… 副本）           # 6 通过 / 5 失败（⒜/⒞ 假红）
```

## blast radius

- 调用方：`loop-context.sh` 由 loop-score 存在性检查引用（`loop-score.sh:75`）；运行期由 hook/人工 `--check` 调用。改动只影响「--no-verify 计数」判据。
- 影响面：假红减少（合法登记不再熔断）；真绕过拦截不变（⒝ 仍红）。
