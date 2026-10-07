# Task Brief — 1224-claim-gate-drill: claim 身份通道「仓内可跑」演练夹具（D-C③ 地基）

## Q0: 定位
- 治理面（门禁/控制塔域）：`scripts/control-tower/merge_writeset_gate.py`（D708 合并级写集对账）的
  **claim 身份通道**；本卡只新增**夹具**，不改生产脚本一行。
- 为什么现在做（Lead 派单 P0）：D-C 的 Done ③ = 「新格式下改坏即红」，而**这条通道是它的地基** ——
  若 claim 在异 root/异环境读不到，"新身份格式"只在本机成立。
- 起点：Lead 在受控沙箱实测（合法 claim + 分支名带 issue + 显式 `--issue` + `--repo-root`）
  得到「⚠️ degraded — 四源皆空 → fail-closed」，**未定性**；本卡负责定性并把它钉成可执行断言。

## Q1: 调研
- **实测真因（本夹具 A/D 唯一变量对照证明）**：`merge_writeset_gate.py:607/634` 的
  `collect_declared` 把 **helper 脚本**（`brief_parser.py` / `devdoc_writeset.py`）定位在
  `<repo-root>/scripts/control-tower/` 下（不是脚本自身所在仓）⇒ 裸沙箱里没有这棵 helper 树 ⇒
  `python3 <缺失路径>` 退出码 **2**（Python "can't open file"）⇒ S0 记为"解析失败"⇒ 四源皆空 ⇒ fail-closed。
  结论：**不是**"claim 在异 root 读不到"（`claim_store` 自己读得到；变更集/merge-base 也正确指向沙箱）。
- **前提**：`--repo-root` 指向的树必须带本仓 `scripts/` 树。真仓 worktree 天然满足；裸沙箱须先
  `cp -R <repo>/scripts <sandbox>/` —— 既有 `merge_writeset_gate.test.sh` 一直这么做，是**隐性既有约定**。
- **① 判据（Lead 给的）结论**：真仓 worktree 等价前提（= repo-root 内带 helper 树）下**通过**：
  `pass` + 声明来源 `S0:claim.writeset` + rc=0 ⇒ 按 Lead 的判据属"沙箱失真"支 ⇒ 交付本演练夹具。
- 决策参考：第一性原理（**测试前提必须显式**：隐性约定 = 下一个人必踩）+ Anthropic 工程基线
  （夹具自包含可复现；唯一变量对照可归因）。

## Q2: 范围
做什么：
- tests/control-tower/claim-gate-drill.test.sh
- .claude/task-briefs/2026-10-08-1224-claim-gate-drill.md
- .claude/claims/1224.yaml
不做什么（含文件路径）：
- 不改 scripts/control-tower/merge_writeset_gate.py（helper 定位策略/报错措辞的返工与否**由 Lead/K3 裁**；
  本卡只把现状与因果钉成断言，不自裁 A 类文件行为）
- 不改 scripts/control-tower/alloc-task-id.sh、.github/workflows/ci.yml、scripts/audit/**
- 不动 scripts/control-tower/claim_store.py 的 SYNO_CLAIM_V2 默认值（迁移级开关，默认关不变）
- 不改 tests/control-tower/merge_writeset_gate.test.sh（既有 D708 夹具，避免写集与他线重叠）

## Q3: 验收
入口：`bash tests/control-tower/claim-gate-drill.test.sh`
处理：A 正向（helper 树在 → pass + `S0:claim.writeset`）／D 唯一变量对照（只去 helper 树 → rc=2 + 点名
      `S0 claim 解析失败` + 复现「四源皆空」观感）／B 畸形 claim（writeset 空 → fail-closed rc=2）／
      C 写集不含变更文件（→ 夹带 rc=1）／E 接线（断言真的走 claim 源，未回落 D# brief 链）
结果：8 断言全绿；机制因果可复跑；前提写成可执行断言而非注释

## 架构层: 基础设施

#CRITERIA: D

## Done 标准:
- [ ] verify: bash tests/control-tower/claim-gate-drill.test.sh ⇒ 0 失败（8 断言）
- [ ] verify: bash scripts/control-tower/check-gate-integrity.sh ⇒ GATE-INTEGRITY: OK
- [ ] verify: bash scripts/control-tower/scan-fullwidth-vars.sh --paths tests/control-tower/claim-gate-drill.test.sh ⇒ 违规 0
- [ ] verify: GITHUB_ACTIONS=true SYNO_CI=1 SYNO_DIFF_BASE=origin/main bash scripts/pre-commit-check.sh ⇒ rc=0

## 写集
| 文件 | 类型 |
|---|---|
| tests/control-tower/claim-gate-drill.test.sh | task（新夹具） |
| .claude/task-briefs/2026-10-08-1224-claim-gate-drill.md | task（自身） |
| .claude/claims/1224.yaml | task（声明载体：累加本卡两条，不改既有行） |
