# Task Brief — #1358: 清理陈旧认领（任务已合并但 status 仍挂 claimed）

## Q0: 定位
- 治理面（簿记）：`task-state/*.json`。本卡只把**已有物理证据证明已合并**的条目的 `status` 从 `claimed` 改为终态。
- **不动代码、不动门禁**：零 `src/**`、零 `scripts/**` 改动（除本卡自己的 brief 与 claim 声明载体）。

## Q1: 调研
- **病根（CTO 2026-10-08 派单）**：`task-state/D1200.json` 仍 `claimed`（D1200 = PR #1254 **早已 MERGED**，K3 终审 9dd2b89d6），其 brief Q2 声明了同一文件 ⇒ #1052 首次提交被 **D328 认领对账误判为「并行劫持」**（制度面缺口：过期 claim 持续误伤后续任何人）。
- **判定口径 = 只认物理证据**：① 该任务 PR `state=MERGED` 且 `git merge-base --is-ancestor <mergeCommit> origin/main` ⇒ rc=0；② 该任务 `main` 提交（Conventional scope=任务号）在 `origin/main`。**判不了的一律不动**（59 张）。
- 决策参考：第一性原理（簿记必须与物理事实同源，不能靠人记）+ Anthropic 工程基线（**证据先行、最小改动**）。

## Q2: 范围
做什么：
- task-state/D583.json
- task-state/D705.json
- task-state/D709.json
- task-state/D710.json
- task-state/D719.json
- task-state/D720.json
- task-state/D737.json
- task-state/D748.json
- task-state/D749.json
- task-state/D750.json
- task-state/D754.json
- task-state/D755.json
- task-state/D756.json
- task-state/D757.json
- task-state/D758.json
- task-state/D759.json
- task-state/D770.json
- task-state/D771.json
- task-state/D773.json
- task-state/D777.json
- task-state/D778.json
- task-state/D793.json
- task-state/D794.json
- task-state/D797.json
- task-state/D818.json
- task-state/D819.json
- task-state/D824.json
- task-state/D831.json
- task-state/D834.json
- task-state/D835.json
- task-state/D837.json
- task-state/D838.json
- task-state/D839.json
- task-state/D848.json
- task-state/D853.json
- task-state/D854.json
- task-state/D856.json
- task-state/D911.json
- task-state/D916.json
- task-state/D917.json
- task-state/D935.json
- task-state/D1000.json
- task-state/D1003.json
- task-state/D1004.json
- task-state/D1012.json
- task-state/D1016.json
- task-state/D1018.json
- task-state/D1022.json
- task-state/D1023.json
- task-state/D1030.json
- task-state/D1031.json
- task-state/D1039.json
- task-state/D1044.json
- task-state/D1049.json
- task-state/D1050.json
- task-state/D1052.json
- task-state/D1058.json
- task-state/D1059.json
- task-state/D1065.json
- task-state/D1093.json
- task-state/D1160.json
- task-state/D1164.json
- task-state/D1168.json
- task-state/D1193.json
- task-state/D1194.json
- task-state/D1197.json
- task-state/D1198.json
- task-state/D1199.json
- task-state/D1200.json
- task-state/D1203.json
- task-state/D1204.json
- task-state/D1206.json
- task-state/D1208.json
- task-state/D1209.json
- task-state/D1210.json
- task-state/D1213.json
- task-state/D1215.json
- task-state/D1219.json
- task-state/D1220.json
- task-state/D1221.json
- task-state/D1222.json
- task-state/D1223.json
- task-state/D1226.json
- task-state/D1227.json
- task-state/D1228.json
- task-state/D1232.json
- task-state/D1233.json
- task-state/D1235.json
- task-state/D1238.json
- task-state/D1241.json
- task-state/D1243.json
- task-state/D9204.json
- task-state/D9205.json
- task-state/D9206.json
- task-state/D9207.json
- task-state/D9208.json
- task-state/D9209.json
- task-state/D9210.json
- .claude/claims/1358.yaml
- .claude/task-briefs/2026-10-08-1358-stale-claims-cleanup.md
（说明：上列 98 个 `task-state/D*.json` 各只改 `status` 一行；`claimed → impl_done`（96）/`audited`（2）。claim 与 brief 为本卡声明载体。）
不做什么（含文件路径）：
- 不改 scripts/control-tower/check-project-coordinates.sh — 原因：卡面校验器本卡零改动（只读它做复验）
- 不改 scripts/control-tower/sync_project_coordinates.py — 原因：其单选字段缺陷归门禁治理线（R46）
- 不改 scripts/pre-commit-check.sh — 原因：D328 对跨任务簿记提交的误判归门禁治理线（同族 #1308）
- 不改 docs/synova/coordination/施工项登记.ts — 原因：CTO 明令归下一轮回填
- 不改 src/growth/proposal-store.ts — 原因：他线在飞文件（本卡实测确认属 `fix/1322-audit-orgid-unknown`）

## Q3: 验收
入口：`git diff --name-only origin/main...HEAD`（本分支变更集）
处理：逐条核「变更集 ⊆ Q2 做什么」且「每文件仅 status 一行变化」
结果：98 个 task-state 文件全部 `impl_done`/`audited`；**判不了的 59 张一张未动**；卡面校验器无回归

## 架构层: 基础设施（簿记/治理面，非 L1-L5）

#CRITERIA: A

## Done 标准:
- [ ] verify: python3 -c "import json,subprocess;bad=[n for n in open('/tmp/claim-cleanup/triage.json') and json.load(open('/tmp/claim-cleanup/triage.json'))['ok'] if json.load(open('task-state/%s.json'%n))['status'] not in ('impl_done','audited')];print('BAD',bad)" ⇒ 输出 `BAD []`
- [ ] verify: git diff --name-only origin/main...HEAD | grep -vE '^(task-state/D[0-9]+\.json|\.claude/claims/1358\.yaml|\.claude/task-briefs/2026-10-08-1358-stale-claims-cleanup\.md)$' | wc -l ⇒ 输出 0（无非声明文件夹带）
- [ ] verify: git diff --numstat origin/main...HEAD -- task-state/ | awk '$1!=1||$2!=1' | wc -l ⇒ 输出 0（每文件恰 1 增 1 删）
- [ ] verify: bash scripts/control-tower/check-project-coordinates.sh ⇒ exit 0（卡面校验器无回归）
