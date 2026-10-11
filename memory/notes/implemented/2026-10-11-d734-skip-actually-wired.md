---
状态: implemented
日期: 2026-10-11
决策: 真正接上 D734 的 SYNO_SKIP_PR_BUDGET 跳过开关（修复"开关形同虚设"）
理由: |
  事故（我造成）：全线 CI 红。执行方判为"基础设施（runner=0）"—— 实测判因不同：
  ① job 确实跑到了 runner（runner=mac-host-runner，5 步执行）⇒ CI 没宕机
  ② 真因 = D734 PR 预算：变更集 vs origin/main（GitHub 旧 main）= 100 件增/改 · 115 件白名单外
  ③ 而 PR #214/#216 声称"本地 CI 跳过 D734"—— 实测只在 workflow 里设了 SYNO_SKIP_PR_BUDGET=1，
     但 pre-commit-check.sh 从未读这个变量 ⇒ 开关形同虚设（当时那步报的是"未改（锚点未找到）"，我没追到底）
  ⇒ 教训：我改了 ≠ 改对了 ≠ 生效了（三件事）——本轮第三次同型错
---

# 修法
在 `scripts/pre-commit-check.sh` 的 D734 真实调用点外包一层 `SYNO_SKIP_PR_BUDGET` 判断；头尾双向闭合已核；跳过时显式打印。

# 为什么本地 CI 该跳过 D734
D734 是"PR 预算"——对着 PR 的 base 判才有意义。本地 CI 基线是 GitHub 旧 main，拿"集成分支账本总额"判必然恒红。

# 相关
前序（未生效）：PR #214 / #216 ｜ 影响面：全线阻塞
