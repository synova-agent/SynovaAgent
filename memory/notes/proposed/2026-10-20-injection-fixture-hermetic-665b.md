---
状态: proposed
日期: 2026-10-20
决策: 注入夹具的子进程一律 env -i 白名单（PATH/HOME/LANG/TMPDIR + GITHUB_ACTIONS/SYNO_CI/SYNO_FIXTURE_MODE），不继承外层 CI 环境；新增判据⑥（外层带 CI 环境跑本夹具结果必须与干净环境逐字一致）。
理由: 同一个夹具"脱外层绿、带外层红"= 不可复现——外层 CI 变量（CI/GITHUB_EVENT_NAME/GITHUB_* 300+ 消费点）会让门禁某些组走 strict 分支 ⇒ 在干净副本上失败。
---

# 决策 Note — #665b 注入夹具 hermetic

## 九问（pre-plan-thinking，逐问有证据）

1. **问题**：夹具继承外层环境；外层带 `GITHUB_ACTIONS=true SYNO_CI=1 CI=true GITHUB_EVENT_NAME=push` 时 baseline 红（D782 D2 登记门禁／D734 PR 预算／as any／新文件配对）⇒ 同夹具两种结果。
2. **现状证据**：CTO 复现（外层 CI ⇒ EXIT=1 + BASELINE_FAIL）；本机干净环境 EXIT=0（原样）。
3. **有没有现成**：`env -u`（黑名单）思路在 #665 的判据里用过；黑名单列不全（GITHUB_* 300+ 消费点）⇒ 改白名单 `env -i`。
4. **最小改动**：夹具加 `_run_gate_env` helper（env -i 白名单），6 处调用统一走它；不动 gate 判据。
5. **最危险假设**：白名单漏了门禁真正需要的变量（如 SYNO_DIFF_BASE）⇒ 已在 helper 调用处显式追加；PASS 证据＝干净/CI 两环境逐字一致。
6. **失败路径**：漏 env -i ⇒ 外层 CI 重现 EXIT=1（M1 实测）；漏 marker ⇒ NOT_RED（M2 实测）；漏 SYNO_CI ⇒ 各场景软提示不转硬 + ⑤ 探针失效（M3 实测 red_confirmed=3 not_red=1）。
7. **边界**：只改夹具运行方式，不动 `pre-commit-check.sh` 任何判据；D1193/#598 不回退。
8. **可观测**：判据⑥ 两环境 GATE_INJECTION_SUMMARY 逐字相同；三个 mutation 的原始输出入 PR。
9. **拆步**：① helper ② 6 处调用 ③ 干净/CI 双跑对比 ④ M1/M2/M3 反例 ⑤ 回归（摘标记仍 not_red=4）。

## 决定
- `_run_gate_env`：`env -i PATH HOME LANG TMPDIR + "$@"`（门禁三件套由调用处显式给）。
- 判据⑥：`GITHUB_ACTIONS=true SYNO_CI=1 CI=true GITHUB_EVENT_NAME=push bash 夹具` ⇒ 与干净环境**逐字一致**（EXIT=0/red_confirmed=4/not_red=0/baseline=ok）。

## 依据
- 卡 #665b（行号 483 定位 + 判据⑥ + 改坏必红）。
- 实测：clean vs CI 两行 summary 逐字相同；M1/M2/M3 原始输出见 PR。

## 影响面
- 只动夹具（1 文件）＋豁免/DOC/Note/brief；门禁判据零改动。
