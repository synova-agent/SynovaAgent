# gate-exemptions — #1094（W2 运行遥测：duration_ms/hits ＋「未运行」与「零命中」区分）

- scripts/control-tower/gate-telemetry.sh — 新增 gate-hits JSONL 单写入器（三态 0/1/2；写失败 stderr 加 degraded 日志；不改门禁结论） — #1094
- scripts/control-tower/gate-stats.sh — 扩统计列（触发/命中/中位耗时）；空日志报「未运行」并禁「零命中可退役」候选（M-8） — #1094
- scripts/pre-commit-check.sh — log_gate 埋点改为经 gate-telemetry 写入 duration_ms/hits（只改本埋点，不动各检查组） — #1094
- tests/control-tower/gate-telemetry.test.sh — 上述写入器配对测试（三态、写失败降级、转义、LF、改坏必红） — #1094
- tests/control-tower/gate-stats.test.sh — 上述统计扩配对测试（中位耗时、未运行与零命中分离、M-8、改坏必红） — #1094
- gate-exemptions/2026-10-28-1094-gate-telemetry.md — 本豁免文件自身受保护，按 #623 加同 diff 自覆盖行 — #1094
- docs/authority/DOCS-REGISTRY.yaml — D782 D2 登记门禁要求登记本豁免文件（DOC-0317），仅追加一条 — #1094
