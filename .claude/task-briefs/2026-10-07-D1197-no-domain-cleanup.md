# 清分域：scan/budget 的最后三域名残留

#CRITERIA: A

## Q0:
定位：治理层（控制塔扫描器 + PR 预算门禁）。分域废止收尾。
背景：创始人 2026-10-07「不分域。谁有空，谁能做就谁做。」已授权清理（#1245/#1246/#1247）。
现状（实测）：全仓仍有 2 处把 `mac|win|k3` 当活口径：
  · scan-fullwidth-vars.sh 的 owner 解析 awk 硬编码三域名（单域后 owner=maintainer 整行被丢）
  · check-pr-budget.sh 的显示过滤只认三域名

## Q1:
调研：两处均为分域残留；#1245 已把 ownership.yaml 单域化 ⇒ 三域名在数据源中不存在。
结论：改为「任意 owner 键」，使单域下正常显示；同步修过期测试断言。

## Q2:
做什么：
- scripts/control-tower/scan-fullwidth-vars.sh
- scripts/control-tower/check-pr-budget.sh
- tests/control-tower/check-pr-budget.test.sh
- .claude/task-briefs/2026-10-07-D1197-no-domain-cleanup.md
- task-state/D1197.json

不做什么：
- 不改 scripts/control-tower/check-ownership.py（#1247 已改，本卡只读）
- 不改 docs/synova/coordination/ownership.yaml（#1245 已单域化）
- 不改 scripts/audit/self-diagnosis.py

## Q3:
入口：bash scripts/control-tower/check-pr-budget.sh --files "<多个路径>"
处理：owner 解析取任意首字段 → 域判定 → 单域恒 PASS
结果：输出「✅ 变更单域」；跨域语句保留为信息性语义（不阻断）

## 架构层:
基础设施 控制塔治理层（扫描器 + PR 预算门禁）——不触 L1-L5 运行时

## Done 标准
- [x] 归属解析不再丢单域 owner verify: bash tests/control-tower/scan-fullwidth-vars.test.sh
- [x] 预算门禁点名「变更单域」 verify: bash tests/control-tower/check-pr-budget.test.sh
- [x] 全仓无把 mac|win|k3 当活口径者 verify: grep -rn "mac|win|k3" scripts/control-tower/ | grep -v "废止" || true
