# review: #1146
- scripts/install-hooks.sh — 3 处日志写入改工具中立路径并 mkdir，含头注同步 — #1146
- scripts/hooks/post-commit.sh — marker 读取改新路径优先、legacy 只读回落带告警 — #1146
- scripts/pre-commit-check.sh — 失败日志读取改新路径优先、legacy 只读回落带告警 — #1146
- scripts/workflow/loop-context.sh — 失败率统计读取同步新路径与回落 — #1146
- scripts/control-tower/log-snapshot.sh — 日志快照读取同步新路径与回落 — #1146
- scripts/control-tower/gen-cto-health.py — CTO 健康仪表盘数据源改新路径优先 — #1146
- scripts/project/pr-queue-scan.py — 噪声清单同时登记新路径 — #1146
- scripts/check-fde-terms.sh — 术语白名单补 .synova/logs 运行时产物 — #1146
- gate-exemptions/2026-10-29-decouple-install-hooks.md — 本豁免件自覆盖（三段式声明自身） — #1146
