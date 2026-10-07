# 清分域：ownership.yaml 单域化

#CRITERIA: A

## Q0:
定位：治理层（控制塔归属校验器 + CODEOWNERS 生成链）。
背景：创始人 2026-10-07 明令「不分域。谁有空，谁能做就谁做。」并授权本批清掉数据源。
现状（实测）：ownership.yaml 仍按 mac/win/k3 三域划分 42 条 glob；check-pr-budget.sh 的 ② 项
调 check-ownership.py 做**单域判定**（跨 >1 域 ⇒ exit 1）⇒ **分域仍在门禁里拦 PR**。

## Q1:
调研：仓内消费者三处（check-ownership.py / check-pr-budget.sh / scan-fullwidth-vars.sh）
+ persona 的「D734 PR 预算：≤12 文件 + 单域」。
实测关键事实：CODEOWNERS 的 44 处 owner **全部**是 @tangbaobao520 ⇒ 单域化**不改变产物语义**。
结论：把数据源改单域（跨域结构上不可能），保留校验器与 CODEOWNERS 生成能力。

## Q2:
做什么：
- docs/synova/coordination/ownership.yaml
- .github/CODEOWNERS
- scripts/control-tower/check-ownership.py
- tests/control-tower/check-ownership.test.sh
- .claude/task-briefs/2026-10-07-D1197-no-domain-cleanup.md
- scripts/control-tower/scan-fullwidth-vars.sh
- tests/control-tower/scan-fullwidth-vars.test.sh
- tests/control-tower/check-pr-budget.test.sh
- scripts/control-tower/check-ownership.py（用法串订正）
- task-state/D1197.json

不做什么：
- 不改 scripts/control-tower/check-pr-budget.sh（其域判定读数据源，数据单域后自然失效）
- 不改 scripts/audit/self-diagnosis.py

## Q3:
入口：python3 scripts/control-tower/check-ownership.py <文件...>
处理：ownership.yaml 单域（** 一条兜底，owner 键唯一）→ 校验器解析 → --emit-codeowners
结果：归属恒同域（跨域不可能）；CODEOWNERS 重生成；drift 夹具逐字节断言

## 架构层:
基础设施 治理层（控制塔归属校验器 + CODEOWNERS 生成链）——不触 L1-L5 运行时

## Done 标准
- [x] 归属查询恒同域 verify: python3 scripts/control-tower/check-ownership.py src/server.ts scripts/control-tower/check-ownership.py docs/synova/coordination/ownership.yaml
- [x] 产物 drift 逐字节一致 verify: bash tests/control-tower/check-ownership.test.sh
- [x] 单域结构（恰 1 条 glob / owner 键恰 1 个 / 无 territory / 无 mac|win|k3 键） verify: bash tests/control-tower/check-ownership.test.sh
- [x] 非单域仍必红（判别性夹具） verify: bash tests/control-tower/check-ownership.test.sh
