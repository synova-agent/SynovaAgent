# K12-ENG P1-1 整改：梯子 CI 块回填 fail-closed（K3 终审 P1-1）

- **状态**: implemented（2026-11-02）
- **任务**: #1271（#1279）；审计：K3 终审 P1-1
- **问题**：`pre-commit-check.sh` 的 K12-21 CI-only 块在梯子子进程非零退出、输出无 `❌`/`RESULT=` 时
  （npx 缺失/崩溃栈/OOM），`hard_check` 收到空证据集 ⇒ count=0 ⇒ **绿**；与该块自注"禁把判不了当通过"相悖。
- **修法**：`LADDER_EXIT≠0` **无条件判红**；且 `exit=0` 但无 `RESULT=` 证据行同样判红。证据行仅作展示，
  不再参与"是否违规"的判定（消除"零证据=零违规"）。
- **证据**：无 node 环境（PATH 摘除 npx）跑 CI-strict pre-commit ⇒ 本块输出
  `exit=127；证据行: （无 ❌/RESULT= 输出——fail-closed）` 并计入 HARD_FAIL（修前为 RC=0 绿灯）。
- **回滚**：还原该块（单 hunk）。
