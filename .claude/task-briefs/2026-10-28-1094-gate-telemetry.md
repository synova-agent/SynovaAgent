# Task Brief: #1094 W2 运行遥测（gate-hits 扩 duration_ms/hits ＋「未运行」与「零命中」区分）

#CRITERIA: D

## Q0: 定位（项目拼图 + 文件审计）

- 治理线 / 控制塔门禁观测面：`.claude/gate-hits.log`（JSONL，运行态，.gitignore 刻意忽略）是
  「门禁是否在跑、跑多慢、是否真命中」的唯一数据源。现有读者 = `gate-stats.sh`（月度汇总）、
  `gate-retirement-report.sh`（90 天退役复审）、`log-snapshot.sh`（取证快照）。
- 缺口（#1094 核实前提）：原 4 字段 `{time,gate,result,branch}` 无法区分「没跑」与「跑了但 0 命中」，
  也没有耗时；空日志会被读成「零命中候选」⇒ 可能退役仍在用的门禁（M-8）。
- 文件审计：`grep -n "log_gate\|gate-hits" scripts/pre-commit-check.sh scripts/control-tower/*.sh`
  确认写入方仅 pre-commit 的 `log_gate`（单点），无第二个写入者、无既有遥测目录；读者均按可选字段读取。

## Q1: 调研（决策链 / 既有基础）

- 既有机制：D515 项4 已把命中统计收敛到 `log_gate` 单点；`gate-retirement-report.sh` 已按
  「无数据 ≠ 零命中」口径处理，其「声明检查点全集」扫描口径（`hard_check|soft_check|v5_soft|decl_check`）可复用。
- 决策参考系：第一性原理（观测缺失 ⇒ 判定失真；先让状态可判，再谈统计）＋ Anthropic 工程基线
  （三态退出码、降级显式、单点写入器）＋ 开源实证（JSONL 追加日志 ＋ 读取端兼容旧行）。
- 红线：不新建遥测目录、日志不入库（.gitignore 继续忽略，刻意设计）；遥测写失败不改门禁结论；
  `scripts/audit/**` 属 K3 不碰；本批只加观测面，不改任何门禁判据（判据变更归 CTO）。

## Q2: 范围（做什么 / 不做什么 — 含文件路径）

做什么：
- scripts/control-tower/gate-telemetry.sh
- scripts/control-tower/gate-stats.sh
- scripts/pre-commit-check.sh
- tests/control-tower/gate-telemetry.test.sh
- tests/control-tower/gate-stats.test.sh
- gate-exemptions/2026-10-28-1094-gate-telemetry.md
- .claude/task-briefs/2026-10-28-1094-gate-telemetry.md
- .claude/claims/1094.yaml
- memory/notes/proposed/2026-10-28-1094-gate-telemetry.md
- docs/authority/DOCS-REGISTRY.yaml
- docs/authority/WIRING-REGISTRY.yaml

不做什么：
- 不改 .gitea/workflows/local-gates.yml — 本批不新增 CI 步（接入另卡）
- 不改 scripts/control-tower/gate-retirement-report.sh — 退役复审报告口径另卡
- 不改 scripts/control-tower/log-snapshot.sh — 快照读取保持兼容（新字段为可选）
- 不改 scripts/audit/ — K3 审计专属红线
- 不改 scripts/control-tower/probe-delivery-hygiene.sh — 探针归 P7，本批零接触

## Q3: 验收（入口 → 交互 → 结果）

- 入口 A：`bash tests/control-tower/gate-telemetry.test.sh`（写入器三态/降级/转义/改坏必红）
- 入口 B：`bash tests/control-tower/gate-stats.test.sh`（统计列/未运行与零命中分离/M-8/改坏必红）
- 交互：pre-commit 每个检查点调用 `log_gate` → 经 `gate-telemetry.sh --emit` 追加
  `{time,gate,result,branch,duration_ms,hits}`；`gate-stats.sh` 读日志 + 扫 pre-commit 声明检查点。
- 结果：有记录 ⇒ 表内 触发/命中/通过/中位耗时/误报代理；无记录 ⇒ 只报「未运行」并明确
  「无数据 ≠ 零命中、不得据此退役」（不产出候选清单）。

## 架构层: 不属五层业务（治理脚本）

## Done 标准

- [x] 写入器三态与写失败降级可证 → verify: bash tests/control-tower/gate-telemetry.test.sh
- [x] 统计列与「未运行/零命中」分离可证 → verify: bash tests/control-tower/gate-stats.test.sh
- [x] M-8 空日志只报「未运行」→ verify: SYNO_GATE_HITS_LOG=/tmp/none-1094.log bash scripts/control-tower/gate-stats.sh
- [x] 受保护路径逐条合规豁免 → verify: bash scripts/control-tower/check-gate-protection.sh --changed-base gitea/local-main --root .
- [x] 本地门禁通过（唯一允许红＝①c 内容面耦合 Windows 路径缺陷） → verify: SYNO_CI=1 bash scripts/pre-commit-check.sh
