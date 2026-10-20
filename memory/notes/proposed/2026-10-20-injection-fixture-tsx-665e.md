---
状态: proposed
日期: 2026-10-20
决策: gate-integrity job 显式装 tsx（npm install --no-save tsx@4.23.13）＋ timeout 2→10；夹具 _run_gate_env 注入 SYNO_TSX=<workspace>/node_modules/.bin/tsx。克隆仍 hermetic（不装依赖）。
理由: CI 日志实证——夹具跑完整 pre-commit 时组 13（块级 paths 快照对账）需要 tsx；GitHub 的 gate-integrity job 无依赖安装步骤、克隆里无 node_modules ⇒ 组 13 fail-closed exit 2 ⇒ baseline 恒红（annotation：❌ 门禁判不了（exit 2）：找不到 tsx）。
---

# 决策 Note — #665e 夹具 tsx 依赖（CI 真红根因）

## 现状（CI 日志实证，非推测）
```
❌ 门禁判不了（exit 2）：找不到 tsx（试过 $SYNO_TSX / <clone>/node_modules/.bin/tsx / PATH / 上溯 5 级）
❌ 块级 paths 快照对账（fail-closed）: 1 处
baseline=FAIL decl_gates=1（D1148 合并探针同因）
```
⇒ 夹具的克隆（git clone）没有 node_modules；GitHub 的 gate-integrity job 无依赖安装步骤 ⇒ `tsx` 不可得。本地 `/Users/wane/SynovaAgent/node_modules` 存在，故本地绿、CI 红。

## 决定
1. `.github/workflows/ci.yml` gate-integrity job：夹具 step 前加 `npm install --no-save --no-audit --no-fund tsx@4.23.13`（只装 tsx，不装全量）；`timeout-minutes: 2 → 10`（基线注释同步）。docs-only 时同样跳过。
2. 夹具 `_run_gate_env`：`SYNO_TSX=$REPO_DIR/node_modules/.bin/tsx`（门禁自带注入缝）——克隆保持 hermetic。

## 依据
- CI run 39398215672 job 118546120735 日志（带 token 的 `gh api .../logs --allow-escape-sequences` 可读）。
- ⑦ 的 annotations 把 ❌ 行送到了 check-runs（判据⑦ 在 GitHub 上成立）。

## 影响面
- ci.yml（1 step ＋ timeout）＋夹具（1 处 env）；不改任何门禁判据；⑥/⑦/⑧ 零改动。
