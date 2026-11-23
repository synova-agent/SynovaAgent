# review: #1465
# 豁免登记 — Issue #1463（合并凭证链路甲类：token 第 4 来源 git credential fill）；PR #1465（重切自 #1464，基线 6694cb50d）
#
# 变更性质：**只增凭据来源**，判据/阈值/退出码语义零改动。
#   · resolve_token() 第 4 来源 `git credential fill`（host/protocol 由 $API 推导，禁写死 IP）；
#     前三来源顺序与语义一字未改；取不到 ⇒ 返回非 0（fail-closed，不静默空 token）；
#   · token 只走「管道→shell 变量」：不 set -x、不回显、不落盘；
#   · 判据回归证据：`--selfcheck` → SELFCHECK-OK: 13/13；主配对测试 → 14 通过, 0 失败（WSL 默认 bash）；
#   · 乙类（② 移植修复／E_NO_TOKEN）**只出提案、未改脚本**，另走 A 类送审。
# 依据：CTO 2026-11-23 裁定（甲类 B 类直做；乙类 A 类送审，不与甲类同 PR）。
#
# 逐文件豁免（三段式：路径 — 理由（≥10 字） — 裁定号）：
- scripts/control-tower/check-merge-conditions.sh — 只增凭据第 4 来源（GCM），判据/阈值/退出码零改动 — #1463
- tests/control-tower/check-merge-conditions-token.test.sh — 配套配对测试（6 判定点，含改坏必红三态） — #1463
- docs/authority/DOCS-REGISTRY.yaml — 纯追加一行 DOC-1463-01 登记（乙类提案） — #1463
- gate-exemptions/2026-11-23-1464-merge-cred-chain.md — 本豁免件自身在 diff 内（自覆盖行） — #1463
