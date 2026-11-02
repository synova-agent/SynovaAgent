# K12-ENG P1-3：K12 测量梯子入 CI

- **状态**: implemented（2026-11-02）
- **任务**: #1271（K12-ENG）· 关联 #205（K12-21）
- **决策**: 在 `scripts/pre-commit-check.sh` 末尾增加 **CI-only** 块（`SYNO_CI=1 ∧ GITHUB_ACTIONS=true`），
  跑 `probe-ladder.ts --all`；本地不跑（不占 D515 fast 预算）。exit 0 = 测量件健康（末行如实披露计数）；
  exit 1/2 = 红（fail-closed）。优先 `timeout/gtimeout`，两者皆缺则显式披露并以 CI job 超时兜底。
- **理由**: 14 项批准 item 8；DSH rc.5 "wire mechanically checkable invariants into an executed top-level gate"——
  此前梯子零调用点（`git grep probe-ladder -- scripts/pre-commit-check.sh .gitea` = 0），全靠人跑。
- **证据**:
  - `bash -n scripts/pre-commit-check.sh` 通过
  - `SYNO_CI=1 GITHUB_ACTIONS=true bash scripts/pre-commit-check.sh` ⇒ 梯子块执行并输出 `RESULT=` 行
  - 直跑 `probe-ladder --all` ⇒ exit 0（末行 `RESULT=DEGRADED probes=13 pass=9 fail=2 notimpl=2`，如实披露）
- **回滚**: 删除该 CI-only 块（单点、无判据语义改动）。
- **边界**: 不改 ladder 判据/探针；不改 CI workflow；块仅 CI 生效。
